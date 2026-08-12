import { create } from 'zustand'
import type {
  Account,
  AppPreferences,
  Category,
  DashboardSummary,
  Transaction,
} from '@/types'
import { mockAccounts, mockCategories, mockTransactions } from '@/mock/data'

/**
 * 全局状态仓库（Zustand）
 *
 * Zustand 的核心思路：把「跨组件共享的数据」集中到一个 store，
 * 任意组件用 `useAppStore(s => s.xxx)` 订阅自己关心的片段，
 * 只有用到的片段变化时才重渲染 —— 比 Context 更细粒度、性能更好。
 */

interface AppState {
  // ---- 数据 ----
  accounts: Account[]
  transactions: Transaction[]
  categories: Category[]
  preferences: AppPreferences

  // ---- 操作（actions） ----
  setPreferences: (patch: Partial<AppPreferences>) => void
  addTransaction: (input: Omit<Transaction, 'id'>) => void
}

export const useAppStore = create<AppState>((set) => ({
  accounts: mockAccounts,
  transactions: mockTransactions,
  categories: mockCategories,
  preferences: { themeMode: 'light', currencySymbol: '¥' },

  setPreferences: (patch) =>
    set((state) => ({ preferences: { ...state.preferences, ...patch } })),

  // 新增一笔账单时，同步更新对应账户余额（收入加、支出减）
  addTransaction: (input) =>
    set((state) => {
      const tx: Transaction = { ...input, id: `t-${Date.now()}` }
      const accounts = state.accounts.map((a) => {
        if (a.id !== input.accountId) return a
        const delta = input.type === 'income' ? input.amount : -input.amount
        return { ...a, balance: a.balance + delta }
      })
      return { transactions: [tx, ...state.transactions], accounts }
    }),
}))

/**
 * 派生数据：根据原始账单/账户计算出仪表盘汇总指标。
 * 放在 store 之外作为纯函数，便于单测，也避免污染 state。
 */
export function computeDashboardSummary(
  transactions: Transaction[],
  accounts: Account[],
): DashboardSummary {
  const now = new Date()
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  let monthIncome = 0
  let monthExpense = 0
  for (const t of transactions) {
    if (!t.date.startsWith(ym)) continue
    if (t.type === 'income') monthIncome += t.amount
    else monthExpense += t.amount
  }

  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0)

  return {
    totalBalance,
    monthIncome,
    monthExpense,
    monthNet: monthIncome - monthExpense,
  }
}
