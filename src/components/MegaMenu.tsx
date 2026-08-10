import { Link } from 'react-router-dom'
import type { NavPrimary } from '../lib/nav-types'
import { BUILTIN_MODULES } from '../lib/builtin-modules'
import { renderIcon } from '../lib/icon-library'

interface MegaMenuProps {
  primary: NavPrimary
}

/**
 * 从一级 Tab 横向弹出的 Mega Menu。
 * 设计：
 *   - 顶部胶囊标题带白色背景 + 圆角 + 阴影 + 图标
 *   - 下方各二级列子项：深色文字 + 子图标
 *   - 当二级列为空时显示「暂无模块」占位
 */
export default function MegaMenu({ primary }: MegaMenuProps) {
  return (
    <div
      className="
        pointer-events-auto
        flex min-w-max flex-col gap-3
        rounded-2xl bg-surface p-3
        shadow-card-hover
        ring-1 ring-line
      "
      role="menu"
    >
      {/* 列容器：横向并排，根据一级 Tab 下二级列数自适应列宽（这里固定 4 列网格） */}
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, Math.min(primary.groups.length, 4))}, minmax(180px, 1fr))`,
        }}
      >
        {primary.groups.map((g) => (
          <div
            key={g.id}
            className="flex min-h-[88px] flex-col rounded-xl border border-line bg-canvas/50 p-3"
          >
            {/* 顶部胶囊标题（纯文字，无多余图标） */}
            <div
              className="
                mb-2 inline-flex w-fit items-center
                rounded-full bg-brand-soft px-3 py-1
                text-xs font-semibold text-ink-strong
              "
            >
              <span>{g.title || '未命名'}</span>
            </div>

            {/* 子模块列表 */}
            {g.modules.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-xs text-ink-mute">
                暂无模块
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {g.modules.map((m) => {
                  const meta = BUILTIN_MODULES[m]
                  if (!meta) return null // 防御：跳过已下线的模块（如 KPI），避免整屏崩溃
                  return (
                    <li key={m}>
                      <Link
                        to={meta.route}
                        className="
                          flex items-center gap-2 rounded-lg px-2 py-1.5
                          text-sm text-ink-strong
                          transition hover:bg-brand-soft
                        "
                      >
                        <span className="grid h-6 w-6 place-items-center rounded-md bg-brand-soft text-ink-strong">
                          {renderIcon(m === 'overview' ? 'home' : m === 'todos' ? 'check' : m === 'requirements' ? 'doc' : m === 'sprints' ? 'clock' : m === 'bugs' ? 'bell' : m === 'tag-dict' ? 'tag' : 'gear')}
                        </span>
                        <span>{meta.title}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ))}
      </div>

      {/* 一级 Tab 名称（迷你副标） */}
      <div className="flex items-center justify-between border-t border-line pt-2 text-xs text-ink-mute">
        <span>{primary.title}</span>
        <Link
          to={`/modules/${primary.groups[0]?.modules[0] ?? 'overview'}`}
          className="rounded-md px-2 py-0.5 text-ink-soft transition hover:bg-brand-soft hover:text-ink-strong"
        >
          进入 →
        </Link>
      </div>
    </div>
  )
}
