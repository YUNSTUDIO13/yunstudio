import { useEffect, useState } from 'react'

// ============================================================
// 统一头像组件：有 avatar_url 渲染图片，无（或加载失败）回退首字母色块
// AppShell 左下 dock 与个人主页共用同一份逻辑，避免两处各写一遍
// ============================================================

/** 由邮箱/昵称派生首字母与背景色（同一账号颜色恒定） */
export function avatarFallback(seed?: string | null): { letter: string; bg: string } {
  const local = (seed ?? '').split('@')[0] || 'U'
  const letter = local.slice(0, 1).toUpperCase()
  let hash = 0
  for (let i = 0; i < local.length; i++) hash = (hash * 31 + local.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return { letter, bg: `hsl(${hue} 35% 60%)` }
}

export default function Avatar({
  url,
  seed,
  className = '',
  textClassName = '',
  alt = '头像',
}: {
  /** 头像图片地址，空则用首字母兜底 */
  url?: string | null
  /** 生成首字母与颜色的种子，通常传邮箱 */
  seed?: string | null
  /** 容器样式（尺寸、圆角、阴影由调用方决定） */
  className?: string
  /** 首字母文字大小 */
  textClassName?: string
  alt?: string
}) {
  const { letter, bg } = avatarFallback(seed)
  const [broken, setBroken] = useState(false)

  // 换头像后 url 变化，重置失败态
  useEffect(() => {
    setBroken(false)
  }, [url])

  const showImage = !!url && !broken

  return (
    <span
      className={`relative grid place-items-center overflow-hidden ${className}`}
      style={showImage ? undefined : { backgroundColor: bg }}
    >
      {showImage ? (
        <img
          src={url as string}
          alt={alt}
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
          draggable={false}
        />
      ) : (
        <span className={`font-semibold text-white ${textClassName}`}>{letter}</span>
      )}
    </span>
  )
}
