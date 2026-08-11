import { useEffect, useRef } from 'react'
import { useSettingsRef } from '../context/UIContext'
import { useAuth } from '../context/AuthContext'

// ============================================================
// 类型
// ============================================================
interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  r: number
}

interface TrailPoint {
  x: number
  y: number
  /** 距离上次 mousemove 的时间（ms）；用于在停顿时快速淡出 */
  staleAt: number
}

// ============================================================
// 配置（性能/视觉平衡；改这里即可微调）
// ============================================================
const MAX_PARTICLES = 220
const PARTICLES_PER_MOVE = 2 // 每次 mousemove 生成的粒子数
const PARTICLE_BASE_LIFE = 700 // ms
const TRAIL_MAX_POINTS = 28
const TRAIL_THROTTLE_MS = 14 // mousemove 采样间隔
const FADE_OUT_MS = 180 // 鼠标停止后尾迹淡出时间

// 工具：hex → {r,g,b}
function hexRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const v =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  const n = parseInt(v || '000000', 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}
function rgbaStr(c: { r: number; g: number; b: number }, a: number): string {
  return `rgba(${c.r},${c.g},${c.b},${a})`
}

// ============================================================
// 组件
// ============================================================
export default function CursorFX() {
  const { user } = useAuth()
  const settingsRef = useSettingsRef()

  // 渲染条件：必须登录 + 总开关开启 + 至少有一个主题启用
  const enabled =
    !!user &&
    settingsRef.current.enabled &&
    (settingsRef.current.themes.particles.enabled || settingsRef.current.themes.comet.enabled)

  if (!enabled) return null

  return <CursorCanvas settingsRef={settingsRef} />
}

