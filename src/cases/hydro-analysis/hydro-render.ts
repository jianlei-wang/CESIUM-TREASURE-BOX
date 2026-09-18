import * as Cesium from 'cesium'
import { createSurfaceAppearance, rampRgb } from '../polygon-depth-contour/depth-contour-lib'
import {
  cellCenter,
  cellIndexOf,
  colOf,
  rowOf,
  type HydGrid,
  type LinkSegment
} from './hydro-lib'

export type RasterMode = 'elevation' | 'raise' | 'acc' | 'mask'

export type RasterStyle = {
  mode: RasterMode
  opacity: number
  min?: number
  max?: number
  fill?: [number, number, number]
  zeroAlpha?: boolean
}

export const DIR_COLORS: string[] = [
  '#f2cc60',
  '#ff9f68',
  '#ff7d66',
  '#e06fa8',
  '#b47dff',
  '#6f8fff',
  '#4ec3c8',
  '#57d6a0'
]

function rampBlue(t: number): [number, number, number] {
  const stops: { at: number; rgb: [number, number, number] }[] = [
    { at: 0, rgb: [6, 24, 66] },
    { at: 0.3, rgb: [14, 74, 168] },
    { at: 0.6, rgb: [38, 150, 235] },
    { at: 0.85, rgb: [122, 220, 255] },
    { at: 1, rgb: [235, 252, 255] }
  ]
  for (let i = 1; i < stops.length; i += 1) {
    if (t <= stops[i].at) {
      const a = stops[i - 1]
      const b = stops[i]
      const k = Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at)))
      return [
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * k),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * k),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * k)
      ]
    }
  }
  return stops[stops.length - 1].rgb
}

function rampRaise(t: number): [number, number, number] {
  const stops: { at: number; rgb: [number, number, number] }[] = [
    { at: 0, rgb: [255, 235, 130] },
    { at: 0.55, rgb: [250, 150, 60] },
    { at: 1, rgb: [210, 40, 60] }
  ]
  for (let i = 1; i < stops.length; i += 1) {
    if (t <= stops[i].at) {
      const a = stops[i - 1]
      const b = stops[i]
      const k = Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at)))
      return [
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * k),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * k),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * k)
      ]
    }
  }
  return stops[stops.length - 1].rgb
}

export function accGradientCss(): string {
  const parts: string[] = []
  for (let i = 0; i <= 10; i += 1) {
    const t = i / 10
    const rgb = rampBlue(t)
    parts.push(`rgb(${rgb[0]},${rgb[1]},${rgb[2]}) ${Math.round(t * 100)}%`)
  }
  return `linear-gradient(90deg, ${parts.join(',')})`
}

export function raiseGradientCss(): string {
  const parts: string[] = []
  for (let i = 0; i <= 6; i += 1) {
    const t = i / 6
    const rgb = rampRaise(t)
    parts.push(`rgb(${rgb[0]},${rgb[1]},${rgb[2]}) ${Math.round(t * 100)}%`)
  }
  return `linear-gradient(90deg, ${parts.join(',')})`
}

export function buildCornerHeights(grid: HydGrid): Float32Array {
  const { cols, rows, dem } = grid
  const cornerH = new Float32Array((rows + 1) * (cols + 1))
  for (let r = 0; r <= rows; r += 1) {
    for (let c = 0; c <= cols; c += 1) {
      let sum = 0
      let count = 0
      const rFrom = Math.max(0, r - 1)
      const rTo = Math.min(rows - 1, r)
      const cFrom = Math.max(0, c - 1)
      const cTo = Math.min(cols - 1, c)
      for (let rr = rFrom; rr <= rTo; rr += 1) {
        for (let cc = cFrom; cc <= cTo; cc += 1) {
          sum += dem[cellIndexOf(grid, rr, cc)]
          count += 1
        }
      }
      cornerH[r * (cols + 1) + c] = count > 0 ? sum / count : dem[Math.max(0, Math.min(rows - 1, r - 1)) * cols + Math.max(0, Math.min(cols - 1, c - 1))]
    }
  }
  return cornerH
}

