// CachedImage —— 应用级图片缓存
// 解决「进观影每次全量重取海报」：浏览器 HTTP 缓存（尤其手机）易被回收，
// 改用 Cache Storage 把 webp blob 按 URL 持久化，命中即本地秒出，零网络。
// 仅当本地无缓存（全新 URL）才下载并写入缓存；不支持 caches / 跨域失败则回退原生 <img>。
import { useEffect, useRef, useState } from 'react'

interface CachedImageProps {
  src: string
  alt?: string
  className?: string
  style?: React.CSSProperties
  loading?: 'lazy' | 'eager'
  draggable?: boolean
  onClick?: (e: React.MouseEvent<HTMLImageElement>) => void
  onError?: () => void
}

const IMG_CACHE = 'yunstudio-img-v1'

async function resolveSrc(raw: string): Promise<{ url: string; isBlob: boolean }> {
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(IMG_CACHE)
      let hit = await cache.match(raw)
      if (!hit) {
        const res = await fetch(raw)
        if (!res.ok) throw new Error('bad status')
        // opaque(跨域无CORS)响应无法 put，会抛错 → 落下方 catch 回退
        await cache.put(raw, res.clone())
        hit = res
      }
      const blob = await hit.blob()
      return { url: URL.createObjectURL(blob), isBlob: true }
    }
  } catch {
    // 不支持 caches / 跨域 / 网络失败 → 回退直接 src（仍享浏览器 HTTP 缓存）
  }
  return { url: raw, isBlob: false }
}

export function CachedImage({
  src,
  alt = '',
  className,
  style,
  loading = 'lazy',
  draggable = false,
  onClick,
  onError,
}: CachedImageProps) {
  const [state, setState] = useState<{ url: string; isBlob: boolean } | null>(null)
  const objUrlRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setState(null) // 先占位，避免首帧直接发网络请求
    resolveSrc(src)
      .then((r) => {
        if (cancelled) {
          if (r.isBlob) URL.revokeObjectURL(r.url)
          return
        }
        if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current)
        objUrlRef.current = r.isBlob ? r.url : null
        setState(r)
      })
      .catch(() => {
        if (!cancelled) setState({ url: src, isBlob: false })
      })
    return () => {
      cancelled = true
      if (objUrlRef.current) {
        URL.revokeObjectURL(objUrlRef.current)
        objUrlRef.current = null
      }
    }
  }, [src])

  if (!state) {
    // 加载占位：保持同盒模型，避免布局抖动；父级已有兜底背景
    return <div className={className} style={style} aria-hidden />
  }
  return (
    <img
      src={state.url}
      alt={alt}
      className={className}
      style={style}
      loading={loading}
      draggable={draggable}
      onClick={onClick}
      onError={() => onError?.()}
    />
  )
}
