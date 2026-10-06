import {
  extent,
  interpolateInferno,
  interpolateSpectral,
  interpolateTurbo,
  interpolateViridis,
  scaleSequential,
  scaleSqrt
} from 'd3'
import type { D3CaseSpec } from '../types'
import { WORLD_HUBS, mulberry32 } from '../data'
import { addLabel, addPoint, addPolygon, addToPointCollection, circlePolygon } from '../render'

const INTERPOLATORS: Record<string, (t: number) => string> = {
  turbo: interpolateTurbo,
  viridis: interpolateViridis,
  spectral: interpolateSpectral,
  inferno: interpolateInferno
}

const spec: D3CaseSpec = {
  id: 'd3-bubble-globe',
  meta: {
    title: '三维气泡图',
    subtitle: 'd3.scaleSqrt → 气泡半径 · scaleSequential → 连续色板',
    description: '用平方根尺度把城市指标映射为气泡半径，在三维地球上形成体量可比较的气泡群。',
    tag: 'D3 统计图形 · 气泡',
    accent: '#facc15',
    tips: [
      '人眼感知面积而非半径，因此半径必须走 scaleSqrt，避免大值被过度放大',
      '颜色使用 d3.scaleSequential 与顺序插值器，与半径共同编码同一指标',
      '可切换真 3D 气泡面（circlePolygon 拉伸）与高性能点集合两种表现'
    ]
  },
  defaults: {
    sizeScale: 1,
    ramp: 'turbo',
    bubble3D: true,
    showLabels: true,
    minPixel: 6,
    seed: 20261006
  },
  camera: { lon: 20, lat: 20, height: 20000000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'sizeScale', label: '半径倍率', min: 0.3, max: 2, step: 0.1 },
    {
      kind: 'select',
      key: 'ramp',
      label: '色带',
      options: [
        { value: 'turbo', label: 'turbo' },
        { value: 'viridis', label: 'viridis' },
        { value: 'spectral', label: 'spectral' },
        { value: 'inferno', label: 'inferno' }
      ]
    },
    { kind: 'checkbox', key: 'bubble3D', label: '3D 气泡面' },
    { kind: 'checkbox', key: 'showLabels', label: '显示数值标签' },
    { kind: 'range', key: 'minPixel', label: '点最小像素', min: 3, max: 14, step: 1 },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const sizeScale = Number(settings.sizeScale)
    const palette = String(settings.ramp)
    const use3D = Boolean(settings.bubble3D)
    const showLabels = Boolean(settings.showLabels)
    const minPixel = Number(settings.minPixel)
    const seed = Number(settings.seed)

    const rng = mulberry32(seed)
    const data = WORLD_HUBS.map((hub) => ({
      ...hub,
      metric: Math.round(hub.value * (0.55 + rng() * 0.9))
    }))
    const metrics = data.map((d) => d.metric)
    const [min, max] = extent(metrics) as [number, number]

    const radiusScale = scaleSqrt().domain([0, max]).range([0, 1])
    const colorScale = scaleSequential(INTERPOLATORS[palette]).domain([min, max])

    const collection = ctx.pointCollection()
    data.forEach((hub) => {
      const ratio = Math.max(0, radiusScale(hub.metric) as number)
      const radius = (40000 + ratio * 460000) * sizeScale
      const color = colorScale(hub.metric)

      if (use3D) {
        addPolygon(ctx.dataSource, circlePolygon(hub.lon, hub.lat, radius, 48), {
          height: radius * 0.12,
          color,
          alpha: 0.5,
          outline: true,
          outlineColor: '#0f172a',
          outlineWidth: 1
        })
      } else {
        addToPointCollection(
          collection,
          hub.lon,
          hub.lat,
          0,
          color,
          Math.max(minPixel, 6 + ratio * 34 * sizeScale)
        )
      }

      addPoint(ctx.dataSource, hub.lon, hub.lat, { pixelSize: 3, color: '#f8fafc', disableDepthTest: true })

      if (showLabels) {
        addLabel(ctx.dataSource, hub.lon, hub.lat, `${hub.name} ${hub.metric}`, {
          font: '11px sans-serif',
          scaleByDistance: [2000000, 0.35, 14000000, 1.2],
          disableDepthTest: true
        })
      }
    })

    ctx.legend([
      { label: palette, color: colorScale(max) },
      { label: `指标 ${min} ~ ${max}（半径 ∝ √值）`, color: colorScale(min) }
    ])
    ctx.status(`全球枢纽 ${data.length} 个气泡，最大半径 ${Math.round(((40000 + 460000) * sizeScale) / 1000)}km`)
  }
}

export default spec
