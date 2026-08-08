import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// 纯前端（BaaS 直连 Supabase），无自研后端。
// 开发服务器默认 5173；如需与既有项目端口错开，可在此加 server.port。
//
// PWA 采用手写 Service Worker（public/sw.js）+ 静态 manifest（public/manifest.webmanifest），
// 不依赖 vite-plugin-pwa / workbox-build（其依赖链在本机会被 safe-delete 抽空部分文件导致构建失败）。
// SW 在 index.html 内联脚本中注册，manifest 由 index.html 的 <link rel="manifest"> 引用。
export default defineConfig({
    // 相对基路径：配合 HashRouter（路由在 URL 的 # 之后，服务端永远只返回根 index.html），
    // 资源用相对引用即可在 GitHub Pages 项目页正确加载，子路由刷新永不再 404。
    base: './',
    plugins: [react()],
    // 平台 safe-delete 会拦截 outDir 的回收站清空导致 build 失败，关闭后由 vite 直接覆盖写入
    build: {
        emptyOutDir: false,
    },
});
