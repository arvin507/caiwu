import { useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  type UploadFile,
  type UploadProps,
} from 'antd'
import { LinkOutlined, UploadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAppStore } from '@/store/useAppStore'
import type { Reimbursement } from '@/types'
import { openFilePreview } from '@/utils/openFilePreview'

const { TextArea } = Input

interface SelectedFile {
  uid: string
  name: string
  type: string
  file: File
}

interface AutoResult {
  linked: Array<{
    invoiceId: string
    invoiceNumber: string | null
    lineType: 'item' | 'leg'
    lineId: string
    amount: number
  }>
  unmatched: Array<{
    invoiceId: string
    invoiceNumber: string | null
    amount: number | null
    reason: 'parseFailed' | 'noMatch' | 'ambiguous' | 'occupied'
  }>
}

interface Props {
  open: boolean
  /** 所属报销单 id（拼接口路径用） */
  reimbursementId: string
  /** 发票归属人默认带报销单申请人 */
  applicantName: string
  /** 当前报销单详情（含 items/legs 带 invoice），用于构建人工关联的可选目标行 */
  reimbursement: Reimbursement
  onClose: () => void
  /** 任意一次（自动或手动）关联成功后，拿到后端返回的最新整单详情 */
  onLinked: (updated: Reimbursement) => void
}

function money(v: number | string | null | undefined): string {
  const n = typeof v === 'number' ? v : Number(v ?? 0)
  return `¥${isNaN(n) ? '0.00' : n.toFixed(2)}`
}

const REASON_LABEL: Record<AutoResult['unmatched'][number]['reason'], string> = {
  parseFailed: '发票金额解析失败，请手动核对',
  noMatch: '没有金额相等的明细行',
  ambiguous: '该金额对应多行明细，需人工选择',
  occupied: '该发票已关联到其他报销明细',
}

const MAX_SIZE_MB = 10

