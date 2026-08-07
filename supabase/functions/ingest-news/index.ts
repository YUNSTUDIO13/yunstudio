// ============================================================
// Supabase Edge Function: ingest-news
// 推送入口：校验 x-api-key → 用 service_role 写入 news 表
// user_id 取自环境变量 NEWS_OWNER_ID（单人项目：皇上自己的 auth.uid）
//
// 部署（需 Supabase CLI 已登录）：
//   supabase functions deploy ingest-news
// 环境变量（Supabase 控制台 → Settings → Edge Functions → Secrets，或 CLI）：
//   NEWS_API_KEY      自定义共享密钥（与调用方一致）
//   NEWS_OWNER_ID     皇上在 Supabase 的 user id（SQL: select id from auth.users;）
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  自动注入，无需手填
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const API_KEY = (Deno.env.get('NEWS_API_KEY') ?? '').trim()
const OWNER_ID = (Deno.env.get('NEWS_OWNER_ID') ?? '').trim()

interface SourceLink {
  title: string
  url: string
}
interface NewsPayload {
  title: string
  summary?: string
  content: string
  category?: string
  report_type?: string
  tags?: string[]
  source_links?: SourceLink[]
  period_start?: string | null
  period_end?: string | null
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'x-api-key, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  // 预检
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 204, headers: corsHeaders() })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405)
  }

  // 1) 鉴权
  const provided = (req.headers.get('x-api-key') ?? '').trim()
  if (!API_KEY || provided !== API_KEY) {
    return json({ error: 'unauthorized' }, 401)
  }
  if (!OWNER_ID) {
    return json({ error: 'server misconfigured: NEWS_OWNER_ID missing' }, 500)
  }

  // 2) 解析
  let body: NewsPayload
  try {
    body = (await req.json()) as NewsPayload
  } catch {
    return json({ error: 'invalid json' }, 400)
  }
  if (!body.title || !body.content) {
    return json({ error: 'title and content are required' }, 400)
  }

  // 3) 写入（service_role 绕过 RLS，强制归属 OWNER_ID）
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  const { data, error } = await supabase
    .from('news')
    .insert({
      user_id: OWNER_ID,
      title: body.title,
      summary: body.summary ?? '',
      content: body.content,
      category: body.category ?? 'general',
      report_type: body.report_type ?? 'manual',
      tags: body.tags ?? [],
      source_links: body.source_links ?? [],
      period_start: body.period_start ?? null,
      period_end: body.period_end ?? null,
    })
    .select()
    .single()

  if (error) {
    return json({ error: error.message }, 500)
  }
  return json({ ok: true, data }, 200)
})