export function surfaceHeightAt(grid: HydGrid, cornerH: Float32Array, lon: number, lat: number): number {
  const { cols, rows, bounds, cellLon, cellLat } = grid
  const u = Math.max(0, Math.min(cols, (lon - bounds.west) / cellLon))
  const v = Math.max(0, Math.min(rows, (bounds.north - lat) / cellLat))
  const c0 = Math.floor(u)
  const r0 = Math.floor(v)
  const du = u - c0
  const dv = v - r0
  const w = cols + 1
  const c1 = Math.min(cols, c0 + 1)
  const r1 = Math.min(rows, r0 + 1)
  const h00 = cornerH[r0 * w + c0]
  const h10 = cornerH[r0 * w + c1]
  const h01 = cornerH[r1 * w + c0]
  const h11 = cornerH[r1 * w + c1]
  return h00 * (1 - du) * (1 - dv) + h10 * du * (1 - dv) + h01 * (1 - du) * dv + h11 * du * dv
}

function cellRamp(grid: HydGrid, mode: RasterMode, value: number, style: RasterStyle): [number, number, number] {
  let t = 0
  if (mode === 'elevation') {
    const min = style.min ?? 0
    const max = style.max ?? 1
    t = max > min ? (value - min) / (max - min) : 0
    return rampRgb('terrain', Math.max(0, Math.min(1, t)))
  }
  if (mode === 'raise') {
    const min = style.min ?? 0
    const max = style.max ?? 1
    t = max > min ? (value - min) / (max - min) : 0
    return rampRaise(Math.max(0, Math.min(1, t)))
  }
  if (mode === 'acc') {
    const max = style.max && style.max > 1 ? style.max : 1
    t = Math.log(1 + Math.max(0, value)) / Math.log(1 + max)
    return rampBlue(Math.max(0, Math.min(1, t)))
  }
  return style.fill ?? [64, 150, 220]
}

export function buildRasterSurfacePrimitive(grid: HydGrid, cornerH: Float32Array, values: Float32Array, style: RasterStyle): Cesium.Primitive {
  const { cols, rows, bounds, cellLon, cellLat } = grid
  const cells = cols * rows
  const alphaByte = Math.round(Math.min(1, Math.max(0, style.opacity)) * 255)
  const positions = new Float64Array(cells * 6 * 3)
  const colors = new Uint8Array(cells * 6 * 4)
  const w = cols + 1
  let base = 0
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell = row * cols + col
      const value = values[cell]
      const rgb = cellRamp(grid, style.mode, value, style)
      const active = !style.zeroAlpha || value > 0
      const cellAlpha = active ? alphaByte : 0
      const cornerTop = row * w + col
      const north = bounds.north - row * cellLat
      const south = north - cellLat
      const west = bounds.west + col * cellLon
      const east = west + cellLon
      const heights = [cornerH[cornerTop], cornerH[cornerTop + 1], cornerH[cornerTop + w], cornerH[cornerTop + w + 1]]
      const points = [
        { lon: west, lat: north, h: heights[0] },
        { lon: east, lat: north, h: heights[1] },
        { lon: east, lat: south, h: heights[3] },
        { lon: west, lat: south, h: heights[2] }
      ]
      const tris = [
        [0, 1, 3],
        [1, 2, 3]
      ]
      for (const tri of tris) {
        for (const corner of tri) {
          const point = points[corner]
          const cartesian = Cesium.Cartesian3.fromDegrees(point.lon, point.lat, point.h)
          positions[base * 3] = cartesian.x
          positions[base * 3 + 1] = cartesian.y
          positions[base * 3 + 2] = cartesian.z
          colors[base * 4] = rgb[0]
          colors[base * 4 + 1] = rgb[1]
          colors[base * 4 + 2] = rgb[2]
          colors[base * 4 + 3] = cellAlpha
          base += 1
        }
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
  const geometry = new Cesium.Geometry({
    attributes,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(positions)
  })
  return new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({ geometry }),
    appearance: createSurfaceAppearance(),
    asynchronous: false,
    allowPicking: false
  })
}

