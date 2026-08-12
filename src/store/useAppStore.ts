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
 * 登录态现在对接真实后端：
 * - login：把用户名/密码发给 /api/auth/login，拿到 JWT token 存到 localStorage
 * - 刷新页面后，restoreSession 用本地 token 调 /api/auth/me 恢复登录态（含 role）
 * - 所有需要鉴权的请求都带 `Authorization: Bearer <token>`
 */

const TOKEN_KEY = 'caiwu_token'

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
  /** JWT token（来自后端，存 localStorage 以便刷新后保持登录） */
  token: string | null
  /** 初始「用 token 恢复登录态」是否已完成，避免刷新瞬间闪一下登录页 */
  authReady: boolean

  // ---- 操作（actions） ----
  setPreferences: (patch: Partial<AppPreferences>) => void
  addTransaction: (input: Omit<Transaction, 'id'>) => void
  loadInvoices: () => Promise<void>
  addInvoice: (input: {
    ownerName: string
    invoiceDate: string
    /** 原始文件对象，用 multipart/form-data 上传 */
    file: File
    note?: string
  }) => Promise<void>
  /** 人工核对写回：PATCH /api/invoices/:id 更新解析结果/状态，并合并回列表 */
  updateInvoice: (id: string, patch: {
    parsedData?: Record<string, unknown> | null
    parseStatus?: 'pending' | 'done' | 'failed'
    parseError?: string | null
  }) => Promise<void>
  /** 删除发票：DELETE /api/invoices/:id（元数据 + 落盘文件），成功后从列表移除 */
  deleteInvoice: (id: string) => Promise<void>

  // 鉴权相关
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  restoreSession: () => Promise<void>
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>

  // 用户管理（仅超级管理员）
  fetchUsers: () => Promise<User[]>
  addUser: (input: { username: string; name: string; password: string }) => Promise<void>
}

const initialToken =
  typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null

export const useAppStore = create<AppState>((set, get) => ({
  accounts: mockAccounts,
  transactions: mockTransactions,
  categories: mockCategories,
  preferences: { themeMode: 'light', currencySymbol: '¥' },

  invoices: [],

  // 初始：若本地已有 token，先当作已登录（restoreSession 会再次校验）
  currentUser: null,
  isAuthenticated: !!initialToken,
  token: initialToken,
  authReady: false,

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

  // 从后端服务拉取发票列表（发票页挂载时调用）
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

  // 上传一张发票到后端服务：POST /api/invoices（multipart/form-data）
  addInvoice: async (input) => {
    const fd = new FormData()
    fd.append('ownerName', input.ownerName)
    fd.append('invoiceDate', input.invoiceDate)
    if (input.note) fd.append('note', input.note)
    fd.append('file', input.file)
    const res = await fetch('/api/invoices', { method: 'POST', body: fd })
    if (!res.ok) throw new Error('上传失败')
    const saved = (await res.json()) as Invoice
    set((state) => ({ invoices: [saved, ...state.invoices] }))
  },

  // 人工核对写回：PATCH /api/invoices/:id，成功后把最新数据合并回列表
  updateInvoice: async (id, patch) => {
    const res = await fetch(`/api/invoices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(err.error || '保存失败')
    }
    const updated = (await res.json()) as Invoice
    set((state) => ({
      invoices: state.invoices.map((i) => (i.id === id ? updated : i)),
    }))
  },

  // 删除发票：DELETE /api/invoices/:id，成功后从列表移除该条
  deleteInvoice: async (id) => {
    const res = await fetch(`/api/invoices/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(err.error || '删除失败')
    }
    set((state) => ({ invoices: state.invoices.filter((i) => i.id !== id) }))
  },

  // 登录：调后端校验，成功存 token + 用户信息（含 role）
  login: async (username, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(err.error || '登录失败')
    }
    const data = (await res.json()) as { token: string; user: User }
    localStorage.setItem(TOKEN_KEY, data.token)
    set({ token: data.token, currentUser: data.user, isAuthenticated: true })
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY)
    set({ token: null, currentUser: null, isAuthenticated: false })
  },

  // 刷新页面后：用本地 token 调 /api/auth/me 恢复登录态（含最新 role）
  restoreSession: async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null
    if (!token) {
      set({ authReady: true })
      return
    }
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('token 失效')
      const user = (await res.json()) as User
      set({ token, currentUser: user, isAuthenticated: true })
    } catch {
      // token 失效：清空，退回登录页
      localStorage.removeItem(TOKEN_KEY)
      set({ token: null, currentUser: null, isAuthenticated: false })
    } finally {
      set({ authReady: true })
    }
  },

  // 修改密码：调后端，校验旧密码后更新（任意已登录用户可用）
  changePassword: async (oldPassword, newPassword) => {
    const { token } = get()
    if (!token) throw new Error('未登录')
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ oldPassword, newPassword }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(err.error || '修改失败')
    }
  },

  // 获取用户列表（仅管理员后端会放行）
  fetchUsers: async () => {
    const { token } = get()
    const res = await fetch('/api/users', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error('获取用户列表失败')
    return (await res.json()) as User[]
  },

  // 创建普通用户（仅管理员后端会放行）
  addUser: async (input) => {
    const { token } = get()
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(err.error || '创建失败')
    }
  },
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
