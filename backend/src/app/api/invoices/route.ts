import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseInvoice } from '@/lib/invoiceParser'
import { writeFile, mkdir, unlink } from 'fs/promises'
import { createHash } from 'crypto'
import path from 'path'

export const runtime = 'nodejs'

const UPLOAD_DIR = path.join(process.cwd(), 'uploads')

// GET /api/invoices —— 发票列表（按上传时间倒序）
export async function GET() {
  const invoices = await prisma.invoice.findMany({
    orderBy: { uploadedAt: 'desc' },
    include: {
      links: {
        select: {
          id: true,
          reimbursementItemId: true,
          reimbursementLegId: true,
          allocatedAmount: true,
        },
      },
    },
  })
  // 标注每张发票当前已关联到哪些报销明细行（支持 N:1，故为数组）
  const data = invoices.map((inv) => ({
    ...inv,
    linkedTo: inv.links.map((l) => ({
      type: l.reimbursementItemId ? ('item' as const) : ('leg' as const),
      id: l.reimbursementItemId ?? l.reimbursementLegId,
      allocatedAmount: l.allocatedAmount != null ? Number(l.allocatedAmount) : null,
    })),
  }))
  return NextResponse.json(data)
}

// POST /api/invoices —— 上传发票（multipart/form-data 标准方式）
// 字段：ownerName(必填) / invoiceDate / note / files(文件数组，可批量)
// 兼容旧调用：仍接受单个 file 字段。
//
// 去重 / 幂等逻辑（避免「失败重试成功」产生两条记录）：
//  1. 计算文件内容 sha256 作为 fileHash；
//  2. 先按 fileHash、再按发票号码(invoiceNumber) 查重；
//  3. 命中已有记录 → 「更新」该记录（覆盖解析结果），而不是新建；仅当命中记录已关联
//     报销单时才跳过(skipped)，避免覆盖在用数据。
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

  // 循环处理每个文件：落盘 → 解析 → 去重 → 新建/更新记录
  const created: Array<Awaited<ReturnType<typeof prisma.invoice.create>>> = []
  const updated: Array<Awaited<ReturnType<typeof prisma.invoice.update>>> = []
  const skipped: Array<{ fileName: string; invoiceNumber: string; existingId: string; reason: string }> = []

  for (const file of files) {
    const ext = path.extname(file.name) || ''
    const storageName = `inv-${crypto.randomUUID()}${ext}`
    const absPath = path.join(UPLOAD_DIR, storageName)
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(absPath, buffer)

    // 文件内容指纹：重复上传（含「先失败、后重试成功」）靠它幂等去重
    const fileHash = createHash('sha256').update(buffer).digest('hex')

    // 先解析，拿到发票号码（解析失败则无号码，但仍可凭 fileHash 去重）
    let parsed: Awaited<ReturnType<typeof parseInvoice>> | null = null
    let parseError: string | null = null
    try {
      parsed = await parseInvoice(absPath)
    } catch (e) {
      parseError = String((e as Error)?.message ?? e)
    }
    const invoiceNumber = parsed?.invoiceNumber || null

    // 去重查询：优先 fileHash（同一文件，失败记录也带此值），其次发票号码
    let existing = fileHash
      ? await prisma.invoice.findFirst({ where: { fileHash }, select: { id: true } })
      : null
    if (!existing && invoiceNumber) {
      existing = await prisma.invoice.findFirst({ where: { invoiceNumber }, select: { id: true } })
    }

    if (existing) {
      // 已关联报销单的记录不覆盖，避免影响在用数据 → 跳过本次上传
      const linked = await prisma.invoiceLink.findFirst({
        where: { invoiceId: existing.id },
        select: { id: true },
      })
      if (linked) {
        await unlink(absPath).catch(() => {}) // 丢弃本次落盘文件
        skipped.push({
          fileName: file.name,
          invoiceNumber: invoiceNumber ?? '',
          existingId: existing.id,
          reason: '已关联报销单',
        })
        continue
      }
      // 幂等更新：复写解析结果，保留原记录的文件与 id（不新建第二条）
      const inv = await prisma.invoice.update({
        where: { id: existing.id },
        data: {
          ownerName,
          fileName: file.name,
          fileType: file.type,
          invoiceDate: invoiceDate ? new Date(invoiceDate) : undefined,
          note,
          invoiceNumber,
          invoiceType: (parsed as any)?.invoiceType ?? 'vat',
          parseStatus: parsed ? 'done' : 'failed',
          parsedData: parsed as any,
          parseError,
        },
      })
      await unlink(absPath).catch(() => {}) // 丢弃本次新写入的文件，复用原记录文件
      updated.push(inv)
      continue
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
        fileHash,
        invoiceNumber,
        invoiceType: (parsed as any)?.invoiceType ?? 'vat',
        parseStatus: parsed ? 'done' : 'failed',
        parsedData: parsed as any,
        parseError,
      },
    })
    created.push(inv)
  }

  return NextResponse.json({ created, updated, skipped }, { status: 201 })
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
    // 已关联报销明细（通过发票关联表）：不删，避免孤儿外键
    const linked = await prisma.invoiceLink.findFirst({
      where: { invoiceId: id },
      select: { id: true },
    })
    if (linked) {
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
