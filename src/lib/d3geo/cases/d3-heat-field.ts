import { contours, extent } from 'd3'
import type { D3CaseSpec } from '../types'
import { valueNoise2D } from '../data'
import { ramp } from '../palettes'
import { addPolygon, shade, type LonLat } from '../render'

const WEST = 98
const EAST = 122
const SOUTH = 22
const NORTH = 42

type ContourShape = {
  value: number
  type: string
  coordinates: number[][][][]
}

const spec: D3CaseSpec = {
  id: 'd3-heat-field',
  meta: {
    title: '三维热力场等值面',
    subtitle: 'valueNoise2D 密度场 · d3.contours 多阈值等值面',
    description: '把二维噪声密度场按多个阈值切成填充等值面，贴地叠加成可视化热力场。',
    tag: 'D3 等值线 · 热力场',
    accent: '#fb923c',
    tips: [
      'd3.contours 接收扁平化的一维值数组（长度 width×height），按阈值输出 MultiPolygon 几何',
      '网格坐标 [x,y] 按边界线性映射回经纬度后再交给 Cesium 贴地渲染',
      '阈值层级由低到高依次绘制，颜色随阈值递增，形成连续的密度分层'
    ]
  },
  defaults: {
    resolution: 56,
    thresholds: 7,
    opacity: 0.65,
    ramp: 'inferno',
    showEdges: true,
    seed: 20261006
  },
  camera: { lon: 110, lat: 32, height: 4500000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'resolution', label: '场分辨率', min: 24, max: 80, step: 4 },
    { kind: 'range', key: 'thresholds', label: '等值面层数', min: 3, max: 10, step: 1 },
    { kind: 'range', key: 'opacity', label: '面透明度', min: 0.2, max: 0.9, step: 0.05 },
    {
      kind: 'select',
      key: 'ramp',
      label: '色带',
      options: [
        { value: 'inferno', label: 'inferno' },
        { value: 'turbo', label: 'turbo' },
        { value: 'viridis', label: 'viridis' },
        { value: 'plasma', label: 'plasma' }
      ]
    },
    { kind: 'checkbox', key: 'showEdges', label: '绘制等值线描边' },
    { kind: 'range', key: 'seed', label: '噪声种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const resolution = Number(settings.resolution)
    const thresholdCount = Number(settings.thresholds)
    const alpha = Number(settings.opacity)
    const palette = String(settings.ramp)
    const showEdges = Boolean(settings.showEdges)
    const seed = Number(settings.seed)

    const width = Math.round(resolution)
    const height = Math.max(8, Math.round(width * 0.72))
    const grid = valueNoise2D(width, height, seed, 4)
    const flat = grid.flat()
    const [min, max] = extent(flat) as [number, number]
    const lo = min
    const hi = max - min < 1e-6 ? min + 1 : max

    const thresholds: number[] = []
    for (let i = 1; i <= thresholdCount; i += 1) {
      thresholds.push(lo + ((hi - lo) * i) / (thresholdCount + 1))
    }

    const shapes = contours().size([width, height]).thresholds(thresholds)(flat) as ContourShape[]
    shapes.sort((a, b) => a.value - b.value)

    let polygonCount = 0
    shapes.forEach((shape) => {
      const t = Math.min(1, Math.max(0, (shape.value - lo) / (hi - lo)))
      const color = ramp(palette, t)
      shape.coordinates.forEach((polygon) => {
        const ring = polygon[0]
        if (!ring || ring.length < 3) return
        const points: LonLat[] = ring.map((p: number[]) => {
          const lon = WEST + (p[0] / (width - 1)) * (EAST - WEST)
          const lat = NORTH - (p[1] / (height - 1)) * (NORTH - SOUTH)
          return [lon, lat]
        })
        addPolygon(ctx.dataSource, points, {
          height: 200,
          color,
          alpha,
          outline: showEdges,
          outlineColor: showEdges ? shade(color, 0.55) : undefined,
          outlineWidth: 1
        })
        polygonCount += 1
      })
    })

    ctx.legend([
      { label: palette, color: ramp(palette, 1) },
      { label: `${thresholds.length} 级等值面`, color: ramp(palette, 0.5) },
      { label: `场 ${width}×${height}`, color: ramp(palette, 0.1) }
    ])
    ctx.status(
      `噪声场 ${width}×${height}，阈值 ${lo.toFixed(2)}~${hi.toFixed(2)} 共 ${thresholds.length} 级，生成 ${polygonCount} 个等值面`
    )
  }
}

export default spec
