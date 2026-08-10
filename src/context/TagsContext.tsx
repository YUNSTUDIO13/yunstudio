// 字典管理 Context（本地优先 + outbox 补传）
// 设计：
//   - categories（字段名）+ values（枚举值）两级。
//   - 与既有 5 实体的 outbox 体系一致：本地先写 + enqueueOp → 联网补传 supabase.upsert。
//   - 引用计数：value 删除前查 4 张业务表 tag_id 列 count。任一非零 → 拦截。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import type { TagCategory, TagValue, TagCategoryInput, TagValueInput } from '../types'
import {
  localAll,
  localPut,
  localDelete,
  db,
  type EntityTable,
} from '../lib/localDb'
import { seedFromServer, enqueueAndMaybeFlush } from '../lib/sync'

interface TagsContextValue {
  categories: TagCategory[]
  values: TagValue[]
  loading: boolean
  refresh: () => Promise<void>

  // 字典面板用
  addCategory: (input: TagCategoryInput) => Promise<TagCategory>
  renameCategory: (id: string, name: string) => Promise<void>
  removeCategoryIfNoReferences: (id: string) => Promise<void>
  addValue: (input: TagValueInput) => Promise<TagValue>
  removeValueIfNoReferences: (id: string) => Promise<void>
  /** 检查某 value_id 在 4 业务表中的引用总数（任意引用即不可删） */
  countReferences: (valueId: string) => Promise<number>

  // 业务模块用
  categoryByName: (name: string) => TagCategory | undefined
  valuesByCategoryId: (categoryId: string) => TagValue[]
  valueById: (id: string | null | undefined) => TagValue | undefined
}

const TagsContext = createContext<TagsContextValue | null>(null)

const TABLE_CAT: EntityTable = 'tag_categories'
const TABLE_VAL: EntityTable = 'tag_values'

/** 4 张业务表名（引用计数目标） */
const REF_TABLES = ['todos', 'requirements', 'sprints', 'bugs'] as const

