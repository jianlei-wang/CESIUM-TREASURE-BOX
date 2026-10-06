import { deviation, mean } from 'd3'
import type { D3CaseSpec } from '../types'
import { clusteredPoints, mulberry32 } from '../data'
import { gridbin, type GridCell } from '../hex'
import { addPolygon } from '../render'

const BOUNDS = { west: 100, south: 22, east: 124, north: 42 }

const CATEGORY_COLORS: Record<string, string> = {
  '高-高': '#ef4444',
  '低-低': '#3b82f6',
  '高-低': '#f59e0b',
  '低-高': '#22d3ee',
  不显著: '#475569'
}

const CLUSTERS = [
  { lon: 116.4, lat: 39.9, count: 0.18, spread: 3.2 },
  { lon: 121.5, lat: 31.2, count: 0.15, spread: 3 },
  { lon: 113.3, lat: 23.1, count: 0.13, spread: 3.4 },
  { lon: 104.1, lat: 30.6, count: 0.12, spread: 3.2 },
  { lon: 114.3, lat: 30.6, count: 0.1, spread: 2.8 },
  { lon: 108.9, lat: 34.3, count: 0.09, spread: 3 },
  { lon: 126.5, lat: 45.8, count: 0.07, spread: 3.4 },
  { lon: 102.8, lat: 24.9, count: 0.06, spread: 3.2 }
]

type Stat = { cell: GridCell; dev: number; lag: number; category: string; ratio: number }

const spec: D3CaseSpec = {
  id: 'd3-local-moran',
  meta: {
    title: '局部空间自相关聚类图',
    subtitle: "简化 Local Moran's I · 网格偏离 × 邻域均值",
    description: '在规则格网上计算每个单元的偏离与邻域均值，划分高-高、低-低与两类空间离群，生成局部聚类显著图。',
    tag: 'D3 空间统计 · 局部自相关',
    accent: '#ef4444',
    tips: [
      '以 gridbin 计数相对全局均值的偏离为局部量，邻域均值作为空间滞后',
      '偏离 × 空间滞后的符号组合区分高-高 / 低-低 / 两类空间离群',
      'd3.deviation 估计标准差，结合阈值过滤掉统计上不显著的单元'
    ]
  },
  defaults: {
    cellSize: 1.5,
    threshold: 0.8,
    heightScale: 60000,
    showLegend: true,
    seed: 20261006
  },
  camera: { lon: 104, lat: 34, height: 6200000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'cellSize', label: '格网大小(°)', min: 0.5, max: 3, step: 0.1 },
    { kind: 'range', key: 'threshold', label: '显著阈值(σ)', min: 0.2, max: 2, step: 0.1 },
    { kind: 'range', key: 'heightScale', label: '柱高倍率', min: 10000, max: 200000, step: 5000 },
    { kind: 'checkbox', key: 'showLegend', label: '显示类别图例' },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const cellSize = Number(settings.cellSize)
    const threshold = Number(settings.threshold)
    const heightScale = Number(settings.heightScale)
    const showLegend = Boolean(settings.showLegend)
    const seed = Number(settings.seed)

    const total = 45000
    const points = clusteredPoints(
      CLUSTERS.map((c) => ({ lon: c.lon, lat: c.lat, count: Math.floor(total * c.count), spread: c.spread })),
      seed
    )
    const rng = mulberry32(seed + 7)
    for (let i = 0; i < 3000; i += 1) {
      points.push([BOUNDS.west + rng() * (BOUNDS.east - BOUNDS.west), BOUNDS.south + rng() * (BOUNDS.north - BOUNDS.south)])
    }

    const cells = gridbin(points, cellSize, BOUNDS)
    const counts = cells.map((c) => c.count)
    const globalMean = mean(counts) ?? 0
    const sd = deviation(counts) ?? 1
    const sigma = sd || 1
    const maxCount = Math.max(1, ...counts)
    const lookup = new Map(cells.map((c) => [c.key, c]))

    const stats: Stat[] = cells.map((cell) => {
      const [i, j] = cell.key.split(',').map(Number)
      const dev = cell.count - globalMean
      let sum = 0
      let n = 0
      for (let di = -1; di <= 1; di += 1) {
        for (let dj = -1; dj <= 1; dj += 1) {
          if (di === 0 && dj === 0) continue
          const neighbor = lookup.get(`${i + di},${j + dj}`)
          if (neighbor) {
            sum += neighbor.count - globalMean
            n += 1
          }
        }
      }
      const lag = n > 0 ? sum / n : 0
      const zi = dev / sigma
      const zl = lag / sigma
      let category = '不显著'
      if (Math.abs(zi) >= threshold && Math.abs(zl) >= threshold) {
        if (zi > 0 && zl > 0) category = '高-高'
        else if (zi < 0 && zl < 0) category = '低-低'
        else if (zi > 0 && zl < 0) category = '高-低'
        else category = '低-高'
      }
      return { cell, dev, lag, category, ratio: cell.count / maxCount }
    })

    const sorted = [...stats].sort((a, b) => a.ratio - b.ratio)
    for (const stat of sorted) {
      const color = CATEGORY_COLORS[stat.category] ?? CATEGORY_COLORS.不显著
      addPolygon(ctx.dataSource, stat.cell.polygon, {
        height: 0,
        extrudedHeight: Math.max(400, stat.ratio * heightScale),
        color,
        alpha: stat.category === '不显著' ? 0.24 : 0.88,
        outline: true,
        outlineColor: '#0f172a',
        outlineWidth: 1
      })
    }

    const tally: Record<string, number> = {}
    for (const stat of stats) tally[stat.category] = (tally[stat.category] ?? 0) + 1

    if (showLegend) {
      ctx.legend([
        { label: `高-高 ${tally['高-高'] ?? 0}`, color: CATEGORY_COLORS['高-高'] },
        { label: `低-低 ${tally['低-低'] ?? 0}`, color: CATEGORY_COLORS['低-低'] },
        { label: `高-低 离群 ${tally['高-低'] ?? 0}`, color: CATEGORY_COLORS['高-低'] },
        { label: `低-高 离群 ${tally['低-高'] ?? 0}`, color: CATEGORY_COLORS['低-高'] },
        { label: `不显著 ${tally.不显著 ?? 0}`, color: CATEGORY_COLORS.不显著 }
      ])
    } else {
      ctx.legend([])
    }

    ctx.status(
      `格网 ${cells.length} 个 · 全局均值 ${globalMean.toFixed(1)} · 显著聚类 ${(tally['高-高'] ?? 0) + (tally['低-低'] ?? 0)} 个 · 空间离群 ${(tally['高-低'] ?? 0) + (tally['低-高'] ?? 0)} 个`
    )
  }
}

export default spec
