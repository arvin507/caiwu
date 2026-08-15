import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseInvoice, type ParsedInvoice } from '@/lib/invoiceParser'
import { writeFile, mkdir, unlink, readFile } from 'fs/promises'
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import path from 'path'
import os from 'os'

export const runtime = 'nodejs'

const UPLOAD_DIR = path.join(process.cwd(), 'uploads')

// 拆分多页 PDF 用的 Python 解释器（与 local_ocr.py 同源，带 pymupdf）
function resolveSplitPython(): string {
  const cands = [
    process.env.LOCAL_OCR_PYTHON,
    'C:/py311/python.exe',
    'C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe',
    'python3',
    'python',
  ].filter(Boolean) as string[]
  for (const c of cands) {
    if (require('fs').existsSync(c)) return c
  }
  return 'python3'
}

/**
 * 把多页 PDF 按页拆成若干单页 PDF（落盘到 UPLOAD_DIR），返回按页序的绝对路径数组。
 * 单页 PDF / 非 PDF 直接返回 [原路径]。失败抛出异常（由上层记为解析失败）。
 */
async function splitPdfToPages(srcAbsPath: string): Promise<string[]> {
  const py = resolveSplitPython()
  const script = path.join(process.cwd(), 'split_pdf.py')
  const out = execFileSync(py, [script, srcAbsPath, UPLOAD_DIR], {
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024 * 64,
  })
  const paths = JSON.parse(out.trim()) as string[]
  return paths
}

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

  /**
   * 处理「单张发票」：基于解析结果 + 文件内容，做幂等去重后建/更新记录。
   * 被两类输入复用：①单页文件（图片 / 单张 PDF）②多页 PDF 拆分出的每一页。
   * @param parsed 单张解析结果（扁平 ParsedInvoice，不含 multi）
   * @param buffer 该张发票对应的文件内容（图片 / 单页 PDF 字节）
   * @param fileName 展示用文件名（多页时附页号）
   */
  async function upsertOne(
    parsed: ParsedInvoice | null,
    buffer: Buffer,
    fileName: string,
    parseErr?: string | null,
  ): Promise<void> {
    const ext = fileName.endsWith('.pdf') ? '.pdf' : (path.extname(fileName) || '')
    const storageName = `inv-${crypto.randomUUID()}${ext}`
    const absPath = path.join(UPLOAD_DIR, storageName)
    await writeFile(absPath, buffer)

    // 文件内容指纹：重复上传（含「先失败、后重试成功」）靠它幂等去重
    const fileHash = createHash('sha256').update(buffer).digest('hex')
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
          fileName,
          invoiceNumber: invoiceNumber ?? '',
          existingId: existing.id,
          reason: '已关联报销单',
        })
        return
      }
      // 幂等更新：复写解析结果，保留原记录的文件与 id（不新建第二条）
      const inv = await prisma.invoice.update({
        where: { id: existing.id },
        data: {
          ownerName,
          fileName,
          fileType: ext ? 'application/pdf' : 'image/*',
          invoiceDate: invoiceDate ? new Date(invoiceDate) : undefined,
          note,
          invoiceNumber,
          invoiceType: (parsed as any)?.invoiceType ?? 'vat',
          parseStatus: parsed ? 'done' : 'failed',
          parsedData: parsed as any,
          parseError: parseErr ?? null,
        },
      })
      await unlink(absPath).catch(() => {}) // 丢弃本次新写入的文件，复用原记录文件
      updated.push(inv)
      return
    }

    // 未重复：建记录并直接写入解析结果（parseStatus 同步为 done / failed）
    const inv = await prisma.invoice.create({
      data: {
        ownerName,
        fileName,
        fileType: ext ? 'application/pdf' : 'image/*',
        invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
        note,
        storagePath: `/uploads/${storageName}`,
        fileHash,
        invoiceNumber,
        invoiceType: (parsed as any)?.invoiceType ?? 'vat',
        parseStatus: parsed ? 'done' : 'failed',
        parsedData: parsed as any,
        parseError: parseErr ?? null,
      },
    })
    created.push(inv)
  }

  for (const file of files) {
    const ext = path.extname(file.name) || ''
    const storageName = `inv-${crypto.randomUUID()}${ext}`
    const absPath = path.join(UPLOAD_DIR, storageName)
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(absPath, buffer)

    // 先解析，拿到发票号码（解析失败则无号码，但仍可凭 fileHash 去重）
    let parsed: Awaited<ReturnType<typeof parseInvoice>> | null = null
    let parseError: string | null = null
    try {
      parsed = await parseInvoice(absPath)
    } catch (e) {
      parseError = String((e as Error)?.message ?? e)
    }

    // 多张发票（合并 PDF 一页一张等）：拆分后逐张上传
    if (parsed && parsed.multi && parsed.pages && parsed.pages.length > 0) {
      let pagePaths: string[] = []
      try {
        pagePaths = await splitPdfToPages(absPath)
      } catch (e) {
        parseError = `PDF 拆分失败: ${String((e as Error)?.message ?? e)}`
      }
      // 丢弃合并原文件（避免落盘重复大文件；拆分出的单页已各自落盘）
      await unlink(absPath).catch(() => {})
      if (pagePaths.length === 0) {
        // 拆分失败兜底：当单张处理（保留原文件）
        await upsertOne(parsed.pages[0] ?? null, buffer, file.name)
        continue
      }
      for (let i = 0; i < pagePaths.length; i++) {
        const pageBuf = await readFile(pagePaths[i]).catch(() => null)
        if (!pageBuf) continue
        const pageParsed = parsed.pages[i] ?? null
        const pageFileName = pagePaths.length > 1
          ? `${file.name.replace(/\.pdf$/i, '')}_第${i + 1}页.pdf`
          : file.name
        await upsertOne(pageParsed, pageBuf, pageFileName, parseError)
        // 清理拆分临时文件（fire-and-forget，失败不影响主流程）
        await unlink(pagePaths[i]).catch(() => {})
      }
      continue
    }

    // 单张：直接基于解析结果建/更新（注意 multi 拆分失败时已用 pages[0] 兜底）
    const singleParsed = parsed && parsed.multi ? (parsed.pages?.[0] ?? null) : parsed
    await upsertOne(singleParsed, buffer, file.name, parseError)
    // upsertOne 内部会重新落盘为 inv-<uuid> 文件；此处外部这份 absPath 已成孤儿，清理之
    await unlink(absPath).catch(() => {})
  }

  return NextResponse.json({ created, updated, skipped }, { status: 201 })
}