export function TagsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [categories, setCategories] = useState<TagCategory[]>([])
  const [values, setValues] = useState<TagValue[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!user) {
      setCategories([])
      setValues([])
      setLoading(false)
      return
    }
    setLoading(true)
    // 本地先读
    const [cats, vals] = await Promise.all([
      localAll<TagCategory>(TABLE_CAT, user.id),
      // values 没有 user_id 索引，需要全量拉后过滤；体量小不优化
      db.tag_values.toArray(),
    ])
    const visibleVals = user
      ? vals.filter((v) => cats.some((c) => c.id === v.category_id))
      : []
    setCategories(cats.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')))
    setValues(visibleVals.sort((a, b) => a.value.localeCompare(b.value, 'zh-CN')))
    setLoading(false)
    try {
      await Promise.all([
        seedFromServer(TABLE_CAT, user.id),
        // tag_values 没 user_id 列，单独拉并按当前用户的 categories 过滤
        seedValues(),
      ])
      const [cats2, vals2] = await Promise.all([
        localAll<TagCategory>(TABLE_CAT, user.id),
        db.tag_values.toArray(),
      ])
      setCategories(cats2.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')))
      const visVals2 = vals2.filter((v) => cats2.some((c) => c.id === v.category_id))
      setValues(visVals2.sort((a, b) => a.value.localeCompare(b.value, 'zh-CN')))
    } catch {
      /* 离线或网络异常忽略 */
    }
  }, [user])

  const seedValues = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    const { data, error } = await supabase.from(TABLE_VAL).select('*')
    if (error || !data) return
    const rows = data as unknown as TagValue[]
    const skipIds = await pendingRowIdsValues()
    const toPut = rows.filter((r) => !skipIds.has(r.id))
    if (toPut.length) await db.tag_values.bulkPut(toPut)
  }, [])

  const pendingRowIdsValues = useCallback(async (): Promise<Set<string>> => {
    const ops = await db.outbox.where('table').equals(TABLE_VAL).toArray()
    return new Set(ops.map((o) => o.rowId))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Realtime：分类
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`tag_categories:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLE_CAT,
          filter: `user_id=eq.${user.id}`,
        },
        async (payload: RealtimePostgresChangesPayload<TagCategory>) => {
          if (payload.eventType === 'DELETE') {
            await localDelete(TABLE_CAT, (payload.old as { id: string }).id)
          } else {
            await localPut(TABLE_CAT, payload.new as TagCategory)
          }
          refresh()
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, refresh])

  // Realtime：值（按 category_id 过滤受限，遂全量拉再过滤）
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`tag_values:all`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLE_VAL,
        },
        async () => {
          // 任一变化就 refresh（数据量小，简单可靠）
          try {
            await seedValues()
            refresh()
          } catch {
            /* ignore */
          }
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, refresh])

  // 引用计数（4 张业务表的 tag_id 列 count 求和）
  const countReferences = useCallback(async (valueId: string): Promise<number> => {
    let total = 0
    for (const t of REF_TABLES) {
      const { count } = await supabase
        .from(t)
        .select('id', { count: 'exact', head: true })
        .eq('tag_id', valueId)
      total += count ?? 0
    }
    return total
  }, [])

  // ============= CRUD =============

  const addCategory = useCallback(
    async (input: TagCategoryInput) => {
      if (!user) throw new Error('未登录')
      const name = input.name.trim()
      if (!name) throw new Error('字段名不能为空')
      // 前端去重：同名字段名同用户不可重
      if (categories.some((c) => c.name === name)) {
        throw new Error(`字段名「${name}」已存在`)
      }
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      const row: TagCategory = {
        id,
        user_id: user.id,
        name,
        created_at: now,
        updated_at: now,
      }
      await localPut(TABLE_CAT, row)
      setCategories((prev) =>
        [...prev, row].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
      )
      await enqueueAndMaybeFlush(TABLE_CAT, 'insert', id, row)
      return row
    },
    [user, categories],
  )

  const renameCategory = useCallback(
    async (id: string, name: string) => {
      const n = name.trim()
      if (!n) throw new Error('字段名不能为空')
      const current = await db.tag_categories.get(id)
      if (!current) return
      if (categories.some((c) => c.id !== id && c.name === n)) {
        throw new Error(`字段名「${n}」已存在`)
      }
      const now = new Date().toISOString()
      const row: TagCategory = { ...current, name: n, updated_at: now }
      await localPut(TABLE_CAT, row)
      setCategories((prev) =>
        prev.map((c) => (c.id === id ? row : c)).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
      )
      await enqueueAndMaybeFlush(TABLE_CAT, 'update', id, row)
    },
    [categories],
  )

  /** 仅在"该 category 下所有 value 都无引用"时可删 */
  const removeCategoryIfNoReferences = useCallback(
    async (id: string) => {
      const cat = categories.find((c) => c.id === id)
      if (!cat) return
      const vals = values.filter((v) => v.category_id === id)
      for (const v of vals) {
        const refs = await countReferences(v.id)
        if (refs > 0) {
          throw new Error(
            `字段名「${cat.name}」下的枚举值「${v.value}」还被 ${refs} 条业务数据引用，请先删除或替换。`,
          )
        }
      }
      // 先删 values（顺手做，但 DB ON DELETE CASCADE 已自动删；这里幂等写本地）
      for (const v of vals) {
        await localDelete(TABLE_VAL, v.id)
        await enqueueAndMaybeFlush(TABLE_VAL, 'delete', v.id)
      }
      // 再删 category（DB ON DELETE CASCADE 会清掉值；本地独立）
      await localDelete(TABLE_CAT, id)
      await enqueueAndMaybeFlush(TABLE_CAT, 'delete', id)
      setCategories((prev) => prev.filter((c) => c.id !== id))
      setValues((prev) => prev.filter((v) => v.category_id !== id))
    },
    [categories, values, countReferences],
  )

  const addValue = useCallback(
    async (input: TagValueInput) => {
      const value = input.value.trim()
      if (!value) throw new Error('枚举值不能为空')
      if (values.some((v) => v.category_id === input.category_id && v.value === value)) {
        throw new Error(`枚举值「${value}」已存在`)
      }
      const cat = categories.find((c) => c.id === input.category_id)
      if (!cat) throw new Error('字段名不存在')
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      const row: TagValue = {
        id,
        category_id: input.category_id,
        value,
        created_at: now,
        updated_at: now,
      }
      await localPut(TABLE_VAL, row)
      setValues((prev) =>
        [...prev, row].sort((a, b) => a.value.localeCompare(b.value, 'zh-CN')),
      )
      await enqueueAndMaybeFlush(TABLE_VAL, 'insert', id, row)
      return row
    },
    [values, categories],
  )

  const removeValueIfNoReferences = useCallback(
    async (id: string) => {
      const v = values.find((x) => x.id === id)
      if (!v) return
      const refs = await countReferences(id)
      if (refs > 0) {
        throw new Error(`枚举值「${v.value}」还被 ${refs} 条业务数据引用，请先替换或删除对应数据。`)
      }
      await localDelete(TABLE_VAL, id)
      await enqueueAndMaybeFlush(TABLE_VAL, 'delete', id)
      setValues((prev) => prev.filter((x) => x.id !== id))
    },
    [values, countReferences],
  )

  // ============= 派生 =============

  const categoryByName = useCallback(
    (name: string) => categories.find((c) => c.name === name),
    [categories],
  )

  const valuesByCategoryId = useCallback(
    (categoryId: string) => values.filter((v) => v.category_id === categoryId),
    [values],
  )

  const valueById = useCallback(
    (id: string | null | undefined) => (id ? values.find((v) => v.id === id) : undefined),
    [values],
  )

  // 默认 category（首次使用"标签"字段时若不存在则建）
  useEffect(() => {
    if (!user || loading) return
    if (categories.length === 0) {
      // 自动建"标签"类目，避免业务模块首次新增标签时阻塞
      void addCategory({ name: '标签' }).catch(() => {
        /* 可能并发触发 addCategory 时第二个会因重名报错，忽略 */
      })
    }
  }, [user, loading, categories.length, addCategory])

  const ctx = useMemo<TagsContextValue>(
    () => ({
      categories,
      values,
      loading,
      refresh,
      addCategory,
      renameCategory,
      removeCategoryIfNoReferences,
      addValue,
      removeValueIfNoReferences,
      countReferences,
      categoryByName,
      valuesByCategoryId,
      valueById,
    }),
    [
      categories,
      values,
      loading,
      refresh,
      addCategory,
      renameCategory,
      removeCategoryIfNoReferences,
      addValue,
      removeValueIfNoReferences,
      countReferences,
      categoryByName,
      valuesByCategoryId,
      valueById,
    ],
  )

  return <TagsContext.Provider value={ctx}>{children}</TagsContext.Provider>
}

export function useTags() {
  const ctx = useContext(TagsContext)
  if (!ctx) throw new Error('useTags 必须在 TagsProvider 内使用')
  return ctx
}
