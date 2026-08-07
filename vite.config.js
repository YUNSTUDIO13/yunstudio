import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// 纯前端（BaaS 直连 Supabase），无自研后端。
// 开发服务器默认 5173；如需与既有项目端口错开，可在此加 server.port。
export default defineConfig({
    // 相对基路径：无论部署到 GitHub Pages 根域（user.github.io）还是项目页（user.github.io/repo），
    // 资源都用相对引用，避免子路由刷新 404。配合 CI 复制 index.html → 404.html 实现 SPA 回退。
    base: './',
    plugins: [react()],
    // 平台 safe-delete 会拦截 outDir 的回收站清空导致 build 失败，关闭后由 vite 直接覆盖写入
    build: {
        emptyOutDir: false,
    },
});
