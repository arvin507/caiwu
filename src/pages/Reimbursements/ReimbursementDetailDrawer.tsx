import { useEffect, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Input,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { DollarOutlined, FileTextOutlined, LinkOutlined } from '@ant-design/icons'
import { useAppStore } from '@/store/useAppStore'
import type {
  Reimbursement,
  ReimbursementItem,
  ReimbursementLeg,
  ReimbursementStatus,
  InvoiceLink,
} from '@/types'
import { formatDate } from '@/utils/format'
import { openFilePreview } from '@/utils/openFilePreview'
import LinkInvoiceModal from './LinkInvoiceModal'
import BatchLinkInvoiceModal from './BatchLinkInvoiceModal'

const TYPE_LABEL: Record<string, string> = {
  travel: '差旅费',
  general: '一般费用',
}

const STATUS_META: Record<
  ReimbursementStatus,
  { color: string; label: string }
> = {
  draft: { color: 'default', label: '草稿' },
  submitted: { color: 'processing', label: '已提交' },
  approved: { color: 'success', label: '已通过' },
  rejected: { color: 'error', label: '已驳回' },
  paid: { color: 'blue', label: '已付款' },
}

function StatusTag({ status }: { status: ReimbursementStatus }) {
  const m = STATUS_META[status]
  return <Tag color={m.color}>{m.label}</Tag>
}

function money(v: string | number | null | undefined): string {
  const n = typeof v === 'number' ? v : Number(v ?? 0)
  return `¥${isNaN(n) ? '0.00' : n.toFixed(2)}`
}

interface Props {
  open: boolean
  reimbursement: Reimbursement | null
  /** 当前用户角色 */
  isAdmin: boolean
  /** 状态变更后通知父组件刷新列表 / 关闭抽屉 */
  onChanged: () => void
  onClose: () => void
}

/**
 * 报销单详情抽屉：展示解析出的结构化数据 + 核对提示 + 状态操作。
 *
 * 业务流程（与后端状态机对齐）：
 *  - 草稿(draft)：本人可「提交」——提交即代表核对无误
 *  - 已提交(submitted)：管理员可「通过 / 驳回（填原因）」
 *  - 已通过(approved)：管理员可「标记付款」
 *  - 任意状态本人或管理员可「删除」
 */
export default function ReimbursementDetailDrawer({
  open,
  reimbursement,
  isAdmin,
  onChanged,
  onClose,
}: Props) {
  const { message } = App.useApp()
  const token = useAppStore((s) => s.token)
  const [busy, setBusy] = useState<string | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  // 本地维护一份报销单数据：关联发票后后端返回最新整单，直接替换，无需重开抽屉
  const [reb, setReb] = useState<Reimbursement | null>(reimbursement)
  useEffect(() => {
    setReb(reimbursement)
  }, [reimbursement])

  // 关联发票操作的状态
  const [linkOpen, setLinkOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [linkLine, setLinkLine] = useState<{
    type: 'item' | 'leg'
    id: string
    invoiceId?: string | null
  } | null>(null)

  const openLink = (type: 'item' | 'leg', id: string) => {
    setLinkLine({ type, id })
    setLinkOpen(true)
  }

  // 解除某张发票与当前行的关联（仅删对应 InvoiceLink，不影响该发票的其它关联）
  const handleUnlink = async (type: 'item' | 'leg', lineId: string, invoiceId: string) => {
    try {
      const res = await fetch(`/api/reimbursements/${reb?.id}/link`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ lineType: type, lineId, invoiceId }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || '解除失败')
      }
      const updated = (await res.json()) as Reimbursement
      message.success('已解除关联')
      setReb(updated)
      onChanged()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '解除失败')
    }
  }

  const previewInvoice = async (invoiceId: string) => {
    try {
      await openFilePreview(`/api/invoices/${invoiceId}/file`, token)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '预览失败')
    }
  }

  // 渲染一行已关联的发票列表（支持 1:N：多张发票；N:1：allocatedAmount 分摊额）
  const renderLinkedInvoices = (
    line: { id: string; links?: InvoiceLink[] },
    type: 'item' | 'leg',
  ) => (
    <Space wrap size={[4, 4]} style={{ width: '100%' }} align="start">
      {(line.links ?? []).map((l) => (
        <Space size="small" key={l.id} wrap>
          <Tag color="success">
            {l.invoice?.invoiceType === 'train'
              ? `${l.invoice?.parsedData?.departureStation ?? ''}→${l.invoice?.parsedData?.arrivalStation ?? ''} ${l.invoice?.parsedData?.trainNo ?? ''}`.trim() ||
                (l.invoice?.invoiceNumber || l.invoice?.fileName || '火车票')
              : (l.invoice?.invoiceNumber || l.invoice?.fileName || '发票')}
            {l.allocatedAmount ? ` 分摊¥${l.allocatedAmount}` : ''}
          </Tag>
          <Button type="link" size="small" onClick={() => previewInvoice(l.invoiceId)}>
            查看
          </Button>
          <Popconfirm
            title="解除该发票与本行的关联？"
            onConfirm={() => handleUnlink(type, line.id, l.invoiceId)}
          >
            <Button type="link" size="small" danger>
              解除
            </Button>
          </Popconfirm>
        </Space>
      ))}
      <Button type="link" size="small" onClick={() => openLink(type, line.id)}>
        关联
      </Button>
    </Space>
  )

  const callStatus = async (action: string, reason?: string) => {
    if (!reb) return
    setBusy(action)
    try {
      const res = await fetch(`/api/reimbursements/${reb.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action, reason }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || '操作失败')
      }
      message.success('操作成功')
      setRejectOpen(false)
      setRejectReason('')
      onChanged()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async () => {
    if (!reb) return
    setBusy('delete')
    try {
      const res = await fetch(`/api/reimbursements/${reb.id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || '删除失败')
      }
      message.success('已删除')
      onChanged()
      onClose()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败')
    } finally {
      setBusy(null)
    }
  }

  // 行程段表格（仅差旅）
  const legColumns = [
    { title: '日期', dataIndex: 'legDate', key: 'legDate' },
    { title: '交通工具', dataIndex: 'transport', key: 'transport' },
    { title: '出发', dataIndex: 'fromStation', key: 'fromStation' },
    { title: '到达', dataIndex: 'toStation', key: 'toStation' },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      render: (v: string) => money(v),
    },
    { title: '单据', dataIndex: 'ticketCount', key: 'ticketCount' },
    {
      title: '发票',
      key: 'invoice',
      render: (_: unknown, r: ReimbursementLeg) => renderLinkedInvoices(r, 'leg'),
    },
  ]

  // 费用明细表格（两类都有）
  const itemColumns = [
    { title: '#', dataIndex: 'seq', key: 'seq', width: 48 },
    { title: '费用类型', dataIndex: 'category', key: 'category' },
    { title: '摘要', dataIndex: 'summary', key: 'summary' },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      render: (v: string) => money(v),
    },
    { title: '备注', dataIndex: 'note', key: 'note' },
    {
      title: '发票',
      key: 'invoice',
      render: (_: unknown, r: ReimbursementItem) => renderLinkedInvoices(r, 'item'),
    },
  ]

  return (
    <Drawer
      title="报销单详情 · 核对"
      width={640}
      open={open}
      onClose={onClose}
      extra={
        <Space>
          {reb?.storagePath ? (
            <Button
              onClick={async () => {
                try {
                  await openFilePreview(`/api/reimbursements/${reb.id}/file`, token)
                } catch (e) {
                  message.error(e instanceof Error ? e.message : '预览失败')
                }
              }}
            >
              查看原文件
            </Button>
          ) : null}
          <Button onClick={onClose}>关闭</Button>
        </Space>
      }
    >
      {!reb ? null : (
        <>
          <Space size="middle" style={{ marginBottom: 16 }}>
            <StatusTag status={reb.status} />
            <Tag>{TYPE_LABEL[reb.type]}</Tag>
          </Space>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="请核对以下系统解析结果，无误后提交即视为确认数据。"
          />

          <Card size="small" title="基本信息" style={{ marginBottom: 16 }}>
            <Descriptions column={2} size="small">
              <Descriptions.Item label="申请人">
                {reb.applicantName || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="部门">{reb.department || '—'}</Descriptions.Item>
              <Descriptions.Item label="项目">{reb.projectName || '—'}</Descriptions.Item>
              <Descriptions.Item label="申请日期">
                {reb.applyDate ? formatDate(reb.applyDate) : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="合计金额">
                <Typography.Text strong style={{ color: '#cf1322', fontSize: 16 }}>
                  {money(reb.totalAmount)}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="文件名">
                {reb.fileName || '—'}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {/* 差旅：出差信息 + 行程段 */}
          {reb.type === 'travel' && reb.trip ? (
            <>
              <Card size="small" title="出差信息" style={{ marginBottom: 16 }}>
                <Descriptions column={2} size="small">
                  <Descriptions.Item label="出差人">
                    {reb.trip.travelerName || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="人数">
                    {reb.trip.headcount ?? '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="起止时间">
                    {reb.trip.dateRangeText || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="起止地点">
                    {reb.trip.locationText || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="出差事由" span={2}>
                    {reb.trip.reason || '—'}
                  </Descriptions.Item>
                </Descriptions>
              </Card>

              <Card
                size="small"
                title="行程段"
                style={{ marginBottom: 16 }}
                styles={{ body: { padding: 0 } }}
              >
                <Table<ReimbursementLeg>
                  rowKey="id"
                  size="small"
                  pagination={false}
                  columns={legColumns}
                  dataSource={reb.legs ?? []}
                />
              </Card>
            </>
          ) : null}

          {/* 费用明细 */}
          <Card
            size="small"
            title={
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Space>
                  <FileTextOutlined />
                  费用明细
                </Space>
                <Button
                  size="small"
                  icon={<LinkOutlined />}
                  onClick={() => setBatchOpen(true)}
                >
                  批量关联发票
                </Button>
              </div>
            }
            styles={{ body: { padding: 0 } }}
          >
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              columns={itemColumns}
              dataSource={reb.items}
              summary={(rows) => {
              const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0)
              return (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={3}>
                    <strong>合计</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1}>
                    <strong>{money(total)}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} />
                </Table.Summary.Row>
              )
            }}
          />
          </Card>

          {reb.status === 'rejected' && reb.rejectReason ? (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: 16 }}
              message="驳回原因"
              description={reb.rejectReason}
            />
          ) : null}

          {/* 操作区：按状态 + 角色显示对应按钮 */}
          <div
            style={{
              marginTop: 24,
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
            }}
          >
            {reb.status === 'draft' ? (
              <Button
                type="primary"
                loading={busy === 'submit'}
                onClick={() => callStatus('submit')}
              >
                提交（确认无误）
              </Button>
            ) : null}

            {isAdmin && reb.status === 'submitted' ? (
              <>
                <Button
                  type="primary"
                  loading={busy === 'approve'}
                  onClick={() => callStatus('approve')}
                >
                  通过
                </Button>
                <Button
                  danger
                  loading={busy === 'reject'}
                  disabled={rejectOpen}
                  onClick={() => setRejectOpen(true)}
                >
                  驳回
                </Button>
              </>
            ) : null}

            {isAdmin && reb.status === 'approved' ? (
              <Button
                icon={<DollarOutlined />}
                loading={busy === 'paid'}
                onClick={() => callStatus('paid')}
              >
                标记付款
              </Button>
            ) : null}

            <Popconfirm
              title="删除报销单"
              description="删除后不可恢复，确定要删除吗？"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={handleDelete}
            >
              <Button danger loading={busy === 'delete'}>
                删除
              </Button>
            </Popconfirm>
          </div>

          {/* 驳回原因输入 */}
          {rejectOpen ? (
            <div style={{ marginTop: 16 }}>
              <Input.TextArea
                rows={3}
                placeholder="请填写驳回原因（必填）"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <div style={{ marginTop: 8, textAlign: 'right' }}>
                <Space>
                  <Button onClick={() => { setRejectOpen(false); setRejectReason('') }}>
                    取消
                  </Button>
                  <Button
                    danger
                    disabled={!rejectReason.trim()}
                    loading={busy === 'reject'}
                    onClick={() => callStatus('reject', rejectReason.trim())}
                  >
                    确认驳回
                  </Button>
                </Space>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* 关联发票弹窗 */}
      <LinkInvoiceModal
        open={linkOpen}
        reimbursementId={reb?.id ?? ''}
        applicantName={reb?.applicantName ?? ''}
        lineType={linkLine?.type ?? 'item'}
        lineId={linkLine?.id ?? ''}
        onClose={() => setLinkOpen(false)}
        onLinked={(updated) => {
          setReb(updated)
          onChanged()
        }}
      />

      <BatchLinkInvoiceModal
        open={batchOpen}
        reimbursementId={reb?.id ?? ''}
        applicantName={reb?.applicantName ?? ''}
        reimbursement={reb as Reimbursement}
        onClose={() => setBatchOpen(false)}
        onLinked={(updated) => {
          setReb(updated)
          onChanged()
        }}
      />
    </Drawer>
  )
}
