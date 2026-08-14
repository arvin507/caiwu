import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { upsertLink, deleteLink, type LineType } from '@/lib/reimbursementLink'

export const runtime = 'nodejs'

/** 关联/反关联后返回的最新整单（含 links + invoice），前端直接替换 */
const includeReb = {
  items: { include: { links: { include: { invoice: true } } } },
  trip: true,
  legs: { include: { links: { include: { invoice: true } } } },
} as const

/**
 * PATCH /api/reimbursements/:id/link
 * 把某条报销明细行（item / leg）关联到一张或多张发票（支持 1:1、1:N）。
 * N:1（一张发票分摊到多行）由调用方对同一 invoiceId 多次调用、每次给不同 lineId + allocatedAmount 实现。
 *
 * body: {
 *   lineType: 'item' | 'leg',
 *   lineId: string,
 *   links: Array<{ invoiceId: string, allocatedAmount?: number }>
 * }
 */
export async function PATCH(
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

  const body = (await req.json().catch(() => null)) as {
    lineType?: string
    lineId?: string
    links?: Array<{ invoiceId?: string; allocatedAmount?: number | null }>
  } | null
  if (!body) return NextResponse.json({ error: '请求体格式错误' }, { status: 400 })

  const { lineType, lineId, links } = body
  if (lineType !== 'item' && lineType !== 'leg') {
    return NextResponse.json({ error: 'lineType 必须是 item 或 leg' }, { status: 400 })
  }
  if (!lineId) return NextResponse.json({ error: 'lineId 必填' }, { status: 400 })
  if (!Array.isArray(links) || links.length === 0) {
    return NextResponse.json({ error: 'links 必填且非空' }, { status: 400 })
  }

  // 校验这一行确实属于本报销单
  if (lineType === 'item') {
    const it = await prisma.reimbursementItem.findUnique({
      where: { id: lineId },
      select: { id: true, reimbursementId: true },
    })
    if (!it || it.reimbursementId !== id) {
      return NextResponse.json({ error: '明细行不存在或不属于该报销单' }, { status: 404 })
    }
  } else {
    const lg = await prisma.reimbursementTripLeg.findUnique({
      where: { id: lineId },
      select: { id: true, reimbursementId: true },
    })
    if (!lg || lg.reimbursementId !== id) {
      return NextResponse.json({ error: '行程段不存在或不属于该报销单' }, { status: 404 })
    }
  }

  // 逐条建立关联
  for (const link of links) {
    if (!link?.invoiceId) continue
    const inv = await prisma.invoice.findUnique({
      where: { id: link.invoiceId },
      select: { id: true },
    })
    if (!inv) return NextResponse.json({ error: `发票不存在: ${link.invoiceId}` }, { status: 404 })
    await upsertLink(prisma, {
      lineType: lineType as LineType,
      lineId,
      invoiceId: link.invoiceId,
      allocatedAmount: link.allocatedAmount ?? null,
    })
  }

  const updated = await prisma.reimbursement.findUnique({
    where: { id },
    include: includeReb,
  })
  return NextResponse.json(updated)
}

/**
 * DELETE /api/reimbursements/:id/link
 * 解除某一行与某张发票的关联（只删对应 InvoiceLink，不影响该行的其它关联 / 该发票的其它关联）。
 *
 * body: { lineType: 'item' | 'leg', lineId: string, invoiceId: string }
 */
export async function DELETE(
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

  const body = (await req.json().catch(() => null)) as {
    lineType?: string
    lineId?: string
    invoiceId?: string
  } | null
  if (!body) return NextResponse.json({ error: '请求体格式错误' }, { status: 400 })

  const { lineType, lineId, invoiceId } = body
  if (lineType !== 'item' && lineType !== 'leg') {
    return NextResponse.json({ error: 'lineType 必须是 item 或 leg' }, { status: 400 })
  }
  if (!lineId || !invoiceId) {
    return NextResponse.json({ error: 'lineId 与 invoiceId 必填' }, { status: 400 })
  }

  await deleteLink(prisma, { lineType: lineType as LineType, lineId, invoiceId })

  const updated = await prisma.reimbursement.findUnique({
    where: { id },
    include: includeReb,
  })
  return NextResponse.json(updated)
}
