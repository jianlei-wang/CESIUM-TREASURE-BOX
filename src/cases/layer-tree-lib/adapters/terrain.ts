import {
  ArcGISTiledElevationTerrainProvider,
  CesiumTerrainProvider,
  EllipsoidTerrainProvider,
  createWorldTerrainAsync,
  type TerrainProvider
} from 'cesium'
import { LayerType, type ContextMenuItem, type LayerConfig, type LayerTreeNode, type StyleField } from '../types'
import { AbstractAdapter } from './base'

interface TerrainHandle {
  provider: TerrainProvider
  kind: string
}

type TerrainFactory = (options: Record<string, unknown>) => TerrainProvider | Promise<TerrainProvider>

const TERRAIN_PROVIDERS: Record<string, TerrainFactory> = {
  ellipsoid: () => new EllipsoidTerrainProvider(),
  world: (o) => createWorldTerrainAsync(o as never),
  cesium: (o) => CesiumTerrainProvider.fromUrl(String(o.url ?? ''), o as never),
  arcgis: (o) => ArcGISTiledElevationTerrainProvider.fromUrl(String(o.url ?? ''), o as never)
}

export class TerrainAdapter extends AbstractAdapter {
  readonly type = LayerType.TERRAIN
  readonly label = '地形'
  readonly color = '#f2a33c'

  async create(config: LayerConfig): Promise<TerrainHandle> {
    const terrain = config.terrain
    if (!terrain) throw new Error(`地形图层「${config.name}」缺少 terrain 配置`)
    const factory = TERRAIN_PROVIDERS[terrain.providerType]
    if (!factory) throw new Error(`不支持的地形类型：${terrain.providerType}`)
    const provider = await factory(terrain.options ?? {})
    const handle: TerrainHandle = { provider, kind: terrain.providerType }
    if (config.visible ?? true) this.viewer.terrainProvider = provider
    this.requestRender()
    return handle
  }

  destroy(cesiumObject: unknown): void {
    if (!this.viewerAlive) return
    const handle = cesiumObject as TerrainHandle
    if (this.viewer.terrainProvider === handle?.provider) {
      this.viewer.terrainProvider = new EllipsoidTerrainProvider()
    }
    this.requestRender()
  }

  setVisible(cesiumObject: unknown, visible: boolean): void {
    if (!this.viewerAlive) return
    const handle = cesiumObject as TerrainHandle | null
    if (!handle) return
    if (visible) {
      this.viewer.terrainProvider = handle.provider
    } else if (this.viewer.terrainProvider === handle.provider) {
      this.viewer.terrainProvider = new EllipsoidTerrainProvider()
    }
    this.requestRender()
  }

  getMeta(cesiumObject: unknown): Record<string, unknown> {
    const handle = cesiumObject as TerrainHandle | null
    return { 地形类型: handle?.kind ?? '-', 当前激活: this.viewer.terrainProvider === handle?.provider }
  }

  getStyleFields(): StyleField[] {
    const scene = this.viewer.scene as unknown as { verticalExaggeration: number }
    return [
      {
        key: 'exaggeration',
        label: '地形夸张',
        type: 'number',
        min: 1,
        max: 10,
        step: 0.1,
        value: Number(scene.verticalExaggeration ?? 1),
        hint: '作用于整个场景'
      }
    ]
  }

  applyStyle(_cesiumObject: unknown, _node: LayerTreeNode, values: Record<string, unknown>): void {
    if (values.exaggeration !== undefined) {
      const scene = this.viewer.scene as unknown as { verticalExaggeration: number }
      scene.verticalExaggeration = Number(values.exaggeration)
    }
    this.requestRender()
  }

  getContextMenuItems(_node: LayerTreeNode): ContextMenuItem[] {
    return [
      { id: 'activateTerrain', label: '设为当前地形', icon: 'terrain' },
      { id: 'd-terrain', divider: true },
      { id: 'terrainExaggeration', label: '地形夸张', icon: 'scale' },
      { id: 'terrainWater', label: '开启水面效果', icon: 'water' }
    ]
  }
}
