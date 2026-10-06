import { max, scaleSqrt } from 'd3'
import { Cartographic, Math as CesiumMath } from 'cesium'
import type { D3CaseSpec } from '../types'
import { clusteredPoints } from '../data'
import { hexbin, type HexCell } from '../hex'
import { ramp } from '../palettes'
import { addPolygon, addPolyline } from '../render'
import { loadWorldTerrain } from '../../cesium-scene'

const CLUSTERS = [
  { lon: 116.4, lat: 39.9, count: 0.2, spread: 3.4 },
  { lon: 103.8, lat: 31.1, count: 0.16, spread: 3.6 },
  { lon: 113.3, lat: 23.1, count: 0.15, spread: 3.4 },
  { lon: 114.3, lat: 30.6, count: 0.13, spread: 3 },
  { lon: 108.9, lat: 34.3, count: 0.12, spread: 3.2 },
  { lon: 102.8, lat: 24.9, count: 0.11, spread: 3.6 },
  { lon: 121.5, lat: 31.2, count: 0.13, spread: 3 }
]

const spec: D3CaseSpec = {
  id: 'd3-clamped-hex',
  meta: {
    title: '地形贴合蜂窝柱（Cesium 1.144）',
    subtitle: 'loadWorldTerrain + globe.getHeight 顶点采样 · perPositionHeight',
    description: '对每个蜂窝顶点用 globe.getHeight 采样地形高程，以带高度值的 addPolygon 贴合地表，并按计数抬升柱顶。',
    tag: 'D3 空间聚合 · 地形贴合',
    accent: '#facc15',
    tips: [
      'loadWorldTerrain 异步加载全球地形，回调中判断 viewer 是否已销毁',
      '逐顶点调用 globe.getHeight(Cartographic) 采样高程作为第三个坐标',
      'perPositionHeight 让多边形沿地形起伏，顶面与侧壁共同构成贴合柱体'
    ]
  },
  defaults: {
    radius: 1.6,
    heightScale: 90000,
    showSurface: true,
    ramp: 'viridis',
    seed: 20261006
  },
  camera: { lon: 104, lat: 34, height: 4200000, heading: 0, pitch: -55 },
  controls: [
    { kind: 'range', key: 'radius', label: '蜂窝半径(°)', min: 1, max: 3.5, step: 0.1 },
    { kind: 'range', key: 'heightScale', label: '柱高倍率', min: 10000, max: 200000, step: 5000 },
    { kind: 'checkbox', key: 'showSurface', label: '显示贴地面' },
    {
      kind: 'select',
      key: 'ramp',
      label: '色带',
      options: [
        { value: 'viridis', label: 'viridis' },
        { value: 'turbo', label: 'turbo' },
        { value: 'spectral', label: 'spectral' },
        { value: 'sunset', label: 'sunset' }
      ]
    },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const radius = Number(settings.radius)
    const heightScale = Number(settings.heightScale)
    const showSurface = Boolean(settings.showSurface)
    const palette = String(settings.ramp)
    const seed = Number(settings.seed)
    const viewer = ctx.viewer
    const ds = ctx.dataSource

    const total = 42000
    const points = clusteredPoints(
      CLUSTERS.map((c) => ({ lon: c.lon, lat: c.lat, count: Math.floor(total * c.count), spread: c.spread })),
      seed
    )
    const cells = hexbin(points, radius, 34)
      .sort((a, b) => b.count - a.count)
      .slice(0, 240)
    const maxCount = max(cells, (c: HexCell) => c.count) ?? 1
    const scale = scaleSqrt([0, maxCount], [0, 1])

    const sampleHeight = (lon: number, lat: number): number => {
      const carto = new Cartographic(CesiumMath.toRadians(lon), CesiumMath.toRadians(lat))
      const height = viewer.scene.globe.getHeight(carto)
      return height ?? 0
    }

    const build = (statusText: string) => {
      ds.entities.removeAll()
      for (const cell of cells) {
        const ratio = scale(cell.count) ?? 0
        const color = ramp(palette, ratio)
        const ground = cell.polygon.map((p) => sampleHeight(p[0], p[1]))
        const topH = ratio * heightScale

        if (showSurface) {
          addPolygon(
            ds,
            cell.polygon.map((p, i) => [p[0], p[1], ground[i] + 40] as [number, number, number]),
            { perPositionHeight: true, color, alpha: 0.5, outline: true, outlineColor: '#0f172a', outlineWidth: 1 }
          )
        }

        addPolygon(
          ds,
          cell.polygon.map((p, i) => [p[0], p[1], ground[i] + topH + 400] as [number, number, number]),
          { perPositionHeight: true, color, alpha: 0.92, outline: true, outlineColor: '#0f172a', outlineWidth: 1 }
        )

        for (let k = 0; k < cell.polygon.length; k += 1) {
          const a = cell.polygon[k]
          const b = cell.polygon[(k + 1) % cell.polygon.length]
          const ha = sampleHeight(a[0], a[1])
          const hb = sampleHeight(b[0], b[1])
          addPolyline(
            ds,
            [
              [a[0], a[1], ha + 40],
              [a[0], a[1], ha + topH + 400],
              [b[0], b[1], hb + topH + 400],
              [b[0], b[1], hb + 40]
            ],
            { width: 1, color, alpha: 0.42 }
          )
        }
      }
      ctx.status(statusText)
    }

    let cancelled = false
    ctx.onCleanup(() => {
      cancelled = true
    })

    ctx.legend([
      { label: palette, color: ramp(palette, 1) },
      { label: `${cells.length} 个贴合蜂窝`, color: '#facc15' }
    ])
    build('地形加载中，先用椭球高度占位…')

    let terrainReady = false
    let rebuilt = false
    let waited = 0
    loadWorldTerrain(viewer)
      .then(() => {
        if (cancelled || viewer.isDestroyed()) return
        terrainReady = true
      })
      .catch(() => {
        /* 地形不可用时保留占位结果 */
      })

    ctx.onFrame((_time, delta) => {
      if (rebuilt || !terrainReady || cancelled) return
      waited += delta
      const globe = viewer.scene.globe as unknown as { tileLoadQueueLength: number }
      if (globe.tileLoadQueueLength === 0 || waited > 3000) {
        rebuilt = true
        build(`地形加载完成：${cells.length} 个蜂窝顶点已用 globe.getHeight 采样贴合`)
      }
    })
  }
}

export default spec
