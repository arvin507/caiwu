// 本地发票解析：支持 PDF（文本层抽取）与 OFD（解包 XML 抽取）
// 不依赖任何外部服务 / API Key，完全离线；图片类文件会抛错（后续接 OCR 服务）
import { readFile } from 'fs/promises'
import path from 'path'
import { baiduVatOcr } from './baiduOcr'
// @ts-ignore pdf-parse 未提供类型声明
import pdfParse from 'pdf-parse'
// @ts-ignore adm-zip 未提供类型声明
import AdmZip from 'adm-zip'
import { XMLParser } from 'fast-xml-parser'

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

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

// 图片类发票走云端 OCR（百度）；其余本地解析
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp']

export async function parseInvoice(filePath: string): Promise<ParsedInvoice> {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.pdf') {
    const text = await extractPdfText(filePath)
    if (!text.trim()) throw new Error('未能从 PDF 抽取到文字（可能是扫描件，需 OCR）')
    return extractFields(text)
  }
  if (ext === '.ofd') {
    const text = await extractOfdText(filePath)
    if (!text.trim()) throw new Error('未能从 OFD 抽取到文字（可能是图片型，需 OCR）')
    return extractFields(text)
  }
  if (IMAGE_EXTS.includes(ext)) {
    if (!process.env.BAIDU_OCR_API_KEY || !process.env.BAIDU_OCR_SECRET_KEY) {
      throw new Error(
        '图片类发票需配置百度 OCR：请在 backend/.env 设置 BAIDU_OCR_API_KEY / BAIDU_OCR_SECRET_KEY',
      )
    }
    const base64 = (await readFile(filePath)).toString('base64')
    return await baiduVatOcr(base64)
  }
  throw new Error(`暂不支持的文件类型「${ext}」`)
}

async function extractPdfText(filePath: string): Promise<string> {
  const buf = await readFile(filePath)
  const data = await pdfParse(buf)
  return data.text || ''
}

async function extractOfdText(filePath: string): Promise<string> {
  const zip = new AdmZip(filePath)
  const texts: string[] = []
  for (const entry of zip.getEntries()) {
    if (!/\/Content\.xml$/i.test(entry.entryName)) continue
    const content = entry.getData().toString('utf8')
    collectTextCodes(xmlParser.parse(content), texts)
  }
  return texts.join('\n')
}

// OFD 的文字在 <TextCode Text="..."/> 或 <TextCode>...</TextCode> 里
function collectTextCodes(node: unknown, out: string[]): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((n) => collectTextCodes(n, out))
    return
  }
  for (const key of Object.keys(node as object)) {
    if (key === 'TextCode' || key.endsWith(':TextCode')) {
      const tc = (node as Record<string, unknown>)[key]
      const list = Array.isArray(tc) ? tc : [tc]
      for (const t of list) {
        const val = (t as Record<string, unknown>)?.['@_Text'] ?? (t as Record<string, unknown>)?.['#text']
        if (val) out.push(String(val))
      }
    }
    collectTextCodes((node as Record<string, unknown>)[key], out)
  }
}

// 用正则从发票原文里抠字段。
//
// 难点：PDF/OFD 文本抽取会丢失版式，标签常和数值被拆散（标签挤在前面、数值跑到末尾），
// 且中文标签字间常被插入空格/换行（如「名 称:」「销\n售\n方」）。
// 因此这里不能用「标签紧贴数值」的朴素正则，改为：
//   1) 标签编译成「字间允许空白」的正则（labelRe）；
//   2) 标签定位后向后搜索第一个符合的值（after），解决标签/数值分离；
//   3) 关键字段再用全局模式兜底（发票号 18-20 位、日期、含字母的税号、末尾价税合计）。
// 仍属「模板相关」提取，换版式可能要微调；OCR 偶发错误前端有「人工核对」入口兜底。
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function labelRe(label: string): RegExp {
  const src = label
    .split('')
    .map((ch) => (ch === ':' || ch === '：' ? '[:：]\\s*' : `${escapeRegExp(ch)}\\s*`))
    .join('')
  return new RegExp(src)
}

// 定位标签后，在它之后的文本里搜第一个符合的值（解决标签与数值分离）
function after(text: string, label: string, valueRe: RegExp): string | null {
  const idx = text.search(labelRe(label))
  if (idx < 0) return null
  const m = text.slice(idx).match(valueRe)
  return m ? (m[1] ?? m[0]).replace(/\s+/g, '').trim() : null
}

function extractFields(text: string): ParsedInvoice {
  // 发票号码：全电发票多为 20 位纯数字；向后搜 18-20 位（避免匹配到 16 位订单号）
  const invoiceNumber =
    after(text, '发票号码', /(\d{18,20})/) ?? text.match(/(\d{18,20})/)?.[1] ?? null

  // 开票日期：向后搜「年月日」或「-」分隔日期
  const invoiceDate =
    after(text, '开票日期', /(\d{4}年\d{1,2}月\d{1,2}日|\d{4}[-/]\d{1,2}[-/]\d{1,2})/) ??
    text.match(/(\d{4}年\d{1,2}月\d{1,2}日|\d{4}[-/]\d{1,2}[-/]\d{1,2})/)?.[1] ??
    null

  // 发票代码：「发票代码」后紧跟 10-12 位数字（电子发票常无此字段，返回 null 正常）
  const invoiceCode = after(text, '发票代码', /(\d{10,12})/)

  // 销售方名称：含「有限公司/公司/店…」的公司名最可靠
  const sellerName =
    text.match(/([一-龥A-Za-z0-9（）()&·]+?(?:有限公司|公司|店|中心|厂|商行))/)?.[1] ?? null

  // 纳税人识别号：15-20 位字母数字且含字母（排除纯数字发票号/订单号）
  let sellerTaxId: string | null = null
  const taxCandidates = text.match(/[0-9A-Z]{15,20}/g) ?? []
  for (const c of taxCandidates) {
    if (/[A-Z]/.test(c)) {
      sellerTaxId = c
      break
    }
  }

  // 价税合计：取最后一个「¥xx.xx」两位金额（位于原文末尾，且为合计）
  const amounts = [...text.matchAll(/¥\s*(\d+\.\d{2})/g)].map((m) => m[1])
  const totalAmount = amounts.length ? amounts[amounts.length - 1] : null

  // 金额 / 税额：从「¥金额¥税额」合并串（常紧跟税率前）提取
  const merged = text.match(/¥\s*(\d+\.\d{2})\s*¥\s*(\d+\.\d{2})/)
  const amount = merged ? merged[1] : null
  const taxAmount = merged ? merged[2] : null

  // 购买方名称：个人发票常直接写「个人」
  const buyerName = /个人/.test(text) ? '个人' : null

  return {
    invoiceCode,
    invoiceNumber,
    invoiceDate,
    sellerName,
    buyerName,
    amount,
    taxAmount,
    totalAmount,
    sellerTaxId,
    rawText: text,
  }
}
