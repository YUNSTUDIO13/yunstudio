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
import type { NewsItem, NewsInput } from '../types'

interface NewsContextValue {
  items: NewsItem[]
  loading: boolean
  error: string | null // 非空表示表未创建/网络异常等
  addNews: (input: NewsInput) => Promise<void>
  removeNews: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

const NewsContext = createContext<NewsContextValue>({
  items: [],
  loading: true,
  error: null,
  addNews: async () => {},
  removeNews: async () => {},
  refresh: async () => {},
})

const TABLE = 'news'

export function NewsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [items, setItems] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) {
      setItems([])
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
      // 多数情况是 news 表尚未在 Supabase 创建
      setError(err.message)
      setItems([])
    } else {
      setItems((data as NewsItem[]) ?? [])
      setError(null)
    }
    setLoading(false)
  }, [user])

  // 初次加载 + 切换账号
  useEffect(() => {
    load()
  }, [load])

  // Realtime：自动化推送 / 其它端改动后秒级刷新
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`news:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLE,
          filter: `user_id=eq.${user.id}`,
        },
        (payload: RealtimePostgresChangesPayload<NewsItem>) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as NewsItem
            setItems((prev) => [row, ...prev.filter((x) => x.id !== row.id)])
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as NewsItem
            setItems((prev) => prev.map((x) => (x.id === row.id ? row : x)))
          } else if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: string }
            setItems((prev) => prev.filter((x) => x.id !== old.id))
          }
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  const addNews = useCallback(
    async (input: NewsInput) => {
      if (!user) throw new Error('未登录')
      const { error: err } = await supabase.from(TABLE).insert({
        user_id: user.id,
        title: input.title,
        summary: input.summary,
        content: input.content,
        category: input.category ?? 'general',
        report_type: input.report_type ?? 'manual',
        tags: input.tags ?? [],
        source_links: input.source_links ?? [],
        period_start: input.period_start ?? null,
        period_end: input.period_end ?? null,
      })
      if (err) throw err
      await load()
    },
    [user, load],
  )

  const removeNews = useCallback(async (id: string) => {
    const { error: err } = await supabase.from(TABLE).delete().eq('id', id)
    if (err) throw err
    setItems((prev) => prev.filter((x) => x.id !== id))
  }, [])

  return (
    <NewsContext.Provider
      value={{ items, loading, error, addNews, removeNews, refresh: load }}
    >
      {children}
    </NewsContext.Provider>
  )
}

export function useNews(): NewsContextValue {
  return useContext(NewsContext)
}
