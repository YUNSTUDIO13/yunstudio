import { useEffect, useState } from 'react'

/**
 * 响应式媒体查询 hook（SSR 安全，初始化即读 window.matchMedia）。
 * 用于 PC / 移动端分支渲染。
 * @param query 媒体查询串，如 '(max-width: 767px)'
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const handler = () => setMatches(mql.matches)
    handler()
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])

  return matches
}
