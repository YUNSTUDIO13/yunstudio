import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
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
import AuroraBackground from '../design/AuroraBackground'

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
    ['overview', 'todos', 'requirements', 'sprints', 'bugs', 'nav-config', 'tag-dict'].includes(id)
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
  // 一级 Tab 下首个三级模块作为「点击直达」目标
  const firstModule = primary.groups.flatMap((g) => g.modules)[0]
  const fallbackRoute = firstModule ? `/modules/${firstModule}` : '/modules/overview'

  const handleClick = (e: React.MouseEvent) => {
    if (isMobile) {
      e.preventDefault()
      onToggle()
    }
  }

  return (
    <div
      className="relative"
      onMouseEnter={isMobile ? undefined : onOpen}
      onMouseLeave={isMobile ? undefined : onScheduleClose}
      data-mega-trigger
    >
      <Link
        to={fallbackRoute}
        onClick={handleClick}
        onFocus={isMobile ? undefined : onOpen}
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
  const { config, findPrimaryByModule } = useNav()
  const location = useLocation()
  const isMobile = useMediaQuery('(max-width: 767px)')

  const [openPrimaryId, setOpenPrimaryId] = useState<string | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 同步 isMobile 给 window 级事件回调（避免闭包读到旧值）
  const isMobileRef = useRef(isMobile)
  isMobileRef.current = isMobile

  // 当前路径所属的 module + primary（用于 dock 高亮）
  const activeModuleId = moduleIdFromPath(location.pathname)
  const activePrimary = activeModuleId ? findPrimaryByModule(activeModuleId) : null
  const isNavConfigActive = activeModuleId === 'nav-config'

  // Esc / 点空白：关闭（移动端由 sheet 遮罩自行关闭，故跳过）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenPrimaryId(null)
    }
    function onClick(e: MouseEvent) {
      if (isMobileRef.current) return
      const target = e.target as HTMLElement | null
      if (!target) return
      if (!target.closest('[data-mega-trigger]') && !target.closest('[data-mega-panel]')) {
        setOpenPrimaryId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onClick)
    }
  }, [])

  // 路由变化时强制关闭 MegaMenu / Sheet
  // 解决：切到其它页（如导航配置/个人主页/主页）后底部 sheet 仍浮着挡住内容
  useEffect(() => {
    setOpenPrimaryId(null)
  }, [location.pathname])

  function openMenu(id: string) {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setOpenPrimaryId(id)
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
    setOpenPrimaryId((cur) => (cur === id ? null : id))
  }

  const sortedPrimaries = [...config.primaries].sort((a, b) => a.order - b.order)
  const openPrimary = sortedPrimaries.find((p) => p.id === openPrimaryId) ?? null

  // 手机 dock 图标自适应档位：总元素数（含 Logo/齿轮/头像）越多 → 图标越小
  // 一级模块少时撑大避免「图标分开太多」；多时收紧避免拥挤；PC 不变（hidden md:flex）
  const mobileTotalSlots = sortedPrimaries.length + 3 // Logo + primaries + gear + avatar
  const iconSizeCls =
    mobileTotalSlots <= 3 ? 'h-12 w-12'
    : mobileTotalSlots <= 5 ? 'h-10 w-10'
    : mobileTotalSlots <= 7 ? 'h-9 w-9'
    : 'h-8 w-8'

  return (
    <div className="relative min-h-screen bg-canvas text-ink-strong">
      <AuroraBackground />
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
          {sortedPrimaries.map((p) => (
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
          ))}
        </nav>
      </aside>

      {/* ===== 桌面：左下悬浮 dock（系统设置 + 账号头像） ===== */}
      <aside
        className="
          fixed left-6 bottom-6 z-40 hidden w-[72px] flex-col items-center gap-3
          rounded-3xl glass-panel p-3 md:flex
        "
      >
        <Link
          to="/modules/nav-config"
          title="系统设置"
          className={`
            grid h-11 w-11 place-items-center rounded-2xl border transition
            ${
              isNavConfigActive
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-white/10 bg-white/5 text-ink-soft hover:bg-white/10 hover:text-ink-strong'
            }
          `}
        >
          {renderIcon('gear')}
        </Link>
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

      {/* ===== 移动：Mega Menu 底部 sheet（点击触发） ===== */}
      {isMobile && openPrimary && (
        <MobileMegaSheet primary={openPrimary} onClose={() => setOpenPrimaryId(null)} />
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

          {sortedPrimaries.map((p) => {
            const active = activePrimary?.id === p.id || openPrimaryId === p.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => togglePrimary(p.id)}
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
          })}

          <Link
            to="/modules/nav-config"
            title="系统设置"
            aria-label="系统设置"
            className="flex h-14 flex-1 flex-col items-center justify-center text-ink-soft"
          >
            <span className={`grid ${iconSizeCls} place-items-center`}>
              {renderIcon('gear')}
            </span>
          </Link>
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
