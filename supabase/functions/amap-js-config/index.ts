// 高德 JS API 前端配置分发（Supabase Edge Function）
// 用途：轨迹地图（TrajectoryPreview）需要在浏览器端直接加载高德 JS API，
//   Key + 安全密钥由本函数从服务端 secrets 下发，前端不硬编码、不进 git。
// 注意：JS API Key 本就设计为前端可加载（高德靠域名白名单约束），
//   放服务端 secrets 是为了「不入代码、可随时更换、多环境统一」，并非绝对保密。
// 部署（v4 临票由皇上在本地终端输入，不经 AI、不进 git）：
//   supabase functions deploy amap-js-config
//   supabase secrets set AMAP_JS_KEY=你的JS_API_Key AMAP_JS_SECURITY=你的安全密钥
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // 鉴权：要求登录态，匿名无法拉取（防盗刷）
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

  return new Response(
    JSON.stringify({
      key: Deno.env.get('AMAP_JS_KEY') ?? '',
      security: Deno.env.get('AMAP_JS_SECURITY') ?? '',
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
