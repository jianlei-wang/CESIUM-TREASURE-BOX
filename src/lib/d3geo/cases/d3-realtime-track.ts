import { Cartesian3, ConstantPositionProperty, ConstantProperty, PolylineDashMaterialProperty } from 'cesium'
import type { D3CaseSpec } from '../types'
import { mulberry32 } from '../data'
import { categorical } from '../palettes'
import { addLabel, addPoint, toColor } from '../render'

type Track = {
  centerLon: number
  centerLat: number
  ampLon: number
  ampLat: number
  omega: number
  phase: number
  color: string
}

const BOUNDS = { west: 96, south: 22, east: 124, north: 44 }

function buildTracks(count: number, seed: number): Track[] {
  const rng = mulberry32(seed)
  const tracks: Track[] = []
  for (let i = 0; i < count; i += 1) {
    tracks.push({
      centerLon: BOUNDS.west + 2 + rng() * (BOUNDS.east - BOUNDS.west - 4),
      centerLat: BOUNDS.south + 2 + rng() * (BOUNDS.north - BOUNDS.south - 4),
      ampLon: 0.8 + rng() * 2.6,
      ampLat: 0.6 + rng() * 2.2,
      omega: 0.18 + rng() * 0.5,
      phase: rng() * Math.PI * 2,
      color: categorical(i)
    })
  }
  return tracks
}

function positionAt(track: Track, t: number): [number, number] {
  const lon = track.centerLon + track.ampLon * Math.sin(track.omega * t + track.phase)
  const lat = track.centerLat + track.ampLat * Math.sin(track.omega * 0.63 * t + track.phase * 1.7)
  return [lon, lat]
}

function buildTrajectory(track: Track, t: number, seconds: number, steps: number): Cartesian3[] {
  const positions: Cartesian3[] = []
  for (let i = 0; i <= steps; i += 1) {
    const [lon, lat] = positionAt(track, t + (seconds * i) / steps)
    positions.push(Cartesian3.fromDegrees(lon, lat, 0))
  }
  return positions
}

const spec: D3CaseSpec = {
  id: 'd3-realtime-track',
  meta: {
    title: '实时目标追踪',
    subtitle: '周期平滑插值 → onFrame 更新 ConstantPositionProperty + 虚线轨迹预测',
    description: '多个移动目标沿平滑轨迹巡游，实时更新位置并以虚线绘制未来一小段预测航迹。',
    tag: 'D3 实时 · 轨迹预测',
    accent: '#f472b6',
    tips: [
      '位置由周期函数连续采样，保证平移平滑无跳变，速度倍率只改变时间推进速率',
      '每帧用 ConstantPositionProperty 更新实体位置，预测线用 PolylineDashMaterialProperty 呈现',
      '目标颜色取自 d3 分类调色板，数量、速度与预测时长均可在线调节'
    ]
  },
  defaults: {
    targets: 16,
    speed: 1.2,
    showPredict: true,
    predictSec: 90,
    seed: 20261006
  },
  camera: { lon: 110, lat: 33, height: 5200000, pitch: -58 },
  controls: [
    { kind: 'range', key: 'targets', label: '目标数量', min: 4, max: 48, step: 2 },
    { kind: 'range', key: 'speed', label: '速度倍率', min: 0.2, max: 3, step: 0.1, format: (v) => `×${v.toFixed(1)}` },
    { kind: 'checkbox', key: 'showPredict', label: '显示预测轨迹' },
    { kind: 'range', key: 'predictSec', label: '预测时长(s)', min: 20, max: 240, step: 10 },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const count = Number(settings.targets)
    const speed = Number(settings.speed)
    const showPredict = Boolean(settings.showPredict)
    const predictSec = Number(settings.predictSec)

    const tracks = buildTracks(count, Number(settings.seed))
    const items = tracks.map((track, index) => {
      const [lon, lat] = positionAt(track, 0)
      const dot = addPoint(ctx.dataSource, lon, lat, {
        pixelSize: 9,
        color: track.color,
        outlineColor: '#0f172a',
        disableDepthTest: true
      })
      const label = addLabel(ctx.dataSource, lon, lat, `T-${String(index + 1).padStart(2, '0')}`, {
        font: '11px sans-serif',
        color: '#f1f5f9',
        scaleByDistance: [1200000, 0.4, 9000000, 1.3],
        disableDepthTest: true
      })
      const path = showPredict
        ? ctx.dataSource.entities.add({
            polyline: {
              positions: buildTrajectory(track, 0, predictSec, 24),
              width: 2,
              material: new PolylineDashMaterialProperty({ color: toColor(track.color, 0.8), dashLength: 16 })
            }
          })
        : undefined
      return { track, dot, label, path }
    })

    ctx.status(`追踪 ${count} 个目标 · 速度 ×${speed.toFixed(1)} · 预测 ${predictSec}s`)
    ctx.legend([
      { label: `${count} 个移动目标`, color: '#f472b6' },
      { label: showPredict ? `预测轨迹 ${predictSec}s` : '预测轨迹关闭', color: '#38bdf8' }
    ])

    const cancel = ctx.onFrame((time) => {
      const t = (time / 1000) * speed
      for (const item of items) {
        const [lon, lat] = positionAt(item.track, t)
        const position = Cartesian3.fromDegrees(lon, lat, 0)
        item.dot.position = new ConstantPositionProperty(position)
        item.label.position = new ConstantPositionProperty(position)
        if (item.path) {
          item.path.polyline!.positions = new ConstantProperty(buildTrajectory(item.track, t, predictSec, 24))
        }
      }
    })
    ctx.onCleanup(cancel)
  }
}

export default spec
