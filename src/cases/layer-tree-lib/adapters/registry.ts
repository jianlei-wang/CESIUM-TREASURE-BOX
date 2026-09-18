import type { AdapterContext, ILayerAdapter } from '../types'
import { LayerType } from '../types'
import { DataSourceAdapter } from './datasource'
import { EntityAdapter } from './entity'
import { GroupAdapter } from './group'
import { ImageryAdapter } from './imagery'
import { ModelAdapter } from './model'
import { ParticleAdapter } from './particle'
import { PrimitiveAdapter } from './primitive'
import { TerrainAdapter } from './terrain'
import { TilesetAdapter } from './tileset'

export type AdapterFactory = (ctx: AdapterContext) => ILayerAdapter

/**
 * 图层类型适配器注册表。
 * 支持全局注册自定义类型；控件实例也会合并 options.adapters 中的自定义适配器。
 */
export class AdapterRegistry {
  private static factories = new Map<LayerType, AdapterFactory>()

  static register(type: LayerType, factory: AdapterFactory): void {
    AdapterRegistry.factories.set(type, factory)
  }

  static unregister(type: LayerType): void {
    AdapterRegistry.factories.delete(type)
  }

  static has(type: LayerType): boolean {
    return AdapterRegistry.factories.has(type)
  }

  static get(type: LayerType): AdapterFactory | undefined {
    return AdapterRegistry.factories.get(type)
  }

  static create(type: LayerType, ctx: AdapterContext): ILayerAdapter | undefined {
    return AdapterRegistry.factories.get(type)?.(ctx)
  }

  static types(): LayerType[] {
    return [...AdapterRegistry.factories.keys()]
  }
}

AdapterRegistry.register(LayerType.GROUP, (ctx) => new GroupAdapter(ctx))
AdapterRegistry.register(LayerType.IMAGERY, (ctx) => new ImageryAdapter(ctx))
AdapterRegistry.register(LayerType.TERRAIN, (ctx) => new TerrainAdapter(ctx))
AdapterRegistry.register(LayerType.TILESET, (ctx) => new TilesetAdapter(ctx))
AdapterRegistry.register(LayerType.DATASOURCE, (ctx) => new DataSourceAdapter(ctx))
AdapterRegistry.register(LayerType.ENTITY, (ctx) => new EntityAdapter(ctx))
AdapterRegistry.register(LayerType.PRIMITIVE, (ctx) => new PrimitiveAdapter(ctx))
AdapterRegistry.register(LayerType.MODEL, (ctx) => new ModelAdapter(ctx))
AdapterRegistry.register(LayerType.PARTICLE, (ctx) => new ParticleAdapter(ctx))

export { AbstractAdapter } from './base'
export { GroupAdapter } from './group'
export { ImageryAdapter } from './imagery'
export { TerrainAdapter } from './terrain'
export { TilesetAdapter } from './tileset'
export { DataSourceAdapter } from './datasource'
export { EntityAdapter } from './entity'
export { PrimitiveAdapter } from './primitive'
export { ModelAdapter } from './model'
export { ParticleAdapter } from './particle'
