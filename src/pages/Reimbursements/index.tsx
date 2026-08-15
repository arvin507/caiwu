import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Popconfirm,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  FileTextOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { useAppStore } from '@/store/useAppStore'
import type {
  Reimbursement,
  ReimbursementItem,
  ReimbursementLeg,
  ReimbursementStatus,
  ReimbursementType,
} from '@/types'
import { formatDate } from '@/utils/format'
import dayjs from 'dayjs'
import { openFilePreview } from '@/utils/openFilePreview'
import UploadModal from './UploadModal'
import LinkInvoiceModal from './LinkInvoiceModal'
import UploadAndLinkModal from './UploadAndLinkModal'
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
  const [month, setMonth] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [active, setActive] = useState<Reimbursement | null>(null)
  // 多选批量删除：当前选中的行 id
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])

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

  const load = useCallback(
    async (month?: string | null): Promise<Reimbursement[]> => {
      setLoading(true)
      try {
        const qs = month ? `?month=${encodeURIComponent(month)}` : ''
        const res = await authFetch(`/api/reimbursements${qs}`)
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
    },
    [authFetch],
  )

  const openDetail = (reb: Reimbursement) => {
    setActive(reb)
    setDetailOpen(true)
  }

  // 详情里删除/状态变更后：刷新列表，并把抽屉当前条目同步为最新数据
  // （否则提交/审批后按钮还会停留旧状态）
  const handleChanged = useCallback(async () => {
    const data = await load(month)
    const id = activeRef.current?.id
    if (id) {
      const updated = data.find((r) => r.id === id)
      if (updated) setActive(updated)
    }
  }, [load, month])

  // 进入页面 / 切换月份筛选时拉取列表
  useEffect(() => {
    load(month)
  }, [load, month])

  // 关联发票后：用后端返回的最新整单就地替换对应行（展开区立即反映发票状态）
  const applyUpdated = useCallback((updated: Reimbursement) => {
    setRows((prev) =>
      prev.map((r) => (r.id === updated.id ? { ...updated, key: updated.id } : r)),
    )
    setActive((prev) => (prev?.id === updated.id ? updated : prev))
  }, [])

  // 关联发票弹窗状态
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkLine, setLinkLine] = useState<{
    type: 'item' | 'leg'
    id: string
    /** 当前行所属报销单 id：必须取「展开行对应的报销单」，不能用 active，否则会串到上次查看的报销单 */
    rebId: string
    applicantName: string
    invoiceId?: string | null
  } | null>(null)

  // 上传并自动关联弹窗状态（同样必须带 rebId，避免跨报销单串单）
  const [uploadLine, setUploadLine] = useState<{
    type: 'item' | 'leg'
    id: string
    rebId: string
    applicantName: string
  } | null>(null)

  const openLink = (
    type: 'item' | 'leg',
    id: string,
    rebId: string,
    applicantName: string,
  ) => {
    setLinkLine({ type, id, rebId, applicantName })
    setLinkOpen(true)
  }
  const openUpload = (
    type: 'item' | 'leg',
    id: string,
    rebId: string,
    applicantName: string,
  ) => {
    setUploadLine({ type, id, rebId, applicantName })
    setUploadOpen(true)
  }

  // 解除某张发票与行的关联（列表展开行用：单张发票旁的「解除」）
  const handleUnlink = async (type: 'item' | 'leg', lineId: string, invoiceId: string, rebId: string) => {
    try {
      const res = await authFetch(`/api/reimbursements/${rebId}/link`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineType: type, lineId, invoiceId }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || '解除失败')
      }
      const updated = (await res.json()) as Reimbursement
      msg.success('已解除关联')
      // 就地替换该报销单行，展开区立即反映
      setRows((prev) => prev.map((r) => (r.id === updated.id ? { ...updated, key: updated.id } : r)))
    } catch (e) {
      msg.error(e instanceof Error ? e.message : '解除失败')
    }
  }

  // 解除本行所有发票关联（行级「解除全部」）
  const handleUnlinkAll = async (type: 'item' | 'leg', lineId: string, links: { invoiceId: string }[], rebId: string) => {
    try {
      let latest: Reimbursement | null = null
      for (const l of links) {
        const res = await authFetch(`/api/reimbursements/${rebId}/link`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lineType: type, lineId, invoiceId: l.invoiceId }),
        })
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(err.error || '解除失败')
        }
        latest = (await res.json()) as Reimbursement
      }
      msg.success('已解除本行所有关联')
      if (latest) setRows((prev) => prev.map((r) => (r.id === latest!.id ? { ...latest!, key: latest!.id } : r)))
    } catch (e) {
      msg.error(e instanceof Error ? e.message : '解除失败')
    }
  }


  const previewInvoice = async (invoiceId: string) => {
    try {
      await openFilePreview(`/api/invoices/${invoiceId}/file`, token)
    } catch (e) {
      msg.error(e instanceof Error ? e.message : '预览失败')
    }
  }

  useEffect(() => {
    load(month)
  }, [load, month])

  // 批量删除：调 DELETE /api/reimbursements（body { ids }）
  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return
    try {
      const res = await authFetch('/api/reimbursements', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedRowKeys }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        deleted?: string[]
        skipped?: Array<{ id: string; reason: string }>
        error?: string
      }
      if (!res.ok) throw new Error(data.error || '批量删除失败')
      const deletedCount = data.deleted?.length ?? 0
      const skippedCount = data.skipped?.length ?? 0
      if (skippedCount > 0) {
        msg.warning(`已删除 ${deletedCount} 张，跳过 ${skippedCount} 张（无权限或不存在）`)
      } else {
        msg.success(`已删除 ${deletedCount} 张报销单`)
      }
      setSelectedRowKeys([])
      load(month)
    } catch (e) {
      msg.error(e instanceof Error ? e.message : '批量删除失败')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await authFetch(`/api/reimbursements/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || '删除失败')
      }
      msg.success('已删除')
      if (active?.id === id) setDetailOpen(false)
      load(month)
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
      title: '发票差额',
      key: 'invoiceShortfall',
      render: (_: unknown, row: Row) => {
        const short = rebShortfall(row)
        if (short <= 0) return <Typography.Text type="secondary">—</Typography.Text>
        return (
          <Typography.Text style={{ color: '#cf1322' }} strong>
            缺 {money(short)}
          </Typography.Text>
        )
      },
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

  // 单张发票行的报销金额：分摊额优先，否则取发票本身价税合计（一行多票场景）
  const invoiceAmount = (l: { allocatedAmount?: string | null; invoice?: { parsedData?: { totalAmount?: string | null } | null } | null }): string => {
    if (l.allocatedAmount) return money(l.allocatedAmount)
    const t = l.invoice?.parsedData?.totalAmount
    if (t != null && t !== '') return money(t)
    return '—'
  }
  const invoiceLabel = (l: { invoice?: { invoiceNumber?: string | null; fileName?: string | null; parsedData?: { departureStation?: string | null; arrivalStation?: string | null; trainNo?: string | null; invoiceType?: string } | null } | null }): string => {
    const inv = l.invoice
    if (!inv) return '发票'
    if (inv.parsedData?.invoiceType === 'train') {
      const trip = `${inv.parsedData?.departureStation ?? ''}→${inv.parsedData?.arrivalStation ?? ''} ${inv.parsedData?.trainNo ?? ''}`.trim()
      return trip || inv.invoiceNumber || inv.fileName || '火车票'
    }
    return inv.invoiceNumber || inv.fileName || '发票'
  }
  // 一行已关联发票的报销金额合计
  const lineLinkedTotal = (links?: { allocatedAmount?: string | null; invoice?: { parsedData?: { totalAmount?: string | null } | null } | null }[]): number =>
    (links ?? []).reduce((s, l) => {
      if (l.allocatedAmount) return s + Number(l.allocatedAmount)
      const t = l.invoice?.parsedData?.totalAmount
      return s + (t != null && t !== '' ? Number(t) : 0)
    }, 0)
  // 一行发票是否不足（差额 > 0.005 视为不足，规避浮点）
  const lineShortfall = (lineAmount: number, links?: { allocatedAmount?: string | null; invoice?: { parsedData?: { totalAmount?: string | null } | null } | null }[]): number => {
    const diff = lineAmount - lineLinkedTotal(links)
    return diff > 0.005 ? diff : 0
  }
  // 整单已挂发票合计（明细项 + 行程段 所有关联发票报销金额之和）
  const rebLinkedTotal = (r: Reimbursement): number => {
    const lines = [...(r.items ?? []), ...(r.legs ?? [])] as { links?: { allocatedAmount?: string | null; invoice?: { parsedData?: { totalAmount?: string | null } | null } | null }[] }[]
    return lines.reduce((s, ln) => s + lineLinkedTotal(ln.links), 0)
  }
  // 整单发票是否不足（差额 > 0.005 视为不足，规避浮点）
  const rebShortfall = (r: Reimbursement): number => {
    const diff = Number(r.totalAmount) - rebLinkedTotal(r)
    return diff > 0.005 ? diff : 0
  }

  // 展开行里「发票」单元格（明细项 / 行程段通用，按 lineType 区分）
  //  - 仅 1 张（或 0 张）：紧凑单行（标签 + 金额 同行）
  //  - 多张（1:N）：每条发票独立一行卡片，展示该发票报销金额
  // 行尾统一展示本行发票合计 / 差额（不足标红）
  const renderInvoiceCell = (
    line: { id: string; amount: string; links?: { id: string; invoiceId: string; invoice?: { invoiceNumber?: string | null; fileName?: string | null; parsedData?: { totalAmount?: string | null; invoiceType?: string; departureStation?: string | null; arrivalStation?: string | null; trainNo?: string | null } | null } | null; allocatedAmount?: string | null }[] },
    type: 'item' | 'leg',
    rebId: string,
    applicantName: string,
  ) => {
    const links = line.links ?? []
    const lineAmt = Number(line.amount || 0)
    const renderShortfall = () => {
      const short = lineShortfall(lineAmt, links)
      if (short <= 0) return null
      return (
        <div style={{ fontSize: 12, marginTop: 2 }}>
          <Typography.Text type="secondary">发票合计 {money(lineLinkedTotal(links))}</Typography.Text>
          <Typography.Text style={{ color: '#cf1322', marginLeft: 8 }}>差额 {money(short)}</Typography.Text>
        </div>
      )
    }
    if (links.length <= 1) {
      const l = links[0]
      return (
        <div>
          <Space size="small" wrap align="center">
            {l ? (
              <>
                <Tag color="success" style={{ marginRight: 0 }}>
                  {invoiceLabel(l)}
                </Tag>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {invoiceAmount(l)}
                </Typography.Text>
                <Button type="link" size="small" onClick={() => previewInvoice(l.invoiceId)}>
                  查看
                </Button>
                <Popconfirm
                  title="解除该发票与本行的关联？"
                  onConfirm={() => handleUnlink(type, line.id, l.invoiceId, rebId)}
                >
                  <Button type="link" size="small" danger>
                    解除
                  </Button>
                </Popconfirm>
              </>
            ) : null}
            <Button type="link" size="small" onClick={() => openUpload(type, line.id, rebId, applicantName)}>
              上传发票
            </Button>
            <Button type="link" size="small" onClick={() => openLink(type, line.id, rebId, applicantName)}>
              关联
            </Button>
          </Space>
          {renderShortfall()}
        </div>
      )
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
        {links.map((l) => (
          <div
            key={l.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '4px 8px',
              background: '#f6ffed',
              border: '1px solid #b7eb8f',
              borderRadius: 6,
            }}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <Tag color="success" style={{ marginRight: 6 }}>
                {invoiceLabel(l)}
              </Tag>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                发票金额 {invoiceAmount(l)}
              </Typography.Text>
            </span>
            <Space size="small" wrap>
              <Button type="link" size="small" onClick={() => previewInvoice(l.invoiceId)}>
                查看
              </Button>
            </Space>
          </div>
        ))}
        <Space size="small" wrap align="center" style={{ paddingLeft: 0 }}>
          <Button type="link" size="small" style={{ paddingLeft: 0 }} onClick={() => openUpload(type, line.id, rebId, applicantName)}>
            上传发票
          </Button>
          <Button type="link" size="small" onClick={() => openLink(type, line.id, rebId, applicantName)}>
            关联
          </Button>
          <Popconfirm
            title={`解除本行全部 ${links.length} 张发票关联？`}
            onConfirm={() => handleUnlinkAll(type, line.id, links, rebId)}
          >
            <Button type="link" size="small" danger>
              解除全部
            </Button>
          </Popconfirm>
        </Space>
        {renderShortfall()}
      </div>
    )
  }

  // 展开行：展示该报销单的明细。差旅展示「行程段 + 费用明细」，一般展示「费用明细」。
  const expandedRowRender = (row: Row): ReactNode => {
    if (row.type === 'travel') {
      return (
        <div style={{ paddingLeft: 32 }}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <div>
              <Typography.Text strong>行程段</Typography.Text>
              <Table<ReimbursementLeg>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={row.legs ?? []}
                columns={[
                  { title: '日期', dataIndex: 'legDate', key: 'legDate' },
                  { title: '交通工具', dataIndex: 'transport', key: 'transport' },
                  { title: '出发', dataIndex: 'fromStation', key: 'fromStation' },
                  { title: '到达', dataIndex: 'toStation', key: 'toStation' },
                  { title: '金额', dataIndex: 'amount', key: 'amount', render: (v: string) => money(v) },
                  { title: '单据', dataIndex: 'ticketCount', key: 'ticketCount' },
                  {
                    title: '发票',
                    key: 'invoice',
                    width: 260,
                    render: (_, r) => renderInvoiceCell(r, 'leg', row.id, row.applicantName),
                  },
                ]}
              />
            </div>
            <div>
              <Typography.Text strong>费用明细</Typography.Text>
              <Table<ReimbursementItem>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={row.items}
                columns={[
                  { title: '#', dataIndex: 'seq', key: 'seq', width: 48 },
                  { title: '费用类型', dataIndex: 'category', key: 'category' },
                  { title: '摘要', dataIndex: 'summary', key: 'summary' },
                  { title: '金额', dataIndex: 'amount', key: 'amount', render: (v: string) => money(v) },
                  {
                    title: '发票',
                    key: 'invoice',
                    width: 260,
                    render: (_, r) => renderInvoiceCell(r, 'item', row.id, row.applicantName),
                  },
                ]}
              />
            </div>
          </Space>
        </div>
      )
    }
    return (
      <Table<ReimbursementItem>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={row.items}
        columns={[
          { title: '#', dataIndex: 'seq', key: 'seq', width: 48 },
          { title: '费用类型', dataIndex: 'category', key: 'category' },
          { title: '摘要', dataIndex: 'summary', key: 'summary' },
          { title: '金额', dataIndex: 'amount', key: 'amount', render: (v: string) => money(v) },
          {
            title: '发票',
            key: 'invoice',
            render: (_, r) => renderInvoiceCell(r, 'item', row.id, row.applicantName),
          },
        ]}
      />
    )
  }

  // 顶部统计：按状态聚合
  const stats = {
    total: rows.length,
    draft: rows.filter((r) => r.status === 'draft').length,
    submitted: rows.filter((r) => r.status === 'submitted').length,
    done: rows.filter((r) => r.status === 'approved' || r.status === 'paid').length,
  }

  return (
    <div>
      {/* 页面标题 + 描述 + 主操作 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginBottom: 16,
        }}
      >
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            报销管理
          </Typography.Title>
          <Typography.Text type="secondary">
            上传报销单 Excel，系统自动解析并核对，关联发票后提交审批。
          </Typography.Text>
        </div>
        <Space>
          <DatePicker
            picker="month"
            placeholder="按月筛选(提交日期)"
            value={month ? dayjs(month) : null}
            onChange={(d) => setMonth(d ? d.format('YYYY-MM') : null)}
            allowClear
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setUploadOpen(true)}>
            上传报销单
          </Button>
        </Space>
      </div>

      {/* 状态统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card variant="borderless">
            <Statistic
              title="报销单总数"
              value={stats.total}
              prefix={<FileTextOutlined style={{ color: '#1677ff' }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card variant="borderless">
            <Statistic
              title="待提交"
              value={stats.draft}
              valueStyle={{ color: '#8c8c8c' }}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card variant="borderless">
            <Statistic
              title="待审批"
              value={stats.submitted}
              valueStyle={{ color: '#fa8c16' }}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card variant="borderless">
            <Statistic
              title="已通过 / 已付款"
              value={stats.done}
              valueStyle={{ color: '#52c41a' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>

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
            title={`确定删除选中的 ${selectedRowKeys.length} 张报销单？`}
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

      <Card
        title="报销单列表"
        variant="borderless"
        styles={{ body: { padding: 0 } }}
      >
        {rows.length === 0 && !loading ? (
          <Empty
            style={{ padding: '48px 0' }}
            description="还没有报销单，点击右上角「上传报销单」开始"
          >
            <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>
              上传第一张报销单
            </Button>
          </Empty>
        ) : (
          <Table<Row>
            rowKey="id"
            loading={loading}
            dataSource={rows}
            columns={columns}
            expandable={{ expandedRowRender }}
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys as string[]),
            }}
            pagination={{ pageSize: 10 }}
          />
        )}
      </Card>

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

      <LinkInvoiceModal
        open={linkOpen}
        reimbursementId={linkLine?.rebId ?? ''}
        applicantName={linkLine?.applicantName ?? ''}
        lineType={linkLine?.type ?? 'item'}
        lineId={linkLine?.id ?? ''}
        onClose={() => setLinkOpen(false)}
        onLinked={(updated) => {
          applyUpdated(updated)
          setLinkOpen(false)
        }}
      />

      <UploadAndLinkModal
        open={uploadOpen}
        reimbursementId={uploadLine?.rebId ?? ''}
        applicantName={uploadLine?.applicantName ?? ''}
        lineType={uploadLine?.type ?? 'item'}
        lineId={uploadLine?.id ?? ''}
        onClose={() => setUploadOpen(false)}
        onLinked={(updated) => {
          applyUpdated(updated)
          setUploadOpen(false)
        }}
      />
    </div>
  )
}
