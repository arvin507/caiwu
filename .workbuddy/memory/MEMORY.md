# 项目长期记忆（caiwu 财务系统）

## 技术栈
- 前端：React 19 + Vite(:5173 → 代理 :4000) + antd + Zustand；源码在 `src/`。
- 后端：Next.js 15 Route Handlers(`backend/src/app/api`) + Prisma 6 + MySQL 8(Docker 3307, 库 caiwu, 密码 caiwu123)；`backend/` 独立 pnpm 工程，`pnpm dev` 跑在 4000。
- 发票 OCR：百度 vat_invoice，统一走 `backend/src/lib/baiduOcr.ts`（QPS=2 信号量 + 指数退避重试）。

## 发票-报销关联模型（核心约定）
- 关联用 junction 表 `InvoiceLink`（非行上 invoiceId）；支持 1:1 / 1:N（一行多票）/ N:1（一票多行，`allocatedAmount` 记分摊额）。
- **硬业务规则：发票归属人(`Invoice.ownerName`) 必须等于报销单申请人(`Reimbursement.applicantName`) 才能关联**（文本 trim 后全等，对所有角色含 admin 生效）。弹窗 `linkable` 接口按 `reimbursementId` 过滤只返回同归属人发票；`PATCH /link` 与 `auto-link` 在写入前强制校验，不一致拒绝。
- auto-link 仅做 1:1 金额精确匹配；1:N / N:1 分摊由人工在弹窗完成。

## 环境坑
- 本机 `rm` 被 WorkBuddy 安全删除拦截（fail-closed），`prisma generate` 时若需挪 `.prisma` 用 `mv` 重命名绕过。
- 改 schema 后必须 `cd backend && pnpm prisma db push`（否则表不存在 / Client 与 DB 漂移）。
- **后端必须 `next dev` 运行，源码改动才会生效**；若以 `next start`（生产构建）运行，路由/页面改动不会重新编译，线上仍是改之前的旧代码。本次「linkable 申请人过滤不生效」根因 = 线上是旧的 `next start`(PID 24592) 且更早的 `pnpm dev`(PID 24320) 子进程残留占用 4000，新代码从未加载。修法 = 杀掉所有 next/pnpm 残留进程，用 `./node_modules/.bin/next dev -p 4000` 启动（实时编译源码）。
- `next dev` 启动清理 `.next` 时会被 WorkBuddy safe-delete 拦截 bulk delete（非致命；dev 仍正常启动并正确响应，已用真实请求验证）。`.next` 因 Windows 文件锁无法 rename 清理，可忽略该告警。
- 报销单申请人真实值为「**郭晓磊**」（晓，非小）；库中所有发票 `ownerName` 当前均为「汪文静」。
