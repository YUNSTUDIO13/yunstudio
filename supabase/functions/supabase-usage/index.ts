// supabase/functions/supabase-usage/index.ts
// 首页 Supabase 用量看板 · 服务端聚合
// ============================================================================
// 数据源：
//   1) DATABASE SIZE    ← supabase.rpc('get_db_size_bytes')    SECURITY DEFINER
//   2) FILE STORAGE     ← supabase.rpc('get_storage_size_bytes') SECURITY DEFINER
//   3) EGRESS / MAU     ← https://api.supabase.com/v1/projects/{ref}/usage
//                          （需 MGMT_TOKEN 个人访问令牌 PAT，非必须；
//                          不配则这两项返回 null，前端显示「—」）
//
// ⚠️ Secret Name 不能用 SUPABASE_ 前缀（Dashboard 校验拦截，会报错
//   "Name must not start with the SUPABASE_ prefix"），保留前缀给系统变量。
//
// 部署：
//   方式 A（CLI 推荐）：
//     supabase functions deploy supabase-usage
//     supabase secrets set MGMT_TOKEN=sbp_xxx_xxxxxxxx   ← 可选
//
//   方式 B（Dashboard）：
//     Edge Functions → New function → 选 Deno → 粘本文件 → Deploy
//     ⚠️ Secrets 不在「函数级 Settings」里，而是项目级独立页面：
//        左导 Edge Functions → 顶部 Secrets（项目级）→ Add new secret
//        Key=MGMT_TOKEN  Value=sbp_xxx_xxxxxxxx
//        或直接打开：https://supabase.com/dashboard/project/<ref>/functions/secrets
//     设置后无需重新部署函数，下次调用自动实时读取。
//
// ⚠️ 函数本身不开 CORS 给浏览器直接 fetch 调；前端走 supabase.functions.invoke，
//    平台自动附加 anon key 走网关校验。

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const MGMT_TOKEN = Deno.env.get('MGMT_TOKEN') ?? ''

// 兼容方式：从 SUPABASE_URL 反推 ref（如 zvpsxbzxupkptyxfruny.supabase.co）
function deriveRef(url: string): string {
  try {
    const host = new URL(url).host
    return host.split('.')[0]
  } catch {
    return ''
  }
}
const PROJECT_REF = deriveRef(SUPABASE_URL)

// Free plan 限额（按 dashboard 当前显示的常量；后续切 Pro 改 SUPABASE_PLAN env）
const FREE_PLAN_LIMITS = {
  egress_mb: 5 * 1024,    // 5 GB
  db_size_mb: 500,        // 500 MB
  mau: 50_000,
  storage_mb: 1024,       // 1 GB
}

// ── 工具：service_role 调 RPC ────────────────────────────────────────────────
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

// ── Management API：Egress / MAU（需 PAT） ────────────────────────────────────
interface MgmtUsage {
  egress_mb: number | null
  mau: number | null
  raw: unknown
}

async function fetchMgmtUsage(): Promise<MgmtUsage> {
  if (!MGMT_TOKEN || !PROJECT_REF) return { egress_mb: null, mau: null, raw: null }
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/usage`, {
      headers: { Authorization: `Bearer ${MGMT_TOKEN}` },
    })
    if (!r.ok) {
      const t = await r.text().catch(() => '')
      console.error(`mgmt /usage ${r.status}: ${t.slice(0, 200)}`)
      return { egress_mb: null, mau: null, raw: t.slice(0, 200) }
    }
    const j = (await r.json()) as Record<string, unknown>
    // 字段名按 supabase 后端版本可能微调；做宽松取值
    const egress =
      (j.egress_mb as number | undefined) ??
      ((j.egress as Record<string, unknown> | undefined)?.used_mb as number | undefined) ??
      ((j.egress as Record<string, unknown> | undefined)?.used as number | undefined) ??
      null
    const mau =
      (j.mau as number | undefined) ??
      ((j.monthly_active_users as number | undefined) ?? null) ??
      ((j.auth as Record<string, unknown> | undefined)?.mau as number | undefined) ??
      null
    return {
      egress_mb: typeof egress === 'number' ? egress : null,
      mau: typeof mau === 'number' ? mau : null,
      raw: j,
    }
  } catch (e) {
    console.error('mgmt fetch failed', e instanceof Error ? e.message : e)
    return { egress_mb: null, mau: null, raw: null }
  }
}

// ── 入口 ──────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
      },
    })
  }

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return new Response(JSON.stringify({ error: 'function env missing (SUPABASE_URL/SERVICE_ROLE_KEY)' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  const supabase = mkAdmin()
  const [db_bytes, storage_bytes, mgmt] = await Promise.all([
    rpcNumber(supabase, 'get_db_size_bytes'),
    rpcNumber(supabase, 'get_storage_size_bytes'),
    fetchMgmtUsage(),
  ])

  const body = {
    plan: 'free',
    limits: FREE_PLAN_LIMITS,
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
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
})