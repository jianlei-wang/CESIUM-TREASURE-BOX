import { contours, extent, range } from 'd3'
import type { D3CaseSpec } from '../types'
import { valueNoise2D } from '../data'
import { ramp } from '../palettes'
import { addPolygon, addPolyline, type LonLat } from '../render'

const W = 120
const H = 90
const BOUNDS = { west: 98, south: 22, east: 124, north: 42 }

type ContourGeometry = {
  value: number
  coordinates: Array<Array<Array<[number, number]>>>
}

const spec: D3CaseSpec = {
  id: 'd3-contour',
  meta: {
    title: '等值线 / 等值面',
    subtitle: 'valueNoise2D 值场 → d3.contours 多层阈值填充 + 等值线边框',
    description: '由二维值噪声生成连续场，按多级阈值切出等值面并叠加等值线，观察场的形态。',
    tag: 'D3 标量场 · 等值线',
    accent: '#4ade80',
    tips: [
      'd3.contours().size().thresholds() 把格网值场切成多级等值面，阈值逐级抬升形成分层填充',
      '格网像素坐标按线性映射转成经纬度，即可用 Polygon / Polyline 贴地渲染',
      '阈值数量、色带、透明度与抬升高度都可调，便于对比不同分层策略'
    ]
  },
  defaults: {
    thresholdCount: 9,
    ramp: 'turbo',
    alpha: 0.55,
    elevation: 40000,
    seed: 20261006
  },
  camera: { lon: 111, lat: 32, height: 3800000, pitch: -68 },
  controls: [
    { kind: 'range', key: 'thresholdCount', label: '阈值数量', min: 3, max: 20, step: 1 },
    {
      kind: 'select',
      key: 'ramp',
      label: '色带',
      options: [
        { value: 'turbo', label: 'turbo' },
        { value: 'viridis', label: 'viridis' },
        { value: 'inferno', label: 'inferno' },
        { value: 'spectral', label: 'spectral' }
      ]
    },
    { kind: 'range', key: 'alpha', label: '透明度', min: 0.1, max: 0.9, step: 0.05 },
    { kind: 'range', key: 'elevation', label: '抬升高度(m)', min: 0, max: 300000, step: 10000 },
    { kind: 'range', key: 'seed', label: '噪声种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const thresholdCount = Number(settings.thresholdCount)
    const palette = String(settings.ramp)
    const alpha = Number(settings.alpha)
    const elevation = Number(settings.elevation)

    const grid = valueNoise2D(W, H, Number(settings.seed), 5)
    const flat = grid.flat()
    const [lo, hi] = extent(flat) as [number, number]
    const span = hi - lo || 1
    const thresholds = range(1, thresholdCount + 1).map((k: number) => lo + (span * k) / (thresholdCount + 1))
    const generator = contours().size([W, H]).thresholds(thresholds)
    const geometries = generator(flat) as ContourGeometry[]

    const toLon = (x: number): number => BOUNDS.west + (x / (W - 1)) * (BOUNDS.east - BOUNDS.west)
    const toLat = (y: number): number => BOUNDS.north - (y / (H - 1)) * (BOUNDS.north - BOUNDS.south)

    let fillCount = 0
    let lineCount = 0
    const borderRings: LonLat[][] = []

    for (const geometry of geometries) {
      const ratio = Math.min(1, Math.max(0, (geometry.value - lo) / span))
      const color = ramp(palette, ratio)
      for (const polygon of geometry.coordinates) {
        const outer = polygon[0]
        if (!outer || outer.length < 3) continue
        const ring: LonLat[] = outer.map((point: [number, number]): LonLat => [toLon(point[0]), toLat(point[1])])
        addPolygon(ctx.dataSource, ring, { height: elevation, color, alpha, outline: false })
        fillCount += 1
      }
      for (const ringPoints of polygon2rings(geometry)) {
        borderRings.push(ringPoints)
        lineCount += 1
      }
    }

    for (const ring of borderRings) {
      addPolyline(ctx.dataSource, ring, {
        width: 1.2,
        color: '#0f172a',
        alpha: 0.85,
        height: elevation + 200
      })
    }

    ctx.status(`值域 ${lo.toFixed(3)} ~ ${hi.toFixed(3)} · 等值面 ${fillCount} 片 · 等值线 ${lineCount} 条`)
    ctx.legend([
      { label: palette, color: ramp(palette, 1) },
      { label: `${thresholdCount} 级阈值`, color: '#4ade80' }
    ])

    function polygon2rings(geometry: ContourGeometry): LonLat[][] {
      const rings: LonLat[][] = []
      for (const polygon of geometry.coordinates) {
        for (const ringPts of polygon) {
          if (ringPts.length < 3) continue
          rings.push(ringPts.map((point: [number, number]): LonLat => [toLon(point[0]), toLat(point[1])]))
        }
      }
      return rings
    }
  }
}

export default spec
