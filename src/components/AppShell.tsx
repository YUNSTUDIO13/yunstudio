import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useNav } from '../context/NavContext'
import { renderIcon } from '../lib/icon-library'
import MegaMenu from './MegaMenu'
import type { BuiltinModuleId } from '../lib/builtin-modules'

// ============================================================
// 工具
// ============================================================

function avatarFromUser(email?: string | null): { letter: string; bg: string } {
  const local = (email ?? '').split('@')[0] || 'U'
  const letter = local.slice(0, 1).toUpperCase()
  let hash = 0
  for (let i = 0; i < local.length; i++) hash = (hash * 31 + local.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return { letter, bg: `hsl(${hue} 35% 60%)` }
}

/**
 * 把 /modules/:id 形式的 url 反推为 BuiltinModuleId
 * /account 这种固定路由返回 null（不动 dock 高亮）
 */
function moduleIdFromPath(pathname: string): BuiltinModuleId | null {
  const m = pathname.match(/^\/modules\/([\w-]+)/)
  if (!m) return null
  const id = m[1]
  if (
    ['overview', 'todos', 'requirements', 'sprints', 'bugs', 'kpis', 'nav-config'].includes(id)
  ) {
    return id as BuiltinModuleId
  }
  return null
}

// ============================================================
// 单个一级 Tab 节点（hover 弹 Mega Menu + 点击跳默认模块）
// ============================================================
function PrimaryDockItem({
  primary,
  isActive,
  isOpen,
  onOpen,
  onScheduleClose,
}: {
  primary: import('../lib/nav-types').NavPrimary
  isActive: boolean
  isOpen: boolean
  onOpen: () => void
  onScheduleClose: () => void
}) {
  // 一级 Tab 下首个三级模块作为「点击直达」目标
  const firstModule = primary.groups.flatMap((g) => g.modules)[0]
  const fallbackRoute = firstModule ? `/modules/${firstModule}` : '/modules/overview'

  return (
    <div
      className="relative"
      onMouseEnter={onOpen}
      onMouseLeave={onScheduleClose}
      data-mega-trigger
    >
      <Link
        to={fallbackRoute}
        onFocus={onOpen}
        title={primary.title}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`
          grid h-11 w-11 place-items-center rounded-2xl border transition
          ${
            isActive || isOpen
              ? 'border-ink-strong bg-ink-strong text-white'
              : 'border-line bg-surface text-ink-soft hover:bg-brand-soft hover:text-ink-strong'
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
  const { config, findPrimaryByModule } = useNav()
  const { letter, bg } = avatarFromUser(user?.email)
  const location = useLocation()

  const [openPrimaryId, setOpenPrimaryId] = useState<string | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 当前路径所属的 module + primary（用于 dock 高亮）
  const activeModuleId = moduleIdFromPath(location.pathname)
  const activePrimary = activeModuleId ? findPrimaryByModule(activeModuleId) : null
  const isNavConfigActive = activeModuleId === 'nav-config'

  // Esc / 点空白：关闭
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenPrimaryId(null)
    }
    function onClick(e: MouseEvent) {
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

  const sortedPrimaries = [...config.primaries].sort((a, b) => a.order - b.order)
  const openPrimary = sortedPrimaries.find((p) => p.id === openPrimaryId) ?? null

  return (
    <div className="min-h-screen bg-canvas text-ink-strong">
      {/* ===== 左上悬浮 dock（主页 + 一级 Tab） ===== */}
      <aside
        className="
          fixed left-6 top-6 z-40
          flex w-[72px] flex-col items-center gap-2
          rounded-3xl bg-surface p-3
          shadow-card-hover
        "
      >
        <Link
          to="/"
          title="主页"
          className="mb-1 grid h-11 w-11 place-items-center rounded-2xl bg-ink-strong text-white"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
            <path d="M12 3l8 14H4z" />
            <circle cx="12" cy="13" r="1.6" fill="#F4F1EA" />
          </svg>
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
            />
          ))}
        </nav>
      </aside>

      {/* ===== 左下悬浮 dock：导航设置（上方固定）+ 账号头像（下方） ===== */}
      <aside
        className="
          fixed left-6 bottom-6 z-40
          flex w-[72px] flex-col items-center gap-3
          rounded-3xl bg-surface p-3
          shadow-card-hover
        "
      >
        <Link
          to="/modules/nav-config"
          title="导航设置"
          className={`
            grid h-11 w-11 place-items-center rounded-2xl border transition
            ${
              isNavConfigActive
                ? 'border-ink-strong bg-ink-strong text-white'
                : 'border-line bg-surface text-ink-soft hover:bg-brand-soft hover:text-ink-strong'
            }
          `}
        >
          {renderIcon('gear')}
        </Link>
        <Link
          to="/account"
          title={`账号（${user?.email ?? ''}）`}
          aria-label="账号"
          className="
            grid h-11 w-11 place-items-center rounded-full border border-line
            text-sm font-semibold text-white shadow-iconBtn
            transition hover:scale-105
          "
          style={{ backgroundColor: bg }}
        >
          {letter}
        </Link>
      </aside>

      {/* ===== Mega Menu（横向弹出） ===== */}
      {openPrimary && (
        <div
          data-mega-panel
          className="fixed left-[120px] top-[88px] z-50"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="relative">
            {/* 左下小箭头（指向 dock 当前一级 Tab） */}
            <span
              className="absolute -left-2 top-7 inline-block h-4 w-4 rotate-45 rounded-tl border-l border-t border-line bg-surface"
              aria-hidden
            />
            <MegaMenu primary={openPrimary} />
          </div>
        </div>
      )}

      {/* 主内容区 */}
      <div className="min-h-screen pl-[120px] pr-6 py-6">{children}</div>
    </div>
  )
}
