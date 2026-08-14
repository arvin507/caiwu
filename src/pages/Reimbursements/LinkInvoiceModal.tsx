import { useEffect, useState } from 'react'
import { App, Button, Modal, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useAppStore } from '@/store/useAppStore'
import type { Invoice, Reimbursement } from '@/types'
import { formatDate } from '@/utils/format'
import { openFilePreview } from '@/utils/openFilePreview'

/** /api/invoices/linkable 返回的发票，带关联标注 */
type LinkableInvoice = Invoice & { linkedTo: { type: 'item' | 'leg'; id: string } | null }

interface Props {
  open: boolean
  /** 所属报销单 id（用于拼接口路径 /api/reimbursements/:id/link） */
  reimbursementId: string
  /** 当前要关联的是「费用项」还是「行程段」 */
  lineType: 'item' | 'leg'
  /** 当前行的 id */
  lineId: string
  onClose: () => void
  /** 关联/解除成功后，拿到后端返回的最新整单详情 */
  onLinked: (updated: Reimbursement) => void
}

function invoiceAmount(inv: Invoice): string {
  const v = inv.parsedData?.totalAmount
  const n = Number(v ?? 0)
  return v ? `¥${isNaN(n) ? '0.00' : n.toFixed(2)}` : '—'
}

export default function LinkInvoiceModal({
  open,
  reimbursementId,
  lineType,
  lineId,
  onClose,
  onLinked,
}: Props) {
  const { message } = App.useApp()
  const token = useAppStore((s) => s.token)

  const [list, setList] = useState<LinkableInvoice[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  // 打开时拉取可关联发票列表
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/invoices/linkable', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        if (!res.ok) throw new Error('加载发票列表失败')
        const data = (await res.json()) as LinkableInvoice[]
        if (!cancelled) setList(data)
      } catch (e) {
        if (!cancelled) message.error(e instanceof Error ? e.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, token, message])

  const doLink = async (invoiceId: string | null) => {
    setBusyId(invoiceId ?? 'unlink')
    try {
      const res = await fetch(`/api/reimbursements/${reimbursementId}/link`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ lineType, lineId, invoiceId }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || '操作失败')
      }
      const updated = (await res.json()) as Reimbursement
      message.success(invoiceId ? '已关联发票' : '已解除关联')
      onLinked(updated)
      onClose()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusyId(null)
    }
  }

  const columns: ColumnsType<LinkableInvoice> = [
    {
      title: '归属人',
      dataIndex: 'ownerName',
      key: 'ownerName',
      render: (v: string) => v || '—',
    },
    {
      title: '发票号码',
      dataIndex: 'invoiceNumber',
      key: 'invoiceNumber',
      render: (v: string | null) => v || '—',
    },
    {
      title: '开票日期',
      dataIndex: 'invoiceDate',
      key: 'invoiceDate',
      render: (d: string) => formatDate(d),
    },
    {
      title: '金额',
      key: 'amount',
      render: (_, inv) => invoiceAmount(inv),
    },
    {
      title: '状态',
      key: 'status',
      render: (_, inv) => {
        if (!inv.linkedTo) return <Tag>未关联</Tag>
        if (inv.linkedTo.id === lineId) return <Tag color="success">当前已关联</Tag>
        return <Tag color="warning">已关联其它行</Tag>
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_, inv) => {
        const isCurrent = inv.linkedTo?.id === lineId
        const isOther = !!inv.linkedTo && !isCurrent
        return (
          <Space size="small">
            <Button
              type="link"
              size="small"
              disabled={isOther || !!isCurrent}
              loading={busyId === inv.id}
              onClick={() => doLink(inv.id)}
            >
              关联
            </Button>
            <Button
              type="link"
              size="small"
              disabled={!inv.linkedTo}
              onClick={async () => {
                try {
                  await openFilePreview(`/api/invoices/${inv.id}/file`, token)
                } catch (e) {
                  message.error(e instanceof Error ? e.message : '预览失败')
                }
              }}
            >
              查看
            </Button>
            {isCurrent ? (
              <Button
                type="link"
                size="small"
                danger
                loading={busyId === 'unlink'}
                onClick={() => doLink(null)}
              >
                解除
              </Button>
            ) : null}
          </Space>
        )
      },
    },
  ]

  return (
    <Modal
      title="关联发票"
      open={open}
      onCancel={onClose}
      footer={null}
      width={760}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        每行（费用明细 / 行程段）可关联一张发票。已关联其它行的发票不可重复关联。
      </Typography.Paragraph>
      <Table<LinkableInvoice>
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={list}
        pagination={{ pageSize: 8 }}
      />
    </Modal>
  )
}
