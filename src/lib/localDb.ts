// 本地优先数据层（离线可用）
// 用 Dexie(IndexedDB) 作为 UI 的"唯一数据源"：离线时所有读写都在本地完成，
// 联网后由 sync.ts 把本地"发件箱(outbox)"逐条补传到 Supabase。
// 手机 / PC 共用同一套浏览器代码，一次实现两端生效。
import Dexie, { type Table } from 'dexie'
import type {
  Todo,
  Requirement,
  Bug,
  Sprint,
  Notification,
  TagCategory,
  TagValue,
  App,
  Movie,
} from '../types'

export type EntityTable =
  | 'todos'
  | 'requirements'
  | 'bugs'
  | 'sprints'
  | 'notifications'
  | 'tag_categories'
  | 'tag_values'
  | 'apps'
  | 'movies'

export type SyncOpType = 'insert' | 'update' | 'delete'

/** 发件箱中的一条待同步操作 */
export interface OutboxOp {
  id: string // 操作自身 id（uuid）
  table: EntityTable
  op: SyncOpType
  rowId: string // 目标实体 id
  payload?: unknown // insert/update 时的完整行（delete 不需要）
  createdAt: string
  attempts: number
}

interface LocalDB extends Dexie {
  todos: Table<Todo, string>
  requirements: Table<Requirement, string>
  bugs: Table<Bug, string>
  sprints: Table<Sprint, string>
  notifications: Table<Notification, string>
  tag_categories: Table<TagCategory, string>
  tag_values: Table<TagValue, string>
  /** 用户已"一键清除"过的通知唯一键（entity_type:entity_id:deadline_at）
   *  用于阻断 60s 兜底扫描把刚清掉的通知又建回来。仅本机语义，不上云。 */
  cleared_notif_keys: Table<{ key: string; cleared_at: string }, string>
  apps: Table<App, string>
  movies: Table<Movie, string>
  outbox: Table<OutboxOp, string>
}

export const db = new Dexie('yunstudio-local') as LocalDB

db.version(2).stores({
  // 主键 id；user_id / updated_at 建索引便于按用户过滤与排序
  todos: 'id, user_id, updated_at',
  requirements: 'id, user_id, updated_at',
  bugs: 'id, user_id, updated_at',
  sprints: 'id, user_id, updated_at',
  notifications: 'id, user_id, entity_type, entity_id, created_at, updated_at',
  outbox: 'id, table, rowId, createdAt',
})

// v3：新增 cleared_notif_keys（已清除通知的键去重记忆，断绝 60s 扫描重建）
db.version(3).stores({
  todos: 'id, user_id, updated_at',
  requirements: 'id, user_id, updated_at',
  bugs: 'id, user_id, updated_at',
  sprints: 'id, user_id, updated_at',
  notifications: 'id, user_id, entity_type, entity_id, created_at, updated_at',
  cleared_notif_keys: 'key, cleared_at',
  outbox: 'id, table, rowId, createdAt',
})

// v4：移除 kpis 表（指标模块已下线，2026-08-10）
db.version(4).stores({
  todos: 'id, user_id, updated_at',
  requirements: 'id, user_id, updated_at',
  bugs: 'id, user_id, updated_at',
  sprints: 'id, user_id, updated_at',
  notifications: 'id, user_id, entity_type, entity_id, created_at, updated_at',
  cleared_notif_keys: 'key, cleared_at',
  outbox: 'id, table, rowId, createdAt',
})

// v5：新增字典 tag_categories + tag_values；4 业务表加 tag_id 索引便于筛选
db.version(5).stores({
  todos: 'id, user_id, updated_at, tag_id',
  requirements: 'id, user_id, updated_at, tag_id',
  bugs: 'id, user_id, updated_at, tag_id',
  sprints: 'id, user_id, updated_at, tag_id',
  notifications: 'id, user_id, entity_type, entity_id, created_at, updated_at',
  tag_categories: 'id, user_id, updated_at, name',
  tag_values: 'id, category_id, updated_at',
  cleared_notif_keys: 'key, cleared_at',
  outbox: 'id, table, rowId, createdAt',
})

// v6：新增 apps 表（个人应用导航 / 书签）
db.version(6).stores({
  todos: 'id, user_id, updated_at, tag_id',
  requirements: 'id, user_id, updated_at, tag_id',
  bugs: 'id, user_id, updated_at, tag_id',
  sprints: 'id, user_id, updated_at, tag_id',
  notifications: 'id, user_id, entity_type, entity_id, created_at, updated_at',
  tag_categories: 'id, user_id, updated_at, name',
  tag_values: 'id, category_id, updated_at',
  apps: 'id, user_id, updated_at',
  movies: 'id, user_id, updated_at',
  cleared_notif_keys: 'key, cleared_at',
  outbox: 'id, table, rowId, createdAt',
})

// v7：新增 movies 表（个人影视库 / 观影志）
db.version(7).stores({
  todos: 'id, user_id, updated_at, tag_id',
  requirements: 'id, user_id, updated_at, tag_id',
  bugs: 'id, user_id, updated_at, tag_id',
  sprints: 'id, user_id, updated_at, tag_id',
  notifications: 'id, user_id, entity_type, entity_id, created_at, updated_at',
  tag_categories: 'id, user_id, updated_at, name',
  tag_values: 'id, category_id, updated_at',
  apps: 'id, user_id, updated_at',
  movies: 'id, user_id, updated_at',
  cleared_notif_keys: 'key, cleared_at',
  outbox: 'id, table, rowId, createdAt',
})

