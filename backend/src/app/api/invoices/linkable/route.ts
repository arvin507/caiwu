import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'

export const runtime = 'nodejs'

/**
 * GET /api/invoices/linkable
 * 关联发票时给前端用的「可选项」列表，并标注每张发票当前已关联到哪些行。
 *  - linkedTo: [] → 尚未关联，可被任意行关联
 *  - linkedTo: [{ type: 'item' | 'leg', id, allocatedAmount? }] → 已关联（可能多行，即 N:1）
 *
 * 业务硬规则：发票归属人(ownerName) 须等于报销单申请人(applicantName) 才能关联。
 *  - 传 reimbursementId 时：仅返回「ownerName === 该单 applicantName」的发票，
 *    加上「已关联到本单、但归属不符的历史发票」（保证用户仍能解除）。
 *  - 不传 reimbursementId（兜底）：返回全部发票（保持旧行为）。
 *
 * 与 /api/invoices（发票管理页用）不同：这里多带了 linkedTo 标注，且不做分页。
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const reimbursementId = req.nextUrl.searchParams.get('reimbursementId') || undefined

  // 核心业务规则：发票归属人(ownerName) 必须等于报销单申请人(applicantName) 才能关联。
  // 查询条件【始终】包含 ownerName 过滤，绝不返回全部发票（避免泄漏他人发票）。
  let where: Prisma.InvoiceWhereInput
  if (reimbursementId) {
    const reb = await prisma.reimbursement.findUnique({
      where: { id: reimbursementId },
      select: {
        id: true,
        applicantName: true,
        items: { select: { id: true } },
        legs: { select: { id: true } },
      },
    })
    if (!reb) return NextResponse.json({ error: '报销单不存在' }, { status: 404 })
    const applicantName = (reb.applicantName || '').trim()
    const itemIds = reb.items.map((i) => i.id)
    const legIds = reb.legs.map((l) => l.id)
    // 已关联到本单行的历史发票（即使归属不符）仍展示，保证可解除
    const linkedToThisReb = {
      links: { some: { OR: [
        { reimbursementItemId: { in: itemIds } },
        { reimbursementLegId: { in: legIds } },
      ] } },
    }
    where = applicantName
      ? { OR: [{ ownerName: applicantName }, linkedToThisReb] }
      : linkedToThisReb
  } else {
    // 未传报销单：弹窗不应出现此情况（正常始终带 id）。返回空，绝不泄漏他人发票。
    return NextResponse.json([])
  }

  const invoices = await prisma.invoice.findMany({
    where,
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
