import {
  ArcGisMapServerImageryProvider,
  GridImageryProvider,
  ImageryLayer,
  IonImageryProvider,
  OpenStreetMapImageryProvider,
  SingleTileImageryProvider,
  TileMapServiceImageryProvider,
  UrlTemplateImageryProvider,
  WebMapServiceImageryProvider,
  WebMapTileServiceImageryProvider,
  type ImageryProvider
} from 'cesium'
import { LayerType, type ContextMenuItem, type LayerConfig, type LayerTreeNode, type StyleField } from '../types'
import { AbstractAdapter } from './base'

type ProviderFactory = (options: Record<string, unknown>) => ImageryProvider | Promise<ImageryProvider>

const PROVIDERS: Record<string, ProviderFactory> = {
  UrlTemplate: (o) => new UrlTemplateImageryProvider(o as never),
  WMS: (o) => new WebMapServiceImageryProvider(o as never),
  WMTS: (o) => new WebMapTileServiceImageryProvider(o as never),
  TMS: (o) => new TileMapServiceImageryProvider(o as never),
  OSM: (o) => new OpenStreetMapImageryProvider(o as never),
  ArcGIS: (o) => new ArcGisMapServerImageryProvider(o as never),
  SingleTile: (o) => new SingleTileImageryProvider(o as never),
  Grid: () => new GridImageryProvider({}),
  Ion: (o) => IonImageryProvider.fromAssetId(Number(o.assetId), o as never)
}

export class ImageryAdapter extends AbstractAdapter {
  readonly type = LayerType.IMAGERY
  readonly label = '影像'
  readonly color = '#3f9dff'

  async create(config: LayerConfig): Promise<ImageryLayer> {
    const imagery = config.imagery
    if (!imagery) throw new Error(`影像图层「${config.name}」缺少 imagery 配置`)
    const factory = PROVIDERS[imagery.providerType]
    if (!factory) throw new Error(`不支持的影像服务类型：${imagery.providerType}`)
    const provider = await factory(imagery.options ?? {})
    const layer = new ImageryLayer(provider, { alpha: config.opacity ?? 1 })
    this.viewer.imageryLayers.add(layer)
    this.requestRender()
    return layer
  }

  destroy(cesiumObject: unknown): void {
    this.viewer.imageryLayers.remove(cesiumObject as ImageryLayer, true)
    this.requestRender()
  }

  setVisible(cesiumObject: unknown, visible: boolean): void {
    ;(cesiumObject as ImageryLayer).show = visible
    this.requestRender()
  }

  setOpacity(cesiumObject: unknown, opacity: number): void {
    ;(cesiumObject as ImageryLayer).alpha = opacity
    this.requestRender()
  }

  moveUp(cesiumObject: unknown): void {
    this.viewer.imageryLayers.raise(cesiumObject as ImageryLayer)
    this.requestRender()
  }

  moveDown(cesiumObject: unknown): void {
    this.viewer.imageryLayers.lower(cesiumObject as ImageryLayer)
    this.requestRender()
  }

  moveToIndex(cesiumObject: unknown, index: number): void {
    const layer = cesiumObject as ImageryLayer
    const collection = this.viewer.imageryLayers
    const current = collection.indexOf(layer)
    if (current < 0) return
    collection.remove(layer, false)
    collection.add(layer, Math.min(Math.max(index, 0), collection.length))
    this.requestRender()
  }

  getMeta(cesiumObject: unknown): Record<string, unknown> {
    const layer = cesiumObject as ImageryLayer
    return {
      影像服务: layer.imageryProvider?.constructor?.name ?? '-',
      透明度: Number(layer.alpha?.toFixed(2) ?? 1),
      显示: layer.show,
      叠加层级: this.viewer.imageryLayers.indexOf(layer)
    }
  }

  getContextMenuItems(_node: LayerTreeNode): ContextMenuItem[] {
    return [
      { id: 'opacity', label: '调整透明度', icon: 'opacity' },
      { id: 'd-imagery', divider: true },
      { id: 'raise', label: '上移一层', icon: 'up' },
      { id: 'lower', label: '下移一层', icon: 'down' },
      { id: 'toTop', label: '置于顶层', icon: 'top' },
      { id: 'toBottom', label: '置于底层', icon: 'bottom' }
    ]
  }

  getStyleFields(cesiumObject: unknown): StyleField[] {
    const layer = cesiumObject as ImageryLayer | null
    if (!layer) return []
    return [
      { key: 'alpha', label: '透明度', type: 'number', min: 0, max: 1, step: 0.01, value: Number(layer.alpha ?? 1) },
      { key: 'brightness', label: '亮度', type: 'number', min: 0, max: 3, step: 0.1, value: Number(layer.brightness ?? 1) },
      { key: 'contrast', label: '对比度', type: 'number', min: 0, max: 3, step: 0.1, value: Number(layer.contrast ?? 1) },
      { key: 'saturation', label: '饱和度', type: 'number', min: 0, max: 3, step: 0.1, value: Number(layer.saturation ?? 1) },
      { key: 'hue', label: '色调', type: 'number', min: 0, max: 1, step: 0.01, value: Number(layer.hue ?? 0) },
      { key: 'gamma', label: '伽马校正', type: 'number', min: 0.1, max: 5, step: 0.1, value: Number(layer.gamma ?? 1) }
    ]
  }

  applyStyle(cesiumObject: unknown, _node: LayerTreeNode, values: Record<string, unknown>): void {
    const layer = cesiumObject as ImageryLayer
    if (!layer) return
    if (values.brightness !== undefined) layer.brightness = Number(values.brightness)
    if (values.contrast !== undefined) layer.contrast = Number(values.contrast)
    if (values.saturation !== undefined) layer.saturation = Number(values.saturation)
    if (values.hue !== undefined) layer.hue = Number(values.hue)
    if (values.gamma !== undefined) layer.gamma = Number(values.gamma)
    this.requestRender()
  }

  async flyTo(cesiumObject: unknown): Promise<void> {
    const layer = cesiumObject as ImageryLayer | null
    if (!layer) return
    await this.viewer.flyTo(layer, { duration: 1.2 })
  }
}
