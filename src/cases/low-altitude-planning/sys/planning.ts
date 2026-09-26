import type { AirspaceZone, AreaBounds, LonLat, Obstacle, RoutePlan, Waypoint } from './types'
import {
  bearing,
  boundsCenter,
  boundsSpanMeters,
  clamp,
  haversine,
  pathLength3d,
  pointInRing
} from './util'

export type PlannerContext = {
  bounds: AreaBounds
  airspaces: AirspaceZone[]
  obstacles: Obstacle[]
  seed?: number
}

const CRUISE_SPEED = 15
const CLIMB_RATE = 4

/** 判断某点是否落入空域（可选高度过滤）。 */
export function zoneContains(zone: AirspaceZone, point: LonLat, alt?: number): boolean {
  if (!zone.active) return false
  if (alt !== undefined && (alt < zone.altMin || alt > zone.altMax)) return false
  if (zone.shape === 'polygon') return pointInRing(point, zone.ring)
  return haversine(point, zone.center) <= zone.radius
}

/** 某点在某高度上是否被禁飞/限飞约束。 */
export function blockedByAirspace(point: LonLat, alt: number, zones: AirspaceZone[]): AirspaceZone | undefined {
  return zones.find((zone) => (zone.type === 'forbid' || zone.type === 'restrict') && zoneContains(zone, point, alt))
}

/** 某点在某高度是否与建筑障碍冲突。 */
export function blockedByObstacle(point: LonLat, alt: number, obstacles: Obstacle[]): Obstacle | undefined {
  return obstacles.find(
    (ob) =>
      point.lon >= ob.west &&
      point.lon <= ob.east &&
      point.lat >= ob.south &&
      point.lat <= ob.north &&
      alt < ob.height + 8
  )
}

type GridAStarOptions = {
  bounds: AreaBounds
  resolution: number
  alt: number
  airspaces: AirspaceZone[]
  obstacles: Obstacle[]
}

function toIndex(point: LonLat, bounds: AreaBounds, resolution: number) {
  const span = boundsSpanMeters(bounds)
  const cols = Math.max(2, Math.ceil(span.width / resolution))
  const rows = Math.max(2, Math.ceil(span.height / resolution))
  const col = clamp(Math.floor(((point.lon - bounds.west) / (bounds.east - bounds.west)) * cols), 0, cols - 1)
  const row = clamp(Math.floor(((point.lat - bounds.south) / (bounds.north - bounds.south)) * rows), 0, rows - 1)
  return { col, row, cols, rows }
}

function fromIndex(col: number, row: number, bounds: AreaBounds, cols: number, rows: number): LonLat {
  return {
    lon: bounds.west + ((col + 0.5) / cols) * (bounds.east - bounds.west),
    lat: bounds.south + ((row + 0.5) / rows) * (bounds.north - bounds.south)
  }
}

/** 栅格化 A* 搜索（八邻域），规避禁飞/限飞区与建筑障碍。 */
export function aStarRoute(start: LonLat, goal: LonLat, options: GridAStarOptions): LonLat[] | null {
  const { bounds, resolution, alt, airspaces, obstacles } = options
  const startIdx = toIndex(start, bounds, resolution)
  const goalIdx = toIndex(goal, bounds, resolution)
  const { cols, rows } = startIdx
  const key = (c: number, r: number) => r * cols + c
  const blocked = (c: number, r: number) => {
    const p = fromIndex(c, r, bounds, cols, rows)
    if (blockedByAirspace(p, alt, airspaces)) return true
    if (blockedByObstacle(p, alt, obstacles)) return true
    return false
  }
  const goalKey = key(goalIdx.col, goalIdx.row)
  const startKey = key(startIdx.col, startIdx.row)
  const gScore = new Map<number, number>()
  const parent = new Map<number, number>()
  const open: Array<{ k: number; c: number; r: number; f: number }> = []
  const h = (c: number, r: number) => Math.hypot(c - goalIdx.col, r - goalIdx.row)
  gScore.set(startKey, 0)
  open.push({ k: startKey, c: startIdx.col, r: startIdx.row, f: h(startIdx.col, startIdx.row) })
  const dirs = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2]
  ]
  let iterations = 0
  while (open.length && iterations < rows * cols * 6) {
    iterations += 1
    open.sort((a, b) => a.f - b.f)
    const current = open.shift()!
    if (current.k === goalKey) {
      const path: LonLat[] = []
      let cursor: number | undefined = current.k
      while (cursor !== undefined) {
        const c = cursor % cols
        const r = Math.floor(cursor / cols)
        path.push(fromIndex(c, r, bounds, cols, rows))
        cursor = parent.get(cursor)
      }
      path.reverse()
      return path
    }
    for (const [dc, dr, cost] of dirs) {
      const nc = current.c + dc
      const nr = current.r + dr
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
      if (blocked(nc, nr)) continue
      const nk = key(nc, nr)
      const tentative = (gScore.get(current.k) ?? Infinity) + cost
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, tentative)
        parent.set(nk, current.k)
        open.push({ k: nk, c: nc, r: nr, f: tentative + h(nc, nr) })
      }
    }
  }
  return null
}

