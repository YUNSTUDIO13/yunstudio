/**
 * 观影模块 · 胶片票据风格榜单卡片（4 款）
 * ============================================================================
 * 视觉来源：桌面设计稿 `C:\Users\hp\Desktop\工作台迭代\src\App.tsx`
 *   —— 常量（BG/CARD/STRIP/GOLD/CREAM/DIM/SEP）、Perf 胶卷穿孔、ScallopRow/Col
 *      票据波浪边、Grain 胶片颗粒、GoldBar 金条、以及四张卡的全部 JSX 结构与
 *      字号/间距/滤镜/渐变，均 1:1 原样复刻，未做任何风格改动。
 *
 * 唯一改动：写死的 FILMS 示例数组 → 真实观影库「个人评分（personal_rating）最高」排序。
 *   · 2×2 C位单片        取 Top 1
 *   · 2×4 年度三甲        取 Top 3
 *   · 4×2 TOP5 横版胶卷   取 Top 5
 *   · 4×4 年度全榜典藏版  取 Top 5（左 C 位 + 右 2×2 副榜）
 *
 * 适配：设计稿是固定像素稿（300×300 / 300×600 / 620×300 / 620×620），
 *   首页是 aspect-ratio 流式网格。故用 FilmFrame 以 transform: scale() 等比缩放，
 *   保证任意容器宽度下都是「像素级同款」，而不是重排版式。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { db } from '../lib/localDb'
import { CachedImage } from '../components/CachedImage'
import { useAuth } from '../context/AuthContext'
import type { Movie } from '../types'

// ─── 设计稿配色常量（原样复刻） ──────────────────────────────────────────────
const BG = '#0d0905'
const CARD = '#1b1208'
const STRIP = '#221508'
const GOLD = '#d4a247'
const CREAM = '#f2e8d0'
const DIM = '#7a6850'
const SEP = 'rgba(212,162,71,0.18)'

/** 卡面顶部年份（设计稿写死 2023 → 改为当前年度，语义即"年度榜"） */
const YEAR = new Date().getFullYear()

// ============================================================================
// 数据层：按个人评分取 Top N
// ============================================================================

/** 卡面所需的展示字段（由 Movie 适配而来，字段名对齐设计稿的 Film 结构） */
interface FilmView {
  rank: number
  title: string // 片名（Oswald 大字）
  sub: string // 次级行：地区 · 年份
  credit: string // 主演行（设计稿为 DIR.，本库无导演字段，用主演）
  genre: string // 类型（大写）
  dur: string // 时长
  rating: string // 个人评分（一位小数）
  poster: string // 封面（cover 优先，回退 backdrop）
  year: number
}

function toFilmView(m: Movie, i: number): FilmView {
  const region = (m.region ?? '').trim()
  const cast = Array.isArray(m.cast) ? m.cast.filter(Boolean) : []
  const genres = Array.isArray(m.genre) ? m.genre.filter(Boolean) : []
  return {
    rank: i + 1,
    title: m.title || '未命名',
    sub: [region, m.year ? String(m.year) : ''].filter(Boolean).join(' · '),
    credit: cast.slice(0, 2).join(' / '),
    genre: genres.join(' · ').toUpperCase() || '—',
    dur: m.duration ? `${m.duration} MIN` : '—',
    rating: typeof m.personal_rating === 'number' ? m.personal_rating.toFixed(1) : '—',
    poster: m.cover || m.backdrop || '',
    year: m.year,
  }
}

/**
 * 读取当前用户「个人评分最高」的前 N 部影片。
 * 数据源与观影页一致：本地优先（Dexie `movies` 表，user_id 索引）。
 * 排序：personal_rating 降序 → 观影日期降序 → 创建时间降序（保证同分稳定）。
 * 仅纳入已打个人评分的影片（personal_rating 为 null 的不参与榜单）。
 */
