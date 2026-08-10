import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// 纯前端（BaaS 直连 Supabase），无自研后端。
// 开发服务器默认 5173；如需与既有项目端口错开，可在此加 server.port。
export default defineConfig({
    plugins: [react()],
    // GitHub Pages 项目页部署在 /yunstudio/ 子路径，用相对 base 确保资源正确加载
    // （deploy.yml 注释亦要求此配置；此前遗漏导致子路径下资源 404）
    base: './',
    // 平台 safe-delete 会拦截 outDir 的回收站清空导致 build 失败，关闭后由 vite 直接覆盖写入
    build: {
        emptyOutDir: false,
    },
});
