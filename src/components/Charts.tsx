// 轻量 SVG 图表组件（无第三方依赖）

/** 迷你趋势线（Sparkline）：用于 KPI 卡 */
export function Sparkline({
  data,
  width = 120,
  height = 36,
  color = '#2D8A8A',
}: {
  data: number[]
  width?: number
  height?: number
  color?: string
}) {
  if (!data || data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const step = width / (data.length - 1)
  const pts = data.map((v, i) => {
    const x = i * step
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const last = pts[pts.length - 1].split(',')
  const areaPath = `M0,${height} L${pts.join(' L')} L${width},${height} Z`
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={areaPath} fill={color} opacity={0.08} />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r={2.6} fill={color} />
    </svg>
  )
}

/** 燃尽图：actual 实际剩余 vs ideal 理想剩余，用于迭代卡 */
export function Burndown({
  actual,
  width = 280,
  height = 84,
  accent = '#2D8A8A',
}: {
  actual: number[]
  width?: number
  height?: number
  accent?: string
}) {
  if (!actual || actual.length < 2) return null
  const max = Math.max(actual[0], 1)
  const pad = 6
  const step = (width - pad * 2) / (actual.length - 1)
  const toXY = (v: number, i: number) => {
    const x = pad + i * step
    const y = pad + (1 - v / max) * (height - pad * 2)
    return [x, y] as const
  }
  const actualPts = actual.map((v, i) => toXY(v, i))
  const idealStart = actual[0]
  const idealEnd = 0
  const idealPts = actual.map((_, i) => {
    const t = i / (actual.length - 1)
    const v = idealStart + (idealEnd - idealStart) * t
    return toXY(v, i)
  })
  const fmt = (p: readonly [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`
  return (
    <svg width={width} height={height} className="overflow-visible">
      <line
        x1={pad}
        y1={height - pad}
        x2={width - pad}
        y2={height - pad}
        stroke="#E8E4DA"
        strokeWidth={1}
      />
      <polyline
        points={idealPts.map(fmt).join(' ')}
        fill="none"
        stroke="#9A9CA3"
        strokeWidth={1.5}
        strokeDasharray="4 4"
        strokeLinecap="round"
      />
      <polyline
        points={actualPts.map(fmt).join(' ')}
        fill="none"
        stroke={accent}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={actualPts[actualPts.length - 1][0]}
        cy={actualPts[actualPts.length - 1][1]}
        r={3}
        fill={accent}
      />
    </svg>
  )
}
