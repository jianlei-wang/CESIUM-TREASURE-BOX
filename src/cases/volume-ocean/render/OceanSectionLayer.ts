/**
 * 垂直断面图层 —— 沿 A–B 测线的距离 × 深度剖面
 *
 * 在测线两侧采样目标变量，逐顶点着色，形成可旋转查看的二维断面（贴于三维空间中）。
 * 深度使用真实米制，位于海底以下 / 缺测的节点透明。
 */

import { Primitive, PrimitiveType, type Viewer } from 'cesium'
import { oceanPaletteColorAt } from '../ocean-tsd.palette'
import { oceanVariableView } from '../ocean-tsd.config'
import type { OceanVariable } from '../ocean-tsd.types'
import { createVertexColorPrimitive, writeVertexColor } from './OceanMesh'
import { settleRender } from './ocean-render-util'
import type { OceanSceneFrame } from './OceanSceneFrame'
import type { OceanGridSampler } from '../data/OceanGridSampler'

export interface OceanSectionOptions {
  a: { lon: number; lat: number }
  b: { lon: number; lat: number }
  variable: OceanVariable
  colorRange: [number, number]
  opacity: number
}

export class OceanSectionLayer {
  private viewer: Viewer
  private frame: OceanSceneFrame
  private sampler: OceanGridSampler
  private primitive: Primitive | null = null
  private options: OceanSectionOptions
  private visible = false
  private dirty = true

  constructor(viewer: Viewer, frame: OceanSceneFrame, sampler: OceanGridSampler, options: OceanSectionOptions) {
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

  setOptions(options: OceanSectionOptions): void {
    this.options = options
    this.dirty = true
    if (this.visible) this.rebuild()
  }

  rebuild(): void {
    this.dispose()
    this.dirty = false
    const { a, b, variable, colorRange, opacity } = this.options
    const samples = Math.max(this.sampler.nx, this.sampler.ny)
    const section = this.sampler.section(a, b, variable, samples)
    const nz = section.depthM.length
    const [minV, maxV] = colorRange
    const span = maxV - minV || 1
    const palette = oceanVariableView(variable).palette
    const count = samples * nz
    const positions = new Float64Array(count * 3)
    const colors = new Uint8Array(count * 4)
    for (let i = 0; i < samples; i += 1) {
      const lon = section.lons[i]
      const lat = section.lats[i]
      const seabed = section.seabedM[i]
      for (let j = 0; j < nz; j += 1) {
        const vertex = i * nz + j
        const depth = section.depthM[j]
        this.frame.writePosition(lon, lat, depth, positions, vertex * 3)
        const value = section.values[i][j]
        if (Number.isFinite(value) && depth <= seabed) {
          const t = (value - minV) / span
          writeVertexColor(colors, vertex, oceanPaletteColorAt(palette, t), opacity)
        } else {
          writeVertexColor(colors, vertex, [40, 60, 80], 0)
        }
      }
    }
    const indices: number[] = []
    for (let i = 0; i < samples - 1; i += 1) {
      for (let j = 0; j < nz - 1; j += 1) {
        const tl = i * nz + j
        const tr = (i + 1) * nz + j
        const bl = i * nz + j + 1
        const br = (i + 1) * nz + j + 1
        indices.push(tl, tr, br)
        indices.push(tl, br, bl)
      }
    }
    const primitive = createVertexColorPrimitive(positions, colors, indices, PrimitiveType.TRIANGLES, {
      translucent: true,
      depthTest: true,
      doubleSided: true
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
