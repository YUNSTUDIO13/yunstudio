// 阅读模块 · 图书数据源接入（镜像 tmdb.ts 的 TMDB 框架）
// 数据源优先级：Open Library（主，国内/中文覆盖好、封面全球 CDN、CORS 友好、无需密钥）
//              → Google Books（兜底，英文名/标题搜索，封面走 Google CDN）
//              → mock（最后防线，保证 UI 不崩、可手动补）
// 封面包 Open Library / Google Books 稳定公网直链（无需中转）；手动上传的本地封面走 Supabase Storage（book-covers 桶）。
// 后续若皇上提供专属 API Key / 换源，仅改本文件即可（单一入口）。
import { supabase } from './supabase'
import type { Book } from '../types'

const GB_API = 'https://www.googleapis.com/books/v1/volumes'
const OL_SEARCH = 'https://openlibrary.org/search.json'

// ─── Mock 兜底数据（仅当所有第三方请求失败时，保证 UI 不崩、可手动补） ──
const MOCK_COVERS = [
  'https://images.unsplash.com/photo-1543002588-bfa74002b3dc?w=300&h=450&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=300&h=450&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1532012197267-da84d127e765?w=300&h=450&fit=crop&auto=format',
]
const MOCK_GENRES = ['小说', '文学', '历史', '哲学', '科幻', '悬疑', '传记', '经济']

export interface BookCandidate {
  id: string
  title: string
  year: number
  cover: string
  third_party_rating: number | null
  author: string
}

export interface BookData {
  cover: string
  third_party_rating: number | null
  genre: string[]
  year: number
  cover_failed: boolean
  /** 简介（Open Library work description / Google Books description） */
  overview: string
  /** 作者（多作者「、」拼接） */
  author: string
  /** 同名候选（最多 8 条），供前端在同名歧义时让用户选 */
  candidates: BookCandidate[]
}

/** 取较大尺寸的 Google Books 封面（默认 zoom=1 极小，换成 zoom=3） */
function enlargeCover(url: string): string {
  return url.replace('zoom=1', 'zoom=3').replace('&edge=curl', '')
}

// ─── Google Books 解析 ───────────────────────────────────────────────
function parseVolume(v: Record<string, unknown>): {
  title: string
  year: number
  cover: string
  rating: number | null
  author: string
  categories: string[]
  description: string
} {
  const vi = (v.volumeInfo ?? {}) as Record<string, unknown>
  const publishedDate = typeof vi.publishedDate === 'string' ? vi.publishedDate : ''
  const year = publishedDate ? Number(publishedDate.slice(0, 4)) || 0 : 0
  const imageLinks = (vi.imageLinks ?? {}) as Record<string, unknown>
  const thumb = typeof imageLinks.thumbnail === 'string' ? (imageLinks.thumbnail as string) : ''
  const cover = thumb ? enlargeCover(thumb) : ''
  const authors = Array.isArray(vi.authors) ? (vi.authors as string[]).join('、') : ''
  const categories = Array.isArray(vi.categories) ? (vi.categories as string[]).slice(0, 3) : []
  const description = typeof vi.description === 'string' ? (vi.description as string) : ''
  const rating = typeof vi.averageRating === 'number' ? (vi.averageRating as number) : null
  return { title: typeof vi.title === 'string' ? (vi.title as string) : '', year, cover, rating, author: authors, categories, description }
}

// ─── Open Library 解析 ──────────────────────────────────────────────
function olCoverUrl(coverI: unknown, isbn: string): string {
  if (typeof coverI === 'number' && coverI > 0) {
    return `https://covers.openlibrary.org/b/id/${coverI}-L.jpg`
  }
  if (isbn) return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`
  return ''
}

function parseOLDoc(d: Record<string, unknown>): {
  id: string
  title: string
  year: number
  author: string
  cover: string
  rating: number | null
  genres: string[]
  key: string
} {
  const title = typeof d.title === 'string' ? d.title : ''
  const year = typeof d.first_publish_year === 'number' ? d.first_publish_year : 0
  const author = Array.isArray(d.author_name) ? (d.author_name as string[]).join('、') : ''
  const isbn =
    Array.isArray(d.isbn) && (d.isbn as string[]).length ? (d.isbn as string[])[0] : ''
  const cover = olCoverUrl(d.cover_i, isbn)
  // Open Library 评分是 0–5，统一换算成项目内的 0–10 双评分体系
  const rating =
    typeof d.ratings_average === 'number' ? Math.round(d.ratings_average * 2 * 10) / 10 : null
  const genres = Array.isArray(d.subject) ? (d.subject as string[]).slice(0, 3) : []
  const key = typeof d.key === 'string' ? (d.key as string) : ''
  const id =
    (typeof d.cover_edition_key === 'string' && d.cover_edition_key) || key || title
  return { id, title, year, author, cover, rating, genres, key }
}

/** 拉取 Open Library 作品的简介（works/{key}.json 的 description 可能是字符串或 {value}） */
async function fetchOLWorkOverview(key: string): Promise<string> {
  try {
    const res = await fetch(`https://openlibrary.org${key}.json`)
    if (!res.ok) return ''
    const j = (await res.json()) as { description?: unknown }
    const desc = j.description
    if (typeof desc === 'string') return desc
    if (desc && typeof desc === 'object' && 'value' in desc) {
      return String((desc as { value: unknown }).value ?? '')
    }
    return ''
  } catch {
    return ''
  }
}

