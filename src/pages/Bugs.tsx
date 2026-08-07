import { useMemo, useRef, useState } from 'react'
import {
  Card,
  Button,
  Input,
  Field,
  Select,
  Modal,
  ConfirmDialog,
  IconButton,
} from '../components/ui'
import PriorityTag from '../components/PriorityTag'
import StatusTag, { type Tone } from '../components/StatusTag'
import { useBugs } from '../context/BugsContext'
import { renderIcon } from '../lib/icon-library'
import type { Bug, BugSeverity, BugStatus, Priority } from '../types'

export const BUG_SEVERITY_META: Record<BugSeverity, { label: string; tone: Tone }> = {
  critical: { label: '致命', tone: 'danger' },
  major: { label: '严重', tone: 'warning' },
  normal: { label: '一般', tone: 'info' },
  minor: { label: '轻微', tone: 'neutral' },
}

export const BUG_STATUS_META: Record<BugStatus, { label: string; tone: Tone }> = {
  open: { label: '待处理', tone: 'neutral' },
  in_progress: { label: '处理中', tone: 'info' },
  verifying: { label: '待验证', tone: 'warning' },
  closed: { label: '已关闭', tone: 'success' },
}

const SEVERITY_ORDER: BugSeverity[] = ['critical', 'major', 'normal', 'minor']
const STATUS_ORDER: BugStatus[] = ['open', 'in_progress', 'verifying', 'closed']

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'P0', label: 'P0（最高）' },
  { value: 'P1', label: 'P1' },
  { value: 'P2', label: 'P2' },
  { value: 'P3', label: 'P3（最低）' },
]

// 四象限视图：P0~P3 映射（与需求模块完全一致）
const QUADRANTS: {
  priority: Priority
  title: string
  axis: string
  badge: string
}[] = [
  { priority: 'P0', title: '重要且紧急', axis: '重要 · 紧急', badge: 'bg-danger/10 text-danger' },
  { priority: 'P1', title: '重要不紧急', axis: '重要 · 不紧急', badge: 'bg-warning/10 text-warning' },
  { priority: 'P2', title: '不重要但紧急', axis: '不重要 · 紧急', badge: 'bg-violet-50 text-violet-700' },
  { priority: 'P3', title: '不重要不紧急', axis: '不重要 · 不紧急', badge: 'bg-brand-soft text-ink-soft' },
]

const EMPTY = {
  title: '',
  severity: 'normal' as BugSeverity,
  priority: 'P2' as Priority,
  status: 'open' as BugStatus,
  reporter: '',
  sourceUrl: '',
}

// ============== 图标 ==============
const gripIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
    <circle cx="9" cy="6" r="1.4" />
    <circle cx="15" cy="6" r="1.4" />
    <circle cx="9" cy="12" r="1.4" />
    <circle cx="15" cy="12" r="1.4" />
    <circle cx="9" cy="18" r="1.4" />
    <circle cx="15" cy="18" r="1.4" />
  </svg>
)
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

// 行内操作簇：链接跳转（左） / 编辑 / 删除
function BugActions({
  b,
  onEdit,
  onDelete,
}: {
  b: Bug
  onEdit: (b: Bug) => void
  onDelete: (b: Bug) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {b.sourceUrl && (
        <a
          href={b.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="打开缺陷单"
          className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-soft transition hover:bg-brand-soft hover:text-accent"
        >
          {renderIcon('link')}
        </a>
      )}
      <IconButton onClick={() => onEdit(b)} title="编辑" className="!h-8 !w-8">
        {editIcon}
      </IconButton>
      <IconButton
        onClick={() => onDelete(b)}
        title="删除"
        className="!h-8 !w-8 hover:!border-danger/40 hover:!bg-danger/10 hover:!text-danger"
      >
        {delIcon}
      </IconButton>
    </div>
  )
}

// 视图切换控件
function ViewSwitch({
  value,
  onChange,
}: {
  value: 'list' | 'quadrant'
  onChange: (v: 'list' | 'quadrant') => void
}) {
  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
      <button
        type="button"
        onClick={() => onChange('list')}
        title="列表视图"
        className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
          value === 'list'
            ? 'bg-brand-soft text-ink-strong'
            : 'text-ink-mute hover:text-ink-soft'
        }`}
      >
        {renderIcon('list')}
        <span>列表</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('quadrant')}
        title="四象限视图"
        className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
          value === 'quadrant'
            ? 'bg-brand-soft text-ink-strong'
            : 'text-ink-mute hover:text-ink-soft'
        }`}
      >
        {renderIcon('grid')}
        <span>四象限</span>
      </button>
    </div>
  )
}

