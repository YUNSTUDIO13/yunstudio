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

const TABLE = 'requirements'

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
    const { data, error: err } = await supabase
      .from(TABLE)
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (err) {
      setError(err.message)
      setRequirements([])
    } else {
      setRequirements((data as Requirement[]) ?? [])
      setError(null)
    }
    setLoading(false)
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
        (payload: RealtimePostgresChangesPayload<Requirement>) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as Requirement
            setRequirements((prev) => [row, ...prev.filter((x) => x.id !== row.id)])
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as Requirement
            setRequirements((prev) => prev.map((x) => (x.id === row.id ? row : x)))
          } else if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: string }
            setRequirements((prev) => prev.filter((x) => x.id !== old.id))
          }
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  const addRequirement = useCallback(
    async (input: RequirementInput) => {
      if (!user) throw new Error('未登录')
      const { error: err } = await supabase.from(TABLE).insert({
        user_id: user.id,
        title: input.title.trim(),
        priority: input.priority,
        status: input.status,
        value_desc: input.valueDesc.trim(),
        source_url: input.sourceUrl || null,
        owner: input.owner?.trim() || null,
      })
      if (err) throw err
      await load()
    },
    [user, load],
  )

  const updateRequirement = useCallback(
    async (id: string, patch: Partial<RequirementInput>) => {
      const { error: err } = await supabase
        .from(TABLE)
        .update({
          ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
          ...(patch.valueDesc !== undefined ? { value_desc: patch.valueDesc.trim() } : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.sourceUrl !== undefined ? { source_url: patch.sourceUrl || null } : {}),
          ...(patch.owner !== undefined ? { owner: patch.owner?.trim() || null } : {}),
        })
        .eq('id', id)
      if (err) throw err
      await load()
    },
    [load],
  )

  const removeRequirement = useCallback(async (id: string) => {
    const { error: err } = await supabase.from(TABLE).delete().eq('id', id)
    if (err) throw err
    setRequirements((prev) => prev.filter((r) => r.id !== id))
  }, [])

  // 拖拽排序：当前会话内的内存重排（无持久化列；刷新后回 created_at 顺序）。
  // 如需持久化，后续给表加 sort_order 列并在 move 时写库。
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