export type FlowArrowStyle = {
  stride: number
  alpha: number
}

export function buildFlowArrowsPrimitive(grid: HydGrid, cornerH: Float32Array, dir: Int8Array, style: FlowArrowStyle): Cesium.Primitive | undefined {
  const { cols, rows, cellLon, cellLat } = grid
  const stride = Math.max(1, Math.round(style.stride))
  const alpha = Math.min(1, Math.max(0, style.alpha))
  const lift = 12
  const instances: Cesium.GeometryInstance[] = []
  const vertexFormat = Cesium.PolylineColorAppearance.VERTEX_FORMAT
  const lengthF = 0.48
  for (let row = 0; row < rows; row += stride) {
    for (let col = 0; col < cols; col += stride) {
      const cell = row * cols + col
      const d = dir[cell]
      if (d < 0) continue
      const center = cellCenter(grid, row, col)
      const dr = [-1, -1, 0, 1, 1, 1, 0, -1][d]
      const dc = [0, 1, 1, 1, 0, -1, -1, -1][d]
      const offLon = dc * cellLon * lengthF
      const offLat = -dr * cellLat * lengthF
      const perpLon = -offLat * (cellLon / cellLat)
      const perpLat = offLon * (cellLat / cellLon)
      const tipLon = center.lon + offLon
      const tipLat = center.lat + offLat
      const headLon = offLon * 0.55
      const headLat = offLat * 0.55
      const wingLon = perpLon * 0.3
      const wingLat = perpLat * 0.3
      const wingALon = tipLon - headLon + wingLon
      const wingALat = tipLat - headLat + wingLat
      const wingBLon = tipLon - headLon - wingLon
      const wingBLat = tipLat - headLat - wingLat
      const rawPoints = [
        { lon: center.lon - offLon * 0.25, lat: center.lat - offLat * 0.25 },
        { lon: tipLon, lat: tipLat },
        { lon: wingALon, lat: wingALat },
        { lon: tipLon, lat: tipLat },
        { lon: wingBLon, lat: wingBLat }
      ]
      const flatLonLat: number[] = []
      const vertexColors: Cesium.Color[] = []
      const color = Cesium.Color.fromCssColorString(DIR_COLORS[d]).withAlpha(alpha)
      for (const point of rawPoints) {
        const h = surfaceHeightAt(grid, cornerH, point.lon, point.lat) + lift
        flatLonLat.push(point.lon, point.lat, h)
        vertexColors.push(color)
      }
      instances.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: Cesium.Cartesian3.fromDegreesArrayHeights(flatLonLat),
            width: 2,
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

export type ReachStyle = {
  width: number
  alpha: number
  color: string
  lift: number
}

export function buildReachPrimitive(grid: HydGrid, cornerH: Float32Array, links: LinkSegment[], style: ReachStyle): Cesium.Primitive | undefined {
  const color = Cesium.Color.fromCssColorString(style.color).withAlpha(Math.min(1, Math.max(0, style.alpha)))
  const instances: Cesium.GeometryInstance[] = []
  const vertexFormat = Cesium.PolylineColorAppearance.VERTEX_FORMAT
  for (const link of links) {
    if (link.cells.length < 2) continue
    const flatLonLat: number[] = []
    const vertexColors: Cesium.Color[] = []
    for (const cell of link.cells) {
      const row = rowOf(grid, cell)
      const col = colOf(grid, cell)
      const center = cellCenter(grid, row, col)
      const h = surfaceHeightAt(grid, cornerH, center.lon, center.lat) + style.lift
      flatLonLat.push(center.lon, center.lat, h)
      vertexColors.push(color)
    }
    const positions = Cesium.Cartesian3.fromDegreesArrayHeights(flatLonLat)
    instances.push(
      new Cesium.GeometryInstance({
        geometry: new Cesium.PolylineGeometry({
          positions,
          width: Math.max(1, Math.round(style.width)),
          vertexFormat,
          colors: vertexColors,
          colorsPerVertex: true
        })
      })
    )
  }
  if (instances.length === 0) return undefined
  return new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
    asynchronous: false,
    allowPicking: false
  })
}
