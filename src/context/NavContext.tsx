import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
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
// localStorage 持久化（按 user 隔离；key: pw.nav.<uid>）
// ============================================================
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
    const defaultNews = DEFAULT_NAV_CONFIG.primaries.find(
      (p) => p.id === 'p_news',
    )
    if (defaultNews) {
      primaries = [
        ...primaries,
        { ...defaultNews, order: primaries.length + 1 },
      ]
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
    // 简化：仅做最小健壮校验（缺字段则回退默认）
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.primaries)) {
      return DEFAULT_NAV_CONFIG
    }
    return migrateConfig(parsed)
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

  // 加载
  useEffect(() => {
    const loaded = loadFromStorage(userId)
    if (loaded) setConfig(loaded)
    else setConfig(DEFAULT_NAV_CONFIG)
  }, [userId])

  // 持久化
  useEffect(() => {
    if (userId !== 'anonymous') saveToStorage(userId, config)
  }, [userId, config])

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

    return {
      addPrimary({ title, iconKey }) {
        const newP: NavPrimary = {
          id: uid('p'),
          title,
          iconKey,
          order: config.primaries.length
            ? Math.max(...config.primaries.map((p) => p.order)) + 1
            : 1,
          groups: [
            { id: uid('g'), title: '默认', modules: [] },
          ],
        }
        setConfig((c) => ({ ...c, primaries: [...c.primaries, newP] }))
        return newP
      },

      updatePrimary(id, patch) {
        setConfig((c) => ({
          ...c,
          primaries: c.primaries.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        }))
      },

      removePrimary(id) {
        setConfig((c) => ({ ...c, primaries: c.primaries.filter((p) => p.id !== id) }))
      },

      movePrimary(id, direction) {
        setConfig((c) => {
          const ordered = sorted(c.primaries)
          const idx = ordered.findIndex((p) => p.id === id)
          if (idx < 0) return c
          const target = direction === 'up' ? idx - 1 : idx + 1
          if (target < 0 || target >= ordered.length) return c
          const swap = [...ordered]
          ;[swap[idx], swap[target]] = [swap[target], swap[idx]]
          // 重新分配 order
          return {
            ...c,
            primaries: swap.map((p, i) => ({ ...p, order: i + 1 })),
          }
        })
      },

      addSecondary(primaryId, { title }) {
        const p = config.primaries.find((x) => x.id === primaryId)
        if (!p) return null
        const g: SecondaryColumn = { id: uid('g'), title, modules: [] }
        setConfig((c) => ({
          ...c,
          primaries: c.primaries.map((pp) =>
            pp.id === primaryId ? { ...pp, groups: [...pp.groups, g] } : pp,
          ),
        }))
        return g
      },

      updateSecondary(primaryId, groupId, title) {
        setConfig((c) => ({
          ...c,
          primaries: c.primaries.map((pp) =>
            pp.id === primaryId
              ? {
                  ...pp,
                  groups: pp.groups.map((g) => (g.id === groupId ? { ...g, title } : g)),
                }
              : pp,
          ),
        }))
      },

      removeSecondary(primaryId, groupId) {
        setConfig((c) => ({
          ...c,
          primaries: c.primaries.map((pp) =>
            pp.id === primaryId
              ? { ...pp, groups: pp.groups.filter((g) => g.id !== groupId) }
              : pp,
          ),
        }))
      },

      moveSecondary(primaryId, groupId, direction) {
        setConfig((c) => ({
          ...c,
          primaries: c.primaries.map((pp) => {
            if (pp.id !== primaryId) return pp
            const idx = pp.groups.findIndex((g) => g.id === groupId)
            if (idx < 0) return pp
            const target = direction === 'up' ? idx - 1 : idx + 1
            if (target < 0 || target >= pp.groups.length) return pp
            const groups = [...pp.groups]
            ;[groups[idx], groups[target]] = [groups[target], groups[idx]]
            return { ...pp, groups }
          }),
        }))
      },

      setGroupModules(primaryId, groupId, modules) {
        // 去重保留顺序
        const unique: BuiltinModuleId[] = []
        for (const m of modules) {
          if (!unique.includes(m)) unique.push(m)
        }
        setConfig((c) => ({
          ...c,
          primaries: c.primaries.map((pp) =>
            pp.id === primaryId
              ? {
                  ...pp,
                  groups: pp.groups.map((g) =>
                    g.id === groupId ? { ...g, modules: unique } : g,
                  ),
                }
              : pp,
          ),
        }))
      },

      resetToDefault() {
        setConfig(DEFAULT_NAV_CONFIG)
      },
    }
  }, [config])

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
