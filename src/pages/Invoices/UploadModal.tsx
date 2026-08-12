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
  name: string
  type: string
  dataUrl: string
}

const MAX_SIZE_MB = 10

/**
 * 上传发票弹窗
 *
 * 规则落地：
 *  - 归属人（ownerName）必填 —— 否则「按人聚合」无意义
 *  - 文件限制 image/* + pdf，且 ≤ 10MB
 *  - 重复上传：本版不做去重（已知限制，见 store.addInvoice 注释）
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
  const addInvoice = useAppStore((s) => s.addInvoice)
  const [form] = Form.useForm()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [selected, setSelected] = useState<SelectedFile | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    form.resetFields()
    setFileList([])
    setSelected(null)
    setSubmitting(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  // 把 antd 内部的文件状态同步回受控 fileList，界面才会显示已选文件。
  // 同时过滤掉「校验失败」的文件（customRequest 里调用了 onError 的那种）。
  const handleChange: UploadProps['onChange'] = (info) => {
    const next = info.fileList.filter((f) => f.status !== 'error')
    setFileList(next.slice(-1)) // maxCount=1，只保留最后一个
  }

  // 完全接管上传：校验 -> 读成 base64 -> 标记成功（让 antd 显示「已选」）
  const customRequest: UploadProps['customRequest'] = (options) => {
    const file = options.file as File
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
    const reader = new FileReader()
    reader.onload = () => {
      setSelected({ name: file.name, type: file.type, dataUrl: reader.result as string })
      options.onSuccess?.({})
    }
    reader.onerror = () => {
      message.error('文件读取失败，请重试')
      options.onError?.(new Error('读取失败'))
    }
    reader.readAsDataURL(file)
  }

  const onFinish = async (values: { ownerName: string; invoiceDate: dayjs.Dayjs; note?: string }) => {
    console.log('[UploadModal] onFinish 触发', {
      ownerName: values.ownerName,
      invoiceDate: values.invoiceDate?.format('YYYY-MM-DD'),
      hasSelected: !!selected,
      fileType: selected?.type,
      dataUrlLen: selected?.dataUrl?.length,
    })
    // 兜底校验：防止「没选文件却点了存档」时静默无反应
    if (!selected) {
      console.warn('[UploadModal] 未选择文件，终止提交')
      message.error('请先选择发票文件')
      return
    }
    setSubmitting(true)
    try {
      console.log('[UploadModal] 开始 POST /api/invoices ...')
      await addInvoice({
        ownerName: values.ownerName.trim(),
        invoiceDate: values.invoiceDate.format('YYYY-MM-DD'),
        fileName: selected.name,
        fileType: selected.type,
        fileDataUrl: selected.dataUrl,
        note: values.note?.trim(),
      })
      console.log('[UploadModal] 上传成功，发票已写入后端')
      message.success('发票已存档')
      handleClose()
    } catch (e) {
      console.error('[UploadModal] 上传异常：', e)
      const msg = e instanceof Error ? e.message : '未知错误'
      message.error(`上传失败：${msg}（请确认 mock 服务已启动：pnpm dev:all）`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="上传发票"
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
          <Input placeholder="这张发票是谁的（必填）" />
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
          validateStatus={selected ? undefined : 'error'}
          help={selected ? undefined : '请选择一张发票文件（图片或 PDF）'}
        >
          <Upload
            accept="image/*,application/pdf"
            maxCount={1}
            fileList={fileList}
            customRequest={customRequest}
            onChange={handleChange}
            onRemove={() => {
              setSelected(null)
              return true
            }}
          >
            <Button icon={<UploadOutlined />}>选择文件（图片或 PDF，≤{MAX_SIZE_MB}MB）</Button>
          </Upload>
        </Form.Item>

        <Form.Item label="备注" name="note">
          <TextArea rows={2} placeholder="可选，如「出差打车」" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
