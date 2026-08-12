import { useEffect, useRef } from 'react'
import {
  THEME_IDS,
  THEME_LABELS,
  SKIN_IDS,
  SKIN_LABELS,
  useUI,
  useSkin,
  type ThemeId,
  type SkinId,
  type UISettingsConfig,
} from '../context/UIContext'
import { renderIcon } from '../lib/icon-library'

// ============================================================
// 单主题卡：toggle + 颜色选择 + 预览缩略
// ============================================================
function ThemeCard({
  themeId,
  cfg,
  masterEnabled,
  onToggle,
  onColorChange,
}: {
  themeId: ThemeId
  cfg: UISettingsConfig['themes'][ThemeId]
  masterEnabled: boolean
  onToggle: (enabled: boolean) => void
  onColorChange: (color: string) => void
}) {
  const meta = THEME_LABELS[themeId]
  return (
    <div
      className={`
        relative overflow-hidden rounded-2xl border p-4 transition
        ${masterEnabled && cfg.enabled
          ? 'border-accent/40 bg-accent/5 shadow-glow'
          : 'border-line bg-surface/40'}
      `}
    >
      {/* 预览缩略 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30 transition-opacity"
        style={{ opacity: masterEnabled && cfg.enabled ? 0.45 : 0.18 }}
      >
        <ThemePreview themeId={themeId} color={cfg.color} />
      </div>

      <div className="relative z-10 flex items-start gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink-strong">{meta.title}</span>
            {themeId === 'comet' ? (
              <span className="grid h-5 w-5 place-items-center text-ink-soft">
                {renderIcon('spark')}
              </span>
            ) : (
              <span className="grid h-5 w-5 place-items-center text-ink-soft">
                {renderIcon('star')}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">{meta.desc}</p>
        </div>

        {/* 主开关：单主题启用/禁用 */}
        <button
          type="button"
          role="switch"
          aria-checked={cfg.enabled}
          aria-label={`${meta.title}开关`}
          disabled={!masterEnabled}
          onClick={() => onToggle(!cfg.enabled)}
          className={`
            relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition
            ${cfg.enabled && masterEnabled
              ? 'border-accent bg-accent'
              : 'border-line bg-white/5'}
            ${!masterEnabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
          `}
        >
          <span
            className={`
              pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition
              ${cfg.enabled && masterEnabled ? 'translate-x-5' : 'translate-x-1'}
            `}
          />
        </button>
      </div>

      <div className="relative z-10 mt-3 flex items-center gap-3 border-t border-line pt-3">
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <span>颜色</span>
          <input
            type="color"
            value={cfg.color}
            disabled={!masterEnabled}
            onChange={(e) => onColorChange(e.target.value)}
            className="h-7 w-7 cursor-pointer rounded-md border border-line bg-transparent p-0 disabled:cursor-not-allowed"
            aria-label={`${meta.title}颜色`}
          />
          <code className="rounded bg-surface/60 px-1.5 py-0.5 text-[10px] text-ink-mute">
            {cfg.color}
          </code>
        </label>
        {/* 快捷色 */}
        <div className="ml-auto flex gap-1.5">
          {['#a78bfa', '#c084fc', '#f472b6', '#22d3ee', '#34d399', '#fbbf24'].map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`使用 ${c}`}
              disabled={!masterEnabled}
              onClick={() => onColorChange(c)}
              className={`
                h-4 w-4 rounded-full border transition
                ${cfg.color.toLowerCase() === c ? 'border-white scale-110' : 'border-white/20 hover:border-white/50'}
                ${!masterEnabled ? 'cursor-not-allowed opacity-40' : ''}
              `}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 主题预览缩略（小型静态模拟）—— 不跑 rAF，只画一帧示意
// ============================================================
function ThemePreview({ themeId, color }: { themeId: ThemeId; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const rect = c.getBoundingClientRect()
    c.width = rect.width * dpr
    c.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, rect.width, rect.height)

    const path = [
      { x: rect.width * 0.05, y: rect.height * 0.85 },
      { x: rect.width * 0.25, y: rect.height * 0.65 },
      { x: rect.width * 0.45, y: rect.height * 0.45 },
      { x: rect.width * 0.65, y: rect.height * 0.35 },
      { x: rect.width * 0.85, y: rect.height * 0.55 },
      { x: rect.width * 0.95, y: rect.height * 0.4 },
    ]
    if (themeId === 'comet') {
      // 渐变线段
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]
        const b = path[i]
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y)
        grad.addColorStop(0, color + '00')
        grad.addColorStop(1, color + 'ff')
        ctx.strokeStyle = grad
        ctx.lineWidth = 2.5
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      // 头点
      const head = path[path.length - 1]
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(head.x, head.y, 3, 0, Math.PI * 2)
      ctx.fill()
    } else {
      // 粒子散布
      const seed = themeId === 'particles' ? 1 : 2
      let s = seed
      const rand = () => {
        s = (s * 9301 + 49297) % 233280
        return s / 233280
      }
      for (let i = 0; i < 26; i++) {
        const t = i / 25
        const p = path[Math.min(path.length - 1, Math.floor(t * (path.length - 1)))]
        const ox = (rand() - 0.5) * 22
        const oy = (rand() - 0.5) * 22
        ctx.fillStyle = color
        ctx.globalAlpha = 0.5 + rand() * 0.5
        ctx.beginPath()
        ctx.arc(p.x + ox, p.y + oy, 1 + rand() * 1.4, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }
  }, [themeId, color])
  return <canvas ref={ref} className="h-24 w-full rounded-xl" aria-hidden />
}

