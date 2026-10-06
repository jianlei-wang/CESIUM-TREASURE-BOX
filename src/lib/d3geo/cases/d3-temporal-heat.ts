import { ColorMaterialProperty, ConstantProperty } from 'cesium'
import { scaleLinear } from 'd3'
import type { D3CaseSpec } from '../types'
import { CHINA_CITIES, mulberry32 } from '../data'
import { ramp } from '../palettes'
import { addPolygon, toColor, type LonLat } from '../render'

type HeatCell = {
  polygon: LonLat[]
  counts: number[]
}

const DOMAIN = { west: 100, south: 22, east: 124, north: 42 }

function buildCells(gridSize: number, pointCount: number, seed: number): { cells: HeatCell[]; maxCount: number } {
  const rng = mulberry32(seed)
  const width = DOMAIN.east - DOMAIN.west
  const height = DOMAIN.north - DOMAIN.south
  const cellW = width / gridSize
  const cellH = height / gridSize

  const counts: number[][] = new Array(gridSize * gridSize)
  for (let i = 0; i < counts.length; i += 1) counts[i] = new Array(24).fill(0)

  const hotspots = CHINA_CITIES.filter(
    (c) => c.lon > DOMAIN.west && c.lon < DOMAIN.east && c.lat > DOMAIN.south && c.lat < DOMAIN.north
  )
  const hourWeight = (hour: number): number =>
    0.25 + Math.exp(-((hour - 10) ** 2) / 16) + 0.9 * Math.exp(-((hour - 20) ** 2) / 10)

  for (let p = 0; p < pointCount; p += 1) {
    let lon: number
    let lat: number
    if (hotspots.length && rng() < 0.72) {
      const hub = hotspots[Math.floor(rng() * hotspots.length)]
      lon = hub.lon + (rng() - 0.5) * 3.2 + (rng() - 0.5) * 1.4
      lat = hub.lat + (rng() - 0.5) * 2.4 + (rng() - 0.5) * 1.2
    } else {
      lon = DOMAIN.west + rng() * width
      lat = DOMAIN.south + rng() * height
    }
    lon = Math.min(DOMAIN.east - 1e-4, Math.max(DOMAIN.west, lon))
    lat = Math.min(DOMAIN.north - 1e-4, Math.max(DOMAIN.south, lat))

    let hour = Math.floor(rng() * 24)
    let guard = 0
    while (rng() > hourWeight(hour) / 1.15 && guard < 8) {
      hour = Math.floor(rng() * 24)
      guard += 1
    }

    const i = Math.min(gridSize - 1, Math.floor((lon - DOMAIN.west) / cellW))
    const j = Math.min(gridSize - 1, Math.floor((lat - DOMAIN.south) / cellH))
    counts[j * gridSize + i][hour] += 1
  }

  const cells: HeatCell[] = []
  let maxCount = 1
  for (let j = 0; j < gridSize; j += 1) {
    for (let i = 0; i < gridSize; i += 1) {
      const west = DOMAIN.west + i * cellW
      const south = DOMAIN.south + j * cellH
      const polygon: LonLat[] = [
        [west, south],
        [west + cellW, south],
        [west + cellW, south + cellH],
        [west, south + cellH]
      ]
      const cellCounts = counts[j * gridSize + i]
      for (const value of cellCounts) maxCount = Math.max(maxCount, value)
      cells.push({ polygon, counts: cellCounts })
    }
  }
  return { cells, maxCount }
}

const spec: D3CaseSpec = {
  id: 'd3-temporal-heat',
  meta: {
    title: '时序热力播放',
    subtitle: '网格小时聚合 → onFrame 逐帧驱动 Polygon 拉伸高度与颜色',
    description: '把点位按小时聚合到规则网格，用逐帧播放的方式呈现一天 24 小时的热度起伏。',
    tag: 'D3 时序 · 动态热力',
    accent: '#fb923c',
    tips: [
      'd3.scaleLinear 把小时计数映射到网格柱高与色带位置，实现高度 / 颜色双编码',
      '每帧重设 polygon.extrudedHeight 与 material 的 ConstantProperty，无需重建实体',
      '帧间隔、网格规模、高度倍率均可调，播放始终按 24 小时循环推进'
    ]
  },
  defaults: {
    gridSize: 10,
    frameInterval: 420,
    heightScale: 220000,
    pointCount: 40000,
    ramp: 'inferno'
  },
  camera: { lon: 112, lat: 32, height: 3200000, pitch: -65 },
  controls: [
    { kind: 'range', key: 'gridSize', label: '网格规模(边)', min: 6, max: 12, step: 1 },
    { kind: 'range', key: 'frameInterval', label: '帧间隔(ms)', min: 120, max: 1500, step: 60 },
    { kind: 'range', key: 'heightScale', label: '高度倍率', min: 20000, max: 600000, step: 20000 },
    { kind: 'range', key: 'pointCount', label: '点数量', min: 5000, max: 120000, step: 5000, format: (v) => v.toLocaleString() },
    {
      kind: 'select',
      key: 'ramp',
      label: '色带',
      options: [
        { value: 'inferno', label: 'inferno' },
        { value: 'turbo', label: 'turbo' },
        { value: 'plasma', label: 'plasma' },
        { value: 'sunset', label: 'sunset' }
      ]
    }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const gridSize = Number(settings.gridSize)
    const frameInterval = Number(settings.frameInterval)
    const heightScale = Number(settings.heightScale)
    const pointCount = Number(settings.pointCount)
    const palette = String(settings.ramp)

    const { cells, maxCount } = buildCells(gridSize, pointCount, 20261006)
    const height = scaleLinear([0, maxCount], [0.04, 1])

    const rendered = cells.map((cell) => {
      const entity = addPolygon(ctx.dataSource, cell.polygon, {
        height: 60,
        extrudedHeight: 60,
        color: '#fb923c',
        alpha: 0.85,
        outline: true,
        outlineColor: '#1e293b',
        outlineWidth: 1
      })
      return { entity, counts: cell.counts }
    })

    const paint = (hour: number): void => {
      for (const item of rendered) {
        const count = item.counts[hour] ?? 0
        const ratio = height(count) ?? 0
        item.entity.polygon!.extrudedHeight = new ConstantProperty(60 + ratio * heightScale)
        item.entity.polygon!.material = new ColorMaterialProperty(toColor(ramp(palette, ratio), 0.86))
      }
      ctx.status(`播放中 ${String(hour).padStart(2, '0')}:00 · 网格 ${gridSize}×${gridSize} · 单格峰值 ${maxCount}`)
    }

    let hour = 0
    let accumulator = 0
    paint(hour)

    const cancel = ctx.onFrame((_time, delta) => {
      accumulator += delta
      if (accumulator < frameInterval) return
      accumulator = 0
      hour = (hour + 1) % 24
      paint(hour)
    })
    ctx.onCleanup(cancel)

    ctx.legend([
      { label: palette, color: ramp(palette, 1) },
      { label: `0 ~ ${maxCount} 次 / 单元`, color: '#fb923c' }
    ])
  }
}

export default spec
