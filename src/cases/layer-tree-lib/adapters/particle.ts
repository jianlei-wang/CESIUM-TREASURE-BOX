import { Cartesian3, CircleEmitter, Color, Math as CesiumMath, ParticleSystem, Transforms } from 'cesium'
import { LayerType, type ContextMenuItem, type LayerConfig, type LayerTreeNode, type StyleField } from '../types'
import { AbstractAdapter } from './base'

interface ParticleOptions {
  lon?: number
  lat?: number
  height?: number
  image?: string
  startColor?: string
  endColor?: string
  minimumParticleLife?: number
  maximumParticleLife?: number
  minimumSpeed?: number
  maximumSpeed?: number
  rate?: number
  [key: string]: unknown
}

export class ParticleAdapter extends AbstractAdapter {
  readonly type = LayerType.PARTICLE
  readonly label = '粒子'
  readonly color = '#ff9f43'

  async create(config: LayerConfig): Promise<ParticleSystem> {
    const options = (config.particle?.options ?? {}) as ParticleOptions
    const { lon = 0, lat = 0, height = 0, startColor, endColor, ...rest } = options
    const system = new ParticleSystem({
      image: rest.image,
      startColor: startColor ? Color.fromCssColorString(startColor) : Color.YELLOW,
      endColor: endColor ? Color.fromCssColorString(endColor) : Color.RED,
      minimumParticleLife: rest.minimumParticleLife ?? 1.0,
      maximumParticleLife: rest.maximumParticleLife ?? 2.0,
      minimumSpeed: rest.minimumSpeed ?? 1.0,
      maximumSpeed: rest.maximumSpeed ?? 4.0,
      rate: rest.rate ?? 5.0,
      emitter: new CircleEmitter(1.0),
      modelMatrix: Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lon, lat, height)),
      ...rest
    } as never)
    this.viewer.scene.primitives.add(system)
    this.requestRender()
    return system
  }

  destroy(cesiumObject: unknown): void {
    if (!cesiumObject) return
    this.viewer.scene.primitives.remove(cesiumObject as never)
    this.requestRender()
  }

  setVisible(cesiumObject: unknown, visible: boolean): void {
    ;(cesiumObject as ParticleSystem).show = visible
    this.requestRender()
  }

  getMeta(cesiumObject: unknown): Record<string, unknown> {
    const system = cesiumObject as ParticleSystem | null
    const count = (system as unknown as { lengthOfArray?: number } | null)?.lengthOfArray ?? 0
    return { 粒子数量: count, 显示: system?.show }
  }

  getStyleFields(cesiumObject: unknown): StyleField[] {
    const system = cesiumObject as ParticleSystem | null
    if (!system) return []
    return [
      { key: 'startColor', label: '起始颜色', type: 'color', value: (system.startColor ?? Color.YELLOW).toCssHexString() },
      { key: 'endColor', label: '结束颜色', type: 'color', value: (system.endColor ?? Color.RED).toCssHexString() },
      { key: 'minimumSpeed', label: '最小速度', type: 'number', min: 0, max: 400, step: 1, value: Number(system.minimumSpeed ?? 1) },
      { key: 'maximumSpeed', label: '最大速度', type: 'number', min: 0, max: 800, step: 1, value: Number(system.maximumSpeed ?? 4) },
      { key: 'minimumParticleLife', label: '最短寿命', type: 'number', min: 0.1, max: 20, step: 0.1, value: Number(system.minimumParticleLife ?? 1) },
      { key: 'maximumParticleLife', label: '最长寿命', type: 'number', min: 0.1, max: 40, step: 0.1, value: Number(system.maximumParticleLife ?? 2) }
    ]
  }

  applyStyle(cesiumObject: unknown, node: LayerTreeNode, values: Record<string, unknown>): void {
    const system = cesiumObject as ParticleSystem
    if (!system) return
    if (values.startColor !== undefined) system.startColor = Color.fromCssColorString(String(values.startColor))
    if (values.endColor !== undefined) system.endColor = Color.fromCssColorString(String(values.endColor))
    if (values.minimumSpeed !== undefined) system.minimumSpeed = Number(values.minimumSpeed)
    if (values.maximumSpeed !== undefined) system.maximumSpeed = Number(values.maximumSpeed)
    if (values.minimumParticleLife !== undefined) system.minimumParticleLife = Number(values.minimumParticleLife)
    if (values.maximumParticleLife !== undefined) system.maximumParticleLife = Number(values.maximumParticleLife)
    node.config.particle = { ...node.config.particle, options: { ...(node.config.particle?.options ?? {}), ...values } }
    this.requestRender()
  }

  async flyTo(cesiumObject: unknown, node: LayerTreeNode): Promise<void> {
    if (!cesiumObject) return
    const options = (node.config.particle?.options ?? {}) as ParticleOptions
    this.viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(Number(options.lon ?? 0), Number(options.lat ?? 0), Number(options.height ?? 0) + 4000),
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-45), roll: 0 },
      duration: 1.2
    })
  }

  getContextMenuItems(_node: LayerTreeNode): ContextMenuItem[] {
    return [
      { id: 'attributes', label: '属性查看', icon: 'info' },
      { id: 'reload', label: '重新加载', icon: 'refresh' }
    ]
  }
}
