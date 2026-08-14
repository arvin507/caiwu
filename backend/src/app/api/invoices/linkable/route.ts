import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'

export const runtime = 'nodejs'

/**
 * GET /api/invoices/linkable
 * 关联发票时给前端用的「可选项」列表：返回全部发票，并标注每张发票当前已关联到哪些行。
 *  - linkedTo: [] → 尚未关联，可被任意行关联
 *  - linkedTo: [{ type: 'item' | 'leg', id, allocatedAmount? }] → 已关联（可能多行，即 N:1）
 *
 * 与 /api/invoices（发票管理页用）不同：这里多带了 linkedTo 标注，且不做分页。
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

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
