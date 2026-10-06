import { Cartesian3, ConstantPositionProperty } from 'cesium'
import type { D3CaseSpec } from '../types'
import { WORLD_HUBS, mulberry32 } from '../data'
import { ramp } from '../palettes'
import { addArc, addPoint, addLabel } from '../render'

type Flow = { from: (typeof WORLD_HUBS)[number]; to: (typeof WORLD_HUBS)[number]; weight: number }

function buildFlows(count: number, seed: number): Flow[] {
  const rng = mulberry32(seed)
  const flows: Flow[] = []
  for (let i = 0; i < count; i += 1) {
    const from = WORLD_HUBS[Math.floor(rng() * WORLD_HUBS.length)]
    let to = WORLD_HUBS[Math.floor(rng() * WORLD_HUBS.length)]
    if (to === from) to = WORLD_HUBS[(WORLD_HUBS.indexOf(from) + 1) % WORLD_HUBS.length]
    flows.push({ from, to, weight: 0.2 + rng() * 0.8 })
  }
  return flows
}

const spec: D3CaseSpec = {
  id: 'd3-flow-arc',
  meta: {
    title: '全球流量流向弧线图',
    subtitle: 'd3 插值 → 大地测量弧线 + 流动光点',
    description: '贸易、航空、资金流以弧形光带呈现，方向与强度由颜色、线宽与流动光点编码。',
    tag: 'D3 流场 · 弧线流向',
    accent: '#f472b6',
    tips: [
      '沿球面插值生成弧线顶点，按 sin(πt) 抬升形成悬空光带',
      '线宽与颜色由 d3 比例尺按流量权重映射',
      '流动光点使用每帧更新的 ConstantPositionProperty，方向感明确'
    ]
  },
  defaults: {
    flows: 60,
    arcHeight: 900000,
    width: 2.2,
    animate: true,
    seed: 20261006
  },
  camera: { lon: 40, lat: 20, height: 20000000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'flows', label: '弧线数量', min: 10, max: 160, step: 5 },
    { kind: 'range', key: 'arcHeight', label: '抬升高度', min: 100000, max: 3000000, step: 100000 },
    { kind: 'range', key: 'width', label: '线宽', min: 0.5, max: 8, step: 0.5 },
    { kind: 'checkbox', key: 'animate', label: '流动光点动画' },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const flows = buildFlows(Number(settings.flows), Number(settings.seed))
    const arcHeight = Number(settings.arcHeight)
    const width = Number(settings.width)
    const animate = Boolean(settings.animate)

    const dots = flows.map((flow) => {
      const entity = addPoint(ctx.dataSource, flow.from.lon, flow.from.lat, {
        pixelSize: 6,
        color: '#fef08a',
        disableDepthTest: true
      })
      return { flow, entity, offset: Math.random() }
    })

    flows.forEach((flow) => {
      const color = ramp('plasma', flow.weight)
      addArc(ctx.dataSource, [flow.from.lon, flow.from.lat], [flow.to.lon, flow.to.lat], {
        segments: 48,
        arcHeight: arcHeight * flow.weight,
        width: width * (0.6 + flow.weight),
        color,
        alpha: 0.75,
        glow: true,
        glowPower: 0.18
      })
    })

    WORLD_HUBS.forEach((hub) => {
      addPoint(ctx.dataSource, hub.lon, hub.lat, { pixelSize: 7, color: '#e2e8f0', outlineColor: '#0f172a' })
      addLabel(ctx.dataSource, hub.lon, hub.lat, hub.name, {
        font: '11px sans-serif',
        scaleByDistance: [2000000, 0.4, 12000000, 1.2],
        disableDepthTest: true
      })
    })

    ctx.legend([
      { label: 'plasma', color: ramp('plasma', 1) },
      { label: `共 ${flows.length} 条流向`, color: '#f472b6' }
    ])
    ctx.status(`全球枢纽 ${WORLD_HUBS.length} 个，流向弧线 ${flows.length} 条`)

    if (animate) {
      const period = 4200
      ctx.onFrame((time) => {
        for (const dot of dots) {
          const u = ((time / period + dot.offset) % 1 + 1) % 1
          const { from, to } = dot.flow
          const lon = from.lon + (to.lon - from.lon) * u
          const lat = from.lat + (to.lat - from.lat) * u
          const height = Math.sin(Math.PI * u) * arcHeight * dot.flow.weight
          dot.entity.position = new ConstantPositionProperty(Cartesian3.fromDegrees(lon, lat, height))
        }
      })
    }
  }
}

export default spec
