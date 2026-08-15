import { useEffect, useState } from 'react'
import { App, Button, Modal, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useAppStore } from '@/store/useAppStore'
import type { Invoice, Reimbursement } from '@/types'
import { formatDate } from '@/utils/format'
import { openFilePreview } from '@/utils/openFilePreview'
import { getPageSize, setPageSize, PAGE_SIZE_OPTIONS } from '@/utils/pageSize'

/** /api/invoices/linkable 返回的发票，带关联标注（支持 N:1，故 linkedTo 为数组） */
type LinkableInvoice = Invoice & {
  linkedTo: Array<{ type: 'item' | 'leg'; id: string; allocatedAmount?: number | null }>
}

interface Props {
  open: boolean
  /** 所属报销单 id（用于拼接口路径 /api/reimbursements/:id/link） */
  reimbursementId: string
  /** 当前报销单申请人，用于按归属人过滤可关联发票 */
  applicantName?: string
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

function isLinkedToCurrent(inv: LinkableInvoice, lineId: string): boolean {
  return inv.linkedTo.some((l) => l.id === lineId)
}

export default function LinkInvoiceModal({
  open,
  reimbursementId,
  applicantName,
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
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
  // 每页条数（受控，切换即刷新）
  const [pageSize, setLocalPageSize] = useState(getPageSize())

  // 打开时拉取可关联发票列表
  useEffect(() => {
    if (!open) return
    setSelectedRowKeys([])
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/invoices/linkable?reimbursementId=${reimbursementId}`, {
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

  // 关联选中（1:N：可一次选多张发票挂到当前行）
  const doLinkMany = async () => {
    if (selectedRowKeys.length === 0) return
    setBusyId('link')
    try {
      const res = await fetch(`/api/reimbursements/${reimbursementId}/link`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          lineType,
          lineId,
          links: selectedRowKeys.map((id) => ({ invoiceId: id })),
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || '关联失败')
      }
      const updated = (await res.json()) as Reimbursement
      message.success(`已关联 ${selectedRowKeys.length} 张发票`)
      setSelectedRowKeys([])
      onLinked(updated)
      onClose()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '关联失败')
    } finally {
      setBusyId(null)
    }
  }

  // 解除某张发票与当前行的关联（仅删该 InvoiceLink，不动其它关联）
  const doUnlink = async (invoiceId: string) => {
    setBusyId(invoiceId)
    try {
      const res = await fetch(`/api/reimbursements/${reimbursementId}/link`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ lineType, lineId, invoiceId }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || '解除失败')
      }
      const updated = (await res.json()) as Reimbursement
      message.success('已解除关联')
      onLinked(updated)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '解除失败')
    } finally {
      setBusyId(null)
    }
  }

  const columns: ColumnsType<LinkableInvoice> = [
    { title: '归属人', dataIndex: 'ownerName', key: 'ownerName', render: (v: string) => v || '—' },
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
    { title: '金额', key: 'amount', render: (_, inv) => invoiceAmount(inv) },
    {
      title: '状态',
      key: 'status',
      render: (_, inv) => {
        if (isLinkedToCurrent(inv, lineId)) return <Tag color="success">本行已关联</Tag>
        if (inv.linkedTo.length) return <Tag color="blue">已关联其它行</Tag>
        return <Tag>未关联</Tag>
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_, inv) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
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
          {isLinkedToCurrent(inv, lineId) ? (
            <Button
              type="link"
              size="small"
              danger
              loading={busyId === inv.id}
              onClick={() => doUnlink(inv.id)}
            >
              解除
            </Button>
          ) : null}
        </Space>
      ),
    },
  ]

  return (
    <Modal
      title="关联发票（可多选，支持一张行挂多张发票）"
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={busyId === 'link'}
            disabled={selectedRowKeys.length === 0}
            onClick={doLinkMany}
          >
            关联选中（{selectedRowKeys.length}）
          </Button>
        </Space>
      }
      width={760}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        仅显示归属人为「{applicantName || '—'}」的发票（申请人与发票归属须一致）。
        勾选一张或多张发票关联到当前行（1:N）。已关联其它行的发票（N:1）也可继续关联到此行，
        分摊金额请在「批量关联发票」弹窗里填写。
      </Typography.Paragraph>
      <Table<LinkableInvoice>
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={list}
        pagination={{
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: PAGE_SIZE_OPTIONS,
          onShowSizeChange: (_current, size) => {
            setLocalPageSize(size)
            setPageSize(size)
          },
        }}
        rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys as string[]) }}
      />
    </Modal>
  )
}
