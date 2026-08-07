import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import Login from '../pages/Login'

// 路由守卫：会话加载中显示占位；无会话跳登录；有会话渲染受保护内容。
export default function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()

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

  return <>{children}</>
}
