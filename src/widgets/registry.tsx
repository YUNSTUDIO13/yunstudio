import type { ComponentType } from 'react'
import { useMemo } from 'react'
import { useTodos } from '../context/TodosContext'
import { useRequirements } from '../context/RequirementsContext'
import { useSprints } from '../context/SprintsContext'
import { useBugs } from '../context/BugsContext'
import { useKpis } from '../context/KpisContext'
import { computeScore, hoursToDeadline, riskLevel } from '../lib/score'
import { renderIcon } from '../lib/icon-library'
import type { IconKey } from '../lib/icon-library'

// ============================================================
// 类型
// ============================================================
export type WidgetCategory = '待办' | '模块概览' | '规划' | '协作'

export interface WidgetMeta {
  id: string
  title: string
  desc: string
  category: WidgetCategory
  iconKey: IconKey
  /** 是否已开发：false 表示"建设中"占位卡（仍可被增删，体现"含未开发需求"） */
  developed: boolean
  /** 已开发卡片点击跳转的模块路由 */
  route?: string
  /** 12 栅格列宽 */
  span: number
}

export interface WidgetDef extends WidgetMeta {
  /** 已开发卡片的内部视觉（不含外壳/栅格列宽，由主页外壳包裹） */
  Render: ComponentType
}

// ============================================================
// 通用视觉常量（与现有 Overview 一致）
// ============================================================
const COLORS = {
  sand: '#E0D5BD',
  sandSoft: '#EAE0CB',
  darkCard: '#2A2622',
  darkCardSoft: '#3A3631',
  yellow: '#F5C842',
  coral: '#E55B47',
  orange: '#FF7043',
  ink: '#1F2024',
}
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WEEK_HEADS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function RingProgress({ pct, label, sub, today }: { pct: number; label: string; sub: string; today: string }) {
  const r = 52
  const c = 2 * Math.PI * r
  const filled = (Math.min(100, Math.max(0, pct)) / 100) * c
  return (
    <div className="relative grid h-36 w-36 place-items-center">
      <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke={COLORS.sandSoft} strokeWidth="8" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={COLORS.coral} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${filled} ${c}`} />
      </svg>
      <div className="text-center leading-tight">
        <div className="text-[10px] tracking-wide text-ink-soft">{label}</div>
        <div className="text-2xl font-bold text-ink-strong">{sub}</div>
      </div>
      <span className="absolute -top-1 right-1 text-xs font-semibold text-ink-mute">{today}</span>
    </div>
  )
}

function ProgressDots({ value, total = 12 }: { value: number; total?: number }) {
  return (
    <div className="flex items-center gap-[3px]">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className="h-3 w-[3px] rounded-sm" style={{ backgroundColor: i < value ? COLORS.coral : '#E8E4DA' }} />
      ))}
    </div>
  )
}

// ============================================================
// 已开发卡片：5 张待办派生卡（抽自原 Overview）
// ============================================================
function TodoFocusWidget() {
  const { todos } = useTodos()
  const total = todos.length
  const active = todos.filter((t) => !t.done).length
  const urgent = todos.filter((t) => !t.done && (t.priority === 'P0' || t.priority === 'P1')).length

  return (
    <div className="relative h-full overflow-hidden rounded-card p-6" style={{ backgroundColor: COLORS.sand }}>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: COLORS.ink }}>今日待办聚焦</h2>
          <p className="mt-1 text-sm" style={{ color: '#6B6E76' }}>Results for Today</p>
        </div>
      </div>
      <div className="relative mt-3 h-72">
        <div className="absolute grid place-items-center rounded-full shadow-card-hover" style={{ width: 240, height: 240, right: 60, top: 0, backgroundColor: COLORS.yellow, color: COLORS.ink }}>
          <div className="text-center leading-tight">
            <div className="text-5xl font-bold">{active}</div>
            <div className="mt-1 text-sm font-medium">进行中</div>
          </div>
        </div>
        <div className="absolute z-10 grid place-items-center rounded-full shadow-card-hover" style={{ width: 150, height: 150, left: 40, top: 30, backgroundColor: COLORS.ink, color: '#FFFFFF' }}>
          <div className="text-center leading-tight">
            <div className="text-3xl font-bold">{total}</div>
            <div className="mt-0.5 text-xs opacity-90">总数</div>
          </div>
        </div>
        <div className="absolute z-20 grid place-items-center rounded-full shadow-card-hover" style={{ width: 170, height: 170, left: 110, bottom: 0, backgroundColor: COLORS.coral, color: '#FFFFFF' }}>
          <div className="text-center leading-tight">
            <div className="text-3xl font-bold">{urgent}</div>
            <div className="mt-0.5 text-xs opacity-95">紧急</div>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-7 text-sm" style={{ color: COLORS.ink }}>
        <span className="flex items-center gap-2"><span className="h-1.5 w-7 rounded-full" style={{ backgroundColor: COLORS.ink }} />总数 <strong>{total}</strong></span>
        <span className="flex items-center gap-2"><span className="h-1.5 w-7 rounded-full" style={{ backgroundColor: COLORS.coral }} />紧急 <strong>{urgent}</strong></span>
        <span className="flex items-center gap-2"><span className="h-1.5 w-7 rounded-full" style={{ backgroundColor: COLORS.yellow }} />进行中 <strong>{active}</strong></span>
      </div>
    </div>
  )
}

function TodoCalendarWidget() {
  const { todos } = useTodos()
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const todayDate = now.getDate()
  const monthName = MONTH_NAMES[month]

  const calCells = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay()
    const firstDayMon = (firstDay + 6) % 7
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells: (
      | { day: number; isToday?: boolean; hasDeadline?: boolean; isDone?: boolean; risk?: string }
      | null
    )[] = []
    for (let i = 0; i < firstDayMon; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      const match = todos.find((t) => {
        if (!t.deadline_at) return false
        const td = new Date(t.deadline_at)
        return td.getFullYear() === year && td.getMonth() === month && td.getDate() === d
      })
      cells.push({ day: d, isToday: d === todayDate, hasDeadline: !!match, isDone: match?.done, risk: match ? riskLevel(match) : undefined })
    }
    while (cells.length < 42) cells.push(null)
    return cells
  }, [todos, year, month, todayDate])

  return (
    <div className="h-full rounded-card p-6 text-white" style={{ backgroundColor: COLORS.darkCard }}>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">本月节奏</h2>
          <p className="mt-1 text-[11px] text-white/70">Training Days</p>
        </div>
        <span className="rounded-full px-3 py-1 text-sm text-white" style={{ backgroundColor: COLORS.darkCardSoft }}>{monthName}</span>
      </div>
      <div className="mt-5 grid grid-cols-7 gap-y-2 text-center text-[11px] font-semibold text-white/60">
        {WEEK_HEADS.map((w, i) => <div key={i}>{w}</div>)}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-y-1.5 text-center text-xs">
        {calCells.map((c, i) => {
          if (!c) return <div key={i} />
          let bg = 'transparent'
          let color = 'rgba(255,255,255,0.85)'
          let fontWeight = 400
          let border = 'none'
          if (c.isToday && c.risk === 'overdue') { bg = COLORS.coral; color = '#fff'; fontWeight = 700 }
          else if (c.isToday && c.hasDeadline && c.isDone) { bg = COLORS.yellow; color = COLORS.ink; fontWeight = 700 }
          else if (c.isToday) { border = '1.5px solid rgba(255,255,255,0.95)'; color = '#fff'; fontWeight = 700 }
          else if (c.risk === 'overdue') { bg = COLORS.coral; color = '#fff'; fontWeight = 600 }
          else if (c.hasDeadline && c.isDone) { bg = COLORS.yellow; color = COLORS.ink; fontWeight = 600 }
          else if (c.hasDeadline) { bg = COLORS.darkCardSoft; color = '#fff'; fontWeight = 500 }
          return (
            <div key={i} className="grid place-items-center">
              <div className="grid h-7 w-7 place-items-center rounded-full text-xs" style={{ backgroundColor: bg, color, fontWeight, border }}>{c.day}</div>
            </div>
          )
        })}
      </div>
      <div className="mt-5 flex items-center gap-3.5 text-[11px] text-white/85">
        <span className="flex items-center gap-1.5"><span className="grid h-3.5 w-3.5 place-items-center rounded-full border border-white/80" />今日</span>
        <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: COLORS.coral }} />逾期</span>
        <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: COLORS.yellow }} />完成</span>
        <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: COLORS.darkCardSoft }} />排期</span>
      </div>
    </div>
  )
}

function TodoRingWidget() {
  const { todos } = useTodos()
  const total = todos.length
  const done = todos.filter((t) => t.done).length
  const completionPct = total > 0 ? Math.round((done / total) * 100) : 0
  const goalTarget = 8
  const todayCompleted = Math.min(goalTarget, done + Math.max(0, Math.floor((total - done) * 0.3)))
  const ringPct = goalTarget > 0 ? Math.round((todayCompleted / goalTarget) * 100) : 0

  return (
    <div className="h-full rounded-card bg-surface p-6 shadow-card">
      <h2 className="text-lg font-bold text-ink-strong">今日完成</h2>
      <p className="mt-1 text-xs text-ink-soft">Keep your pace on track</p>
      <div className="mt-3 flex items-end justify-between">
        <RingProgress pct={ringPct} label="GOAL" sub={String(goalTarget)} today={String(todayCompleted)} />
        <div className="text-right">
          <div className="text-2xl font-bold text-ink-strong">{completionPct}%</div>
          <div className="text-xs text-ink-soft">总完成度</div>
        </div>
      </div>
    </div>
  )
}

function TodoStreamWidget() {
  const { todos } = useTodos()
  const topHabits = useMemo(
    () => [...todos].filter((t) => !t.done).sort((a, b) => computeScore(b) - computeScore(a)).slice(0, 4),
    [todos],
  )

  return (
    <div className="h-full rounded-card bg-surface p-6 shadow-card">
      <h2 className="mb-4 text-lg font-bold text-ink-strong">项目流</h2>
      {topHabits.length === 0 ? (
        <div className="py-10 text-center text-sm text-ink-mute">暂无活跃项目</div>
      ) : (
        <ul className="space-y-3">
          {topHabits.map((t) => {
            const h = hoursToDeadline(t.deadline_at)
            const hLabel = h == null ? '无截止' : h < 0 ? `逾期 ${Math.abs(Math.round(h))}h` : `剩 ${Math.round(h)}h`
            const dots = Math.max(1, Math.min(12, Math.round(computeScore(t) / 12)))
            const completed = Math.max(1, Math.round(computeScore(t) / 30))
            return (
              <li key={t.id} className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold" style={{ backgroundColor: COLORS.sandSoft, color: COLORS.ink }}>{t.title.slice(0, 1).toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink-strong">{t.title}</div>
                  <div className="truncate text-xs text-ink-soft">{t.priority} · {hLabel}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-ink-soft">完成 {completed}/12</span>
                  <ProgressDots value={dots} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function TodoProgressWidget() {
  const { todos } = useTodos()
  const total = todos.length
  const done = todos.filter((t) => t.done).length
  const completionPct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="h-full rounded-card bg-surface p-6 shadow-card">
      <div className="mb-5 flex items-start justify-between">
        <h2 className="text-lg font-bold text-ink-strong">整体进度</h2>
        <div className="text-right leading-tight">
          <div className="text-2xl font-bold text-ink-strong">{completionPct}%</div>
          <div className="text-xs text-ink-soft">Completed</div>
        </div>
      </div>
      <div className="relative">
        <div className="absolute -top-2 z-10 grid h-7 -translate-x-1/2 place-items-center rounded-full px-3 text-xs font-semibold text-white shadow-iconBtn" style={{ left: `${Math.max(5, Math.min(95, completionPct))}%`, backgroundColor: COLORS.ink }}>{done}/{total}</div>
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-line">
          <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${completionPct}%`, backgroundColor: COLORS.ink }} />
          <div className="absolute inset-0 flex justify-between px-1">
            {Array.from({ length: 9 }).map((_, i) => <span key={i} className="h-full w-px bg-canvas/60" />)}
          </div>
        </div>
        <div className="mt-3 flex justify-between text-xs text-ink-soft"><span>0 个</span><span>{total} 个</span></div>
      </div>
    </div>
  )
}

