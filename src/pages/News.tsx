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
} from '../components/ui'
import { useNews } from '../context/NewsContext'
import { renderIcon } from '../lib/icon-library'
import type { NewsItem, NewsSourceLink } from '../types'

// 报表类型展示映射
function reportLabel(rt: string): string {
  if (rt === 'weekly-consumer-trends') return '每周消费趋势'
  if (rt === 'manual') return '手动录入'
  return rt
}
// 分类展示映射
function categoryLabel(c: string): string {
  const map: Record<string, string> = {
    'consumer-trends': '消费趋势',
    general: '通用',
    finance: '财经',
    tech: '科技',
  }
  return map[c] ?? c
}

const CATEGORY_OPTIONS = [
  { value: 'consumer-trends', label: '消费趋势' },
  { value: 'general', label: '通用' },
  { value: 'finance', label: '财经' },
  { value: 'tech', label: '科技' },
]
const REPORT_OPTIONS = [
  { value: 'manual', label: '手动录入' },
  { value: 'weekly-consumer-trends', label: '每周消费趋势' },
]

const EMPTY = {
  title: '',
  summary: '',
  content: '',
  category: 'consumer-trends',
  report_type: 'manual' as string,
  tags: '',
  sourceTitle: '',
  sourceUrl: '',
  period_start: '',
  period_end: '',
}

