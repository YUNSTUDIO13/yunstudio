// 高德 JS API 加载器（前端地图渲染，用于「总览·轨迹预览」）。
// 与 Web 服务 Key（服务端保密、走 amap-proxy 代理）不同，JS API Key + 安全密钥是前端公开可加载的密钥，
// 填入下方常量即可在前端加载地图。未配置时 loadAMap 直接 reject，调用方降级展示占位说明。
export const AMAP_JS_KEY = '' // ← 填入高德 JS API Key（控制台「Web端(JS API)」）
export const AMAP_JS_SECURITY = '' // ← 填入高德 JS API 安全密钥

let amapPromise: Promise<any> | null = null

export function isAmapJsReady(): boolean {
  return !!(AMAP_JS_KEY && AMAP_JS_SECURITY)
}

export function loadAMap(): Promise<any> {
  if (!isAmapJsReady()) return Promise.reject(new Error('AMAP_JS_KEY not configured'))
  const w = window as any
  if (w.AMap) return Promise.resolve(w.AMap)
  if (amapPromise) return amapPromise
  amapPromise = new Promise((resolve, reject) => {
    w._AMapSecurityConfig = { securityJsCode: AMAP_JS_SECURITY }
    const cb = '__amapJsOnLoad'
    w[cb] = () => resolve(w.AMap)
    const s = document.createElement('script')
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_JS_KEY}&callback=${cb}`
    s.async = true
    s.onerror = () => reject(new Error('AMap script load failed'))
    document.head.appendChild(s)
  })
  return amapPromise
}
