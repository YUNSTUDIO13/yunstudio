import type { NavConfig } from './nav-types'

/**
 * 默认 NavConfig（首次打开或点击「重置默认」时使用）
 * 设计原则：
 *  - 6 个一级 Tab（工作 / 总览 / 需求 / 迭代 / 缺陷 / 新闻 / 系统设置）
 *  - 系统设置下挂「导航配置」+ 「字典管理」两个二级列
 */
export const DEFAULT_NAV_CONFIG: NavConfig = {
  version: 1,
  primaries: [
    {
      id: 'p_work',
      title: '工作',
      iconKey: 'list',
      order: 1,
      groups: [
        {
          id: 'g_work_1',
          title: '今日聚焦',
          modules: ['todos'],
        },
        {
          id: 'g_work_2',
          title: '全部待办',
          modules: [],
        },
      ],
    },
    {
      id: 'p_overview',
      title: '总览',
      iconKey: 'home',
      order: 2,
      groups: [{ id: 'g_overview_1', title: '默认', modules: ['overview'] }],
    },
    {
      id: 'p_requirements',
      title: '需求',
      iconKey: 'doc',
      order: 3,
      groups: [
        { id: 'g_req_1', title: '需求池', modules: ['requirements'] },
        { id: 'g_req_2', title: '未分配', modules: [] },
      ],
    },
    {
      id: 'p_sprints',
      title: '迭代',
      iconKey: 'clock',
      order: 4,
      groups: [{ id: 'g_sp_1', title: '当前迭代', modules: ['sprints'] }],
    },
    {
      id: 'p_bugs',
      title: '缺陷',
      iconKey: 'bell',
      order: 5,
      groups: [{ id: 'g_bug_1', title: '跟踪', modules: ['bugs'] }],
    },
    {
      id: 'p_news',
      title: '新闻',
      iconKey: 'news',
      order: 6,
      groups: [{ id: 'g_news_1', title: '资讯', modules: ['news'] }],
    },
    {
      id: 'p_apps',
      title: '应用',
      iconKey: 'grid',
      order: 7,
      groups: [{ id: 'g_apps_1', title: '全部应用', modules: ['apps'] }],
    },
    {
      id: 'p_movies',
      title: '观影',
      iconKey: 'film',
      order: 8,
      groups: [{ id: 'g_movies_1', title: '观影志', modules: ['movies'] }],
    },
    {
      id: 'p_books',
      title: '阅读',
      iconKey: 'book',
      order: 9,
      groups: [{ id: 'g_books_1', title: '阅读志', modules: ['books'] }],
    },
    {
      id: 'p_travel',
      title: '旅行',
      iconKey: 'travel',
      order: 10,
      groups: [{ id: 'g_travel_1', title: '旅行志', modules: ['travel'] }],
    },
    {
      id: 'p_system_settings',
      title: '系统设置',
      iconKey: 'gear',
      order: 9,
      groups: [
        { id: 'g_sys_1', title: '导航配置', modules: ['nav-config'] },
        { id: 'g_sys_2', title: '字典管理', modules: ['tag-dict'] },
        { id: 'g_sys_3', title: 'UI 设置', modules: ['ui-settings'] },
      ],
    },
  ],
}
