import { useEffect, useMemo, useState } from 'react'
import { Button, Empty, Segmented, Space, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PlusOutlined } from '@ant-design/icons'
import { useAppStore } from '@/store/useAppStore'
import type { Invoice, InvoiceSortKey } from '@/types'
import { formatDate } from '@/utils/format'
import UploadModal from './UploadModal'

type Row = Invoice & { key: string }

/**
 * 发票管理：列表展示 + 排序切换 + 空状态引导 + 上传入口。
 * 数据来自后端服务（Next.js，store.loadInvoices 拉取 /api/invoices）。
 */
export default function Invoices() {
  const invoices = useAppStore((s) => s.invoices)
  const loadInvoices = useAppStore((s) => s.loadInvoices)
  const [sortKey, setSortKey] = useState<InvoiceSortKey>('uploadedAt')
  const [uploadOpen, setUploadOpen] = useState(false)

  // 进入页面时从后端拉取发票列表
  useEffect(() => {
    loadInvoices()
  }, [loadInvoices])

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
          <a href={`/api/invoices/${row.id}/file`} target="_blank" rel="noreferrer">
            查看
          </a>
        ) : (
          <Typography.Text type="secondary">无文件</Typography.Text>
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
          pagination={{ pageSize: 10 }}
        />
      )}

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  )
}
