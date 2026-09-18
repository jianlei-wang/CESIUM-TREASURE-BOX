/**
 * 程序化城市规划街区模型。
 *
 * 为便于在浏览器端进行定量光线投射分析，案例不加载外部 3D Tiles，而是按规则路网
 * 生成一批轴对齐的建筑体块（参数化白模）。每栋建筑同时保存经纬度范围与局部 ENU
 * 米坐标（东—北—天），前者用于三维渲染，后者用于光线与包围盒求交。
 */

export type LonLat = { lon: number; lat: number }

export type BuildingBox = {
  id: string
  name: string
  /** 经纬度范围 */
  west: number
  east: number
  south: number
  north: number
  /** 建筑底面 / 顶面高度（米，相对地表） */
  baseHeight: number
  topHeight: number
  floors: number
  /** 局部 ENU 米坐标（相对场景中心），minX 西、maxX 东、minY 南、maxY 北 */
  minX: number
  maxX: number
  minY: number
  maxY: number
  cx: number
  cy: number
  hx: number
  hy: number
}

export type CityModel = {
  center: LonLat
  metersPerDegLon: number
  metersPerDegLat: number
  buildings: BuildingBox[]
  /** 场景范围（度） */
  west: number
  east: number
  south: number
  north: number
  widthMeters: number
  depthMeters: number
}

export type CityOptions = {
  cols?: number
  rows?: number
  blockSize?: number
  street?: number
  seed?: number
}

export const DEFAULT_CITY_CENTER: LonLat = { lon: 116.4074, lat: 39.9042 }

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const USAGE_NAMES = ['住宅楼', '办公楼', '商业楼', '公寓', '综合楼']

/**
 * 生成默认规划街区。
 * 规则路网 + 随机细分地块，建筑高度按到中心的距离形成“中心高、外围低”的簇状天际线。
 */
export function buildDefaultCity(center: LonLat = DEFAULT_CITY_CENTER, options: CityOptions = {}): CityModel {
  const cols = options.cols ?? 7
  const rows = options.rows ?? 6
  const blockSize = options.blockSize ?? 96
  const street = options.street ?? 26
  const random = mulberry32(options.seed ?? 20260120)

  const metersPerDegLat = 111320
  const metersPerDegLon = 111320 * Math.cos((center.lat * Math.PI) / 180)

  const pitch = blockSize + street
  const widthMeters = cols * blockSize + (cols + 1) * street
  const depthMeters = rows * blockSize + (rows + 1) * street
  const originX = -widthMeters / 2
  const originY = -depthMeters / 2
  const maxRadius = Math.hypot(widthMeters / 2, depthMeters / 2)

  const buildings: BuildingBox[] = []
  let index = 0

  const toLon = (x: number): number => center.lon + x / metersPerDegLon
  const toLat = (y: number): number => center.lat + y / metersPerDegLat

  const addBuilding = (
    westM: number,
    southM: number,
    eastM: number,
    northM: number,
    topHeight: number
  ): void => {
    const cx = (westM + eastM) / 2
    const cy = (southM + northM) / 2
    const hx = Math.max(4, (eastM - westM) / 2)
    const hy = Math.max(4, (northM - southM) / 2)
    const floors = Math.max(1, Math.round(topHeight / 3))
    index += 1
    const name = USAGE_NAMES[Math.floor(random() * USAGE_NAMES.length)]
    buildings.push({
      id: `B${String(index).padStart(3, '0')}`,
      name: `${name}·${String(index).padStart(3, '0')}`,
      west: toLon(westM),
      east: toLon(eastM),
      south: toLat(southM),
      north: toLat(northM),
      baseHeight: 0,
      topHeight,
      floors,
      minX: westM,
      maxX: eastM,
      minY: southM,
      maxY: northM,
      cx,
      cy,
      hx,
      hy
    })
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const blockWest = originX + street + col * pitch
      const blockSouth = originY + street + row * pitch
      const blockEast = blockWest + blockSize
      const blockNorth = blockSouth + blockSize
      const blockCx = (blockWest + blockEast) / 2
      const blockCy = (blockSouth + blockNorth) / 2
      const distance = Math.hypot(blockCx, blockCy)
      const proximity = Math.max(0, 1 - distance / maxRadius)
      const towerChance = proximity > 0.55 ? 0.5 : 0.16
      const baseHeight = 15 + proximity * 26 + random() * 14

      const splitX = blockSize > 62 ? (random() < 0.72 ? 2 : 1) : 1
      const splitY = blockSize > 62 ? (random() < 0.6 ? 2 : 1) : 1
      const gap = 7
      const lotWidth = (blockSize - (splitX - 1) * gap) / splitX
      const lotDepth = (blockSize - (splitY - 1) * gap) / splitY

      for (let sy = 0; sy < splitY; sy += 1) {
        for (let sx = 0; sx < splitX; sx += 1) {
          const margin = 3 + random() * 3
          const westM = blockWest + sx * (lotWidth + gap) + margin
          const eastM = blockWest + sx * (lotWidth + gap) + lotWidth - margin
          const southM = blockSouth + sy * (lotDepth + gap) + margin
          const northM = blockSouth + sy * (lotDepth + gap) + lotDepth - margin
          if (eastM - westM < 12 || northM - southM < 12) continue

          const lotCenterX = (westM + eastM) / 2
          const lotCenterY = (southM + northM) / 2
          const lotDistance = Math.hypot(lotCenterX, lotCenterY)
          const lotProximity = Math.max(0, 1 - lotDistance / maxRadius)

          let height = baseHeight * (0.72 + random() * 0.62)
          if (random() < towerChance) {
            height += 38 + lotProximity * 86 + random() * 30
          } else {
            height += lotProximity * 22
          }
          height = Math.max(12, Math.min(168, height))

          // 部分建筑退线留出广场
          if (random() < 0.08) continue
          addBuilding(westM, southM, eastM, northM, Math.round(height))
        }
      }
    }
  }

  return {
    center,
    metersPerDegLon,
    metersPerDegLat,
    buildings,
    west: toLon(originX),
    east: toLon(originX + widthMeters),
    south: toLat(originY),
    north: toLat(originY + depthMeters),
    widthMeters,
    depthMeters
  }
}

