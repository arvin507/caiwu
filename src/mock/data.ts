import type { Account, Category, Transaction } from '@/types'

/**
 * 示例数据（Mock）
 *
 * 真实项目里这些数据来自后端 API。
 * 现在先写死，让页面有内容可展示；
 * 之后接入接口时，只需把 store 里的数据源换成请求结果即可，页面不用改。
 */

export const mockCategories: Category[] = [
  { id: 'c-salary', name: '工资', type: 'income', icon: 'WalletOutlined' },
  { id: 'c-bonus', name: '奖金', type: 'income', icon: 'GiftOutlined' },
  { id: 'c-food', name: '餐饮', type: 'expense', icon: 'CoffeeOutlined' },
  { id: 'c-transport', name: '交通', type: 'expense', icon: 'CarOutlined' },
  { id: 'c-shop', name: '购物', type: 'expense', icon: 'ShoppingOutlined' },
  { id: 'c-fun', name: '娱乐', type: 'expense', icon: 'SmileOutlined' },
]

export const mockAccounts: Account[] = [
  { id: 'a-cash', name: '现金钱包', type: 'cash', balance: 1200.5, currency: '¥' },
  { id: 'a-bank', name: '招商银行储蓄卡', type: 'bank', balance: 38650.0, currency: '¥' },
  { id: 'a-alipay', name: '支付宝', type: 'ecommerce', balance: 5240.8, currency: '¥' },
  { id: 'a-credit', name: '中信信用卡', type: 'credit', balance: -2300.0, currency: '¥' },
]

export const mockTransactions: Transaction[] = [
  { id: 't-1', date: '2026-08-01', type: 'income', categoryId: 'c-salary', accountId: 'a-bank', amount: 18000, note: '八月工资' },
  { id: 't-2', date: '2026-08-03', type: 'expense', categoryId: 'c-food', accountId: 'a-alipay', amount: 68.5, note: '午餐' },
  { id: 't-3', date: '2026-08-05', type: 'expense', categoryId: 'c-transport', accountId: 'a-cash', amount: 30, note: '地铁充值' },
  { id: 't-4', date: '2026-08-08', type: 'expense', categoryId: 'c-shop', accountId: 'a-alipay', amount: 299, note: '运动鞋' },
  { id: 't-5', date: '2026-08-10', type: 'income', categoryId: 'c-bonus', accountId: 'a-bank', amount: 2000, note: '项目奖金' },
  { id: 't-6', date: '2026-08-11', type: 'expense', categoryId: 'c-fun', accountId: 'a-credit', amount: 128, note: '电影票' },
]

// 注：发票数据不再用 mock，改由 mock 后端服务( server/index.js )提供，
// 发票页挂载时通过 store.loadInvoices() 从 /api/invoices 拉取。
