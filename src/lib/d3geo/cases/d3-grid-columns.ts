import { max, scaleSqrt } from 'd3'
import type { D3CaseSpec } from '../types'
import { randomPoints } from '../data'
import { gridbin, type GridCell } from '../hex'
import { ramp } from '../palettes'
import { addBox } from '../render'

const BOUNDS = { west: 100, south: 22, east: 126, north: 44 }

const spec: D3CaseSpec = {
  id: 'd3-grid-columns',
  meta: {
    title: '方形格网 3D 柱',
    subtitle: 'gridbin 聚合 → addBox 立柱 · 颜色-高度双编码',
    description: '把随机点聚合到规则方形格网，每个格网用立柱表达计数，高度与颜色同步编码。',
    tag: 'D3 空间聚合 · gridbin',
    accent: '#fb923c',
    tips: [
      'gridbin 按固定经纬度步长分桶，天然形成规则方格统计单元',
      'd3.scaleSqrt 压制极值，让少量高密度格网不过度抢眼',
      'addBox 以格网中心为锚生成方柱，颜色与高度双编码计数'
    ]
  },
  defaults: {
    pointCount: 50000,
    cellSize: 1,
    heightScale: 200000,
    ramp: 'turbo',
    seed: 20261006
  },
  camera: { lon: 113, lat: 33, height: 4200000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'pointCount', label: '点数量', min: 5000, max: 200000, step: 5000, format: (v) => v.toLocaleString() },
    { kind: 'range', key: 'cellSize', label: '格网大小(°)', min: 0.3, max: 3, step: 0.1 },
    { kind: 'range', key: 'heightScale', label: '高度倍率', min: 20000, max: 400000, step: 10000 },
    {
      kind: 'select',
      key: 'ramp',
      label: '色带',
      options: [
        { value: 'turbo', label: 'turbo' },
        { value: 'viridis', label: 'viridis' },
        { value: 'inferno', label: 'inferno' },
        { value: 'coolwarm', label: 'coolwarm' }
      ]
    },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const total = Number(settings.pointCount)
    const cellSize = Number(settings.cellSize)
    const heightScale = Number(settings.heightScale)
    const palette = String(settings.ramp)

    const points = randomPoints(total, BOUNDS, Number(settings.seed))
    const cells = gridbin(points, cellSize, BOUNDS)
    const maxCount = max(cells, (cell: GridCell) => cell.count) ?? 1
    const height = scaleSqrt([0, maxCount], [0, 1])
    const sizeMeters = cellSize * 111320 * 0.82

    const ranked = [...cells].sort((a, b) => a.count - b.count)
    ranked.forEach((cell) => {
      const ratio = height(cell.count) ?? 0
      addBox(ctx.dataSource, cell.center[0], cell.center[1], {
        size: sizeMeters,
        height: Math.max(2000, ratio * heightScale),
        base: 0,
        color: ramp(palette, ratio),
        alpha: 0.9,
        outline: true,
        outlineColor: '#0f172a'
      })
    })

    ctx.legend([
      { label: palette, color: ramp(palette, 1) },
      { label: `格网 ${cellSize}° · ${cells.length} 格`, color: '#fb923c' }
    ])
    ctx.status(
      `原始 ${points.length.toLocaleString()} 点 → 聚合为 ${cells.length} 个 ${cellSize}° 格网 · 单格峰值 ${maxCount}`
    )
  }
}

export default spec
