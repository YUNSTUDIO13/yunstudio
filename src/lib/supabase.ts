import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // 未配置 env 时不至于直接崩，便于先跑通 UI；但所有认证请求会失败。
  console.warn(
    '[supabase] 缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，请复制 .env.example 为 .env 并填入。',
  )
}

// 纯前端直连 Supabase：会话持久化到 localStorage，token 自动刷新，
// detectSessionInUrl 用于承接邮箱验证回跳的 token。
export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'missing-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
