import { useMemo, useState } from 'react'
import {
  Card,
  Button,
  Input,
  Field,
  Select,
  Textarea,
  Modal,
  ConfirmDialog,
  IconButton,
} from '../components/ui'
import PriorityTag from '../components/PriorityTag'
import { TagPicker, TagChip } from '../components/TagPicker'
import { useTags } from '../context/TagsContext'
import { useTodos } from '../context/TodosContext'
import { computeScore, hoursToDeadline, riskLevel } from '../lib/score'
import { isoToLocalInput, localInputToIso } from '../lib/datetime'
import type { Priority, Todo } from '../types'

type FilterStatus = 'all' | 'active' | 'done'
type SortKey = 'score' | 'deadline' | 'created'
type ViewKey = 'list' | 'quadrant'
const ALL_TAGS = '__ALL_TAGS__'


const EMPTY = {
  title: '',
  source_url: '',
  priority: 'P2' as Priority,
  deadline_at: '',
  note: '',
  tag_id: null as string | null,
}

// 四象限视图：P0~P3 直接映射到艾森豪威尔四象限（与需求模块一致）
const QUADRANTS: {
  priority: Priority
  title: string
  axis: string
  badge: string
}[] = [
  { priority: 'P0', title: '重要且紧急', axis: '重要 · 紧急', badge: 'bg-danger/10 text-danger' },
  { priority: 'P1', title: '重要不紧急', axis: '重要 · 不紧急', badge: 'bg-warning/10 text-warning' },
  { priority: 'P2', title: '不重要但紧急', axis: '不重要 · 紧急', badge: 'bg-violet-400/10 text-violet-300' },
  { priority: 'P3', title: '不重要不紧急', axis: '不重要 · 不紧急', badge: 'bg-brand-soft text-ink-soft' },
]

const editIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
)
const delIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
)

// 行内操作簇：编辑 / 删除（待办无"链接跳转"之外的独立链接动作，保留编辑+删除）
function TodoActions({
  onEdit,
  onDelete,
}: {
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-1">
      <IconButton onClick={onEdit} title="编辑" className="!h-8 !w-8">
        {editIcon}
      </IconButton>
      <IconButton
        onClick={onDelete}
        title="删除"
        className="!h-8 !w-8 hover:!border-danger/40 hover:!bg-danger/10 hover:!text-danger"
      >
        {delIcon}
      </IconButton>
    </div>
  )
}

