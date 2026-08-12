/**
 * 财务系统的领域模型（Domain Model）
 *
 * 这里集中定义整个应用共享的「数据结构契约」。
 * TypeScript 的价值之一：一处定义类型，全项目复用且自动校验，
 * 改了字段名，所有用到它的地方编译期就会报错。
 */

/** 交易类型：收入 / 支出 */
export type TransactionType = 'income' | 'expense'

/** 账户类型 */
export type AccountType = 'cash' | 'bank' | 'credit' | 'ecommerce' | 'investment'

/** 收支分类 */
export interface Category {
  id: string
  name: string
  /** 分类只能用于收入或支出其中一种 */
  type: TransactionType
  icon?: string
}

/** 账户（钱包、银行卡、支付宝等） */
export interface Account {
  id: string
  name: string
  type: AccountType
  /** 当前余额（单位：元） */
  balance: number
  /** 币种符号，默认 ¥ */
  currency: string
  remark?: string
}

/** 一笔收支记录（账单明细） */
export interface Transaction {
  id: string
  /** 交易日期，ISO 字符串，如 '2026-08-12' */
  date: string
  type: TransactionType
  categoryId: string
  accountId: string
  /** 金额（正数，方向由 type 决定） */
  amount: number
  note?: string
}

/** 当前登录用户 */
export interface User {
  id: string
  name: string
  /** 头像链接，可选；不传则展示首字母 */
  avatar?: string
}

/** 全局用户偏好（放在 store 里，可被设置页修改） */
export interface AppPreferences {
  themeMode: 'light' | 'dark'
  currencySymbol: string
}

/** 仪表盘用的汇总指标（派生数据，不持久化） */
export interface DashboardSummary {
  totalBalance: number
  monthIncome: number
  monthExpense: number
  monthNet: number
}

/** 发票（图片或 PDF 存档） */
export interface Invoice {
  id: string
  /** 归属人姓名（必填，否则「按人聚合」无意义） */
  ownerName: string
  /** 原始文件名 */
  fileName: string
  /** MIME 类型，如 image/png、application/pdf */
  fileType: string
  /** 预览/下载地址（由后端返回，如 /api/invoices/:id/file）。纯前端练习用 mock 服务提供 */
  fileUrl?: string
  /** 上传日期 YYYY-MM-DD */
  uploadedAt: string
  /** 发票开票日期 YYYY-MM-DD（用于「按发票日期」排序） */
  invoiceDate: string
  note?: string
}

/** 发票列表排序方式 */
export type InvoiceSortKey = 'uploadedAt' | 'invoiceDate'
