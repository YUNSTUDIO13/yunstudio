import 'fake-indexeddb/auto'
import Dexie from 'dexie'

// ── 复刻 localDb.ts 的 v7 schema（仅 movies 表相关）──
const db = new Dexie('yunstudio-local')
db.version(7).stores({
  todos: 'id, user_id, updated_at',
  movies: 'id, user_id, updated_at',
  outbox: 'id, table, rowId, createdAt',
})

const TABLES_WITH_USER_ID = new Set(['movies'])

async function localAll(table, userId) {
  const rows = await db[table].where('user_id').equals(userId).toArray()
  return rows
}

// ── 复刻 mergeServerIntoLocal（含 2167031 修复）──
async function mergeServerIntoLocal(table, serverRows, skipIds, userId) {
  if (!serverRows.length) return
  const toPut = serverRows.filter((r) => !skipIds.has(String(r.id)))
  if (toPut.length) await db[table].bulkPut(toPut)
  if (!TABLES_WITH_USER_ID.has(table)) return
  const serverIds = new Set(serverRows.map((r) => String(r.id)))
  const localRows = await localAll(table, userId)
  const orphans = localRows
    .filter((r) => !serverIds.has(String(r.id)) && !skipIds.has(String(r.id)))
    .map((r) => String(r.id))
  if (orphans.length) await db[table].bulkDelete(orphans)
}

// ── 复刻 reload 查询 ──
async function reload(table, userId) {
  const rows = await db[table].where('user_id').equals(userId).toArray()
  return rows
}

const REAL = 'user-real'
const A = { id: 'a1', user_id: REAL, title: '测试电影', created_at: '2026-01-01' }
const B = { id: 'b1', user_id: REAL, title: '另一部', created_at: '2026-01-02' }

function assert(cond, msg) {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg)
  if (!cond) process.exitCode = 1
}

// 保存 A（模拟 persist 的 db.movies.put）
await db.movies.put(A)

// Test 1: 直接 reload 应拿到 A
let r1 = await reload('movies', REAL)
assert(r1.length === 1 && r1[0].id === 'a1', 'Test1 保存后 reload 能读到 A')

// Test 2: 云端空集合（seedFromServer 返回 []）→ merge → reload 不应删 A
await mergeServerIntoLocal('movies', [], new Set(), REAL)
let r2 = await reload('movies', REAL)
assert(r2.length === 1 && r2[0].id === 'a1', 'Test2 云端空集合合并后 A 仍在（防误删）')

// Test 3: 云端有 B 但无 A，且 A 在 skipIds（outbox 待同步）→ A 应保留
await mergeServerIntoLocal('movies', [B], new Set(['a1']), REAL)
let r3 = await reload('movies', REAL)
assert(r3.length === 2 && r3.some((x) => x.id === 'a1'), 'Test3 云端缺 A 但 A 在待同步集，A 保留')

// Test 4: 云端有 A（flush 成功）→ A 保留
await mergeServerIntoLocal('movies', [A], new Set(), REAL)
let r4 = await reload('movies', REAL)
assert(r4.length === 1 && r4[0].id === 'a1', 'Test4 云端含 A，A 保留')

// Test 5: 关键——以 'anonymous' 查询（刷新瞬间 user 未恢复）应读不到 A（这正是“丢失”现象）
let r5 = await reload('movies', 'anonymous')
assert(r5.length === 0, 'Test5 用 anonymous 查询读不到真实用户的数据（复现“刷新丢失”现象）')

console.log('\n结论：本地 Dexie 存取与合并逻辑本身正确；Test5 证明若刷新时 userId 回落到 anonymous，则查不到真实用户数据——即“刷新丢失”的根因是 读取时 userId 与保存时不一致。')
