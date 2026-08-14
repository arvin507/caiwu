import type { PrismaClient } from '@prisma/client'

/**
 * 检查某张发票是否已被「其它报销明细行」占用（1:1 关联约束）。
 * exceptLineId 用于「把同一行重新关联到本发票」时排除自身，避免误判。
 */
export async function isInvoiceOccupied(
  prisma: PrismaClient,
  invoiceId: string,
  exceptLineId?: string,
): Promise<boolean> {
  const item = await prisma.reimbursementItem.findFirst({
    where: { invoiceId, ...(exceptLineId ? { id: { not: exceptLineId } } : {}) },
    select: { id: true },
  })
  if (item) return true
  const leg = await prisma.reimbursementTripLeg.findFirst({
    where: { invoiceId, ...(exceptLineId ? { id: { not: exceptLineId } } : {}) },
    select: { id: true },
  })
  return !!leg
}
