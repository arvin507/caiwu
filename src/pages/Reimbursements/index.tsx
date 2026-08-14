import { useCallback, useEffect, useRef, useState } from 'react'
import {
  App,
  Button,
  Empty,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PlusOutlined } from '@ant-design/icons'
import { useAppStore } from '@/store/useAppStore'
import type { Reimbursement, ReimbursementStatus, ReimbursementType } from '@/types'
import { formatDate } from '@/utils/format'
import { openFilePreview } from '@/utils/openFilePreview'
import UploadModal from './UploadModal'
import ReimbursementDetailDrawer from './ReimbursementDetailDrawer'

const TYPE_LABEL: Record<ReimbursementType, string> = {
  travel: '差旅费',
  general: '一般费用',
}

const STATUS_META: Record<ReimbursementStatus, { color: string; label: string }> =
  {
    draft: { color: 'default', label: '草稿' },
    submitted: { color: 'processing', label: '已提交' },
    approved: { color: 'success', label: '已通过' },
    rejected: { color: 'error', label: '已驳回' },
    paid: { color: 'blue', label: '已付款' },
  }

function money(v: string | number | null | undefined): string {
  const n = typeof v === 'number' ? v : Number(v ?? 0)
  return `¥${isNaN(n) ? '0.00' : n.toFixed(2)}`
}

type Row = Reimbursement & { key: string }

/**
 * 报销管理：列表展示 + 上传入口 + 详情抽屉（核对/审批）。
 *
 * 数据来自后端 GET /api/reimbursements（admin 看全部，普通用户看自己；后端已过滤）。
 * 报销模块不进全局 store——只有本页使用，放在页面内 fetch 管理本地 state，避免 store 膨胀。
 */
export default function Reimbursements() {
  const { message: msg } = App.useApp()
  const token = useAppStore((s) => s.token)
  const currentUser = useAppStore((s) => s.currentUser)
  const isAdmin = currentUser?.role === 'admin'

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [active, setActive] = useState<Reimbursement | null>(null)

  // 用 ref 持有最新 active，避免在 load 回调闭包里拿到过期值
  const activeRef = useRef<Reimbursement | null>(null)
  activeRef.current = active

  const authFetch = useCallback(
    (url: string, init: RequestInit = {}) =>
      fetch(url, {
        ...init,
        headers: {
          ...(init.headers || {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }),
    [token],
  )

  const load = useCallback(async (): Promise<Reimbursement[]> => {
    setLoading(true)
    try {
      const res = await authFetch('/api/reimbursements')
      if (!res.ok) return []
      const data = (await res.json()) as Reimbursement[]
      setRows(data.map((r) => ({ ...r, key: r.id })))
      return data
    } catch {
      // 后端未启动：静默，列表保持空（空状态会引导启动服务）
      return []
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  const openDetail = (reb: Reimbursement) => {
    setActive(reb)
    setDetailOpen(true)
  }

  // 详情里删除/状态变更后：刷新列表，并把抽屉当前条目同步为最新数据
  // （否则提交/审批后按钮还会停留旧状态）
  const handleChanged = useCallback(async () => {
    const data = await load()
    const id = activeRef.current?.id
    if (id) {
      const updated = data.find((r) => r.id === id)
      if (updated) setActive(updated)
    }
  }, [load])

  useEffect(() => {
    load()
  }, [load])

  const handleDelete = async (id: string) => {
    try {
      const res = await authFetch(`/api/reimbursements/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || '删除失败')
      }
      msg.success('已删除')
      if (active?.id === id) setDetailOpen(false)
      load()
    } catch (e) {
      msg.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  const columns: ColumnsType<Row> = [
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (t: ReimbursementType) => <Tag>{TYPE_LABEL[t]}</Tag>,
    },
    { title: '申请人', dataIndex: 'applicantName', key: 'applicantName' },
    { title: '部门', dataIndex: 'department', key: 'department', render: (v) => v || '—' },
    { title: '项目', dataIndex: 'projectName', key: 'projectName', render: (v) => v || '—' },
    {
      title: '合计金额',
      dataIndex: 'totalAmount',
      key: 'totalAmount',
      render: (v: string) => <Typography.Text strong>{money(v)}</Typography.Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: ReimbursementStatus) => (
        <Tag color={STATUS_META[s].color}>{STATUS_META[s].label}</Tag>
      ),
    },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (d: string) => formatDate(d),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, row) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => openDetail(row)}>
            查看
          </Button>
          {row.storagePath ? (
            <Button
              type="link"
              size="small"
              onClick={async () => {
                try {
                  await openFilePreview(`/api/reimbursements/${row.id}/file`, token)
                } catch (e) {
                  msg.error(e instanceof Error ? e.message : '预览失败')
                }
              }}
            >
              预览
            </Button>
          ) : null}
          <Popconfirm
            title="删除报销单"
            description="删除后不可恢复，确定要删除吗？"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(row.id)}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Typography.Title level={3} style={{ margin: 0 }}>
          报销管理
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setUploadOpen(true)}>
          上传报销单
        </Button>
      </div>

      {rows.length === 0 && !loading ? (
        <Empty description="还没有报销单，点击右上角「上传报销单」开始">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setUploadOpen(true)}>
            上传第一张报销单
          </Button>
        </Empty>
      ) : (
        <Table<Row>
          rowKey="id"
          loading={loading}
          dataSource={rows}
          columns={columns}
          pagination={{ pageSize: 10 }}
        />
      )}

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={(reb) => {
          setUploadOpen(false)
          openDetail(reb)
        }}
      />

      <ReimbursementDetailDrawer
        open={detailOpen}
        reimbursement={active}
        isAdmin={!!isAdmin}
        onChanged={handleChanged}
        onClose={() => setDetailOpen(false)}
      />
    </div>
  )
}
