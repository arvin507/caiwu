import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'

export const runtime = 'nodejs'

/** 金额统一到「分」比较，吸收浮点误差与个位数不一致（如 4794.52 vs 4794.5） */
const round2 = (n: number) => Math.round(n * 100) / 100

const includeReb = {
  items: { include: { links: { include: { invoice: true } } } },
  trip: true,
  legs: { include: { links: { include: { invoice: true } } } },
} as const

/**
 * POST /api/reimbursements/:id/auto-link
 * 批量上传的发票按金额自动关联到本报销单「尚未关联」的明细行（通过发票关联表）。
 *
 * body: { invoiceIds: string[] }
 *
 * 匹配规则（保守策略，自动只做 1:1 精确匹配；1:N / N:1 分摊由人工在弹窗完成）：
 *  - 仅用「本单尚未关联（links 为空）」的明细行参与匹配
 *  - 仅用「解析成功且能拿到价税合计」的发票参与匹配
 *  - 每张合格发票，在剩余未关联行里找金额（精确到分）相等的行：
 *      恰好 1 行  → 自动关联（写一条 InvoiceLink）
 *      0 行       → 进 unmatched（无对应明细金额）
 *      ≥2 行      → 进 unmatched（金额重复，需人工，避免挂错）
 *
 * 返回 { linked, unmatched, reimbursement }，前端据此刷新详情/列表。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { id } = await params
  const reb = await prisma.reimbursement.findUnique({
    where: { id },
    select: { id: true, submitterId: true, applicantName: true },
  })
  if (!reb) return NextResponse.json({ error: '报销单不存在' }, { status: 404 })
  if (user.role !== 'admin' && reb.submitterId !== user.id) {
    return NextResponse.json({ error: '无权限操作该报销单' }, { status: 403 })
  }

  const body = (await req.json().catch(() => null)) as { invoiceIds?: string[] } | null
  if (!body || !Array.isArray(body.invoiceIds) || body.invoiceIds.length === 0) {
    return NextResponse.json({ error: 'invoiceIds 必填且非空' }, { status: 400 })
  }

  // 本单所有「尚未关联」的明细行，作为匹配候选
  const full = await prisma.reimbursement.findUnique({
    where: { id },
    include: {
      items: { where: { links: { none: {} } } },
      legs: { where: { links: { none: {} } } },
    },
  })
  if (!full) return NextResponse.json({ error: '报销单不存在' }, { status: 404 })

  const lines = [
    ...full.items.map((i) => ({
      type: 'item' as const,
      id: i.id,
      amt: round2(Number(i.amount.toString())),
    })),
    ...full.legs.map((l) => ({
      type: 'leg' as const,
      id: l.id,
      amt: round2(Number(l.amount.toString())),
    })),
  ]

  // 本次上传的这批发票（仅取必要字段）
  const invoices = await prisma.invoice.findMany({
    where: { id: { in: body.invoiceIds } },
    select: { id: true, invoiceNumber: true, ownerName: true, parseStatus: true, parsedData: true },
  })

  const linked: Array<{
    invoiceId: string
    invoiceNumber: string | null
    lineType: 'item' | 'leg'
    lineId: string
    amount: number
  }> = []
  const unmatched: Array<{
    invoiceId: string
    invoiceNumber: string | null
    amount: number | null
    reason: 'parseFailed' | 'noMatch' | 'ambiguous' | 'ownerMismatch'
  }> = []
  // 已自动关联的行，避免被同批次另一张发票重复占用
  const usedLineIds = new Set<string>()

  for (const inv of invoices) {
    const raw = inv.parsedData && (inv.parsedData as Record<string, unknown>).totalAmount
    const amt = raw != null && !isNaN(Number(raw)) ? round2(Number(raw)) : null

    // 业务硬规则：发票归属人须等于报销单申请人，否则不参与自动匹配
    if ((inv.ownerName || '').trim() !== (reb.applicantName || '').trim()) {
      unmatched.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: amt,
        reason: 'ownerMismatch',
      })
      continue
    }

    // 解析失败 / 无金额 → 无法自动匹配
    if (inv.parseStatus !== 'done' || amt === null) {
      unmatched.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: amt,
        reason: 'parseFailed',
      })
      continue
    }

    const matches = lines.filter((l) => !usedLineIds.has(l.id) && l.amt === amt)
    if (matches.length === 0) {
      unmatched.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: amt,
        reason: 'noMatch',
      })
      continue
    }

    // 同一金额存在多条未关联明细行时，金额等价可互换，直接贪心取第一条关联。
    // 例：两张 141 发票 + 两条 141 明细 → 各挂一条，两张全部自动关联。
    // usedLineIds 防止同一条明细在同一批次内被两张发票重复占用（不会超额挂账）。
    const line = matches[0]
    // 写一条关联（1:1 精确匹配）；同一发票可再被人工关联到其它行（N:1）
    if (line.type === 'item') {
      await prisma.invoiceLink.create({
        data: { invoiceId: inv.id, reimbursementItemId: line.id },
      })
    } else {
      await prisma.invoiceLink.create({
        data: { invoiceId: inv.id, reimbursementLegId: line.id },
      })
    }
    usedLineIds.add(line.id)
    linked.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      lineType: line.type,
      lineId: line.id,
      amount: amt,
    })
  }

  // 返回最新整单（含已关联发票），前端据此刷新详情/列表，使「已匹配」即时显示为已关联
  const reimbursement = await prisma.reimbursement.findUnique({
    where: { id },
    include: includeReb,
  })
  return NextResponse.json({ linked, unmatched, reimbursement })
}