export default function News() {
  const { items, loading, error, addNews, removeNews, refresh } = useNews()
  const [query, setQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [modalOpen, setModalOpen] = useState(false)
  const [draft, setDraft] = useState(EMPTY)
  const [titleError, setTitleError] = useState('')
  const [toDelete, setToDelete] = useState<NewsItem | null>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((n) => {
      if (filterCategory !== 'all' && n.category !== filterCategory) return false
      if (q) {
        const hay = `${n.title} ${n.summary} ${n.tags.join(' ')}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, query, filterCategory])

  function openCreate() {
    setDraft(EMPTY)
    setTitleError('')
    setModalOpen(true)
  }
  function toggleExpand(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }
  async function submit() {
    const title = draft.title.trim()
    const summary = draft.summary.trim()
    if (!title) {
      setTitleError('标题必填')
      return
    }
    if (!summary) {
      setTitleError('摘要必填')
      return
    }
    const tags = draft.tags
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
    const source_links: NewsSourceLink[] = []
    if (draft.sourceUrl.trim() && draft.sourceTitle.trim()) {
      source_links.push({ title: draft.sourceTitle.trim(), url: draft.sourceUrl.trim() })
    } else if (draft.sourceUrl.trim()) {
      source_links.push({ title: draft.sourceUrl.trim(), url: draft.sourceUrl.trim() })
    }
    try {
      await addNews({
        title,
        summary,
        content: draft.content,
        category: draft.category,
        report_type: draft.report_type,
        tags,
        source_links,
        period_start: draft.period_start || null,
        period_end: draft.period_end || null,
      })
      setModalOpen(false)
    } catch (e) {
      setTitleError(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* 顶部 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.25em] text-ink-mute">
            News
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-ink-strong">新闻</h1>
          <p className="mt-1 text-sm text-ink-soft">
            报表与资讯看板 · 支持每周消费趋势自动推送
          </p>
        </div>
        <Button onClick={openCreate}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          新建新闻
        </Button>
      </div>

      {/* 错误态 */}
      {error ? (
        <Card className="!p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-danger">
            {renderIcon('bell')}
            数据读取失败
          </div>
          <p className="mt-2 text-sm text-ink-soft">{error}</p>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            请确认已在 Supabase 项目执行 <code className="rounded bg-brand-soft px-1">supabase/news.sql</code> 创建
            <code className="rounded bg-brand-soft px-1"> news</code> 表，并已部署
            <code className="rounded bg-brand-soft px-1"> ingest-news</code> Edge Function。
            完成后点击重试。
          </p>
          <Button className="mt-4" variant="soft" onClick={() => refresh()}>
            重试
          </Button>
        </Card>
      ) : loading ? (
        <p className="py-12 text-center text-sm text-ink-mute">加载中…</p>
      ) : (
        <>
          {/* 筛选栏（一排：搜索 / 分类 / [ml-auto] 共 N 条） */}
          <Card className="!p-3">
            <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索标题 / 摘要 / 标签"
                className="min-w-[140px] flex-1 basis-[180px] md:flex-1 md:basis-auto"
                aria-label="搜索新闻"
              />
              <Select
                value={filterCategory}
                onChange={(v) => setFilterCategory(v)}
                className="!w-auto min-w-[120px] max-w-[180px] flex-1 basis-[120px] md:flex-none md:basis-auto"
                aria-label="按分类筛选"
              >
                <option value="all">全部分类</option>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
              <div className="ml-auto flex shrink-0 items-center gap-3">
                <span className="hidden text-xs text-ink-mute sm:inline">
                  共 {visible.length} 条
                </span>
              </div>
            </div>
            <div className="mt-1 text-[11px] text-ink-mute sm:hidden">
              共 {visible.length} 条
            </div>
          </Card>

          {/* 空态 */}
          {visible.length === 0 ? (
            <Card>
              <p className="py-12 text-center text-sm text-ink-mute">
                还没有新闻 · 点右上角「新建新闻」，或等待每周消费趋势自动推送
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((n) => {
                const open = !!expanded[n.id]
                const period =
                  n.period_start && n.period_end
                    ? `${n.period_start} ~ ${n.period_end}`
                    : n.period_start || n.period_end || ''
                return (
                  <Card key={n.id} className="!p-5">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          n.report_type === 'weekly-consumer-trends'
                            ? 'bg-accent/10 text-accent'
                            : 'bg-brand-soft text-ink-soft'
                        }`}
                      >
                        {reportLabel(n.report_type)}
                      </span>
                      {period && <span className="text-xs text-ink-mute">{period}</span>}
                    </div>
                    <h3 className="text-base font-semibold text-ink-strong">{n.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-ink-soft">{n.summary}</p>

                    {n.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {n.tags.map((t) => (
                          <span
                            key={t}
                            className="rounded-md bg-brand-soft px-2 py-0.5 text-xs text-ink-soft"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}

                    {n.content && (
                      <div className="mt-3">
                        {open ? (
                          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-brand-soft/60 p-3 text-xs leading-relaxed text-ink-soft">
                            {n.content}
                          </pre>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleExpand(n.id)}
                            className="text-xs font-medium text-accent hover:text-accent/80"
                          >
                            展开全文 ↓
                          </button>
                        )}
                      </div>
                    )}

                    {n.source_links.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {n.source_links.map((l, i) => (
                          <a
                            key={i}
                            href={l.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-accent hover:bg-brand-soft"
                          >
                            {renderIcon('link')}
                            {l.title}
                          </a>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                      <span className="text-xs text-ink-mute">
                        {categoryLabel(n.category)}
                      </span>
                      <Button
                        variant="ghost"
                        onClick={() => setToDelete(n)}
                        className="!px-3 !py-1.5 text-danger hover:!bg-danger/10"
                      >
                        删除
                      </Button>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* 新建 Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="新建新闻"
        maxWidth="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button onClick={submit}>创建</Button>
          </>
        }
      >
        <Field label="标题" error={titleError === '标题必填' ? titleError : undefined}>
          <Input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="如：每周全球消费趋势数据更新报表"
            autoFocus
          />
        </Field>
        <Field label="摘要" error={titleError === '摘要必填' ? titleError : undefined}>
          <Input
            value={draft.summary}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            placeholder="一句话概述"
          />
        </Field>
        <Field label="正文（可选，支持长文）">
          <Textarea
            rows={5}
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            placeholder="详细内容 / 数据要点"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="分类">
            <Select
              value={draft.category}
              onChange={(v) => setDraft({ ...draft, category: v })}
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="报表类型">
            <Select
              value={draft.report_type}
              onChange={(v) => setDraft({ ...draft, report_type: v })}
            >
              {REPORT_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="标签（可选，逗号分隔）">
          <Input
            value={draft.tags}
            onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
            placeholder="消费, 趋势, 全球"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="来源标题（可选）">
            <Input
              value={draft.sourceTitle}
              onChange={(e) => setDraft({ ...draft, sourceTitle: e.target.value })}
              placeholder="数据源名称"
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="周期起（可选）">
            <Input
              type="date"
              value={draft.period_start}
              onChange={(e) => setDraft({ ...draft, period_start: e.target.value })}
            />
          </Field>
          <Field label="周期止（可选）">
            <Input
              type="date"
              value={draft.period_end}
              onChange={(e) => setDraft({ ...draft, period_end: e.target.value })}
            />
          </Field>
        </div>
        {titleError && titleError !== '标题必填' && titleError !== '摘要必填' && (
          <p className="mt-2 text-xs text-danger">{titleError}</p>
        )}
      </Modal>

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (toDelete) await removeNews(toDelete.id)
        }}
        title="删除新闻"
        message={`确定删除「${toDelete?.title ?? ''}」？此操作不可恢复。`}
        confirmText="删除"
        cancelText="取消"
        danger
      />
    </div>
  )
}
