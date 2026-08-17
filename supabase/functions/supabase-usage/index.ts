// supabase/functions/supabase-usage/index.ts
// 首页 Supabase 用量看板 · 服务端聚合
// ============================================================================
// 数据源（按优先级）：
//   ★ 主源：Supabase Management API  GET /v1/projects/{ref}/usage
//          —— 这是 Supabase Dashboard「Usage」页自己的权威数据源，口径完全一致。
//            返回 database_size_bytes / storage_size_bytes / bandwidth_bytes / mau
//            等字段，本函数对其做防御式多字段名解析，命中即取。
//   ★ 回退：仅当 MGMT_TOKEN 缺失或 API 调用失败时，才用 SECURITY DEFINER RPC
//          get_db_size_bytes / get_storage_size_bytes（pg_database_size + storage.objects 求和）。
//          —— 注意：RPC 口径 ≠ Dashboard 口径（差十几 MB 属正常），仅作兜底。
//
// ⚠️ Secret Name 不能用 SUPABASE_ 前缀（Dashboard 校验拦截：
//   "Name must not start with the SUPABASE_ prefix"）。本函数读 MGMT_TOKEN。
//
// 部署：
//   方式 A（CLI）：supabase functions deploy supabase-usage
//                  supabase secrets set MGMT_TOKEN=sbp_xxx_xxxxxxxx   ← 必需（否则 4 项不全）
//   方式 B（Dashboard）：Edge Functions → New function → 选 Deno → 粘本文件 → Deploy
//         Secrets 在「项目级」独立页：左导 Edge Functions → 顶部 Secrets → Add new secret
//         或直接开 https://supabase.com/dashboard/project/<ref>/functions/secrets
//         ★ 设完无需重新部署，官方明确："They're available immediately in your functions"。
//
// ⚠️ CORS：每个 Response（OPTIONS / 200 / 500）都必须显式带 ACAO 头，
//    Supabase Edge Function 网关不会自动注入；缺失 → opaque response →
//    supabase.functions.invoke 报 FunctionsFetchError。

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const MGMT_TOKEN = Deno.env.get('MGMT_TOKEN') ?? ''

// 从 SUPABASE_URL 反推 ref（如 zvpsxbzxupkptyxfruny.supabase.co）
function deriveRef(url: string): string {
  try {
    return new URL(url).host.split('.')[0]
  } catch {
    return ''
  }
}
const PROJECT_REF = deriveRef(SUPABASE_URL)

// Free plan 限额兜底（当 Management API 的 limit 字段取不到时用）
const FREE_PLAN_LIMITS = {
  egress_mb: 5 * 1024, // 5 GB
  db_size_mb: 500, // 500 MB
  mau: 50_000,
  storage_mb: 1024, // 1 GB
}

// CORS 头（Supabase Edge Function 不会自动注入 ACAO，每个 Response 都得显式带）
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}

function mkAdmin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function rpcNumber(supabase: ReturnType<typeof createClient>, name: string): Promise<number | null> {
  const { data, error } = await supabase.rpc(name)
  if (error) {
    console.error(`rpc ${name} failed`, error.message)
    return null
  }
  if (typeof data === 'number') return data
  if (typeof data === 'string') {
    const n = Number(data)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// 嵌套取值
function getPath(obj: unknown, path: string[]): unknown {
  let v: unknown = obj
  for (const k of path) {
    if (v == null || typeof v !== 'object') return undefined
    v = (v as Record<string, unknown>)[k]
  }
  return v
}

// 从 Management API 响应里抽取一个指标的 usage + limit，兼容多种字段命名
function extractMetric(j: Record<string, unknown>, usagePaths: string[][], limitPaths: string[][]): {
  usage: number | null
  limit: number | null
} {
  let usage: number | null = null
  for (const p of usagePaths) {
    const v = getPath(j, p)
    const n = typeof v === 'string' ? Number(v) : v
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) {
      usage = n
      break
    }
  }
  let limit: number | null = null
  for (const p of limitPaths) {
    const v = getPath(j, p)
    const n = typeof v === 'string' ? Number(v) : v
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
      limit = n
      break
    }
  }
  return { usage, limit }
}

// 数值规整：若原值 > 1e6 视为已是字节，否则视为 MB→转字节
function toBytes(v: number): number {
  return v > 1_000_000 ? Math.round(v) : Math.round(v * 1024 * 1024)
}
function toMB(v: number): number {
  return v > 1_000_000 ? Math.round(v / 1024 / 1024) : Math.round(v)
}

