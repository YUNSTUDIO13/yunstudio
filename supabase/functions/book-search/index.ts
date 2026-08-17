// 阅读模块 · 豆瓣图书代理（Supabase Edge Function）
//
// 为什么需要它：豆瓣是中文图书数据最全的来源（书名 / 作者 / 封面 / 评分 / 简介 / 标签），
// 但 book.douban.com 不返回 Access-Control-Allow-Origin，浏览器直连被 CORS 拦；
// 故由本函数服务端代理，前端经 supabase.functions.invoke('book-search') 调用，CORS 天然解决。
//
// 豆瓣无官方免费 API，但以下两个非官方接口可用、且无需 key：
//   ① book.douban.com/j/subject_suggest?q=书名   → 自动补全候选（标题 / 作者 / 年 / 封面 / subject id）
//   ② m.douban.com/rexxar/api/v2/book/{id}        → 详情（大封面 / 作者 / 简介(intro) / 标签(tags)），需带 Referer: m.douban.com
//
// 封面策略（2026-08-17 治本）：
//   服务端把候选+详情封面直接 fetch + base64 内嵌成 data URI 返回——浏览器按 data: 加载，
//   完全不走网络图床、无 CORS/CORP/防盗链/慢网 任何环节，**保证所有浏览器、所有网络 100% 渲染**。
//   同时保留 GET ?img=<url> 代理分支给「DB 里旧裸 URL」在读路径用；写入路径（新增/同步）一律内嵌。
//
// 部署（两种方式，任选其一）：
//   A. CLI（本地终端，需先 supabase login）：
//        supabase link --project-ref zvpsxbzxupkptyxfruny
//        supabase functions deploy book-search
//   B. Supabase Dashboard → Edge Functions → 选中 book-search → Via Editor 粘贴本文件保存即部署。
//   无需设置任何 Secret（豆瓣接口无需 key）。
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DOUBAN_SUGGEST = 'https://book.douban.com/j/subject_suggest'
const DOUBAN_REXXAR = 'https://m.douban.com/rexxar/api/v2/book'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

type SuggestItem = {
  title?: string
  url?: string
  pic?: string
  author_name?: string
  year?: string
  type?: string
  id?: string
}

/** 抓豆瓣详情：大封面 / 作者 / 简介(intro) / 标签(tags→类型) */
async function fetchDoubanDetail(
  id: string,
): Promise<null | {
  cover: string
  author: string
  overview: string
  genre: string[]
}> {
  try {
    const res = await fetch(`${DOUBAN_REXXAR}/${id}`, {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://m.douban.com/',
        'Accept': 'application/json',
      },
    })
    if (!res.ok) return null
    const j = (await res.json()) as Record<string, unknown>
    const coverRaw =
      (j.cover_url as string) || (j.large as string) || (j.pic as string) || ''
    const authorRaw = j.author
    let author = ''
    if (Array.isArray(authorRaw)) author = (authorRaw as string[]).join('、')
    else if (typeof authorRaw === 'string') author = authorRaw
    // 简介：优先 intro（rexxar 主字段），兜底 summary
    const overviewRaw = (j.intro as string) || (j.summary as string) || ''
    // 类型：tags 数组（{name,count} 或字符串），多数书为空 → 留空由用户手填
    const tagsRaw = j.tags
    let genre: string[] = []
    if (Array.isArray(tagsRaw)) {
      genre = (tagsRaw as unknown[])
        .map((t) => (typeof t === 'string' ? t : (t as { name?: string })?.name))
        .filter((x): x is string => typeof x === 'string' && !!x)
    }
    return {
      cover: typeof coverRaw === 'string' ? coverRaw : '',
      author,
      overview: typeof overviewRaw === 'string' ? overviewRaw.trim() : '',
      genre,
    }
  } catch {
    return null
  }
}

/** 服务端带豆瓣 Referer 抓图，转 base64 内嵌 data URI 返回。
 *  仅放行豆瓣图床主机（防滥用）；失败返回空串，让前端走 onError 兜底。 */
