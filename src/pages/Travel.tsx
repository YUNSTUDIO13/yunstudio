import { useEffect, useMemo, useRef, useState } from 'react'
import { geoMercator, geoPath, type GeoProjection } from 'd3-geo'
import { Modal, Button, Field, Input, Textarea, Select } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { localAll, localPut, localDelete } from '../lib/localDb'
import type { Travel, TravelStop, TransportMode } from '../types'

// ============================================================
// 常量：3 条动态旅行路线（固定展示元素）
// ============================================================
const ROUTES: {
  from: string
  to: string
  mode: TransportMode
  color: string
  emoji: string
  label: string
  fromXY: [number, number] // [lng, lat]
  toXY: [number, number]
}[] = [
  {
    from: '北京',
    to: '上海',
    mode: 'flight',
    color: '#ff8a5c',
    emoji: '✈️',
    label: '飞机',
    fromXY: [116.41, 39.9],
    toXY: [121.47, 31.23],
  },
  {
    from: '上海',
    to: '长沙',
    mode: 'train',
    color: '#4dd0e1',
    emoji: '🚄',
    label: '高铁',
    fromXY: [121.47, 31.23],
    toXY: [112.94, 28.23],
  },
  {
    from: '长沙',
    to: '张家界',
    mode: 'car',
    color: '#a78bfa',
    emoji: '🚗',
    label: '自驾',
    fromXY: [112.94, 28.23],
    toXY: [110.48, 29.12],
  },
]

const TRANSPORT_OPTIONS: { value: TransportMode; label: string }[] = [
  { value: 'flight', label: '✈️ 飞机' },
  { value: 'train', label: '🚄 高铁' },
  { value: 'car', label: '🚗 自驾' },
  { value: 'bus', label: '🚌 大巴' },
  { value: 'other', label: '📍 其他' },
]

const VIEW_W = 1000
const VIEW_H = 780

// 预置省份下拉（与 GeoJSON 名称对齐，供添加表单选择）
const PROVINCE_OPTIONS = [
  '北京市', '天津市', '河北省', '山西省', '内蒙古自治区', '辽宁省', '吉林省',
  '黑龙江省', '上海市', '江苏省', '浙江省', '安徽省', '福建省', '江西省',
  '山东省', '河南省', '湖北省', '湖南省', '广东省', '广西壮族自治区', '海南省',
  '重庆市', '四川省', '贵州省', '云南省', '西藏自治区', '陕西省', '甘肃省',
  '青海省', '宁夏回族自治区', '新疆维吾尔自治区', '台湾省', '香港特别行政区',
  '澳门特别行政区',
]

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr]
  const [it] = next.splice(from, 1)
  next.splice(to, 0, it)
  return next
}

// ============================================================
// 封面（无图时显示渐变占位）
// ============================================================
function Cover({ src, label }: { src?: string; label: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt={label}
        className="h-full w-full object-cover"
        loading="lazy"
      />
    )
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-500/30 via-fuchsia-500/20 to-sky-500/30">
      <span className="text-2xl font-semibold text-white/80">{label.slice(0, 1)}</span>
    </div>
  )
}

// ============================================================
// 左侧：暗色调中国地图
// ============================================================
interface ProjFeature {
  name: string
  path: string
  centroid: [number, number]
}

