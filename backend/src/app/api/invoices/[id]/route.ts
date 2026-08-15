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

  // 已关联报销单：不允许删除，避免孤儿外键
  const linked = await prisma.invoiceLink.findFirst({
    where: { invoiceId: id },
    select: { id: true },
  })
  if (linked) {
    return NextResponse.json({ error: '该发票已关联报销单，无法删除' }, { status: 400 })
  }

  await prisma.invoice.delete({ where: { id } })
  // 落盘文件删除改为后台尽力、不阻塞响应（开发环境 safe-delete 可能拦截 unlink，
  // 放行 uploads 目录后即为正常删除；即便被拦也只是磁盘残留，不影响元数据删除）
  void unlink(path.join(UPLOAD_DIR, path.basename(inv.storagePath))).catch(() => {})
  return NextResponse.json({ ok: true })
}

// PATCH /api/invoices/:id —— 人工核对写回：更新解析结果/状态
// 用于前端「人工核对」：OCR/本地解析偶尔抽错，用户改完字段后保存。
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let body: { parsedData?: unknown; parseStatus?: string; parseError?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  // 只构造被显式提供的字段，避免把 undefined 写进数据库
  const data: Record<string, unknown> = {}
  if (body.parsedData !== undefined) data.parsedData = body.parsedData
  if (body.parseStatus !== undefined) data.parseStatus = body.parseStatus
  if (body.parseError !== undefined) data.parseError = body.parseError
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 })
  }

  const updated = await prisma.invoice.update({ where: { id }, data })
  return NextResponse.json(updated)
}