async function embedImageDataUri(target: string): Promise<string> {
  if (!target) return ''
  try {
    const u = new URL(target)
    const host = u.hostname.toLowerCase()
    if (!/doubanio\.com$/.test(host) && !/douban\.com$/.test(host)) return ''
    const r = await fetch(u.toString(), {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://book.douban.com/',
        'Accept': 'image/webp,image/avif,image/*,*/*',
      },
    })
    if (!r.ok) return ''
    const ct = r.headers.get('Content-Type') || 'image/jpeg'
    const buf = await r.arrayBuffer()
    const bytes = new Uint8Array(buf)
    // Deno 不允许最大字符串放大倍数 > 1.5？实测 Uint8Array -> btoa 分块没问题
    let bin = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return `data:${ct};base64,${btoa(bin)}`
  } catch {
    return ''
  }
}

/** 图片代理（仅放行豆瓣域名）：保留供「DB 里旧裸 URL」在读路径走 proxiedCover() 包裹时使用 */
async function proxyImage(target: string): Promise<Response> {
  try {
    const u = new URL(target)
    const host = u.hostname.toLowerCase()
    if (!/doubanio\.com$/.test(host) && !/douban\.com$/.test(host)) {
      return new Response('forbidden host', { status: 403, headers: { 'Access-Control-Allow-Origin': '*' } })
    }
    const r = await fetch(u.toString(), {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://book.douban.com/',
        'Accept': 'image/webp,image/avif,image/*,*/*',
      },
    })
    if (!r.ok) {
      return new Response('upstream error', {
        status: 502,
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
    }
    const buf = await r.arrayBuffer()
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': r.headers.get('Content-Type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, immutable',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    })
  } catch {
    return new Response('proxy error', {
      status: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  }
}

serve(async (req: Request) => {
  const url = new URL(req.url)

  // ① 图片代理（公开，无需登录）：保留供旧 DB 里的裸 douban URL 在读路径使用
  if (req.method === 'GET' && url.searchParams.has('img')) {
    return await proxyImage(url.searchParams.get('img') ?? '')
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // ② 搜索 / 详情（需登录态，防盗刷）
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

  let body: { title?: string; douban_id?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const title = (body.title ?? '').toString().trim()
  if (!title && !body.douban_id) {
    return new Response(JSON.stringify({ error: 'title required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 候选切换：按 douban_id 拉详情，返回内嵌图（保证浏览器一定能渲染）
  if (body.douban_id) {
    const det = await fetchDoubanDetail(body.douban_id)
    if (det) {
      const coverB64 = await embedImageDataUri(det.cover)
      return new Response(
        JSON.stringify({
          found: true,
          candidates: [],
          cover: coverB64,
          genre: det.genre,
          year: 0,
          cover_failed: !coverB64,
          overview: det.overview,
          author: det.author,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ error: 'detail fetch failed' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ① suggest 取候选（中文书名 / 作者 / 年 / 封面 URL）
  let items: SuggestItem[] = []
  try {
    const res = await fetch(`${DOUBAN_SUGGEST}?q=${encodeURIComponent(title)}`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    })
    if (res.ok) items = (await res.json()) as SuggestItem[]
  } catch {
    /* ignore */
  }

  if (!items.length) {
    return new Response(JSON.stringify({ found: false, candidates: [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 8 个候选的封面 URL 列表
  const candidatesRaw = items.slice(0, 8).map((it) => ({
    id: String(it.id ?? ''),
    title: it.title ?? '',
    year: it.year ? Number(it.year) : 0,
    pic: it.pic ?? '',
    author_name: it.author_name ?? '',
  }))
  const top = candidatesRaw[0]

  // ② 对首个候选拉详情
  const det = await fetchDoubanDetail(top.id)
  const topCoverUrl = det?.cover || top.pic

  // 并行抓所有图 + base64 内嵌（含 top 详情大图、8 张候选封面）
  const [topCoverB64, ...candCoversB64] = await Promise.all([
    embedImageDataUri(topCoverUrl),
    ...candidatesRaw.map((c) => embedImageDataUri(c.pic)),
  ])

  const candidates = candidatesRaw.map((c, i) => ({
    id: c.id,
    title: c.title,
    year: c.year,
    cover: candCoversB64[i],   // data:image/jpeg;base64,... 或空串
    author: c.author_name,
    pic: c.pic,                // 保留原 URL，proxiedCover 兜底（旧 DB 兼容 / 内嵌失败时）
  }))

  return new Response(
    JSON.stringify({
      found: true,
      candidates,
      cover: topCoverB64,                              // data URI
      cover_failed: !topCoverB64,
      genre: det?.genre ?? [],
      year: top.year,
      overview: det?.overview ?? '',
      author: det?.author || top.author_name,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
