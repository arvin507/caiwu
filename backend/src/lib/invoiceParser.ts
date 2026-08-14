// 发票解析：统一走百度 OCR（增值税发票识别），支持图片 / PDF / OFD
//
// 说明：此前本地文本解析（pdf-parse / OFD 解包）对版式敏感、易抽错金额
// （曾出现「金额/税额为空、价税合计被错抽成税额」的 bug），故改为全部交由
// 百度云端结构化识别，入参按文件类型选择 image / pdf_file / ofd_file。
// 百度 vat_invoice 接口原生支持这三种 base64 入参（无需本地转图片）。
//
// 数据合规提示：发票属财务敏感数据，调用意味着文件会发往百度云端；
// 学习/内部可用，上线前请评估合规（或改用私有化部署 / 本地 OCR）。
import { readFile } from 'fs/promises'
import path from 'path'
import { baiduVatOcr } from './baiduOcr'

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp']

export interface ParsedInvoice {
  invoiceCode?: string | null
  invoiceNumber?: string | null
  invoiceDate?: string | null
  sellerName?: string | null
  buyerName?: string | null
  amount?: string | null
  taxAmount?: string | null
  totalAmount?: string | null
  /** 销售方纳税人识别号（公司类发票才有，个人发票无） */
  sellerTaxId?: string | null
  rawText: string
}

export async function parseInvoice(filePath: string): Promise<ParsedInvoice> {
  const ext = path.extname(filePath).toLowerCase()
  const base64 = (await readFile(filePath)).toString('base64')

  if (IMAGE_EXTS.includes(ext)) {
    return baiduVatOcr(base64, 'image')
  }
  if (ext === '.pdf') {
    return baiduVatOcr(base64, 'pdf')
  }
  if (ext === '.ofd') {
    return baiduVatOcr(base64, 'ofd')
  }
  throw new Error(`暂不支持的文件类型「${ext}」（当前仅支持图片 / PDF / OFD，均走百度 OCR）`)
}