/** Catmull-Rom 样条加密，生成平滑可飞轨迹。 */
export function smoothPath(points: LonLat[], tension = 0.5, samplesPerSeg = 6): LonLat[] {
  if (points.length < 3) return points.slice()
  const result: LonLat[] = [points[0]]
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]
    for (let s = 1; s <= samplesPerSeg; s += 1) {
      const t = s / samplesPerSeg
      const t2 = t * t
      const t3 = t2 * t
      const lon =
        p1.lon +
        tension *
          ((-p0.lon + p2.lon) * t +
            (2 * p0.lon - 5 * p1.lon + 4 * p2.lon - p3.lon) * t2 +
            (-p0.lon + 3 * p1.lon - 3 * p2.lon + p3.lon) * t3)
      const lat =
        p1.lat +
        tension *
          ((-p0.lat + p2.lat) * t +
            (2 * p0.lat - 5 * p1.lat + 4 * p2.lat - p3.lat) * t2 +
            (-p0.lat + 3 * p1.lat - 3 * p2.lat + p3.lat) * t3)
      result.push({ lon, lat })
    }
  }
  return result
}

export type RouteAssessment = { risk: number; notes: string[]; conflicts: number }

/** 对航线做禁飞/限飞/障碍综合评估。 */
export function assessRoute(
  points: Waypoint[],
  airspaces: AirspaceZone[],
  obstacles: Obstacle[]
): RouteAssessment {
  const notes: string[] = []
  let risk = 0.05
  let conflicts = 0
  let forbidHit = false
  let restrictHit = false
  let obstacleHit = false
  for (const point of points) {
    const zone = blockedByAirspace(point, point.alt, airspaces)
    if (zone?.type === 'forbid') forbidHit = true
    else if (zone?.type === 'restrict') restrictHit = true
    const ob = blockedByObstacle(point, point.alt, obstacles)
    if (ob) {
      obstacleHit = true
      conflicts += 1
    }
  }
  if (forbidHit) {
    risk += 0.6
    notes.push('航段穿越禁飞区，必须调整或申请空域')
  } else {
    notes.push('未穿越禁飞区')
  }
  if (restrictHit) {
    risk += 0.25
    notes.push('航段进入限飞区，需控制真高不超过 120 m')
  } else {
    notes.push('未进入限飞区')
  }
  if (obstacleHit) {
    risk += 0.3
    notes.push(`检测到 ${conflicts} 个采样点与建筑障碍冲突`)
  } else {
    notes.push('航段与建筑障碍无冲突')
  }
  // 与建筑侧向最近距离
  let minClearance = Infinity
  for (const point of points) {
    for (const ob of obstacles) {
      const dx = Math.max(ob.west - point.lon, 0, point.lon - ob.east) * 111320
      const dy = Math.max(ob.south - point.lat, 0, point.lat - ob.north) * 111320
      minClearance = Math.min(minClearance, Math.hypot(dx, dy))
    }
  }
  if (minClearance < 60) {
    risk += 0.15
    if (minClearance < 25) risk += 0.15
    notes.push(`与建筑最小水平净空 ${minClearance.toFixed(0)} m`)
  } else if (Number.isFinite(minClearance)) {
    notes.push(`与建筑最小水平净空 ${minClearance.toFixed(0)} m`)
  }
  return { risk: clamp(risk, 0, 1), notes, conflicts }
}

