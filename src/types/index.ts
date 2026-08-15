/**
 * 财务系统的领域模型（Domain Model）
 *
 * 这里集中定义整个应用共享的「数据结构契约」。
 * TypeScript 的价值之一：一处定义类型，全项目复用且自动校验，
 * 改了字段名，所有用到它的地方编译期就会报错。
 */

/** 交易类型：收入 / 支出 */
export type TransactionType = 'income' | 'expense'

/** 账户类型 */
export type AccountType = 'cash' | 'bank' | 'credit' | 'ecommerce' | 'investment'

/** 收支分类 */
export interface Category {
  id: string
  name: string
  /** 分类只能用于收入或支出其中一种 */
  type: TransactionType
  icon?: string
}

/** 账户（钱包、银行卡、支付宝等） */
export interface Account {
  id: string
  name: string
  type: AccountType
  /** 当前余额（单位：元） */
  balance: number
  /** 币种符号，默认 ¥ */
  currency: string
  remark?: string
}

/** 一笔收支记录（账单明细） */
export interface Transaction {
  id: string
  /** 交易日期，ISO 字符串，如 '2026-08-12' */
  date: string
  type: TransactionType
  categoryId: string
  accountId: string
  /** 金额（正数，方向由 type 决定） */
  amount: number
  note?: string
}

/** 用户角色：超级管理员 / 普通用户 */
export type UserRole = 'admin' | 'user'

/** 当前登录用户 */
export interface User {
  id: string
  name: string
  /** 登录账号（后端返回，可选） */
  username?: string
  /** 角色，决定能看到的菜单与可执行的操作 */
  role: UserRole
  /** 头像链接，可选；不传则展示首字母 */
  avatar?: string
}

/** 全局用户偏好（放在 store 里，可被设置页修改） */
export interface AppPreferences {
  themeMode: 'light' | 'dark'
  currencySymbol: string
}

/** 仪表盘用的汇总指标（派生数据，不持久化） */
export interface DashboardSummary {
  totalBalance: number
  monthIncome: number
  monthExpense: number
  monthNet: number
}

/** 发票（图片或 PDF 存档） */
export interface Invoice {
  id: string
  /** 归属人姓名（必填，否则「按人聚合」无意义） */
  ownerName: string
  /** 原始文件名 */
  fileName: string
  /** MIME 类型，如 image/png、application/pdf */
  fileType: string
  /** 文件在后端存储的相对路径（如 /uploads/inv-xxx.pdf），预览走 /api/invoices/:id/file */
  storagePath?: string
  /** 上传时间（后端 Prisma DateTime 序列化，ISO 字符串，如 '2026-08-12T00:00:00.000Z'） */
  uploadedAt: string
  /** 发票开票日期（后端返回 ISO 字符串；用于「按发票日期」排序，字符串字典序即时间序） */
  invoiceDate: string
  note?: string
  /** 解析状态：pending 解析中 / done 已完成 / failed 失败 */
  parseStatus?: 'pending' | 'done' | 'failed'
  /** 解析出的结构化字段（发票代码、号码、金额等），未完成/失败时为 null */
  parsedData?: InvoiceParsedData | null
  /** 解析失败原因 */
  parseError?: string | null
  /** 发票类型：vat(增值税普/专票) | train(铁路电子客票/火车票) */
  invoiceType?: 'vat' | 'train' | string
  /** 解析出的发票号码（独立列；用于前端展示与去重提示，避免依赖 JSON 字段） */
  invoiceNumber?: string | null
  /** 关联发票专用：标注该发票当前已关联到哪些报销行（支持 N:1，故为数组；来自 /api/invoices/linkable） */
  linkedTo?: Array<{ type: 'item' | 'leg'; id: string; allocatedAmount?: number | null }> | null
}

/** 发票关联表记录（junction：支持 1:1 / 1:N / N:1） */
export interface InvoiceLink {
  id: string
  invoiceId: string
  reimbursementItemId?: string | null
  reimbursementLegId?: string | null
  /** N:1 分摊额（Decimal 序列化为字符串） */
  allocatedAmount?: string | null
  note?: string | null
  /** 嵌套的发票对象（详情接口带出） */
  invoice?: Invoice | null
}

