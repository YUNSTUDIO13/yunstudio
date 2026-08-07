import { useMemo, useState } from 'react'
import { Modal, Field, Input, Button, ConfirmDialog } from '../components/ui'
import { useNav } from '../context/NavContext'
import { BUILTIN_MODULES, BUILTIN_MODULE_IDS } from '../lib/builtin-modules'
import { renderIcon, ICONS, ICON_KEYS, ICON_LABELS, type IconKey } from '../lib/icon-library'
import type { NavPrimary } from '../lib/nav-types'

// ============================================================
// 子组件：图标选择器（24 宫格）
// ============================================================
function IconPicker({
  value,
  onChange,
}: {
  value: IconKey
  onChange: (k: IconKey) => void
}) {
  return (
    <div className="grid grid-cols-8 gap-2">
      {ICON_KEYS.map((k) => (
        <button
          type="button"
          key={k}
          onClick={() => onChange(k)}
          title={ICON_LABELS[k]}
          className={`
            grid h-10 w-10 place-items-center rounded-xl border transition
            ${
              k === value
                ? 'border-ink-strong bg-ink-strong text-white'
                : 'border-line bg-surface text-ink-soft hover:bg-brand-soft hover:text-ink-strong'
            }
          `}
        >
          {ICONS[k]}
        </button>
      ))}
    </div>
  )
}

