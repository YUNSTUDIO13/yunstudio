// 设计令牌 —— 1:1 复刻桌面「高级简约UI」（深色玻璃拟态）
// 来源：C:\Users\hp\Desktop\高级简约UI\src\App.tsx 的 C / glass 常量

export const C = {
  accent: '#7c85f5',
  accentSoft: 'rgba(124,133,245,0.15)',
  accentBorder: 'rgba(124,133,245,0.28)',
  accentGlow: 'rgba(124,133,245,0.22)',
  green: '#5eead4',
  amber: '#fbbf24',
  red: '#f87171',
  textPrimary: 'rgba(255,255,255,0.88)',
  textSub: 'rgba(255,255,255,0.38)',
  textGhost: 'rgba(255,255,255,0.14)',
  border: 'rgba(255,255,255,0.07)',
  borderHigh: 'rgba(255,255,255,0.12)',
}

export const glass = {
  card: {
    background: 'rgba(255,255,255,0.038)',
    backdropFilter: 'blur(32px) saturate(180%) brightness(1.04)',
    WebkitBackdropFilter: 'blur(32px) saturate(180%) brightness(1.04)',
    border: '1px solid rgba(255,255,255,0.07)',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.15), 0 12px 48px rgba(0,0,0,0.4)',
  },
  dock: {
    background: 'rgba(255,255,255,0.06)',
    backdropFilter: 'blur(48px) saturate(220%) brightness(1.08)',
    WebkitBackdropFilter: 'blur(48px) saturate(220%) brightness(1.08)',
    border: '1px solid rgba(255,255,255,0.11)',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.2), 0 32px 80px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(255,255,255,0.03)',
  },
  input: {
    background: 'rgba(255,255,255,0.03)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(255,255,255,0.06)',
    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)',
  },
  pill: {
    background: 'rgba(255,255,255,0.06)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: '1px solid rgba(255,255,255,0.09)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
  },
}
