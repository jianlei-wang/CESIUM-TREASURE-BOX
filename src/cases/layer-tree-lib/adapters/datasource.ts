import { CzmlDataSource, CustomDataSource, GeoJsonDataSource, KmlDataSource, type DataSource } from 'cesium'
import { LayerType, type ContextMenuItem, type LayerConfig, type LayerTreeNode } from '../types'
import { AbstractAdapter } from './base'

export class DataSourceAdapter extends AbstractAdapter {
  readonly type = LayerType.DATASOURCE
  readonly label = '数据源'
  readonly color = '#2fbf87'

  async create(config: LayerConfig): Promise<DataSource> {
    const ds = config.datasource
    if (!ds) throw new Error(`数据源图层「${config.name}」缺少 datasource 配置`)
    const options = ds.options ?? {}
    let source: DataSource
    switch (ds.format) {
      case 'geojson':
        source = await GeoJsonDataSource.load((ds.url ?? ds.data) as never, options as never)
        break
      case 'kml':
        source = await KmlDataSource.load(ds.url as never, {
          camera: this.viewer.camera,
          canvas: this.viewer.canvas,
          ...options
        } as never)
        break
      case 'czml':
        source = await CzmlDataSource.load((ds.data ?? ds.url) as never, options as never)
        break
      case 'custom':
        source = new CustomDataSource(config.name)
        break
      default:
        throw new Error(`不支持的数据源格式：${String(ds.format)}`)
    }
    this.viewer.dataSources.add(source)
    this.requestRender()
    return source
  }

  destroy(cesiumObject: unknown): void {
    this.viewer.dataSources.remove(cesiumObject as DataSource, true)
    this.requestRender()
  }

  setVisible(cesiumObject: unknown, visible: boolean): void {
    ;(cesiumObject as DataSource).show = visible
    this.requestRender()
  }

  getMeta(cesiumObject: unknown): Record<string, unknown> {
    const source = cesiumObject as DataSource | null
    return {
      名称: source?.name ?? '-',
      要素数量: source?.entities?.values?.length ?? 0,
      时钟: source?.clock ? '含时间动态' : '静态',
      显示: source?.show
    }
  }

  async flyTo(cesiumObject: unknown): Promise<void> {
    const source = cesiumObject as DataSource | null
    if (!source) return
    await this.viewer.flyTo(source, { duration: 1.2 })
  }

  getContextMenuItems(_node: LayerTreeNode): ContextMenuItem[] {
    return [
      { id: 'attributes', label: '属性查看', icon: 'info' },
      { id: 'reload', label: '重新加载', icon: 'refresh' },
      { id: 'd-ds', divider: true },
      { id: 'export', label: '导出配置', icon: 'export' }
    ]
  }
}
