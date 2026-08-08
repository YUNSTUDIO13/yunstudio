import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useProfile } from '../context/ProfileContext'
import { useRequirements } from '../context/RequirementsContext'
import { useTodos } from '../context/TodosContext'
import { useMediaQuery } from '../lib/useMediaQuery'
import { C, glass } from '../design/tokens'
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
  const { todos } = useTodos()
  const navigate = useNavigate()
  const isMobile = useMediaQuery('(max-width: 767px)')

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

      {/* top row */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.1fr 1fr', gap: 14 }}>
        <Card>
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

        <Card style={{ display: 'flex', flexDirection: 'column' }}>
          <CardHeader title="项目流" icon={<PulseDot color="rgba(255,255,255,0.2)" />} />
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 130 }}>
            <span style={{ fontSize: 12, color: C.textGhost, letterSpacing: '.04em' }}>暂无活跃项目</span>
          </div>
        </Card>
      </div>

      {/* mid row */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 14 }}>
        <Card>
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

        <Card>
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

        <Card style={{ display: 'flex', flexDirection: 'column' }}>
          <CardHeader title="迭代概览" icon={<IconClock />} />
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 80 }}>
            <span style={{ fontSize: 12, color: C.textGhost, letterSpacing: '.04em' }}>暂无迭代</span>
          </div>
        </Card>
      </div>

      {/* bottom row */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
        <Card>
          <CardHeader title="缺陷概览" icon={<IconBell />} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 16 }}>
            <Display size={40}>0</Display>
            <Label>个未关闭</Label>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Badge label="致命 0" color={C.red} bg="rgba(248,113,113,.09)" />
            <Badge label="已关闭 0" color="rgba(255,255,255,0.22)" bg="rgba(255,255,255,0.04)" />
          </div>
        </Card>

        <Card style={{ display: 'flex', flexDirection: 'column' }}>
          <CardHeader title="指标概览" icon={<IconChart />} />
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 80 }}>
            <span style={{ fontSize: 12, color: C.textGhost, letterSpacing: '.04em' }}>暂无指标</span>
          </div>
        </Card>
      </div>
    </div>
  )
}
