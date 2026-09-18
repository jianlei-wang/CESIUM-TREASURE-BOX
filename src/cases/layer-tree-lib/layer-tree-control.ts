import { Cartesian3, Math as CesiumMath, type Viewer } from 'cesium'
import { AdapterRegistry, type AdapterFactory } from './adapters/registry'
import { EventEmitter } from './event-emitter'
import { LayerTreeModel } from './layer-tree-model'
import {
  LayerType,
  uid,
  type AdapterContext,
  type ContextMenuItem,
  type ILayerAdapter,
  type LayerConfig,
  type LayerTreeEventMap,
  type LayerTreeEventName,
  type LayerTreeJSON,
  type LayerTreeOptions,
  type LayerTreeNode,
  type StyleField
} from './types'

const DEFAULT_CONTEXT_ITEMS: ContextMenuItem[] = [
  { id: 'visibility', label: '显示/隐藏', icon: 'visible' },
  { id: 'rename', label: '重命名', shortcut: 'F2', icon: 'rename' },
  { id: 'locate', label: '定位到图层', shortcut: 'Enter', icon: 'locate' },
  { id: 'duplicate', label: '复制图层', shortcut: 'Ctrl+D', icon: 'copy' },
  { id: 'settings', label: '样式设置', icon: 'settings' },
  { id: 'd-common-1', divider: true }
]

const TAIL_CONTEXT_ITEMS: ContextMenuItem[] = [
  { id: 'd-common-2', divider: true },
  { id: 'export', label: '导出配置', icon: 'export' },
  { id: 'delete', label: '删除图层', shortcut: 'Delete', danger: true, icon: 'delete' }
]

const PRIMITIVE_TYPES: LayerType[] = [LayerType.TILESET, LayerType.PRIMITIVE, LayerType.MODEL, LayerType.PARTICLE]

function cloneConfig(config: LayerConfig, withNewIds = false): LayerConfig {
  const copy: LayerConfig = { ...config }
  delete (copy as Record<string, unknown>).cesiumObject
  if (withNewIds) copy.id = uid()
  if (Array.isArray(config.children)) copy.children = config.children.map((child) => cloneConfig(child, withNewIds))
  return copy
}

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char))
}

/**
 * Cesium 标准图层树控件。
 * 负责图层数据模型与 Cesium 场景之间的双向同步，并对外暴露统一操作 API 与事件体系。
 */
export class LayerTreeControl {
  readonly viewer: Viewer
  readonly model = new LayerTreeModel()
  readonly options: LayerTreeOptions

  private emitter = new EventEmitter()
  private adapters = new Map<LayerType, ILayerAdapter>()
  private contextMenuItems: ContextMenuItem[]
  private removedBuffer: { configs: LayerConfig[]; timer: ReturnType<typeof setTimeout> } | null = null
  private disposers: Array<() => void> = []
  private destroyed = false

  constructor(viewer: Viewer, options: LayerTreeOptions = {}) {
    this.viewer = viewer
    this.options = options
    this.contextMenuItems = options.contextMenuItems ?? []
    const ctx: AdapterContext = {
      viewer,
      requestRender: () => {
        if (!viewer.isDestroyed()) viewer.scene.requestRender()
      }
    }
    for (const type of AdapterRegistry.types()) {
      const adapter = AdapterRegistry.create(type, ctx)
      if (adapter) this.adapters.set(type, adapter)
    }
    for (const entry of options.adapters ?? []) {
      const adapter = typeof entry === 'function' ? entry(ctx) : entry
      this.adapters.set(adapter.type, adapter)
    }
    this.bindModel()
    queueMicrotask(() => {
      if (!this.destroyed) this.emit('control:ready', { control: this })
    })
  }

  // ---------------------------------------------------------------- 事件

  on<K extends LayerTreeEventName>(event: K, listener: (payload: LayerTreeEventMap[K]) => void): () => void {
    return this.emitter.on(event, listener as (payload: unknown) => void)
  }

  off<K extends LayerTreeEventName>(event: K, listener: (payload: LayerTreeEventMap[K]) => void): void {
    this.emitter.off(event, listener as (payload: unknown) => void)
  }