// ─── 各源 fetcher（失败返回 null，由上层链式兜底） ────────────────────
async function fetchFromOpenLibrary(title: string): Promise<BookData | null> {
  try {
    const url = `${OL_SEARCH}?title=${encodeURIComponent(title)}&limit=8&fields=title,author_name,first_publish_year,cover_i,cover_edition_key,isbn,key,ratings_average,ratings_count,subject,language`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = (await res.json()) as { docs?: Record<string, unknown>[] }
    const docs = Array.isArray(json.docs) ? json.docs : []
    if (!docs.length) return null
    const parsed = docs.map(parseOLDoc).filter((p) => p.title)
    if (!parsed.length) return null
    const top = parsed[0]
    const overview = top.key ? await fetchOLWorkOverview(top.key) : ''
    const candidates: BookCandidate[] = parsed.slice(0, 8).map((p) => ({
      id: p.id,
      title: p.title,
      year: p.year,
      cover: p.cover,
      third_party_rating: p.rating,
      author: p.author,
    }))
    return {
      cover: top.cover,
      third_party_rating: top.rating,
      genre: top.genres,
      year: top.year,
      cover_failed: !top.cover,
      overview,
      author: top.author,
      candidates,
    }
  } catch {
    return null
  }
}

async function fetchFromGoogleBooks(title: string, year: string): Promise<BookData | null> {
  try {
    const q = encodeURIComponent(`intitle:${title}`)
    const url = `${GB_API}?q=${q}&country=CN&maxResults=8`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = (await res.json()) as { items?: Record<string, unknown>[] }
    const items = json.items ?? []
    if (!items.length) return null
    const parsed = items.map(parseVolume)
    const top = parsed[0] ?? null
    const candidates: BookCandidate[] = parsed.slice(0, 8).map((p, i) => ({
      id: (items[i]?.id as string) ?? String(i),
      title: p.title,
      year: p.year,
      cover: p.cover,
      third_party_rating: p.rating,
      author: p.author,
    }))
    return {
      cover: top?.cover ?? '',
      third_party_rating: top?.rating ?? null,
      genre: top?.categories ?? [],
      year: top?.year || Number(year) || 0,
      cover_failed: !top?.cover,
      overview: top?.description ?? '',
      author: top?.author ?? '',
      candidates,
    }
  } catch {
    return null
  }
}

function mockBookData(year: string): BookData {
  const cover = MOCK_COVERS[Math.floor(Math.random() * MOCK_COVERS.length)]
  return {
    cover,
    third_party_rating: Number((6 + Math.random() * 3).toFixed(1)),
    genre: [MOCK_GENRES[Math.floor(Math.random() * MOCK_GENRES.length)]],
    year: Number(year) || 2000 + Math.floor(Math.random() * 26),
    cover_failed: false,
    overview: '',
    author: '',
    candidates: [],
  }
}

/**
 * 按书名（+ 年代辅助）获取第三方数据。
 * 优先级：Open Library（主，国内/中文覆盖好、CORS 友好、无需密钥）
 *        → Google Books（兜底，英文名/标题搜索）
 *        → mock（最后防线，保证 UI 不崩）。
 */
export async function fetchBookByTitle(title: string, year: string): Promise<BookData> {
  const ol = await fetchFromOpenLibrary(title)
  if (ol) return ol
  const gb = await fetchFromGoogleBooks(title, year)
  if (gb) return gb
  return mockBookData(year)
}

/** 对已有书籍重新拉取第三方数据（用于「同步数据」/「手动获取封面」） */
export async function syncBook(book: Book): Promise<BookData> {
  return fetchBookByTitle(book.title, String(book.year))
}

// ─── 图片压缩 + 上传 Storage（手动上传的本地封面用） ──────────────────────
async function blobToWebp(blob: Blob, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return blob
  ctx.drawImage(bitmap, 0, 0)
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))),
      'image/webp',
      quality,
    )
  })
}

/** 通用：传入 blob，压缩为 webp（若 webp 反而更大则保留原图） */
async function compressToWebpIfSmaller(blob: Blob, quality = 0.82): Promise<Blob> {
  try {
    const webp = await blobToWebp(blob, quality)
    return webp.size < blob.size * 1.05 ? webp : blob
  } catch {
    return blob
  }
}

/**
 * 用户手动上传本地图片 → 压缩为 WebP → 上传 Storage book-covers/{userId}/{uuid}.webp
 * 返回 Storage 公网 URL。
 */
export async function uploadBookCover(file: File, userId: string): Promise<string> {
  const blob = await compressToWebpIfSmaller(file, 0.82)
  const path = `${userId}/${crypto.randomUUID()}.webp`
  const { error } = await supabase.storage
    .from('book-covers')
    .upload(path, blob, { upsert: false, contentType: 'image/webp' })
  if (error) throw error
  const { data } = supabase.storage.from('book-covers').getPublicUrl(path)
  return data.publicUrl
}

/**
 * 公网封面 URL（Open Library / Google Books 直链）直接采用，不做中转：
 * 两者缩略图直链稳定且带 CORS，浏览器可直接加载（CachedImage 已做应用级缓存），
 * 重传到 Storage 反而可能因跨域污染 canvas 而失败。后续若需自托管可在此 fetch→重传。
 */
export async function uploadBookImage(url: string, _userId: string): Promise<string> {
  return url
}
