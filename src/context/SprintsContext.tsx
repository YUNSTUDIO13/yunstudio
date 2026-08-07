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

const TABLE = 'sprints'

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
    const { data, error: err } = await supabase
      .from(TABLE)
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (err) {
      setError(err.message)
      setSprints([])
    } else {
      setSprints((data as Sprint[]) ?? [])
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
      .channel(`sprints:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLE,
          filter: `user_id=eq.${user.id}`,
        },
        (payload: RealtimePostgresChangesPayload<Sprint>) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as Sprint
            setSprints((prev) => [row, ...prev.filter((x) => x.id !== row.id)])
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as Sprint
            setSprints((prev) => prev.map((x) => (x.id === row.id ? row : x)))
          } else if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: string }
            setSprints((prev) => prev.filter((x) => x.id !== old.id))
          }
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  const addSprint = useCallback(
    async (input: SprintInput) => {
      if (!user) throw new Error('未登录')
      const progress = Math.max(0, Math.min(100, input.progress))
      const { error: err } = await supabase.from(TABLE).insert({
        user_id: user.id,
        name: input.name.trim(),
        goal: input.goal.trim(),
        status: input.status,
        start_date: input.start_date || null,
        end_date: input.end_date || null,
        progress,
        burndown: [Math.max(1, Math.round(progress || 1))],
      })
      if (err) throw err
      await load()
    },
    [user, load],
  )

  const updateSprint = useCallback(
    async (id: string, patch: Partial<SprintInput>) => {
      const { error: err } = await supabase
        .from(TABLE)
        .update({
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.goal !== undefined ? { goal: patch.goal.trim() } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.start_date !== undefined ? { start_date: patch.start_date || null } : {}),
          ...(patch.end_date !== undefined ? { end_date: patch.end_date || null } : {}),
          ...(patch.progress != null
            ? { progress: Math.max(0, Math.min(100, patch.progress)) }
            : {}),
        })
        .eq('id', id)
      if (err) throw err
      await load()
    },
    [load],
  )

  const removeSprint = useCallback(async (id: string) => {
    const { error: err } = await supabase.from(TABLE).delete().eq('id', id)
    if (err) throw err
    setSprints((prev) => prev.filter((s) => s.id !== id))
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
