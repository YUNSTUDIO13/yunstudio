// 阅读模块（Books / 阅读志）
// 布局与功能对齐桌面「工作台前端代码」的阅读应用：
//   顶部导航：透明→毛玻璃滚动吸附，仅【搜索 / 批量导入 / 新建】三个入口
//   （2026-08-11 已移除顶部 Hero 推荐模块；阅读记录整体上移，顶部留白避开 fixed 导航）
//   阅读记录：竖版海报网格（PC 自适应换行 auto-fill/最小 160px，手机 2 列），点击打开详情
//   详情弹窗：顶部大封面 + 渐变 + 同步/编辑 按钮 + 2×2 键值对信息 + 双评分并排 + 个人短评 + 同步状态
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent } from 'react'
import { Modal, Field, Input, Textarea, Button, ConfirmDialog, lockBodyScroll, unlockBodyScroll, forceUnlockBodyScroll } from '../components/ui'
import { db, pendingRowIds } from '../lib/localDb'
import { seedFromServer, enqueueAndMaybeFlush, setSyncStatusHandler } from '../lib/sync'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useTodos } from '../context/TodosContext'
import { fetchBookByTitle, syncBook, uploadBookCover, uploadBookImage, type BookCandidate } from '../lib/books'
import { useMediaQuery } from '../lib/useMediaQuery'
import { localInputToIso } from '../lib/datetime'
import { TagPicker } from '../components/TagPicker'
import { CachedImage } from '../components/CachedImage'
import type { Book } from '../types'

const SRC_THIRD = '第三方'

// ─── 评分档位（筛选用，多选） ─────────────────────────────────
const RATING_TIERS = [
  { key: '9+', label: '9 分以上', test: (r: number) => r >= 9 },
  { key: '8-9', label: '8–9 分', test: (r: number) => r >= 8 && r < 9 },
  { key: '7-8', label: '7–8 分', test: (r: number) => r >= 7 && r < 8 },
  { key: '6-7', label: '6–7 分', test: (r: number) => r >= 6 && r < 7 },
  { key: '<6', label: '6 分以下', test: (r: number) => r < 6 },
]

// ─── 跨域图片下载（fetch→blob→a.download；失败退回新标签） ─────────
async function downloadImage(url: string, filename: string) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error('fetch failed')
    const blob = await res.blob()
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(objUrl)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

// ─── 去重键 / 解析辅助（新建 · 批量导入 · 批量更新 三处共用） ────────────────
/**
 * 书籍唯一键 = 名称（去首尾空格 + 转小写）+ 年代。
 * 大小写与首尾空格不敏感，避免「奥本海默 」与「奥本海默」被当成两部。
 */
function bookKey(title: string, year: number | string): string {
  return `${String(title ?? '').trim().toLowerCase()}__${String(year ?? '').trim()}`
}

/**
 * 日期归一为 YYYY-MM-DD。支持 2024-3-5 / 2024/3/5 / 2024.3.5 / 2024年3月5日 /
 * 仅年月（补 01 日）/ 仅年份（补 01-01）/ Excel 日期序列号。无法识别返回空串。
 */
