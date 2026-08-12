import { create } from 'zustand'
import type {
  Account,
  AppPreferences,
  Category,
  DashboardSummary,
  Invoice,
  Transaction,
  User,
} from '@/types'
import {
  mockAccounts,
  mockCategories,
  mockTransactions,
} from '@/mock/data'

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

  // ---- 发票 ----
  invoices: Invoice[]

  // ---- 登录态 ----
  currentUser: User | null
  isAuthenticated: boolean

  // ---- 操作（actions） ----
  setPreferences: (patch: Partial<AppPreferences>) => void
  addTransaction: (input: Omit<Transaction, 'id'>) => void
  loadInvoices: () => Promise<void>
  addInvoice: (input: {
    ownerName: string
    invoiceDate: string
    fileName: string
    fileType: string
    /** 文件 base64 DataURL（上传时发给 mock 服务，由其解码落盘） */
    fileDataUrl: string
    note?: string
  }) => Promise<void>
  login: (username: string) => void
  logout: () => void
}

export const useAppStore = create<AppState>((set) => ({
  accounts: mockAccounts,
  transactions: mockTransactions,
  categories: mockCategories,
  preferences: { themeMode: 'light', currencySymbol: '¥' },

  invoices: [],

  // 初始未登录
  currentUser: null,
  isAuthenticated: false,

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

  // 从 mock 服务拉取发票列表（发票页挂载时调用）
  loadInvoices: async () => {
    try {
      const res = await fetch('/api/invoices')
      if (!res.ok) return
      const list = (await res.json()) as Invoice[]
      set({ invoices: list })
    } catch {
      // 服务未启动时静默失败，列表保持空（页面显示空状态引导）
    }
  },

  // 上传一张发票到 mock 服务：POST /api/invoices（内含 base64 文件内容）
  // 服务解码后存盘，返回带 fileUrl 的记录；前端只保存元数据，不再持有 base64
  addInvoice: async (input) => {
    const res = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) throw new Error('上传失败')
    const saved = (await res.json()) as Invoice
    set((state) => ({ invoices: [saved, ...state.invoices] }))
  },

  // 演示登录：记录用户名即可（真实项目应校验后端返回的 token）
  login: (username) =>
    set({
      currentUser: { id: 'u-demo', name: username },
      isAuthenticated: true,
    }),

  logout: () => set({ currentUser: null, isAuthenticated: false }),
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
