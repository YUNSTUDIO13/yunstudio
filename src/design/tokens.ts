// 设计令牌 —— 1:1 复刻桌面「高级简约UI」（深色玻璃拟态）
// 来源：C:\Users\hp\Desktop\高级简约UI\src\App.tsx 的 C / glass 常量

export const C = {
  accent: 'var(--c-accent, #7c85f5)',
  accentSoft: 'var(--c-accent-soft, rgba(124,133,245,0.15))',
  accentBorder: 'var(--c-accent-border, rgba(124,133,245,0.28))',
  accentGlow: 'var(--c-accent-glow, rgba(124,133,245,0.22))',
  // 语义色（success/warning/danger）—— 也 var 化，让 flat-light 段切换为"高同色非荧光色"加深版，
  // 避免白底上 #fbbf24 之类亮黄/亮绿视觉像荧光色。
  // liquid-glass 默认维持原版（亮色在深底上效果好）；flat-light 段在 index.css 重新定义。
  green: 'var(--c-green, #5eead4)',
  amber: 'var(--c-amber, #fbbf24)',
  red: 'var(--c-red, #f87171)',
  // 大数字（非荧光、柔和深字）：liquid-glass 用接近白，flat-light 用 slate-800 替代 #111827 的硬黑感。
  displayPrimary: 'var(--c-display-primary, rgba(255,255,255,0.92))',
  // 文字/边色全部 var 化，让 flat-dark / flat-light 皮肤可穿透覆盖
  textPrimary: 'var(--c-text-primary, rgba(255,255,255,0.88))',
  textSub: 'var(--c-text-sub, rgba(255,255,255,0.38))',
  textGhost: 'var(--c-text-ghost, rgba(255,255,255,0.14))',
  border: 'var(--c-border, rgba(255,255,255,0.07))',
  borderHigh: 'var(--c-border-high, rgba(255,255,255,0.12))',
}

export const glass = {
  card: {
    background: 'var(--glass-card-bg, rgba(255,255,255,0.038))',
    backdropFilter: 'var(--glass-card-blur, blur(32px) saturate(180%) brightness(1.04))',
    WebkitBackdropFilter: 'var(--glass-card-blur, blur(32px) saturate(180%) brightness(1.04))',
    border: 'var(--glass-card-border, 1px solid rgba(255,255,255,0.07))',
    boxShadow:
      'var(--glass-card-shadow, inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.15), 0 12px 48px rgba(0,0,0,0.4))',
  },
  dock: {
    // dock 是悬浮圆角胶囊，不参与去玻璃化（陛下原话："dock 保持悬浮圆角设计"）
    background: 'rgba(255,255,255,0.06)',
    backdropFilter: 'blur(48px) saturate(220%) brightness(1.08)',
    WebkitBackdropFilter: 'blur(48px) saturate(220%) brightness(1.08)',
    border: '1px solid rgba(255,255,255,0.11)',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.2), 0 32px 80px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(255,255,255,0.03)',
  },
  input: {
    background: 'var(--glass-input-bg, rgba(255,255,255,0.03))',
    backdropFilter: 'var(--glass-input-blur, blur(12px))',
    WebkitBackdropFilter: 'var(--glass-input-blur, blur(12px))',
    border: 'var(--glass-input-border, 1px solid rgba(255,255,255,0.06))',
    boxShadow: 'var(--glass-input-shadow, inset 0 1px 3px rgba(0,0,0,0.2))',
  },
  pill: {
    background: 'var(--glass-pill-bg, rgba(255,255,255,0.06))',
    backdropFilter: 'var(--glass-pill-blur, blur(16px))',
    WebkitBackdropFilter: 'var(--glass-pill-blur, blur(16px))',
    border: 'var(--glass-pill-border, 1px solid rgba(255,255,255,0.09))',
    boxShadow: 'var(--glass-pill-shadow, inset 0 1px 0 rgba(255,255,255,0.08))',
  },
}
