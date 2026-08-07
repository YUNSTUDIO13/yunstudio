import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useProfile } from '../context/ProfileContext'
import { useDashboard } from '../context/DashboardContext'
import { SPAN_CLASS, type WidgetDef } from '../widgets/registry'
import { renderIcon } from '../lib/icon-library'
import DashboardConfig from '../components/DashboardConfig'

// 建设中占位卡（developed=false 时渲染）
function UndevelopedCard({ w }: { w: WidgetDef }) {
  return (
    <div className="flex h-full min-h-[180px] flex-col items-center justify-center rounded-card border border-dashed border-line bg-surface p-6 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-ink-mute">
        {renderIcon(w.iconKey)}
      </span>
      <div className="mt-3 text-sm font-semibold text-ink-strong">{w.title}</div>
      <div className="mt-1 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
        建设中 · 敬请期待
      </div>
    </div>
  )
}

export default function Overview() {
  const { user } = useAuth()
  const { profile } = useProfile()
  const { widgets } = useDashboard()
  const navigate = useNavigate()
  const [configOpen, setConfigOpen] = useState(false)
  const name =
    profile?.display_name || (user?.email ?? '').split('@')[0] || '您'

  return (
    <div className="mx-auto max-w-[1280px]">
      {/* ============ 顶部 Header ============ */}
      <header className="mb-7 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-ink-strong">Hi, {name}!</h1>
          <p className="mt-1 text-sm text-ink-soft">让我们看看你今天的工作节奏</p>
        </div>
        <button
          type="button"
          onClick={() => setConfigOpen(true)}
          className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink-strong shadow-card transition hover:bg-brand-soft"
        >
          {renderIcon('grid')}
          管理卡片
        </button>
      </header>

      {/* ============ 卡片网格（数据驱动） ============ */}
      {widgets.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-surface p-16 text-center text-sm text-ink-mute">
          主页暂无卡片，点击右上角「管理卡片」添加。
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-6">
          {widgets.map((w) =>
            w.developed ? (
              <button
                key={w.id}
                type="button"
                onClick={() => w.route && navigate(w.route)}
                title={`查看${w.title}`}
                className={`${SPAN_CLASS[w.span] ?? 'col-span-4'} group block w-full rounded-card text-left outline-none transition hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:ring-2 focus-visible:ring-accent/30`}
              >
                <w.Render />
              </button>
            ) : (
              <div key={w.id} className={SPAN_CLASS[w.span] ?? 'col-span-4'}>
                <UndevelopedCard w={w} />
              </div>
            ),
          )}
        </div>
      )}

      <DashboardConfig open={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  )
}
