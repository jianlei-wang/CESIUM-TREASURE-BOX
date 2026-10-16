/**
 * 海底地形图层 —— 逐顶点着色的水深网格
 *
 * 直接把每个网格节点的海底深度映射为颜色，形成起伏的“水底面”，
 * 使体渲染的水体悬于真实地形之上。颜色使用案例自有的海底色带。
 */

import { Primitive, PrimitiveType, type Viewer } from 'cesium'
import { oceanPaletteColorAt } from '../ocean-tsd.palette'
import { createVertexColorPrimitive, writeVertexColor } from './OceanMesh'
import { settleRender } from './ocean-render-util'
import type { OceanSceneFrame } from './OceanSceneFrame'
import type { OceanDatasetStatic } from '../data/OceanDatasetLoader'

export class OceanBathymetryLayer {
  private viewer: Viewer
  private frame: OceanSceneFrame
  private data: OceanDatasetStatic
  private primitive: Primitive | null = null
  private visible = true
  private alpha = 0.9

  constructor(viewer: Viewer, frame: OceanSceneFrame, data: OceanDatasetStatic) {
    this.viewer = viewer
    this.frame = frame
    this.data = data
    this.rebuild()
  }

  setVisible(value: boolean): void {
    this.visible = value
    if (this.primitive) this.primitive.show = value
    this.requestRender()
  }

  setOpacity(value: number): void {
    this.alpha = value
    this.rebuild()
  }

  rebuild(): void {
    this.dispose()
    const { lons, lats, bathymetry, manifest } = this.data
    const nx = lons.length
    const ny = lats.length
    const [minD, maxD] = manifest.bathymetryRangeM
    const span = maxD - minD || 1
    const positions = new Float64Array(nx * ny * 3)
    const colors = new Uint8Array(nx * ny * 4)
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const vertex = x + nx * y
        const depth = bathymetry[vertex]
        this.frame.writePosition(lons[x], lats[y], depth, positions, vertex * 3)
        const t = (depth - minD) / span
        writeVertexColor(colors, vertex, oceanPaletteColorAt('bathymetry', t), this.alpha)
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
