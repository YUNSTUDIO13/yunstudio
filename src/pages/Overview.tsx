import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useProfile } from '../context/ProfileContext'
import { useRequirements } from '../context/RequirementsContext'
import { useSprints } from '../context/SprintsContext'
import { useBugs } from '../context/BugsContext'
import { useTodos } from '../context/TodosContext'
import { useMediaQuery } from '../lib/useMediaQuery'
import { useDashboard } from '../context/DashboardContext'
import DashboardConfig from '../components/DashboardConfig'
import NotificationBell from '../components/NotificationBell'
import { SIZE_CLASS } from '../widgets/registry'
import { C, glass } from '../design/tokens'
import { computeScore, hoursToDeadline, riskLevel } from '../lib/score'
import {
  Card,
  CardHeader,
  Display,
  PulseDot,
  IconFile,
  IconBell,
  IconClock,
} from '../design/primitives'

// 紧凑 MetricPill（仅 Overview 用）—— 比 Badge 原语窄一档，
// 防止手机 2 列（内可用 129px）flex-wrap 换行截断第二 pill。
function MetricPill({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 500,
        color,
        background: bg,
        border: `1px solid ${color}35`,
        borderRadius: 5,
        padding: '2px 7px',
        letterSpacing: '.02em',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  )
}

export default function Overview() {
  const { user } = useAuth()
  const { profile } = useProfile()
  const { requirements } = useRequirements()
  const { sprints } = useSprints()
  const { bugs } = useBugs()
  const { todos } = useTodos()
  const navigate = useNavigate()
  const isMobile = useMediaQuery('(max-width: 767px)')
  const { config } = useDashboard()
  const [cfgOpen, setCfgOpen] = useState(false)

  const name = profile?.display_name || (user?.email ?? '').split('@')[0] || '您'

  const totalTodos = todos.length
  const doneTodos = todos.filter((t) => t.done).length
  const todayPct = totalTodos ? Math.round((doneTodos / totalTodos) * 100) : 0

  const reqTotal = requirements.length
  const reqLaunched = requirements.filter((r) => r.status === 'launched').length
  // 已排期待上线（scheduled/dev/test）—— 整体进度卡「待上线」指标
  const reqPendingLaunch = requirements.filter((r) =>
    ['scheduled', 'dev', 'test'].includes(r.status),
  ).length
  const reqInReview = requirements.filter((r) => r.status === 'review').length
  const reqInDev = requirements.filter((r) => r.status === 'dev').length
  const reqActive = requirements.filter(
    (r) => !['launched', 'void', 'hold'].includes(r.status),
  ).length
  const reqPct = reqTotal ? Math.round((reqLaunched / reqTotal) * 100) : 0

  // 待办 Top 4（按 Score 倒序、未完成优先）
  const topTodos = useMemo(
    () =>
      [...todos]
        .filter((t) => !t.done)
        .sort((a, b) => computeScore(b) - computeScore(a))
        .slice(0, 4),
    [todos],
  )

  // 缺陷：有效中的缺陷数（业务可用 = 非已关闭）—— 大数字核心指标
  const bugOpen = bugs.filter((b) => b.status !== 'closed').length
  const bugCritical = bugs.filter((b) => b.severity === 'critical' && b.status !== 'closed').length
  const bugSevere = bugs.filter((b) => b.severity === 'major' && b.status !== 'closed').length

  // 当前迭代：状态 active 的优先，其次第一条
  const activeSprint = useMemo(
    () => sprints.find((s) => s.status === 'active') ?? sprints[0] ?? null,
    [sprints],
  )

  // Top 指标已下线（指标模块移除）

  return (
    <div style={{ padding: isMobile ? '16px 16px 24px' : '40px 44px 56px', display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 16 }}>
      {/* 个性化 Header（保留 M3.8 昵称显示）；通知铃铛与标题同行右对齐，仅主页展示 */}
      <div
        style={{
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <Display size={42} color={C.textPrimary}>{`Hi, ${name}`}</Display>
        <NotificationBell />
      </div>

      {/* 首页卡片：按 config.widgetIds 顺序渲染（管理卡片的"展示顺序"调序在此生效）；
          二维尺寸模型（手机 2 列 / 桌面 8 列，等比缩小一倍）。
          · 手机 & PC 双端均加 aspect-square：1×1/2×2 真正正方形、2×1 真正 2:1（用户要求手机也是正方形）
          · PC 改 4 列 → 8 列：每个单元格宽减半（≈266→125），1×1 正方形由 266² 缩到 125²，等比缩小一倍
          · 行高由 aspect-ratio 决定（去掉 auto-rows 固定值），避免横长方形违反"1×1=正方形" */}
      <div className="grid grid-cols-2 md:grid-cols-8 gap-3 md:gap-3 auto-rows-auto">
        {config.widgetIds.map((id) => {
          const size = config.sizes[id] ?? '1x1'
          switch (id) {
            case 'w_todo_ring':
              return (
                <div key={id} className={`${SIZE_CLASS[size]}`}>
          <Card style={{ height: '100%', padding: '15px', display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
            <CardHeader
              title="今日完成"
              style={{ marginBottom: 0 }}
              action={
                isMobile ? null : (
                  <button
                    onClick={() => navigate('/modules/todos')}
                    style={{
                      ...glass.pill,
                      fontSize: 11,
                      fontWeight: 500,
                      color: C.accent,
                      borderRadius: 7,
                      padding: '4px 11px',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      letterSpacing: '.02em',
                    }}
                  >
                    查看今日
                  </button>
                )
              }
            />
            <Display size={isMobile ? 32 : 28}>{doneTodos}</Display>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap', marginTop: 2 }}>
              <MetricPill label={`已完成 ${doneTodos}`} color={C.accent} bg={C.accentSoft} />
              <MetricPill label={`总完成度 ${todayPct}%`} color={C.green} bg="rgba(94,234,212,.09)" />
            </div>
          </Card>
                </div>
              )
            case 'w_todo_stream':
              return (
                <div key={id} className={`${SIZE_CLASS[size]}`}>
          <Card style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '15px' }}>
            <CardHeader title="待办" icon={<PulseDot color="rgba(255,255,255,0.2)" />} />
            {topTodos.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 130 }}>
                <span style={{ fontSize: 12, color: C.textGhost, letterSpacing: '.04em' }}>暂无活跃待办</span>
              </div>
            ) : (
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4, flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {topTodos.map((t) => {
                  const h = hoursToDeadline(t.deadline_at)
                  const risk = riskLevel(t)
                  const hLabel =
                    h == null
                      ? '无截止'
                      : h < 0
                        ? `逾期 ${Math.abs(Math.round(h))}h`
                        : `剩 ${Math.round(h)}h`
                  const riskColor =
                    risk === 'overdue'
                      ? C.red
                      : risk === 'urgent'
                        ? C.amber
                        : C.textSub
                  return (
                    <li
                      key={t.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 12 }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          background: riskColor,
                          boxShadow: risk === 'overdue' ? `0 0 8px ${riskColor}` : 'none',
                          flexShrink: 0,
                        }}
                      />
                      <span
                        className="min-w-0 flex-1 break-words text-sm leading-snug"
                        style={{ color: C.textPrimary }}
                      >
                        {t.title}
                      </span>
                      <span style={{ fontSize: 11, color: C.textSub, flexShrink: 0 }}>
                        {t.priority} · {hLabel}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
                </div>
              )
            case 'w_todo_progress':
              return (
                <div key={id} className={`${SIZE_CLASS[size]}`}>
          <Card style={{ height: '100%', padding: '15px', display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
            <CardHeader title="整体进度" style={{ marginBottom: 0 }} />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <Display size={isMobile ? 32 : 28}>{reqPct}%</Display>
              <div style={{ flex: 1, position: 'relative', height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'visible' }}>
                <div style={{ position: 'absolute', left: 0, top: '-1px', bottom: '-1px', width: `${reqPct}%`, background: `linear-gradient(90deg,${C.accent},#c084fc)`, borderRadius: 2, boxShadow: `0 0 10px ${C.accentGlow}` }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap', marginTop: 2 }}>
              <MetricPill label={`已上线 ${reqLaunched}`} color={C.green} bg="rgba(94,234,212,.09)" />
              <MetricPill label={`待上线 ${reqPendingLaunch}`} color={C.amber} bg="rgba(251,191,36,.09)" />
            </div>
          </Card>
                </div>
              )
            case 'w_req_summary':
              return (
                <div key={id} className={`${SIZE_CLASS[size]}`}>
          <Card style={{ height: '100%', padding: '15px', display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
            <CardHeader title="需求概览" icon={<IconFile />} style={{ marginBottom: 0 }} />
            <Display size={isMobile ? 32 : 28}>{reqActive}</Display>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap', marginTop: 2 }}>
              <MetricPill label={`待评审 ${reqInReview}`} color={C.amber} bg="rgba(251,191,36,.09)" />
              <MetricPill label={`研发中 ${reqInDev}`} color={C.accent} bg={C.accentSoft} />
            </div>
          </Card>
                </div>
              )
            case 'w_sprint_summary':
              return (
                <div key={id} className={`${SIZE_CLASS[size]}`}>
          <Card style={{ height: '100%', padding: '15px', display: 'flex', flexDirection: 'column' }}>
            <CardHeader title="迭代概览" icon={<IconClock />} />
            {activeSprint ? (
              <>
                <div className="min-w-0 break-words text-sm font-semibold leading-snug" style={{ color: C.textPrimary, marginTop: 4 }}>
                  {activeSprint.name}
                </div>
                <div className="relative" style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginTop: 14, marginBottom: 10, overflow: 'visible' }}>
                  <div style={{ position: 'absolute', left: 0, top: '-1px', bottom: '-1px', width: `${Math.round(activeSprint.progress)}%`, background: `linear-gradient(90deg,${C.accent},#c084fc)`, borderRadius: 2, boxShadow: `0 0 10px ${C.accentGlow}` }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, color: C.textSub }}>
                  <span>{activeSprint.status}</span>
                  <span>{Math.round(activeSprint.progress)}%</span>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 80 }}>
                <span style={{ fontSize: 12, color: C.textGhost, letterSpacing: '.04em' }}>暂无迭代</span>
              </div>
            )}
          </Card>
                </div>
              )
            case 'w_bug_summary':
              return (
                <div key={id} className={`${SIZE_CLASS[size]}`}>
          <Card style={{ height: '100%', padding: '15px', display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
            <CardHeader title="缺陷概览" icon={<IconBell />} style={{ marginBottom: 0 }} />
            <Display size={isMobile ? 32 : 28}>{bugOpen}</Display>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap', marginTop: 2 }}>
              <MetricPill label={`致命 ${bugCritical}`} color={C.red} bg="rgba(248,113,113,.09)" />
              <MetricPill label={`严重 ${bugSevere}`} color={C.amber} bg="rgba(251,191,36,.09)" />
            </div>
          </Card>
                </div>
              )
            default:
              return null
          }
        })}
      </div>

      {/* 卡片管理入口（恢复：可自定义是否展示首页卡片） */}
      <div className="flex justify-center pt-1">
        <button
          type="button"
          onClick={() => setCfgOpen(true)}
          className="glass-pill inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-ink-soft transition hover:text-accent"
        >
          管理首页卡片
        </button>
      </div>
      <DashboardConfig open={cfgOpen} onClose={() => setCfgOpen(false)} />
    </div>
  )
}
