import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { DEDUCTION_STATUSES, type DeductionStatus } from '@/lib/vatDeduction'

export const runtime = 'nodejs'

const MAX_BATCH = 500

/**
 * POST /api/deductions/batch —— 批量更新抵扣台账状态
 * 请求体：
 *   ids          String[]  抵扣记录 id（必填，最多 500 条）
 *   status       勾选状态（可选，必须在 DEDUCTION_STATUSES 内）
 *   declarePeriod 申报所属期（可选，可置空）
 *   note          备注（可选）
 * 返回：{ updated: number, skipped: number }（skipped = 不存在的 id）
 */
export async function POST(req: NextRequest) {
  let body: {
    ids?: unknown
    status?: string
    declarePeriod?: string | null
    note?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  const ids = Array.isArray(body.ids) ? (body.ids.filter((x) => typeof x === 'string') as string[]) : []
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids 不能为空' }, { status: 400 })
  }
  if (ids.length > MAX_BATCH) {
    return NextResponse.json({ error: `单次批量最多 ${MAX_BATCH} 条` }, { status: 400 })
  }

  const data: Record<string, unknown> = {}

  if (body.status !== undefined) {
    if (!DEDUCTION_STATUSES.includes(body.status as DeductionStatus)) {
      return NextResponse.json({ error: '非法的抵扣状态' }, { status: 400 })
    }
    data.status = body.status
  }
  if (body.declarePeriod !== undefined) {
    data.declarePeriod =
      body.declarePeriod && body.declarePeriod.trim() ? body.declarePeriod.trim() : null
  }
  if (body.note !== undefined) {
    data.note = body.note
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 })
  }

  // selected / deducted 自动记确认时间；回退则清空
  const bumpConfirmed =
    body.status === 'selected' || body.status === 'deducted'
      ? true
      : body.status === 'unconfirmed' || body.status === 'transferred_out'
        ? false
        : null

  // 取出现有记录，决定 confirmedAt 是否需要写入
  const existing = await prisma.invoiceDeduction.findMany({
    where: { id: { in: ids } },
    select: { id: true, confirmedAt: true },
  })
  const existingIds = new Set(existing.map((e) => e.id))

  if (bumpConfirmed === true) {
    // 仅给尚未确认过的补 confirmedAt；已确认的保留原时间
    const needStamp = existing.filter((e) => !e.confirmedAt).map((e) => e.id)
    if (needStamp.length) {
      await prisma.invoiceDeduction.updateMany({
        where: { id: { in: needStamp } },
        data: { ...data, confirmedAt: new Date() },
      })
    }
    const already = existing.filter((e) => e.confirmedAt).map((e) => e.id)
    if (already.length) {
      await prisma.invoiceDeduction.updateMany({
        where: { id: { in: already } },
        data,
      })
    }
  } else if (bumpConfirmed === false) {
    await prisma.invoiceDeduction.updateMany({
      where: { id: { in: ids } },
      data: { ...data, confirmedAt: null },
    })
  } else {
    await prisma.invoiceDeduction.updateMany({
      where: { id: { in: ids } },
      data,
    })
  }

  const updated = existingIds.size
  const skipped = ids.length - updated
  return NextResponse.json({ updated, skipped })
}
