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
})
