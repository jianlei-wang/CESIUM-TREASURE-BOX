import { EventEmitter } from './event-emitter'
import { LayerType, uid, type LayerConfig, type LayerMeta, type LayerTreeNode } from './types'

export type ModelEventName =
  | 'node:add'
  | 'node:remove'
  | 'node:move'
  | 'node:visibility'
  | 'node:opacity'
  | 'node:expand'
  | 'node:select'
  | 'node:rename'
  | 'node:update'
  | 'tree:load'
  | 'change'

export interface FlatRow {
  node: LayerTreeNode
  depth: number
}

interface SelectOptions {
  additive?: boolean
  range?: boolean
}

/**
 * 图层树状态唯一真相源。
 * 只维护纯数据节点与树结构，Cesium 场景同步由 LayerTreeControl + Adapter 负责。
 */
export class LayerTreeModel {
  private nodes = new Map<string, LayerTreeNode>()
  private rootIds: string[] = []
  private order: string[] = []
  private emitter = new EventEmitter()

  readonly version = { value: 0 }

  on(event: ModelEventName, listener: (payload: unknown) => void): () => void {
    return this.emitter.on(event, listener)
  }

  off(event: ModelEventName, listener: (payload: unknown) => void): void {
    this.emitter.off(event, listener)
  }

  private touch(reason: string): void {
    this.version.value += 1
    this.emitter.emit('change', { reason })
  }

  get size(): number {
    return this.nodes.size
  }

  findNode(id: string): LayerTreeNode | null {
    return this.nodes.get(id) ?? null
  }

  getAllNodes(): LayerTreeNode[] {
    return this.order.map((id) => this.nodes.get(id)!).filter(Boolean)
  }

  getRoots(): LayerTreeNode[] {
    return this.rootIds.map((id) => this.nodes.get(id)!).filter(Boolean)
  }

  getChildren(id: string): LayerTreeNode[] {
    const node = this.nodes.get(id)
    if (!node) return []
    return node.children.map((cid) => this.nodes.get(cid)!).filter(Boolean)
  }

  findByType(type: LayerType): LayerTreeNode[] {
    return this.getAllNodes().filter((node) => node.type === type)
  }

  getVisibleNodes(): LayerTreeNode[] {
    return this.getAllNodes().filter((node) => this.getEffectiveVisible(node.id))
  }

  getParent(id: string): LayerTreeNode | null {
    const node = this.nodes.get(id)
    if (!node || !node.parentId) return null
    return this.nodes.get(node.parentId) ?? null
  }

  getDescendants(id: string, includeSelf = false): LayerTreeNode[] {
    const result: LayerTreeNode[] = []
    const walk = (nodeId: string) => {
      const node = this.nodes.get(nodeId)
      if (!node) return
      result.push(node)
      for (const childId of node.children) walk(childId)
    }
    const start = this.nodes.get(id)
    if (!start) return result
    if (includeSelf) walk(id)
    else for (const childId of start.children) walk(childId)
    return result
  }

  isAncestor(ancestorId: string, id: string): boolean {
    let current = this.nodes.get(id)?.parentId ?? null
    while (current) {
      if (current === ancestorId) return true
      current = this.nodes.get(current)?.parentId ?? null
    }
    return false
  }

  getEffectiveVisible(id: string): boolean {
    let current: LayerTreeNode | undefined = this.nodes.get(id)
    while (current) {
      if (!current.visible) return false
      current = current.parentId ? this.nodes.get(current.parentId) : undefined
    }
    return true
  }

  getEffectiveOpacity(id: string): number {
    let current: LayerTreeNode | undefined = this.nodes.get(id)
    let opacity = 1
    while (current) {
      opacity *= current.opacity
      current = current.parentId ? this.nodes.get(current.parentId) : undefined
    }
    return opacity
  }

  getVisibilityState(id: string): 'checked' | 'unchecked' | 'indeterminate' {
    const node = this.nodes.get(id)
    if (!node) return 'unchecked'
    if (node.type !== LayerType.GROUP || node.children.length === 0) {
      return node.visible ? 'checked' : 'unchecked'
    }
    const states = this.getDescendants(id).map((child) => child.visible)
    if (states.every((value) => value)) return 'checked'
    if (states.every((value) => !value)) return 'unchecked'
    return 'indeterminate'
  }

