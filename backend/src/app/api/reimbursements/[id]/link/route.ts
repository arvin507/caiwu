import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'

export const runtime = 'nodejs'

/**
 * PATCH /api/reimbursements/:id/link
 * 把某条报销明细（费用项 item / 差旅行程段 leg）关联到一张发票（1:1）。
 *
 * body: { lineType: 'item' | 'leg', lineId: string, invoiceId: string | null }
 *  - invoiceId 为 null 表示解除关联。
 *
 * 权限：报销单本人或 admin。
 * 约束：一张发票只能挂一行（invoiceId 唯一约束 + 此处显式校验，避免并发/历史脏数据）。
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
    invoiceId?: string | null
  } | null
  if (!body) return NextResponse.json({ error: '请求体格式错误' }, { status: 400 })

  const { lineType, lineId, invoiceId } = body
  if (lineType !== 'item' && lineType !== 'leg') {
    return NextResponse.json({ error: 'lineType 必须是 item 或 leg' }, { status: 400 })
  }
  if (!lineId) return NextResponse.json({ error: 'lineId 必填' }, { status: 400 })

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

  // 关联发票时：发票必须存在，且不能已被其它行占用
  if (invoiceId) {
    const inv = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true },
    })
    if (!inv) return NextResponse.json({ error: '发票不存在' }, { status: 404 })

    const dupItem = await prisma.reimbursementItem.findFirst({
      where: { invoiceId, id: { not: lineId } },
      select: { id: true },
    })
    const dupLeg = await prisma.reimbursementTripLeg.findFirst({
      where: { invoiceId, id: { not: lineId } },
      select: { id: true },
    })
    if (dupItem || dupLeg) {
      return NextResponse.json({ error: '该发票已关联到其他报销明细' }, { status: 400 })
    }
  }

  // 更新对应行的 invoiceId
  if (lineType === 'item') {
    await prisma.reimbursementItem.update({
      where: { id: lineId },
      data: { invoiceId: invoiceId || null },
    })
  } else {
    await prisma.reimbursementTripLeg.update({
      where: { id: lineId },
      data: { invoiceId: invoiceId || null },
    })
  }

  // 返回更新后的整单详情（含嵌套发票），方便前端直接替换
  const updated = await prisma.reimbursement.findUnique({
    where: { id },
    include: {
      items: { include: { invoice: true } },
      trip: true,
      legs: { include: { invoice: true } },
    },
  })
  return NextResponse.json(updated)
}
