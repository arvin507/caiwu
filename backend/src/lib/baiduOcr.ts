// 百度 OCR：增值税发票识别（云端）
//
// 适用场景：所有发票（图片 / PDF / OFD）统一走云端结构化识别。
// 百度 vat_invoice 接口原生支持 image / pdf_file / ofd_file 三种 base64 入参
// （优先级 image > url > pdf_file > ofd_file），多页文件默认只识别第 1 页。
//
// 费用与合规提示：
//  - 百度 OCR 有免费额度，超出按调用量计费，需在控制台开通「文字识别 OCR」服务。
//  - 发票属于财务敏感数据，调用意味着文件会发往百度云端；学习/内部可用，
//    上线前请评估数据合规（或改用私有化部署 / 本地 OCR）。
import type { ParsedInvoice } from './invoiceParser'

const TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token'
const VAT_URL = 'https://aip.baidubce.com/rest/2.0/ocr/v1/vat_invoice'

// ─────────────────────────────────────────────────────────────
// 并发控制：百度 OCR 的 QPS 上限为 2。
// 用全局信号量保证「同时在途」的 OCR 请求不超过 2，避免触发 QPS 限流；
// 即使前端并发上传、或多用户同时上传，OCR 调用也被统一节流到 2。
// ─────────────────────────────────────────────────────────────
const OCR_MAX_CONCURRENCY = 2
let _active = 0
const _waiters: Array<() => void> = []
function acquireSlot(): Promise<void> {
  if (_active < OCR_MAX_CONCURRENCY) {
    _active++
    return Promise.resolve()
  }
  return new Promise((resolve) => _waiters.push(resolve))
}
function releaseSlot() {
  _active--
  const next = _waiters.shift()
  if (next) {
    _active++
    next()
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 百度 QPS 超限错误码为 18；另含「请求过于频繁 / 限流」及瞬时网络抖动，这些都应重试。
function isRetryableOcrError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  return /\b18\b|qps|rate.?limit|请求过于频繁|频繁|ECONNRESET|ETIMEDOUT|timeout|fetch failed|network/i.test(
    msg,
  )
}

// access_token 有效期约 30 天，这里在进程内缓存，过期前复用，减少获取调用
let cachedToken: { token: string; expireAt: number } | null = null

/** 用 API Key / Secret Key 换取 access_token（百度 OAuth client_credentials 模式） */
export async function getBaiduToken(): Promise<string> {
  const apiKey = process.env.BAIDU_OCR_API_KEY
  const secretKey = process.env.BAIDU_OCR_SECRET_KEY
  if (!apiKey || !secretKey) {
    throw new Error(
      '未配置百度 OCR 密钥：请在 backend/.env 设置 BAIDU_OCR_API_KEY 与 BAIDU_OCR_SECRET_KEY',
    )
  }
  if (cachedToken && cachedToken.expireAt > Date.now()) return cachedToken.token

  const url =
    `${TOKEN_URL}?grant_type=client_credentials` +
    `&client_id=${encodeURIComponent(apiKey)}` +
    `&client_secret=${encodeURIComponent(secretKey)}`
  const res = await fetch(url, { method: 'POST' })
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string }
  if (!json.access_token) {
    throw new Error('获取百度 access_token 失败: ' + JSON.stringify(json))
  }
  // 提前 60s 过期，避免临界时刻用到失效 token
  cachedToken = {
    token: json.access_token,
    expireAt: Date.now() + (Number(json.expires_in) || 2592000) * 1000 - 60_000,
  }
  return cachedToken.token
}

/**
 * 从 words_result 里取字段，兼容两种返回结构：
 *  - 专用接口 vat_invoice 直接返回字符串：words_result.InvoiceCode = "12345"
 *  - 部分场景返回 { words: "12345" }
 * keys 可传多个候选名，命中第一个非空值。
 */
function pick(wr: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = wr?.[k]
    if (v == null) continue
    const s = typeof v === 'string' ? v : ((v as { words?: unknown })?.words ?? '').toString()
    if (s && s.trim()) return s.trim()
  }
  return null
}

/**
 * 调用百度「增值税发票识别」接口，把结果映射为 ParsedInvoice。
 * @param base64 文件纯 base64 串（不带 data URI 前缀）
 * @param kind   文件类型：image / pdf / ofd，决定提交参数（image / pdf_file / ofd_file）
 */
export async function baiduVatOcr(base64: string, kind: 'image' | 'pdf' | 'ofd'): Promise<ParsedInvoice> {
  // 百度限制 base64（编码+urlencode 后）不超过约 8MB，过大直接提示压缩，避免无谓请求
  if (base64.length > 8 * 1024 * 1024) {
    throw new Error('文件过大（base64 > 8MB），请压缩 / 缩小后重试')
  }

  const paramName = kind === 'image' ? 'image' : kind === 'pdf' ? 'pdf_file' : 'ofd_file'

  // 并发闸门：保证同时在途 OCR 请求 ≤ OCR_MAX_CONCURRENCY（=2，对齐百度 QPS）
  await acquireSlot()
  try {
    let lastErr: unknown
    // 重试：QPS 超限（错误码 18）/ 限流 / 网络抖动为可重试错误，最多 3 次、指数退避（500ms→1s→2s）
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const token = await getBaiduToken()
        const res = await fetch(`${VAT_URL}?access_token=${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          // base64 为纯串（不带 data URI 前缀），按 urlencode 提交；参数名随文件类型变化
          body: `${paramName}=${encodeURIComponent(base64)}`,
        })
        const json = (await res.json()) as {
          error_code?: number
          error_msg?: string
          words_result?: Record<string, unknown>
        }
        if (json.error_code) {
          const retryable =
            json.error_code === 18 || /qps|rate.?limit|频繁|limit/i.test(json.error_msg || '')
          const err = new Error(`百度 OCR 错误 ${json.error_code}: ${json.error_msg || ''}`)
          // 用标记位记录是否可重试，交给外层判断是否继续退避
          ;(err as { ocrRetryable?: boolean }).ocrRetryable = retryable
          throw err
        }

        const wr = json.words_result || {}
        return {
          // vat_invoice 字段映射（与本地解析抽出的字段对齐）
          invoiceCode: pick(wr, 'InvoiceCode'), // 发票代码
          invoiceNumber: pick(wr, 'InvoiceNum'), // 发票号码
          invoiceDate: pick(wr, 'InvoiceDate'), // 开票日期
          sellerName: pick(wr, 'SellerName'), // 销售方名称
          sellerTaxId: pick(wr, 'SellerRegisterNum'), // 销售方纳税人识别号
          buyerName: pick(wr, 'PurchaserName'), // 购买方名称
          amount: pick(wr, 'TotalAmount'), // 合计金额（不含税）
          taxAmount: pick(wr, 'TotalTax'), // 合计税额
          totalAmount: pick(wr, 'AmountInFiguers'), // 价税合计（小写）
          // 把百度返回的全部结构化字段存为原文，前端「核对」页可查看/人工校对
          rawText: JSON.stringify(wr, null, 2),
        }
      } catch (e) {
        lastErr = e
        const retryable =
          (e as { ocrRetryable?: boolean })?.ocrRetryable || isRetryableOcrError(e)
        if (!retryable || attempt === 2) throw e
        await sleep(500 * Math.pow(2, attempt)) // 500ms, 1s, 2s
      }
    }
    throw lastErr
  } finally {
    releaseSlot()
  }
}
