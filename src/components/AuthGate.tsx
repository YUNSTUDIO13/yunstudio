import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { useDashboard } from '../context/DashboardContext'
import Login from '../pages/Login'

// 路由守卫：会话加载中显示占位；无会话跳登录；有会话且 dashboard 布局已就绪才渲染受保护内容。
export default function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const { hydrated } = useDashboard()

  // 开发预览后门：URL 带 preview=1 时跳过登录与加载等待，方便无账号本地查看模块效果。
  // 不影响正式登录流程（去掉参数即恢复原样）。
  const isPreview =
    new URLSearchParams(window.location.search).get('preview') === '1' ||
    window.location.hash.includes('preview=1')

  if (loading && !isPreview) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-sm text-ink-mute">
        加载中…
      </div>
    )
  }

  if (!session && !isPreview) {
    return <Login />
  }

  // 等待 dashboard 云端布局加载完成：本地有数据则同步放行（首帧渲染本地，不闪），
  // 本地无数据（清缓存/首次）则短暂显示加载中，避免先渲染默认布局再跳联网最新的闪屏。
  if (!hydrated && !isPreview) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-sm text-ink-mute">
        加载中…
      </div>
    )
  }

  return <>{children}</>
}
