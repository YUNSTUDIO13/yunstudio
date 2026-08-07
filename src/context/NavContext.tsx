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
import type { BuiltinModuleId } from '../lib/builtin-modules'
import type { IconKey } from '../lib/icon-library'
import { DEFAULT_NAV_CONFIG } from '../lib/default-nav'
import type { NavConfig, NavPrimary, SecondaryColumn } from '../lib/nav-types'
import { uid } from '../lib/nav-types'
import { useAuth } from './AuthContext'

// ============================================================
// 类型
// ============================================================
interface NavActions {
  // 一级 Tab
  addPrimary(input: { title: string; iconKey: IconKey }): NavPrimary
  updatePrimary(id: string, patch: Partial<Pick<NavPrimary, 'title' | 'iconKey'>>): void
  removePrimary(id: string): void
  movePrimary(id: string, direction: 'up' | 'down'): void
  // 二级列
  addSecondary(primaryId: string, input: { title: string }): SecondaryColumn | null
  updateSecondary(primaryId: string, groupId: string, title: string): void
  removeSecondary(primaryId: string, groupId: string): void
  moveSecondary(primaryId: string, groupId: string, direction: 'up' | 'down'): void
  // 三级模块
  setGroupModules(primaryId: string, groupId: string, modules: BuiltinModuleId[]): void
  // 整体
  resetToDefault(): void
}

interface NavContextValue {
  config: NavConfig
  // 用 moduleId 反查一级 Tab（即 Dock 高亮 / Mega Menu 归属）
  findPrimaryByModule(moduleId: BuiltinModuleId): NavPrimary | null
  findSecondaryByModule(
    moduleId: BuiltinModuleId,
  ): { primary: NavPrimary; group: SecondaryColumn } | null
  actions: NavActions
}

const NavContext = createContext<NavContextValue | null>(null)

// ============================================================
// Supabase 持久化（user_configs 表，kind='nav'）
// 读取优先级：云端 → localStorage 兜底 → 默认
// 写入：云端 upsert + localStorage 双写；云端失败静默回退本地
// ============================================================
const TABLE = 'user_configs'
const NAV_KIND = 'nav'

function storageKey(userId: string): string {
  return `pw.nav.${userId}`
}

/**
 * 兼容映射：把老版本的 primary.id 重命名到新 id，避免升级时 dock 丢格
 *  - 'p_settings' → 'p_nav_settings'（M2.2 升级：设置 → 导航设置）
 */
function migrateConfig(cfg: NavConfig): NavConfig {
  let primaries = cfg.primaries.map((p) => {
    if (p.id === 'p_settings') {
      return { ...p, id: 'p_nav_settings', title: p.title === '设置' ? '导航设置' : p.title }
    }
    return p
  })

  // M2.10：若旧配置缺「新闻」一级 Tab，则按默认补齐（不破坏用户已有自定义）
  const hasNews = primaries.some((p) => p.groups.some((g) => g.modules.includes('news')))
  if (!hasNews) {
    const defaultNews = DEFAULT_NAV_CONFIG.primaries.find((p) => p.id === 'p_news')
    if (defaultNews) {
      primaries = [...primaries, { ...defaultNews, order: primaries.length + 1 }]
    }
  }

  return { ...cfg, primaries }
}

function loadFromStorage(userId: string): NavConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as NavConfig
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.primaries)) return null
    return parsed
  } catch {
    return null
  }
}

function saveToStorage(userId: string, config: NavConfig): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(config))
  } catch {
    // quota / private mode：静默失败（演示阶段不用上报）
  }
}

