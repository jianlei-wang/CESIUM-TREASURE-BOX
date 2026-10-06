import type { D3CaseSpec } from '../types'
import { CHINA_CITIES, mulberry32, type CityDatum } from '../data'
import { ramp } from '../palettes'
import { addArc, addLabel, addPoint, addPolygon } from '../render'

type Flow = { from: CityDatum; to: CityDatum; weight: number }

const EAST = CHINA_CITIES.filter((city) => city.lon > 112)
const WEST = CHINA_CITIES.filter((city) => city.lon < 106)

function buildFlows(count: number, seed: number): Flow[] {
  const rng = mulberry32(seed)
  const flows: Flow[] = []
  for (let i = 0; i < count; i += 1) {
    const from = EAST[Math.floor(rng() * EAST.length)]
    const to = WEST[Math.floor(rng() * WEST.length)]
    flows.push({ from, to, weight: 0.25 + rng() * 0.75 })
  }
  return flows
}

const spec: D3CaseSpec = {
  id: 'd3-sankey',
  meta: {
    title: '桑基流带地理化',
    subtitle: '自实现分层流 · 变宽多边形流带',
    description: '把东部到西部的分组流量绘制为可变宽度的地理流带，带宽编码流量强度，起终点锚定真实城市。',
    tag: 'D3 流向分析 · 桑基流带',
    accent: '#22d3ee',
    tips: [
      '未安装 d3-sankey，这里自实现简化分层布局：东部节点为源、西部节点为汇',
      '沿起终点连线采样，用垂直偏移构造左右边界点，拼成变宽流带多边形',
      '带宽按流量权重缩放，中段略微收束后再展开，形成柔和的流带形态'
    ]
  },
  defaults: {
    flowCount: 22,
    bandwidth: 0.7,
    width: 1.6,
    showLabels: true,
    seed: 20261006
  },
  camera: { lon: 110, lat: 32, height: 4200000, pitch: -85 },
  controls: [
    { kind: 'range', key: 'flowCount', label: '流量条数', min: 6, max: 60, step: 2 },
    { kind: 'range', key: 'bandwidth', label: '带宽倍率(°)', min: 0.1, max: 1.6, step: 0.05 },
    { kind: 'range', key: 'width', label: '中心线线宽', min: 0.5, max: 5, step: 0.5 },
    { kind: 'checkbox', key: 'showLabels', label: '显示起终点标签' },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const flowCount = Math.round(Number(ctx.settings.flowCount))
    const bandwidth = Number(ctx.settings.bandwidth)
    const width = Number(ctx.settings.width)
    const showLabels = Boolean(ctx.settings.showLabels)
    const seed = Number(ctx.settings.seed)

    const flows = buildFlows(flowCount, seed)
    const maxWeight = Math.max(...flows.map((flow) => flow.weight), 0.0001)
    const steps = 36
    const endpoints = new Map<string, CityDatum>()

    flows.forEach((flow) => {
      const dx = flow.to.lon - flow.from.lon
      const dy = flow.to.lat - flow.from.lat
      const len = Math.hypot(dx, dy) || 1
      const px = -dy / len
      const py = dx / len
      const ratio = flow.weight / maxWeight
      const half = (ratio * bandwidth) / 2

      const left: Array<[number, number]> = []
      const right: Array<[number, number]> = []
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps
        const taper = 0.3 + 0.7 * Math.sin(Math.PI * t)
        const w = half * taper
        const cx = flow.from.lon + dx * t
        const cy = flow.from.lat + dy * t
        left.push([cx + px * w, cy + py * w])
        right.push([cx - px * w, cy - py * w])
      }
      const ribbon = [...left, ...right.reverse()]

      addPolygon(ctx.dataSource, ribbon, {
        height: 3000,
        color: ramp('plasma', ratio),
        alpha: 0.5,
        outline: false
      })
      addArc(ctx.dataSource, [flow.from.lon, flow.from.lat], [flow.to.lon, flow.to.lat], {
        segments: steps,
        arcHeight: 40000,
        width,
        color: ramp('plasma', ratio),
        alpha: 0.85,
        glow: true,
        glowPower: 0.2
      })

      endpoints.set(flow.from.name, flow.from)
      endpoints.set(flow.to.name, flow.to)
    })

    endpoints.forEach((city) => {
      addPoint(ctx.dataSource, city.lon, city.lat, {
        pixelSize: 6,
        color: '#e2e8f0',
        outlineColor: '#0f172a',
        outlineWidth: 2,
        disableDepthTest: true
      })
      if (showLabels) {
        addLabel(ctx.dataSource, city.lon, city.lat, city.name, {
          font: '11px sans-serif',
          scaleByDistance: [1500000, 0.3, 9000000, 1.3],
          disableDepthTest: true
        })
      }
    })

    ctx.legend([
      { label: 'plasma', color: ramp('plasma', 1) },
      { label: `东部 → 西部 ${flows.length} 条流带`, color: '#22d3ee' }
    ])
    ctx.status(`源节点 ${EAST.length} 个、汇节点 ${WEST.length} 个，绘制 ${flows.length} 条分层流带`)
  }
}

export default spec
