// 旅行模块（Travel）—— 个人旅行志
// 1:1 复刻 drafts/travel/preview.html 设计稿：地图主视觉 + 航线图例 + 省份统计
//   + 城市记录瀑布流 + 按天无缝详情 + 城市联想新建弹窗 + 添加项弹窗 + 9 模块总览。
// 数据：本地优先（Dexie travels 表）+ outbox 补传 Supabase + Realtime，零 mock。
// 地图：province_adcode 反查省级行政区，有该省记录则对应省份点亮（中国地图 Web Mercator 烘焙 path）。
// 封面：新建必传，压缩为 WebP/JPEG data URL 落库（离线可用，同步时作为文本列上云）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { forceUnlockBodyScroll } from '../components/ui'
import { db, localPut, localDelete } from '../lib/localDb'
import { supabase } from '../lib/supabase'
import {
  seedFromServer,
  enqueueAndMaybeFlush,
  setSyncStatusHandler,
} from '../lib/sync'
import { CHINA_GEO, CHINA_VIEWBOX, type ChinaGeo } from '../lib/china-geo'
import type { Travel, TravelDay, TravelItem } from '../types'
import './travel.css'

// ─── 功能类型（行程时间轴条目的"功能标题" + 内联 SVG 图标） ───────────────
// ★ 图标路径必须用 import.meta.env.BASE_URL（vite base:'./'）相对拼接：
//   绝对路径 /icons/... 在 GitHub Pages 子路径(/yunstudio/)部署下会 404 → 图标裂开
const ICON_BASE = import.meta.env.BASE_URL
interface ModuleMeta {
  name: string
  icon: string
}
export const MODULE_LABELS: Record<string, ModuleMeta> = {
  transport: { name: '交通', icon: `${ICON_BASE}icons/travel/category/transport.png` },
  hotel: { name: '住宿', icon: `${ICON_BASE}icons/travel/category/hotel.png` },
  attraction: { name: '景点', icon: `${ICON_BASE}icons/travel/category/attraction.png` },
  food: { name: '吃喝', icon: `${ICON_BASE}icons/travel/category/food.png` },
  shopping: { name: '购物', icon: `${ICON_BASE}icons/travel/category/shopping.png` },
  entertainment: { name: '娱乐', icon: `${ICON_BASE}icons/travel/category/entertainment.png` },
  checkin: { name: '打卡', icon: `${ICON_BASE}icons/travel/category/checkin.png` },
  note: { name: '注意事项', icon: `${ICON_BASE}icons/travel/category/note.png` },
  memo: { name: '便签', icon: `${ICON_BASE}icons/travel/category/memo.png` },
  luggage: { name: '行李清单', icon: `${ICON_BASE}icons/travel/category/luggage.png` },
  ticket: { name: '机酒车票', icon: `${ICON_BASE}icons/travel/category/ticket.png` },
  place: { name: '地点', icon: `${ICON_BASE}icons/travel/category/place.png` },
  custom: { name: '自定义', icon: `${ICON_BASE}icons/travel/category/custom.png` },
}
// 总览卡片展示的 8 个模块（与设计稿一致）
const OVERVIEW_TYPES = [
  'transport', 'hotel', 'attraction', 'food', 'shopping', 'entertainment', 'checkin', 'note',
]
const MODULE_KEYS = Object.keys(MODULE_LABELS)

// ─── 旅行主题类型（决定卡片左上角圆形图标来源） ───────────────
export const TRAVEL_TYPES: Record<string, { name: string; icon: string }> = {
  city: { name: '城市', icon: `${ICON_BASE}icons/travel/type/city.png` },
  forest: { name: '森林', icon: `${ICON_BASE}icons/travel/type/forest.png` },
  ocean: { name: '海洋', icon: `${ICON_BASE}icons/travel/type/ocean.png` },
  lake: { name: '湖泊', icon: `${ICON_BASE}icons/travel/type/lake.png` },
  dune: { name: '沙丘', icon: `${ICON_BASE}icons/travel/type/dune.png` },
}
const TRAVEL_TYPE_KEYS = Object.keys(TRAVEL_TYPES) as ('city' | 'forest' | 'ocean' | 'lake' | 'dune')[]

// ─── 城市联想数据源（真实城市 → 省级行政区；海外城市 provinceAdcode 为空不点亮地图） ──
interface CitySeed {
  name: string
  provinceName: string
  country?: string
}
const CITY_SEEDS: CitySeed[] = [
  { name: '北京', provinceName: '北京市' }, { name: '上海', provinceName: '上海市' },
  { name: '天津', provinceName: '天津市' }, { name: '重庆', provinceName: '重庆市' },
  { name: '广州', provinceName: '广东省' }, { name: '深圳', provinceName: '广东省' },
  { name: '杭州', provinceName: '浙江省' }, { name: '成都', provinceName: '四川省' },
  { name: '武汉', provinceName: '湖北省' }, { name: '西安', provinceName: '陕西省' },
  { name: '南京', provinceName: '江苏省' }, { name: '苏州', provinceName: '江苏省' },
  { name: '长沙', provinceName: '湖南省' }, { name: '张家界', provinceName: '湖南省' },
  { name: '青岛', provinceName: '山东省' }, { name: '济南', provinceName: '山东省' },
  { name: '烟台', provinceName: '山东省' }, { name: '威海', provinceName: '山东省' },
  { name: '厦门', provinceName: '福建省' }, { name: '福州', provinceName: '福建省' },
  { name: '昆明', provinceName: '云南省' }, { name: '丽江', provinceName: '云南省' },
  { name: '大理', provinceName: '云南省' }, { name: '西双版纳', provinceName: '云南省' },
  { name: '三亚', provinceName: '海南省' }, { name: '海口', provinceName: '海南省' },
  { name: '哈尔滨', provinceName: '黑龙江省' }, { name: '大连', provinceName: '辽宁省' },
  { name: '沈阳', provinceName: '辽宁省' }, { name: '长春', provinceName: '吉林省' },
  { name: '郑州', provinceName: '河南省' }, { name: '洛阳', provinceName: '河南省' },
  { name: '合肥', provinceName: '安徽省' }, { name: '黄山', provinceName: '安徽省' },
  { name: '南昌', provinceName: '江西省' }, { name: '婺源', provinceName: '江西省' },
  { name: '贵阳', provinceName: '贵州省' }, { name: '桂林', provinceName: '广西壮族自治区' },
  { name: '北海', provinceName: '广西壮族自治区' }, { name: '拉萨', provinceName: '西藏自治区' },
  { name: '兰州', provinceName: '甘肃省' }, { name: '敦煌', provinceName: '甘肃省' },
  { name: '西宁', provinceName: '青海省' }, { name: '银川', provinceName: '宁夏回族自治区' },
  { name: '乌鲁木齐', provinceName: '新疆维吾尔自治区' }, { name: '喀什', provinceName: '新疆维吾尔自治区' },
  { name: '呼和浩特', provinceName: '内蒙古自治区' }, { name: '石家庄', provinceName: '河北省' },
  { name: '太原', provinceName: '山西省' }, { name: '香港', provinceName: '香港特别行政区' },
  { name: '澳门', provinceName: '澳门特别行政区' }, { name: '台北', provinceName: '台湾省' },
  { name: '东京', provinceName: '日本', country: '日本' }, { name: '大阪', provinceName: '日本', country: '日本' },
  { name: '首尔', provinceName: '韩国', country: '韩国' }, { name: '曼谷', provinceName: '泰国', country: '泰国' },
  { name: '新加坡', provinceName: '新加坡', country: '新加坡' }, { name: '巴厘岛', provinceName: '印度尼西亚', country: '印度尼西亚' },
  { name: '巴黎', provinceName: '法国', country: '法国' }, { name: '伦敦', provinceName: '英国', country: '英国' },
  { name: '罗马', provinceName: '意大利', country: '意大利' }, { name: '纽约', provinceName: '美国', country: '美国' },
  { name: '迪拜', provinceName: '阿联酋', country: '阿联酋' }, { name: '悉尼', provinceName: '澳大利亚', country: '澳大利亚' },
]
const PROVINCE_ADCODE_BY_NAME: Record<string, string> = Object.fromEntries(
  CHINA_GEO.filter((g) => g.name && g.adcode !== '100000_JD').map((g) => [g.name, g.adcode]),
)
const CITIES = CITY_SEEDS.map((c) => ({
  name: c.name,
  provinceName: c.provinceName,
  country: c.country,
  provinceAdcode: PROVINCE_ADCODE_BY_NAME[c.provinceName] ?? '',
}))

// 省级行政区（34 个，剔除南海诸岛框）
const PROVINCES: ChinaGeo[] = CHINA_GEO.filter(
  (g) => g.adcode !== '100000_JD' && g.name,
)

