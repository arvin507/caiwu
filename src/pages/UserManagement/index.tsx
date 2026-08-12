import { useEffect, useState } from 'react'
import {
  App as AntApp,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useAppStore } from '@/store/useAppStore'
import type { User, UserRole } from '@/types'

/**
 * 用户管理（仅超级管理员可见）
 *
 * - 列表展示所有账户（用户名 / 姓名 / 角色 / 创建时间）
 * - 超级管理员可创建「普通用户」账户（指定用户名、姓名、初始密码）
 * - 后端 /api/users 同时做强制校验：非管理员调用直接 403
 */
export default function UserManagement() {
  const { message } = AntApp.useApp()
  const fetchUsers = useAppStore((s) => s.fetchUsers)
  const addUser = useAppStore((s) => s.addUser)

  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      setUsers(await fetchUsers())
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const roleText: Record<UserRole, { text: string; color: string }> = {
    admin: { text: '超级管理员', color: 'gold' },
    user: { text: '普通用户', color: 'blue' },
  }

  const columns: ColumnsType<User> = [
    { title: '用户名', dataIndex: 'username' },
    { title: '姓名', dataIndex: 'name' },
    {
      title: '角色',
      dataIndex: 'role',
      render: (role: UserRole) => (
        <Tag color={roleText[role].color}>{roleText[role].text}</Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      render: (v: string) => new Date(v).toLocaleString(),
    },
  ]

  const handleAdd = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      await addUser(values)
      message.success('账户已创建')
      form.resetFields()
      setModalOpen(false)
      load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card
      title="用户管理"
      extra={
        <Button type="primary" onClick={() => setModalOpen(true)}>
          添加账户
        </Button>
      }
    >
      <Typography.Paragraph type="secondary">
        超级管理员可以创建「普通用户」账户；普通用户无法访问本页面。
      </Typography.Paragraph>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={users}
        pagination={false}
      />

      <Modal
        title="添加账户（普通用户）"
        open={modalOpen}
        onOk={handleAdd}
        confirmLoading={submitting}
        onCancel={() => setModalOpen(false)}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="username"
            label="登录用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="用于登录的账号" />
          </Form.Item>
          <Form.Item
            name="name"
            label="姓名"
            rules={[{ required: true, message: '请输入姓名' }]}
          >
            <Input placeholder="展示用姓名" />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[
              { required: true, message: '请输入初始密码' },
              { min: 6, message: '密码至少 6 位' },
            ]}
          >
            <Input.Password placeholder="至少 6 位，创建后请告知对方修改" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