  getFlatRows(): FlatRow[] {
    const rows: FlatRow[] = []
    const walk = (ids: string[], depth: number) => {
      for (const id of ids) {
        const node = this.nodes.get(id)
        if (!node) continue
        rows.push({ node, depth })
        if (node.type === LayerType.GROUP && node.expanded && node.children.length) {
          walk(node.children, depth + 1)
        }
      }
    }
    walk(this.rootIds, 0)
    return rows
  }

  addNode(config: LayerConfig, parentId: string | null = null): LayerTreeNode {
    const id = config.id ?? uid()
    const now = Date.now()
    const meta: LayerMeta = {
      source: config.meta?.source,
      format: config.meta?.format,
      description: config.meta?.description,
      extent: config.meta?.extent,
      createdAt: config.meta?.createdAt ?? now,
      modifiedAt: config.meta?.modifiedAt ?? now
    }
    const node: LayerTreeNode = {
      id,
      name: config.name,
      type: config.type,
      parentId,
      children: [],
      visible: config.visible ?? true,
      locked: config.locked ?? false,
      expanded: config.expanded ?? true,
      selected: false,
      loading: true,
      error: null,
      opacity: config.opacity ?? 1,
      cesiumObject: null,
      adapterType: config.type,
      meta,
      config,
      contextMenu: []
    }
    this.nodes.set(id, node)
    this.order.push(id)
    if (parentId && this.nodes.has(parentId)) this.nodes.get(parentId)!.children.push(id)
    else {
      node.parentId = null
      this.rootIds.push(id)
    }
    this.emitter.emit('node:add', { node })
    this.touch('add')
    return node
  }

  removeNode(id: string, recursive = true): LayerTreeNode[] {
    const node = this.nodes.get(id)
    if (!node) return []
    const removed: LayerTreeNode[] = []
    const targets = recursive && node.children.length ? [...this.getDescendants(id, true)].reverse() : [node]
    for (const target of targets) {
      this.detach(target.id)
      this.nodes.delete(target.id)
      this.order = this.order.filter((item) => item !== target.id)
      removed.push(target)
      this.emitter.emit('node:remove', { node: target })
    }
    this.touch('remove')
    return removed
  }

  private detach(id: string): void {
    const node = this.nodes.get(id)
    if (!node) return
    if (node.parentId) {
      const parent = this.nodes.get(node.parentId)
      if (parent) parent.children = parent.children.filter((childId) => childId !== id)
    } else {
      this.rootIds = this.rootIds.filter((childId) => childId !== id)
    }
  }

  moveNode(id: string, targetParentId: string | null, index?: number): boolean {
    const node = this.nodes.get(id)
    if (!node) return false
    if (targetParentId === id || (targetParentId && this.isAncestor(id, targetParentId))) return false
    const oldParentId = node.parentId
    const oldIndex = this.indexOf(id)
    this.detach(id)
    node.parentId = targetParentId
    if (targetParentId && this.nodes.has(targetParentId)) {
      const parent = this.nodes.get(targetParentId)!
      const insertAt = index === undefined || index < 0 || index > parent.children.length ? parent.children.length : index
      parent.children.splice(insertAt, 0, id)
    } else {
      node.parentId = null
      const insertAt = index === undefined || index < 0 || index > this.rootIds.length ? this.rootIds.length : index
      this.rootIds.splice(insertAt, 0, id)
    }
    const newIndex = this.indexOf(id)
    this.emitter.emit('node:move', { node, oldParentId, newParentId: node.parentId, oldIndex, newIndex })
    this.touch('move')
    return true
  }

  indexOf(id: string): number {
    const node = this.nodes.get(id)
    if (!node) return -1
    return node.parentId
      ? (this.nodes.get(node.parentId)?.children.indexOf(id) ?? -1)
      : this.rootIds.indexOf(id)
  }

  setVisible(id: string, visible: boolean, silent = false): void {
    const node = this.nodes.get(id)
    if (!node || node.locked) return
    const oldVisible = node.visible
    node.visible = visible
    if (!silent) this.emitter.emit('node:visibility', { node, visible, oldVisible })
    if (node.type === LayerType.GROUP) {
      for (const childId of node.children) this.setVisible(childId, visible, silent)
    }
    if (!silent) this.touch('visibility')
  }

  toggleVisible(id: string): void {
    const node = this.nodes.get(id)
    if (!node) return
    const next = this.getVisibilityState(id) !== 'checked'
    this.setVisible(id, next)
  }

