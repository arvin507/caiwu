import { useMemo } from 'react'
import { Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { TRANSACTION_TYPE_LABEL } from '@/constants'
import { useAppStore } from '@/store/useAppStore'
import type { Transaction } from '@/types'
import { formatSignedCurrency } from '@/utils/format'

type Row = Transaction & { key: string; categoryName?: string; accountName?: string }

/**
 * 账单明细：用 antd Table 展示列表。
 * 重点演示：
 *  - 用 useMemo 把「分类/账户 id」映射成名字（派生数据，避免每次渲染重复计算）
 *  - 金额按收支用红/绿色区分（中国习惯：收红支绿）
 */
export default function Transactions() {
  const transactions = useAppStore((s) => s.transactions)
  const categories = useAppStore((s) => s.categories)
  const accounts = useAppStore((s) => s.accounts)
  const symbol = useAppStore((s) => s.preferences.currencySymbol)

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  )
  const accountMap = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a])),
    [accounts],
  )

  const rows: Row[] = transactions.map((t) => ({
    ...t,
    key: t.id,
    categoryName: categoryMap[t.categoryId]?.name,
    accountName: accountMap[t.accountId]?.name,
  }))

  const columns: ColumnsType<Row> = [
    { title: '日期', dataIndex: 'date', key: 'date' },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: Transaction['type']) => (
        <Tag color={type === 'income' ? 'red' : 'green'}>
          {TRANSACTION_TYPE_LABEL[type]}
        </Tag>
      ),
    },
    { title: '分类', dataIndex: 'categoryName', key: 'categoryName' },
    { title: '账户', dataIndex: 'accountName', key: 'accountName' },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      render: (amount: number, row) => (
        <span style={{ color: row.type === 'income' ? '#cf1322' : '#3f8600' }}>
          {formatSignedCurrency(row.type === 'income' ? amount : -amount, symbol)}
        </span>
      ),
    },
    { title: '备注', dataIndex: 'note', key: 'note' },
  ]

  return (
    <div>
      <Typography.Title level={3}>账单明细</Typography.Title>
      <Table<Row> rowKey="id" dataSource={rows} columns={columns} pagination={{ pageSize: 10 }} />
    </div>
  )
}
