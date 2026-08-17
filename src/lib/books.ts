// 阅读模块 · 图书数据源接入（镜像 tmdb.ts 的 TMDB 框架）
// 主数据源：豆瓣（经 Supabase Edge Function 代理 book-search，解决 CORS；书名/作者/封面/评分中文覆盖最佳）
// 兜底：mock（当 Edge Function 未部署 / 网络异常时，保证 UI 不崩、可手动补元数据）
// 封面包豆瓣 doubanio.com 公网直链（前端直拉，CachedImage 已做应用级缓存）
// 后续若换源，仅改本文件即可（单一入口）。
import { supabase } from './supabase'
import type { Book } from '../types'

export interface BookCandidate {
  id: string
  title: string
  year: number
  cover: string
  author: string
}

export interface BookData {
  cover: string
  genre: string[]
  year: number
  cover_failed: boolean
  /** 简介（豆瓣详情接口 intro 字段；多数书有，部分为空待手动补） */
  overview: string
  /** 作者（多作者「、」拼接） */
  author: string
  /** 同名候选（最多 8 条），供前端在同名歧义时让用户选 */
  candidates: BookCandidate[]
}

const MOCK_COVERS = [
  'https://images.unsplash.com/photo-1543002588-bfa74002b3dc?w=300&h=450&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=300&h=450&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1532012197267-da84d127e765?w=300&h=450&fit=crop&auto=format',
]
const MOCK_GENRES = ['小说', '文学', '历史', '哲学', '科幻', '悬疑', '传记', '经济']

function mockBookData(year: string): BookData {
  const cover = MOCK_COVERS[Math.floor(Math.random() * MOCK_COVERS.length)]
  return {
    cover,
    genre: [MOCK_GENRES[Math.floor(Math.random() * MOCK_GENRES.length)]],
    year: Number(year) || 2000 + Math.floor(Math.random() * 26),
    cover_failed: false,
    overview: '',
    author: '',
    candidates: [],
  }
}

/**
 * 按书名获取第三方数据。
 * 主源：豆瓣（经 Edge Function book-search 代理，CORS 已解决，中文覆盖最佳）；
 * 兜底：mock（Edge Function 未部署 / 异常时，保证 UI 不崩、可手动补元数据）。
 * 实测：Open Library 对中文书名检索基本为空且不稳，Google Books 本项目配额=0 不可用，故双双弃用。
 */
export async function fetchBookByTitle(title: string, year: string): Promise<BookData> {
  try {
    const { data, error } = await supabase.functions.invoke('book-search', {
      body: { title },
    })
    if (!error && data && data.found) {
      const candidates: BookCandidate[] = Array.isArray(data.candidates)
        ? (data.candidates as BookCandidate[]).map((c) => ({
            id: c.id ?? '',
            title: c.title ?? '',
            year: c.year ?? 0,
            cover: c.cover ?? '',
            author: c.author ?? '',
          }))
        : []
      return {
        cover: typeof data.cover === 'string' ? data.cover : '',
        genre: Array.isArray(data.genre) ? (data.genre as string[]) : [],
        year: typeof data.year === 'number' ? data.year : Number(year) || 0,
        cover_failed: !data.cover,
        overview: typeof data.overview === 'string' ? data.overview : '',
        author: typeof data.author === 'string' ? data.author : '',
        candidates,
      }
    }
    if (error) console.warn('[books] book-search invoke error, fallback mock:', error.message)
  } catch (e) {
    console.warn('[books] book-search invoke failed, fallback mock:', e)
  }
  return mockBookData(year)
}

/** 对已有书籍重新拉取第三方数据（用于「同步数据」/「手动获取封面」） */
export async function syncBook(book: Book): Promise<BookData> {
  return fetchBookByTitle(book.title, String(book.year))
}

/**
 * 按豆瓣 id 拉取单本书详情（用户切换候选时调用）：
 * 补回大封面 / 评分 / 作者 / 类型(tags) / 简介(intro)。未部署/异常时返回空对象，由调用方回退候选自带字段。
 */
export async function fetchBookDetail(doubanId: string): Promise<Partial<BookData>> {
  if (!doubanId) return {}
  try {
    const { data, error } = await supabase.functions.invoke('book-search', {
      body: { douban_id: doubanId },
    })
    if (!error && data && data.found) {
      return {
        cover: typeof data.cover === 'string' ? data.cover : '',
        genre: Array.isArray(data.genre) ? (data.genre as string[]) : [],
        overview: typeof data.overview === 'string' ? data.overview : '',
        author: typeof data.author === 'string' ? data.author : '',
        cover_failed: !data.cover,
      }
    }
    if (error) console.warn('[books] book-search detail error:', error.message)
  } catch (e) {
    console.warn('[books] book-search detail failed:', e)
  }
  return {}
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
 * 公网封面 URL（豆瓣 doubanio.com 直链）直接采用，不做中转：
 * 该直链浏览器可直接加载（CachedImage 已做应用级缓存），
 * 重传到 Storage 反而可能因跨域污染 canvas 而失败。后续若需自托管可在此 fetch→重传。
 */
export async function uploadBookImage(url: string, _userId: string): Promise<string> {
  return url
}