export type RouteMetrics = { length: number; duration: number; energy: number }

export function routeMetrics(points: Waypoint[], speed = CRUISE_SPEED): RouteMetrics {
  const length = pathLength3d(points)
  let climb = 0
  for (let i = 1; i < points.length; i += 1) climb += Math.abs(points[i].alt - points[i - 1].alt)
  const horizontal = points.reduce((sum, p, i) => (i === 0 ? 0 : sum + haversine(points[i - 1], p)), 0)
  const duration = horizontal / speed + climb / CLIMB_RATE
  const energy = clamp((duration / 60) * 3.2 + horizontal / 1000 / 12, 3, 100)
  return { length, duration, energy }
}

function pointFromLonLat(p: LonLat, alt: number): Waypoint {
  return { lon: p.lon, lat: p.lat, alt }
}

let routeSeq = 0

function buildPlan(
  name: string,
  type: RoutePlan['type'],
  points: Waypoint[],
  context: PlannerContext,
  notes: string[]
): RoutePlan {
  const metrics = routeMetrics(points)
  const assessment = assessRoute(points, context.airspaces, context.obstacles)
  const score = clamp(
    100 - assessment.risk * 60 - (metrics.energy / 100) * 18 - Math.min(20, metrics.length / 400),
    0,
    100
  )
  routeSeq += 1
  return {
    id: `route-${Date.now()}-${routeSeq}`,
    name,
    type,
    points,
    length: metrics.length,
    duration: metrics.duration,
    energy: metrics.energy,
    risk: assessment.risk,
    score,
    status: 'candidate',
    color: '#38bdf8',
    createdAt: new Date().toISOString(),
    notes: [...notes, ...assessment.notes]
  }
}

export type WaypointTask = {
  start: LonLat
  end: LonLat
  alt: number
  resolution?: number
}

/** 航点航线：栅格 A* + Catmull-Rom 平滑，生成 2~3 个候选方案。 */
export function planWaypointRoutes(task: WaypointTask, context: PlannerContext): RoutePlan[] {
  const resolution = task.resolution ?? 140
  const raw = aStarRoute(task.start, task.end, {
    bounds: context.bounds,
    resolution,
    alt: task.alt,
    airspaces: context.airspaces,
    obstacles: context.obstacles
  })
  const plans: RoutePlan[] = []
  if (!raw || raw.length < 2) {
    const direct = smoothPath([task.start, task.end])
    plans.push(
      buildPlan('候选方案 A · 直连', 'waypoint', direct.map((p) => pointFromLonLat(p, task.alt)), context, [
        '未找到完全避障路径，回退直连航线，请人工调整'
      ])
    )
    return plans
  }
  const smoothed = smoothPath(raw, 0.5, 6)
  const dense = smoothed.map((p) => pointFromLonLat(p, task.alt))
  plans.push(buildPlan('候选方案 A · 安全优先', 'waypoint', dense, context, ['A* 栅格避障 + Catmull-Rom 平滑']))

  // 更高的候选方案：抬升高度降低障碍冲突
  const liftedAlt = Math.min(300, task.alt + 90)
  const liftedRaw = aStarRoute(task.start, task.end, {
    bounds: context.bounds,
    resolution,
    alt: liftedAlt,
    airspaces: context.airspaces,
    obstacles: context.obstacles
  })
  const lifted = smoothPath(liftedRaw && liftedRaw.length > 1 ? liftedRaw : raw, 0.5, 6)
  plans.push(
    buildPlan(
      '候选方案 B · 抬升高度',
      'waypoint',
      lifted.map((p) => pointFromLonLat(p, liftedAlt)),
      context,
      [`巡航真高抬升至 ${liftedAlt} m，降低建筑冲突`]
    )
  )

  // 更贴地的候选方案
  const lowAlt = Math.max(40, task.alt - 40)
  const lowRaw = aStarRoute(task.start, task.end, {
    bounds: context.bounds,
    resolution,
    alt: lowAlt,
    airspaces: context.airspaces,
    obstacles: context.obstacles
  })
  const low = smoothPath(lowRaw && lowRaw.length > 1 ? lowRaw : raw, 0.5, 5)
  plans.push(
    buildPlan(
      '候选方案 C · 节能低空',
      'waypoint',
      low.map((p) => pointFromLonLat(p, lowAlt)),
      context,
      [`巡航真高 ${lowAlt} m，航程更短、能耗更低`]
    )
  )
  return plans
}

