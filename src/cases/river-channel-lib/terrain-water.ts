import {
  BoundingSphere,
  Cartesian3,
  Cartographic,
  ComponentDatatype,
  Ellipsoid,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  PrimitiveType,
  sampleTerrainMostDetailed,
  type TerrainProvider
} from 'cesium'

/** 经纬度包围盒（度）。 */
export type LonLatBounds = {
  west: number
  south: number
  east: number
  north: number
}

/** 用户手绘的河道多边形，顶点为 [经度, 纬度]。 */
export type LonLatPolygon = ReadonlyArray<readonly [number, number]>

/** 采样得到的地形高度栅格。row 0 对应最北侧一行。 */
export type TerrainGrid = {
  bounds: LonLatBounds
  cols: number
  rows: number
  heights: Float32Array
  min: number
  max: number
}

export type WaterMesh = {
  geometry: Geometry
  bounds: LonLatBounds
  widthMeters: number
  heightMeters: number
}

/**
 * 由地形与河道走向自动判定的流场。
 * vectors 逐格点存放 (east, north) 单位流向，河道外为 (0, 0)。
 */
export type FlowField = {
  vectors: Float32Array
  /** 全河段主流向方位角（度，正北 0°，顺时针为正） */
  bearing: number
  /** 参与判定的河道格点数 */
  corridorCells: number
}

/** 判定为河道走廊的最小水深（米） */
const FLOW_MIN_DEPTH = 0.2
/** 求坡降与河道主轴所用的邻域半径（格） */
const FLOW_WINDOW = 9

const SAMPLE_BATCH = 4096

const scratchPosition = new Cartesian3()
const scratchNormal = new Cartesian3()

export function boundsSizeMeters(bounds: LonLatBounds): { widthMeters: number; heightMeters: number } {
  const midLat = (bounds.south + bounds.north) / 2
  const mPerLon = 111320 * Math.max(0.05, Math.cos((midLat * Math.PI) / 180))
  const mPerLat = 111320
  return {
    widthMeters: Math.max(1, (bounds.east - bounds.west) * mPerLon),
    heightMeters: Math.max(1, (bounds.north - bounds.south) * mPerLat)
  }
}

function lonAt(bounds: LonLatBounds, c: number, cols: number): number {
  if (cols <= 1) return (bounds.west + bounds.east) / 2
  return bounds.west + ((bounds.east - bounds.west) * c) / (cols - 1)
}

/** row 0 = 最北，row rows-1 = 最南。 */
function latAt(bounds: LonLatBounds, r: number, rows: number): number {
  if (rows <= 1) return (bounds.south + bounds.north) / 2
  return bounds.north - ((bounds.north - bounds.south) * r) / (rows - 1)
}

/**
 * 按经纬度栅格采样真实地形高度（Cesium 世界地形，最精细级别）。
 * 分批请求，避免一次性抛出过多采样点。
 */
export async function sampleTerrainGrid(
  provider: TerrainProvider,
  bounds: LonLatBounds,
  cols: number,
  rows: number,
  onProgress?: (done: number, total: number) => void
): Promise<TerrainGrid> {
  const total = cols * rows
  const heights = new Float32Array(total)
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let done = 0
  const rowsPerBatch = Math.max(1, Math.floor(SAMPLE_BATCH / cols))

  for (let r0 = 0; r0 < rows; r0 += rowsPerBatch) {
    const r1 = Math.min(rows, r0 + rowsPerBatch)
    const samples: Cartographic[] = []
    for (let r = r0; r < r1; r += 1) {
      const lat = latAt(bounds, r, rows)
      for (let c = 0; c < cols; c += 1) {
        samples.push(Cartographic.fromDegrees(lonAt(bounds, c, cols), lat, 0))
      }
    }
    await sampleTerrainMostDetailed(provider, samples)
    for (let r = r0; r < r1; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const sample = samples[(r - r0) * cols + c]
        const raw = sample?.height
        const h = Number.isFinite(raw) ? (raw as number) : Number.NaN
        const k = r * cols + c
        if (Number.isFinite(h)) {
          heights[k] = h
          if (h < min) min = h
          if (h > max) max = h
        } else {
          heights[k] = Number.NaN
        }
      }
    }
    done += (r1 - r0) * cols
    onProgress?.(done, total)
  }

  fillMissingHeights(heights, cols, rows, Number.isFinite(min) ? min : 0)
  if (!Number.isFinite(min)) {
    min = 0
    max = 1
  }
  if (max <= min) max = min + 1

  return { bounds, cols, rows, heights, min, max }
}