// ============================================================
// 皮肤预览缩略（手写样式展示皮肤的"真容"，不依赖 .glass-card / data-skin）
// ============================================================
function SkinPreview({ skinId }: { skinId: SkinId }) {
  // 三套皮肤色板：与 index.css 覆盖层的值严格一致，保证所见即所得
  const palette = skinId === 'liquid-glass'
    ? {
        bg: '#0e0e16',
        cardBg: 'rgba(255,255,255,0.038)',
        cardBorder: 'rgba(255,255,255,0.08)',
        radius: 20,
        accent: '#7c85f5',
        text: 'rgba(255,255,255,0.88)',
        mute: 'rgba(255,255,255,0.55)',
        hint: 'rgba(255,255,255,0.10)',
      }
    : skinId === 'flat-dark'
    ? {
        // 与 src/index.css [data-skin='flat-dark'] 段的 var(--xxx) 严格一致
        bg: '#0E1015',                                     // 画布：柔和深蓝黑
        cardBg: '#1A1C22',                                 // 卡：比画布亮 8%
        cardBorder: 'rgba(255,255,255,0.06)',              // 0.5px 极细边（用 box-shadow 实现）
        radius: 18,                                        // 卡圆角（参考图 16-20）
        accent: 'rgba(255,255,255,0.08)',                  // 选中态：克制
        accentBorder: 'rgba(255,255,255,0.45)',            // 选中态边
        primaryBtnBg: 'linear-gradient(180deg, #ffffff 0%, #e8e8ec 100%)',  // 主按钮白底
        primaryBtnColor: '#0a0a0a',
        text: '#ffffff',
        base: 'rgba(255,255,255,0.92)',
        mute: 'rgba(255,255,255,0.65)',
        sub: 'rgba(255,255,255,0.42)',
        hint: 'rgba(255,255,255,0.06)',                    // 次级胶囊底
        hintBorder: 'rgba(255,255,255,0.07)',
      }
    : {
        // flat-light（ByeWind 白图）：画布极浅灰 / 卡纯白 / 淡边 / 深字 / 克制蓝 / 主按钮黑底
        bg: '#F9FAFB',                                     // 画布：极浅灰
        cardBg: '#FFFFFF',                                 // 卡：纯白
        cardBorder: 'rgba(0,0,0,0.06)',                    // 极淡边
        radius: 18,                                        // 卡圆角
        accent: 'rgba(37,99,235,0.10)',                    // 选中态：极淡蓝
        accentBorder: 'rgba(37,99,235,0.45)',              // 选中态边
        primaryBtnBg: 'linear-gradient(180deg, #111827 0%, #1f2937 100%)',  // 主按钮深色实底
        primaryBtnColor: '#ffffff',
        text: '#111827',                                   // 主标题（深）
        base: '#1f2937',
        mute: '#6b7280',                                   // 副标题
        sub: '#9ca3af',
        hint: 'rgba(0,0,0,0.04)',                          // 次级胶囊底
        hintBorder: 'rgba(0,0,0,0.08)',
      }
  return (
    <div
      className="flex h-32 w-full flex-col gap-1.5 overflow-hidden rounded-xl p-2"
      style={{ backgroundColor: palette.bg }}
    >
      <div
        className="flex-1 overflow-hidden p-2"
        style={{
          backgroundColor: palette.cardBg,
          boxShadow: `0 0 0 0.5px ${palette.cardBorder}, 0 1px 3px rgba(0,0,0,0.25)`,
          borderRadius: palette.radius,
        }}
      >
        <div
          className="text-[11px] font-semibold leading-tight"
          style={{ color: palette.text }}
        >
          卡片标题
        </div>
        <div className="mt-0.5 text-[9px]" style={{ color: palette.mute }}>
          副标题/描述文字
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          <span
            className="rounded-md px-2 py-0.5 text-[8px] font-semibold"
            style={{
              backgroundImage: palette.primaryBtnBg,
              color: palette.primaryBtnColor,
              boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
            }}
          >
            主按钮
          </span>
          <span
            className="rounded-md px-2 py-0.5 text-[8px]"
            style={{
              backgroundColor: palette.hint,
              color: palette.mute,
              boxShadow: `0 0 0 0.5px ${palette.hintBorder}`,
            }}
          >
            胶囊
          </span>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 皮肤选择卡
// ============================================================
function SkinCard({
  skinId,
  active,
  onSelect,
}: {
  skinId: SkinId
  active: boolean
  onSelect: () => void
}) {
  const meta = SKIN_LABELS[skinId]
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`
        group relative flex flex-col gap-3 rounded-2xl border p-4 text-left transition
        ${active
          ? 'border-accent bg-accent/5 shadow-glow'
          : 'border-line bg-surface/40 hover:border-ink-strong/60'}
      `}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="text-sm font-semibold text-ink-strong">{meta.title}</div>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">{meta.desc}</p>
        </div>
        {/* 选中指示器 */}
        <span
          className={`
            grid h-5 w-5 shrink-0 place-items-center rounded-full border transition
            ${active ? 'border-accent bg-accent text-white' : 'border-line bg-transparent'}
          `}
        >
          {active && (
            <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 10l3 3 7-7" />
            </svg>
          )}
        </span>
      </div>
      <SkinPreview skinId={skinId} />
      <div className="text-[11px] text-ink-mute">
        {active ? '当前生效 · 即时切换' : '点击切换到此皮肤'}
      </div>
    </button>
  )
}

