import { max, scaleSqrt } from 'd3'
import { ColorMaterialProperty, ConstantProperty } from 'cesium'
import type { D3CaseSpec } from '../types'
import { clusteredPoints } from '../data'
import { hexbin, type HexCell } from '../hex'
import { mixHex, ramp } from '../palettes'
import { addPolygon, toColor } from '../render'

const CLUSTERS = [
  { lon: 116.4, lat: 39.9, count: 0.17, spread: 4.6 },
  { lon: 121.5, lat: 31.2, count: 0.15, spread: 4.2 },
  { lon: 113.3, lat: 23.1, count: 0.14, spread: 4.6 },
  { lon: 104.1, lat: 30.6, count: 0.12, spread: 4.4 },
  { lon: 114.3, lat: 30.6, count: 0.1, spread: 4 },
  { lon: 108.9, lat: 34.3, count: 0.09, spread: 4.2 },
  { lon: 126.5, lat: 45.8, count: 0.08, spread: 4.6 },
  { lon: 102.8, lat: 24.9, count: 0.07, spread: 4.4 }
]

const spec: D3CaseSpec = {
  id: 'd3-hex-ripple',
  meta: {
    title: '蜂窝扫描 / 波纹特效',
    subtitle: 'hexbin 聚合 · onFrame 调制 extrudedHeight 与 material',
    description: '以中心为源向外传播的波纹逐格调制蜂窝柱高与颜色，形成雷达扫描式的高亮扫过效果。',
    tag: 'D3 空间聚合 · 波纹特效',
    accent: '#22d3ee',
    tips: [
      '按单元到中心的归一化距离设置相位，波前由内向外推进',
      '每帧用 ConstantProperty 重设 extrudedHeight、用 ColorMaterialProperty 刷新颜色',
      'mixHex 在基色与高亮色间插值，颜色与高度随同一波函数同步脉动'
    ]
  },
  defaults: {
    frequency: 3,
    speed: 1.2,
    radius: 1.2,
    heightScale: 110000,
    ramp: 'coolwarm',
    seed: 20261006
  },
  camera: { lon: 104, lat: 34, height: 6200000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'frequency', label: '波纹频率(圈)', min: 0.5, max: 6, step: 0.5 },
    { kind: 'range', key: 'speed', label: '传播速度', min: 0.2, max: 3, step: 0.1 },
    { kind: 'range', key: 'radius', label: '蜂窝半径(°)', min: 0.5, max: 2.5, step: 0.1 },
    { kind: 'range', key: 'heightScale', label: '柱高倍率', min: 20000, max: 300000, step: 10000 },
    {
      kind: 'select',
      key: 'ramp',
      label: '基色色带',
      options: [
        { value: 'coolwarm', label: 'coolwarm' },
        { value: 'viridis', label: 'viridis' },
        { value: 'inferno', label: 'inferno' },
        { value: 'turbo', label: 'turbo' }
      ]
    },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const radius = Number(settings.radius)
    const heightScale = Number(settings.heightScale)
    const palette = String(settings.ramp)
    const seed = Number(settings.seed)

    const total = 48000
    const points = clusteredPoints(
      CLUSTERS.map((c) => ({ lon: c.lon, lat: c.lat, count: Math.floor(total * c.count), spread: c.spread })),
      seed
    )

    const cells = hexbin(points, radius, 34)
    const maxCount = max(cells, (c: HexCell) => c.count) ?? 1
    const scale = scaleSqrt([0, maxCount], [0, 1])

    let cx = 0
    let cy = 0
    for (const cell of cells) {
      cx += cell.center[0]
      cy += cell.center[1]
    }
    cx /= cells.length || 1
    cy /= cells.length || 1

    let maxDist = 0.0001
    for (const cell of cells) {
      maxDist = Math.max(maxDist, Math.hypot(cell.center[0] - cx, cell.center[1] - cy))
    }

    const items = cells.map((cell) => {
      const ratio = scale(cell.count) ?? 0
      const dist = Math.hypot(cell.center[0] - cx, cell.center[1] - cy) / maxDist
      const target = Math.max(2000, ratio * heightScale)
      const baseColor = ramp(palette, ratio)
      const entity = addPolygon(ctx.dataSource, cell.polygon, {
        height: 0,
        extrudedHeight: target,
        color: baseColor,
        alpha: 0.9,
        outline: true,
        outlineColor: '#0f172a',
        outlineWidth: 1
      })
      return { entity, target, dist, baseColor }
    })

    ctx.legend([
      { label: palette, color: ramp(palette, 1) },
      { label: `${cells.length} 个蜂窝 · 中心波纹`, color: '#22d3ee' }
    ])
    ctx.status(`蜂窝 ${cells.length} 个，波纹由中心向外传播 · 频率 ${Number(settings.frequency)} 圈`)

    ctx.onFrame((time) => {
      const frequency = Number(ctx.settings.frequency)
      const speed = Number(ctx.settings.speed)
      const t = time / 1000
      for (const item of items) {
        const wave = 0.5 + 0.5 * Math.sin(t * speed * Math.PI * 2 - item.dist * frequency * Math.PI * 2)
        const boost = Math.pow(wave, 2.2)
        const height = Math.max(400, item.target * (0.3 + boost))
        if (item.entity.polygon) {
          item.entity.polygon.extrudedHeight = new ConstantProperty(height)
          item.entity.polygon.material = new ColorMaterialProperty(toColor(mixHex(item.baseColor, '#ffffff', boost * 0.8), 0.9))
        }
      }
    })
  }
}

export default spec
