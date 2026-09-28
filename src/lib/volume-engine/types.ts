/** Volume Engine —— 通用视图类型 */

export type StatItem = { label: string; value: string }

export type PickedView = { title: string; rows: StatItem[]; empty?: string }
