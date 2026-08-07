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
import type { Kpi, KpiInput } from '../types'

interface KpisContextValue {
  kpis: Kpi[]
  loading: boolean
  error: string | null
  addKpi: (input: KpiInput) => Promise<void>
  updateKpi: (id: string, patch: Partial<KpiInput>) => Promise<void>
  removeKpi: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

const KpisContext = createContext<KpisContextValue | null>(null)

const TABLE = 'kpis'

export function KpisProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [kpis, setKpis] = useState<Kpi[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) {
      setKpis([])
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
      setKpis([])
    } else {
      setKpis((data as Kpi[]) ?? [])
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
      .channel(`kpis:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLE,
          filter: `user_id=eq.${user.id}`,
        },
        (payload: RealtimePostgresChangesPayload<Kpi>) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as Kpi
            setKpis((prev) => [row, ...prev.filter((x) => x.id !== row.id)])
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as Kpi
            setKpis((prev) => prev.map((x) => (x.id === row.id ? row : x)))
          } else if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: string }
            setKpis((prev) => prev.filter((x) => x.id !== old.id))
          }
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  const addKpi = useCallback(
    async (input: KpiInput) => {
      if (!user) throw new Error('未登录')
      const { error: err } = await supabase.from(TABLE).insert({
        user_id: user.id,
        name: input.name.trim(),
        category: input.category,
        value: input.value,
        unit: input.unit.trim() || '',
        target: input.target,
        trend: input.trend && input.trend.length ? input.trend : [input.value],
        lower_is_better: input.lowerIsBetter ?? false,
      })
      if (err) throw err
      await load()
    },
    [user, load],
  )

  const updateKpi = useCallback(
    async (id: string, patch: Partial<KpiInput>) => {
      const { error: err } = await supabase
        .from(TABLE)
        .update({
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.category !== undefined ? { category: patch.category } : {}),
          ...(patch.value !== undefined ? { value: patch.value } : {}),
          ...(patch.unit !== undefined ? { unit: patch.unit.trim() || '' } : {}),
          ...(patch.target !== undefined ? { target: patch.target } : {}),
          ...(patch.trend !== undefined
            ? { trend: patch.trend && patch.trend.length ? patch.trend : [patch.value ?? 0] }
            : {}),
          ...(patch.lowerIsBetter !== undefined
            ? { lower_is_better: patch.lowerIsBetter ?? false }
            : {}),
        })
        .eq('id', id)
      if (err) throw err
      await load()
    },
    [load],
  )

  const removeKpi = useCallback(async (id: string) => {
    const { error: err } = await supabase.from(TABLE).delete().eq('id', id)
    if (err) throw err
    setKpis((prev) => prev.filter((k) => k.id !== id))
  }, [])

  return (
    <KpisContext.Provider
      value={{ kpis, loading, error, addKpi, updateKpi, removeKpi, refresh: load }}
    >
      {children}
    </KpisContext.Provider>
  )
}

export function useKpis() {
  const ctx = useContext(KpisContext)
  if (!ctx) throw new Error('useKpis 必须在 KpisProvider 内使用')
  return ctx
}
