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
  localDelete,
  localGet,
  localPut,
  getClearedNotifKeys,
  addClearedNotifKeys,
  type EntityTable,
} from '../lib/localDb'
import { seedFromServer, enqueueAndMaybeFlush } from '../lib/sync'

interface NotificationsContextValue {
  notifications: Notification[]
  unreadCount: number
  loading: boolean
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  /** 清空全部通知（本地删除 + 入队补传云端） */
  clearAll: () => Promise<void>
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

/**
 * 通知去重唯一键：实体类型 + 实体 id + 该次截止时间快照。
 * 同一条待办、同一个截止时间，全生命周期只应存在一条通知。
 */
function notifKey(n: {
  entity_type: Notification['entity_type']
  entity_id: string
  deadline_at: string
}): string {
  return `${n.entity_type}:${n.entity_id}:${n.deadline_at}`
}

/**
 * 清理历史遗留重复：旧扫描逻辑「已读后再次到期重建未读」会让同一待办堆出多条。
 * 同键仅保留最早的一条（即首次提醒），已读状态在同键内合并（任一已读 ⇒ 保留条已读）。
 * 其余条目本地删除并入队 delete 补传云端，保证多端一致。
 */
async function dedupeExisting(userId: string): Promise<number> {
  const all = await localAll<Notification>(TABLE, userId)
  const groups = new Map<string, Notification[]>()
  for (const n of all) {
    const key = notifKey(n)
    const arr = groups.get(key)
    if (arr) arr.push(n)
    else groups.set(key, [n])
  }
  let removed = 0
  for (const list of groups.values()) {
    if (list.length < 2) continue
    // 最早创建的一条作为保留项
    list.sort((a, b) => a.created_at.localeCompare(b.created_at))
    const [keep, ...dups] = list
    // 已读状态合并：组内任一已读则保留条视为已读（取最早的 read_at）
    const readTimes = list.map((n) => n.read_at).filter((v): v is string => !!v)
    if (readTimes.length > 0 && !keep.read_at) {
      readTimes.sort()
      const merged: Notification = {
        ...keep,
        read_at: readTimes[0],
        updated_at: new Date().toISOString(),
      }
      await localPut(TABLE, merged)
      await enqueueAndMaybeFlush(TABLE, 'update', merged.id, merged)
    }
    for (const d of dups) {
      await localDelete(TABLE, d.id)
      await enqueueAndMaybeFlush(TABLE, 'delete', d.id)
      removed++
    }
  }
  return removed
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { todos } = useTodos()
  const { sprints } = useSprints()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  // 防重入：scanDueEntities 60s interval 与用户主动刷新不应同时入队
  const scanningRef = useRef(false)

  /**
   * 加载：本地优先，联网再注水。
   * ⚠️ 根治「刷新丢失」：seedFromServer 下行用 mergeServerIntoLocal 的 bulkPut 整行覆盖本地
   *    Dexie。通知的「已读(read_at)」「已清除(cleared_notif_keys)」是用户本地行为，若上行
   *    （markRead/clearAll 的 outbox flush）因弱网/时序未把状态推上云端，下行就会用云端旧值
   *    （read_at=null / 行仍在）把本地打回原形 —— 表现为「刷新必现」。
   *    故下行合并后必须本地优先恢复：① 云端 read_at 空但本地已读 → 保留本地 read_at；
   *    ② 云端尚未删除的「已清除」行被拉回 → 按 clearedKeys 剔除，绝不重建。
   */
  const load = useCallback(async () => {
    if (!user) {
      setNotifications([])
      setLoading(false)
      return
    }
    // 快照：记录下行覆盖前的本地已读 + 已清除键，用于下行后本地优先恢复
    const before = await loadLocal(user.id)
    const beforeById = new Map(before.map((n) => [n.id, n]))
    const clearedKeys = await getClearedNotifKeys()
    setNotifications(before)
    setLoading(false)
    try {
      await seedFromServer(TABLE, user.id)
      const after = await localAll<Notification>(TABLE, user.id)
      // ① 恢复本地已读：云端 read_at 为空但本地原本已读 → 用本地快照回填（本地优先）
      for (const n of after) {
        const prev = beforeById.get(n.id)
        if (prev?.read_at && !n.read_at) {
          await localPut(TABLE, {
            ...n,
            read_at: prev.read_at,
            updated_at: prev.updated_at ?? n.updated_at,
          })
        }
      }
      // ② 剔除下行拉回的「已清除」行（云端 delete 尚未到达时）
      for (const n of after) {
        if (clearedKeys.has(notifKey(n))) await localDelete(TABLE, n.id)
      }
      const finalLocal = (await loadLocal(user.id)).filter(
        (n) => !clearedKeys.has(notifKey(n)),
      )
      setNotifications(finalLocal)
    } catch {
      /* 离线或网络异常：本地数据已展示，无需报错 */
      setNotifications(before.filter((n) => !clearedKeys.has(notifKey(n))))
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
            const oldRow = payload.old as Partial<Notification>
            const id = oldRow.id
            // 跨端"清除"语义同步：任何设备一键清除后，云端删除事件会广播到所有设备，
            // 收方在本地 cleared_notif_keys 补一条该键，本机的 60s 扫描就不会再把它建回来。
            if (oldRow.entity_type && oldRow.entity_id && oldRow.deadline_at) {
              try {
                await addClearedNotifKeys([
                  notifKey({
                    entity_type: oldRow.entity_type,
                    entity_id: oldRow.entity_id,
                    deadline_at: oldRow.deadline_at,
                  }),
                ])
              } catch {
                /* 写 cleared 失败不影响主流程 */
              }
            }
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
   * 去重契约（用户要求：读过就别再吵；清掉就别再回）：
   *   唯一键 = entity_type:entity_id:deadline_at
   *   1) 命中「本地已有通知（含已读）」→ 跳过；
   *   2) 命中「cleared_notif_keys（用户已一键清除）」→ 跳过；
   *   ⇒ 同一待办的同一截止时间，全生命周期只通知一次；
   *      标记已读后不会重新建；一键清除后 60s 扫描也不会再把它建回来。
   *   ⇒ 若用户改了截止时间，键变化，属于新的到期事件，允许再提醒一次（符合直觉）。
   * 返回新建数量（供调试 / 测试）。
   */
  const scanDueEntities = useCallback(async (): Promise<number> => {
    if (!user) return 0
    if (scanningRef.current) return 0
    scanningRef.current = true
    try {
      const now = Date.now()
      const nowIso = new Date(now).toISOString()
      // 先清理历史遗留的重复条目（旧逻辑「已读后重建」制造的噪音）
      const removed = await dedupeExisting(user.id)
      if (removed > 0) setNotifications(await loadLocal(user.id))
      const localExisting = await localAll<Notification>(TABLE, user.id)
      // 用户已"一键清除"过的键集合（持久化在 Dexie，跨刷新、跨会话都生效）
      const clearedKeys = await getClearedNotifKeys()

      // 已通知过的键集合（含已读）——命中即跳过，杜绝重复轰炸
      const notifiedKeys = new Set<string>(localExisting.map(notifKey))

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
        const key = notifKey(e)
        if (clearedKeys.has(key)) continue // 用户已一键清除过 → 永不重建
        if (notifiedKeys.has(key)) continue // 已通知过（含已读）→ 永不重复
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
        notifiedKeys.add(key)
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

  /** 一键清空：本地逐条删除并入队补传；同时把"已清键"持久化到 cleared_notif_keys，
   *  阻断 60s 兜底扫描把刚清掉的通知又建回来。 */
  const clearAll = useCallback(async () => {
    if (!user) return
    const all = await localAll<Notification>(TABLE, user.id)
    if (!all.length) return
    // 先把要清的键全部记录（不依赖后面的删除是否成功，确保扫描不会重建）
    const keys = all.map(notifKey)
    await addClearedNotifKeys(keys)
    for (const n of all) {
      await localDelete(TABLE, n.id)
      await enqueueAndMaybeFlush(TABLE, 'delete', n.id)
    }
    setNotifications([])
  }, [user])

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        markRead,
        markAllRead,
        clearAll,
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
