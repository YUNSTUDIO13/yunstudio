// 通用占位页：用于尚未深做的模块（需求 / 迭代 / 缺陷 / 指标）
import { Card } from '../components/ui'

export default function Placeholder({
  title,
  desc,
}: {
  title: string
  desc: string
}) {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.25em] text-ink-mute">
          Module
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-ink-strong">{title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{desc}</p>
      </div>
      <Card className="border-dashed">
        <div className="flex flex-col items-center py-12 text-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-2xl text-ink-soft">
            ⚙
          </div>
          <p className="text-sm text-ink-soft">前端体验阶段尚未深做</p>
          <p className="mt-2 text-xs text-ink-mute">
            待您确认待办模块体验 OK 后接入
          </p>
        </div>
      </Card>
    </div>
  )
}
