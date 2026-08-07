import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from './AuthContext'
import { DEFAULT_DASHBOARD, WIDGETS, WIDGET_LIST, type WidgetDef } from '../widgets/registry'

// ============================================================
// 类型
// ============================================================
interface DashboardConfig {
  version: number
  /** 启用的卡片 id，按展示顺序 */
  widgetIds: string[]
}

interface DashboardActions {
  addWidget: (id: string) => void
  removeWidget: (id: string) => void
  moveWidget: (id: string, direction: 'up' | 'down') => void
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
// localStorage 持久化（按 user 隔离：pw.dash.<uid>）
// ============================================================
function storageKey(userId: string): string {
  return `pw.dash.${userId}`
}

function loadFromStorage(userId: string): DashboardConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as DashboardConfig
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.widgetIds)) return null
    return parsed
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

// ============================================================
// Provider
// ============================================================
export function DashboardProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? 'anonymous'
  const [config, setConfig] = useState<DashboardConfig>({ version: 1, widgetIds: DEFAULT_DASHBOARD })

  useEffect(() => {
    const loaded = loadFromStorage(userId)
    if (loaded) setConfig(loaded)
    else setConfig({ version: 1, widgetIds: DEFAULT_DASHBOARD })
  }, [userId])

  useEffect(() => {
    if (userId !== 'anonymous') saveToStorage(userId, config)
  }, [userId, config])

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
        setConfig((c) => {
          if (c.widgetIds.includes(id)) return c
          if (!WIDGETS[id]) return c
          return { ...c, widgetIds: [...c.widgetIds, id] }
        })
      },
      removeWidget(id) {
        setConfig((c) => ({ ...c, widgetIds: c.widgetIds.filter((x) => x !== id) }))
      },
      moveWidget(id, direction) {
        setConfig((c) => {
          const idx = c.widgetIds.indexOf(id)
          if (idx < 0) return c
          const target = direction === 'up' ? idx - 1 : idx + 1
          if (target < 0 || target >= c.widgetIds.length) return c
          const next = [...c.widgetIds]
          ;[next[idx], next[target]] = [next[target], next[idx]]
          return { ...c, widgetIds: next }
        })
      },
      resetToDefault() {
        setConfig({ version: 1, widgetIds: DEFAULT_DASHBOARD })
      },
    }),
    [],
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