// ============================================================
// 主页面
// ============================================================
export default function UISettings() {
  const { settings, update, reset, setSkin } = useUI()
  const currentSkin = useSkin()

  // 总开关
  const setEnabled = (enabled: boolean) => update({ enabled })
  // 单主题开关 / 颜色
  const setTheme = (id: ThemeId, patch: Partial<{ enabled: boolean; color: string }>) =>
    update((cur) => ({
      ...cur,
      themes: { ...cur.themes, [id]: { ...cur.themes[id], ...patch } },
    }))

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink-strong">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/15 text-accent">
              {renderIcon('spark')}
            </span>
            UI 设置
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            自定义指针主题 · 光粒与流光可叠加使用 · 配置云端同步
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg border border-line bg-surface/60 px-3 py-1.5 text-xs text-ink-soft transition hover:border-ink-strong hover:text-ink-strong"
        >
          重置默认
        </button>
      </header>

      {/* 总开关 */}
      <section className="glass-card p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-base font-semibold text-ink-strong">启用指针特效</div>
            <p className="mt-1 text-xs text-ink-soft">
              总开关。关闭后所有主题都不会渲染，全局零开销。
              <br />
              默认关闭；开启后可逐项配置。
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.enabled}
            aria-label="启用指针特效总开关"
            onClick={() => setEnabled(!settings.enabled)}
            className={`
              relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition
              ${settings.enabled
                ? 'border-accent bg-accent shadow-glow'
                : 'border-line bg-white/5'}
            `}
          >
            <span
              className={`
                pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition
                ${settings.enabled ? 'translate-x-6' : 'translate-x-1'}
              `}
            />
          </button>
        </div>

{!settings.enabled && (
        <div className="mt-3 rounded-lg border border-line bg-surface/60 px-3 py-2 text-xs text-ink-soft">
          ⓘ 总开关关闭，下方主题即使勾选也不会渲染。
        </div>
      )}
      </section>

      {/* 皮肤 */}
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-sm font-semibold uppercase tracking-wider text-ink-soft">
          皮肤
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {SKIN_IDS.map((id) => (
            <SkinCard
              key={id}
              skinId={id}
              active={currentSkin === id}
              onSelect={() => setSkin(id)}
            />
          ))}
        </div>
        <p className="mt-1 px-1 text-xs text-ink-soft">
          皮肤仅影响全站视觉（背景、卡片、圆角），与上方的指针特效独立，可自由组合。切换后手机状态栏颜色会自动跟随当前主题。
        </p>
      </section>

      {/* 主题列表 */}
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-sm font-semibold uppercase tracking-wider text-ink-soft">
          指针主题
        </h2>
        {THEME_IDS.map((id) => (
          <ThemeCard
            key={id}
            themeId={id}
            cfg={settings.themes[id]}
            masterEnabled={settings.enabled}
            onToggle={(enabled) => setTheme(id, { enabled })}
            onColorChange={(color) => setTheme(id, { color })}
          />
        ))}
        <p className="mt-1 px-1 text-xs text-ink-soft">
          光粒与流光可同时开启，多个特效叠加显示。每个主题颜色独立。
        </p>
      </section>
    </div>
  )
}