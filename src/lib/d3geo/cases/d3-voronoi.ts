import { Delaunay } from 'd3'
import type { D3CaseSpec } from '../types'
import { clusteredPoints, mulberry32, randomPoints } from '../data'
import { ramp } from '../palettes'
import { addLabel, addPoint, addPolygon, type LonLat } from '../render'

const BOUNDS = { west: 98, south: 22, east: 124, north: 42 }
const CLUSTER_HUBS = [
  { lon: 116.4, lat: 39.9 },
  { lon: 121.5, lat: 31.2 },
  { lon: 113.3, lat: 23.1 },
  { lon: 104.1, lat: 30.6 },
  { lon: 114.3, lat: 30.6 },
  { lon: 108.9, lat: 34.3 }
]

function buildSites(count: number, layout: string, seed: number): LonLat[] {
  if (layout === 'grid') {
    const side = Math.max(2, Math.round(Math.sqrt(count)))
    const rng = mulberry32(seed)
    const sites: LonLat[] = []
    for (let j = 0; j < side; j += 1) {
      for (let i = 0; i < side; i += 1) {
        const lon = BOUNDS.west + ((i + 0.5) / side) * (BOUNDS.east - BOUNDS.west) + (rng() - 0.5) * 1.2
        const lat = BOUNDS.south + ((j + 0.5) / side) * (BOUNDS.north - BOUNDS.south) + (rng() - 0.5) * 1.2
        sites.push([lon, lat])
      }
    }
    return sites
  }
  if (layout === 'cluster') {
    const per = Math.max(1, Math.round(count / CLUSTER_HUBS.length))
    return clusteredPoints(
      CLUSTER_HUBS.map((hub) => ({ lon: hub.lon, lat: hub.lat, count: per, spread: 2.4 })),
      seed
    )
  }
  return randomPoints(count, BOUNDS, seed)
}

const spec: D3CaseSpec = {
  id: 'd3-voronoi',
  meta: {
    title: 'Voronoi / Delaunay 剖分',
    subtitle: 'd3.Delaunay.from → cellPolygon 转经纬度贴地渲染',
    description: '以站点集构建 Delaunay 三角网与 Voronoi 势力范围，把每个泰森多边形贴地半透明呈现。',
    tag: 'D3 空间剖分 · Voronoi',
    accent: '#a78bfa',
    tips: [
      'Delaunay.from 一次性构建三角网，voronoi(bounds) 直接得到带边界的泰森多边形',
      'cellPolygon 返回平面坐标，与原经纬度同一坐标系，可直接用于贴地 Polygon 渲染',
      '站点布局支持随机 / 网格 / 簇状，直观对比不同分布下的剖分形态'
    ]
  },
  defaults: {
    siteCount: 140,
    layout: 'random',
    showSites: true,
    showLabels: false,
    ramp: 'spectral'
  },
  camera: { lon: 110, lat: 32, height: 4000000, pitch: -72 },
  controls: [
    { kind: 'range', key: 'siteCount', label: '站点数量', min: 12, max: 600, step: 4 },
    {
      kind: 'select',
      key: 'layout',
      label: '站点布局',
      options: [
        { value: 'random', label: '随机分布' },
        { value: 'grid', label: '规则网格' },
        { value: 'cluster', label: '簇状分布' }
      ]
    },
    { kind: 'checkbox', key: 'showSites', label: '显示基站点' },
    { kind: 'checkbox', key: 'showLabels', label: '显示站点标签' },
    {
      kind: 'select',
      key: 'ramp',
      label: '色带',
      options: [
        { value: 'spectral', label: 'spectral' },
        { value: 'turbo', label: 'turbo' },
        { value: 'viridis', label: 'viridis' },
        { value: 'coolwarm', label: 'coolwarm' }
      ]
    }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const siteCount = Number(settings.siteCount)
    const layout = String(settings.layout)
    const showSites = Boolean(settings.showSites)
    const showLabels = Boolean(settings.showLabels)
    const palette = String(settings.ramp)

    const sites = buildSites(siteCount, layout, 20261006)
    const delaunay = Delaunay.from(sites)
    const voronoi = delaunay.voronoi([BOUNDS.west, BOUNDS.south, BOUNDS.east, BOUNDS.north])

    let rendered = 0
    sites.forEach((site, index) => {
      const cell = voronoi.cellPolygon(index) as Array<[number, number]> | null
      if (cell && cell.length > 3) {
        const ring: LonLat[] = []
        for (let k = 0; k < cell.length - 1; k += 1) ring.push([cell[k][0], cell[k][1]])
        addPolygon(ctx.dataSource, ring, {
          color: ramp(palette, (index % 97) / 96),
          alpha: 0.32,
          outline: true,
          outlineColor: '#0f172a',
          outlineWidth: 1
        })
        rendered += 1
      }
      if (showSites) {
        addPoint(ctx.dataSource, site[0], site[1], {
          pixelSize: 5,
          color: '#f8fafc',
          outlineColor: '#0f172a',
          disableDepthTest: true
        })
      }
      if (showLabels && index % 15 === 0) {
        addLabel(ctx.dataSource, site[0], site[1], `S${index + 1}`, {
          font: '11px sans-serif',
          color: '#e2e8f0',
          scaleByDistance: [900000, 0.4, 6000000, 1.3],
          disableDepthTest: true
        })
      }
    })

    ctx.status(`站点 ${sites.length} 个 · 有效 Voronoi 单元 ${rendered} 个 · 布局 ${layout}`)
    ctx.legend([
      { label: palette, color: ramp(palette, 1) },
      { label: `${rendered} 个势力范围`, color: '#a78bfa' }
    ])
  }
}

export default spec
