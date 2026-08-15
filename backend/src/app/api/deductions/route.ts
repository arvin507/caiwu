import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { syncDeduction } from '@/lib/vatDeduction'

export const runtime = 'nodejs'

/**
 * GET /api/deductions —— 进项抵扣台账列表
 * 查询参数（均可选）：
 *   period        申报所属期精确匹配，如 2026-08
 *   status        勾选状态：unconfirmed|selected|deducted|transferred_out
 *   kind          凭证类别精确匹配（voucherKind）
 *   deductibleOnly=1  只看可抵扣
 * 行为：自动为「已解析但尚无抵扣行」的发票补建记录，再按条件过滤返回。
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const period = sp.get('period')?.trim() || ''
  const status = sp.get('status')?.trim() || ''
  const kind = sp.get('kind')?.trim() || ''
  const deductibleOnly = sp.get('deductibleOnly') === '1'

  // 1) 补建缺失的抵扣行（每张已解析发票都应有一行台账）
  const missing = await prisma.invoice.findMany({
    where: { parsedData: { not: Prisma.JsonNull }, deduction: null },
    select: { id: true, parsedData: true, invoiceType: true },
  })
  for (const inv of missing) {
    await syncDeduction(inv.id, inv.parsedData as any, inv.invoiceType).catch(() => {})
  }

  // 2) 按条件查询
  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (period) where.declarePeriod = period
  if (kind) where.voucherKind = kind
  if (deductibleOnly) where.canDeduct = true

  const rows = await prisma.invoiceDeduction.findMany({
    where,
    orderBy: [{ canDeduct: 'desc' }, { deductibleTax: 'desc' }],
    include: {
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          invoiceType: true,
          ownerName: true,
          fileName: true,
          parsedData: true,
          _count: { select: { links: true } },
        },
      },
    },
  })

  const data = rows.map((r) => ({
    id: r.id,
    invoiceId: r.invoiceId,
    voucherKind: r.voucherKind,
    canDeduct: r.canDeduct,
    taxRate: r.taxRate,
    taxExclusiveAmount: r.taxExclusiveAmount,
    deductibleTax: r.deductibleTax,
    status: r.status,
    declarePeriod: r.declarePeriod,
    note: r.note,
    confirmedAt: r.confirmedAt,
    invoice: {
      id: r.invoice.id,
      invoiceNumber: r.invoice.invoiceNumber,
      invoiceType: r.invoice.invoiceType,
      ownerName: r.invoice.ownerName,
      fileName: r.invoice.fileName,
      linkedCount: r.invoice._count.links,
      parsedData: r.invoice.parsedData,
    },
  }))
  return NextResponse.json(data)
}

/**
 * POST /api/deductions/recalculate —— 批量重算所有已解析发票的抵扣结果。
 * 发票 OCR 改进 / 规则调整后，一键刷新 invoice_deductions 的计算字段
 * （不影响用户已标记的 status / declarePeriod / note）。
 */
export async function POST(req: NextRequest) {
  const invoices = await prisma.invoice.findMany({
    where: { parsedData: { not: Prisma.JsonNull } },
    select: { id: true, parsedData: true, invoiceType: true },
  })
  let ok = 0
  let failed = 0
  for (const inv of invoices) {
    try {
      await syncDeduction(inv.id, inv.parsedData as any, inv.invoiceType)
      ok++
    } catch {
      failed++
    }
  }
  return NextResponse.json({ recalced: ok, failed })
}
