/**
 * 等值面图层 —— 目标值的等值壳层（体素采样）
 *
 * 通过筛取与等值相差在带宽内的有效体素，用点图元勾勒该等值面的空间形态。
 * 这是对连续等值面的离散、稳健近似，避免在浏览器端构建大型三角网格。
 */

import { Color, PointPrimitiveCollection, type Viewer } from 'cesium'
import { oceanPaletteColorAt } from '../ocean-tsd.palette'
import { oceanVariableView } from '../ocean-tsd.config'
import type { OceanVariable } from '../ocean-tsd.types'
import { settleRender } from './ocean-render-util'
import type { OceanSceneFrame } from './OceanSceneFrame'
import type { OceanGridSampler } from '../data/OceanGridSampler'

export interface OceanIsosurfaceOptions {
  variable: OceanVariable
  isoValue: number
  colorRange: [number, number]
  opacity: number
  toleranceRatio: number
}

const MAX_POINTS = 40000

export class OceanIsosurfaceLayer {
  private viewer: Viewer
  private frame: OceanSceneFrame
  private sampler: OceanGridSampler
  private collection: PointPrimitiveCollection | null = null
  private options: OceanIsosurfaceOptions
  private visible = false
  private pixelSize = 4
  private dirty = true

  constructor(viewer: Viewer, frame: OceanSceneFrame, sampler: OceanGridSampler, options: OceanIsosurfaceOptions) {
    this.viewer = viewer
    this.frame = frame
    this.sampler = sampler
    this.options = options
  }

  setVisible(value: boolean): void {
    this.visible = value
    if (value && (!this.collection || this.dirty)) this.rebuild()
    if (this.collection) this.collection.show = value
    this.requestRender()
  }

  setOptions(options: OceanIsosurfaceOptions): void {
    this.options = options
    this.dirty = true
    if (this.visible) this.rebuild()
  }

  rebuild(): void {
    this.dispose()
    this.dirty = false
    const { variable, isoValue, colorRange, opacity, toleranceRatio } = this.options
    const field = this.sampler.buildField(variable)
    const { nx, ny, nz } = this.sampler
    const { lons, lats, depths } = this.sampler.staticData
    const [minV, maxV] = colorRange
    const span = maxV - minV || 1
    const band = Math.max(span * toleranceRatio, 1e-6)
    const palette = oceanVariableView(variable).palette
    const rgb = oceanPaletteColorAt(palette, (isoValue - minV) / span)

    const collected: number[] = []
    const stride = nx * ny
    for (let z = 0; z < nz; z += 1) {
      for (let y = 0; y < ny; y += 1) {
        for (let x = 0; x < nx; x += 1) {
          const value = field[x + nx * y + stride * z]
          if (Number.isFinite(value) && Math.abs(value - isoValue) <= band) {
            collected.push(x, y, z)
          }
        }
      }
    }
    const total = collected.length / 3
    const step = total > MAX_POINTS ? Math.ceil(total / MAX_POINTS) : 1

    const collection = new PointPrimitiveCollection()
    const color = new Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, opacity)
    for (let i = 0; i < total; i += step) {
      const x = collected[i * 3]
      const y = collected[i * 3 + 1]
      const z = collected[i * 3 + 2]
      collection.add({
        position: this.frame.worldPosition(lons[x], lats[y], depths[z]),
        pixelSize: this.pixelSize,
        color,
        disableDepthTestDistance: 0
      })
    }
    collection.show = this.visible
    this.viewer.scene.primitives.add(collection)
    this.collection = collection
    this.requestRender()
  }

  private requestRender(): void {
    settleRender(this.viewer)
  }

  dispose(): void {
    if (this.collection && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.collection)
    }
    this.collection = null
  }
}
