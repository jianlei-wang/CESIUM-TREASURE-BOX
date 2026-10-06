import { Cartesian2, Cartesian3, Material, PolylineCollection, ScreenSpaceEventHandler, ScreenSpaceEventType, Color } from 'cesium'
import type { D3CaseSpec } from '../types'
import type { AggregateCell, LonLat } from '../spatial/hexbin'
import { buildDelaunay, type DelaunayIndex } from '../spatial/delaunay'
import { renderCellPolygons } from '../render/polygons'
import { addLabel, addPoint } from '../render'
import { haversine, formatNumber, normalize } from '../core/geo'
import { ramp } from '../palettes'
import { loadCities } from './_data'
import { PALETTE_OPTIONS, rampLegend } from './_kit'

type RegionKey = 'europe' | 'asia' | 'americas' | 'global'

const REGIONS: Record<RegionKey, { bounds: [number, number, number, number]; camera: { lon: number; lat: number; height: number } }> = {
  europe: { bounds: [-12, 35, 30, 60], camera: { lon: 9, lat: 48, height: 5_200_000 } },
  asia: { bounds: [60, 0, 150, 55], camera: { lon: 105, lat: 30, height: 6_500_000 } },
  americas: { bounds: [-130, 15, -60, 60], camera: { lon: -95, lat: 40, height: 7_500_000 } },
  global: { bounds: [-180, -60, 180, 72], camera: { lon: 20, lat: 20, height: 24_000_000 } }
}

function polygonArea(polygon: LonLat[]): number {
  let area = 0
  for (let i = 0; i < polygon.length; i += 1) {
    const [x1, y1] = polygon[i]
    const [x2, y2] = polygon[(i + 1) % polygon.length]
    area += x1 * y2 - x2 * y1
  }
  return Math.abs(area / 2)
}

