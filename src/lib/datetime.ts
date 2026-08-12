// ISO（UTC）↔ datetime-local（本地）互转，保证表单显示与存储一致。
// 原仅定义在 pages/Todos.tsx 内，现抽为共享工具，供 Todos 与 Movies（预约观看弹窗）复用，
// 避免重复实现造成两处行为不一致。

export function isoToLocalInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

export function localInputToIso(v: string): string | null {
  if (!v) return null
  const t = new Date(v).getTime()
  return isNaN(t) ? null : new Date(t).toISOString()
}