/** 类型化表引用，避免 any 满天飞 */
function tableRef<T>(table: EntityTable): Table<T> {
  switch (table) {
    case 'todos':
      return db.todos as unknown as Table<T>
    case 'requirements':
      return db.requirements as unknown as Table<T>
    case 'bugs':
      return db.bugs as unknown as Table<T>
    case 'sprints':
      return db.sprints as unknown as Table<T>
    case 'notifications':
      return db.notifications as unknown as Table<T>
    case 'tag_categories':
      return db.tag_categories as unknown as Table<T>
    case 'tag_values':
      return db.tag_values as unknown as Table<T>
    case 'apps':
      return db.apps as unknown as Table<T>
    case 'movies':
      return db.movies as unknown as Table<T>
  }
}

/** 读取某用户在某表下的全部本地行，按 created_at 倒序 */
export async function localAll<T>(table: EntityTable, userId: string): Promise<T[]> {
  const rows = await tableRef<T>(table).where('user_id').equals(userId).toArray()
  return rows.sort((a, b) =>
    String((b as Record<string, unknown>).created_at).localeCompare(
      String((a as Record<string, unknown>).created_at),
    ),
  )
}

export async function localGet<T>(table: EntityTable, id: string): Promise<T | undefined> {
  return tableRef<T>(table).get(id)
}

export async function localPut<T>(table: EntityTable, row: T): Promise<void> {
  await tableRef<T>(table).put(row)
}

export async function localDelete(table: EntityTable, id: string): Promise<void> {
  await tableRef(table).delete(id)
}

/**
 * 把云端行合并进本地（按 id upsert）。skipIds 里的本地未同步行不覆盖，保留用户离线编辑。
 *
 * ⚠️ 铁律（2026-08-11 修正，根治「刷新丢失」）：
 * 本函数【绝不删除】任何本地行。任何删除都必须由显式操作触发——
 *   ① 用户主动删除（confirmDelete → db.xxx.delete + outbox delete）；
 *   ② Realtime 的 DELETE 事件（订阅回调里按 payload.old.id 精确删除）。
 * 早期版本在此做「孤儿回收」（云端没有就删本地），看似能同步其它端的删除，
 * 但在本地优先架构下极其危险：刷新时 seedFromServer 拉云端，若刚加的电影因 outbox 补传时序 /
 * RLS 暂未进云端，或云端查询瞬间未返回该行，本地副本就被当孤儿删光——表现为「刷新必丢失」。
 * 跨端删除一致性改由 ② 显式 Realtime DELETE 兜底，不再用「猜孤儿」的方式。
 */
export async function mergeServerIntoLocal(
  table: EntityTable,
  serverRows: Record<string, unknown>[],
  skipIds: Set<string>,
  userId: string,
): Promise<void> {
  const serverIds = new Set(serverRows.map((r) => String(r.id)))
  // outbox 中尚待上传的行（本地新建/编辑/删除）一律不碰，避免「刷新丢失新建」回归
  const pending = await pendingRowIds(table)

  // 1) 云端有 → upsert 进本地（skipIds 里的本地编辑不覆盖）
  const toPut = serverRows.filter((r) => !skipIds.has(String(r.id)))
  if (toPut.length) await tableRef(table).bulkPut(toPut as never)

  // 2) 跨端删除一致性：本地有、云端没有、且不在 outbox（非本地未同步新建）→ 清理本地。
  //    修复「手机删了、PC 刷新后还在」：无痕模式正常正是因为本地无数据、直接 seed 云端（已删除）。
  //    PC 端老本地残留靠此步在 seed 时回收；同时保留 Realtime DELETE 实时路径做即时清理。
  const localRows = await tableRef(table).where('user_id').equals(userId).toArray()
  const toDelete = localRows
    .map((r) => String((r as { id: string }).id))
    .filter((id) => !serverIds.has(id))
    .filter((id) => !skipIds.has(id))
    .filter((id) => !pending.has(id))
  if (toDelete.length) await tableRef(table).bulkDelete(toDelete as never)
}

/** 入队一条待同步操作 */
export async function enqueueOp(op: Omit<OutboxOp, 'id' | 'createdAt' | 'attempts'>): Promise<void> {
  await db.outbox.add({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    attempts: 0,
    ...op,
  })
}

export async function pendingOps(): Promise<OutboxOp[]> {
  return db.outbox.orderBy('createdAt').toArray()
}

export async function clearOp(id: string): Promise<void> {
  await db.outbox.delete(id)
}

export async function bumpAttempts(id: string): Promise<void> {
  const op = await db.outbox.get(id)
  if (op) await db.outbox.update(id, { attempts: op.attempts + 1 })
}

/** 取所有"已清除"的通知键集合（用于扫描去重） */
export async function getClearedNotifKeys(): Promise<Set<string>> {
  const rows = await db.cleared_notif_keys.toArray()
  return new Set(rows.map((r) => r.key))
}

/** 批量记录"已清除"键（幂等：同 key 重复写入只更新 cleared_at） */
export async function addClearedNotifKeys(keys: string[]): Promise<void> {
  if (!keys.length) return
  const now = new Date().toISOString()
  await db.cleared_notif_keys.bulkPut(
    keys.map((key) => ({ key, cleared_at: now })),
  )
}

/** 取某表下正处于待同步状态的本地 rowId 集合（合并云端时跳过，保护离线编辑） */
export async function pendingRowIds(table: EntityTable): Promise<Set<string>> {
  const ops = await db.outbox.where('table').equals(table).toArray()
  return new Set(ops.map((o) => o.rowId))
}
