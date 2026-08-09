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
import {
  localAll,
  localGet,
  localPut,
  localDelete,
  type EntityTable,
} from '../lib/localDb'
import { seedFromServer, enqueueAndMaybeFlush } from '../lib/sync'

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

const TABLE: EntityTable = 'kpis'

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
    setKpis(await localAll<Kpi>(TABLE, user.id))
    setLoading(false)
    setError(null)
    try {
      await seedFromServer(TABLE, user.id)
      setKpis(await localAll<Kpi>(TABLE, user.id))
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
      .channel(`kpis:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLE,
          filter: `user_id=eq.${user.id}`,
        },
        async (payload: RealtimePostgresChangesPayload<Kpi>) => {
          if (payload.eventType === 'DELETE') {
            await localDelete(TABLE, (payload.old as { id: string }).id)
          } else {
            await localPut(TABLE, payload.new as Kpi)
          }
          setKpis(await localAll<Kpi>(TABLE, user.id))
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

  const addKpi = useCallback(
    async (input: KpiInput) => {
      if (!user) throw new Error('未登录')
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      const row: Kpi = {
        id,
        user_id: user.id,
        name: input.name.trim(),
        category: input.category,
        value: input.value,
        unit: input.unit.trim() || '',
        target: input.target,
        trend: input.trend && input.trend.length ? input.trend : [input.value],
        lower_is_better: input.lower_is_better ?? false,
        created_at: now,
        updated_at: now,
      }
      await localPut(TABLE, row)
      setKpis((prev) => [row, ...prev.filter((x) => x.id !== id)])
      await enqueueAndMaybeFlush(TABLE, 'insert', id, row)
    },
    [user],
  )

  const updateKpi = useCallback(
    async (id: string, patch: Partial<KpiInput>) => {
      const current = await localGet<Kpi>(TABLE, id)
      if (!current) return
      const now = new Date().toISOString()
      const row: Kpi = {
        ...current,
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.value !== undefined ? { value: patch.value } : {}),
        ...(patch.unit !== undefined ? { unit: patch.unit.trim() || '' } : {}),
        ...(patch.target !== undefined ? { target: patch.target } : {}),
        ...(patch.trend !== undefined
          ? { trend: patch.trend && patch.trend.length ? patch.trend : [patch.value ?? 0] }
          : {}),
        ...(patch.lower_is_better !== undefined
          ? { lower_is_better: patch.lower_is_better ?? false }
          : {}),
        updated_at: now,
      }
      await localPut(TABLE, row)
      setKpis((prev) => prev.map((x) => (x.id === id ? row : x)))
      await enqueueAndMaybeFlush(TABLE, 'update', id, row)
    },
    [],
  )

  const removeKpi = useCallback(async (id: string) => {
    await localDelete(TABLE, id)
    setKpis((prev) => prev.filter((k) => k.id !== id))
    await enqueueAndMaybeFlush(TABLE, 'delete', id)
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