/** 局部 ENU 米坐标 → 经纬度 */
export function localToLonLat(city: CityModel, x: number, y: number): LonLat {
  return {
    lon: city.center.lon + x / city.metersPerDegLon,
    lat: city.center.lat + y / city.metersPerDegLat
  }
}

/** 经纬度 → 局部 ENU 米坐标 */
export function lonLatToLocal(city: CityModel, lon: number, lat: number): { x: number; y: number } {
  return {
    x: (lon - city.center.lon) * city.metersPerDegLon,
    y: (lat - city.center.lat) * city.metersPerDegLat
  }
}

/**
 * 光线与建筑包围盒求交（slab 算法）。
 * @returns 命中距离 t（米），未命中返回 null
 */
export function rayBoxIntersect(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number
): number | null {
  let tMin = 0
  let tMax = Number.POSITIVE_INFINITY

  const axes: [number, number, number, number][] = [
    [ox, dx, minX, maxX],
    [oy, dy, minY, maxY],
    [oz, dz, minZ, maxZ]
  ]

  for (const [origin, direction, lo, hi] of axes) {
    if (Math.abs(direction) < 1e-9) {
      if (origin < lo || origin > hi) return null
      continue
    }
    const inv = 1 / direction
    let t1 = (lo - origin) * inv
    let t2 = (hi - origin) * inv
    if (t1 > t2) {
      const tmp = t1
      t1 = t2
      t2 = tmp
    }
    if (t1 > tMin) tMin = t1
    if (t2 < tMax) tMax = t2
    if (tMin > tMax) return null
  }

  return tMin
}

/**
 * 判断从局部点 (ox,oy,oz) 沿太阳方向是否被建筑遮挡。
 */
export function isOccludedByBuildings(
  city: CityModel,
  ox: number,
  oy: number,
  oz: number,
  direction: { east: number; north: number; up: number },
  maxDistance: number
): boolean {
  for (const building of city.buildings) {
    const t = rayBoxIntersect(
      ox,
      oy,
      oz,
      direction.east,
      direction.north,
      direction.up,
      building.minX,
      building.maxX,
      building.minY,
      building.maxY,
      building.baseHeight,
      building.topHeight
    )
    if (t !== null && t > 0.05 && t < maxDistance) return true
  }
  return false
}
