import type { ReactNode } from 'react'

// 24 个线性 SVG 图标，统一描边风格（与现有 AppShell 同步）
// 配置页里用户可在一级 Tab 上「选择图标」，范围限定这 24 个
export type IconKey =
  | 'home' | 'target' | 'doc' | 'clock' | 'bell' | 'gear'
  | 'star' | 'flag' | 'bookmark' | 'check' | 'flag2'
  | 'list' | 'grid' | 'pie' | 'bar' | 'wave'
  | 'users' | 'msg' | 'inbox' | 'tag' | 'link'
  | 'folder' | 'cube' | 'rocket' | 'spark' | 'flame'
  | 'news' | 'film' | 'book'

// 每个图标提供一个 ReactNode；用统一描边粗细、类名，调用方靠外部 control 颜色
const S = 'h-5 w-5'
const svg = (path: ReactNode): ReactNode => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={S}>
    {path}
  </svg>
)

export const ICONS: Record<IconKey, ReactNode> = {
  home: svg(<><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>),
  target: svg(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></>),
  doc: svg(<><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6" /><path d="M8 13h8M8 17h5" /></>),
  clock: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  bell: svg(<><path d="M6 8a6 6 0 0112 0c0 7 3 7 3 9H3c0-2 3-2 3-9z" /><path d="M10 21a2 2 0 004 0" /></>),
  gear: svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3h.1a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8v.1a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></>),
  star: svg(<><path d="M12 3l2.7 6 6.3.6-4.8 4.4 1.4 6.6L12 17.8 6.4 20.6l1.4-6.6L3 9.6l6.3-.6z" /></>),
  flag: svg(<><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>),
  bookmark: svg(<><path d="M6 3h12v18l-6-4-6 4z" /></>),
  check: svg(<><path d="M4 12l5 5L20 6" /></>),
  flag2: svg(<><path d="M5 21V4" /><path d="M5 9h10l-2-3 2-3H5" /></>),
  list: svg(<><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" /></>),
  grid: svg(<><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></>),
  pie: svg(<><path d="M12 2a10 10 0 1010 10H12V2z" /><path d="M12 2v8h8" /></>),
  bar: svg(<><path d="M3 21h18" /><rect x="5" y="13" width="3" height="6" /><rect x="11" y="9" width="3" height="10" /><rect x="17" y="5" width="3" height="14" /></>),
  wave: svg(<><path d="M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0" /><path d="M3 18c2-3 4-3 6 0s4 3 6 0 4-3 6 0" /></>),
  users: svg(<><circle cx="9" cy="8" r="3.5" /><path d="M2 21c0-3.3 3-6 7-6s7 2.7 7 6" /><circle cx="17" cy="6" r="2.5" /><path d="M16 14c3 0 6 2 6 5" /></>),
  msg: svg(<><path d="M21 12a8 8 0 11-3-6.2L21 4l-1.2 4.2A7.9 7.9 0 0121 12z" /></>),
  inbox: svg(<><path d="M3 13l3-9h12l3 9" /><path d="M3 13v6a2 2 0 002 2h14a2 2 0 002-2v-6" /><path d="M3 13h5l2 3h4l2-3h5" /></>),
  tag: svg(<><path d="M3 12V4h8l10 10-8 8z" /><circle cx="8" cy="8" r="1.5" fill="currentColor" /></>),
  link: svg(<><path d="M9 15l6-6" /><path d="M11 6l1.5-1.5a4 4 0 015.7 5.7L16 12" /><path d="M13 18l-1.5 1.5a4 4 0 01-5.7-5.7L8 12" /></>),
  folder: svg(<><path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></>),
  cube: svg(<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5L12 12l8-4.5" /><path d="M12 12v9" /></>),
  rocket: svg(<><path d="M5 19c-1-3 1-9 7-15 6 6 8 12 7 15-2 1-7-1-7-1s-5 2-7 1z" /><circle cx="12" cy="11" r="2" /></>),
  spark: svg(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" /></>),
  flame: svg(<><path d="M12 3c2 4 6 5 6 10a6 6 0 11-12 0c0-3 2-4 3-6 1 2 2 2 3-1z" /></>),
  news: svg(<><path d="M3 5h12a2 2 0 012 2v12H5a2 2 0 01-2-2z" /><path d="M3 5v12" /><path d="M8 9h6M8 12h6M8 15h4" /></>),
  film: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="8" r="1.2" fill="currentColor" /><circle cx="16" cy="8" r="1.2" fill="currentColor" /><circle cx="8" cy="16" r="1.2" fill="currentColor" /><circle cx="16" cy="16" r="1.2" fill="currentColor" /><path d="M12 4v16" /></>),
  book: svg(<><path d="M4 4h11a2 2 0 012 2v14H6a2 2 0 01-2-2z" /><path d="M17 6h3v14H6" /><path d="M4 4v14" /></>),
}

// 供配置页面板用的图标标签（中文短标签，避免选择时一脸懵）
export const ICON_LABELS: Record<IconKey, string> = {
  home: '主页', target: '靶心', doc: '文档', clock: '时钟', bell: '提醒', gear: '设置',
  star: '收藏', flag: '旗帜', bookmark: '书签', check: '对勾', flag2: '里程碑',
  list: '列表', grid: '网格', pie: '饼图', bar: '柱状', wave: '波形',
  users: '团队', msg: '消息', inbox: '收件', tag: '标签', link: '链接',
  folder: '文件夹', cube: '立方', rocket: '火箭', spark: '闪光', flame: '火焰',
  news: '资讯', film: '观影', book: '阅读',
}

export const ICON_KEYS: IconKey[] = Object.keys(ICONS) as IconKey[]

export function renderIcon(key: string): ReactNode {
  return ICONS[key as IconKey] ?? ICONS.home
}
