import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Field, Input, Modal, Textarea } from '../components/ui'
import Avatar from '../components/Avatar'
import { useAuth } from '../context/AuthContext'
import { useProfile } from '../context/ProfileContext'
import { supabase } from '../lib/supabase'
import {
  AVATAR_ACCEPT,
  ImageCompressError,
  compressAvatar,
  formatBytes,
  type CompressedImage,
} from '../lib/image'

// ============================================================
// 个人主页：头像上传（本地选图 → 前端压缩 → Storage）+ 资料编辑 + 改密 + 退出
// ============================================================

function formatDate(iso?: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

type Toast = { type: 'ok' | 'err'; text: string } | null

export default function AccountPage() {
  const { user, signOut } = useAuth()
  const { profile, loading, error, updateProfile, uploadAvatar, removeAvatar } = useProfile()
  const navigate = useNavigate()

  const [toast, setToast] = useState<Toast>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])

  // ---------------- 账号元信息（只读） ----------------
  const createdAt = user?.created_at
  const lastSignInAt = user?.last_sign_in_at
  const emailConfirmed = !!user?.email_confirmed_at
  const provider = user?.app_metadata?.provider ?? '邮箱密码'
  const role = (user?.app_metadata?.role as string | undefined) ?? 'user'
  const userId = user?.id ?? ''

  // ---------------- 资料表单 ----------------
  const [form, setForm] = useState({ display_name: '', title: '', department: '', bio: '' })
  const [savingProfile, setSavingProfile] = useState(false)

  // profile 加载/远端变更后同步进表单
  useEffect(() => {
    setForm({
      display_name: profile?.display_name ?? '',
      title: profile?.title ?? '',
      department: profile?.department ?? '',
      bio: profile?.bio ?? '',
    })
  }, [profile])

  const dirty = useMemo(
    () =>
      form.display_name !== (profile?.display_name ?? '') ||
      form.title !== (profile?.title ?? '') ||
      form.department !== (profile?.department ?? '') ||
      form.bio !== (profile?.bio ?? ''),
    [form, profile],
  )

  const nameError =
    form.display_name.trim().length > 24 ? '昵称最多 24 个字符' : undefined
  const bioError = form.bio.length > 200 ? '简介最多 200 个字符' : undefined

  async function handleSaveProfile() {
    if (savingProfile || nameError || bioError) return
    setSavingProfile(true)
    try {
      await updateProfile(form)
      setToast({ type: 'ok', text: '资料已保存' })
    } catch (e) {
      setToast({ type: 'err', text: `保存失败：${(e as Error).message}` })
    } finally {
      setSavingProfile(false)
    }
  }

  // ---------------- 头像上传 ----------------
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [cropOpen, setCropOpen] = useState(false)
  const [preview, setPreview] = useState<CompressedImage | null>(null)
  const [compressing, setCompressing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [removing, setRemoving] = useState(false)

  async function handlePick(file?: File | null) {
    if (!file) return
    setCompressing(true)
    setCropOpen(true)
    setPreview(null)
    try {
      const out = await compressAvatar(file, { size: 512, maxBytes: 120 * 1024 })
      setPreview(out)
    } catch (e) {
      setCropOpen(false)
      const msg = e instanceof ImageCompressError ? e.message : '图片处理失败，请重试'
      setToast({ type: 'err', text: msg })
    } finally {
      setCompressing(false)
      // 允许连续选同一张图（否则 onChange 不触发）
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleConfirmUpload() {
    if (!preview || uploading) return
    setUploading(true)
    try {
      await uploadAvatar(preview.blob, preview.mime)
      setCropOpen(false)
      setPreview(null)
      setToast({ type: 'ok', text: '头像已更新' })
    } catch (e) {
      setToast({ type: 'err', text: `上传失败：${(e as Error).message}` })
    } finally {
      setUploading(false)
    }
  }

  async function handleRemoveAvatar() {
    if (removing) return
    setRemoving(true)
    try {
      await removeAvatar()
      setToast({ type: 'ok', text: '头像已移除' })
    } catch (e) {
      setToast({ type: 'err', text: `移除失败：${(e as Error).message}` })
    } finally {
      setRemoving(false)
      setRemoveOpen(false)
    }
  }

  // ---------------- 修改密码 ----------------
  const [pwd, setPwd] = useState({ next: '', confirm: '' })
  const [savingPwd, setSavingPwd] = useState(false)
  const pwdStrength = strengthOf(pwd.next)
  const pwdError =
    pwd.next && pwd.next.length < 8
      ? '密码至少 8 位'
      : pwd.confirm && pwd.next !== pwd.confirm
        ? '两次输入不一致'
        : undefined
  const pwdReady = pwd.next.length >= 8 && pwd.next === pwd.confirm

  async function handleChangePassword() {
    if (!pwdReady || savingPwd) return
    setSavingPwd(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password: pwd.next })
      if (err) throw err
      setPwd({ next: '', confirm: '' })
      setToast({ type: 'ok', text: '密码已修改，下次登录请用新密码' })
    } catch (e) {
      setToast({ type: 'err', text: `修改失败：${(e as Error).message}` })
    } finally {
      setSavingPwd(false)
    }
  }

  // ---------------- 退出 ----------------
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  async function handleLogout() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await signOut()
      navigate('/', { replace: true })
    } finally {
      setSigningOut(false)
      setLogoutOpen(false)
    }
  }

  const nickname = profile?.display_name || (user?.email ?? '').split('@')[0] || '未命名'

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-4">
      {/* 顶部标题 */}
      <header className="rounded-2xl bg-surface p-5 shadow-card">
        <h1 className="text-xl font-semibold text-ink-strong">个人主页</h1>
        <p className="mt-1 text-sm text-ink-soft">
          维护头像与个人资料，修改密码或退出登录。资料存于云端，多台电脑自动同步。
        </p>
      </header>

      {/* 表未建 / 网络异常提示 */}
      {error && (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-ink-strong">
          <div className="font-medium">资料加载失败</div>
          <p className="mt-1 text-ink-soft">
            {error}
            <br />
            若提示表或字段不存在，请先在 Supabase SQL Editor 执行{' '}
            <code className="rounded bg-surface px-1 py-0.5 text-xs">
              supabase/profile-avatar.sql
            </code>
            。
          </p>
        </div>
      )}

      {/* 头像卡 */}
      <section className="rounded-2xl bg-surface p-6 shadow-card">
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title="点击更换头像"
            className="group relative h-20 w-20 shrink-0 rounded-full shadow-card-hover outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Avatar
              url={profile?.avatar_url}
              seed={user?.email}
              className="h-20 w-20 rounded-full"
              textClassName="text-2xl"
            />
            <span
              className="
                pointer-events-none absolute inset-0 grid place-items-center rounded-full
                bg-ink-strong/55 text-[11px] font-medium text-white opacity-0
                transition group-hover:opacity-100
              "
            >
              更换
            </span>
          </button>

          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-semibold text-ink-strong">{nickname}</div>
            <div className="mt-0.5 truncate text-sm text-ink-soft">{user?.email ?? '未登录'}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-mute">
              <span className="rounded-md bg-brand-soft px-2 py-0.5 text-ink-strong">
                {provider}
              </span>
              {emailConfirmed ? (
                <span className="rounded-md bg-accent/10 px-2 py-0.5 text-accent">邮箱已验证</span>
              ) : (
                <span className="rounded-md bg-warning/10 px-2 py-0.5 text-warning">
                  邮箱未验证
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button variant="soft" onClick={() => fileRef.current?.click()} disabled={loading}>
            上传新头像
          </Button>
          {profile?.avatar_url && (
            <Button variant="ghost" onClick={() => setRemoveOpen(true)}>
              移除头像
            </Button>
          )}
          <span className="text-xs text-ink-mute">
            支持 JPG / PNG / WebP，自动裁成正方形并压缩到 512px
          </span>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept={AVATAR_ACCEPT}
          className="hidden"
          onChange={(e) => handlePick(e.target.files?.[0])}
        />
      </section>

      {/* 资料编辑 */}
      <section className="rounded-2xl bg-surface p-6 shadow-card">
        <h2 className="mb-4 text-base font-semibold text-ink-strong">个人资料</h2>

        <Field label="昵称" error={nameError} hint="展示在头像旁，最多 24 字">
          <Input
            value={form.display_name}
            maxLength={32}
            placeholder="如：老王"
            onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
          />
        </Field>

        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="职位">
            <Input
              value={form.title}
              maxLength={32}
              placeholder="如：高级产品经理"
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </Field>
          <Field label="部门">
            <Input
              value={form.department}
              maxLength={32}
              placeholder="如：增长产品部"
              onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
            />
          </Field>
        </div>

        <Field
          label="个性签名 / 简介"
          error={bioError}
          hint={`${form.bio.length} / 200`}
        >
          <Textarea
            value={form.bio}
            rows={3}
            maxLength={220}
            placeholder="一句话介绍自己，或写下当前季度的目标"
            onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
          />
        </Field>

        <div className="mt-2 flex items-center gap-2">
          <Button
            onClick={handleSaveProfile}
            disabled={!dirty || savingProfile || !!nameError || !!bioError}
          >
            {savingProfile ? '保存中…' : '保存资料'}
          </Button>
          {dirty && (
            <Button
              variant="ghost"
              onClick={() =>
                setForm({
                  display_name: profile?.display_name ?? '',
                  title: profile?.title ?? '',
                  department: profile?.department ?? '',
                  bio: profile?.bio ?? '',
                })
              }
            >
              放弃修改
            </Button>
          )}
        </div>
      </section>

      {/* 修改密码 */}
      <section className="rounded-2xl bg-surface p-6 shadow-card">
        <h2 className="mb-1 text-base font-semibold text-ink-strong">修改密码</h2>
        <p className="mb-4 text-sm text-ink-soft">
          修改后当前会话仍然有效，其它设备需用新密码重新登录。
        </p>

        <Field label="新密码" error={pwdError} hint="至少 8 位，建议混合大小写与数字">
          <Input
            type="password"
            autoComplete="new-password"
            value={pwd.next}
            placeholder="••••••••"
            onChange={(e) => setPwd((p) => ({ ...p, next: e.target.value }))}
          />
        </Field>

        {pwd.next && (
          <div className="-mt-2 mb-4 flex items-center gap-2">
            <div className="flex h-1.5 flex-1 gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`h-full flex-1 rounded-full ${
                    i < pwdStrength.level
                      ? pwdStrength.level === 1
                        ? 'bg-danger'
                        : pwdStrength.level === 2
                          ? 'bg-warning'
                          : 'bg-accent'
                      : 'bg-line'
                  }`}
                />
              ))}
            </div>
            <span className="text-xs text-ink-mute">{pwdStrength.text}</span>
          </div>
        )}

        <Field label="确认新密码">
          <Input
            type="password"
            autoComplete="new-password"
            value={pwd.confirm}
            placeholder="再输入一次"
            onChange={(e) => setPwd((p) => ({ ...p, confirm: e.target.value }))}
          />
        </Field>

        <Button onClick={handleChangePassword} disabled={!pwdReady || savingPwd}>
          {savingPwd ? '提交中…' : '修改密码'}
        </Button>
      </section>

      {/* 账号信息（只读） */}
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
                setToast({ type: 'ok', text: '用户 ID 已复制' })
              }}
            >
              复制
            </Button>
          </div>
        </Field>

        <div className="grid gap-x-4 sm:grid-cols-2">
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
        </div>

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

      {/* ---------- 头像预览 / 确认上传 ---------- */}
      <Modal
        open={cropOpen}
        onClose={() => {
          if (!uploading) {
            setCropOpen(false)
            setPreview(null)
          }
        }}
        title="确认新头像"
        maxWidth="max-w-sm"
        footer={
          <>
            <Button
              variant="ghost"
              disabled={uploading}
              onClick={() => {
                setCropOpen(false)
                setPreview(null)
              }}
            >
              取消
            </Button>
            <Button onClick={handleConfirmUpload} disabled={!preview || uploading}>
              {uploading ? '上传中…' : '确认使用'}
            </Button>
          </>
        }
      >
        {compressing || !preview ? (
          <div className="grid place-items-center py-10 text-sm text-ink-soft">
            正在压缩图片…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-6">
              <div className="text-center">
                <img
                  src={preview.dataUrl}
                  alt="头像预览"
                  className="h-28 w-28 rounded-full object-cover shadow-card"
                />
                <div className="mt-2 text-xs text-ink-mute">大图预览</div>
              </div>
              <div className="text-center">
                <img
                  src={preview.dataUrl}
                  alt="头像小图预览"
                  className="h-11 w-11 rounded-full object-cover shadow-card"
                />
                <div className="mt-2 text-xs text-ink-mute">导航栏效果</div>
              </div>
            </div>
            <div className="rounded-lg bg-canvas/40 px-3 py-2.5 text-xs text-ink-soft">
              已压缩：{formatBytes(preview.sourceBytes)} → {formatBytes(preview.bytes)}
              （{preview.size}×{preview.size}，{preview.mime.replace('image/', '').toUpperCase()}）
              {preview.sourceBytes > 0 && (
                <span className="ml-1 text-accent">
                  省 {Math.max(0, Math.round((1 - preview.bytes / preview.sourceBytes) * 100))}%
                </span>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ---------- 移除头像确认 ---------- */}
      <Modal
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        title="移除当前头像？"
        maxWidth="max-w-sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoveOpen(false)} disabled={removing}>
              取消
            </Button>
            <Button variant="danger" onClick={handleRemoveAvatar} disabled={removing}>
              {removing ? '移除中…' : '移除'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">移除后将恢复为邮箱首字母头像，可随时重新上传。</p>
      </Modal>

      {/* ---------- 退出确认 ---------- */}
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

      {/* ---------- 轻提示 ---------- */}
      {toast && (
        <div
          className={`
            fixed bottom-8 left-1/2 z-[60] -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm shadow-card-hover
            ${toast.type === 'ok' ? 'bg-ink-strong text-white' : 'bg-danger text-white'}
          `}
          role="status"
        >
          {toast.text}
        </div>
      )}
    </div>
  )
}

/** 简易密码强度：长度 + 字符种类 */
function strengthOf(pwd: string): { level: 0 | 1 | 2 | 3; text: string } {
  if (!pwd) return { level: 0, text: '' }
  let score = 0
  if (pwd.length >= 8) score++
  if (pwd.length >= 12) score++
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++
  if (/\d/.test(pwd)) score++
  if (/[^\w\s]/.test(pwd)) score++
  if (score <= 2) return { level: 1, text: '偏弱' }
  if (score <= 3) return { level: 2, text: '中等' }
  return { level: 3, text: '较强' }
}
