import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, hashPassword, toPublicUser } from '@/lib/auth'

// GET /api/users —— 仅超级管理员可查看用户列表
export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, username: true, role: true, createdAt: true },
  })
  return NextResponse.json(users)
}

// POST /api/users —— 仅超级管理员可创建「普通用户」账户
export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied

  const { username, name, password } = await req.json().catch(() => ({}))
  if (!username || !name || !password) {
    return NextResponse.json({ error: '用户名、姓名、密码均必填' }, { status: 400 })
  }
  if (password.length < 6) {
    return NextResponse.json({ error: '密码至少 6 位' }, { status: 400 })
  }

  const exists = await prisma.user.findUnique({ where: { username } })
  if (exists) return NextResponse.json({ error: '该用户名已存在' }, { status: 409 })

  // 管理员创建的账户固定为普通用户（role=user），不开放创建管理员入口
  const created = await prisma.user.create({
    data: { username, name, passwordHash: await hashPassword(password), role: 'user' },
    select: { id: true, name: true, username: true, role: true, createdAt: true },
  })
  return NextResponse.json(created, { status: 201 })
}
