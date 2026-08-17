// supabase/functions/supabase-usage/index.ts
// 首页 Supabase 用量看板 · 服务端聚合
// ============================================================================
// 数据源：
//   ★ 主源（保底，永远可用）：SECURITY DEFINER RPC
//        get_db_size_bytes()     = pg_database_size（PG 逻辑库即时字节数）
//        get_storage_size_bytes()= storage.objects 文件字节求和（已排除 thumbnails 系统桶）
//   ★ 增强源：Supabase Management API（需 MGMT_TOKEN）。
//        ⚠️ 经实测，公开 Management API **没有** /v1/projects/{ref}/usage 聚合端点
//        （返回 404）。本函数改为「探测模式」：把一组候选端点全部打一遍，
//        把每个端点的真实返回打到日志（前缀 mgmt_probe），便于据此校准字段名。
//        若某端点真含 database/storage/egress/mau 字段，再解析使用。
//
// ⚠️ Secret Name 不能用 SUPABASE_ 前缀（Dashboard 校验拦截）。本函数读 MGMT_TOKEN。
//
// 部署：
//   方式 A（CLI）：supabase functions deploy supabase-usage
//                  supabase secrets set MGMT_TOKEN=sbp_xxx_xxxxxxxx   ← 可选（仅增强源）
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

interface ProbeResult {
  endpoint: string
  status: number
  ok: boolean
  preview: string
}

// 探测一组 Management API 候选端点，把每个的真实返回打日志并返回。
// 目的：查清哪个公开端点真正含有 database/storage/egress/mau 用量字段。
async function probeEndpoints(): Promise<ProbeResult[]> {
  const results: ProbeResult[] = []
  if (!MGMT_TOKEN || !PROJECT_REF) return results

  const host = 'https://api.supabase.com'
  const ref = PROJECT_REF
  // 官方文档确认存在 / 或可能有用量数据的候选端点
  const candidates = [
    `/v1/projects/${ref}`,
    `/v1/projects/${ref}/subscription`,
    `/v1/projects/${ref}/billing`,
    `/v1/projects/${ref}/endpoints/usage.api-counts`,
    `/v1/projects/${ref}/endpoints/usage.api-requests-count`,
  ]

  for (const ep of candidates) {
    try {
      const r = await fetch(host + ep, { headers: { Authorization: `Bearer ${MGMT_TOKEN}` } })
      const text = await r.text()
      results.push({ endpoint: ep, status: r.status, ok: r.ok, preview: text.slice(0, 1800) })
    } catch (e) {
      results.push({ endpoint: ep, status: -1, ok: false, preview: String(e) })
    }
  }

  // 从 project 详情里拿 organization id，再探 org 级端点
  const proj = results.find((x) => x.endpoint === `/v1/projects/${ref}`)
  if (proj && proj.ok) {
    try {
      const pj = JSON.parse(proj.preview) as Record<string, unknown>
      const org = (pj.organization_id ?? pj.organization_slug) as string | undefined
      if (org) {
        for (const sub of [`/v1/organizations/${org}`, `/v1/organizations/${org}/billing`]) {
          try {
            const r = await fetch(host + sub, { headers: { Authorization: `Bearer ${MGMT_TOKEN}` } })
            const text = await r.text()
            results.push({ endpoint: sub, status: r.status, ok: r.ok, preview: text.slice(0, 1800) })
          } catch (e) {
            results.push({ endpoint: sub, status: -1, ok: false, preview: String(e) })
          }
        }
      }
    } catch {
      /* ignore parse error */
    }
  }

  console.log('mgmt_probe:', JSON.stringify(results))
  return results
}

// 数值规整：若原值 > 1e6 视为已是字节，否则视为 MB→转字节
function toBytes(v: number): number {
  return v > 1_000_000 ? Math.round(v) : Math.round(v * 1024 * 1024)
}
function toMB(v: number): number {
  return v > 1_000_000 ? Math.round(v / 1024 / 1024) : Math.round(v)
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

  // db / storage 永远用 RPC 保底（真实字节数，与 Dashboard 计费口径有差异但真实）
  const supabase = mkAdmin()
  const [db_bytes, storage_bytes] = await Promise.all([
    rpcNumber(supabase, 'get_db_size_bytes'),
    rpcNumber(supabase, 'get_storage_size_bytes'),
  ])

  // 探测 Management API（诊断用，结果进日志 + 返回体 mgmt_probe 字段）
  const mgmt_probe = await probeEndpoints()

  const body = {
    plan: 'free',
    limits: FREE_PLAN_LIMITS,
    db_size_bytes: db_bytes,
    storage_size_bytes: storage_bytes,
    egress_mb: null,
    mau: null,
    mgmt_enabled: !!MGMT_TOKEN,
    mgmt_probe,
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