// ─── 地图装饰层（对齐设计稿 setupMap）：等值波浪线 + 同心椭圆环，营造"科技发光"底纹 ──
const TOPO_WAVES: { d: string; cls: string }[] = (() => {
  const W = 1000
  const out: { d: string; cls: string }[] = []
  for (let i = 0; i < 9; i++) {
    const y = 120 + i * 95 + (i % 2) * 10
    const amp = 10 + (i % 3) * 4
    const phase = i * 0.7
    let d = `M 0 ${y}`
    const step = 28
    for (let x = step; x <= W; x += step) {
      const yi = y + Math.sin((x / W) * Math.PI * 3 + phase) * amp
      d += ` L ${x} ${yi.toFixed(1)}`
    }
    out.push({ d, cls: i % 2 ? 'wave-p' : 'wave-c' })
  }
  return out
})()
// 椭圆环按省份中心分布（cx≈625 / cy≈470）布点，覆盖国土主要区域
const TOPO_ISO = [
  { cx: 620, cy: 470, rx: 260, ry: 150, op: 0.16 },
  { cx: 780, cy: 560, rx: 170, ry: 100, op: 0.13 },
  { cx: 430, cy: 400, rx: 200, ry: 120, op: 0.12 },
  { cx: 690, cy: 300, rx: 210, ry: 120, op: 0.1 },
]

// ─── 辅助 ────────────────────────────────────────────────────────────────
function dayCount(s: string, e: string): number {
  if (!s || !e) return 1
  const a = new Date(s + 'T00:00:00')
  const b = new Date(e + 'T00:00:00')
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1)
}
function nightCount(s: string, e: string): number {
  return Math.max(0, dayCount(s, e) - 1)
}
// 日期范围智能缩写（卡片展示）：
// 同月「2026-6-15～20」/ 跨月「2026-6-15～7-20」/ 跨年「2026-12-30～2027-1-1」
function formatDateRange(s: string, e: string): string {
  if (!s || !e) return `${s || ''}～${e || ''}`
  const [sy, sm, sd] = s.split('-')
  const [ey, em, ed] = e.split('-')
  const num = (v?: string) => (v ? String(Number(v)) : '')
  if (sy === ey && sm === em) return `${sy}-${num(sm)}-${num(sd)}～${num(ed)}`
  if (sy === ey) return `${sy}-${num(sm)}-${num(sd)}～${num(em)}-${num(ed)}`
  return `${sy}-${num(sm)}-${num(sd)}～${ey}-${num(em)}-${num(ed)}`
}
function dayDate(start: string, idx: number): string {
  const d = new Date(start + 'T00:00:00')
  d.setDate(d.getDate() + idx)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function uid(): string {
  return crypto.randomUUID()
}
const EMOJI_POOL = ['🌏', '✈️', '🗺️', '🧳', '🏝️', '⛰️', '🏙️', '🌆', '🚞']

// 压缩上传图片为 data URL（WebP 优先，不支持则回退 JPEG）
async function compressImage(file: File, maxDim = 1280, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('解析图片失败'))
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('无法创建画布'))
        ctx.drawImage(img, 0, 0, w, h)
        let url = canvas.toDataURL('image/webp', quality)
        if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', quality)
        resolve(url)
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

// ─── 轨迹动画（参考桌面「轨迹动画迭代优化」项目 1:1 复刻，去掉 ripple-anim 圆环）───

// 贝塞尔控制点（垂直方向偏移，弧度）
function bezierControlPoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  lift = 0.38,
): [number, number] {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  return [mx - dy * lift, my + dx * lift - len * lift * 0.5]
}

// 飞机：二次贝塞尔弧线（lift=0.38 最弧）
function quadBezierPath(x1: number, y1: number, x2: number, y2: number, lift = 0.3): string {
  const [cx, cy] = bezierControlPoint(x1, y1, x2, y2, lift)
  return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`
}

// 高铁：轻微弧线（lift=0.12）
function trainPath(x1: number, y1: number, x2: number, y2: number): string {
  const [cx, cy] = bezierControlPoint(x1, y1, x2, y2, 0.12)
  return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`
}

// 自驾：S 形三次贝塞尔
function drivePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = (x2 - x1) / 3
  const dy = (y2 - y1) / 3
  const c1x = x1 + dx - dy * 0.1
  const c1y = y1 + dy + dx * 0.1
  const c2x = x2 - dx + dy * 0.1
  const c2y = y2 - dy - dx * 0.1
  return `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`
}

// 飞机轨迹（最亮）—— 仅主弧线 + 飞机移动 + 终点脉冲，去掉 ripple-anim 圆环
function PlaneRoute({
  from,
  to,
}: {
  from: { adcode: string; cx: number; cy: number }
  to: { adcode: string; cx: number; cy: number }
}) {
  const x1 = from.cx,
    y1 = from.cy,
    x2 = to.cx,
    y2 = to.cy
  const pathD = quadBezierPath(x1, y1, x2, y2, 0.38)
  const pathId = `plane-path-${from.adcode}-${to.adcode}`
  const filterId = `glow-plane-${from.adcode}-${to.adcode}`

  return (
    <g>
      <defs>
        <path id={pathId} d={pathD} />
        {/* 双层高斯模糊：粗模糊 + 细模糊叠加，做出"光晕"质感 */}
        <filter id={filterId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4" result="b1" />
          <feGaussianBlur stdDeviation="1.5" in="SourceGraphic" result="b2" />
          <feMerge>
            <feMergeNode in="b1" />
            <feMergeNode in="b2" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 多层 stroke（5 层叠加做出"光带"质感，从外到内） */}

      {/* 1. 最外层宽光晕（粗 stroke 弱 alpha） */}
      <path d={pathD} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="12" filter="url(#glow-white)" />
      {/* 2. 中等光带 */}
      <path d={pathD} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="5" filter="url(#glow-white)" />
      {/* 3. 主流动虚线（核心 dash + 流动动画） */}
      <path d={pathD} fill="none"
        stroke="rgba(255,255,255,0.7)"
        strokeWidth="1.5"
        className="traj-plane-line"
        filter={`url(#${filterId})`}
      />
      {/* 4. 快速亮头（能量脉冲 1，沿弧线快移的小亮段） */}
      <path d={pathD} fill="none"
        stroke="rgba(255,255,255,0.95)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="16 300"
        filter={`url(#${filterId})`}
      >
        <animate attributeName="stroke-dashoffset" from="0" to="-316" dur="1.6s" repeatCount="indefinite" />
      </path>
      {/* 5. 拖尾光晕（能量脉冲 2，粗 stroke 弱 alpha 跟随亮头） */}
      <path d={pathD} fill="none"
        stroke="rgba(200,215,255,0.55)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="28 288"
        filter="url(#glow-white)"
      >
        <animate attributeName="stroke-dashoffset" from="-12" to="-328" dur="1.6s" repeatCount="indefinite" />
      </path>
      {/* 6. 二次波（能量脉冲 3，错时启动） */}
      <path d={pathD} fill="none"
        stroke="rgba(255,255,255,0.7)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="10 306"
        filter={`url(#${filterId})`}
      >
        <animate attributeName="stroke-dashoffset" from="0" to="-316" dur="1.6s" begin="0.8s" repeatCount="indefinite" />
      </path>
      {/* 7. 微粒闪烁（小粒 sparkle 快速移动） */}
      <path d={pathD} fill="none"
        stroke="rgba(255,255,255,0.5)"
        strokeWidth="1"
        strokeLinecap="round"
        strokeDasharray="2 50"
        filter={`url(#${filterId})`}
      >
        <animate attributeName="stroke-dashoffset" from="0" to="-52" dur="0.45s" repeatCount="indefinite" />
      </path>

      {/* 飞机图标（沿弧线移动 + glow）。rotate="auto" 让 x 轴对齐路径切线；
          但飞机 path 机头本身朝右下约 12°，需内层 rotate(-15) 回正，机头才正对目标 */}
      <g className="icon-plane" filter={`url(#${filterId})`}>
        <animateMotion dur="3.8s" repeatCount="indefinite" rotate="auto">
          <mpath href={`#${pathId}`} />
        </animateMotion>
        <circle r="10" fill="rgba(255,255,255,0.14)" />
        {/* rotate(-15)：飞机 path 机头默认朝右下约 12°，逆时针 15° 回正，使机头对准飞行切线方向 */}
        <g transform="rotate(-15) translate(-7,-7)">
          <svg viewBox="0 0 24 24" width="14" height="14">
            <path
              d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"
              fill="white"
            />
          </svg>
        </g>
      </g>

      {/* 起点 + 终点大光球（node-pulse 脉冲） */}
      <circle cx={x1} cy={y1} r="4.5" fill="rgba(255,255,255,0.95)" filter={`url(#${filterId})`} className="node-pulse" />
      <circle cx={x2} cy={y2} r="4.5" fill="rgba(255,255,255,0.95)" filter={`url(#${filterId})`} className="node-pulse" style={{ animationDelay: '0.9s' }} />
    </g>
  )
}

