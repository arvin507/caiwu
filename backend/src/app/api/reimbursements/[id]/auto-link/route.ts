import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { isInvoiceOccupied } from '@/lib/reimbursementLink'

export const runtime = 'nodejs'

/** 金额统一到「分」比较，吸收浮点误差与个位数不一致（如 4794.52 vs 4794.5） */
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * POST /api/reimbursements/:id/auto-link
 * 批量上传的发票按金额自动关联到本报销单的明细行。
 *
 * body: { invoiceIds: string[] } —— 本次上传返回的一批发票 id
 *
 * 匹配规则（保守策略）：
 *  - 仅用「本单尚未关联」的明细行（items + legs）参与匹配
 *  - 仅用「解析成功且能拿到价税合计」的发票参与匹配
 *  - 每张合格发票，在剩余未关联行里找金额（精确到分）相等的行：
 *      恰好 1 行  → 自动关联
 *      0 行       → 进 unmatched（无对应明细金额）
 *      ≥2 行      → 进 unmatched（金额重复，需人工，避免挂错）
 *  - 发票解析失败 / 无金额 / 已被其它单占用 → 进 unmatched
 *
 * 返回 { linked: [...], unmatched: [...] }，前端据此展示并引导人工补关联。
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
    select: { id: true, submitterId: true },
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
      items: { where: { invoiceId: null } },
      legs: { where: { invoiceId: null } },
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
    select: { id: true, invoiceNumber: true, parseStatus: true, parsedData: true },
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
    reason: 'parseFailed' | 'noMatch' | 'ambiguous' | 'occupied'
  }> = []
  // 已自动关联的行，避免被同批次另一张发票重复占用
  const usedLineIds = new Set<string>()

  for (const inv of invoices) {
    const raw = inv.parsedData && (inv.parsedData as Record<string, unknown>).totalAmount
    const amt = raw != null && !isNaN(Number(raw)) ? round2(Number(raw)) : null

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
    if (matches.length > 1) {
      unmatched.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: amt,
        reason: 'ambiguous',
      })
      continue
    }

    const line = matches[0]
    // 保险：发票是否已被其它报销单的行占用
    if (await isInvoiceOccupied(prisma, inv.id, line.id)) {
      unmatched.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: amt,
        reason: 'occupied',
      })
      continue
    }

    if (line.type === 'item') {
      await prisma.reimbursementItem.update({
        where: { id: line.id },
        data: { invoiceId: inv.id },
      })
    } else {
      await prisma.reimbursementTripLeg.update({
        where: { id: line.id },
        data: { invoiceId: inv.id },
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

  return NextResponse.json({ linked, unmatched })
}
