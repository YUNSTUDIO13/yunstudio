/* 手写 Service Worker —— 个人工作台 PWA
 * 策略：
 *  - 安装时预缓存 app shell（index.html + 图标 + manifest）
 *  - 同源静态资源：stale-while-revalidate（先返回缓存，后台更新）
 *  - 页面导航：network-first，失败回退到缓存的 index.html（SPA 单页）
 *  - 跨域请求（Supabase / Google Fonts）：不拦截，直连网络，保证数据实时
 * 与 HashRouter 配合：所有路由都在 URL 的 # 之后，文档始终为根 index.html。
 */
const VERSION = 'yunstudio-v1';
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
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 跨域（Supabase API、字体 CDN）不缓存，直连网络，保证实时数据
  if (url.origin !== self.location.origin) return;

  // 导航请求：network-first，回退缓存 index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
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