  private emit<K extends LayerTreeEventName>(event: K, payload: LayerTreeEventMap[K]): void {
    this.emitter.emit(event, payload)
  }

  private bindModel(): void {
    const model = this.model
    this.disposers.push(
      model.on('node:remove', (raw) => {
        const { node } = raw as { node: LayerTreeNode }
        this.adapterOf(node)?.destroy(node.cesiumObject)
        this.emit('layer:remove', { nodeId: node.id, node })
      })
    )
    this.disposers.push(
      model.on('node:visibility', (raw) => {
        const { node, visible, oldVisible } = raw as { node: LayerTreeNode; visible: boolean; oldVisible: boolean }
        this.applyVisibility(node)
        this.emit('layer:visibility-change', { node, visible, oldVisible })
      })
    )
    this.disposers.push(
      model.on('node:opacity', (raw) => {
        const { node, opacity, oldOpacity } = raw as { node: LayerTreeNode; opacity: number; oldOpacity: number }
        this.applyOpacity(node)
        for (const child of model.getDescendants(node.id)) this.applyOpacity(child)
        this.emit('layer:opacity-change', { node, opacity, oldOpacity })
      })
    )
    this.disposers.push(
      model.on('node:rename', (raw) => {
        const { node, name, oldName } = raw as { node: LayerTreeNode; name: string; oldName: string }
        this.emit('layer:rename', { node, name, oldName })
      })
    )
    this.disposers.push(
      model.on('node:move', (raw) => {
        const payload = raw as LayerTreeEventMap['layer:move']
        this.syncOrder()
        this.emit('layer:move', payload)
      })
    )
    this.disposers.push(
      model.on('node:expand', (raw) => {
        const { node, expanded } = raw as { node: LayerTreeNode; expanded: boolean }
        this.emit(expanded ? 'group:expand' : 'group:collapse', { node })
      })
    )
    this.disposers.push(
      model.on('node:select', (raw) => {
        const payload = raw as LayerTreeEventMap['layer:select']
        this.emit('layer:select', payload)
      })
    )
    this.disposers.push(
      model.on('change', (raw) => {
        this.emit('tree:change', raw as LayerTreeEventMap['tree:change'])
      })
    )
  }

  // ---------------------------------------------------------------- 适配器

  getAdapter(type: LayerType): ILayerAdapter | undefined {
    return this.adapters.get(type)
  }

  private adapterOf(node: LayerTreeNode): ILayerAdapter | undefined {
    return this.adapters.get(node.type as LayerType)
  }

  private applyVisibility(node: LayerTreeNode): void {
    const adapter = this.adapterOf(node)
    if (!adapter || node.type === LayerType.GROUP) return
    adapter.setVisible(node.cesiumObject, this.model.getEffectiveVisible(node.id))
  }

  private applyOpacity(node: LayerTreeNode): void {
    const adapter = this.adapterOf(node)
    if (!adapter?.setOpacity || node.type === LayerType.GROUP) return
    adapter.setOpacity(node.cesiumObject, this.model.getEffectiveOpacity(node.id))
  }

  private syncOrder(): void {
    if (this.viewer.isDestroyed()) return
    const imageryNodes = this.model.getFlatRows().filter((row) => row.node.type === LayerType.IMAGERY && row.node.cesiumObject)
    if (imageryNodes.length) {
      const collection = this.viewer.imageryLayers
      for (const row of imageryNodes) {
        if (collection.contains(row.node.cesiumObject as never)) collection.remove(row.node.cesiumObject as never, false)
      }
      for (let i = imageryNodes.length - 1; i >= 0; i -= 1) {
        collection.add(imageryNodes[i].node.cesiumObject as never)
      }
    }
    const primitiveNodes = this.model
      .getFlatRows()
      .filter((row) => PRIMITIVE_TYPES.includes(row.node.type) && row.node.cesiumObject)
    if (primitiveNodes.length) {
      const collection = this.viewer.scene.primitives
      for (let i = primitiveNodes.length - 1; i >= 0; i -= 1) {
        collection.raiseToTop(primitiveNodes[i].node.cesiumObject as never)
      }
    }
    this.viewer.scene.requestRender()
  }