/**
 * 由真实地形与河道走向自动判定水流方向，不依赖人工指定的流向角：
 * 1. 以「水深大于阈值」圈定河道走廊（掩膜），河道关系即由该掩膜体现；
 * 2. 对走廊内的河床高程做重度平滑得到区域势面，其负梯度即地形坡降方向；
 *    对全河段坡降做深度加权矢量平均，得到稳定的「全局下游方向」，
 *    用于统一确定每条流线的正负号（水一定由高处流向低处）；
 * 3. 用走廊掩膜的加权协方差（结构张量）求每个格点处河道的主轴方向，
 *    以它作为流线切线：这样平缓水库段不会因坡度噪声而乱流，
 *    河道转弯处流向也会随河道走向自然偏转；
 * 4. 主轴指向上游还是下游由全局下游方向决定，最后对矢量场做邻域平滑。
 */
export function computeFlowField(
  grid: TerrainGrid,
  waterLevel: number,
  polygon?: LonLatPolygon
): FlowField {
  const { cols, rows, heights } = grid
  const count = cols * rows
  const { widthMeters, heightMeters } = boundsSizeMeters(grid.bounds)
  const dx = cols > 1 ? widthMeters / (cols - 1) : widthMeters
  const dy = rows > 1 ? heightMeters / (rows - 1) : heightMeters

  const mask = new Float32Array(count)
  let corridorCells = 0
  for (let k = 0; k < count; k += 1) {
    if (waterLevel - heights[k] > FLOW_MIN_DEPTH) {
      mask[k] = 1
      corridorCells += 1
    }
  }
  if (polygon && polygon.length >= 3) {
    corridorCells = 0
    for (let r = 0; r < rows; r += 1) {
      const lat = latAt(grid.bounds, r, rows)
      for (let c = 0; c < cols; c += 1) {
        const k = r * cols + c
        if (mask[k] === 0) continue
        if (!pointInPolygon(lonAt(grid.bounds, c, cols), lat, polygon)) {
          mask[k] = 0
          continue
        }
        corridorCells += 1
      }
    }
  }

  const vectors = new Float32Array(count * 2)
  if (corridorCells < 4) return { vectors, bearing: 0, corridorCells }

  // 2. 走廊内河床高程的重度平滑 → 区域坡降
  const potential = maskedBoxAverage(heights, mask, cols, rows, FLOW_WINDOW)
  const descEast = new Float32Array(count)
  const descNorth = new Float32Array(count)
  for (let r = 0; r < rows; r += 1) {
    const rm = r > 0 ? r - 1 : r
    const rp = r < rows - 1 ? r + 1 : r
    const spanY = (rp - rm) * dy || dy
    for (let c = 0; c < cols; c += 1) {
      const cm = c > 0 ? c - 1 : c
      const cp = c < cols - 1 ? c + 1 : c
      const spanX = (cp - cm) * dx || dx
      const k = r * cols + c
      // 坡降 = -∇高程：北向以 row 0（最北）为正向
      descEast[k] = -(potential[r * cols + cp] - potential[r * cols + cm]) / spanX
      descNorth[k] = -(potential[rm * cols + c] - potential[rp * cols + c]) / spanY
    }
  }

  let globalEast = 0
  let globalNorth = 0
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const k = r * cols + c
      if (mask[k] === 0) continue
      const w = Math.max(0.5, waterLevel - heights[k])
      globalEast += descEast[k] * w
      globalNorth += descNorth[k] * w
    }
  }
  const globalLength = Math.hypot(globalEast, globalNorth)
  const hasGlobal = globalLength > 1e-9
  if (hasGlobal) {
    globalEast /= globalLength
    globalNorth /= globalLength
  }

  // 3. 走廊掩膜的结构张量 → 局部河道主轴
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const k = r * cols + c
      if (mask[k] === 0) continue
      let s0 = 0
      let sx = 0
      let sy = 0
      let sxx = 0
      let sxy = 0
      let syy = 0
      for (let dr = -FLOW_WINDOW; dr <= FLOW_WINDOW; dr += 1) {
        const rr = r + dr
        if (rr < 0 || rr >= rows) continue
        const py = -dr * dy
        for (let dc = -FLOW_WINDOW; dc <= FLOW_WINDOW; dc += 1) {
          const cc = c + dc
          if (cc < 0 || cc >= cols) continue
          const w = mask[rr * cols + cc]
          if (w === 0) continue
          const px = dc * dx
          s0 += w
          sx += w * px
          sy += w * py
          sxx += w * px * px
          sxy += w * px * py
          syy += w * py * py
        }
      }
      if (s0 < 1) continue
      const mx = sx / s0
      const my = sy / s0
      const cxx = sxx / s0 - mx * mx
      const cxy = sxy / s0 - mx * my
      const cyy = syy / s0 - my * my
      const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy)
      let axisEast = Math.cos(theta)
      let axisNorth = Math.sin(theta)
      // 4. 主轴指向下游还是上游：由全局下游方向（退化时用本格坡降）决定
      const ref = hasGlobal
        ? axisEast * globalEast + axisNorth * globalNorth
        : axisEast * descEast[k] + axisNorth * descNorth[k]
      if (ref < 0) {
        axisEast = -axisEast
        axisNorth = -axisNorth
      }
      vectors[k * 2] = axisEast
      vectors[k * 2 + 1] = axisNorth
    }
  }

  smoothFlowVectors(vectors, mask, cols, rows, 2)

  let sumEast = 0
  let sumNorth = 0
  let sumWeight = 0
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const k = r * cols + c
      if (mask[k] === 0) continue
      const e = vectors[k * 2]
      const n = vectors[k * 2 + 1]
      const length = Math.hypot(e, n)
      if (length < 1e-6) continue
      vectors[k * 2] = e / length
      vectors[k * 2 + 1] = n / length
      const w = Math.max(0.5, waterLevel - heights[k])
      sumEast += vectors[k * 2] * w
      sumNorth += vectors[k * 2 + 1] * w
      sumWeight += w
    }
  }

  const bearing =
    sumWeight > 0 ? (Math.atan2(sumEast, sumNorth) * (180 / Math.PI) + 360) % 360 : 0
  return { vectors, bearing, corridorCells }
}

