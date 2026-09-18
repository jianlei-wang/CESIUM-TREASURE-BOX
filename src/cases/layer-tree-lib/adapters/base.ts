import type { AdapterContext, ILayerAdapter, LayerConfig } from '../types'
import { LayerType } from '../types'

/** 适配器公共基类：持有 viewer 上下文并提供少量通用能力。 */
export abstract class AbstractAdapter implements ILayerAdapter {
  abstract readonly type: LayerType
  abstract readonly label: string
  abstract readonly color: string

  protected readonly ctx: AdapterContext

  constructor(ctx: AdapterContext) {
    this.ctx = ctx
  }

  protected get viewer() {
    return this.ctx.viewer
  }

  /** viewer 是否仍然可用，避免组件销毁后访问已销毁实例的场景对象。 */
  protected get viewerAlive(): boolean {
    return !!this.ctx.viewer && !this.ctx.viewer.isDestroyed()
  }

  protected requestRender(): void {
    this.ctx.requestRender()
  }

  abstract create(config: LayerConfig): Promise<unknown>
  abstract destroy(cesiumObject: unknown): void
  abstract setVisible(cesiumObject: unknown, visible: boolean): void

  getExtent(_cesiumObject: unknown): [number, number, number, number] | null {
    return null
  }
}
