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
import { Sparkline } from '../components/Charts'
import { useKpis } from '../context/KpisContext'
import type { Kpi, KpiCategory } from '../types'

export const KPI_CATEGORY_META: Record<KpiCategory, { label: string; tone: Tone }> = {
  business: { label: '业务', tone: 'info' },
  efficiency: { label: '效率', tone: 'violet' },
  quality: { label: '质量', tone: 'success' },
  growth: { label: '增长', tone: 'warning' },
}

const CATEGORY_ORDER: KpiCategory[] = ['business', 'efficiency', 'quality', 'growth']

const EMPTY = {
  name: '',
  category: 'business' as KpiCategory,
  value: 0,
  unit: '',
  target: 0,
  trendText: '',
}

// 解析"逗号/空格分隔"的数值序列
function parseTrend(text: string): number[] {
  return text
    .split(/[\s,，]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n))
}

export default function Kpis() {
  const { kpis, loading, error, refresh, addKpi, updateKpi, removeKpi } = useKpis()
  const [filterCat, setFilterCat] = useState<KpiCategory | 'all'>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Kpi | null>(null)
  const [draft, setDraft] = useState(EMPTY)
  const [nameError, setNameError] = useState('')
  const [toDelete, setToDelete] = useState<Kpi | null>(null)

  const visible = useMemo(
    () => (filterCat === 'all' ? kpis : kpis.filter((k) => k.category === filterCat)),
    [kpis, filterCat],
  )

  const openCreate = () => {
    setEditing(null)
    setDraft(EMPTY)
    setNameError('')
    setModalOpen(true)
  }
  const openEdit = (k: Kpi) => {
    setEditing(k)
    setDraft({
      name: k.name,
      category: k.category,
      value: k.value,
      unit: k.unit,
      target: k.target,
      trendText: k.trend.join(', '),
    })
    setNameError('')
    setModalOpen(true)
  }
  const submit = () => {
    const name = draft.name.trim()
    if (!name) return setNameError('指标名称必填')
    if (draft.target <= 0) return setNameError('目标值需大于 0')
    const trend = parseTrend(draft.trendText)
    const payload = {
      name,
      category: draft.category,
      value: draft.value,
      unit: draft.unit,
      target: draft.target,
      trend: trend.length ? trend : [draft.value],
    }
    if (editing) updateKpi(editing.id, payload)
    else addKpi(payload)
    setModalOpen(false)
  }

  // 单卡派生：环比、达标、进度
  function derive(k: Kpi) {
    const first = k.trend[0] ?? k.value
    const last = k.trend[k.trend.length - 1] ?? k.value
    const delta = first ? ((last - first) / Math.abs(first)) * 100 : 0
    const up = last >= first
    const good = k.lower_is_better ? !up : up
    const met = k.lower_is_better ? k.value <= k.target : k.value >= k.target
    const pct = k.lower_is_better
      ? Math.min(100, k.target && k.value ? (k.target / k.value) * 100 : 0)
      : Math.min(100, k.target ? (k.value / k.target) * 100 : 0)
    return { delta, up, good, met, pct }
  }

  const metCount = kpis.filter((k) => (k.lower_is_better ? k.value <= k.target : k.value >= k.target)).length
  const improved = kpis.filter((k) => derive(k).good).length
  const declined = kpis.length - improved

  const stats = [
    { label: '指标总数', value: kpis.length, accent: 'text-ink-strong' },
    { label: '已达标', value: metCount, accent: 'text-success' },
    { label: '环比向好', value: improved, accent: 'text-accent' },
    { label: '环比承压', value: declined, accent: 'text-danger' },
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
            <code className="rounded bg-brand-soft px-1"> kpis</code> 表，完成后点击重试。
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
            KPIs
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-ink-strong">指标</h1>
          <p className="mt-1 hidden text-sm text-ink-soft md:block">KPI 指标卡 · 趋势洞察 · 达标跟踪</p>
        </div>
        <Button onClick={openCreate}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          新建指标
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

      {/* 筛选栏（一排：分类 / [ml-auto] 共 N 个） */}
      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
          <Select
            value={filterCat}
            onChange={(v) => setFilterCat(v as KpiCategory | 'all')}
            className="!w-auto min-w-[140px] max-w-[220px] flex-1 basis-[140px] md:flex-none md:basis-auto"
            aria-label="按分类筛选"
          >
            <option value="all">全部分类</option>
            {CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>
                {KPI_CATEGORY_META[c].label}
              </option>
            ))}
          </Select>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <span className="hidden text-xs text-ink-mute sm:inline">
              共 {visible.length} 个指标
            </span>
          </div>
        </div>
        <div className="mt-1 text-[11px] text-ink-mute sm:hidden">
          共 {visible.length} 个指标
        </div>
      </Card>

      {/* KPI 卡网格 */}
      {visible.length === 0 ? (
        <Card>
          <p className="py-12 text-center text-sm text-ink-mute">没有符合条件的指标</p>
        </Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((k) => {
            const d = derive(k)
            return (
              <Card key={k.id} className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <StatusTag tone={KPI_CATEGORY_META[k.category].tone}>
                      {KPI_CATEGORY_META[k.category].label}
                    </StatusTag>
                    <h3 className="mt-2 truncate text-sm font-semibold text-ink-strong">
                      {k.name}
                    </h3>
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton onClick={() => openEdit(k)} title="编辑" className="!h-7 !w-7">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                      </svg>
                    </IconButton>
                    <IconButton
                      onClick={() => setToDelete(k)}
                      title="删除"
                      className="!h-7 !w-7 hover:!border-danger/40 hover:!bg-danger/10 hover:!text-danger"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      </svg>
                    </IconButton>
                  </div>
                </div>

                {/* 数值 + 环比 */}
                <div className="flex items-end justify-between">
                  <div className="leading-none">
                    <span className="text-3xl font-bold text-ink-strong">{k.value}</span>
                    <span className="ml-1 text-sm text-ink-soft">{k.unit}</span>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${
                      d.good
                        ? 'border-success/30 bg-success/10 text-success'
                        : 'border-danger/30 bg-danger/10 text-danger'
                    }`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3 w-3">
                      {d.up ? (
                        <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                      ) : (
                        <path d="M12 5v14M5 12l7 7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                      )}
                    </svg>
                    {Math.abs(d.delta).toFixed(1)}%
                  </span>
                </div>

                {/* 趋势线 */}
                <div className="flex justify-center py-1">
                  <Sparkline data={k.trend} width={220} height={40} color={d.good ? '#2B9A6A' : '#D8424F'} />
                </div>

                {/* 达标进度 */}
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ink-soft">目标 {k.target}{k.unit}</span>
                    <span className={d.met ? 'font-medium text-success' : 'font-medium text-ink-soft'}>
                      {d.met ? '已达标' : '未达标'}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line">
                    <div
                      className={`h-full rounded-full ${d.met ? 'bg-success' : 'bg-warning'}`}
                      style={{ width: `${d.pct}%` }}
                    />
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* 新建/编辑 Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? '编辑指标' : '新建指标'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button onClick={submit}>{editing ? '保存' : '创建'}</Button>
          </>
        }
      >
        <Field label="指标名称" error={nameError}>
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="如：月活跃用户"
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="分类">
            <Select
              value={draft.category}
              onChange={(v) => setDraft({ ...draft, category: v as KpiCategory })}
            >
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>
                  {KPI_CATEGORY_META[c].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="单位">
            <Input
              value={draft.unit}
              onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
              placeholder="如：人 / % / h"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="当前值">
            <Input
              type="number"
              value={draft.value}
              onChange={(e) => setDraft({ ...draft, value: Number(e.target.value) })}
            />
          </Field>
          <Field label="目标值">
            <Input
              type="number"
              value={draft.target}
              onChange={(e) => setDraft({ ...draft, target: Number(e.target.value) })}
            />
          </Field>
        </div>
        <Field label="近期趋势（逗号分隔的数值）" hint="如：11000, 11500, 12000">
          <Textarea
            rows={2}
            value={draft.trendText}
            onChange={(e) => setDraft({ ...draft, trendText: e.target.value })}
            placeholder="用于生成迷你趋势线"
          />
        </Field>
      </Modal>

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && removeKpi(toDelete.id)}
        title="删除指标"
        message={`确定删除「${toDelete?.name ?? ''}」？此操作不可恢复。`}
        confirmText="删除"
        danger
      />
    </div>
  )
}