export default function BatchLinkInvoiceModal({
  open,
  reimbursementId,
  applicantName,
  reimbursement,
  onClose,
  onLinked,
}: Props) {
  const { message } = App.useApp()
  const token = useAppStore((s) => s.token)
  const addInvoices = useAppStore((s) => s.addInvoices)

  const [form] = Form.useForm()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [selected, setSelected] = useState<SelectedFile[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [autoResult, setAutoResult] = useState<AutoResult | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // 本单所有「尚未关联」的明细行，作为人工关联的可选项（关联后由父刷新重算）
  const candidateLines = useMemo(() => {
    const items = (reimbursement.items ?? [])
      .filter((i) => !i.invoiceId)
      .map((i) => ({
        type: 'item' as const,
        id: i.id,
        label: `费用 #${i.seq} ${i.category ?? ''} ${money(i.amount)}`.replace(/\s+/g, ' ').trim(),
      }))
    const legs = (reimbursement.legs ?? [])
      .filter((l) => !l.invoiceId)
      .map((l) => ({
        type: 'leg' as const,
        id: l.id,
        label: `行程 ${l.fromStation ?? ''}→${l.toStation ?? ''} ${money(l.amount)}`.replace(
          /\s+/g,
          ' ',
        ),
      }))
    return [...items, ...legs]
  }, [reimbursement])

  // 用行 id 反查可读描述（展示「已自动关联到哪一行」）
  const lineLabel = (type: 'item' | 'leg', id: string): string => {
    if (type === 'item') {
      const it = reimbursement.items?.find((i) => i.id === id)
      return it ? `费用 #${it.seq} ${it.category ?? ''}`.replace(/\s+/g, ' ').trim() : id
    }
    const lg = reimbursement.legs?.find((l) => l.id === id)
    return lg ? `行程 ${lg.fromStation ?? ''}→${lg.toStation ?? ''}`.replace(/\s+/g, ' ') : id
  }

  const reset = () => {
    form.resetFields()
    setFileList([])
    setSelected([])
    setAutoResult(null)
    setSubmitting(false)
    setBusyId(null)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleChange: UploadProps['onChange'] = (info) => {
    const next = info.fileList.filter((f) => f.status !== 'error')
    setFileList(next)
    const uids = new Set(next.map((f) => f.uid))
    setSelected((prev) => prev.filter((s) => uids.has(s.uid)))
  }

  const customRequest: UploadProps['customRequest'] = (options) => {
    const file = options.file as File & { uid: string }
    const isAllowed = file.type === 'application/pdf' || file.type.startsWith('image/')
    if (!isAllowed) {
      message.error('仅支持图片或 PDF 文件')
      options.onError?.(new Error('文件类型不支持'))
      return
    }
    const isLt10M = file.size / 1024 / 1024 < MAX_SIZE_MB
    if (!isLt10M) {
      message.error(`文件不能超过 ${MAX_SIZE_MB}MB`)
      options.onError?.(new Error('文件过大'))
      return
    }
    setSelected((prev) => [...prev, { uid: file.uid, name: file.name, type: file.type, file }])
    options.onSuccess?.({})
  }

  // 步骤一：批量上传发票 → 步骤二：触发自动金额匹配
  const handleUploadAndMatch = async (values: {
    ownerName: string
    invoiceDate: dayjs.Dayjs
    note?: string
  }) => {
    if (selected.length === 0) {
      message.error('请先至少选择一个发票文件')
      return
    }
    setSubmitting(true)
    try {
      const { created, skipped } = await addInvoices({
        ownerName: values.ownerName.trim(),
        invoiceDate: values.invoiceDate.format('YYYY-MM-DD'),
        files: selected.map((s) => s.file),
        note: values.note?.trim(),
      })
      if (skipped.length) {
        message.warning(`已跳过 ${skipped.length} 张重复发票（号码已存在）`)
      }
      if (created.length === 0) {
        message.error('没有新发票被上传（可能全部重复）')
        return
      }
      const res = await fetch(`/api/reimbursements/${reimbursementId}/auto-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ invoiceIds: created.map((c) => c.id) }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || '自动匹配失败')
      }
      const result = (await res.json()) as AutoResult
      setAutoResult(result)
      if (result.linked.length) message.success(`已自动关联 ${result.linked.length} 张发票`)
      if (result.unmatched.length) message.info(`${result.unmatched.length} 张需手动关联`)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '上传失败')
    } finally {
      setSubmitting(false)
    }
  }

  // 步骤三：待人工的发票，手动选定目标行后关联
  const doManualLink = async (
    invoiceId: string,
    lineType: 'item' | 'leg',
    lineId: string,
  ) => {
    setBusyId(invoiceId)
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
        throw new Error(err.error || '关联失败')
      }
      const updated = (await res.json()) as Reimbursement
      message.success('已关联发票')
      onLinked(updated) // 父刷新本单 → candidateLines 重算
      setAutoResult((prev) =>
        prev
          ? { ...prev, unmatched: prev.unmatched.filter((u) => u.invoiceId !== invoiceId) }
          : prev,
      )
    } catch (e) {
      message.error(e instanceof Error ? e.message : '关联失败')
    } finally {
      setBusyId(null)
    }
  }

  const linkedColumns = [
    { title: '发票号码', dataIndex: 'invoiceNumber', key: 'invoiceNumber', render: (v: string | null) => v || '—' },
    { title: '金额', dataIndex: 'amount', key: 'amount', render: (v: number) => money(v) },
    {
      title: '已自动关联到',
      key: 'line',
      render: (_: unknown, r: AutoResult['linked'][number]) => lineLabel(r.lineType, r.lineId),
    },
  ]

  const unmatchedColumns = [
    { title: '发票号码', dataIndex: 'invoiceNumber', key: 'invoiceNumber', render: (v: string | null) => v || '—' },
    { title: '金额', dataIndex: 'amount', key: 'amount', render: (v: number | null) => (v == null ? '—' : money(v)) },
    {
      title: '原因',
      dataIndex: 'reason',
      key: 'reason',
      render: (r: AutoResult['unmatched'][number]['reason']) => (
        <Tag color="warning">{REASON_LABEL[r]}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, r: AutoResult['unmatched'][number]) => (
        <Space size="small">
          <Select
            placeholder="选择明细行"
            style={{ width: 200 }}
            options={candidateLines.map((c) => ({ value: `${c.type}:${c.id}`, label: c.label }))}
            onSelect={(val: string) => {
              const [type, id] = val.split(':') as ['item' | 'leg', string]
              void doManualLink(r.invoiceId, type, id)
            }}
            disabled={candidateLines.length === 0}
            loading={busyId === r.invoiceId}
          />
          <Button
            type="link"
            size="small"
            onClick={async () => {
              try {
                await openFilePreview(`/api/invoices/${r.invoiceId}/file`, token)
              } catch (e) {
                message.error(e instanceof Error ? e.message : '预览失败')
              }
            }}
          >
            查看
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <Modal
      title="批量关联发票"
      open={open}
      onCancel={handleClose}
      footer={null}
      width={840}
      destroyOnClose
    >
      {!autoResult ? (
        <Form
          form={form}
          layout="vertical"
          initialValues={{ ownerName: applicantName, invoiceDate: dayjs() }}
          onFinish={handleUploadAndMatch}
        >
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            上传一批发票后，系统会按「价税合计」自动匹配到金额相等的报销明细行；
            金额不匹配或重复的发票会列出，由你手动关联。
          </Typography.Paragraph>
          <Form.Item
            label="归属人"
            name="ownerName"
            rules={[{ required: true, whitespace: true, message: '请填写发票归属人' }]}
          >
            <Input placeholder="这些发票是谁的（必填）" />
          </Form.Item>
          <Form.Item
            label="发票日期"
            name="invoiceDate"
            rules={[{ required: true, message: '请选择发票日期' }]}
          >
            <DatePicker style={{ width: '100%' }} placeholder="开票日期，默认今天" />
          </Form.Item>
          <Form.Item
            label="发票文件"
            required
            validateStatus={selected.length ? undefined : 'error'}
            help={selected.length ? undefined : '请选择发票文件（可多选，图片或 PDF）'}
          >
            <Upload
              accept="image/*,application/pdf"
              multiple
              fileList={fileList}
              customRequest={customRequest}
              onChange={handleChange}
            >
              <Button icon={<UploadOutlined />}>选择文件（可多选，图片或 PDF，≤{MAX_SIZE_MB}MB）</Button>
            </Upload>
          </Form.Item>
          <Form.Item label="备注" name="note">
            <TextArea rows={2} placeholder="可选" />
          </Form.Item>
          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={handleClose}>取消</Button>
              <Button type="primary" loading={submitting} onClick={() => form.submit()}>
                上传并自动匹配
              </Button>
            </Space>
          </div>
        </Form>
      ) : (
        <>
          <Alert
            type={autoResult.unmatched.length ? 'warning' : 'success'}
            showIcon
            style={{ marginBottom: 16 }}
            message={`已自动关联 ${autoResult.linked.length} 张，待人工关联 ${autoResult.unmatched.length} 张`}
          />

          <Card size="small" title="已自动关联" style={{ marginBottom: 16 }}>
            {autoResult.linked.length ? (
              <Table
                rowKey="invoiceId"
                size="small"
                pagination={false}
                columns={linkedColumns}
                dataSource={autoResult.linked}
              />
            ) : (
              <Typography.Text type="secondary">无</Typography.Text>
            )}
          </Card>

          <Card size="small" title="待人工关联">
            {autoResult.unmatched.length ? (
              <Table
                rowKey="invoiceId"
                size="small"
                pagination={false}
                columns={unmatchedColumns}
                dataSource={autoResult.unmatched}
              />
            ) : (
              <Typography.Text type="secondary">无，全部已关联完成 🎉</Typography.Text>
            )}
          </Card>

          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Space>
              <Button icon={<LinkOutlined />} onClick={() => setAutoResult(null)}>
                重新上传
              </Button>
              <Button type="primary" onClick={handleClose}>
                完成
              </Button>
            </Space>
          </div>
        </>
      )}
    </Modal>
  )
}
