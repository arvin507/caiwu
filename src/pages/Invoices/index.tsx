import { useEffect, useMemo, useState } from 'react'
import { Button, Empty, message, Popconfirm, Segmented, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { useAppStore } from '@/store/useAppStore'
import type { Invoice, InvoiceSortKey } from '@/types'
import { formatDate } from '@/utils/format'
import { openFilePreview } from '@/utils/openFilePreview'
import UploadModal from './UploadModal'
import InvoiceDetailDrawer from './InvoiceDetailDrawer'

type Row = Invoice & { key: string }

/**
 * 发票管理：列表展示 + 排序切换 + 空状态引导 + 上传入口。
 * 数据来自后端服务（Next.js，store.loadInvoices 拉取 /api/invoices）。
 */
export default function Invoices() {
  const invoices = useAppStore((s) => s.invoices)
  const loadInvoices = useAppStore((s) => s.loadInvoices)
  const deleteInvoice = useAppStore((s) => s.deleteInvoice)
  const deleteInvoices = useAppStore((s) => s.deleteInvoices)
  const token = useAppStore((s) => s.token)
  const [sortKey, setSortKey] = useState<InvoiceSortKey>('uploadedAt')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // 多选批量删除：当前选中的行 id
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])

  const openDetail = (inv: Invoice) => {
    setActiveInvoice(inv)
    setDetailOpen(true)
  }

  // 删除发票：调 store 删除，成功后若恰好是抽屉打开的那张就关掉抽屉
  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await deleteInvoice(id)
      message.success('已删除')
      if (activeInvoice?.id === id) setDetailOpen(false)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  // 批量删除：调 store.deleteInvoices（后端已关联报销单的会跳过）
  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return
    try {
      const { deleted, skipped } = await deleteInvoices(selectedRowKeys)
      if (skipped.length > 0) {
        message.warning(
          `已删除 ${deleted.length} 张，跳过 ${skipped.length} 张（已关联报销单或不存在）`,
        )
      } else {
        message.success(`已删除 ${deleted.length} 张发票`)
      }
      setSelectedRowKeys([])
    } catch (e) {
      message.error(e instanceof Error ? e.message : '批量删除失败')
    }
  }

  // 进入页面时从后端拉取发票列表
  useEffect(() => {
    loadInvoices()
  }, [loadInvoices])

  // 自动轮询：只要还有「解析中」的发票，每 2.5s 刷新一次列表。
  // 工程目前没有 WebSocket/SSE，用轮询模拟「响应式」——用户无需手动刷新，
  // 一旦全部解析完（无 pending）轮询自动停止。后续若需秒级推送可改 SSE。
  const hasPending = invoices.some((i) => i.parseStatus === 'pending')
  useEffect(() => {
    if (!hasPending) return
    const timer = setInterval(() => {
      loadInvoices()
    }, 2500)
    return () => clearInterval(timer)
  }, [hasPending, loadInvoices])

  // 排序：所选字段值大的排前面（最新上传 / 最晚发票日期），降序
  const rows: Row[] = useMemo(() => {
    const list = invoices.map((inv) => ({ ...inv, key: inv.id }))
    list.sort((a, b) =>
      a[sortKey] < b[sortKey] ? 1 : a[sortKey] > b[sortKey] ? -1 : 0,
    )
    return list
  }, [invoices, sortKey])

  const columns: ColumnsType<Row> = [
    { title: '归属人', dataIndex: 'ownerName', key: 'ownerName' },
    {
      title: '发票日期',
      dataIndex: 'invoiceDate',
      key: 'invoiceDate',
      render: (d: string) => formatDate(d),
    },
    { title: '文件名', dataIndex: 'fileName', key: 'fileName' },
    {
      title: '上传时间',
      dataIndex: 'uploadedAt',
      key: 'uploadedAt',
      render: (d: string) => formatDate(d),
    },
    {
      title: '预览',
      key: 'preview',
      render: (_, row) =>
        row.id ? (
          <a
            onClick={async () => {
              try {
                await openFilePreview(`/api/invoices/${row.id}/file`, token)
              } catch (e) {
                message.error(e instanceof Error ? e.message : '预览失败')
              }
            }}
          >
            查看
          </a>
        ) : (
          <Typography.Text type="secondary">无文件</Typography.Text>
        ),
    },
    {
      title: '解析状态',
      key: 'parseStatus',
      render: (_, row) => {
        if (row.parseStatus === 'done') return <Tag color="success">已完成</Tag>
        if (row.parseStatus === 'failed') return <Tag color="error">失败</Tag>
        if (row.parseStatus === 'pending') return <Tag color="processing">解析中</Tag>
        return <Tag>未解析</Tag>
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_, row) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => openDetail(row)}>
            核对
          </Button>
          <Popconfirm
            title="删除发票"
            description="删除后不可恢复，确定要删除吗？"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(row.id)}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deletingId === row.id}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
    { title: '备注', dataIndex: 'note', key: 'note' },
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
          发票管理
        </Typography.Title>
        <Space>
          <Segmented
            value={sortKey}
            onChange={(v) => setSortKey(v as InvoiceSortKey)}
            options={[
              { label: '最新上传', value: 'uploadedAt' },
              { label: '发票日期', value: 'invoiceDate' },
            ]}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setUploadOpen(true)}>
            上传发票
          </Button>
        </Space>
      </div>

      {rows.length === 0 ? (
        <Empty description="还没有发票，点击右上角「上传发票」存档第一张">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setUploadOpen(true)}>
            上传第一张发票
          </Button>
        </Empty>
      ) : (
        <Table<Row>
          rowKey="id"
          dataSource={rows}
          columns={columns}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys as string[]),
          }}
          pagination={{ pageSize: 10 }}
        />
      )}

      {/* 多选批量删除工具条：仅在选中项时出现 */}
      {selectedRowKeys.length > 0 ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 16,
            padding: '10px 16px',
            background: '#f0f5ff',
            borderRadius: 8,
          }}
        >
          <Typography.Text>已选 {selectedRowKeys.length} 项</Typography.Text>
          <Popconfirm
            title={`确定删除选中的 ${selectedRowKeys.length} 张发票？`}
            description="删除后不可恢复"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={handleBatchDelete}
          >
            <Button danger icon={<DeleteOutlined />}>
              批量删除
            </Button>
          </Popconfirm>
          <Button type="link" onClick={() => setSelectedRowKeys([])}>
            取消选择
          </Button>
        </div>
      ) : null}

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />

      <InvoiceDetailDrawer
        open={detailOpen}
        invoice={activeInvoice}
        onClose={() => setDetailOpen(false)}
      />
    </div>
  )
}
