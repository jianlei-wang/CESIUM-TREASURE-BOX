import { Color, Entity } from 'cesium'
import { LayerType, type ContextMenuItem, type LayerConfig, type LayerTreeNode, type StyleField } from '../types'
import { AbstractAdapter } from './base'

function colorToHex(value: unknown): string {
  if (value instanceof Color) return value.toCssHexString()
  if (typeof value === 'string') {
    const parsed = Color.fromCssColorString(value)
    return parsed ? parsed.toCssHexString() : '#ffffff'
  }
  return '#ffffff'
}

export class EntityAdapter extends AbstractAdapter {
  readonly type = LayerType.ENTITY
  readonly label = '实体'
  readonly color = '#e26aa1'

  async create(config: LayerConfig): Promise<Entity> {
    if (!config.entity) throw new Error(`实体图层「${config.name}」缺少 entity 配置`)
    const entity = new Entity(config.entity as never)
    this.viewer.entities.add(entity)
    this.requestRender()
    return entity
  }

  destroy(cesiumObject: unknown): void {
    this.viewer.entities.remove(cesiumObject as Entity)
    this.requestRender()
  }

  setVisible(cesiumObject: unknown, visible: boolean): void {
    ;(cesiumObject as Entity).show = visible
    this.requestRender()
  }

  getMeta(cesiumObject: unknown): Record<string, unknown> {
    const entity = cesiumObject as Entity | null
    if (!entity) return {}
    const graphics = [
      'point',
      'billboard',
      'label',
      'model',
      'polygon',
      'polyline',
      'ellipse',
      'ellipsoid',
      'box',
      'cylinder',
      'corridor',
      'wall',
      'rectangle',
      'path',
      'plane',
      'polylineVolume'
    ].filter((key) => (entity as unknown as Record<string, unknown>)[key] !== undefined)
    return {
      ID: entity.id,
      名称: entity.name ?? '-',
      图形类型: graphics.length ? graphics.join(', ') : '-',
      显示: entity.show,
      描述: entity.description ? '含描述' : '-'
    }
  }

  async flyTo(cesiumObject: unknown): Promise<void> {
    const entity = cesiumObject as Entity | null
    if (!entity) return
    await this.viewer.flyTo(entity, { duration: 1.2 })
  }

  getStyleFields(_cesiumObject: unknown, node: LayerTreeNode): StyleField[] {
    const config = (node.config.entity ?? {}) as Record<string, Record<string, unknown>> | undefined
    if (!config) return []
    const fields: StyleField[] = []
    if (config.point) {
      fields.push({ key: 'pointPixelSize', label: '点大小', type: 'number', min: 1, max: 64, step: 1, value: Number(config.point.pixelSize ?? 10) })
      fields.push({ key: 'pointColor', label: '点颜色', type: 'color', value: colorToHex(config.point.color) })
    }
    if (config.label) {
      fields.push({ key: 'labelText', label: '标签文本', type: 'text', value: String(config.label.text ?? '') })
      fields.push({ key: 'labelFont', label: '标签字体', type: 'text', value: String(config.label.font ?? '15px sans-serif') })
      fields.push({ key: 'labelColor', label: '标签颜色', type: 'color', value: colorToHex(config.label.fillColor) })
    }
    return fields
  }

  applyStyle(cesiumObject: unknown, _node: LayerTreeNode, values: Record<string, unknown>): void {
    const entity = cesiumObject as Entity
    if (!entity) return
    if (entity.point) {
      if (values.pointPixelSize !== undefined) entity.point.pixelSize = Number(values.pointPixelSize) as never
      if (values.pointColor !== undefined) entity.point.color = Color.fromCssColorString(String(values.pointColor)) as never
    }
    if (entity.label) {
      if (values.labelText !== undefined) entity.label.text = String(values.labelText) as never
      if (values.labelFont !== undefined) entity.label.font = String(values.labelFont) as never
      if (values.labelColor !== undefined) entity.label.fillColor = Color.fromCssColorString(String(values.labelColor)) as never
    }
    this.requestRender()
  }

  getContextMenuItems(_node: LayerTreeNode): ContextMenuItem[] {
    return [
      { id: 'attributes', label: '编辑属性', icon: 'edit' },
      { id: 'description', label: '查看描述', icon: 'info' }
    ]
  }
}
