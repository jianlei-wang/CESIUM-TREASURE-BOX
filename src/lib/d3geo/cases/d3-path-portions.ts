import { extent } from 'd3'
import type { D3CaseSpec } from '../types'
import { mulberry32 } from '../data'
import { addLabel, addPoint, addPolyline } from '../render'

type TrackSample = { lon: number; lat: number; ratio: number }

const FAST_COLOR = '#ef4444'
const SLOW_COLOR = '#3b82f6'

function buildTrack(count: number, amp: number, seed: number): TrackSample[] {
  const rng = mulberry32(seed)
  const raw: Array<{ lon: number; lat: number; speed: number }> = []
  let lon = 104
  let lat = 30
  let heading = rng() * Math.PI * 2
  const phase = rng() * Math.PI * 2
  for (let i = 0; i < count; i += 1) {
    heading += (rng() - 0.5) * 0.5
    const speed = 0.5 + amp * (0.5 + 0.5 * Math.sin(i * 0.12 + phase)) + rng() * 0.12 * amp
    lon += Math.cos(heading) * speed * 0.28
    lat += Math.sin(heading) * speed * 0.2
    raw.push({ lon, lat, speed })
  }
  const [min, max] = extent(raw, (d: { speed: number }) => d.speed) as [number, number]
  const span = max - min || 1
  return raw.map((d) => ({ lon: d.lon, lat: d.lat, ratio: (d.speed - min) / span }))
}

const spec: D3CaseSpec = {
  id: 'd3-path-portions',
  meta: {
    title: '分段轨迹材质',
    subtitle: '速度阈值分段 · 多段 Polyline 分类着色',
    description: '按速度阈值把轨迹切成多段，快段用红色、慢段用蓝色分别渲染，直观呈现运动状态变化。',
    tag: 'D3 轨迹分段 · 状态着色',
    accent: '#ef4444',
    tips: [
      '先归一化每个采样点的速度值，再用阈值把相邻点之间的段分成快 / 慢两类',
      '每段独立生成一条 Polyline，颜色与阈值绑定，切换阈值即时重算整条轨迹',
      '速度波动幅度可调，波动越大快慢交替越频繁，分段纹理越明显'
    ]
  },
  defaults: {
    sampleCount: 280,
    threshold: 0.55,
    lineWidth: 3,
    amp: 0.8,
    seed: 20261006
  },
  camera: { lon: 108, lat: 30, height: 2600000, pitch: -82 },
  controls: [
    { kind: 'range', key: 'sampleCount', label: '采样点数', min: 80, max: 600, step: 20 },
    { kind: 'range', key: 'threshold', label: '分段阈值', min: 0, max: 1, step: 0.05 },
    { kind: 'range', key: 'lineWidth', label: '线宽', min: 1, max: 8, step: 0.5 },
    { kind: 'range', key: 'amp', label: '速度波动幅度', min: 0, max: 1, step: 0.05 },
    { kind: 'range', key: 'seed', label: '轨迹种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const count = Math.round(Number(ctx.settings.sampleCount))
    const threshold = Number(ctx.settings.threshold)
    const lineWidth = Number(ctx.settings.lineWidth)
    const amp = Number(ctx.settings.amp)
    const seed = Number(ctx.settings.seed)

    const samples = buildTrack(count, amp, seed)
    let fast = 0
    let slow = 0

    for (let i = 0; i < samples.length - 1; i += 1) {
      const a = samples[i]
      const b = samples[i + 1]
      const value = (a.ratio + b.ratio) / 2
      const isFast = value >= threshold
      if (isFast) fast += 1
      else slow += 1
      addPolyline(
        ctx.dataSource,
        [
          [a.lon, a.lat, 1500],
          [b.lon, b.lat, 1500]
        ],
        { width: lineWidth, color: isFast ? FAST_COLOR : SLOW_COLOR, alpha: 0.95, glow: true, glowPower: 0.2 }
      )
    }

    const start = samples[0]
    const end = samples[samples.length - 1]
    addPoint(ctx.dataSource, start.lon, start.lat, { pixelSize: 10, color: '#22c55e', disableDepthTest: true })
    addLabel(ctx.dataSource, start.lon, start.lat, '起点', { font: '12px sans-serif', disableDepthTest: true })
    addPoint(ctx.dataSource, end.lon, end.lat, { pixelSize: 10, color: '#e2e8f0', disableDepthTest: true })
    addLabel(ctx.dataSource, end.lon, end.lat, '终点', { font: '12px sans-serif', disableDepthTest: true })

    ctx.legend([
      { label: `快（≥ ${threshold.toFixed(2)}）`, color: FAST_COLOR },
      { label: `慢（< ${threshold.toFixed(2)}）`, color: SLOW_COLOR }
    ])
    ctx.status(`轨迹 ${samples.length} 点：快段 ${fast} 段 / 慢段 ${slow} 段，线宽 ${lineWidth}`)
  }
}

export default spec
