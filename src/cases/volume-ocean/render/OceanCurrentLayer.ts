/**
 * 流场箭头图层 —— 指定深度的水平流速矢量
 *
 * 在选定深度上按抽稀步长采样 u/v 分量，绘制带方向的比例线段，颜色表示流速大小。
 * 箭头长度相对于网格间距做归一化，只用于表达方向与相对强弱。
 */

import { Primitive, PrimitiveType, type Viewer } from 'cesium'
import { oceanPaletteColorAt } from '../ocean-tsd.palette'
import { createVertexColorPrimitive } from './OceanMesh'
import { settleRender } from './ocean-render-util'
import type { OceanSceneFrame } from './OceanSceneFrame'
import type { OceanGridSampler } from '../data/OceanGridSampler'

export interface OceanCurrentOptions {
  depthM: number
  stride: number
  colorRange: [number, number]
  opacity: number
}

export class OceanCurrentLayer {
  private viewer: Viewer
  private frame: OceanSceneFrame
  private sampler: OceanGridSampler
  private primitive: Primitive | null = null
  private options: OceanCurrentOptions
  private visible = false
  private dirty = true

  constructor(viewer: Viewer, frame: OceanSceneFrame, sampler: OceanGridSampler, options: OceanCurrentOptions) {
    this.viewer = viewer
    this.frame = frame
    this.sampler = sampler
    this.options = options
  }

  setVisible(value: boolean): void {
    this.visible = value
    if (value && (!this.primitive || this.dirty)) {
      this.rebuild()
    } else if (this.primitive) {
      this.primitive.show = value
    }
    this.requestRender()
  }

  setOptions(options: OceanCurrentOptions): void {
    this.options = options
    this.dirty = true
    if (this.visible) this.rebuild()
  }

  rebuild(): void {
    this.dispose()
    this.dirty = false
    const { depthM, stride, colorRange, opacity } = this.options
    const { lons, lats } = this.sampler.staticData
    const nx = lons.length
    const ny = lats.length
    const [minV, maxV] = colorRange
    const span = maxV - minV || 1
    const baseLen = this.frame.horizontalScaleM / Math.max(1, Math.min(nx, ny) - 1)
    const step = Math.max(1, stride)

    const positions: number[] = []
    const colors: number[] = []
    for (let y = 0; y < ny; y += step) {
      const lat = lats[y]
      for (let x = 0; x < nx; x += step) {
        const lon = lons[x]
        const u = this.sampler.storedAt('u', lon, lat, depthM)
        const v = this.sampler.storedAt('v', lon, lat, depthM)
        if (!Number.isFinite(u) || !Number.isFinite(v)) continue
        const speed = Math.hypot(u, v)
        if (speed < 1e-6) continue
        const dirLon = u / speed
        const dirLat = v / speed
        const meters = Math.min(baseLen, speed * baseLen * 3 + baseLen * 0.15)
        const dLon = meterToLon(meters * dirLon, lat)
        const dLat = meterToLat(meters * dirLat)
        const start = this.frame.worldPosition(lon, lat, depthM)
        const end = this.frame.worldPosition(lon + dLon, lat + dLat, depthM)
        positions.push(start.x, start.y, start.z, end.x, end.y, end.z)
        const t = (speed - minV) / span
        const rgb = oceanPaletteColorAt('current', t)
        for (let k = 0; k < 2; k += 1) {
          colors.push(rgb[0], rgb[1], rgb[2], Math.round(opacity * 255))
        }
      }
    }
    if (positions.length === 0) {
      this.requestRender()
      return
    }
    const posArray = new Float64Array(positions)
    const colorArray = new Uint8Array(colors)
    const indices: number[] = []
    for (let i = 0; i < posArray.length / 3; i += 1) indices.push(i)
    const primitive = createVertexColorPrimitive(posArray, colorArray, indices, PrimitiveType.LINES, {
      translucent: true,
      depthTest: true
    })
    primitive.show = this.visible
    this.viewer.scene.primitives.add(primitive)
    this.primitive = primitive
    this.requestRender()
  }

  private requestRender(): void {
    settleRender(this.viewer)
  }

  dispose(): void {
    if (this.primitive && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.primitive)
    }
    this.primitive = null
  }
}

function meterToLon(meters: number, lat: number): number {
  return meters / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)))
}

function meterToLat(meters: number): number {
  return meters / 110540
}
