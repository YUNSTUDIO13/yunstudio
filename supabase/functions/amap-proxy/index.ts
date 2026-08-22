// 高德地图 Web 服务代理（Supabase Edge Function）
// 关键：AMAP_WEB_KEY 仅存于 Supabase 服务端密钥，前端经本函数调用，绝不暴露 key。
// 支持：
//   action=district  keywords=城市/区/县   → 行政区划查询（省/市/区/县 + adcode + 中心点坐标）
//   action=poi       keywords=POI city=可选 → POI 关键字搜索（机场/高铁站/酒店/景点/商户…）
// 部署（v4 临票由皇上在本地终端输入，不经 AI、不进 git）：
//   supabase functions deploy amap-proxy
//   supabase secrets set AMAP_WEB_KEY=你的高德Web服务Key
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const AMAP_WEB_KEY = Deno.env.get('AMAP_WEB_KEY') ?? ''
const AMAP_BASE = 'https://restapi.amap.com'
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

  if (!AMAP_WEB_KEY) {
    return new Response(JSON.stringify({ error: 'AMAP_WEB_KEY not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: { action?: string; keywords?: string; city?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const action = body.action ?? ''
  const keywords = (body.keywords ?? '').toString().trim()
  if (!keywords) {
    return new Response(JSON.stringify({ error: 'keywords required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    // 行政区划查询：支持省 / 市 / 区 / 县（如输入「长沙县」返回其 adcode 与中心点）
    if (action === 'district') {
      const url = `${AMAP_BASE}/v3/config/district?keywords=${encodeURIComponent(keywords)}&subdistrict=0&extensions=base&key=${AMAP_WEB_KEY}`
      const res = await fetch(url)
      const json = await res.json()
      const districts = Array.isArray(json.districts)
        ? json.districts.map((d: any) => ({
            name: d.name,
            adcode: d.adcode,
            center: d.center, // "lng,lat"
            level: d.level, // province / city / district
          }))
        : []
      return new Response(JSON.stringify({ districts }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // POI 关键字搜索：机场 / 高铁站 / 酒店 / 景点 / 商户（含地址、坐标、电话、评分）
    if (action === 'poi') {
      const city = body.city ? `&city=${encodeURIComponent(body.city)}&citylimit=true` : ''
      const url = `${AMAP_BASE}/v3/place/text?keywords=${encodeURIComponent(keywords)}&offset=20&extensions=all${city}&key=${AMAP_WEB_KEY}`
      const res = await fetch(url)
      const json = await res.json()
      const pois = Array.isArray(json.pois)
        ? json.pois.map((p: any) => ({
            id: p.id,
            name: p.name,
            address: p.address ?? '',
            location: p.location ?? '', // "lng,lat"
            type: p.type ?? '',
            tel: p.tel ?? '',
            rating: p.biz_ext?.rating ? String(p.biz_ext.rating) : '',
          }))
        : []
      return new Response(JSON.stringify({ pois }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'amap fetch failed', detail: String(e) }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
