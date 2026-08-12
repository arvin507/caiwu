# 财务管理系统（caiwu）

> 一个用 **React + TypeScript + Vite** 写的前端，配合 **Next.js + Prisma** 后端与 **MySQL** 数据库的实战教学项目。
> 当前已实现：登录、发票管理（上传 / 列表 / 排序 / 预览 / 删除）等，其余页面为占位。

## 技术栈与架构

| 层 | 技术 | 说明 |
| --- | --- | --- |
| 前端 | React 19 / TypeScript / Vite / Ant Design v6 / React Router v7 / Zustand | 项目根目录，`pnpm dev` 跑在 `5173` |
| 后端 | Next.js 15（App Router）+ Prisma ORM | `backend/` 目录，`pnpm dev` 跑在 `4000` |
| 数据库 | MySQL 8.0 | 推荐用 Docker 起，配置见 `backend/docker-compose.yml` |
| 历史遗留 | 零依赖 Node mock 服务 | `server/index.js`，端口 `8787`，当前默认不启用 |

> 前端开发时，Vite 代理（`vite.config.ts`）把 `/api` 转发到 `http://localhost:4000`（真实后端）。
> 教材文档里写的 `8787` 是旧版 mock 模式，已过时，**以代码为准**。

## 快速开始（Docker，推荐）

你**不需要手动安装 MySQL Server**——作者已用 Docker Compose 配好了一切。

1. **安装 Docker Desktop**（Windows 会随安装自动配置 WSL2）：https://www.docker.com/products/docker-desktop/
   启动后等左下角图标变绿（引擎真正运行）再继续。

2. **起 MySQL**（在 `backend/` 目录下）：
   ```bash
   docker compose up -d
   ```
   首次会拉 `mysql:8.0` 镜像（联网，稍慢）。起好后 `docker ps` 能看到 `caiwu-mysql` 容器。
   - root 密码：`caiwu123`
   - 库名：`caiwu`
   - 宿主机端口：`3307`（故意避开本机可能的 `3306`）

3. **建表 + 灌初始数据**：
   ```bash
   cd backend
   pnpm install          # 安装后端依赖
   pnpm prisma db push   # 按 schema 建表
   pnpm prisma db seed   # 创建初始管理员 admin / 123456
   ```

4. **起服务**（两个终端）：
   ```bash
   # 终端 1：后端
   cd backend && pnpm dev        # http://localhost:4000

   # 终端 2：前端（项目根目录）
   pnpm dev                      # http://localhost:5173
   ```

5. 浏览器打开 **http://localhost:5173**，用 `admin / 123456` 登录。

> `backend/.env` 已按上面的真实配置填好（端口 `3307`、库 `caiwu`、密码 `caiwu123`），**无需改动**。
> 若 `.env` 丢失：复制 `backend/.env.example`，并把端口改成 `3307` 即可。

## 不使用 Docker：原生 MySQL

1. 下载 MySQL Installer for Windows（https://dev.mysql.com/downloads/installer/），安装 **MySQL Server 8.0**
2. 安装时设置 root 密码为 `caiwu123`（或自定，并同步改 `backend/.env` 的密码与端口）
3. 手动建库：`CREATE DATABASE caiwu;`
4. 其余步骤与上面第 3–5 步完全相同（注意 `.env` 端口用 `3306`，若无冲突）

## 可用脚本

**根目录：**
- `pnpm dev` —— 前端开发服务器（5173）
- `pnpm build` —— 类型检查 + 打包（产物在 `dist/`）
- `pnpm mock` —— 启动旧版 mock 服务（8787，当前默认不用）
- `pnpm dev:all` —— 同时起前端 + mock（历史脚本；新代码已对接真实后端，慎用于需要登录态的场景）

**`backend/`：**
- `pnpm dev` —— 后端开发服务器（4000）
- `pnpm prisma db push` —— 同步数据库表结构
- `pnpm prisma db seed` —— 灌初始数据

## 图片发票 OCR（百度）

发票解析分两条路：

- **PDF / OFD**：本地解析，零依赖、零 API Key、完全离线（见 `backend/src/lib/invoiceParser.ts`）。
- **图片（png/jpg/jpeg/bmp/gif/webp）**：本地无法从图片抽文字，需调用**百度 OCR 增值税发票识别**接口（云端）。

### 启用步骤

1. 打开百度智能云控制台 → 产品 → 文字识别 OCR，开通服务并**创建应用**，拿到 `API Key` 与 `Secret Key`。
2. 在 `backend/.env` 填入（取消注释并替换）：
   ```bash
   BAIDU_OCR_API_KEY="你的APIKey"
   BAIDU_OCR_SECRET_KEY="你的SecretKey"
   ```
3. 重启后端（`pnpm dev` 会自动重载并读取新环境变量）。
4. 上传图片类发票：后端先把图片发往百度识别，再把结构化字段（发票代码/号码/开票日期/销售方/购买方/金额/税额/价税合计）写回；前端「核对」页可查看与人工校对。

> 说明：百度 `access_token` 会在后端进程内缓存（约 30 天），无需每次请求都换取。
> 合规提示：调用意味着发票图片会发往百度云端；学习/内部可用，正式上线前请评估数据合规（或改用私有化部署）。

## 新手教材

完整的「从零搭建」讲解（项目搭建、配置、TS/React/路由、状态管理、前后端联调、踩坑复盘）见：
`docs/新手教材-财务系统从零到实战.md`

## 注意事项

- **登录必须走真实后端** `/api/auth/login`。mock 服务（`server/index.js`）只实现了发票接口，**不含登录/用户管理接口**，因此「纯前端 + mock」无法登录进系统。
- 前端报 `/api` 502 → 通常是后端 `4000` 没起来，或 MySQL（Docker）还在初始化，稍等重试。
