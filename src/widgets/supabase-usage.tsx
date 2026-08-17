/**
 * 首页 Supabase 用量看板 · 2x1 卡片
 * ============================================================================
 * 数据：supabase.functions.invoke('supabase-usage') → 服务端聚合
 *   · DATABASE SIZE   ← SECURITY DEFINER RPC get_db_size_bytes
 *   · FILE STORAGE    ← SECURITY DEFINER RPC get_storage_size_bytes
 *   · EGRESS / MAU    ← Supabase Management API（需 MGMT_TOKEN，可选）
 *
 * 视觉：紧凑 4 行（字段左对齐 + 数值右对齐），无进度条；
 *       缺数据则该项显示「—」。
 */
import { useEffect, useState } from 'react'
import { Card, CardHeader } from '../design/primitives'
import { supabase } from '../lib/supabase'

interface UsageResp {
  plan: string
  limits: {
    egress_mb: number
    db_size_mb: number
    mau: number
    storage_mb: number
  }
  db_size_bytes: number | null
  storage_size_bytes: number | null
  egress_mb: number | null
  mau: number | null
  mgmt_enabled: boolean
  project_ref?: string
  fetched_at: string
}

// ── 数字格式化 ──────────────────────────────────────────────────────────────
function fmtBytes(b: number | null): string {
  if (b == null) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  const mb = b / (1024 * 1024)
  if (mb < 10) return `${mb.toFixed(2)} MB`
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

function fmtMB(mb: number | null): string {
  if (mb == null) return '—'
  if (mb < 10) return `${mb.toFixed(2)} MB`
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

function fmtCount(n: number | null): string {
  if (n == null) return '—'
  return n.toLocaleString()
}

// ── 单行：字段左对齐 + 数值右对齐，无装饰 ────────────────────────────────────
type Unit = 'bytes' | 'mb' | 'count'

function UsageRow({
  label,
  used,
  total,
  unit,
}: {
  label: string
  used: number | null
  total: number
  unit: Unit
}) {
  const usedDisp =
    unit === 'bytes' ? fmtBytes(used) : unit === 'mb' ? fmtMB(used) : fmtCount(used)
  const totalDisp =
    unit === 'bytes'
      ? fmtBytes(total)
      : unit === 'mb'
        ? fmtMB(total)
        : fmtCount(total)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '4px 0',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 500,
          color: 'rgba(255,255,255,0.6)',
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          textAlign: 'left',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          color: 'rgba(255,255,255,0.88)',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          textAlign: 'right',
        }}
      >
        {usedDisp}
        <span style={{ color: 'rgba(255,255,255,0.32)', marginLeft: 6 }}>/ {totalDisp}</span>
      </span>
    </div>
  )
}

// ── 卡片本体 ────────────────────────────────────────────────────────────────
export default function SupabaseUsageCard() {
  const [data, setData] = useState<UsageResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    void (async () => {
      try {
        const { data: r, error: e } = await supabase.functions.invoke<UsageResp>('supabase-usage')
        if (cancel) return
        if (e) setError(e.message)
        else if (r) setData(r)
      } catch (err) {
        if (!cancel) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancel) setLoading(false)
      }
    })()
    return () => {
      cancel = true
    }
  }, [])

  const limits = data?.limits ?? {
    egress_mb: 5 * 1024,
    db_size_mb: 500,
    mau: 50_000,
    storage_mb: 1024,
  }

  return (
    <Card
      style={{
        height: '100%',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        overflow: 'hidden',
      }}
    >
      <CardHeader
        title="Supabase 用量"
        style={{ marginBottom: 0 }}
        action={
          data?.plan ? (
            <span
              style={{
                fontSize: 10,
                fontWeight: 500,
                color: 'rgba(94,234,212,0.95)',
                background: 'rgba(94,234,212,.10)',
                border: '1px solid rgba(94,234,212,.28)',
                borderRadius: 5,
                padding: '1px 6px',
                letterSpacing: '.06em',
                textTransform: 'uppercase',
              }}
            >
              {data.plan}
            </span>
          ) : undefined
        }
      />

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '.06em' }}>
            加载用量…
          </span>
        </div>
      ) : error ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 11, color: 'rgba(248,113,113,0.85)' }}>获取失败：{error}</span>
        </div>
      ) : !data ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>暂无数据</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <UsageRow label="Egress" used={data.egress_mb} total={limits.egress_mb} unit="mb" />
          <UsageRow
            label="Database Size"
            used={data.db_size_bytes}
            total={limits.db_size_mb * 1024 * 1024}
            unit="bytes"
          />
          <UsageRow label="Monthly Active" used={data.mau} total={limits.mau} unit="count" />
          <UsageRow
            label="File Storage"
            used={data.storage_size_bytes}
            total={limits.storage_mb * 1024 * 1024}
            unit="bytes"
          />
        </div>
      )}
    </Card>
  )
}
