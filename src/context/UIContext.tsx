import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

// ============================================================
// 类型
// ============================================================

/** 指针主题 id 集合（与 CursorFX 一一对应） */
export type ThemeId = 'particles' | 'comet'

export const THEME_LABELS: Record<ThemeId, { title: string; desc: string }> = {
  particles: {
    title: '光粒特效',
    desc: '指针移动时洒落流光颗粒，多点叠加、additive 混合，自然弥散',
  },
  comet: {
    title: '流光特效',
    desc: '指针轨迹拖出彗星尾巴，宽度渐变、颜色尾部淡出',
  },
}

export const THEME_IDS: ThemeId[] = ['particles', 'comet']

/** 单主题配置 */
export interface ThemeConfig {
  enabled: boolean
  /** hex 颜色（含 #），如 '#a78bfa' */
  color: string
}

/** UI 设置总配置（按用户持久化到 user_configs / kind='ui_settings'） */
export interface UISettingsConfig {
  version: 1
  /** 总开关：默认关闭；关闭时全局指针特效一律不渲染 */
  enabled: boolean
  /** 各主题配置；颜色独立 */
  themes: Record<ThemeId, ThemeConfig>
  /** 编辑时间戳 ISO（与 nav / dashboard 对齐，便于多端 last-write-wins） */
  updated_at?: string
}

const DEFAULT_THEME_COLOR: Record<ThemeId, string> = {
  particles: '#a78bfa', // 靛紫
  comet: '#c084fc',     // 紫
}

export function defaultUISettings(): UISettingsConfig {
  return {
    version: 1,
    enabled: false,
    themes: {
      particles: { enabled: true, color: DEFAULT_THEME_COLOR.particles },
      comet: { enabled: true, color: DEFAULT_THEME_COLOR.comet },
    },
  }
}

function isUISettings(x: unknown): x is UISettingsConfig {
  return !!x && typeof x === 'object' && (x as UISettingsConfig).version === 1
    && typeof (x as UISettingsConfig).enabled === 'boolean'
    && !!(x as UISettingsConfig).themes
}

/** 兜底合并：缺字段时回填默认值（向后兼容老版本配置） */
function hydrate(s: UISettingsConfig): UISettingsConfig {
  const def = defaultUISettings()
  return {
    ...def,
    ...s,
    themes: {
      particles: { ...def.themes.particles, ...(s.themes?.particles ?? {}) },
      comet: { ...def.themes.comet, ...(s.themes?.comet ?? {}) },
    },
  }
}

interface UIContextValue {
  settings: UISettingsConfig
  hydrated: boolean
  /** 立即更新设置（本地+云端双写）；调用方按需防抖 */
  update: (patch: Partial<UISettingsConfig> | ((s: UISettingsConfig) => UISettingsConfig)) => void
  /** 重置默认 */
  reset: () => void
}

const UIContext = createContext<UIContextValue | null>(null)

// ============================================================
// 持久化（user_configs / kind='ui_settings'）—— 与 nav/dashboard 同源
// ============================================================
const TABLE = 'user_configs'
const KIND = 'ui_settings'

function storageKey(userId: string): string {
  return `pw.ui.${userId}`
}

function loadFromStorage(userId: string): UISettingsConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return isUISettings(parsed) ? hydrate(parsed) : null
  } catch {
    return null
  }
}

function saveToStorage(userId: string, cfg: UISettingsConfig): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(cfg))
  } catch {
    // ignore quota / private mode
  }
}

export function UIProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? 'anonymous'

  // 首帧兜底：从 localStorage 同步读出（跨账户登录也用当前 accountId 隔离）
  const [settings, setSettings] = useState<UISettingsConfig>(() => {
    if (userId === 'anonymous') return defaultUISettings()
    return loadFromStorage(userId) ?? defaultUISettings()
  })
  const [hydrated, setHydrated] = useState<boolean>(false)

  // 记录最近一次编辑时间戳（写入用）
  const stamp = () => new Date().toISOString()

  // ----- 加载：本地有 → 首帧直接渲染；挂载后回云端按时间戳收敛 -----
  useEffect(() => {
    let cancelled = false
    let settled = false
    const finish = () => {
      if (!cancelled && !settled) {
        settled = true
        setHydrated(true)
      }
    }
    async function load() {
      if (!user) {
        finish()
        return
      }
      const local = loadFromStorage(user.id)
      if (local) saveToStorage(user.id, local)
      const { data, error } = await supabase
        .from(TABLE)
        .select('config')
        .eq('user_id', user.id)
        .eq('kind', KIND)
        .maybeSingle()
      if (cancelled) return
      const cloud = data?.config && isUISettings(data.config) ? hydrate(data.config) : null
      if (cloud) {
        const localTs = local?.updated_at ?? null
        const cloudTs = cloud.updated_at ?? null
        // 云端优先：若云端更新（或本地无时间戳）则以云端为准；否则保持本地
        if (!localTs || (cloudTs && cloudTs >= localTs)) {
          setSettings(cloud)
          saveToStorage(user.id, cloud)
        }
      } else if (!error && !local) {
        // 云端无、本地无：保持默认（首帧已是默认）
      } else if (error) {
        console.warn('[ui-settings] 云端读取失败，已保留本地：', error.message)
      }
      finish()
    }
    load().catch(() => finish())
    return () => {
      cancelled = true
    }
  }, [user])

  // ----- 持久化：云端 upsert + localStorage 双写 + updated_at -----
  const persist = useCallback(
    async (next: UISettingsConfig) => {
      const stamped: UISettingsConfig = { ...next, updated_at: stamp() }
      setSettings(stamped)
      if (user && userId !== 'anonymous') {
        saveToStorage(user.id, stamped)
      }
      if (user) {
        const { error } = await supabase
          .from(TABLE)
          .upsert(
            { user_id: user.id, kind: KIND, config: stamped },
            { onConflict: 'user_id,kind' },
          )
        if (error) {
          console.warn('[ui-settings] 云端保存失败，已保留本地：', error.message)
        }
      }
    },
    [user, userId],
  )

  // ----- Realtime：多 PC 同步 -----
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`user_configs:ui_settings:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLE,
          filter: `user_id=eq.${user.id}`,
        },
        (payload: RealtimePostgresChangesPayload<{ kind: string; config: UISettingsConfig }>) => {
          const kind = (payload.new as { kind?: string })?.kind
          if (kind !== KIND) return
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const cfg = (payload.new as { config?: UISettingsConfig }).config
            if (cfg && isUISettings(cfg)) {
              setSettings((prev) => {
                const curTs = prev.updated_at
                const newTs = cfg.updated_at
                return !curTs || !newTs || newTs >= curTs ? hydrate(cfg) : prev
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

  const update = useCallback(
    (patch: Partial<UISettingsConfig> | ((s: UISettingsConfig) => UISettingsConfig)) => {
      const next =
        typeof patch === 'function'
          ? (patch as (s: UISettingsConfig) => UISettingsConfig)(settings)
          : { ...settings, ...patch }
      void persist(next)
    },
    [settings, persist],
  )

  const reset = useCallback(() => {
    void persist(defaultUISettings())
  }, [persist])

  const value = useMemo<UIContextValue>(
    () => ({ settings, hydrated, update, reset }),
    [settings, hydrated, update, reset],
  )

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>
}

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useUI 必须在 UIProvider 内使用')
  return ctx
}

// 用于非 React 环境（CursorFX 内部）以 ref 方式拿最新设置
export function useSettingsRef() {
  const { settings } = useUI()
  const ref = useRef(settings)
  ref.current = settings
  return ref
}