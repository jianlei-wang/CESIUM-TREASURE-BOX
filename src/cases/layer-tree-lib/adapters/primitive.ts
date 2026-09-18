import {
  BillboardCollection,
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  HeadingPitchRange,
  HorizontalOrigin,
  LabelCollection,
  LabelStyle,
  Math as CesiumMath,
  NearFarScalar,
  PerInstanceColorAppearance,
  PointPrimitiveCollection,
  Primitive,
  VerticalOrigin,
  WallGeometry
} from 'cesium'
import { LayerType, type ContextMenuItem, type LayerConfig, type LayerTreeNode, type StyleField } from '../types'
import { AbstractAdapter } from './base'

interface PrimitiveOptions {
  color?: string
  pixelSize?: number
  width?: number
  height?: number
  scale?: number
  minimumHeights?: number[]
  maximumHeights?: number[]
  positions?: number[]
  lon?: number
  lat?: number
  altitude?: number
  text?: string
  font?: string
  image?: string
  cesiumObject?: unknown
}

function toNumbers(value: unknown): number[] {
  return Array.isArray(value) ? value.map((item) => Number(item)) : []
}

export class PrimitiveAdapter extends AbstractAdapter {
  readonly type = LayerType.PRIMITIVE
  readonly label = '图元'
  readonly color = '#22b8c9'

  async create(config: LayerConfig): Promise<unknown> {
    const primitiveConfig = config.primitive
    if (!primitiveConfig) throw new Error(`图元图层「${config.name}」缺少 primitive 配置`)
    const options = (primitiveConfig.options ?? {}) as PrimitiveOptions
    if (options.cesiumObject) {
      this.viewer.scene.primitives.add(options.cesiumObject as never)
      this.requestRender()
      return options.cesiumObject
    }
    const color = Color.fromCssColorString(options.color ?? '#3fd0ff')
    let object: unknown
    switch (primitiveConfig.primitiveType) {
      case 'wall': {
        const positions = Cartesian3.fromDegreesArrayHeights(toNumbers(options.positions))
        const geometry = new WallGeometry({
          positions,
          minimumHeights: options.minimumHeights,
          maximumHeights: options.maximumHeights,
          vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT
        })
        const instance = new GeometryInstance({
          geometry,
          attributes: { color: ColorGeometryInstanceAttribute.fromColor(color) }
        })
        object = new Primitive({
          geometryInstances: instance,
          appearance: new PerInstanceColorAppearance({ translucent: color.alpha < 1, closed: false })
        })
        break
      }
      case 'point': {
        const collection = new PointPrimitiveCollection()
        collection.add({
          position: Cartesian3.fromDegrees(options.lon ?? 0, options.lat ?? 0, options.altitude ?? 0),
          color,
          pixelSize: options.pixelSize ?? 10
        })
        object = collection
        break
      }
      case 'billboard': {
        const collection = new BillboardCollection()
        collection.add({
          position: Cartesian3.fromDegrees(options.lon ?? 0, options.lat ?? 0, options.altitude ?? 0),
          image: options.image ?? '',
          scale: options.scale ?? 1,
          verticalOrigin: VerticalOrigin.BOTTOM
        })
        object = collection
        break
      }
      case 'label': {
        const collection = new LabelCollection()
        collection.add({
          position: Cartesian3.fromDegrees(options.lon ?? 0, options.lat ?? 0, options.altitude ?? 0),
          text: options.text ?? config.name,
          font: options.font ?? '14px sans-serif',
          fillColor: color,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 2,
          outlineColor: Color.BLACK,
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(0, options.height ?? -18),
          scaleByDistance: new NearFarScalar(1.0e3, 1.0, 6.0e6, 0.4)
        })
        object = collection
        break
      }
      default:
        throw new Error(`不支持的图元类型：${primitiveConfig.primitiveType}`)
    }
    this.viewer.scene.primitives.add(object as never)
    this.requestRender()
    return object
  }