// ============================================================
// Provider
// ============================================================
export function NavProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? 'anonymous'
  const [config, setConfig] = useState<NavConfig>(DEFAULT_NAV_CONFIG)

  // ----- 加载：云端优先，localStorage 兜底，无则默认 -----
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!user) {
        setConfig(DEFAULT_NAV_CONFIG)
        return
      }
      const { data, error } = await supabase
        .from(TABLE)
        .select('config')
        .eq('user_id', user.id)
        .eq('kind', NAV_KIND)
        .maybeSingle()
      if (cancelled) return
      if (data?.config) {
        setConfig(migrateConfig(data.config as NavConfig))
      } else if (!error) {
        // 云端无记录 → 试 localStorage
        const local = loadFromStorage(user.id)
        setConfig(local ? migrateConfig(local) : DEFAULT_NAV_CONFIG)
      } else {
        // 云端异常（多见于表未创建）→ localStorage 兜底
        const local = loadFromStorage(user.id)
        setConfig(local ? migrateConfig(local) : DEFAULT_NAV_CONFIG)
        console.warn('[nav] 云端读取失败，已用本地兜底：', error.message)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [user])

  // ----- 持久化：云端 upsert + localStorage 双写 -----
  const persist = useCallback(
    async (next: NavConfig) => {
      setConfig(next)
      if (user && userId !== 'anonymous') saveToStorage(user.id, next)
      if (user) {
        const { error } = await supabase
          .from(TABLE)
          .upsert(
            { user_id: user.id, kind: NAV_KIND, config: next },
            { onConflict: 'user_id,kind' },
          )
        if (error) {
          console.warn('[nav] 云端保存失败，已保留本地：', error.message)
        }
      }
    },
    [user, userId],
  )

  // ----- Realtime：多 PC 同步 -----
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`user_configs:nav:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLE,
          filter: `user_id=eq.${user.id}`,
        },
        (payload: RealtimePostgresChangesPayload<{ kind: string; config: NavConfig }>) => {
          const kind = (payload.new as { kind?: string })?.kind
          if (kind !== NAV_KIND) return
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const cfg = (payload.new as { config?: NavConfig }).config
            if (cfg) setConfig(migrateConfig(cfg))
          }
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  // ----- 派生查找 -----
  const findPrimaryByModule = useCallback(
    (moduleId: BuiltinModuleId): NavPrimary | null => {
      for (const p of config.primaries) {
        if (p.groups.some((g) => g.modules.includes(moduleId))) return p
      }
      return null
    },
    [config],
  )

  const findSecondaryByModule = useCallback(
    (moduleId: BuiltinModuleId) => {
      for (const p of config.primaries) {
        const g = p.groups.find((gg) => gg.modules.includes(moduleId))
        if (g) return { primary: p, group: g }
      }
      return null
    },
    [config],
  )

  // ----- Actions -----
  const actions: NavActions = useMemo(() => {
    // 排序用的稳定 sort
    const sorted = (primaries: NavPrimary[]) =>
      [...primaries].sort((a, b) => a.order - b.order)

    const commit = (next: NavConfig) => {
      void persist(next)
      return next
    }

    return {
      addPrimary({ title, iconKey }) {
        const newP: NavPrimary = {
          id: uid('p'),
          title,
          iconKey,
          order: config.primaries.length
            ? Math.max(...config.primaries.map((p) => p.order)) + 1
            : 1,
          groups: [{ id: uid('g'), title: '默认', modules: [] }],
        }
        commit({ ...config, primaries: [...config.primaries, newP] })
        return newP
      },

      updatePrimary(id, patch) {
        commit({
          ...config,
          primaries: config.primaries.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })
      },

      removePrimary(id) {
        commit({
          ...config,
          primaries: config.primaries.filter((p) => p.id !== id),
        })
      },

      movePrimary(id, direction) {
        const ordered = sorted(config.primaries)
        const idx = ordered.findIndex((p) => p.id === id)
        if (idx < 0) return
        const target = direction === 'up' ? idx - 1 : idx + 1
        if (target < 0 || target >= ordered.length) return
        const swap = [...ordered]
        ;[swap[idx], swap[target]] = [swap[target], swap[idx]]
        commit({
          ...config,
          primaries: swap.map((p, i) => ({ ...p, order: i + 1 })),
        })
      },

      addSecondary(primaryId, { title }) {
        const p = config.primaries.find((x) => x.id === primaryId)
        if (!p) return null
        const g: SecondaryColumn = { id: uid('g'), title, modules: [] }
        commit({
          ...config,
          primaries: config.primaries.map((pp) =>
            pp.id === primaryId ? { ...pp, groups: [...pp.groups, g] } : pp,
          ),
        })
        return g
      },

      updateSecondary(primaryId, groupId, title) {
        commit({
          ...config,
          primaries: config.primaries.map((pp) =>
            pp.id === primaryId
              ? {
                  ...pp,
                  groups: pp.groups.map((g) => (g.id === groupId ? { ...g, title } : g)),
                }
              : pp,
          ),
        })
      },

      removeSecondary(primaryId, groupId) {
        commit({
          ...config,
          primaries: config.primaries.map((pp) =>
            pp.id === primaryId
              ? { ...pp, groups: pp.groups.filter((g) => g.id !== groupId) }
              : pp,
          ),
        })
      },

      moveSecondary(primaryId, groupId, direction) {
        commit({
          ...config,
          primaries: config.primaries.map((pp) => {
            if (pp.id !== primaryId) return pp
            const idx = pp.groups.findIndex((g) => g.id === groupId)
            if (idx < 0) return pp
            const target = direction === 'up' ? idx - 1 : idx + 1
            if (target < 0 || target >= pp.groups.length) return pp
            const groups = [...pp.groups]
            ;[groups[idx], groups[target]] = [groups[target], groups[idx]]
            return { ...pp, groups }
          }),
        })
      },

      setGroupModules(primaryId, groupId, modules) {
        // 去重保留顺序
        const unique: BuiltinModuleId[] = []
        for (const m of modules) {
          if (!unique.includes(m)) unique.push(m)
        }
        commit({
          ...config,
          primaries: config.primaries.map((pp) =>
            pp.id === primaryId
              ? {
                  ...pp,
                  groups: pp.groups.map((g) =>
                    g.id === groupId ? { ...g, modules: unique } : g,
                  ),
                }
              : pp,
          ),
        })
      },

      resetToDefault() {
        commit(DEFAULT_NAV_CONFIG)
      },
    }
  }, [config, persist])

  const value: NavContextValue = {
    config,
    findPrimaryByModule,
    findSecondaryByModule,
    actions,
  }

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>
}

// ============================================================
// Hooks
// ============================================================
export function useNav(): NavContextValue {
  const ctx = useContext(NavContext)
  if (!ctx) throw new Error('useNav 必须在 NavProvider 内使用')
  return ctx
}

export function useNavActions(): NavActions {
  return useNav().actions
}
