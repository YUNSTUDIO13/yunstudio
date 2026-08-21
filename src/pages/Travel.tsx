// 旅行模块（Travel）—— 个人旅行志
// 本地优先（Dexie travels 表）+ outbox 补传 Supabase（与 movies/books 一致）
// 地图：省份点亮由 travels 的 province_adcode 反查派生；hover 浮起 + 发光
// 详情：总览 + 无缝 Day 滚动（滚动联动顶部 tab）；行程条目支持 增/删/改/上下移
// 封面：新建行程必传，压缩为 WebP/JPEG data URL 落库（离线可用，同步时作为文本列上云）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { db, pendingRowIds } from '../lib/localDb'
import { supabase } from '../lib/supabase'
import {
  seedFromServer,
  enqueueAndMaybeFlush,
  setSyncStatusHandler,
} from '../lib/sync'
import { useMediaQuery } from '../lib/useMediaQuery'
import { CHINA_GEO, CHINA_VIEWBOX, type ChinaGeo } from '../lib/china-geo'
import { forceUnlockBodyScroll } from '../components/ui'
import type { Travel, TravelDay, TravelItem } from '../types'

// ─── 功能类型（行程时间轴条目的"功能标题"） ───────────────────────────────
interface ModuleMeta {
  name: string
  icon: string
}
export const MODULE_LABELS: Record<string, ModuleMeta> = {
  transport: { name: '交通', icon: '🚆' },
  hotel: { name: '住宿', icon: '🏨' },
  food: { name: '吃喝', icon: '🍜' },
  attraction: { name: '景点', icon: '📍' },
  shopping: { name: '购物', icon: '🛍️' },
  entertainment: { name: '娱乐', icon: '🎡' },
  checkin: { name: '打卡', icon: '📸' },
  note: { name: '注意事项', icon: '⚠️' },
  memo: { name: '便签', icon: '📝' },
  luggage: { name: '行李清单', icon: '🧳' },
  ticket: { name: '机酒车票', icon: '🎫' },
  place: { name: '地点', icon: '🗺️' },
  custom: { name: '自定义', icon: '✨' },
}
const MODULE_KEYS = Object.keys(MODULE_LABELS)

// ─── 辅助 ────────────────────────────────────────────────────────────────
function dayCount(s: string, e: string): number {
  const a = new Date(s + 'T00:00:00')
  const b = new Date(e + 'T00:00:00')
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1)
}
function dayDate(start: string, idx: number): string {
  const d = new Date(start + 'T00:00:00')
  d.setDate(d.getDate() + idx)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function uid(): string {
  return crypto.randomUUID()
}

// 压缩上传图片为 data URL（WebP 优先，不支持则回退 JPEG）
async function compressImage(file: File, maxDim = 1280, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('解析图片失败'))
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('无法创建画布'))
        ctx.drawImage(img, 0,0, w, h)
        let url = canvas.toDataURL('image/webp', quality)
        if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', quality)
        resolve(url)
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

// 省份下拉（34 省级行政区，剔除南海诸岛）
const PROVINCES: ChinaGeo[] = CHINA_GEO.filter(
  (g) => g.adcode !== '100000' && !g.name.includes('南海'),
)

