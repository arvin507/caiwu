import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseInvoice } from '@/lib/invoiceParser'
import { writeFile, mkdir, unlink } from 'fs/promises'
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
// 字段：ownerName(必填) / invoiceDate / note / files(文件数组，可批量)
// 兼容旧调用：仍接受单个 file 字段。
//
// 去重逻辑：每张文件先同步解析，拿到发票号码后在落库前查重；
// 若号码已存在于其它记录，则删除本次落盘文件、不建记录，并记入 skipped（提示用户）。
export async function POST(req: NextRequest) {
  const form = await req.formData()

  const ownerName = (form.get('ownerName') as string | null)?.trim() || ''
  const invoiceDate = form.get('invoiceDate') as string | null
  const note = (form.get('note') as string | null)?.trim() || null

  // 批量：优先取 files[]；兼容旧的单文件 file 字段
  const files = (form.getAll('files') as File[]).filter((f) => f && f.size > 0)
  const single = form.get('file') as File | null
  if (single && single.size > 0) files.push(single)

  // 服务端校验：归属人必填、至少选一个文件（不只靠前端拦）
  if (!ownerName) {
    return NextResponse.json({ error: '归属人必填' }, { status: 400 })
  }
  if (files.length === 0) {
    return NextResponse.json({ error: '请至少选择一个发票文件' }, { status: 400 })
  }

  // 文件落盘 backend/uploads/（不再用 base64 塞 JSON，省内存、可流式）
  await mkdir(UPLOAD_DIR, { recursive: true })

  // 循环处理每个文件：落盘 → 解析 → 去重 → 建记录
  const created: Array<Awaited<ReturnType<typeof prisma.invoice.create>>> = []
  const skipped: Array<{ fileName: string; invoiceNumber: string; existingId: string }> = []

  for (const file of files) {
    const ext = path.extname(file.name) || ''
    const storageName = `inv-${crypto.randomUUID()}${ext}`
    const absPath = path.join(UPLOAD_DIR, storageName)
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(absPath, buffer)

    // 先解析，拿到发票号码用于去重（解析失败则无号码，无法去重，按失败落库）
    let parsed: Awaited<ReturnType<typeof parseInvoice>> | null = null
    let parseError: string | null = null
    try {
      parsed = await parseInvoice(absPath)
    } catch (e) {
      parseError = String((e as Error)?.message ?? e)
    }
    const invoiceNumber = parsed?.invoiceNumber || null

    // 去重：发票号码已存在于其它记录 → 删除本次文件、不建记录、提示用户
    if (invoiceNumber) {
      const dup = await prisma.invoice.findFirst({
        where: { invoiceNumber },
        select: { id: true },
      })
      if (dup) {
        await unlink(absPath).catch(() => {}) // 丢弃本次上传的落盘文件
        skipped.push({ fileName: file.name, invoiceNumber, existingId: dup.id })
        continue
      }
    }

    // 未重复：建记录并直接写入解析结果（parseStatus 同步为 done / failed）
    const inv = await prisma.invoice.create({
      data: {
        ownerName,
        fileName: file.name,
        fileType: file.type,
        invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
        note,
        storagePath: `/uploads/${storageName}`,
        invoiceNumber,
        parseStatus: parsed ? 'done' : 'failed',
        parsedData: parsed as any,
        parseError,
      },
    })
    created.push(inv)
  }

  return NextResponse.json({ created, skipped }, { status: 201 })
}

// DELETE /api/invoices —— 批量删除（body: { ids: string[] }）
// 已关联报销明细（item / leg）的发票跳过，避免留下孤儿关联；其余删除元数据 + 落盘文件。
export async function DELETE(req: NextRequest) {
  let body: { ids?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }
  const ids = Array.isArray(body.ids) ? (body.ids as string[]).filter(Boolean) : []
  if (ids.length === 0) {
    return NextResponse.json({ error: '未提供要删除的发票 id' }, { status: 400 })
  }

  const deleted: string[] = []
  const skipped: Array<{ id: string; reason: string }> = []

  for (const id of ids) {
    const inv = await prisma.invoice.findUnique({
      where: { id },
      select: { id: true, storagePath: true },
    })
    if (!inv) {
      skipped.push({ id, reason: '发票不存在' })
      continue
    }
    // 已关联报销明细：不删，避免孤儿外键
    const linkedItem = await prisma.reimbursementItem.findFirst({
      where: { invoiceId: id },
      select: { id: true },
    })
    const linkedLeg = await prisma.reimbursementTripLeg.findFirst({
      where: { invoiceId: id },
      select: { id: true },
    })
    if (linkedItem || linkedLeg) {
      skipped.push({ id, reason: '已关联报销单，无法删除' })
      continue
    }
    await prisma.invoice.delete({ where: { id } })
    try {
      await unlink(path.join(UPLOAD_DIR, path.basename(inv.storagePath)))
    } catch (e) {
      // 元数据已删；文件删除失败仅记录，不阻断响应（如文件已手动移除）
      console.error('[批量删除] 删除落盘文件失败:', e)
    }
    deleted.push(id)
  }

  return NextResponse.json({ deleted, skipped })
}
