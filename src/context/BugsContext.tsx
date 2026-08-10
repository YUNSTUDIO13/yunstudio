import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import type { Bug, BugInput } from '../types'
import {
  localAll,
  localGet,
  localPut,
  localDelete,
  type EntityTable,
} from '../lib/localDb'
import { seedFromServer, enqueueAndMaybeFlush } from '../lib/sync'

interface BugsContextValue {
  bugs: Bug[]
  loading: boolean
  error: string | null
  addBug: (input: BugInput) => Promise<void>
  updateBug: (id: string, patch: Partial<BugInput>) => Promise<void>
  removeBug: (id: string) => Promise<void>
  moveBug: (fromId: string, toId: string) => void
  refresh: () => Promise<void>
}

const BugsContext = createContext<BugsContextValue | null>(null)

const TABLE: EntityTable = 'bugs'

export function BugsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [bugs, setBugs] = useState<Bug[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) {
      setBugs([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setBugs(await localAll<Bug>(TABLE, user.id))
    setLoading(false)
    setError(null)
    try {
      await seedFromServer(TABLE, user.id)
      setBugs(await localAll<Bug>(TABLE, user.id))
    } catch {
      /* 离线：以本地为准 */
    }
  }, [user])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`bugs:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLE,
          filter: `user_id=eq.${user.id}`,
        },
        async (payload: RealtimePostgresChangesPayload<Bug>) => {
          if (payload.eventType === 'DELETE') {
            await localDelete(TABLE, (payload.old as { id: string }).id)
          } else {
            await localPut(TABLE, payload.new as Bug)
          }
          setBugs(await localAll<Bug>(TABLE, user.id))
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  // 断网后恢复联网：重新从云端注水（拉取其它端数据）
  useEffect(() => {
    const onOnline = () => void load()
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline)
      return () => window.removeEventListener('online', onOnline)
    }
  }, [load])

  const addBug = useCallback(
    async (input: BugInput) => {
      if (!user) throw new Error('未登录')
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      const row: Bug = {
        id,
        user_id: user.id,
        title: input.title.trim(),
        severity: input.severity,
        priority: input.priority,
        status: input.status,
        reporter: input.reporter?.trim() || null,
        source_url: input.source_url || null,
        tag_id: input.tag_id || null,
        created_at: now,
        updated_at: now,
      }
      await localPut(TABLE, row)
      setBugs((prev) => [row, ...prev.filter((x) => x.id !== id)])
      await enqueueAndMaybeFlush(TABLE, 'insert', id, row)
    },
    [user],
  )

  const updateBug = useCallback(
    async (id: string, patch: Partial<BugInput>) => {
      const current = await localGet<Bug>(TABLE, id)
      if (!current) return
      const now = new Date().toISOString()
      const row: Bug = {
        ...current,
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.reporter !== undefined ? { reporter: patch.reporter?.trim() || null } : {}),
        ...(patch.source_url !== undefined ? { source_url: patch.source_url || null } : {}),
        ...(patch.tag_id !== undefined ? { tag_id: patch.tag_id || null } : {}),
        updated_at: now,
      }
      await localPut(TABLE, row)
      setBugs((prev) => prev.map((x) => (x.id === id ? row : x)))
      await enqueueAndMaybeFlush(TABLE, 'update', id, row)
    },
    [],
  )

  const removeBug = useCallback(async (id: string) => {
    await localDelete(TABLE, id)
    setBugs((prev) => prev.filter((b) => b.id !== id))
    await enqueueAndMaybeFlush(TABLE, 'delete', id)
  }, [])

  // 拖拽排序：当前会话内的内存重排（无持久化列；刷新后回 created_at 顺序）。
  const moveBug = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return
    setBugs((prev) => {
      const fromIdx = prev.findIndex((b) => b.id === fromId)
      const toIdx = prev.findIndex((b) => b.id === toId)
      if (fromIdx < 0 || toIdx < 0) return prev
      const next = prev.slice()
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
  }, [])

  return (
    <BugsContext.Provider
      value={{ bugs, loading, error, addBug, updateBug, removeBug, moveBug, refresh: load }}
    >
      {children}
    </BugsContext.Provider>
  )
}

export function useBugs() {
  const ctx = useContext(BugsContext)
  if (!ctx) throw new Error('useBugs 必须在 BugsProvider 内使用')
  return ctx
}
