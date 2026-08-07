import { useMemo, useRef, useState } from 'react'
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
import StatusTag, { type Tone } from '../components/StatusTag'
import { useRequirements } from '../context/RequirementsContext'
import { renderIcon } from '../lib/icon-library'
import type { Priority, ReqStatus, Requirement } from '../types'

// 状态元数据：中文标签 + 配色档位（与 8 态状态机一一对应）
export const REQ_STATUS_META: Record<ReqStatus, { label: string; tone: Tone }> = {
  draft: { label: '草稿', tone: 'neutral' },
  review: { label: '待评审', tone: 'info' },
  scheduled: { label: '已排期', tone: 'violet' },
  dev: { label: '研发中', tone: 'warning' },
  test: { label: '测试中', tone: 'info' },
  launched: { label: '已上线', tone: 'success' },
  hold: { label: '已挂起', tone: 'neutral' },
  void: { label: '作废', tone: 'danger' },
}

const STATUS_ORDER: ReqStatus[] = [
  'draft', 'review', 'scheduled', 'dev', 'test', 'launched', 'hold', 'void',
]

const EMPTY = {
  title: '',
  priority: 'P2' as Priority,
  status: 'draft' as ReqStatus,
  valueDesc: '',
  owner: '',
  sourceUrl: '',
}

// 终态：已上线 / 作废
const TERMINAL: ReqStatus[] = ['launched', 'void']

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'P0', label: 'P0（最高）' },
  { value: 'P1', label: 'P1' },
  { value: 'P2', label: 'P2' },
  { value: 'P3', label: 'P3（最低）' },
]

// 四象限视图：P0~P3 直接映射到艾森豪威尔四象限
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

