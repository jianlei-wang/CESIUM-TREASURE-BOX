import { max, scaleSqrt } from 'd3'
import { cellToBoundary, latLngToCell } from 'h3-js'
import type { D3CaseSpec } from '../types'
import { clusteredPoints } from '../data'
import { ramp } from '../palettes'
import { addPolygon } from '../render'

const CLUSTERS = [
  { lon: 116.4, lat: 39.9, count: 0.16, spread: 4.4 },
  { lon: 121.5, lat: 31.2, count: 0.14, spread: 4 },
  { lon: 113.3, lat: 23.1, count: 0.13, spread: 4.4 },
  { lon: 104.1, lat: 30.6, count: 0.12, spread: 4.2 },
  { lon: 114.3, lat: 30.6, count: 0.1, spread: 3.8 },
  { lon: 108.9, lat: 34.3, count: 0.09, spread: 4 },
  { lon: 126.5, lat: 45.8, count: 0.08, spread: 4.4 },
  { lon: 102.8, lat: 24.9, count: 0.07, spread: 4.2 }
]

function resForHeight(height: number): number {
  if (height > 9000000) return 1
  if (height > 5000000) return 2
  if (height > 2500000) return 3
  if (height > 1200000) return 4
  if (height > 600000) return 5
  return 6
}

const spec: D3CaseSpec = {
  id: 'd3-lod-hex',
  meta: {
    title: '多尺度 LOD 蜂窝切换',
    subtitle: 'h3-js 分级网格 · camera.changed 驱动分辨率切换',
    description: '监听相机变化，按视高自动选择 H3 分辨率重建蜂窝聚合，在缩放间平滑切换统计粒度。',
    tag: 'D3 空间聚合 · LOD',
    accent: '#38bdf8',
    tips: [
      'h3.latLngToCell 按分辨率把散点归入分级六边形，cellToBoundary 取得边界',
      '监听 viewer.camera.changed，根据相机高度映射到合适分辨率并及时重建',
      'onCleanup 中移除事件监听，避免重建后残留回调'
    ]
  },
  defaults: {
    autoLod: true,
    resolution: 4,
    points: 45000,
    heightScale: 90000,
    seed: 20261006
  },
  camera: { lon: 104, lat: 34, height: 6200000, pitch: -90 },
  controls: [
    { kind: 'checkbox', key: 'autoLod', label: '自动 LOD 切换' },
    { kind: 'range', key: 'resolution', label: '手动分辨率 res', min: 0, max: 7, step: 1 },
    { kind: 'range', key: 'points', label: '散点数量', min: 5000, max: 80000, step: 5000, format: (v) => v.toLocaleString() },
    { kind: 'range', key: 'heightScale', label: '柱高倍率', min: 10000, max: 250000, step: 10000 },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const autoLod = Boolean(settings.autoLod)
    const manualRes = Math.round(Number(settings.resolution))
    const total = Number(settings.points)
    const heightScale = Number(settings.heightScale)
    const seed = Number(settings.seed)
    const viewer = ctx.viewer

    const points = clusteredPoints(
      CLUSTERS.map((c) => ({ lon: c.lon, lat: c.lat, count: Math.floor(total * c.count), spread: c.spread })),
      seed
    )

    let currentRes = -1
    const renderRes = (res: number) => {
      currentRes = res
      ctx.dataSource.entities.removeAll()
      const buckets = new Map<string, number>()
      for (const [lon, lat] of points) {
        const cell = latLngToCell(lat, lon, res)
        buckets.set(cell, (buckets.get(cell) ?? 0) + 1)
      }
      const maxCount = max([...buckets.values()], (v: number) => v) ?? 1
      const scale = scaleSqrt([0, maxCount], [0, 1])
      const rings: Array<{ count: number; ring: Array<[number, number]> }> = []
      for (const [cell, cellCount] of buckets) {
        const ring = cellToBoundary(cell).map((c) => [c[1], c[0]] as [number, number])
        rings.push({ count: cellCount, ring })
      }
      rings.sort((a, b) => a.count - b.count)
      for (const item of rings) {
        const ratio = scale(item.count) ?? 0
        addPolygon(ctx.dataSource, item.ring, {
          height: 100,
          extrudedHeight: Math.max(1500, ratio * heightScale),
          color: ramp('coolwarm', ratio),
          alpha: 0.85,
          outline: true,
          outlineColor: '#0f172a',
          outlineWidth: 1
        })
      }
      const cameraKm = viewer.camera.positionCartographic.height / 1000
      ctx.status(`当前 H3 分辨率 res=${res} · ${buckets.size} 个单元 · 相机高度 ${cameraKm.toFixed(0)} km`)
      ctx.legend([
        { label: 'coolwarm', color: ramp('coolwarm', 1) },
        { label: `${autoLod ? '自动 LOD' : '手动'} · res ${res}`, color: '#38bdf8' }
      ])
    }

    viewer.camera.percentageChanged = 0.01
    const onCameraChanged = () => {
      if (!autoLod) return
      const res = resForHeight(viewer.camera.positionCartographic.height)
      if (res !== currentRes) renderRes(res)
    }
    viewer.camera.changed.addEventListener(onCameraChanged)
    ctx.onCleanup(() => {
      viewer.camera.changed.removeEventListener(onCameraChanged)
    })

    renderRes(autoLod ? resForHeight(viewer.camera.positionCartographic.height) : manualRes)
  }
}

export default spec
