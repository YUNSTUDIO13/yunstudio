// 内置模块枚举（预置库）。用户从这些里选，自己不能造新模块。
// 后续真接 Supabase 时，每个模块对应一张或多张业务表 + 视图。
export const BUILTIN_MODULE_IDS = [
  'overview',
  'todos',
  'requirements',
  'sprints',
  'bugs',
  'news', // 新闻/资讯（Supabase 云端表，支持外部推送）
  'nav-config', // 导航配置本身是个内置模块（角色「配置后台」）
  'tag-dict', // 字典管理（系统设置下的二级页）
  'apps', // 应用（个人应用导航 / 书签）
  'ui-settings', // UI 设置（指针主题 · 全局视觉）
  'movies', // 观影（个人影视库 / 观影志）
  'books', // 阅读（个人书库 / 阅读志）
] as const
export type BuiltinModuleId = (typeof BUILTIN_MODULE_IDS)[number]

export interface BuiltinModuleMeta {
  id: BuiltinModuleId
  title: string
  desc: string
  // 路由前缀（统一用 /modules/[id]）
  route: string
  // 默认是否启用（在「重置默认」时会被推入导航）
  defaultEnabled: boolean
}

// 元数据由配置页读取，用于「添加三级模块」弹窗中的多选面板
export const BUILTIN_MODULES: Record<BuiltinModuleId, BuiltinModuleMeta> = {
  overview: {
    id: 'overview',
    title: '总览',
    desc: '总览卡片（待办 · 需求 · 缺陷 · 完成度）',
    route: '/modules/overview',
    defaultEnabled: true,
  },
  todos: {
    id: 'todos',
    title: '待办',
    desc: '待办列表 · Score 排序 · 优先级/截止/标签',
    route: '/modules/todos',
    defaultEnabled: true,
  },
  requirements: {
    id: 'requirements',
    title: '需求',
    desc: '需求池 · 8 态状态机 · 业务价值',
    route: '/modules/requirements',
    defaultEnabled: true,
  },
  sprints: {
    id: 'sprints',
    title: '迭代',
    desc: 'Sprint 周期 · 燃尽图',
    route: '/modules/sprints',
    defaultEnabled: true,
  },
  bugs: {
    id: 'bugs',
    title: '缺陷',
    desc: 'Bug 跟踪 · 修复闭环',
    route: '/modules/bugs',
    defaultEnabled: true,
  },
  'nav-config': {
    id: 'nav-config',
    title: '导航配置',
    desc: '自定义一级 Tab/二级列/三级模块归属',
    route: '/modules/nav-config',
    defaultEnabled: true,
  },
  news: {
    id: 'news',
    title: '新闻',
    desc: '资讯/报表聚合 · 支持外部自动推送',
    route: '/modules/news',
    defaultEnabled: true,
  },
  'tag-dict': {
    id: 'tag-dict',
    title: '字典管理',
    desc: '维护所有受控枚举字段（标签 / 优先级 等）的取值',
    route: '/modules/tag-dict',
    defaultEnabled: true,
  },
  'apps': {
    id: 'apps',
    title: '应用',
    desc: '个人应用导航 · 图标跳转 · 新增 / 编辑 / 删除',
    route: '/modules/apps',
    defaultEnabled: true,
  },
  'ui-settings': {
    id: 'ui-settings',
    title: 'UI 设置',
    desc: '指针主题 · 光粒 / 流光特效 · 自定义颜色',
    route: '/modules/ui-settings',
    defaultEnabled: true,
  },
  'movies': {
    id: 'movies',
    title: '观影',
    desc: '个人影视库 · 封面/评分/短评 · 自动同步第三方',
    route: '/modules/movies',
    defaultEnabled: true,
  },
  'books': {
    id: 'books',
    title: '阅读',
    desc: '个人书库 · 封面/评分/短评 · Google Books 自动补元数据',
    route: '/modules/books',
    defaultEnabled: true,
  },
}

// 取内置模块的元数据；不存在则兜底为空对象
export function getBuiltinModule(id: string): BuiltinModuleMeta | null {
  return (BUILTIN_MODULES as Record<string, BuiltinModuleMeta | undefined>)[id] ?? null
}
