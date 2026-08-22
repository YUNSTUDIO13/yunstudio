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
  tag_id?: string | null // 字典·枚举值 id（来自 tag_values）
  movie_id?: string | null // 绑定的观影电影 id（预约观看联动用）
  counted_at?: string | null // 计数守卫：完成并已计入观影次数的时间戳；用于去重（取消再勾选不累加）
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
  tag_id?: string | null
  movie_id?: string | null // 绑定的观影电影 id（预约观看联动用）
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
  tag_id?: string | null // 字典·枚举值 id
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
  tag_id?: string | null
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
  tag_id?: string | null // 字典·枚举值 id
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
  tag_id?: string | null
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
  tag_id?: string | null // 字典·枚举值 id
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
  tag_id?: string | null
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

// ============================================================
// 字典（TagDictionary）
// 用于支持字段自定义枚举值（如"标签"、"优先级"等所有需要受控枚举的字段）
// 当前主用：tag_categories.name === "标签"  → 四业务表 todos/requirements/sprints/bugs.tag_id
// ============================================================
export interface TagCategory {
  id: string
  user_id: string
  name: string // 字段名，如"标签"
  created_at: string
  updated_at: string
}

export interface TagValue {
  id: string
  category_id: string
  value: string // 枚举值文本
  created_at: string
  updated_at: string
}

export type TagCategoryInput = { name: string }
export type TagValueInput = { category_id: string; value: string }

// ============================================================
// 应用（Apps）—— 个人应用导航 / 书签类
// 数据列：应用图标(运行期按URL取favicon，不落库) / 应用名称 / 目标 URL / 功能说明
// 点击图标直接跳转目标 URL；支持新增 / 编辑 / 删除（云端 Supabase 存储）
// ============================================================
export interface App {
  id: string
  user_id: string
  name: string // 应用名称
  target_url: string // 目标 URL（点击图标跳转）
  description: string // 功能说明
  created_at: string
  updated_at: string
}

export type AppInput = {
  name: string
  target_url: string
  description?: string | null
}

// ============================================================
// 观影（Movies）—— 个人影视库
// 数据：本地 Dexie 优先 + outbox 补传 Supabase（与 apps 等模块一致的本地优先架构）
// 封面：TMDB 返回的公网 poster URL；手动上传走 Supabase Storage(movie-covers bucket) 返回公链
// 评分：personal_rating 优先；third_party_rating 为 TMDB 等第三方评分；两者皆有时双评展示（带"我/第三方"标识）
// ============================================================
export interface Movie {
  id: string
  user_id: string
  title: string
  year: number
  cover: string // 封面图 URL（TMDB 公网 / Storage 公链）；为空时显示占位
  backdrop: string // 宽幅背景图 URL（TMDB backdrop_path）；Hero 优先用此图，竖版则用 cover
  personal_rating: number | null // 个人评分（0–10）
  third_party_rating: number | null // 第三方评分（TMDB，0–10）
  review: string // 个人短评
  overview: string // 简介（TMDB overview，zh-CN）
  cast: string[] // 演员表（TMDB credits.cast 前若干主演）
  genre: string[] // 类型
  region: string // 地区
  duration: number // 时长（分钟）
  watched_at: string // 观影日期（YYYY-MM-DD）
  view_count: number // 观影次数（默认 0；预约观看待办完成勾选时 +1，可累计）
  synced: boolean // 是否已同步第三方数据
  cover_failed: boolean // 封面获取是否失败（用于标记手动获取）
  created_at: string
  updated_at: string
}

export type MovieInput = {
  title: string
  year: number
  cover?: string
  backdrop?: string
  personal_rating?: number | null
  third_party_rating?: number | null
  review?: string
  overview?: string
  cast?: string[]
  genre?: string[]
  region?: string
  duration?: number
  watched_at?: string
  synced?: boolean
  cover_failed?: boolean
}

// ============================================================
// 阅读（Books）—— 个人书库（镜像观影 Movies，字段差异见下）
// 字段差异（相对 Movies）：
//   · 书籍名称(title) / 年代(year) / 封面(cover) / 类型(genre[]) / 个人评分(personal_rating)
//     / 个人评价(review) / 简介(overview) 均与观影一致
//   · 演员表(cast[]) → 作者(author)：单行文本，多作者用「、」分隔（无第三方书库自动拉取）
//   · 观影日期(watched_at) → 阅读日期(read_at)
//   · 观影次数(view_count) → 阅读次数(read_count)
//   · 去掉：地区(region) / 时宽背景图(backdrop) / 时长(duration)（阅读无剧照）
// ============================================================
export interface Book {
  id: string
  user_id: string
  title: string
  year: number
  cover: string // 封面图 URL（Google Books 公网 / Storage 公链）；为空时显示占位
  personal_rating: number | null // 个人评分（0–10）
  review: string // 个人短评
  overview: string // 简介
  author: string // 作者（单行文本，多作者「、」分隔）
  genre: string[] // 类型
  read_at: string // 阅读日期（YYYY-MM-DD）
  read_count: number // 阅读次数（默认 0）
  synced: boolean // 是否已同步第三方数据
  cover_failed: boolean // 封面获取是否失败（用于标记手动获取）
  created_at: string
  updated_at: string
}

