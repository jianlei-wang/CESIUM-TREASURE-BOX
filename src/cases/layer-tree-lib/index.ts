/**
 * Cesium 标准图层树控件 —— 公共入口
 *
 * 核心（模型 / 适配器 / 控件）不依赖渲染框架，可直接在原生 JS / React / Vue 中复用；
 * Vue 面板组件 LayerTreePanel.vue 为可选视图层，通过 `viewer` 属性接入。
 *
 * 基础用法：
 *   import { LayerTreeControl, LayerType } from '@/cases/layer-tree-lib'
 *   const control = new LayerTreeControl(viewer, { theme: 'dark' })
 *   await control.addLayer({ name: '天地图影像', type: LayerType.IMAGERY, imagery: { ... } })
 */
export { LayerTreeControl } from './layer-tree-control'
export { LayerTreeModel } from './layer-tree-model'
export { EventEmitter } from './event-emitter'
export { AdapterRegistry } from './adapters/registry'
export { AbstractAdapter } from './adapters/base'
export { ImageryAdapter } from './adapters/imagery'
export { TerrainAdapter } from './adapters/terrain'
export { TilesetAdapter } from './adapters/tileset'
export { DataSourceAdapter } from './adapters/datasource'
export { EntityAdapter } from './adapters/entity'
export { PrimitiveAdapter } from './adapters/primitive'
export { ModelAdapter } from './adapters/model'
export { ParticleAdapter } from './adapters/particle'
export { GroupAdapter } from './adapters/group'
export { LayerType, uid } from './types'
export type {
  AdapterContext,
  ContextMenuItem,
  ILayerAdapter,
  LayerAddPreset,
  LayerConfig,
  LayerMeta,
  LayerTreeEventMap,
  LayerTreeEventName,
  LayerTreeJSON,
  LayerTreeOptions,
  LayerTreeNode,
  StyleField,
  StyleFieldOption,
  StyleFieldType
} from './types'