function useTopRatedFilms(limit: number): { films: FilmView[]; loading: boolean } {
  const { user } = useAuth()
  const userId = user?.id ?? 'anonymous'
  const [films, setFilms] = useState<FilmView[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!user) {
        if (!cancelled) {
          setFilms([])
          setLoading(false)
        }
        return
      }
      try {
        const rows = await db.movies.where('user_id').equals(userId).toArray()
        const ranked = rows
          .filter((m) => typeof m.personal_rating === 'number')
          .sort(
            (a, b) =>
              (b.personal_rating as number) - (a.personal_rating as number) ||
              String(b.watched_at ?? '').localeCompare(String(a.watched_at ?? '')) ||
              String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
          )
          .slice(0, limit)
          .map(toFilmView)
        if (!cancelled) {
          setFilms(ranked)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    // 从观影页改完评分再切回主页时刷新
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [user, userId, limit])

  return { films, loading }
}

// ============================================================================
// 设计稿原子组件（原样复刻）
// ============================================================================

// ─── Film sprocket perforation strip ───────────────────────────────────────
function Perf({ length, horizontal }: { length: number; horizontal: boolean }) {
  const hW = 8,
    hH = 12,
    pitch = 22
  const gap = pitch - (horizontal ? hW : hH)
  const count = Math.max(2, Math.floor(length / pitch) - 1)
  if (horizontal) {
    return (
      <div
        style={{
          width: length,
          height: 22,
          background: STRIP,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap,
        }}
      >
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            style={{ width: hW, height: hH, background: BG, borderRadius: 2, flexShrink: 0 }}
          />
        ))}
      </div>
    )
  }
  return (
    <div
      style={{
        height: length,
        width: 22,
        background: STRIP,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{ height: hH, width: hW, background: BG, borderRadius: 2, flexShrink: 0 }}
        />
      ))}
    </div>
  )
}

// ─── Scalloped ticket edge — horizontal (top / bottom) ─────────────────────
function ScallopRow({ length, atTop }: { length: number; atTop: boolean }) {
  const r = 9,
    pitch = 26
  const gap = pitch - r * 2
  const count = Math.max(2, Math.floor(length / pitch) - 1)
  return (
    <div
      style={{
        position: 'absolute',
        [atTop ? 'top' : 'bottom']: -r,
        left: 0,
        width: length,
        height: r * 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap,
        zIndex: 20,
        pointerEvents: 'none',
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{ width: r * 2, height: r * 2, borderRadius: '50%', background: BG, flexShrink: 0 }}
        />
      ))}
    </div>
  )
}

// ─── Scalloped ticket edge — vertical (left / right) ───────────────────────
function ScallopCol({ length, atLeft }: { length: number; atLeft: boolean }) {
  const r = 9,
    pitch = 26
  const gap = pitch - r * 2
  const count = Math.max(2, Math.floor(length / pitch) - 1)
  return (
    <div
      style={{
        position: 'absolute',
        [atLeft ? 'left' : 'right']: -r,
        top: 0,
        height: length,
        width: r * 2,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap,
        zIndex: 20,
        pointerEvents: 'none',
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{ width: r * 2, height: r * 2, borderRadius: '50%', background: BG, flexShrink: 0 }}
        />
      ))}
    </div>
  )
}

