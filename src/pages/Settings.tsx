import { Card, Form, Segmented, Typography } from 'antd'
import { useAppStore } from '@/store/useAppStore'

/**
 * 系统设置：演示「状态驱动 UI」。
 * 切换主题会写入 Zustand store，App 根组件的 ConfigProvider 监听到变化后
 * 重新计算主题算法，整个系统配色立即改变 —— 无需手动操作 DOM。
 */
export default function Settings() {
  const themeMode = useAppStore((s) => s.preferences.themeMode)
  const setPreferences = useAppStore((s) => s.setPreferences)

  return (
    <div>
      <Typography.Title level={3}>系统设置</Typography.Title>
      <Card style={{ maxWidth: 480 }}>
        <Form layout="vertical">
          <Form.Item label="主题模式" tooltip="切换后全局配色立即生效">
            <Segmented
              value={themeMode}
              onChange={(v) => setPreferences({ themeMode: v as 'light' | 'dark' })}
              options={[
                { label: '浅色', value: 'light' },
                { label: '深色', value: 'dark' },
              ]}
            />
          </Form.Item>
        </Form>
        <Typography.Paragraph type="secondary">
          修改主题 → 写入 store → 根组件 ConfigProvider 重算主题算法 → 全局配色更新。
          这就是「单一数据源 + 状态驱动视图」的典型流程。
        </Typography.Paragraph>
      </Card>
    </div>
  )
}
