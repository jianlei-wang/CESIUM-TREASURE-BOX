/** Volume Engine —— 通用视图类型 */

export type StatItem = { label: string; value: string }

export type PickedView = { title: string; rows: StatItem[]; empty?: string }

/** 图层面板单项：key 供调用方映射副作用，on 为当前显隐状态 */
export type LayerDockItem = {
  key: string
  label: string
  color: string
  on: boolean
  hint?: string
}
