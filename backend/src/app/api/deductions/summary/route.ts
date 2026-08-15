import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

/**
 * GET /api/deductions/summary —— 申报底稿按凭证类别汇总
 * 查询参数（可选）：
 *   period  申报所属期精确匹配（如 2026-08）；不传则汇总全部「可抵扣且未进项转出」
 * 返回：
 *   groups：按 voucherKind 分组 [{ voucherKind, count, deductibleTax, taxExclusiveAmount }]
 *   totalDeductibleTax：可抵扣进项税额合计
 *   totalTaxExclusive：不含税金额合计
 * 前端据此映射到《增值税及附加税费申报表附列资料（二）》对应栏次。
 */
export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get('period')?.trim() || ''

  const where: Record<string, unknown> = {
    canDeduct: true,
    status: { not: 'transferred_out' },
  }
  if (period) where.declarePeriod = period

  const rows = await prisma.invoiceDeduction.findMany({
    where,
    select: {
      voucherKind: true,
      taxExclusiveAmount: true,
      deductibleTax: true,
    },
  })

  const groupsMap = new Map<string, { count: number; exclusive: number; tax: number }>()
  let totalExclusive = 0
  let totalTax = 0
  for (const r of rows) {
    const excl = Number(r.taxExclusiveAmount ?? 0) || 0
    const tax = Number(r.deductibleTax ?? 0) || 0
    const key = r.voucherKind ?? '其他'
    const g = groupsMap.get(key) ?? { count: 0, exclusive: 0, tax: 0 }
    g.count += 1
    g.exclusive += excl
    g.tax += tax
    groupsMap.set(key, g)
    totalExclusive += excl
    totalTax += tax
  }

  const groups = Array.from(groupsMap.entries()).map(([voucherKind, g]) => ({
    voucherKind,
    count: g.count,
    taxExclusiveAmount: g.exclusive.toFixed(2),
    deductibleTax: g.tax.toFixed(2),
  }))

  return NextResponse.json({
    period: period || null,
    groups,
    totalExclusiveAmount: totalExclusive.toFixed(2),
    totalDeductibleTax: totalTax.toFixed(2),
  })
}
