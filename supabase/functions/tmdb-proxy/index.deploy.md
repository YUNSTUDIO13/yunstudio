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
// ISO 3166-1 alpha-2 国家码 → 中文名（TMDB search 返回 origin_country 是数组 of ISO 码）
const COUNTRY_CN: Record<string, string> = {
  US: '美国', GB: '英国', CN: '中国', HK: '中国香港', TW: '中国台湾', MO: '中国澳门',
  JP: '日本', KR: '韩国', KP: '朝鲜', IN: '印度', FR: '法国', DE: '德国', IT: '意大利',
  ES: '西班牙', PT: '葡萄牙', RU: '俄罗斯', CA: '加拿大', AU: '澳大利亚', NZ: '新西兰',
  BR: '巴西', MX: '墨西哥', AR: '阿根廷', CL: '智利', NL: '荷兰', BE: '比利时', SE: '瑞典',
  NO: '挪威', DK: '丹麦', FI: '芬兰', IS: '冰岛', IE: '爱尔兰', CH: '瑞士', AT: '奥地利',
  PL: '波兰', CZ: '捷克', HU: '匈牙利', GR: '希腊', TR: '土耳其', IL: '以色列', EG: '埃及',
  ZA: '南非', NG: '尼日利亚', KE: '肯尼亚', TH: '泰国', VN: '越南', MY: '马来西亚', SG: '新加坡',
  ID: '印度尼西亚', PH: '菲律宾', PK: '巴基斯坦', BD: '孟加拉国', LK: '斯里兰卡', IR: '伊朗',
  IQ: '伊拉克', SA: '沙特阿拉伯', AE: '阿联酋', UA: '乌克兰', RO: '罗马尼亚', BG: '保加利亚',
}
// TMDB production_countries[].name 返回的英文长名 → 中文（即使 zh-CN 也不本地化）
const COUNTRY_EN: Record<string, string> = {
  'United States of America': '美国', 'United States': '美国', 'United Kingdom': '英国',
  'China': '中国', 'Hong Kong': '中国香港', 'Taiwan': '中国台湾', 'Macao': '中国澳门', 'Macau': '中国澳门',
  'Japan': '日本', 'South Korea': '韩国', 'North Korea': '朝鲜', 'India': '印度',
  'France': '法国', 'Germany': '德国', 'Italy': '意大利', 'Spain': '西班牙', 'Portugal': '葡萄牙',
  'Russia': '俄罗斯', 'Russian Federation': '俄罗斯', 'Canada': '加拿大', 'Australia': '澳大利亚',
  'New Zealand': '新西兰', 'Brazil': '巴西', 'Mexico': '墨西哥', 'Argentina': '阿根廷',
  'Chile': '智利', 'Netherlands': '荷兰', 'Belgium': '比利时', 'Sweden': '瑞典', 'Norway': '挪威',
  'Denmark': '丹麦', 'Finland': '芬兰', 'Iceland': '冰岛', 'Ireland': '爱尔兰', 'Switzerland': '瑞士',
  'Austria': '奥地利', 'Poland': '波兰', 'Czech Republic': '捷克', 'Hungary': '匈牙利',
  'Greece': '希腊', 'Turkey': '土耳其', 'Israel': '以色列', 'Egypt': '埃及', 'South Africa': '南非',
  'Nigeria': '尼日利亚', 'Kenya': '肯尼亚', 'Thailand': '泰国', 'Vietnam': '越南',
  'Malaysia': '马来西亚', 'Singapore': '新加坡', 'Indonesia': '印度尼西亚', 'Philippines': '菲律宾',
  'Pakistan': '巴基斯坦', 'Bangladesh': '孟加拉国', 'Sri Lanka': '斯里兰卡', 'Iran': '伊朗',
  'Iraq': '伊拉克', 'Saudi Arabia': '沙特阿拉伯', 'United Arab Emirates': '阿联酋',
  'Ukraine': '乌克兰', 'Romania': '罗马尼亚', 'Bulgaria': '保加利亚',
}
// 任意外文地区字符串 → 中文（先查 EN 长名 → ISO 码 → 模糊）
const toCNRegion = (raw: string): string => {
  if (!raw) return ''
  const en = COUNTRY_EN[raw]
  if (en) return en
  const iso = COUNTRY_CN[raw]
  if (iso) return iso
  // 已是中文则直通
  return raw
}
// 同时支持两种来源：①detail.production_countries[].name（英文长名）②search.origin_country[0]（ISO 码）
const pickRegion = (det: any): string => {
  const en = (det.production_countries ?? [])[0]?.name as string | undefined
  if (en) {
    const cn = toCNRegion(en)
    if (cn) return cn
  }
  const iso = (det.origin_country ?? [])[0] as string | undefined
  if (iso) return toCNRegion(iso)
  return ''
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

  let body: { title?: string; year?: string | number; tmdb_id?: number }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // v4 Bearer 鉴权（读取访问令牌为长期有效，不自动过期；仅 dashboard 手动 Reset 才失效）
  const tmdbHeaders: HeadersInit = {
    accept: 'application/json',
    Authorization: `Bearer ${TMDB_API_KEY}`,
  }

  // 统一从 TMDB 详情（含 credits）抽取字段：评分 / 类型 / 中文地区 / 时长 / 简介 / 演员表
  const buildDetail = (det: any) => {
    const runtime = det.runtime ?? 0
    const region = pickRegion(det)
    const gids = (det.genres ?? []).map((g: { id: number }) => g.id)
    const genre = gids.map((id: number) => GENRE_MAP[id]).filter(Boolean)
    const overview = typeof det.overview === 'string' ? det.overview : ''
    const cast = ((det.credits?.cast ?? []) as { name?: string }[])
      .slice(0, 12)
      .map((c) => c.name)
      .filter((n): n is string => !!n)
    return {
      poster_path: det.poster_path ?? '',
      backdrop_path: det.backdrop_path ?? '',
      vote_average: typeof det.vote_average === 'number' ? Number(det.vote_average.toFixed(1)) : null,
      genre,
      origin_country: region,
      release_date: det.release_date ?? '',
      runtime,
      overview,
      cast,
    }
  }

  // 候选切换：直接按 tmdb_id 拉详情（跳过 search）
  if (body.tmdb_id) {
    try {
      const detRes = await fetch(
        `${TMDB_BASE}/movie/${Number(body.tmdb_id)}?language=zh-CN&append_to_response=credits`,
        { headers: tmdbHeaders },
      )
      const det = await detRes.json()
      return new Response(
        JSON.stringify({ found: true, candidates: [], ...buildDetail(det) }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    } catch {
      return new Response(JSON.stringify({ error: 'detail fetch failed' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  const title = (body.title ?? '').toString().trim()
  if (!title) {
    return new Response(JSON.stringify({ error: 'title required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const year = body.year ? `&year=${encodeURIComponent(String(body.year))}` : ''

  // search 加 language=zh-CN 让 TMDB 返回中文地区/标题；取前 8 个候选供前端选择
  const searchRes = await fetch(
    `${TMDB_BASE}/search/movie?language=zh-CN&query=${encodeURIComponent(title)}${year}`,
    { headers: tmdbHeaders },
  )
  const searchJson = await searchRes.json()
  type SR = {
    id: number
    title?: string
    original_title?: string
    poster_path?: string | null
    backdrop_path?: string | null
    release_date?: string
    vote_average?: number
    genre_ids?: number[]
    origin_country?: string[]
  }
  const candidates = ((searchJson.results ?? []) as SR[]).slice(0, 8).map((r) => ({
    tmdb_id: r.id,
    title: r.title ?? r.original_title ?? '',
    year: r.release_date ? Number(String(r.release_date).slice(0, 4)) : 0,
    poster_path: r.poster_path ?? '',
    backdrop_path: r.backdrop_path ?? '',
    vote_average: typeof r.vote_average === 'number' ? Number(r.vote_average.toFixed(1)) : null,
    origin_country: toCNRegion((r.origin_country ?? [])[0] ?? ''),
  }))
  const first = candidates[0]
  if (!first) {
    return new Response(JSON.stringify({ found: false, candidates: [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 详情（含 credits）：补 runtime / 中文地区名 / 完整类型 / 简介 / 演员表
  let det: any = {}
  try {
    const detRes = await fetch(
      `${TMDB_BASE}/movie/${first.tmdb_id}?language=zh-CN&append_to_response=credits`,
      { headers: tmdbHeaders },
    )
    det = await detRes.json()
  } catch { /* ignore */ }

  return new Response(
    JSON.stringify({ found: true, candidates, ...buildDetail(det) }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
