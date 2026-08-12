import { useState } from 'react'
import { App as AntApp, Button, Card, Form, Input } from 'antd'
import { useAppStore } from '@/store/useAppStore'

/**
 * 修改密码（所有已登录用户可用）
 *
 * 调后端 /api/auth/change-password：先校验原密码，再写入新密码哈希。
 * 管理员和普通用户走的是同一个页面、同一个接口。
 */
export default function ChangePassword() {
  const { message } = AntApp.useApp()
  const changePassword = useAppStore((s) => s.changePassword)
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()

  const onFinish = async (values: {
    oldPassword: string
    newPassword: string
  }) => {
    setLoading(true)
    try {
      await changePassword(values.oldPassword, values.newPassword)
      message.success('密码已修改，请使用新密码登录')
      form.resetFields()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '修改失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card title="修改密码" style={{ maxWidth: 480 }}>
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item
          name="oldPassword"
          label="原密码"
          rules={[{ required: true, message: '请输入原密码' }]}
        >
          <Input.Password placeholder="当前密码" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '新密码至少 6 位' },
          ]}
        >
          <Input.Password placeholder="至少 6 位" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="确认新密码"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) {
                  return Promise.resolve()
                }
                return Promise.reject(new Error('两次输入的密码不一致'))
              },
            }),
          ]}
        >
          <Input.Password placeholder="再次输入新密码" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>
            确认修改
          </Button>
        </Form.Item>
      </Form>
    </Card>
  )
}
