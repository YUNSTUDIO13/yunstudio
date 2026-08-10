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
  start_date: string | null // ISO（规划阶段可无起止日期）
  end_date: string | null // ISO
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

// ------------------------------------------------------------
// 个人资料（public.profiles，与 auth.users 1:1，主键即 user id）
// ------------------------------------------------------------
export interface Profile {
  id: string // = auth.users.id
  email?: string | null
  display_name?: string | null
  avatar_url?: string | null
  title?: string | null // 职位
  department?: string | null // 部门
  bio?: string | null // 个性签名 / 简介
  created_at: string
  updated_at: string
}

/** 个人主页可编辑字段 */
export type ProfileInput = {
  display_name?: string | null
  title?: string | null
  department?: string | null
  bio?: string | null
}

// ============================================================
// 通知（Notification）—— 到期通知
// 触发：实体（todo/sprint）填写了截止时间且到达该时间点，
//       在通知列表增加一条。已读后该实体再次到期才再建。
// ============================================================
export type NotificationEntity = 'todo' | 'sprint'
export type NotificationKind = 'expired'

export interface Notification {
  id: string
  user_id: string
  entity_type: NotificationEntity
  entity_id: string
  entity_title: string // 实体标题快照（即使实体被删/改名也保留历史记录）
  deadline_at: string // 截止时间快照
  kind: NotificationKind
  read_at: string | null // null = 未读
  created_at: string
  updated_at: string
}
