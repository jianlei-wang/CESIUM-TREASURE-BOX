import { quadtree } from 'd3'
import type { D3CaseSpec } from '../types'
import { randomPoints } from '../data'
import { ramp } from '../palettes'
import { addPoint, addPolygon, circlePolygon, type LonLat } from '../render'

const BOUNDS = { west: 100, south: 22, east: 124, north: 42 }
const ELEVATION = 8000

const spec: D3CaseSpec = {
  id: 'd3-quadtree',
  meta: {
    title: '四叉树空间索引可视化',
    subtitle: 'd3.quadtree → 递归细分边界矩形 + 圆形范围查询',
    description: '以四叉树逐级二分矩形空间，抬升绘制细分边界，并高亮命中圆形查询范围的点。',
    tag: 'D3 空间索引 · Quadtree',
    accent: '#38bdf8',
    tips: [
      'd3.quadtree 依据点坐标递归四分空间，visit 回调按层返回当前节点的包围矩形',
      '每个内部节点用一个空心 Polygon 边框表示，统一抬升到同一高度便于观察分层',
      '圆形查询用度数半径做距离判断，命中点高亮，直观体现索引的剪枝能力'
    ]
  },
  defaults: {
    pointCount: 420,
    radius: 3.2,
    showPoints: true,
    maxDepth: 5,
    seed: 20261006
  },
  camera: { lon: 112, lat: 32, height: 4400000, pitch: -70 },
  controls: [
    { kind: 'range', key: 'pointCount', label: '点数', min: 60, max: 2000, step: 20 },
    { kind: 'range', key: 'radius', label: '查询半径(°)', min: 0.5, max: 8, step: 0.1 },
    { kind: 'checkbox', key: 'showPoints', label: '显示点' },
    { kind: 'range', key: 'maxDepth', label: '细分层数', min: 1, max: 7, step: 1 },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const pointCount = Number(settings.pointCount)
    const radiusDeg = Number(settings.radius)
    const showPoints = Boolean(settings.showPoints)
    const maxDepth = Number(settings.maxDepth)

    const points = randomPoints(pointCount, BOUNDS, Number(settings.seed))
    const tree = quadtree()
      .x((d: [number, number]) => d[0])
      .y((d: [number, number]) => d[1])
      .addAll(points)

    const rootWidth = BOUNDS.east - BOUNDS.west
    let nodeCount = 0
    tree.visit((node: { length?: number }, x0: number, y0: number, x1: number, y1: number) => {
      if (!node.length) return true
      nodeCount += 1
      const span = x1 - x0
      const depth = span > 0 ? Math.round(Math.log2(rootWidth / span)) : 0
      if (depth < maxDepth) {
        const ratio = depth / Math.max(1, maxDepth)
        const corners: LonLat[] = [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1]
        ]
        addPolygon(ctx.dataSource, corners, {
          height: ELEVATION,
          color: ramp('blues', 0.3 + ratio * 0.6),
          alpha: 0,
          outline: true,
          outlineColor: ramp('blues', 0.4 + ratio * 0.6),
          outlineWidth: 1
        })
      }
      return depth >= maxDepth
    })

    const centerLon = (BOUNDS.west + BOUNDS.east) / 2
    const centerLat = (BOUNDS.south + BOUNDS.north) / 2
    const queryRing = circlePolygon(centerLon, centerLat, radiusDeg * 111320, 72)
    addPolygon(ctx.dataSource, queryRing, {
      height: ELEVATION + 400,
      color: '#f472b6',
      alpha: 0.12,
      outline: true,
      outlineColor: '#f472b6',
      outlineWidth: 2
    })
    addPoint(ctx.dataSource, centerLon, centerLat, {
      pixelSize: 8,
      color: '#f472b6',
      outlineColor: '#0f172a',
      disableDepthTest: true
    })

    let insideCount = 0
    if (showPoints) {
      for (const point of points) {
        const inside = Math.hypot(point[0] - centerLon, point[1] - centerLat) <= radiusDeg
        if (inside) insideCount += 1
        addPoint(ctx.dataSource, point[0], point[1], {
          pixelSize: inside ? 7 : 4,
          color: inside ? '#f472b6' : '#38bdf8',
          outlineColor: inside ? '#f472b6' : '#0f172a',
          disableDepthTest: true
        })
      }
    }

    ctx.status(`点 ${points.length} · 内部节点 ${nodeCount} · 命中 ${insideCount} · 细分 ${maxDepth} 层`)
    ctx.legend([
      { label: '四叉树细分边界', color: ramp('blues', 0.8) },
      { label: `查询命中 ${insideCount} 点`, color: '#f472b6' }
    ])
  }
}

export default spec
