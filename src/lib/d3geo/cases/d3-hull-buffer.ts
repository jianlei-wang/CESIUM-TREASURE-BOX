import { polygonHull } from 'd3'
import type { D3CaseSpec } from '../types'
import { randomPoints } from '../data'
import { addPoint, addPolygon, type LonLat } from '../render'

type PlanePoint = [number, number]

const BOUNDS = { west: 100, south: 22, east: 124, north: 42 }

const spec: D3CaseSpec = {
  id: 'd3-hull-buffer',
  meta: {
    title: '凸包与缓冲区',
    subtitle: 'd3.polygonHull 平面凸包 → 顶点外扩取包络近似缓冲多边形',
    description: '把散点投影到平面求凸包，再沿凸包顶点外扩取包络，得到半透明的缓冲环。',
    tag: 'D3 几何运算 · 凸包缓冲',
    accent: '#facc15',
    tips: [
      '先将经纬度按中心纬度余弦缩放投影到平面，凸包计算更接近等距真实形态',
      '缓冲区通过在每个凸包顶点周围撒一圈样本点后再次求凸包近似，简单且平滑',
      '凸包与缓冲环分层抬升渲染，避免贴地共面闪烁，点数与缓冲距离可现场调节'
    ]
  },
  defaults: {
    pointCount: 220,
    bufferKm: 90,
    showPoints: true,
    fillAlpha: 0.35,
    seed: 20261006
  },
  camera: { lon: 112, lat: 32, height: 4200000, pitch: -68 },
  controls: [
    { kind: 'range', key: 'pointCount', label: '点数', min: 20, max: 1200, step: 10 },
    { kind: 'range', key: 'bufferKm', label: '缓冲距离(km)', min: 10, max: 400, step: 10 },
    { kind: 'checkbox', key: 'showPoints', label: '显示原始点' },
    { kind: 'range', key: 'fillAlpha', label: '填充透明度', min: 0.1, max: 0.8, step: 0.05 },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const pointCount = Number(settings.pointCount)
    const bufferKm = Number(settings.bufferKm)
    const showPoints = Boolean(settings.showPoints)
    const fillAlpha = Number(settings.fillAlpha)

    const lat0 = (BOUNDS.south + BOUNDS.north) / 2
    const cos = Math.cos((lat0 * Math.PI) / 180) || 0.01
    const sites = randomPoints(pointCount, BOUNDS, Number(settings.seed))
    const plane: PlanePoint[] = sites.map((site): PlanePoint => [site[0] * cos, site[1]])
    const hull = polygonHull(plane) as PlanePoint[] | null
    const hullPoints: PlanePoint[] =
      hull && hull.length >= 3
        ? hull
        : [
            [BOUNDS.west * cos, BOUNDS.south],
            [BOUNDS.east * cos, BOUNDS.south],
            [BOUNDS.east * cos, BOUNDS.north],
            [BOUNDS.west * cos, BOUNDS.north]
          ]

    const bufferDeg = bufferKm / 111
    const samples: PlanePoint[] = []
    const ringSegments = 36
    for (const vertex of hullPoints) {
      for (let k = 0; k < ringSegments; k += 1) {
        const angle = (k / ringSegments) * Math.PI * 2
        samples.push([vertex[0] + bufferDeg * Math.cos(angle), vertex[1] + bufferDeg * Math.sin(angle)])
      }
    }
    const bufferHull = polygonHull(samples) as PlanePoint[] | null

    const toGeo = (points: PlanePoint[]): LonLat[] => points.map((point): LonLat => [point[0] / cos, point[1]])
    const bufferGeo = toGeo(bufferHull && bufferHull.length >= 3 ? bufferHull : samples)
    const hullGeo = toGeo(hullPoints)

    addPolygon(ctx.dataSource, bufferGeo, {
      height: 600,
      color: '#38bdf8',
      alpha: Math.min(0.4, fillAlpha * 0.7),
      outline: true,
      outlineColor: '#38bdf8',
      outlineWidth: 1
    })
    addPolygon(ctx.dataSource, hullGeo, {
      height: 2600,
      color: '#facc15',
      alpha: fillAlpha,
      outline: true,
      outlineColor: '#facc15',
      outlineWidth: 2
    })

    if (showPoints) {
      for (const site of sites) {
        addPoint(ctx.dataSource, site[0], site[1], {
          pixelSize: 4,
          color: '#e2e8f0',
          outlineColor: '#0f172a',
          disableDepthTest: true
        })
      }
    }

    ctx.status(`点 ${sites.length} · 凸包顶点 ${hullPoints.length} · 缓冲 ${bufferKm}km · 包络顶点 ${bufferGeo.length}`)
    ctx.legend([
      { label: '凸包边界', color: '#facc15' },
      { label: `缓冲 ${bufferKm}km`, color: '#38bdf8' }
    ])
  }
}

export default spec
