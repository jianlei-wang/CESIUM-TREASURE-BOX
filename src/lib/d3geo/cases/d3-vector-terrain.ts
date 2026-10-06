import { ConstantProperty, HeightReference } from 'cesium'
import type { D3CaseSpec } from '../types'
import { mulberry32 } from '../data'
import { loadWorldTerrain } from '../../cesium-scene'
import { ramp } from '../palettes'
import { addPolygon, addPolyline, type LonLat } from '../render'

const BOUNDS = { west: 102.4, south: 30.1, east: 105.4, north: 31.9 }

type VectorLine = { points: LonLat[]; kind: 'road' | 'river' }

/** 由随机游走生成带自然弯曲的线要素。 */
function makeLine(rng: () => number, start: LonLat, steps: number, step: number, wobble: number): LonLat[] {
  const points: LonLat[] = [start]
  let lon = start[0]
  let lat = start[1]
  let heading = rng() * Math.PI * 2
  for (let i = 0; i < steps; i += 1) {
    heading += (rng() - 0.5) * wobble
    lon += Math.cos(heading) * step
    lat += Math.sin(heading) * step * 0.55
    points.push([lon, lat])
  }
  return points
}

const spec: D3CaseSpec = {
  id: 'd3-vector-terrain',
  meta: {
    title: '矢量数据贴地形渲染',
    subtitle: 'clampToGround 折线 / 贴地矢量面 · Cesium 1.144',
    description: '道路、河流与普查区矢量要素贴合真实地形起伏，验证 1.144 的矢量贴地形能力。',
    tag: 'D3 矢量 · 贴地形',
    accent: '#f59e0b',
    tips: [
      'Cesium 1.144 支持矢量折线 clampToGround，线条随世界地形起伏而不再悬浮',
      '面状普查区通过 HeightReference.CLAMP_TO_GROUND 贴合地表渲染',
      'loadWorldTerrain 异步加载地形，完成后自动更新状态并驱动场景'
    ]
  },
  defaults: {
    showRoads: true,
    showRivers: true,
    showPolygons: true,
    lineWidth: 3,
    polygonAlpha: 0.4,
    seed: 20261006
  },
  camera: { lon: 103.7, lat: 31.1, height: 420000, pitch: -45 },
  controls: [
    { kind: 'checkbox', key: 'showRoads', label: '显示道路' },
    { kind: 'checkbox', key: 'showRivers', label: '显示河流' },
    { kind: 'checkbox', key: 'showPolygons', label: '显示普查区面' },
    { kind: 'range', key: 'lineWidth', label: '线宽', min: 1, max: 10, step: 0.5 },
    { kind: 'range', key: 'polygonAlpha', label: '面透明度', min: 0.1, max: 0.9, step: 0.05 },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const showRoads = Boolean(settings.showRoads)
    const showRivers = Boolean(settings.showRivers)
    const showPolygons = Boolean(settings.showPolygons)
    const lineWidth = Number(settings.lineWidth)
    const polygonAlpha = Number(settings.polygonAlpha)
    const rng = mulberry32(Number(settings.seed))

    if (showPolygons) {
      const cols = 6
      const rows = 5
      const w = (BOUNDS.east - BOUNDS.west) / cols
      const h = (BOUNDS.north - BOUNDS.south) / rows
      for (let c = 0; c < cols; c += 1) {
        for (let r = 0; r < rows; r += 1) {
          const west = BOUNDS.west + c * w
          const south = BOUNDS.south + r * h
          const value = 20 + rng() * 80
          const entity = addPolygon(
            ctx.dataSource,
            [
              [west, south],
              [west + w, south],
              [west + w, south + h],
              [west, south + h]
            ],
            {
              color: ramp('spectral', value / 100),
              alpha: polygonAlpha,
              outline: true,
              outlineColor: '#0f172a',
              outlineWidth: 1
            }
          )
          if (entity.polygon) entity.polygon.heightReference = new ConstantProperty(HeightReference.CLAMP_TO_GROUND)
        }
      }
    }

    const lines: VectorLine[] = []
    for (let i = 0; i < 10; i += 1) {
      const start: LonLat = [
        BOUNDS.west + rng() * (BOUNDS.east - BOUNDS.west),
        BOUNDS.south + rng() * (BOUNDS.north - BOUNDS.south)
      ]
      lines.push({ points: makeLine(rng, start, 14, 0.12, 0.9), kind: 'road' })
    }
    for (let i = 0; i < 5; i += 1) {
      const start: LonLat = [
        BOUNDS.west + rng() * (BOUNDS.east - BOUNDS.west),
        BOUNDS.south + rng() * (BOUNDS.north - BOUNDS.south)
      ]
      lines.push({ points: makeLine(rng, start, 20, 0.1, 0.45), kind: 'river' })
    }

    for (const line of lines) {
      if (line.kind === 'road' && !showRoads) continue
      if (line.kind === 'river' && !showRivers) continue
      addPolyline(ctx.dataSource, line.points, {
        width: line.kind === 'river' ? lineWidth + 1.5 : lineWidth,
        color: line.kind === 'road' ? '#fbbf24' : '#38bdf8',
        alpha: 0.95,
        clampToGround: true
      })
    }

    ctx.legend([
      { label: '道路（贴地折线）', color: '#fbbf24' },
      { label: '河流（贴地折线）', color: '#38bdf8' },
      { label: '普查区（贴地面）', color: ramp('spectral', 0.7) }
    ])
    ctx.status('矢量数据已提交，正在异步加载世界地形…')

    loadWorldTerrain(ctx.viewer)
      .then(() => {
        if (ctx.viewer.isDestroyed()) return
        ctx.status('世界地形加载完成 · 1.144 矢量贴地形：道路/河流 clampToGround，普查区贴地渲染')
      })
      .catch(() => {
        if (ctx.viewer.isDestroyed()) return
        ctx.status('地形加载失败，已退化为椭球面渲染；1.144 贴地形接口调用仍已触发')
      })
  }
}

export default spec
