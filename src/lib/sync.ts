// 同步引擎：把本地"发件箱(outbox)"里的离线操作补传到 Supabase
// 策略：
//  - 写操作：客户端先落本地 Dexie（UI 立即展示），同时入 outbox；联网后由本引擎逐条补传。
//  - 补传用 upsert（按 id 幂等）→ 天然支持"最后写入胜"：谁后同步谁覆盖。
//  - 冲突：个人工具采用 last-write-wins。若已在 Supabase 跑 `offline-lww.sql` 把
//    updated_at 触发器改为仅 INSERT 自动设值，则 updated_at 由客户端携带，实现"按编辑时间胜"。
//  - 失败：网络异常时保留在 outbox，下次 online 事件 / 定时重试（指数退避）。
import { useEffect } from 'react'
import { supabase } from './supabase'
import {
  enqueueOp,
  pendingOps,
  clearOp,
  bumpAttempts,
  mergeServerIntoLocal,
  pendingRowIds,
  type EntityTable,
  type SyncOpType,
} from './localDb'

let flushing = false

/** 入队一条操作，并在在线时立刻尝试补传 */
export async function enqueueAndMaybeFlush(
  table: EntityTable,
  op: SyncOpType,
  rowId: string,
  payload?: unknown,
): Promise<void> {
  await enqueueOp({ table, op, rowId, payload })
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    void flushOutbox()
  }
}

/** 把单条操作应用到 Supabase */
async function applyOp(op: {
  table: EntityTable
  op: SyncOpType
  rowId: string
  payload?: unknown
}): Promise<void> {
  const table = supabase.from(op.table)
  if (op.op === 'delete') {
    await table.delete().eq('id', op.rowId)
  } else {
    // insert 与 update 统一用 upsert（onConflict: id）→ 幂等、最后写入胜
    await table.upsert(op.payload as Record<string, unknown>, { onConflict: 'id' })
  }
}

/** 把本地发件箱逐条补传到云端；失败保留待下次重试 */
export async function flushOutbox(): Promise<void> {
  if (flushing) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  flushing = true
  try {
    const ops = await pendingOps()
    for (const op of ops) {
      try {
        await applyOp(op)
        await clearOp(op.id)
      } catch {
        // 网络/服务端异常：记录重试次数并保留，下一次 online 或定时再试
        await bumpAttempts(op.id)
        if (typeof navigator !== 'undefined' && !navigator.onLine) break
        // 连续多条失败（如鉴权失效）时不再无意义重试，等 online 事件触发
        break
      }
    }
  } finally {
    flushing = false
  }
}

/**
 * 首次/联网时把云端数据合并进本地（作为本地优先的"初始注水"）。
 * 已离线编辑且尚未同步的本地行（在 outbox 中）不会被云端版本覆盖。
 */
export async function seedFromServer(table: EntityTable, userId: string): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('user_id', userId)
  if (error || !data) return
  const skip = await pendingRowIds(table)
  await mergeServerIntoLocal(table, data as Record<string, unknown>[], skip, userId)
}

/** 全局挂载：监听 online 事件补传；并定时兜底重试（防在线事件未触发） */
export function useSyncEngine(enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const onOnline = () => void flushOutbox()
    // 挂载即尝试一次（捕获启动时遗留的待同步）
    void flushOutbox()
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline)
      const timer = window.setInterval(() => {
        if (navigator.onLine) void flushOutbox()
      }, 15000)
      return () => {
        window.removeEventListener('online', onOnline)
        window.clearInterval(timer)
      }
    }
  }, [enabled])
}
