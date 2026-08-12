import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, verifyPassword, hashPassword } from '@/lib/auth'

// POST /api/auth/change-password
// 任意已登录用户修改自己的密码：先校验原密码，再写入新哈希
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { oldPassword, newPassword } = await req.json().catch(() => ({}))
  if (!oldPassword || !newPassword) {
    return NextResponse.json({ error: '原密码和新密码必填' }, { status: 400 })
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: '新密码至少 6 位' }, { status: 400 })
  }
  if (!(await verifyPassword(oldPassword, user.passwordHash))) {
    return NextResponse.json({ error: '原密码错误' }, { status: 400 })
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  })
  return NextResponse.json({ ok: true })
}
