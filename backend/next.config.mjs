/** @type {import('next').NextConfig} */
const nextConfig = {
  // 本项目里 Next.js 仅作后端 API 服务（保留根目录 Vite 前端）。
  // 不启用任何前端页面优化，专注 app/api 下的路由。
  // 如需跨域（前端直连而非走 Vite 代理），可在此加 headers/CORS 配置。
}

export default nextConfig
