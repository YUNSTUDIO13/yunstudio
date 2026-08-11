// TMDB 代理（Supabase Edge Function）
// 关键：TMDB_API_KEY 仅存于 Supabase 服务端密钥（v4 Bearer Token / JWT），
//       前端经本函数取元数据，绝不直接暴露 key。
// 图片本身走 image.tmdb.org 公开 CDN（无需 key），由前端直拉后压缩上传 Storage。
//
// 部署（v4 临牌由皇上在本地终端输入，不经 AI、不进 git）：
//   supabase functions deploy tmdb-proxy
//   supabase secrets set TMDB_API_KEY=eyJh...  ← v4 Bearer Token（JWT，eyJh... 开头）
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TMDB_API_KEY = Deno.env.get('TMDB_API_KEY') ?? ''
const TMDB_BASE = 'https://api.themoviedb.org/3'
const GENRE_MAP: Record<number, string> = {
  28: '动作', 12: '冒险', 16: '动画', 35: '喜剧', 80: '犯罪', 18: '剧情',
  14: '奇幻', 27: '恐怖', 9648: '悬疑', 10749: '爱情', 878: '科幻', 53: '惊悚',
  10752: '战争', 37: '西部',
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // 鉴权：要求登录态，匿名无法调用（防盗刷）
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: authData, error: authErr } = await supabaseClient.auth.getUser()
  if (authErr || !authData.user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!TMDB_API_KEY) {
    return new Response(JSON.stringify({ error: 'TMDB_API_KEY not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: { title?: string; year?: string | number }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const title = (body.title ?? '').toString().trim()
  if (!title) {
    return new Response(JSON.stringify({ error: 'title required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const year = body.year ? `&year=${encodeURIComponent(String(body.year))}` : ''

  // v4 Bearer 鉴权（读取访问令牌为长期有效，不自动过期；仅 dashboard 手动 Reset 才失效）
  const tmdbHeaders: HeadersInit = {
    accept: 'application/json',
    Authorization: `Bearer ${TMDB_API_KEY}`,
  }

  const searchRes = await fetch(
    `${TMDB_BASE}/search/movie?query=${encodeURIComponent(title)}${year}`,
    { headers: tmdbHeaders },
  )
  const searchJson = await searchRes.json()
  const m = searchJson.results?.[0]
  if (!m) {
    return new Response(JSON.stringify({ found: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 详情接口补 runtime（search 不含）
  let runtime = 0
  try {
    const detRes = await fetch(`${TMDB_BASE}/movie/${m.id}`, { headers: tmdbHeaders })
    const det = await detRes.json()
    runtime = det.runtime ?? 0
  } catch { /* ignore */ }

  const genre = ((m.genre_ids ?? []) as number[])
    .map((id: number) => GENRE_MAP[id])
    .filter(Boolean)

  return new Response(
    JSON.stringify({
      found: true,
      poster_path: m.poster_path ?? '',
      backdrop_path: m.backdrop_path ?? '',
      vote_average: typeof m.vote_average === 'number' ? Number(m.vote_average.toFixed(1)) : null,
      genre,
      origin_country: (m.origin_country ?? [])[0] ?? '',
      release_date: m.release_date ?? '',
      runtime,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
