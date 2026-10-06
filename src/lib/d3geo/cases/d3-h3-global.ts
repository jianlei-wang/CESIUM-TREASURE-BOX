import { scaleSqrt } from 'd3'
import { cellToBoundary, latLngToCell } from 'h3-js'
import type { D3CaseSpec } from '../types'
import { clusteredPoints } from '../data'
import { ramp } from '../palettes'
import { addLabel, addPolygon, type LonLat } from '../render'

const BOUNDS = { west: 73, south: 18, east: 135, north: 54 }

const CLUSTERS = [
  { lon: 116.4, lat: 39.9, spread: 4 },
  { lon: 121.5, lat: 31.2, spread: 3.5 },
  { lon: 113.3, lat: 23.1, spread: 4 },
  { lon: 104.1, lat: 30.6, spread: 4 },
  { lon: 114.3, lat: 30.6, spread: 3 },
  { lon: 108.9, lat: 34.3, spread: 3.5 },
  { lon: 126.5, lat: 45.8, spread: 4 }
]

function boundaryToLonLat(cell: string): LonLat[] {
  return cellToBoundary(cell).map((pair: [number, number]) => [pair[1], pair[0]] as LonLat)
}

const spec: D3CaseSpec = {
  id: 'd3-h3-global',
  meta: {
    title: 'H3 全球六边形层级网格',
    subtitle: 'h3-js latLngToCell / cellToBoundary → Cesium Polygon',
    description: '用 H3 六边形网格覆盖区域，随机点按单元聚合，计数映射柱高与颜色。',
    tag: 'D3 空间索引 · H3',
    accent: '#34d399',
    tips: [
      '对区域采样网格点用 latLngToCell 求单元集合，cellToBoundary 转经纬度后渲染网格',
      '随机点投递到同一 H3 单元内聚合计数，按计数映射六边形柱高与颜色',
      'cellToBoundary 返回 [lat,lng]，需交换为 [lon,lat] 再交给 Cesium'
    ]
  },
  defaults: {
    resolution: 4,
    pointCount: 8000,
    heightScale: 260000,
    ramp: 'viridis',
    seed: 20261006
  },
  camera: { lon: 104, lat: 34, height: 7200000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'resolution', label: 'H3 分辨率', min: 0, max: 9, step: 1 },
    { kind: 'range', key: 'pointCount', label: '聚合点数', min: 1000, max: 30000, step: 1000, format: (v) => v.toLocaleString() },
    { kind: 'range', key: 'heightScale', label: '高度倍率', min: 20000, max: 600000, step: 20000 },
    {
      kind: 'select',
      key: 'ramp',
      label: '色带',
      options: [
        { value: 'viridis', label: 'viridis' },
        { value: 'turbo', label: 'turbo' },
        { value: 'spectral', label: 'spectral' },
        { value: 'sunset', label: 'sunset' }
      ]
    },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const resolution = Number(settings.resolution)
    const total = Number(settings.pointCount)
    const heightScale = Number(settings.heightScale)
    const palette = String(settings.ramp)

    const gridCells = new Set<string>()
    const cols = 36
    const rows = 22
    for (let c = 0; c < cols; c += 1) {
      for (let r = 0; r < rows; r += 1) {
        const lon = BOUNDS.west + ((c + 0.5) / cols) * (BOUNDS.east - BOUNDS.west)
        const lat = BOUNDS.south + ((r + 0.5) / rows) * (BOUNDS.north - BOUNDS.south)
        gridCells.add(latLngToCell(lat, lon, resolution))
      }
    }

    const points = clusteredPoints(
      CLUSTERS.map((cluster) => ({
        lon: cluster.lon,
        lat: cluster.lat,
        count: Math.floor(total / CLUSTERS.length),
        spread: cluster.spread
      })),
      Number(settings.seed)
    )

    const counts = new Map<string, number>()
    for (const [lon, lat] of points) {
      const cell = latLngToCell(lat, lon, resolution)
      counts.set(cell, (counts.get(cell) ?? 0) + 1)
    }

    const maxCount = Math.max(1, ...[...counts.values()])
    const height = scaleSqrt([0, maxCount], [0, 1])

    gridCells.forEach((cell) => {
      if (counts.has(cell)) return
      addPolygon(ctx.dataSource, boundaryToLonLat(cell), {
        color: '#1e293b',
        alpha: 0.22,
        outline: true,
        outlineColor: '#334155',
        outlineWidth: 1
      })
    })

    const ranked = [...counts.entries()].sort((a, b) => a[1] - b[1])
    ranked.forEach(([cell, count]) => {
      const ratio = height(count) ?? 0
      addPolygon(ctx.dataSource, boundaryToLonLat(cell), {
        height: 100,
        extrudedHeight: Math.max(2000, ratio * heightScale),
        color: ramp(palette, ratio),
        alpha: 0.88,
        outline: true,
        outlineColor: '#0f172a',
        outlineWidth: 1
      })
    })

    if (ranked.length > 0) {
      const [topCell, topCount] = ranked[ranked.length - 1]
      const boundary = cellToBoundary(topCell)
      const mid = boundary[0]
      addLabel(ctx.dataSource, mid[1], mid[0], `峰值 ${topCount}`, {
        font: '12px sans-serif',
        scaleByDistance: [2000000, 0.4, 14000000, 1.3],
        disableDepthTest: true
      })
    }

    ctx.legend([
      { label: palette, color: ramp(palette, 1) },
      { label: `res=${resolution} · ${counts.size} 个占用单元`, color: '#34d399' }
    ])
    ctx.status(
      `H3 分辨率 ${resolution} · 网格单元 ${gridCells.size} 个 · 聚合单元 ${counts.size} 个 · 点数 ${points.length.toLocaleString()} · 峰值 ${maxCount}`
    )
  }
}

export default spec
