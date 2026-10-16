/**
 * 水平切片图层 —— 固定深度的平面等值着色
 *
 * 在每个网格节点按当前深度采样目标变量，逐顶点着色，形成该深度的水平分布图。
 * 位于海底以下或陆地的节点因缺测而透明。深度由分析语义（真实米制）决定。
 */

import { Primitive, PrimitiveType, type Viewer } from 'cesium'
import { oceanPaletteColorAt } from '../ocean-tsd.palette'
import { oceanVariableView } from '../ocean-tsd.config'
import type { OceanVariable } from '../ocean-tsd.types'
import { createVertexColorPrimitive, writeVertexColor } from './OceanMesh'
import { settleRender } from './ocean-render-util'
import type { OceanSceneFrame } from './OceanSceneFrame'
import type { OceanGridSampler } from '../data/OceanGridSampler'

export interface OceanSliceOptions {
  depthM: number
  variable: OceanVariable
  colorRange: [number, number]
  opacity: number
}

export class OceanSliceLayer {
  private viewer: Viewer
  private frame: OceanSceneFrame
  private sampler: OceanGridSampler
  private primitive: Primitive | null = null
  private options: OceanSliceOptions
  private visible = true
  private dirty = false

  constructor(viewer: Viewer, frame: OceanSceneFrame, sampler: OceanGridSampler, options: OceanSliceOptions) {
    this.viewer = viewer
    this.frame = frame
    this.sampler = sampler
    this.options = options
    this.rebuild()
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

  setOptions(options: OceanSliceOptions): void {
    this.options = options
    this.dirty = true
    if (this.visible) this.rebuild()
  }

  rebuild(): void {
    this.dispose()
    this.dirty = false
    const { lons, lats } = this.sampler.staticData
    const nx = lons.length
    const ny = lats.length
    const { depthM, variable, colorRange, opacity } = this.options
    const [minV, maxV] = colorRange
    const span = maxV - minV || 1
    const palette = oceanVariableView(variable).palette
    const positions = new Float64Array(nx * ny * 3)
    const colors = new Uint8Array(nx * ny * 4)
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const vertex = x + nx * y
        this.frame.writePosition(lons[x], lats[y], depthM, positions, vertex * 3)
        const value = this.sampler.variableAt(variable, lons[x], lats[y], depthM)
        if (Number.isFinite(value)) {
          const t = (value - minV) / span
          writeVertexColor(colors, vertex, oceanPaletteColorAt(palette, t), opacity)
        } else {
          writeVertexColor(colors, vertex, [40, 60, 80], 0)
        }
      }
    }
    const indices: number[] = []
    for (let y = 0; y < ny - 1; y += 1) {
      for (let x = 0; x < nx - 1; x += 1) {
        const tl = x + nx * y
        const tr = tl + 1
        const bl = tl + nx
        const br = bl + 1
        indices.push(tl, bl, br)
        indices.push(tl, br, tr)
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
