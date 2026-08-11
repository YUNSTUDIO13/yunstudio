// 观影模块（Movies / 观影志）
// 布局与功能对齐桌面「工作台前端代码」的观影应用：
//   顶部工具栏（搜索 / 批量导入 / 新建）+ 精选 Hero + 海报墙 + 点击封面弹开详情
//   详情弹窗：展示 + 编辑（同新建逻辑）+ 同步数据（第三方）
//   双评分：个人优先，第三方次之，两者皆有则并排带「我 / 第三方」标识
//   封面：TMDB 返回公网 URL（自动获取，失败标记手动获取）/ 手动上传走 Supabase Storage
// UI 风格保持 yunstudio 现有深色玻璃拟态；数据走本地 Dexie 优先 + outbox 补传 Supabase
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Field, Input, Textarea, Button, ConfirmDialog, Card } from '../components/ui'
import { db } from '../lib/localDb'
import { seedFromServer, enqueueAndMaybeFlush } from '../lib/sync'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { fetchMovieByTitle, syncMovie, uploadMovieCover } from '../lib/tmdb'
import type { Movie } from '../types'

const SRC_PERSONAL = '我'
const SRC_THIRD = '第三方'

// ─── 评分徽章：个人优先，双评并排带标识 ─────────────────────────────────────
function ScoreBadge({ movie }: { movie: Movie }) {
  const hasP = movie.personal_rating !== null && movie.personal_rating !== undefined
  const hasT = movie.third_party_rating !== null && movie.third_party_rating !== undefined
  if (!hasP && !hasT) return null
  return (
    <span className="inline-flex items-center gap-2">
      {hasP && (
        <span className="text-sm font-semibold text-accent">
          {movie.personal_rating!.toFixed(1)}
          <span className="ml-1 text-[10px] font-normal text-ink-mute">{SRC_PERSONAL}</span>
        </span>
      )}
      {hasP && hasT && <span className="text-ink-mute">·</span>}
      {hasT && (
        <span className="text-sm font-semibold text-ink-soft">
          {movie.third_party_rating!.toFixed(1)}
          <span className="ml-1 text-[10px] font-normal text-ink-mute">{SRC_THIRD}</span>
        </span>
      )}
    </span>
  )
}

// ─── 星级（accent 填充） ───────────────────────────────────────────────────
function Stars({ value, max = 10, size = 12 }: { value: number; max?: number; size?: number }) {
  const filled = Math.round((value / max) * 5)
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 12 12"
          fill={i < filled ? 'currentColor' : 'none'}
          stroke={i < filled ? 'currentColor' : '#555'}
          strokeWidth="1.2"
          className={i < filled ? 'text-accent' : 'text-ink-mute'}
        >
          <polygon points="6,1 7.5,4.5 11,4.8 8.5,7.2 9.2,11 6,9 2.8,11 3.5,7.2 1,4.8 4.5,4.5" />
        </svg>
      ))}
    </span>
  )
}

