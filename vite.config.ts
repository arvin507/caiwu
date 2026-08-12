import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  resolve: {
    // 路径别名：用 `@/` 代替相对路径 `../../`，是前端工程的通用约定
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 开发时代理：把前端的 /api 请求转发到本地 mock 服务(8787)
    // 这样前端用相对路径 /api/... 即可，无需处理跨域(CORS)
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