function normalizeDate(raw: string): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  // Excel 日期序列号（5 位数字，1900 起算）
  if (/^\d{5}$/.test(s)) {
    const d = new Date((Number(s) - 25569) * 86400000)
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }
  // 年月日
  const ymd = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`
  // 仅年月
  const ym = s.match(/^(\d{4})[-/.年](\d{1,2})月?$/)
  if (ym) return `${ym[1]}-${ym[2].padStart(2, '0')}-01`
  // 仅年份
  if (/^\d{4}$/.test(s)) return `${s}-01-01`
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return ''
}

/** 评分解析：非数字返回 null，超范围钳到 0–10 */
function parseRating(raw: string): number | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const n = parseFloat(s)
  if (isNaN(n)) return null
  return Math.min(10, Math.max(0, n))
}

/**
 * 剪贴板文本 → 行数组（tab 分隔，Excel 默认复制格式）。
 * 首行若命中「名称/片名/年代/评分/阅读时间」等表头词则自动跳过。
 */
function parseClipboardRows(text: string): string[][] {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const head = lines[0].split('\t').map((c) => c.trim())
  const isHeader =
    /名称|片名|^title$|^name$/i.test(head[0] ?? '') ||
    /年代|年份|year/i.test(head[1] ?? '') ||
    /评分|rating|score/i.test(head[2] ?? '') ||
    /阅读时间|阅读日期|日期|date/i.test(head[3] ?? '')
  return lines.slice(isHeader ? 1 : 0).map((l) => l.split('\t').map((c) => c.trim()))
}

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

// ─── 竖版海报（160×240 严格对齐参考 app；fluid=手机 2 列网格自适应） ─────────
function PosterCard({ book, onClick, fluid }: { book: Book; onClick: () => void; fluid?: boolean }) {
  const [err, setErr] = useState(false)
  const rating = book.personal_rating ?? book.third_party_rating
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative shrink-0 overflow-hidden rounded-xl bg-black/40 ring-1 ring-white/10 transition hover:ring-accent/40 ${
        fluid ? 'w-full aspect-[2/3]' : 'h-[240px] w-[160px]'
      }`}
    >
      {book.cover && !err ? (
        <CachedImage
          src={book.cover}
          alt={book.title}
          loading="lazy"
          onError={() => setErr(true)}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
      ) : (
        <div className="grid h-full w-full place-items-center bg-gradient-to-br from-[#1a1a2e] to-[#2a2a3e] text-3xl font-semibold text-ink-mute">
          {book.title.slice(0, 1)}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 px-2.5 py-2 text-left">
        <div className="truncate text-sm font-medium text-white">{book.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/70">
          <span>{book.year || '—'}</span>
          {rating !== null && rating !== undefined && (
            <>
              <span className="text-white/30">·</span>
              <span className="font-semibold text-yellow-400">{rating.toFixed(1)}</span>
            </>
          )}
          {book.read_count > 0 && (
            <>
              <span className="text-white/30">·</span>
              <span>读过 {book.read_count} 次</span>
            </>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── 剧照缩略图（封面/剧情照，点击放大，提供下载） ────────────────────────
function StillThumb({
  url,
  label,
  onOpen,
  onDownload,
}: {
  url: string
  label: string
  onOpen: () => void
  onDownload: () => void
}) {
  const [err, setErr] = useState(false)
  return (
    <div className="group relative w-full overflow-hidden rounded-lg ring-1 ring-white/10">
      <button type="button" onClick={onOpen} className="block w-full">
        {!err ? (
          <CachedImage
            src={url}
            alt={label}
            loading="lazy"
            onError={() => setErr(true)}
            className="h-[100px] w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="grid h-[100px] w-full place-items-center bg-black/30 text-xs text-ink-mute">{label}</div>
        )}
      </button>
      <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/85">
        {label}
      </span>
      <button
        type="button"
        onClick={onDownload}
        aria-label="下载保存"
        className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white/85 opacity-0 transition hover:bg-black/75 group-hover:opacity-100"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
    </div>
  )
}

// ─── 详情弹窗（顶部封面 + 渐变 + 同步/编辑 按钮 + 键值对 + 双评分 + 短评） ───
function BookDetailPanel({
  book,
  onSave,
  onSync,
  onDelete,
}: {
  book: Book
  onSave: (m: Book) => void
  onSync: (m: Book) => Promise<Book>
  onDelete: (m: Book) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Book>(book)
  const [syncing, setSyncing] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [showReserve, setShowReserve] = useState(false)

  // 切换阅读对象（PC 分栏点击不同卡片 / 移动端重开）时重置草稿
  useEffect(() => { setDraft(book) }, [book])

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

        {/* 键值对（类型/年份/阅读时间/阅读次数） */}
        <div className="mt-12 grid grid-cols-2 gap-x-8 gap-y-6 px-6 md:px-10">
          <InfoField
            label="类型"
            value={(draft.genre ?? []).join(' / ')}
            editing={editing}
            onChange={(v) => setDraft({ ...draft, genre: v.split('/').map((s) => s.trim()).filter(Boolean) })}
          />
          <InfoField
            label="年份"
            value={String(draft.year || '')}
            editing={editing}
            onChange={(v) => setDraft({ ...draft, year: parseInt(v, 10) || 0 })}
          />
          <InfoField
            label="阅读时间"
            type="date"
            value={draft.read_at ?? ''}
            editing={editing}
            onChange={(v) => setDraft({ ...draft, read_at: normalizeDate(v) })}
          />
          <InfoField
            label="阅读次数"
            value={String(draft.read_count ?? 0)}
            editing={editing}
            onChange={(v) => setDraft({ ...draft, read_count: parseInt(v, 10) || 0 })}
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

        {/* 简介 + 演员表（个人短评上方） */}
        <div className="mt-12 space-y-6 px-6 md:px-10">
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-wider text-ink-mute">简介</div>
            {editing ? (
              <Textarea
                value={draft.overview}
                onChange={(e) => setDraft({ ...draft, overview: e.target.value })}
                placeholder="可手动补充简介…"
                rows={3}
              />
            ) : (
              <p className="text-sm leading-relaxed text-ink-soft">{draft.overview || '暂无简介'}</p>
            )}
          </div>
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-wider text-ink-mute">作者</div>
            {editing ? (
              <Input
                value={draft.author ?? ''}
                onChange={(e) => setDraft({ ...draft, author: e.target.value })}
                placeholder="多个作者用「、」分隔，如：余华、莫言"
              />
            ) : draft.author ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-sm text-ink-soft">
                {draft.author.split('、').map((c, i) => (
                  <span key={`${c}-${i}`}>
                    {c}
                    {i < draft.author.split('、').length - 1 && <span className="ml-3 text-white/25">·</span>}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-mute">暂无作者</p>
            )}
          </div>
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

        {/* 封面（点击放大查看 / 下载保存） */}
        <div className="mt-12 px-6 md:px-10">
          <div className="mb-3 text-[11px] uppercase tracking-wider text-ink-mute">封面</div>
          {draft.cover ? (
            <div className="grid grid-cols-2 gap-3">
              <StillThumb
                url={draft.cover}
                label="封面"
                onOpen={() => setLightbox(draft.cover)}
                onDownload={() => void downloadImage(draft.cover, `${draft.title || 'book'}-封面.jpg`)}
              />
            </div>
          ) : (
            <p className="text-sm text-ink-mute">暂无封面</p>
          )}
        </div>

        {/* 灯箱：放大查看 + 下载保存 */}
        {lightbox && (
          <div
            className="fixed inset-0 z-[60] grid place-items-center bg-black/95 p-4"
            onClick={() => setLightbox(null)}
          >
            <button
              onClick={() => setLightbox(null)}
              aria-label="关闭"
              className="fixed right-6 top-6 z-10 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20"
            >
              ✕
            </button>
            <CachedImage
              src={lightbox}
              alt="剧照大图"
              loading="eager"
              onClick={(e) => e.stopPropagation()}
              className="max-h-[82vh] max-w-full rounded-lg object-contain"
            />
            <button
              onClick={() => void downloadImage(lightbox, `${draft.title || 'book'}-剧照.jpg`)}
              className="fixed bottom-8 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/15 px-5 py-2.5 text-sm text-white backdrop-blur-md transition hover:bg-white/25"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              下载保存
            </button>
          </div>
        )}

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
          <div className="flex items-center justify-end gap-2">
            {!editing && (
              <>
                {/* 想读：提醒图标 */}
                <button
                  type="button"
                  onClick={() => setShowReserve(true)}
                  title="想读"
                  aria-label="想读"
                  className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <path d="M6 8a6 6 0 0112 0c0 7 3 7 3 9H3c0-2 3-2 3-9z" />
                    <path d="M10 21a2 2 0 004 0" />
                  </svg>
                </button>
                {/* 同步数据：刷新图标 */}
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={syncing}
                  title={syncing ? '同步中…' : draft.cover_failed ? '手动获取封面' : '同步数据'}
                  aria-label="同步数据"
                  className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20 disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <path d="M21 12a9 9 0 11-3-6.7L21 8" />
                    <path d="M21 3v5h-5" />
                  </svg>
                </button>
                {/* 编辑：铅笔图标 */}
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  title="编辑"
                  aria-label="编辑"
                  className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
                  </svg>
                </button>
                {/* 删除：垃圾桶图标（保留红色危险暗示） */}
                <button
                  type="button"
                  onClick={() => onDelete(draft)}
                  title="删除"
                  aria-label="删除"
                  className="grid h-9 w-9 place-items-center rounded-full bg-danger/10 text-danger backdrop-blur-md transition hover:bg-danger/20"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <path d="M3 6h18" />
                    <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                </button>
              </>
            )}
            {editing && (
              <>
                <Button variant="ghost" onClick={() => { setDraft(book); setEditing(false) }}>
                  取消
                </Button>
                <Button variant="primary" onClick={handleSave}>
                  保存
                </Button>
              </>
            )}
          </div>
        </div>

        <WantReadModal book={draft} open={showReserve} onClose={() => setShowReserve(false)} />
      </div>
    )
  }

// 想读弹窗：直接复用待办新建接口，自动生成一条待办。
// 标题=想读《书名》、优先级固定 P0、截止时间/标签自选、备注预填。
function WantReadModal({
  book,
  open,
  onClose,
}: {
  book: Book
  open: boolean
  onClose: () => void
}) {
  const { addTodo } = useTodos()
  const [deadline, setDeadline] = useState('') // datetime-local 输入值
  const [tag, setTag] = useState<string | null>(null)
  const [note, setNote] = useState('好的电影，值得反复品鉴~')
  const [submitting, setSubmitting] = useState(false)

  // 每次打开重置表单（避免上次的截止时间/标签残留）
  useEffect(() => {
    if (open) {
      setDeadline('')
      setTag(null)
      setNote('好书值得反复读~')
      setSubmitting(false)
    }
  }, [open])

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      await addTodo({
        title: `想读《${book.title}》`,
        priority: 'P0',
        deadline_at: localInputToIso(deadline),
        tag_id: tag,
        note,
      })
      onClose()
    } catch (e) {
      console.error('[books] 创建想读待办失败:', e)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="想读"
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? '创建中…' : '创建待办'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {/* 标题预览（自动填充，不可改） */}
        <Field label="待办标题（自动生成）">
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-ink-soft">
            想读《{book.title}》
          </div>
        </Field>

        {/* 优先级：固定 P0 */}
        <Field label="优先级">
          <div className="inline-flex items-center rounded-full bg-[#f5222d]/15 px-3 py-1 text-xs font-semibold text-[#ff7875]">
            P0
          </div>
        </Field>

        {/* 截止时间：datetime-local 自选 */}
        <Field label="截止时间">
          <Input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </Field>

        {/* 标签：单选 chip 自选 */}
        <Field label="标签">
          <TagPicker value={tag} onChange={setTag} />
        </Field>

        {/* 备注：预填可改 */}
        <Field label="备注">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </Field>
      </div>
    </Modal>
  )
}

function BookModal({
  book,
  onClose,
  onSave,
  onSync,
  onDelete,
}: {
  book: Book
  onClose: () => void
  onSave: (m: Book) => void
  onSync: (m: Book) => Promise<Book>
  onDelete: (m: Book) => void
}) {
  // 全屏弹窗：锁滚动 + ESC 关闭（移动端 / 无分栏时复用）。
  // 用 ref 持有最新 onClose；滚动锁走全局计数器（lockBodyScroll/unlockBodyScroll），
  // 开弹窗 +1、关弹窗 -1，永远还原默认空串，杜绝 prev 污染导致的全站锁死。
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    lockBodyScroll()
    return () => {
      unlockBodyScroll()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-md"
      data-detail-modal
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
      <BookDetailPanel book={book} onSave={onSave} onSync={onSync} onDelete={onDelete} />
    </div>
  )
}

function BookList({
  visible,
  movies,
  onOpen,
}: {
  visible: Book[]
  movies: Book[]
  onOpen: (m: Book) => void
}) {
  if (visible.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-white/50">
        {movies.length === 0
          ? '还没有阅读记录。点击右上角「新建」添加，或用「批量导入」一次加入多部。'
          : '没有匹配的书籍。'}
      </div>
    )
  }
  return (
    <>
      {/* 桌面：自适应换行网格（列数随容器宽度自动增减，单列最小 160px） */}
      <div className="hidden gap-4 md:grid md:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
        {visible.map((m) => (
          <PosterCard key={m.id} book={m} fluid onClick={() => onOpen(m)} />
        ))}
      </div>
      {/* 手机：2 列网格，上下滚动 */}
      <div className="grid grid-cols-2 gap-[10px] md:hidden">
        {visible.map((m) => (
          <PosterCard key={m.id} book={m} fluid onClick={() => onOpen(m)} />
        ))}
      </div>
    </>
  )
}

function InfoField({
  label,
  value,
  editing,
  onChange,
  type,
}: {
  label: string
  value: string
  editing: boolean
  onChange: (v: string) => void
  /** 编辑态 input 类型，如 'date'（默认 text） */
  type?: string
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wider text-ink-mute">{label}</div>
      {editing ? (
        <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
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
            const url = await uploadBookCover(file, userId)
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
function NewBookModal({
  userId,
  existingKeys,
  onClose,
  onSave,
}: {
  userId: string
  /** 已有书籍的去重键集合（名称+年代），命中则拒绝重复创建 */
  existingKeys: Set<string>
  onClose: () => void
  onSave: (m: Book) => void
}) {
  const [draft, setDraft] = useState({ title: '', year: '', cover: '', personalRating: '', review: '', watchedAt: '', genre: '', author: '' })
  const [preview, setPreview] = useState<Partial<Book>>({})
  const [fetching, setFetching] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [candidates, setCandidates] = useState<BookCandidate[]>([])
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const triggerFetch = (title: string, year: string) => {
    if (timer.current) clearTimeout(timer.current)
    // 必须「名称 + 年代」双字段都非空才触发（同名歧义需要年份辅助 TMDB search 锁定目标）
    if (!title.trim() || !year.trim()) {
      setCandidates([])
      setSelectedCandidateIdx(null)
      return
    }
    timer.current = setTimeout(async () => {
      setFetching(true)
      try {
        const data = await fetchBookByTitle(title, year)
        // 公网封面直链（Google Books）直接采用，无需重传 Storage（uploadBookImage 已做直通）
        const cover = data.cover
        setPreview({ ...data, cover })
        // 类型/作者：仅在用户尚未手动填写时，用 Google Books 建议值预填（用户填了则保留覆盖）
        setDraft((d) => ({
          ...d,
          genre: d.genre ? d.genre : (data.genre ?? []).join(' / '),
          author: d.author ? d.author : (data.author ?? ''),
        }))
        setCandidates(data.candidates ?? [])
        setSelectedCandidateIdx(0)
      } finally {
        setFetching(false)
      }
    }, 800)
  }

  /** 切换候选后，同步封面与评分 */
  const handleSelectCandidate = async (idx: number) => {
    const candidate = candidates[idx]
    if (!candidate) return
    setSelectedCandidateIdx(idx)
    setFetching(true)
    try {
      const cover = candidate.cover || ''
      setPreview((prev) => ({
        ...prev,
        cover,
        third_party_rating: candidate.third_party_rating,
        year: candidate.year,
        author: candidate.author || prev.author || '',
        cover_failed: !cover && !prev.cover,
      }))
      setDraft((d) => ({ ...d, year: candidate.year ? String(candidate.year) : d.year }))
    } finally {
      setFetching(false)
    }
  }

  const coverUrl = draft.cover || preview.cover || ''

  // 去重校验：名称 + 年代 都填了才判定（年代空时无法唯一定位，不拦）
  const isDuplicate =
    !!draft.title.trim() && !!draft.year.trim() && existingKeys.has(bookKey(draft.title, draft.year))

  const handleSave = () => {
    if (!draft.title.trim() || !draft.year.trim()) return
    if (isDuplicate) return // 已存在同名同年书籍，直接跳过不新建
    const nowIso = new Date().toISOString()
    const book: Book = {
      id: crypto.randomUUID(),
      user_id: userId,
      title: draft.title.trim(),
      year: parseInt(draft.year, 10) || 0,
      cover: draft.cover || preview.cover || '',
      personal_rating: draft.personalRating ? parseFloat(draft.personalRating) : null,
      third_party_rating: preview.third_party_rating ?? null,
      review: draft.review.trim(),
      overview: preview.overview ?? '',
      author: draft.author.trim() || preview.author || '',
      genre: draft.genre.trim()
        ? draft.genre.split(/[,，/]/).map((s) => s.trim()).filter(Boolean)
        : preview.genre ?? [],
      read_at: normalizeDate(draft.watchedAt) || nowIso.slice(0, 10),
      read_count: 0,
      synced: !!preview.cover,
      cover_failed: !preview.cover && !draft.cover,
      created_at: nowIso,
      updated_at: nowIso,
    }
    onSave(book)
  }

  return (
    <Modal
      open
      title="新增阅读记录"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={handleSave} disabled={!draft.title.trim() || !draft.year.trim() || isDuplicate}>
            {isDuplicate ? '已存在，无需添加' : '添加记录'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_160px]">
        <div className="space-y-4">
          <Field label="书籍名称" hint="输入后自动尝试获取封面与第三方信息">
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
          {isDuplicate && (
            <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              库中已存在「{draft.title.trim()}（{draft.year.trim()}）」，已阻止重复创建。如需修改请到列表中打开该书籍编辑。
            </p>
          )}
          {candidates.length > 0 && (
            <Field label={`候选（${candidates.length} 个）`} hint="点击切换封面 / 年份 / 评分">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {candidates.map((c, idx) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={fetching}
                    onClick={() => void handleSelectCandidate(idx)}
                    className={`relative flex w-[120px] shrink-0 flex-col rounded-lg border p-1.5 text-left transition ${
                      selectedCandidateIdx === idx ? 'border-accent bg-accent/10' : 'border-white/10 hover:border-white/30'
                    }`}
                  >
                    <div className="relative h-[150px] w-full overflow-hidden rounded-md bg-black/40">
                      {c.cover ? (
                        <img src={c.cover} alt={c.title} loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-xs text-ink-mute">{c.title.slice(0, 1)}</div>
                      )}
                    </div>
                    <div className="mt-1.5 truncate text-xs text-white">{c.title}</div>
                    <div className="flex items-center gap-1.5 text-[10px] text-white/60">
                      <span>{c.year || '—'}</span>
                      {c.third_party_rating !== null && <span className="text-yellow-400">★ {c.third_party_rating.toFixed(1)}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </Field>
          )}
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
                      const url = await uploadBookCover(file, userId)
                      setDraft({ ...draft, cover: url })
                    } catch { /* 静默 */ }
                    finally { setUploading(false) }
                  }}
                />
              </label>
            </div>
          </Field>
          <Field label="类型" hint="多个用「/」分隔，如 剧情 / 科幻">
            <Input
              value={draft.genre}
              onChange={(e) => setDraft({ ...draft, genre: e.target.value })}
              placeholder="TMDB 自动带出，可修改"
            />
          </Field>
          <Field label="作者" hint="多个作者用「、」分隔；Google Books 自动带出，可修改">
            <Input
              value={draft.author ?? ''}
              onChange={(e) => setDraft({ ...draft, author: e.target.value })}
              placeholder="Google Books 自动带出"
            />
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
          <Field label="阅读时间" hint="留空则默认记为今天">
            <Input
              type="date"
              value={draft.watchedAt}
              onChange={(e) => setDraft({ ...draft, watchedAt: e.target.value })}
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
              {preview.author ? ` · ${preview.author}` : ''}
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

// ─── 批量导入弹窗（粘贴 4 列 + 去重跳过 + 逐行富化 + 压缩上传 + 进度 + 容错）───
function BatchImportModal({
  userId,
  existingKeys,
  onClose,
  onDone,
}: {
  userId: string
  /** 已有书籍的去重键集合（名称+年代），命中则整行跳过（不请求 TMDB、不新建） */
  existingKeys: Set<string>
  onClose: () => void
  onDone: () => void
}) {
  const [phase, setPhase] = useState<'idle' | 'importing' | 'done'>('idle')
  const [rows, setRows] = useState<{ title: string; year: string; rating: string; watchedAt: string; author: string }[]>([])
  const [parseErr, setParseErr] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState<
    { title: string; ok: boolean; skipped?: boolean; msg?: string; hasCover?: boolean }[]
  >([])

  /**
   * 粘贴解析：抓取剪贴板纯文本，按 tab 拆分（Excel 默认复制格式）。
   * 列序：书籍名称 / 年代 / 个人评分（可选）/ 阅读时间（可选）/ 作者（可选）。表头自动识别跳过。
   */
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text/plain')
    setParseErr('')
    if (!text || !text.trim()) return
    e.preventDefault()
    const cells = parseClipboardRows(text)
    if (!cells.length) {
      setParseErr('未识别到有效行，请确认复制了「名称 + 年代」列')
      return
    }
    const parsed = cells
      .map((c) => ({
        title: String(c[0] ?? '').trim(),
        year: String(c[1] ?? '').trim(),
        rating: String(c[2] ?? '').trim(),
        watchedAt: String(c[3] ?? '').trim(),
        author: String(c[4] ?? '').trim(),
      }))
      .filter((r) => r.title)
    if (!parsed.length) {
      setParseErr('未识别到「名称 + 年代」数据，请确认前两列为名称、年代')
      return
    }
    setRows(parsed)
  }

  // 预判：本批中有多少行是库里已存在的（会被跳过）
  const dupCount = useMemo(
    () => rows.filter((r) => existingKeys.has(bookKey(r.title, r.year))).length,
    [rows, existingKeys],
  )

  const handleClear = () => {
    setRows([])
    setParseErr('')
  }

  const startImport = async () => {
    if (!rows.length) return
    setPhase('importing')
    setProgress({ done: 0, total: rows.length })
    setResults([])
    // 本批内也去重（同一份表格里出现两次同名同年，只建一次）
    const seen = new Set(existingKeys)
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const key = bookKey(r.title, r.year)
      // 去重校验：库中或本批已有 → 直接跳过，不请求 TMDB、不新建
      if (seen.has(key)) {
        setResults((p) => [...p, { title: r.title, ok: true, skipped: true }])
        setProgress({ done: i + 1, total: rows.length })
        continue
      }
      seen.add(key)
      try {
        const data = await fetchBookByTitle(r.title, r.year)
        const cover = data.cover ? await uploadBookImage(data.cover, userId).catch(() => '') : ''
        const nowIso = new Date().toISOString()
        const book: Book = {
          id: crypto.randomUUID(),
          user_id: userId,
          title: r.title,
          year: data.year || parseInt(r.year, 10) || 0,
          cover,
          personal_rating: parseRating(r.rating),
          third_party_rating: data.third_party_rating ?? null,
          review: '',
          overview: data.overview ?? '',
          author: r.author || data.author || '',
          genre: data.genre ?? [],
          read_at: normalizeDate(r.watchedAt) || nowIso.slice(0, 10),
          read_count: 0,
          synced: !!cover,
          cover_failed: !cover,
          created_at: nowIso,
          updated_at: nowIso,
        }
        await db.books.put(book)
        await enqueueAndMaybeFlush('books', 'insert', book.id, book)
        setResults((p) => [...p, { title: r.title, ok: true, hasCover: !!cover }])
      } catch (e) {
        setResults((p) => [...p, { title: r.title, ok: false, msg: e instanceof Error ? e.message : String(e) }])
      }
      setProgress({ done: i + 1, total: rows.length })
      if (i < rows.length - 1) await new Promise((res) => setTimeout(res, 250)) // 节流，避免触发 TMDB/Storage 限流
    }
    setPhase('done')
  }

  return (
    <Modal
      open
      title="粘贴导入·阅读记录"
      onClose={onClose}
      footer={
        phase === 'idle' ? (
          <>
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button onClick={startImport} disabled={!rows.length || rows.length === dupCount}>
              {rows.length
                ? rows.length === dupCount
                  ? '全部已存在'
                  : `确认导入 ${rows.length - dupCount} 部`
                : '确认导入'}
            </Button>
          </>
        ) : phase === 'done' ? (
          <Button onClick={() => { onDone(); onClose() }}>完成</Button>
        ) : (
          <Button disabled>导入中…</Button>
        )
      }
    >
      {phase === 'idle' && rows.length === 0 && (
        <>
          <div className="mb-3 space-y-1 text-xs text-ink-mute">
            <p>
              在 Excel 中选中数据区域（含标题行）按 <kbd className="rounded border border-white/15 bg-white/5 px-1 text-[11px] text-ink-soft">Ctrl+C</kbd> 复制，
              然后点击下方输入框按 <kbd className="rounded border border-white/15 bg-white/5 px-1 text-[11px] text-ink-soft">Ctrl+V</kbd> 粘贴。
            </p>
            <p>
              列序：<span className="text-ink-soft">书籍名称</span>、<span className="text-ink-soft">年代</span>、
              <span className="text-ink-soft">个人评分</span>（可选）、<span className="text-ink-soft">阅读时间</span>（可选）·
              第一行表头自动识别
            </p>
            <p className="text-amber-300/80">
              已有书籍（同名 + 同年代）会自动跳过，不会重复创建。若只想更新已有书籍的评分 / 阅读时间，请用「批量更新」。
            </p>
          </div>
          <textarea
            onPaste={handlePaste}
            placeholder="点击此处，按 Ctrl+V 粘贴 Excel 数据…"
            autoFocus
            rows={5}
            className="block w-full resize-none rounded-xl border-2 border-dashed border-accent/40 bg-accent/[0.04] px-4 py-3 text-sm text-ink-soft outline-none transition placeholder:text-ink-mute focus:border-accent focus:bg-accent/[0.08]"
          />
          {parseErr && <p className="mt-3 text-xs text-[#f87171]">{parseErr}</p>}
        </>
      )}
      {phase === 'idle' && rows.length > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                已接收 {rows.length} 行 · 待新建 {rows.length - dupCount} 部
              </span>
              {dupCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/15 px-2.5 py-1 text-xs text-amber-300">
                  已存在 {dupCount} 部，将跳过
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleClear}
              className="text-xs text-ink-mute underline-offset-2 transition hover:text-ink-soft hover:underline"
            >
              清空重新粘贴
            </button>
          </div>
          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5 text-left text-[11px] uppercase tracking-wider text-ink-mute">
                  <th className="w-12 px-3 py-2 text-center">#</th>
                  <th className="px-3 py-2">书籍名称</th>
                  <th className="w-20 px-3 py-2">年代</th>
                  <th className="w-16 px-3 py-2">评分</th>
                  <th className="w-28 px-3 py-2">阅读时间</th>
                  <th className="w-20 px-3 py-2">处理</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((r, i) => {
                  const dup = existingKeys.has(bookKey(r.title, r.year))
                  return (
                    <tr key={i} className="border-b border-white/5 last:border-b-0 hover:bg-white/[0.03]">
                      <td className="px-3 py-2 text-center text-[11px] text-ink-mute">{i + 1}</td>
                      <td className="px-3 py-2 text-ink-soft">{r.title}</td>
                      <td className="px-3 py-2 text-ink-mute">{r.year || '—'}</td>
                      <td className="px-3 py-2 text-ink-mute">{parseRating(r.rating) ?? '—'}</td>
                      <td className="px-3 py-2 text-ink-mute">{normalizeDate(r.watchedAt) || '—'}</td>
                      <td className={`px-3 py-2 text-[11px] ${dup ? 'text-amber-300' : 'text-emerald-300'}`}>
                        {dup ? '跳过' : '新建'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {rows.length > 50 && (
              <div className="border-t border-white/10 px-3 py-2 text-center text-[11px] text-ink-mute">
                … 其余 {rows.length - 50} 行省略显示
              </div>
            )}
          </div>
        </>
      )}
      {phase !== 'idle' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-soft">导入进度</span>
            <span className="text-ink-mute">{progress.done} / {progress.total}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
          {phase === 'done' && (
            <p className="text-xs text-ink-mute">
              新增 <span className="text-emerald-300">{results.filter((r) => r.ok && !r.skipped).length}</span> 部 ·
              跳过（已存在）<span className="text-amber-300">{results.filter((r) => r.skipped).length}</span> 部 ·
              失败 <span className="text-[#f87171]">{results.filter((r) => !r.ok).length}</span> 部
            </p>
          )}
          <div className="max-h-52 space-y-1 overflow-auto">
            {results.map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm"
                style={{ background: 'rgba(255,255,255,0.03)' }}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    r.skipped ? 'bg-[#fbbf24]' : r.ok ? 'bg-[#4ade80]' : 'bg-[#f87171]'
                  }`}
                />
                <span className="flex-1 truncate text-ink-soft">{r.title}</span>
                {r.skipped ? (
                  <span className="text-[11px] text-amber-300">已存在·跳过</span>
                ) : r.ok ? (
                  r.hasCover ? <span className="text-[11px] text-ink-mute">封面✓</span> : <span className="text-[11px] text-[#f87171]">无封面</span>
                ) : (
                  <span className="text-[11px] text-[#f87171]">{(r.msg ?? '').slice(0, 20)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

// ─── 批量更新弹窗（4 列：名称/年代/个人评分/阅读时间 → 仅更新已有书籍的 2 个字段）──
function BatchUpdateModal({
  movies,
  onClose,
  onDone,
}: {
  movies: Book[]
  onClose: () => void
  onDone: () => void
}) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [rows, setRows] = useState<{ title: string; year: string; rating: string; watchedAt: string }[]>([])
  const [parseErr, setParseErr] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState<
    { title: string; status: 'updated' | 'nochange' | 'missing' | 'error'; msg?: string }[]
  >([])

  /** 现有书籍索引：去重键（名称+年代）→ Book */
  const index = useMemo(() => {
    const m = new Map<string, Book>()
    for (const mv of movies) m.set(bookKey(mv.title, mv.year), mv)
    return m
  }, [movies])

  /** 现有书籍索引：仅按名称（不敏感）→ 同名书籍列表（用于「名称+年代」未中时的回退匹配） */
  const byTitle = useMemo(() => {
    const m = new Map<string, Book[]>()
    for (const mv of movies) {
      const k = mv.title.trim().toLowerCase()
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(mv)
    }
    return m
  }, [movies])

  /**
   * 解析某行要更新的目标书籍：
   *  1) 精确（名称+年代）命中 → 直接用；
   *  2) 否则仅按名称回退：库里同名唯一才认（填「导入时年代被 TMDB 改写」导致年代对不上的坑），
   *     并在 note 标注年份差异供复核；
   *  3) 同名多部 或 库中无同名 → 匹配不到（保持「绝不新建」铁律，跳过）。
   */
  const resolveTarget = (r: { title: string; year: string }): {
    book: Book | null
    byTitleOnly: boolean
    note: string
  } => {
    const exact = index.get(bookKey(r.title, r.year))
    if (exact) return { book: exact, byTitleOnly: false, note: '' }
    const sameTitle = byTitle.get(r.title.trim().toLowerCase()) ?? []
    if (sameTitle.length === 1) {
      const m = sameTitle[0]
      return {
        book: m,
        byTitleOnly: true,
        note: `年份不一致（表 ${r.year || '—'} / 库 ${m.year || '—'}）·已按名称匹配`,
      }
    }
    return {
      book: null,
      byTitleOnly: false,
      note: sameTitle.length > 1 ? '库中同名多部，无法判定年份，跳过' : '库中无同名书籍，跳过',
    }
  }

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text/plain')
    setParseErr('')
    if (!text || !text.trim()) return
    e.preventDefault()
    const cells = parseClipboardRows(text)
    if (!cells.length) {
      setParseErr('未识别到有效行，请确认复制了 4 列数据')
      return
    }
    const parsed = cells
      .map((c) => ({
        title: String(c[0] ?? '').trim(),
        year: String(c[1] ?? '').trim(),
        rating: String(c[2] ?? '').trim(),
        watchedAt: String(c[3] ?? '').trim(),
      }))
      .filter((r) => r.title)
    if (!parsed.length) {
      setParseErr('未识别到「名称 + 年代」数据，请确认列序为 名称 / 年代 / 个人评分 / 阅读时间')
      return
    }
    setRows(parsed)
  }

  // 预判：能匹配到现有书籍的行数（精确 + 仅名称回退）
  const matchCount = useMemo(
    () => rows.filter((r) => resolveTarget(r).book).length,
    [rows, index, byTitle],
  )

  const startUpdate = async () => {
    if (!rows.length) return
    setPhase('running')
    setProgress({ done: 0, total: rows.length })
    setResults([])
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const { book: target, byTitleOnly, note } = resolveTarget(r)
      // 匹配不到 → 跳过，绝不新建（皇上明确要求）
      if (!target) {
        setResults((p) => [...p, { title: `${r.title}（${r.year || '—'}）`, status: 'missing', msg: note }])
        setProgress({ done: i + 1, total: rows.length })
        continue
      }
      const rating = parseRating(r.rating)
      const watched = normalizeDate(r.watchedAt)
      // 两列都为空 → 无可更新内容，保留原值
      if (rating === null && !watched) {
        setResults((p) => [...p, { title: target.title, status: 'nochange' }])
        setProgress({ done: i + 1, total: rows.length })
        continue
      }
      try {
        const updated: Book = {
          ...target,
          // 列为空则保留原值，不覆盖成 null / 空串
          personal_rating: rating ?? target.personal_rating,
          read_at: watched || target.read_at,
          updated_at: new Date().toISOString(),
        }
        await db.books.put(updated)
        await enqueueAndMaybeFlush('books', 'update', updated.id, updated)
        setResults((p) => [
          ...p,
          { title: target.title, status: 'updated', msg: byTitleOnly ? note : undefined },
        ])
      } catch (e) {
        setResults((p) => [
          ...p,
          { title: target.title, status: 'error', msg: e instanceof Error ? e.message : String(e) },
        ])
      }
      setProgress({ done: i + 1, total: rows.length })
      // 每 20 条让出一次主线程，避免大批量写入卡 UI
      if (i % 20 === 19) await new Promise((res) => setTimeout(res, 60))
    }
    setPhase('done')
  }

  const STATUS_META = {
    updated: { dot: 'bg-[#4ade80]', text: 'text-emerald-300', label: '已更新' },
    nochange: { dot: 'bg-white/30', text: 'text-ink-mute', label: '无变更' },
    missing: { dot: 'bg-[#fbbf24]', text: 'text-amber-300', label: '库中无·跳过' },
    error: { dot: 'bg-[#f87171]', text: 'text-[#f87171]', label: '失败' },
  } as const

  return (
    <Modal
      open
      title="批量更新·评分与阅读时间"
      onClose={onClose}
      footer={
        phase === 'idle' ? (
          <>
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button onClick={startUpdate} disabled={!rows.length || matchCount === 0}>
              {rows.length ? (matchCount ? `确认更新 ${matchCount} 部` : '无匹配书籍') : '确认更新'}
            </Button>
          </>
        ) : phase === 'done' ? (
          <Button onClick={() => { onDone(); onClose() }}>完成</Button>
        ) : (
          <Button disabled>更新中…</Button>
        )
      }
    >
      {phase === 'idle' && rows.length === 0 && (
        <>
          <div className="mb-3 space-y-1 text-xs text-ink-mute">
            <p>
              在 Excel 中选中数据区域（含标题行）按 <kbd className="rounded border border-white/15 bg-white/5 px-1 text-[11px] text-ink-soft">Ctrl+C</kbd> 复制，
              然后点击下方输入框按 <kbd className="rounded border border-white/15 bg-white/5 px-1 text-[11px] text-ink-soft">Ctrl+V</kbd> 粘贴。
            </p>
            <p>
              列序：<span className="text-ink-soft">书籍名称</span>、<span className="text-ink-soft">年代</span>、
              <span className="text-ink-soft">个人评分</span>、<span className="text-ink-soft">阅读时间</span>
            </p>
            <p className="text-accent/80">
              优先按「名称 + 年代」匹配库中已有书籍，更新 <span className="text-ink-soft">个人评分</span> 与{' '}
              <span className="text-ink-soft">阅读时间</span> 两个字段；若年代与库中（TMDB）不一致，
              会自动回退「仅按名称」匹配（库里同名唯一才认）。匹配不到的行直接跳过，
              <span className="text-ink-soft">不会新建任何书籍</span>。某列留空则保留该书籍原值。
            </p>
          </div>
          <textarea
            onPaste={handlePaste}
            placeholder="点击此处，按 Ctrl+V 粘贴 Excel 数据…"
            autoFocus
            rows={5}
            className="block w-full resize-none rounded-xl border-2 border-dashed border-accent/40 bg-accent/[0.04] px-4 py-3 text-sm text-ink-soft outline-none transition placeholder:text-ink-mute focus:border-accent focus:bg-accent/[0.08]"
          />
          {parseErr && <p className="mt-3 text-xs text-[#f87171]">{parseErr}</p>}
        </>
      )}
      {phase === 'idle' && rows.length > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                已接收 {rows.length} 行 · 匹配 {matchCount} 部
              </span>
              {rows.length - matchCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/15 px-2.5 py-1 text-xs text-amber-300">
                  库中无 {rows.length - matchCount} 部，将跳过
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setRows([]); setParseErr('') }}
              className="text-xs text-ink-mute underline-offset-2 transition hover:text-ink-soft hover:underline"
            >
              清空重新粘贴
            </button>
          </div>
          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5 text-left text-[11px] uppercase tracking-wider text-ink-mute">
                  <th className="w-12 px-3 py-2 text-center">#</th>
                  <th className="px-3 py-2">书籍名称</th>
                  <th className="w-20 px-3 py-2">年代</th>
                  <th className="w-16 px-3 py-2">评分</th>
                  <th className="w-28 px-3 py-2">阅读时间</th>
                  <th className="w-24 px-3 py-2">处理</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((r, i) => {
                  const res = resolveTarget(r)
                  const hit = !!res.book
                  return (
                    <tr key={i} className="border-b border-white/5 last:border-b-0 hover:bg-white/[0.03]">
                      <td className="px-3 py-2 text-center text-[11px] text-ink-mute">{i + 1}</td>
                      <td className="px-3 py-2 text-ink-soft">{r.title}</td>
                      <td className="px-3 py-2 text-ink-mute">{r.year || '—'}</td>
                      <td className="px-3 py-2 text-ink-mute">{parseRating(r.rating) ?? '—'}</td>
                      <td className="px-3 py-2 text-ink-mute">{normalizeDate(r.watchedAt) || '—'}</td>
                      <td className={`px-3 py-2 text-[11px] ${hit ? (res.byTitleOnly ? 'text-amber-300' : 'text-emerald-300') : 'text-amber-300'}`}>
                        {hit ? (res.byTitleOnly ? '按名称匹配' : '更新') : '库中无·跳过'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {rows.length > 50 && (
              <div className="border-t border-white/10 px-3 py-2 text-center text-[11px] text-ink-mute">
                … 其余 {rows.length - 50} 行省略显示
              </div>
            )}
          </div>
        </>
      )}
      {phase !== 'idle' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-soft">更新进度</span>
            <span className="text-ink-mute">{progress.done} / {progress.total}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
          {phase === 'done' && (
            <p className="text-xs text-ink-mute">
              已更新 <span className="text-emerald-300">{results.filter((r) => r.status === 'updated').length}</span> 部 ·
              无变更 {results.filter((r) => r.status === 'nochange').length} 部 ·
              库中无 <span className="text-amber-300">{results.filter((r) => r.status === 'missing').length}</span> 部 ·
              失败 <span className="text-[#f87171]">{results.filter((r) => r.status === 'error').length}</span> 部
            </p>
          )}
          <div className="max-h-52 space-y-1 overflow-auto">
            {results.map((r, i) => {
              const meta = STATUS_META[r.status]
              return (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm"
                  style={{ background: 'rgba(255,255,255,0.03)' }}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                  <span className="flex-1 truncate text-ink-soft">{r.title}</span>
                  <span className={`text-[11px] ${meta.text}`}>{r.msg ? r.msg.slice(0, 20) : meta.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Modal>
  )
}

// ─── 筛选弹窗（类型 / 地区 / 年份 / 评分，每维度多选） ─────────────────────
interface FilterState {
  genres: string[]
  years: string[]
  ratings: string[]
}

const EMPTY_FILTER: FilterState = { genres: [], years: [], ratings: [] }

function FilterChips({
  options,
  selected,
  onToggle,
}: {
  options: { value: string; label: string }[]
  selected: string[]
  onToggle: (v: string) => void
}) {
  if (!options.length) {
    return <p className="text-xs text-ink-mute">暂无可选值（当前库无此类数据）</p>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = selected.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onToggle(o.value)}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              active
                ? 'border-accent bg-accent/15 text-white'
                : 'border-white/10 bg-white/5 text-ink-soft hover:border-white/30'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function FilterModal({
  open,
  init,
  genres,
  years,
  onApply,
  onClear,
  onClose,
}: {
  open: boolean
  init: FilterState
  genres: string[]
  years: string[]
  onApply: (f: FilterState) => void
  onClear: () => void
  onClose: () => void
}) {
  const [sel, setSel] = useState<FilterState>(init)
  useEffect(() => { if (open) setSel(init) }, [open, init])

  const toggle = (dim: keyof FilterState, v: string) =>
    setSel((s) => ({
      ...s,
      [dim]: s[dim].includes(v) ? s[dim].filter((x) => x !== v) : [...s[dim], v],
    }))

  const activeCount = sel.genres.length + sel.years.length + sel.ratings.length

  return (
    <Modal
      open={open}
      title="筛选阅读记录"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClear}>清空</Button>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={() => onApply(sel)}>应用{activeCount ? `（${activeCount}）` : ''}</Button>
        </>
      }
    >
      <div className="space-y-6">
        <div>
          <div className="mb-2.5 text-[11px] uppercase tracking-wider text-ink-mute">类型</div>
          <FilterChips
            options={genres.map((g) => ({ value: g, label: g }))}
            selected={sel.genres}
            onToggle={(v) => toggle('genres', v)}
          />
        </div>
        <div>
          <div className="mb-2.5 text-[11px] uppercase tracking-wider text-ink-mute">年份</div>
          <FilterChips
            options={years.map((y) => ({ value: y, label: y }))}
            selected={sel.years}
            onToggle={(v) => toggle('years', v)}
          />
        </div>
        <div>
          <div className="mb-2.5 text-[11px] uppercase tracking-wider text-ink-mute">评分</div>
          <FilterChips
            options={RATING_TIERS.map((t) => ({ value: t.key, label: t.label }))}
            selected={sel.ratings}
            onToggle={(v) => toggle('ratings', v)}
          />
        </div>
      </div>
    </Modal>
  )
}

// ─── 主页面（完全对齐参考 App 布局） ─────────────────────────────────────
export default function BooksPage() {
  const { user } = useAuth()
  const userId = user?.id ?? 'anonymous'
  const [movies, setBooks] = useState<Book[]>([])
  const [, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [selected, setSelected] = useState<Book | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [showBatch, setShowBatch] = useState(false)
  const [showBatchUpdate, setShowBatchUpdate] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER)
  const [sortBy, setSortBy] = useState<'read_at' | 'rating'>('read_at')
  const [del, setDel] = useState<Book | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const isMobile = useMediaQuery('(max-width: 767px)')
  const [showFunc, setShowFunc] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const funcRef = useRef<HTMLDivElement>(null)

  // 功能弹窗：点击外部关闭
  useEffect(() => {
    if (!showFunc) return
    function onDoc(e: MouseEvent) {
      if (funcRef.current && !funcRef.current.contains(e.target as Node)) setShowFunc(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [showFunc])

  // 注册同步状态回调：上传失败显式报错横幅，成功则清除
  useEffect(() => {
    setSyncStatusHandler((s) => {
      if (s.ok) setSyncError(null)
      else setSyncError(s.msg ?? '同步到云端失败')
    })
    return () => setSyncStatusHandler(null)
  }, [])

  const reload = useCallback(async () => {
    if (!user) {
      setBooks([])
      setLoading(false)
      return
    }
    const rows = await db.books.where('user_id').equals(userId).toArray()
    rows.sort(
      (a, b) =>
        String(b.read_at ?? '').localeCompare(String(a.read_at ?? '')) ||
        b.created_at.localeCompare(a.created_at),
    )
    setBooks(rows)
    setLoading(false)
  }, [user, userId])

  // 本地 vs 云端孤儿对账：清理「云端已删除、且本地无挂起 upsert」的残留记录。
  // 跨端删除一致性兜底——PC 错过 Realtime DELETE 时本地残留永不清（无痕模式因全新 IndexedDB 才正常）。
  // 同时供「手动刷新」复用。
  const reconcileOrphans = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    try {
      const { data, error } = await supabase
        .from('books')
        .select('id')
        .eq('user_id', userId)
      if (error || !data) return
      const cloudIds = new Set((data as { id: string }[]).map((r) => r.id))
      const locals = await db.books.where('user_id').equals(userId).toArray()
      const pending = await pendingRowIds('books')
      const orphanIds = locals
        .map((m) => m.id)
        .filter((id) => !cloudIds.has(id) && !pending.has(id))
      if (orphanIds.length) {
        await db.books.bulkDelete(orphanIds)
        const del = new Set(orphanIds)
        setBooks((prev) => prev.filter((m) => !del.has(m.id)))
      }
    } catch {
      // 对账失败静默处理，绝不阻塞主流程
    }
  }, [userId])

  // 加载 + Realtime
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      // 本地优先：先立即从 IndexedDB 秒出数据（首屏不卡）
      await reload()
      if (cancelled) return
      // 仅当本地无数据时才全量注水（首装/清缓存）；已有本地数据时依赖 Realtime 行级增量同步，
      // 避免每次进页面都 bulkPut 177 行导致手机端卡顿（删除等操作的后台对齐同理）。
      const localCount = await db.books.where('user_id').equals(userId).count()
      if (localCount === 0) {
        await seedFromServer('books', userId)
        if (cancelled) return
        await reload()
      }
      // 增量对账：无论本地是否有数据，都清理云端已删的本地孤儿（跨端删除一致性兜底）
      if (!cancelled) await reconcileOrphans()
    }
    void load()
    // 兜底：页面长时间打开错过 Realtime 时，每 30s 静默对账一次自动自愈
    const timer = window.setInterval(() => {
      if (!cancelled) void reconcileOrphans()
    }, 30000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [userId, reload, reconcileOrphans])

  // 手动刷新：主动从云端全量拉取并本地对账（补手机端新建、PC 未收到 Realtime UPSERT 的新增；清云端已删孤儿）。
  // 不锁滚动、按钮转圈，失败给错误提示但不阻塞。
  const refreshFromCloud = useCallback(async () => {
    if (!user || refreshing) return
    setRefreshing(true)
    try {
      // 云端全量拉取并 bulkPut 到本地（含 PC 端缺失的新增记录）
      await seedFromServer('books', userId)
      // 清理云端已删的本地孤儿
      await reconcileOrphans()
      // 刷新列表 state
      await reload()
      setSyncError(null)
    } catch {
      setSyncError('从云端刷新失败，请检查网络后重试')
    } finally {
      setRefreshing(false)
    }
  }, [user, userId, refreshing, reload, reconcileOrphans])

  // 安全网：本页卸载（切换模块）时强制释放任何残留的滚动锁，避免跨路由后全站仍被锁死。
  useEffect(() => () => { forceUnlockBodyScroll() }, [])

  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`books:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'books', filter: `user_id=eq.${userId}` },
        (payload: { eventType?: string; old?: { id?: string }; new?: Record<string, unknown> }) => {
          const et = payload.eventType
          const oldId = payload.old?.id
          const newRow = payload.new as (Record<string, unknown> & { id?: string }) | undefined
          // 删除：按 id 精确删本地 + 行级移除 state（跨端删除一致性），零整表重渲
          if (et === 'DELETE' || (oldId && !newRow?.id)) {
            if (oldId) {
              void db.books.delete(oldId)
              setBooks((prev) => prev.filter((m) => m.id !== oldId))
            }
            return
          }
          // 新增/更新：用 payload.new 做行级精准 upsert，避免回显时全量重拉 177 行（手机端卡顿根因）。
          // 保护本地未同步编辑：该行在 outbox/pending 中则跳过，不覆盖本地最新（LWW 一致）。
          if (newRow?.id) {
            void (async () => {
              const pending = await pendingRowIds('books')
              if (!pending.has(String(newRow.id))) {
                await db.books.put(newRow as unknown as Book)
              }
              await reload()
            })()
          }
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user, userId])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = movies.filter((m) => {
      // 搜索（名称 + 类型）
      if (q && !(m.title.toLowerCase().includes(q) || (m.genre ?? []).some((g) => g.toLowerCase().includes(q)))) {
        return false
      }
      // 类型（OR 维度内，AND 跨维度）
      if (filter.genres.length && !(m.genre ?? []).some((g) => filter.genres.includes(g))) return false
      // 年份
      if (filter.years.length && !filter.years.includes(String(m.year || ''))) return false
      // 评分档位
      if (filter.ratings.length) {
        const r = m.personal_rating ?? m.third_party_rating
        if (r == null) return false
        const ok = RATING_TIERS.some((t) => filter.ratings.includes(t.key) && t.test(r))
        if (!ok) return false
      }
      return true
    })
    const sorted = [...list]
    if (sortBy === 'rating') {
      sorted.sort(
        (a, b) =>
          (b.personal_rating ?? -1) - (a.personal_rating ?? -1) ||
          String(b.read_at ?? '').localeCompare(String(a.read_at ?? '')) ||
          b.created_at.localeCompare(a.created_at),
      )
    } else {
      // 默认：按阅读时间（年/日）倒序，最新阅读在前
      sorted.sort(
        (a, b) =>
          String(b.read_at ?? '').localeCompare(String(a.read_at ?? '')) ||
          b.created_at.localeCompare(a.created_at),
      )
    }
    return sorted
  }, [movies, search, filter, sortBy])

  // 去重键集合（名称 + 年代）：新建 / 批量导入 共用，命中则跳过不重复创建
  const existingKeys = useMemo(
    () => new Set(movies.map((m) => bookKey(m.title, m.year))),
    [movies],
  )

  // 筛选可选值（从当前库派生）
  const filterOptions = useMemo(() => {
    const genres = Array.from(new Set(movies.flatMap((m) => m.genre ?? []))).sort()
    const years = Array.from(new Set(movies.map((m) => String(m.year || '')).filter(Boolean))).sort(
      (a, b) => Number(b) - Number(a),
    )
    return { genres, years }
  }, [movies])

  const activeFilterCount =
    filter.genres.length + filter.years.length + filter.ratings.length

  const persist = useCallback(
    async (book: Book) => {
      await db.books.put(book)
      await enqueueAndMaybeFlush('books', book.created_at === book.updated_at ? 'insert' : 'update', book.id, book)
      await reload()
    },
    [reload],
  )

  const handleSaveBook = (updated: Book) => {
    void (async () => {
      try {
        await persist({ ...updated, updated_at: new Date().toISOString() })
      } catch (e) {
        console.error('[movies] 保存落库失败:', e)
      }
    })()
    // PC 分栏：保存后保持详情栏打开（刷新草稿为最新）；移动端：关闭弹窗
    setSelected(isMobile ? null : updated)
  }

  const handleNewBook = (m: Book) => {
    // 先关弹窗（零阻塞、任何情况下都秒关），再后台落库；落库失败也不影响已关闭的弹窗。
    setShowNew(false)
    void (async () => {
      try {
        await persist(m)
      } catch (e) {
        console.error('[movies] 新建落库失败:', e)
      }
    })()
  }

  const handleSync = async (m: Book): Promise<Book> => {
    const data = await syncBook(m)
    // 若本地缺封面，从 Google Books 拉取并压缩上传到 Storage（失败则留空）
    let cover = m.cover
    if (!cover && data.cover) cover = await uploadBookImage(data.cover, userId).catch(() => '')
    const updated: Book = {
      ...m,
      cover,
      third_party_rating: data.third_party_rating ?? m.third_party_rating,
      genre: m.genre.length ? m.genre : data.genre ?? [],
      year: data.year || m.year,
      author: m.author || data.author || '',
      synced: true,
      cover_failed: !cover,
      updated_at: new Date().toISOString(),
    }
    await persist(updated)
    return updated
  }

  // 批量导入逻辑已内联至 BatchImportModal（逐行 fetch → 压缩上传 Storage → 落 Dexie + outbox，含进度与逐行容错）

  const confirmDelete = async () => {
    if (!del) return
    const id = del.id
    // 本地优先：先即时从 state 移除 + 关弹窗（纯本地，零网络、零整表重渲染），杜绝手机端卡顿
    setBooks((prev) => prev.filter((m) => m.id !== id))
    setSelected(null)
    setDel(null)
    // 落本地 + 后台补传云端（fire-and-forget，绝不阻塞 UI）
    await db.books.delete(id)
    void enqueueAndMaybeFlush('books', 'delete', id)
  }

  const openBook = (m: Book) => {
    const fresh = movies.find((x) => x.id === m.id) ?? m
    setSelected(fresh)
  }

  return (
    <div className="relative w-full">
      {/* 顶部导航：始终透明，无滚动磨砂底色（入口：搜索 / 筛选 / 功能） */}
      <nav className="fixed left-0 right-0 top-0 z-30 bg-transparent border-b border-transparent">
        <div className="flex items-center justify-between gap-2.5 px-[10px] py-4 md:pl-[120px] md:pr-12">
          {/* 左：页面标题（与右侧按钮同 y 左对齐） */}
          <h1 className="flex items-baseline gap-1 text-base font-semibold text-white/90">
            阅读记录
            <span className="text-xs font-normal text-white/40">{visible.length} 部</span>
          </h1>
          {/* 右：功能按钮群 */}
          <div className="flex items-center gap-2.5">
          {/* 搜索 */}
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
          {/* 排序 */}
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'read_at' | 'rating')}
              aria-label="排序方式"
              className="h-9 appearance-none rounded-full bg-white/10 pl-3 pr-7 text-xs text-white/85 backdrop-blur-md transition hover:bg-white/20 focus:outline-none"
            >
              <option value="read_at" className="bg-[#15151c] text-white">阅读时间（新→旧）</option>
              <option value="rating" className="bg-[#15151c] text-white">个人评分（高→低）</option>
            </select>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-white/70">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
          {/* 筛选 */}
          <button
            onClick={() => setShowFilter(true)}
            aria-label="筛选"
            className={`relative grid h-9 w-9 place-items-center rounded-full backdrop-blur-md transition ${
              activeFilterCount ? 'bg-accent/20 text-accent' : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            {activeFilterCount > 0 && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-black">
                {activeFilterCount}
              </span>
            )}
          </button>
          {/* 功能（圆形按钮，点击展开批量导入 / 新建） */}
          <div className="relative" ref={funcRef}>
            <button
              onClick={() => setShowFunc((f) => !f)}
              aria-label="功能"
              aria-haspopup="menu"
              aria-expanded={showFunc}
              className="grid h-9 w-9 place-items-center rounded-full bg-white/10 backdrop-blur-md transition hover:bg-white/20"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                <circle cx="12" cy="5" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="12" cy="19" r="1.6" />
              </svg>
            </button>
            {showFunc && (
              <div className="animate-popover absolute right-0 top-11 z-40 w-40 overflow-hidden rounded-xl border border-white/10 bg-[#15151c]/95 p-1.5 shadow-2xl backdrop-blur-xl">
                <button
                  onClick={() => { setShowFunc(false); setShowBatch(true) }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-white/85 transition hover:bg-white/10"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  批量导入
                </button>
                <button
                  onClick={() => { setShowFunc(false); setShowBatchUpdate(true) }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-white/85 transition hover:bg-white/10"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
                    <path d="M21 2v6h-6" />
                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                    <path d="M3 22v-6h6" />
                    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                  </svg>
                  批量更新
                </button>
                {/* 刷新（从云端拉取并本地对账） */}
                <button
                  onClick={() => { setShowFunc(false); void refreshFromCloud() }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-white/85 transition hover:bg-white/10"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
                    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                    <polyline points="21 3 21 9 15 9" />
                  </svg>
                  刷新（从云端同步）
                </button>
                <button
                  onClick={() => { setShowFunc(false); setShowNew(true) }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-white/85 transition hover:bg-white/10"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  新建
                </button>
              </div>
            )}
          </div>
          </div>
        </div>
        {showSearch && (
          <div className="border-t border-white/10 px-3 py-3 md:pl-[120px] md:pr-12">
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索书籍名称 / 类型"
              className="w-full"
            />
          </div>
        )}
      </nav>

      {syncError && (
        <div className="-mx-[6px] px-0 pt-[62px] md:mx-0 md:pl-[120px] md:pr-12 md:pt-[92px]">
          <div className="mb-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {syncError}
          </div>
        </div>
      )}

      {/* 阅读记录：PC 分栏（左列表压缩 · 右详情 7:3） / 移动端全屏弹窗 */}
      {selected && !isMobile ? (
        <div className="grid grid-cols-[7fr_3fr]">
          <section className="-mx-[6px] px-0 pb-10 pt-[62px] md:mx-0 md:pr-12 md:pb-14 md:pt-[92px]">
            <BookList visible={visible} movies={movies} onOpen={openBook} />
          </section>
          <aside className="animate-slide-in sticky top-[68px] flex h-[calc(100vh-68px)] flex-col border-l border-white/10 bg-black/40 backdrop-blur-xl">
            <button
              onClick={() => setSelected(null)}
              aria-label="关闭"
              className="absolute right-5 top-5 z-20 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20"
            >
              ✕
            </button>
            <div className="flex-1 overflow-y-auto">
              <BookDetailPanel
                book={selected}
                onSave={handleSaveBook}
                onSync={handleSync}
                onDelete={(m) => setDel(m)}
              />
            </div>
          </aside>
        </div>
      ) : (
        <>
          <section className="-mx-[6px] px-0 pt-[62px] pb-10 md:mx-0 md:pr-12 md:pb-14 md:pt-[92px]">
            <BookList visible={visible} movies={movies} onOpen={openBook} />
          </section>
          {selected && (
            <BookModal
              book={selected}
              onClose={() => setSelected(null)}
              onSave={handleSaveBook}
              onSync={handleSync}
              onDelete={(m) => setDel(m)}
            />
          )}
        </>
      )}
      {showNew && (
        <NewBookModal
          userId={userId}
          existingKeys={existingKeys}
          onClose={() => setShowNew(false)}
          onSave={handleNewBook}
        />
      )}
      {showBatch && (
        <BatchImportModal
          userId={userId}
          existingKeys={existingKeys}
          onClose={() => setShowBatch(false)}
          onDone={() => { void reload() }}
        />
      )}
      {showBatchUpdate && (
        <BatchUpdateModal
          movies={movies}
          onClose={() => setShowBatchUpdate(false)}
          onDone={() => { void reload() }}
        />
      )}
      {showFilter && (
        <FilterModal
          open={showFilter}
          init={filter}
          genres={filterOptions.genres}
          years={filterOptions.years}
          onApply={(f) => { setFilter(f); setShowFilter(false) }}
          onClear={() => { setFilter(EMPTY_FILTER); setShowFilter(false) }}
          onClose={() => setShowFilter(false)}
        />
      )}

      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={confirmDelete}
        title="删除阅读记录"
        message={del ? `确定删除「${del.title}」？该操作不可撤销。` : ''}
        confirmText="删除"
        danger
      />
    </div>
  )
}
