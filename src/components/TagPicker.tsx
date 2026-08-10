// 标签字典共享组件
//  - TagPicker：表单内使用，单选 chip 列表（横排，selected 高亮靛紫）
//  - TagChip：列表行展示用，只读 chip
// 接 useTags() 字典上下文，单一字典"标签"类目（默认）。后续若字段名扩展，可传 categoryName 指定。
import { useMemo } from 'react'
import { useTags } from '../context/TagsContext'

const DEFAULT_CATEGORY_NAME = '标签'

export function TagPicker({
  value,
  onChange,
  categoryName = DEFAULT_CATEGORY_NAME,
  className = '',
}: {
  /** 选中的 tag_value.id（或 null） */
  value: string | null | undefined
  onChange: (v: string | null) => void
  categoryName?: string
  className?: string
}) {
  const { categories, valuesByCategoryId, categoryByName } = useTags()

  const opts = useMemo(() => {
    const cat = categoryByName(categoryName) ?? categories[0]
    if (!cat) return []
    return valuesByCategoryId(cat.id)
  }, [categories, categoryByName, valuesByCategoryId, categoryName])

  if (opts.length === 0) {
    return (
      <div className={`text-xs text-ink-mute ${className}`}>
        （字典为空，去「系统设置 → 字典管理」添加）
      </div>
    )
  }

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {opts.map((v) => {
        const selected = v.id === value
        return (
          <button
            type="button"
            key={v.id}
            onClick={() => onChange(selected ? null : v.id)}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition ${
              selected
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-line bg-surface text-ink-soft hover:border-ink-soft hover:text-ink-strong'
            }`}
          >
            {v.value}
          </button>
        )
      })}
    </div>
  )
}

export function TagChip({ tagId }: { tagId?: string | null }) {
  const { valueById } = useTags()
  if (!tagId) return null
  const v = valueById(tagId)
  if (!v) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-ink-strong">
      {v.value}
    </span>
  )
}
