/* 手写 Service Worker —— 个人工作台 PWA
 * 策略：
 *  - 安装时预缓存 app shell（index.html + 图标 + manifest）
 *  - 同源静态资源：stale-while-revalidate（先返回缓存，后台更新）
 *  - 页面导航：network-first + cache:'no-cache'，确保永远拿到最新 HTML
 *    （避免被 GitHub Pages 的 HTTP 缓存顶住旧壳，从而旧 HTML 指向旧 JS 哈希、永远加载旧版）
 *  - 跨域请求（Supabase / Google Fonts）：不拦截，直连网络，保证数据实时
 *  - VERSION 由构建脚本注入（每次部署唯一，取 git short SHA），
 *    activate 时清空「所有」旧缓存，保证更新必生效、旧壳不再焊死客户端
 *
 * 紧急字面改动（确保 sw.js bytes hash 变更，让已装的客户端 SW 触发 install + 清旧 cache）：
 *  2026-08-12 #4 「全面反思修复」—— .glass-* 1px 全局化 + .border-line 用 var 三段覆盖 +
 *   进度条 var 全局兜底 (Overview inline 移除 fallback) + 状态栏 box-shadow:none 全局 +
 *   MegaMenu 三级菜单 hover 用 accent 高亮。皇上根因排查后确认"不是 SW 缓存问题，
 *   是修复只在 [data-skin=flat-light] 段生效"。本次把全部 5 个 bug 都做到 :root 默认值 +
 *   三皮肤覆盖，**绝不再依赖单段**。客户端请卸载 PWA 重装或 Ctrl+Shift+R 硬刷。
 *
 * 2026-08-12 #5 「分割线治本」—— 根因是 tailwind.config.js 里 line:'#26262E' 硬编码，
 *   Tailwind 编译出 .border-line{border-color:rgb(38,38,46)} 静态 utility 把"白底黑分割线"
 *   焊死，flat-light 下用 !important 覆盖也压不住（用户浏览器 SW 缓存到旧 utility）。
 *   治法：① tailwind.config.js 让 line='var(--c-line)'，utility 本身引用变量；
 *         ② index.css 把 .border-line 覆盖升到 'html .border-line' (specificity 0,1,1)
 *            压过 Tailwind (0,1,0)，双保险。本轮 sw.js bytes 必然变更，触发客户端 install +
 *            清旧 cache —— 即使 PWA 不重开也能拿到新壳。
 *
 * 2026-08-12 #6 「新建需求输入框残缺修复」—— flat-light 段 .glass-input 的 box-shadow
 *   残留 `inset 0 1px 2px rgba(0,0,0,0.03)`，inset 让圆角左上/左下被"吃进"产生视觉残缺。
 *   治法：与 flat-dark 段对齐成单层 `0 0 0 1px var(--edge)`，去掉 inset。liquid-glass
 *   默认段保留 inset 是设计意图（玻璃顶部高光），仅 flat-light 清掉。
 *
 * 2026-08-12 #7 「Sprints 进度条实心纯黑治本」—— Sprints.tsx 用 `bg-accent` Tailwind utility
 *   渲染 fill，但 tailwind.config.js:16 把 `accent:'#7c85f5'` 硬编码，Tailwind 编译出
 *   `.bg-accent{background-color:#7c85f5}` 静态 utility。flat-light 段覆写规则把 `.bg-accent`
 *   和 `.bg-accent/5/10/15/20` 合并到一个规则里用 rgba(37,99,235,0.10) 10% 透明蓝，**实色
 *   fill 被错改成接近透明的浅蓝**（视觉上跟外层 bg-line 浅灰 track 一起呈现一条"深色实心"）。
 *   治法（双保险）：① tailwind.config.js 让 accent='rgb(var(--c-accent-rgb) / <alpha-value>)'，
 *     :root + flat-dark 段补 --c-accent-rgb:124,133,245（靛紫）+ flat-light 段补
 *     --c-accent-rgb:37,99,235（蓝），让 Tailwind 编译出的 utility 本身引用变量，三皮肤自动跟随；
 *   ② src/index.css 把覆写规则拆分——`.bg-accent`（实色）和 `.bg-accent/X`（透明变体）
 *     各走各的色：flat-light 实色=#2563eb 蓝 / 浅底变体=rgba(37,99,235,0.10) 10%透明蓝；
 *     flat-dark 实色=#7c85f5 靛紫 / 浅底变体=rgba(255,255,255,0.08) 白.08。
 *
 * 2026-08-12 #8 「屏幕顶部那根虚线治本」—— 根因是 tailwind.config.js 把 canvas 硬编码 #040408，
 *   Tailwind 编译出 .bg-canvas{background-color:#040408} 静态 utility；PWA 状态栏透明区下方透出
 *   body 默认紫黑 vs AppShell div 的 flat-dark 蓝黑 / flat-light 白，色差产生"虚线"。
 *   治法（双保险）：① tailwind.config.js 让 canvas='rgb(var(--c-canvas-rgb) / <alpha-value>)'，
 *     三段补 --c-canvas-rgb（4,4,8 / 14,16,21 / 249,250,251），Tailwind 编译的 utility 本身引用变量；
 *   ② src/index.css 把 html / html[data-skin] 背景升 specificity 0,1,0 + !important 压过
 *     Tailwind 静态 utility (0,1,0)；三层（html / body / .bg-canvas div）背景色完全统一。
 */
const VERSION = '__SW_VERSION__';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.jpg',
  './pwa-192.png',
  './pwa-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // 清空所有旧缓存（任意旧版本号），强制后续请求回源拉取最新构建
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 跨域（Supabase API、字体 CDN）不缓存，直连网络，保证实时数据
  if (url.origin !== self.location.origin) return;

  // 导航请求：network-first + no-cache，回退缓存 index.html（SPA 单页）
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((resp) => {
          const copy = resp.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return resp;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 同源静态资源：stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200 && resp.type === 'basic') {
            const copy = resp.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
