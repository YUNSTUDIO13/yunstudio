import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { useDashboard } from '../context/DashboardContext'
import Login from '../pages/Login'

// 路由守卫：会话加载中显示占位；无会话跳登录；有会话且 dashboard 布局已就绪才渲染受保护内容。
export default function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const { hydrated } = useDashboard()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-sm text-ink-mute">
        加载中…
      </div>
    )
  }

  if (!session) {
    return <Login />
  }

  // 等待 dashboard 云端布局加载完成：本地有数据则同步放行（首帧渲染本地，不闪），
  // 本地无数据（清缓存/首次）则短暂显示加载中，避免先渲染默认布局再跳联网最新的闪屏。
  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-sm text-ink-mute">
        加载中…
      </div>
    )
  }

  return <>{children}</>
}