/** 面状扫测航线：按间距生成蛇形覆盖。 */
export function planAreaRoute(polygon: LonLat[], spacing: number, alt: number, context: PlannerContext): RoutePlan {
  if (polygon.length < 3) {
    return buildPlan('面状扫测航线', 'area', [], context, ['请先绘制至少 3 个顶点的区域'])
  }
  const lons = polygon.map((p) => p.lon)
  const lats = polygon.map((p) => p.lat)
  const west = Math.min(...lons)
  const east = Math.max(...lons)
  const south = Math.min(...lats)
  const north = Math.max(...lats)
  const latStep = spacing / 111320
  const points: Waypoint[] = []
  let row = 0
  for (let lat = south + latStep / 2; lat < north; lat += latStep) {
    const intersections: number[] = []
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const a = polygon[j]
      const b = polygon[i]
      if (a.lat > lat !== b.lat > lat) {
        intersections.push(a.lon + ((lat - a.lat) * (b.lon - a.lon)) / (b.lat - a.lat))
      }
    }
    intersections.sort((a, b) => a - b)
    for (let k = 0; k + 1 < intersections.length; k += 2) {
      const left = intersections[k]
      const right = intersections[k + 1]
      if (row % 2 === 0) {
        points.push({ lon: left, lat, alt })
        points.push({ lon: right, lat, alt })
      } else {
        points.push({ lon: right, lat, alt })
        points.push({ lon: left, lat, alt })
      }
    }
    row += 1
  }
  return buildPlan('面状扫测航线', 'area', points, context, [
    `蛇形覆盖，航线间距 ${spacing} m，共 ${points.length} 个航点`
  ])
}

/** 环绕航线：围绕目标点固定半径生成。 */
export function planSurroundRoute(
  center: LonLat,
  radius: number,
  alt: number,
  context: PlannerContext,
  segments = 32
): RoutePlan {
  const points: Waypoint[] = []
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    const dLat = (radius / 111320) * Math.cos(angle)
    const dLon = (radius / (111320 * Math.cos((center.lat * Math.PI) / 180))) * Math.sin(angle)
    points.push({ lon: center.lon + dLon, lat: center.lat + dLat, alt })
  }
  return buildPlan('环绕侦察航线', 'surround', points, context, [
    `环绕半径 ${radius} m，巡航真高 ${alt} m，共 ${segments} 段`
  ])
}

/** 计算航线在场景中的方位角序列，供姿态参考。 */
export function segmentBearings(points: Waypoint[]): number[] {
  const result: number[] = []
  for (let i = 1; i < points.length; i += 1) result.push(bearing(points[i - 1], points[i]))
  return result
}

/** 生成演示用的默认起终点（避开禁飞区）。 */
export function defaultTaskPoints(bounds: AreaBounds): { start: LonLat; end: LonLat } {
  const center = boundsCenter(bounds)
  return {
    start: { lon: bounds.west + (center.lon - bounds.west) * 0.3, lat: bounds.south + 0.004 },
    end: { lon: bounds.east - 0.006, lat: bounds.north - 0.005 }
  }
}
