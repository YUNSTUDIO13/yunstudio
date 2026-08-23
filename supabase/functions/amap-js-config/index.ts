// 高德 JS API 前端配置分发（Supabase Edge Function）
// 用途：轨迹地图（TrajectoryPreview）需要在浏览器端直接加载高德 JS API，
//   Key + 安全密钥由本函数从服务端 secrets 下发，前端不硬编码、不进 git。
// 说明：JS API Key 本就设计为前端公开加载（高德靠域名白名单约束），因此**不做登录校验**，
//   未登录（预览模式）也能加载轨迹，与旧版体验一致；放 secrets 仅为不入代码、可随时更换。
// 部署（v4 临票由皇上在本地终端输入，不经 AI、不进 git）：
//   supabase functions deploy amap-js-config
//   supabase secrets set AMAP_JS_KEY=你的JS_API_Key AMAP_JS_SECURITY=你的安全密钥
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  return new Response(
    JSON.stringify({
      key: Deno.env.get('AMAP_JS_KEY') ?? '',
      security: Deno.env.get('AMAP_JS_SECURITY') ?? '',
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