// 图标
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
function ReqActions({
  r,
  onEdit,
  onDelete,
}: {
  r: Requirement
  onEdit: (r: Requirement) => void
  onDelete: (r: Requirement) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {r.sourceUrl && (
        <a
          href={r.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="打开来源链接"
          className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-soft transition hover:bg-brand-soft hover:text-accent"
        >
          {renderIcon('link')}
        </a>
      )}
      <IconButton onClick={() => onEdit(r)} title="编辑" className="!h-8 !w-8">
        {editIcon}
      </IconButton>
      <IconButton
        onClick={() => onDelete(r)}
        title="删除"
        className="!h-8 !w-8 hover:!border-danger/40 hover:!bg-danger/10 hover:!text-danger"
      >
        {delIcon}
      </IconButton>
    </div>
  )
}

// ============== 紧凑的视图切换控件（列表 / 四象限） ==============
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

export default function Requirements() {
  const {
    requirements,
    addRequirement,
    updateRequirement,
    removeRequirement,
    moveRequirement,
    loading,
    error,
    refresh,
  } = useRequirements()
  const [filterStatus, setFilterStatus] = useState<ReqStatus | 'all'>('all')
  const [filterPriority, setFilterPriority] = useState<Priority | 'all'>('all')
  const [keyword, setKeyword] = useState('')
  const [view, setView] = useState<'list' | 'quadrant'>('list')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Requirement | null>(null)
  const [draft, setDraft] = useState(EMPTY)
  const [titleError, setTitleError] = useState('')
  const [toDelete, setToDelete] = useState<Requirement | null>(null)

  // 拖拽排序（仅列表视图启用）
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const dragAllowed = useRef(false)

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return requirements.filter((r) => {
      if (filterStatus !== 'all' && r.status !== filterStatus) return false
      if (filterPriority !== 'all' && r.priority !== filterPriority) return false
      if (
        kw &&
        !r.title.toLowerCase().includes(kw) &&
        !(r.owner ?? '').toLowerCase().includes(kw)
      )
        return false
      return true
    })
  }, [requirements, filterStatus, filterPriority, keyword])

  const openCreate = () => {
    setEditing(null)
    setDraft(EMPTY)
    setTitleError('')
    setModalOpen(true)
  }
  const openEdit = (r: Requirement) => {
    setEditing(r)
    setDraft({
      title: r.title,
      priority: r.priority,
      status: r.status,
      valueDesc: r.valueDesc,
      owner: r.owner ?? '',
      sourceUrl: r.sourceUrl ?? '',
    })
    setTitleError('')
    setModalOpen(true)
  }
  const submit = () => {
    const title = draft.title.trim()
    if (!title) return setTitleError('标题必填')
    if (title.length > 50) return setTitleError('标题不超过 50 字')
    const payload = {
      title,
      priority: draft.priority,
      status: draft.status,
      valueDesc: draft.valueDesc,
      owner: draft.owner || null,
      sourceUrl: draft.sourceUrl || null,
    }
    if (editing) updateRequirement(editing.id, payload)
    else addRequirement(payload)
    setModalOpen(false)
  }

  const stats = [
    { label: '需求总数', value: requirements.length, accent: 'text-ink-strong' },
    {
      label: '活跃',
      value: requirements.filter((r) => !TERMINAL.includes(r.status) && r.status !== 'hold').length,
      accent: 'text-warning',
    },
    {
      label: '已上线',
      value: requirements.filter((r) => r.status === 'launched').length,
      accent: 'text-success',
    },
    {
      label: '挂起/作废',
      value: requirements.filter((r) => r.status === 'hold' || r.status === 'void').length,
      accent: 'text-ink-mute',
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
            <code className="rounded bg-brand-soft px-1"> requirements</code> 表，完成后点击重试。
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
            Requirements
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-ink-strong">需求</h1>
          <p className="mt-1 text-sm text-ink-soft">
            需求池 · 8 态状态机 · 业务价值跟踪
          </p>
        </div>
        <Button onClick={openCreate}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          新建需求
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

      {/* 筛选栏 · 一排展示：状态 / 优先级 / 搜索 / [ml-auto] 共 N 条 / 视图切换 */}
      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
          <Select
            value={filterStatus}
            onChange={(v) => setFilterStatus(v as ReqStatus | 'all')}
            className="!w-auto min-w-[120px] max-w-[180px] flex-1 basis-[120px] md:flex-none md:basis-auto"
            aria-label="按状态筛选"
          >
            <option value="all">全部状态</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {REQ_STATUS_META[s].label}
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
            placeholder="搜索标题 / 负责人"
            className="min-w-[140px] flex-1 basis-[180px] md:flex-1 md:basis-auto"
            aria-label="搜索需求"
          />

          {/* 最右侧：共 N 条 + 视图切换 */}
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <span className="hidden text-xs text-ink-mute sm:inline">共 {visible.length} 条</span>
            <ViewSwitch value={view} onChange={setView} />
          </div>
        </div>
        {/* 移动端 fallback：把"共 N 条"换行展示 */}
        <div className="mt-1 text-[11px] text-ink-mute sm:hidden">共 {visible.length} 条</div>
      </Card>

      {/* 列表视图 */}
      {view === 'list' ? (
        <Card>
          {visible.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink-mute">没有符合条件的需求</p>
          ) : (
            <ul className="divide-y divide-line">
              {visible.map((r) => (
                <li
                  key={r.id}
                  draggable
                  onDragStart={(e) => {
                    if (!dragAllowed.current) {
                      e.preventDefault()
                      return
                    }
                    setDragId(r.id)
                    e.dataTransfer.effectAllowed = 'move'
                    try {
                      e.dataTransfer.setData('text/plain', r.id)
                    } catch {
                      /* 部分浏览器对 setData 有限制，忽略即可 */
                    }
                  }}
                  onDragEnter={() => dragId && setOverId(r.id)}
                  onDragOver={(e) => {
                    if (dragId) e.preventDefault()
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragId && overId && dragId !== overId)
                      moveRequirement(dragId, overId)
                    setDragId(null)
                    setOverId(null)
                  }}
                  onDragEnd={() => {
                    dragAllowed.current = false
                    setDragId(null)
                    setOverId(null)
                  }}
                  className={`group flex items-center gap-2 px-2 py-3 transition ${
                    dragId === r.id ? 'opacity-40' : ''
                  } ${
                    dragId && overId === r.id && dragId !== r.id
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
                  <StatusTag tone={REQ_STATUS_META[r.status].tone}>
                    {REQ_STATUS_META[r.status].label}
                  </StatusTag>
                  <PriorityTag priority={r.priority} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink-strong">
                        {r.title}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 truncate text-xs text-ink-mute">
                      <span className="shrink-0">{r.owner ?? '未指派'}</span>
                      <span className="text-line">·</span>
                      <span className="truncate">价值：{r.valueDesc}</span>
                    </div>
                  </div>
                  <ReqActions r={r} onEdit={openEdit} onDelete={setToDelete} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {QUADRANTS.map((q) => {
            const items = visible.filter((r) => r.priority === q.priority)
            return (
              <Card key={q.priority} className="!p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold ${q.badge}`}
                    >
                      {q.priority}
                    </span>
                    <span className="text-sm font-semibold text-ink-strong">
                      {q.title}
                    </span>
                  </div>
                  <span className="text-xs text-ink-mute">
                    {q.axis} · {items.length}
                  </span>
                </div>
                {items.length === 0 ? (
                  <p className="py-10 text-center text-xs text-ink-mute">
                    该象限暂无需求
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {items.map((r) => (
                      <li
                        key={r.id}
                        className="rounded-xl border border-line bg-canvas/40 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <StatusTag tone={REQ_STATUS_META[r.status].tone}>
                                {REQ_STATUS_META[r.status].label}
                              </StatusTag>
                              <span className="truncate text-sm font-medium text-ink-strong">
                                {r.title}
                              </span>
                            </div>
                            <div className="mt-1 truncate text-xs text-ink-mute">
                              {r.owner ?? '未指派'} · {r.valueDesc}
                            </div>
                          </div>
                          <ReqActions r={r} onEdit={openEdit} onDelete={setToDelete} />
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
        title={editing ? '编辑需求' : '新建需求'}
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
            placeholder="需求名称"
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
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
              onChange={(v) => setDraft({ ...draft, status: v as ReqStatus })}
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {REQ_STATUS_META[s].label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="负责人（可选）">
            <Input
              value={draft.owner}
              onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
              placeholder="如：朕 / 张工"
            />
          </Field>
          <Field label="来源链接（可选）">
            <Input
              value={draft.sourceUrl}
              onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })}
              placeholder="https://..."
            />
          </Field>
        </div>
        <Field label="业务价值说明">
          <Textarea
            rows={3}
            value={draft.valueDesc}
            onChange={(e) => setDraft({ ...draft, valueDesc: e.target.value })}
            placeholder="这个需求带来的业务价值 / 目标"
          />
        </Field>
      </Modal>

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && removeRequirement(toDelete.id)}
        title="删除需求"
        message={`确定删除「${toDelete?.title ?? ''}」？此操作不可恢复。`}
        confirmText="删除"
        danger
      />
    </div>
  )
}
