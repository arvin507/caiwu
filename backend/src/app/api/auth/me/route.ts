import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, toPublicUser } from '@/lib/auth'

// GET /api/auth/me
// 前端刷新页面后，用本地保存的 token 换取最新用户信息（含角色）
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 })
  return NextResponse.json(toPublicUser(user))
}
