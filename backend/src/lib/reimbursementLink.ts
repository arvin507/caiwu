import type { PrismaClient } from '@prisma/client'

export type LineType = 'item' | 'leg'

/**
 * 在「发票关联表」上建立/更新一条关联（junction）。
 * 支持三种模式：
 *  - 1:1 ：一行 ↔ 一张发票（一条记录）
 *  - 1:N ：同一 lineId 配多个不同 invoiceId（多次调用）
 *  - N:1 ：同一 invoiceId 配多个不同 lineId（多次调用，allocatedAmount 记录分摊额）
 *
 * 唯一键 (reimbursementItemId, invoiceId) / (reimbursementLegId, invoiceId) 保证同一行不重复挂同一张发票。
 */
export async function upsertLink(
  prisma: PrismaClient,
  opts: {
    lineType: LineType
    lineId: string
    invoiceId: string
    allocatedAmount?: number | null
  },
) {
  const base = {
    invoiceId: opts.invoiceId,
    allocatedAmount:
      opts.allocatedAmount != null ? String(opts.allocatedAmount) : null,
  }
  const data =
    opts.lineType === 'item'
      ? { ...base, reimbursementItemId: opts.lineId }
      : { ...base, reimbursementLegId: opts.lineId }

  const where =
    opts.lineType === 'item'
      ? {
          reimbursementItemId_invoiceId: {
            reimbursementItemId: opts.lineId,
            invoiceId: opts.invoiceId,
          },
        }
      : {
          reimbursementLegId_invoiceId: {
            reimbursementLegId: opts.lineId,
            invoiceId: opts.invoiceId,
          },
        }

  return prisma.invoiceLink.upsert({
    where,
    create: data,
    update: { allocatedAmount: data.allocatedAmount },
  })
}

/** 删除某一行与某张发票之间的关联（不影响其它关联） */
export async function deleteLink(
  prisma: PrismaClient,
  opts: { lineType: LineType; lineId: string; invoiceId: string },
) {
  const where =
    opts.lineType === 'item'
      ? { reimbursementItemId: opts.lineId, invoiceId: opts.invoiceId }
      : { reimbursementLegId: opts.lineId, invoiceId: opts.invoiceId }
  // 可能本就不存在（如并发），用 deleteMany 吞掉"未找到"
  await prisma.invoiceLink.deleteMany({ where })
}
