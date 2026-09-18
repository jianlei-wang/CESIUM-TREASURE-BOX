import { Cartographic, Cesium3DTileStyle, Cesium3DTileset } from 'cesium'
import { LayerType, type ContextMenuItem, type LayerConfig, type LayerTreeNode, type StyleField } from '../types'
import { AbstractAdapter } from './base'

export class TilesetAdapter extends AbstractAdapter {
  readonly type = LayerType.TILESET
  readonly label = '3D Tiles'
  readonly color = '#9b7bff'

  async create(config: LayerConfig): Promise<Cesium3DTileset> {
    const tilesetConfig = config.tileset
    if (!tilesetConfig) throw new Error(`3D Tiles 图层「${config.name}」缺少 tileset 配置`)
    const tileset = tilesetConfig.ionAssetId !== undefined
      ? await Cesium3DTileset.fromIonAssetId(tilesetConfig.ionAssetId, tilesetConfig.options as never)
      : await Cesium3DTileset.fromUrl(String(tilesetConfig.url ?? ''), tilesetConfig.options as never)
    if (tilesetConfig.style) tileset.style = new Cesium3DTileStyle(tilesetConfig.style as never)
    this.viewer.scene.primitives.add(tileset)
    this.requestRender()
    return tileset
  }

  destroy(cesiumObject: unknown): void {
    const tileset = cesiumObject as Cesium3DTileset | null
    if (!tileset) return
    this.viewer.scene.primitives.remove(tileset)
    this.requestRender()
  }

  setVisible(cesiumObject: unknown, visible: boolean): void {
    const tileset = cesiumObject as Cesium3DTileset
    tileset.show = visible
    this.requestRender()
  }

  setOpacity(cesiumObject: unknown, opacity: number): void {
    const tileset = cesiumObject as Cesium3DTileset
    if (opacity >= 0.999) {
      tileset.style = undefined
    } else {
      tileset.style = new Cesium3DTileStyle({ color: `color('white', ${opacity.toFixed(3)})` })
    }
    this.requestRender()
  }

  moveUp(cesiumObject: unknown): void {
    this.viewer.scene.primitives.raise(cesiumObject as never)
    this.requestRender()
  }

  moveDown(cesiumObject: unknown): void {
    this.viewer.scene.primitives.lower(cesiumObject as never)
    this.requestRender()
  }

  getMeta(cesiumObject: unknown): Record<string, unknown> {
    const tileset = cesiumObject as Cesium3DTileset | null
    if (!tileset) return {}
    const center = Cartographic.fromCartesian(tileset.boundingSphere.center)
    return {
      中心经度: ((center.longitude * 180) / Math.PI).toFixed(5),
      中心纬度: ((center.latitude * 180) / Math.PI).toFixed(5),
      包围球半径: Math.round(tileset.boundingSphere.radius),
      屏幕空间误差: tileset.maximumScreenSpaceError,
      瓦片总数:
        (tileset.statistics as unknown as { numberOfTilesTotal?: number } | null)?.numberOfTilesTotal ?? 0,
      显示: tileset.show
    }
  }

  async flyTo(cesiumObject: unknown): Promise<void> {
    const tileset = cesiumObject as Cesium3DTileset | null
    if (!tileset) return
    await this.viewer.flyTo(tileset, { duration: 1.2 })
  }

  getContextMenuItems(_node: LayerTreeNode): ContextMenuItem[] {
    return [
      { id: 'opacity', label: '调整透明度', icon: 'opacity' },
      { id: 'reload', label: '重新加载', icon: 'refresh' },
      { id: 'd-tileset', divider: true },
      { id: 'attributes', label: '属性查看', icon: 'info' }
    ]
  }

  getStyleFields(cesiumObject: unknown, node: LayerTreeNode): StyleField[] {
    const tileset = cesiumObject as Cesium3DTileset | null
    if (!tileset) return []
    return [
      { key: 'alpha', label: '透明度', type: 'number', min: 0, max: 1, step: 0.01, value: Number(node.opacity ?? 1) },
      {
        key: 'maximumScreenSpaceError',
        label: '屏幕空间误差',
        type: 'number',
        min: 1,
        max: 64,
        step: 1,
        value: Number(tileset.maximumScreenSpaceError ?? 16)
      },
      { key: 'showOutlines', label: '显示包围盒轮廓', type: 'boolean', value: Boolean(tileset.showOutline) }
    ]
  }

  applyStyle(cesiumObject: unknown, _node: LayerTreeNode, values: Record<string, unknown>): void {
    const tileset = cesiumObject as Cesium3DTileset
    if (!tileset) return
    if (values.maximumScreenSpaceError !== undefined) tileset.maximumScreenSpaceError = Number(values.maximumScreenSpaceError)
    if (values.showOutlines !== undefined) tileset.showOutline = Boolean(values.showOutlines)
    this.requestRender()
  }
}
