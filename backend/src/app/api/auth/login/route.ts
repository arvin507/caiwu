import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword, signToken, toPublicUser } from '@/lib/auth'

// POST /api/auth/login
// 校验用户名 + 密码，成功返回 token 与用户信息（不含密码）
export async function POST(req: NextRequest) {
  const { username, password } = await req.json().catch(() => ({}))

  if (!username || !password) {
    return NextResponse.json({ error: '用户名和密码必填' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { username } })
  // 用户名不存在或密码不匹配，统一返回 401（不区分提示，避免被枚举用户名）
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 })
  }

  const token = signToken({ userId: user.id, role: user.role })
  return NextResponse.json({
    token,
    user: toPublicUser(user),
  })
}
