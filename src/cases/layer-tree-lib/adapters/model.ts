import { Cartesian3, Cartographic, Color, HeadingPitchRoll, Model, Transforms } from 'cesium'
import { LayerType, type ContextMenuItem, type LayerConfig, type LayerTreeNode, type StyleField } from '../types'
import { AbstractAdapter } from './base'

interface ModelOptions {
  lon?: number
  lat?: number
  height?: number
  heading?: number
  pitch?: number
  roll?: number
  scale?: number
  minimumPixelSize?: number
  show?: boolean
  [key: string]: unknown
}

export class ModelAdapter extends AbstractAdapter {
  readonly type = LayerType.MODEL
  readonly label = '模型'
  readonly color = '#7f8cff'

  async create(config: LayerConfig): Promise<Model> {
    const modelConfig = config.model
    if (!modelConfig) throw new Error(`模型图层「${config.name}」缺少 model 配置`)
    const { lon, lat, height = 0, heading = 0, pitch = 0, roll = 0, ...rest } = (modelConfig.options ?? {}) as ModelOptions
    const model = await Model.fromGltfAsync({ url: modelConfig.url, ...rest } as never)
    if (lon !== undefined && lat !== undefined) {
      const hpr = HeadingPitchRoll.fromDegrees(heading, pitch, roll)
      const position = Cartesian3.fromDegrees(lon, lat, height)
      model.modelMatrix = Transforms.headingPitchRollToFixedFrame(position, hpr)
    }
    this.viewer.scene.primitives.add(model)
    this.requestRender()
    return model
  }

  destroy(cesiumObject: unknown): void {
    const model = cesiumObject as Model | null
    if (!model) return
    this.viewer.scene.primitives.remove(model)
    this.requestRender()
  }

  setVisible(cesiumObject: unknown, visible: boolean): void {
    ;(cesiumObject as Model).show = visible
    this.requestRender()
  }

  setOpacity(cesiumObject: unknown, opacity: number): void {
    const model = cesiumObject as Model
    model.color = Color.WHITE.withAlpha(opacity, new Color())
    this.requestRender()
  }

  getMeta(cesiumObject: unknown): Record<string, unknown> {
    const model = cesiumObject as Model | null
    if (!model) return {}
    const center = Cartographic.fromCartesian(model.boundingSphere.center)
    return {
      中心经度: ((center.longitude * 180) / Math.PI).toFixed(5),
      中心纬度: ((center.latitude * 180) / Math.PI).toFixed(5),
      包围球半径: Math.round(model.boundingSphere.radius),
      显示: model.show
    }
  }

  async flyTo(cesiumObject: unknown): Promise<void> {
    const model = cesiumObject as Model | null
    if (!model) return
    this.viewer.camera.flyToBoundingSphere(model.boundingSphere, { duration: 1.2 })
  }

  getStyleFields(cesiumObject: unknown): StyleField[] {
    const model = cesiumObject as Model | null
    if (!model) return []
    const color = model.color ?? Color.WHITE
    return [
      { key: 'color', label: '颜色', type: 'color', value: color.toCssHexString() },
      { key: 'alpha', label: '透明度', type: 'number', min: 0, max: 1, step: 0.01, value: Number(color.alpha ?? 1) },
      { key: 'scale', label: '缩放', type: 'number', min: 0.1, max: 100, step: 0.1, value: Number(model.scale ?? 1) },
      { key: 'minimumPixelSize', label: '最小像素', type: 'number', min: 0, max: 2048, step: 8, value: Number(model.minimumPixelSize ?? 0) }
    ]
  }

  applyStyle(cesiumObject: unknown, _node: LayerTreeNode, values: Record<string, unknown>): void {
    const model = cesiumObject as Model
    if (!model) return
    if (values.color !== undefined || values.alpha !== undefined) {
      const base = values.color !== undefined ? Color.fromCssColorString(String(values.color)) : model.color ?? Color.WHITE
      const alpha = values.alpha !== undefined ? Number(values.alpha) : base.alpha
      model.color = base.withAlpha(Number.isFinite(alpha) ? alpha : 1, new Color())
    }
    if (values.scale !== undefined) model.scale = Number(values.scale)
    if (values.minimumPixelSize !== undefined) model.minimumPixelSize = Number(values.minimumPixelSize)
    this.requestRender()
  }

  getContextMenuItems(_node: LayerTreeNode): ContextMenuItem[] {
    return [
      { id: 'opacity', label: '调整透明度', icon: 'opacity' },
      { id: 'attributes', label: '属性查看', icon: 'info' }
    ]
  }
}
