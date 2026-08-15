import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseInvoice } from '@/lib/invoiceParser'
import { syncDeduction } from '@/lib/vatDeduction'
import { existsSync } from 'fs'
import path from 'path'

export const runtime = 'nodejs'

const UPLOAD_DIR = path.join(process.cwd(), 'uploads')

/**
 * POST /api/invoices/reparse —— 用当前 OCR 引擎对发票（重新）本地识别
 * 请求体（可选）：{ ids?: string[] }；不传则重识别全部发票。
 * 用途：改 local_ocr.py 后让存量发票吃到新的抽取字段；或修正误识后一键重抽。
 * 重识别会更新 parsedData 并同步进项抵扣台账。
 */
export async function POST(req: NextRequest) {
  let body: { ids?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    // 空 body → 全部重识别
  }
  const ids = Array.isArray(body.ids) ? (body.ids as string[]).filter(Boolean) : []
  const where = ids.length ? { id: { in: ids } } : {}

  const invoices = await prisma.invoice.findMany({
    where,
    select: { id: true, storagePath: true, invoiceType: true },
  })

  let reprocessed = 0
  const errors: Array<{ id: string; reason: string }> = []
  for (const inv of invoices) {
    const abs = path.join(UPLOAD_DIR, path.basename(inv.storagePath))
    if (!existsSync(abs)) {
      errors.push({ id: inv.id, reason: '落盘文件不存在' })
      continue
    }
    try {
      const parsed = await parseInvoice(abs)
      await prisma.invoice.update({
        where: { id: inv.id },
        data: {
          invoiceType: (parsed as any)?.invoiceType ?? inv.invoiceType,
          parseStatus: 'done',
          parsedData: parsed as any,
        },
      })
      await syncDeduction(inv.id, parsed as any, (parsed as any)?.invoiceType).catch(() => {})
      reprocessed++
    } catch (e) {
      errors.push({ id: inv.id, reason: String((e as Error)?.message ?? e) })
    }
  }
  return NextResponse.json({ reprocessed, errors })
}
