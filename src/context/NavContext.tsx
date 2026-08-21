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
import { BUILTIN_MODULE_IDS, type BuiltinModuleId } from '../lib/builtin-modules'
import type { IconKey } from '../lib/icon-library'
import { DEFAULT_NAV_CONFIG } from '../lib/default-nav'
import type { NavConfig, NavPrimary, SecondaryColumn } from '../lib/nav-types'
import { uid } from '../lib/nav-types'
import { useAuth } from './AuthContext'
import { readLastUserId, writeLastUserId } from './DashboardContext'

// ============================================================
// 类型
// ============================================================
interface NavActions {
  // 一级 Tab
  addPrimary(input: { title: string; iconKey: IconKey; directModule?: BuiltinModuleId | null }): NavPrimary
  updatePrimary(id: string, patch: Partial<Pick<NavPrimary, 'title' | 'iconKey' | 'directModule'>>): void
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
  // 是否已加载/确认：本地有数据则首帧同步放行（无默认闪屏）；
  // 本地无数据（清缓存/首次）则等云端拉到再放行（避免默认态闪现）。用法同 DashboardContext.hydrated。
  hydrated: boolean
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
  // 诊断：若旧配置含已下线的模块（如 KPI 刚下线），记录便于排查「hover 导航整屏清除」根因
  const invalid: string[] = []
  for (const p of cfg.primaries) {
    if (p.directModule && !(BUILTIN_MODULE_IDS as readonly string[]).includes(p.directModule)) {
      invalid.push(p.directModule)
    }
    for (const g of p.groups) {
      for (const m of g.modules) {
        if (!(BUILTIN_MODULE_IDS as readonly string[]).includes(m)) invalid.push(m)
      }
    }
  }
  if (invalid.length) {
    console.warn('[nav] 已剔除旧配置中的无效模块（可能已下线的模块如 KPI）：', [...new Set(invalid)])
  }

  // 1) 剔除已下线的模块引用（如 KPI 下线后旧配置仍含 'kpis'），
  //    否则 MegaMenu 渲染 BUILTIN_MODULES[m].route 会因 undefined 而整屏崩溃
  const sanitized = {
    ...cfg,
    primaries: cfg.primaries.map((p) => ({
      ...p,
      directModule:
        p.directModule && (BUILTIN_MODULE_IDS as readonly string[]).includes(p.directModule)
          ? p.directModule
          : null,
      groups: p.groups.map((g) => ({
        ...g,
        modules: g.modules.filter((m) => (BUILTIN_MODULE_IDS as readonly string[]).includes(m)),
      })),
    })),
  }

  let primaries: NavPrimary[] = sanitized.primaries.map((p) => {
    if (p.id === 'p_settings') {
      return { ...p, id: 'p_nav_settings', title: p.title === '设置' ? '导航设置' : p.title }
    }
    // 字典模块上线（2026-08-10）：p_nav_settings → p_system_settings（系统设置）
    // 旧"导航设置"一级 Tab 自动合并到"系统设置"，避免一个老用户看到两个相似的设置 Tab
    if (p.id === 'p_nav_settings') {
      return { ...p, id: 'p_system_settings', title: p.title === '导航设置' ? '系统设置' : p.title }
    }
    return p
  })

  // 注：早期「新闻 / 应用」一级 Tab 的前向补齐逻辑已移除——新用户由 DEFAULT_NAV_CONFIG 自带这两个
  // Tab，老用户若曾缺失也早已补齐过；此处不再按「是否含模块」反复补齐，以尊重用户在导航设置中的
  // 主动删除（否则每次加载 migrateConfig 都会把用户删掉的 Tab 重新加回来，出现「删了又自动新增」）。

  // 系统设置（2026-08-11）：老账户 config 可能整体缺失 p_system_settings（早期版本未自动种入）。
  // 仅在「完全缺失」时一次性种入默认 primary（含 nav-config / tag-dict 两条默认二级列），
  // 让下游 moveSecondary / removeSecondary / addSecondary / setGroupModules 等 actions 都能命中。
  // 重要：种入后**绝不**在后续加载中回填 nav-config / tag-dict —— 系统设置模块与其他一级 Tab 行为
  // 完全一致，用户对二级列的增删改必须被尊重并持久化，禁止「诈尸」式自动恢复。
  let sysIdx = primaries.findIndex((p) => p.id === 'p_system_settings')
  const defaultSys = DEFAULT_NAV_CONFIG.primaries.find((p) => p.id === 'p_system_settings')
  if (sysIdx < 0 && defaultSys) {
    const seedGroups = defaultSys.groups.map((g) => ({ ...g, id: uid('g') }))
    primaries = [
      ...primaries,
      {
        id: 'p_system_settings',
        title: defaultSys.title,
        iconKey: defaultSys.iconKey,
        order: defaultSys.order,
        groups: seedGroups,
      },
    ]
    sysIdx = primaries.length - 1
  }

