// 业务实体类型定义（前端体验阶段，与未来 Supabase 表字段一一对应，便于后续接库）
export type Priority = 'P0' | 'P1' | 'P2' | 'P3'

export interface Todo {
  id: string
  user_id: string
  title: string
  source_url?: string | null // 外部系统链接（Jira/飞书等），仅跳转不对接
  priority: Priority
  deadline_at?: string | null // ISO 时间字符串
  note?: string | null
  done: boolean
  done_at?: string | null
  created_at: string
  updated_at: string
}

// 新建/编辑表单的输入形态（去掉系统托管字段）
export type TodoInput = {
  title: string
  source_url?: string | null
  priority: Priority
  deadline_at?: string | null
  note?: string | null
}

// ============================================================
// 需求（Requirement）—— 8 态状态机
// ============================================================
export type ReqStatus =
  | 'draft' // 草稿
  | 'review' // 待评审
  | 'scheduled' // 已排期
  | 'dev' // 研发中
  | 'test' // 测试中
  | 'launched' // 已上线（终态）
  | 'hold' // 已挂起
  | 'void' // 作废（终态）

export interface Requirement {
  id: string
  user_id: string
  title: string
  priority: Priority
  status: ReqStatus
  value_desc: string // 业务价值说明（DB 端加密，此处仅展示）
  source_url?: string | null // 外部系统链接（仅跳转不对接）
  owner?: string | null // 负责人
  created_at: string
  updated_at: string
}

export type RequirementInput = {
  title: string
  priority: Priority
  status: ReqStatus
  value_desc: string
  source_url?: string | null
  owner?: string | null
}

// ============================================================
// 迭代（Sprint）
// ============================================================
export type SprintStatus =
  | 'planning' // 规划中
  | 'active' // 进行中
  | 'closing' // 已收尾
  | 'done' // 已完成
  | 'cancelled' // 已取消

export interface Sprint {
  id: string
  user_id: string
  name: string
  goal: string // 迭代目标
  status: SprintStatus
  start_date: string // ISO
  end_date: string // ISO
  progress: number // 完成百分比 0-100
  burndown: number[] // 剩余工作量序列（用于燃尽图）
  created_at: string
  updated_at: string
}

export type SprintInput = {
  name: string
  goal: string
  status: SprintStatus
  start_date: string
  end_date: string
  progress: number
}

// ============================================================
// 缺陷（Bug）
// ============================================================
export type BugSeverity = 'critical' | 'major' | 'normal' | 'minor' // 致命/严重/一般/轻微
export type BugStatus = 'open' | 'in_progress' | 'verifying' | 'closed' // 待处理/处理中/待验证/已关闭

export interface Bug {
  id: string
  user_id: string
  title: string
  severity: BugSeverity
  priority: Priority
  status: BugStatus
  reporter?: string | null // 报告人
  source_url?: string | null // 复现/缺陷单链接
  created_at: string
  updated_at: string
}

export type BugInput = {
  title: string
  severity: BugSeverity
  priority: Priority
  status: BugStatus
  reporter?: string | null
  source_url?: string | null
}

// ============================================================
// 指标（KPI）
// ============================================================
export type KpiCategory = 'business' | 'efficiency' | 'quality' | 'growth' // 业务/效率/质量/增长

export interface Kpi {
  id: string
  user_id: string
  name: string
  category: KpiCategory
  value: number
  unit: string
  target: number
  trend: number[] // 近期数值序列（用于迷你趋势线）
  lower_is_better?: boolean // true 时数值越低越好（如缺陷修复时长）
  created_at: string
  updated_at: string
}

export type KpiInput = {
  name: string
  category: KpiCategory
  value: number
  unit: string
  target: number
  trend: number[]
  lower_is_better?: boolean
}

// ============================================================
// 新闻 / 资讯（News）—— Supabase 云端表（首张真实业务表）
// 由「每周全球消费趋势数据更新报表」等任务推送，或手动新增
// ============================================================
export interface NewsSourceLink {
  title: string
  url: string
}

export interface NewsItem {
  id: string
  user_id: string
  title: string
  summary: string
  content: string // markdown 长文
  category: string // 业务分类，如 'consumer-trends'
  report_type: string // 报表类型，如 'weekly-consumer-trends'
  tags: string[]
  source_links: NewsSourceLink[]
  period_start?: string | null // 报表覆盖周期起（日期）
  period_end?: string | null // 报表覆盖周期止（日期）
  created_at: string
  updated_at: string
}

export type NewsInput = {
  title: string
  summary: string
  content: string
  category?: string
  report_type?: string
  tags?: string[]
  source_links?: NewsSourceLink[]
  period_start?: string | null
  period_end?: string | null
}
