// 增值税进项抵扣规则引擎
//
// 定位：本系统做「进项抵扣台账 + 申报底稿生成器」，不替代税务数字账户
// （实际勾选动作仍在税务局平台手动完成，系统只记录状态并汇总）。
//
// 本模块基于发票 OCR 解析结果（parsedData）算两件事：
//   1) 能否抵扣（canDeduct）—— 专票/数电专票/铁路电子客票/机动车销售统一发票等可抵，
//      增值税普通发票不可抵。
//   2) 可抵扣进项税额（deductibleTax）与不含税金额（taxExclusiveAmount）。
//
// 法规要点（已核实）：
//   - 专票/数电专票：可抵扣进项税额 = 票面「税额」。
//   - 铁路电子客票（公告2024年第8号，2024-11-01起）：一般纳税人以数电铁路客票作扣税凭证，
//     进项税额 = 票面税额（数电票直接给）；纸质火车票按 票价÷(1+9%)×9%。
//   - 不可抵扣（须进项转出）：餐饮服务/居民日常服务/娱乐服务/贷款服务、用于简易计税/
//     免税项目/集体福利/个人消费的购进（财税〔2016〕36号附件1第27条）。
import { prisma } from '@/lib/prisma'

/** 发票解析结果（后端本地定义，避免跨项目依赖前端 @/types） */
interface ParsedInvoiceLite {
  invoiceType?: 'vat' | 'train' | string | null
  voucherTitle?: string | null
  rawText?: string | null
  taxRate?: string | null
  amount?: string | null
  taxAmount?: string | null
  totalAmount?: string | null
  [key: string]: unknown
}

/**
 * 从票面原文兜底判定凭证专/普类别。
 * 用于「voucherTitle 缺失（历史数据/OCR 漏抽）」时仍能正确区分专票与普票，
 * 避免一张明显的专票因缺标题字段被误判为不可抵扣。
 *   返回 'special' 增值税专用发票/电子专用发票等（可抵）
 *        'motor'  机动车销售统一发票（可抵）
 *        'normal' 增值税普通发票/电子普通发票（不可抵）
 *        null     无法判定（保持安全默认：不可抵）
 */
function deriveVoucherClassFromText(text: string | null | undefined): 'special' | 'motor' | 'normal' | null {
  if (!text) return null
  const t = text.replace(/\s+/g, '')
  if (t.includes('机动车销售统一发票')) return 'motor'
  // 「专用发票」是专票的最强特征词（增值税专用发票/电子专用发票/数电专用发票）
  if (t.includes('专用发票')) return 'special'
  if (t.includes('增值税普通发票') || t.includes('电子普通发票') || t.includes('普通发票')) return 'normal'
  return null
}

/**
 * 解析凭证标题与是否专票类。
 * 优先用结构化字段 voucherTitle；缺失时回退扫描 rawText。
 */
function resolveVoucherInfo(parsed: ParsedInvoiceLite): { title: string | null; isSpecial: boolean } {
  const title = parsed.voucherTitle ?? null
  if (title) {
    const isSpecial = title.includes('专用') || title.includes('机动车销售统一发票')
    return { title, isSpecial }
  }
  const klass = deriveVoucherClassFromText(parsed.rawText)
  if (klass === 'special') return { title: '增值税专用发票', isSpecial: true }
  if (klass === 'motor') return { title: '机动车销售统一发票', isSpecial: true }
  if (klass === 'normal') return { title: '增值税普通发票', isSpecial: false }
  return { title: null, isSpecial: false }
}

/** 抵扣状态机 */
export type DeductionStatus =
  | 'unconfirmed' // 未勾选
  | 'selected' // 已勾选（在税务数字账户勾选确认）
  | 'deducted' // 已申报抵扣
  | 'transferred_out' // 进项转出（不可抵/用途改变）

export const DEDUCTION_STATUSES: DeductionStatus[] = [
  'unconfirmed',
  'selected',
  'deducted',
  'transferred_out',
]

/** 规则引擎算出的抵扣结果 */
export interface DeductionComputed {
  voucherKind: string | null
  canDeduct: boolean
  taxRate: string | null
  taxExclusiveAmount: string | null
  deductibleTax: string | null
}

