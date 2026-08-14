import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'

export const runtime = 'nodejs'

/**
 * GET /api/invoices/linkable
 * 关联发票时给前端用的「可选项」列表：返回全部发票，并标注每张发票当前已关联到哪一行。
 *  - linkedTo: null → 尚未关联，可被任意行关联
 *  - linkedTo: { type: 'item' | 'leg', id } → 已关联；前端据此禁用/高亮
 *
 * 与 /api/invoices（发票管理页用）不同：这里多带了 linkedTo 标注，且不做分页。
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const invoices = await prisma.invoice.findMany({
    orderBy: { uploadedAt: 'desc' },
  })

  // 把「发票 → 已关联行」做成 map，2 次查询搞定，避免 N+1
  const itemLinks = await prisma.reimbursementItem.findMany({
    where: { invoiceId: { not: null } },
    select: { id: true, invoiceId: true },
  })
  const legLinks = await prisma.reimbursementTripLeg.findMany({
    where: { invoiceId: { not: null } },
    select: { id: true, invoiceId: true },
  })

  const linkedMap = new Map<string, { type: 'item' | 'leg'; id: string }>()
  for (const it of itemLinks) {
    if (it.invoiceId) linkedMap.set(it.invoiceId, { type: 'item', id: it.id })
  }
  for (const lg of legLinks) {
    if (lg.invoiceId) linkedMap.set(lg.invoiceId, { type: 'leg', id: lg.id })
  }

  const data = invoices.map((inv) => ({
    ...inv,
    linkedTo: linkedMap.get(inv.id) ?? null,
  }))
  return NextResponse.json(data)
}
