// 应用（Apps）—— 个人应用导航 / 书签
// 功能：
//  1. 数据列：图标 / 应用名称 / 目标 URL / 功能说明（网格卡片）
//  2. 搜索：按名称 / URL / 功能说明模糊过滤
//  3. 新增：弹窗，字段同数据列；图标优先取目标网站 favicon，加载失败回退首字
//  4. 管理态：开启后每张卡片显示编辑 / 删除；编辑复用新增逻辑；删除走确认弹窗
//  5. 点击图标直接跳转目标 URL（管理态下不跳转，避免误触）
// 数据：本地 Dexie 优先 + outbox 补传 Supabase（与其他模块一致的本地优先架构）
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Modal,
  Field,
  Input,
  Textarea,
  Button,
  ConfirmDialog,
  Card,
} from '../components/ui'
import { db } from '../lib/localDb'
import { enqueueAndMaybeFlush, seedFromServer } from '../lib/sync'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { App } from '../types'

interface Draft {
  id: string | null
  name: string
  targetUrl: string
  description: string
}

/** 由目标 URL 推导原站 favicon 地址 */
function faviconFor(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}/favicon.ico`
  } catch {
    return ''
  }
}

// 模块级本地图标缓存：appId -> true(已成功) / false(失败回退首字)
// 刷新即清空 → 重新按目标 URL 抓取 favicon；符合「图标不落库、本地缓存、清空则重新获取」
const iconCache = new Map<string, boolean>()

/** 图标：运行时按 target_url 取原站 favicon；成功存本地缓存，失败回退名称首字 */
function AppIcon({ app, size = 'h-12 w-12' }: { app: App; size?: string }) {
  const faviconUrl = useMemo(() => faviconFor(app.target_url), [app.target_url])
  const [failed, setFailed] = useState(() => iconCache.get(app.id) === false)
  if (!faviconUrl || failed) {
    return (
      <div
        className={`${size} grid shrink-0 place-items-center rounded-xl bg-accent/15 text-lg font-semibold text-accent`}
      >
        {app.name.slice(0, 1).toUpperCase()}
      </div>
    )
  }
  return (
    <img
      src={faviconUrl}
      alt={app.name}
      className={`${size} shrink-0 rounded-xl object-cover`}
      onError={() => {
        iconCache.set(app.id, false)
        setFailed(true)
      }}
      onLoad={() => {
        iconCache.set(app.id, true)
      }}
    />
  )
}

/** 预览图标（编辑弹窗内，按目标 URL 实时取 favicon） */
function PreviewIcon({ url, name, size = 'h-16 w-16' }: { url: string; name: string; size?: string }) {
  const [err, setErr] = useState(false)
  useEffect(() => setErr(false), [url])
  if (url && !err) {
    return (
      <img
        src={url}
        alt={name}
        onError={() => setErr(true)}
        className={`${size} shrink-0 rounded-2xl object-cover`}
      />
    )
  }
  return (
    <div
      className={`${size} grid shrink-0 place-items-center rounded-2xl bg-accent/15 text-2xl font-semibold text-accent`}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

export default function AppsPage() {
  const { user } = useAuth()
  const userId = user?.id ?? 'anonymous'
  const [apps, setApps] = useState<App[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [manageMode, setManageMode] = useState(false)
  const [edit, setEdit] = useState<Draft | null>(null)
  const [del, setDel] = useState<App | null>(null)
  const [busy, setBusy] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!user) {
      setApps([])
      setLoading(false)
      return
    }
    const rows = await db.apps.where('user_id').equals(userId).toArray()
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
    setApps(rows)
    setLoading(false)
  }, [user, userId])

  // 首次注水（拉云端合并进本地）：仅在线时执行
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      await seedFromServer('apps', userId)
      if (!cancelled) await reload()
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [reload, userId])

  // Realtime：其他端的增删改即时同步（apps 量小，回调内重拉全量）
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`apps:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'apps', filter: `user_id=eq.${userId}` },
        () => {
          void (async () => {
            await seedFromServer('apps', userId)
            await reload()
          })()
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, userId, reload])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return apps
    return apps.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.target_url.toLowerCase().includes(q) ||
        (a.description || '').toLowerCase().includes(q),
    )
  }, [apps, search])

  function openCreate() {
    setGlobalError(null)
    setEdit({ id: null, name: '', targetUrl: '', description: '' })
  }
  function openEdit(a: App) {
    setGlobalError(null)
    setEdit({
      id: a.id,
      name: a.name,
      targetUrl: a.target_url,
      description: a.description || '',
    })
  }

  const previewIcon = edit ? faviconFor(edit.targetUrl) : ''

  async function submit() {
    if (!edit || !user) return
    setBusy(true)
    setGlobalError(null)
    try {
      const name = edit.name.trim()
      if (!name) throw new Error('应用名称不能为空')
      const url = edit.targetUrl.trim()
      if (!url) throw new Error('目标 URL 不能为空')
      try {
        new URL(url)
      } catch {
        throw new Error('目标 URL 格式不合法（需含 http/https）')
      }
      const now = new Date().toISOString()
      let payload: App
      if (edit.id) {
        const existing = apps.find((a) => a.id === edit.id)
        payload = {
          id: edit.id,
          user_id: userId,
          name,
          target_url: url,
          description: edit.description.trim(),
          created_at: existing?.created_at ?? now,
          updated_at: now,
        }
      } else {
        payload = {
          id: crypto.randomUUID(),
          user_id: userId,
          name,
          target_url: url,
          description: edit.description.trim(),
          created_at: now,
          updated_at: now,
        }
      }
      await db.apps.put(payload)
      await enqueueAndMaybeFlush('apps', edit.id ? 'update' : 'insert', payload.id, payload)
      await reload()
      setEdit(null)
      setManageMode(false)
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!del) return
    setGlobalError(null)
    try {
      await db.apps.delete(del.id)
      await enqueueAndMaybeFlush('apps', 'delete', del.id)
      await reload()
      setDel(null)
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : String(e))
    }
  }

  function openApp(a: App) {
    if (manageMode) return // 管理态不跳转，避免误触
    window.open(a.target_url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* 顶部 */}
      <header className="flex flex-wrap items-end justify-between gap-3 glass-card p-5">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.25em] text-ink-mute">
            Workspace · 应用
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-ink-strong">应用导航</h1>
          <p className="mt-1 text-sm text-ink-soft">
            集中收纳常用系统的入口。点击图标直达目标地址；支持新增、编辑、删除，云端多端同步。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={manageMode ? 'primary' : 'soft'}
            onClick={() => setManageMode((v) => !v)}
          >
            {manageMode ? '退出管理' : '管理应用'}
          </Button>
          <Button onClick={openCreate}>新增应用</Button>
        </div>
      </header>

      {globalError ? (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {globalError}
        </div>
      ) : null}

      {/* 搜索 */}
      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索应用名称 / URL / 功能说明"
            className="flex-1"
          />
          <span className="ml-auto text-xs text-ink-mute">共 {visible.length} 个应用</span>
        </div>
      </Card>

      {/* 应用网格 */}
      {loading ? (
        <Card>
          <p className="py-12 text-center text-sm text-ink-mute">加载中…</p>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <p className="py-12 text-center text-sm text-ink-mute">
            {apps.length === 0
              ? '还没有应用。点击右上角「新增应用」开始收纳常用系统入口。'
              : '没有匹配的应用。'}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((a) => (
            <div
              key={a.id}
              className="group relative flex flex-col rounded-card glass-card p-4 transition hover:border-accent/30"
            >
              <div
                onClick={() => openApp(a)}
                className={`flex items-start gap-3 ${manageMode ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <AppIcon app={a} size="h-12 w-12" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-medium text-ink-strong">{a.name}</div>
                  <a
                    href={a.target_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate text-xs text-ink-mute transition hover:text-accent"
                    title={a.target_url}
                  >
                    {a.target_url}
                  </a>
                  {a.description ? (
                    <p className="mt-1.5 line-clamp-2 text-sm text-ink-soft">{a.description}</p>
                  ) : null}
                </div>
              </div>

              {manageMode ? (
                <div className="mt-3 flex justify-end gap-2 border-t border-line pt-3">
                  <Button variant="soft" onClick={() => openEdit(a)}>
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setDel(a)}
                    className="!text-danger hover:!bg-danger/10"
                  >
                    删除
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* 新增 / 编辑 Modal */}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? '编辑应用' : '新增应用'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              取消
            </Button>
            <Button onClick={submit} disabled={busy}>
              {edit?.id ? '保存' : '创建'}
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-4">
            {/* 图标预览 + 说明 */}
            <div className="flex items-center gap-3 rounded-xl border border-line bg-brand-soft/30 p-3">
              <PreviewIcon url={previewIcon} name={edit.name || '应用'} />
              <div className="min-w-0 text-xs text-ink-mute">
                <div className="font-medium text-ink-soft">图标预览</div>
                自动取目标网站 favicon；加载失败自动显示「{edit.name.slice(0, 1).toUpperCase() || '首字'}」兜底。图标不落库，仅本地缓存。
              </div>
            </div>

            <Field label="应用名称" error={undefined}>
              <Input
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                placeholder="如：Jira / 飞书 / 数据看板"
              />
            </Field>

            <Field label="目标 URL" hint="输入后图标会自动尝试抓取该网站 favicon">
              <Input
                value={edit.targetUrl}
                onChange={(e) => setEdit({ ...edit, targetUrl: e.target.value })}
                placeholder="https://example.com"
              />
            </Field>

            <Field label="功能说明" hint="可选，简述该应用用途">
              <Textarea
                value={edit.description}
                onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                placeholder="如：团队协作与任务跟踪"
                rows={3}
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={confirmDelete}
        title="删除应用"
        message={del ? `确定删除应用「${del.name}」？该操作不可撤销。` : ''}
        confirmText="删除"
        cancelText="取消"
        danger
      />
    </div>
  )
}
