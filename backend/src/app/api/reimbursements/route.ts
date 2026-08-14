import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { parseReimbursementFile, type ReimbursementType } from '@/lib/reimbursementParser'
import { writeFile, mkdir, unlink } from 'fs/promises'
import path from 'path'

export const runtime = 'nodejs'

const UPLOAD_DIR = path.join(process.cwd(), 'uploads')

// GET /api/reimbursements —— 报销单列表
// admin 看全部；普通用户只看自己提交的。默认倒序。
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const where = user.role === 'admin' ? {} : { submitterId: user.id }
  const list = await prisma.reimbursement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      items: { include: { links: { include: { invoice: true } } } },
      trip: true,
      legs: { include: { links: { include: { invoice: true } } } },
    },
  })
  return NextResponse.json(list)
}

// POST /api/reimbursements —— 上传 Excel，系统解析后落库为草稿(draft)
// 字段：type('travel' | 'general') / file(xlsx)
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const form = await req.formData()
  const type = (form.get('type') as string | null)?.trim() as ReimbursementType | undefined
  const file = form.get('file') as File | null

  if (type !== 'travel' && type !== 'general') {
    return NextResponse.json({ error: '请指定报销类型 type: travel | general' }, { status: 400 })
  }
  if (!file || file.size === 0) {
    return NextResponse.json({ error: '请上传报销单 Excel 文件' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  // 先解析（内存中）：失败直接返回，不落盘，避免脏数据
  let parsed
  try {
    parsed = await parseReimbursementFile(buffer, type)
  } catch (e) {
    return NextResponse.json(
      { error: '解析失败：' + String((e as Error)?.message ?? e) },
      { status: 400 },
    )
  }

  // 落盘原始文件
  await mkdir(UPLOAD_DIR, { recursive: true })
  const ext = path.extname(file.name) || ''
  const storageName = `reb-${crypto.randomUUID()}${ext}`
  await writeFile(path.join(UPLOAD_DIR, storageName), buffer)

  // 一次性写入主表 + 明细 + 差旅子表（金额用字符串传给 Decimal，避免浮点误差）
  const created = await prisma.reimbursement.create({
    data: {
      type,
      applicantName: parsed.applicantName,
      department: parsed.department || null,
      projectName: parsed.projectName || null,
      projectCode: parsed.projectCode || null,
      applyDate: parsed.applyDate ? new Date(parsed.applyDate) : null,
      totalAmount: String(parsed.totalAmount),
      status: 'draft',
      storagePath: `/uploads/${storageName}`,
      fileName: file.name,
      submitterId: user.id,
      items: {
        create: parsed.items.map((i) => ({
          seq: i.seq,
          category: i.category || null,
          summary: i.summary || null,
          amount: String(i.amount),
          note: i.note || null,
        })),
      },
      trip: parsed.trip
        ? {
            create: {
              travelerName: parsed.trip.travelerName || null,
              startDate: parsed.trip.startDate ? new Date(parsed.trip.startDate) : null,
              endDate: parsed.trip.endDate ? new Date(parsed.trip.endDate) : null,
              fromLocation: parsed.trip.fromLocation || null,
              toLocation: parsed.trip.toLocation || null,
              headcount: parsed.trip.headcount ?? null,
              reason: parsed.trip.reason || null,
              dateRangeText: parsed.trip.dateRangeText || null,
              locationText: parsed.trip.locationText || null,
            },
          }
        : undefined,
      legs: parsed.legs && parsed.legs.length
        ? {
            create: parsed.legs.map((l) => ({
              legDate: l.legDate || null,
              transport: l.transport || null,
              fromStation: l.fromStation || null,
              toStation: l.toStation || null,
              amount: String(l.amount),
              ticketCount: l.ticketCount ?? null,
            })),
          }
        : undefined,
    },
    include: { items: true, trip: true, legs: true },
  })

  return NextResponse.json(created, { status: 201 })
}

// DELETE /api/reimbursements —— 批量删除（body: { ids: string[] }）
// 权限：本人提交 或 admin。无权限 / 不存在的 id 计入 skipped，不阻断其余删除。
// 删除库记录（级联删 items/trip/legs）后，尽量删除落盘附件。
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  let body: { ids?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }
  const ids = Array.isArray(body.ids) ? (body.ids as string[]).filter(Boolean) : []
  if (ids.length === 0) {
    return NextResponse.json({ error: '未提供要删除的报销单 id' }, { status: 400 })
  }

  const deleted: string[] = []
  const skipped: Array<{ id: string; reason: string }> = []

  for (const id of ids) {
    const reb = await prisma.reimbursement.findUnique({
      where: { id },
      select: { id: true, submitterId: true, storagePath: true },
    })
    if (!reb) {
      skipped.push({ id, reason: '报销单不存在' })
      continue
    }
    if (user.role !== 'admin' && reb.submitterId !== user.id) {
      skipped.push({ id, reason: '无权限删除' })
      continue
    }
    await prisma.reimbursement.delete({ where: { id } })
    if (reb.storagePath) {
      const abs = path.join(process.cwd(), 'uploads', path.basename(reb.storagePath))
      await unlink(abs).catch((e) => console.error('批量删除报销附件失败(可忽略):', e?.message))
    }
    deleted.push(id)
  }

  return NextResponse.json({ deleted, skipped })
}
