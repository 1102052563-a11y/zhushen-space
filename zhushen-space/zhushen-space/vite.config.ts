import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发代理目标：解决本地 localhost 跨域（CORS）问题
// 如果你用的 API 地址不同，把 VITE_API_TARGET 写进 .env.local 文件
const API_TARGET = process.env.VITE_API_TARGET ?? 'https://api.baimeow.icu'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 访问 http://localhost:5173/dev-proxy/* 时自动转发到目标 API
      // 使用方式：在设置里把 API 地址改为 http://localhost:5173/dev-proxy
      '/dev-proxy': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dev-proxy/, ''),
        secure: false,
      },
    },
  },
})