  // ---------------------------------------------------------------- 图层管理

  async addLayer(config: LayerConfig, parentId?: string | null): Promise<LayerTreeNode> {
    const node = this.model.addNode(config, parentId ?? null)
    try {
      const adapter = this.adapterOf(node)
      if (!adapter) throw new Error(`未注册的图层类型：${String(config.type)}`)
      const existing = (config as Record<string, unknown>).cesiumObject
      if (existing !== undefined) {
        this.model.setCesiumObject(node.id, existing)
      } else if (node.type !== LayerType.GROUP) {
        const object = await adapter.create({ ...config, opacity: this.model.getEffectiveOpacity(node.id) })
        this.model.setCesiumObject(node.id, object)
      } else {
        await adapter.create(config)
      }
      const bound = node.type === LayerType.GROUP ? null : node.cesiumObject
      if (bound) adapter.setVisible(bound, this.model.getEffectiveVisible(node.id))
      this.model.setLoading(node.id, false)
      if (Array.isArray(config.children)) {
        for (const child of config.children) await this.addLayer(child, node.id)
      }
      this.emit('layer:add', { node, cesiumObject: node.cesiumObject })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.model.setLoading(node.id, false, message)
      this.emit('layer:loading-error', { node, error: message })
      console.error('[LayerTree] add layer failed:', message)
    }
    return node
  }

  async addLayers(configs: LayerConfig[], parentId?: string | null): Promise<LayerTreeNode[]> {
    const nodes: LayerTreeNode[] = []
    for (const config of configs) nodes.push(await this.addLayer(config, parentId))
    return nodes
  }

  removeLayer(id: string): boolean {
    const node = this.model.findNode(id)
    if (!node) return false
    if (this.options.enableDelete === false) return false
    const config = this.model.subtreeConfig(id)
    this.removedBuffer = {
      configs: [config],
      timer: setTimeout(() => {
        this.removedBuffer = null
      }, 5000)
    }
    this.model.removeNode(id, true)
    return true
  }

  removeLayers(ids: string[]): number {
    let removed = 0
    for (const id of ids) if (this.removeLayer(id)) removed += 1
    return removed
  }

  undoRemove(): boolean {
    if (!this.removedBuffer) return false
    clearTimeout(this.removedBuffer.timer)
    const configs = this.removedBuffer.configs
    this.removedBuffer = null
    for (const config of configs) void this.addLayer(config)
    return true
  }

  getLayer(id: string): LayerTreeNode | null {
    return this.model.findNode(id)
  }

  getAllLayers(): LayerTreeNode[] {
    return this.model.getAllNodes()
  }

  getVisibleLayers(): LayerTreeNode[] {
    return this.model.getVisibleNodes()
  }

  getLayersByType(type: LayerType): LayerTreeNode[] {
    return this.model.findByType(type)
  }

  rename(id: string, name: string): void {
    this.model.rename(id, name)
  }

  async duplicate(id: string): Promise<LayerTreeNode | null> {
    const node = this.model.findNode(id)
    if (!node) return null
    const config = cloneConfig(node.config, true)
    config.name = `${node.name} 副本`
    const siblings = node.parentId ? this.model.getChildren(node.parentId) : this.model.getRoots()
    const index = this.model.indexOf(id)
    const created = await this.addLayer(config, node.parentId)
    const parentId = node.parentId
    if (index >= 0 && index < siblings.length - 1) this.model.moveNode(created.id, parentId, index + 1)
    return created
  }

  // ---------------------------------------------------------------- 分组

  createGroup(name: string, parentId?: string | null): LayerTreeNode {
    return this.model.addNode({ name, type: LayerType.GROUP }, parentId ?? null)
  }

  moveToGroup(layerId: string, groupId: string | null): boolean {
    return this.model.moveNode(layerId, groupId)
  }

  dissolveGroup(groupId: string): boolean {
    const group = this.model.findNode(groupId)
    if (!group || group.type !== LayerType.GROUP) return false
    const parentId = group.parentId
    const children = [...group.children]
    children.forEach((childId, index) => this.model.moveNode(childId, parentId, index))
    this.model.removeNode(groupId, false)
    return true
  }

