// 发票解析：统一走本地离线 OCR 引擎（脚本见 backend/local_ocr.py）
//
// 引擎：local_ocr.py 默认优先用 PaddleOCR（PaddlePaddle，中文识别准确率高，
// 解决此前 RapidOCR 在中文发票上乱码/误识的问题）；PaddleOCR 不可用时自动回退
// RapidOCR（rapidocr-onnxruntime）。PDF 用 PyMuPDF 栅格化后识别。
//
// 背景：此前曾用百度云端 vat_invoice，但发票属财务敏感数据会上云；本地离线引擎
// 完全不依赖云端、不暴露文件，离线免费。
//
// 支持：图片（png/jpg/jpeg/bmp/gif/webp）、PDF（多页合并坐标）。
// 不支持（实测 PyMuPDF 1.28.2 无法打开 OFD）：OFD —— 需要额外引入 OFD 渲染库
//        后再扩展 local_ocr.py，届时前端放宽文件类型限制即可。
//
// 数据流：parseInvoice(filePath) → spawn python local_ocr.py → 解析 stdout JSON → ParsedInvoice
import { localOcr } from './localOcr'

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
  /** 发票类型：vat(增值税) | train(铁路电子客票) */
  invoiceType?: 'vat' | 'train'
  rawText: string
}

export async function parseInvoice(filePath: string): Promise<ParsedInvoice> {
  return localOcr(filePath)
}