  destroy(cesiumObject: unknown): void {
    if (!cesiumObject) return
    this.viewer.scene.primitives.remove(cesiumObject as never)
    this.requestRender()
  }

  setVisible(cesiumObject: unknown, visible: boolean): void {
    ;(cesiumObject as { show: boolean }).show = visible
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

  async flyTo(cesiumObject: unknown, node: LayerTreeNode): Promise<void> {
    if (!cesiumObject) return
    const primitiveConfig = node.config.primitive
    const options = (primitiveConfig?.options ?? {}) as PrimitiveOptions
    if (primitiveConfig?.primitiveType === 'wall') {
      const positions = Cartesian3.fromDegreesArrayHeights(toNumbers(options.positions))
      if (positions.length) {
        const sphere = BoundingSphere.fromPoints(positions)
        this.viewer.camera.flyToBoundingSphere(sphere, {
          duration: 1.2,
          offset: new HeadingPitchRange(0, CesiumMath.toRadians(-45), sphere.radius * 2.2)
        })
        return
      }
    }
    const lon = Number(options.lon ?? 0)
    const lat = Number(options.lat ?? 0)
    const height = Number(options.altitude ?? options.height ?? 0)
    this.viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(lon, lat, height + 4000),
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-45), roll: 0 },
      duration: 1.2
    })
  }

  getStyleFields(_cesiumObject: unknown, node: LayerTreeNode): StyleField[] {
    const options = (node.config.primitive?.options ?? {}) as PrimitiveOptions
    switch (node.config.primitive?.primitiveType) {
      case 'point':
        return [
          { key: 'pixelSize', label: '点大小', type: 'number', min: 1, max: 64, step: 1, value: Number(options.pixelSize ?? 10) },
          { key: 'color', label: '颜色', type: 'color', value: String(options.color ?? '#3fd0ff') }
        ]
      case 'label':
        return [
          { key: 'text', label: '文本', type: 'text', value: String(options.text ?? node.name) },
          { key: 'font', label: '字体', type: 'text', value: String(options.font ?? '14px sans-serif') },
          { key: 'color', label: '颜色', type: 'color', value: String(options.color ?? '#3fd0ff') }
        ]
      case 'billboard':
        return [
          { key: 'image', label: '图片 URL', type: 'text', value: String(options.image ?? '') },
          { key: 'scale', label: '缩放', type: 'number', min: 0.1, max: 10, step: 0.1, value: Number(options.scale ?? 1) }
        ]
      default:
        return []
    }
  }

  applyStyle(cesiumObject: unknown, node: LayerTreeNode, values: Record<string, unknown>): void {
    const collection = cesiumObject as { get?: (index: number) => unknown } | null
    const first = collection?.get?.(0) as Record<string, unknown> | undefined
    if (!first) return
    const type = node.config.primitive?.primitiveType
    if (type === 'point') {
      if (values.pixelSize !== undefined) (first as unknown as { pixelSize: number }).pixelSize = Number(values.pixelSize)
      if (values.color !== undefined) (first as unknown as { color: Color }).color = Color.fromCssColorString(String(values.color))
    } else if (type === 'label') {
      if (values.text !== undefined) (first as unknown as { text: string }).text = String(values.text)
      if (values.font !== undefined) (first as unknown as { font: string }).font = String(values.font)
      if (values.color !== undefined) (first as unknown as { fillColor: Color }).fillColor = Color.fromCssColorString(String(values.color))
    } else if (type === 'billboard') {
      if (values.image !== undefined) (first as unknown as { image: string }).image = String(values.image)
      if (values.scale !== undefined) (first as unknown as { scale: number }).scale = Number(values.scale)
    }
    node.config.primitive = {
      primitiveType: String(type ?? ''),
      options: { ...(node.config.primitive?.options ?? {}), ...values }
    }
    this.requestRender()
  }

  getContextMenuItems(_node: LayerTreeNode): ContextMenuItem[] {
    return [
      { id: 'attributes', label: '编辑几何体', icon: 'edit' },
      { id: 'reload', label: '重新加载', icon: 'refresh' }
    ]
  }
}