// ─── 海报卡（poster） ───────────────────────────────────────────────────────
function PosterCard({ movie, onClick }: { movie: Movie; onClick: () => void }) {
  const [err, setErr] = useState(false)
  return (
    <div
      onClick={onClick}
      className="group relative aspect-[2/3] cursor-pointer overflow-hidden rounded-card glass-card transition hover:border-accent/30"
    >
      {movie.cover && !err ? (
        <img
          src={movie.cover}
          alt={movie.title}
          loading="lazy"
          onError={() => setErr(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center bg-gradient-to-br from-[#1a1a2e] to-[#2a2a3e] text-3xl font-semibold text-ink-mute">
          {movie.title.slice(0, 1)}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-3">
        <div className="truncate text-sm font-medium text-white">{movie.title}</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[11px] text-ink-mute">{movie.year || '—'}</span>
          <ScoreBadge movie={movie} />
        </div>
      </div>
    </div>
  )
}

// ─── 封面图（通用，带失败占位） ─────────────────────────────────────────────
function Cover({
  src,
  alt,
  className,
  rounded = 'rounded-card',
}: {
  src: string
  alt: string
  className?: string
  rounded?: string
}) {
  const [err, setErr] = useState(false)
  if (!src || err) {
    return (
      <div
        className={`grid place-items-center bg-gradient-to-br from-[#1a1a2e] to-[#2a2a3e] text-ink-mute ${rounded} ${className ?? ''}`}
      >
        <span className="text-4xl font-semibold opacity-60">{alt.slice(0, 1)}</span>
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setErr(true)}
      className={`object-cover ${rounded} ${className ?? ''}`}
    />
  )
}

// ─── 精选 Hero ─────────────────────────────────────────────────────────────
function Hero({ movie, onClick }: { movie: Movie; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="group relative h-[300px] cursor-pointer overflow-hidden rounded-card glass-card md:h-[420px]"
    >
      <Cover
        src={movie.cover}
        alt={movie.title}
        rounded="rounded-card"
        className="absolute inset-0 h-full w-full brightness-[0.6] saturate-110 transition group-hover:scale-[1.03]"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-6 md:p-10">
        <div className="flex flex-wrap gap-2">
          {(movie.genre ?? []).map((g) => (
            <span
              key={g}
              className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] text-white/80"
            >
              {g}
            </span>
          ))}
        </div>
        <h2 className="font-serif text-3xl font-semibold text-white md:text-5xl">{movie.title}</h2>
        <div className="flex flex-wrap items-center gap-3 text-sm text-white/70">
          <Stars value={movie.personal_rating ?? movie.third_party_rating ?? 0} size={14} />
          <ScoreBadge movie={movie} />
          <span>·</span>
          <span>{movie.year || '—'}</span>
          {movie.region && (
            <>
              <span>·</span>
              <span>{movie.region}</span>
            </>
          )}
          {movie.duration > 0 && (
            <>
              <span>·</span>
              <span>{movie.duration}分钟</span>
            </>
          )}
        </div>
        {movie.review && (
          <p className="max-w-xl line-clamp-2 text-sm text-white/60">{movie.review}</p>
        )}
        <div className="mt-2">
          <span className="inline-flex rounded-full bg-white/10 px-4 py-1.5 text-xs text-white backdrop-blur transition group-hover:bg-white/20">
            查看详情
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── 详情弹窗 ───────────────────────────────────────────────────────────────
function MovieModal({
  movie,
  onClose,
  onSave,
  onSync,
  onDelete,
}: {
  movie: Movie
  onClose: () => void
  onSave: (m: Movie) => void
  onSync: (m: Movie) => Promise<Movie>
  onDelete: (m: Movie) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Movie>(movie)
  const [syncing, setSyncing] = useState(false)

  const handleSync = async () => {
    setSyncing(true)
    try {
      const updated = await onSync(draft)
      setDraft(updated)
    } finally {
      setSyncing(false)
    }
  }
  const handleSave = () => {
    onSave(draft)
    setEditing(false)
  }

  return (
    <Modal open title={editing ? '编辑观影记录' : movie.title} maxWidth="max-w-3xl" onClose={onClose}>
      <div className="-m-6">
        {/* 头部大图 */}
        <div className="relative h-56 w-full overflow-hidden rounded-t-card bg-black/40 md:h-64">
          <Cover
            src={draft.cover}
            alt={draft.title}
            rounded="rounded-none"
            className="h-full w-full"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0c0c14] via-[#0c0c14]/30 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5">
            <div>
              <h2 className="font-serif text-2xl font-semibold text-white">{draft.title}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/70">
                <span>{draft.year || '—'}</span>
                {draft.region && (
                  <>
                    <span className="text-white/30">·</span>
                    <span>{draft.region}</span>
                  </>
                )}
                {draft.duration > 0 && (
                  <>
                    <span className="text-white/30">·</span>
                    <span>{draft.duration}分钟</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              {!editing && (
                <Button variant="soft" onClick={handleSync} disabled={syncing}>
                  {syncing ? '同步中…' : draft.cover_failed ? '手动获取封面' : '同步数据'}
                </Button>
              )}
              <Button
                variant={editing ? 'primary' : 'soft'}
                onClick={editing ? handleSave : () => setEditing(true)}
              >
                {editing ? '保存' : '编辑'}
              </Button>
              {editing && (
                <Button variant="ghost" onClick={() => { setDraft(movie); setEditing(false) }}>
                  取消
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* 内容 */}
        <div className="space-y-5 p-5">
          {editing && (
            <Field label="封面（自动获取，也可填写 URL 或上传）">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={draft.cover}
                  onChange={(e) => setDraft({ ...draft, cover: e.target.value, cover_failed: false })}
                  placeholder="封面图片 URL"
                />
                <UploadButton
                  userId={draft.user_id}
                  onUploaded={(url) => setDraft({ ...draft, cover: url, cover_failed: false })}
                />
              </div>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-4">
            <InfoField
              label="类型"
              value={(draft.genre ?? []).join(' / ')}
              editing={editing}
              onChange={(v) => setDraft({ ...draft, genre: v.split('/').map((s) => s.trim()).filter(Boolean) })}
            />
            <InfoField
              label="地区"
              value={draft.region}
              editing={editing}
              onChange={(v) => setDraft({ ...draft, region: v })}
            />
            <InfoField
              label="年代"
              value={String(draft.year || '')}
              editing={editing}
              onChange={(v) => setDraft({ ...draft, year: parseInt(v, 10) || 0 })}
            />
            <InfoField
              label="时长（分钟）"
              value={String(draft.duration || '')}
              editing={editing}
              onChange={(v) => setDraft({ ...draft, duration: parseInt(v, 10) || 0 })}
            />
          </div>

          {/* 评分 */}
          <div className="flex flex-wrap gap-8">
            <div>
              <div className="mb-2 text-[11px] uppercase tracking-wider text-ink-mute">个人评分</div>
              {editing ? (
                <Input
                  type="number"
                  min={0}
                  max={10}
                  step={0.1}
                  value={draft.personal_rating ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      personal_rating: e.target.value === '' ? null : parseFloat(e.target.value),
                    })
                  }
                  placeholder="0–10"
                  className="w-24"
                />
              ) : draft.personal_rating !== null && draft.personal_rating !== undefined ? (
                <div className="flex items-center gap-2">
                  <Stars value={draft.personal_rating} />
                  <span className="text-xl font-semibold text-accent">{draft.personal_rating.toFixed(1)}</span>
                  <span className="text-[10px] text-ink-mute">{SRC_PERSONAL}</span>
                </div>
              ) : (
                <span className="text-sm text-ink-mute">未评分</span>
              )}
            </div>
            {draft.third_party_rating !== null && draft.third_party_rating !== undefined && (
              <div>
                <div className="mb-2 text-[11px] uppercase tracking-wider text-ink-mute">{SRC_THIRD}评分</div>
                <div className="flex items-center gap-2">
                  <Stars value={draft.third_party_rating} />
                  <span className="text-xl font-semibold text-ink-soft">{draft.third_party_rating.toFixed(1)}</span>
                  <span className="text-[10px] text-ink-mute">{SRC_THIRD}</span>
                </div>
              </div>
            )}
          </div>

          {/* 短评 */}
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-wider text-ink-mute">个人短评</div>
            {editing ? (
              <Textarea
                value={draft.review}
                onChange={(e) => setDraft({ ...draft, review: e.target.value })}
                placeholder="写下你的感受…"
                rows={4}
              />
            ) : (
              <p className="text-sm leading-relaxed text-ink-soft">{draft.review || '暂无短评'}</p>
            )}
          </div>

          {/* 同步状态 + 删除 */}
          <div className="flex items-center justify-between border-t border-white/8 pt-4">
            <div className="flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: draft.synced ? '#4ade80' : '#f87171' }}
              />
              <span className="text-[11px] text-ink-mute">
                {draft.synced ? '已同步第三方数据' : '未同步，点击「同步数据」获取封面 / 评分等信息'}
              </span>
            </div>
            {!editing && (
              <Button variant="ghost" className="!text-danger hover:!bg-danger/10" onClick={() => onDelete(draft)}>
                删除
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function InfoField({
  label,
  value,
  editing,
  onChange,
}: {
  label: string
  value: string
  editing: boolean
  onChange: (v: string) => void
}) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] uppercase tracking-wider text-ink-mute">{label}</div>
      {editing ? (
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <div className="text-sm text-ink-strong">{value || '—'}</div>
      )}
    </div>
  )
}

function UploadButton({ userId, onUploaded }: { userId: string; onUploaded: (url: string) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <label className="inline-flex h-9 shrink-0 cursor-pointer items-center rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-ink-soft transition hover:bg-white/10">
      {busy ? '上传中…' : '上传'}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file) return
          setBusy(true)
          try {
            const url = await uploadMovieCover(file, userId)
            onUploaded(url)
          } catch {
            /* 静默失败，用户可重试 */
          } finally {
            setBusy(false)
          }
        }}
      />
    </label>
  )
}

// ─── 新建弹窗 ───────────────────────────────────────────────────────────────
function NewMovieModal({
  userId,
  onClose,
  onSave,
}: {
  userId: string
  onClose: () => void
  onSave: (m: Movie) => void
}) {
  const [draft, setDraft] = useState({ title: '', year: String(new Date().getFullYear()), cover: '', personalRating: '', review: '' })
  const [preview, setPreview] = useState<Partial<Movie>>({})
  const [fetching, setFetching] = useState(false)
  const [uploading, setUploading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const triggerFetch = (title: string, year: string) => {
    if (timer.current) clearTimeout(timer.current)
    if (!title.trim()) return
    timer.current = setTimeout(async () => {
      setFetching(true)
      try {
        const data = await fetchMovieByTitle(title, year)
        setPreview(data)
      } finally {
        setFetching(false)
      }
    }, 800)
  }

  const coverUrl = draft.cover || preview.cover || ''

  const handleSave = () => {
    if (!draft.title.trim()) return
    const nowIso = new Date().toISOString()
    const movie: Movie = {
      id: crypto.randomUUID(),
      user_id: userId,
      title: draft.title.trim(),
      year: parseInt(draft.year, 10) || new Date().getFullYear(),
      cover: draft.cover || preview.cover || '',
      personal_rating: draft.personalRating ? parseFloat(draft.personalRating) : null,
      third_party_rating: preview.third_party_rating ?? null,
      review: draft.review.trim(),
      genre: preview.genre ?? [],
      region: preview.region ?? '',
      duration: preview.duration ?? 0,
      watched_at: nowIso.slice(0, 10),
      synced: !!preview.cover,
      cover_failed: !preview.cover && !draft.cover,
      created_at: nowIso,
      updated_at: nowIso,
    }
    onSave(movie)
  }

  return (
    <Modal
      open
      title="新增观影记录"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!draft.title.trim()}>
            添加记录
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_160px]">
        <div className="space-y-4">
          <Field label="观影名称" hint="输入后自动尝试获取封面与第三方信息">
            <Input
              value={draft.title}
              autoFocus
              onChange={(e) => {
                setDraft({ ...draft, title: e.target.value })
                triggerFetch(e.target.value, draft.year)
              }}
              placeholder="如：奥本海默"
            />
          </Field>
          <Field label="年代">
            <Input
              value={draft.year}
              onChange={(e) => {
                setDraft({ ...draft, year: e.target.value })
                triggerFetch(draft.title, e.target.value)
              }}
              placeholder="2023"
              className="w-28"
            />
          </Field>
          <Field label="封面（可手动填写或上传）">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={draft.cover}
                onChange={(e) => setDraft({ ...draft, cover: e.target.value })}
                placeholder={fetching ? '正在自动获取…' : '图片 URL（自动填充）'}
              />
              <label className="inline-flex h-9 shrink-0 cursor-pointer items-center rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-ink-soft transition hover:bg-white/10">
                {uploading ? '上传中…' : '上传'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    setUploading(true)
                    try {
                      const url = await uploadMovieCover(file, userId)
                      setDraft({ ...draft, cover: url })
                    } catch {
                      /* 静默 */
                    } finally {
                      setUploading(false)
                    }
                  }}
                />
              </label>
            </div>
          </Field>
          <Field label="个人评分 (0–10)" hint="留空则使用第三方评分">
            <Input
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={draft.personalRating}
              onChange={(e) => setDraft({ ...draft, personalRating: e.target.value })}
              placeholder="如 9.0"
              className="w-32"
            />
          </Field>
          <Field label="个人评价">
            <Textarea
              value={draft.review}
              onChange={(e) => setDraft({ ...draft, review: e.target.value })}
              placeholder="写下你的感受…"
              rows={3}
            />
          </Field>
          {preview.third_party_rating !== null && preview.third_party_rating !== undefined && (
            <p className="text-xs text-ink-mute">
              第三方评分：<span className="text-ink-soft">{preview.third_party_rating.toFixed(1)}</span>
              {preview.genre?.length ? ` · ${preview.genre.join(' / ')}` : ''}
              {preview.region ? ` · ${preview.region}` : ''}
            </p>
          )}
        </div>

        {/* 封面预览 */}
        <div className="flex flex-col items-center gap-2">
          <div className="h-[220px] w-[160px] overflow-hidden rounded-card border border-white/8 bg-black/30">
            {coverUrl ? (
              <img src={coverUrl} alt="封面预览" className="h-full w-full object-cover" />
            ) : fetching ? (
              <div className="h-full w-full animate-pulse bg-white/5" />
            ) : (
              <div className="grid h-full w-full place-items-center px-3 text-center text-xs text-ink-mute">
                {draft.title ? '获取封面中…' : '输入名称自动获取封面'}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ─── 批量导入弹窗 ───────────────────────────────────────────────────────────
function BatchImportModal({
  onClose,
  onImport,
}: {
  onClose: () => void
  onImport: (rows: { title: string; year: string }[]) => void
}) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<{ title: string; year: string }[]>([])

  const parse = (raw: string) => {
    const rows = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/[,，\t｜|]/).map((s) => s.trim()).filter(Boolean)
        return { title: parts[0] ?? '', year: parts[1] ?? '' }
      })
      .filter((r) => r.title)
    setParsed(rows)
  }

  return (
    <Modal
      open
      title="批量导入"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => parsed.length && onImport(parsed)} disabled={!parsed.length}>
            导入 {parsed.length ? `${parsed.length} 部` : ''}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-soft">每行一部，格式：电影名称，年代</p>
      <Textarea
        value={text}
        autoFocus
        onChange={(e) => {
          setText(e.target.value)
          parse(e.target.value)
        }}
        placeholder={'奥本海默，2023\n瞬息全宇宙，2022\n坠落的审判，2023'}
        rows={8}
      />
      {parsed.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-[11px] uppercase tracking-wider text-ink-mute">识别到 {parsed.length} 部影片</div>
          <div className="max-h-44 space-y-1 overflow-auto">
            {parsed.map((row, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-ink-soft"
                style={{ background: 'rgba(255,255,255,0.03)' }}
              >
                <span className="w-5 text-[11px] text-ink-mute">{i + 1}</span>
                <span className="flex-1 truncate">{row.title}</span>
                <span className="text-ink-mute">{row.year || '—'}</span>
                <span className="h-2 w-2 rounded-full bg-[#4ade80]" />
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

// ─── 主页面 ─────────────────────────────────────────────────────────────────
export default function MoviesPage() {
  const { user } = useAuth()
  const userId = user?.id ?? 'anonymous'
  const [movies, setMovies] = useState<Movie[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Movie | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [showBatch, setShowBatch] = useState(false)
  const [del, setDel] = useState<Movie | null>(null)
  const [globalError, setGlobalError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!user) {
      setMovies([])
      setLoading(false)
      return
    }
    const rows = await db.movies.where('user_id').equals(userId).toArray()
    rows.sort(
      (a, b) =>
        String(b.watched_at ?? '').localeCompare(String(a.watched_at ?? '')) ||
        b.created_at.localeCompare(a.created_at),
    )
    setMovies(rows)
    setLoading(false)
  }, [user, userId])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      await seedFromServer('movies', userId)
      if (!cancelled) await reload()
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [reload, userId])

  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`movies:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'movies', filter: `user_id=eq.${userId}` },
        () => {
          void (async () => {
            await seedFromServer('movies', userId)
            await reload()
          })()
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, userId, reload])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return movies
    return movies.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        (m.genre ?? []).some((g) => g.toLowerCase().includes(q)),
    )
  }, [movies, search])

  const hero = visible.length ? visible[0] : null

  const persist = useCallback(
    async (movie: Movie) => {
      await db.movies.put(movie)
      await enqueueAndMaybeFlush('movies', movie.created_at === movie.updated_at ? 'insert' : 'update', movie.id, movie)
      await reload()
    },
    [reload, userId],
  )

  const handleSaveMovie = (updated: Movie) => {
    void persist({ ...updated, updated_at: new Date().toISOString() })
    setSelected(null)
  }

  const handleNewMovie = (m: Movie) => {
    void persist(m)
    setShowNew(false)
  }

  const handleSync = async (m: Movie): Promise<Movie> => {
    const data = await syncMovie(m)
    const updated: Movie = {
      ...m,
      cover: m.cover || data.cover || '',
      third_party_rating: data.third_party_rating ?? m.third_party_rating,
      genre: m.genre.length ? m.genre : data.genre ?? [],
      region: m.region || data.region || '',
      duration: m.duration > 0 ? m.duration : data.duration ?? 0,
      year: data.year || m.year,
      synced: true,
      cover_failed: !m.cover && !data.cover,
      updated_at: new Date().toISOString(),
    }
    await persist(updated)
    return updated
  }

  const handleBatchImport = async (rows: { title: string; year: string }[]) => {
    setShowBatch(false)
    if (!user) return
    const nowIso = new Date().toISOString()
    const created: Movie[] = rows.map((r) => ({
      id: crypto.randomUUID(),
      user_id: userId,
      title: r.title,
      year: parseInt(r.year, 10) || new Date().getFullYear(),
      cover: '',
      personal_rating: null,
      third_party_rating: null,
      review: '',
      genre: [],
      region: '',
      duration: 0,
      watched_at: nowIso.slice(0, 10),
      synced: false,
      cover_failed: false,
      created_at: nowIso,
      updated_at: nowIso,
    }))
    for (const m of created) {
      await db.movies.put(m)
      await enqueueAndMaybeFlush('movies', 'insert', m.id, m)
    }
    await reload()
    // 后台自动同步第三方数据（mock 框架）
    for (const m of created) {
      void (async () => {
        const updated = await handleSync(m)
        void updated
      })()
    }
  }

  const confirmDelete = async () => {
    if (!del) return
    try {
      await db.movies.delete(del.id)
      await enqueueAndMaybeFlush('movies', 'delete', del.id)
      await reload()
      setSelected(null)
      setDel(null)
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : String(e))
    }
  }

  const openMovie = (m: Movie) => {
    const fresh = movies.find((x) => x.id === m.id) ?? m
    setSelected(fresh)
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* 顶部 */}
      <header className="flex flex-wrap items-end justify-between gap-3 glass-card p-5">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.25em] text-ink-mute">
            Workspace · 观影
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-ink-strong">观影志</h1>
          <p className="mt-1 text-sm text-ink-soft">
            记录你看过的电影。支持自动获取封面与第三方评分；点击封面查看详情、编辑或同步数据。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="soft" onClick={() => setShowBatch(true)}>
            批量导入
          </Button>
          <Button onClick={() => setShowNew(true)}>+ 新建</Button>
        </div>
      </header>

      {globalError ? (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {globalError}
        </div>
      ) : null}

      {/* 搜索 */}
      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索影片名称 / 类型"
            className="flex-1"
          />
          <span className="ml-auto text-xs text-ink-mute">共 {visible.length} 部</span>
        </div>
      </Card>

      {loading ? (
        <Card>
          <p className="py-12 text-center text-sm text-ink-mute">加载中…</p>
        </Card>
      ) : (
        <>
          {/* 精选 Hero */}
          {!search && hero && (
            <Hero movie={hero} onClick={() => openMovie(hero)} />
          )}

          {/* 海报墙 */}
          {visible.length === 0 ? (
            <Card>
              <p className="py-12 text-center text-sm text-ink-mute">
                {movies.length === 0
                  ? '还没有观影记录。点击右上角「新建」添加，或用「批量导入」一次加入多部。'
                  : '没有匹配的影片。'}
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
              {visible.map((m) => (
                <PosterCard key={m.id} movie={m} onClick={() => openMovie(m)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* 弹窗 */}
      {selected && (
        <MovieModal
          movie={selected}
          onClose={() => setSelected(null)}
          onSave={handleSaveMovie}
          onSync={handleSync}
          onDelete={(m) => setDel(m)}
        />
      )}
      {showNew && (
        <NewMovieModal userId={userId} onClose={() => setShowNew(false)} onSave={handleNewMovie} />
      )}
      {showBatch && (
        <BatchImportModal onClose={() => setShowBatch(false)} onImport={handleBatchImport} />
      )}

      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={confirmDelete}
        title="删除观影记录"
        message={del ? `确定删除「${del.title}」？该操作不可撤销。` : ''}
        confirmText="删除"
        danger
      />
    </div>
  )
}
