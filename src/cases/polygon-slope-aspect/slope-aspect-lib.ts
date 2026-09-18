import * as Cesium from 'cesium'
import {
  bilinearHeight,
  createSampleGrid,
  createSurfaceAppearance,
  fillGridStats,
  nodeLonLat,
  paletteGradientCss,
  pointInRing,
  rampRgb,
  rayRingIntersection,
  PALETTE_OPTIONS,
  type PaletteKey,
  type Ring,
  type SampleGrid
} from '../polygon-depth-contour/depth-contour-lib'

export {
  bilinearHeight,
  createSampleGrid,
  createSurfaceAppearance,
  fillGridStats,
  nodeLonLat,
  paletteGradientCss,
  pointInRing,
  rampRgb,
  PALETTE_OPTIONS,
  type PaletteKey,
  type Ring,
  type SampleGrid
}

export type AspectCode = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'

export type AspectDirection = {
  code: AspectCode
  label: string
  deg: number
  css: string
}

export const ASPECT_DIRECTIONS: AspectDirection[] = [
  { code: 'N', label: '北', deg: 0, css: '#e8554d' },
  { code: 'NE', label: '东北', deg: 45, css: '#f2902f' },
  { code: 'E', label: '东', deg: 90, css: '#e8bd2d' },
  { code: 'SE', label: '东南', deg: 135, css: '#82c341' },
  { code: 'S', label: '南', deg: 180, css: '#2fb089' },
  { code: 'SW', label: '西南', deg: 225, css: '#4a9edb' },
  { code: 'W', label: '西', deg: 270, css: '#7a7fd8' },
  { code: 'NW', label: '西北', deg: 315, css: '#bd6ed0' }
]

export function aspectDirectionCss(code: AspectCode): string {
  return ASPECT_DIRECTIONS.find((direction) => direction.code === code)?.css ?? '#ffffff'
}

export function aspectIndexFromDeg(deg: number): number {
  const normalized = ((deg % 360) + 360) % 360
  return ((Math.round(normalized / 45) % 8) + 8) % 8
}

export function aspectDirectionAt(deg: number): AspectDirection {
  return ASPECT_DIRECTIONS[aspectIndexFromDeg(deg)]
}

export type SlopeField = {
  nx: number
  ny: number
  slopeDeg: Float32Array
  gradE: Float32Array
  gradN: Float32Array
  cellCount: number
  avgSlopeDeg: number
  maxSlopeDeg: number
  aspectHist: number[]
  flatCells: number
  countedCells: number
  dominantIndex: number
  dominantRatio: number
}

const METERS_PER_DEG_LAT = 111320

function metersPerDegLonAt(latDeg: number): number {
  return METERS_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180)
}

function nodeIndex(grid: SampleGrid, row: number, col: number): number {
  return row * grid.nx + col
}

function sampleGradient(grid: SampleGrid, row: number, col: number, field: Pick<SlopeField, 'gradE' | 'gradN' | 'slopeDeg'>): void {
  const index = nodeIndex(grid, row, col)
  const { heights, nx, ny, cellLon, cellLat } = grid
  const latDeg = grid.north + row * grid.cellLat
  const lonMeters = Math.abs(cellLon) * metersPerDegLonAt(latDeg)
  const latMeters = Math.abs(cellLat) * METERS_PER_DEG_LAT
  const center = heights[index]
  const hasEast = col + 1 < nx
  const hasWest = col > 0
  const hasNorth = row > 0
  const hasSouth = row + 1 < ny
  let gradE: number
  let gradN: number
  if (hasEast && hasWest) {
    gradE = (heights[index + 1] - heights[index - 1]) / (2 * lonMeters)
  } else if (hasEast) {
    gradE = (heights[index + 1] - center) / lonMeters
  } else if (hasWest) {
    gradE = (center - heights[index - 1]) / lonMeters
  } else {
    gradE = 0
  }
  if (hasNorth && hasSouth) {
    gradN = (heights[index - nx] - heights[index + nx]) / (2 * latMeters)
  } else if (hasNorth) {
    gradN = (heights[index - nx] - center) / latMeters
  } else if (hasSouth) {
    gradN = (center - heights[index + nx]) / latMeters
  } else {
    gradN = 0
  }
  field.gradE[index] = gradE
  field.gradN[index] = gradN
  field.slopeDeg[index] = (Math.atan(Math.hypot(gradE, gradN)) * 180) / Math.PI
}

