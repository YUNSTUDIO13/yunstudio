import type { Priority } from '../types'

// 亮色背景下的优先级 tag（饱和度适中、可读）
const MAP: Record<Priority, { label: string; cls: string }> = {
  P0: {
    label: 'P0',
    cls: 'border-danger/30 bg-danger/10 text-danger',
  },
  P1: {
    label: 'P1',
    cls: 'border-warning/30 bg-warning/10 text-warning',
  },
  P2: {
    label: 'P2',
    cls: 'border-amber-500/30 bg-amber-500/10 text-amber-600',
  },
  P3: {
    label: 'P3',
    cls: 'border-line bg-brand-soft text-ink-soft',
  },
}

export default function PriorityTag({ priority }: { priority: Priority }) {
  const m = MAP[priority]
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${m.cls}`}
    >
      {m.label}
    </span>
  )
}
