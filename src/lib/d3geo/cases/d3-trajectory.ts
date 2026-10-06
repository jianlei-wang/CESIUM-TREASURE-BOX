import { range, scaleLinear } from 'd3'
import { Cartesian3, ConstantPositionProperty, ConstantProperty } from 'cesium'
import type { D3CaseSpec } from '../types'
import { mulberry32 } from '../data'
import { ramp } from '../palettes'
import { addLabel, addPoint, addPolyline, addToPointCollection } from '../render'

type Sample = { lon: number; lat: number; speed: number }

const MAX_TAIL = 40

function buildTrack(total: number, seed: number): Sample[] {
  const rng = mulberry32(seed)
  const samples: Sample[] = []
  let lon = 106
  let lat = 31
  let heading = rng() * Math.PI * 2
  for (let i = 0; i < total; i += 1) {
    heading += (rng() - 0.5) * 0.55
    const speed = 0.5 + Math.abs(Math.sin(i * 0.05)) * 1.1 + rng() * 0.2
    lon += Math.cos(heading) * 0.3 * speed
    lat += Math.sin(heading) * 0.22 * speed
    samples.push({ lon, lat, speed })
  }
  return samples
}

const spec: D3CaseSpec = {
  id: 'd3-trajectory',
  meta: {
    title: '时空轨迹回放',
    subtitle: 'd3 采样轨迹 · 速度加权时间轴回放',
    description: '生成带速度变化的采样轨迹，沿完整航线回放移动目标，并用渐隐尾迹还原运动过程。',
    tag: 'D3 时空数据 · 轨迹回放',
    accent: '#fb923c',
    tips: [
      '每段轨迹按「段长 / 速度」累加为时间轴，回放时快慢差异真实可见',
      '位置由采样点线性插值得到，逐帧用 ConstantPositionProperty 更新移动目标',
      '尾迹预生成多条短折线，越靠后的段透明度越低，形成渐隐拖尾'
    ]
  },
  defaults: {
    sampleCount: 420,
    speed: 6,
    tailLength: 18,
    showTail: true,
    seed: 20261006
  },
  camera: { lon: 106, lat: 31, height: 2600000, pitch: -80 },
  controls: [
    { kind: 'range', key: 'sampleCount', label: '轨迹采样数', min: 120, max: 900, step: 20 },
    { kind: 'range', key: 'speed', label: '回放速度', min: 1, max: 30, step: 1 },
    { kind: 'range', key: 'tailLength', label: '尾迹长度', min: 0, max: MAX_TAIL, step: 1 },
    { kind: 'checkbox', key: 'showTail', label: '显示渐隐尾迹' },
    { kind: 'range', key: 'seed', label: '轨迹种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const total = Math.round(Number(ctx.settings.sampleCount))
    const speedFactor = Number(ctx.settings.speed)
    const tailLength = Math.round(Number(ctx.settings.tailLength))
    const showTail = Boolean(ctx.settings.showTail)
    const seed = Number(ctx.settings.seed)

    const samples = buildTrack(total, seed)
    const times: number[] = [0]
    for (let i = 1; i < samples.length; i += 1) {
      const a = samples[i - 1]
      const b = samples[i]
      const seg = Math.hypot(b.lon - a.lon, b.lat - a.lat)
      const avgSpeed = Math.max(0.1, (a.speed + b.speed) / 2)
      times.push(times[i - 1] + seg / avgSpeed)
    }
    const totalTime = times[times.length - 1] || 1

    const route = samples.map((s): [number, number, number] => [s.lon, s.lat, 1200])
    addPolyline(ctx.dataSource, route, { width: 2.4, color: '#38bdf8', alpha: 0.7, glow: true, glowPower: 0.2 })

    const collection = ctx.pointCollection()
    samples.forEach((s) => addToPointCollection(collection, s.lon, s.lat, 600, '#64748b', 2))

    const marker = addPoint(ctx.dataSource, samples[0].lon, samples[0].lat, {
      pixelSize: 12,
      color: '#fb923c',
      outlineColor: '#0f172a',
      outlineWidth: 2,
      disableDepthTest: true
    })
    const markerLabel = addLabel(ctx.dataSource, samples[0].lon, samples[0].lat, '', {
      font: '12px sans-serif',
      color: '#fdba74',
      disableDepthTest: true
    })

    const tailColor = scaleLinear([0, MAX_TAIL], [1, 0])
    const tailEntities = (range(MAX_TAIL) as number[]).map((k: number) => {
      const entity = addPolyline(
        ctx.dataSource,
        [
          [samples[0].lon, samples[0].lat],
          [samples[0].lon, samples[0].lat]
        ],
        {
          width: 4,
          color: ramp('sunset', tailColor(k) ?? 0),
          alpha: 0.9 - (k / MAX_TAIL) * 0.85,
          glow: true,
          glowPower: 0.25
        }
      )
      entity.show = false
      return entity
    })

    const locate = (t: number): { sample: Sample; index: number } => {
      const clamped = Math.max(0, Math.min(t, totalTime))
      let index = 0
      while (index < times.length - 2 && times[index + 1] < clamped) index += 1
      const span = times[index + 1] - times[index] || 1
      const frac = (clamped - times[index]) / span
      const a = samples[index]
      const b = samples[Math.min(index + 1, samples.length - 1)]
      return {
        sample: {
          lon: a.lon + (b.lon - a.lon) * frac,
          lat: a.lat + (b.lat - a.lat) * frac,
          speed: a.speed + (b.speed - a.speed) * frac
        },
        index
      }
    }

    let elapsed = 0
    let lastIndex = 0
    const renderFrame = () => {
      const { sample, index } = locate(elapsed)
      lastIndex = index
      marker.position = new ConstantPositionProperty(Cartesian3.fromDegrees(sample.lon, sample.lat, 2200))
      markerLabel.position = new ConstantPositionProperty(Cartesian3.fromDegrees(sample.lon, sample.lat, 16000))
      if (markerLabel.label) markerLabel.label.text = new ConstantProperty(`速度 ${sample.speed.toFixed(2)}`)

      tailEntities.forEach((entity, k) => {
        const head = lastIndex - k
        const tail = head - 1
        const active = showTail && k < tailLength && tail >= 0 && head >= 0 && head < samples.length
        entity.show = active
        if (!active || !entity.polyline) return
        const a = samples[tail]
        const b = samples[head]
        entity.polyline.positions = new ConstantProperty([
          Cartesian3.fromDegrees(a.lon, a.lat, 1800),
          Cartesian3.fromDegrees(b.lon, b.lat, 1800)
        ])
      })
    }

    renderFrame()
    ctx.onFrame((_time, delta) => {
      elapsed += (delta / 1000) * speedFactor
      if (elapsed > totalTime) elapsed = 0
      renderFrame()
    })

    ctx.legend([
      { label: 'sunset', color: ramp('sunset', 1) },
      { label: `轨迹 ${samples.length} 点 · 总时长 ${totalTime.toFixed(1)}`, color: '#fb923c' }
    ])
    ctx.status(`时空轨迹：${samples.length} 个采样点，尾迹 ${showTail ? tailLength : 0} 段，回放速度 ${speedFactor}×`)
  }
}

export default spec
