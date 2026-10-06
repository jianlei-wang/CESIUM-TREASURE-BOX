import { max } from 'd3'
import type { D3CaseSpec } from '../types'
import { CHINA_CITIES, mulberry32 } from '../data'
import { gridbin, type GridCell } from '../hex'
import { ramp } from '../palettes'
import { addPolygon, addPolyline, type LonLat } from '../render'

type Od = { origin: LonLat; dest: LonLat }

function buildOd(count: number, seed: number): Od[] {
  const rng = mulberry32(seed)
  const flows: Od[] = []
  for (let i = 0; i < count; i += 1) {
    const from = CHINA_CITIES[Math.floor(rng() * CHINA_CITIES.length)]
    const to = CHINA_CITIES[Math.floor(rng() * CHINA_CITIES.length)]
    const origin: LonLat = [from.lon + (rng() - 0.5) * 3.2, from.lat + (rng() - 0.5) * 2.4]
    const dest: LonLat = [to.lon + (rng() - 0.5) * 2.4, to.lat + (rng() - 0.5) * 2]
    flows.push({ origin, dest })
  }
  return flows
}

const spec: D3CaseSpec = {
  id: 'd3-od-grid',
  meta: {
    title: '流向格网（OD 聚合网格）',
    subtitle: 'gridbin 聚合起终点 → 格内主导流向箭头',
    description: '把海量 OD 起终点聚合到规则格网，在每格内绘制由净位移决定方向、由强度决定长度与颜色的流向箭头。',
    tag: 'D3 流场 · OD 聚合',
    accent: '#fb923c',
    tips: [
      '以起点落格聚合 OD 记录，格内净位移向量即该格的主导流向',
      '方向由 atan2 计算，长度与颜色由 d3 比例尺按强度映射到箭头',
      '箭头由主干折线与两段箭头翼组成，可随强度线性拉伸'
    ]
  },
  defaults: {
    cellSize: 1.6,
    count: 9000,
    arrowScale: 0.9,
    ramp: 'plasma',
    seed: 20261006
  },
  camera: { lon: 104, lat: 34, height: 6200000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'cellSize', label: '格网大小(°)', min: 0.8, max: 3, step: 0.1 },
    { kind: 'range', key: 'count', label: 'OD 点数量', min: 2000, max: 30000, step: 1000, format: (v) => v.toLocaleString() },
    { kind: 'range', key: 'arrowScale', label: '箭头长度倍率', min: 0.4, max: 1.4, step: 0.05 },
    {
      kind: 'select',
      key: 'ramp',
      label: '强度色带',
      options: [
        { value: 'plasma', label: 'plasma' },
        { value: 'turbo', label: 'turbo' },
        { value: 'spectral', label: 'spectral' },
        { value: 'sunset', label: 'sunset' }
      ]
    },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const cellSize = Number(settings.cellSize)
    const count = Number(settings.count)
    const arrowScale = Number(settings.arrowScale)
    const palette = String(settings.ramp)
    const seed = Number(settings.seed)

    const ods = buildOd(count, seed)
    const cells = gridbin(ods.map((od) => od.origin), cellSize)
    const cos0 = Math.cos((34 * Math.PI) / 180) || 0.01
    const extract = (lon: number) => lon * cos0

    type Arrow = { cell: GridCell; ratio: number; angle: number; netMag: number }
    const raw = cells.map((cell) => {
      let sumX = 0
      let sumY = 0
      for (const index of cell.indices) {
        const od = ods[index]
        sumX += extract(od.dest[0]) - extract(od.origin[0])
        sumY += od.dest[1] - od.origin[1]
      }
      const netMag = Math.hypot(sumX, sumY) / Math.max(1, cell.count)
      return { cell, netMag, angle: Math.atan2(sumY, sumX) }
    })
    const maxNet = max(raw, (r: { netMag: number }) => r.netMag) ?? 1
    const arrows: Arrow[] = raw.map((r) => ({ ...r, ratio: maxNet > 0 ? r.netMag / maxNet : 0 }))
    arrows.sort((a, b) => a.ratio - b.ratio)

    for (const arrow of arrows) {
      const [lon, lat] = arrow.cell.center
      const countRatio = Math.min(1, arrow.cell.count / Math.max(1, max(cells, (c: GridCell) => c.count) ?? 1))
      addPolygon(ctx.dataSource, arrow.cell.polygon, {
        height: 100,
        color: ramp(palette, 0.2 + countRatio * 0.5),
        alpha: 0.16,
        outline: true,
        outlineColor: '#1e293b',
        outlineWidth: 1
      })

      const color = ramp(palette, arrow.ratio)
      const length = cellSize * 0.9 * arrowScale * (0.25 + arrow.ratio * 0.95)
      const baseX = extract(lon)
      const tipX = baseX + Math.cos(arrow.angle) * length
      const tipY = lat + Math.sin(arrow.angle) * length
      const tipLon = tipX / cos0
      const headLength = length * 0.38
      const width = 1.1 + arrow.ratio * 2.3

      addPolyline(ctx.dataSource, [[lon, lat, 600], [tipLon, tipY, 600]], {
        width,
        color,
        alpha: 0.92,
        glow: true,
        glowPower: 0.16
      })

      for (const offset of [Math.PI * 0.82, -Math.PI * 0.82]) {
        const wingX = tipX + Math.cos(arrow.angle + offset) * headLength
        const wingY = tipY + Math.sin(arrow.angle + offset) * headLength
        addPolyline(ctx.dataSource, [[tipLon, tipY, 600], [wingX / cos0, wingY, 600]], {
          width,
          color,
          alpha: 0.92
        })
      }
    }

    ctx.legend([
      { label: palette, color: ramp(palette, 1) },
      { label: `${ods.length.toLocaleString()} 条 OD → ${cells.length} 格`, color: '#fb923c' }
    ])
    ctx.status(`OD 记录 ${ods.length.toLocaleString()} 条，聚合为 ${cells.length} 个格网，格内主导流向箭头同步绘制`)
  }
}

export default spec
