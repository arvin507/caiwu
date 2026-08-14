import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, requireAdmin } from '@/lib/auth'

export const runtime = 'nodejs'

// PATCH /api/reimbursements/:id/status
// body: { action: 'submit' | 'approve' | 'reject' | 'paid', reason?: string }
// 状态机：draft → submitted → approved → paid，submitted 可 reject
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = body.action as string | undefined

  const reb = await prisma.reimbursement.findUnique({ where: { id } })
  if (!reb) return NextResponse.json({ error: '报销单不存在' }, { status: 404 })

  switch (action) {
    case 'submit': {
      // 仅本人、且当前为草稿
      if (reb.submitterId !== user.id) {
        return NextResponse.json({ error: '只能提交自己的报销单' }, { status: 403 })
      }
      if (reb.status !== 'draft') {
        return NextResponse.json({ error: '只有草稿状态可以提交' }, { status: 400 })
      }
      const updated = await prisma.reimbursement.update({
        where: { id },
        data: { status: 'submitted' },
      })
      return NextResponse.json(updated)
    }

    case 'approve': {
      const denied = await requireAdmin(req)
      if (denied) return denied
      if (reb.status !== 'submitted') {
        return NextResponse.json({ error: '只有已提交的报销单可以审批通过' }, { status: 400 })
      }
      const updated = await prisma.reimbursement.update({
        where: { id },
        data: { status: 'approved', approverId: user.id, approvedAt: new Date() },
      })
      return NextResponse.json(updated)
    }

    case 'reject': {
      const denied = await requireAdmin(req)
      if (denied) return denied
      if (reb.status !== 'submitted') {
        return NextResponse.json({ error: '只有已提交的报销单可以驳回' }, { status: 400 })
      }
      const reason = (body.reason as string | undefined)?.trim()
      const updated = await prisma.reimbursement.update({
        where: { id },
        data: { status: 'rejected', approverId: user.id, rejectReason: reason || null },
      })
      return NextResponse.json(updated)
    }

    case 'paid': {
      const denied = await requireAdmin(req)
      if (denied) return denied
      if (reb.status !== 'approved') {
        return NextResponse.json({ error: '只有审批通过的报销单可以标记付款' }, { status: 400 })
      }
      const updated = await prisma.reimbursement.update({
        where: { id },
        data: { status: 'paid', approvedAt: reb.approvedAt ?? new Date() },
      })
      return NextResponse.json(updated)
    }

    default:
      return NextResponse.json(
        { error: '未知 action，应为 submit | approve | reject | paid' },
        { status: 400 },
      )
  }
}
