import { Card, Col, Row, Statistic, Typography } from 'antd'
import { computeDashboardSummary, useAppStore } from '@/store/useAppStore'
import { formatCurrency } from '@/utils/format'

/**
 * 仪表盘：用 Statistic 卡片展示核心指标。
 * 数据全部来自 store，指标由 computeDashboardSummary 这个纯函数派生，
 * 所以「加一笔账单」后，这里会自动跟着变（store 变化 → 组件重渲染）。
 */
export default function Dashboard() {
  const transactions = useAppStore((s) => s.transactions)
  const accounts = useAppStore((s) => s.accounts)
  const symbol = useAppStore((s) => s.preferences.currencySymbol)

  const summary = computeDashboardSummary(transactions, accounts)

  return (
    <div>
      <Typography.Title level={3}>仪表盘</Typography.Title>
      <Row gutter={16}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="总资产"
              value={summary.totalBalance}
              formatter={(v) => formatCurrency(Number(v), symbol)}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="本月收入"
              value={summary.monthIncome}
              valueStyle={{ color: '#cf1322' }}
              formatter={(v) => formatCurrency(Number(v), symbol)}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="本月支出"
              value={summary.monthExpense}
              valueStyle={{ color: '#3f8600' }}
              formatter={(v) => formatCurrency(Number(v), symbol)}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="本月结余"
              value={summary.monthNet}
              valueStyle={{ color: summary.monthNet >= 0 ? '#cf1322' : '#3f8600' }}
              formatter={(v) => formatCurrency(Number(v), symbol)}
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
