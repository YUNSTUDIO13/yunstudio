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

const TABLE = 'bugs'

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
    const { data, error: err } = await supabase
      .from(TABLE)
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (err) {
      setError(err.message)
      setBugs([])
    } else {
      setBugs((data as Bug[]) ?? [])
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
      .channel(`bugs:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLE,
          filter: `user_id=eq.${user.id}`,
        },
        (payload: RealtimePostgresChangesPayload<Bug>) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as Bug
            setBugs((prev) => [row, ...prev.filter((x) => x.id !== row.id)])
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as Bug
            setBugs((prev) => prev.map((x) => (x.id === row.id ? row : x)))
          } else if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: string }
            setBugs((prev) => prev.filter((x) => x.id !== old.id))
          }
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  const addBug = useCallback(
    async (input: BugInput) => {
      if (!user) throw new Error('未登录')
      const { error: err } = await supabase.from(TABLE).insert({
        user_id: user.id,
        title: input.title.trim(),
        severity: input.severity,
        priority: input.priority,
        status: input.status,
        reporter: input.reporter?.trim() || null,
        source_url: input.sourceUrl || null,
      })
      if (err) throw err
      await load()
    },
    [user, load],
  )

  const updateBug = useCallback(
    async (id: string, patch: Partial<BugInput>) => {
      const { error: err } = await supabase
        .from(TABLE)
        .update({
          ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
          ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.reporter !== undefined ? { reporter: patch.reporter?.trim() || null } : {}),
          ...(patch.sourceUrl !== undefined ? { source_url: patch.sourceUrl || null } : {}),
        })
        .eq('id', id)
      if (err) throw err
      await load()
    },
    [load],
  )

  const removeBug = useCallback(async (id: string) => {
    const { error: err } = await supabase.from(TABLE).delete().eq('id', id)
    if (err) throw err
    setBugs((prev) => prev.filter((b) => b.id !== id))
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
