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

const TABLE = 'todos'

export function TodosProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [todos, setTodos] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) {
      setTodos([])
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
      setTodos([])
    } else {
      setTodos((data as Todo[]) ?? [])
      setError(null)
    }
    setLoading(false)
  }, [user])

  useEffect(() => {
    load()
  }, [load])

  // Realtime：其它端改动后秒级刷新
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
        (payload: RealtimePostgresChangesPayload<Todo>) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as Todo
            setTodos((prev) => [row, ...prev.filter((x) => x.id !== row.id)])
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as Todo
            setTodos((prev) => prev.map((x) => (x.id === row.id ? row : x)))
          } else if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: string }
            setTodos((prev) => prev.filter((x) => x.id !== old.id))
          }
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  const addTodo = useCallback(
    async (input: TodoInput) => {
      if (!user) throw new Error('未登录')
      const { error: err } = await supabase.from(TABLE).insert({
        user_id: user.id,
        title: input.title.trim(),
        source_url: input.source_url || null,
        priority: input.priority,
        deadline_at: input.deadline_at || null,
        note: input.note || null,
        done: false,
        done_at: null,
      })
      if (err) throw err
      await load()
    },
    [user, load],
  )

  const updateTodo = useCallback(
    async (id: string, patch: Partial<TodoInput>) => {
      const { error: err } = await supabase
        .from(TABLE)
        .update({ ...patch })
        .eq('id', id)
      if (err) throw err
      await load()
    },
    [load],
  )

  const toggleDone = useCallback(
    async (id: string) => {
      const current = todos.find((t) => t.id === id)
      const next = !current?.done
      const { error: err } = await supabase
        .from(TABLE)
        .update({ done: next, done_at: next ? new Date().toISOString() : null })
        .eq('id', id)
      if (err) throw err
      await load()
    },
    [todos, load],
  )

  const removeTodo = useCallback(async (id: string) => {
    const { error: err } = await supabase.from(TABLE).delete().eq('id', id)
    if (err) throw err
    setTodos((prev) => prev.filter((x) => x.id !== id))
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
