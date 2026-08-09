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
import type { Requirement, RequirementInput } from '../types'
import {
  localAll,
  localGet,
  localPut,
  localDelete,
  type EntityTable,
} from '../lib/localDb'
import { seedFromServer, enqueueAndMaybeFlush } from '../lib/sync'

interface RequirementsContextValue {
  requirements: Requirement[]
  loading: boolean
  error: string | null
  addRequirement: (input: RequirementInput) => Promise<void>
  updateRequirement: (id: string, patch: Partial<RequirementInput>) => Promise<void>
  removeRequirement: (id: string) => Promise<void>
  moveRequirement: (fromId: string, toId: string) => void
  refresh: () => Promise<void>
}

const RequirementsContext = createContext<RequirementsContextValue | null>(null)

const TABLE: EntityTable = 'requirements'

export function RequirementsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) {
      setRequirements([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setRequirements(await localAll<Requirement>(TABLE, user.id))
    setLoading(false)
    setError(null)
    try {
      await seedFromServer(TABLE, user.id)
      setRequirements(await localAll<Requirement>(TABLE, user.id))
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
      .channel(`requirements:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLE,
          filter: `user_id=eq.${user.id}`,
        },
        async (payload: RealtimePostgresChangesPayload<Requirement>) => {
          if (payload.eventType === 'DELETE') {
            await localDelete(TABLE, (payload.old as { id: string }).id)
          } else {
            await localPut(TABLE, payload.new as Requirement)
          }
          setRequirements(await localAll<Requirement>(TABLE, user.id))
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

  const addRequirement = useCallback(
    async (input: RequirementInput) => {
      if (!user) throw new Error('未登录')
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      const row: Requirement = {
        id,
        user_id: user.id,
        title: input.title.trim(),
        priority: input.priority,
        status: input.status,
        value_desc: input.value_desc.trim(),
        source_url: input.source_url || null,
        owner: input.owner?.trim() || null,
        created_at: now,
        updated_at: now,
      }
      await localPut(TABLE, row)
      setRequirements((prev) => [row, ...prev.filter((x) => x.id !== id)])
      await enqueueAndMaybeFlush(TABLE, 'insert', id, row)
    },
    [user],
  )

  const updateRequirement = useCallback(
    async (id: string, patch: Partial<RequirementInput>) => {
      const current = await localGet<Requirement>(TABLE, id)
      if (!current) return
      const now = new Date().toISOString()
      const row: Requirement = {
        ...current,
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.value_desc !== undefined ? { value_desc: patch.value_desc.trim() } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.source_url !== undefined ? { source_url: patch.source_url || null } : {}),
        ...(patch.owner !== undefined ? { owner: patch.owner?.trim() || null } : {}),
        updated_at: now,
      }
      await localPut(TABLE, row)
      setRequirements((prev) => prev.map((x) => (x.id === id ? row : x)))
      await enqueueAndMaybeFlush(TABLE, 'update', id, row)
    },
    [],
  )

  const removeRequirement = useCallback(async (id: string) => {
    await localDelete(TABLE, id)
    setRequirements((prev) => prev.filter((r) => r.id !== id))
    await enqueueAndMaybeFlush(TABLE, 'delete', id)
  }, [])

  // 拖拽排序：当前会话内的内存重排（无持久化列；刷新后回 created_at 顺序）。
  const moveRequirement = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return
    setRequirements((prev) => {
      const fromIdx = prev.findIndex((r) => r.id === fromId)
      const toIdx = prev.findIndex((r) => r.id === toId)
      if (fromIdx === -1 || toIdx === -1) return prev
      const next = prev.slice()
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
  }, [])

  return (
    <RequirementsContext.Provider
      value={{ requirements, loading, error, addRequirement, updateRequirement, removeRequirement, moveRequirement, refresh: load }}
    >
      {children}
    </RequirementsContext.Provider>
  )
}

export function useRequirements() {
  const ctx = useContext(RequirementsContext)
  if (!ctx) throw new Error('useRequirements 必须在 RequirementsProvider 内使用')
  return ctx
}
