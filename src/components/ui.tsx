import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'

/* ----------------------------- 卡片 ----------------------------- */
export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-card border border-line bg-surface p-6 shadow-card ${className}`}
    >
      {children}
    </div>
  )
}

/* ----------------------------- 表单 ----------------------------- */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-xs font-medium text-ink-soft">
        {label}
      </span>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-ink-mute">{hint}</p>
      ) : null}
    </label>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-strong outline-none transition placeholder:text-ink-mute hover:border-ink-mute/60 focus:border-accent focus:ring-2 focus:ring-accent/15"
    />
  )
}

/* ----------------------------- 自建 Listbox 风格的 Select -----------------------------
 * 原生 <select> 的下拉浮层由 OS 渲染，无法用 CSS 控制（系统蓝底白字、Windows 2000 味）
 * 这里完全自建：受控 button 触发 + 自定义 ul 浮层 + 暖米风颜值 + 完整键盘 + a11y
 *
 * API 兼容旧用法：<Select value onChange><option value="x">label</option></Select>
 * 但 onChange 签名改为 (value: string) => void，不再是 ChangeEvent
 */
type ParsedOption = { value: string; label: string; disabled?: boolean }

function parseChildren(children: ReactNode): ParsedOption[] {
  const out: ParsedOption[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const t = child.type as unknown
    if (t === 'option') {
      const p = child.props as { value?: string | number; children?: ReactNode; disabled?: boolean }
      const v = String(p.value ?? '')
      const label = stringifyLabel(p.children) || v
      out.push({ value: v, label, disabled: p.disabled })
    } else if (t === 'optgroup') {
      const p = child.props as { label?: string; children?: ReactNode }
      const groupLabel = p.label ?? ''
      Children.forEach(p.children, (gc) => {
        if (!isValidElement(gc)) return
        if ((gc.type as unknown) === 'option') {
          const gp = gc.props as { value?: string | number; children?: ReactNode }
          const v = String(gp.value ?? '')
          const inner = stringifyLabel(gp.children) || v
          out.push({ value: v, label: groupLabel ? `${groupLabel} · ${inner}` : inner })
        }
      })
    }
  })
  return out
}

function stringifyLabel(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  // 多个 children 拼接
  let s = ''
  Children.forEach(node, (c) => {
    if (typeof c === 'string' || typeof c === 'number') s += String(c)
  })
  return s.trim()
}

type SelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'onChange' | 'value' | 'children' | 'size'
> & {
  value: string
  onChange: (value: string) => void
  children: ReactNode
  /** 触发器尺寸：md(36px) | sm(32px) */
  size?: 'sm' | 'md'
  /** 占位提示（value 找不到对应 option 时显示） */
  placeholder?: string
  /** 触发器对齐方式：start(默认) | center */
  align?: 'start' | 'center'
}

export function Select({
  value,
  onChange,
  children,
  className = '',
  disabled,
  name,
  id,
  size = 'md',
  placeholder = '请选择',
  align = 'start',
  ...rest
}: SelectProps) {
  // 取出 aria-* 等剩余属性
  const ariaLabel = (rest as Record<string, unknown>)['aria-label']

  const options = useMemo(() => parseChildren(children), [children])
  const current = options.find((o) => o.value === value) ?? null

  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(() => {
    const i = options.findIndex((o) => o.value === value)
    return i >= 0 ? i : 0
  })

  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  // 同步 active：打开时或 value 变化时
  useEffect(() => {
    if (open) {
      const i = options.findIndex((o) => o.value === value)
      setActiveIdx(i >= 0 ? i : 0)
    }
  }, [open, value, options])

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node | null
      if (
        t &&
        !triggerRef.current?.contains(t) &&
        !popRef.current?.contains(t)
      ) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function commit(idx: number) {
    const opt = options[idx]
    if (!opt || opt.disabled) return
    onChange(opt.value)
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return
    if (!open) {
      if (
        e.key === 'ArrowDown' ||
        e.key === 'ArrowUp' ||
        e.key === 'Enter' ||
        e.key === ' '
      ) {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIdx((i) => Math.min(options.length - 1, i + 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIdx((i) => Math.max(0, i - 1))
        break
      case 'Home':
        e.preventDefault()
        setActiveIdx(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIdx(options.length - 1)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        commit(activeIdx)
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  const heightCls = size === 'sm' ? 'h-8' : 'h-9'
  const textCls = size === 'sm' ? 'text-[13px]' : 'text-sm'

  return (
    <div className={`relative w-full ${className}`}>
      {/* 原生表单提交兼容：有 name 时塞一个隐藏 input */}
      {name ? <input type="hidden" name={name} value={value ?? ''} /> : null}

      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={(ariaLabel as string) || undefined}
        id={id}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={`group flex w-full ${heightCls} items-center rounded-lg border bg-surface ${textCls} outline-none transition ${
          open
            ? 'border-accent/60 ring-2 ring-accent/15'
            : 'border-line hover:border-ink-mute/60 focus:border-accent focus:ring-2 focus:ring-accent/15'
        } ${
          disabled
            ? 'cursor-not-allowed opacity-50'
            : 'cursor-pointer'
        }`}
      >
        <span
          className={`min-w-0 flex-1 truncate ${
            align === 'center' ? 'pl-0 text-center' : 'pl-3.5 text-left'
          } ${
            current ? 'text-ink-strong' : 'text-ink-mute'
          }`}
        >
          {current ? current.label : placeholder}
        </span>
        <span
          aria-hidden
          className="flex h-full shrink-0 items-center pl-2.5 pr-2.5 text-ink-mute transition-colors group-hover:text-ink-soft"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-3.5 w-3.5 transition-transform duration-200 ${
              open ? 'rotate-180 text-ink-soft' : ''
            }`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {open ? (
        <div
          ref={popRef}
          className="absolute left-0 right-0 top-full z-50 mt-1.5 origin-top animate-popover rounded-xl border border-line bg-surface shadow-card-hover"
          style={{ minWidth: '100%' }}
        >
          <ul
            id={listboxId}
            role="listbox"
            tabIndex={-1}
            aria-label={(ariaLabel as string) || undefined}
            className="max-h-64 overflow-auto p-1"
          >
            {options.length === 0 ? (
              <li className="px-2.5 py-3 text-center text-xs text-ink-mute">
                暂无可选项
              </li>
            ) : (
              options.map((o, i) => {
                const selected = o.value === value
                const isActive = i === activeIdx
                return (
                  <li
                    key={o.value || `opt-${i}`}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={o.disabled || undefined}
                    onMouseEnter={() => setActiveIdx(i)}
                    onMouseDown={(e) => {
                      // 防止 mousedown 抢走 button focus
                      e.preventDefault()
                    }}
                    onClick={() => commit(i)}
                    className={`flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-sm transition-colors ${
                      selected
                        ? 'bg-brand-soft font-medium text-ink-strong'
                        : isActive
                          ? 'bg-brand-soft/70 text-ink-strong'
                          : 'text-ink-strong hover:bg-brand-soft/50'
                    } ${o.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    <span
                      aria-hidden
                      className={`grid h-4 w-4 shrink-0 place-items-center transition-opacity ${
                        selected
                          ? 'text-accent opacity-100'
                          : 'opacity-0'
                      }`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3.5 w-3.5"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                    <span className="truncate">{o.label}</span>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return (
    <textarea
      {...props}
      className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink-strong outline-none transition placeholder:text-ink-mute focus:border-accent focus:ring-2 focus:ring-accent/15"
    />
  )
}

/* ----------------------------- 按钮 ----------------------------- */
export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'soft' | 'danger'
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50'
  const styles =
    variant === 'primary'
      ? 'bg-ink-strong text-white shadow-sm hover:bg-ink-strong/90'
      : variant === 'soft'
        ? 'bg-brand-soft text-ink-strong hover:bg-line'
        : variant === 'danger'
          ? 'bg-danger text-white shadow-sm hover:bg-danger/90'
          : 'border border-line bg-surface text-ink-strong hover:bg-brand-soft'
  return (
    <button {...props} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  )
}

export function IconButton({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink-soft transition hover:bg-brand-soft hover:text-ink-strong disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  )
}

/* ----------------------------- 弹窗 Modal ----------------------------- */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  maxWidth?: string
}) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    // 锁定背景滚动
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* 遮罩 */}
      <button
        aria-label="关闭"
        className="absolute inset-0 animate-overlay bg-ink-strong/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      {/* 内容 */}
      <div
        className={`animate-modal relative z-10 w-full ${maxWidth} rounded-card border border-line bg-surface p-6 shadow-card-hover`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-strong">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-ink-mute transition hover:bg-brand-soft hover:text-ink-strong"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <div>{children}</div>
        {footer && (
          <div className="mt-6 flex justify-end gap-3">{footer}</div>
        )}
      </div>
    </div>
  )
}

/* ----------------------------- 确认对话框 ----------------------------- */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      maxWidth="max-w-sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {cancelText}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-soft">{message}</p>
    </Modal>
  )
}