// ─── Film grain overlay ─────────────────────────────────────────────────────
function Grain() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 18,
        pointerEvents: 'none',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`,
        backgroundSize: '200px 200px',
        opacity: 0.055,
        mixBlendMode: 'screen',
      }}
    />
  )
}

// ─── Thin gold label strip ──────────────────────────────────────────────────
function GoldBar({ text }: { text: string }) {
  return (
    <div
      style={{
        background: GOLD,
        color: BG,
        padding: '3px 0',
        fontFamily: "'Special Elite', monospace",
        fontSize: 8,
        letterSpacing: 2.5,
        textAlign: 'center',
        fontWeight: 700,
      }}
    >
      {text}
    </div>
  )
}

// ============================================================================
// 适配层：像素稿 → 流式网格
// ============================================================================

/**
 * 把固定像素设计稿等比缩放进流式网格单元格。
 * 网格单元的 aspect-ratio 与设计稿宽高比一致（见 registry.SIZE_CLASS），
 * 因此按宽度算出的 scale 会让高度也刚好吻合，不裁切、不变形。
 */
function FilmFrame({ dw, dh, children }: { dw: number; dh: number; children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      if (w > 0) setScale(w / dw)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [dw])

  return (
    <div ref={hostRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        style={{
          width: dw,
          height: dh,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          visibility: scale > 0 ? 'visible' : 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  )
}

/** 封面图：缺图 / 加载失败时回退成胶片底纹占位，避免出现白块 */
function Poster({
  src,
  alt,
  style,
}: {
  src: string
  alt: string
  style?: React.CSSProperties
}) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: `linear-gradient(135deg, ${STRIP} 0%, ${CARD} 100%)`,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <span
          style={{
            fontFamily: "'Special Elite', monospace",
            fontSize: 8,
            letterSpacing: 2,
            color: `${DIM}80`,
          }}
        >
          NO IMAGE
        </span>
      </div>
    )
  }
  return (
    <CachedImage
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', ...style }}
    />
  )
}

/** 空榜占位：尚无打分影片时，保持胶片卡壳体，卡内提示 */
function EmptyReel({ label }: { label: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 19,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        background: CARD,
      }}
    >
      <div
        style={{
          fontFamily: "'Oswald', sans-serif",
          fontSize: 13,
          letterSpacing: 4,
          color: `${GOLD}90`,
        }}
      >
        NO RATED FILMS
      </div>
      <div
        style={{
          fontFamily: "'Special Elite', monospace",
          fontSize: 9,
          letterSpacing: 1.5,
          color: DIM,
        }}
      >
        {label}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CARD 1 — 2×2   C位单片   (300 × 300)   · 个人评分最高 Top 1
// ═══════════════════════════════════════════════════════════════════════════
export function MovieHeroCard() {
  const W = 300,
    H = 300
  const { films } = useTopRatedFilms(1)
  const f = films[0]

  return (
    <FilmFrame dw={W} dh={H}>
      <div style={{ position: 'relative' }}>
        <ScallopRow length={W} atTop />
        <div
          style={{
            width: W,
            height: H,
            background: CARD,
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            flexDirection: 'row',
            boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
            border: `1px solid ${SEP}`,
          }}
        >
          <Grain />
          <Perf length={H} horizontal={false} />

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <GoldBar text={`${YEAR} ANNUAL TOP FILMS — CRITICS' CHOICE`} />

            {/* Poster */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              {f && (
                <>
                  <Poster
                    src={f.poster}
                    alt={f.title}
                    style={{ filter: 'sepia(20%) contrast(1.1)' }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background:
                        'linear-gradient(to top, #0d0905 0%, rgba(13,9,5,0.25) 48%, transparent 100%)',
                    }}
                  />
                  {/* Rank */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 8,
                      left: 8,
                      fontFamily: "'Oswald', sans-serif",
                      fontSize: 58,
                      fontWeight: 700,
                      color: GOLD,
                      lineHeight: 1,
                      letterSpacing: -3,
                      textShadow: '0 2px 14px rgba(0,0,0,0.9)',
                    }}
                  >
                    №1
                  </div>
                  {/* Title block */}
                  <div
                    style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0 10px 9px' }}
                  >
                    <div
                      style={{
                        fontFamily: "'Oswald', sans-serif",
                        fontSize: 17,
                        fontWeight: 700,
                        color: CREAM,
                        letterSpacing: 1.5,
                        lineHeight: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {f.title}
                    </div>
                    <div
                      style={{
                        fontFamily: "'Special Elite', monospace",
                        fontSize: 9,
                        color: DIM,
                        letterSpacing: 1,
                        marginTop: 4,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {[f.sub, f.credit].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </>
              )}
              {!f && <EmptyReel label="去观影模块给影片打个分" />}
            </div>

            {/* Bottom meta */}
            <div
              style={{
                background: '#0f0b06',
                padding: '5px 10px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderTop: `1px solid ${SEP}`,
              }}
            >
              <span
                style={{
                  fontFamily: "'Special Elite', monospace",
                  fontSize: 8,
                  color: DIM,
                  letterSpacing: 1.5,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {f ? `${f.genre} · ${f.dur}` : 'FILM ARCHIVE · 35MM'}
              </span>
              <span
                style={{
                  fontFamily: "'Oswald', sans-serif",
                  fontSize: 16,
                  fontWeight: 700,
                  color: GOLD,
                  flexShrink: 0,
                  marginLeft: 8,
                }}
              >
                ★ {f ? f.rating : '—'}
              </span>
            </div>
          </div>

          <Perf length={H} horizontal={false} />
        </div>
        <ScallopRow length={W} atTop={false} />
      </div>
    </FilmFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CARD 2 — 2×4   年度三甲   (300 × 600)   · 个人评分最高 Top 3
// ═══════════════════════════════════════════════════════════════════════════
export function MovieTop3Card() {
  const W = 300,
    H = 600
  const { films } = useTopRatedFilms(3)

  return (
    <FilmFrame dw={W} dh={H}>
      <div style={{ position: 'relative' }}>
        <ScallopRow length={W} atTop />
        <div
          style={{
            width: W,
            height: H,
            background: CARD,
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
            border: `1px solid ${SEP}`,
          }}
        >
          <Grain />
          <Perf length={W} horizontal />

          {/* Header */}
          <div
            style={{
              padding: '14px 14px 11px',
              textAlign: 'center',
              borderBottom: `1px solid ${SEP}`,
              background: 'rgba(0,0,0,0.2)',
            }}
          >
            <div
              style={{
                fontFamily: "'Oswald', sans-serif",
                color: GOLD,
                fontSize: 10,
                letterSpacing: 6,
                marginBottom: 6,
              }}
            >
              ANNUAL BEST FILMS
            </div>
            <div
              style={{
                fontFamily: "'Oswald', sans-serif",
                color: CREAM,
                fontSize: 34,
                fontWeight: 700,
                lineHeight: 1,
                letterSpacing: 2,
              }}
            >
              {YEAR}
            </div>
            <div
              style={{
                fontFamily: "'Special Elite', monospace",
                color: DIM,
                fontSize: 9,
                letterSpacing: 2.5,
                marginTop: 5,
              }}
            >
              · YEAR IN REVIEW · TOP 3 ·
            </div>
          </div>

          {/* Film rows */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
            {films.length === 0 && <EmptyReel label="去观影模块给影片打个分" />}
            {films.map((f, i) => (
              <div
                key={f.rank}
                style={{
                  flex: 1,
                  display: 'flex',
                  gap: 10,
                  padding: '8px 14px',
                  borderBottom: i < films.length - 1 ? `1px solid ${SEP}` : 'none',
                  alignItems: 'center',
                  position: 'relative',
                }}
              >
                {/* Gold accent bar for #1 */}
                {i === 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: '12%',
                      bottom: '12%',
                      width: 2,
                      background: GOLD,
                      borderRadius: 1,
                    }}
                  />
                )}

                {/* Rank number */}
                <div
                  style={{
                    fontFamily: "'Oswald', sans-serif",
                    fontSize: i === 0 ? 46 : 30,
                    fontWeight: 700,
                    color: i === 0 ? GOLD : `${CREAM}28`,
                    lineHeight: 1,
                    width: 38,
                    flexShrink: 0,
                    textAlign: 'center',
                    letterSpacing: -2,
                  }}
                >
                  {f.rank}
                </div>

                {/* Poster thumbnail */}
                <div
                  style={{
                    width: 54,
                    height: 78,
                    flexShrink: 0,
                    overflow: 'hidden',
                    borderRadius: 2,
                    boxShadow: '0 2px 10px rgba(0,0,0,0.6)',
                    border: i === 0 ? `1.5px solid ${GOLD}` : `1px solid ${SEP}`,
                  }}
                >
                  <Poster src={f.poster} alt={f.title} />
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "'Oswald', sans-serif",
                      fontSize: 13,
                      fontWeight: 700,
                      color: CREAM,
                      letterSpacing: 0.5,
                      lineHeight: 1.2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {f.title}
                  </div>
                  <div
                    style={{
                      fontFamily: "'Special Elite', monospace",
                      fontSize: 9,
                      color: DIM,
                      marginTop: 2,
                      letterSpacing: 0.5,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {f.sub}
                  </div>
                  <div
                    style={{
                      fontFamily: "'Special Elite', monospace",
                      fontSize: 8,
                      color: `${DIM}99`,
                      marginTop: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {f.credit ? `CAST. ${f.credit}` : f.genre}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 5, alignItems: 'center' }}>
                    <span
                      style={{
                        fontFamily: "'Oswald', sans-serif",
                        fontSize: 13,
                        fontWeight: 700,
                        color: GOLD,
                      }}
                    >
                      ★ {f.rating}
                    </span>
                    <span
                      style={{ fontFamily: "'Special Elite', monospace", fontSize: 8, color: DIM }}
                    >
                      {f.dur}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div
            style={{
              background: '#0f0b06',
              padding: '5px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              fontFamily: "'Special Elite', monospace",
              fontSize: 8,
              color: `${DIM}70`,
              letterSpacing: 1.5,
              borderTop: `1px solid ${SEP}`,
            }}
          >
            <span>NO. 001–003</span>
            <span>35MM · ARCHIVES</span>
          </div>

          <Perf length={W} horizontal />
        </div>
        <ScallopRow length={W} atTop={false} />
      </div>
    </FilmFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CARD 3 — 4×2   TOP 5 横版胶卷   (620 × 300)   · 个人评分最高 Top 5
// ═══════════════════════════════════════════════════════════════════════════
export function MovieTop5StripCard() {
  const W = 620,
    H = 300
  const { films } = useTopRatedFilms(5)

  return (
    <FilmFrame dw={W} dh={H}>
      <div style={{ position: 'relative' }}>
        <ScallopCol length={H} atLeft />
        <div
          style={{
            width: W,
            height: H,
            background: CARD,
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
            border: `1px solid ${SEP}`,
          }}
        >
          <Grain />
          <Perf length={W} horizontal />

          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '7px 14px 6px',
              borderBottom: `1px solid ${SEP}`,
              flexShrink: 0,
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: "'Oswald', sans-serif",
                  color: GOLD,
                  fontSize: 9,
                  letterSpacing: 5,
                }}
              >
                ANNUAL TOP FILMS
              </div>
              <div
                style={{
                  fontFamily: "'Oswald', sans-serif",
                  color: CREAM,
                  fontSize: 24,
                  fontWeight: 700,
                  lineHeight: 1,
                  letterSpacing: 2,
                }}
              >
                {YEAR}
              </div>
            </div>
            {/* Center decorative sprocket marks */}
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              {Array.from({ length: 7 }).map((_, i) => (
                <div
                  key={i}
                  style={{ width: 5, height: 7, background: `${GOLD}40`, borderRadius: 1 }}
                />
              ))}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div
                style={{
                  fontFamily: "'Special Elite', monospace",
                  color: DIM,
                  fontSize: 8.5,
                  letterSpacing: 1.5,
                }}
              >
                CRITICS' TOP FIVE
              </div>
              <div
                style={{
                  fontFamily: "'Special Elite', monospace",
                  color: `${DIM}70`,
                  fontSize: 7.5,
                  letterSpacing: 1,
                  marginTop: 2,
                }}
              >
                35MM FILM ARCHIVES
              </div>
            </div>
          </div>

          {/* Five-panel film strip */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
            {films.length === 0 && <EmptyReel label="去观影模块给影片打个分" />}
            {films.map((f, i) => (
              <div
                key={f.rank}
                style={{
                  flex: i === 0 ? 1.35 : 1,
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'relative',
                  borderRight: i < films.length - 1 ? `1px solid ${SEP}` : 'none',
                  overflow: 'hidden',
                }}
              >
                {/* Poster */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                  <Poster
                    src={f.poster}
                    alt={f.title}
                    style={{
                      filter:
                        i === 0
                          ? 'contrast(1.08) sepia(12%)'
                          : 'contrast(1.0) saturate(0.75) sepia(18%)',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background:
                        i === 0
                          ? 'linear-gradient(to top, rgba(13,9,5,0.88) 0%, transparent 52%)'
                          : 'linear-gradient(to top, rgba(13,9,5,0.96) 0%, rgba(13,9,5,0.15) 55%)',
                    }}
                  />
                  {/* Rank badge */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 6,
                      left: 7,
                      fontFamily: "'Oswald', sans-serif",
                      fontSize: i === 0 ? 32 : 22,
                      fontWeight: 700,
                      color: i === 0 ? GOLD : `${CREAM}55`,
                      lineHeight: 1,
                      textShadow: '0 1px 8px rgba(0,0,0,0.95)',
                    }}
                  >
                    {f.rank}
                  </div>
                </div>

                {/* Title strip */}
                <div style={{ padding: '5px 7px 5px', background: '#120e08', flexShrink: 0 }}>
                  <div
                    style={{
                      fontFamily: "'Oswald', sans-serif",
                      fontSize: i === 0 ? 10.5 : 9.5,
                      fontWeight: 700,
                      color: i === 0 ? CREAM : `${CREAM}90`,
                      letterSpacing: 0.3,
                      lineHeight: 1.25,
                      height: '2.5em',
                      overflow: 'hidden',
                    }}
                  >
                    {f.title}
                  </div>
                  <div
                    style={{
                      fontFamily: "'Oswald', sans-serif",
                      fontSize: 11,
                      fontWeight: 700,
                      color: GOLD,
                      marginTop: 3,
                    }}
                  >
                    ★ {f.rating}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Perf length={W} horizontal />
        </div>
        <ScallopCol length={H} atLeft={false} />
      </div>
    </FilmFrame>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CARD 4 — 4×4   年度全榜典藏版   (620 × 620)   · 个人评分最高 Top 5
// ═══════════════════════════════════════════════════════════════════════════
export function MovieCollectionCard() {
  const W = 620,
    H = 620
  const { films } = useTopRatedFilms(5)
  const hero = films[0]
  const rest = films.slice(1)
  const innerW = W - 44
  const innerH = H - 44

  return (
    <FilmFrame dw={W} dh={H}>
      <div style={{ position: 'relative' }}>
        <ScallopRow length={W} atTop />
        <div
          style={{
            width: W,
            height: H,
            background: CARD,
            overflow: 'hidden',
            position: 'relative',
            boxShadow: '0 12px 50px rgba(0,0,0,0.8)',
            border: `1px solid ${SEP}`,
          }}
        >
          <Grain />

          {/* Film border grid: perfs on all 4 sides */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '22px 1fr 22px',
              gridTemplateRows: '22px 1fr 22px',
              width: '100%',
              height: '100%',
            }}
          >
            {/* Corners */}
            <div style={{ background: STRIP }} />
            <Perf length={innerW} horizontal />
            <div style={{ background: STRIP }} />

            <Perf length={innerH} horizontal={false} />

            {/* ── Main content ──────────────────────────────────── */}
            <div
              style={{
                overflow: 'hidden',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* Title bar */}
              <div
                style={{
                  background: 'rgba(0,0,0,0.3)',
                  padding: '8px 13px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: `1px solid ${SEP}`,
                  flexShrink: 0,
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: "'Oswald', sans-serif",
                      color: GOLD,
                      fontSize: 9,
                      letterSpacing: 6,
                    }}
                  >
                    ANNUAL TOP FILMS
                  </div>
                  <div
                    style={{
                      fontFamily: "'Oswald', sans-serif",
                      color: CREAM,
                      fontSize: 22,
                      fontWeight: 700,
                      lineHeight: 1,
                      letterSpacing: 3,
                    }}
                  >
                    {YEAR}
                  </div>
                </div>
                {/* Decorative sprockets */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {[0, 1].map((r) => (
                    <div key={r} style={{ display: 'flex', gap: 4 }}>
                      {Array.from({ length: 9 }).map((_, i) => (
                        <div
                          key={i}
                          style={{ width: 5, height: 4, background: `${GOLD}30`, borderRadius: 1 }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    textAlign: 'right',
                    fontFamily: "'Special Elite', monospace",
                    color: DIM,
                    fontSize: 8,
                    letterSpacing: 2,
                    lineHeight: 1.8,
                  }}
                >
                  CRITICS' CHOICE
                  <br />
                  COLLECTORS' EDITION
                  <br />
                  35MM · ARCHIVES
                </div>
              </div>

              {/* Hero + grid */}
              <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
                {films.length === 0 && <EmptyReel label="去观影模块给影片打个分" />}

                {/* ── Hero C-position (left) ──────────── */}
                <div
                  style={{
                    width: 220,
                    flexShrink: 0,
                    position: 'relative',
                    overflow: 'hidden',
                    borderRight: `1px solid ${SEP}`,
                  }}
                >
                  {hero && (
                    <>
                      <Poster
                        src={hero.poster}
                        alt={hero.title}
                        style={{ filter: 'sepia(15%) contrast(1.12)' }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background:
                            'linear-gradient(to top, #0d0905 0%, rgba(13,9,5,0.55) 38%, transparent 70%)',
                        }}
                      />
                      {/* C位 tag */}
                      <div
                        style={{
                          position: 'absolute',
                          top: 10,
                          left: 10,
                          background: GOLD,
                          color: BG,
                          padding: '2px 9px',
                          fontFamily: "'Special Elite', monospace",
                          fontSize: 9,
                          letterSpacing: 2.5,
                          fontWeight: 700,
                        }}
                      >
                        C 位
                      </div>
                      {/* Giant rank */}
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 90,
                          left: 10,
                          fontFamily: "'Oswald', sans-serif",
                          fontSize: 78,
                          fontWeight: 700,
                          color: GOLD,
                          lineHeight: 0.85,
                          letterSpacing: -4,
                          textShadow: '0 3px 20px rgba(0,0,0,0.95)',
                        }}
                      >
                        №
                        <br />1
                      </div>
                      {/* Info */}
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 10,
                          left: 10,
                          right: 10,
                        }}
                      >
                        <div
                          style={{
                            fontFamily: "'Oswald', sans-serif",
                            fontSize: 17,
                            fontWeight: 700,
                            color: CREAM,
                            letterSpacing: 1.5,
                            lineHeight: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {hero.title}
                        </div>
                        <div
                          style={{
                            fontFamily: "'Special Elite', monospace",
                            fontSize: 9,
                            color: DIM,
                            marginTop: 3,
                            letterSpacing: 0.5,
                          }}
                        >
                          {hero.sub}
                        </div>
                        <div
                          style={{
                            fontFamily: "'Special Elite', monospace",
                            fontSize: 8,
                            color: `${DIM}aa`,
                            marginTop: 2,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {hero.credit ? `CAST. ${hero.credit}` : hero.genre}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            marginTop: 7,
                          }}
                        >
                          <span
                            style={{
                              fontFamily: "'Oswald', sans-serif",
                              fontSize: 16,
                              fontWeight: 700,
                              color: GOLD,
                            }}
                          >
                            ★ {hero.rating}
                          </span>
                          <span
                            style={{
                              fontFamily: "'Special Elite', monospace",
                              fontSize: 8,
                              color: DIM,
                            }}
                          >
                            {hero.dur}
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* ── #2–5 grid (right) ───────────────── */}
                <div
                  style={{
                    flex: 1,
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gridTemplateRows: '1fr 1fr',
                    overflow: 'hidden',
                  }}
                >
                  {rest.map((f, i) => (
                    <div
                      key={f.rank}
                      style={{
                        position: 'relative',
                        overflow: 'hidden',
                        borderRight: i % 2 === 0 ? `1px solid ${SEP}` : 'none',
                        borderBottom: i < 2 ? `1px solid ${SEP}` : 'none',
                      }}
                    >
                      <Poster
                        src={f.poster}
                        alt={f.title}
                        style={{ filter: 'saturate(0.7) sepia(22%)' }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background:
                            'linear-gradient(to top, rgba(13,9,5,0.94) 0%, rgba(13,9,5,0.1) 55%)',
                        }}
                      />
                      {/* Rank */}
                      <div
                        style={{
                          position: 'absolute',
                          top: 7,
                          left: 7,
                          fontFamily: "'Oswald', sans-serif",
                          fontSize: 22,
                          fontWeight: 700,
                          color: `${CREAM}50`,
                          lineHeight: 1,
                          textShadow: '0 1px 6px rgba(0,0,0,0.9)',
                        }}
                      >
                        {f.rank}
                      </div>
                      {/* Info */}
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          padding: '0 9px 8px',
                        }}
                      >
                        <div
                          style={{
                            fontFamily: "'Oswald', sans-serif",
                            fontSize: 11,
                            fontWeight: 700,
                            color: CREAM,
                            lineHeight: 1.25,
                            height: '2.5em',
                            overflow: 'hidden',
                          }}
                        >
                          {f.title}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginTop: 3,
                          }}
                        >
                          <span
                            style={{
                              fontFamily: "'Special Elite', monospace",
                              fontSize: 8,
                              color: DIM,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {f.sub}
                          </span>
                          <span
                            style={{
                              fontFamily: "'Oswald', sans-serif",
                              fontSize: 11,
                              fontWeight: 700,
                              color: GOLD,
                              flexShrink: 0,
                              marginLeft: 6,
                            }}
                          >
                            ★ {f.rating}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bottom bar */}
              <div
                style={{
                  background: '#0f0b06',
                  padding: '5px 13px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontFamily: "'Special Elite', monospace",
                  fontSize: 8,
                  color: `${DIM}70`,
                  letterSpacing: 1.5,
                  borderTop: `1px solid ${SEP}`,
                  flexShrink: 0,
                }}
              >
                <span>NO. 001–005 · COLLECTORS' EDITION</span>
                <span>◆</span>
                <span>35MM · EST. 1895</span>
              </div>
            </div>
            {/* ── end main content ─────────────────────────────── */}

            <Perf length={innerH} horizontal={false} />

            {/* Bottom corners + perf */}
            <div style={{ background: STRIP }} />
            <Perf length={innerW} horizontal />
            <div style={{ background: STRIP }} />
          </div>
        </div>
        <ScallopRow length={W} atTop={false} />
      </div>
    </FilmFrame>
  )
}
