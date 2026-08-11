// 观影模块（Movies / 观影志）
// 布局与功能对齐桌面「工作台前端代码」的观影应用：
//   顶部导航：透明→毛玻璃滚动吸附，仅【搜索 / 批量导入 / 新建】三个入口
//   Hero：全屏电影封面 + 渐变叠加，随机主推影片左下角展示「标签 / 标题 / 评分 / 年代 / 地区 / 时长 / 简介 / 查看详情」
//   观影记录：横向滚动海报（160×240 竖版），点击打开详情
//   详情弹窗：顶部大封面 + 渐变 + 同步/编辑 按钮 + 2×2 键值对信息 + 双评分并排 + 个人短评 + 同步状态
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Field, Input, Textarea, Button, ConfirmDialog } from '../components/ui'
import { db } from '../lib/localDb'
import { seedFromServer, enqueueAndMaybeFlush } from '../lib/sync'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { fetchMovieByTitle, syncMovie, uploadMovieCover } from '../lib/tmdb'
import type { Movie } from '../types'

const SRC_THIRD = '第三方'

// ─── 星级（10 分制 → 5 星，半星近似为整星） ─────────────────────────────────
function Stars({ value, max = 10, size = 14 }: { value: number; max?: number; size?: number }) {
  const filled = Math.round((value / max) * 5)
  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 12 12"
          fill={i < filled ? 'currentColor' : 'none'}
          stroke={i < filled ? 'currentColor' : 'rgba(255,255,255,0.35)'}
          strokeWidth="1.2"
          className={i < filled ? 'text-yellow-400' : 'text-white/40'}
        >
          <polygon points="6,1 7.5,4.5 11,4.8 8.5,7.2 9.2,11 6,9 2.8,11 3.5,7.2 1,4.8 4.5,4.5" />
        </svg>
      ))}
    </span>
  )
}