// ─── 中国地图 ────────────────────────────────────────────────────────────
function ChinaMap({
  visited,
  onProvinceClick,
}: {
  visited: Set<string>
  onProvinceClick: (adcode: string) => void
}) {
  const [hover, setHover] = useState<string | null>(null)
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-3 backdrop-blur-xl">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-white/90">我的旅行地图</h2>
        <span className="text-xs text-white/40">已点亮 {visited.size} 省</span>
      </div>
      <svg
        viewBox={CHINA_VIEWBOX}
        className="h-auto w-full"
        style={{ display: 'block' }}
        preserveAspectRatio="xMidYMid meet"
      >
        {CHINA_GEO.map((g) => {
          const isVisited = visited.has(g.adcode)
          const isHover = hover === g.adcode
          const baseFill = isVisited ? 'rgb(124,133,245)' : 'rgba(255,255,255,0.10)'
          const fill = isHover ? 'rgb(150,158,250)' : baseFill
          return (
            <path
              key={g.adcode}
              d={g.path}
              fill={fill}
              stroke="rgba(0,0,0,0.5)"
              strokeWidth={0.6}
              style={{
                cursor: isVisited ? 'pointer' : 'default',
                transition: 'fill .2s ease, transform .15s ease, filter .2s ease',
                transform: isHover ? 'translateY(-2px)' : 'none',
                filter: isHover
                  ? 'drop-shadow(0 4px 12px rgba(124,133,245,0.65))'
                  : isVisited
                  ? 'drop-shadow(0 0 4px rgba(124,133,245,0.35))'
                  : 'none',
              }}
              onMouseEnter={() => setHover(g.adcode)}
              onMouseLeave={() => setHover(null)}
              onClick={() => isVisited && onProvinceClick(g.adcode)}
            />
          )
        })}
      </svg>
      <p className="mt-1 text-center text-[11px] text-white/35">
        鼠标悬停省份高亮 · 点亮的省份代表去过（由行程记录自动派生）
      </p>
    </div>
  )
}

