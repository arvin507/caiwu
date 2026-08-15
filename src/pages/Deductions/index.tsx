import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Key } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CheckSquareOutlined,
  CloseOutlined,
  ContainerOutlined,
  DownloadOutlined,
  EditOutlined,
  FileDoneOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { getPageSize, setPageSize, PAGE_SIZE_OPTIONS } from '@/utils/pageSize'
import type { DeductionRow, DeductionStatus, DeductionSummary } from '@/types'

const { Title, Text } = Typography

// 抵扣状态 → 展示文案 + 颜色
const STATUS_META: Record<DeductionStatus, { label: string; color: string }> = {
  unconfirmed: { label: '未勾选', color: 'default' },
  selected: { label: '已勾选', color: 'processing' },
  deducted: { label: '已抵扣', color: 'success' },
  transferred_out: { label: '进项转出', color: 'error' },
}
const STATUS_OPTIONS = (Object.keys(STATUS_META) as DeductionStatus[]).map((k) => ({
  value: k,
  label: STATUS_META[k].label,
}))

// 凭证类别 → 申报底稿《附列资料（二）》栏次（简表，覆盖本系统已支持的凭证）
function columnLabel(kind: string | null): string {
  if (!kind) return '其他扣税凭证'
  if (kind.includes('专用') || kind.includes('机动车')) return '一、认证相符的增值税专用发票（第35栏）'
  if (kind.includes('铁路电子客票')) return '一、认证相符的增值税专用发票（含铁路电子客票，第35栏）'
  if (kind.includes('通行费')) return '二、其他扣税凭证（通行费电子发票）'
  if (kind.includes('海关')) return '三、海关进口增值税专用缴款书'
  if (kind.includes('农产品')) return '四、农产品收购发票或者销售发票'
  if (kind.includes('普通')) return '（不可抵扣：增值税普通发票）'
  return '其他扣税凭证'
}

const money = (v: string | null | undefined) =>
  v != null && v !== '' ? `¥${v}` : '—'

type Row = DeductionRow & { key: string }

