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

  // 说明：district / poi / route 均为读取高德公开数据（行政区/POI/里程），无用户隐私，
  //   不做登录校验，未登录（预览模式）也可用，与轨迹一致。防刷依赖高德配额与 Key 白名单。

  if (!AMAP_WEB_KEY) {
    return new Response(JSON.stringify({ error: 'AMAP_WEB_KEY not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: {
    action?: string
    keywords?: string
    city?: string
    mode?: string
    origin?: string
    destination?: string
  }
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
  // route（里程）不需要 keywords，仅 district/poi 需要
  if (!keywords && action !== 'route') {
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

    // 里程计算：mode=driving(自驾·高德驾车) / transit(高铁·高德公交) / straight(飞机·大圆直线)
    // 输入 origin / destination 均为 "lng,lat"；返回 { km }
    if (action === 'route') {
      const mode = String(body.mode ?? 'straight')
      const origin = String(body.origin ?? '').trim()
      const destination = String(body.destination ?? '').trim()
      if (!origin || !destination) {
        return new Response(JSON.stringify({ error: 'origin/destination required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const [olng, olat] = origin.split(',').map(Number)
      const [dlng, dlat] = destination.split(',').map(Number)
      if ([olng, olat, dlng, dlat].some((n) => Number.isNaN(n))) {
        return new Response(JSON.stringify({ error: 'invalid coordinate' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      // 飞机：大圆距离（haversine）直线公里
      if (mode === 'straight') {
        const R = 6371.0088
        const toRad = (x: number) => (x * Math.PI) / 180
        const dLat = toRad(dlat - olat)
        const dLng = toRad(dlng - olng)
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(olat)) * Math.cos(toRad(dlat)) * Math.sin(dLng / 2) ** 2
        const km = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
        return new Response(JSON.stringify({ km }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      // 自驾：高德驾车路径规划 → distance(米)
      if (mode === 'driving') {
        const url = `${AMAP_BASE}/v3/direction/driving?origin=${origin}&destination=${destination}&strategy=0&extensions=base&key=${AMAP_WEB_KEY}`
        const res = await fetch(url)
        const json = await res.json()
        const meters = Number(json?.route?.paths?.[0]?.distance ?? 0)
        const km = Math.max(0, Math.round(meters / 1000))
        return new Response(JSON.stringify({ km }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      // 高铁：高德公交路线规划 → 取首方案 distance(米)（含铁路/大巴，贴合城际出行）
      if (mode === 'transit') {
        const url = `${AMAP_BASE}/v3/direction/transit?origin=${origin}&destination=${destination}&city1=&city2=&extensions=base&strategy=0&key=${AMAP_WEB_KEY}`
        const res = await fetch(url)
        const json = await res.json()
        const meters = Number(json?.route?.transits?.[0]?.distance ?? 0)
        const km = Math.max(0, Math.round(meters / 1000))
        return new Response(JSON.stringify({ km }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: 'unknown route mode' }), {
        status: 400,
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
