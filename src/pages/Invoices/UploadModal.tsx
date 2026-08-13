import { useState } from 'react'
import { App, Button, DatePicker, Form, Input, Modal, Upload, type UploadFile, type UploadProps } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAppStore } from '@/store/useAppStore'

const { TextArea } = Input

interface UploadModalProps {
  open: boolean
  onClose: () => void
}

interface SelectedFile {
  uid: string
  name: string
  type: string
  /** 原始 File 对象，提交时放进 FormData 用 multipart 上传 */
  file: File
}

const MAX_SIZE_MB = 10

/**
 * 上传发票弹窗（支持批量）
 *
 * 规则落地：
 *  - 归属人（ownerName）必填 —— 否则「按人聚合」无意义
 *  - 文件限制 image/* + pdf，且 ≤ 10MB
 *  - 支持一次多选多张发票，用一个请求批量上传（后端 files[] 循环处理）
 *  - 重复上传：后端在落库前按发票号码去重——号码已存在的发票会被自动删除并提示
 *
 * 上传逻辑用 customRequest 完全接管（而非 beforeUpload 返回 false）：
 * antd v6 中 beforeUpload 返回 false 时文件可能不进入受控 fileList，
 * 用 customRequest 可以自己决定「何时标记成功」，状态更可控、界面更可靠。
 *
 * ⚠️ 关键坑（已踩过）：Upload 用了受控 fileList（fileList={fileList}），
 *    就必须靠 onChange 把 antd 内部的文件状态同步回来，否则界面永远不显示已选文件。
 */
export default function UploadModal({ open, onClose }: UploadModalProps) {
  const { message } = App.useApp()
  const addInvoices = useAppStore((s) => s.addInvoices)
  const [form] = Form.useForm()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [selected, setSelected] = useState<SelectedFile[]>([])
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    form.resetFields()
    setFileList([])
    setSelected([])
    setSubmitting(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  // 把 antd 内部的文件状态同步回受控 fileList，界面才会显示已选文件。
  // 同时裁剪 selected——只保留仍在 fileList 里的文件（处理删除）。
  const handleChange: UploadProps['onChange'] = (info) => {
    const next = info.fileList.filter((f) => f.status !== 'error')
    setFileList(next)
    const uids = new Set(next.map((f) => f.uid))
    setSelected((prev) => prev.filter((s) => uids.has(s.uid)))
  }

  // 完全接管上传：仅做前端校验（类型/大小），通过后记录原始 File 对象，
  // 真正的上传在 onFinish 里用 FormData 以 multipart 提交（files[] 批量）。
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
    // 校验通过：追加原始 File，标记成功让 antd 显示「已选」
    setSelected((prev) => [...prev, { uid: file.uid, name: file.name, type: file.type, file }])
    options.onSuccess?.({})
  }

  const onFinish = async (values: { ownerName: string; invoiceDate: dayjs.Dayjs; note?: string }) => {
    // 兜底校验：防止「没选文件却点了存档」时静默无反应
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
      if (created.length) message.success(`已存档 ${created.length} 张发票`)
      if (skipped.length) {
        const names = skipped
          .map((s) => `${s.fileName}（号码 ${s.invoiceNumber}）`)
          .join('、')
        message.warning(`已跳过 ${skipped.length} 张重复发票（号码已存在）：${names}`)
      }
      if (!created.length && !skipped.length) {
        message.error('没有文件被处理')
      }
      handleClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误'
      message.error(`上传失败：${msg}（请确认后端服务已启动：pnpm dev）`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="上传发票（支持批量）"
      open={open}
      onCancel={handleClose}
      onOk={() => form.submit()}
      okText="存档"
      confirmLoading={submitting}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ invoiceDate: dayjs() }}
        onFinish={onFinish}
        onFinishFailed={({ errorFields }) => {
          console.warn('[UploadModal] 表单校验未通过，阻止提交：', errorFields)
          message.error('请检查表单：必填项未填写或格式不对')
        }}
      >
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
          <TextArea rows={2} placeholder="可选，如「出差打车」" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
