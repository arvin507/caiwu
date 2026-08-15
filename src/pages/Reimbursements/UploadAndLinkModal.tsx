import { useState } from 'react'
import { App, Button, Modal, Upload, type UploadFile, type UploadProps } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAppStore } from '@/store/useAppStore'
import type { Reimbursement } from '@/types'

const MAX_SIZE_MB = 10

interface SelectedFile {
  uid: string
  name: string
  file: File
}

interface Props {
  open: boolean
  /** 报销单 id */
  reimbursementId: string
  /** 报销单申请人：上传发票的归属人会被锁定为该值（关联硬规则要求一致） */
  applicantName: string
  /** 关联的目标行类型 */
  lineType: 'item' | 'leg'
  /** 关联的目标行 id */
  lineId: string
  onClose: () => void
  /** 自动关联成功后回调最新整单 */
  onLinked: (updated: Reimbursement) => void
}

/**
 * 上传发票并自动关联到本条明细/行程段。
 *
 * 流程：选文件 → POST /api/invoices（同步解析）→ 取本次新建/更新的发票 id
 * → PATCH /api/reimbursements/:id/link 一次性关联到本行。
 *
 * 归属人（ownerName）锁定为报销单申请人：
 *  - 关联硬规则要求「发票归属人 === 报销单申请人」，否则 PATCH /link 会被拒；
 *  - 锁死后上传的发票本身归属人就是申请人，自动关联必然通过，避免用户填错导致失败。
 *  - 顺带把这些发票归入发票库（ownerName=申请人），与「发票管理」页数据同源。
 */
export default function UploadAndLinkModal({
  open,
  reimbursementId,
  applicantName,
  lineType,
  lineId,
  onClose,
  onLinked,
}: Props) {
  const { message } = App.useApp()
  const addInvoices = useAppStore((s) => s.addInvoices)
  const token = useAppStore((s) => s.token)
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [selected, setSelected] = useState<SelectedFile[]>([])
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setFileList([])
    setSelected([])
    setSubmitting(false)
  }

  const handleClose = () => {
    if (submitting) return
    reset()
    onClose()
  }

  // 受控 fileList 必须靠 onChange 同步，界面才会显示已选文件
  const handleChange: UploadProps['onChange'] = (info) => {
    const next = info.fileList.filter((f) => f.status !== 'error')
    setFileList(next)
    const uids = new Set(next.map((f) => f.uid))
    setSelected((prev) => prev.filter((s) => uids.has(s.uid)))
  }

  // 完全接管上传：仅做前端类型/大小校验，通过则记录原始 File，标记成功让 antd 显示已选
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
    setSelected((prev) => [...prev, { uid: file.uid, name: file.name, file }])
    options.onSuccess?.({})
  }

  const handleSubmit = async () => {
    if (selected.length === 0) {
      message.error('请先选择发票文件')
      return
    }
    setSubmitting(true)
    try {
      // 1) 上传并（同步）解析；ownerName 锁定为申请人，invoiceDate 默认今天
      const { created, updated, skipped } = await addInvoices({
        ownerName: applicantName,
        invoiceDate: dayjs().format('YYYY-MM-DD'),
        files: selected.map((s) => s.file),
      })
      const invoiceIds = [...created, ...updated].map((i) => i.id)
      if (invoiceIds.length === 0) {
        const names = skipped.map((s) => s.fileName).join('、')
        message.warning(`没有新的发票被上传（${names || '可能已关联其它报销单'}）`)
        reset()
        onClose()
        return
      }
      // 2) 一次性关联本行（1:N 支持多张）
      const res = await fetch(`/api/reimbursements/${reimbursementId}/link`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          lineType,
          lineId,
          links: invoiceIds.map((invoiceId) => ({ invoiceId })),
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || '关联失败')
      }
      const updatedReb = (await res.json()) as Reimbursement
      const createdCount = created.length
      const updatedCount = updated.length
      if (createdCount) message.success(`已上传 ${createdCount} 张并关联本行`)
      else if (updatedCount) message.success(`已关联 ${updatedCount} 张（同一文件已存在，已复用）`)
      onLinked(updatedReb)
      reset()
      onClose()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '上传并关联失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="上传发票并关联本行"
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      okText="上传并关联"
      confirmLoading={submitting}
      maskClosable={false}
    >
      <p style={{ marginBottom: 12, color: '#888', fontSize: 13 }}>
        归属人已锁定为 <strong>{applicantName || '—'}</strong>（关联规则要求发票归属人与报销单申请人一致）。
        上传的发票会同步进入发票库。
      </p>
      <Upload
        accept="image/*,application/pdf"
        multiple
        fileList={fileList}
        customRequest={customRequest}
        onChange={handleChange}
      >
        <Button icon={<UploadOutlined />}>选择文件（可多选，图片或 PDF，≤{MAX_SIZE_MB}MB）</Button>
      </Upload>
    </Modal>
  )
}
