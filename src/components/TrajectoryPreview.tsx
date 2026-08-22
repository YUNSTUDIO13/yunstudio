import { useEffect, useMemo, useRef, useState } from 'react'
import type { TravelDay } from '../types'
import { loadAMap, isAmapJsReady } from '../lib/amapJs'

interface Stop {
  lng: number
  lat: number
  title: string
  type: string
  time: string
}

// 第7条：总览底部轨迹预览。按 Day1/Day2… 切换，当日站点按时间排序后在地图上连成轨迹。
// 依赖高德 JS API（amapJs.ts 配置 Key 后生效）；未配置或当日无坐标点时显示占位说明。
export default function TrajectoryPreview({ days }: { days: TravelDay[] }) {
  const [active, setActive] = useState(0)
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)

  // 当日含坐标的站点，按时间（HH:MM）升序
  const stops = useMemo<Stop[]>(() => {
    const day = days[active]
    if (!day) return []
    return day.items
      .filter((it) => it.location && it.location.includes(','))
      .map((it) => {
        const [lng, lat] = it.location!.split(',').map(Number)
        return { lng, lat, title: it.title || it.type, type: it.type, time: it.time }
      })
      .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
  }, [days, active])

  useEffect(() => {
    if (!isAmapJsReady() || !mapEl.current) return
    let mounted = true
    loadAMap()
      .then((AMap) => {
        if (!mounted || !mapEl.current) return
        if (!mapRef.current) {
          mapRef.current = new AMap.Map(mapEl.current, { zoom: 11, viewMode: '2D' })
        }
        const map = mapRef.current
        map.clearMap()
        if (!stops.length) return
        const path = stops.map((s) => [s.lng, s.lat])
        const markers = stops.map(
          (s, i) =>
            new AMap.Marker({
              position: [s.lng, s.lat],
              title: `${s.title}（${s.time}）`,
              label: { content: String(i + 1), direction: 'top' },
            }),
        )
        map.add(markers)
        if (path.length > 1) {
          map.add(
            new AMap.Polyline({
              path,
              strokeColor: '#1e80ff',
              strokeWeight: 4,
              strokeOpacity: 0.85,
              showDir: true,
            }),
          )
        }
        map.setFitView()
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [stops, active])

  if (!days.length) return null

  return (
    <div className="traj-preview">
      <div className="traj-head">
        <div className="label">轨迹预览</div>
        <div className="traj-tabs">
          {days.map((_, i) => (
            <button
              key={i}
              type="button"
              className={i === active ? 'traj-tab active' : 'traj-tab'}
              onClick={() => setActive(i)}
            >
              Day {i + 1}
            </button>
          ))}
        </div>
      </div>
      <div className="traj-map" ref={mapEl}>
        {!isAmapJsReady() && (
          <div className="traj-empty">配置高德 JS API Key 后显示每日轨迹（src/lib/amapJs.ts）</div>
        )}
        {isAmapJsReady() && !stops.length && (
          <div className="traj-empty">当日暂无带坐标的地点（用「高德搜索」添加地点即可生成轨迹）</div>
        )}
      </div>
    </div>
  )
}
