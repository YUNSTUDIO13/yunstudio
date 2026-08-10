// 通知中心：实体截止时间到点时建一条未读通知。
// 范围：todos（deadline_at）+ sprints（end_date）。
// 已完成/已上线/已取消的实体到期不通知。
// 设计：与 5 业务实体一致——本地优先（Dexie）+ outbox 补传 + Realtime 监听。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { useTodos } from './TodosContext'
import { useSprints } from './SprintsContext'
import type { Notification } from '../types'
import {
  localAll,
  localGet,
  localPut,
  type EntityTable,
} from '../lib/localDb'
import { seedFromServer, enqueueAndMaybeFlush } from '../lib/sync'

interface NotificationsContextValue {
  notifications: Notification[]
  unreadCount: number
  loading: boolean
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  /** 扫描 todos/sprints 中已到期且未完成的实体，建未读通知（去重） */
  scanDueEntities: () => Promise<number>
  refresh: () => Promise<void>
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null)
const TABLE: EntityTable = 'notifications'

/** 取本地所有通知（含已读未读），按 created_at 倒序 */
async function loadLocal(userId: string): Promise<Notification[]> {
  const all = await localAll<Notification>(TABLE, userId)
  return all.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { todos } = useTodos()
  const { sprints } = useSprints()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  // 防重入：scanDueEntities 60s interval 与用户主动刷新不应同时入队
  const scanningRef = useRef(false)

  /** 加载：本地优先，联网再注水 */
  const load = useCallback(async () => {
    if (!user) {
      setNotifications([])
      setLoading(false)
      return
    }
    const local = await loadLocal(user.id)
    setNotifications(local)
    setLoading(false)
    try {
      await seedFromServer(TABLE, user.id)
      setNotifications(await loadLocal(user.id))
    } catch {
      /* 离线或网络异常：本地数据已展示，无需报错 */
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  /** Realtime：跨端实时同步通知列表 */
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLE,
          filter: `user_id=eq.${user.id}`,
        },
        async (payload: RealtimePostgresChangesPayload<Notification>) => {
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id: string }).id
            // 直接从内存里删（不依赖 db）——避免冲突
            setNotifications((prev) => prev.filter((n) => n.id !== id))
          } else {
            const row = payload.new as Notification
            setNotifications((prev) => {
              const next = prev.filter((n) => n.id !== row.id)
              next.unshift(row)
              return next.sort((a, b) => b.created_at.localeCompare(a.created_at))
            })
            // 持久化进本地（其他设备用）；upsert 幂等
            await localPut(TABLE, row)
          }
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user])

  /** 联网恢复 → 重注水 */
  useEffect(() => {
    const onOnline = () => void load()
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline)
      return () => window.removeEventListener('online', onOnline)
    }
  }, [load])

  /**
   * 扫描 todos（deadline_at ≤ now 且未完成）+ sprints（end_date ≤ now 且非终态）
   * 对每个"已到期且未通知"的实体建一条未读通知；同一实体至多一条未读（标记已读后可再次到期再建）。
   * 返回新建数量（供调试 / 测试）。已读→取消已读状态由 UI 层处理（markRead）。
   */
  const scanDueEntities = useCallback(async (): Promise<number> => {
    if (!user) return 0
    if (scanningRef.current) return 0
    scanningRef.current = true
    try {
      const now = Date.now()
      const nowIso = new Date(now).toISOString()
      const localExisting = await localAll<Notification>(TABLE, user.id)

      // 按实体键去重：已有未读同实体 → 跳过；已有已读同实体 → 重建未读（用户已读后再次到期）
      const hasUnreadKey = new Set<string>()
      const hasReadKey = new Set<string>()
      for (const n of localExisting) {
        const key = `${n.entity_type}:${n.entity_id}`
        if (n.read_at) hasReadKey.add(key)
        else hasUnreadKey.add(key)
      }

      // 收集到期实体
      const due: Array<{
        entity_type: 'todo' | 'sprint'
        entity_id: string
        entity_title: string
        deadline_at: string
      }> = []

      for (const t of todos) {
        if (t.done) continue
        if (!t.deadline_at) continue
        const tDead = Date.parse(t.deadline_at)
        if (Number.isFinite(tDead) && tDead <= now) {
          due.push({
            entity_type: 'todo',
            entity_id: t.id,
            entity_title: t.title || '（无标题）',
            deadline_at: t.deadline_at,
          })
        }
      }

      for (const s of sprints) {
        if (s.status === 'done' || s.status === 'cancelled') continue
        if (!s.end_date) continue
        const sEnd = Date.parse(s.end_date)
        if (Number.isFinite(sEnd) && sEnd <= now) {
          due.push({
            entity_type: 'sprint',
            entity_id: s.id,
            entity_title: s.name || '（无标题）',
            deadline_at: s.end_date,
          })
        }
      }

      let created = 0
      for (const e of due) {
        const key = `${e.entity_type}:${e.entity_id}`
        if (hasUnreadKey.has(key)) continue // 已有未读 → 不重复
        // 若该实体之前已经被通知过（即在已读列表中），本次到期重新建一条
        const row: Notification = {
          id: crypto.randomUUID(),
          user_id: user.id,
          entity_type: e.entity_type,
          entity_id: e.entity_id,
          entity_title: e.entity_title,
          deadline_at: e.deadline_at,
          kind: 'expired',
          read_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        }
        await localPut(TABLE, row)
        await enqueueAndMaybeFlush(TABLE, 'insert', row.id, row)
        setNotifications((prev) =>
          [row, ...prev.filter((n) => n.id !== row.id)].sort((a, b) =>
            b.created_at.localeCompare(a.created_at),
          ),
        )
        created++
        hasUnreadKey.add(key)
      }
      return created
    } finally {
      scanningRef.current = false
    }
  }, [user, todos, sprints])

  /** 定时扫描 + 实体变化时扫描 */
  useEffect(() => {
    if (!user) return
    // 挂载即扫一次
    void scanDueEntities()
    // 60s 兜底（防止 setInterval 之外的因素）
    if (typeof window !== 'undefined') {
      const t = window.setInterval(() => {
        void scanDueEntities()
      }, 60000)
      return () => window.clearInterval(t)
    }
  }, [user, scanDueEntities])

  /** 实体数据变化（来自 todos/sprints 列表）→ 扫一次 */
  useEffect(() => {
    if (!user) return
    void scanDueEntities()
  }, [user, todos, sprints, scanDueEntities])

  /** 联网恢复 → 扫一次 */
  useEffect(() => {
    const onOnline = () => void scanDueEntities()
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline)
      return () => window.removeEventListener('online', onOnline)
    }
  }, [scanDueEntities])

  const markRead = useCallback(
    async (id: string) => {
      const current = await localGet<Notification>(TABLE, id)
      if (!current) return
      const nowIso = new Date().toISOString()
      const row: Notification = {
        ...current,
        read_at: nowIso,
        updated_at: nowIso,
      }
      await localPut(TABLE, row)
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? row : n)),
      )
      await enqueueAndMaybeFlush(TABLE, 'update', id, row)
    },
    [],
  )

  const markAllRead = useCallback(async () => {
    if (!user) return
    const nowIso = new Date().toISOString()
    const updates = notifications
      .filter((n) => !n.read_at)
      .map((n) => ({
        ...n,
        read_at: nowIso,
        updated_at: nowIso,
      }))
    if (!updates.length) return
    // 一次性批量 upsert 本地
    for (const row of updates) {
      await localPut(TABLE, row)
      await enqueueAndMaybeFlush(TABLE, 'update', row.id, row)
    }
    setNotifications((prev) =>
      prev.map((n) => (n.read_at ? n : { ...n, read_at: nowIso, updated_at: nowIso })),
    )
  }, [user, notifications])

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read_at).length,
    [notifications],
  )

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        markRead,
        markAllRead,
        scanDueEntities,
        refresh: load,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications 必须在 NotificationsProvider 内使用')
  return ctx
}