  setOpacity(id: string, opacity: number): void {
    const node = this.nodes.get(id)
    if (!node) return
    const oldOpacity = node.opacity
    node.opacity = Math.min(1, Math.max(0, opacity))
    this.emitter.emit('node:opacity', { node, opacity: node.opacity, oldOpacity })
    this.touch('opacity')
  }

  setExpanded(id: string, expanded: boolean): void {
    const node = this.nodes.get(id)
    if (!node || node.type !== LayerType.GROUP) return
    if (node.expanded === expanded) return
    node.expanded = expanded
    this.emitter.emit('node:expand', { node, expanded })
    this.touch('expand')
  }

  toggleExpand(id: string): void {
    const node = this.nodes.get(id)
    if (!node) return
    this.setExpanded(id, !node.expanded)
  }

  rename(id: string, name: string): void {
    const node = this.nodes.get(id)
    if (!node) return
    const trimmed = name.trim()
    if (!trimmed || trimmed === node.name) return
    const oldName = node.name
    node.name = trimmed
    node.meta.modifiedAt = Date.now()
    this.emitter.emit('node:rename', { node, name: trimmed, oldName })
    this.touch('rename')
  }

  setLocked(id: string, locked: boolean): void {
    const node = this.nodes.get(id)
    if (!node) return
    node.locked = locked
    this.touch('lock')
  }

  setLoading(id: string, loading: boolean, error: string | null = null): void {
    const node = this.nodes.get(id)
    if (!node) return
    node.loading = loading
    node.error = error
    this.touch('loading')
  }

  setCesiumObject(id: string, object: unknown): void {
    const node = this.nodes.get(id)
    if (!node) return
    node.cesiumObject = object
    this.touch('bind')
  }

  select(id: string | null, options: SelectOptions = {}): void {
    const oldSelected = this.getAllNodes().filter((node) => node.selected)
    const oldNode = oldSelected[oldSelected.length - 1] ?? null

    if (id === null) {
      for (const node of this.nodes.values()) node.selected = false
      this.emitter.emit('node:select', { node: null, oldNode, selected: [] })
      this.touch('select')
      return
    }

    const node = this.nodes.get(id)
    if (!node) return

    if (options.additive) {
      node.selected = !node.selected
    } else if (options.range && oldNode) {
      const rows = this.getFlatRows()
      const from = rows.findIndex((row) => row.node.id === oldNode.id)
      const to = rows.findIndex((row) => row.node.id === id)
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from]
        for (const item of this.nodes.values()) item.selected = false
        for (let i = start; i <= end; i += 1) rows[i].node.selected = true
      }
    } else {
      for (const item of this.nodes.values()) item.selected = false
      node.selected = true
    }

    const selected = this.getAllNodes().filter((item) => item.selected)
    const currentNode = selected[selected.length - 1] ?? null
    this.emitter.emit('node:select', { node: currentNode, oldNode, selected })
    this.touch('select')
  }

  getSelected(): LayerTreeNode[] {
    return this.getAllNodes().filter((node) => node.selected)
  }

  selectAll(): void {
    for (const node of this.nodes.values()) node.selected = true
    const selected = this.getAllNodes()
    this.emitter.emit('node:select', { node: selected[selected.length - 1] ?? null, oldNode: null, selected })
    this.touch('select-all')
  }

  updateNode(id: string, patch: Partial<LayerTreeNode>): void {
    const node = this.nodes.get(id)
    if (!node) return
    Object.assign(node, patch)
    node.meta.modifiedAt = Date.now()
    this.emitter.emit('node:update', { node, patch })
    this.touch('update')
  }

  clear(): void {
    this.nodes.clear()
    this.rootIds = []
    this.order = []
    this.touch('clear')
  }

  toConfigs(): LayerConfig[] {
    return this.rootIds.map((id) => this.subtreeConfig(id))
  }

  subtreeConfig(id: string): LayerConfig {
    const node = this.nodes.get(id)!
    const config: LayerConfig = { ...node.config }
    config.id = node.id
    config.name = node.name
    config.type = node.type
    config.visible = node.visible
    config.opacity = node.opacity
    config.locked = node.locked
    config.expanded = node.expanded
    delete (config as Record<string, unknown>).cesiumObject
    if (node.children.length) config.children = node.children.map((childId) => this.subtreeConfig(childId))
    else delete config.children
    return config
  }

  notifyLoad(): void {
    this.emitter.emit('tree:load', { rootNodes: this.getRoots() })
    this.touch('load')
  }
}
