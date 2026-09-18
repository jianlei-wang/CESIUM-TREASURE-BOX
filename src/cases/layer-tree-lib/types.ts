/**
 * Cesium 标准图层树控件 —— 类型定义
 *
 * 该模块只描述数据模型与接口，不依赖具体渲染框架，可被 Vue / React / 原生 JS 直接复用。
 */

export enum LayerType {
  GROUP = 'group',
  IMAGERY = 'imagery',
  TERRAIN = 'terrain',
  TILESET = 'tileset',
  DATASOURCE = 'datasource',
  ENTITY = 'entity',
  PRIMITIVE = 'primitive',
  MODEL = 'model',
  PARTICLE = 'particle',
  VOXEL = 'voxel',
  CUSTOM = 'custom'
}

export interface LayerMeta {
  source?: string
  format?: string
  description?: string
  createdAt: number
  modifiedAt: number
  extent?: [number, number, number, number]
}

export interface ImageryConfig {
  providerType: string
  options: Record<string, unknown>
}

export interface TerrainConfig {
  providerType: string
  options?: Record<string, unknown>
}

export interface TilesetConfig {
  url?: string
  ionAssetId?: number
  options?: Record<string, unknown>
  style?: Record<string, unknown>
}

export interface DataSourceConfig {
  format: 'geojson' | 'kml' | 'czml' | 'custom'
  url?: string
  data?: unknown
  options?: Record<string, unknown>
}

export interface EntityConfig {
  [key: string]: unknown
}

export interface PrimitiveConfig {
  primitiveType: string
  options: Record<string, unknown>
}

export interface ModelConfig {
  url: string
  options?: Record<string, unknown>
}

export interface ParticleConfig {
  emitter?: string
  options?: Record<string, unknown>
}

export interface LayerConfig {
  id?: string
  name: string
  type: LayerType
  visible?: boolean
  opacity?: number
  locked?: boolean
  expanded?: boolean
  children?: LayerConfig[]
  imagery?: ImageryConfig
  terrain?: TerrainConfig
  tileset?: TilesetConfig
  datasource?: DataSourceConfig
  entity?: EntityConfig
  primitive?: PrimitiveConfig
  model?: ModelConfig
  particle?: ParticleConfig
  meta?: Partial<LayerMeta>
  [key: string]: unknown
}

export interface LayerTreeNode {
  id: string
  name: string
  type: LayerType
  parentId: string | null
  children: string[]
  visible: boolean
  locked: boolean
  expanded: boolean
  selected: boolean
  loading: boolean
  error: string | null
  opacity: number
  cesiumObject: unknown
  adapterType: string
  meta: LayerMeta
  config: LayerConfig
  contextMenu: string[]
  [key: string]: unknown
}

export interface ContextMenuItem {
  id: string
  label?: string
  icon?: string
  shortcut?: string
  danger?: boolean
  divider?: boolean
  disabled?: boolean | ((node: LayerTreeNode) => boolean)
  visible?: boolean | ((node: LayerTreeNode) => boolean)
  submenu?: ContextMenuItem[]
  children?: ContextMenuItem[]
  action?: (node: LayerTreeNode, control: unknown) => void
}

export type StyleFieldType = 'text' | 'number' | 'color' | 'boolean' | 'select'

export interface StyleFieldOption {
  label: string
  value: string | number
}

/** 图层样式字段描述，供视图层自动渲染样式设置表单。 */
export interface StyleField {
  key: string
  label: string
  type: StyleFieldType
  value: string | number | boolean
  min?: number
  max?: number
  step?: number
  options?: StyleFieldOption[]
  hint?: string
}

export interface LayerTreeOptions {
  container?: HTMLElement | string
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'inline'
  enableSearch?: boolean
  enableDragDrop?: boolean
  enableContextMenu?: boolean
  enableRename?: boolean
  enableDelete?: boolean
  enableOpacity?: boolean
  enableAddButton?: boolean
  confirmOnDelete?: boolean
  defaultExpanded?: boolean
  syncImageryOrder?: boolean
  terrainExclusive?: boolean
  theme?: 'dark' | 'light' | 'auto'
  width?: number
  maxHeight?: number
  adapters?: Array<ILayerAdapter | ((ctx: AdapterContext) => ILayerAdapter)>
  contextMenuItems?: ContextMenuItem[]
}

export interface AdapterContext {
  viewer: import('cesium').Viewer
  requestRender: () => void
}

export interface ILayerAdapter {
  readonly type: LayerType
  readonly label: string
  readonly color: string

  create(config: LayerConfig): Promise<unknown>
  destroy(cesiumObject: unknown): void
  clone?(cesiumObject: unknown): Promise<unknown>

  setVisible(cesiumObject: unknown, visible: boolean): void
  setOpacity?(cesiumObject: unknown, opacity: number): void
  getExtent?(cesiumObject: unknown): [number, number, number, number] | null

  moveUp?(cesiumObject: unknown): void
  moveDown?(cesiumObject: unknown): void
  moveToIndex?(cesiumObject: unknown, index: number): void

  getMeta?(cesiumObject: unknown): Record<string, unknown>
  getContextMenuItems?(node: LayerTreeNode): ContextMenuItem[]
  getStyleFields?(cesiumObject: unknown, node: LayerTreeNode): StyleField[]
  applyStyle?(cesiumObject: unknown, node: LayerTreeNode, values: Record<string, unknown>): void
  flyTo?(cesiumObject: unknown, node: LayerTreeNode): Promise<void> | void
}

export interface LayerTreeJSON {
  version: string
  nodes: LayerConfig[]
}

export interface LayerAddPreset {
  label: string
  hint?: string
  group?: boolean
  config: LayerConfig | ((parentId: string | null) => LayerConfig)
}

export interface LayerTreeEventMap {
  'layer:add': { node: LayerTreeNode; cesiumObject: unknown }
  'layer:remove': { nodeId: string; node: LayerTreeNode }
  'layer:visibility-change': { node: LayerTreeNode; visible: boolean; oldVisible: boolean }
  'layer:opacity-change': { node: LayerTreeNode; opacity: number; oldOpacity: number }
  'layer:rename': { node: LayerTreeNode; name: string; oldName: string }
  'layer:style-change': { node: LayerTreeNode; values: Record<string, unknown> }
  'layer:move': { node: LayerTreeNode; oldParentId: string | null; newParentId: string | null; oldIndex: number; newIndex: number }
  'layer:select': { node: LayerTreeNode | null; oldNode: LayerTreeNode | null; selected: LayerTreeNode[] }
  'layer:loading-start': { node: LayerTreeNode }
  'layer:loading-end': { node: LayerTreeNode; cesiumObject: unknown }
  'layer:loading-error': { node: LayerTreeNode; error: string }
  'group:expand': { node: LayerTreeNode }
  'group:collapse': { node: LayerTreeNode }
  'tree:load': { rootNodes: LayerTreeNode[] }
  'tree:change': { reason: string }
  'contextmenu:action': { menuId: string; node: LayerTreeNode }
  'control:ready': { control: unknown }
}

export type LayerTreeEventName = keyof LayerTreeEventMap

let uidCounter = 0

export function uid(prefix = 'layer'): string {
  uidCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}`
}
