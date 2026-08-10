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
  useRef,
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

  // 清理字典脏数据：
  //  ① 同名类目重复（StrictMode 双调用 / 多标签页并发）
  //  ② 「标签」空类目孤儿（用户把「标签」改名为「标签2」后，自动建类目 effect 因依赖变更
  //     被错误重触，复制出一个空的「标签」类目——若用户已有别的非空类目则一并清理）。
  const dedupeCategories = useCallback(async () => {
    if (!user) return
    const cats = await localAll<TagCategory>(TABLE_CAT, user.id)
    if (cats.length === 0) return
    const vals = await db.tag_values.toArray()
    const valueCountByCat = new Map<string, number>()
    for (const v of vals) {
      valueCountByCat.set(v.category_id, (valueCountByCat.get(v.category_id) ?? 0) + 1)
    }

    // ① 同名去重
    const byName = new Map<string, TagCategory[]>()
    for (const c of cats) {
      const arr = byName.get(c.name) ?? []
      arr.push(c)
      byName.set(c.name, arr)
    }
    for (const group of byName.values()) {
      if (group.length <= 1) continue
      const sorted = [...group].sort((a, b) => a.created_at.localeCompare(b.created_at))
      const keep = sorted[0]
      const dups = sorted.slice(1)
      for (const d of dups) {
        await db.tag_values.where('category_id').equals(d.id).modify({ category_id: keep.id })
        await localDelete(TABLE_CAT, d.id)
        await db.outbox
          .where('table')
          .equals(TABLE_CAT)
          .and((o: { rowId: string; op: string }) => o.rowId === d.id && o.op === 'insert')
          .delete()
        await enqueueAndMaybeFlush(TABLE_CAT, 'delete', d.id)
      }
    }

    // ② 「标签」空类目孤儿清理：仅在用户已有别的非空类目时清理，避免误删新建用户的默认类目。
    const freshCats = await localAll<TagCategory>(TABLE_CAT, user.id)
    const freshVals = await db.tag_values.toArray()
    const freshCount = new Map<string, number>()
    for (const v of freshVals) {
      freshCount.set(v.category_id, (freshCount.get(v.category_id) ?? 0) + 1)
    }
    const emptyTagCat = freshCats.find(
      (c) => c.name === '标签' && (freshCount.get(c.id) ?? 0) === 0,
    )
    const hasOtherNonEmpty = freshCats.some(
      (c) => c.id !== emptyTagCat?.id && (freshCount.get(c.id) ?? 0) > 0,
    )
    if (emptyTagCat && hasOtherNonEmpty) {
      await localDelete(TABLE_CAT, emptyTagCat.id)
      await db.outbox
        .where('table')
        .equals(TABLE_CAT)
        .and((o: { rowId: string; op: string }) => o.rowId === emptyTagCat.id && o.op === 'insert')
        .delete()
      await enqueueAndMaybeFlush(TABLE_CAT, 'delete', emptyTagCat.id)
    }
  }, [user])

  const refresh = useCallback(async () => {
    if (!user) {
      setCategories([])
      setValues([])
      setLoading(false)
      return
    }
    setLoading(true)
    // 先清理历史上因竞态产生的同名「标签」重复类目
    await dedupeCategories()
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
  }, [user, dedupeCategories])

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

  // 首次使用自动建「标签」类目：以「查库判重」代替易失的 state 判重，
  // 避免 StrictMode 双调用 / 多标签页并发创建多个同名「标签」类目。
  // 用 ref 记 user.id 实现"每用户一次性"：防止 rename 后 addCategory 重建触发本 effect 重新建「标签」类目，
  // 留下空「标签」孤儿（用户把「标签」改名「标签2」后，就会出现空「标签」+「标签2」并存）。
  const autoCreatedForUserRef = useRef<string | null>(null)
  useEffect(() => {
    if (!user || loading) return
    if (autoCreatedForUserRef.current === user.id) return
    autoCreatedForUserRef.current = user.id
    void (async () => {
      const existing = await db.tag_categories
        .where('user_id')
        .equals(user.id)
        .filter((c) => c.name === '标签')
        .first()
      if (existing) return
      // 自动建"标签"类目，避免业务模块首次新增标签时阻塞
      await addCategory({ name: '标签' }).catch(() => {
        /* 极端并发下仍可能重名，忽略即可（刷新时 dedupe 兜底） */
      })
    })()
  }, [user, loading, addCategory])

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
