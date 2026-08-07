import type { NavConfig } from './nav-types'

/**
 * 默认 NavConfig（首次打开或点击「重置默认」时使用）
 * 设计原则：
 *  - 7 个一级 Tab（总览/工作/需求/迭代/缺陷/指标/设置）
 *  - 每个一级 Tab 至少一个二级列；二级列 title 为空模块项也允许
 *  - "设置"一级 Tab 默认含「导航配置」二级列
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
      id: 'p_kpis',
      title: '指标',
      iconKey: 'bar',
      order: 6,
      groups: [{ id: 'g_kpi_1', title: '指标卡', modules: ['kpis'] }],
    },
    {
      id: 'p_news',
      title: '新闻',
      iconKey: 'news',
      order: 7,
      groups: [{ id: 'g_news_1', title: '资讯', modules: ['news'] }],
    },
    {
      id: 'p_nav_settings',
      title: '导航设置',
      iconKey: 'gear',
      order: 8,
      groups: [{ id: 'g_set_1', title: '导航配置', modules: ['nav-config'] }],
    },
  ],
}