/** 发票本地解析得到的字段（键可为空，表示没抽出来） */
export interface InvoiceParsedData {
  invoiceCode?: string | null
  invoiceNumber?: string | null
  invoiceDate?: string | null
  sellerName?: string | null
  buyerName?: string | null
  amount?: string | null
  taxAmount?: string | null
  totalAmount?: string | null
  /** 销售方纳税人识别号（公司类发票才有） */
  sellerTaxId?: string | null
  /** 抽取出的原始文字，用于人工核对 */
  rawText?: string
  // ── 火车票（铁路电子客票）扩展字段 ──
  /** 乘车人姓名 */
  passengerName?: string | null
  /** 出发站 */
  departureStation?: string | null
  /** 到达站 */
  arrivalStation?: string | null
  /** 车次，如 G7608 */
  trainNo?: string | null
  /** 乘车日期 ISO（yyyy-mm-dd） */
  rideDate?: string | null
  /** 开车时间 HH:mm */
  departureTime?: string | null
  /** 乘车日期+时间，ISO 片段 */
  departureDateTime?: string | null
  /** 车厢/座位，如 04车13C号 */
  carSeatNo?: string | null
  /** 席别，如 二等座 */
  seatClass?: string | null
  /** 票价（= totalAmount，未拆分税额） */
  fare?: string | null
  /** 电子客票号 */
  electronicTicketNo?: string | null
  /** 身份证号（可能遮挡） */
  idNo?: string | null
  /** 改签/退票标记 */
  ticketNote?: string | null
  /** 兜底：保留其它未被上面字段覆盖的键 */
  [key: string]: unknown
}

/** 发票列表排序方式 */
export type InvoiceSortKey = 'uploadedAt' | 'invoiceDate'

// ============ 报销管理 ============

/** 报销类型：差旅费 / 一般费用 */
export type ReimbursementType = 'travel' | 'general'

/** 报销单状态机：草稿 → 已提交 → 已通过 / 已驳回 → 已付款 */
export type ReimbursementStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'paid'

/** 通用费用明细（一般费用由它直接构成；差旅的费用汇总段也复用它） */
export interface ReimbursementItem {
  id: string
  seq: number
  /** 费用类型：办公费用/业务招待费/住宿费... */
  category?: string | null
  /** 摘要 */
  summary?: string | null
  /** 金额（后端 Decimal 序列化为字符串，前端用 Number() 处理） */
  amount: string
  note?: string | null
  /** 关联的发票（通过发票关联表，支持 1:N；详情接口带出 links） */
  links?: InvoiceLink[]
}

/** 差旅专用：出差信息（一对一） */
export interface ReimbursementTrip {
  id: string
  travelerName?: string | null
  startDate?: string | null
  endDate?: string | null
  fromLocation?: string | null
  toLocation?: string | null
  headcount?: number | null
  reason?: string | null
  /** 原始「起止时间」文本，兜底展示 */
  dateRangeText?: string | null
  /** 原始「起止地点」文本，兜底展示 */
  locationText?: string | null
}

/** 差旅专用：行程段（一对多） */
export interface ReimbursementLeg {
  id: string
  /** 如 "7/8" */
  legDate?: string | null
  transport?: string | null
  fromStation?: string | null
  toStation?: string | null
  amount: string
  ticketCount?: number | null
  /** 关联的发票（通过发票关联表，支持 1:N；详情接口带出 links） */
  links?: InvoiceLink[]
}

/** 报销单（主表 + 关联子表） */
export interface Reimbursement {
  id: string
  type: ReimbursementType
  applicantName: string
  department?: string | null
  projectName?: string | null
  projectCode?: string | null
  /** 申请日期，ISO 字符串或 null */
  applyDate?: string | null
  /** 合计金额（系统按明细求和得出，string 原因为 Decimal 序列化） */
  totalAmount: string
  status: ReimbursementStatus
  /** 原始文件相对路径，预览走 /api/reimbursements/:id/file */
  storagePath?: string | null
  fileName?: string | null
  /** 提交人 User.id（本人才能提交/删除草稿） */
  submitterId?: string | null
  approverId?: string | null
  approvedAt?: string | null
  rejectReason?: string | null
  createdAt: string
  updatedAt: string
  items: ReimbursementItem[]
  trip?: ReimbursementTrip | null
  legs?: ReimbursementLeg[]
}