// ============================================================
// 已开发卡片：4 张模块概览卡
// ============================================================
function Pill({ tone, children }: { tone: 'info' | 'success' | 'warning' | 'danger' | 'violet' | 'neutral'; children: React.ReactNode }) {
  const map: Record<string, string> = {
    info: 'bg-sky-50 text-sky-700',
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    danger: 'bg-rose-50 text-rose-700',
    violet: 'bg-violet-50 text-violet-700',
    neutral: 'bg-brand-soft text-ink-soft',
  }
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${map[tone]}`}>{children}</span>
}

function ReqSummaryWidget() {
  const { requirements } = useRequirements()
  const total = requirements.length
  const active = requirements.filter((r) => !['launched', 'hold', 'void'].includes(r.status)).length
  const draft = requirements.filter((r) => r.status === 'draft' || r.status === 'review').length

  return (
    <div className="h-full rounded-card bg-surface p-6 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-ink-strong">需求概览</h2>
        <span className="text-ink-mute">{renderIcon('doc')}</span>
      </div>
      <div className="mt-4 flex items-end gap-2">
        <div className="text-4xl font-bold text-ink-strong">{total}</div>
        <div className="pb-1 text-xs text-ink-soft">条需求</div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Pill tone="info">进行中 {active}</Pill>
        <Pill tone="warning">待评审 {draft}</Pill>
      </div>
    </div>
  )
}

function SprintSummaryWidget() {
  const { sprints } = useSprints()
  const active = sprints.find((s) => s.status === 'active') ?? sprints[0]
  const pct = active ? Math.round(active.progress) : 0

  return (
    <div className="h-full rounded-card bg-surface p-6 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-ink-strong">迭代概览</h2>
        <span className="text-ink-mute">{renderIcon('clock')}</span>
      </div>
      {active ? (
        <>
          <div className="mt-4 truncate text-sm font-semibold text-ink-strong">{active.name}</div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-xs text-ink-soft">
            <span>{active.status}</span>
            <span>{pct}%</span>
          </div>
        </>
      ) : (
        <div className="mt-8 text-center text-sm text-ink-mute">暂无迭代</div>
      )}
    </div>
  )
}

function BugSummaryWidget() {
  const { bugs } = useBugs()
  const open = bugs.filter((b) => b.status !== 'closed').length
  const critical = bugs.filter((b) => b.severity === 'critical' && b.status !== 'closed').length
  const fixed = bugs.filter((b) => b.status === 'closed').length

  return (
    <div className="h-full rounded-card bg-surface p-6 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-ink-strong">缺陷概览</h2>
        <span className="text-ink-mute">{renderIcon('bell')}</span>
      </div>
      <div className="mt-4 flex items-end gap-2">
        <div className="text-4xl font-bold text-ink-strong">{open}</div>
        <div className="pb-1 text-xs text-ink-soft">个未关闭</div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Pill tone="danger">致命 {critical}</Pill>
        <Pill tone="success">已关闭 {fixed}</Pill>
      </div>
    </div>
  )
}

function KpiSummaryWidget() {
  const { kpis } = useKpis()
  const top = [...kpis].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0]

  return (
    <div className="h-full rounded-card bg-surface p-6 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-ink-strong">指标概览</h2>
        <span className="text-ink-mute">{renderIcon('bar')}</span>
      </div>
      {top ? (
        <>
          <div className="mt-4 truncate text-sm font-semibold text-ink-strong">{top.name}</div>
          <div className="mt-1 flex items-end gap-1.5">
            <span className="text-3xl font-bold text-ink-strong">{top.value}</span>
            <span className="pb-1 text-xs text-ink-soft">{top.unit}</span>
          </div>
          <div className="mt-3 text-xs text-ink-soft">
            目标 {top.target}{top.unit} · {Math.round((top.value / top.target) * 100)}%
          </div>
        </>
      ) : (
        <div className="mt-8 text-center text-sm text-ink-mute">暂无指标</div>
      )}
    </div>
  )
}

// ============================================================
// 注册表（含"建设中"占位卡 —— 体现"含未开发需求"）
// ============================================================
export const WIDGETS: Record<string, WidgetDef> = {
  // —— 待办派生（5 张已开发） ——
  w_todo_focus: { id: 'w_todo_focus', title: '待办聚焦', desc: '总数 / 进行中 / 紧急 三球概览', category: '待办', iconKey: 'flame', developed: true, route: '/modules/todos', span: 8, Render: TodoFocusWidget },
  w_todo_calendar: { id: 'w_todo_calendar', title: '本月节奏', desc: '待办截止日期月历热力', category: '待办', iconKey: 'clock', developed: true, route: '/modules/todos', span: 4, Render: TodoCalendarWidget },
  w_todo_ring: { id: 'w_todo_ring', title: '今日完成', desc: '完成度目标圆环', category: '待办', iconKey: 'check', developed: true, route: '/modules/todos', span: 5, Render: TodoRingWidget },
  w_todo_stream: { id: 'w_todo_stream', title: '项目流', desc: 'Score 排序的活跃项目', category: '待办', iconKey: 'list', developed: true, route: '/modules/todos', span: 7, Render: TodoStreamWidget },
  w_todo_progress: { id: 'w_todo_progress', title: '整体进度', desc: '待办总完成进度条', category: '待办', iconKey: 'bar', developed: true, route: '/modules/todos', span: 5, Render: TodoProgressWidget },

  // —— 模块概览（4 张已开发） ——
  w_req_summary: { id: 'w_req_summary', title: '需求概览', desc: '需求总数 / 进行中 / 待评审', category: '模块概览', iconKey: 'doc', developed: true, route: '/modules/requirements', span: 3, Render: ReqSummaryWidget },
  w_sprint_summary: { id: 'w_sprint_summary', title: '迭代概览', desc: '当前迭代进度', category: '模块概览', iconKey: 'clock', developed: true, route: '/modules/sprints', span: 3, Render: SprintSummaryWidget },
  w_bug_summary: { id: 'w_bug_summary', title: '缺陷概览', desc: '未关闭 / 致命缺陷', category: '模块概览', iconKey: 'bell', developed: true, route: '/modules/bugs', span: 3, Render: BugSummaryWidget },
  w_kpi_summary: { id: 'w_kpi_summary', title: '指标概览', desc: 'Top 指标与达标率', category: '模块概览', iconKey: 'bar', developed: true, route: '/modules/kpis', span: 3, Render: KpiSummaryWidget },

  // —— 建设中占位（3 张，仍可被增删） ——
  w_goal: { id: 'w_goal', title: '目标 OKR', desc: '个人 / 团队目标跟踪', category: '规划', iconKey: 'target', developed: false, span: 4, Render: () => <></> },
  w_team: { id: 'w_team', title: '团队负载', desc: '成员任务负载分布', category: '协作', iconKey: 'users', developed: false, span: 4, Render: () => <></> },
  w_message: { id: 'w_message', title: '消息中心', desc: '待办 / @ 提醒聚合', category: '协作', iconKey: 'msg', developed: false, span: 4, Render: () => <></> },
}

export const WIDGET_LIST: WidgetDef[] = Object.values(WIDGETS)

/** 默认启用的卡片（顺序即展示顺序） */
export const DEFAULT_DASHBOARD: string[] = [
  'w_todo_focus', 'w_todo_calendar', 'w_todo_ring', 'w_todo_stream', 'w_todo_progress',
  'w_req_summary', 'w_sprint_summary', 'w_bug_summary', 'w_kpi_summary',
]

/** 栅格列宽 → 静态 class（避免 Tailwind JIT 因动态拼接丢类） */
// 移动端单列堆叠（col-span-12），桌面 ≥768px 恢复原始跨度（md:col-span-X）
export const SPAN_CLASS: Record<number, string> = {
  3: 'col-span-12 md:col-span-3',
  4: 'col-span-12 md:col-span-4',
  5: 'col-span-12 md:col-span-5',
  7: 'col-span-12 md:col-span-7',
  8: 'col-span-12 md:col-span-8',
  12: 'col-span-12',
}