/** 在走廊掩膜内对源数据做邻域均值（掩膜为 0 的格点不参与，也不被填充）。 */
function maskedBoxAverage(
  src: Float32Array,
  mask: Float32Array,
  cols: number,
  rows: number,
  radius: number
): Float32Array {
  const out = new Float32Array(src.length)
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const k = r * cols + c
      let sum = 0
      let weight = 0
      for (let dr = -radius; dr <= radius; dr += 1) {
        const rr = r + dr
        if (rr < 0 || rr >= rows) continue
        for (let dc = -radius; dc <= radius; dc += 1) {
          const cc = c + dc
          if (cc < 0 || cc >= cols) continue
          const w = mask[rr * cols + cc]
          if (w === 0) continue
          sum += src[rr * cols + cc] * w
          weight += w
        }
      }
      out[k] = weight > 0 ? sum / weight : src[k]
    }
  }
  return out
}

/** 在走廊内对流向矢量做邻域平滑，去掉孤立异常方向。 */
function smoothFlowVectors(
  vectors: Float32Array,
  mask: Float32Array,
  cols: number,
  rows: number,
  iterations: number
): void {
  const source = new Float32Array(vectors.length)
  for (let it = 0; it < iterations; it += 1) {
    source.set(vectors)
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const k = r * cols + c
        if (mask[k] === 0) continue
        let sumEast = 0
        let sumNorth = 0
        let weight = 0
        for (let dr = -1; dr <= 1; dr += 1) {
          const rr = r + dr
          if (rr < 0 || rr >= rows) continue
          for (let dc = -1; dc <= 1; dc += 1) {
            const cc = c + dc
            if (cc < 0 || cc >= cols) continue
            const kk = rr * cols + cc
            const w = mask[kk]
            if (w === 0) continue
            sumEast += source[kk * 2] * w
            sumNorth += source[kk * 2 + 1] * w
            weight += w
          }
        }
        if (weight === 0) continue
        vectors[k * 2] = sumEast / weight
        vectors[k * 2 + 1] = sumNorth / weight
      }
    }
  }
}

