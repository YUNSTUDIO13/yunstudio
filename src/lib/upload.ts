// 旅行模块图片上传（参考观影模块 lib/tmdb.ts 的 movie-covers 模式）
// 用户上传本地图片 → 压缩为 WebP → 上传 Supabase Storage `travel-images/{userId}/{uuid}.webp
// → 返回 publicUrl。压缩失败/反大时保留原图。RLS 由 travels.sql 中
// travel_images_insert/update/delete policy 限定为本人 (path 首层 = user_id)。

import { supabase } from './supabase'

const TRAVEL_BUCKET = 'travel-images'

/** Blob → canvas → WebP（默认 quality 0.82） */
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

/** 压缩为 WebP：若 webp 反而比原图大 5% 以上，保留原图（不劣化旧图） */
async function compressToWebpIfSmaller(blob: Blob, quality = 0.82): Promise<Blob> {
  try {
    const webp = await blobToWebp(blob, quality)
    return webp.size < blob.size * 1.05 ? webp : blob
  } catch {
    return blob
  }
}

/**
 * 上传单张图片到 travel-images 桶，返回 publicUrl
 * 失败抛 Error（调用方决定 toast 还是回退 data URL）
 */
export async function uploadTravelImage(file: File, userId: string): Promise<string> {
  const blob = await compressToWebpIfSmaller(file, 0.82)
  const path = `${userId}/${crypto.randomUUID()}.webp`
  const { error } = await supabase.storage
    .from(TRAVEL_BUCKET)
    .upload(path, blob, { upsert: false, contentType: 'image/webp' })
  if (error) throw error
  const { data } = supabase.storage.from(TRAVEL_BUCKET).getPublicUrl(path)
  return data.publicUrl
}
