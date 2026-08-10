import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { DEFAULT_DASHBOARD, WIDGETS, WIDGET_LIST, DEFAULT_SIZES, type WidgetDef, type WidgetSize } from '../widgets/registry'

// ============================================================
// 类型
// ============================================================
interface DashboardConfig {
  version: number
  /** 启用的卡片 id，按展示顺序 */
  widgetIds: string[]
  /** 每个卡片的二维尺寸（宽×高，单位=网格单元格）；缺失时回退默认尺寸 */
  sizes: Record<string, WidgetSize>
  /** 编辑时间戳（ISO）；多端按"最后编辑胜"收敛，刷新时仅云端更新于本地才覆盖 */
  updated_at?: string
}

interface DashboardActions {
  addWidget: (id: string) => void
  removeWidget: (id: string) => void
  moveWidget: (id: string, direction: 'up' | 'down') => void
  setWidgetSize: (id: string, size: WidgetSize) => void
  resetToDefault: () => void
}

interface DashboardContextValue {
  config: DashboardConfig
  /** 已启用的卡片定义（按 config.widgetIds 顺序，过滤掉不存在的 id） */
  widgets: WidgetDef[]
  actions: DashboardActions
}

const DashboardContext = createContext<DashboardContextValue | null>(null)

// ============================================================
// Supabase 持久化（user_configs 表，kind='dashboard'）
// 读取优先级：云端 → localStorage 兜底 → 默认
// 写入：云端 upsert + localStorage 双写；云端失败静默回退本地
// ============================================================
const TABLE = 'user_configs'
const DASHBOARD_KIND = 'dashboard'

function storageKey(userId: string): string {
  return `pw.dash.${userId}`
}

// 记录「上次登录的 userId」，用于在首帧同步读出其自定义布局，
// 消除「默认布局 → 自定义布局」的闪屏（FOUC）。
const LAST_USER_KEY = 'pw.lastUserId'
function readLastUserId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(LAST_USER_KEY)
  } catch {
    return null
  }
}
function writeLastUserId(id: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LAST_USER_KEY, id)
  } catch {
    // ignore quota / private mode
  }
}

function isDashboardConfig(x: unknown): x is DashboardConfig {
  return (
    !!x &&
    typeof x === 'object' &&
    (x as DashboardConfig).version === 1 &&
    Array.isArray((x as DashboardConfig).widgetIds)
  )
}

function loadFromStorage(userId: string): DashboardConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return isDashboardConfig(parsed) ? parsed : null
  } catch {
    return null
  }
}

function saveToStorage(userId: string, config: DashboardConfig): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(config))
  } catch {
    // quota / private mode：静默失败
  }
}

// 首帧兜底：扫描所有 pw.dash.* 键，命中任一合法自定义布局。
// 用于「旧版本从未写入 pw.lastUserId、但 pw.dash.{userId} 已存在」的回访场景，
// 确保首帧直接渲染自定义布局而不经默认态中间帧。
function loadAnyStoredConfig(): DashboardConfig | null {
  if (typeof window === 'undefined') return null
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key && key.startsWith('pw.dash.') && key !== LAST_USER_KEY) {
        const parsed = JSON.parse(window.localStorage.getItem(key) || 'null')
        if (isDashboardConfig(parsed)) return parsed
      }
    }
  } catch {
    return null
  }
  return null
}

