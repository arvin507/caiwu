/**
 * 通用格式化工具
 *
 * 把「原始数据」转成「用户看得懂的展示文本」，
 * 例如 38650 -> ¥38,650.00。集中放在 utils 里，页面直接调用，避免重复逻辑。
 */

/** 金额格式化：千分位 + 固定两位小数 + 币种符号 */
export function formatCurrency(amount: number, symbol = '¥'): string {
  return (
    symbol +
    amount.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

/**
 * 带正负号的金额（收入/支出用）。
 * 注意：按中国习惯，正数为红、负数为绿由调用方用 color 控制，这里只负责符号。
 */
export function formatSignedCurrency(amount: number, symbol = '¥'): string {
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : ''
  return sign + formatCurrency(Math.abs(amount), symbol)
}

/**
 * 日期格式化：把日期转成「2026年08月12日」。
 * 兼容两种输入：
 *  - '2026-08-12'（前端 date 输入 / 纯日期）
 *  - '2026-08-12T00:00:00.000Z'（后端 Prisma DateTime 序列化的 ISO 字符串）
 */
export function formatDate(input: string): string {
  if (!input) return ''
  // 后端 DateTime 序列化带 T 和时间，先截取日期部分 YYYY-MM-DD，避免时区偏移与乱码
  const datePart = input.includes('T') ? input.slice(0, 10) : input
  const [y, m, d] = datePart.split('-')
  if (!y || !m || !d) return input
  return `${y}年${m}月${d}日`
}

/** 取当前月份，用于筛选「本月」数据，如 '2026-08' */
export function currentYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
