import { Card, Empty, Typography } from 'antd'

/**
 * 统计报表：占位页。
 * 后续可接入图表库（如 @ant-design/charts / ECharts）展示收支趋势、分类占比等。
 */
export default function Reports() {
  return (
    <div>
      <Typography.Title level={3}>统计报表</Typography.Title>
      <Card>
        <Empty description="报表功能开发中：后续将展示收支趋势图、分类占比饼图等" />
      </Card>
    </div>
  )
}
