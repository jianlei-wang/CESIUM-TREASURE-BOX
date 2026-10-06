import { max } from 'd3'
import type { D3CaseSpec } from '../types'
import { clusteredPoints, mulberry32 } from '../data'
import { hexbin, type HexCell } from '../hex'
import { ramp } from '../palettes'
import { addPolygon, addToPointCollection } from '../render'

const CLUSTERS = [
  { lon: 116.4, lat: 39.9, count: 0.2, spread: 5 },
  { lon: 121.5, lat: 31.2, count: 0.17, spread: 4 },
  { lon: 113.3, lat: 23.1, count: 0.15, spread: 5 },
  { lon: 104.1, lat: 30.6, count: 0.14, spread: 5 },
  { lon: 114.3, lat: 30.6, count: 0.12, spread: 4 },
  { lon: 108.9, lat: 34.3, count: 0.1, spread: 4 },
  { lon: 126.5, lat: 45.8, count: 0.08, spread: 5 },
  { lon: 87.6, lat: 43.8, count: 0.04, spread: 6 }
]

const spec: D3CaseSpec = {
  id: 'd3-hexbin-decimate',
  meta: {
    title: '蜂窝抽稀与点降采样',
    subtitle: 'hexbin 聚合 / PointPrimitiveCollection 原始点切换',
    description: '十万级散点在蜂窝聚合与原始点两种模式下切换，实时对比数据压减率。',
    tag: 'D3 抽稀 · 降采样',
    accent: '#22d3ee',
    tips: [
      '蜂窝聚合把海量点压减为数量级的统计单元，压减率即时回显',
      '原始点模式改用 PointPrimitiveCollection 批量图元，避免逐条 Entity 开销',
      '两种模式共用同一份随机数据，切换参数后重建即可对比渲染负载'
    ]
  },
  defaults: {
    pointCount: 100000,
    radius: 1,
    showRaw: false,
    ramp: 'viridis',
    seed: 20261006
  },
  camera: { lon: 106, lat: 34, height: 6800000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'pointCount', label: '点数量', min: 10000, max: 200000, step: 10000, format: (v) => v.toLocaleString() },
    { kind: 'range', key: 'radius', label: '蜂窝半径(°)', min: 0.3, max: 3, step: 0.1 },
    { kind: 'checkbox', key: 'showRaw', label: '显示原始点' },
    {
      kind: 'select',
      key: 'ramp',
      label: '色带',
      options: [
        { value: 'viridis', label: 'viridis' },
        { value: 'turbo', label: 'turbo' },
        { value: 'plasma', label: 'plasma' },
        { value: 'greens', label: 'greens' }
      ]
    },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const total = Number(settings.pointCount)
    const radius = Number(settings.radius)
    const showRaw = Boolean(settings.showRaw)
    const palette = String(settings.ramp)

    const rng = mulberry32(Number(settings.seed))
    const points = clusteredPoints(
      CLUSTERS.map((cluster) => ({
        lon: cluster.lon,
        lat: cluster.lat,
        count: Math.floor(total * cluster.count),
        spread: cluster.spread
      })),
      Number(settings.seed)
    )
    for (let i = 0; i < total * 0.05; i += 1) {
      points.push([98 + rng() * 28, 20 + rng() * 24])
    }

    let unitCount = 0
    if (showRaw) {
      const collection = ctx.pointCollection()
      for (const [lon, lat] of points) {
        addToPointCollection(collection, lon, lat, 0, '#22d3ee', 2.5)
      }
      unitCount = points.length
      ctx.legend([
        { label: `${points.length.toLocaleString()} 个原始点`, color: '#22d3ee' },
        { label: 'PointPrimitiveCollection', color: '#0f172a' }
      ])
    } else {
      const cells = hexbin(points, radius, 34)
      const maxCount = max(cells, (cell: HexCell) => cell.count) ?? 1
      unitCount = cells.length
      const ranked = [...cells].sort((a, b) => a.count - b.count)
      ranked.forEach((cell) => {
        const ratio = cell.count / maxCount
        addPolygon(ctx.dataSource, cell.polygon, {
          height: 100,
          extrudedHeight: Math.max(2000, ratio * 120000),
          color: ramp(palette, ratio),
          alpha: 0.85,
          outline: true,
          outlineColor: '#0f172a',
          outlineWidth: 1
        })
      })
      ctx.legend([
        { label: palette, color: ramp(palette, 1) },
        { label: `${cells.length.toLocaleString()} 个蜂窝单元`, color: '#4ade80' }
      ])
    }

    const reduction = points.length > 0 ? (1 - unitCount / points.length) * 100 : 0
    ctx.status(
      `原始 ${points.length.toLocaleString()} 点 · 当前渲染 ${unitCount.toLocaleString()} 个${showRaw ? '点' : '蜂窝'} · 压减率 ${reduction.toFixed(2)}%`
    )
  }
}

export default spec
