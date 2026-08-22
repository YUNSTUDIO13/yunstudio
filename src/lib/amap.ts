// 高德地图 Web 服务封装（前端）
// 所有高德调用经 Supabase Edge Function 代理（amap-proxy），AMAP_WEB_KEY 仅存于服务端密钥，不暴露前端。
// 未配置 key / 网络失败时返回空数组，调用方降级为「手动输入」。
import { supabase } from './supabase'

export interface AMapDistrict {
  name: string
  adcode: string
  center: string // "lng,lat"
  level: string // province | city | district
}

export interface AMapPoi {
  id: string
  name: string
  address: string
  location: string // "lng,lat"
  type?: string
  tel?: string
  rating?: string
}

async function invokeAmap(body: Record<string, unknown>): Promise<any | null> {
  try {
    const { data, error } = await supabase.functions.invoke('amap-proxy', { body })
    if (error) {
      console.warn('[amap] invoke error:', error.message)
      return null
    }
    return data
  } catch (e) {
    console.warn('[amap] invoke failed:', e)
    return null
  }
}

/** 行政区划查询：输入「长沙县」返回其 adcode / 中心点 / 级别（支持省/市/区/县） */
export async function amapSearchDistrict(keywords: string): Promise<AMapDistrict[]> {
  const d = await invokeAmap({ action: 'district', keywords })
  return d && Array.isArray(d.districts) ? (d.districts as AMapDistrict[]) : []
}

/** POI 关键字搜索：机场 / 高铁站 / 酒店 / 景点 / 商户，可选限定城市 */
export async function amapSearchPoi(keywords: string, city?: string): Promise<AMapPoi[]> {
  const d = await invokeAmap({ action: 'poi', keywords, city })
  return d && Array.isArray(d.pois) ? (d.pois as AMapPoi[]) : []
}