/** 标准增值税税率档位（用于把「税额/金额」反推的税率吸附到最近档） */
const STD_RATES = [0.01, 0.03, 0.05, 0.06, 0.09, 0.11, 0.13, 0.16, 0.17]
function snapRate(r: number): number {
  return STD_RATES.reduce((best, x) => (Math.abs(x - r) < Math.abs(best - r) ? x : best))
}

const TRAIN_RATE = 0.09

function toNum(v: string | null | undefined): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 核心：依据发票解析结果 + 发票类型算抵扣结果。
 * @param parsed 发票 parsedData（可能为 null：解析失败/尚未解析）
 * @param invoiceType 'vat' | 'train'
 */
export function computeDeduction(
  parsed: ParsedInvoiceLite | null | undefined,
  invoiceType?: string | null,
): DeductionComputed {
  if (!parsed) {
    return {
      voucherKind: null,
      canDeduct: false,
      taxRate: null,
      taxExclusiveAmount: null,
      deductibleTax: null,
    }
  }

  // ── 铁路电子客票（火车票）：法定 9% ──
  if (invoiceType === 'train' || parsed.invoiceType === 'train') {
    const fare = toNum(parsed.totalAmount)
    // 数电铁路客票票面直接给税额，优先采用；否则按 票价÷(1+9%)×9%
    let deductible = toNum(parsed.taxAmount)
    if (deductible == null && fare != null) {
      deductible = +(fare / (1 + TRAIN_RATE) * TRAIN_RATE).toFixed(2)
    }
    const exclusive = fare != null && deductible != null ? +(fare - deductible).toFixed(2) : null
    return {
      voucherKind: '铁路电子客票',
      canDeduct: true,
      taxRate: '0.09',
      taxExclusiveAmount: exclusive != null ? String(exclusive) : null,
      deductibleTax: deductible != null ? String(deductible) : null,
    }
  }

  // ── 增值税专/普票 ──
  // 优先用结构化标题，缺失时回退扫描票面原文，避免专票被误判不可抵
  const { title, isSpecial } = resolveVoucherInfo(parsed)
  const canDeduct = isSpecial

  const tax = toNum(parsed.taxAmount)
  const amount = toNum(parsed.amount)
  const total = toNum(parsed.totalAmount)

  // 税率：优先用票面 taxRate，否则用 税额/金额 反推并吸附到标准档
  let rate: number | null = toNum(parsed.taxRate)
  if (rate == null && tax != null && amount != null && amount !== 0) {
    rate = snapRate(tax / amount)
  }

  const deductibleTax = canDeduct && tax != null ? String(tax) : null
  // 不含税金额：优先票面「金额」，缺则退化为价税合计
  const taxExclusiveAmount =
    amount != null ? String(amount) : total != null ? String(total) : null

  return {
    voucherKind: title ?? '增值税其他',
    canDeduct,
    taxRate: rate != null ? `${rate.toFixed(2)}` : null,
    taxExclusiveAmount,
    deductibleTax,
  }
}

/**
 * 同步某张发票的抵扣记录：算结果并 upsert 到 invoice_deductions。
 * 在发票解析结果变化时调用（上传/重识别/批量重算），保证台账与解析一致。
 * @param invoiceId 发票 id
 * @param parsed 发票解析结果
 * @param invoiceType 发票类型
 */
export async function syncDeduction(
  invoiceId: string,
  parsed: ParsedInvoiceLite | null | undefined,
  invoiceType?: string | null,
): Promise<void> {
  const c = computeDeduction(parsed, invoiceType)
  await prisma.invoiceDeduction.upsert({
    where: { invoiceId },
    create: {
      invoiceId,
      voucherKind: c.voucherKind,
      canDeduct: c.canDeduct,
      taxRate: c.taxRate,
      taxExclusiveAmount: c.taxExclusiveAmount,
      deductibleTax: c.deductibleTax,
    },
    update: {
      voucherKind: c.voucherKind,
      canDeduct: c.canDeduct,
      taxRate: c.taxRate,
      taxExclusiveAmount: c.taxExclusiveAmount,
      deductibleTax: c.deductibleTax,
    },
  })
}