function ChinaMap({ stats }: { stats: { trips: number; cities: number; provinces: number } }) {
  const [geo, setGeo] = useState<{ features: ProjFeature[]; projection: GeoProjection } | null>(null)
  const [hovered, setHovered] = useState<{ name: string; xy: [number, number] } | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`${import.meta.env.BASE_URL}geo/china.json`)
      .then((r) => r.json())
      .then((raw: { features: { properties: { name?: string; centroid?: [number, number] }; geometry: unknown }[] }) => {
        if (cancelled) return
        const fc = { type: 'FeatureCollection', features: raw.features } as never
        const projection = geoMercator().fitExtent(
          [
            [24, 24],
            [VIEW_W - 24, VIEW_H - 24],
          ],
          fc,
        )
        const pathGen = geoPath(projection)
        const features: ProjFeature[] = raw.features.map((f) => {
          const d = pathGen(f.geometry as never) ?? ''
          const c = (f.properties.centroid ?? [104, 35]) as [number, number]
          const xy = projection(c) ?? [0, 0]
          return { name: f.properties.name ?? '', path: d, centroid: xy }
        })
        setGeo({ features, projection })
      })
      .finally(() => !cancelled && setLoaded(true))
    return () => {
      cancelled = true
    }
  }, [])

  // 路线投影坐标
  const routes = useMemo(() => {
    if (!geo) return []
    return ROUTES.map((r) => {
      const s = geo.projection(r.fromXY) ?? [0, 0]
      const e = geo.projection(r.toXY) ?? [0, 0]
      const mx = (s[0] + e[0]) / 2
      const my = (s[1] + e[1]) / 2
      const dx = e[0] - s[0]
      const dy = e[1] - s[1]
      const len = Math.hypot(dx, dy) || 1
      const off = len * 0.2
      const cx = mx - (dy / len) * off
      const cy = my + (dx / len) * off
      const d = `M${s[0].toFixed(1)},${s[1].toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${e[0].toFixed(1)},${e[1].toFixed(1)}`
      return { ...r, s, e, d }
    })
  }, [geo])

  return (
    <div className="relative h-full w-full overflow-hidden rounded-card bg-gradient-to-br from-[#0a0f1f] via-[#0c1430] to-[#0a0f22] ring-1 ring-white/10">
      {/* 等高线纹理背景 */}
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="contour" width="160" height="46" patternUnits="userSpaceOnUse">
            <path d="M0 23 Q40 6 80 23 T160 23" fill="none" stroke="rgba(120,140,210,0.10)" strokeWidth="1" />
          </pattern>
          <pattern id="contour2" width="200" height="64" patternUnits="userSpaceOnUse">
            <path d="M0 32 Q50 12 100 32 T200 32" fill="none" stroke="rgba(90,110,180,0.07)" strokeWidth="1" />
          </pattern>
          <radialGradient id="glow" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="rgba(99,102,241,0.18)" />
            <stop offset="100%" stopColor="rgba(99,102,241,0)" />
          </radialGradient>
        </defs>
        <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="url(#contour)" />
        <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="url(#contour2)" />
        <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="url(#glow)" />
      </svg>

      {/* 省名 + 统计（左上标题） */}
      <div className="pointer-events-none absolute left-5 top-5 z-10">
        <h1 className="text-xl font-semibold tracking-wide text-white drop-shadow">我的旅行地图</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <StatChip label="旅程" value={stats.trips} />
          <StatChip label="城市" value={stats.cities} />
          <StatChip label="省份" value={stats.provinces} />
        </div>
      </div>

      {/* 主地图 SVG */}
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet">
        {geo?.features.map((f, i) => {
          const isHover = hovered?.name === f.name && f.name !== ''
          return (
            <path
              key={i}
              d={f.path}
              className="province-assemble"
              style={{ animationDelay: `${Math.min(i * 28, 1400)}ms` }}
              fill={isHover ? 'rgba(129,140,248,0.55)' : 'rgba(86,103,178,0.30)'}
              stroke={isHover ? '#c7d2fe' : 'rgba(148,163,255,0.45)'}
              strokeWidth={isHover ? 1.4 : 0.8}
              onMouseEnter={() => f.name && setHovered({ name: f.name, xy: f.centroid })}
              onMouseLeave={() => setHovered(null)}
            />
          )
        })}

        {/* 路线 */}
        {routes.map((r, i) => (
          <g key={i}>
            <path id={`rp-${i}`} d={r.d} fill="none" stroke={r.color} strokeWidth={2.2} strokeOpacity={0.9} className="route-flow" />
            <circle cx={r.s[0]} cy={r.s[1]} r={3.5} fill={r.color} />
            <circle cx={r.e[0]} cy={r.e[1]} r={3.5} fill={r.color} />
            {/* 移动交通工具 */}
            <g>
              <text fontSize={18} textAnchor="middle" dominantBaseline="central">
                {r.emoji}
              </text>
              <animateMotion dur={`${3 + i * 0.6}s`} repeatCount="indefinite" rotate="0">
                <mpath href={`#rp-${i}`} />
              </animateMotion>
            </g>
          </g>
        ))}

        {/* 路线城市标签 */}
        {routes.flatMap((r, ri) =>
          [r.s, r.e].map((pt, pi) => {
            const name = pi === 0 ? r.from : r.to
            return (
              <g key={`${ri}-${pi}`} pointerEvents="none">
                <text x={pt[0]} y={pt[1] - 9} textAnchor="middle" fontSize={11} fill="#e5e7eb" fontWeight={600}>
                  {name}
                </text>
              </g>
            )
          }),
        )}

        {/* 悬停省名提示 */}
        {hovered && hovered.name && (
          <g pointerEvents="none" transform={`translate(${hovered.xy[0]}, ${hovered.xy[1]})`}>
            <rect
              x={-(hovered.name.length * 7 + 12)}
              y={-30}
              width={hovered.name.length * 14 + 24}
              height={22}
              rx={6}
              fill="rgba(8,12,28,0.85)"
              stroke="rgba(148,163,255,0.5)"
            />
            <text textAnchor="middle" y={-14} fontSize={13} fill="#fff" fontWeight={600}>
              {hovered.name}
            </text>
          </g>
        )}
      </svg>

      {/* 底部交通图例 */}
      <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-4 rounded-full bg-black/40 px-4 py-2 backdrop-blur-md ring-1 ring-white/10">
        {ROUTES.map((r) => (
          <div key={r.from + r.to} className="flex items-center gap-1.5 text-xs text-white/90">
            <span className="text-base leading-none">{r.emoji}</span>
            <span className="font-medium">{r.label}</span>
            <span className="text-white/50">{r.from}→{r.to}</span>
          </div>
        ))}
      </div>

      {!loaded && (
        <div className="absolute inset-0 grid place-items-center text-sm text-white/50">地图加载中…</div>
      )}

      <style>{`
        .province-assemble { opacity: 0; animation: provinceIn .7s ease forwards; }
        @keyframes provinceIn { from { opacity: 0; } to { opacity: 1; } }
        .route-flow { stroke-dasharray: 4 12; animation: dashFlow 1.1s linear infinite; }
        @keyframes dashFlow { to { stroke-dashoffset: -32; } }
      `}</style>
    </div>
  )
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white/10 px-2.5 py-1 text-center backdrop-blur-sm ring-1 ring-white/10">
      <div className="text-base font-semibold text-white">{value}</div>
      <div className="text-[10px] text-white/60">{label}</div>
    </div>
  )
}

