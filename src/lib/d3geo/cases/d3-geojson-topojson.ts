import { feature } from 'topojson-client'
import type { D3CaseSpec } from '../types'
import { addLabel, addPolygon, addPolyline, type LonLat } from '../render'

const NORTH = 38
const SOUTH = 22
const WEST = 100
const EAST = 120
const MIDX = 110

/** 左、右两区共享的中缝弧段，这里放 41 个顶点以体现 TopoJSON 的弧段压缩收益。 */
const shared: number[][] = []
for (let i = 0; i <= 40; i += 1) {
  shared.push([MIDX, SOUTH + (NORTH - SOUTH) * (i / 40)])
}

const TOPOLOGY = {
  type: 'Topology',
  objects: {
    regions: {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Polygon', arcs: [[0, 1, 2, 3]], properties: { name: '西部区', color: '#38bdf8' } },
        { type: 'Polygon', arcs: [[4, 5, 6, ~1]], properties: { name: '东部区', color: '#f472b6' } }
      ]
    }
  },
  arcs: [
    [[WEST, SOUTH], [MIDX, SOUTH]],
    shared,
    [[MIDX, NORTH], [WEST, NORTH]],
    [[WEST, NORTH], [WEST, SOUTH]],
    [[MIDX, SOUTH], [EAST, SOUTH]],
    [[EAST, SOUTH], [EAST, NORTH]],
    [[EAST, NORTH], [MIDX, NORTH]]
  ]
}

type RegionFeature = {
  properties: { name: string; color: string }
  geometry: { type: string; coordinates: number[][][] }
}

type RegionCollection = { features: RegionFeature[] }

const spec: D3CaseSpec = {
  id: 'd3-geojson-topojson',
  meta: {
    title: 'GeoJSON 与 TopoJSON 双解析',
    subtitle: 'topojson-client.feature() · 共享弧段压缩',
    description: '把内联 TopoJSON 的共享弧段展开为 GeoJSON，并在三维地球上渲染省/市边界。',
    tag: 'D3 矢量解析 · TopoJSON',
    accent: '#38bdf8',
    tips: [
      'topojson-client 的 feature() 以内联 topology.arcs 重建 GeoJSON，负索引表示反向引用同一弧段',
      '左右两区共用中缝 arc1，存储侧只保留一份顶点，展开后才复制到两条边界上',
      '状态栏实时对比 arcs 顶点数与展开后顶点数，量化拓扑压缩的收益'
    ]
  },
  defaults: {
    mode: 'extrude',
    height: 260000,
    opacity: 0.72,
    showLabels: true,
    showSharedEdge: true
  },
  camera: { lon: 110, lat: 30, height: 3800000, pitch: -90 },
  controls: [
    {
      kind: 'select',
      key: 'mode',
      label: '解析模式',
      options: [
        { value: 'extrude', label: '拉伸体块' },
        { value: 'ground', label: '贴地描边' }
      ]
    },
    {
      kind: 'range',
      key: 'height',
      label: '抬升高度',
      min: 0,
      max: 500000,
      step: 10000,
      format: (v) => `${Math.round(v / 1000)}km`
    },
    { kind: 'range', key: 'opacity', label: '面透明度', min: 0.2, max: 1, step: 0.05 },
    { kind: 'checkbox', key: 'showLabels', label: '显示区域名称' },
    { kind: 'checkbox', key: 'showSharedEdge', label: '高亮共享 arc' }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const mode = String(settings.mode)
    const lift = Number(settings.height)
    const opacity = Number(settings.opacity)
    const showLabels = Boolean(settings.showLabels)
    const showShared = Boolean(settings.showSharedEdge)

    const collection = feature(TOPOLOGY, TOPOLOGY.objects.regions) as RegionCollection
    const storedCoords = TOPOLOGY.arcs.reduce((acc: number, arc: number[][]) => acc + arc.length, 0)
    const expandedCoords = collection.features.reduce((acc: number, f: RegionFeature) => {
      let count = 0
      for (const ring of f.geometry.coordinates) count += ring.length
      return acc + count
    }, 0)
    const storedBytes = JSON.stringify(TOPOLOGY.arcs).length
    const expandedBytes = JSON.stringify(collection.features.map((f: RegionFeature) => f.geometry.coordinates)).length
    const ratio = expandedBytes > 0 ? (1 - storedBytes / expandedBytes) * 100 : 0

    collection.features.forEach((f: RegionFeature) => {
      const ring = f.geometry.coordinates[0] ?? []
      const points = ring.map((p: number[]) => [p[0], p[1]] as LonLat)
      if (points.length < 3) return

      if (mode === 'extrude') {
        addPolygon(ctx.dataSource, points, {
          height: 200,
          extrudedHeight: Math.max(2000, lift),
          color: f.properties.color,
          alpha: opacity,
          outline: true,
          outlineColor: '#0f172a'
        })
      } else {
        addPolygon(ctx.dataSource, points, {
          height: Math.max(100, lift),
          color: f.properties.color,
          alpha: opacity,
          outline: true,
          outlineColor: '#e2e8f0',
          outlineWidth: 2
        })
      }

      if (showLabels) {
        const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length
        const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length
        addLabel(ctx.dataSource, cx, cy, f.properties.name, {
          font: '13px sans-serif',
          disableDepthTest: true,
          scaleByDistance: [1000000, 0.5, 6000000, 1.2]
        })
      }
    })

    if (showShared) {
      const edgeHeight = mode === 'extrude' ? Math.max(2000, lift) + 2000 : Math.max(100, lift) + 2000
      addPolyline(
        ctx.dataSource,
        shared.map((p: number[]) => [p[0], p[1]] as LonLat),
        { width: 4, color: '#facc15', height: edgeHeight, glow: true, glowPower: 0.22 }
      )
    }

    ctx.legend([
      { label: '西部区', color: '#38bdf8' },
      { label: '东部区', color: '#f472b6' },
      { label: '共享 arc1（仅存一份）', color: '#facc15' }
    ])
    ctx.status(
      `TopoJSON arcs 顶点 ${storedCoords} → GeoJSON 顶点 ${expandedCoords}，JSON 体积压缩 ${ratio.toFixed(1)}%`
    )
  }
}

export default spec
