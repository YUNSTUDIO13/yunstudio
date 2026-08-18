// 通知中心：右上角铃铛 + 气泡下拉（玻璃拟态，深色风格）
// - 玻璃按钮（未读红点 + 数字）
// - 气泡下拉：标题 + "全部已读" + 列表（类型/标题/截止/通知时间）+ 空态提示
// - 点击外部 / Esc 关闭、滚动锁、聚焦第一个条目

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotifications } from '../context/NotificationsContext'
import { C, glass } from '../design/tokens'
import type { Notification } from '../types'

// ============================================================
// 工具：相对时间（X 分钟前）+ 截止日期格式化
// ============================================================
function fromNow(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const diff = Math.floor((Date.now() - t) / 1000)
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} 天前`
  const d = new Date(t)
  return `${d.getMonth() + 1}-${d.getDate()}`
}

/** 把截止时间显示为"今日 18:00 / 明日 09:00 / 8-12 14:00"这种紧凑形式 */
function fmtDeadline(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const isTomorrow = d.toDateString() === tomorrow.toDateString()
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (sameDay) return `今日 ${time}`
  if (isTomorrow) return `明日 ${time}`
  return `${d.getMonth() + 1}-${d.getDate()} ${time}`
}

function entityLabel(t: Notification['entity_type']): string {
  return t === 'todo' ? '待办' : '迭代'
}

// ============================================================
// 主组件
// ============================================================
export default function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead, clearAll } = useNotifications()
  const [open, setOpen] = useState(false)
  // 打开面板瞬间即全部已读（用户要求：点了通知按钮就代表看过了）。
  // 但为了让用户仍能一眼分辨"这次新来的是哪几条"，把打开那一刻的未读 id 快照下来，
  // 仅用于本次面板内的视觉高亮；关闭后清空。
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set())
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()

  function toggleOpen() {
    const next = !open
    setOpen(next)
    if (next) {
      // 点击通知按钮 = 已读，红点即刻消失，60s 扫描也不会再把它们建回来
      // 注意：副作用（setHighlightIds / markAllRead）放在事件处理函数体内，
      // 不嵌在 setOpen 的 state-updater 纯函数里（React 反模式，StrictMode 会双调用）
      setHighlightIds(new Set(notifications.filter((n) => !n.read_at).map((n) => n.id)))
      if (unreadCount > 0) void markAllRead()
    } else {
      setHighlightIds(new Set())
    }
  }

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        setHighlightIds(new Set())
      }
    }
    function onClick(e: MouseEvent) {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (wrapRef.current && !wrapRef.current.contains(t)) {
        setOpen(false)
        setHighlightIds(new Set())
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onClick)
    }
  }, [open])

  function handleItemClick(n: Notification) {
    void markRead(n.id)
    const route = n.entity_type === 'todo' ? '/modules/todos' : '/modules/sprints'
    setOpen(false)
    setHighlightIds(new Set())
    navigate(route)
  }

  return (
    // 内联定位：由调用方（Overview 标题行）决定摆放位置，这里只负责自身与气泡的相对定位
    <div ref={wrapRef} className="relative z-40 shrink-0" data-notif-trigger>
      {/* Bell 按钮 */}
      <button
        type="button"
        onClick={toggleOpen}
        title="通知"
        aria-label={unreadCount > 0 ? `通知（${unreadCount} 条未读）` : '通知'}
        aria-expanded={open}
        className={`
          relative grid h-11 w-11 place-items-center rounded-full border transition active:scale-95
          ${
            open
              ? 'border-accent bg-accent/20 text-accent'
              : 'border-white/10 bg-white/5 text-ink-soft hover:bg-white/10 hover:text-ink-strong'
          }
        `}
      >
        {/* Bell SVG */}
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-semibold leading-none"
            style={{
              background: C.red,
              color: '#fff',
              height: 18,
              border: '2px solid #040408',
              boxShadow: '0 0 12px rgba(248,113,113,0.55)',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* 气泡下拉 */}
      {open && (
        <div
          data-notif-panel
          role="menu"
          aria-label="通知列表"
          className={`
            z-50 overflow-hidden rounded-2xl
            // 手机端：脱离铃铛、视口居中
            fixed left-1/2 top-16 -translate-x-1/2
            w-[calc(100vw-32px)] max-w-[360px]
            // 桌面端：回到 absolute、贴铃铛右下
            md:absolute md:left-auto md:top-[60px] md:translate-x-0 md:right-0
            md:w-[340px] md:max-w-[calc(100vw-32px)]
          `}
          style={{
            ...glass.card,
            // 平板/桌面端 popover：白底深字的 flat-light 覆盖在 [data-skin='flat-light'] [data-notif-panel] 段做。
            // 这里保留 liquid-glass / flat-dark 的深色玻璃风格（用户明确要求"dock 类浮层保留"）。
            background: 'rgba(20,20,28,0.72)',
            backdropFilter: 'blur(40px) saturate(180%)',
            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            boxShadow:
              'inset 0 1px 0 rgba(255,255,255,0.10), 0 24px 64px rgba(0,0,0,0.6)',
          }}
        >
          {/* 标题栏 */}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: `1px solid ${C.border}` }}
          >
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>
                通知
              </span>
              {highlightIds.size > 0 && (
                <span
                  className="rounded-full px-1.5 text-[10px] font-semibold"
                  style={{
                    background: C.accentSoft,
                    color: C.accent,
                    border: `1px solid ${C.accentBorder}`,
                    lineHeight: '16px',
                  }}
                >
                  {highlightIds.size} 条新
                </span>
              )}
            </div>
            {notifications.length > 0 && (
              <span className="text-[11px]" style={{ color: C.textGhost }}>
                已全部标记为已读
              </span>
            )}
          </div>

          {/* 列表 / 空态 */}
          <div className="max-h-[60vh] overflow-y-auto">
            {notifications.length === 0 ? (
              <div
                className="px-6 py-10 text-center"
                style={{ color: C.textSub, fontSize: 13 }}
              >
                <div className="mb-2 text-2xl">✨</div>
                暂无通知
                <div className="mt-1 text-[11px]" style={{ color: C.textGhost }}>
                  到期的待办 / 迭代会在这里提醒
                </div>
              </div>
            ) : (
              notifications.map((n) => {
                // 打开面板时已整体置为已读，故高亮以"本次打开前的未读快照"为准
                const unread = highlightIds.has(n.id) || !n.read_at
                return (
                  <button
                    type="button"
                    key={n.id}
                    onClick={() => handleItemClick(n)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition active:scale-[0.98]"
                    style={{
                      borderBottom: `1px solid ${C.border}`,
                      background: unread ? C.accentSoft : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      ;(e.currentTarget as HTMLElement).style.background = unread
                        ? C.accentSoft
                        : 'var(--c-notif-hover, rgba(255,255,255,0.04))'
                    }}
                    onMouseLeave={(e) => {
                      ;(e.currentTarget as HTMLElement).style.background = unread
                        ? C.accentSoft
                        : 'transparent'
                    }}
                  >
                    {/* 未读红点 */}
                    <span
                      aria-hidden
                      className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{
                        background: unread ? C.red : 'transparent',
                        boxShadow: unread ? `0 0 8px ${C.red}` : 'none',
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="rounded-md px-1.5 text-[10px] font-medium"
                          style={{
                            color: C.amber,
                            background: 'rgba(251,191,36,0.10)',
                            border: '1px solid rgba(251,191,36,0.25)',
                          }}
                        >
                          {entityLabel(n.entity_type)} · 到期
                        </span>
                      </div>
                      <div
                        className="mt-1 truncate"
                        style={{
                          fontSize: 13,
                          color: C.textPrimary,
                          fontWeight: unread ? 600 : 500,
                          lineHeight: 1.4,
                        }}
                        title={n.entity_title}
                      >
                        {n.entity_title}
                      </div>
                      <div
                        className="mt-1 flex items-center gap-2 text-[11px]"
                        style={{ color: C.textSub }}
                      >
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                          截止 {fmtDeadline(n.deadline_at)}
                        </span>
                        <span style={{ color: C.textGhost }}>·</span>
                        <span>{fromNow(n.created_at)}通知</span>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {notifications.length > 0 && (
            <div
              className="flex items-center justify-between gap-2 px-4 py-2.5"
              style={{ borderTop: `1px solid ${C.border}` }}
            >
              <span className="text-[10px]" style={{ color: C.textGhost }}>
                同一事项的同一截止时间只提醒一次
              </span>
              <button
                type="button"
                onClick={() => void clearAll()}
                title="清空所有通知"
                className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition hover:bg-danger/10 hover:text-danger"
                style={{ color: C.textSub }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                </svg>
                一键清除
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