function cellCenterIndex(grid: SampleGrid, row: number, col: number): { lon: number; lat: number } {
  return {
    lon: grid.west + (col + 0.5) * grid.cellLon,
    lat: grid.north + (row + 0.5) * grid.cellLat
  }
}

function cellAspect(grid: SampleGrid, field: SlopeField, row: number, col: number): { bearingDeg: number; slopeDeg: number } | undefined {
  const corners = [
    [row, col],
    [row, col + 1],
    [row + 1, col],
    [row + 1, col + 1]
  ]
  let gradE = 0
  let gradN = 0
  let valid = 0
  for (const [cornerRow, cornerCol] of corners) {
    const index = nodeIndex(grid, cornerRow, cornerCol)
    const e = field.gradE[index]
    const n = field.gradN[index]
    gradE += e
    gradN += n
    valid += 1
  }
  if (valid === 0) return undefined
  gradE /= valid
  gradN /= valid
  const slopeDeg = (Math.atan(Math.hypot(gradE, gradN)) * 180) / Math.PI
  const bearingDeg = (Math.atan2(-gradE, -gradN) * 180) / Math.PI
  return { bearingDeg, slopeDeg }
}

export function computeSlopeField(grid: SampleGrid, ring: Ring, flatThresholdDeg: number): SlopeField {
  const { nx, ny } = grid
  const slopeDeg = new Float32Array(nx * ny)
  const gradE = new Float32Array(nx * ny)
  const gradN = new Float32Array(nx * ny)
  const field: SlopeField = {
    nx,
    ny,
    slopeDeg,
    gradE,
    gradN,
    cellCount: 0,
    avgSlopeDeg: 0,
    maxSlopeDeg: 0,
    aspectHist: [0, 0, 0, 0, 0, 0, 0, 0],
    flatCells: 0,
    countedCells: 0,
    dominantIndex: 0,
    dominantRatio: 0
  }
  for (let row = 0; row < ny; row += 1) {
    for (let col = 0; col < nx; col += 1) {
      sampleGradient(grid, row, col, field)
    }
  }
  let sumSlope = 0
  let maxSlope = 0
  let cellCount = 0
  for (let row = 0; row < ny - 1; row += 1) {
    for (let col = 0; col < nx - 1; col += 1) {
      const center = cellCenterIndex(grid, row, col)
      if (!pointInRing(center.lon, center.lat, ring)) continue
      const aspect = cellAspect(grid, field, row, col)
      if (!aspect) continue
      sumSlope += aspect.slopeDeg
      if (aspect.slopeDeg > maxSlope) maxSlope = aspect.slopeDeg
      cellCount += 1
      if (aspect.slopeDeg >= flatThresholdDeg) {
        const bucket = aspectIndexFromDeg(aspect.bearingDeg)
        field.aspectHist[bucket] += 1
      } else {
        field.flatCells += 1
      }
    }
  }
  field.cellCount = cellCount
  field.countedCells = field.aspectHist.reduce((sum, count) => sum + count, 0)
  field.avgSlopeDeg = cellCount > 0 ? sumSlope / cellCount : 0
  field.maxSlopeDeg = maxSlope
  let dominantIndex = -1
  let dominantCount = 0
  for (let index = 0; index < 8; index += 1) {
    if (field.aspectHist[index] > dominantCount) {
      dominantCount = field.aspectHist[index]
      dominantIndex = index
    }
  }
  field.dominantIndex = dominantIndex
  field.dominantRatio = field.countedCells > 0 ? dominantCount / field.countedCells : 0
  return field
}

export type SlopeSurfaceOptions = {
  palette: PaletteKey
  opacity: number
  capDeg: number
}

