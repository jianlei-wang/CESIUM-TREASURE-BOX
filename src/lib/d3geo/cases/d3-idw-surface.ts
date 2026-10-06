import type { D3CaseSpec } from '../types'
import { mulberry32 } from '../data'
import { ramp } from '../palettes'
import { addPolygon } from '../render'

const BOUNDS = { west: 100, south: 25, east: 120, north: 40 }

const spec: D3CaseSpec = {
  id: 'd3-idw-surface',
  meta: {
    title: '网格插值连续曲面（IDW）',
    subtitle: '反距离加权插值 → perPositionHeight 四边形连续曲面',
    description: '把离散观测点用反距离加权插值到规则格网，以带高度的四边形构造连续曲面并按插值结果着色。',
    tag: 'D3 空间插值 · IDW 曲面',
    accent: '#a78bfa',
    tips: [
      '反距离加权以 1/dᵖ 为权重融合邻域观测，幂次越高越贴近最近点',
      '在规则格网逐顶点插值，得到连续起伏的三维曲面采样点',
      '每个格网四边形携带四个高度值，perPositionHeight 拼成无缝曲面'
    ]
  },
  defaults: {
    power: 2,
    gridRes: 40,
    obsCount: 18,
    heightScale: 160000,
    ramp: 'viridis',
    seed: 20261006
  },
  camera: { lon: 110, lat: 30, height: 3800000, heading: 0, pitch: -58 },
  controls: [
    { kind: 'range', key: 'power', label: 'IDW 幂次 p', min: 0.5, max: 5, step: 0.1 },
    { kind: 'range', key: 'gridRes', label: '格网分辨率', min: 12, max: 64, step: 4 },
    { kind: 'range', key: 'obsCount', label: '观测点数量', min: 6, max: 40, step: 1 },
    { kind: 'range', key: 'heightScale', label: '曲面高度倍率', min: 20000, max: 300000, step: 10000 },
    {
      kind: 'select',
      key: 'ramp',
      label: '色带',
      options: [
        { value: 'viridis', label: 'viridis' },
        { value: 'inferno', label: 'inferno' },
        { value: 'turbo', label: 'turbo' },
        { value: 'spectral', label: 'spectral' }
      ]
    },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const power = Number(settings.power)
    const gridRes = Math.round(Number(settings.gridRes))
    const obsCount = Math.round(Number(settings.obsCount))
    const heightScale = Number(settings.heightScale)
    const palette = String(settings.ramp)
    const seed = Number(settings.seed)

    const cos0 = Math.cos((((BOUNDS.south + BOUNDS.north) / 2) * Math.PI) / 180) || 0.01
    const rng = mulberry32(seed)

    const bumps = Array.from({ length: 5 }, () => ({
      lon: BOUNDS.west + rng() * (BOUNDS.east - BOUNDS.west),
      lat: BOUNDS.south + rng() * (BOUNDS.north - BOUNDS.south),
      amp: 0.5 + rng() * 0.9,
      sigma: 1.5 + rng() * 2
    }))
    const field = (lon: number, lat: number): number => {
      let value = 0
      for (const bump of bumps) {
        const d2 = (lon - bump.lon) ** 2 + (lat - bump.lat) ** 2
        value += bump.amp * Math.exp(-d2 / (2 * bump.sigma * bump.sigma))
      }
      return value
    }

    const obs: Array<{ x: number; y: number; value: number }> = []
    for (let i = 0; i < obsCount; i += 1) {
      const lon = BOUNDS.west + rng() * (BOUNDS.east - BOUNDS.west)
      const lat = BOUNDS.south + rng() * (BOUNDS.north - BOUNDS.south)
      obs.push({ x: lon * cos0, y: lat, value: field(lon, lat) + (rng() - 0.5) * 0.3 })
    }

    const idw = (x: number, y: number): number => {
      let numerator = 0
      let denominator = 0
      for (const o of obs) {
        const dx = x - o.x
        const dy = y - o.y
        const d2 = dx * dx + dy * dy
        const weight = 1 / Math.pow(d2 + 1e-6, power / 2)
        numerator += weight * o.value
        denominator += weight
      }
      return denominator > 0 ? numerator / denominator : 0
    }

    const stepLon = (BOUNDS.east - BOUNDS.west) / gridRes
    const stepLat = (BOUNDS.north - BOUNDS.south) / gridRes
    const grid: number[][] = []
    let minV = Number.POSITIVE_INFINITY
    let maxV = Number.NEGATIVE_INFINITY
    for (let j = 0; j <= gridRes; j += 1) {
      const row: number[] = []
      for (let i = 0; i <= gridRes; i += 1) {
        const lon = BOUNDS.west + i * stepLon
        const lat = BOUNDS.south + j * stepLat
        const value = idw(lon * cos0, lat)
        row.push(value)
        if (value < minV) minV = value
        if (value > maxV) maxV = value
      }
      grid.push(row)
    }
    const span = maxV - minV || 1
    const norm = (value: number) => (value - minV) / span

    for (let j = 0; j < gridRes; j += 1) {
      for (let i = 0; i < gridRes; i += 1) {
        const v00 = grid[j][i]
        const v10 = grid[j][i + 1]
        const v11 = grid[j + 1][i + 1]
        const v01 = grid[j + 1][i]
        const lon0 = BOUNDS.west + i * stepLon
        const lon1 = lon0 + stepLon
        const lat0 = BOUNDS.south + j * stepLat
        const lat1 = lat0 + stepLat
        const points: Array<[number, number, number]> = [
          [lon0, lat0, norm(v00) * heightScale],
          [lon1, lat0, norm(v10) * heightScale],
          [lon1, lat1, norm(v11) * heightScale],
          [lon0, lat1, norm(v01) * heightScale]
        ]
        const average = norm((v00 + v10 + v11 + v01) / 4)
        addPolygon(ctx.dataSource, points, {
          perPositionHeight: true,
          color: ramp(palette, average),
          alpha: 0.94
        })
      }
    }

    ctx.legend([
      { label: palette, color: ramp(palette, 1) },
      { label: `p=${power} · ${obs.length} 观测 → ${gridRes}×${gridRes} 格`, color: '#a78bfa' }
    ])
    ctx.status(`IDW 插值 ${gridRes}×${gridRes} 格网，幂次 p=${power}，插值域 ${minV.toFixed(2)} ~ ${maxV.toFixed(2)}`)
  }
}

export default spec