/** 用邻域平均值填补采样失败（NaN）的格点，避免出现空洞。 */
function fillMissingHeights(heights: Float32Array, cols: number, rows: number, fallback: number): void {
  let missing = 0
  for (let i = 0; i < heights.length; i += 1) {
    if (!Number.isFinite(heights[i])) missing += 1
  }
  if (missing === 0) return
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const k = r * cols + c
      if (Number.isFinite(heights[k])) continue
      let sum = 0
      let count = 0
      for (let dr = -1; dr <= 1; dr += 1) {
        const rr = r + dr
        if (rr < 0 || rr >= rows) continue
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dr === 0 && dc === 0) continue
          const cc = c + dc
          if (cc < 0 || cc >= cols) continue
          const nv = heights[rr * cols + cc]
          if (Number.isFinite(nv)) {
            sum += nv
            count += 1
          }
        }
      }
      heights[k] = count > 0 ? sum / count : fallback
    }
  }
}

/** 射线法判断经纬度点是否落在多边形内（含边界附近）。 */
export function pointInPolygon(lon: number, lat: number, polygon: LonLatPolygon): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i][0]
    const yi = polygon[i][1]
    const xj = polygon[j][0]
    const yj = polygon[j][1]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** 由地形高度估算一个能形成可见水面的水位：
 * 取高度的低分位值，保证 bbox 内相当一部分河谷被淹没。
 * 若给定河道多边形，则只用多边形内的地形参与统计。
 */
export function estimateWaterLevel(grid: TerrainGrid, fraction = 0.16, polygon?: LonLatPolygon): number {
  const { bounds, cols, rows, heights } = grid
  let values: number[] = []
  if (polygon && polygon.length >= 3) {
    for (let r = 0; r < rows; r += 1) {
      const lat = latAt(bounds, r, rows)
      for (let c = 0; c < cols; c += 1) {
        if (!pointInPolygon(lonAt(bounds, c, cols), lat, polygon)) continue
        values.push(heights[r * cols + c])
      }
    }
  }
  if (values.length === 0) values = Array.from(grid.heights)
  values.sort((a, b) => a - b)
  const clamped = Math.min(0.9, Math.max(0.01, fraction))
  const index = Math.min(values.length - 1, Math.max(0, Math.round(clamped * (values.length - 1))))
  return values[index]
}

/**
 * 以固定水位构建水面网格：
 * - 顶点高程统一为 waterLevel，形成水平水面；
 * - 逐顶点写入水深 aDepth = waterLevel - 河床高度，供着色器做深浅渐变；
 * - 逐顶点写入流向 aFlow（自动判定的单位向量）；
 * - elevationOffset 用于在保留真实水深的前提下把网格整体抬高，
 *   便于在同一河段上叠加第二层（如动态流向箭头）而不与水面争深度；
 * - 给定 polygon 时，多边形外的顶点水深写为负值，由着色器裁剪，
 *   于是水面范围被限制在用户手绘的河道多边形内；
 * - 水面高于河床处着色器才绘制，因此河岸线由真实等高线决定。
 */
