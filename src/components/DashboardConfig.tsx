import { useMemo } from 'react'
import { Modal, Button } from './ui'
import { renderIcon } from '../lib/icon-library'
import { useDashboard } from '../context/DashboardContext'
import { WIDGET_LIST, OVERVIEW_CARD_IDS, SIZE_OPTIONS, type WidgetCategory, type WidgetDef } from '../widgets/registry'

const CATEGORY_ORDER: WidgetCategory[] = ['待办', '模块概览', '观影', '规划', '协作']

export default function DashboardConfig({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { config, actions } = useDashboard()
  const enabledIds = config.widgetIds

  // 按 category 分组（仅含 Overview 实际可渲染的卡片，避免勾选无对应渲染段的卡）
  const grouped = useMemo(() => {
    const map: Record<string, WidgetDef[]> = {}
    for (const w of WIDGET_LIST) {
      if (!OVERVIEW_CARD_IDS.includes(w.id)) continue
      ;(map[w.category] ??= []).push(w)
    }
    return map
  }, [])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="卡片管理"
      maxWidth="max-w-2xl"
      footer={
        // 「恢复默认」靠左、「完成」靠右，与原视觉一致；footer 由 Modal 钉底，内容可滚
        <div className="flex w-full items-center justify-between">
          <Button variant="ghost" onClick={actions.resetToDefault}>
            恢复默认
          </Button>
          <Button onClick={onClose}>完成</Button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-ink-soft">
        勾选可在主页启用的卡片；未勾选的将被移除。含「建设中」占位卡，可提前加入布局。
      </p>

      {/* —— 可用卡片（按分类勾选增删） —— */}
      {/* 整段进 Modal 自带的滚动容器；不再用 max-h 嵌套，避免双重滚动冲突 */}
      <div className="space-y-5 pr-1">
        {CATEGORY_ORDER.map((cat) => {
          const list = grouped[cat] ?? []
          if (list.length === 0) return null
          return (
            <div key={cat}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-mute">{cat}</h3>
              <div className="space-y-2">
                {list.map((w) => {
                  const enabled = enabledIds.includes(w.id)
                  return (
                    <label
                      key={w.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${
                        enabled ? 'border-accent/40 bg-accent/5' : 'border-line bg-surface hover:bg-brand-soft'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-[#2D8A8A]"
                        checked={enabled}
                        onChange={() => (enabled ? actions.removeWidget(w.id) : actions.addWidget(w.id))}
                      />
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-ink-soft">
                        {renderIcon(w.iconKey)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-medium text-ink-strong">{w.title}</span>
                          {!w.developed && (
                            <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
                              建设中
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-ink-mute">{w.desc}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* —— 展示顺序（已启用卡片上下调序） —— */}
      {enabledIds.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-mute">展示顺序</h3>
          <ul className="space-y-1.5">
            {enabledIds.map((id, i) => {
              const w = WIDGET_LIST.find((x) => x.id === id)
              if (!w) return null
              return (
                <li key={id} className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-soft px-3 py-2">
                  <span className="w-5 text-center text-xs font-semibold text-ink-mute">{i + 1}</span>
                  <span className="flex-1 truncate text-sm text-ink-strong">{w.title}</span>
                  {/* 尺寸选择器：1×1 / 2×1 / 1×2 / 2×2，点击即改并持久化 */}
                  <div className="flex items-center gap-1">
                    {(w.sizeOptions ?? SIZE_OPTIONS).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => actions.setWidgetSize(id, s)}
                        className={`h-6 rounded px-1.5 text-[11px] font-medium transition ${
                          (config.sizes[id] ?? '1x1') === s
                            ? 'bg-accent text-white'
                            : 'border border-line bg-surface text-ink-soft hover:text-ink-strong'
                        }`}
                        title={`尺寸 ${s}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => actions.moveWidget(id, 'up')}
                      className="grid h-7 w-7 place-items-center rounded-md border border-line bg-surface text-ink-soft transition hover:text-ink-strong disabled:opacity-30"
                      title="上移"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={i === enabledIds.length - 1}
                      onClick={() => actions.moveWidget(id, 'down')}
                      className="grid h-7 w-7 place-items-center rounded-md border border-line bg-surface text-ink-soft transition hover:text-ink-strong disabled:opacity-30"
                      title="下移"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => actions.removeWidget(id)}
                      className="grid h-7 w-7 place-items-center rounded-md border border-line bg-surface text-ink-soft transition hover:text-danger"
                      title="移除"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Modal>
  )
}