// ============================================================
// Provider
// ============================================================
export function DashboardProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? 'anonymous'
  // 首帧同步读出自定义布局，避免先渲染默认态再闪回自定义态（FOUC）
  const [config, setConfig] = useState<DashboardConfig>(() => {
    const hydrate = (c: DashboardConfig): DashboardConfig => ({
      ...c,
      sizes: { ...DEFAULT_SIZES, ...(c.sizes ?? {}) },
    })
    const last = readLastUserId()
    if (last) {
      const local = loadFromStorage(last)
      if (local) return hydrate(local)
    }
    // 兜底：旧版未写 lastUserId，但 pw.dash.{userId} 已存在的回访场景
    const any = loadAnyStoredConfig()
    if (any) return hydrate(any)
    return { version: 1, widgetIds: DEFAULT_DASHBOARD, sizes: { ...DEFAULT_SIZES } }
  })

  // ----- 加载：首帧已用本地同步渲染（无 FOUC）；挂载后 Always 回云端对齐，多设备收敛 -----
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!user) {
        setConfig({ version: 1, widgetIds: DEFAULT_DASHBOARD, sizes: { ...DEFAULT_SIZES } })
        return
      }
      writeLastUserId(user.id)
      const { data, error } = await supabase
        .from(TABLE)
        .select('config')
        .eq('user_id', user.id)
        .eq('kind', DASHBOARD_KIND)
        .maybeSingle()
      if (cancelled) return
      if (data?.config && isDashboardConfig(data.config)) {
        const loaded = data.config
        const merged = { ...loaded, sizes: { ...DEFAULT_SIZES, ...(loaded.sizes ?? {}) } }
        const localCustom = loadFromStorage(user.id)
        // 多端 last-write-wins：仅当云端比本地"更新"才覆盖，否则保持本地现状 → 刷新不闪屏
        // 缺时间戳（旧数据）时以云端为准，触发一次性收敛
        const localTs = localCustom?.updated_at
        const cloudTs = merged.updated_at
        const cloudNewer =
          !localCustom || (cloudTs && localTs ? cloudTs > localTs : true)
        if (!cloudNewer) return // 本地已是最新/更新 → 保持本地，不闪
        setConfig(merged)
        return
      }
      // 云端无数据 / 读取失败：保留首帧已渲染的本地布局（若本地也无则维持默认）
      if (error) {
        console.warn('[dashboard] 云端读取失败，已用本地兜底：', error.message)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [user])

  // ----- 持久化：云端 upsert + localStorage 双写；每次编辑打 updated_at 时间戳 -----
  const persist = useCallback(
    async (next: DashboardConfig) => {
      const stamped: DashboardConfig = { ...next, updated_at: new Date().toISOString() }
      setConfig(stamped)
      if (user && userId !== 'anonymous') {
        saveToStorage(user.id, stamped)
        writeLastUserId(user.id)
      }
      if (user) {
        const { error } = await supabase
          .from(TABLE)
          .upsert(
            { user_id: user.id, kind: DASHBOARD_KIND, config: stamped },
            { onConflict: 'user_id,kind' },
          )
        if (error) {
          console.warn('[dashboard] 云端保存失败，已保留本地：', error.message)
        }
      }
    },
    [user, userId],
  )

  // ----- Realtime：多 PC 同步 -----
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`user_configs:dashboard:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLE,
          filter: `user_id=eq.${user.id}`,
        },
        (
          payload: RealtimePostgresChangesPayload<{
            kind: string
            config: DashboardConfig
          }>,
        ) => {
          const kind = (payload.new as { kind?: string })?.kind
          if (kind !== DASHBOARD_KIND) return
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const cfg = (payload.new as { config?: DashboardConfig }).config
            if (cfg && isDashboardConfig(cfg)) {
              // 仅当云端变更更新（或等于）本地才采纳，防陈旧回声覆盖本地新编辑
              setConfig((prev) => {
                const curTs = prev.updated_at
                const newTs = cfg.updated_at
                return !curTs || !newTs || newTs >= curTs ? cfg : prev
              })
            }
          }
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  // 派生：按配置顺序过滤出有效卡片
  const widgets = useMemo(
    () =>
      config.widgetIds
        .map((id) => WIDGETS[id])
        .filter((w): w is WidgetDef => Boolean(w)),
    [config.widgetIds],
  )

  const actions: DashboardActions = useMemo(
    () => ({
      addWidget(id) {
        if (config.widgetIds.includes(id) || !WIDGETS[id]) return
        void persist({
          ...config,
          widgetIds: [...config.widgetIds, id],
          sizes: { ...config.sizes, [id]: config.sizes[id] ?? WIDGETS[id].defaultSize ?? '1x1' },
        })
      },
      removeWidget(id) {
        void persist({ ...config, widgetIds: config.widgetIds.filter((x) => x !== id) })
      },
      moveWidget(id, direction) {
        const idx = config.widgetIds.indexOf(id)
        if (idx < 0) return
        const target = direction === 'up' ? idx - 1 : idx + 1
        if (target < 0 || target >= config.widgetIds.length) return
        const next = [...config.widgetIds]
        ;[next[idx], next[target]] = [next[target], next[idx]]
        void persist({ ...config, widgetIds: next })
      },
      setWidgetSize(id, size) {
        void persist({ ...config, sizes: { ...config.sizes, [id]: size } })
      },
      resetToDefault() {
        void persist({ version: 1, widgetIds: DEFAULT_DASHBOARD, sizes: { ...DEFAULT_SIZES } })
      },
    }),
    [config, persist],
  )

  const value: DashboardContextValue = { config, widgets, actions }
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}

// ============================================================
// Hooks
// ============================================================
export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext)
  if (!ctx) throw new Error('useDashboard 必须在 DashboardProvider 内使用')
  return ctx
}

export { WIDGET_LIST }
