import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { readFile } from 'fs/promises'
import path from 'path'

export const runtime = 'nodejs'

// GET /api/reimbursements/:id/file —— 在线预览原始 Excel
// 用 path.basename 防路径穿越；权限同详情（本人或 admin）
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { id } = await params
  const reb = await prisma.reimbursement.findUnique({
    where: { id },
    select: { storagePath: true, fileName: true, submitterId: true },
  })
  if (!reb || !reb.storagePath) return NextResponse.json({ error: '无附件' }, { status: 404 })
  if (user.role !== 'admin' && reb.submitterId !== user.id) {
    return NextResponse.json({ error: '无权限' }, { status: 403 })
  }

  const abs = path.join(process.cwd(), 'uploads', path.basename(reb.storagePath))
  let buf: Buffer
  try {
    buf = await readFile(abs)
  } catch {
    return NextResponse.json({ error: '附件文件丢失' }, { status: 404 })
  }

  const ext = path.extname(reb.fileName || '').toLowerCase()
  const contentType =
    ext === '.pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(reb.fileName || 'file')}"`,
    },
  })
}
