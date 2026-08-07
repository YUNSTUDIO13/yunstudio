import type { Priority, Todo } from '../types'

// 优先级等级：P0=0, P1=1, P2=2, P3=3
export const PRIORITY_LEVEL: Record<Priority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
}

// 距截止的剩余小时数（负数 = 已逾期）；无截止返回 null
// 取一位小数：消除 Date(毫秒整数) / 36e5 产生的浮点尾巴（如 .000025555）
export function hoursToDeadline(
  deadline_at?: string | null,
  now: Date = new Date(),
): number | null {
  if (!deadline_at) return null
  const h = (new Date(deadline_at).getTime() - now.getTime()) / 36e5
  return Math.round(h * 10) / 10
}

// Score = (4 - PriorityLevel) × 30 + max(0, 72 - HoursToDeadline)
// 完成后计 0（移出活跃视图）。越临近截止、优先级越高，分越高。
// 公式语义为整数，返回 Math.round 后的整数值，避免浮点噪声显示成 189.000025555。
export function computeScore(
  todo: Pick<Todo, 'priority' | 'deadline_at' | 'done'>,
  now: Date = new Date(),
): number {
  if (todo.done) return 0
  const base = (4 - PRIORITY_LEVEL[todo.priority]) * 30
  const h = hoursToDeadline(todo.deadline_at, now)
  const bonus = h == null ? 0 : Math.max(0, 72 - h)
  return Math.round(base + bonus)
}

export type RiskLevel = 'overdue' | 'urgent' | 'normal'

export function riskLevel(
  todo: Pick<Todo, 'deadline_at' | 'done'>,
  now: Date = new Date(),
): RiskLevel {
  if (todo.done) return 'normal'
  const h = hoursToDeadline(todo.deadline_at, now)
  if (h == null) return 'normal'
  if (h < 0) return 'overdue'
  if (h <= 24) return 'urgent'
  return 'normal'
}