// ============================================================
// 右侧：湖南省旅行记录面板
// ============================================================
const CITY_TABS = ['全部', '长沙', '岳阳', '张家界'] as const

function TravelPanel({
  records,
  onChanged,
}: {
  records: Travel[]
  onChanged: () => void
}) {
  const [filter, setFilter] = useState<(typeof CITY_TABS)[number]>('全部')
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [editing, setEditing] = useState<Travel | null>(null)
  const [adding, setAdding] = useState(false)
  const [delTarget, setDelTarget] = useState<Travel | null>(null)

  const filtered = useMemo(() => {
    const list = [...records].sort((a, b) => a.order - b.order)
    if (filter === '全部') return list
    return list.filter((r) => r.to.includes(filter))
  }, [records, filter])

  const cityCount = useMemo(() => new Set(records.map((r) => r.to)).size, [records])

  async function persistOrder(list: Travel[]) {
    for (let i = 0; i < list.length; i++) {
      const rec = { ...list[i], order: i }
      await localPut('travels', rec)
    }
    onChanged()
  }

  function onDrop(toIdx: number) {
    if (dragIdx === null || dragIdx === toIdx) return
    const next = arrayMove(filtered, dragIdx, toIdx)
    setDragIdx(null)
    void persistOrder(next)
  }

  return (
    <div className="flex h-full flex-col rounded-card glass-panel">
      {/* 标题 + 城市数量标签 */}
      <div className="flex items-center justify-between gap-2 border-b border-white/8 px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-ink-strong">湖南省 · 旅行记录</h2>
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
            {cityCount} 城
          </span>
        </div>
      </div>

      {/* 城市筛选标签栏 */}
      <div className="flex flex-wrap gap-2 px-5 py-3">
        {CITY_TABS.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              filter === c
                ? 'bg-accent/20 text-accent ring-1 ring-accent/40'
                : 'bg-white/5 text-ink-soft hover:bg-white/10'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* 城市卡片（2 列） */}
      <div className="grid flex-1 grid-cols-2 content-start gap-3 overflow-y-auto px-5 pb-5">
        {filtered.length === 0 && (
          <div className="col-span-2 grid place-items-center py-16 text-sm text-ink-mute">
            暂无「{filter}」的旅行记录，点击下方按钮添加 ✦
          </div>
        )}
        {filtered.map((r, idx) => (
          <div
            key={r.id}
            draggable
            onDragStart={() => setDragIdx(idx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(idx)}
            className={`group relative overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/8 transition ${
              dragIdx === idx ? 'opacity-50 ring-accent' : 'hover:ring-white/20'
            }`}
          >
            {/* 封面 */}
            <div className="relative h-28 w-full overflow-hidden">
              <Cover src={r.image} label={r.to} />
              <span className="absolute left-2 top-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                {r.date}
              </span>
              {/* 操作 */}
              <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
                <button
                  onClick={() => setEditing(r)}
                  className="grid h-6 w-6 place-items-center rounded-md bg-black/50 text-xs text-white hover:bg-black/70"
                  title="编辑"
                >
                  ✎
                </button>
                <button
                  onClick={() => setDelTarget(r)}
                  className="grid h-6 w-6 place-items-center rounded-md bg-black/50 text-xs text-white hover:bg-danger"
                  title="删除"
                >
                  ✕
                </button>
              </div>
            </div>
            {/* 内容 */}
            <div className="space-y-1.5 p-3">
              <div className="flex items-center justify-between gap-1">
                <div className="truncate text-sm font-semibold text-ink-strong">{r.to}</div>
                <div className="flex shrink-0 items-center gap-0.5 text-xs text-amber-400">
                  ★ {r.rating.toFixed(1)}
                </div>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-ink-soft">
                <span>{r.from}</span>
                <span className="text-ink-mute">→</span>
                <span>{r.to}</span>
                <span className="ml-1 rounded bg-white/8 px-1 text-[10px] text-ink-soft">
                  {TRANSPORT_OPTIONS.find((t) => t.value === r.transport)?.label}
                </span>
              </div>
              {r.accommodation && (
                <div className="truncate text-[11px] text-ink-soft">🏨 {r.accommodation}</div>
              )}
              {r.place && (
                <div className="truncate text-[11px] text-ink-soft">📍 {r.place}</div>
              )}
              <div className="flex items-center gap-2 text-[11px] text-ink-mute">
                <span>📷 {r.stops?.filter((s) => s.image).length || (r.image ? 1 : 0)}</span>
                {r.location && <span>🧭 已定位</span>}
              </div>
            </div>
            {/* 拖动提示 */}
            <div className="absolute bottom-2 right-2 cursor-grab text-[10px] text-ink-mute opacity-0 transition group-hover:opacity-100">
              ⠿ 拖动排序
            </div>
          </div>
        ))}
      </div>

      {/* 添加旅行记录 */}
      <div className="border-t border-white/8 p-4">
        <Button className="w-full" onClick={() => setAdding(true)}>
          ＋ 添加旅行记录
        </Button>
      </div>

      {/* 弹窗 */}
      {adding && (
        <AddTravelModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            onChanged()
          }}
        />
      )}
      {editing && (
        <AddTravelModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}
      {delTarget && (
        <ConfirmDelete
          name={delTarget.to}
          onClose={() => setDelTarget(null)}
          onConfirm={async () => {
            await localDelete('travels', delTarget.id)
            setDelTarget(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

function ConfirmDelete({
  name,
  onClose,
  onConfirm,
}: {
  name: string
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title="删除旅行记录"
      maxWidth="max-w-sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            删除
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-soft">确定删除「{name}」这条旅行记录吗？此操作不可撤销。</p>
    </Modal>
  )
}

// ============================================================
// 添加 / 编辑 旅行记录弹窗
// ============================================================
function AddTravelModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Travel | null
  onClose: () => void
  onSaved: () => void
}) {
  const { user } = useAuth()
  const [from, setFrom] = useState(initial?.from ?? '')
  const [to, setTo] = useState(initial?.to ?? '')
  const [province, setProvince] = useState(initial?.province ?? '湖南省')
  const [transport, setTransport] = useState<TransportMode>(initial?.transport ?? 'train')
  const [accommodation, setAccommodation] = useState(initial?.accommodation ?? '')
  const [place, setPlace] = useState(initial?.place ?? '')
  const [location, setLocation] = useState(initial?.location ?? '')
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().slice(0, 10))
  const [rating, setRating] = useState(initial?.rating ?? 8)
  const [note, setNote] = useState(initial?.note ?? '')
  const [image, setImage] = useState(initial?.image ?? '')
  const [stops, setStops] = useState<TravelStop[]>(initial?.stops ?? [])
  const [stopDrag, setStopDrag] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setImage(String(reader.result))
    reader.readAsDataURL(file)
  }

  function addStop() {
    setStops((s) => [
      ...s,
      { id: crypto.randomUUID(), place: '', transport: transport, accommodation: '', image: '', location: '' },
    ])
  }
  function updateStop(id: string, patch: Partial<TravelStop>) {
    setStops((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }
  function removeStop(id: string) {
    setStops((s) => s.filter((x) => x.id !== id))
  }
  function onDropStop(to: number) {
    if (stopDrag === null || stopDrag === to) return
    setStops((s) => arrayMove(s, stopDrag, to))
    setStopDrag(null)
  }

  async function save() {
    if (!to.trim() || !from.trim()) return
    const now = new Date().toISOString()
    const rec: Travel = {
      id: initial?.id ?? crypto.randomUUID(),
      user_id: user?.id ?? 'anonymous',
      from: from.trim(),
      to: to.trim(),
      province,
      transport,
      accommodation: accommodation.trim() || undefined,
      place: place.trim() || undefined,
      location: location.trim() || undefined,
      image: image || undefined,
      date,
      rating: Number(rating) || 0,
      note: note.trim() || undefined,
      stops: stops.filter((s) => s.place.trim()),
      order: initial?.order ?? Date.now(),
      created_at: initial?.created_at ?? now,
      updated_at: now,
    }
    await localPut('travels', rec)
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? '编辑旅行记录' : '添加旅行记录'}
      maxWidth="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={save} disabled={!from.trim() || !to.trim()}>
            {initial ? '保存' : '添加'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="出发地">
          <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="如：上海" />
        </Field>
        <Field label="目的地">
          <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="如：长沙" />
        </Field>
        <Field label="省份">
          <Select value={province} onChange={setProvince}>
            {PROVINCE_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="交通方式">
          <Select value={transport} onChange={(v) => setTransport(v as TransportMode)}>
            {TRANSPORT_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="日期">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="评分（0–10）">
          <Input
            type="number"
            min={0}
            max={10}
            step={0.5}
            value={rating}
            onChange={(e) => setRating(Number(e.target.value))}
          />
        </Field>
        <Field label="住宿">
          <Input value={accommodation} onChange={(e) => setAccommodation(e.target.value)} placeholder="如：橘子洲民宿" />
        </Field>
        <Field label="主要地点 / 景点">
          <Input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="如：岳麓山" />
        </Field>
        <Field label="定位">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="文本或经纬度" />
        </Field>
        <Field label="图片">
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onPickImage}
            />
            <Button variant="soft" className="px-3 py-2 text-xs" onClick={() => fileRef.current?.click()}>
              上传图片
            </Button>
            {image && (
              <button
                onClick={() => setImage('')}
                className="text-xs text-ink-mute underline hover:text-ink-soft"
              >
                清除
              </button>
            )}
          </div>
          {image ? (
            <img src={image} alt="封面预览" className="mt-2 h-16 w-24 rounded-md object-cover" />
          ) : (
            <p className="mt-1 text-xs text-ink-mute">未选择，将显示渐变占位封面</p>
          )}
        </Field>
      </div>

      <Field label="备注 / 游记">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="可选" />
      </Field>

      {/* 行程节点（支持按住滑动排序） */}
      <div className="mt-1">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-ink-soft">行程节点（按住 ⠿ 拖动排序）</span>
          <Button variant="soft" className="px-3 py-1.5 text-xs" onClick={addStop}>
            ＋ 添加节点
          </Button>
        </div>
        <div className="space-y-2">
          {stops.length === 0 && (
            <p className="rounded-lg border border-dashed border-line bg-canvas/30 px-3 py-2 text-xs text-ink-mute">
              暂无节点。可添加「地点 / 住宿 / 交通 / 图片 / 定位」，并拖动排序。
            </p>
          )}
          {stops.map((s, i) => (
            <div
              key={s.id}
              draggable
              onDragStart={() => setStopDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDropStop(i)}
              className={`rounded-xl border border-line bg-canvas/40 p-3 ${
                stopDrag === i ? 'opacity-50' : ''
              }`}
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="cursor-grab select-none text-ink-mute" title="拖动排序">
                  ⠿
                </span>
                <Input
                  value={s.place}
                  onChange={(e) => updateStop(s.id, { place: e.target.value })}
                  placeholder={`地点 ${i + 1}（如：天门山）`}
                  className="flex-1"
                />
                <button
                  onClick={() => removeStop(s.id)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-ink-mute hover:bg-danger/10 hover:text-danger"
                  title="删除节点"
                >
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Select
                  value={s.transport ?? transport}
                  onChange={(v) => updateStop(s.id, { transport: v as TransportMode })}
                >
                  {TRANSPORT_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
                <Input
                  value={s.accommodation ?? ''}
                  onChange={(e) => updateStop(s.id, { accommodation: e.target.value })}
                  placeholder="住宿"
                />
                <Input
                  value={s.location ?? ''}
                  onChange={(e) => updateStop(s.id, { location: e.target.value })}
                  placeholder="定位"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ============================================================
// 主页面：60 / 40 分栏布局
// ============================================================
const SEED: Omit<Travel, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = [
  {
    from: '上海', to: '长沙', province: '湖南省', transport: 'train',
    accommodation: '五一广场轻奢民宿', place: '岳麓山 · 橘子洲', location: '28.228,112.938',
    date: '2024-05-01', rating: 9, note: '臭豆腐配茶颜悦色，岳麓书院很有书卷气。',
    image: '', order: 0,
  },
  {
    from: '武汉', to: '长沙', province: '湖南省', transport: 'car',
    accommodation: '梅溪湖边公寓', place: '湖南省博物馆', location: '28.234,112.945',
    date: '2024-09-14', rating: 8.5, note: '马王堆辛追夫人震撼。',
    image: '', order: 1,
  },
  {
    from: '长沙', to: '岳阳', province: '湖南省', transport: 'car',
    accommodation: '洞庭湖畔酒店', place: '岳阳楼 · 洞庭湖', location: '29.358,113.092',
    date: '2024-06-12', rating: 8, note: '登楼望洞庭，浩浩汤汤。',
    image: '', order: 2,
  },
  {
    from: '广州', to: '岳阳', province: '湖南省', transport: 'train',
    accommodation: '岳阳楼上客栈', place: '君山岛', location: '29.452,113.072',
    date: '2024-10-03', rating: 7.5, note: '银针茶很香。',
    image: '', order: 3,
  },
  {
    from: '长沙', to: '张家界', province: '湖南省', transport: 'car',
    accommodation: '武陵源景区民宿', place: '武陵源 · 袁家界', location: '29.317,110.479',
    date: '2024-07-20', rating: 10, note: '阿凡达取景地，云雾里的石峰绝了。',
    image: '', order: 4,
  },
  {
    from: '北京', to: '张家界', province: '湖南省', transport: 'flight',
    accommodation: '天门山索道旁酒店', place: '天门山 · 玻璃栈道', location: '29.035,110.479',
    date: '2025-04-08', rating: 9.5, note: '99 弯盘山公路名不虚传。',
    image: '', order: 5,
  },
]

export default function TravelPage() {
  const { user } = useAuth()
  const [records, setRecords] = useState<Travel[]>([])

  async function reload() {
    const uid = user?.id ?? 'anonymous'
    let list = (await localAll<Travel>('travels', uid)) as Travel[]
    // 首启种子（仅当空库），方便直接看到「湖南省 · 旅行记录」效果
    if (list.length === 0) {
      const now = new Date().toISOString()
      for (const s of SEED) {
        const rec: Travel = { ...s, id: crypto.randomUUID(), user_id: uid, created_at: now, updated_at: now }
        await localPut('travels', rec)
      }
      list = (await localAll<Travel>('travels', uid)) as Travel[]
    }
    setRecords(list)
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const stats = useMemo(() => {
    const cities = new Set(records.map((r) => r.to)).size
    const provinces = new Set(records.map((r) => r.province)).size
    return { trips: records.length, cities, provinces }
  }, [records])

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-4 md:flex-row">
      {/* 左 60%：地图 */}
      <div className="h-[42vh] min-h-[320px] md:h-full md:w-[60%]">
        <ChinaMap stats={stats} />
      </div>
      {/* 右 40%：记录面板 */}
      <div className="min-h-0 flex-1 md:w-[40%]">
        <TravelPanel records={records} onChanged={reload} />
      </div>
    </div>
  )
}
