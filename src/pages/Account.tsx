import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Field, Modal } from '../components/ui'
import { useAuth } from '../context/AuthContext'

// ============================================================
// 工具：与 AppShell 共用同一份头像（颜色 = 邮箱哈希）
// ============================================================
function avatarFromUser(email?: string | null): { letter: string; bg: string } {
  const local = (email ?? '').split('@')[0] || 'U'
  const letter = local.slice(0, 1).toUpperCase()
  let hash = 0
  for (let i = 0; i < local.length; i++) hash = (hash * 31 + local.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return { letter, bg: `hsl(${hue} 35% 60%)` }
}

function formatDate(iso?: string): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

// ============================================================
// 主页面
// ============================================================
export default function AccountPage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  // 头像信息
  const { letter, bg } = avatarFromUser(user?.email)

  // 元数据：createdAt 取自 user.created_at，role / app_metadata
  const createdAt = user?.created_at
  const lastSignInAt = user?.last_sign_in_at
  const emailConfirmed = !!user?.email_confirmed_at
  const provider = user?.app_metadata?.provider ?? '邮箱密码'
  const role = (user?.app_metadata?.role as string | undefined) ?? 'user'
  const userId = user?.id ?? ''

  // 关闭弹窗时按 Esc 也退出弹窗
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLogoutOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function handleLogout() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await signOut()
      // 退出后 AuthGate 检测到无会话会渲染 Login 页面
      navigate('/', { replace: true })
    } finally {
      setSigningOut(false)
      setLogoutOpen(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* 顶部：返回 + 标题 */}
      <header className="rounded-2xl bg-surface p-5 shadow-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-ink-strong">账号</h1>
            <p className="mt-1 text-sm text-ink-soft">
              查看当前登录的账号信息，并退出登录。
            </p>
          </div>
        </div>
      </header>

      {/* 账号基本信息卡（大头像 + 邮箱 + 提供方） */}
      <section className="rounded-2xl bg-surface p-6 shadow-card">
        <div className="flex items-center gap-5">
          <div
            className="grid h-20 w-20 place-items-center rounded-full text-2xl font-semibold text-white shadow-card-hover"
            style={{ backgroundColor: bg }}
          >
            {letter}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-semibold text-ink-strong">
              {user?.email ?? '未登录'}
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-ink-mute">
              <span className="rounded-md bg-brand-soft px-2 py-0.5 text-ink-strong">
                {provider}
              </span>
              {emailConfirmed ? (
                <span className="rounded-md bg-accent/10 px-2 py-0.5 text-accent">
                  邮箱已验证
                </span>
              ) : (
                <span className="rounded-md bg-warning/10 px-2 py-0.5 text-warning">
                  邮箱未验证
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 账号字段（只读） */}
      <section className="rounded-2xl bg-surface p-6 shadow-card">
        <h2 className="mb-4 text-base font-semibold text-ink-strong">账号信息</h2>

        <Field label="邮箱地址">
          <div className="rounded-lg border border-line bg-canvas/30 px-3 py-2.5 text-sm text-ink-strong">
            {user?.email ?? '—'}
          </div>
        </Field>

        <Field label="用户 ID">
          <div className="flex items-center gap-2">
            <code className="block flex-1 truncate rounded-lg border border-line bg-canvas/30 px-3 py-2.5 text-xs text-ink-soft">
              {userId}
            </code>
            <Button
              variant="soft"
              className="!px-3"
              onClick={() => {
                if (!userId) return
                navigator.clipboard?.writeText(userId).catch(() => {})
              }}
            >
              复制
            </Button>
          </div>
        </Field>

        <Field label="角色 / 权限">
          <div className="rounded-lg border border-line bg-canvas/30 px-3 py-2.5 text-sm text-ink-strong">
            {role}
          </div>
        </Field>

        <Field label="注册时间">
          <div className="rounded-lg border border-line bg-canvas/30 px-3 py-2.5 text-sm text-ink-strong">
            {formatDate(createdAt)}
          </div>
        </Field>

        <Field label="最近登录">
          <div className="rounded-lg border border-line bg-canvas/30 px-3 py-2.5 text-sm text-ink-strong">
            {formatDate(lastSignInAt)}
          </div>
        </Field>
      </section>

      {/* 退出 */}
      <section className="rounded-2xl bg-surface p-6 shadow-card">
        <h2 className="mb-1 text-base font-semibold text-ink-strong">退出登录</h2>
        <p className="mb-4 text-sm text-ink-soft">
          退出后，本机的 Supabase 会话将被清空，下次需要重新登录。
        </p>
        <Button variant="danger" onClick={() => setLogoutOpen(true)}>
          退出登录
        </Button>
      </section>

      {/* 确认弹窗 */}
      <Modal
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        title="确认退出登录？"
        maxWidth="max-w-sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setLogoutOpen(false)} disabled={signingOut}>
              取消
            </Button>
            <Button variant="danger" onClick={handleLogout} disabled={signingOut}>
              {signingOut ? '退出中…' : '退出'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">
          退出后将回到登录页面，未同步的本地数据（如本地草稿）可能丢失。
        </p>
      </Modal>
    </div>
  )
}
