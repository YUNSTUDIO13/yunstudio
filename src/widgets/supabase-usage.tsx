/**
 * 首页 Supabase 用量看板 · 2x4 卡片
 * ============================================================================
 * 数据：supabase.functions.invoke('supabase-usage') → 服务端聚合
 *   · DATABASE SIZE   ← SECURITY DEFINER RPC get_db_size_bytes
 *   · FILE STORAGE    ← SECURITY DEFINER RPC get_storage_size_bytes
 *   · EGRESS / MAU    ← Supabase Management API（需 SUPABASE_MGMT_TOKEN，可选）
 *
 * 视觉：标题 + plan pill + 4 行（空心圆 + 标签 + 已用/总量 + 短进度条）；
 *       缺数据则该项显示「—」，进度条为 0%。
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

function pct(used: number | null, limit: number): number {
  if (used == null || limit <= 0) return 0
  return Math.min(100, Math.max(0, (used / limit) * 100))
}

// ── 单行：空心圆 + 标签 + 已用/总量 + 进度条 ─────────────────────────────────
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
  const p = pct(used, total)
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
        gap: 10,
        padding: '9px 0',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          border: '1.5px solid rgba(255,255,255,0.4)',
          flexShrink: 0,
        }}
      />
      <span
        style={{
          flex: 1,
          fontSize: 10.5,
          fontWeight: 500,
          color: 'rgba(255,255,255,0.6)',
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
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
        }}
      >
        {usedDisp}
        <span style={{ color: 'rgba(255,255,255,0.32)', marginLeft: 4 }}>/ {totalDisp}</span>
      </span>
      <div
        style={{
          width: 72,
          height: 2,
          background: 'var(--c-progress-track)',
          borderRadius: 1,
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${p}%`,
            background: 'var(--grad-progress)',
            borderRadius: 1,
            transition: 'width .5s ease',
          }}
        />
      </div>
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
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        overflow: 'hidden',
      }}
    >
      <CardHeader
        title="Supabase 用量"
        style={{ marginBottom: 4 }}
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
                padding: '2px 7px',
                letterSpacing: '.06em',
                textTransform: 'uppercase',
              }}
            >
              {data.plan} plan
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
          {!data.mgmt_enabled && (
            <div
              style={{
                marginTop: 'auto',
                fontSize: 10,
                color: 'rgba(255,255,255,0.32)',
                letterSpacing: '.04em',
                textAlign: 'right',
                paddingTop: 4,
              }}
            >
              Egress / MAU 需配置 PAT（<code>SUPABASE_MGMT_TOKEN</code>）
            </div>
          )}
        </div>
      )}
    </Card>
  )
}