export type LayerKind = 'imagery' | 'terrain' | 'tileset' | 'geojson' | 'gltf' | 'effect' | 'overlay' | 'custom'

export interface LayerDescriptor {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  locked?: boolean
  order?: number
  uri?: string
  metadata?: Record<string, unknown>
}

export interface LayerAdapter {
  readonly id: string
  mount(): Promise<void> | void
  unmount(): Promise<void> | void
  setVisible(visible: boolean): void
  setOpacity?(opacity: number): void
  diagnostics?(): Record<string, unknown>
}

export interface LayerHandle {
  descriptor: LayerDescriptor
  adapter: LayerAdapter
}

export class LayerRegistry {
  private layers = new Map<string, LayerHandle>()
  private disposed = false

  register(descriptor: LayerDescriptor, adapter: LayerAdapter): void {
    if (this.disposed) throw new Error('图层注册表已销毁')
    if (this.layers.has(descriptor.id)) throw new Error(`图层 ${descriptor.id} 已注册`)
    this.layers.set(descriptor.id, { descriptor: { ...descriptor }, adapter })
  }

  async mount(id: string): Promise<void> {
    const handle = this.layers.get(id)
    if (!handle) throw new Error(`未找到图层 ${id}`)
    await handle.adapter.mount()
    handle.adapter.setVisible(handle.descriptor.visible)
  }

  async mountAll(): Promise<void> {
    for (const id of this.layers.keys()) {
      await this.mount(id)
    }
  }

  setVisible(id: string, visible: boolean): void {
    const handle = this.layers.get(id)
    if (!handle) return
    handle.descriptor.visible = visible
    handle.adapter.setVisible(visible)
  }

  setOpacity(id: string, opacity: number): void {
    const handle = this.layers.get(id)
    if (!handle) return
    handle.adapter.setOpacity?.(opacity)
  }

  list(): LayerDescriptor[] {
    return [...this.layers.values()]
      .map((handle) => ({ ...handle.descriptor }))
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
  }

  async unregister(id: string): Promise<void> {
    const handle = this.layers.get(id)
    if (!handle) return
    this.layers.delete(id)
    await handle.adapter.unmount()
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const ids = [...this.layers.keys()].reverse()
    for (const id of ids) {
      try {
        await this.unregister(id)
      } catch {
        /* 单个图层卸载失败不阻塞其余资源回收 */
      }
    }
  }
}
