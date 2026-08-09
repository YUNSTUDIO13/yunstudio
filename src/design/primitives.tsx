// 设计稿组件库 —— 1:1 复刻桌面「高级简约UI」App.tsx 的内部组件
// 供 Overview / Requirements 等页面直接复用，确保像素级一致 + 真实数据绑定

import { useState, type CSSProperties, type ReactNode } from 'react'
import { C, glass } from './tokens'

// ── display number ─────────────────────────────────────────────────────────
// Serif italic for large metrics — creates editorial luxury tension
export function Display({
  children,
  size = 42,
  color = C.textPrimary,
}: {
  children: ReactNode
  size?: number
  color?: string
}) {
  return (
    <span
      style={{
        fontFamily: "'Instrument Serif', Georgia, serif",
        fontStyle: 'italic',
        fontWeight: 400,
        fontSize: size,
        lineHeight: 1,
        color,
        letterSpacing: '-0.02em',
      }}
    >
      {children}
    </span>
  )
}

// ── ring chart ─────────────────────────────────────────────────────────────
export function RingChart({ pct, goal, size = 136 }: { pct: number; goal: number; size?: number }) {
  const stroke = Math.max(3, Math.round(size * 0.05))
  const r = size / 2 - stroke - 2
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  const numSize = Math.max(14, Math.round(size * 0.22))
  const goalSize = Math.max(7, Math.round(size * 0.07))

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#c084fc" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* track */}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke} />
        {/* progress */}
        {dash > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="url(#rg)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
            filter="url(#glow)"
          />
        )}
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: goalSize, color: C.textGhost, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500, marginBottom: 2 }}>
          GOAL
        </span>
        <Display size={numSize} color={C.textPrimary}>
          {goal}
        </Display>
      </div>
    </div>
  )
}

// ── glass card wrapper ─────────────────────────────────────────────────────
export function Card({
  children,
  style,
  onMouseEnter,
  onMouseLeave,
}: {
  children: ReactNode
  style?: CSSProperties
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onMouseEnter={() => {
        setHovered(true)
        onMouseEnter?.()
      }}
      onMouseLeave={() => {
        setHovered(false)
        onMouseLeave?.()
      }}
      style={{
        ...glass.card,
        borderRadius: 20,
        padding: '26px 28px',
        position: 'relative',
        overflow: 'hidden',
        transition: 'box-shadow .25s ease, transform .25s ease',
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
        boxShadow: hovered
          ? `inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(0,0,0,0.15), 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(124,133,245,0.08)`
          : (glass.card.boxShadow as string),
        ...style,
      }}
    >
      {/* top-edge specular highlight */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '12%',
          right: '12%',
          height: 1,
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.18) 40%, rgba(255,255,255,0.18) 60%, transparent)',
          pointerEvents: 'none',
        }}
      />
      {children}
    </div>
  )
}

// ── card header ────────────────────────────────────────────────────────────
export function CardHeader({
  title,
  icon,
  action,
}: {
  title: string
  icon?: ReactNode
  action?: ReactNode
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: C.textSub, letterSpacing: '.04em', textTransform: 'uppercase' }}>{title}</span>
      {icon && !action && <span style={{ color: C.textGhost }}>{icon}</span>}
      {action}
    </div>
  )
}

// ── badge ──────────────────────────────────────────────────────────────────
export function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 500,
        color,
        background: bg,
        border: `1px solid ${color}35`,
        borderRadius: 5,
        padding: '2.5px 8px',
        letterSpacing: '.02em',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      {label}
    </span>
  )
}

// ── pulse dot ─────────────────────────────────────────────────────────────
export function PulseDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 6px ${color}`,
        animation: 'pulse-dot 2s ease-in-out infinite',
        flexShrink: 0,
      }}
    />
  )
}

// ── label ─────────────────────────────────────────────────────────────────
export function Label({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontSize: 11, color: C.textGhost, letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 500 }}>
      {children}
    </span>
  )
}

// ── divider ───────────────────────────────────────────────────────────────
export function Divider() {
  return <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.05)', margin: '6px 0' }} />
}

// ── filter pill ───────────────────────────────────────────────────────────
export function FilterPill({ label, active }: { label: string; active?: boolean }) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        background: active ? C.accentSoft : hov ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${active ? C.accentBorder : hov ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.06)'}`,
        borderRadius: 8,
        padding: '6px 12px',
        fontSize: 12,
        color: active ? C.accent : hov ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.32)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        transition: 'all .15s ease',
      }}
    >
      {label} <IconChevron />
    </button>
  )
}

// ── icons ──────────────────────────────────────────────────────────────────
export function IconGrid({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.6" fill="currentColor" />
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.6" fill="currentColor" />
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.6" fill="currentColor" />
      <rect x="9" y="9" width="5.5" height="5.5" rx="1.6" fill="currentColor" />
    </svg>
  )
}
export function IconList({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="3.5" width="13" height="1.4" rx=".7" fill="currentColor" />
      <rect x="1.5" y="7.3" width="13" height="1.4" rx=".7" fill="currentColor" />
      <rect x="1.5" y="11.1" width="13" height="1.4" rx=".7" fill="currentColor" />
    </svg>
  )
}
export function IconSettings({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2.3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.3 3.3l1.1 1.1M11.6 11.6l1.1 1.1M3.3 12.7l1.1-1.1M11.6 4.4l1.1-1.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
export function IconPlus() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
export function IconChevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
export function IconBell() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path d="M7 1a4 4 0 0 1 4 4v3l1 1.5H2L3 8V5a4 4 0 0 1 4-4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M5.5 11.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
export function IconFile() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path d="M3 1h5.5L11 3.5V13H3V1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8.5 1v3H11" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M5 6.5h4M5 9h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
export function IconClock() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 4v3.5l2 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
export function IconChart() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="8" width="3" height="5" rx=".5" fill="currentColor" opacity=".65" />
      <rect x="5.5" y="5" width="3" height="8" rx=".5" fill="currentColor" opacity=".65" />
      <rect x="10" y="2" width="3" height="11" rx=".5" fill="currentColor" opacity=".65" />
    </svg>
  )
}
export function IconLink() {
  return (
    <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
      <path d="M5 8L8 5M7 2.5l1.5-1.5a2.5 2.5 0 0 1 3.5 3.5L10.5 6M6 7l-1.5 1.5A2.5 2.5 0 0 1 1 5l1.5-1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
export function IconEdit() {
  return (
    <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
      <path d="M9 2l2 2-7 7H2V9l7-7z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}
export function IconTrash() {
  return (
    <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
      <path d="M2 3.5h9M5 3.5V2h3v1.5M10.5 3.5L10 11H3L2.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
