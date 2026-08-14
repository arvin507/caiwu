import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { unlink } from 'fs/promises'
import path from 'path'

export const runtime = 'nodejs'

// GET /api/reimbursements/:id —— 详情（含明细/差旅子表）
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { id } = await params
  const reb = await prisma.reimbursement.findUnique({
    where: { id },
    include: {
      items: { include: { links: { include: { invoice: true } } } },
      trip: true,
      legs: { include: { links: { include: { invoice: true } } } },
    },
  })
  if (!reb) return NextResponse.json({ error: '报销单不存在' }, { status: 404 })
  if (user.role !== 'admin' && reb.submitterId !== user.id) {
    return NextResponse.json({ error: '无权限查看该报销单' }, { status: 403 })
  }
  return NextResponse.json(reb)
}

// DELETE /api/reimbursements/:id —— 删除（本人或 admin）
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { id } = await params
  const reb = await prisma.reimbursement.findUnique({
    where: { id },
    select: { id: true, submitterId: true, storagePath: true },
  })
  if (!reb) return NextResponse.json({ error: '报销单不存在' }, { status: 404 })
  if (user.role !== 'admin' && reb.submitterId !== user.id) {
    return NextResponse.json({ error: '无权限删除该报销单' }, { status: 403 })
  }

  // 先删库记录（级联删 items/trip/legs），再尽量删文件
  await prisma.reimbursement.delete({ where: { id } })
  if (reb.storagePath) {
    const abs = path.join(process.cwd(), 'uploads', path.basename(reb.storagePath))
    await unlink(abs).catch((e) => console.error('删除报销单附件失败(可忽略):', e?.message))
  }
  return NextResponse.json({ ok: true })
}