const spec: D3CaseSpec = {
  id: 'd3-delaunay-voronoi',
  meta: {
    title: 'Delaunay / Voronoi 空间邻域分析',
    subtitle: '真实城市点 → Delaunay 三角网 → Voronoi 影响范围',
    description:
      '以真实世界城市经纬度为点集，构建 d3-delaunay 三角网与 Voronoi 单元，单元面积表示影响范围；点击城市显示其 Voronoi 单元、最近邻城市与球面距离。',
    tag: 'Delaunay · Voronoi · 最近邻',
    accent: '#60a5fa',
    tips: [
      '点集为真实城市经纬度，非随机分布',
      'd3-delaunay 同时提供三角邻接、Voronoi 单元与最近邻',
      'Voronoi 面积 = 服务范围，点击点显示最近邻与距离'
    ]
  },
  defaults: {
    region: 'europe',
    palette: 'viridis',
    showCells: true,
    showEdges: true,
    colorBy: 'area'
  },
  camera: { lon: 9, lat: 48, height: 5_200_000, pitch: -90 },
  controls: [
    {
      kind: 'select',
      key: 'region',
      label: '区域',
      options: [
        { value: 'europe', label: '欧洲' },
        { value: 'asia', label: '亚洲' },
        { value: 'americas', label: '美洲' },
        { value: 'global', label: '全球' }
      ]
    },
    { kind: 'select', key: 'colorBy', label: '单元着色', options: [{ value: 'area', label: 'Voronoi 面积' }, { value: 'density', label: '局部点密度' }] },
    { kind: 'select', key: 'palette', label: '色带', options: PALETTE_OPTIONS },
    { kind: 'checkbox', key: 'showCells', label: 'Voronoi 单元' },
    { kind: 'checkbox', key: 'showEdges', label: 'Delaunay 三角网' }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const region = REGIONS[String(settings.region) as RegionKey] ?? REGIONS.europe
    const palette = String(settings.palette)
    let disposed = false
    let pointLon: number[] = []
    let pointLat: number[] = []
    let index: DelaunayIndex | undefined

    const handler = new ScreenSpaceEventHandler(ctx.viewer.scene.canvas)
    ctx.onCleanup(() => {
      disposed = true
      handler.destroy()
    })

    ctx.status('加载真实城市点…')
    loadCities()
      .then((buffer) => {
        if (disposed) return
        const [west, south, east, north] = region.bounds
        const points: LonLat[] = []
        for (let i = 0; i < buffer.length; i += 1) {
          const lon = buffer.positions[i * 2]
          const lat = buffer.positions[i * 2 + 1]
          if (lon < west || lon > east || lat < south || lat > north) continue
          points.push([lon, lat])
        }
        pointLon = points.map((p) => p[0])
        pointLat = points.map((p) => p[1])

        const buildEnd = ctx.profiler.time('Delaunay')
        index = buildDelaunay(points)
        ctx.profiler.set('Delaunay', `${buildEnd().toFixed(0)} ms`)

        const cells: AggregateCell[] = []
        const areas: number[] = []
        for (let i = 0; i < points.length; i += 1) {
          const polygon = index.cellPolygon(i) ?? [points[i]]
          const area = polygon.length >= 3 ? polygonArea(polygon) : 0
          areas.push(area)
          cells.push({ key: String(i), lon: points[i][0], lat: points[i][1], polygon, count: area, sum: area, mean: area, min: area, max: area })
        }
        const maxArea = areas.reduce((acc, value) => Math.max(acc, value), 1)

        if (Boolean(settings.showCells)) {
          const renderEnd = ctx.profiler.time('Render')
          const primitive = renderCellPolygons(cells, {
            alpha: 0.55,
            colorOf: (cell) => {
              if (String(settings.colorBy) === 'density') {
                const local = index ? index.neighbors(Number(cell.key)).length : 0
                return ramp(palette, normalize(local, 0, 8))
              }
              return ramp(palette, Math.sqrt(normalize(cell.count, 0, maxArea)))
            }
          })
          if (primitive) ctx.addPrimitive(primitive)
          ctx.profiler.set('Render', `${renderEnd().toFixed(0)} ms`)
        }

        if (Boolean(settings.showEdges)) {
          const lines = ctx.addPrimitive(new PolylineCollection())
          const seen = new Set<string>()
          let edges = 0
          for (let i = 0; i < points.length; i += 1) {
            for (const j of index.neighbors(i)) {
              const key = i < j ? `${i}-${j}` : `${j}-${i}`
              if (seen.has(key)) continue
              seen.add(key)
              lines.add({
                positions: [Cartesian3.fromDegrees(points[i][0], points[i][1], 0), Cartesian3.fromDegrees(points[j][0], points[j][1], 0)],
                width: 1,
                material: Material.fromType('Color', { color: Color.fromCssColorString('#38bdf8').withAlpha(0.35) })
              })
              edges += 1
            }
          }
          ctx.profiler.set('Edges', edges.toLocaleString('en-US'))
        }

        for (let i = 0; i < points.length; i += 1) {
          addPoint(ctx.dataSource, points[i][0], points[i][1], { pixelSize: 4, color: '#e2e8f0', disableDepthTest: true })
        }

        handler.setInputAction((movement: { position: Cartesian2 }) => {
          if (!index) return
          const picked = ctx.viewer.scene.pick(movement.position) as { id?: unknown } | undefined
          void picked
          const ray = ctx.viewer.camera.getPickRay(movement.position)
          if (!ray) return
          const cartesian = ctx.viewer.scene.globe.pick(ray, ctx.viewer.scene)
          if (!cartesian) return
          const carto = ctx.viewer.scene.globe.ellipsoid.cartesianToCartographic(cartesian)
          const lon = (carto.longitude * 180) / Math.PI
          const lat = (carto.latitude * 180) / Math.PI
          const i = index.find(lon, lat)
          if (i < 0 || i >= points.length) return
          const nearest = index.nearest(i, 5)
          const cell = index.cellPolygon(i)
          if (cell) {
            const primitive = renderCellPolygons(
              [{ key: 'sel', lon: points[i][0], lat: points[i][1], polygon: cell, count: 1, sum: 1, mean: 1, min: 1, max: 1 }],
              { alpha: 0.4, colorOf: () => '#f59e0b' }
            )
            if (primitive) ctx.addPrimitive(primitive)
          }
          ctx.dataSource.entities.removeAll()
          nearest.forEach((j, rank) => {
            const distance = haversine(points[i], points[j])
            ctx.dataSource.entities.add({
              polyline: {
                positions: [Cartesian3.fromDegrees(points[i][0], points[i][1], 0), Cartesian3.fromDegrees(points[j][0], points[j][1], 0)],
                width: 2,
                material: Color.fromCssColorString('#f59e0b')
              }
            })
            addLabel(ctx.dataSource, points[j][0], points[j][1], `${rank + 1}. ${formatNumber(distance / 1000, 0)} km`, { color: '#fde68a', pixelOffsetY: -14 })
          })
          const area = cell ? polygonArea(cell) : 0
          ctx.status(`城市 (${points[i][0].toFixed(2)}, ${points[i][1].toFixed(2)}) · Voronoi 面积 ${formatNumber(area, 2)}°² · ${nearest.length} 个最近邻`)
        }, ScreenSpaceEventType.LEFT_CLICK)

        ctx.profiler.set('Cities', points.length.toLocaleString('en-US'))
        ctx.profiler.set('Cells', cells.length.toLocaleString('en-US'))
        ctx.status(`${points.length} 个真实城市 · Delaunay/Voronoi 构建完成，点击城市查看最近邻`)
        ctx.legend([rampLegend(palette, String(settings.colorBy) === 'area' ? 'Voronoi 面积' : '局部点密度')])
      })
      .catch((error: unknown) => {
        if (!disposed) ctx.status(`数据加载失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }
}

export default spec