export default function Bugs() {
  const { bugs, loading, error, refresh, addBug, updateBug, removeBug, moveBug } = useBugs()
  const [filterSeverity, setFilterSeverity] = useState<BugSeverity | 'all'>('all')
  const [filterStatus, setFilterStatus] = useState<BugStatus | 'all'>('all')
  const [filterPriority, setFilterPriority] = useState<Priority | 'all'>('all')
  const [keyword, setKeyword] = useState('')
  const [view, setView] = useState<'list' | 'quadrant'>('list')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Bug | null>(null)
  const [draft, setDraft] = useState(EMPTY)
  const [titleError, setTitleError] = useState('')
  const [toDelete, setToDelete] = useState<Bug | null>(null)

  // 拖拽排序（仅列表视图启用）
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const dragAllowed = useRef(false)

  const visible = useMemo(
    () =>
      bugs.filter((b) => {
        if (filterSeverity !== 'all' && b.severity !== filterSeverity) return false
        if (filterStatus !== 'all' && b.status !== filterStatus) return false
        if (filterPriority !== 'all' && b.priority !== filterPriority) return false
        const kw = keyword.trim().toLowerCase()
        if (
          kw &&
          !b.title.toLowerCase().includes(kw) &&
          !(b.reporter ?? '').toLowerCase().includes(kw)
        )
          return false
        return true
      }),
    [bugs, filterSeverity, filterStatus, filterPriority, keyword],
  )

  const openCreate = () => {
    setEditing(null)
    setDraft(EMPTY)
    setTitleError('')
    setModalOpen(true)
  }
  const openEdit = (b: Bug) => {
    setEditing(b)
    setDraft({
      title: b.title,
      severity: b.severity,
      priority: b.priority,
      status: b.status,
      reporter: b.reporter ?? '',
      sourceUrl: b.sourceUrl ?? '',
    })
    setTitleError('')
    setModalOpen(true)
  }
  const submit = () => {
    const title = draft.title.trim()
    if (!title) return setTitleError('缺陷标题必填')
    const payload = {
      title,
      severity: draft.severity,
      priority: draft.priority,
      status: draft.status,
      reporter: draft.reporter || null,
      sourceUrl: draft.sourceUrl || null,
    }
    if (editing) updateBug(editing.id, payload)
    else addBug(payload)
    setModalOpen(false)
  }

  const stats = [
    { label: '缺陷总数', value: bugs.length, accent: 'text-ink-strong' },
    { label: '待处理', value: bugs.filter((b) => b.status === 'open').length, accent: 'text-ink-soft' },
    {
      label: '致命/严重',
      value: bugs.filter((b) => b.severity === 'critical' || b.severity === 'major').length,
      accent: 'text-danger',
    },
    {
      label: '已关闭',
      value: bugs.filter((b) => b.status === 'closed').length,
      accent: 'text-success',
    },
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
            <code className="rounded bg-brand-soft px-1"> bugs</code> 表，完成后点击重试。
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
            Bugs
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-ink-strong">缺陷</h1>
          <p className="mt-1 text-sm text-ink-soft">Bug 跟踪 · 修复闭环 · 严重度分级</p>
        </div>
        <Button onClick={openCreate}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          新建缺陷
        </Button>
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

      {/* 筛选栏 · 一排展示：严重度 / 状态 / 优先级 / 搜索 / [ml-auto] 共 N 条 / 视图切换 */}
      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
          <Select
            value={filterSeverity}
            onChange={(v) => setFilterSeverity(v as BugSeverity | 'all')}
            className="!w-auto min-w-[120px] max-w-[180px] flex-1 basis-[120px] md:flex-none md:basis-auto"
            aria-label="按严重度筛选"
          >
            <option value="all">全部严重度</option>
            {SEVERITY_ORDER.map((s) => (
              <option key={s} value={s}>
                {BUG_SEVERITY_META[s].label}
              </option>
            ))}
          </Select>
          <Select
            value={filterStatus}
            onChange={(v) => setFilterStatus(v as BugStatus | 'all')}
            className="!w-auto min-w-[120px] max-w-[180px] flex-1 basis-[120px] md:flex-none md:basis-auto"
            aria-label="按状态筛选"
          >
            <option value="all">全部状态</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {BUG_STATUS_META[s].label}
              </option>
            ))}
          </Select>
          <Select
            value={filterPriority}
            onChange={(v) => setFilterPriority(v as Priority | 'all')}
            className="!w-auto min-w-[120px] max-w-[180px] flex-1 basis-[120px] md:flex-none md:basis-auto"
            aria-label="按优先级筛选"
          >
            <option value="all">全部优先级</option>
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索标题 / 报告人"
            className="min-w-[140px] flex-1 basis-[180px] md:flex-1 md:basis-auto"
            aria-label="搜索缺陷"
          />

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <span className="hidden text-xs text-ink-mute sm:inline">共 {visible.length} 条</span>
            <ViewSwitch value={view} onChange={setView} />
          </div>
        </div>
        <div className="mt-1 text-[11px] text-ink-mute sm:hidden">共 {visible.length} 条</div>
      </Card>

      {/* 列表视图 */}
      {view === 'list' ? (
        <Card>
          {visible.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink-mute">没有符合条件的缺陷</p>
          ) : (
            <ul className="divide-y divide-line">
              {visible.map((b) => (
                <li
                  key={b.id}
                  draggable
                  onDragStart={(e) => {
                    if (!dragAllowed.current) {
                      e.preventDefault()
                      return
                    }
                    setDragId(b.id)
                    e.dataTransfer.effectAllowed = 'move'
                    try {
                      e.dataTransfer.setData('text/plain', b.id)
                    } catch {
                      /* 忽略 */
                    }
                  }}
                  onDragEnter={() => dragId && setOverId(b.id)}
                  onDragOver={(e) => {
                    if (dragId) e.preventDefault()
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragId && overId && dragId !== overId) moveBug(dragId, overId)
                    setDragId(null)
                    setOverId(null)
                  }}
                  onDragEnd={() => {
                    dragAllowed.current = false
                    setDragId(null)
                    setOverId(null)
                  }}
                  className={`group flex items-center gap-2 px-2 py-3 transition ${
                    dragId === b.id ? 'opacity-40' : ''
                  } ${
                    dragId && overId === b.id && dragId !== b.id
                      ? 'rounded-xl bg-brand-soft ring-1 ring-accent/30'
                      : ''
                  }`}
                >
                  {/* 左侧拖拽手柄（hover 显示） */}
                  <button
                    type="button"
                    aria-label="拖拽调整顺序"
                    title="按住拖拽以调整顺序"
                    onMouseDown={() => {
                      dragAllowed.current = true
                    }}
                    onClick={(e) => e.preventDefault()}
                    className="hidden shrink-0 cursor-grab text-ink-mute transition hover:text-ink-soft active:cursor-grabbing group-hover:block"
                  >
                    {gripIcon}
                  </button>
                  <StatusTag tone={BUG_SEVERITY_META[b.severity].tone}>
                    {BUG_SEVERITY_META[b.severity].label}
                  </StatusTag>
                  <StatusTag tone={BUG_STATUS_META[b.status].tone}>
                    {BUG_STATUS_META[b.status].label}
                  </StatusTag>
                  <PriorityTag priority={b.priority} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink-strong">
                        {b.title}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-ink-mute">
                      {b.reporter ?? '未指派'}
                    </div>
                  </div>
                  <BugActions b={b} onEdit={openEdit} onDelete={setToDelete} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {QUADRANTS.map((q) => {
            const items = visible.filter((b) => b.priority === q.priority)
            return (
              <Card key={q.priority} className="!p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold ${q.badge}`}
                    >
                      {q.priority}
                    </span>
                    <span className="text-sm font-semibold text-ink-strong">{q.title}</span>
                  </div>
                  <span className="text-xs text-ink-mute">
                    {q.axis} · {items.length}
                  </span>
                </div>
                {items.length === 0 ? (
                  <p className="py-10 text-center text-xs text-ink-mute">该象限暂无缺陷</p>
                ) : (
                  <ul className="space-y-2">
                    {items.map((b) => (
                      <li key={b.id} className="rounded-xl border border-line bg-canvas/40 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <StatusTag tone={BUG_SEVERITY_META[b.severity].tone}>
                                {BUG_SEVERITY_META[b.severity].label}
                              </StatusTag>
                              <StatusTag tone={BUG_STATUS_META[b.status].tone}>
                                {BUG_STATUS_META[b.status].label}
                              </StatusTag>
                              <span className="truncate text-sm font-medium text-ink-strong">
                                {b.title}
                              </span>
                            </div>
                            <div className="mt-1 truncate text-xs text-ink-mute">
                              {b.reporter ?? '未指派'}
                            </div>
                          </div>
                          <BugActions b={b} onEdit={openEdit} onDelete={setToDelete} />
                        </div>
                      </li>
                    ))}
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
        title={editing ? '编辑缺陷' : '新建缺陷'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button onClick={submit}>{editing ? '保存' : '创建'}</Button>
          </>
        }
      >
        <Field label="缺陷标题" error={titleError}>
          <Input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="一句话描述问题"
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="严重度">
            <Select
              value={draft.severity}
              onChange={(v) => setDraft({ ...draft, severity: v as BugSeverity })}
            >
              {SEVERITY_ORDER.map((s) => (
                <option key={s} value={s}>
                  {BUG_SEVERITY_META[s].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="优先级">
            <Select
              value={draft.priority}
              onChange={(v) => setDraft({ ...draft, priority: v as Priority })}
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="状态">
            <Select
              value={draft.status}
              onChange={(v) => setDraft({ ...draft, status: v as BugStatus })}
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {BUG_STATUS_META[s].label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="报告人（可选）">
            <Input
              value={draft.reporter}
              onChange={(e) => setDraft({ ...draft, reporter: e.target.value })}
              placeholder="如：张工 / 用户反馈"
            />
          </Field>
          <Field label="缺陷单链接（可选）">
            <Input
              value={draft.sourceUrl}
              onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })}
              placeholder="https://..."
            />
          </Field>
        </div>
      </Modal>

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && removeBug(toDelete.id)}
        title="删除缺陷"
        message={`确定删除「${toDelete?.title ?? ''}」？此操作不可恢复。`}
        confirmText="删除"
        danger
      />
    </div>
  )
}
