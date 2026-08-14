import { useState } from 'react'
import {
  App,
  Button,
  Form,
  Modal,
  Select,
  Upload,
  type UploadFile,
  type UploadProps,
} from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { useAppStore } from '@/store/useAppStore'
import type { Reimbursement, ReimbursementType } from '@/types'

interface UploadModalProps {
  open: boolean
  onClose: () => void
  /** 上传成功（落库为 draft）后回调，父组件用返回的草稿打开核对抽屉 */
  onUploaded: (reb: Reimbursement) => void
}

const MAX_SIZE_MB = 10

/**
 * 上传报销单弹窗
 *
 * 与发票上传类似的受控 Upload 写法（customRequest 接管 + onChange 回写 fileList），
 * 区别：
 *  - 只接受 .xlsx 单文件（报销单是 Excel 模板）
 *  - 多了「报销类型」下拉（travel 差旅 / general 一般），后端也会按此路由解析器
 *  - 上传即由后端解析并落库为 draft，返回完整记录给父组件做核对
 */
export default function UploadModal({ open, onClose, onUploaded }: UploadModalProps) {
  const { message } = App.useApp()
  const token = useAppStore((s) => s.token)
  const [form] = Form.useForm()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    form.resetFields()
    setFileList([])
    setSubmitting(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  // 受控 Upload：把 antd 内部文件状态同步回界面（否则不显示已选文件）
  const handleChange: UploadProps['onChange'] = (info) => {
    // 报销单只取最新一个文件
    const next = info.fileList.slice(-1).filter((f) => f.status !== 'error')
    setFileList(next)
  }

  // 完全接管上传：仅做前端校验（扩展名 + 大小），原始 File 交给 onFinish 用 FormData 提交
  const customRequest: UploadProps['customRequest'] = (options) => {
    const file = options.file as File & { uid: string }
    const isXlsx =
      /\.xlsx?$/i.test(file.name) ||
      file.type ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    if (!isXlsx) {
      message.error('仅支持 Excel 文件（.xlsx）')
      options.onError?.(new Error('文件类型不支持'))
      return
    }
    const isLt10M = file.size / 1024 / 1024 < MAX_SIZE_MB
    if (!isLt10M) {
      message.error(`文件不能超过 ${MAX_SIZE_MB}MB`)
      options.onError?.(new Error('文件过大'))
      return
    }
    options.onSuccess?.({})
  }

  const onFinish = async (values: { type: ReimbursementType }) => {
    if (fileList.length === 0) {
      message.error('请先选择报销单 Excel 文件')
      return
    }
    const file = fileList[0].originFileObj as File | undefined
    if (!file) {
      message.error('文件读取失败，请重新选择')
      return
    }
    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('type', values.type)
      fd.append('file', file)
      const res = await fetch('/api/reimbursements', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || '上传失败')
      }
      const reb = (await res.json()) as Reimbursement
      message.success('已上传并解析，请在详情中核对后提交')
      reset()
      onClose()
      onUploaded(reb)
    } catch (e) {
      message.error(
        `上传失败：${e instanceof Error ? e.message : '未知错误'}（请确认后端服务已启动）`,
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="上传报销单"
      open={open}
      onCancel={handleClose}
      onOk={() => form.submit()}
      okText="上传并解析"
      confirmLoading={submitting}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        onFinishFailed={() => message.error('请选择报销类型')}
      >
        <Form.Item
          label="报销类型"
          name="type"
          rules={[{ required: true, message: '请选择报销类型' }]}
        >
          <Select
            placeholder="选择报销单类型"
            options={[
              { label: '差旅费报销单', value: 'travel' },
              { label: '一般费用报销单', value: 'general' },
            ]}
          />
        </Form.Item>

        <Form.Item
          label="报销单文件"
          required
          validateStatus={fileList.length ? undefined : 'error'}
          help={fileList.length ? undefined : '请选择 Excel 文件（.xlsx，≤10MB）'}
        >
          <Upload
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            maxCount={1}
            fileList={fileList}
            customRequest={customRequest}
            onChange={handleChange}
          >
            <Button icon={<UploadOutlined />}>选择文件（.xlsx）</Button>
          </Upload>
        </Form.Item>
      </Form>
    </Modal>
  )
}
