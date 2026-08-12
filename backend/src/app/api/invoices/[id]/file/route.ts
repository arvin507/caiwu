import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readFile } from 'fs/promises'
import path from 'path'

const UPLOAD_DIR = path.join(process.cwd(), 'uploads')

// GET /api/invoices/:id/file —— 预览/下载文件（流式传输，不进内存）
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const inv = await prisma.invoice.findUnique({ where: { id } })
  if (!inv) return NextResponse.json({ error: '发票不存在' }, { status: 404 })

  const filePath = path.join(UPLOAD_DIR, path.basename(inv.storagePath))
  try {
    const data = await readFile(filePath)
    return new NextResponse(data, {
      headers: {
        'Content-Type': inv.fileType,
        'Content-Disposition': `inline; filename="${encodeURIComponent(inv.fileName)}"`,
      },
    })
  } catch {
    return NextResponse.json({ error: '文件已丢失' }, { status: 404 })
  }
}