function CursorCanvas({ settingsRef }: { settingsRef: ReturnType<typeof useSettingsRef> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const trailRef = useRef<TrailPoint[]>([])
  const lastSampleRef = useRef(0)
  const lastMoveTimeRef = useRef(0)
  const mouseRef = useRef<{ x: number; y: number; hasMoved: boolean }>({
    x: -1000,
    y: -1000,
    hasMoved: false,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let running = true
    let width = 0
    let height = 0
    let dpr = window.devicePixelRatio || 1

    function resize() {
      dpr = window.devicePixelRatio || 1
      width = window.innerWidth
      height = window.innerHeight
      canvas!.width = Math.floor(width * dpr)
      canvas!.height = Math.floor(height * dpr)
      canvas!.style.width = width + 'px'
      canvas!.style.height = height + 'px'
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    function onMove(e: MouseEvent) {
      const now = performance.now()
      // 防抖节流
      if (now - lastSampleRef.current < TRAIL_THROTTLE_MS) {
        // 即使节流也更新位置，避免跳跃
        mouseRef.current.x = e.clientX
        mouseRef.current.y = e.clientY
        mouseRef.current.hasMoved = true
        lastMoveTimeRef.current = now
        return
      }
      lastSampleRef.current = now
      lastMoveTimeRef.current = now

      // 尾迹
      const trail = trailRef.current
      trail.push({ x: e.clientX, y: e.clientY, staleAt: now })
      if (trail.length > TRAIL_MAX_POINTS) trail.shift()

      mouseRef.current.x = e.clientX
      mouseRef.current.y = e.clientY
      mouseRef.current.hasMoved = true

      // 粒子
      const s = settingsRef.current
      if (s.themes.particles.enabled) {
        const list = particlesRef.current
        for (let i = 0; i < PARTICLES_PER_MOVE; i++) {
          if (list.length >= MAX_PARTICLES) list.shift()
          const angle = Math.random() * Math.PI * 2
          const speed = 0.2 + Math.random() * 0.9
          list.push({
            x: e.clientX + (Math.random() - 0.5) * 4,
            y: e.clientY + (Math.random() - 0.5) * 4,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed + 0.1, // 略向下沉
            life: PARTICLE_BASE_LIFE * (0.7 + Math.random() * 0.6),
            maxLife: PARTICLE_BASE_LIFE,
            r: 0.6 + Math.random() * 1.0,
          })
        }
      }
    }

    function onLeave() {
      // 鼠标离开窗口：停止粒子生成，尾迹保留自然淡出
      mouseRef.current.hasMoved = false
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    window.addEventListener('mouseout', onLeave)
    document.addEventListener('mouseleave', onLeave)

    function loop() {
      if (!running) return
      raf = requestAnimationFrame(loop)
      const now = performance.now()
      const s = settingsRef.current

      // 全局清屏（每帧透明叠加 → 拖尾衰减）
      ctx!.globalCompositeOperation = 'destination-out'
      ctx!.fillStyle = 'rgba(0,0,0,0.22)'
      ctx!.fillRect(0, 0, width, height)

      // ---- 1. 流光尾迹 ----
      const trail = trailRef.current
      if (s.themes.comet.enabled && trail.length > 1) {
        ctx!.globalCompositeOperation = 'lighter'
        const color = hexRgb(s.themes.comet.color)
        // 按 staleness 把过老的点丢进时间维
        const elapsedSinceMove = now - lastMoveTimeRef.current
        // 计算线条宽度：起点最宽（current）→ 末端最细
        const baseWidth = 5.5
        for (let i = 1; i < trail.length; i++) {
          const a = trail[i - 1]
          const b = trail[i]
          const t = i / (trail.length - 1) // 0=尾端、1=头端
          const w = baseWidth * (0.15 + t * 0.85)
          const alpha = t * 0.85 * (elapsedSinceMove > FADE_OUT_MS ? Math.max(0, 1 - (elapsedSinceMove - FADE_OUT_MS) / 300) : 1)
          if (alpha <= 0.01) continue
          const grad = ctx!.createLinearGradient(a.x, a.y, b.x, b.y)
          grad.addColorStop(0, rgbaStr(color, 0))
          grad.addColorStop(1, rgbaStr(color, alpha))
          ctx!.strokeStyle = grad
          ctx!.lineWidth = w
          ctx!.lineCap = 'round'
          ctx!.beginPath()
          ctx!.moveTo(a.x, a.y)
          ctx!.lineTo(b.x, b.y)
          ctx!.stroke()
        }
        // 头点（光晕）
        const head = trail[trail.length - 1]
        const headAlpha = elapsedSinceMove > FADE_OUT_MS
          ? Math.max(0, 1 - (elapsedSinceMove - FADE_OUT_MS) / 250)
          : 1
        if (headAlpha > 0) {
          // 外圈
          ctx!.fillStyle = rgbaStr(color, headAlpha * 0.25)
          ctx!.beginPath()
          ctx!.arc(head.x, head.y, 8, 0, Math.PI * 2)
          ctx!.fill()
          // 内核
          ctx!.fillStyle = rgbaStr(color, headAlpha)
          ctx!.beginPath()
          ctx!.arc(head.x, head.y, 2.5, 0, Math.PI * 2)
          ctx!.fill()
        }
      }

      // ---- 2. 光粒 ----
      const list = particlesRef.current
      if (s.themes.particles.enabled && list.length) {
        ctx!.globalCompositeOperation = 'lighter'
        const color = hexRgb(s.themes.particles.color)
        const next: Particle[] = []
        for (let i = 0; i < list.length; i++) {
          const p = list[i]
          p.life -= 16 // 假设一帧 16ms
          if (p.life <= 0) continue
          p.x += p.vx
          p.y += p.vy
          // 模拟重力 / 阻尼
          p.vy += 0.012
          p.vx *= 0.985
          p.vy *= 0.985
          const lifeRatio = p.life / p.maxLife
          const alpha = Math.pow(lifeRatio, 0.8) // 缓出
          const r = p.r * (0.5 + lifeRatio * 0.5)
          // 外圈辉光
          ctx!.fillStyle = rgbaStr(color, alpha * 0.18)
          ctx!.beginPath()
          ctx!.arc(p.x, p.y, r * 2, 0, Math.PI * 2)
          ctx!.fill()
          // 内核
          ctx!.fillStyle = rgbaStr(color, alpha)
          ctx!.beginPath()
          ctx!.arc(p.x, p.y, r, 0, Math.PI * 2)
          ctx!.fill()
          next.push(p)
        }
        particlesRef.current = next
      }

      // ---- 3. 鼠标长时间无动作 → 渐进清空尾迹 ----
      const elapsedSinceMove = now - lastMoveTimeRef.current
      if (elapsedSinceMove > 250 && trail.length > 0) {
        // 每帧丢一个最老的点
        if (elapsedSinceMove > FADE_OUT_MS) {
          trail.shift()
          if (trail.length > 0) trail.shift()
        }
      }
    }

    raf = requestAnimationFrame(loop)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseout', onLeave)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [settingsRef])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[9998]"
      style={{ mixBlendMode: 'screen' }}
    />
  )
}