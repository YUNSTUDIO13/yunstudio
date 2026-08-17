// 阅读模块 · Google Books 接入（镜像 tmdb.ts 的 TMDB 框架）
// 数据获取走 Google Books 公开 API（volumes，无需 Key 即可搜索，带 CORS），封面包 Google Books
// 稳定公网缩略图直链（无需中转）；手动上传的本地封面走 Supabase Storage（book-covers 桶）。
// 后续若皇上提供专属 API Key / 换源，仅改本文件即可（单一入口）。
import { supabase } from './supabase'
import type { Book } from '../types'

const GB_API = 'https://www.googleapis.com/books/v1/volumes'

// ─── Mock 兜底数据（仅当 Google Books 请求失败时，保证 UI 不崩、可手动补） ──
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
  /** 简介（Google Books description） */
  overview: string
  /** 作者（Google Books authors 用「、」拼接） */
  author: string
  /** 同名候选（最多 8 条），供前端在同名歧义时让用户选 */
  candidates: BookCandidate[]
}

/** 取较大尺寸的 Google Books 封面（默认 zoom=1 极小，换成 zoom=3） */
function enlargeCover(url: string): string {
  return url.replace('zoom=1', 'zoom=3').replace('&edge=curl', '')
}

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

/**
 * 按书名（+ 年代辅助）获取第三方数据。
 * 优先走 Google Books 公开 API；失败（网络/CORS/限流）时回退 mock，保证 UI 不崩。
 */
export async function fetchBookByTitle(title: string, year: string): Promise<BookData> {
  try {
    const q = encodeURIComponent(`intitle:${title}`)
    const url = `${GB_API}?q=${q}&country=CN&maxResults=8`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Google Books request failed: ${res.status}`)
    const json = (await res.json()) as { items?: Record<string, unknown>[] }
    const items = json.items ?? []
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
  } catch (e) {
    console.warn('[books] fetch failed, fallback mock:', e)
    await new Promise((r) => setTimeout(r, 400))
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
 * 公网封面 URL（如 Google Books 直链）直接采用，不做中转：
 * Google Books 缩略图直链稳定且带 CORS，浏览器可直接加载（CachedImage 已做应用级缓存），
 * 重传到 Storage 反而可能因跨域污染 canvas 而失败。后续若需自托管可在此 fetch→重传。
 */
export async function uploadBookImage(url: string, _userId: string): Promise<string> {
  return url
}