export type BookInput = {
  title: string
  year: number
  cover?: string
  personal_rating?: number | null
  review?: string
  overview?: string
  author?: string
  genre?: string[]
  read_at?: string
  read_count?: number
  synced?: boolean
  cover_failed?: boolean
}

// ============================================================
// 旅行（Travel）—— 个人旅行志
// 数据：本地 Dexie 优先 + outbox 补传 Supabase（与 movies/books 一致）
// 地图：province_adcode 反查省级行政区，有该省记录则地图对应省份点亮
// 封面：用户上传图片，压缩为 WebP data URL 落库（本地优先、离线可用；同步时作为文本列上云）
// 行程：days 为嵌套 JSON（每天含若干 items），整段作为 JSON 列存储，不拆子表
// ============================================================
export interface TravelItem {
  id: string
  time: string // 当日时刻 HH:MM
  type: string // 功能类型键（见页面 MODULE_LABELS）
  title: string // 自定义标题（缺省兜底为类型名）
  note: string // 备注
  img: string | null // 图片（data URL 或 Storage 公链），可空；第6条迭代升级为多图后改为 string[]
  // ── 第6条迭代：各类型字段（可选，按 type 使用） ──
  // 交通
  tool?: 'plane' | 'train' | 'drive' // 交通工具
  dateStart?: string // 出发日期
  dateEnd?: string // 到达日期
  flightNo?: string // 航班号（tool=plane）
  trainNo?: string // 车次号（tool=train）
  fromStation?: string // 出发站（高德机场/车站，失败手动）
  fromTime?: string // 出发时间
  toStation?: string // 到达站
  toTime?: string // 到达时间
  // 住宿
  hotel?: string // 酒店名（高德搜索）
  address?: string // 地址（高德返回，失败手动）
  star?: number // 星级（高德返回，失败手动）
  // 景点 / POI（吃喝/购物/娱乐/打卡复用景点字段）
  poi?: string // POI 名称（高德搜索）
  intro?: string // 地点介绍
  rating?: string // 真实评价
  openTime?: string // 营业时间
  // 导航地址（点击复制，除注意事项外均含）
  navAddr?: string
}

export interface TravelDay {
  items: TravelItem[]
}

export interface Travel {
  id: string
  user_id: string
  title: string // 行程标题（如「长沙 3 天 2 夜」）
  city: string // 目的地城市名
  province_adcode: string // 省级行政区 adcode（地图点亮反查键）
  province_name: string // 省级行政区名称
  emoji: string // 情绪/主题 emoji
  start_date: string // 出发日 YYYY-MM-DD
  end_date: string // 返程日 YYYY-MM-DD
  cover: string // 封面图（必填：用户上传压缩后的 data URL）
  days: TravelDay[] // 行程时间轴（嵌套 JSON）
  created_at: string
  updated_at: string
  // 出发地（可选，老数据无则不展示；仅在 detail panel 顶部显示「出发地～目的地」，
  // 不点亮出发地省份的地图——地图只点亮目的地）
  departure_city?: string
  departure_province_adcode?: string
  departure_province_name?: string
  // 交通方式（决定轨迹动画类型：飞机/高铁/自驾）
  transport_mode?: 'plane' | 'train' | 'drive'
  // 旅行类型（旅行主题：城市/森林/海洋/湖泊/沙丘），决定卡片左上角圆形图标来源。
  // 用户在新建表单选择类型；老数据无则回退到 emoji 字段，再无则用 type=city 图标。
  type?: 'city' | 'forest' | 'ocean' | 'lake' | 'dune'
  // 第5条迭代：四个独立模块（便签/行李清单/机酒车票/地点），不受右下角添加按钮控制，
  // 在总览卡片下方独立展示、独立更新。后续单独迭代其模块能力。
  extra?: {
    memo?: string // 便签（纯文本）
    luggage?: string[] // 行李清单（清单项）
    ticket?: string[] // 机酒车票（清单项）
    place?: string[] // 地点（清单项）
  }
}

export type TravelInput = {
  title: string
  city: string
  province_adcode: string
  province_name: string
  emoji: string
  start_date: string
  end_date: string
  cover: string
  days?: TravelDay[]
}