// 高铁轨迹（中等亮度）—— 主虚线 + 高铁沿弧线移动 + 终点脉冲
function TrainRoute({
  from,
  to,
}: {
  from: { adcode: string; cx: number; cy: number }
  to: { adcode: string; cx: number; cy: number }
}) {
  const x1 = from.cx,
    y1 = from.cy,
    x2 = to.cx,
    y2 = to.cy
  const pathD = trainPath(x1, y1, x2, y2)
  const pathId = `train-path-${from.adcode}-${to.adcode}`
  const filterId = `glow-train-${from.adcode}-${to.adcode}`

  return (
    <g>
      <defs>
        <path id={pathId} d={pathD} />
        <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 1. 宽外层光晕（粗 stroke 弱 alpha） */}
      <path d={pathD} fill="none" stroke="rgba(154,162,177,0.06)" strokeWidth="10" filter="url(#glow-gray)" />
      {/* 2. 中等光带 */}
      <path d={pathD} fill="none" stroke="rgba(154,162,177,0.18)" strokeWidth="4" filter="url(#glow-gray)" />
      {/* 3. 主流动虚线轨道 */}
      <path
        d={pathD}
        fill="none"
        stroke="rgba(154,162,177,0.7)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="18 8"
        className="traj-train-line"
        filter={`url(#${filterId})`}
      />
      {/* 4. 移动能量脉冲（列车头） */}
      <path
        d={pathD}
        fill="none"
        stroke="rgba(185,195,215,0.95)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="22 300"
        filter={`url(#${filterId})`}
      >
        <animate attributeName="stroke-dashoffset" from="0" to="-322" dur="2s" repeatCount="indefinite" />
      </path>
      {/* 5. 次级拖尾（错时启动） */}
      <path
        d={pathD}
        fill="none"
        stroke="rgba(154,162,177,0.45)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray="30 300"
        filter="url(#glow-gray)"
      >
        <animate attributeName="stroke-dashoffset" from="-8" to="-338" dur="2s" repeatCount="indefinite" />
      </path>

      {/* 高铁图标（沿弧线移动 + glow） */}
      <g className="icon-train" filter={`url(#${filterId})`}>
        <animateMotion dur="5s" repeatCount="indefinite" rotate="auto">
          <mpath href={`#${pathId}`} />
        </animateMotion>
        <rect x="-9" y="-6" width="18" height="12" rx="3" fill="rgba(154,162,177,0.2)" stroke="rgba(154,162,177,0.5)" strokeWidth="0.8" />
        <rect x="-6" y="-4" width="4" height="4" rx="1" fill="rgba(210,220,235,0.6)" />
        <rect x="2" y="-4" width="4" height="4" rx="1" fill="rgba(210,220,235,0.6)" />
        <rect x="-8" y="2" width="16" height="1.5" rx="0.75" fill="rgba(154,162,177,0.5)" />
      </g>

      {/* 起点 + 终点圆点（node-pulse 脉冲） */}
      <circle cx={x1} cy={y1} r="4" fill="rgba(154,162,177,0.95)" filter={`url(#${filterId})`} className="node-pulse" />
      <circle cx={x2} cy={y2} r="4" fill="rgba(154,162,177,0.95)" filter={`url(#${filterId})`} className="node-pulse" style={{ animationDelay: '1s' }} />
    </g>
  )
}

// 自驾轨迹（最暗）—— 主虚线 + 汽车沿弧线移动 + 终点脉冲
function DriveRoute({
  from,
  to,
}: {
  from: { adcode: string; cx: number; cy: number }
  to: { adcode: string; cx: number; cy: number }
}) {
  const x1 = from.cx,
    y1 = from.cy,
    x2 = to.cx,
    y2 = to.cy
  const pathD = drivePath(x1, y1, x2, y2)
  const pathId = `drive-path-${from.adcode}-${to.adcode}`
  const filterId = `glow-drive-${from.adcode}-${to.adcode}`

  return (
    <g>
      <defs>
        <path id={pathId} d={pathD} />
        <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 1. 宽外层路面（粗 stroke 弱 alpha） */}
      <path d={pathD} fill="none" stroke="rgba(92,101,119,0.12)" strokeWidth="9" filter="url(#glow-dim)" />
      {/* 2. 主流动虚线路面 */}
      <path
        d={pathD}
        fill="none"
        stroke="rgba(120,132,155,0.65)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="4 10"
        className="traj-drive-line"
        filter={`url(#${filterId})`}
      />
      {/* 3. 移动前大灯（沿弧线移动的能量块） */}
      <path
        d={pathD}
        fill="none"
        stroke="rgba(155,165,185,0.95)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="14 300"
        filter={`url(#${filterId})`}
      >
        <animate attributeName="stroke-dashoffset" from="0" to="-314" dur="3s" repeatCount="indefinite" />
      </path>
      {/* 4. 拖尾光晕（粗 stroke 弱 alpha） */}
      <path
        d={pathD}
        fill="none"
        stroke="rgba(120,132,155,0.35)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="24 300"
        filter="url(#glow-dim)"
      >
        <animate attributeName="stroke-dashoffset" from="-10" to="-334" dur="3s" repeatCount="indefinite" />
      </path>

      {/* 汽车图标（沿弧线移动 + glow） */}
      <g className="icon-car" filter={`url(#${filterId})`}>
        <animateMotion dur="6.5s" repeatCount="indefinite" rotate="auto">
          <mpath href={`#${pathId}`} />
        </animateMotion>
        <rect x="-9" y="-4" width="18" height="9" rx="2.5" fill="rgba(120,132,155,0.25)" stroke="rgba(140,152,175,0.55)" strokeWidth="0.8" />
        <path d="M-3,-4 L3,-4 L5,-0.5 L-5,-0.5 Z" fill="rgba(200,210,225,0.5)" />
        <circle cx="-5.5" cy="5" r="2.5" fill="rgba(90,100,120,0.7)" stroke="rgba(140,150,170,0.4)" strokeWidth="0.5" />
        <circle cx="5.5" cy="5" r="2.5" fill="rgba(90,100,120,0.7)" stroke="rgba(140,150,170,0.4)" strokeWidth="0.5" />
      </g>

      {/* 起点 + 终点圆点（node-pulse 脉冲） */}
      <circle cx={x1} cy={y1} r="3.5" fill="rgba(120,132,155,0.9)" filter={`url(#${filterId})`} className="node-pulse" />
      <circle cx={x2} cy={y2} r="3.5" fill="rgba(120,132,155,0.9)" filter={`url(#${filterId})`} className="node-pulse" style={{ animationDelay: '1.2s' }} />
    </g>
  )
}

// 轨迹层：按 mode 渲染对应路线（visible=false 时整个 layer 隐藏）
function TrajectoryLayer({
  routes,
  visible,
}: {
  routes: { from: { adcode: string; cx: number; cy: number }; to: { adcode: string; cx: number; cy: number }; mode: 'plane' | 'train' | 'drive' }[]
  visible: boolean
}) {
  if (!visible) return null
  return (
    <g className="trajectory-layer">
      {/* 公共 glow filter（三种亮度递减） */}
      <defs>
        <filter id="glow-white" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="glow-gray" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="glow-dim" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {routes.map((r, i) => {
        const key = `${r.from.adcode}-${r.to.adcode}-${r.mode}-${i}`
        if (r.mode === 'plane') return <PlaneRoute key={key} from={r.from} to={r.to} />
        if (r.mode === 'train') return <TrainRoute key={key} from={r.from} to={r.to} />
        return <DriveRoute key={key} from={r.from} to={r.to} />
      })}
    </g>
  )
}

