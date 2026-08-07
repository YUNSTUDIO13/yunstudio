import type { BuiltinModuleId } from './builtin-modules'
import type { IconKey } from './icon-library'

/**
 * NavConfig 数据模型
 *
 * HomeTab（固定）：硬编码不参与自定义，点击跳 / 渲染欢迎/汇总
 * NavPrimary：一级 Tab（侧栏 dock 中的一个图标）
 *   - iconKey：从 24 个图标里选
 *   - groups：二级列分组（>0 个）
 *   - order：Dock 上下顺序
 * SecondaryColumn：二级列（一级 Tab hover 时 Mega Menu 中的一列）
 *   - title：标题（如「今日聚焦」「团队协作」）
 *   - modules：该二级列下挂的三级模块 id 列表（按顺序）
 */

export interface SecondaryColumn {
  id: string // 唯一
  title: string
  modules: BuiltinModuleId[]
}

export interface NavPrimary {
  id: string // 唯一
  title: string
  iconKey: IconKey
  groups: SecondaryColumn[]
  order: number
}

export interface NavConfig {
  // 一级 Tab（按 order 升序）
  primaries: NavPrimary[]
  // schema 版本号，未来 schema 变更时可做迁移
  version: 1
}

/** 用 crypto.randomUUID 在不支持的环境下兜底 */
export function uid(prefix = ''): string {
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return prefix ? `${prefix}_${raw.slice(0, 8)}` : raw
}
