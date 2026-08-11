import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useProfile } from '../context/ProfileContext'
import { useNav } from '../context/NavContext'
import { renderIcon } from '../lib/icon-library'
import logoUrl from '/logo.jpg'
import { useMediaQuery } from '../lib/useMediaQuery'
import MegaMenu from './MegaMenu'
import MobileMegaSheet from './MobileMegaSheet'
import Avatar from './Avatar'
import type { BuiltinModuleId } from '../lib/builtin-modules'
import type { NavPrimary } from '../lib/nav-types'
import AuroraBackground from '../design/AuroraBackground'
import CursorFX from './CursorFX'

// ============================================================
// 工具
// ============================================================

/**
 * 把 /modules/:id 形式的 url 反推为 BuiltinModuleId
 * /account 这种固定路由返回 null（不动 dock 高亮）
 */
function moduleIdFromPath(pathname: string): BuiltinModuleId | null {
  const m = pathname.match(/^\/modules\/([\w-]+)/)
  if (!m) return null
  const id = m[1]
  if (
    ['overview', 'todos', 'requirements', 'sprints', 'bugs', 'nav-config', 'tag-dict', 'apps', 'ui-settings', 'movies'].includes(
      id,
    )
  ) {
    return id as BuiltinModuleId
  }
  return null
}

// ============================================================
// 单个一级 Tab 节点
//  - 桌面：hover 弹 Mega Menu + 点击跳默认模块
//  - 移动：点击切换底部 sheet（阻止默认跳转）
// ============================================================
function PrimaryDockItem({
  primary,
  isActive,
  isOpen,
  onOpen,
  onScheduleClose,
  isMobile,
  onToggle,
}: {
  primary: import('../lib/nav-types').NavPrimary
  isActive: boolean
  isOpen: boolean
  onOpen: () => void
  onScheduleClose: () => void
  isMobile: boolean
  onToggle: () => void
}) {
  // 直接模式（directModule 绑定单一模块）：点击 dock 直达该模块，不弹菜单
  const isDirect = !!primary.directModule
  const targetModule = isDirect
    ? primary.directModule
    : primary.groups.flatMap((g) => g.modules)[0]
  const fallbackRoute = targetModule ? `/modules/${targetModule}` : '/modules/overview'

  const handleClick = (e: React.MouseEvent) => {
    if (isMobile) {
      // 直接模式：让 Link 自然跳转，不打开底部 sheet
      if (!isDirect) {
        e.preventDefault()
        onToggle()
      }
    }
  }

  return (
    <div
      className="relative"
      onMouseEnter={isMobile || isDirect ? undefined : onOpen}
      onMouseLeave={isMobile || isDirect ? undefined : onScheduleClose}
      data-mega-trigger
    >
      <Link
        to={fallbackRoute}
        onClick={handleClick}
        onFocus={isMobile || isDirect ? undefined : onOpen}
        title={primary.title}
        aria-haspopup="menu"
        aria-expanded={isOpen}
          className={`
            grid h-11 w-11 place-items-center rounded-2xl border transition
            ${
              isActive || isOpen
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-white/10 bg-white/5 text-ink-soft hover:bg-white/10 hover:text-ink-strong'
            }
          `}
      >
        {renderIcon(primary.iconKey)}
      </Link>
    </div>
  )
}