// ============================================================
// 主页面
// ============================================================
export default function NavConfigPage() {
  const { config, actions } = useNav()
  const [editingPrimary, setEditingPrimary] = useState<{ id?: string } | null>(null)
  const [editingGroup, setEditingGroup] = useState<
    { primaryId: string; groupId?: string } | null
  >(null)
  const [editingModules, setEditingModules] = useState<
    { primaryId: string; groupId: string; moduleIds: string[] } | null
  >(null)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [delPrimary, setDelPrimary] = useState<NavPrimary | null>(null)

  const sortedPrimaries = useMemo(
    () => [...config.primaries].sort((a, b) => a.order - b.order),
    [config.primaries],
  )

  return (
    <div className="space-y-6">
      {/* 顶部：标题 + 重置默认 */}
      <header className="flex items-start justify-between gap-4 rounded-2xl bg-surface p-5 shadow-card">
        <div>
          <h1 className="text-xl font-semibold text-ink-strong">导航栏配置</h1>
          <p className="mt-1 text-sm text-ink-soft">
            自定义一级 Tab（图标与名称）、二级列分组，以及三级模块归属。当前数据存于本地 localStorage。
          </p>
        </div>
        <Button variant="soft" onClick={() => setResetConfirm(true)}>
          重置默认
        </Button>
      </header>

      {/* 一级 Tab 列表 */}
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-strong">一级 Tab</h2>
          <Button
            className="px-3 py-1.5 text-xs"
            onClick={() => setEditingPrimary({})}
          >
            + 新增一级 Tab
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sortedPrimaries.map((p, idx) => (
            <div
              key={p.id}
              className="rounded-2xl border border-line bg-canvas/40 p-4"
            >
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-ink-strong">
                  {renderIcon(p.iconKey)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink-strong">
                    {p.title}
                  </div>
                  <div className="text-xs text-ink-mute">
                    {p.groups.length} 个二级列 · {p.groups.reduce((n, g) => n + g.modules.length, 0)} 个模块
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <IconBtn
                    title="上移"
                    onClick={() => actions.movePrimary(p.id, 'up')}
                    disabled={idx === 0}
                  >
                    ↑
                  </IconBtn>
                  <IconBtn
                    title="下移"
                    onClick={() => actions.movePrimary(p.id, 'down')}
                    disabled={idx === sortedPrimaries.length - 1}
                  >
                    ↓
                  </IconBtn>
                  <IconBtn title="编辑" onClick={() => setEditingPrimary({ id: p.id })}>
                    ✎
                  </IconBtn>
                  <IconBtn title="删除" onClick={() => setDelPrimary(p)} danger>
                    ✕
                  </IconBtn>
                </div>
              </div>

              {/* 二级列子列表 */}
              <div className="mt-3 space-y-1.5 border-t border-line pt-3">
                {p.groups.map((g, gIdx) => (
                  <div
                    key={g.id}
                    className="flex items-center gap-2 rounded-lg bg-surface/70 px-2 py-1.5"
                  >
                    <span className="grid h-5 w-5 place-items-center rounded-md bg-brand-soft text-xs text-ink-strong">
                      {gIdx + 1}
                    </span>
                    <span className="flex-1 truncate text-sm text-ink-strong">
                      {g.title || '未命名'}
                    </span>
                    <span className="text-xs text-ink-mute">{g.modules.length} 模块</span>
                    <button
                      type="button"
                      title="上移"
                      disabled={gIdx === 0}
                      onClick={() => actions.moveSecondary(p.id, g.id, 'up')}
                      className="rounded-md px-1 text-ink-soft transition hover:bg-brand-soft disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      title="下移"
                      disabled={gIdx === p.groups.length - 1}
                      onClick={() => actions.moveSecondary(p.id, g.id, 'down')}
                      className="rounded-md px-1 text-ink-soft transition hover:bg-brand-soft disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      title="编辑"
                      onClick={() => setEditingGroup({ primaryId: p.id, groupId: g.id })}
                      className="rounded-md px-1 text-ink-soft transition hover:bg-brand-soft"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      title="删除"
                      onClick={() => actions.removeSecondary(p.id, g.id)}
                      className="rounded-md px-1 text-ink-soft transition hover:bg-danger/10 hover:text-danger"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setEditingGroup({ primaryId: p.id })}
                  className="w-full rounded-lg border border-dashed border-line bg-transparent py-1.5 text-xs text-ink-soft transition hover:border-ink-strong hover:text-ink-strong"
                >
                  + 新增二级列
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 高级：按一级 Tab 编辑三级模块归属（点二级列「编辑」并切到模块面板） */}
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-strong">三级模块归属</h2>
          <div className="text-xs text-ink-mute">
            点击二级列的「✎ 编辑」展开此面板，调整该二级列下挂哪些预置模块
          </div>
        </div>

        {!editingModules && (
          <div className="rounded-xl border border-dashed border-line bg-canvas/30 p-8 text-center text-sm text-ink-mute">
            请从上方一级 Tab 卡片里点任意「二级列 → ✎ 编辑」打开此面板。
          </div>
        )}

        {editingModules && (
          <GroupModuleEditor
            primaryId={editingModules.primaryId}
            groupId={editingModules.groupId}
            moduleIds={editingModules.moduleIds}
            onChange={(next) =>
              setEditingModules({ ...editingModules, moduleIds: next })
            }
            onSave={() => {
              actions.setGroupModules(
                editingModules.primaryId,
                editingModules.groupId,
                editingModules.moduleIds as never,
              )
              setEditingModules(null)
            }}
            onCancel={() => setEditingModules(null)}
          />
        )}
      </section>

      {/* ===== Modals ===== */}
      {/* 一级 Tab 编辑 Modal */}
      {editingPrimary && (
        <PrimaryEditModal
          primary={editingPrimary.id ? sortedPrimaries.find((p) => p.id === editingPrimary.id) : undefined}
          onSave={(title, iconKey) => {
            if (editingPrimary.id) {
              actions.updatePrimary(editingPrimary.id, { title, iconKey })
            } else {
              actions.addPrimary({ title, iconKey })
            }
            setEditingPrimary(null)
          }}
          onClose={() => setEditingPrimary(null)}
        />
      )}

      {/* 二级列编辑 Modal */}
      {editingGroup && (
        <SecondaryEditModal
          primaryId={editingGroup.primaryId}
          group={
            editingGroup.groupId
              ? sortedPrimaries
                  .find((p) => p.id === editingGroup.primaryId)
                  ?.groups.find((g) => g.id === editingGroup.groupId)
              : undefined
          }
          onSave={(title) => {
            if (editingGroup.groupId) {
              actions.updateSecondary(editingGroup.primaryId, editingGroup.groupId, title)
            } else {
              actions.addSecondary(editingGroup.primaryId, { title })
            }
            setEditingGroup(null)
          }}
          onManageModules={(groupId) => {
            const g = sortedPrimaries
              .find((p) => p.id === editingGroup.primaryId)
              ?.groups.find((x) => x.id === groupId)
            if (!g) return
            setEditingGroup(null)
            setEditingModules({
              primaryId: editingGroup.primaryId,
              groupId,
              moduleIds: [...g.modules],
            })
          }}
          onClose={() => setEditingGroup(null)}
        />
      )}

      {/* 重置默认确认 */}
      <ConfirmDialog
        open={resetConfirm}
        title="重置为默认配置？"
        message="将清空所有自定义的一级 Tab、二级列与模块归属，恢复初次使用的默认布局。"
        confirmText="重置"
        danger
        onConfirm={() => {
          actions.resetToDefault()
          setEditingModules(null)
          setResetConfirm(false)
        }}
        onClose={() => setResetConfirm(false)}
      />

      {/* 删除一级 Tab 确认 */}
      <ConfirmDialog
        open={!!delPrimary}
        title={delPrimary ? `删除一级 Tab「${delPrimary.title}」？` : ''}
        message="该一级 Tab 下的所有二级列与模块归属也会一并删除。（相关业务数据本身不删）"
        confirmText="删除"
        danger
        onConfirm={() => {
          const target = delPrimary
          if (!target) return
          actions.removePrimary(target.id)
          if (
            editingModules &&
            sortedPrimaries.find((p) => p.id === editingModules.primaryId)?.id ===
              target.id
          ) {
            setEditingModules(null)
          }
          setDelPrimary(null)
        }}
        onClose={() => setDelPrimary(null)}
      />
    </div>
  )
}

// ============================================================
// 子组件：小图标按钮（与 ui 库解耦，本页面专用）
// ============================================================
function IconBtn({
  children,
  onClick,
  title,
  danger,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  title?: string
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`
        grid h-7 w-7 place-items-center rounded-md text-xs transition
        ${
          danger
            ? 'text-ink-soft hover:bg-danger/10 hover:text-danger'
            : 'text-ink-soft hover:bg-brand-soft hover:text-ink-strong'
        }
        disabled:cursor-not-allowed disabled:opacity-30
      `}
    >
      {children}
    </button>
  )
}

// ============================================================
// 子组件：一级 Tab 编辑 Modal
// ============================================================
function PrimaryEditModal({
  primary,
  onSave,
  onClose,
}: {
  primary?: NavPrimary
  onSave: (title: string, iconKey: IconKey) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(primary?.title ?? '')
  const [iconKey, setIconKey] = useState<IconKey>(primary?.iconKey ?? 'list')
  return (
    <Modal
      open
      onClose={onClose}
      title={primary ? '编辑一级 Tab' : '新增一级 Tab'}
      maxWidth="max-w-lg"
      footer={
        <>
          <Button variant="soft" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => title.trim() && onSave(title.trim(), iconKey)} disabled={!title.trim()}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="一级 Tab 名称" hint="必填">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：工作 / 生活 / 学习" />
        </Field>
        <Field label="一级 Tab 图标">
          <IconPicker value={iconKey} onChange={setIconKey} />
        </Field>
      </div>
    </Modal>
  )
}

// ============================================================
// 子组件：二级列编辑 Modal
// ============================================================
function SecondaryEditModal({
  primaryId,
  group,
  onSave,
  onManageModules,
  onClose,
}: {
  primaryId: string
  group?: { id: string; title: string; modules: string[] }
  onSave: (title: string) => void
  onManageModules: (groupId: string) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(group?.title ?? '')
  return (
    <Modal
      open
      onClose={onClose}
      title={group ? '编辑二级列' : '新增二级列'}
      maxWidth="max-w-md"
      footer={
        <>
          <Button variant="soft" onClick={onClose}>
            取消
          </Button>
          {group && (
            <Button variant="soft" onClick={() => onManageModules(group.id)}>
              管理三级模块
            </Button>
          )}
          <Button onClick={() => title.trim() && onSave(title.trim())} disabled={!title.trim()}>
            保存
          </Button>
        </>
      }
    >
      <Field label="二级列标题" hint="必填">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：今日聚焦 / 团队协作" />
      </Field>
      {/* 提供一个便捷入口：还没填标题也想直接管理模块 */}
      {!group && (
        <div className="mt-2 text-xs text-ink-mute">
          二级列保存后再点击「管理三级模块」继续配置。
        </div>
      )}
      <span className="hidden">{primaryId}</span>
    </Modal>
  )
}

// ============================================================
// 子组件：三级模块归属编辑器（核心交互）
// ============================================================
function GroupModuleEditor({
  primaryId,
  groupId,
  moduleIds,
  onChange,
  onSave,
  onCancel,
}: {
  primaryId: string
  groupId: string
  moduleIds: string[]
  onChange: (next: string[]) => void
  onSave: () => void
  onCancel: () => void
}) {
  const { config, findPrimaryByModule } = useNav()

  // 显示：当前一级 Tab 的所有二级列中已分配的模块 → 用于做交叉提示
  const usedInOtherGroups = useMemo(() => {
    const used = new Map<string, string>() // moduleId -> groupTitle
    const p = config.primaries.find((pp) => pp.id === primaryId)
    if (!p) return used
    for (const g of p.groups) {
      if (g.id === groupId) continue
      for (const m of g.modules) {
        used.set(m, g.title || '未命名')
      }
    }
    return used
  }, [config, primaryId, groupId])

  function toggle(mod: string) {
    if (moduleIds.includes(mod)) {
      onChange(moduleIds.filter((m) => m !== mod))
    } else {
      onChange([...moduleIds, mod])
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-canvas/40 p-3 text-sm">
        <div className="mb-2 font-semibold text-ink-strong">
          一级 Tab「{config.primaries.find((p) => p.id === primaryId)?.title}」下的二级列
        </div>
        <div className="text-xs text-ink-mute">
          勾选要归属到当前二级列下的三级模块；勾掉即从该二级列移除。
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {BUILTIN_MODULE_IDS.map((mid) => {
          const meta = BUILTIN_MODULES[mid]
          const checked = moduleIds.includes(mid)
          const conflict = usedInOtherGroups.get(mid)
          const inOtherPrim = findPrimaryByModule(mid) &&
            findPrimaryByModule(mid)!.id !== primaryId
            ? findPrimaryByModule(mid)!
            : null
          return (
            <label
              key={mid}
              className={`
                flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition
                ${
                  checked
                    ? 'border-ink-strong bg-brand-soft'
                    : 'border-line bg-canvas/40 hover:border-ink-soft'
                }
              `}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(mid)}
                className="mt-1 h-4 w-4 accent-ink-strong"
              />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink-strong">{meta.title}</div>
                <div className="mt-0.5 text-xs text-ink-mute">{meta.desc}</div>
                {conflict && (
                  <div className="mt-1 text-xs text-warning">
                    ⚠ 本一级 Tab 内「{conflict}」已挂此模块
                  </div>
                )}
                {inOtherPrim && !conflict && (
                  <div className="mt-1 text-xs text-ink-mute">
                    也被分配到一级 Tab「{inOtherPrim.title}」
                  </div>
                )}
              </div>
            </label>
          )
        })}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="soft" onClick={onCancel}>
          取消
        </Button>
        <Button onClick={onSave}>保存归属</Button>
      </div>
      <span className="hidden">{groupId}</span>
    </div>
  )
}
