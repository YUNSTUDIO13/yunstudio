// 系统设置 · 字典管理二级页
// 功能：
//  1. 数据列：字段名（chip）+ 枚举值（多值 chip）+ 操作（编辑/删除）
//  2. 新增/编辑 Modal：字段名（select + 已有枚举）、字段值（输入+重复校验+已存在列表展示）
//  3. 删除：若有 4 业务表引用 → 拦截提示；否则可删
//  4. 字段名为空时禁止保存/删除
import { useMemo, useState } from 'react'
import {
  Modal,
  Field,
  Input,
  Button,
  Select,
  ConfirmDialog,
  Card,
} from '../components/ui'
import { useTags } from '../context/TagsContext'
import type { TagCategory, TagValue } from '../types'

interface EditState {
  categoryId: string | null // null = 新建
  draftName: string
  // 新增 value 草稿
  newValue: string
  newValueError: string
}

const ALL_VALUES_OPTION = '__ALL__'

export default function TagDictPage() {
  const {
    categories,
    values,
    loading,
    refresh,
    addCategory,
    renameCategory,
    removeCategoryIfNoReferences,
    addValue,
    removeValueIfNoReferences,
    countReferences,
  } = useTags()

  const [filterCategoryId, setFilterCategoryId] = useState<string>(ALL_VALUES_OPTION)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [del, setDel] = useState<TagCategory | null>(null)
  const [delVal, setDelVal] = useState<TagValue | null>(null)
  const [busy, setBusy] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  // 按字段名分组后的 values
  const grouped = useMemo(() => {
    const map = new Map<string, TagValue[]>()
    for (const c of categories) map.set(c.id, [])
    for (const v of values) {
      const arr = map.get(v.category_id)
      if (arr) arr.push(v)
    }
    return map
  }, [categories, values])

  const visible = useMemo(() => {
    if (filterCategoryId === ALL_VALUES_OPTION) return categories
    return categories.filter((c) => c.id === filterCategoryId)
  }, [categories, filterCategoryId])

  function openCreate() {
    setEdit({
      categoryId: null,
      draftName: categories[0]?.name ?? '标签',
      newValue: '',
      newValueError: '',
    })
    setGlobalError(null)
  }

  function openEdit(c: TagCategory) {
    setEdit({ categoryId: c.id, draftName: c.name, newValue: '', newValueError: '' })
    setGlobalError(null)
  }

  async function submitEdit() {
    if (!edit) return
    setBusy(true)
    setGlobalError(null)
    try {
      const name = edit.draftName.trim()
      if (!name) throw new Error('字段名不能为空')
      if (edit.categoryId) {
        await renameCategory(edit.categoryId, name)
      } else {
        await addCategory({ name })
        // 新建后定位到新建的类目
        const created = categories.find((c) => c.name === name)
        // 若 addCategory 内已更新 state，refresh 会刷新；这里保持 UI 等待刷新
        await refresh()
        const found = (await refreshedList()).find((c) => c.name === name)
        if (found) {
          setEdit((cur) =>
            cur
              ? {
                  categoryId: found.id,
                  draftName: found.name,
                  newValue: cur.newValue,
                  newValueError: cur.newValueError,
                }
              : null,
          )
          return
        }
        void created
      }
      if (edit.categoryId && edit.newValue.trim()) {
        await addValue({
          category_id: edit.categoryId,
          value: edit.newValue.trim(),
        })
        setEdit((cur) => (cur ? { ...cur, newValue: '', newValueError: '' } : cur))
      }
      // 若只是改名，关闭 modal
      if (edit.categoryId) {
        setEdit(null)
      }
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function refreshedList(): Promise<TagCategory[]> {
    await refresh()
    return categories
  }

  async function addNewValueInline() {
    if (!edit) return
    if (!edit.categoryId) {
      setEdit((cur) =>
        cur ? { ...cur, newValueError: '请先保存字段名后再新增枚举值' } : cur,
      )
      return
    }
    const v = edit.newValue.trim()
    if (!v) {
      setEdit((cur) => (cur ? { ...cur, newValueError: '枚举值不能为空' } : cur))
      return
    }
    const exists = values.some(
      (x) => x.category_id === edit.categoryId && x.value === v,
    )
    if (exists) {
      setEdit((cur) => (cur ? { ...cur, newValueError: `「${v}」已存在` } : cur))
      return
    }
    setBusy(true)
    setGlobalError(null)
    try {
      await addValue({ category_id: edit.categoryId, value: v })
      setEdit((cur) => (cur ? { ...cur, newValue: '', newValueError: '' } : cur))
    } catch (e) {
      setEdit((cur) =>
        cur
          ? { ...cur, newValueError: e instanceof Error ? e.message : String(e) }
          : cur,
      )
    } finally {
      setBusy(false)
    }
  }

  async function tryRemoveCategory(c: TagCategory) {
    setGlobalError(null)
    try {
      await removeCategoryIfNoReferences(c.id)
      setDel(null)
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : String(e))
    }
  }

  async function tryRemoveValue(v: TagValue) {
    setGlobalError(null)
    try {
      const refs = await countReferences(v.id)
      if (refs > 0) {
        setGlobalError(
          `枚举值「${v.value}」还被 ${refs} 条业务数据引用，请先在对应模块替换或删除数据后再来删除。`,
        )
        setDelVal(null)
        return
      }
      await removeValueIfNoReferences(v.id)
      setDelVal(null)
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* 顶部 */}
      <header className="flex flex-wrap items-end justify-between gap-3 glass-card p-5">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.25em] text-ink-mute">
            System · 字典管理
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-ink-strong">字典管理</h1>
          <p className="mt-1 text-sm text-ink-soft">
            维护所有受控枚举字段的取值。当前主用「标签」字段（已被待办 / 需求 / 迭代 / 缺陷四个模块引用）；后续可新增「优先级」「受理人」等同模式字段。
          </p>
          {globalError ? (
            <div className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {globalError}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="soft" onClick={() => refresh()}>刷新</Button>
          <Button onClick={openCreate}>新增字段名</Button>
        </div>
      </header>

      {/* 筛选 */}
      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs text-ink-mute">字段名</div>
          <Select
            value={filterCategoryId}
            onChange={(v) => setFilterCategoryId(v as string)}
            className="!w-auto min-w-[180px] flex-1 basis-[180px] md:flex-none md:basis-auto"
            aria-label="按字段名筛选"
          >
            <option value={ALL_VALUES_OPTION}>全部</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <span className="ml-auto text-xs text-ink-mute">共 {visible.length} 条</span>
        </div>
      </Card>

      {/* 数据列 */}
      <Card>
        {loading ? (
          <p className="py-12 text-center text-sm text-ink-mute">加载中…</p>
        ) : visible.length === 0 ? (
          <p className="py-12 text-center text-sm text-ink-mute">
            暂无字典字段。点击右上角「新增字段名」开始维护。
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((c) => {
              const vals = grouped.get(c.id) ?? []
              return (
                <li key={c.id} className="flex flex-col gap-2 px-2 py-4 md:flex-row md:items-start md:gap-4">
                  <div className="md:w-32 shrink-0">
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-ink-strong">
                      {c.name}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    {vals.length === 0 ? (
                      <span className="text-xs text-ink-mute">
                        （暂无枚举值，点编辑添加）
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {vals.map((v) => (
                          <span
                            key={v.id}
                            className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-strong"
                          >
                            {v.value}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" onClick={() => openEdit(c)}>
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setDel(c)}
                      className="!text-danger hover:!bg-danger/10"
                    >
                      删除
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* 新增/编辑 Modal */}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.categoryId ? '编辑字段名' : '新增字段名'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              取消
            </Button>
            <Button onClick={submitEdit} disabled={busy}>
              {edit?.categoryId ? '保存' : '创建'}
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-2">
            <Field label="字段名">
              {edit.categoryId ? (
                <Input
                  value={edit.draftName}
                  onChange={(e) =>
                    setEdit({ ...edit, draftName: e.target.value })
                  }
                  placeholder="如：标签 / 优先级 / 受理人"
                />
              ) : (
                <Select
                  value={edit.draftName}
                  onChange={(v) =>
                    setEdit({ ...edit, draftName: v as string })
                  }
                  className="!w-full"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                  {/* 允许用户手动输入新字段名（通过 Input 切换） */}
                  <option value="__CUSTOM__">＋ 新字段名</option>
                </Select>
              )}
            </Field>

            {/* 新建模式下允许"自定义字段名"——下拉选 + 新增 */}
            {edit && !edit.categoryId && edit.draftName === '__CUSTOM__' && (
              <Field label="自定义字段名">
                <Input
                  value=""
                  onChange={(e) =>
                    setEdit({ ...edit, draftName: e.target.value })
                  }
                  placeholder="输入新字段名"
                />
              </Field>
            )}

            {/* 编辑模式下方展示已有枚举值 + 重复校验 + 内联新增 */}
            {edit.categoryId && (
              <>
                <Field
                  label="新增枚举值"
                  error={edit.newValueError}
                  hint="与下方已有值同名会拦截"
                >
                  <div className="flex gap-2">
                    <Input
                      value={edit.newValue}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          newValue: e.target.value,
                          newValueError: '',
                        })
                      }
                      placeholder="输入枚举值"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void addNewValueInline()
                        }
                      }}
                    />
                    <Button
                      variant="soft"
                      onClick={addNewValueInline}
                      disabled={busy}
                    >
                      添加
                    </Button>
                  </div>
                </Field>

                <div>
                  <div className="mb-2 text-xs font-medium text-ink-soft">
                    已有枚举值（点击 × 可尝试删除）
                  </div>
                  <div className="flex flex-wrap gap-1.5 rounded-xl border border-line bg-brand-soft/30 p-3">
                    {(grouped.get(edit.categoryId) ?? []).map((v) => (
                      <span
                        key={v.id}
                        className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-strong"
                      >
                        {v.value}
                        <button
                          type="button"
                          title="删除（被引用时拦截）"
                          onClick={() => setDelVal(v)}
                          className="grid h-4 w-4 place-items-center rounded-full text-ink-mute hover:bg-danger/10 hover:text-danger"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
                            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                          </svg>
                        </button>
                      </span>
                    ))}
                    {(grouped.get(edit.categoryId) ?? []).length === 0 && (
                      <span className="text-xs text-ink-mute">（暂无）</span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* 删除字段名确认 */}
      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={() => del && tryRemoveCategory(del)}
        title="删除字段名"
        message={
          del
            ? `确定删除字段名「${del.name}」？该字段名下的所有枚举值都会被一并删除。仅在该字段名下所有枚举值都未被 4 业务表引用时可删。`
            : ''
        }
        confirmText="删除"
        cancelText="取消"
        danger
      />

      {/* 删除枚举值确认 */}
      <ConfirmDialog
        open={!!delVal}
        onClose={() => setDelVal(null)}
        onConfirm={() => delVal && tryRemoveValue(delVal)}
        title="删除枚举值"
        message={
          delVal
            ? `确定删除枚举值「${delVal.value}」？仅在未被任何业务数据引用时可删。`
            : ''
        }
        confirmText="删除"
        cancelText="取消"
        danger
      />
    </div>
  )
}