  // ---------------------------------------------------------------- 状态

  setVisible(id: string, visible: boolean): void {
    const node = this.model.findNode(id)
    if (!node) return
    if (node.type === LayerType.TERRAIN && visible && this.options.terrainExclusive !== false) {
      for (const other of this.model.findByType(LayerType.TERRAIN)) {
        if (other.id !== id && other.visible) this.model.setVisible(other.id, false)
      }
    }
    this.model.setVisible(id, visible)
  }

  toggleVisible(id: string): void {
    const node = this.model.findNode(id)
    if (!node) return
    this.setVisible(id, this.model.getVisibilityState(id) !== 'checked')
  }

  setOpacity(id: string, opacity: number): void {
    this.model.setOpacity(id, opacity)
  }

  showAll(): void {
    for (const node of this.model.getRoots()) this.model.setVisible(node.id, true)
  }

  hideAll(): void {
    for (const node of this.model.getRoots()) this.model.setVisible(node.id, false)
  }

  expandAll(): void {
    for (const node of this.model.findByType(LayerType.GROUP)) this.model.setExpanded(node.id, true)
  }

  collapseAll(): void {
    for (const node of this.model.findByType(LayerType.GROUP)) this.model.setExpanded(node.id, false)
  }

  // ---------------------------------------------------------------- 排序

  moveUp(id: string): void {
    const index = this.model.indexOf(id)
    if (index <= 0) return
    const node = this.model.findNode(id)
    if (!node) return
    this.model.moveNode(id, node.parentId, index - 1)
  }

  moveDown(id: string): void {
    const index = this.model.indexOf(id)
    const node = this.model.findNode(id)
    if (!node) return
    const siblings = node.parentId ? this.model.getChildren(node.parentId) : this.model.getRoots()
    if (index < 0 || index >= siblings.length - 1) return
    this.model.moveNode(id, node.parentId, index + 2 > siblings.length ? siblings.length : index + 2)
  }

  moveTo(id: string, targetParentId: string | null, index: number): void {
    this.model.moveNode(id, targetParentId, index)
  }

  moveToTop(id: string): void {
    const node = this.model.findNode(id)
    if (!node) return
    const siblings = node.parentId ? this.model.getChildren(node.parentId) : this.model.getRoots()
    this.model.moveNode(id, node.parentId, siblings.length - 1)
  }

  moveToBottom(id: string): void {
    const node = this.model.findNode(id)
    if (!node) return
    this.model.moveNode(id, node.parentId, 0)
  }

  // ---------------------------------------------------------------- 定位

  async flyTo(id: string): Promise<void> {
    const node = this.model.findNode(id)
    if (!node) return
    const adapter = this.adapterOf(node)
    if (adapter?.flyTo) {
      try {
        await adapter.flyTo(node.cesiumObject, node)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.emit('layer:loading-error', { node, error: message })
        console.error('[LayerTree] flyTo failed:', message)
      }
      return
    }
    if (node.type === LayerType.GROUP) {
      const child = this.model.getDescendants(node.id).find((item) => item.cesiumObject)
      if (child) await this.flyTo(child.id)
    }
  }

  async zoomTo(id: string): Promise<void> {
    const node = this.model.findNode(id)
    if (!node) return
    const extent = this.adapterOf(node)?.getExtent?.(node.cesiumObject)
    if (!extent) {
      await this.flyTo(id)
      return
    }
    const [west, south, east, north] = extent
    await new Promise<void>((resolve) => {
      this.viewer.camera.flyTo({
        destination: Cartesian3.fromRadians(
          CesiumMath.toRadians((west + east) / 2),
          CesiumMath.toRadians((south + north) / 2),
          CesiumMath.toRadians(Math.max(east - west, north - south)) * 6.0e6
        ),
        complete: () => resolve()
      })
    })
  }

  selectLayer(id: string | null, options: { additive?: boolean; range?: boolean } = {}): void {
    this.model.select(id, options)
  }

  // ---------------------------------------------------------------- 元数据

