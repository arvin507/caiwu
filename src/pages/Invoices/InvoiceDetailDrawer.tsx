import { useEffect, useState } from 'react'
import { Alert, App, Button, Collapse, Drawer, Input, Space, Tag, Typography } from 'antd'
import { useAppStore } from '@/store/useAppStore'
import type { Invoice, InvoiceParsedData } from '@/types'
import { openFilePreview } from '@/utils/openFilePreview'

/** 增值税专/普票：可手动核对的字段（不含 rawText，原文只读展示） */
const VAT_FIELDS: { key: keyof InvoiceParsedData; label: string }[] = [
  { key: 'invoiceCode', label: '发票代码' },
  { key: 'invoiceNumber', label: '发票号码' },
  { key: 'invoiceDate', label: '开票日期' },
  { key: 'sellerName', label: '销售方名称' },
  { key: 'sellerTaxId', label: '纳税人识别号' },
  { key: 'buyerName', label: '购买方名称' },
  { key: 'amount', label: '金额' },
  { key: 'taxAmount', label: '税额' },
  { key: 'totalAmount', label: '价税合计' },
]

/** 火车票（铁路电子客票）：行程相关字段 */
const TRAIN_FIELDS: { key: keyof InvoiceParsedData; label: string }[] = [
  { key: 'invoiceNumber', label: '发票号码' },
  { key: 'invoiceDate', label: '开票日期' },
  { key: 'passengerName', label: '乘车人' },
  { key: 'departureStation', label: '出发站' },
  { key: 'arrivalStation', label: '到达站' },
  { key: 'trainNo', label: '车次' },
  { key: 'departureDateTime', label: '乘车日期/时间' },
  { key: 'carSeatNo', label: '车厢/座位' },
  { key: 'seatClass', label: '席别' },
  { key: 'totalAmount', label: '票价' },
  { key: 'buyerName', label: '购买方名称' },
  { key: 'sellerTaxId', label: '统一社会信用代码' },
  { key: 'electronicTicketNo', label: '电子客票号' },
  { key: 'idNo', label: '身份证号' },
  { key: 'ticketNote', label: '改签/退票' },
]

function StatusTag({ status }: { status?: string }) {
  if (status === 'done') return <Tag color="success">已完成</Tag>
  if (status === 'failed') return <Tag color="error">失败</Tag>
  return <Tag color="processing">解析中</Tag>
}

interface Props {
  open: boolean
  invoice: Invoice | null
  onClose: () => void
}

/**
 * 发票解析结果 + 人工核对抽屉。
 *
 * - 展示解析状态、原始文件预览链接
 * - 解析失败时给出提示，并允许「手动填写后保存」（图片类发票本地解析不了，正是这个入口）
 * - 字段可编辑，保存走 PATCH /api/invoices/:id 写回 parsedData，状态置 done
 */
export default function InvoiceDetailDrawer({ open, invoice, onClose }: Props) {
  const { message } = App.useApp()
  const updateInvoice = useAppStore((s) => s.updateInvoice)
  const token = useAppStore((s) => s.token)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // 打开 / 切换发票时，用后端返回的 parsedData 初始化可编辑字段
  useEffect(() => {
    if (!open || !invoice?.parsedData) {
      setFields({})
      return
    }
    const pd = invoice.parsedData
    const active = invoice.invoiceType === 'train' ? TRAIN_FIELDS : VAT_FIELDS
    const next: Record<string, string> = {}
    for (const f of active) next[f.key] = (pd[f.key] as string) ?? ''
    next.rawText = pd.rawText ?? ''
    setFields(next)
  }, [open, invoice])

  const handleSave = async () => {
    if (!invoice) return
    setSaving(true)
    try {
      const active = invoice.invoiceType === 'train' ? TRAIN_FIELDS : VAT_FIELDS
      const parsedData: Record<string, unknown> = { rawText: fields.rawText ?? '' }
      for (const f of active) parsedData[f.key] = fields[f.key] ? fields[f.key] : null
      await updateInvoice(invoice.id, { parsedData, parseStatus: 'done' })
      message.success('核对已保存')
      onClose()
    } catch (e) {
      message.error(`保存失败：${e instanceof Error ? e.message : '未知错误'}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      title="发票解析结果 · 人工核对"
      width={480}
      open={open}
      onClose={onClose}
      extra={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button type="primary" loading={saving} onClick={handleSave}>
            保存核对
          </Button>
        </Space>
      }
    >
      {!invoice ? null : (
        <>
          <Space size="middle" style={{ marginBottom: 16 }}>
            <StatusTag status={invoice.parseStatus} />
            <a
              onClick={async () => {
                try {
                  await openFilePreview(`/api/invoices/${invoice.id}/file`, token)
                } catch (e) {
                  message.error(e instanceof Error ? e.message : '预览失败')
                }
              }}
            >
              查看原始文件
            </a>
          </Space>

          {invoice.parseStatus === 'failed' && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="本地解析失败"
              description={
                <>
                  原因：{invoice.parseError || '未知'}。
                  <br />
                  图片类发票本地无法识别，请在下方手动填写关键信息后「保存核对」。
                </>
              }
            />
          )}

          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            本地解析（PDF/OFD 文本抽取 + 正则）偶有偏差，请核对后保存。
          </Typography.Paragraph>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {(invoice.invoiceType === 'train' ? TRAIN_FIELDS : VAT_FIELDS).map((f) => (
              <div key={f.key}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {f.label}
                </Typography.Text>
                <Input
                  value={fields[f.key] ?? ''}
                  placeholder={f.label}
                  onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          {fields.rawText ? (
            <Collapse style={{ marginTop: 16 }} items={[
              {
                key: 'raw',
                label: '原文（只读，供核对）',
                children: (
                  <Input.TextArea value={fields.rawText} autoSize={{ minRows: 4, maxRows: 12 }} readOnly />
                ),
              },
            ]} />
          ) : null}
        </>
      )}
    </Drawer>
  )
}
