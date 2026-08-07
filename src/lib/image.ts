// ============================================================
// 前端图片压缩工具（纯浏览器 Canvas 实现，无第三方依赖）
// 用途：头像本地上传前压缩，避免把几 MB 原图直接塞进 Storage
//
// 处理链路：
//   File → 校验 → 解码（EXIF 方向自动纠正）→ 居中正方形裁切
//        → 缩放到目标边长 → 编码（优先 WebP）→ 质量/尺寸迭代逼近目标体积
// ============================================================

/** 允许上传的原始图片类型（与 Storage 桶 allowed_mime_types 对齐 + 常见格式） */
const ACCEPT_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
]

/** 原始文件体积上限：10MB。超过说明用户选错了图（如原相机大图） */
const MAX_SOURCE_BYTES = 10 * 1024 * 1024

export type CompressOptions = {
  /** 输出边长（正方形），默认 512 */
  size?: number
  /** 目标体积上限（字节），默认 120KB */
  maxBytes?: number
  /** 初始编码质量，默认 0.9 */
  quality?: number
}

export type CompressedImage = {
  /** 压缩后的二进制，可直接上传 Storage */
  blob: Blob
  /** 预览用 dataURL */
  dataUrl: string
  /** 输出 MIME：image/webp 或 image/jpeg */
  mime: string
  /** 输出边长 */
  size: number
  /** 输出字节数 */
  bytes: number
  /** 原始字节数（用于展示压缩率） */
  sourceBytes: number
}

/** 压缩失败时抛出的错误，message 可直接展示给用户 */
export class ImageCompressError extends Error {}

// ------------------------------------------------------------
// 能力探测：浏览器是否支持 WebP 编码（Safari 14+ / Chrome / Edge 均支持）
// ------------------------------------------------------------
let webpSupport: boolean | null = null
function supportsWebp(): boolean {
  if (webpSupport !== null) return webpSupport
  try {
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    webpSupport = c.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    webpSupport = false
  }
  return webpSupport
}

// ------------------------------------------------------------
// 解码：优先 createImageBitmap（快、且能按 EXIF 自动旋转）
// 老浏览器回退到 <img> + objectURL
// ------------------------------------------------------------
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // 某些格式（如部分 avif）可能失败，走回退分支
    }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new ImageCompressError('图片解码失败，请换一张图片试试'))
      img.src = url
    })
  } finally {
    // 图片已解码进内存，可安全释放
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

function sourceSize(src: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  if ('naturalWidth' in src) return { w: src.naturalWidth, h: src.naturalHeight }
  return { w: src.width, h: src.height }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new ImageCompressError('图片编码失败'))),
      mime,
      quality,
    )
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new ImageCompressError('生成预览失败'))
    fr.readAsDataURL(blob)
  })
}

/**
 * 把用户选择的图片压缩成正方形头像。
 *
 * @throws {ImageCompressError} 类型不符 / 体积过大 / 解码失败时抛出，message 可直接展示
 */
export async function compressAvatar(
  file: File,
  opts: CompressOptions = {},
): Promise<CompressedImage> {
  const targetSize = opts.size ?? 512
  const maxBytes = opts.maxBytes ?? 120 * 1024
  const startQuality = opts.quality ?? 0.9

  // ---------- 校验 ----------
  if (!file.type.startsWith('image/')) {
    throw new ImageCompressError('只支持图片文件（JPG / PNG / WebP / GIF）')
  }
  if (!ACCEPT_MIME.includes(file.type)) {
    throw new ImageCompressError(`暂不支持 ${file.type} 格式，请换 JPG / PNG / WebP`)
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new ImageCompressError(
      `图片太大（${(file.size / 1024 / 1024).toFixed(1)}MB），请选择 10MB 以内的图片`,
    )
  }

  // ---------- 解码 ----------
  const src = await decode(file)
  const { w, h } = sourceSize(src)
  if (!w || !h) throw new ImageCompressError('图片尺寸异常，无法处理')

  // ---------- 居中正方形裁切参数 ----------
  const side = Math.min(w, h)
  const sx = Math.floor((w - side) / 2)
  const sy = Math.floor((h - side) / 2)

  const mime = supportsWebp() ? 'image/webp' : 'image/jpeg'

  // ---------- 逐级压缩：先降质量，再降尺寸 ----------
  const sizeSteps = [targetSize, 384, 256, 192]
  let best: { blob: Blob; size: number } | null = null

  for (const outSize of sizeSteps) {
    // 输出不放大：原图比目标还小时，用原图边长
    const out = Math.min(outSize, side)

    const canvas = document.createElement('canvas')
    canvas.width = out
    canvas.height = out
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ImageCompressError('当前浏览器不支持 Canvas，无法压缩图片')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    // JPEG 无透明通道，先铺白底，避免 PNG 透明区变黑
    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, out, out)
    }
    ctx.drawImage(src as CanvasImageSource, sx, sy, side, side, 0, 0, out, out)

    for (let q = startQuality; q >= 0.5; q -= 0.1) {
      const blob = await canvasToBlob(canvas, mime, Number(q.toFixed(2)))
      if (!best || blob.size < best.blob.size) best = { blob, size: out }
      if (blob.size <= maxBytes) {
        if ('close' in src) src.close()
        return {
          blob,
          dataUrl: await blobToDataUrl(blob),
          mime,
          size: out,
          bytes: blob.size,
          sourceBytes: file.size,
        }
      }
    }
  }

  if ('close' in src) src.close()
  if (!best) throw new ImageCompressError('图片压缩失败，请换一张图片试试')

  // 极端情况（如超大噪点图）：取迭代过程中最小的一版
  return {
    blob: best.blob,
    dataUrl: await blobToDataUrl(best.blob),
    mime,
    size: best.size,
    bytes: best.blob.size,
    sourceBytes: file.size,
  }
}

/** 人类可读的体积文案：1.2 MB / 86 KB */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** 供 <input type="file" accept> 使用 */
export const AVATAR_ACCEPT = ACCEPT_MIME.join(',')