// ─── 竖版海报（160×240 严格对齐参考 app） ─────────────────────────────────
function PosterCard({ movie, onClick }: { movie: Movie; onClick: () => void }) {
  const [err, setErr] = useState(false)
  const rating = movie.personal_rating ?? movie.third_party_rating
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative h-[240px] w-[160px] shrink-0 overflow-hidden rounded-xl bg-black/40 ring-1 ring-white/10 transition hover:ring-accent/40"
    >
      {movie.cover && !err ? (
        <img
          src={movie.cover}
          alt={movie.title}
          loading="lazy"
          onError={() => setErr(true)}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
      ) : (
        <div className="grid h-full w-full place-items-center bg-gradient-to-br from-[#1a1a2e] to-[#2a2a3e] text-3xl font-semibold text-ink-mute">
          {movie.title.slice(0, 1)}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 px-2.5 py-2 text-left">
        <div className="truncate text-sm font-medium text-white">{movie.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/70">
          <span>{movie.year || '—'}</span>
          {rating !== null && rating !== undefined && (
            <>
              <span className="text-white/30">·</span>
              <span className="font-semibold text-yellow-400">{rating.toFixed(1)}</span>
            </>
          )}
          {movie.duration > 0 && (
            <>
              <span className="text-white/30">·</span>
              <span>{movie.duration}分钟</span>
            </>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── 全屏 Hero：背景封面 + 渐变 + 左下角信息 ────────────────────────────────
function Hero({ movie, onViewDetails }: { movie: Movie; onViewDetails: () => void }) {
  const [err, setErr] = useState(false)
  const rating = movie.personal_rating ?? movie.third_party_rating
  return (
    <section
      className="relative h-[78vh] min-h-[560px] w-full overflow-hidden md:h-screen md:min-h-0 md:w-screen md:-ml-[120px] md:-mr-6 md:-mt-6"
      key={movie.id /* 切换影片触发淡入动效 */}
    >
      <style>{`
        @keyframes heroFadeIn { from { opacity: 0; transform: scale(1.04); } to { opacity: 1; transform: scale(1); } }
        @keyframes heroInfoIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      {movie.cover && !err ? (
        <img
          src={movie.cover}
          alt={movie.title}
          onError={() => setErr(true)}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ animation: 'heroFadeIn 0.8s ease-out' }}
        />
      ) : (
        <div
          className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[#1a1a2e] via-[#0a0a14] to-[#0c0c14]"
          style={{ animation: 'heroFadeIn 0.8s ease-out' }}
        >
          <span className="font-serif text-[12rem] text-white/8">{movie.title.slice(0, 1)}</span>
        </div>
      )}
      {/* 渐变叠加：底部黑色让文字清晰，顶部和右侧轻染 */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/20 to-transparent" />

      {/* 左下角信息块：左封面（backdrop 优先，否则 cover）+ 右文字块 */}
      <div className="absolute inset-x-0 bottom-0 px-6 pb-12 md:px-0 md:pl-[104px] md:pr-12 md:pb-20">
        <div
          className="flex max-w-4xl items-end gap-5"
          style={{ animation: 'heroInfoIn 0.6s ease-out 0.2s both' }}
        >
          {/* 左侧封面：与「观影记录」海报同 2:3 竖版比例（180×270），object-cover 居中裁剪宽幅图 */}
          {(movie.backdrop || movie.cover) && (
            <div className="relative hidden h-[270px] w-[180px] shrink-0 overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/15 md:block">
              <img
                src={movie.backdrop || movie.cover}
                alt={movie.title}
                className="h-full w-full object-cover"
              />
            </div>
          )}
          {/* 右侧文字块 */}
          <div className="flex-1 space-y-3 pb-1">
            {(movie.genre ?? []).length > 0 && (
              <div className="flex flex-wrap gap-3 text-xs text-white/60">
                {(movie.genre ?? []).slice(0, 3).map((g, i) => (
                  <span key={g}>
                    {g}
                    {i < Math.min(2, movie.genre.length - 1) && <span className="ml-3 text-white/30">·</span>}
                  </span>
                ))}
              </div>
            )}
            <h1 className="font-serif text-4xl font-semibold text-white md:text-6xl">{movie.title}</h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-white/80">
              <Stars value={rating ?? 0} size={14} />
              {movie.personal_rating !== null && movie.personal_rating !== undefined && (
                <span className="font-semibold text-white">{movie.personal_rating.toFixed(1)}</span>
              )}
              {movie.third_party_rating !== null && movie.third_party_rating !== undefined && (
                <span className="text-white/60">{movie.third_party_rating.toFixed(1)}</span>
              )}
              <span className="text-white/30">·</span>
              <span>{movie.year || '—'}</span>
              {movie.region && (
                <>
                  <span className="text-white/30">·</span>
                  <span>{movie.region}</span>
                </>
              )}
              {movie.duration > 0 && (
                <>
                  <span className="text-white/30">·</span>
                  <span>{movie.duration}分钟</span>
                </>
              )}
            </div>
            {movie.review && (
              <p className="max-w-2xl line-clamp-2 text-sm text-white/60">{movie.review}</p>
            )}
            <div className="pt-2">
              <button
                onClick={onViewDetails}
                className="rounded-full bg-white/10 px-5 py-1.5 text-sm text-white backdrop-blur-md transition hover:bg-white/20"
              >
                查看详情
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── 详情弹窗（顶部封面 + 渐变 + 同步/编辑 按钮 + 键值对 + 双评分 + 短评） ───
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

  // 自实现全屏弹窗：锁滚动 + ESC 关闭（替代原 <Modal>）
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

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
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      {/* 浮动关闭按钮 */}
      <button
        onClick={onClose}
        aria-label="关闭"
        className="fixed right-6 top-6 z-20 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20"
      >
        ✕
      </button>

      {/* 主体：无外框，居中且受最大宽度约束 */}
      <div
        className="mx-auto max-w-3xl pb-24"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部封面 + 渐变 + 标题（紧贴顶部，无 margin-top） */}
        <div className="relative h-72 w-full overflow-hidden md:h-80">
          {draft.cover ? (
            <img src={draft.cover} alt={draft.title} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center bg-gradient-to-br from-[#1a1a2e] to-[#2a2a3e]">
              <span className="font-serif text-7xl text-white/10">{draft.title.slice(0, 1)}</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 px-6 pb-6 md:px-10 md:pb-8">
            <h2 className="font-serif text-3xl font-semibold text-white md:text-4xl">{draft.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-white/70">
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
        </div>

        {/* 编辑态：封面字段 */}
        {editing && (
          <div className="mt-8 px-6 md:px-10">
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
          </div>
        )}

        {/* 2×2 键值对 */}
        <div className="mt-12 grid grid-cols-2 gap-x-8 gap-y-6 px-6 md:px-10">
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
            label="年份"
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

        {/* 双评分 */}
        <div className="mt-12 flex flex-wrap gap-10 px-6 md:px-10">
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
                <span className="text-xl font-semibold text-white">{draft.personal_rating.toFixed(1)}</span>
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
                <span className="text-xl font-semibold text-white/80">{draft.third_party_rating.toFixed(1)}</span>
              </div>
            </div>
          )}
        </div>

        {/* 个人短评 */}
        <div className="mt-12 px-6 md:px-10">
          <div className="mb-2 text-[11px] uppercase tracking-wider text-ink-mute">个人短评</div>
          {editing ? (
            <Textarea
              value={draft.review}
              onChange={(e) => setDraft({ ...draft, review: e.target.value })}
              placeholder="写下你的感受…"
              rows={4}
            />
          ) : (
            <p className="text-base leading-relaxed text-ink-soft">{draft.review || '暂无短评'}</p>
          )}
        </div>

        {/* 底部：同步状态 + 操作按钮（同步 / 编辑 / 取消 / 删除 全部并排） */}
        <div className="mt-16 flex flex-col gap-4 border-t border-white/10 px-6 pt-6 md:px-10">
          <div className="flex items-center gap-2">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: draft.synced ? '#4ade80' : '#f87171' }}
            />
            <span className="text-[11px] text-ink-mute">
              {draft.synced ? '已同步第三方数据' : '未同步，点击「同步数据」获取封面 / 评分等信息'}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!editing && (
              <>
                <Button variant="soft" onClick={handleSync} disabled={syncing}>
                  {syncing ? '同步中…' : draft.cover_failed ? '手动获取封面' : '同步数据'}
                </Button>
                <Button variant="soft" onClick={() => setEditing(true)}>
                  编辑
                </Button>
                <Button variant="ghost" className="!text-danger hover:!bg-danger/10" onClick={() => onDelete(draft)}>
                  删除
                </Button>
              </>
            )}
            {editing && (
              <>
                <Button variant="ghost" onClick={() => { setDraft(movie); setEditing(false) }}>
                  取消
                </Button>
                <Button variant="primary" onClick={handleSave}>
                  保存
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
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
      <div className="mb-1 text-[11px] uppercase tracking-wider text-ink-mute">{label}</div>
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
            /* 静默失败 */
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
      backdrop: preview.backdrop || '',
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
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={handleSave} disabled={!draft.title.trim()}>添加记录</Button>
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
                    } catch { /* 静默 */ }
                    finally { setUploading(false) }
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
        <div className="flex flex-col items-center gap-2">
          <div className="h-[240px] w-[160px] overflow-hidden rounded-xl border border-white/10 bg-black/30">
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
          <Button variant="ghost" onClick={onClose}>取消</Button>
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
        onChange={(e) => { setText(e.target.value); parse(e.target.value) }}
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

// ─── 主页面（完全对齐参考 App 布局） ─────────────────────────────────────
export default function MoviesPage() {
  const { user } = useAuth()
  const userId = user?.id ?? 'anonymous'
  const [movies, setMovies] = useState<Movie[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [selected, setSelected] = useState<Movie | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [showBatch, setShowBatch] = useState(false)
  const [del, setDel] = useState<Movie | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const [heroIndex, setHeroIndex] = useState(0)

  // 加载 + Realtime
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      await seedFromServer('movies', userId)
      if (!cancelled) await reload()
    }
    void load()
    return () => { cancelled = true }
  }, [userId])

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
    return () => { supabase.removeChannel(channel) }
  }, [user, userId])

  // 滚动监听（导航透明→毛玻璃）
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return movies
    return movies.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        (m.genre ?? []).some((g) => g.toLowerCase().includes(q)),
    )
  }, [movies, search])

  // Hero 轮播：随机选至多 5 部，每 8s 切换
  const heroCandidates = useMemo(() => {
    if (visible.length === 0) return []
    const arr = [...visible]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr.slice(0, Math.min(5, arr.length))
  }, [visible])

  useEffect(() => {
    if (heroCandidates.length <= 1) return
    const t = setInterval(() => setHeroIndex((i) => (i + 1) % heroCandidates.length), 8000)
    return () => clearInterval(t)
  }, [heroCandidates.length])

  const hero = heroCandidates.length ? heroCandidates[heroIndex % heroCandidates.length] : null

  const persist = useCallback(
    async (movie: Movie) => {
      await db.movies.put(movie)
      await enqueueAndMaybeFlush('movies', movie.created_at === movie.updated_at ? 'insert' : 'update', movie.id, movie)
      await reload()
    },
    [reload],
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
      backdrop: m.backdrop || data.backdrop || '',
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
      backdrop: '',
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
    // 后台自动同步第三方数据
    for (const m of created) {
      void (async () => {
        const updated = await handleSync(m)
        void updated
      })()
    }
  }

  const confirmDelete = async () => {
    if (!del) return
    await db.movies.delete(del.id)
    await enqueueAndMaybeFlush('movies', 'delete', del.id)
    await reload()
    setSelected(null)
    setDel(null)
  }

  const openMovie = (m: Movie) => {
    const fresh = movies.find((x) => x.id === m.id) ?? m
    setSelected(fresh)
  }

  return (
    <div className="relative w-full">
      {/* 顶部导航：透明 → 毛玻璃滚动吸附（仅 3 个入口：搜索 / 批量导入 / 新建） */}
      <nav
        className={`fixed left-0 right-0 top-0 z-30 transition-all duration-300 ${
          scrolled
            ? 'bg-black/40 backdrop-blur-xl border-b border-white/10'
            : 'bg-transparent border-b border-transparent'
        }`}
      >
        <div className="flex items-center justify-end gap-2.5 px-6 py-4 md:px-12">
            <button
              onClick={() => setShowSearch((s) => !s)}
              aria-label="搜索"
              className="grid h-9 w-9 place-items-center rounded-full bg-white/10 backdrop-blur-md transition hover:bg-white/20"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            <button
              onClick={() => setShowBatch(true)}
              className="rounded-full bg-white/10 px-4 py-1.5 text-sm text-white backdrop-blur-md transition hover:bg-white/20"
            >
              批量导入
            </button>
            <button
              onClick={() => setShowNew(true)}
              className="rounded-full bg-yellow-400 px-4 py-1.5 text-sm font-medium text-black transition hover:bg-yellow-300"
            >
              + 新建
            </button>
        </div>
        {showSearch && (
          <div className="border-t border-white/10 px-6 py-3 md:px-12">
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索影片名称 / 类型"
              className="w-full"
            />
          </div>
        )}
      </nav>

      {/* Hero */}
      {!loading && hero && (
        <Hero movie={hero} onViewDetails={() => openMovie(hero)} />
      )}

      {/* 观影记录：横向滚动 */}
      <section className="px-6 py-10 md:px-12 md:py-14">
        <h2 className="mb-5 text-base font-semibold text-white/90">
          观影记录
          <span className="ml-2 text-sm font-normal text-white/40">{visible.length} 部</span>
        </h2>
        {visible.length === 0 ? (
          <div className="py-16 text-center text-sm text-white/50">
            {movies.length === 0
              ? '还没有观影记录。点击右上角「新建」添加，或用「批量导入」一次加入多部。'
              : '没有匹配的影片。'}
          </div>
        ) : (
          <div
            className="-mx-6 flex gap-4 overflow-x-auto px-6 pb-4 md:-mx-12 md:px-12"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.2) transparent' }}
          >
            {visible.map((m) => (
              <PosterCard key={m.id} movie={m} onClick={() => openMovie(m)} />
            ))}
          </div>
        )}
      </section>

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
