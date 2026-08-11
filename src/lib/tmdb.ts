// TMDB 同步框架（观影模块）
// 数据获取走 Supabase Edge Function 代理（tmdb-proxy），TMDB_API_KEY 仅存于服务端密钥，
// 前端只 invoke 函数、绝不持有 key。图片经 image.tmdb.org 公开 CDN 直拉（无需 key），
// 前端 canvas 压缩为 WebP 后上传 Supabase Storage（movie-covers 桶），最终存 Storage URL。
// 未部署 Edge Function / invoke 失败时自动回退 mock，保证 UI 不崩。
import { supabase } from './supabase'
import type { Movie } from '../types'

const TMDB_IMG = 'https://image.tmdb.org/t/p'

// ─── Mock 数据（兜底，纯前端演示，不含真实版权内容）────────────────────────
const MOCK_COVERS = [
  'https://images.unsplash.com/photo-1574267432553-4b4628081c31?w=600&h=900&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1535016120720-40c646be5580?w=600&h=900&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1512070679279-8988d32161be?w=600&h=900&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=600&h=900&fit=crop&auto=format',
]
// 宽幅背景图（16:9 横版），用于 Hero 信息块左侧封面
const MOCK_BACKDROPS = [
  'https://images.unsplash.com/photo-1489599735734-79b4625b3676?w=1200&h=675&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1485846234645-a62644f84728?w=1200&h=675&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1542204165-65bf26472b9b?w=1200&h=675&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=1200&h=675&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?w=1200&h=675&fit=crop&auto=format',
]
const MOCK_GENRES = ['剧情', '爱情', '科幻', '犯罪', '喜剧', '悬疑', '动画', '动作']
const MOCK_REGIONS = ['美国', '英国', '法国', '日本', '韩国', '中国']

export interface TMDBMovieData {
  cover: string
  backdrop: string // 宽幅背景图（TMDB backdrop_path / 横版剧照）
  third_party_rating: number | null
  genre: string[]
  region: string
  duration: number
  year: number
  cover_failed: boolean
}

/**
 * 按观影名称 + 年代获取第三方数据。
 * 优先走 Edge Function 代理（key 不出服务端）；失败/未配置时回退 mock。
 */
export async function fetchMovieByTitle(title: string, year: string): Promise<TMDBMovieData> {
  // —— 优先：Edge Function 代理 ——
  try {
    const { data, error } = await supabase.functions.invoke('tmdb-proxy', {
      body: { title, year },
    })
    if (!error && data && data.found) {
      const cover = data.poster_path ? `${TMDB_IMG}/w500${data.poster_path}` : ''
      const backdrop = data.backdrop_path ? `${TMDB_IMG}/w780${data.backdrop_path}` : ''
      return {
        cover,
        backdrop,
        third_party_rating: typeof data.vote_average === 'number' ? data.vote_average : null,
        genre: Array.isArray(data.genre) ? data.genre : [],
        region: data.origin_country ?? '',
        duration: typeof data.runtime === 'number' ? data.runtime : 0,
        year: data.release_date ? Number(String(data.release_date).slice(0, 4)) : Number(year) || 0,
        cover_failed: !cover,
      }
    }
    if (error) console.warn('[tmdb] invoke error, fallback mock:', error.message)
  } catch (e) {
    console.warn('[tmdb] invoke failed, fallback mock:', e)
  }

  // —— Mock 兜底 ——
  await new Promise((r) => setTimeout(r, 600 + Math.random() * 500))
  const ok = Math.random() > 0.12 // ~12% 概率封面获取失败，用于演示「手动获取」
  const yr = parseInt(year, 10) || 0
  const cover = ok ? MOCK_COVERS[Math.floor(Math.random() * MOCK_COVERS.length)] : ''
  const backdrop = ok ? MOCK_BACKDROPS[Math.floor(Math.random() * MOCK_BACKDROPS.length)] : ''
  return {
    cover,
    backdrop,
    third_party_rating: Number((6 + Math.random() * 3).toFixed(1)),
    genre: [MOCK_GENRES[Math.floor(Math.random() * MOCK_GENRES.length)]],
    region: MOCK_REGIONS[Math.floor(Math.random() * MOCK_REGIONS.length)],
    duration: 90 + Math.floor(Math.random() * 90),
    year: yr || 2000 + Math.floor(Math.random() * 26),
    cover_failed: !ok,
  }
}

/** 对已有影片重新拉取第三方数据（用于「同步数据」/「手动获取封面」） */
export async function syncMovie(movie: Movie): Promise<TMDBMovieData> {
  return fetchMovieByTitle(movie.title, String(movie.year))
}

// ─── 图片压缩 + 上传 Storage（关键：压缩到极致且清晰）─────────────────────
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
 * 拉取 TMDB 公开 CDN 图片 → 压缩为 WebP → 上传 Storage movie-covers/{userId}/{uuid}.webp
 * 返回 Storage 公网 URL（替代 TMDB CDN 直链，自托管、可长期保存、跨端一致）。
 */
export async function uploadTmdbImage(tmdbUrl: string, userId: string): Promise<string> {
  const res = await fetch(tmdbUrl)
  if (!res.ok) throw new Error(`fetch tmdb image failed: ${res.status}`)
  const orig = await res.blob()
  const blob = await compressToWebpIfSmaller(orig, 0.82)
  const path = `${userId}/${crypto.randomUUID()}.webp`
  const { error } = await supabase.storage
    .from('movie-covers')
    .upload(path, blob, { upsert: false, contentType: 'image/webp' })
  if (error) throw error
  const { data } = supabase.storage.from('movie-covers').getPublicUrl(path)
  return data.publicUrl
}

/** 用户手动上传本地图片 → 同样压缩为 WebP → 上传 Storage */
export async function uploadMovieCover(file: File, userId: string): Promise<string> {
  const blob = await compressToWebpIfSmaller(file, 0.82)
  const path = `${userId}/${crypto.randomUUID()}.webp`
  const { error } = await supabase.storage
    .from('movie-covers')
    .upload(path, blob, { upsert: false, contentType: 'image/webp' })
  if (error) throw error
  const { data } = supabase.storage.from('movie-covers').getPublicUrl(path)
  return data.publicUrl
}
