import { useState } from 'react'
import { Button, Card, Form, Input, Typography } from 'antd'
import { useAppStore } from '@/store/useAppStore'

/**
 * 登录页
 *
 * 演示模式：任意非空的用户名 / 密码即可登录（调用 store.login）。
 * 真实项目里，这里应把用户名密码发给后端，校验通过后再 login，
 * 并且通常会把后端返回的 token 存到 localStorage 做「刷新后保持登录」。
 */
export default function Login() {
  const login = useAppStore((s) => s.login)
  const [loading, setLoading] = useState(false)

  const onFinish = (values: { username: string; password: string }) => {
    setLoading(true)
    // 调用 store 的 login，把用户名记为当前用户
    login(values.username)
    // 登录成功后，App.tsx 的路由守卫会自动切到系统主页（无需手动跳转）
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f2f5',
      }}
    >
      <Card style={{ width: 360 }} variant="borderless">
        <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 4 }}>
          财务管理系统
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          请登录后使用
        </Typography.Paragraph>

        <Form
          name="login"
          size="large"
          initialValues={{ username: 'admin', password: '123456' }}
          onFinish={onFinish}
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="用户名" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password placeholder="密码" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 8 }}>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登录
            </Button>
          </Form.Item>
        </Form>

        <Typography.Paragraph
          type="secondary"
          style={{ textAlign: 'center', fontSize: 12, marginBottom: 0 }}
        >
          演示系统：任意用户名 / 密码即可登录
        </Typography.Paragraph>
      </Card>
    </div>
  )
}
