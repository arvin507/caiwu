import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseInvoice } from '@/lib/invoiceParser'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

export const runtime = 'nodejs'

const UPLOAD_DIR = path.join(process.cwd(), 'uploads')

// GET /api/invoices —— 发票列表（按上传时间倒序）
export async function GET() {
  const invoices = await prisma.invoice.findMany({
    orderBy: { uploadedAt: 'desc' },
  })
  return NextResponse.json(invoices)
}

// POST /api/invoices —— 上传发票（multipart/form-data 标准方式）
// 字段：ownerName(必填) / invoiceDate / note / file(文件)
export async function POST(req: NextRequest) {
  const form = await req.formData()

  const ownerName = (form.get('ownerName') as string | null)?.trim() || ''
  const invoiceDate = form.get('invoiceDate') as string | null
  const note = (form.get('note') as string | null)?.trim() || null
  const file = form.get('file') as File | null

  // 服务端校验：归属人必填、文件必传（不只靠前端拦）
  if (!ownerName) {
    return NextResponse.json({ error: '归属人必填' }, { status: 400 })
  }
  if (!file || file.size === 0) {
    return NextResponse.json({ error: '请选择发票文件' }, { status: 400 })
  }

  // 文件落盘 backend/uploads/（不再用 base64 塞 JSON，省内存、可流式）
  await mkdir(UPLOAD_DIR, { recursive: true })
  const ext = path.extname(file.name) || ''
  const storageName = `inv-${crypto.randomUUID()}${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(path.join(UPLOAD_DIR, storageName), buffer)

  // 元数据写 MySQL（parseStatus 默认 pending）
  const created = await prisma.invoice.create({
    data: {
      ownerName,
      fileName: file.name,
      fileType: file.type,
      invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
      note,
      storagePath: `/uploads/${storageName}`,
    },
  })

  // 触发本地解析（PDF / OFD）：先返回 201，后端异步解析，不阻塞上传
  // 图片类文件会在 parseInvoice 内抛错，状态置为 failed（图片识别后续接 OCR 服务）
  void parseInvoice(path.join(UPLOAD_DIR, storageName))
    .then((data) =>
      prisma.invoice.update({
        where: { id: created.id },
        data: { parseStatus: 'done', parsedData: data as any },
      }),
    )
    .catch((e) =>
      prisma.invoice.update({
        where: { id: created.id },
        data: { parseStatus: 'failed', parseError: String(e?.message ?? e) },
      }),
    )

  return NextResponse.json(created, { status: 201 })
}