  // UI 设置模块（2026-08-11）：向老账户的 p_system_settings 下一次性追加「UI 设置」二级列，
  // 包含默认 ui-settings 模块（一次性前向迁移，与 news/apps 同源；用户后续删除不再自动恢复）。
  if (sysIdx >= 0 && defaultSys) {
    const sysP = primaries[sysIdx]
    const hasUISettings = sysP.groups.some((g) => g.modules.includes('ui-settings'))
    if (!hasUISettings) {
      const uiGroup = defaultSys.groups.find((g) => g.modules.includes('ui-settings'))
      if (uiGroup) {
        const newGroup = { ...uiGroup, id: uid('g') }
        primaries = [
          ...primaries.slice(0, sysIdx),
          { ...sysP, groups: [...sysP.groups, newGroup] },
          ...primaries.slice(sysIdx + 1),
        ]
      }
    }
  }

  // 旅行模块（2026-08-21）：向老账户的导航一次性追加「旅行」一级 Tab（含默认 travel 模块）。
  // 与 ui-settings 同源的一次性前向迁移；用户后续删除该 Tab 不再自动恢复（尊重主动删除）。
  {
    const hasTravel = primaries.some((p) => p.groups.some((g) => g.modules.includes('travel')))
    if (!hasTravel) {
      const travelPrimary = DEFAULT_NAV_CONFIG.primaries.find((p) => p.id === 'p_travel')
      if (travelPrimary) {
        primaries = [
          ...primaries,
          {
            ...travelPrimary,
            id: 'p_travel',
            groups: travelPrimary.groups.map((g) => ({ ...g, id: uid('g') })),
          },
        ]
      }
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

  // 首帧同步读出上次登录用户的导航配置，避免先渲染默认 Tab 再闪回自定义 Tab（FOUC）。
  // 与 DashboardContext 同策略：useState 初始化器同步读 localStorage，hadLocal 决定初始 hydrated。
  const [config, setConfig] = useState<NavConfig>(() => {
    const last = readLastUserId()
    if (last) {
      const local = loadFromStorage(last)
      if (local) return migrateConfig(local)
    }
    return DEFAULT_NAV_CONFIG
  })
  const [hydrated, setHydrated] = useState<boolean>(() => {
    const last = readLastUserId()
    return !!(last && loadFromStorage(last))
  })

  // ----- 加载：首帧已由种子同步渲染本地（无 FOUC）；挂载回云端校正 -----
  // 同步时序铁律（与看板一致）：本地有数据 → 首帧直接渲染本地（零闪）；
  // 挂载后回云端按「云端优先」校正——云端有则以云端为准（多端一致 + 可从云端恢复本地污染），
  // 绝不在 user=null 时强行 setConfig(DEFAULT) 吞噬种子。
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
        // 认证解析窗口：种子已渲染（真实或默认），绝不强行覆盖为 DEFAULT，避免 FOUC / 吞噬本地
        finish()
        return
      }
      writeLastUserId(user.id)
      const local = loadFromStorage(user.id)
      // 先把本地落盘（与种子一致），避免后续被误判
      if (local) saveToStorage(user.id, local)
      // 云端优先：拉云端配置
      const { data, error } = await supabase
        .from(TABLE)
        .select('config')
        .eq('user_id', user.id)
        .eq('kind', NAV_KIND)
        .maybeSingle()
      if (cancelled) return
      if (data?.config) {
        // 云端有 → 以云端为准（多端一致；若本地被污染也能从云端恢复）
        const merged = migrateConfig(data.config as NavConfig)
        setConfig(merged)
        saveToStorage(user.id, merged)
      } else if (!error) {
        // 云端无记录 → 用本地（若有）或默认
        if (local) setConfig(migrateConfig(local))
        else setConfig(DEFAULT_NAV_CONFIG)
      } else {
        // 云端异常（多见于表未创建）→ 本地兜底
        if (local) setConfig(migrateConfig(local))
        else setConfig(DEFAULT_NAV_CONFIG)
        console.warn('[nav] 云端读取失败，已用本地兜底：', error.message)
      }
      finish()
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
      if (user && userId !== 'anonymous') {
        saveToStorage(user.id, next)
        writeLastUserId(user.id)
      }
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
        if (p.directModule && p.directModule === moduleId) return p
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
      addPrimary({ title, iconKey, directModule = null }) {
        const newP: NavPrimary = {
          id: uid('p'),
          title,
          iconKey,
          directModule,
          order: config.primaries.length
            ? Math.max(...config.primaries.map((p) => p.order)) + 1
            : 1,
          // 直接模式：绑定单一模块，无二级列载体；菜单模式：补一个默认空二级列
          groups: directModule ? [] : [{ id: uid('g'), title: '默认', modules: [] }],
        }
        commit({ ...config, primaries: [...config.primaries, newP] })
        return newP
      },

      updatePrimary(id, patch) {
        commit({
          ...config,
          primaries: config.primaries.map((p) => {
            if (p.id !== id) return p
            const next = { ...p, ...patch }
            // directModule 变化时同步处理二级列：直接模式清空、回到菜单模式补默认空列
            if (patch.directModule !== undefined) {
              if (patch.directModule) {
                next.groups = []
              } else if (next.groups.length === 0) {
                next.groups = [{ id: uid('g'), title: '默认', modules: [] }]
              }
            }
            return next
          }),
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
    hydrated,
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
