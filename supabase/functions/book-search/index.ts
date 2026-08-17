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
// 封面说明：suggest 给的是 /s/public/ 小图（必然存在），本函数尝试升级为 /l/public/ 大图，
// 若大图 HEAD 探测不存在则回退小图，避免破图。
//
// 部署（两种方式，任选其一）：
//   A. CLI（本地终端，需先 supabase login）：
//        supabase link --project-ref zvpsxbzxupkptyxfruny
//        supabase functions deploy book-search
//   B. Supabase Dashboard → Edge Functions → New Function，名称填 book-search，粘贴本文件代码保存即部署。
//   无需设置任何 Secret（豆瓣接口无需 key）。
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DOUBAN_SUGGEST = 'https://book.douban.com/j/subject_suggest'
const DOUBAN_REXXAR = 'https://m.douban.com/rexxar/api/v2/book'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

/** 封面：优先大图 /l/public/，HEAD 探测不存在则回退 suggest 给的 /s/public/ 小图（必然有效） */
async function bestCover(pic: string): Promise<string> {
  if (!pic) return ''
  const large = pic.replace('/s/public/', '/l/public/')
  if (large === pic) return pic
  try {
    const r = await fetch(large, {
      method: 'HEAD',
      headers: { 'User-Agent': UA, 'Referer': 'https://book.douban.com/' },
    })
    if (r.ok) return large
  } catch {
    /* 探测失败则回退小图 */
  }
  return pic
}

/** 豆瓣详情：大封面 / 作者（多作者「、」拼接）/ 简介(intro) / 标签(tags→类型) */
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
  if (!title) {
    return new Response(JSON.stringify({ error: 'title required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 候选切换：直接按 douban_id 拉详情（跳过 suggest）
  if (body.douban_id) {
    const det = await fetchDoubanDetail(body.douban_id)
    if (det) {
      return new Response(
        JSON.stringify({
          found: true,
          candidates: [],
          cover: det.cover,
          genre: det.genre,
          year: 0,
          cover_failed: !det.cover,
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

  // ① suggest 取候选（中文书名 / 作者 / 年 / 封面）
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

  // 候选封面：尝试升级大图，失败回退小图（防破图）
  const candidates = await Promise.all(
    items.slice(0, 8).map(async (it) => ({
      id: String(it.id ?? ''),
      title: it.title ?? '',
      year: it.year ? Number(it.year) : 0,
      cover: await bestCover(it.pic ?? ''),
      author: it.author_name ?? '',
    })),
  )

  const top = candidates[0]

  // ② 对首个候选拉详情，补大封面 / 作者 / 简介 / 类型
  const det = await fetchDoubanDetail(top.id)

  return new Response(
    JSON.stringify({
      found: true,
      candidates,
      cover: det?.cover || top.cover,
      genre: det?.genre ?? [],
      year: top.year,
      cover_failed: !(det?.cover || top.cover),
      overview: det?.overview ?? '',
      author: det?.author || top.author,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
