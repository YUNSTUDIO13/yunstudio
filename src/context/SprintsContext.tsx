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
import type { Sprint, SprintInput } from '../types'
import {
  localAll,
  localGet,
  localPut,
  localDelete,
  type EntityTable,
} from '../lib/localDb'
import { seedFromServer, enqueueAndMaybeFlush } from '../lib/sync'

interface SprintsContextValue {
  sprints: Sprint[]
  loading: boolean
  error: string | null
  addSprint: (input: SprintInput) => Promise<void>
  updateSprint: (id: string, patch: Partial<SprintInput>) => Promise<void>
  removeSprint: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

const SprintsContext = createContext<SprintsContextValue | null>(null)

const TABLE: EntityTable = 'sprints'

export function SprintsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [sprints, setSprints] = useState<Sprint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) {
      setSprints([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setSprints(await localAll<Sprint>(TABLE, user.id))
    setLoading(false)
    setError(null)
    try {
      await seedFromServer(TABLE, user.id)
      setSprints(await localAll<Sprint>(TABLE, user.id))
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
      .channel(`sprints:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLE,
          filter: `user_id=eq.${user.id}`,
        },
        async (payload: RealtimePostgresChangesPayload<Sprint>) => {
          if (payload.eventType === 'DELETE') {
            await localDelete(TABLE, (payload.old as { id: string }).id)
          } else {
            await localPut(TABLE, payload.new as Sprint)
          }
          setSprints(await localAll<Sprint>(TABLE, user.id))
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

  const addSprint = useCallback(
    async (input: SprintInput) => {
      if (!user) throw new Error('未登录')
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      const progress = Math.max(0, Math.min(100, input.progress))
      const row: Sprint = {
        id,
        user_id: user.id,
        name: input.name.trim(),
        goal: input.goal.trim(),
        status: input.status,
        start_date: input.start_date || null,
        end_date: input.end_date || null,
        progress,
        burndown: [Math.max(1, Math.round(progress || 1))],
        created_at: now,
        updated_at: now,
      }
      await localPut(TABLE, row)
      setSprints((prev) => [row, ...prev.filter((x) => x.id !== id)])
      await enqueueAndMaybeFlush(TABLE, 'insert', id, row)
    },
    [user],
  )

  const updateSprint = useCallback(
    async (id: string, patch: Partial<SprintInput>) => {
      const current = await localGet<Sprint>(TABLE, id)
      if (!current) return
      const now = new Date().toISOString()
      const nextProgress =
        patch.progress != null ? Math.max(0, Math.min(100, patch.progress)) : current.progress
      const row: Sprint = {
        ...current,
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.goal !== undefined ? { goal: patch.goal.trim() } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.start_date !== undefined ? { start_date: patch.start_date || null } : {}),
        ...(patch.end_date !== undefined ? { end_date: patch.end_date || null } : {}),
        ...(patch.progress != null ? { progress: nextProgress } : {}),
        updated_at: now,
      }
      await localPut(TABLE, row)
      setSprints((prev) => prev.map((x) => (x.id === id ? row : x)))
      await enqueueAndMaybeFlush(TABLE, 'update', id, row)
    },
    [],
  )

  const removeSprint = useCallback(async (id: string) => {
    await localDelete(TABLE, id)
    setSprints((prev) => prev.filter((s) => s.id !== id))
    await enqueueAndMaybeFlush(TABLE, 'delete', id)
  }, [])

  return (
    <SprintsContext.Provider
      value={{ sprints, loading, error, addSprint, updateSprint, removeSprint, refresh: load }}
    >
      {children}
    </SprintsContext.Provider>
  )
}

export function useSprints() {
  const ctx = useContext(SprintsContext)
  if (!ctx) throw new Error('useSprints 必须在 SprintsProvider 内使用')
  return ctx
}
