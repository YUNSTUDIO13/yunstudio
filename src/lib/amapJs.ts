// 高德 JS API 加载器（前端地图渲染，用于「总览·轨迹预览」）。
// Key + 安全密钥不硬编码：由 Supabase Edge Function `amap-js-config` 从服务端 secrets 下发
// （登录态拉取，未配置时降级为不加载，页面显示占位说明）。
import { supabase } from './supabase'

let cfgPromise: Promise<{ key: string; security: string }> | null = null
const EMPTY = { key: '', security: '' }

async function fetchConfig(): Promise<{ key: string; security: string }> {
  if (cfgPromise) return cfgPromise
  const p = (async () => {
    try {
      // 超时控制：大陆网络下 supabase 慢，10s 快速失败，绝不让轨迹永远挂起
      const ctrl = new AbortController()
      const timer = window.setTimeout(() => ctrl.abort(), 10000)
      const { data, error } = await supabase.functions.invoke('amap-js-config', {
        signal: ctrl.signal,
      })
      window.clearTimeout(timer)
      if (error) return EMPTY
      return { key: data?.key ?? '', security: data?.security ?? '' }
    } catch {
      return EMPTY
    }
  })()
  cfgPromise = p
  const r = await p
  // 关键修复：失败不永久缓存——下次调用重试，避免首次网络失败后轨迹永远占位
  if (!r.key || !r.security) cfgPromise = null
  return r
}

export async function isAmapJsReady(): Promise<boolean> {
  const c = await fetchConfig()
  return !!(c.key && c.security)
}

let amapPromise: Promise<any> | null = null

export async function loadAMap(): Promise<any> {
  const c = await fetchConfig()
  if (!c.key || !c.security) return Promise.reject(new Error('AMAP_JS config not configured'))
  const w = window as any
  if (w.AMap) return Promise.resolve(w.AMap)
  if (amapPromise) return amapPromise
  amapPromise = new Promise((resolve, reject) => {
    w._AMapSecurityConfig = { securityJsCode: c.security }
    const cb = '__amapJsOnLoad'
    w[cb] = () => resolve(w.AMap)
    const s = document.createElement('script')
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${c.key}&callback=${cb}`
    s.async = true
    s.onerror = () => {
      amapPromise = null // 加载失败不缓存，允许重试
      reject(new Error('Amap script load failed'))
    }
    document.head.appendChild(s)
  })
  return amapPromise
}
