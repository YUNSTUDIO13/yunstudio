import type { ReactNode } from 'react'

// 状态药丸配色档位（复用设计 token + 少量 Tailwind 默认色）
export type Tone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'violet'

const TONE_CLS: Record<Tone, string> = {
  neutral: 'border-line bg-brand-soft text-ink-soft',
  info: 'border-accent/30 bg-accent/10 text-accent',
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-danger/30 bg-danger/10 text-danger',
  violet: 'border-violet-400/30 bg-violet-400/10 text-violet-300',
}

export default function StatusTag({
  tone = 'neutral',
  children,
}: {
  tone?: Tone
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${TONE_CLS[tone]}`}
    >
      {children}
    </span>
  )
}
