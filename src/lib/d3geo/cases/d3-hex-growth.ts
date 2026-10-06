import { max, scaleSqrt } from 'd3'
import { ConstantProperty } from 'cesium'
import type { D3CaseContext, D3CaseSpec } from '../types'
import { clusteredPoints } from '../data'
import { hexbin, type HexCell } from '../hex'
import { ramp } from '../palettes'
import { addPolygon } from '../render'

type GrowContext = D3CaseContext & { restartGrowth?: () => void }

const CLUSTERS = [
  { lon: 116.4, lat: 39.9, count: 0.16, spread: 4.6 },
  { lon: 121.5, lat: 31.2, count: 0.14, spread: 4.2 },
  { lon: 113.3, lat: 23.1, count: 0.13, spread: 4.6 },
  { lon: 104.1, lat: 30.6, count: 0.12, spread: 4.4 },
  { lon: 114.3, lat: 30.6, count: 0.1, spread: 4 },
  { lon: 108.9, lat: 34.3, count: 0.09, spread: 4.2 },
  { lon: 126.5, lat: 45.8, count: 0.08, spread: 4.6 },
  { lon: 102.8, lat: 24.9, count: 0.07, spread: 4.4 }
]

const spec: D3CaseSpec = {
  id: 'd3-hex-growth',
  meta: {
    title: '蜂窝时序生长动画',
    subtitle: 'hexbin 聚合 → requestAnimationFrame 逐柱缓动生长',
    description: '按距中心的远近给每根蜂窝柱设置生长延迟与缓动，用每帧更新的拉伸高度表现人口 / 区域增长。',
    tag: 'D3 空间聚合 · 生长动画',
    accent: '#4ade80',
    tips: [
      'hexbin 先把散点聚成蜂窝，计数经 d3.scaleSqrt 映射为目标高度',
      '按单元到质心的距离分配生长延迟，形成由中心向外的生长波',
      'onFrame 内用 easeOutCubic 更新 extrudedHeight，速度滑块可重播'
    ]
  },
  defaults: {
    speed: 1,
    radius: 1.3,
    heightScale: 120000,
    seed: 20261006
  },
  camera: { lon: 104, lat: 34, height: 6200000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'speed', label: '动画速度', min: 0.3, max: 3, step: 0.1 },
    { kind: 'range', key: 'radius', label: '蜂窝半径(°)', min: 0.4, max: 2.5, step: 0.1 },
    { kind: 'range', key: 'heightScale', label: '高度倍率', min: 20000, max: 300000, step: 10000 },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 },
    { kind: 'button', label: '重播生长', onClick: (ctx) => (ctx as GrowContext).restartGrowth?.() }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const radius = Number(settings.radius)
    const heightScale = Number(settings.heightScale)
    const seed = Number(settings.seed)

    const total = 52000
    const points = clusteredPoints(
      CLUSTERS.map((c) => ({ lon: c.lon, lat: c.lat, count: Math.floor(total * c.count), spread: c.spread })),
      seed
    )

    const cells = hexbin(points, radius, 34)
    const maxCount = max(cells, (c: HexCell) => c.count) ?? 1
    const height = scaleSqrt([0, maxCount], [0, 1])

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
      const ratio = height(cell.count) ?? 0
      const dist = Math.hypot(cell.center[0] - cx, cell.center[1] - cy) / maxDist
      const entity = addPolygon(ctx.dataSource, cell.polygon, {
        height: 0,
        extrudedHeight: 400,
        color: ramp('viridis', ratio),
        alpha: 0.9,
        outline: true,
        outlineColor: '#0f172a',
        outlineWidth: 1
      })
      return { entity, ratio, delay: dist * 0.5 }
    })

    const targetContext = ctx as GrowContext
    let startAt = 0
    let lastPercent = -1

    targetContext.restartGrowth = () => {
      startAt = 0
      lastPercent = -1
    }

    ctx.status(`蜂窝 ${cells.length} 个，等待生长…`)
    ctx.legend([
      { label: 'viridis', color: ramp('viridis', 1) },
      { label: `${cells.length} 个蜂窝单元`, color: '#4ade80' }
    ])

    const duration = 2400
    ctx.onFrame((time) => {
      if (startAt === 0) {
        startAt = time
        return
      }
      const dynamicSpeed = Number(ctx.settings.speed)
      const progress = ((time - startAt) * dynamicSpeed) / duration
      let done = true
      for (const item of items) {
        const local = Math.min(1, Math.max(0, progress * 1.6 - item.delay))
        const eased = 1 - Math.pow(1 - local, 3)
        const h = Math.max(400, item.ratio * heightScale * eased)
        if (item.entity.polygon) item.entity.polygon.extrudedHeight = new ConstantProperty(h)
        if (local < 1) done = false
      }
      const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100)
      if (percent !== lastPercent && percent < 100) {
        lastPercent = percent
        ctx.status(`生长中… ${percent}%`)
      }
      if (done && lastPercent !== 100) {
        lastPercent = 100
        ctx.status(`生长完成：${cells.length} 个蜂窝单元，峰值计数 ${maxCount}`)
      }
    })
  }
}

export default spec