// ─── 中国地图（Web Mercator 烘焙 path，零运行时依赖） ───────────────────────
function ChinaMap({
  visited,
  counts,
  onProvinceClick,
  showTrajectory,
  routes,
}: {
  visited: Set<string>
  counts: Record<string, number>
  onProvinceClick: (adcode: string, name: string) => void
  showTrajectory: boolean
  routes: { from: { adcode: string; cx: number; cy: number }; to: { adcode: string; cx: number; cy: number }; mode: 'plane' | 'train' | 'drive' }[]
}) {
  const [hover, setHover] = useState<string | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const handleMove = (e: React.MouseEvent, g: ChinaGeo) => {
    const rect = cardRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const c = counts[g.adcode] ?? 0
    setTip({
      x,
      y,
      text: `${g.name}${c > 0 ? ` · 已记录 ${c} 次` : ''}`,
    })
  }

  return (
    <div className="map-card" ref={cardRef}>
      <span className="corner tl" />
      <span className="corner tr" />
      <span className="corner bl" />
      <span className="corner br" />
      <svg
        id="map"
        viewBox={CHINA_VIEWBOX}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block' }}
      >
        <defs>
          <pattern id="tgrid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="rgba(124,133,245,0.06)" strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="1000" height="979" fill="url(#tgrid)" />
        {/* 装饰层：等值波浪线 + 同心椭圆环（设计稿 setupMap 同款） */}
        <g className="topo" aria-hidden>
          {TOPO_WAVES.map((w, i) => (
            <path key={`w${i}`} d={w.d} className={w.cls} strokeWidth={0.6} opacity={0.18} fill="none" />
          ))}
          {TOPO_ISO.map((e, i) =>
            [1, 0.7, 0.4].map((f, j) => (
              <ellipse
                key={`iso-${i}-${j}`}
                cx={e.cx}
                cy={e.cy}
                rx={e.rx * f}
                ry={e.ry * f}
                className={j % 2 ? 'wave-p' : 'wave-c'}
                strokeWidth={0.6 - j * 0.1}
                fill="none"
                opacity={e.op * (1 - j * 0.2)}
              />
            )),
          )}
        </g>
        {CHINA_GEO.map((g) => {
          if (g.adcode === '100000_JD') {
            return (
              <g key="nanhai">
                <path className="nanhai-frame" d={g.path} />
                <text className="nanhai-label" x="780" y="930">
                  南海诸岛
                </text>
              </g>
            )
          }
          const isVisited = visited.has(g.adcode)
          return (
            <path
              key={g.adcode}
              className={`prov${isVisited ? ' visited' : ''}${hover === g.adcode ? ' hover' : ''}`}
              d={g.path}
              onMouseEnter={() => setHover(g.adcode)}
              onMouseMove={(e) => handleMove(e, g)}
              onMouseLeave={() => {
                setHover(null)
                setTip(null)
              }}
              onClick={() => onProvinceClick(g.adcode, g.name)}
            />
          )
        })}
        {CHINA_GEO.map((g) => {
          if (g.adcode === '100000_JD' || !visited.has(g.adcode)) return null
          return (
            <g key={`mk-${g.adcode}`} style={{ pointerEvents: 'none' }}>
              <circle className="marker show" cx={g.cx} cy={g.cy} r={5} />
              <circle className="marker-ripple go" cx={g.cx} cy={g.cy} r={4} />
            </g>
          )
        })}
        {/* 轨迹动画层（旅程轨迹 / 隐藏轨迹 toggle 控制） */}
        <TrajectoryLayer routes={routes} visible={showTrajectory} />
      </svg>
      <div
        className={`tip${tip ? ' show' : ''}`}
        style={tip ? { left: tip.x, top: tip.y } : undefined}
      >
        {tip?.text}
      </div>
    </div>
  )
}

// ─── 主组件 ──────────────────────────────────────────────────────────────
export default function Travel() {
  const { user } = useAuth()
  const userId = user?.id ?? 'anonymous'

  const [travels, setTravels] = useState<Travel[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'desc' | 'asc'>('desc')
  const [filterRegion, setFilterRegion] = useState('')
  const [filterYear, setFilterYear] = useState('')
  const [sortPop, setSortPop] = useState(false)
  const [filterPop, setFilterPop] = useState(false)
  // 各弹窗 ref：用于点击弹窗外任意区域关闭
  const sortPopRef = useRef<HTMLDivElement>(null)
  const filterPopRef = useRef<HTMLDivElement>(null)
  const cardPopRef = useRef<HTMLDivElement>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const fabAddRef = useRef<HTMLButtonElement>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState(0) // 0 = 总览，1..N = Day
  const [editing, setEditing] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [addItem, setAddItem] = useState<{
    open: boolean
    travelId: string
    dayIndex: number
    editId?: string
  }>({ open: false, travelId: '', dayIndex: 0 })
  const [cardPop, setCardPop] = useState<{ id: string; x: number; y: number } | null>(null)
  const [toastMsg, setToastMsg] = useState('')
  // 轨迹动画显隐：开启后展示出发地→目的地的航线/铁路/自驾线，关闭后隐藏
  // 持久化到 localStorage（"重新打开网页也保持开启状态"）
  const [showTrajectory, setShowTrajectoryState] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem('pw.travel.showTrajectory') === '1'
    } catch {
      return false
    }
  })
  const setShowTrajectory = (v: boolean | ((prev: boolean) => boolean)) => {
    setShowTrajectoryState((prev) => {
      const next = typeof v === 'function' ? v(prev) : v
      try {
        window.localStorage.setItem('pw.travel.showTrajectory', next ? '1' : '0')
      } catch {
        /* localStorage 不可用时静默失败 */
      }
      return next
    })
  }
  const toastTimer = useRef<number>()

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 1800)
  }, [])

  // ── 数据加载：本地优先 + 云端注水 + Realtime ──
  const reload = useCallback(async (uid: string) => {
    const rows = (await db.travels.where('user_id').equals(uid).toArray()) as Travel[]
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
    setTravels(rows)
  }, [])

  const load = useCallback(async () => {
    if (!user) {
      // preview=1 匿名态：user=null 不进异步加载，直接关掉 loading 显示空态，避免「正在载入…」占位一直挂在那
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      await reload(userId)
      await seedFromServer('travels', userId)
      await reload(userId)
    } finally {
      setLoading(false)
    }
  }, [user, userId, reload])

  useEffect(() => {
    void load()
  }, [load])

  // ── 一级页面所有弹窗：点组件外任意区域关闭 ──
  // 用 mouseup（早于 click 触发；fab-add 是 toggle 按钮需用 ref 豁免，否则会立刻被关）
  useEffect(() => {
    if (!sortPop) return
    const handler = (e: MouseEvent) => {
      if (sortPopRef.current && !sortPopRef.current.contains(e.target as Node)) {
        setSortPop(false)
      }
    }
    document.addEventListener('mouseup', handler)
    return () => document.removeEventListener('mouseup', handler)
  }, [sortPop])

  useEffect(() => {
    if (!filterPop) return
    const handler = (e: MouseEvent) => {
      if (filterPopRef.current && !filterPopRef.current.contains(e.target as Node)) {
        setFilterPop(false)
      }
    }
    document.addEventListener('mouseup', handler)
    return () => document.removeEventListener('mouseup', handler)
  }, [filterPop])

  useEffect(() => {
    if (!cardPop) return
    const handler = (e: MouseEvent) => {
      if (cardPopRef.current && !cardPopRef.current.contains(e.target as Node)) {
        setCardPop(null)
      }
    }
    document.addEventListener('mouseup', handler)
    return () => document.removeEventListener('mouseup', handler)
  }, [cardPop])

  useEffect(() => {
    if (!addMenuOpen) return
    const handler = (e: MouseEvent) => {
      // fab-add 是 toggle 按钮——豁免（不豁免会让 toggle 按钮点不开/关不掉）
      if (fabAddRef.current?.contains(e.target as Node)) return
      if (addMenuRef.current?.contains(e.target as Node)) return
      setAddMenuOpen(false)
    }
    document.addEventListener('mouseup', handler)
    return () => document.removeEventListener('mouseup', handler)
  }, [addMenuOpen])

  // 同步状态错误提示
  useEffect(() => {
    setSyncStatusHandler?.((s) => {
      if (!s.ok && s.msg) showToast(s.msg)
    })
    return () => setSyncStatusHandler?.(null)
  }, [showToast])

  // Realtime：云端变更补进本地（INSERT/UPDATE upsert，DELETE 精确删）
  useEffect(() => {
    if (!user) return
    const ch = supabase
      .channel(`travels:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'travels', filter: `user_id=eq.${userId}` },
        (payload: { eventType: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
          if (payload.eventType === 'DELETE') {
            const oldId = payload.old?.id as string | undefined
            if (oldId) {
              void db.travels.delete(oldId)
              setTravels((prev) => prev.filter((t) => t.id !== oldId))
            }
          } else if (payload.new) {
            const row = payload.new as unknown as Travel
            void db.travels.put(row)
            setTravels((prev) => {
              const idx = prev.findIndex((t) => t.id === row.id)
              const next = idx >= 0 ? prev.map((t) => (t.id === row.id ? row : t)) : [row, ...prev]
              return next.sort((a, b) => b.created_at.localeCompare(a.created_at))
            })
          }
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [user, userId])

  // 卸载时解锁可能存在的 body 滚动锁
  useEffect(() => () => forceUnlockBodyScroll(), [])

  // ── 派生数据 ──
  // 省码反查兜底：老记录若 province_adcode 为空（旧版本直接打字新建），按城市名反查，保证地图点亮
  const resolveAdcode = useCallback((t: Travel): string => {
    if (t.province_adcode) return t.province_adcode
    const hit = CITIES.find((c) => c.name === t.city)
    return hit?.provinceAdcode ?? ''
  }, [])

  const visitedSet = useMemo(() => {
    const s = new Set<string>()
    travels.forEach((t) => {
      const ad = resolveAdcode(t)
      if (ad) s.add(ad)
    })
    return s
  }, [travels, resolveAdcode])

  // 轨迹动画 routes：从 travels 提取（每条 travel = 1 条轨迹，从出发地 → 目的地）
  // 起点 / 终点都允许是未点亮的省份（用户要求"轨迹链接的地方不一定是点亮的地图区域"）
  const trajectoryRoutes = useMemo(() => {
    return travels
      .map((t) => {
        const fromAdcode = t.departure_province_adcode || ''
        const toAdcode = t.province_adcode || ''
        if (!fromAdcode || !toAdcode || fromAdcode === toAdcode) return null
        const from = CHINA_GEO.find((g) => g.adcode === fromAdcode)
        const to = CHINA_GEO.find((g) => g.adcode === toAdcode)
        if (!from || !to) return null
        return { from, to, mode: (t.transport_mode || 'plane') as 'plane' | 'train' | 'drive' }
      })
      .filter(Boolean) as { from: typeof CHINA_GEO[number]; to: typeof CHINA_GEO[number]; mode: 'plane' | 'train' | 'drive' }[]
  }, [travels])

  const provinceCounts = useMemo(() => {
    const c: Record<string, number> = {}
    travels.forEach((t) => {
      const ad = resolveAdcode(t)
      if (ad) c[ad] = (c[ad] ?? 0) + 1
    })
    return c
  }, [travels, resolveAdcode])

  const visitedKm = visitedSet.size * 800 // 衍生展示指标：累计足迹（省×800km）

  const years = useMemo(() => {
    const ys = new Set<string>()
    travels.forEach((t) => {
      if (t.start_date) ys.add(t.start_date.slice(0, 4))
    })
    return Array.from(ys).sort().reverse()
  }, [travels])

  const filtered = useMemo(() => {
    let list = travels.slice()
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter(
        (t) =>
          t.city.toLowerCase().includes(q) ||
          t.title.toLowerCase().includes(q) ||
          (t.province_name || '').toLowerCase().includes(q),
      )
    }
    if (filterRegion) list = list.filter((t) => t.province_name === filterRegion)
    if (filterYear) list = list.filter((t) => t.start_date?.startsWith(filterYear))
    list.sort((a, b) =>
      sort === 'desc'
        ? b.start_date.localeCompare(a.start_date)
        : a.start_date.localeCompare(b.start_date),
    )
    return list
  }, [travels, query, filterRegion, filterYear, sort])

  const detail = useMemo(
    () => travels.find((t) => t.id === detailId) ?? null,
    [travels, detailId],
  )

  // ── 持久化助手 ──
  const persist = useCallback(
    async (updated: Travel) => {
      const row = { ...updated, updated_at: new Date().toISOString() }
      await localPut('travels', row)
      await enqueueAndMaybeFlush('travels', 'update', row.id, row)
      setTravels((prev) =>
        prev.map((t) => (t.id === row.id ? row : t)).sort((a, b) => b.created_at.localeCompare(a.created_at)),
      )
    },
    [],
  )

  // ── 新建旅行 ──
  const [cityText, setCityText] = useState('')
  const [citySuggest, setCitySuggest] = useState<typeof CITIES>([])
  // 出发地：与目的地同套城市联想逻辑，独立 state/ref 避免互相干扰
  const [departureText, setDepartureText] = useState('')
  const [departureSuggest, setDepartureSuggest] = useState<typeof CITIES>([])
  const departureProvince = useRef<{ name: string; adcode: string }>({ name: '', adcode: '' })
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [coverText, setCoverText] = useState('')
  const [coverPreview, setCoverPreview] = useState('')
  const [createErr, setCreateErr] = useState('')
  // 交通方式：决定轨迹动画类型（plane/train/drive），默认飞机
  const [transportMode, setTransportMode] = useState<'plane' | 'train' | 'drive'>('plane')
  // 旅行主题类型（决定卡片左上角圆形图标来源），默认城市
  const [travelType, setTravelType] = useState<'city' | 'forest' | 'ocean' | 'lake' | 'dune'>('city')
  // 编辑模式：null = 新建，否则 = 正在编辑的 travel.id
  const [editTravelId, setEditTravelId] = useState<string | null>(null)

  const onCityInput = (v: string) => {
    setCityText(v)
    if (!v.trim()) {
      setCitySuggest([])
      return
    }
    const q = v.trim().toLowerCase()
    setCitySuggest(CITIES.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8))
  }
  const pickCity = (c: (typeof CITIES)[number]) => {
    setCityText(c.name)
    setCitySuggest([])
    // 暂存选中的省信息，提交时用到
    pickedProvince.current = { name: c.provinceName, adcode: c.provinceAdcode }
  }
  const pickedProvince = useRef<{ name: string; adcode: string }>({ name: '', adcode: '' })

  const onDepartureInput = (v: string) => {
    setDepartureText(v)
    if (!v.trim()) {
      setDepartureSuggest([])
      return
    }
    const q = v.trim().toLowerCase()
    setDepartureSuggest(CITIES.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8))
  }
  const pickDeparture = (c: (typeof CITIES)[number]) => {
    setDepartureText(c.name)
    setDepartureSuggest([])
    departureProvince.current = { name: c.provinceName, adcode: c.provinceAdcode }
  }

  const onCoverPick = async (file?: File) => {
    if (!file) return
    try {
      const url = await compressImage(file)
      setCoverText(file.name)
      setCoverPreview(url)
      setCreateErr('')
    } catch {
      setCreateErr('图片处理失败，请换一张')
    }
  }

  const createDays = (s: string, e: string): TravelDay[] =>
    Array.from({ length: dayCount(s, e) }, () => ({ items: [] }))

  const submitCreate = async () => {
    const city = cityText.trim()
    if (!city) return setCreateErr('请填写目的地')
    if (!startDate || !endDate) return setCreateErr('请选择行程日期')
    if (new Date(endDate) < new Date(startDate)) return setCreateErr('结束日期不能早于开始日期')
    if (!coverPreview) return setCreateErr('请上传一张封面图')
    // 省信息：点选联想项时已暂存；若直接打字未点选，则按城市名精确反查（保证地图点亮）
    let prov = pickedProvince.current
    if (!prov.adcode) {
      const hit = CITIES.find((c) => c.name === city)
      if (hit) prov = { name: hit.provinceName, adcode: hit.provinceAdcode }
    }
    // 出发地：可选，未填则不写字段；未点选联想项时同样按城市名反查省
    const depText = departureText.trim()
    let dep = departureProvince.current
    if (depText && !dep.adcode) {
      const hit = CITIES.find((c) => c.name === depText)
      if (hit) dep = { name: hit.provinceName, adcode: hit.provinceAdcode }
    }
    const dc = dayCount(startDate, endDate)
    const nc = nightCount(startDate, endDate)
    const now = new Date().toISOString()
    const isEdit = !!editTravelId
    const existing = isEdit ? travels.find((t) => t.id === editTravelId) : null
    const rec: Travel = {
      id: existing?.id ?? uid(),
      user_id: existing?.user_id ?? userId,
      title: `${city} ${dc}天${nc}夜行程`,
      city,
      province_adcode: prov.adcode,
      province_name: prov.name,
      emoji: existing?.emoji ?? EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)],
      start_date: startDate,
      end_date: endDate,
      cover: coverPreview,
      days: existing?.days ?? createDays(startDate, endDate), // 编辑时保留已有时间轴
      // 出发地：未填则不写字段（undefined），老数据无此字段保持兼容
      ...(depText
        ? {
            departure_city: depText,
            departure_province_adcode: dep.adcode || '',
            departure_province_name: dep.name || '',
          }
        : {}),
      transport_mode: transportMode,
      type: travelType,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    }
    await localPut('travels', rec)
    await enqueueAndMaybeFlush('travels', isEdit ? 'update' : 'insert', rec.id, rec)
    setTravels((prev) =>
      isEdit
        ? prev.map((t) => (t.id === rec.id ? rec : t)).sort((a, b) => b.created_at.localeCompare(a.created_at))
        : [rec, ...prev],
    )
    showToast(isEdit ? `已更新 · ${rec.title}` : prov.adcode ? `已生成旅行规划 · 点亮${prov.name}` : '已生成旅行规划')
    // 重置 + 关闭
    setCreateOpen(false)
    setEditTravelId(null)
    setCityText('')
    setCitySuggest([])
    setDepartureText('')
    setDepartureSuggest([])
    setStartDate('')
    setEndDate('')
    setCoverText('')
    setCoverPreview('')
    setCreateErr('')
    setTransportMode('plane')
    setTravelType('city')
    pickedProvince.current = { name: '', adcode: '' }
    departureProvince.current = { name: '', adcode: '' }
    // 直接打开详情，方便继续添加行程
    setDetailId(rec.id)
    setActiveTab(0)
    setEditing(false)
  }

  // ── 删除旅行 ──
  const deleteTravel = async (id: string) => {
    if (!window.confirm('确定删除这条旅行记录吗？此操作不可撤销。')) return
    await localDelete('travels', id)
    await enqueueAndMaybeFlush('travels', 'delete', id)
    setTravels((prev) => prev.filter((t) => t.id !== id))
    if (detailId === id) setDetailId(null)
    showToast('已删除')
  }

  // ── 添加 / 编辑 行程项 ──
  const [aiType, setAiType] = useState('attraction')
  const [aiTitle, setAiTitle] = useState('')
  const [aiTime, setAiTime] = useState('')
  const [aiNote, setAiNote] = useState('')
  const [aiImg, setAiImg] = useState('')
  const [aiImgName, setAiImgName] = useState('')
  const [aiPreview, setAiPreview] = useState('')

  const openAddItem = (travelId: string, dayIndex: number, editId?: string) => {
    if (!detail) return
    const day = detail.days[dayIndex]
    if (!day) return
    if (editId) {
      const it = day.items.find((i) => i.id === editId)
      if (it) {
        setAiType(it.type)
        setAiTitle(it.title)
        setAiTime(it.time)
        setAiNote(it.note)
        setAiImg(it.img ?? '')
        setAiImgName(it.img ? '已附图片' : '')
        setAiPreview(it.img ?? '')
      }
    } else {
      setAiType('attraction')
      setAiTitle('')
      setAiTime('')
      setAiNote('')
      setAiImg('')
      setAiImgName('')
      setAiPreview('')
    }
    setAddItem({ open: true, travelId, dayIndex, editId })
    setAddMenuOpen(false)
  }

  const onAiImg = async (file?: File) => {
    if (!file) return
    try {
      const url = await compressImage(file)
      setAiImg(url)
      setAiImgName(file.name)
      setAiPreview(url)
    } catch {
      showToast('图片处理失败')
    }
  }

  const submitAddItem = async () => {
    if (!detail) return
    const title = aiTitle.trim() || MODULE_LABELS[aiType].name
    const item: TravelItem = {
      id: addItem.editId ?? uid(),
      time: aiTime,
      type: aiType,
      title,
      note: aiNote.trim(),
      img: aiImg || null,
    }
    const days = detail.days.map((d, i) => {
      if (i !== addItem.dayIndex) return d
      if (addItem.editId) {
        return { items: d.items.map((it) => (it.id === addItem.editId ? item : it)) }
      }
      return { items: [...d.items, item] }
    })
    const updated = { ...detail, days }
    await persist(updated)
    setAddItem({ open: false, travelId: '', dayIndex: 0 })
    showToast(addItem.editId ? '已更新' : '已添加')
  }

  // 行程项：上移 / 下移 / 删除
  const moveItem = async (dayIndex: number, itemId: string, dir: -1 | 1) => {
    if (!detail) return
    const days = detail.days.map((d, i) => {
      if (i !== dayIndex) return d
      const arr = d.items.slice()
      const idx = arr.findIndex((it) => it.id === itemId)
      const j = idx + dir
      if (idx < 0 || j < 0 || j >= arr.length) return d
      ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
      return { items: arr }
    })
    await persist({ ...detail, days })
  }
  const deleteItem = async (dayIndex: number, itemId: string) => {
    if (!detail) return
    const days = detail.days.map((d, i) =>
      i === dayIndex ? { items: d.items.filter((it) => it.id !== itemId) } : d,
    )
    await persist({ ...detail, days })
  }

  // 新增一天
  const addDay = async () => {
    if (!detail) return
    await persist({ ...detail, days: [...detail.days, { items: [] }] })
    setActiveTab(detail.days.length + 1)
    showToast('已添加新的一天')
  }

  // 同步按钮
  const syncNow = async () => {
    showToast('正在同步云端…')
    await seedFromServer('travels', userId)
    await reload(userId)
    await enqueueAndMaybeFlush('travels', 'update', '', undefined)
    showToast('同步完成')
  }

  // 省份点击（地图）：点击某省 → 右侧仅展示该省；再点同一省 → 取消筛选展示全部
  const onProvinceClick = (adcode: string, name: string) => {
    // 再点同一省份 → 取消筛选，展示全部数据
    if (filterRegion === name) {
      setFilterRegion('')
      setFilterYear('')
      setQuery('')
      showToast('已显示全部记录')
      return
    }
    // 点击省份 → 仅展示该省（无条件筛选，无记录则右侧显示空态）
    const c = provinceCounts[adcode] ?? 0
    setFilterRegion(name)
    setFilterYear('')
    setQuery('')
    showToast(c > 0 ? `已筛选：${name}（${c} 次记录）` : `${name} · 还没有旅行记录`)
  }

  // 总览：各模块计数
  const overviewCounts = useMemo(() => {
    const c: Record<string, number> = {}
    detail?.days.forEach((d) =>
      d.items.forEach((it) => {
        c[it.type] = (c[it.type] ?? 0) + 1
      }),
    )
    return c
  }, [detail])

  // ── 渲染 ──
  const closeDetail = () => {
    setDetailId(null)
    setEditing(false)
    setAddMenuOpen(false)
  }

  return (
    <div className="travel-page" style={{ height: 'calc(100vh - 48px)' }}>
      <div className="t-app">
        {/* ===== 左侧：地图仪表盘 ===== */}
        <div className="t-left">
          <div className="left-header">
            <div className="brand">
              <div className="logo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
                </svg>
              </div>
              <div className="title">
                <h1>我的旅行时光地图</h1>
              </div>
            </div>
            <div className="t-stats">
              <div className="t-stat">
                <div className="ico">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z" />
                    <circle cx="12" cy="9" r="2.5" />
                  </svg>
                </div>
                <div>
                  <div className="lbl">已造访省份</div>
                  <div className="val">
                    {visitedSet.size}
                    <em>/34</em>
                  </div>
                </div>
              </div>
              <div className="t-stat">
                <div className="ico">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 12h6l3-7 3 14 3-7h3" />
                  </svg>
                </div>
                <div>
                  <div className="lbl">旅行里程</div>
                  <div className="val">
                    {visitedKm}
                    <em> km</em>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <ChinaMap
            visited={visitedSet}
            counts={provinceCounts}
            onProvinceClick={onProvinceClick}
            showTrajectory={showTrajectory}
            routes={trajectoryRoutes}
          />

          <div className="t-legend">
            <span className="item">
              <span className="dot plane">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                  <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" />
                </svg>
              </span>
              <span className="t-legend-text">航空线路</span>
            </span>
            <span className="item">
              <span className="dot train">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                  <rect x="2" y="5" width="20" height="14" rx="3.5" />
                  <rect x="5.5" y="8" width="4.5" height="5" rx="1" fill="#0E1015" />
                  <rect x="14" y="8" width="4.5" height="5" rx="1" fill="#0E1015" />
                </svg>
              </span>
              <span className="t-legend-text">高速铁路</span>
            </span>
            <span className="item">
              <span className="dot car">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                  <rect x="2" y="6" width="20" height="10" rx="2.5" />
                  <path d="M6.5 6l2.5-3h6l2.5 3" fill="#0E1015" />
                  <circle cx="7" cy="16.5" r="3" fill="#0E1015" />
                  <circle cx="17" cy="16.5" r="3" fill="#0E1015" />
                </svg>
              </span>
              <span className="t-legend-text">自驾公路</span>
            </span>
            <span className="route-toggle">
            <span
              className={`rt-label${showTrajectory ? '' : ' dim'}`}
              onClick={() => setShowTrajectory(true)}
            >
              旅行轨迹
            </span>
            <button
              className={`rt-switch${showTrajectory ? ' on' : ''}`}
              type="button"
              onClick={() => setShowTrajectory(!showTrajectory)}
              aria-label="切换轨迹显示"
              title="开启/关闭轨迹动画（持久化）"
            >
              <span className="rt-knob" />
            </button>
          </span>
          </div>
        </div>

        {/* ===== 右侧：工具栏 + 瀑布流 ===== */}
        <div className="t-right" style={{ position: 'relative' }}>
          <div className="toolbar">
            <div className="t-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4-4" />
              </svg>
              <input
                placeholder="搜索目的地、标题…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div
              className="icon-btn"
              title="排序"
              onClick={() => {
                setSortPop((v) => !v)
                setFilterPop(false)
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" />
              </svg>
              <span className="badge-tip">{sort === 'desc' ? '行程时间倒序' : '行程时间正序'}</span>
            </div>
            <div
              className="icon-btn"
              title="筛选"
              onClick={() => {
                setFilterPop((v) => !v)
                setSortPop(false)
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 5h18M6 12h12M10 19h4" />
              </svg>
              <span className="badge-tip">筛选</span>
            </div>
            <div className="icon-btn" title="同步" onClick={() => void syncNow()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 0115-6.7M21 12a9 9 0 01-15 6.7" />
                <path d="M21 4v5h-5M3 20v-5h5" />
              </svg>
              <span className="badge-tip">刷新从云端同步</span>
            </div>
            <button className="new-btn" onClick={() => {
              setEditTravelId(null)
              setCreateOpen(true)
            }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
              新建
            </button>

            {/* 排序弹窗 */}
            <div ref={sortPopRef} className={`t-popover${sortPop ? ' show' : ''}`} style={{ right: '148px' }}>
              <div className="head">排序方式</div>
              <div
                className={`item${sort === 'desc' ? ' active' : ''}`}
                onClick={() => {
                  setSort('desc')
                  setSortPop(false)
                }}
              >
                <span className="ico">⏱</span> 按行程时间倒序 <span className="check">✓</span>
              </div>
              <div
                className={`item${sort === 'asc' ? ' active' : ''}`}
                onClick={() => {
                  setSort('asc')
                  setSortPop(false)
                }}
              >
                <span className="ico">⏱</span> 按行程时间正序 <span className="check">✓</span>
              </div>
            </div>

            {/* 筛选弹窗 */}
            <div ref={filterPopRef} className={`t-popover${filterPop ? ' show' : ''}`} style={{ right: '96px' }}>
              <div className="head">地区</div>
              <select
                className="t-input"
                value={filterRegion}
                onChange={(e) => setFilterRegion(e.target.value)}
                style={{ width: '100%', padding: '7px 8px', borderRadius: '8px' }}
              >
                <option value="">全部地区</option>
                {PROVINCES.map((p) => (
                  <option key={p.adcode} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="sep" />
              <div className="head">行程时间</div>
              <select
                className="t-input"
                value={filterYear}
                onChange={(e) => setFilterYear(e.target.value)}
                style={{ width: '100%', padding: '7px 8px', borderRadius: '8px' }}
              >
                <option value="">全部</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y} 年
                  </option>
                ))}
              </select>
              <div className="sep" />
              <div
                className="item"
                style={{ color: 'var(--text-dim)' }}
                onClick={() => {
                  setFilterRegion('')
                  setFilterYear('')
                  setFilterPop(false)
                }}
              >
                清除筛选
              </div>
            </div>
          </div>

          <div className="scroll-area">
            <div className="waterfall">
              {filtered.length === 0 && !loading && (
                <div className="empty-state">
                  还没有旅行记录，点击右上角「新建」开始规划你的第一程 ✈️
                  <div className="arrow">↓</div>
                </div>
              )}
              {loading && (
                <div className="empty-state">正在载入旅行地图…</div>
              )}
              {filtered.map((t) => {
                const dc = dayCount(t.start_date, t.end_date)
                const nc = nightCount(t.start_date, t.end_date)
                return (
                  <div
                    className="wf-item"
                    key={t.id}
                    onClick={() => {
                      setDetailId(t.id)
                      setActiveTab(0)
                      setEditing(false)
                    }}
                  >
                    <div className="wf-cover">
                      {t.cover ? (
                        <img src={t.cover} alt={t.title} />
                      ) : (
                        <div
                          className="cover-bg"
                          style={{
                            position: 'absolute',
                            inset: 0,
                            background:
                              'linear-gradient(135deg, rgba(124,133,245,0.5), rgba(124,133,245,0.15))',
                          }}
                        />
                      )}
                      <div className="vignette" />
                    </div>
                    <div
                      className="wf-more"
                      role="button"
                      aria-expanded={cardPop?.id === t.id}
                      title="更多"
                      onClick={(e) => {
                        e.stopPropagation()
                        const r = (e.target as HTMLElement).getBoundingClientRect()
                        setCardPop(
                          cardPop?.id === t.id
                            ? null
                            : { id: t.id, x: r.right - 156, y: r.bottom + 6 },
                        )
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="5" r="1.6" />
                        <circle cx="12" cy="12" r="1.6" />
                        <circle cx="12" cy="19" r="1.6" />
                      </svg>
                    </div>
                    <div className="wf-meta-row">
                      <div className="wf-emoji">
                        {t.type && TRAVEL_TYPES[t.type] ? (
                          <img src={TRAVEL_TYPES[t.type].icon} alt={TRAVEL_TYPES[t.type].name} />
                        ) : t.emoji ? (
                          <span>{t.emoji}</span>
                        ) : (
                          <img src={TRAVEL_TYPES.city.icon} alt="城市" />
                        )}
                      </div>
                      <div className="wf-info">
                        <div className="wf-title">
                          {t.city} · {dc}天{nc}夜
                        </div>
                        <div className="wf-sub">
                          {formatDateRange(t.start_date, t.end_date)}
                          <span className="pip" />
                          {t.province_name}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ===== 详情面板（从右滑入全屏覆盖） ===== */}
          <div className={`detail-panel${detail ? ' show' : ''}`}>
            {detail && (
              <>
                <div className="dp-header">
                  <div
                    className="dp-back"
                    title="返回"
                    onClick={closeDetail}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </div>
                  <div className="dp-title-wrap">
                    <div className="dp-title">{detail.title}</div>
                    <div className="dp-sub">
                      行程日期 · {detail.start_date} → {detail.end_date}
                      {detail.departure_city ? (
                        // 有出发地：「出发地 ~ 目的地」（不重复显示，简洁路线感）
                        <> · {detail.departure_city} ~ {detail.city}</>
                      ) : (
                        // 老数据无出发地：保持原「📍 目的地」
                        detail.province_name && <> · 📍 {detail.province_name}</>
                      )}
                    </div>
                  </div>
                  <button
                    className={`dp-edit-btn${editing ? ' active' : ''}`}
                    onClick={() => setEditing((v) => !v)}
                  >
                    {editing ? '完成' : '编辑'}
                  </button>
                </div>
                <div className="dp-tabs">
                  <div
                    className={`dp-tab${activeTab === 0 ? ' active' : ''}`}
                    onClick={() => setActiveTab(0)}
                  >
                    总览
                  </div>
                  {detail.days.map((_d, i) => (
                    <div
                      key={i}
                      className={`dp-tab${activeTab === i + 1 ? ' active' : ''}`}
                      onClick={() => setActiveTab(i + 1)}
                    >
                      DAY {i + 1}
                    </div>
                  ))}
                  <div
                    className="dp-tab add"
                    onClick={() => {
                      setActiveTab(detail.days.length)
                      void addDay()
                    }}
                  >
                    + 添加日期
                  </div>
                </div>
                <div className={`dp-body${editing ? ' editing' : ''}`}>
                  {activeTab === 0 && (
                    <div className="overview-grid">
                      {OVERVIEW_TYPES.map((type) => {
                        const meta = MODULE_LABELS[type]
                        const cnt = overviewCounts[type] ?? 0
                        // 点击跳到第一个含该类型的天
                        const firstDay = detail.days.findIndex((d) =>
                          d.items.some((it) => it.type === type),
                        )
                        return (
                          <div
                            className={`mod-card${cnt > 0 ? ' purple' : ''}`}
                            key={type}
                            onClick={() => {
                              if (firstDay >= 0) setActiveTab(firstDay + 1)
                            }}
                            style={{ cursor: firstDay >= 0 ? 'pointer' : 'default' }}
                          >
                            <div className="mod-ico">
                              <img src={meta.icon} alt={meta.name} />
                            </div>
                            <div className="mod-name">{meta.name}</div>
                            <div className="mod-num">{cnt}</div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {activeTab > 0 &&
                    detail.days[activeTab - 1] && (
                      <div className="day-section is-active">
                        <div className="day-header">
                          <span className="day-tag">DAY {activeTab}</span>
                          <span className="day-title">
                            {detail.city} · 第 {activeTab} 天
                          </span>
                          <span className="day-line" />
                          <span className="day-date">
                            {dayDate(detail.start_date, activeTab - 1)}
                          </span>
                        </div>
                        {detail.days[activeTab - 1].items.length === 0 && (
                          <div className="empty-state" style={{ margin: '10px 0' }}>
                            这一天还没有安排，点右下角 + 添加行程
                          </div>
                        )}
                        {detail.days[activeTab - 1].items.map((it) => {
                          const meta = MODULE_LABELS[it.type] ?? MODULE_LABELS.custom
                          return (
                            <div className="timeline" key={it.id}>
                              <div className="tl-item">
                                <div className="tl-time">{it.time || '—'}</div>
                                <div className="tl-axis">
                                  <div className="tl-dot" />
                                  <div className="tl-line" />
                                </div>
                                <div className="tl-content">
                                  <div className="tl-title">
                                    <span className="tl-title-text">{it.title}</span>
                                    <img className="tl-title-ico" src={meta.icon} alt={meta.name} />
                                  </div>
                                  <div className="tl-meta">
                                    <span className="tl-pill">{meta.name}</span>
                                    {it.time && <span>· {it.time}</span>}
                                  </div>
                                  {it.note && <div className="tl-note">{it.note}</div>}
                                  {it.img && (
                                    <img className="tl-thumb" src={it.img} alt={it.title} />
                                  )}
                                  {editing && (
                                    <div className="tl-actions">
                                      <button
                                        title="上移"
                                        onClick={() => moveItem(activeTab - 1, it.id, -1)}
                                      >
                                        ↑
                                      </button>
                                      <button
                                        title="下移"
                                        onClick={() => moveItem(activeTab - 1, it.id, 1)}
                                      >
                                        ↓
                                      </button>
                                      <button
                                        className="tl-act-edit"
                                        title="编辑"
                                        onClick={() =>
                                          openAddItem(detail.id, activeTab - 1, it.id)
                                        }
                                      >
                                        ✎
                                      </button>
                                      <button
                                        title="删除"
                                        onClick={() => deleteItem(activeTab - 1, it.id)}
                                      >
                                        🗑
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                </div>
                <button
                  ref={fabAddRef}
                  className="fab-add"
                  title="添加"
                  onClick={() => setAddMenuOpen((v) => !v)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
                <div ref={addMenuRef} className={`add-menu${addMenuOpen ? ' show' : ''}`}>
                  {MODULE_KEYS.map((type) => {
                    const meta = MODULE_LABELS[type]
                    return (
                      <div
                        className="am"
                        key={type}
                        title={meta.name}
                        onClick={() => openAddItem(detail.id, Math.max(0, activeTab - 1))}
                      >
                        <div className="am-ico">
                          <img src={meta.icon} alt={meta.name} />
                        </div>
                        <div>{meta.name}</div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ===== 卡片"更多"弹出（fixed 定位，避开 overflow） ===== */}
      {cardPop && (
        <div
          ref={cardPopRef}
          className="wf-popover"
          style={{ position: 'fixed', left: cardPop.x, top: cardPop.y }}
        >
          <button
            className="wf-pop-item"
            onClick={() => {
              const t = travels.find((x) => x.id === cardPop.id)
              if (t) {
                // 编辑模式：把当前 travel 的所有字段灌入表单 state
                setEditTravelId(t.id)
                setCityText(t.city)
                setCitySuggest([])
                pickedProvince.current = { name: t.province_name, adcode: t.province_adcode }
                setDepartureText(t.departure_city ?? '')
                setDepartureSuggest([])
                departureProvince.current = {
                  name: t.departure_province_name ?? '',
                  adcode: t.departure_province_adcode ?? '',
                }
                setStartDate(t.start_date)
                setEndDate(t.end_date)
                setCoverPreview(t.cover)
                setCoverText('当前封面（可重新上传）')
                setTransportMode(t.transport_mode ?? 'plane')
                setTravelType(t.type ?? 'city')
                setCreateErr('')
                setCreateOpen(true)
              }
              setCardPop(null)
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            编辑卡片
          </button>
          <button
            className="wf-pop-item"
            onClick={() => {
              const t = travels.find((x) => x.id === cardPop.id)
              if (t) {
                setDetailId(t.id)
                setActiveTab(0)
                setEditing(false)
              }
              setCardPop(null)
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            打开详情
          </button>
          <button
            className="wf-pop-item pop-del"
            onClick={() => {
              void deleteTravel(cardPop.id)
              setCardPop(null)
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
            删除记录
          </button>
        </div>
      )}

      {/* ===== 创建旅行 dialog ===== */}
      {createOpen && (
        <div className="t-modal-mask show" onClick={(e) => {
          if (e.target === e.currentTarget) {
            setCreateOpen(false)
            setEditTravelId(null)
          }
        }}>
          <div className="t-modal">
            <div className="t-modal-close" onClick={() => {
              setCreateOpen(false)
              setEditTravelId(null)
            }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </div>
            <h3>{editTravelId ? '编辑旅行记录' : '新建旅行记录'}</h3>
            <div className="t-modal-sub">WHERE · WHEN · INFO</div>

            {/* 出发地：可选，与"你想去哪里"同套城市联想逻辑 */}
            <div className="t-field">
              <div className="label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 22h20" />
                  <path d="M9 17l-3 4 5.5-5.5L17 8l-2.5-2.5L9 11l-5.5 5.5 4 1.5z" />
                  <path d="M17 8l4-4" />
                  <path d="M21 4l-4 4" />
                </svg>
                你从哪出发？
              </div>
              <div className="desc">支持全球多级城市，输入关键词自动联想</div>
              <input
                className="t-input"
                placeholder="例如：上海、北京、广州…"
                value={departureText}
                autoComplete="off"
                onChange={(e) => onDepartureInput(e.target.value)}
              />
              <div className={`t-suggest${departureSuggest.length ? ' show' : ''}`}>
                {departureSuggest.map((c) => (
                  <div
                    className="sg"
                    key={c.name + c.provinceName}
                    onClick={() => pickDeparture(c)}
                  >
                    <span className="name">{c.name}</span>
                    <span className="prov">{c.country || c.provinceName}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="t-field">
              <div className="label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="11" r="3" />
                  <path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z" />
                </svg>
                你想去哪里？
              </div>
              <div className="desc">支持全球多级城市，输入关键词自动联想</div>
              <input
                className="t-input"
                placeholder="例如：上海、长沙、东京、巴黎…"
                value={cityText}
                autoComplete="off"
                onChange={(e) => onCityInput(e.target.value)}
              />
              <div className={`t-suggest${citySuggest.length ? ' show' : ''}`}>
                {citySuggest.map((c) => (
                  <div
                    className="sg"
                    key={c.name + c.provinceName}
                    onClick={() => pickCity(c)}
                  >
                    <span className="name">{c.name}</span>
                    <span className="prov">{c.country || c.provinceName}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="t-field">
              <div className="label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M8 3v4M16 3v4M3 11h18" />
                </svg>
                你想去多久？
              </div>
              <div className="desc">即——行程日期（开始 / 结束），下方自动算出天数</div>
              <div className="t-date-row">
                <input
                  type="date"
                  className="t-input"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <input
                  type="date"
                  className="t-input"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              {startDate && endDate && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: 'rgb(var(--c-accent-rgb))',
                  }}
                >
                  共 {dayCount(startDate, endDate)} 天 {nightCount(startDate, endDate)} 夜
                </div>
              )}
            </div>

            <div className="t-field">
              <div className="label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" transform="translate(0, -2) scale(1)" />
                  <path d="M17 8l4-4" />
                  <path d="M21 4l-4 4" />
                </svg>
                交通方式
              </div>
              <div className="desc">决定地图上的轨迹动画样式（飞机最亮 / 高铁中等 / 自驾最暗）</div>
              <div className="t-transport-row">
                {([
                  { k: 'plane' as const, label: '飞机', icon: `${ICON_BASE}icons/travel/transport/plane.png` },
                  { k: 'train' as const, label: '高铁', icon: `${ICON_BASE}icons/travel/transport/train.png` },
                  { k: 'drive' as const, label: '自驾', icon: `${ICON_BASE}icons/travel/transport/drive.png` },
                ]).map((opt) => (
                  <button
                    key={opt.k}
                    type="button"
                    className={`t-transport-opt${transportMode === opt.k ? ' active' : ''}`}
                    onClick={() => setTransportMode(opt.k)}
                  >
                    <img className="ico" src={opt.icon} alt={opt.label} />
                    <span className="lbl">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="t-field">
              <div className="label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                旅行主题
              </div>
              <div className="desc">决定卡片左上角圆形图标，可选城市/森林/海洋/湖泊/沙丘</div>
              <div className="t-transport-row">
                {TRAVEL_TYPE_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`t-transport-opt${travelType === k ? ' active' : ''}`}
                    onClick={() => setTravelType(k)}
                  >
                    <img className="ico" src={TRAVEL_TYPES[k].icon} alt={TRAVEL_TYPES[k].name} />
                    <span className="lbl">{TRAVEL_TYPES[k].name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="t-field">
              <div className="label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="M3 17l5-5 4 4 3-3 6 6" />
                </svg>
                封面图（必传）
              </div>
              <div className="desc">本地压缩为图片后入库，离线可用、同步上云</div>
              <label
                className="t-input"
                htmlFor="coverInput"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  height: 42,
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{ width: 16, height: 16, flexShrink: 0, opacity: 0.7 }}
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                  {coverText || '选择图片（必传）'}
                </span>
              </label>
              <input
                id="coverInput"
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => onCoverPick(e.target.files?.[0] ?? undefined)}
              />
              {coverPreview && (
                <img
                  src={coverPreview}
                  alt="封面预览"
                  style={{
                    marginTop: 8,
                    maxWidth: '100%',
                    maxHeight: 160,
                    borderRadius: 10,
                    border: '1px solid var(--line)',
                  }}
                />
              )}
            </div>

            {createErr && (
              <div style={{ color: 'rgb(185,28,28)', fontSize: 12, marginTop: 8 }}>
                {createErr}
              </div>
            )}

            <div className="modal-actions">
              <button className="t-btn-secondary" onClick={() => setCreateOpen(false)}>
                取消
              </button>
              <button className="t-btn-primary" onClick={() => void submitCreate()}>
                {editTravelId ? '保存修改' : '生成规划'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 添加 / 编辑 行程项 dialog ===== */}
      {addItem.open && detail && (
        <div className="t-modal-mask show" onClick={(e) => {
          if (e.target === e.currentTarget) setAddItem({ open: false, travelId: '', dayIndex: 0 })
        }}>
          <div className="t-modal">
            <div
              className="t-modal-close"
              onClick={() => setAddItem({ open: false, travelId: '', dayIndex: 0 })}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </div>
            <h3>{addItem.editId ? '编辑行程模块' : '添加行程模块'}</h3>
            <div className="t-modal-sub">TYPE · TITLE · TIME · NOTE · IMAGE</div>

            <div className="t-field">
              <div className="label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 7h16M4 12h16M4 17h10" />
                </svg>
                功能标题
              </div>
              <div className="desc">选择模块类型（共 13 类）</div>
              <select
                className="t-input"
                value={aiType}
                onChange={(e) => setAiType(e.target.value)}
              >
                {MODULE_KEYS.map((type) => (
<option key={type} value={type}>
                  {MODULE_LABELS[type].name}
                </option>
                ))}
              </select>
            </div>

            <div className="t-field">
              <div className="label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 20h4l11-11-4-4L4 16v4z" />
                </svg>
                自定义标题
              </div>
              <div className="desc">给这条记录起个名字（如：护国寺小吃）</div>
              <input
                className="t-input"
                placeholder="如：护国寺小吃"
                value={aiTitle}
                onChange={(e) => setAiTitle(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div className="t-field" style={{ flex: 1, marginBottom: 0 }}>
                <div className="label">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  时间
                </div>
                <input
                  className="t-input"
                  type="time"
                  value={aiTime}
                  onChange={(e) => setAiTime(e.target.value)}
                />
              </div>
              <div className="t-field" style={{ flex: 1, marginBottom: 0 }}>
                <div className="label">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <circle cx="9" cy="11" r="2" />
                    <path d="M3 17l5-5 4 4 3-3 6 6" />
                  </svg>
                  图片上传
                </div>
                <label
                  className="t-input"
                  htmlFor="aiImg"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    height: 42,
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ width: 16, height: 16, flexShrink: 0, opacity: 0.7 }}
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                    {aiImgName || '选择图片（可选）'}
                  </span>
                </label>
                <input
                  id="aiImg"
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => onAiImg(e.target.files?.[0] ?? undefined)}
                />
              </div>
            </div>

            <div className="t-field">
              <div className="label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16v16H4z" />
                  <path d="M4 8h16M8 4v16" />
                </svg>
                备注
              </div>
              <textarea
                className="t-input"
                rows={3}
                placeholder="如：豆汁焦圈 / 麻豆腐 / 驴打滚"
                style={{ resize: 'vertical' }}
                value={aiNote}
                onChange={(e) => setAiNote(e.target.value)}
              />
            </div>

            {aiPreview && (
              <div style={{ margin: '-6px 0 12px' }}>
                <img
                  id="aiPreviewImg"
                  src={aiPreview}
                  alt="预览"
                  style={{
                    maxWidth: '100%',
                    maxHeight: 160,
                    borderRadius: 10,
                    border: '1px solid var(--line)',
                  }}
                />
              </div>
            )}

            <div className="modal-actions">
              <button
                className="t-btn-secondary"
                onClick={() => setAddItem({ open: false, travelId: '', dayIndex: 0 })}
              >
                取消
              </button>
              <button className="t-btn-primary" onClick={() => void submitAddItem()}>
                {addItem.editId ? '保存修改' : '添加到时间轴'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 全局 toast ===== */}
      <div className={`t-toast${toastMsg ? ' show' : ''}`}>{toastMsg || '同步完成'}</div>
    </div>
  )
}
