import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 纯前端（BaaS 直连 Supabase），无自研后端。
// 开发服务器默认 5173；如需与既有项目端口错开，可在此加 server.port。
export default defineConfig({
  plugins: [react()],
  // 平台 safe-delete 会拦截 outDir 的回收站清空导致 build 失败，关闭后由 vite 直接覆盖写入
  build: {
    emptyOutDir: false,
  },
})
