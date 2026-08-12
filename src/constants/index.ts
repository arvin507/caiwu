import type { AccountType, TransactionType } from '@/types'

/**
 * 常量集中管理「展示文案」与「枚举」的映射关系。
 * 好处：代码里只出现枚举值（'income'），界面上显示中文（'收入'），
 * 后续做 i18n 或改文案只动这里。
 */

export const TRANSACTION_TYPE_LABEL: Record<TransactionType, string> = {
  income: '收入',
  expense: '支出',
}

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  cash: '现金',
  bank: '银行卡',
  credit: '信用卡',
  ecommerce: '电子钱包',
  investment: '投资账户',
}