interface MgmtUsage {
  db_size_bytes: number | null
  storage_size_bytes: number | null
  egress_mb: number | null
  mau: number | null
  limits: typeof FREE_PLAN_LIMITS
  raw: unknown
  ok: boolean
}

// Management API：4 项指标全部从这里取（与 Dashboard 同源）
async function fetchMgmtUsage(): Promise<MgmtUsage> {
  const fallback: MgmtUsage = {
    db_size_bytes: null,
    storage_size_bytes: null,
    egress_mb: null,
    mau: null,
    limits: FREE_PLAN_LIMITS,
    raw: null,
    ok: false,
  }
  if (!MGMT_TOKEN || !PROJECT_REF) return fallback
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/usage`, {
      headers: { Authorization: `Bearer ${MGMT_TOKEN}` },
    })
    if (!r.ok) {
      const t = await r.text().catch(() => '')
      console.error(`mgmt /usage ${r.status}: ${t.slice(0, 300)}`)
      return fallback
    }
    const j = (await r.json()) as Record<string, unknown>
    // 打日志便于核验字段名（Supabase 各版本返回结构略有差异）
    console.log('mgmt usage raw:', JSON.stringify(j).slice(0, 3000))

    const db = extractMetric(
      j,
      [['database_size', 'usage'], ['database_size_bytes'], ['db_size', 'usage'], ['db_size_bytes'], ['databaseSizeBytes']],
      [['database_size', 'limit'], ['database_size_bytes_limit'], ['db_size_limit']],
    )
    const storage = extractMetric(
      j,
      [['storage', 'usage'], ['storage_size_bytes'], ['storage_size', 'usage'], ['storageSizeBytes']],
      [['storage', 'limit'], ['storage_size_bytes_limit'], ['storage_limit']],
    )
    const egress = extractMetric(
      j,
      [['egress', 'usage'], ['egress_bytes'], ['bandwidth_bytes'], ['egress', 'used_mb'], ['bandwidth', 'usage']],
      [['egress', 'limit'], ['egress_bytes_limit'], ['bandwidth_limit']],
    )
    const mau = extractMetric(
      j,
      [['maus', 'usage'], ['mau'], ['monthly_active_users'], ['auth', 'mau'], ['mau_count']],
      [['maus', 'limit'], ['mau_limit'], ['monthly_active_users_limit']],
    )

    const limits = {
      egress_mb: egress.limit != null ? toMB(egress.limit) : FREE_PLAN_LIMITS.egress_mb,
      db_size_mb: db.limit != null ? toMB(db.limit) : FREE_PLAN_LIMITS.db_size_mb,
      mau: mau.limit != null ? Math.round(mau.limit) : FREE_PLAN_LIMITS.mau,
      storage_mb: storage.limit != null ? toMB(storage.limit) : FREE_PLAN_LIMITS.storage_mb,
    }

    return {
      db_size_bytes: db.usage != null ? toBytes(db.usage) : null,
      storage_size_bytes: storage.usage != null ? toBytes(storage.usage) : null,
      egress_mb: egress.usage != null ? toMB(egress.usage) : null,
      mau: mau.usage != null ? Math.round(mau.usage) : null,
      limits,
      raw: j,
      ok: true,
    }
  } catch (e) {
    console.error('mgmt fetch failed', e instanceof Error ? e.message : e)
    return fallback
  }
}

// ── 入口 ──────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return new Response(JSON.stringify({ error: 'function env missing (SUPABASE_URL/SERVICE_ROLE_KEY)' }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }

  const mgmt = await fetchMgmtUsage()

  // db / storage 若 Management API 没拿到（无 token 或字段未命中），回退 RPC
  let db_bytes = mgmt.db_size_bytes
  let storage_bytes = mgmt.storage_size_bytes
  if (db_bytes == null || storage_bytes == null) {
    const supabase = mkAdmin()
    const [rpcDb, rpcStorage] = await Promise.all([
      rpcNumber(supabase, 'get_db_size_bytes'),
      rpcNumber(supabase, 'get_storage_size_bytes'),
    ])
    if (db_bytes == null) db_bytes = rpcDb
    if (storage_bytes == null) storage_bytes = rpcStorage
  }

  const body = {
    plan: 'free',
    limits: mgmt.limits,
    db_size_bytes: db_bytes,
    storage_size_bytes: storage_bytes,
    egress_mb: mgmt.egress_mb,
    mau: mgmt.mau,
    mgmt_enabled: !!MGMT_TOKEN,
    project_ref: PROJECT_REF,
    fetched_at: new Date().toISOString(),
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
})