export function buildSlopeSurfaceGeometry(
  grid: SampleGrid,
  ring: Ring,
  field: SlopeField,
  options: SlopeSurfaceOptions
): Cesium.Geometry {
  const { nx, ny, west, north, cellLon, cellLat } = grid
  const cellRowCount = ny - 1
  const cellColCount = nx - 1
  const pending: { row: number; col: number }[] = []
  const alphaByte = Math.round(Math.min(1, Math.max(0, options.opacity)) * 255)
  const cap = Math.max(0.1, options.capDeg)

  for (let row = 0; row < cellRowCount; row += 1) {
    const centerLat = north + (row + 0.5) * cellLat
    for (let col = 0; col < cellColCount; col += 1) {
      const centerLon = west + (col + 0.5) * cellLon
      if (pointInRing(centerLon, centerLat, ring)) {
        pending.push({ row, col })
      }
    }
  }

  const vertices = pending.length * 6
  const positions = new Float64Array(vertices * 3)
  const colors = new Uint8Array(vertices * 4)

  const cornerOffset = (corner: number): [number, number] => {
    switch (corner) {
      case 0: return [0, 0]
      case 1: return [0, 1]
      case 2: return [1, 1]
      default: return [1, 0]
    }
  }

  const pushVertex = (offset: number, lon: number, lat: number, height: number): void => {
    const cartesian = Cesium.Cartesian3.fromDegrees(lon, lat, height)
    positions[offset] = cartesian.x
    positions[offset + 1] = cartesian.y
    positions[offset + 2] = cartesian.z
  }

  let base = 0
  for (const cell of pending) {
    const row = cell.row
    const col = cell.col
    const centerLat = north + (row + 0.5) * cellLat
    const centerLon = west + (col + 0.5) * cellLon
    const center = { lon: centerLon, lat: centerLat }
    const points: { lon: number; lat: number; height: number; r: number; g: number; b: number }[] = []
    for (let corner = 0; corner < 4; corner += 1) {
      const [dRow, dCol] = cornerOffset(corner)
      const nodeRow = row + dRow
      const nodeCol = col + dCol
      let point = nodeLonLat(grid, nodeRow, nodeCol)
      if (!pointInRing(point.lon, point.lat, ring)) {
        point = rayRingIntersection(center, point, ring) ?? point
      }
      const height = bilinearHeight(grid, point.lon, point.lat)
      const nodeSlope = field.slopeDeg[nodeIndex(grid, nodeRow, nodeCol)]
      const t = Math.min(1, Math.max(0, nodeSlope / cap))
      const rgb = rampRgb(options.palette, t)
      points.push({ lon: point.lon, lat: point.lat, height, r: rgb[0], g: rgb[1], b: rgb[2] })
    }
    const triangleCornerSets = [
      [0, 1, 3],
      [1, 2, 3]
    ]
    for (const triangle of triangleCornerSets) {
      for (const cornerIndex of triangle) {
        const point = points[cornerIndex]
        pushVertex(base * 3, point.lon, point.lat, point.height)
        const colorOffset = base * 4
        colors[colorOffset] = point.r
        colors[colorOffset + 1] = point.g
        colors[colorOffset + 2] = point.b
        colors[colorOffset + 3] = alphaByte
        base += 1
      }
    }
  }

  const attributes = new Cesium.GeometryAttributes()
  attributes.position = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positions
  })
  attributes.color = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
    componentsPerAttribute: 4,
    normalize: true,
    values: colors
  })
  return new Cesium.Geometry({
    attributes,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(positions)
  })
}

export type AspectColorMode = 'aspect' | 'custom'

export type AspectArrowStyle = {
  stride: number
  lengthRatio: number
  width: number
  alpha: number
  flatThresholdDeg: number
  colorMode: AspectColorMode
  customColor: string
  lift: number
}

