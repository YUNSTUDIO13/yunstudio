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
import type { Todo, TodoInput } from '../types'
import {
  db,
  localAll,
  localGet,
  localPut,
  localDelete,
  type EntityTable,
} from '../lib/localDb'
import { seedFromServer, enqueueAndMaybeFlush } from '../lib/sync'

interface TodosContextValue {
  todos: Todo[]
  loading: boolean
  error: string | null
  addTodo: (input: TodoInput) => Promise<void>
  updateTodo: (id: string, patch: Partial<TodoInput>) => Promise<void>
  toggleDone: (id: string) => Promise<void>
  removeTodo: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

const TodosContext = createContext<TodosContextValue | null>(null)

const TABLE: EntityTable = 'todos'

export function TodosProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [todos, setTodos] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 本地优先：先读 Dexie（离线立即可用），联网时再把云端数据合并进本地。
  const load = useCallback(async () => {
    if (!user) {
      setTodos([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    const local = await localAll<Todo>(TABLE, user.id)
    setTodos(local)
    setLoading(false)
    setError(null)
    // 联网时把云端数据合并进本地（首次注水 / 多端同步）；失败（离线）忽略，以本地为准
    try {
      await seedFromServer(TABLE, user.id)
      setTodos(await localAll<Todo>(TABLE, user.id))
    } catch {
      /* 离线或网络异常：本地数据已展示，无需报错 */
    }
  }, [user])

  useEffect(() => {
    load()
  }, [load])

  // Realtime：其它端/云端改动 → 合并进本地 Dexie → 刷新视图。离线时本端改动不触发此通道。
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`todos:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLE,
          filter: `user_id=eq.${user.id}`,
        },
        async (payload: RealtimePostgresChangesPayload<Todo>) => {
          if (payload.eventType === 'DELETE') {
            await localDelete(TABLE, (payload.old as { id: string }).id)
          } else {
            await localPut(TABLE, payload.new as Todo)
          }
          setTodos(await localAll<Todo>(TABLE, user.id))
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  // 断网后恢复联网：重新从云端注水（拉取其它端数据），与发件箱补传并行不冲突
  useEffect(() => {
    const onOnline = () => void load()
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline)
      return () => window.removeEventListener('online', onOnline)
    }
  }, [load])

  // 跨模块联动：待办完成 → 对应电影的观影次数 +1。
  // 仅当该电影存在于本地 Dexie 时累加；走既有 outbox 增量同步到云端。
  const bumpMovieViewCount = useCallback(async (movieId: string) => {
    const movie = await db.movies.get(movieId)
    if (!movie) return
    const now = new Date().toISOString()
    const updated: typeof movie = {
      ...movie,
      view_count: (movie.view_count ?? 0) + 1,
      updated_at: now,
    }
    await db.movies.put(updated)
    await enqueueAndMaybeFlush('movies', 'update', movieId, updated)
  }, [])

  const addTodo = useCallback(
    async (input: TodoInput) => {
      if (!user) throw new Error('未登录')
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      const row: Todo = {
        id,
        user_id: user.id,
        title: input.title.trim(),
        source_url: input.source_url || null,
        priority: input.priority,
        deadline_at: input.deadline_at || null,
        note: input.note || null,
        tag_id: input.tag_id || null,
        movie_id: input.movie_id || null, // 绑定观影电影（预约观看联动）
        counted_at: null, // 计数守卫初始为空
        done: false,
        done_at: null,
        created_at: now,
        updated_at: now,
      }
      await localPut(TABLE, row) // 本地立即写入
      setTodos((prev) => [row, ...prev.filter((x) => x.id !== id)]) // 乐观展示
      await enqueueAndMaybeFlush(TABLE, 'insert', id, row) // 入发件箱，联网即补传
    },
    [user],
  )

  const updateTodo = useCallback(
    async (id: string, patch: Partial<TodoInput>) => {
      const current = await localGet<Todo>(TABLE, id)
      if (!current) return
      const now = new Date().toISOString()
      const row: Todo = {
        ...current,
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.source_url !== undefined ? { source_url: patch.source_url || null } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.deadline_at !== undefined ? { deadline_at: patch.deadline_at || null } : {}),
        ...(patch.note !== undefined ? { note: patch.note || null } : {}),
        ...(patch.tag_id !== undefined ? { tag_id: patch.tag_id || null } : {}),
        updated_at: now,
      }
      await localPut(TABLE, row)
      setTodos((prev) => prev.map((x) => (x.id === id ? row : x)))
      await enqueueAndMaybeFlush(TABLE, 'update', id, row)
    },
    [],
  )

  const toggleDone = useCallback(
    async (id: string) => {
      const current = await localGet<Todo>(TABLE, id)
      if (!current) return
      const next = !current.done
      const now = new Date().toISOString()
      // 计数守卫：仅在"未完成→已完成"且绑定了电影且尚未计数时，打上 counted_at 并触发 +1。
      // 取消勾选：不动 counted_at（不清零）→ 再次勾选时守卫已存在，跳过 +1（不累加）。
      const shouldCount = next && !!current.movie_id && !current.counted_at
      const row: Todo = {
        ...current,
        done: next,
        done_at: next ? now : null,
        counted_at: shouldCount ? now : current.counted_at ?? null,
        updated_at: now,
      }
      await localPut(TABLE, row)
      setTodos((prev) => prev.map((x) => (x.id === id ? row : x)))
      await enqueueAndMaybeFlush(TABLE, 'update', id, row)
      // 跨模块联动：观影次数 +1（仅首次完成触发；重新预约会生成新待办故可累计）
      if (shouldCount && current.movie_id) {
        await bumpMovieViewCount(current.movie_id)
      }
    },
    [bumpMovieViewCount],
  )

  const removeTodo = useCallback(async (id: string) => {
    await localDelete(TABLE, id)
    setTodos((prev) => prev.filter((x) => x.id !== id))
    await enqueueAndMaybeFlush(TABLE, 'delete', id)
  }, [])

  return (
    <TodosContext.Provider
      value={{ todos, loading, error, addTodo, updateTodo, toggleDone, removeTodo, refresh: load }}
    >
      {children}
    </TodosContext.Provider>
  )
}

export function useTodos() {
  const ctx = useContext(TodosContext)
  if (!ctx) throw new Error('useTodos 必须在 TodosProvider 内使用')
  return ctx
}
