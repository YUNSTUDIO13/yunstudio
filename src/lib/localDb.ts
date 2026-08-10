// 本地优先数据层（离线可用）
// 用 Dexie(IndexedDB) 作为 UI 的"唯一数据源"：离线时所有读写都在本地完成，
// 联网后由 sync.ts 把本地"发件箱(outbox)"逐条补传到 Supabase。
// 手机 / PC 共用同一套浏览器代码，一次实现两端生效。
import Dexie, { type Table } from 'dexie'
import type { Todo, Requirement, Bug, Sprint, Notification } from '../types'

export type EntityTable = 'todos' | 'requirements' | 'bugs' | 'sprints' | 'notifications'

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
  /** 用户已"一键清除"过的通知唯一键（entity_type:entity_id:deadline_at）
   *  用于阻断 60s 兜底扫描把刚清掉的通知又建回来。仅本机语义，不上云。 */
  cleared_notif_keys: Table<{ key: string; cleared_at: string }, string>
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

/** 把云端行合并进本地（按 id upsert）。skipIds 里的本地未同步行不覆盖，保留用户离线编辑。 */
export async function mergeServerIntoLocal(
  table: EntityTable,
  serverRows: Record<string, unknown>[],
  skipIds: Set<string>,
): Promise<void> {
  const toPut = serverRows.filter((r) => !skipIds.has(String(r.id)))
  if (toPut.length) await tableRef(table).bulkPut(toPut as never)
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