// ─── 行程卡片 ────────────────────────────────────────────────────────────
function TripCard({
  trip,
  onOpen,
  onEdit,
  onDelete,
}: {
  trip: Travel
  onOpen: (t: Travel) => void
  onEdit: (t: Travel) => void
  onDelete: (t: Travel) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const days = dayCount(trip.start_date, trip.end_date)
  const nights = Math.max(days - 1, 0)
  useEffect(() => {
    if (!menuOpen) return
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  return (
    <div
      className="group relative cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-white/5 transition hover:border-white/20"
      onClick={() => onOpen(trip)}
    >
      {/* 封面（必传，无图不显示封面区） */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-black/40">
        <img
          src={trip.cover}
          alt={trip.title}
          className="h-full w-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <span className="absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/45 text-lg backdrop-blur-md">
          {trip.emoji || '✈️'}
        </span>
        <span className="absolute bottom-2 right-3 text-xs font-medium text-white/90">
          {trip.province_name} · {days}天{nights}夜
        </span>
      </div>
      <div className="p-3">
        <div className="truncate text-sm font-semibold text-white/90">{trip.title}</div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-white/45">
          <span>{trip.start_date}</span>
          <span className="h-1 w-1 rounded-full bg-white/30" />
          <span>{trip.end_date}</span>
        </div>
      </div>

      {/* 三点菜单（对齐观影"更多"浮层样式） */}
      <div className="absolute right-2 top-2" ref={menuRef}>
        <button
          aria-label="更多"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen((v) => !v)
          }}
          className="grid h-8 w-8 place-items-center rounded-full bg-black/50 text-white/90 backdrop-blur-md transition hover:bg-black/70"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="19" r="1.6" />
          </svg>
        </button>
        {menuOpen && (
          <div
            className="animate-popover absolute right-0 top-10 z-40 w-36 overflow-hidden rounded-xl border border-white/10 bg-[#15151c]/95 p-1.5 shadow-2xl backdrop-blur-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setMenuOpen(false)
                onEdit(trip)
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-white/85 transition hover:bg-white/10"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
                <path d="M4 20h4l11-11-4-4L4 16v4z" />
              </svg>
              编辑
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                onDelete(trip)
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-danger transition hover:bg-danger/10"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-danger">
                <path d="M6 7h12M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M7 7l1 13a2 2 0 002 2h4a2 2 0 002-2l1-13" />
              </svg>
              删除
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 行程时间轴条目 ──────────────────────────────────────────────────────
function TimelineItem({
  item,
  index,
  onEdit,
  onDelete,
  onMove,
}: {
  item: TravelItem
  index: number
  onEdit: (i: number) => void
  onDelete: (i: number) => void
  onMove: (i: number, dir: -1 | 1) => void
}) {
  const meta = MODULE_LABELS[item.type] ?? MODULE_LABELS.custom
  return (
    <div className="relative rounded-xl border border-white/10 bg-white/5 p-3 pl-4">
      {/* 左侧时间轴竖线 dot */}
      <span className="absolute left-1.5 top-4 h-2 w-2 -translate-x-1/2 rounded-full bg-accent" />
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm">{meta.icon}</span>
            <span className="text-xs text-white/50">{meta.name}</span>
            {item.time && <span className="text-xs text-accent">{item.time}</span>}
          </div>
          <div className="mt-0.5 truncate text-sm font-medium text-white/90">{item.title}</div>
          {item.note && <div className="mt-1 text-xs leading-relaxed text-white/55">{item.note}</div>}
          {item.img && (
            <img
              src={item.img}
              alt={item.title}
              className="mt-2 max-h-36 w-auto rounded-lg border border-white/10 object-cover"
              loading="lazy"
            />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-60 transition group-hover:opacity-100">
          <button
            aria-label="上移"
            onClick={() => onMove(index, -1)}
            className="grid h-6 w-6 place-items-center rounded-md bg-black/40 text-white/70 transition hover:bg-accent/20 hover:text-accent"
          >
            ↑
          </button>
          <button
            aria-label="下移"
            onClick={() => onMove(index, 1)}
            className="grid h-6 w-6 place-items-center rounded-md bg-black/40 text-white/70 transition hover:bg-accent/20 hover:text-accent"
          >
            ↓
          </button>
          <button
            aria-label="编辑"
            onClick={() => onEdit(index)}
            className="grid h-6 w-6 place-items-center rounded-md bg-black/40 text-white/70 transition hover:bg-accent/20 hover:text-accent"
          >
            ✎
          </button>
          <button
            aria-label="删除"
            onClick={() => onDelete(index)}
            className="grid h-6 w-6 place-items-center rounded-md bg-black/40 text-white/70 transition hover:bg-danger/20 hover:text-danger"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 行程详情面板 ────────────────────────────────────────────────────────
function TravelDetailPanel({
  trip,
  onClose,
  onChange,
  onDelete,
}: {
  trip: Travel
  onClose: () => void
  onChange: (t: Travel) => void
  onDelete: (t: Travel) => void
}) {
  const isMobile = useMediaQuery('(max-width: 767px)')
  const days = trip.days ?? []
  const tabs = useMemo(() => ['总览', ...days.map((_, i) => `Day${i + 1}`)], [days.length])
  const [activeTab, setActiveTab] = useState('总览')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<{ dayIdx: number; itemIdx: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Record<string, HTMLElement | null>>({})

  const scrollToTab = (tab: string) => {
    const el = tabRefs.current[tab]
    if (el && bodyRef.current) {
      bodyRef.current.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' })
    }
  }

  // 滚动联动：body 滚动时高亮最靠顶的 section 对应 tab
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const top = body.scrollTop + 12
        let current = '总览'
        for (const t of tabs) {
          const el = tabRefs.current[t]
          if (el && el.offsetTop <= top) current = t
        }
        setActiveTab(current)
      })
    }
    body.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      body.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [tabs])

  const mutateItems = (dayIdx: number, fn: (items: TravelItem[]) => TravelItem[]) => {
    const nextDays = days.map((d, i) =>
      i === dayIdx ? { items: fn(d.items) } : d,
    )
    onChange({ ...trip, days: nextDays, updated_at: new Date().toISOString() })
  }

  const handleAdd = (dayIdx: number, item: TravelItem) => {
    mutateItems(dayIdx, (items) => [item, ...items])
    setShowAdd(false)
  }
  const handleEditSave = (item: TravelItem) => {
    if (!editing) return
    const { dayIdx, itemIdx } = editing
    mutateItems(dayIdx, (items) => items.map((it, i) => (i === itemIdx ? item : it)))
    setEditing(null)
  }
  const handleDelete = (dayIdx: number, itemIdx: number) => {
    mutateItems(dayIdx, (items) => items.filter((_, i) => i !== itemIdx))
  }
  const handleMove = (dayIdx: number, itemIdx: number, dir: -1 | 1) => {
    mutateItems(dayIdx, (items) => {
      const to = itemIdx + dir
      if (to < 0 || to >= items.length) return items
      const arr = [...items]
      ;[arr[itemIdx], arr[to]] = [arr[to], arr[itemIdx]]
      return arr
    })
  }

  const totalDays = dayCount(trip.start_date, trip.end_date)
  const itemCount = days.reduce((s, d) => s + d.items.length, 0)

  return (
    <div
      className={
        isMobile
          ? 'fixed inset-0 z-50 flex flex-col bg-[#0b0d13]'
          : 'fixed right-0 top-0 z-50 flex h-full w-[min(460px,92vw)] flex-col border-l border-white/10 bg-[#0b0d13] shadow-2xl'
      }
    >
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 truncate text-base font-semibold text-white/90">
            <span className="text-lg">{trip.emoji || '✈️'}</span>
            {trip.title}
          </div>
          <div className="mt-0.5 text-xs text-white/45">
            {trip.province_name} · {totalDays}天{Math.max(totalDays - 1, 0)}夜 · {itemCount} 条记录
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            aria-label="删除行程"
            onClick={() => onDelete(trip)}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-danger transition hover:bg-danger/15"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 7h12M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M7 7l1 13a2 2 0 002 2h4a2 2 0 002-2l1-13" />
            </svg>
          </button>
          <button
            aria-label="关闭"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            ✕
          </button>
        </div>
      </div>

      {/* tab 栏（sticky 风格：滚动联动） */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-white/10 px-3 py-2">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => {
              setActiveTab(t)
              scrollToTab(t)
            }}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition ${
              activeTab === t ? 'bg-accent/20 text-accent' : 'text-white/60 hover:bg-white/10'
            }`}
          >
            {t}
          </button>
        ))}
        <button
          onClick={() => setShowAdd(true)}
          className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-white/80 transition hover:bg-accent/20 hover:text-accent"
          aria-label="添加行程模块"
        >
          +
        </button>
      </div>

      {/* 滚动主体 */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-3">
        {/* 总览 */}
        <section
          ref={(el) => {
            tabRefs.current['总览'] = el
          }}
          className="mb-5"
        >
          <div className="aspect-[16/10] w-full overflow-hidden rounded-xl border border-white/10 bg-black/40">
            <img src={trip.cover} alt={trip.title} className="h-full w-full object-cover" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <div className="text-xs text-white/40">目的地</div>
              <div className="text-white/85">{trip.city}</div>
            </div>
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <div className="text-xs text-white/40">省份</div>
              <div className="text-white/85">{trip.province_name}</div>
            </div>
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <div className="text-xs text-white/40">出发</div>
              <div className="text-white/85">{trip.start_date}</div>
            </div>
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <div className="text-xs text-white/40">返程</div>
              <div className="text-white/85">{trip.end_date}</div>
            </div>
          </div>
        </section>

        {/* 逐 Day 无缝衔接 */}
        {days.map((d, dayIdx) => (
          <section
            key={dayIdx}
            ref={(el) => {
              tabRefs.current[`Day${dayIdx + 1}`] = el
            }}
            className="mb-1"
          >
            <div className="sticky top-0 z-10 -mx-4 mb-2 bg-[#0b0d13]/95 px-4 py-2 backdrop-blur">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-bold tracking-widest text-accent">
                  DAY {String(dayIdx + 1).padStart(2, '0')}
                </span>
                <span className="text-xs text-white/40">/ {String(totalDays).padStart(2, '0')}</span>
                <span className="ml-auto text-xs text-white/35">{dayDate(trip.start_date, dayIdx)}</span>
              </div>
            </div>
            {d.items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 py-6 text-center text-xs text-white/35">
                这一天暂无记录，点右上角 ＋ 添加模块
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {d.items.map((it, itemIdx) => (
                  <TimelineItem
                    key={it.id}
                    item={it}
                    index={itemIdx}
                    onEdit={() => setEditing({ dayIdx, itemIdx })}
                    onDelete={() => handleDelete(dayIdx, itemIdx)}
                    onMove={(i, dir) => handleMove(dayIdx, i, dir)}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
        <div className="h-10" />
      </div>

      {/* 添加 / 编辑 行程模块 dialog */}
      {showAdd && (
        <ItemDialog
          title="添加行程模块"
          okLabel="添加到时间轴"
          onClose={() => setShowAdd(false)}
          onSave={(it) => handleAdd(activeDayIdx(activeTab), it)}
        />
      )}
      {editing && (
        <ItemDialog
          title="编辑行程模块"
          okLabel="保存修改"
          initial={days[editing.dayIdx]?.items[editing.itemIdx]}
          onClose={() => setEditing(null)}
          onSave={handleEditSave}
        />
      )}
    </div>
  )
}

function activeDayIdx(tab: string): number {
  const m = tab.match(/^Day(\d+)$/)
  return m ? parseInt(m[1], 10) - 1 : 0
}

// ─── 行程条目 dialog（新增 / 编辑共用） ──────────────────────────────────
function ItemDialog({
  title,
  okLabel,
  initial,
  onClose,
  onSave,
}: {
  title: string
  okLabel: string
  initial?: TravelItem
  onClose: () => void
  onSave: (item: TravelItem) => void
}) {
  const [type, setType] = useState(initial?.type ?? 'transport')
  const [customTitle, setCustomTitle] = useState(initial?.title ?? '')
  const [time, setTime] = useState(initial?.time ?? defaultHHMM())
  const [note, setNote] = useState(initial?.note ?? '')
  const [img, setImg] = useState<string | null>(initial?.img ?? null)
  const [imgName, setImgName] = useState(initial?.img ? '已附图片（可重新选择替换）' : '')
  const fileRef = useRef<HTMLInputElement>(null)

  const onFile = async (file?: File) => {
    if (!file) return
    try {
      const url = await compressImage(file)
      setImg(url)
      setImgName(file.name.length > 18 ? file.name.slice(0, 16) + '…' : file.name)
    } catch {
      setImgName('图片处理失败，请重试')
    }
  }

  const submit = () => {
    const meta = MODULE_LABELS[type]
    const t: TravelItem = {
      id: initial?.id ?? uid(),
      type,
      title: customTitle.trim() || `新建${meta?.name ?? '条目'}`,
      time,
      note: note.trim(),
      img,
    }
    onSave(t)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#15151c] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-white/90">{title}</h3>
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-white/50">功能标题</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none focus:border-accent/50"
            >
              {MODULE_KEYS.map((k) => (
                <option key={k} value={k} className="bg-[#15151c]">
                  {MODULE_LABELS[k].icon} {MODULE_LABELS[k].name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">自定义标题</label>
            <input
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="留空则默认按功能标题"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none focus:border-accent/50"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">时间</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none focus:border-accent/50 [color-scheme:dark]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">图片上传（可选）</label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center justify-between rounded-lg border border-dashed border-white/15 bg-black/30 px-3 py-2 text-sm text-white/70 transition hover:border-accent/40"
            >
              <span className="truncate">{imgName || '选择图片'}</span>
              <span className="text-accent">浏览</span>
            </button>
            {img && (
              <img src={img} alt="预览" className="mt-2 max-h-28 w-auto rounded-lg border border-white/10" />
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">备注</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="可选"
              className="w-full resize-none rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none focus:border-accent/50"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-white/60 transition hover:bg-white/10"
          >
            取消
          </button>
          <button
            onClick={submit}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black transition hover:bg-accent/90"
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function defaultHHMM(): string {
  const h = String(new Date().getHours()).padStart(2, '0')
  return `${h}:00`
}

// ─── 新建行程 dialog ─────────────────────────────────────────────────────
function NewTripModal({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (t: Travel) => void
}) {
  const [title, setTitle] = useState('')
  const [provinceAdcode, setProvinceAdcode] = useState(PROVINCES[0]?.adcode ?? '')
  const [city, setCity] = useState('')
  const [emoji, setEmoji] = useState('✈️')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [cover, setCover] = useState<string | null>(null)
  const [coverName, setCoverName] = useState('')
  const [coverErr, setCoverErr] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const province = PROVINCES.find((p) => p.adcode === provinceAdcode)
  const days = startDate && endDate ? dayCount(startDate, endDate) : 1

  const onFile = async (file?: File) => {
    setCoverErr('')
    if (!file) return
    try {
      const url = await compressImage(file, 1600, 0.85)
      setCover(url)
      setCoverName(file.name.length > 18 ? file.name.slice(0, 16) + '…' : file.name)
    } catch {
      setCoverErr('封面处理失败，请重试')
    }
  }

  const submit = () => {
    if (!cover) {
      setCoverErr('请上传封面图（必填）')
      return
    }
    if (!startDate || !endDate) {
      setCoverErr('请选择出发与返程日期')
      return
    }
    setBusy(true)
    const now = new Date().toISOString()
    const t: Travel = {
      id: uid(),
      user_id: '', // 由调用方补充（persist 时以当前登录用户覆盖）
      title: title.trim() || `${city || province?.name || '旅行'} ${days}天${Math.max(days - 1, 0)}夜`,
      city: city.trim() || province?.name || '',
      province_adcode: province?.adcode ?? '',
      province_name: province?.name ?? '',
      emoji,
      start_date: startDate,
      end_date: endDate,
      cover,
      days: Array.from({ length: days }, () => ({ items: [] }) as TravelDay),
      created_at: now,
      updated_at: now,
    }
    onSave(t)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-[#15151c] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-white/90">新建行程</h3>
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-white/50">行程标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="留空自动生成（城市 + 天数）"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none focus:border-accent/50"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-white/50">省份</label>
              <select
                value={provinceAdcode}
                onChange={(e) => setProvinceAdcode(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none focus:border-accent/50"
              >
                {PROVINCES.map((p) => (
                  <option key={p.adcode} value={p.adcode} className="bg-[#15151c]">
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/50">目的地城市</label>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="如 长沙"
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none focus:border-accent/50"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-white/50">主题 emoji</label>
              <input
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/50">天数（自动算）</label>
              <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/70">
                {days} 天 {Math.max(days - 1, 0)} 夜
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-white/50">出发日</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none focus:border-accent/50 [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/50">返程日</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none focus:border-accent/50 [color-scheme:dark]"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">封面图（必填）</label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center justify-between rounded-lg border border-dashed border-white/15 bg-black/30 px-3 py-2 text-sm text-white/70 transition hover:border-accent/40"
            >
              <span className="truncate">{coverName || '选择封面图片'}</span>
              <span className="text-accent">浏览</span>
            </button>
            {cover && (
              <img src={cover} alt="封面预览" className="mx-auto mt-2 max-h-32 rounded-lg border border-white/10" />
            )}
            {coverErr && <div className="mt-1 text-xs text-danger">{coverErr}</div>}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-white/60 transition hover:bg-white/10"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black transition hover:bg-accent/90 disabled:opacity-50"
          >
            创建
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 主页面 ──────────────────────────────────────────────────────────────
export default function TravelPage() {
  const { user } = useAuth()
  const userId = user?.id ?? 'anonymous'
  const [travels, setTravels] = useState<Travel[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [showFunc, setShowFunc] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [selected, setSelected] = useState<Travel | null>(null)
  const [del, setDel] = useState<Travel | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const funcRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showFunc) return
    function onDoc(e: MouseEvent) {
      if (funcRef.current && !funcRef.current.contains(e.target as Node)) setShowFunc(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [showFunc])

  useEffect(() => {
    setSyncStatusHandler((s) => {
      if (s.ok) setSyncError(null)
      else setSyncError(s.msg ?? '同步到云端失败')
    })
    return () => setSyncStatusHandler(null)
  }, [])

  // 安全网：卸载时释放可能的滚动锁
  useEffect(() => () => { forceUnlockBodyScroll() }, [])

  const reload = useCallback(async () => {
    if (!user) {
      setTravels([])
      setLoading(false)
      return
    }
    const rows = await db.travels.where('user_id').equals(userId).toArray()
    rows.sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)) || b.created_at.localeCompare(a.created_at))
    setTravels(rows)
    setLoading(false)
  }, [user, userId])

  const reconcileOrphans = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    try {
      const { data, error } = await supabase.from('travels').select('id').eq('user_id', userId)
      if (error || !data) return
      const cloudIds = new Set((data as { id: string }[]).map((r) => r.id))
      const locals = await db.travels.where('user_id').equals(userId).toArray()
      const pending = await pendingRowIds('travels')
      const orphanIds = locals.map((t) => t.id).filter((id) => !cloudIds.has(id) && !pending.has(id))
      if (orphanIds.length) {
        await db.travels.bulkDelete(orphanIds)
        const delSet = new Set(orphanIds)
        setTravels((prev) => prev.filter((t) => !delSet.has(t.id)))
      }
    } catch {
      /* 对账失败静默，不阻塞主流程 */
    }
  }, [userId])

  // 加载 + Realtime
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      await reload()
      if (cancelled) return
      const localCount = await db.travels.where('user_id').equals(userId).count()
      if (localCount === 0) {
        await seedFromServer('travels', userId)
        if (cancelled) return
        await reload()
      }
      if (!cancelled) await reconcileOrphans()
    }
    void load()
    const timer = window.setInterval(() => {
      if (!cancelled) void reconcileOrphans()
    }, 30000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [userId, reload, reconcileOrphans])

  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`travels:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'travels', filter: `user_id=eq.${userId}` },
        (payload: { eventType?: string; old?: { id?: string }; new?: Record<string, unknown> }) => {
          const et = payload.eventType
          const oldId = payload.old?.id
          const newRow = payload.new as (Record<string, unknown> & { id?: string }) | undefined
          if (et === 'DELETE' || (oldId && !newRow?.id)) {
            if (oldId) {
              void db.travels.delete(oldId)
              setTravels((prev) => prev.filter((t) => t.id !== oldId))
              setSelected((s) => (s && s.id === oldId ? null : s))
            }
            return
          }
          if (newRow?.id) {
            void (async () => {
              const pending = await pendingRowIds('travels')
              if (!pending.has(String(newRow.id))) {
                await db.travels.put(newRow as unknown as Travel)
              }
              await reload()
            })()
          }
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, userId])

  const persist = useCallback(
    async (t: Travel) => {
      const row: Travel = { ...t, user_id: userId }
      await db.travels.put(row)
      await enqueueAndMaybeFlush('travels', t.created_at === t.updated_at ? 'insert' : 'update', t.id, row)
      await reload()
    },
    [reload, userId],
  )

  const handleNewTrip = (t: Travel) => {
    setShowNew(false)
    void (async () => {
      try {
        await persist(t)
      } catch (e) {
        console.error('[travel] 新建落库失败:', e)
      }
    })()
  }

  const handleDeleteTrip = (t: Travel) => {
    setDel(null)
    setSelected(null)
    void (async () => {
      try {
        await db.travels.delete(t.id)
        await enqueueAndMaybeFlush('travels', 'delete', t.id)
        await reload()
      } catch (e) {
        console.error('[travel] 删除落库失败:', e)
      }
    })()
  }

  const handleDetailChange = (t: Travel) => {
    void (async () => {
      try {
        await persist(t)
        setSelected(t)
      } catch (e) {
        console.error('[travel] 详情更新落库失败:', e)
      }
    })()
  }

  const visited = useMemo(() => new Set(travels.map((t) => t.province_adcode).filter(Boolean)), [travels])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return travels
    return travels.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.city.toLowerCase().includes(q) ||
        t.province_name.toLowerCase().includes(q),
    )
  }, [travels, search])

  const openByProvince = (adcode: string) => {
    const t = travels.find((x) => x.province_adcode === adcode)
    if (t) setSelected(t)
  }

  return (
    <div className="relative w-full">
      {/* 顶部导航：固定透明 */}
      <nav className="fixed left-0 right-0 top-0 z-30 bg-transparent">
        <div className="flex items-center justify-between gap-2.5 px-[10px] py-4 md:pl-[120px] md:pr-12">
          <h1 className="flex items-baseline gap-1 text-base font-semibold text-white/90">
            旅行记录
            <span className="text-xs font-normal text-white/40">{travels.length} 段</span>
          </h1>
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => {
                setShowSearch((s) => !s)
                if (showSearch) setSearch('')
              }}
              aria-label="搜索"
              className={`grid h-9 w-9 place-items-center rounded-full backdrop-blur-md transition ${
                showSearch ? 'bg-accent/20 text-accent' : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            {showSearch && (
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索目的地 / 城市"
                className="h-9 w-40 rounded-full border border-white/10 bg-black/40 px-4 text-sm text-white/90 outline-none backdrop-blur-md focus:border-accent/50 md:w-56"
              />
            )}
            <div className="relative" ref={funcRef}>
              <button
                onClick={() => setShowFunc((f) => !f)}
                aria-label="功能"
                aria-haspopup="menu"
                aria-expanded={showFunc}
                className="grid h-9 w-9 place-items-center rounded-full bg-white/10 backdrop-blur-md transition hover:bg-white/20"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              {showFunc && (
                <div className="animate-popover absolute right-0 top-11 z-40 w-40 overflow-hidden rounded-xl border border-white/10 bg-[#15151c]/95 p-1.5 shadow-2xl backdrop-blur-xl">
                  <button
                    onClick={() => {
                      setShowFunc(false)
                      setShowNew(true)
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-white/85 transition hover:bg-white/10"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    新建行程
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {syncError && (
        <div className="px-3 pt-[62px] md:pl-[120px] md:pr-12 md:pt-[92px]">
          <div className="mb-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {syncError}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-[1400px] px-3 pb-16 pt-[72px] md:pt-[100px]">
        {loading ? (
          <div className="py-20 text-center text-sm text-white/40">加载中…</div>
        ) : travels.length === 0 ? (
          <div className="py-20 text-center text-sm text-white/40">
            还没有旅行记录。点击右上角「功能 → 新建行程」，地图对应省份会随之点亮。
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_1.05fr]">
            {/* 左：地图（桌面 sticky） */}
            <div className="lg:sticky lg:top-[100px] lg:h-[calc(100vh-120px)] lg:self-start">
              <ChinaMap visited={visited} onProvinceClick={openByProvince} />
            </div>
            {/* 右：瀑布流 */}
            <div className="columns-1 gap-4 sm:columns-2 [&>*]:mb-4">
              {visible.map((t) => (
                <div key={t.id} className="break-inside-avoid">
                  <TripCard
                    trip={t}
                    onOpen={setSelected}
                    onEdit={setSelected}
                    onDelete={setDel}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 详情面板（桌面右侧 dock / 移动端全屏） */}
      {selected && (
        <TravelDetailPanel
          trip={selected}
          onClose={() => setSelected(null)}
          onChange={handleDetailChange}
          onDelete={setDel}
        />
      )}

      {showNew && (
        <NewTripModal onClose={() => setShowNew(false)} onSave={handleNewTrip} />
      )}

      {del && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#15151c] p-4 shadow-2xl">
            <h3 className="text-base font-semibold text-white/90">删除行程</h3>
            <p className="mt-2 text-sm text-white/60">
              确定删除「{del.title}」？该操作会从本地与云端一并移除，不可恢复。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDel(null)}
                className="rounded-lg px-4 py-2 text-sm text-white/60 transition hover:bg-white/10"
              >
                取消
              </button>
              <button
                onClick={() => handleDeleteTrip(del)}
                className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition hover:bg-danger/90"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