  getMeta(node: LayerTreeNode): Record<string, unknown> {
    const meta = this.adapterOf(node)?.getMeta?.(node.cesiumObject) ?? {}
    return {
      名称: node.name,
      类型: this.getTypeLabel(node.type),
      ID: node.id,
      数据来源: node.meta.source ?? (node.config.imagery?.options?.url as string) ?? node.config.tileset?.url ?? '-',
      创建时间: new Date(node.meta.createdAt).toLocaleString(),
      ...meta
    }
  }

  getTypeLabel(type: LayerType): string {
    return this.adapters.get(type)?.label ?? type
  }

  getTypeColor(type: LayerType): string {
    return this.adapters.get(type)?.color ?? '#8aa4c8'
  }

  getStats(): { total: number; visible: number; selected: number; loading: number } {
    const nodes = this.model.getAllNodes()
    return {
      total: nodes.length,
      visible: this.model.getVisibleNodes().length,
      selected: this.model.getSelected().length,
      loading: nodes.filter((node) => node.loading).length
    }
  }

  // ---------------------------------------------------------------- 样式

  getStyleFields(id: string): StyleField[] {
    const node = this.model.findNode(id)
    if (!node) return []
    const adapter = this.adapterOf(node)
    if (!adapter?.getStyleFields) return []
    return adapter.getStyleFields(node.cesiumObject, node)
  }

  applyStyle(id: string, values: Record<string, unknown>): void {
    const node = this.model.findNode(id)
    if (!node) return
    const adapter = this.adapterOf(node)
    const rest = { ...values }
    if (rest.alpha !== undefined && adapter?.setOpacity) {
      const alpha = Number(rest.alpha)
      delete rest.alpha
      this.model.setOpacity(id, Number.isFinite(alpha) ? alpha : node.opacity)
    }
    if (adapter?.applyStyle && Object.keys(rest).length) {
      adapter.applyStyle(node.cesiumObject, node, rest)
    }
    this.emit('layer:style-change', { node, values })
  }

  // ---------------------------------------------------------------- 右键菜单

  getContextMenuItems(node: LayerTreeNode): ContextMenuItem[] {
    const typeItems = this.adapterOf(node)?.getContextMenuItems?.(node) ?? []
    const extra = this.contextMenuItems
    const items = [...DEFAULT_CONTEXT_ITEMS, ...typeItems, ...extra, ...TAIL_CONTEXT_ITEMS]
    return items
      .filter((item) => this.isItemVisible(item, node))
      .map((item) => this.attachAction(item, node))
  }

  private isItemVisible(item: ContextMenuItem, node: LayerTreeNode): boolean {
    if (item.id === 'opacity' && this.options.enableOpacity === false) return false
    if ((item.id === 'rename' || item.id === 'delete') && this.options.enableDelete === false) return false
    if (item.id === 'settings') {
      const adapter = this.adapterOf(node)
      if (!adapter?.getStyleFields || adapter.getStyleFields(node.cesiumObject, node).length === 0) return false
    }
    if (typeof item.visible === 'function') return item.visible(node)
    if (typeof item.visible === 'boolean') return item.visible
    return true
  }

  private attachAction(item: ContextMenuItem, node: LayerTreeNode): ContextMenuItem {
    const result: ContextMenuItem = { ...item }
    if (typeof item.disabled === 'function') result.disabled = item.disabled(node)
    if (item.action) return result
    result.action = (target) => {
      const run = this.menuActions[item.id]
      if (run) run(target)
      else this.emit('contextmenu:action', { menuId: item.id, node: target })
    }
    return result
  }

