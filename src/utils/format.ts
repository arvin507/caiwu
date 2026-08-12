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

/** 日期格式化：'2026-08-12' -> '2026年08月12日' */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${y}年${m}月${d}日`
}

/** 取当前月份，用于筛选「本月」数据，如 '2026-08' */
export function currentYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
