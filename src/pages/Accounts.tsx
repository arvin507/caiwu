import { Card, List, Typography } from 'antd'
import { ACCOUNT_TYPE_LABEL } from '@/constants'
import { useAppStore } from '@/store/useAppStore'
import { formatCurrency } from '@/utils/format'

/**
 * 账户管理：用 List 展示各账户及余额。
 * 余额正负用不同颜色（负数通常表示信用卡欠款）。
 */
export default function Accounts() {
  const accounts = useAppStore((s) => s.accounts)
  const symbol = useAppStore((s) => s.preferences.currencySymbol)

  return (
    <div>
      <Typography.Title level={3}>账户管理</Typography.Title>
      <List
        grid={{ gutter: 16, xs: 1, sm: 2, lg: 3 }}
        dataSource={accounts}
        renderItem={(a) => (
          <List.Item>
            <Card title={a.name}>
              <Typography.Text type="secondary">
                {ACCOUNT_TYPE_LABEL[a.type]}
              </Typography.Text>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  marginTop: 8,
                  color: a.balance >= 0 ? '#cf1322' : '#3f8600',
                }}
              >
                {formatCurrency(a.balance, symbol)}
              </div>
            </Card>
          </List.Item>
        )}
      />
    </div>
  )
}
