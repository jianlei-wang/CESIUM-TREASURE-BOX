import { scaleSqrt, max } from 'd3'
import type { D3CaseSpec } from '../types'
import { clusteredPoints, mulberry32 } from '../data'
import { hexbin, type HexCell } from '../hex'
import { ramp } from '../palettes'
import { addPolygon } from '../render'

const CLUSTERS = [
  { lon: 116.4, lat: 39.9, count: 0.22, spread: 5 },
  { lon: 121.5, lat: 31.2, count: 0.18, spread: 4 },
  { lon: 113.3, lat: 23.1, count: 0.16, spread: 5 },
  { lon: 104.1, lat: 30.6, count: 0.14, spread: 5 },
  { lon: 114.3, lat: 30.6, count: 0.12, spread: 4 },
  { lon: 108.9, lat: 34.3, count: 0.1, spread: 4 },
  { lon: 126.5, lat: 45.8, count: 0.08, spread: 5 }
]

const spec: D3CaseSpec = {
  id: 'd3-hexbin',
  meta: {
    title: '六边形格网聚合（hexbin 3D 柱）',
    subtitle: '平面六边形分桶 → 拉伸 Polygon 立体统计面',
    description: '把海量散点聚合到规则蜂窝格网，用计数映射六棱柱高度与颜色，避免重叠。',
    tag: 'D3 空间聚合 · hexbin',
    accent: '#4ade80',
    tips: [
      '在缩放后的平面空间做六边形分桶，邻域最近中心策略避免边界抖动',
      '每个被占据的蜂窝生成一根拉伸多边形柱体，高度与颜色双编码计数',
      '聚合先行是海量点最有效的减负闸门，可支撑十万级散点'
    ]
  },
  defaults: {
    pointCount: 60000,
    radius: 1.1,
    heightScale: 90000,
    ramp: 'viridis',
    seed: 20261006
  },
  camera: { lon: 104, lat: 34, height: 6200000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'pointCount', label: '散点数量', min: 5000, max: 200000, step: 5000, format: (v) => v.toLocaleString() },
    { kind: 'range', key: 'radius', label: '六边形半径(°)', min: 0.3, max: 3, step: 0.1 },
    { kind: 'range', key: 'heightScale', label: '柱高倍率', min: 10000, max: 300000, step: 10000 },
    {
      kind: 'select',
      key: 'ramp',
      label: '色带',
      options: [
        { value: 'viridis', label: 'viridis' },
        { value: 'turbo', label: 'turbo' },
        { value: 'inferno', label: 'inferno' },
        { value: 'greens', label: 'greens' }
      ]
    },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const total = Number(settings.pointCount)
    const radius = Number(settings.radius)
    const heightScale = Number(settings.heightScale)
    const palette = String(settings.ramp)

    const rng = mulberry32(Number(settings.seed))
    const points = clusteredPoints(
      CLUSTERS.map((c) => ({ lon: c.lon, lat: c.lat, count: Math.floor(total * c.count), spread: c.spread })),
      Number(settings.seed)
    )
    // 保留少量随机噪声点，使形态更自然
    for (let i = 0; i < total * 0.06; i += 1) {
      points.push([100 + rng() * 24, 22 + rng() * 20])
    }

    const cells = hexbin(points, radius, 34)
    const maxCount = max(cells, (c: HexCell) => c.count) ?? 1
    const height = scaleSqrt([0, maxCount], [0, 1])
    const sorted = [...cells].sort((a, b) => a.count - b.count)

    sorted.forEach((cell) => {
      const ratio = height(cell.count) ?? 0
      const color = ramp(palette, ratio)
      addPolygon(ctx.dataSource, cell.polygon, {
        height: 100,
        extrudedHeight: Math.max(3000, ratio * heightScale),
        color,
        alpha: 0.85,
        outline: true,
        outlineColor: '#0f172a',
        outlineWidth: 1
      })
    })

    ctx.legend([
      { label: palette, color: ramp(palette, 1) },
      { label: `${points.length.toLocaleString()} 点 → ${cells.length} 蜂窝`, color: '#4ade80' }
    ])
    ctx.status(`原始 ${points.length.toLocaleString()} 点，聚合为 ${cells.length} 个蜂窝单元，单格峰值 ${maxCount}`)
  }
}

export default spec