// DELETE /api/invoices —— 批量删除（body: { ids: string[] }）
// 已关联报销明细（item / leg）的发票跳过，避免误删已核销发票；其余删除元数据 + 落盘文件。
//
// 性能优化：原实现为 for 串行循环，每张发票 3 次串行 DB 往返（findUnique + findFirst 查关联 + delete）
// 外加 1 次串行 unlink，删 N 张 = 3N 次查询，N 大时极慢。现改为：
//   1) 一次 findMany(in ids) 拿全部记录与落盘路径；
//   2) 一次 findMany(in ids) 拿全部「已关联」发票 id 集合；
//   3) 一次 deleteMany(in deletableIds) 批量删除（DB 级 ON DELETE CASCADE 自动清理 invoice_links）；
//   4) 落盘文件 unlink 用 Promise.all 并行。
// DB 往返从 3N 降到常数级（3 次），文件 IO 从串行变并行。
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

  // 1) 一次查出所有存在的发票（含落盘路径）
  const existing = await prisma.invoice.findMany({
    where: { id: { in: ids } },
    select: { id: true, storagePath: true },
  })
  const existingIds = new Set(existing.map((e) => e.id))

  // 2) 一次查出所有「已关联报销单」的发票 id（@map invoice_links，invoiceId 已建索引）
  const linkedRows = await prisma.invoiceLink.findMany({
    where: { invoiceId: { in: ids } },
    select: { invoiceId: true },
  })
  const linkedIds = new Set(linkedRows.map((r) => r.invoiceId))

  // 可删除 = 存在 且 未关联（绝不会包含有 link 的行，deleteMany 不会触发外键冲突）
  const deletable = existing.filter((e) => !linkedIds.has(e.id))
  const deletableIds = deletable.map((e) => e.id)

  // skipped：保持原结构 { id, reason }；不存在 + 已关联两类
  const skipped: Array<{ id: string; reason: string }> = []
  for (const id of ids) {
    if (!existingIds.has(id)) {
      skipped.push({ id, reason: '发票不存在' })
    } else if (linkedIds.has(id)) {
      skipped.push({ id, reason: '已关联报销单，无法删除' })
    }
  }

  let deleted: string[] = []
  if (deletableIds.length > 0) {
    // 3) 一次性批量删除元数据（数据库 ON DELETE CASCADE 自动清理对应 invoice_links）
    await prisma.invoice.deleteMany({ where: { id: { in: deletableIds } } })
    // 4) 落盘文件删除改为「后台尽力、不阻塞响应」(fire-and-forget)。
    //    原因：开发环境 WorkBuddy 的 safe-delete 钩子会拦截批量 unlink（阈值 50，
    //    按进程累计），导致删除被严重拖慢（实测删 50 张 31s）甚至被拒、文件删不掉，
    //    而数据库记录删除本身仅 ~23ms。若在此 await 等待文件删除，用户要干等数十秒。
    //    改为不 await：DB 已删 → HTTP 立即返回 → 前端列表秒级更新；文件删除在后台
    //    尽力进行（放行 uploads 目录后即为正常删除；即便被拦也只是磁盘残留，不影响
    //    发票元数据删除）。catch 静默，避免 safe-delete 拦截时刷屏成百上千条错误。
    void Promise.all(
      deletable.map((e) =>
        unlink(path.join(UPLOAD_DIR, path.basename(e.storagePath))).catch(() => {}),
      ),
    )
    deleted = deletableIds
  }

  return NextResponse.json({ deleted, skipped })
}