  private menuActions: Record<string, (node: LayerTreeNode) => void> = {
    visibility: (node) => this.toggleVisible(node.id),
    rename: (node) => this.emit('contextmenu:action', { menuId: 'rename', node }),
    locate: (node) => void this.flyTo(node.id),
    duplicate: (node) => void this.duplicate(node.id),
    settings: (node) => this.emit('contextmenu:action', { menuId: 'settings', node }),
    attributes: (node) => this.emit('contextmenu:action', { menuId: 'attributes', node }),
    description: (node) => this.emit('contextmenu:action', { menuId: 'description', node }),
    opacity: (node) => this.emit('contextmenu:action', { menuId: 'opacity', node }),
    export: (node) => this.exportFile(node.id),
    delete: (node) => {
      if (this.options.confirmOnDelete) this.emit('contextmenu:action', { menuId: 'delete', node })
      else this.removeLayer(node.id)
    },
    reload: (node) => void this.reload(node.id),
    raise: (node) => this.moveUp(node.id),
    lower: (node) => this.moveDown(node.id),
    toTop: (node) => this.moveToTop(node.id),
    toBottom: (node) => this.moveToBottom(node.id),
    activateTerrain: (node) => this.setVisible(node.id, true),
    terrainExaggeration: (node) => this.emit('contextmenu:action', { menuId: 'terrainExaggeration', node }),
    terrainWater: (node) => this.emit('contextmenu:action', { menuId: 'terrainWater', node }),
    groupAddLayer: (node) => this.emit('contextmenu:action', { menuId: 'groupAddLayer', node }),
    groupAddGroup: (node) => this.emit('contextmenu:action', { menuId: 'groupAddGroup', node }),
    groupExpand: (node) => {
      this.model.setExpanded(node.id, true)
      for (const child of this.model.getDescendants(node.id).filter((item) => item.type === LayerType.GROUP)) this.model.setExpanded(child.id, true)
    },
    groupCollapse: (node) => {
      for (const child of this.model.getDescendants(node.id).filter((item) => item.type === LayerType.GROUP)) this.model.setExpanded(child.id, false)
    },
    groupShow: (node) => this.model.setVisible(node.id, true),
    groupHide: (node) => this.model.setVisible(node.id, false),
    dissolveGroup: (node) => this.dissolveGroup(node.id)
  }

  // ---------------------------------------------------------------- 重载与导出

  async reload(id: string): Promise<void> {
    const node = this.model.findNode(id)
    if (!node || node.type === LayerType.GROUP) return
    const adapter = this.adapterOf(node)
    if (!adapter) return
    adapter.destroy(node.cesiumObject)
    this.model.setCesiumObject(id, null)
    this.model.setLoading(id, true)
    try {
      const object = await adapter.create({ ...node.config, opacity: this.model.getEffectiveOpacity(id) })
      this.model.setCesiumObject(id, object)
      adapter.setVisible(object, this.model.getEffectiveVisible(id))
      this.model.setLoading(id, false)
      this.emit('layer:loading-end', { node, cesiumObject: object })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.model.setLoading(id, false, message)
      this.emit('layer:loading-error', { node, error: message })
    }
  }

  exportConfig(id?: string): LayerConfig | LayerConfig[] {
    if (id) {
      const node = this.model.findNode(id)
      if (!node) return []
      return cloneConfig({ ...node.config, id: node.id, name: node.name, type: node.type })
    }
    return this.model.toConfigs()
  }

  exportFile(id?: string): void {
    if (typeof document === 'undefined') return
    const data = this.exportConfig(id)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `layer-tree-${id ?? 'all'}-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  // ---------------------------------------------------------------- 序列化

  toJSON(): LayerTreeJSON {
    return { version: '1.0', nodes: this.model.toConfigs() }
  }

  async fromJSON(json: LayerTreeJSON): Promise<void> {
    this.clear()
    const nodes = Array.isArray(json?.nodes) ? json.nodes : []
    for (const config of nodes) await this.addLayer(config)
    this.model.notifyLoad()
  }

  clear(): void {
    for (const node of [...this.model.getAllNodes()].reverse()) {
      try {
        this.adapterOf(node)?.destroy(node.cesiumObject)
      } catch (error) {
        console.warn('[LayerTree] 释放图层资源失败:', error)
      }
    }
    this.model.clear()
  }

  // ---------------------------------------------------------------- 生命周期

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.removedBuffer) clearTimeout(this.removedBuffer.timer)
    for (const dispose of this.disposers) dispose()
    this.disposers = []
    this.clear()
    this.emitter.clear()
  }

  /** 在控件内部使用的 HTML 转义，供面板展示描述信息。 */
  static escapeHtml(value: unknown): string {
    return escapeHtml(value)
  }
}

export type { AdapterFactory }
