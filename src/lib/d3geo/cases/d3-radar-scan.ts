import { CallbackProperty, Cartesian3, Math as CesiumMath } from 'cesium'
import type { D3CaseSpec } from '../types'
import { mulberry32 } from '../data'
import { addLabel, addPoint, addPolyline, addPulseRing, toColor } from '../render'

type Target = { lon: number; lat: number; angle: number; hit: boolean }

const CENTER = { lon: 116.407, lat: 39.904 }
const METER_PER_DEG_LAT = 110540

const spec: D3CaseSpec = {
  id: 'd3-radar-scan',
  meta: {
    title: '扫描圈 / 雷达波特效',
    subtitle: 'PulseRing 扩散圆环 + ctx.onFrame 旋转扫描线',
    description: '以目标站为中心扩散雷达波，旋转扫描线掠过目标点时高亮命中，营造实时监视感。',
    tag: 'D3 动效 · 雷达扫描',
    accent: '#22d3ee',
    tips: [
      'addPulseRing 生成周期扩散的圆环，半径随时间节拍由 0 增至最大',
      '扫描线用 CallbackProperty 承载端点，onFrame 只更新角度，避免每帧重建实体',
      '目标命中判定比较扫描角与目标方位角，命中时切换颜色形成反馈'
    ]
  },
  defaults: {
    period: 2400,
    maxRadius: 120000,
    color: '#22d3ee',
    targets: 12,
    seed: 20261006
  },
  camera: { lon: 116.407, lat: 39.904, height: 520000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'period', label: '扫描周期(ms)', min: 800, max: 6000, step: 200 },
    { kind: 'range', key: 'maxRadius', label: '最大半径(m)', min: 20000, max: 300000, step: 10000 },
    { kind: 'color', key: 'color', label: '扫描颜色' },
    { kind: 'range', key: 'targets', label: '目标数量', min: 3, max: 30, step: 1 },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const period = Number(settings.period)
    const maxRadius = Number(settings.maxRadius)
    const color = String(settings.color)
    const targetCount = Number(settings.targets)
    const seed = Number(settings.seed)

    const latRad = CesiumMath.toRadians(CENTER.lat)
    const rLonDeg = maxRadius / (111320 * (Math.cos(latRad) || 0.01))
    const rLatDeg = maxRadius / METER_PER_DEG_LAT

    ;[1, 0.66, 0.45].forEach((factor, i) => {
      addPulseRing(ctx.dataSource, CENTER.lon, CENTER.lat, {
        color,
        maxRadius,
        period: period * factor + i * 60,
        width: 2.6 - i * 0.6
      })
    })

    addPoint(ctx.dataSource, CENTER.lon, CENTER.lat, {
      pixelSize: 12,
      color: '#f8fafc',
      outlineColor: '#0f172a',
      disableDepthTest: true
    })
    addLabel(ctx.dataSource, CENTER.lon, CENTER.lat, '雷达站', {
      font: '13px sans-serif',
      color: '#e2e8f0',
      disableDepthTest: true
    })

    const rng = mulberry32(seed)
    const targets: Target[] = []
    for (let i = 0; i < targetCount; i += 1) {
      const angle = rng() * Math.PI * 2
      const radius = Math.sqrt(rng()) * maxRadius * 0.94
      const lon = CENTER.lon + (Math.cos(angle) * radius) / (111320 * (Math.cos(latRad) || 0.01))
      const lat = CENTER.lat + (Math.sin(angle) * radius) / METER_PER_DEG_LAT
      const target: Target = { lon, lat, angle, hit: false }
      const entity = addPoint(ctx.dataSource, lon, lat, {
        pixelSize: 8,
        color: '#64748b',
        disableDepthTest: true
      })
      if (entity.point) {
        entity.point.color = new CallbackProperty(
          () => toColor(target.hit ? '#f87171' : '#64748b'),
          false
        )
      }
      targets.push(target)
    }

    const state = { angle: 0 }
    const scan = addPolyline(
      ctx.dataSource,
      [
        [CENTER.lon, CENTER.lat],
        [CENTER.lon + rLonDeg, CENTER.lat]
      ],
      { width: 3, color, glow: true, glowPower: 0.3 }
    )
    if (scan.polyline) {
      scan.polyline.positions = new CallbackProperty(
        () => [
          Cartesian3.fromDegrees(CENTER.lon, CENTER.lat, 120),
          Cartesian3.fromDegrees(
            CENTER.lon + Math.cos(state.angle) * rLonDeg,
            CENTER.lat + Math.sin(state.angle) * rLatDeg,
            120
          )
        ],
        false
      )
    }

    const angularDistance = (a: number, b: number) => {
      const diff = Math.abs(((a - b) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2))
      return Math.min(diff, Math.PI * 2 - diff)
    }

    ctx.onFrame((time) => {
      state.angle = (((time % period) + period) % period) / period * Math.PI * 2
      let hits = 0
      targets.forEach((target) => {
        const hit = angularDistance(state.angle, target.angle) < 0.32
        target.hit = hit
        if (hit) hits += 1
      })
      if (hits > 0) ctx.status(`扫描中：${time.toFixed(0)}ms，命中 ${hits}/${targets.length} 个目标`)
      else ctx.status(`扫描中：方位 ${(CesiumMath.toDegrees(state.angle) % 360).toFixed(0)}°，目标 ${targets.length} 个`)
    })

    ctx.legend([
      { label: '扫描波', color },
      { label: '普通目标', color: '#64748b' },
      { label: '命中目标', color: '#f87171' }
    ])
    ctx.status(`雷达站已部署，目标 ${targets.length} 个，周期 ${period}ms`)
  }
}

export default spec