export function buildWaterMesh(
  grid: TerrainGrid,
  waterLevel: number,
  flow: FlowField,
  elevationOffset = 0,
  polygon?: LonLatPolygon
): WaterMesh {
  const { bounds, cols, rows, heights } = grid
  const count = cols * rows
  const positions = new Float64Array(count * 3)
  const normals = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)
  const depths = new Float32Array(count)
  const flows = flow.vectors

  for (let r = 0; r < rows; r += 1) {
    const lat = latAt(bounds, r, rows)
    const v = rows <= 1 ? 0.5 : r / (rows - 1)
    for (let c = 0; c < cols; c += 1) {
      const lon = lonAt(bounds, c, cols)
      const u = cols <= 1 ? 0.5 : c / (cols - 1)
      const k = r * cols + c

      Cartesian3.fromDegrees(lon, lat, waterLevel + elevationOffset, Ellipsoid.WGS84, scratchPosition)
      positions[k * 3] = scratchPosition.x
      positions[k * 3 + 1] = scratchPosition.y
      positions[k * 3 + 2] = scratchPosition.z

      Ellipsoid.WGS84.geodeticSurfaceNormal(scratchPosition, scratchNormal)
      normals[k * 3] = scratchNormal.x
      normals[k * 3 + 1] = scratchNormal.y
      normals[k * 3 + 2] = scratchNormal.z

      // st.y 向北为正，和流向角（0°=正东，逆时针向北）保持一致
      uvs[k * 2] = u
      uvs[k * 2 + 1] = 1 - v

      depths[k] = waterLevel - heights[k]
      // 多边形外的顶点用负水深裁剪掉，把水面限制在手绘河道内
      if (polygon && polygon.length >= 3 && !pointInPolygon(lon, lat, polygon)) {
        depths[k] = -1
      }
    }
  }

  const quadCount = Math.max(0, cols - 1) * Math.max(0, rows - 1)
  const indices = new Uint32Array(quadCount * 6)
  let o = 0
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const a = r * cols + c
      const b = a + 1
      const d = (r + 1) * cols + c
      const e = d + 1
      indices[o] = a
      indices[o + 1] = d
      indices[o + 2] = b
      indices[o + 3] = b
      indices[o + 4] = d
      indices[o + 5] = e
      o += 6
    }
  }

  const attributes = new GeometryAttributes() as GeometryAttributes &
    Record<string, GeometryAttribute | undefined>
  attributes.position = new GeometryAttribute({
    componentDatatype: ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positions
  })
  attributes.normal = new GeometryAttribute({
    componentDatatype: ComponentDatatype.FLOAT,
    componentsPerAttribute: 3,
    values: normals
  })
  attributes.st = new GeometryAttribute({
    componentDatatype: ComponentDatatype.FLOAT,
    componentsPerAttribute: 2,
    values: uvs
  })
  attributes.aDepth = new GeometryAttribute({
    componentDatatype: ComponentDatatype.FLOAT,
    componentsPerAttribute: 1,
    values: depths
  })
  attributes.aFlow = new GeometryAttribute({
    componentDatatype: ComponentDatatype.FLOAT,
    componentsPerAttribute: 2,
    values: flows
  })

  const geometry = new Geometry({
    attributes,
    indices,
    primitiveType: PrimitiveType.TRIANGLES,
    boundingSphere: BoundingSphere.fromVertices(positions as unknown as number[])
  })

  const { widthMeters, heightMeters } = boundsSizeMeters(bounds)
  return { geometry, bounds, widthMeters, heightMeters }
}
