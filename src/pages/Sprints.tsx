import { useMemo, useState } from 'react'
import {
  Card,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  Modal,
  ConfirmDialog,
  IconButton,
} from '../components/ui'
import StatusTag, { type Tone } from '../components/StatusTag'
import { Burndown } from '../components/Charts'
import { useSprints } from '../context/SprintsContext'
import type { Sprint, SprintStatus } from '../types'

export const SPRINT_STATUS_META: Record<SprintStatus, { label: string; tone: Tone }> = {
  planning: { label: '规划中', tone: 'violet' },
  active: { label: '进行中', tone: 'warning' },
  closing: { label: '已收尾', tone: 'info' },
  done: { label: '已完成', tone: 'success' },
  cancelled: { label: '已取消', tone: 'danger' },
}

const STATUS_ORDER: SprintStatus[] = ['planning', 'active', 'closing', 'done', 'cancelled']

const EMPTY = {
  name: '',
  goal: '',
  status: 'planning' as SprintStatus,
  start_date: '',
  end_date: '',
  progress: 0,
}

function fmtDate(s?: string): string {
  if (!s) return '—'
  const [, m, d] = s.split('-')
  return `${m}/${d}`
}

export default function Sprints() {
  const { sprints, loading, error, refresh, addSprint, updateSprint, removeSprint } = useSprints()
  const [filterStatus, setFilterStatus] = useState<SprintStatus | 'all'>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Sprint | null>(null)
  const [draft, setDraft] = useState(EMPTY)
  const [nameError, setNameError] = useState('')
  const [toDelete, setToDelete] = useState<Sprint | null>(null)

  const visible = useMemo(
    () =>
      filterStatus === 'all'
        ? sprints
        : sprints.filter((s) => s.status === filterStatus),
    [sprints, filterStatus],
  )

  const openCreate = () => {
    setEditing(null)
    setDraft(EMPTY)
    setNameError('')
    setModalOpen(true)
  }
  const openEdit = (s: Sprint) => {
    setEditing(s)
    setDraft({
      name: s.name,
      goal: s.goal,
      status: s.status,
      start_date: s.start_date ?? '',
      end_date: s.end_date ?? '',
      progress: s.progress,
    })
    setNameError('')
    setModalOpen(true)
  }
  const submit = () => {
    const name = draft.name.trim()
    if (!name) return setNameError('迭代名称必填')
    if (!draft.start_date || !draft.end_date) return setNameError('请填写起止日期')
    const payload = {
      name,
      goal: draft.goal,
      status: draft.status,
      start_date: draft.start_date,
      end_date: draft.end_date,
      progress: draft.progress,
    }
    if (editing) updateSprint(editing.id, payload)
    else addSprint(payload)
    setModalOpen(false)
  }

  const activeCount = sprints.filter((s) => s.status === 'active').length
  const doneCount = sprints.filter((s) => s.status === 'done').length
  const avgProgress = sprints.length
    ? Math.round(
        sprints
          .filter((s) => s.status !== 'cancelled')
          .reduce((acc, s) => acc + s.progress, 0) /
          Math.max(1, sprints.filter((s) => s.status !== 'cancelled').length),
      )
    : 0

  const stats = [
    { label: '总迭代', value: sprints.length, accent: 'text-ink-strong' },
    { label: '进行中', value: activeCount, accent: 'text-warning' },
    { label: '已完成', value: doneCount, accent: 'text-success' },
    { label: '平均完成率', value: `${avgProgress}%`, accent: 'text-accent' },
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
            <code className="rounded bg-brand-soft px-1"> sprints</code> 表，完成后点击重试。
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
            Sprints
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-ink-strong">迭代</h1>
          <p className="mt-1 hidden text-sm text-ink-soft md:block">Sprint 周期 · 燃尽图 · 交付节奏</p>
        </div>
        <Button onClick={openCreate}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          新建迭代
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

      {/* 筛选栏（一排：状态 / [ml-auto] 共 N 个） */}
      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
          <Select
            value={filterStatus}
            onChange={(v) => setFilterStatus(v as SprintStatus | 'all')}
            className="!w-auto min-w-[140px] max-w-[220px] flex-1 basis-[140px] md:flex-none md:basis-auto"
            aria-label="按状态筛选"
          >
            <option value="all">全部状态</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {SPRINT_STATUS_META[s].label}
              </option>
            ))}
          </Select>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <span className="hidden text-xs text-ink-mute sm:inline">
              共 {visible.length} 个迭代
            </span>
          </div>
        </div>
        <div className="mt-1 text-[11px] text-ink-mute sm:hidden">
          共 {visible.length} 个迭代
        </div>
      </Card>

      {/* 卡片网格 */}
      {visible.length === 0 ? (
        <Card>
          <p className="py-12 text-center text-sm text-ink-mute">没有符合条件的迭代</p>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {visible.map((s) => (
            <Card key={s.id} className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-base font-semibold text-ink-strong">
                      {s.name}
                    </h3>
                    <StatusTag tone={SPRINT_STATUS_META[s.status].tone}>
                      {SPRINT_STATUS_META[s.status].label}
                    </StatusTag>
                  </div>
                  <p className="mt-1 truncate text-xs text-ink-soft">{s.goal}</p>
                </div>
                <div className="flex items-center gap-1">
                  <IconButton onClick={() => openEdit(s)} title="编辑" className="!h-8 !w-8">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                    </svg>
                  </IconButton>
                  <IconButton
                    onClick={() => setToDelete(s)}
                    title="删除"
                    className="!h-8 !w-8 hover:!border-danger/40 hover:!bg-danger/10 hover:!text-danger"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </IconButton>
                </div>
              </div>

              {/* 日期 + 进度 */}
              <div className="flex items-center justify-between text-xs text-ink-soft">
                <span>
                  {fmtDate(s.start_date ?? undefined)} → {fmtDate(s.end_date ?? undefined)}
                </span>
                <span className="font-medium text-ink-strong">{s.progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${s.progress}%` }}
                />
              </div>

              {/* 燃尽图 */}
              {s.status !== 'cancelled' && (
                <div>
                  <div className="mb-1 flex items-center gap-3 text-[11px] text-ink-mute">
                    <span className="flex items-center gap-1">
                      <span className="h-0.5 w-4 bg-accent" /> 实际剩余
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-0.5 w-4 border-t border-dashed border-ink-mute" /> 理想剩余
                    </span>
                  </div>
                  <Burndown actual={s.burndown} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* 新建/编辑 Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? '编辑迭代' : '新建迭代'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button onClick={submit}>{editing ? '保存' : '创建'}</Button>
          </>
        }
      >
        <Field label="迭代名称" error={nameError}>
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="如：Sprint 26"
            autoFocus
          />
        </Field>
        <Field label="迭代目标">
          <Textarea
            rows={2}
            value={draft.goal}
            onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
            placeholder="本迭代要交付的核心目标"
          />
        </Field>
        <Field label="状态">
          <Select
            value={draft.status}
            onChange={(v) => setDraft({ ...draft, status: v as SprintStatus })}
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {SPRINT_STATUS_META[s].label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="开始日期">
            <Input
              type="date"
              value={draft.start_date}
              onChange={(e) => setDraft({ ...draft, start_date: e.target.value })}
            />
          </Field>
          <Field label="结束日期">
            <Input
              type="date"
              value={draft.end_date}
              onChange={(e) => setDraft({ ...draft, end_date: e.target.value })}
            />
          </Field>
        </div>
        <Field label={`完成进度 ${draft.progress}%`}>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={draft.progress}
            onChange={(e) => setDraft({ ...draft, progress: Number(e.target.value) })}
            className="w-full accent-accent"
          />
        </Field>
      </Modal>

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && removeSprint(toDelete.id)}
        title="删除迭代"
        message={`确定删除「${toDelete?.name ?? ''}」？此操作不可恢复。`}
        confirmText="删除"
        danger
      />
    </div>
  )
}
