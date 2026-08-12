// 发票 mock 服务（零依赖，仅用 Node 内置模块）
// 运行：node server/index.js  （或 pnpm mock）
// 端口：8787
//
// 接口：
//   GET    /api/invoices              列出全部发票元数据
//   POST   /api/invoices              上传一张发票（JSON 内含 base64 文件内容）
//   GET    /api/invoices/:id/file     预览/下载该发票文件
//   DELETE /api/invoices/:id          删除一张发票（及其文件）
//
// 说明：真实后端会把文件存到对象存储(OSS/S3)并返回 URL。
// 这里用「base64 落盘到本地文件」模拟，便于纯前端练习阶段直接跑通。

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 8787
const DATA_DIR = path.join(__dirname, 'data')
const UPLOAD_DIR = path.join(__dirname, 'uploads')
const DATA_FILE = path.join(DATA_DIR, 'invoices.json')

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

// MIME -> 文件扩展名
const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
}

function readInvoices() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
  } catch {
    return []
  }
}

function writeInvoices(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2))
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

// 读取请求体（限制 30MB，避免超大请求拖垮服务）
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    let aborted = false
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 30 * 1024 * 1024) {
        aborted = true
        req.destroy()
      }
    })
    req.on('end', () => (aborted ? reject(new Error('请求体过大')) : resolve(data)))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  // 1) 列表
  if (req.method === 'GET' && url.pathname === '/api/invoices') {
    return sendJson(res, 200, readInvoices())
  }

  // 2) 上传
  if (req.method === 'POST' && url.pathname === '/api/invoices') {
    try {
      const body = JSON.parse(await readBody(req))
      const { ownerName, invoiceDate, fileName, fileType, fileDataUrl, note } = body
      if (!ownerName || !fileDataUrl) {
        return sendJson(res, 400, { error: 'ownerName 与 fileDataUrl 必填' })
      }
      const id = `inv-${Date.now()}`
      const ext = MIME_EXT[fileType] || ''
      const filePath = path.join(UPLOAD_DIR, `${id}${ext}`)
      // data:image/png;base64,xxxx -> 取逗号后的 base64 部分
      const base64 = String(fileDataUrl).split(',')[1] || ''
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))

      const record = {
        id,
        ownerName,
        invoiceDate,
        fileName: fileName || `invoice${ext}`,
        fileType,
        uploadedAt: new Date().toISOString().slice(0, 10),
        note: note || '',
        fileUrl: `/api/invoices/${id}/file`,
      }
      const list = readInvoices()
      list.unshift(record) // 最新的排最前
      writeInvoices(list)
      return sendJson(res, 201, record)
    } catch (e) {
      return sendJson(res, 500, { error: String(e) })
    }
  }

  // 3) 预览/下载文件
  const fileMatch = url.pathname.match(/^\/api\/invoices\/(.+)\/file$/)
  if (req.method === 'GET' && fileMatch) {
    const id = fileMatch[1]
    const rec = readInvoices().find((x) => x.id === id)
    if (!rec) return sendJson(res, 404, { error: '发票不存在' })
    const ext = MIME_EXT[rec.fileType] || ''
    const filePath = path.join(UPLOAD_DIR, `${id}${ext}`)
    if (!fs.existsSync(filePath)) return sendJson(res, 404, { error: '文件缺失' })
    res.writeHead(200, { 'Content-Type': rec.fileType || 'application/octet-stream' })
    return fs.createReadStream(filePath).pipe(res)
  }

  // 4) 删除
  const delMatch = url.pathname.match(/^\/api\/invoices\/(.+)$/)
  if (req.method === 'DELETE' && delMatch) {
    const id = delMatch[1]
    const list = readInvoices()
    const idx = list.findIndex((x) => x.id === id)
    if (idx === -1) return sendJson(res, 404, { error: '发票不存在' })
    const rec = list[idx]
    const ext = MIME_EXT[rec.fileType] || ''
    try {
      fs.unlinkSync(path.join(UPLOAD_DIR, `${id}${ext}`))
    } catch {
      // 文件已不存在也能继续删元数据
    }
    list.splice(idx, 1)
    writeInvoices(list)
    return sendJson(res, 200, { ok: true })
  }

  sendJson(res, 404, { error: 'not found' })
})

server.listen(PORT, () => {
  console.log(`[mock] 发票服务已启动: http://localhost:${PORT}`)
})
