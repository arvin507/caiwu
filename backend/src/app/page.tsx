export default function Home() {
  return (
    <main style={{ fontFamily: 'monospace', padding: 24 }}>
      <h1>caiwu-backend</h1>
      <p>这是财务系统的后端 API 服务（Next.js + Prisma + MySQL）。</p>
      <ul>
        <li>
          <code>GET /api/health</code> —— 健康检查
        </li>
        <li>
          <code>GET /api/invoices</code> —— 发票列表
        </li>
        <li>
          <code>POST /api/invoices</code> —— 上传发票（multipart/form-data）
        </li>
        <li>
          <code>GET /api/invoices/:id/file</code> —— 预览/下载
        </li>
        <li>
          <code>DELETE /api/invoices/:id</code> —— 删除
        </li>
      </ul>
    </main>
  )
}
