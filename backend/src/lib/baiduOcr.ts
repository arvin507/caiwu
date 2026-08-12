// 百度 OCR：增值税发票识别（云端）
//
// 适用场景：图片类发票（png/jpg/jpeg/bmp/gif/webp）——本地无法从图片抽文字，
// 需把图片发送到百度云端识别。PDF/OFD 仍走本地解析（见 invoiceParser.ts）。
//
// 费用与合规提示：
//  - 百度 OCR 有免费额度，超出按调用量计费，需在控制台开通「文字识别 OCR」服务。
//  - 发票属于财务敏感数据，调用意味着文件会发往百度云端；学习/内部可用，
//    上线前请评估数据合规（或改用私有化部署 / 本地 OCR）。
import type { ParsedInvoice } from './invoiceParser'

const TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token'
const VAT_URL = 'https://aip.baidubce.com/rest/2.0/ocr/v1/vat_invoice'

// access_token 有效期约 30 天，这里在进程内缓存，过期前复用，减少获取调用
let cachedToken: { token: string; expireAt: number } | null = null

/** 用 API Key / Secret Key 换取 access_token（百度 OAuth client_credentials 模式） */
export async function getBaiduToken(): Promise<string> {
  const apiKey = process.env.BAIDU_OCR_API_KEY
  const secretKey = process.env.BAIDU_OCR_SECRET_KEY
  if (!apiKey || !secretKey) {
    throw new Error(
      '未配置百度 OCR 密钥：请在 backend/.env 设置 BAIDU_OCR_API_KEY 与 BAIDU_OCR_SECRET_KEY',
    )
  }
  if (cachedToken && cachedToken.expireAt > Date.now()) return cachedToken.token

  const url =
    `${TOKEN_URL}?grant_type=client_credentials` +
    `&client_id=${encodeURIComponent(apiKey)}` +
    `&client_secret=${encodeURIComponent(secretKey)}`
  const res = await fetch(url, { method: 'POST' })
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string }
  if (!json.access_token) {
    throw new Error('获取百度 access_token 失败: ' + JSON.stringify(json))
  }
  // 提前 60s 过期，避免临界时刻用到失效 token
  cachedToken = {
    token: json.access_token,
    expireAt: Date.now() + (Number(json.expires_in) || 2592000) * 1000 - 60_000,
  }
  return cachedToken.token
}

/**
 * 从 words_result 里取字段，兼容两种返回结构：
 *  - 专用接口 vat_invoice 直接返回字符串：words_result.InvoiceCode = "12345"
 *  - 部分场景返回 { words: "12345" }
 * keys 可传多个候选名，命中第一个非空值。
 */
function pick(wr: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = wr?.[k]
    if (v == null) continue
    const s = typeof v === 'string' ? v : ((v as { words?: unknown })?.words ?? '').toString()
    if (s && s.trim()) return s.trim()
  }
  return null
}

/** 调用百度「增值税发票识别」接口，把结果映射为 ParsedInvoice */
export async function baiduVatOcr(base64: string): Promise<ParsedInvoice> {
  // 百度限制图片 base64 后不超过约 4MB（原图约 3MB），过大直接提示压缩，避免无谓请求
  if (base64.length > 4 * 1024 * 1024) {
    throw new Error('图片过大（base64 > 4MB），请压缩后重试（建议原图 < 3MB）')
  }

  const token = await getBaiduToken()
  const res = await fetch(`${VAT_URL}?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    // image 为纯 base64 串（不带 data URI 前缀），按 urlencode 提交
    body: `image=${encodeURIComponent(base64)}`,
  })
  const json = (await res.json()) as {
    error_code?: number
    error_msg?: string
    words_result?: Record<string, unknown>
  }
  if (json.error_code) {
    throw new Error(`百度 OCR 错误 ${json.error_code}: ${json.error_msg}`)
  }

  const wr = json.words_result || {}
  return {
    // vat_invoice 字段映射（与本地解析抽出的字段对齐）
    invoiceCode: pick(wr, 'InvoiceCode'), // 发票代码
    invoiceNumber: pick(wr, 'InvoiceNum'), // 发票号码
    invoiceDate: pick(wr, 'InvoiceDate'), // 开票日期
    sellerName: pick(wr, 'SellerName'), // 销售方名称
    sellerTaxId: pick(wr, 'SellerRegisterNum'), // 销售方纳税人识别号
    buyerName: pick(wr, 'PurchaserName'), // 购买方名称
    amount: pick(wr, 'TotalAmount'), // 合计金额（不含税）
    taxAmount: pick(wr, 'TotalTax'), // 合计税额
    totalAmount: pick(wr, 'AmountInFiguers'), // 价税合计（小写）
    // 把百度返回的全部结构化字段存为原文，前端「核对」页可查看/人工校对
    rawText: JSON.stringify(wr, null, 2),
  }
}
