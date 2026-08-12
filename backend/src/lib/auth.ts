import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret'

/** JWT 里携带的少量信息（不要塞敏感数据） */
export type JwtPayload = { userId: string; role: string }

/** 明文密码 → bcrypt 哈希（不可逆，且每次加盐结果不同） */
export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10)
}

/** 校验明文密码与哈希是否匹配 */
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash)
}

/** 签发 token（有效期 7 天） */
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

/** 校验 token，失败返回 null */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload
  } catch {
    return null
  }
}

/** 从请求头取出 Bearer token（没有则返回 null） */
export function getBearer(req: NextRequest): string | null {
  const header = req.headers.get('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7) : null
}

/**
 * 取当前登录用户：解析 token → 查库（保证 role 等是最新值）。
 * 用于需要「知道是谁在操作」的接口。
 */
export async function getCurrentUser(req: NextRequest) {
  const token = getBearer(req)
  if (!token) return null
  const payload = verifyToken(token)
  if (!payload) return null
  return prisma.user.findUnique({ where: { id: payload.userId } })
}

/**
 * 管理员守卫：未登录返回 401、非 admin 返回 403、通过返回 null。
 * 调用方：`const denied = await requireAdmin(req); if (denied) return denied`
 */
export async function requireAdmin(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  if (user.role !== 'admin')
    return NextResponse.json({ error: '无权限，仅超级管理员可操作' }, { status: 403 })
  return null
}

/** 把库里的用户对象脱敏成可返回给前端的形状（去掉密码哈希） */
export function toPublicUser(user: {
  id: string
  name: string
  username: string
  role: string
}) {
  return { id: user.id, name: user.name, username: user.username, role: user.role }
}