export default function Todos() {
  const { todos, loading, error, refresh, addTodo, updateTodo, toggleDone, removeTodo } = useTodos()
  const { categoryByName, valuesByCategoryId } = useTags()
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [filterPriority, setFilterPriority] = useState<Priority | 'all'>('all')
  const [filterTag, setFilterTag] = useState<string>(ALL_TAGS)
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ViewKey>('quadrant')
  const [helpOpen, setHelpOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Todo | null>(null)
  const [draft, setDraft] = useState(EMPTY)
  const [titleError, setTitleError] = useState('')
  const [toDelete, setToDelete] = useState<Todo | null>(null)

  const tagCat = categoryByName('标签')
  const tagOptions = tagCat ? valuesByCategoryId(tagCat.id) : []

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = todos.filter((t) => {
      if (filterStatus === 'active' && t.done) return false
      if (filterStatus === 'done' && !t.done) return false
      if (filterPriority !== 'all' && t.priority !== filterPriority) return false
      if (filterTag !== ALL_TAGS && t.tag_id !== filterTag) return false
      if (q && !t.title.toLowerCase().includes(q)) return false
      return true
    })
    list = [...list].sort((a, b) => {
      if (sortKey === 'score') return computeScore(b) - computeScore(a)
      if (sortKey === 'deadline') {
        const ha = hoursToDeadline(a.deadline_at)
        const hb = hoursToDeadline(b.deadline_at)
        if (ha == null) return 1
        if (hb == null) return -1
        return ha - hb
      }
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    })
    return list
  }, [todos, filterStatus, filterPriority, filterTag, sortKey, query])

  // 四象限：按优先级分组（象限内按 Score 降序）
  const byPriority = useMemo(() => {
    const q = query.trim().toLowerCase()
    const map: Record<Priority, Todo[]> = { P0: [], P1: [], P2: [], P3: [] }
    todos.forEach((t) => {
      if (filterStatus === 'active' && t.done) return
      if (filterStatus === 'done' && !t.done) return
      if (filterPriority !== 'all' && t.priority !== filterPriority) return
      if (filterTag !== ALL_TAGS && t.tag_id !== filterTag) return
      if (q && !t.title.toLowerCase().includes(q)) return
      map[t.priority].push(t)
    })
    ;(Object.keys(map) as Priority[]).forEach((p) => {
      map[p] = map[p].sort((a, b) => computeScore(b) - computeScore(a))
    })
    return map
  }, [todos, filterStatus, filterPriority, filterTag, query])

  function openCreate() {
    setEditing(null)
    setDraft(EMPTY)
    setTitleError('')
    setModalOpen(true)
  }
  function openEdit(t: Todo) {
    setEditing(t)
    setDraft({
      title: t.title,
      source_url: t.source_url ?? '',
      priority: t.priority,
      deadline_at: isoToLocalInput(t.deadline_at),
      note: t.note ?? '',
      tag_id: t.tag_id ?? null,
    })
    setTitleError('')
    setModalOpen(true)
  }
  function submit() {
    const title = draft.title.trim()
    if (!title) {
      setTitleError('标题必填')
      return
    }
    if (title.length > 50) {
      setTitleError('标题不超过 50 字')
      return
    }
    const payload = {
      title,
      source_url: draft.source_url || null,
      priority: draft.priority,
      deadline_at: localInputToIso(draft.deadline_at),
      note: draft.note || null,
      tag_id: draft.tag_id,
    }
    if (editing) updateTodo(editing.id, payload)
    else addTodo(payload)
    setModalOpen(false)
  }

  const stats = [
    { label: '进行中', value: todos.filter((t) => !t.done).length, accent: 'text-ink-strong' },
    { label: '逾期', value: todos.filter((t) => !t.done && riskLevel(t) === 'overdue').length, accent: 'text-danger' },
    { label: '今日到期', value: todos.filter((t) => { const h = hoursToDeadline(t.deadline_at); return !t.done && h != null && h >= 0 && h <= 24 }).length, accent: 'text-warning' },
    { label: '已完成', value: todos.filter((t) => t.done).length, accent: 'text-success' },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* 错误/加载态 */}
      {error ? (
        <Card className="!p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-danger">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            数据读取失败
          </div>
          <p className="mt-2 text-sm text-ink-soft">{error}</p>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            请确认已在 Supabase 项目执行 <code className="rounded bg-brand-soft px-1">supabase/business-tables.sql</code> 创建
            <code className="rounded bg-brand-soft px-1"> todos</code> 表，完成后点击重试。
          </p>
          <Button className="mt-4" variant="soft" onClick={() => refresh()}>
            重试
          </Button>
        </Card>
      ) : loading ? (
        <p className="py-12 text-center text-sm text-ink-mute">加载中…</p>
      ) : null}

      {/* 顶部 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.25em] text-ink-mute">
            Todos
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-ink-strong">待办</h1>
          <p className="mt-1 hidden text-sm text-ink-soft md:block">
            用 Score 排序：优先级越高 / 越接近截止，越靠前
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Score 说明问号 */}
          <div
            className="relative"
            onMouseEnter={() => setHelpOpen(true)}
            onMouseLeave={() => setHelpOpen(false)}
          >
            <button
              type="button"
              aria-label="Score 评分说明"
              onClick={() => setHelpOpen((v) => !v)}
              onFocus={() => setHelpOpen(true)}
              onBlur={() => setHelpOpen(false)}
              className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-base font-semibold text-ink-soft transition hover:bg-brand-soft hover:text-ink-strong"
            >
              ?
            </button>
            {helpOpen && (
              <div className="fixed left-4 right-4 top-20 z-50 mt-2 rounded-card border border-line bg-surface p-4 text-xs shadow-card-hover md:absolute md:right-0 md:left-auto md:top-full md:w-80">
                <div className="mb-2 text-sm font-semibold text-ink-strong">
                  Score 评分说明
                </div>
                <div className="mb-2 rounded-lg bg-brand-soft p-2 font-mono text-[11px] leading-relaxed text-ink-strong">
                  Score = (4 − 优先级等级) × 30
                  <br />
                  &nbsp;&nbsp;&nbsp;&nbsp;+ max(0, 72 − 距截止小时)
                </div>
                <div className="mb-2 leading-relaxed text-ink-soft">
                  优先级等级：P0=0，P1=1，P2=2，P3=3。越临近截止（≤72h）、优先级越高，分越高；完成后计 0。
                </div>
                <div className="space-y-1 text-ink-soft">
                  <div>
                    案例① P1 剩 48h：(4−1)×30 + (72−48) = 90 + 24 ={' '}
                    <span className="font-semibold text-ink-strong">114</span>
                  </div>
                  <div>
                    案例② P3 剩 100h（&gt;72，奖分0）：(4−3)×30 + 0 ={' '}
                    <span className="font-semibold text-ink-strong">30</span>
                  </div>
                  <div>
                    案例③ P0 已逾期（剩 −10h）：(4−0)×30 + (72+10) = 120 + 82 ={' '}
                    <span className="font-semibold text-ink-strong">202</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <Button onClick={openCreate}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            新建待办
          </Button>
        </div>
      </div>

      {/* 统计条 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="!p-5">
            <div className={`text-3xl font-semibold ${s.accent}`}>{s.value}</div>
            <div className="mt-1 text-xs text-ink-soft">{s.label}</div>
          </Card>
        ))}
      </div>

      {/* 筛选栏（一排：搜索 / 状态 / 优先级 / 排序 / [ml-auto] 共 N 条 / 视图切换） */}
      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
          <Select
            value={filterStatus}
            onChange={(v) => setFilterStatus(v as FilterStatus)}
            className="!w-auto min-w-[120px] max-w-[180px] flex-1 basis-[120px] md:flex-none md:basis-auto"
            aria-label="按状态筛选"
          >
            <option value="all">全部状态</option>
            <option value="active">进行中</option>
            <option value="done">已完成</option>
          </Select>
          <Select
            value={filterPriority}
            onChange={(v) => setFilterPriority(v as Priority | 'all')}
            className="!w-auto min-w-[120px] max-w-[180px] flex-1 basis-[120px] md:flex-none md:basis-auto"
            aria-label="按优先级筛选"
          >
            <option value="all">全部优先级</option>
            <option value="P0">P0</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
            <option value="P3">P3</option>
          </Select>
          <Select
            value={filterTag}
            onChange={(v) => setFilterTag(v as string)}
            className="!w-auto min-w-[120px] max-w-[180px] flex-1 basis-[120px] md:flex-none md:basis-auto"
            aria-label="按标签筛选"
          >
            <option value={ALL_TAGS}>全部标签</option>
            {tagOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.value}
              </option>
            ))}
          </Select>
          <Select
            value={sortKey}
            onChange={(v) => setSortKey(v as SortKey)}
            className="!w-auto min-w-[130px] max-w-[200px] flex-1 basis-[130px] md:flex-none md:basis-auto"
            aria-label="排序方式"
          >
            <option value="score">按 Score 排序</option>
            <option value="deadline">按截止时间</option>
            <option value="created">按创建时间</option>
          </Select>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题"
            className="min-w-[140px] flex-1 basis-[180px] md:flex-1 md:basis-auto"
            aria-label="搜索待办"
          />

          {/* 最右侧：共 N 条 + 视图切换 */}
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <span className="hidden text-xs text-ink-mute sm:inline">
              共 {visible.length} 条
            </span>
            {/* 视图切换（最右） */}
            <div className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
              <button
                type="button"
                onClick={() => setView('list')}
                title="列表视图"
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  view === 'list'
                    ? 'bg-brand-soft text-ink-strong'
                    : 'text-ink-mute hover:text-ink-soft'
                }`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5">
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
                <span>列表</span>
              </button>
              <button
                type="button"
                onClick={() => setView('quadrant')}
                title="四象限视图"
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  view === 'quadrant'
                    ? 'bg-brand-soft text-ink-strong'
                    : 'text-ink-mute hover:text-ink-soft'
                }`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                <span>四象限</span>
              </button>
            </div>
          </div>
        </div>
        {/* 移动端 fallback：把"共 N 条"换行展示 */}
        <div className="mt-1 text-[11px] text-ink-mute sm:hidden">
          共 {visible.length} 条
        </div>
      </Card>

      {/* 内容区 */}
      {view === 'list' ? (
        <Card>
          {visible.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink-mute">没有符合条件的待办</p>
          ) : (
            <ul className="divide-y divide-line">
              {visible.map((t) => {
                const risk = riskLevel(t)
                const h = hoursToDeadline(t.deadline_at)
                return (
                  <li
                    key={t.id}
                    className={`flex flex-col gap-1.5 p-1 md:px-2 md:py-3 md:flex-row md:items-center md:gap-3 ${t.done ? 'opacity-60' : ''}`}
                  >
                    {/* 紧凑头：checkbox + PriorityTag + TagChip 合并为一个 chip 行，避免「勾选框 / P0 / 标签」被 gap 拆成三段独立块 */}
                    <div className="flex items-center gap-1.5 self-start md:self-auto">
                      <input
                        type="checkbox"
                        checked={t.done}
                        onChange={() => toggleDone(t.id)}
                        className="h-4 w-4 shrink-0 accent-ink-strong"
                      />
                      <PriorityTag priority={t.priority} />
                      <TagChip tagId={t.tag_id} />
                    </div>
                    {/* 标题段：占满剩余宽度，标题与 note 自由换行 */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`break-words text-sm leading-snug ${
                            t.done ? 'text-ink-mute line-through' : 'text-ink-strong'
                          }`}
                        >
                          {t.title}
                        </span>
                        {t.source_url && (
                          <a
                            href={t.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-accent hover:text-accent/80"
                            title="打开来源链接"
                          >
                            ↗
                          </a>
                        )}
                      </div>
                      {t.note && (
                        <div className="break-words text-xs leading-relaxed text-ink-mute">{t.note}</div>
                      )}
                    </div>
                    {/* 末行：风险 + Score + actions，移动端 justify-between，桌面端右对齐 */}
                    <div className="flex items-center justify-between gap-3 self-end md:self-auto md:justify-end">
                      <span
                        className={`text-xs ${
                          risk === 'overdue'
                            ? 'font-medium text-danger'
                            : risk === 'urgent'
                              ? 'font-medium text-warning'
                              : 'text-ink-mute'
                        }`}
                      >
                        {risk === 'overdue'
                          ? '逾期'
                          : risk === 'urgent'
                            ? '紧急'
                            : h == null
                              ? '无截止'
                              : `剩 ${Math.round(h)}h`}
                      </span>
                      <span className="w-10 text-right text-sm font-semibold text-ink-strong">
                        {computeScore(t)}
                      </span>
                      <TodoActions onEdit={() => openEdit(t)} onDelete={() => setToDelete(t)} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {QUADRANTS.map((q) => {
            const items = byPriority[q.priority]
            return (
              <Card key={q.priority} className="!p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${q.badge}`}>
                      {q.priority}
                    </span>
                    <span className="text-sm font-semibold text-ink-strong">{q.title}</span>
                  </div>
                  <span className="text-xs text-ink-mute">{q.axis}</span>
                </div>
                {items.length === 0 ? (
                  <p className="py-6 text-center text-xs text-ink-mute">暂无待办</p>
                ) : (
                  <ul className="space-y-2">
                    {items.map((t) => {
                      const risk = riskLevel(t)
                      return (
                        <li
                          key={t.id}
                          className={`rounded-xl border border-line bg-canvas/40 px-1.5 pb-1.5 pt-2 md:p-3 ${t.done ? 'opacity-60' : ''}`}
                        >
                          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <input
                                  type="checkbox"
                                  checked={t.done}
                                  onChange={() => toggleDone(t.id)}
                                  className="h-4 w-4 shrink-0 accent-ink-strong"
                                />
                                <PriorityTag priority={t.priority} />
                                <TagChip tagId={t.tag_id} />
                              </div>
                              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                <span
                                  className={`break-words text-sm font-medium leading-snug ${
                                    t.done ? 'text-ink-mute line-through' : 'text-ink-strong'
                                  }`}
                                >
                                  {t.title}
                                </span>
                                {t.source_url && (
                                  <a
                                    href={t.source_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-accent hover:text-accent/80"
                                    title="打开来源链接"
                                  >
                                    ↗
                                  </a>
                                )}
                              </div>
                              {t.note && (
                                <div className="mt-1 text-xs leading-relaxed text-ink-mute">
                                  <span className="text-ink-mute/80">备注：</span>
                                  <span className="break-words">{t.note}</span>
                                </div>
                              )}
                              <div className="break-words text-xs leading-relaxed text-ink-mute">
                                Score {computeScore(t)}
                                {risk === 'overdue'
                                  ? ' · 逾期'
                                  : risk === 'urgent'
                                    ? ' · 紧急'
                                    : ''}
                              </div>
                            </div>
                            <div className="flex items-center justify-end md:justify-end">
                              <TodoActions onEdit={() => openEdit(t)} onDelete={() => setToDelete(t)} />
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* 新建/编辑 Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? '编辑待办' : '新建待办'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button onClick={submit}>{editing ? '保存' : '创建'}</Button>
          </>
        }
      >
        <Field label="标题" error={titleError} hint={`${draft.title.length}/50`}>
          <Input
            value={draft.title}
            maxLength={50}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="要做的事"
            autoFocus
          />
        </Field>
        <Field label="来源链接（可选）">
          <Input
            value={draft.source_url}
            onChange={(e) => setDraft({ ...draft, source_url: e.target.value })}
            placeholder="https://..."
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="优先级">
            <Select
              value={draft.priority}
              onChange={(v) => setDraft({ ...draft, priority: v as Priority })}
            >
              <option value="P0">P0（最高）</option>
              <option value="P1">P1</option>
              <option value="P2">P2</option>
              <option value="P3">P3（最低）</option>
            </Select>
          </Field>
          <Field label="截止时间（可选）">
            <Input
              type="datetime-local"
              value={draft.deadline_at}
              onChange={(e) => setDraft({ ...draft, deadline_at: e.target.value })}
            />
          </Field>
        </div>
        <Field label="标签（可选）" hint="单选；点击同一项可取消">
          <TagPicker value={draft.tag_id} onChange={(v) => setDraft({ ...draft, tag_id: v })} />
        </Field>
        <Field label="备注（可选）">
          <Textarea
            rows={3}
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            placeholder="补充说明"
          />
        </Field>
      </Modal>

      {/* 删除确认 Modal */}
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && removeTodo(toDelete.id)}
        title="删除待办"
        message={`确定删除「${toDelete?.title ?? ''}」？此操作不可恢复。`}
        confirmText="删除"
        cancelText="取消"
        danger
      />
    </div>
  )
}
