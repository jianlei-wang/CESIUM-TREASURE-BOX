import { scaleLinear } from 'd3'
import type { D3CaseSpec } from '../types'
import { valueNoise2D } from '../data'
import { ramp } from '../palettes'
import { addPolygon } from '../render'

const BOUNDS = { west: 100, south: 24, east: 124, north: 44 }

const spec: D3CaseSpec = {
  id: 'd3-surface-area',
  meta: {
    title: '三维连续曲面（面积图）',
    subtitle: 'valueNoise2D 采样 → 逐格四边形按值抬升',
    description: '把连续值噪声映射为规则网格四边形，四角按数值抬升并着色，形成可旋转观察的三维曲面。',
    tag: 'D3 连续场 · 3D 曲面',
    accent: '#f59e0b',
    tips: [
      'valueNoise2D 生成多倍频连续场，每个网格单元由四个采样角点构成四边形',
      'addPolygon 的顶点携带第三个高度分量，perPositionHeight 自动开启形成起伏曲面',
      '色带由高度比例尺驱动，分辨率与高度倍率可实时重算整张曲面'
    ]
  },
  defaults: {
    resolution: 24,
    heightScale: 420000,
    ramp: 'turbo',
    wireframe: true,
    seed: 20261006
  },
  camera: { lon: 112, lat: 34, height: 3000000, pitch: -78 },
  controls: [
    { kind: 'range', key: 'resolution', label: '网格分辨率', min: 10, max: 40, step: 1 },
    { kind: 'range', key: 'heightScale', label: '高度倍率', min: 50000, max: 900000, step: 10000 },
    {
      kind: 'select',
      key: 'ramp',
      label: '色带',
      options: [
        { value: 'turbo', label: 'turbo' },
        { value: 'viridis', label: 'viridis' },
        { value: 'spectral', label: 'spectral' },
        { value: 'sunset', label: 'sunset' }
      ]
    },
    { kind: 'checkbox', key: 'wireframe', label: '显示网格描边' },
    { kind: 'range', key: 'seed', label: '噪声种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const resolution = Math.round(Number(ctx.settings.resolution))
    const heightScale = Number(ctx.settings.heightScale)
    const palette = String(ctx.settings.ramp)
    const wireframe = Boolean(ctx.settings.wireframe)
    const seed = Number(ctx.settings.seed)

    const cols = Math.max(4, resolution)
    const rows = Math.max(3, Math.round(resolution * 0.7))
    const noise = valueNoise2D(cols + 1, rows + 1, seed, 4)

    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const row of noise) {
      for (const value of row) {
        if (value < min) min = value
        if (value > max) max = value
      }
    }
    const height = scaleLinear([min, max], [0, 1])

    const lonSpan = BOUNDS.east - BOUNDS.west
    const latSpan = BOUNDS.north - BOUNDS.south
    let cells = 0
    let peak = 0

    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        const lon0 = BOUNDS.west + (i / cols) * lonSpan
        const lon1 = BOUNDS.west + ((i + 1) / cols) * lonSpan
        const lat0 = BOUNDS.south + (j / rows) * latSpan
        const lat1 = BOUNDS.south + ((j + 1) / rows) * latSpan

        const v00 = noise[j][i]
        const v10 = noise[j][i + 1]
        const v11 = noise[j + 1][i + 1]
        const v01 = noise[j + 1][i]
        const h00 = (height(v00) ?? 0) * heightScale
        const h10 = (height(v10) ?? 0) * heightScale
        const h11 = (height(v11) ?? 0) * heightScale
        const h01 = (height(v01) ?? 0) * heightScale

        const avg = (v00 + v10 + v11 + v01) / 4
        const ratio = height(avg) ?? 0
        if (ratio > peak) peak = ratio

        addPolygon(
          ctx.dataSource,
          [
            [lon0, lat0, h00],
            [lon1, lat0, h10],
            [lon1, lat1, h11],
            [lon0, lat1, h01]
          ],
          {
            color: ramp(palette, ratio),
            alpha: 0.9,
            outline: wireframe,
            outlineColor: '#0b1220',
            outlineWidth: 1
          }
        )
        cells += 1
      }
    }

    ctx.legend([
      { label: palette, color: ramp(palette, 1) },
      { label: `峰值 ${Math.round(peak * 100)}%`, color: '#f59e0b' }
    ])
    ctx.status(`${cols} × ${rows} 网格 = ${cells} 个曲面片，高度倍率 ${(heightScale / 1000).toFixed(0)} km`)
  }
}

export default spec
