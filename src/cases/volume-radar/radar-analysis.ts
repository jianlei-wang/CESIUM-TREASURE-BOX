/**
 * 雷达分析可视化 —— 地面回波覆盖图层、平面场栅格绘制与时间演变曲线。
 *
 * 把 Worker 返回的业务栅格（回波顶高 / 柱最大值）以地面贴图方式叠加到体域底面，
 * 把时间演变统计绘制为轻量 canvas 折线图，供案例工作台直接消费，业务单位均为 km / km² / dBZ。
 */

import {
  Cartesian3,
  ConstantProperty,
  Entity,
  ImageMaterialProperty,
  Rectangle,
  RectangleGraphics,
  type Viewer
} from 'cesium'
import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'
import { radarColorAt } from '../../lib/volume-engine/palette'

export type RadarAnalysisResult = {
  grid: number
  maxDbz: number
  maxTop: number
  meanTop: number
  p95Top: number
  topGrid: Float32Array
  columnMax: Float32Array
  footprint: { area20Km2: number; area35Km2: number; area45Km2: number }
  topThreshold: number
  coreThreshold: number
  corePos: Float32Array
  corePeak: Float32Array
  coreTop: Float32Array
  coreCount: number
}

export type RadarTrendResult = {
  steps: number
  maxDbz: Float32Array
  maxTopKm: Float32Array
  area35Km2: Float32Array
}

export type GridField = 'top' | 'max'

/** 把归一化栅格绘制为 canvas：顶高场用蓝→青→白，柱最大值场用雷达分级色 */
export function renderGridCanvas(result: RadarAnalysisResult, field: GridField): HTMLCanvasElement {
  const G = result.grid
  const canvas = document.createElement('canvas')
  canvas.width = G
  canvas.height = G
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const image = ctx.createImageData(G, G)
  const topNorm = result.topGrid
  const maxField = result.columnMax
  for (let j = 0; j < G; j += 1) {
    for (let i = 0; i < G; i += 1) {
      const src = (G - 1 - j) * G + i
      const idx = (j * G + i) * 4
      if (field === 'max') {
        const dbz = maxField[src]
        const rgba = radarColorAt(dbz)
        // 弱回波做适度透明，突出强中心
        const a = dbz < 5 ? 0 : Math.min(220, 60 + dbz * 3)
        image.data[idx] = rgba[0]
        image.data[idx + 1] = rgba[1]
        image.data[idx + 2] = rgba[2]
        image.data[idx + 3] = a
      } else {
        const t = topNorm[src]
        if (t <= 0.001) {
          image.data[idx + 3] = 0
        } else {
          const k = Math.min(1, t * 4)
          image.data[idx] = Math.round(40 + 200 * k)
          image.data[idx + 1] = Math.round(120 + 130 * k)
          image.data[idx + 2] = Math.round(210 + 45 * k)
          image.data[idx + 3] = Math.round(40 + 180 * Math.min(1, t * 5))
        }
      }
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

export type GroundLayer = {
  /** 更新地面贴图（切换回波顶高 / 柱最大值） */
  update: (result: RadarAnalysisResult, field: GridField) => void
  setVisible: (visible: boolean) => void
  destroy: () => void
}

/** 在体域底面安装地面覆盖图层，返回可更新 / 卸载的句柄 */
export function installGroundLayer(engine: VolumeEngine): GroundLayer {
  const viewer = engine.getViewer() as Viewer | undefined
  if (!viewer || viewer.isDestroyed()) {
    return { update: () => undefined, setVisible: () => undefined, destroy: () => undefined }
  }
  const sw = engine.worldFromNormalized(0, 0, 0)
  const ne = engine.worldFromNormalized(1, 1, 0)
  const rect = Rectangle.fromCartesianArray([Cartesian3.clone(sw), Cartesian3.clone(ne)])
  const material = new ImageMaterialProperty({ transparent: true })
  const entity: Entity = viewer.entities.add({
    rectangle: new RectangleGraphics({
      coordinates: rect,
      material,
      height: 5
    })
  })
  let visible = true

  function update(result: RadarAnalysisResult, field: GridField): void {
    material.image = new ConstantProperty(renderGridCanvas(result, field))
    engine.requestRender()
  }
  function setVisible(next: boolean): void {
    visible = next
    entity.show = visible
    engine.requestRender()
  }
  return {
    update,
    setVisible,
    destroy: () => {
      if (viewer.isDestroyed()) return
      viewer.entities.remove(entity)
      engine.requestRender()
    }
  }
}

/** 时间演变折线图：最大 dBZ / 最高顶高 / ≥35dBZ 覆盖面积三条归一化曲线 */
export function drawTrendChart(canvas: HTMLCanvasElement, trend: RadarTrendResult): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const pad = 6
  const series = [
    { data: trend.maxDbz, color: '#ff5a3c', max: 70 },
    { data: trend.maxTopKm, color: '#5ad7ff', max: Math.max(1, ...Array.from(trend.maxTopKm)) },
    { data: trend.area35Km2, color: '#ffd21e', max: Math.max(1, ...Array.from(trend.area35Km2)) }
  ]
  // 网格
  ctx.strokeStyle = 'rgba(157,188,224,0.16)'
  ctx.lineWidth = 1
  for (let g = 0; g <= 2; g += 1) {
    const y = pad + ((h - pad * 2) * g) / 2
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(w - pad, y)
    ctx.stroke()
  }
  const n = trend.steps
  for (const s of series) {
    ctx.strokeStyle = s.color
    ctx.lineWidth = 1.8
    ctx.beginPath()
    for (let i = 0; i < n; i += 1) {
      const x = pad + ((w - pad * 2) * i) / Math.max(1, n - 1)
      const y = h - pad - ((h - pad * 2) * Math.min(1, s.data[i] / s.max))
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
}

export function formatKm(normalizedTop: number, heightM: number): string {
  return `${((normalizedTop * heightM) / 1000).toFixed(1)} km`
}