export function buildAspectArrowPrimitive(
  grid: SampleGrid,
  ring: Ring,
  field: SlopeField,
  style: AspectArrowStyle
): Cesium.Primitive | undefined {
  const { nx, ny, cellLon, cellLat } = grid
  const stride = Math.max(1, Math.round(style.stride))
  const arrowColor = style.colorMode === 'custom' ? Cesium.Color.fromCssColorString(style.customColor).withAlpha(Math.min(1, Math.max(0, style.alpha))) : undefined
  const stepLat = Math.abs(cellLat)
  const instances: Cesium.GeometryInstance[] = []
  const vertexFormat = Cesium.PolylineColorAppearance.VERTEX_FORMAT
  for (let row = 0; row < ny - 1; row += stride) {
    for (let col = 0; col < nx - 1; col += stride) {
      const center = cellCenterIndex(grid, row, col)
      if (!pointInRing(center.lon, center.lat, ring)) continue
      const aspect = cellAspect(grid, field, row, col)
      if (!aspect || aspect.slopeDeg < style.flatThresholdDeg) continue
      const latMeters = METERS_PER_DEG_LAT * stepLat
      const lonMeters = metersPerDegLonAt(center.lat) * Math.abs(cellLon)
      const cellMeters = (lonMeters + latMeters) / 2
      const lengthMeters = Math.max(0.05, cellMeters) * Math.max(0.2, style.lengthRatio)
      const bearingRad = (aspect.bearingDeg * Math.PI) / 180
      const dirLon = (Math.sin(bearingRad) * lengthMeters) / metersPerDegLonAt(center.lat)
      const dirLat = (Math.cos(bearingRad) * lengthMeters) / METERS_PER_DEG_LAT
      const perpLon = (-Math.cos(bearingRad) * lengthMeters) / metersPerDegLonAt(center.lat)
      const perpLat = (Math.sin(bearingRad) * lengthMeters) / METERS_PER_DEG_LAT
      const headLon = dirLon * 0.45
      const headLat = dirLat * 0.45
      const wingLon = perpLon * 0.28
      const wingLat = perpLat * 0.28
      const tipLon = center.lon + dirLon
      const tipLat = center.lat + dirLat
      const wingALon = tipLon - headLon + wingLon
      const wingALat = tipLat - headLat + wingLat
      const wingBLon = tipLon - headLon - wingLon
      const wingBLat = tipLat - headLat - wingLat
      const rawPoints = [
        { lon: center.lon, lat: center.lat },
        { lon: tipLon, lat: tipLat },
        { lon: wingALon, lat: wingALat },
        { lon: tipLon, lat: tipLat },
        { lon: wingBLon, lat: wingBLat }
      ]
      const flatLonLat: number[] = []
      const vertexColors: Cesium.Color[] = []
      let direction = arrowColor
      if (!direction) {
        const bucket = aspectIndexFromDeg(aspect.bearingDeg)
        direction = Cesium.Color.fromCssColorString(ASPECT_DIRECTIONS[bucket].css).withAlpha(Math.min(1, Math.max(0, style.alpha)))
      }
      for (const point of rawPoints) {
        const height = bilinearHeight(grid, point.lon, point.lat) + style.lift
        flatLonLat.push(point.lon, point.lat, height)
        vertexColors.push(direction)
      }
      instances.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: Cesium.Cartesian3.fromDegreesArrayHeights(flatLonLat),
            width: Math.max(1, Math.round(style.width)),
            vertexFormat,
            colors: vertexColors,
            colorsPerVertex: true
          })
        })
      )
    }
  }
  if (instances.length === 0) return undefined
  return new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
    asynchronous: false,
    allowPicking: false
  })
}

export function colorStringToCss(color: Cesium.Color): string {
  const value = color
  const toByte = (channel: number): string =>
    Math.round(Math.min(255, Math.max(0, channel * 255)))
      .toString(16)
      .padStart(2, '0')
  return `#${toByte(value.red)}${toByte(value.green)}${toByte(value.blue)}`
}

export function estimateArrowCount(grid: SampleGrid, ring: Ring, stride: number, flatThresholdDeg: number, field: SlopeField): number {
  const { nx, ny } = grid
  const used = Math.max(1, Math.round(stride))
  let count = 0
  for (let row = 0; row < ny - 1; row += used) {
    for (let col = 0; col < nx - 1; col += used) {
      const center = cellCenterIndex(grid, row, col)
      if (!pointInRing(center.lon, center.lat, ring)) continue
      const aspect = cellAspect(grid, field, row, col)
      if (aspect && aspect.slopeDeg >= flatThresholdDeg) count += 1
    }
  }
  return count
}
