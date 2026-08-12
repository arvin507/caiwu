import { useState } from 'react'
import { Button, Card, Form, Input, Typography, App as AntApp } from 'antd'
import { useAppStore } from '@/store/useAppStore'

/**
 * 登录页
 *
 * 现在对接真实后端：把用户名/密码发给 /api/auth/login，
 * 校验通过后由 store.login 保存 JWT token 与用户信息（含角色），
 * 并把 token 存入 localStorage，刷新页面后仍能保持登录。
 */
export default function Login() {
  const login = useAppStore((s) => s.login)
  const { message } = AntApp.useApp()
  const [loading, setLoading] = useState(false)

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true)
    try {
      await login(values.username, values.password)
      // 登录成功：App 的路由守卫会自动切到系统主页，无需手动跳转
    } catch (e) {
      message.error(e instanceof Error ? e.message : '登录失败')
    } finally {
      setLoading(false)
    }
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
          默认管理员：admin / 123456（登录后请尽快修改密码）
        </Typography.Paragraph>
      </Card>
    </div>
  )
}
