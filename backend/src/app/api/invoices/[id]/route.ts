import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { unlink } from 'fs/promises'
import path from 'path'

const UPLOAD_DIR = path.join(process.cwd(), 'uploads')

// GET /api/invoices/:id —— 单条发票元数据
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const inv = await prisma.invoice.findUnique({ where: { id } })
  if (!inv) return NextResponse.json({ error: '发票不存在' }, { status: 404 })
  return NextResponse.json(inv)
}

// DELETE /api/invoices/:id —— 删除（元数据 + 落盘文件）
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const inv = await prisma.invoice.findUnique({ where: { id } })
  if (!inv) return NextResponse.json({ error: '发票不存在' }, { status: 404 })

  await prisma.invoice.delete({ where: { id } })
  try {
    await unlink(path.join(UPLOAD_DIR, path.basename(inv.storagePath)))
  } catch (e) {
    // 元数据已删；文件删除失败仅记录，不阻断响应（如文件已手动移除）
    console.error('[DELETE] 删除落盘文件失败:', e)
  }
  return NextResponse.json({ ok: true })
}
