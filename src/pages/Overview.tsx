import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useProfile } from '../context/ProfileContext'
import { useRequirements } from '../context/RequirementsContext'
import { useSprints } from '../context/SprintsContext'
import { useBugs } from '../context/BugsContext'
import { useKpis } from '../context/KpisContext'
import { useTodos } from '../context/TodosContext'
import { useMediaQuery } from '../lib/useMediaQuery'
import { useDashboard } from '../context/DashboardContext'
import DashboardConfig from '../components/DashboardConfig'
import { SIZE_CLASS } from '../widgets/registry'
import { C, glass } from '../design/tokens'
import { computeScore, hoursToDeadline, riskLevel } from '../lib/score'
import {
  Card,
  CardHeader,
  Display,
  Badge,
  Label,
  Divider,
  PulseDot,
  RingChart,
  IconFile,
  IconBell,
  IconClock,
  IconChart,
} from '../design/primitives'

export default function Overview() {
  const { user } = useAuth()
  const { profile } = useProfile()
  const { requirements } = useRequirements()
  const { sprints } = useSprints()
  const { bugs } = useBugs()
  const { kpis } = useKpis()
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
  const reqActive = requirements.filter(
    (r) => !['launched', 'void', 'hold'].includes(r.status),
  ).length
  const reqReview = requirements.filter((r) => r.status === 'review').length
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

  // 缺陷：未关闭 / 致命 / 已关闭
  const bugOpen = bugs.filter((b) => b.status !== 'closed').length
  const bugCritical = bugs.filter((b) => b.severity === 'critical' && b.status !== 'closed').length
  const bugFixed = bugs.filter((b) => b.status === 'closed').length

  // 当前迭代：状态 active 的优先，其次第一条
  const activeSprint = useMemo(
    () => sprints.find((s) => s.status === 'active') ?? sprints[0] ?? null,
    [sprints],
  )

  // Top 指标：按 |value| 取绝对值最大的
  const topKpi = useMemo(
    () => (kpis.length === 0 ? null : [...kpis].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0]),
    [kpis],
  )

  return (
    <div style={{ padding: isMobile ? '16px 16px 24px' : '40px 44px 56px', display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 16 }}>
      {/* 个性化 Header（保留 M3.8 昵称显示） */}
      <div style={{ marginBottom: 8 }}>
        <h1 style={{ fontSize: 13, fontWeight: 500, color: C.textGhost, letterSpacing: '.1em', textTransform: 'uppercase', margin: 0 }}>
          Overview
        </h1>
        <div style={{ marginTop: 8 }}>
          <Display size={42} color={C.textPrimary}>{`Hi, ${name}`}</Display>
        </div>
      </div>

      {/* 首页卡片：按 config.widgetIds 顺序渲染（管理卡片的"展示顺序"调序在此生效）；
          二维尺寸模型（手机 2 列 / 桌面 4 列，固定行高），按 config.sizes[id] 占 m×n 单元格。 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 auto-rows-[168px] md:auto-rows-[200px]">
        {config.widgetIds.map((id) => {
          const size = config.sizes[id] ?? '1x1'
          switch (id) {
            case 'w_todo_ring':
              return (
                <div key={id} className={`${SIZE_CLASS[size]} h-full`}>
          <Card style={{ height: '100%' }}>
            <CardHeader
              title="今日完成"
              action={
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
              }
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 32, marginTop: 4 }}>
              <RingChart pct={todayPct} goal={8} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <Display size={48}>{doneTodos}</Display>
                  <div style={{ marginTop: 3 }}>
                    <Label>已完成</Label>
                  </div>
                </div>
                <Divider />
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <Display size={32}>{todayPct}%</Display>
                  <Label>总完成度</Label>
                </div>
              </div>
            </div>
          </Card>
                </div>
              )
            case 'w_todo_stream':
              return (
                <div key={id} className={`${SIZE_CLASS[size]} h-full`}>
          <Card style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                <div key={id} className={`${SIZE_CLASS[size]} h-full`}>
          <Card style={{ height: '100%' }}>
            <CardHeader title="整体进度" />
            <div style={{ marginBottom: 18 }}>
              <Display size={40}>{reqPct}%</Display>
              <div style={{ marginTop: 2 }}>
                <Label>Completed</Label>
              </div>
            </div>
            <div style={{ position: 'relative', height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginBottom: 14, overflow: 'visible' }}>
              <div style={{ position: 'absolute', left: 0, top: '-1px', bottom: '-1px', width: `${reqPct}%`, background: `linear-gradient(90deg,${C.accent},#c084fc)`, borderRadius: 2, boxShadow: `0 0 10px ${C.accentGlow}` }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ ...glass.pill, borderRadius: 6, padding: '2px 8px', fontSize: 11.5, color: C.accent, fontWeight: 600 }}>{reqLaunched}/{reqTotal}</span>
                <Label>已上线</Label>
              </div>
              <Label>{reqActive} 个进行中</Label>
            </div>
          </Card>
                </div>
              )
            case 'w_req_summary':
              return (
                <div key={id} className={`${SIZE_CLASS[size]} h-full`}>
          <Card style={{ height: '100%' }}>
            <CardHeader title="需求概览" icon={<IconFile />} />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 16 }}>
              <Display size={40}>{reqTotal}</Display>
              <Label>条需求</Label>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Badge label={`进行中 ${reqActive}`} color={C.green} bg="rgba(94,234,212,.09)" />
              <Badge label={`待评审 ${reqReview}`} color={C.amber} bg="rgba(251,191,36,.09)" />
            </div>
          </Card>
                </div>
              )
            case 'w_sprint_summary':
              return (
                <div key={id} className={`${SIZE_CLASS[size]} h-full`}>
          <Card style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                <div key={id} className={`${SIZE_CLASS[size]} h-full`}>
          <Card style={{ height: '100%' }}>
            <CardHeader title="缺陷概览" icon={<IconBell />} />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 16 }}>
              <Display size={40}>{bugOpen}</Display>
              <Label>个未关闭</Label>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Badge label={`致命 ${bugCritical}`} color={C.red} bg="rgba(248,113,113,.09)" />
              <Badge label={`已关闭 ${bugFixed}`} color="rgba(255,255,255,0.22)" bg="rgba(255,255,255,0.04)" />
            </div>
          </Card>
                </div>
              )
            case 'w_kpi_summary':
              return (
                <div key={id} className={`${SIZE_CLASS[size]} h-full`}>
          <Card style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <CardHeader title="指标概览" icon={<IconChart />} />
            {topKpi ? (
              <>
                <div className="min-w-0 break-words text-sm font-semibold leading-snug" style={{ color: C.textPrimary, marginTop: 4 }}>
                  {topKpi.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                  <Display size={32}>{topKpi.value}</Display>
                  <Label>{topKpi.unit}</Label>
                </div>
                <div style={{ fontSize: 11.5, color: C.textSub, marginTop: 6 }}>
                  目标 {topKpi.target}{topKpi.unit} · {Math.round((topKpi.value / topKpi.target) * 100)}%
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 80 }}>
                <span style={{ fontSize: 12, color: C.textGhost, letterSpacing: '.04em' }}>暂无指标</span>
              </div>
            )}
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
