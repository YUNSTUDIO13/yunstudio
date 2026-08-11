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

// 同步状态回调：UI 注册后，上传失败/成功时收到通知（用于显式报错，避免静默失败）
type SyncStatus = { ok: boolean; msg?: string }
let syncStatusHandler: ((s: SyncStatus) => void) | null = null
const notifiedOps = new Set<string>() // 已提示过的 rowId，避免重复弹错误
export function setSyncStatusHandler(fn: ((s: SyncStatus) => void) | null): void {
  syncStatusHandler = fn
}

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

/**
 * 把单条操作应用到 Supabase。
 * uid 为实时登录用户（flush 时取，避免创建瞬间 user 未解出导致的 'anonymous' 中毒）。
 * insert/update 统一 upsert（onConflict: id）→ 幂等、最后写入胜。
 */
async function applyOp(
  op: { table: EntityTable; op: SyncOpType; rowId: string; payload?: unknown },
  uid: string | null,
): Promise<void> {
  if (!uid) throw new Error('未登录，无法同步到云端（登录后自动重试）')
  const table = supabase.from(op.table)
  if (op.op === 'delete') {
    await table.delete().eq('id', op.rowId)
  } else {
    const payload = { ...(op.payload as Record<string, unknown>) }
    // 关键修正：用实时会话 uid 覆盖 payload 里的 user_id，
    // 即便创建时 userId 为 'anonymous'，也能在 flush 时纠正为真实 uid 使 RLS 通过。
    payload.user_id = uid
    await table.upsert(payload, { onConflict: 'id' })
  }
}

/** 把本地发件箱逐条补传到云端；失败保留待下次重试，并向 UI 显式报错（不再静默吞掉） */
export async function flushOutbox(): Promise<void> {
  if (flushing) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  flushing = true
  let processed = 0
  let errored = false
  try {
    // 取一次实时登录态（flush 时 user 必然已解出），用于 RLS 的 user_id 修正
    const { data: authData, error: authErr } = await supabase.auth.getUser()
    const uid = authErr ? null : authData.user?.id ?? null
    const ops = await pendingOps()
    for (const op of ops) {
      try {
        await applyOp(op, uid)
        await clearOp(op.id)
        notifiedOps.delete(op.rowId) // 成功则允许后续失败再提示
        processed++
      } catch (e) {
        errored = true
        const msg = e instanceof Error ? e.message : String(e)
        // 不再静默吞掉：打印到控制台 + 首次失败显式提示 UI
        console.error('[sync] 上传云端失败:', op.table, op.rowId, msg)
        await bumpAttempts(op.id)
        if (!notifiedOps.has(op.rowId)) {
          notifiedOps.add(op.rowId)
          syncStatusHandler?.({ ok: false, msg: `同步到云端失败：${msg}` })
        }
        // 离线则停止后续；其余（如权限/列缺失）继续处理其余 op，等下次重试
        if (typeof navigator !== 'undefined' && !navigator.onLine) break
      }
    }
  } finally {
    flushing = false
  }
  // 本轮有成功处理且无错误 → 清掉错误横幅（说明已追上云端）
  if (processed > 0 && !errored) syncStatusHandler?.({ ok: true })
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
