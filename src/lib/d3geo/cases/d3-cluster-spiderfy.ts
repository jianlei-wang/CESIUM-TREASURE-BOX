import { Cartesian2, ScreenSpaceEventType, type Entity } from 'cesium'
import type { D3CaseSpec } from '../types'
import { CHINA_CITIES, clusteredPoints } from '../data'
import { ramp } from '../palettes'
import { addLabel, addPoint, addPolygon, addPolyline, circlePolygon, type LonLat } from '../render'

type Cluster = { center: LonLat; members: LonLat[] }

/** 简易网格聚类：按阈值步长分桶，桶内点的均值为簇中心。 */
function clusterPoints(points: LonLat[], cellDeg: number): Cluster[] {
  const buckets = new Map<string, LonLat[]>()
  for (const point of points) {
    const key = `${Math.floor(point[0] / cellDeg)},${Math.floor(point[1] / cellDeg)}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(point)
    else buckets.set(key, [point])
  }
  const clusters: Cluster[] = []
  for (const members of buckets.values()) {
    let lon = 0
    let lat = 0
    for (const member of members) {
      lon += member[0]
      lat += member[1]
    }
    clusters.push({ center: [lon / members.length, lat / members.length], members })
  }
  return clusters
}

const spec: D3CaseSpec = {
  id: 'd3-cluster-spiderfy',
  meta: {
    title: '聚合气泡簇与爆炸展开',
    subtitle: '网格聚类 + circlePolygon → 扇形 spiderfy 展开',
    description: '先按距离阈值聚合成气泡簇，点击圆圈用扇形布局展开内部子点。',
    tag: 'D3 聚类 · spiderfy',
    accent: '#f472b6',
    tips: [
      '先按聚类距离把邻近点归入网格桶，桶内均值作为簇中心',
      '每个簇用 circlePolygon 绘制圆面并以 addLabel 标注数量',
      '点击簇后沿圆周扇形（spiderfy）展开成员点，viewer.screenSpaceEventHandler 负责拾取与清理'
    ]
  },
  defaults: {
    clusterDist: 2,
    spiderRadius: 90000,
    pointCount: 4000,
    showLabels: true,
    seed: 20261006
  },
  camera: { lon: 108, lat: 32, height: 5200000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'clusterDist', label: '聚类距离(°)', min: 0.5, max: 5, step: 0.1 },
    { kind: 'range', key: 'spiderRadius', label: '展开半径(m)', min: 20000, max: 300000, step: 10000, format: (v) => v.toLocaleString() },
    { kind: 'range', key: 'pointCount', label: '点数', min: 1000, max: 20000, step: 1000, format: (v) => v.toLocaleString() },
    { kind: 'checkbox', key: 'showLabels', label: '显示数量标签' },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const clusterDist = Number(settings.clusterDist)
    const spiderRadius = Number(settings.spiderRadius)
    const total = Number(settings.pointCount)
    const showLabels = Boolean(settings.showLabels)

    const seeds = CHINA_CITIES.slice(0, 8)
    const points = clusteredPoints(
      seeds.map((city) => ({
        lon: city.lon,
        lat: city.lat,
        count: Math.floor(total / seeds.length),
        spread: 3
      })),
      Number(settings.seed)
    )

    const clusters = clusterPoints(points, clusterDist)
    const maxCount = Math.max(1, ...clusters.map((cluster) => cluster.members.length))
    const clusterIndex = new Map<unknown, number>()
    let expanded = -1
    let expansion: Entity[] = []

    const collapse = () => {
      for (const entity of expansion) ctx.dataSource.entities.remove(entity)
      expansion = []
      expanded = -1
    }

    clusters.forEach((cluster, index) => {
      const count = cluster.members.length
      const ratio = count / maxCount
      const radiusMeters = 30000 + Math.sqrt(count) * 12000
      const entity = addPolygon(ctx.dataSource, circlePolygon(cluster.center[0], cluster.center[1], radiusMeters, 40), {
        color: ramp('plasma', ratio),
        alpha: 0.45,
        outline: true,
        outlineColor: '#f472b6',
        outlineWidth: 2
      })
      clusterIndex.set(entity, index)
      if (showLabels) {
        addLabel(ctx.dataSource, cluster.center[0], cluster.center[1], String(count), {
          font: 'bold 12px sans-serif',
          color: '#f8fafc',
          scaleByDistance: [800000, 0.5, 8000000, 1.4],
          disableDepthTest: true
        })
      }
      if (count === 1) {
        addPoint(ctx.dataSource, cluster.center[0], cluster.center[1], { pixelSize: 6, color: '#f8fafc' })
      }
    })

    const expand = (index: number) => {
      collapse()
      const cluster = clusters[index]
      const count = cluster.members.length
      cluster.members.forEach((member, k) => {
        const angle = (k / Math.max(1, count)) * Math.PI * 2
        const cosLat = Math.cos((cluster.center[1] * Math.PI) / 180) || 0.01
        const lon = cluster.center[0] + (Math.cos(angle) * spiderRadius) / (111320 * cosLat)
        const lat = cluster.center[1] + (Math.sin(angle) * spiderRadius) / 110540
        expansion.push(addPolyline(ctx.dataSource, [cluster.center, [lon, lat]], { width: 1, color: '#94a3b8', alpha: 0.7 }))
        expansion.push(addPoint(ctx.dataSource, lon, lat, { pixelSize: 7, color: '#f8fafc', outlineColor: '#0f172a', disableDepthTest: true }))
      })
      expanded = index
      ctx.status(`已展开第 ${index} 簇 · ${count} 个子点沿扇形分布`)
    }

    ctx.legend([
      { label: 'plasma（聚类规模）', color: ramp('plasma', 1) },
      { label: '点击圆面展开子点', color: '#f472b6' }
    ])
    ctx.status(`聚类 ${clusters.length} 簇 · 共 ${points.length.toLocaleString()} 点 · 点击气泡簇展开`)

    const handler = ctx.viewer.screenSpaceEventHandler
    if (handler) {
      handler.setInputAction((movement: { position: Cartesian2 }) => {
        const picked = ctx.viewer.scene.pick(movement.position)
        const entity = picked ? picked.id : undefined
        if (!entity) return
        const index = clusterIndex.get(entity)
        if (index === undefined) return
        if (expanded === index) {
          collapse()
          ctx.status('已收起展开的聚合簇')
        } else {
          expand(index)
        }
      }, ScreenSpaceEventType.LEFT_CLICK)
      ctx.onCleanup(() => {
        handler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK)
        collapse()
      })
    }
  }
}

export default spec
