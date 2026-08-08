import { Link } from 'react-router-dom'
import type { NavPrimary } from '../lib/nav-types'
import { BUILTIN_MODULES } from '../lib/builtin-modules'
import { renderIcon } from '../lib/icon-library'

/** 一级 Tab 下的模块 → 图标 key（与 MegaMenu 保持一致） */
function moduleIcon(m: string): string {
  if (m === 'overview') return 'home'
  if (m === 'todos') return 'check'
  if (m === 'requirements') return 'doc'
  if (m === 'sprints') return 'clock'
  if (m === 'bugs') return 'bell'
  if (m === 'kpis') return 'bar'
  if (m === 'nav-config') return 'gear'
  return 'gear'
}

/**
 * 移动端 Mega Menu：从底部弹出的半屏 sheet（纵向列模块）。
 * 仅在 isMobile 时由 AppShell 渲染；桌面仍用横向浮层 MegaMenu。
 */
export default function MobileMegaSheet({
  primary,
  onClose,
}: {
  primary: NavPrimary
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      {/* 遮罩：点击关闭 */}
      <button
        aria-label="关闭"
        className="absolute inset-0 animate-overlay bg-ink-strong/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      {/* 底部 sheet 内容
          - 四边圆角 rounded-3xl（不再 rounded-t-3xl，去掉 border-t，与底部 dock 浮岛风格一致）
          - 整体上移：mb 从 calc(3.5rem) 加大到 calc(4.5rem)，与底部 dock 间距更明显 */}
      <div
        className="relative z-10 mb-[calc(5.5rem+env(safe-area-inset-bottom))] max-h-[calc(100dvh-5.5rem-env(safe-area-inset-bottom))] overflow-y-auto rounded-3xl bg-surface p-4 animate-modal"
        style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.55), 0 8px 28px -6px rgba(0,0,0,0.5)' }}
      >
        {/* 顶部抓手 */}
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line" aria-hidden />
        {/* 标题行 */}
        <div className="mb-2 flex items-center gap-2">
          {/* 标题行：primary icon 块走 accent 调（与 AppShell 桌面 dock / 移动底栏 active 态一致） */}
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent/20 text-accent ring-1 ring-accent/30">
            {renderIcon(primary.iconKey)}
          </span>
          <h3 className="text-base font-semibold text-ink-strong">{primary.title}</h3>
        </div>
        {/* 纵向模块列表 */}
        <div className="flex flex-col">
          {primary.groups.map((g) => (
            <div key={g.id} className="border-t border-line py-2 first:border-t-0">
              <div className="mb-1 px-1 text-xs font-semibold text-ink-mute">{g.title || '未命名'}</div>
              {g.modules.length === 0 ? (
                <div className="py-2 text-xs text-ink-mute">暂无模块</div>
              ) : (
                <div className="flex flex-col">
                  {g.modules.map((m) => {
                    const meta = BUILTIN_MODULES[m]
                    return (
                      <Link
                        key={m}
                        to={meta.route}
                        onClick={onClose}
                        className="flex items-center gap-3 rounded-xl px-2 py-3 text-sm text-ink-strong transition hover:bg-brand-soft"
                      >
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-soft text-ink-strong">
                          {renderIcon(moduleIcon(m))}
                        </span>
                        <span>{meta.title}</span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