// ============================================================
// 主组件
// ============================================================
export default function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { profile } = useProfile()
  const { config, hydrated, findPrimaryByModule } = useNav()
  const location = useLocation()
  const navigate = useNavigate()
  const isMobile = useMediaQuery('(max-width: 767px)')

  const [openPrimaryId, setOpenPrimaryId] = useState<string | null>(null)
  // 系统设置（固定 dock 入口）的独立展开状态；与 openPrimaryId 互斥
  const [settingsOpen, setSettingsOpen] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 同步 isMobile 给 window 级事件回调（避免闭包读到旧值）
  const isMobileRef = useRef(isMobile)
  isMobileRef.current = isMobile

  // 当前路径所属的 module + primary（用于 dock 高亮）
  const activeModuleId = moduleIdFromPath(location.pathname)
  const activePrimary = activeModuleId ? findPrimaryByModule(activeModuleId) : null
  // 「系统设置」下挂的二级页（字典管理 / 导航配置）激活时，dock 齿轮也亮
  const isSettingsActive = activeModuleId === 'nav-config' || activeModuleId === 'tag-dict'

  // Esc / 点空白：关闭（移动端由 sheet 遮罩自行关闭，故跳过）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpenPrimaryId(null)
        setSettingsOpen(false)
      }
    }
    function onClick(e: MouseEvent) {
      if (isMobileRef.current) return
      const target = e.target as HTMLElement | null
      if (!target) return
      if (
        !target.closest('[data-mega-trigger]') &&
        !target.closest('[data-mega-panel]') &&
        !target.closest('[data-settings-trigger]') &&
        !target.closest('[data-settings-panel]')
      ) {
        setOpenPrimaryId(null)
        setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onClick)
    }
  }, [])

  // 路由变化时强制关闭 MegaMenu / Sheet / 系统设置面板
  useEffect(() => {
    setOpenPrimaryId(null)
    setSettingsOpen(false)
  }, [location.pathname])

  function openMenu(id: string) {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setOpenPrimaryId(id)
    setSettingsOpen(false) // 与「系统设置」互斥
  }
  function scheduleClose() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      setOpenPrimaryId(null)
      closeTimerRef.current = null
    }, 140)
  }
  function cancelClose() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }
  function togglePrimary(id: string) {
    setSettingsOpen(false) // 与「系统设置」互斥
    setOpenPrimaryId((cur) => (cur === id ? null : id))
  }

  const sortedPrimaries = [...config.primaries].sort((a, b) => a.order - b.order)
  const openPrimary = sortedPrimaries.find((p) => p.id === openPrimaryId) ?? null

  // dock 一级 Tab 列表：排除「系统设置」（它固定在 gear 齿轮浮层，不占一级 Tab 格，避免与齿轮重复）
  const dockPrimaries = useMemo(
    () => sortedPrimaries.filter((p) => p.id !== 'p_system_settings'),
    [sortedPrimaries],
  )

  // 「系统设置」浮层内容：直接读配置里的真源 p_system_settings（可经「导航配置」页自定义），
  // 仅当配置缺失（极旧账户）时回落到写死兜底。
  const settingsPrimary: NavPrimary = useMemo(() => {
    const sys = sortedPrimaries.find((p) => p.id === 'p_system_settings')
    return (
      sys ?? {
        id: 'p_system_settings',
        title: '系统设置',
        iconKey: 'gear',
        order: 9999,
        groups: [
          { id: 'g_sys_1', title: '导航配置', modules: ['nav-config'] },
          { id: 'g_sys_2', title: '字典管理', modules: ['tag-dict'] },
          { id: 'g_sys_3', title: 'UI 设置', modules: ['ui-settings'] },
        ],
      }
    )
  }, [sortedPrimaries])

  function toggleSettings() {
    setSettingsOpen((cur) => {
      const next = !cur
      if (next) setOpenPrimaryId(null) // 与一级 Tab 互斥
      return next
    })
  }

  // 手机 dock 图标自适应档位：总元素数（含 Logo/齿轮/头像）越多 → 图标越小
  // 一级模块少时撑大避免「图标分开太多」；多时收紧避免拥挤；PC 不变（hidden md:flex）
  const mobileTotalSlots = dockPrimaries.length + 3 // Logo + primaries(不含系统设置) + gear + avatar
  const iconSizeCls =
    mobileTotalSlots <= 3 ? 'h-12 w-12'
    : mobileTotalSlots <= 5 ? 'h-10 w-10'
    : mobileTotalSlots <= 7 ? 'h-9 w-9'
    : 'h-8 w-8'

  return (
    <div className="relative min-h-screen bg-canvas text-ink-strong">
      <AuroraBackground />
      <CursorFX />
      {/* ===== 桌面：左上悬浮 dock（主页 + 一级 Tab） ===== */}
      <aside
        className="
          fixed left-6 top-6 z-40 hidden w-[72px] flex-col items-center gap-2
          rounded-3xl glass-panel p-3 md:flex
        "
      >
        <Link
          to="/"
          title="主页"
          aria-label="主页"
          className="mb-1 grid h-11 w-11 place-items-center overflow-hidden rounded-full shadow-iconBtn transition hover:scale-105"
        >
          <img src={logoUrl} alt="YUN STUDIO" className="h-full w-full object-cover" />
        </Link>

        <nav className="flex flex-col items-center gap-2">
          {hydrated ? (
            dockPrimaries.map((p) => (
              <PrimaryDockItem
                key={p.id}
                primary={p}
                isActive={activePrimary?.id === p.id}
                isOpen={openPrimaryId === p.id}
                onOpen={() => openMenu(p.id)}
                onScheduleClose={scheduleClose}
                isMobile={isMobile}
                onToggle={() => togglePrimary(p.id)}
              />
            ))
          ) : (
            // 首帧未水合：显示加载占位，避免默认 Tab 闪现（同主页 hydrated 策略）
            <div className="h-11 w-11 animate-pulse rounded-2xl bg-white/5" />
          )}
        </nav>
      </aside>

      {/* ===== 桌面：左下悬浮 dock（系统设置 + 账号头像） ===== */}
      <aside
        className="
          fixed left-6 bottom-6 z-40 hidden w-[72px] flex-col items-center gap-3
          rounded-3xl glass-panel p-3 md:flex
        "
      >
        <div
          className="relative"
          data-settings-trigger
          onMouseEnter={() => {
            if (isMobileRef.current) return
            if (closeTimerRef.current) {
              clearTimeout(closeTimerRef.current)
              closeTimerRef.current = null
            }
            setSettingsOpen(true)
            setOpenPrimaryId(null)
          }}
          onMouseLeave={() => {
            if (isMobileRef.current) return
            // 齿轮 → 浮层之间的间隙：留 140ms 让浮层 onMouseEnter 抢先取消
            if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
            closeTimerRef.current = setTimeout(() => {
              setSettingsOpen(false)
              closeTimerRef.current = null
            }, 140)
          }}
        >
          <button
            type="button"
            onClick={toggleSettings}
            title="系统设置"
            aria-label="系统设置"
            aria-haspopup="menu"
            aria-expanded={settingsOpen}
            className={`
              grid h-11 w-11 place-items-center rounded-2xl border transition
              ${
                isSettingsActive || settingsOpen
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-white/10 bg-white/5 text-ink-soft hover:bg-white/10 hover:text-ink-strong'
              }
            `}
          >
            {renderIcon('gear')}
          </button>
        </div>
        <Link
          to="/account"
          title={`个人主页（${profile?.display_name || user?.email || ''}）`}
          aria-label="个人主页"
          className="
            block h-11 w-11 rounded-full border border-line
            shadow-iconBtn transition hover:scale-105
          "
        >
          <Avatar
            url={profile?.avatar_url}
            seed={user?.email}
            className="h-full w-full rounded-full"
            textClassName="text-sm"
          />
        </Link>
      </aside>

      {/* ===== 桌面：Mega Menu 横向浮层（hover 触发） ===== */}
      {!isMobile && openPrimary && (
        <div
          data-mega-panel
          className="fixed left-[120px] top-[88px] z-50"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <MegaMenu primary={openPrimary} />
        </div>
      )}

      {/* ===== 桌面：系统设置 浮层（齿轮右侧展开，hover 触发） =====
          间距与一级 Tab MegaMenu 镜像对齐：
          一级 Tab MegaMenu 用 left-[120px] top-[88px]（面板顶到一级 Tab 中心 +8px）
          本面板用 left-[120px] bottom-[88px]（面板底到齿轮中心 -8px）→ 镜像对称 */}
      {!isMobile && settingsOpen && (
        <div
          data-settings-panel
          className="fixed left-[120px] bottom-[88px] z-50"
          onMouseEnter={() => {
            if (closeTimerRef.current) {
              clearTimeout(closeTimerRef.current)
              closeTimerRef.current = null
            }
          }}
          onMouseLeave={() => {
            if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
            closeTimerRef.current = setTimeout(() => {
              setSettingsOpen(false)
              closeTimerRef.current = null
            }, 140)
          }}
        >
          <MegaMenu primary={settingsPrimary} />
        </div>
      )}

      {/* ===== 移动：Mega Menu 底部 sheet（点击触发） ===== */}
      {isMobile && openPrimary && (
        <MobileMegaSheet primary={openPrimary} onClose={() => setOpenPrimaryId(null)} />
      )}

      {/* ===== 移动：系统设置底部 sheet（齿轮点击触发） ===== */}
      {isMobile && settingsOpen && (
        <MobileMegaSheet primary={settingsPrimary} onClose={() => setSettingsOpen(false)} />
      )}

      {/* ===== 移动：底部 tab bar（悬浮岛：左/右/底 1rem 安全岛 + iOS 底安全区） =====
          自适应：所有 5+N 个元素均分宽度（flex-1），图标 wrapper 按总元素数分档
          （少 → 撑大、多 → 收紧）。PC 端 hidden md:flex 不受此逻辑影响。 */}
      {isMobile && (
        <nav
          className="
            fixed left-4 right-4 z-50 flex items-stretch
            glass-panel rounded-3xl px-1
          "
          style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        >
          <Link
            to="/"
            title="主页"
            aria-label="主页"
            className="
              flex h-14 flex-1 items-center justify-center
              overflow-hidden transition active:scale-95
            "
          >
            <img
              src={logoUrl}
              alt="YUN STUDIO"
              className={`${iconSizeCls} rounded-full object-cover`}
            />
          </Link>

          {hydrated ? (
            dockPrimaries.map((p) => {
              const active = activePrimary?.id === p.id || openPrimaryId === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    p.directModule
                      ? navigate(`/modules/${p.directModule}`)
                      : togglePrimary(p.id)
                  }
                  title={p.title}
                  aria-label={p.title}
                  aria-expanded={openPrimaryId === p.id}
                  className="flex h-14 flex-1 flex-col items-center justify-center"
                >
                  <span
                    className={`grid ${iconSizeCls} place-items-center rounded-2xl transition ${
                      active ? 'bg-accent/20 text-accent' : 'text-ink-soft'
                    }`}
                  >
                    {renderIcon(p.iconKey)}
                  </span>
                </button>
              )
            })
          ) : (
            // 首帧未水合：显示加载占位，避免默认 Tab 闪现（同主页 hydrated 策略）
            <div className="flex h-14 flex-1 items-center justify-center">
              <div className={`${iconSizeCls} animate-pulse rounded-2xl bg-white/5`} />
            </div>
          )}

          <div
            className="relative flex h-14 flex-1 flex-col items-center justify-center"
            data-settings-trigger
          >
            <button
              type="button"
              onClick={toggleSettings}
              title="系统设置"
              aria-label="系统设置"
              aria-expanded={settingsOpen}
              className={`
                flex h-14 flex-1 flex-col items-center justify-center transition active:scale-95
                ${isSettingsActive || settingsOpen ? 'text-accent' : 'text-ink-soft'}
              `}
            >
              <span
                className={`grid ${iconSizeCls} place-items-center rounded-2xl transition ${
                  isSettingsActive || settingsOpen ? 'bg-accent/20' : ''
                }`}
              >
                {renderIcon('gear')}
              </span>
            </button>
          </div>
          <Link
            to="/account"
            title={`个人主页（${profile?.display_name || user?.email || ''}）`}
            aria-label="个人主页"
            className="flex h-14 flex-1 flex-col items-center justify-center"
          >
            <span
              className={`${iconSizeCls} flex items-center justify-center overflow-hidden rounded-full border border-line`}
            >
              <Avatar
                url={profile?.avatar_url}
                seed={user?.email}
                className="h-full w-full"
                textClassName="text-xs"
              />
            </span>
          </Link>
        </nav>
      )}

      {/* 主内容区：桌面左留 dock，移动下留底部 tab */}
      <div
        className={
          isMobile
            ? 'relative z-10 min-h-screen px-4 pb-28 pt-4'
            : 'relative z-10 min-h-screen pl-[120px] pr-6 py-6'
        }
      >
        {children}
      </div>
    </div>
  )
}
