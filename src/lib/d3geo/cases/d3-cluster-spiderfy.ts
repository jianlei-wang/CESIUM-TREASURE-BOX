import { Cartesian2, Cartesian3, Color, ScreenSpaceEventHandler, ScreenSpaceEventType, type PointPrimitiveCollection } from 'cesium'
import type { D3CaseSpec } from '../types'
import type { GeoPointBuffer } from '../core/buffer'
import { screenGridCluster } from '../spatial/quadtree'
import { ramp, categorical } from '../palettes'
import { formatCount, normalize } from '../core/geo'
import { loadQuakes } from './_data'
import { PALETTE_OPTIONS, rampLegend } from './_kit'

type Cluster = { index: number; lon: number; lat: number; members: number[]; mean: number; min: number; max: number }

const spec: D3CaseSpec = {
  id: 'd3-cluster-spiderfy',
  meta: {
    title: '聚类 + 蜘蛛展开 · 屏幕空间交互',
    subtitle: '真实事件 → 屏幕网格聚类 → 点击展开成员',
    description:
      '对 USGS 真实地震事件做屏幕空间网格聚类，聚合点大小映射数量、颜色映射均值；点击聚合点展开为蜘蛛图成员点，并给出数量 / 极值 / 均值 / 类别分布。',
    tag: 'Cluster · Spiderfy · 屏幕空间',
    accent: '#34d399',
    tips: [
      '输入为真实地震事件坐标，聚类尺度随屏幕像素变化',
      '点击聚合点触发蜘蛛展开，成员用偏移点与连线表达',
      '统计随交互实时给出：count / min / max / mean / 类别分布'
    ]
  },
  defaults: {
    cellSize: 46,
    palette: 'turbo',
    spread: 0.35,
    showMembers: true
  },
  camera: { lon: 20, lat: 20, height: 24_000_000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'cellSize', label: '聚合像素', min: 16, max: 120, step: 2 },
    { kind: 'range', key: 'spread', label: '展开半径(度)', min: 0.05, max: 1.5, step: 0.05 },
    { kind: 'select', key: 'palette', label: '色带', options: PALETTE_OPTIONS },
    { kind: 'checkbox', key: 'showMembers', label: '显示展开成员' }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const palette = String(settings.palette)
    let disposed = false
    let buffer: GeoPointBuffer | undefined
    let clusters: Cluster[] = []
    const collection: PointPrimitiveCollection = ctx.pointCollection()
    const memberCollection: PointPrimitiveCollection = ctx.pointCollection()
    let lastCameraHeight = -1
    let lastCameraLon = 999
    let lastCameraLat = 999

    const handler = new ScreenSpaceEventHandler(ctx.viewer.scene.canvas)
    ctx.onCleanup(() => {
      disposed = true
      handler.destroy()
    })

    const project = (lon: number, lat: number): Cartesian2 | undefined =>
      ctx.viewer.scene.cartesianToCanvasCoordinates(Cartesian3.fromDegrees(lon, lat, 0))

    const drawClusters = (): void => {
      collection.removeAll()
      memberCollection.removeAll()
      const maxCluster = clusters.reduce((acc, cluster) => Math.max(acc, cluster.members.length), 1)
      for (const cluster of clusters) {
        const t = normalize(cluster.members.length, 1, maxCluster)
        const size = 6 + Math.sqrt(cluster.members.length) * 3.4
        collection.add({
          position: Cartesian3.fromDegrees(cluster.lon, cluster.lat, 0),
          color: cssColor(ramp(palette, Math.pow(t, 0.5)), 0.92),
          pixelSize: Math.min(30, size),
          outlineColor: cssColor('#0f172a', 1),
          outlineWidth: 1,
          id: { __d3cluster: cluster.index }
        })
      }
    }

    const spiderfy = (cluster: Cluster): void => {
      memberCollection.removeAll()
      ctx.dataSource.entities.removeAll()
      const local = new Map<number, number>()
      if (Boolean(settings.showMembers) && cluster.members.length > 1) {
        const spread = Number(settings.spread)
        cluster.members.forEach((memberIndex, k) => {
          const angle = (Math.PI * 2 * k) / cluster.members.length
          const lon = cluster.lon + Math.cos(angle) * spread
          const lat = cluster.lat + Math.sin(angle) * spread * 0.7
          const category = (buffer as GeoPointBuffer).categories[memberIndex]
          local.set(category, (local.get(category) ?? 0) + 1)
          memberCollection.add({
            position: Cartesian3.fromDegrees(lon, lat, 0),
            color: cssColor(categorical(category), 1),
            pixelSize: 6,
            id: { __d3member: memberIndex }
          })
          ctx.dataSource.entities.add({
            polyline: {
              positions: [Cartesian3.fromDegrees(cluster.lon, cluster.lat, 0), Cartesian3.fromDegrees(lon, lat, 0)],
              width: 1,
              material: cssColor('#94a3b8', 0.6)
            }
          })
        })
      }
      const localText = [...local.entries()].map(([cat, n]) => `C${cat}×${n}`).join(' ') || '单点'
      ctx.status(
        `聚合 ${cluster.members.length} 点 · 均值 ${cluster.mean.toFixed(2)} · 范围 ${cluster.min.toFixed(1)}–${cluster.max.toFixed(1)} · ${localText}`
      )
    }

    const computeClusters = (): void => {
      if (!buffer) return
      const xs = new Float32Array(buffer.length)
      const ys = new Float32Array(buffer.length)
      const valid: number[] = []
      for (let i = 0; i < buffer.length; i += 1) {
        const screen = project(buffer.positions[i * 2], buffer.positions[i * 2 + 1])
        if (!screen) continue
        xs[i] = screen.x
        ys[i] = screen.y
        valid.push(i)
      }
      const { assignments } = screenGridCluster(xs, ys, Number(settings.cellSize))
      const buckets = new Map<number, number[]>()
      for (const i of valid) {
        const id = assignments[i]
        if (id < 0) continue
        const list = buckets.get(id)
        if (list) list.push(i)
        else buckets.set(id, [i])
      }
      clusters = []
      let ci = 0
      for (const members of buckets.values()) {
        let lon = 0
        let lat = 0
        let min = Number.POSITIVE_INFINITY
        let max = Number.NEGATIVE_INFINITY
        let sum = 0
        for (const i of members) {
          lon += buffer.positions[i * 2]
          lat += buffer.positions[i * 2 + 1]
          const value = buffer.values[i]
          sum += value
          if (value < min) min = value
          if (value > max) max = value
        }
        clusters.push({ index: ci, lon: lon / members.length, lat: lat / members.length, members, mean: sum / members.length, min, max })
        ci += 1
      }
      drawClusters()
    }

    handler.setInputAction((movement: { position: Cartesian2 }) => {
      if (!buffer) return
      const picked = ctx.viewer.scene.pick(movement.position) as { id?: { __d3cluster?: number } } | undefined
      const clusterId = picked?.id?.__d3cluster
      if (clusterId === undefined) return
      const cluster = clusters[clusterId]
      if (cluster) spiderfy(cluster)
    }, ScreenSpaceEventType.LEFT_CLICK)

    const refreshIfCameraMoved = (): void => {
      if (!buffer) return
      const carto = ctx.viewer.camera.positionCartographic
      const height = carto.height
      const lon = (carto.longitude * 180) / Math.PI
      const lat = (carto.latitude * 180) / Math.PI
      if (
        Math.abs(height - lastCameraHeight) > Math.max(1, height * 0.04) ||
        Math.abs(lon - lastCameraLon) > 0.4 ||
        Math.abs(lat - lastCameraLat) > 0.4
      ) {
        lastCameraHeight = height
        lastCameraLon = lon
        lastCameraLat = lat
        computeClusters()
      }
    }

    ctx.status('加载真实地震事件…')
    loadQuakes()
      .then((loaded) => {
        if (disposed) return
        buffer = loaded
        const start = ctx.profiler.time('Cluster')
        computeClusters()
        ctx.profiler.set('Cluster', `${start().toFixed(0)} ms`)
        ctx.profiler.set('Input', formatCount(buffer.length))
        ctx.profiler.set('Clusters', formatCount(clusters.length))
        ctx.profiler.set('Compression', `${((1 - clusters.length / buffer.length) * 100).toFixed(1)}%`)
        ctx.status(`${formatCount(buffer.length)} 个真实事件 → ${formatCount(clusters.length)} 个聚合点，点击聚合点展开`)
        ctx.legend([rampLegend(palette, '聚合数量 少→多')])
        ctx.onFrame(refreshIfCameraMoved)
      })
      .catch((error: unknown) => {
        if (!disposed) ctx.status(`数据加载失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }
}

function cssColor(css: string, alpha: number): Color {
  const color = Color.fromCssColorString(css)
  color.alpha = alpha
  return color
}

export default spec