export default function Deductions() {
  const { message } = AntApp.useApp()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)

  // 台账筛选
  const [period, setPeriod] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [kind, setKind] = useState<string | null>(null)
  const [deductible, setDeductible] = useState<'all' | 'yes' | 'no'>('all')
  // 每页条数（受控，切换即刷新）
  const [pageSize, setLocalPageSize] = useState(getPageSize())

  // 标记弹窗
  const [markOpen, setMarkOpen] = useState(false)
  const [markTarget, setMarkTarget] = useState<DeductionRow | null>(null)
  const [markForm, setMarkForm] = useState<{ status: DeductionStatus; period: string | null; note: string }>({
    status: 'unconfirmed',
    period: null,
    note: '',
  })

  // 批量选择
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchForm, setBatchForm] = useState<{ status: DeductionStatus; period: string | null; note: string }>({
    status: 'selected',
    period: null,
    note: '',
  })

  // 申报底稿
  const [summary, setSummary] = useState<DeductionSummary | null>(null)
  const [summaryPeriod, setSummaryPeriod] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)

  const loadLedger = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (period) qs.set('period', period)
      if (status) qs.set('status', status)
      if (kind) qs.set('kind', kind)
      if (deductible === 'yes') qs.set('canDeduct', '1')
      else if (deductible === 'no') qs.set('canDeduct', '0')
      const res = await fetch(`/api/deductions?${qs.toString()}`)
      if (!res.ok) throw new Error('加载抵扣台账失败')
      const data = (await res.json()) as DeductionRow[]
      setRows(data.map((r) => ({ ...r, key: r.id })))
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [period, status, kind, deductible, message])

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      const qs = summaryPeriod ? `?period=${encodeURIComponent(summaryPeriod)}` : ''
      const res = await fetch(`/api/deductions/summary${qs}`)
      if (!res.ok) throw new Error('加载申报底稿失败')
      setSummary((await res.json()) as DeductionSummary)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setSummaryLoading(false)
    }
  }, [summaryPeriod, message])

  useEffect(() => {
    loadLedger()
  }, [loadLedger])

  // 凭证类别下拉选项（从当前数据派生）
  const kindOptions = useMemo(() => {
    const set = new Set<string>()
    rows.forEach((r) => r.voucherKind && set.add(r.voucherKind))
    return Array.from(set).map((k) => ({ value: k, label: k }))
  }, [rows])

  const recalc = async () => {
    try {
      const res = await fetch('/api/deductions', { method: 'POST' })
      if (!res.ok) throw new Error()
      const d = (await res.json()) as { recalced: number; failed: number }
      message.success(`已重算 ${d.recalced} 张${d.failed ? `，失败 ${d.failed} 张` : ''}`)
      await loadLedger()
    } catch {
      message.error('批量重算失败')
    }
  }

  const openMark = (row: DeductionRow) => {
    setMarkTarget(row)
    setMarkForm({
      status: row.status,
      period: row.declarePeriod,
      note: row.note ?? '',
    })
    setMarkOpen(true)
  }

  const submitMark = async () => {
    if (!markTarget) return
    try {
      const res = await fetch(`/api/deductions/${markTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: markForm.status,
          declarePeriod: markForm.period,
          note: markForm.note,
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || '保存失败')
      }
      message.success('已更新抵扣状态')
      setMarkOpen(false)
      await loadLedger()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    }
  }

  const openBatch = () => {
    setBatchForm({ status: 'selected', period: null, note: '' })
    setBatchOpen(true)
  }

  // 批量快捷：仅更新状态
  const batchQuick = async (status: DeductionStatus) => {
    const ids = [...selectedRowKeys]
    if (ids.length === 0) return
    try {
      const res = await fetch('/api/deductions/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, status }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || '批量操作失败')
      }
      const d = (await res.json()) as { updated: number; skipped: number }
      message.success(`已更新 ${d.updated} 项${d.skipped ? `，跳过 ${d.skipped} 项` : ''}`)
      setSelectedRowKeys([])
      await loadLedger()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '批量操作失败')
    }
  }

  // 批量详细设置：状态 + 所属期 + 备注
  const submitBatch = async () => {
    const ids = [...selectedRowKeys]
    if (ids.length === 0) return
    try {
      const res = await fetch('/api/deductions/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids,
          status: batchForm.status,
          declarePeriod: batchForm.period,
          note: batchForm.note,
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || '批量保存失败')
      }
      const d = (await res.json()) as { updated: number; skipped: number }
      message.success(`已更新 ${d.updated} 项${d.skipped ? `，跳过 ${d.skipped} 项` : ''}`)
      setBatchOpen(false)
      setSelectedRowKeys([])
      await loadLedger()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '批量保存失败')
    }
  }

  // 申报底稿导出 CSV（带 BOM，Excel 可直接打开）
  const exportCsv = () => {
    if (!summary) return
    const header = ['栏次', '凭证类别', '份数', '不含税金额', '可抵扣进项税额']
    const lines = summary.groups.map((g) => [
      columnLabel(g.voucherKind),
      g.voucherKind,
      String(g.count),
      g.taxExclusiveAmount,
      g.deductibleTax,
    ])
    lines.push(['合计', '', '', summary.totalExclusiveAmount, summary.totalDeductibleTax])
    const csv = [header, ...lines]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `进项抵扣申报底稿${summary.period ? '_' + summary.period : ''}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: Key[]) => setSelectedRowKeys(keys as string[]),
    preserveSelectedRowKeys: true,
  }

  const ledgerColumns: ColumnsType<Row> = [
    {
      title: '发票号码',
      dataIndex: ['invoice', 'invoiceNumber'],
      key: 'invoiceNumber',
      render: (v: string | null) => v ?? <Text type="secondary">—</Text>,
    },
    {
      title: '凭证类别',
      dataIndex: 'voucherKind',
      key: 'voucherKind',
      render: (v: string | null, row) =>
        row.canDeduct ? (
          <Tag color="blue">{v ?? '其他'}</Tag>
        ) : (
          <Tooltip title="增值税普通发票等不可抵扣凭证">
            <Tag>{v ?? '其他'}</Tag>
          </Tooltip>
        ),
    },
    {
      title: '税率',
      dataIndex: 'taxRate',
      key: 'taxRate',
      render: (v: string | null) => (v ? `${(Number(v) * 100).toFixed(0)}%` : '—'),
    },
    {
      title: '不含税金额',
      dataIndex: 'taxExclusiveAmount',
      key: 'taxExclusiveAmount',
      render: (v: string | null) => money(v),
    },
    {
      title: '可抵扣税额',
      dataIndex: 'deductibleTax',
      key: 'deductibleTax',
      render: (v: string | null, row) =>
        row.canDeduct ? (
          <Text strong>{money(v)}</Text>
        ) : (
          <Text type="secondary">不可抵</Text>
        ),
    },
    {
      title: '购买方/销售方',
      key: 'party',
      render: (_, row) => {
        const pd = row.invoice.parsedData
        const name =
          row.invoice.invoiceType === 'train'
            ? pd?.departureStation && pd?.arrivalStation
              ? `${pd.departureStation} → ${pd.arrivalStation}`
              : pd?.sellerName
            : pd?.sellerName
        return name ?? <Text type="secondary">—</Text>
      },
    },
    {
      title: '勾选状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: DeductionStatus) => <Tag color={STATUS_META[s].color}>{STATUS_META[s].label}</Tag>,
    },
    {
      title: '申报所属期',
      dataIndex: 'declarePeriod',
      key: 'declarePeriod',
      render: (v: string | null) => v ?? <Text type="secondary">未设</Text>,
    },
    {
      title: '关联',
      key: 'linked',
      render: (_, row) =>
        row.invoice.linkedCount > 0 ? (
          <Tag color="success">已关联{row.invoice.linkedCount}</Tag>
        ) : (
          <Tag>未关联</Tag>
        ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => openMark(row)}>
          标记
        </Button>
      ),
    },
  ]

  const summaryColumns: ColumnsType<DeductionSummary['groups'][number]> = [
    { title: '栏次（附列资料二）', key: 'col', render: (_, r) => columnLabel(r.voucherKind) },
    { title: '凭证类别', dataIndex: 'voucherKind', key: 'voucherKind' },
    { title: '份数', dataIndex: 'count', key: 'count' },
    {
      title: '不含税金额',
      dataIndex: 'taxExclusiveAmount',
      key: 'taxExclusiveAmount',
      render: (v: string) => `¥${v}`,
    },
    {
      title: '可抵扣进项税额',
      dataIndex: 'deductibleTax',
      key: 'deductibleTax',
      render: (v: string) => <Text strong>¥{v}</Text>,
    },
  ]

  return (
    <div>
      <Title level={3} style={{ margin: 0 }}>
        进项抵扣
      </Title>
      <Text type="secondary">
        系统做「进项抵扣台账 + 申报底稿」：勾选动作仍在税务数字账户完成，这里记录状态并汇总。
      </Text>

      <Tabs
        defaultActiveKey="ledger"
        style={{ marginTop: 16 }}
        items={[
          {
            key: 'ledger',
            label: (
              <span>
                <FileDoneOutlined /> 抵扣台账
              </span>
            ),
            children: (
              <Card>
                <Space wrap style={{ marginBottom: 16 }}>
                  <DatePicker
                    picker="month"
                    placeholder="申报所属期"
                    value={period ? dayjs(period) : null}
                    onChange={(d) => setPeriod(d ? d.format('YYYY-MM') : null)}
                    allowClear
                  />
                  <Select
                    placeholder="勾选状态"
                    style={{ width: 140 }}
                    allowClear
                    value={status}
                    onChange={setStatus}
                    options={STATUS_OPTIONS}
                  />
                  <Select
                    placeholder="凭证类别"
                    style={{ minWidth: 180 }}
                    allowClear
                    value={kind}
                    onChange={setKind}
                    options={kindOptions}
                  />
                  <Select
                    placeholder="是否可抵扣"
                    style={{ width: 140 }}
                    allowClear
                    value={deductible === 'all' ? undefined : deductible}
                    onChange={(v) => setDeductible(v ?? 'all')}
                    options={[
                      { value: 'yes', label: '可抵扣' },
                      { value: 'no', label: '不可抵扣' },
                    ]}
                  />
                  <Button icon={<ReloadOutlined />} onClick={recalc}>
                    批量重算
                  </Button>
                  <Button onClick={loadLedger}>刷新</Button>
                </Space>

                {selectedRowKeys.length > 0 && (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message={
                      <Space wrap size="small">
                        <CheckSquareOutlined />
                        <Text strong>已选 {selectedRowKeys.length} 项</Text>
                        <Text type="secondary">快捷：</Text>
                        <Button size="small" onClick={() => batchQuick('selected')}>
                          标记已勾选
                        </Button>
                        <Button size="small" onClick={() => batchQuick('deducted')}>
                          标记已抵扣
                        </Button>
                        <Button size="small" danger onClick={() => batchQuick('transferred_out')}>
                          进项转出
                        </Button>
                        <Button size="small" onClick={() => batchQuick('unconfirmed')}>
                          重置未勾选
                        </Button>
                        <Button size="small" icon={<EditOutlined />} onClick={openBatch}>
                          详细设置…
                        </Button>
                        <Button
                          size="small"
                          type="text"
                          icon={<CloseOutlined />}
                          onClick={() => setSelectedRowKeys([])}
                        >
                          取消选择
                        </Button>
                      </Space>
                    }
                  />
                )}

                <Table<Row>
                  rowKey="id"
                  dataSource={rows}
                  columns={ledgerColumns}
                  loading={loading}
                  scroll={{ x: 'max-content' }}
                  pagination={{
                    pageSize,
                    showSizeChanger: true,
                    pageSizeOptions: PAGE_SIZE_OPTIONS,
                    onShowSizeChange: (_current, size) => {
                      setLocalPageSize(size)
                      setPageSize(size)
                    },
                  }}
                  rowSelection={rowSelection}
                />

                <Modal
                  title="标记抵扣状态"
                  open={markOpen}
                  onOk={submitMark}
                  onCancel={() => setMarkOpen(false)}
                  okText="保存"
                  cancelText="取消"
                >
                  {markTarget && (
                    <Space direction="vertical" style={{ width: '100%' }} size="middle">
                      <div>
                        <Text type="secondary">发票号码：</Text>
                        {markTarget.invoice.invoiceNumber ?? '—'}
                      </div>
                      <div>
                        <Text type="secondary">凭证类别：</Text>
                        {markTarget.voucherKind ?? '—'}
                        {!markTarget.canDeduct && (
                          <Tag style={{ marginLeft: 8 }}>不可抵扣</Tag>
                        )}
                      </div>
                      <div>
                        <Text>勾选状态</Text>
                        <Select
                          style={{ width: '100%', marginTop: 4 }}
                          value={markForm.status}
                          onChange={(v) => setMarkForm((f) => ({ ...f, status: v }))}
                          options={STATUS_OPTIONS}
                        />
                      </div>
                      <div>
                        <Text>申报所属期</Text>
                        <DatePicker
                          picker="month"
                          style={{ width: '100%', marginTop: 4 }}
                          value={markForm.period ? dayjs(markForm.period) : null}
                          onChange={(d) =>
                            setMarkForm((f) => ({ ...f, period: d ? d.format('YYYY-MM') : null }))
                          }
                          allowClear
                        />
                      </div>
                      <Input.TextArea
                        placeholder="备注（如进项转出原因）"
                        value={markForm.note}
                        onChange={(e) => setMarkForm((f) => ({ ...f, note: e.target.value }))}
                      />
                    </Space>
                  )}
                </Modal>

                <Modal
                  title={`批量标记抵扣状态（${selectedRowKeys.length} 项）`}
                  open={batchOpen}
                  onOk={submitBatch}
                  onCancel={() => setBatchOpen(false)}
                  okText="批量保存"
                  cancelText="取消"
                >
                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <div>
                      <Text>勾选状态</Text>
                      <Select
                        style={{ width: '100%', marginTop: 4 }}
                        value={batchForm.status}
                        onChange={(v) => setBatchForm((f) => ({ ...f, status: v }))}
                        options={STATUS_OPTIONS}
                      />
                    </div>
                    <div>
                      <Text>申报所属期</Text>
                      <DatePicker
                        picker="month"
                        style={{ width: '100%', marginTop: 4 }}
                        value={batchForm.period ? dayjs(batchForm.period) : null}
                        onChange={(d) =>
                          setBatchForm((f) => ({ ...f, period: d ? d.format('YYYY-MM') : null }))
                        }
                        allowClear
                      />
                    </div>
                    <Input.TextArea
                      placeholder="备注（如进项转出原因，将写入全部选中项）"
                      value={batchForm.note}
                      onChange={(e) => setBatchForm((f) => ({ ...f, note: e.target.value }))}
                    />
                  </Space>
                </Modal>
              </Card>
            ),
          },
          {
            key: 'summary',
            label: (
              <span>
                <ContainerOutlined /> 申报底稿
              </span>
            ),
            children: (
              <Card>
                <Space wrap style={{ marginBottom: 16 }}>
                  <DatePicker
                    picker="month"
                    placeholder="按申报所属期汇总（不选则全部可抵扣）"
                    value={summaryPeriod ? dayjs(summaryPeriod) : null}
                    onChange={(d) => setSummaryPeriod(d ? d.format('YYYY-MM') : null)}
                    allowClear
                  />
                  <Button onClick={loadSummary} loading={summaryLoading}>
                    汇总
                  </Button>
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    onClick={exportCsv}
                    disabled={!summary}
                  >
                    导出 CSV
                  </Button>
                </Space>

                {summary ? (
                  <>
                    <Table<DeductionSummary['groups'][number]>
                      rowKey="voucherKind"
                      dataSource={summary.groups}
                      columns={summaryColumns}
                      pagination={false}
                      summary={(pageData) => {
                        const tExcl = pageData.reduce((s, r) => s + Number(r.taxExclusiveAmount), 0)
                        const tTax = pageData.reduce((s, r) => s + Number(r.deductibleTax), 0)
                        return (
                          <Table.Summary.Row>
                            <Table.Summary.Cell index={0}>
                              <Text strong>合计</Text>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={1} />
                            <Table.Summary.Cell index={2} />
                            <Table.Summary.Cell index={3}>
                              <Text strong>¥{tExcl.toFixed(2)}</Text>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={4}>
                              <Text strong>¥{tTax.toFixed(2)}</Text>
                            </Table.Summary.Cell>
                          </Table.Summary.Row>
                        )
                      }}
                    />
                    <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
                      可抵扣进项税额合计：<Text strong>¥{summary.totalDeductibleTax}</Text>
                      （对应《增值税及附加税费申报表附列资料（二）》相关栏次）
                    </Text>
                  </>
                ) : (
                  <Empty description="选择所属期后点击「汇总」" />
                )}
              </Card>
            ),
          },
        ]}
      />
    </div>
  )
}
