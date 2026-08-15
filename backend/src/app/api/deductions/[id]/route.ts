import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { DEDUCTION_STATUSES, type DeductionStatus } from '@/lib/vatDeduction'

export const runtime = 'nodejs'

/**
 * PATCH /api/deductions/:id —— 更新某张发票的抵扣台账状态
 * 请求体（均可选）：
 *   status        勾选状态，必须在 DEDUCTION_STATUSES 内
 *   declarePeriod 申报所属期，如 2026-08（可置空）
 *   note          备注
 * 状态变为 selected / deducted 时自动记录 confirmedAt；回退为未勾选/进项转出时清空。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let body: { status?: string; declarePeriod?: string | null; note?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  const existing = await prisma.invoiceDeduction.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: '抵扣记录不存在' }, { status: 404 })

  const data: Record<string, unknown> = {}

  if (body.status !== undefined) {
    if (!DEDUCTION_STATUSES.includes(body.status as DeductionStatus)) {
      return NextResponse.json({ error: '非法的抵扣状态' }, { status: 400 })
    }
    data.status = body.status
    // 进入「已勾选/已抵扣」自动记确认时间；回退则清空
    if (body.status === 'selected' || body.status === 'deducted') {
      if (!existing.confirmedAt) data.confirmedAt = new Date()
    } else {
      data.confirmedAt = null
    }
  }
  if (body.declarePeriod !== undefined) {
    data.declarePeriod = body.declarePeriod && body.declarePeriod.trim() ? body.declarePeriod.trim() : null
  }
  if (body.note !== undefined) {
    data.note = body.note
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 })
  }

  const updated = await prisma.invoiceDeduction.update({ where: { id }, data })
  return NextResponse.json(updated)
}
