// TMDB 同步框架（观影模块）
// 当前为「有 key 走真实 TMDB、无 key 走 mock」的运行时切换实现：
//  - 配置了 VITE_TMDB_API_KEY 即自动启用真实接口，无需改动任何调用方代码；
//  - 未配置时走 mock（纯前端演示，随机 ~12% 封面失败以演示「手动获取」）。
//
// 统一约定：
//  - fetchMovieByTitle(title, year)：按名称+年代获取封面/评分/类型/地区/时长/年代
//  - syncMovie(movie)：对已有影片重新拉取第三方数据（封面失败可重试）
//  - 封面获取失败时返回 cover: '' 且 cover_failed: true，由调用方标记并提示「手动获取」
import { supabase } from './supabase'
import type { Movie } from '../types'

// ─── 真实 TMDB 接入点（配置 VITE_TMDB_API_KEY 后自动启用）─────────────────────
const TMDB_API_KEY = (import.meta.env.VITE_TMDB_API_KEY as string | undefined) ?? ''
const TMDB_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500'
// TMDB genre id → 中文名（search 接口只返回 genre_ids 数组）
const GENRE_MAP: Record<number, string> = {
  28: '动作', 12: '冒险', 16: '动画', 35: '喜剧', 80: '犯罪', 18: '剧情',
  14: '奇幻', 27: '恐怖', 9648: '悬疑', 10749: '爱情', 878: '科幻', 53: '惊悚',
  10752: '战争', 37: '西部',
}

// ─── Mock 数据（占位封面，纯前端演示，不含真实版权内容）────────────────────────
const MOCK_COVERS = [
  'https://images.unsplash.com/photo-1574267432553-4b4628081c31?w=600&h=900&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1535016120720-40c646be5580?w=600&h=900&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1512070679279-8988d32161be?w=600&h=900&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=600&h=900&fit=crop&auto=format',
]
const MOCK_GENRES = ['剧情', '爱情', '科幻', '犯罪', '喜剧', '悬疑', '动画', '动作']
const MOCK_REGIONS = ['美国', '英国', '法国', '日本', '韩国', '中国']

export interface TMDBMovieData {
  cover: string
  third_party_rating: number | null
  genre: string[]
  region: string
  duration: number
  year: number
  cover_failed: boolean
}

/**
 * 按观影名称 + 年代获取第三方数据。
 * 返回 TMDBMovieData 子集（封面/评分/类型/地区/时长/年代/封面失败标记）。
 */
export async function fetchMovieByTitle(title: string, year: string): Promise<TMDBMovieData> {
  // —— 真实实现（仅在配置了 VITE_TMDB_API_KEY 时启用）——
  if (TMDB_API_KEY) {
    const y = year ? `&year=${encodeURIComponent(year)}` : ''
    const res = await fetch(`${TMDB_BASE}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}${y}`)
    const json = await res.json()
    const m = json.results?.[0]
    if (!m) {
      return { cover: '', third_party_rating: null, genre: [], region: '', duration: 0, year: Number(year) || 0, cover_failed: true }
    }
    const cover = m.poster_path ? `${TMDB_IMG}${m.poster_path}` : ''
    return {
      cover,
      third_party_rating: typeof m.vote_average === 'number' ? Number(m.vote_average.toFixed(1)) : null,
      genre: ((m.genre_ids ?? []) as number[]).map((id) => GENRE_MAP[id]).filter((g): g is string => Boolean(g)),
      region: (m.origin_country ?? [])[0] ?? '',
      duration: m.runtime ?? 0,
      year: m.release_date ? Number(m.release_date.slice(0, 4)) : (Number(year) || 0),
      cover_failed: !cover,
    }
  }

  // —— Mock 实现（演示用，无需 key）——
  await new Promise((r) => setTimeout(r, 600 + Math.random() * 500))
  const ok = Math.random() > 0.12 // ~12% 概率封面获取失败，用于演示「手动获取」
  const yr = parseInt(year, 10) || 0
  return {
    cover: ok ? MOCK_COVERS[Math.floor(Math.random() * MOCK_COVERS.length)] : '',
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

/**
 * 上传封面到 Supabase Storage（movie-covers bucket，公开读、仅本人写）。
 * 返回公网 URL，可直接存 movies.cover 字段并跨端同步。
 */
export async function uploadMovieCover(file: File, userId: string): Promise<string> {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase()
  const path = `${userId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from('movie-covers')
    .upload(path, file, { upsert: false, contentType: file.type || 'image/png' })
  if (error) throw error
  const { data } = supabase.storage.from('movie-covers').getPublicUrl(path)
  return data.publicUrl
}
