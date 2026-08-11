import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Field, Input, Button, Modal } from '../components/ui'
import logoUrl from '/logo.jpg'

type Mode = 'login' | 'register'
type Msg = { type: 'ok' | 'err'; text: string } | null

export default function Login() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<Msg>(null)
  // 邮箱确认提示弹窗
  const [hintOpen, setHintOpen] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    try {
      if (mode === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        })
        if (error) throw error
        if (data.session) {
          // 若 Supabase 控制台关闭了「Confirm email」，注册即登录
          setMessage({ type: 'ok', text: '注册成功，已自动登录。' })
        } else {
          // 注册成功但未自动登录 → 弹窗提示去邮箱激活
          setHintOpen(true)
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        // 登录成功由 AuthContext 监听到，AuthGate 自动切换到控制台
      }
    } catch (err) {
      setMessage({ type: 'err', text: (err as Error)?.message || '操作失败，请重试。' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas px-4">
      {/* 装饰：左上和右下的暖色光晕 */}
      <div className="pointer-events-none absolute -left-32 -top-32 h-80 w-80 rounded-full bg-warning/15 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 -bottom-32 h-80 w-80 rounded-full bg-accent/15 blur-3xl" />

      <div className="relative z-10 w-full max-w-md">
        {/* Logo + 标题 */}
        <div className="mb-6 text-center">
          <img
            src={logoUrl}
            alt="YUNSTUDIO"
            className="mx-auto mb-3 h-14 w-14 rounded-2xl object-cover shadow-card"
          />
          <h1 className="text-xl font-semibold text-ink-strong">YUNSTUDIO</h1>
          <p className="mt-1 text-sm text-ink-soft">
            联网 · 多端同步 · 数据不出域
          </p>
        </div>

        {/* 卡片 */}
        <div className="rounded-card border border-line bg-surface p-6 shadow-card">
          {/* 模式切换 */}
          <div className="mb-5 flex gap-1 rounded-lg bg-brand-soft p-1">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m)
                  setMessage(null)
                }}
                className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
                  mode === m
                    ? 'bg-surface text-ink-strong shadow-sm'
                    : 'text-ink-soft hover:text-ink-strong'
                }`}
              >
                {m === 'login' ? '登录' : '注册'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit}>
            <Field label="邮箱">
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </Field>
            <Field label="密码（至少 6 位）">
              <Input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </Field>
            <Button type="submit" disabled={loading} className="w-full">
              {loading
                ? '处理中…'
                : mode === 'login'
                  ? '登录'
                  : '注册账号'}
            </Button>
          </form>

          {message && (
            <div
              className={`mt-4 rounded-lg px-3 py-2 text-sm ${
                message.type === 'ok'
                  ? 'bg-success/10 text-success'
                  : 'bg-danger/10 text-danger'
              }`}
            >
              {message.text}
            </div>
          )}
        </div>
      </div>

      {/* 注册后需邮箱激活提示（弹窗） */}
      <Modal
        open={hintOpen}
        onClose={() => setHintOpen(false)}
        title="请查收验证邮件"
        maxWidth="max-w-sm"
        footer={
          <Button onClick={() => { setHintOpen(false); setMode('login') }}>
            我去查收
          </Button>
        }
      >
        <p className="text-sm text-ink-soft">
          注册成功！请在邮箱中点击 Supabase 发送的激活链接完成验证，然后再返回登录。
          <br />
          <span className="mt-2 block text-xs text-ink-mute">
            小贴士：若希望注册即登录，可在 Supabase 控制台 → Authentication → Providers →
            Email 中关闭「Confirm email」。
          </span>
        </p>
      </Modal>
    </div>
  )
}
