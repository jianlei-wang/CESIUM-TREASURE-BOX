import * as Cesium from 'cesium'
import { createSurfaceAppearance } from '../polygon-depth-contour/depth-contour-lib'
import type { HydGrid } from '../hydro-analysis/hydro-lib'
import { DEPTH_LEVEL_COLORS, zoneColor } from './flood-forecast-lib'

export type Rgb = [number, number, number]

function gradientCssFromStops(stops: { at: number; rgb: Rgb }[]): string {
  const parts: string[] = []
  for (const stop of stops) {
    parts.push(`rgb(${stop.rgb[0]},${stop.rgb[1]},${stop.rgb[2]}) ${Math.round(stop.at * 100)}%`)
  }
  return `linear-gradient(90deg, ${parts.join(',')})`
}

function rampValue(stops: { at: number; rgb: Rgb }[], t: number): Rgb {
  const k = Math.max(0, Math.min(1, t))
  for (let i = 1; i < stops.length; i += 1) {
    if (k <= stops[i].at) {
      const a = stops[i - 1]
      const b = stops[i]
      const f = Math.max(0, Math.min(1, (k - a.at) / (b.at - a.at)))
      return [
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f)
      ]
    }
  }
  return stops[stops.length - 1].rgb
}

const RAIN_STOPS: { at: number; rgb: Rgb }[] = [
  { at: 0, rgb: [200, 232, 255] },
  { at: 0.4, rgb: [90, 170, 250] },
  { at: 0.7, rgb: [40, 90, 230] },
  { at: 1, rgb: [70, 20, 150] }
]

const RUNOFF_STOPS: { at: number; rgb: Rgb }[] = [
  { at: 0, rgb: [250, 244, 180] },
  { at: 0.45, rgb: [246, 178, 78] },
  { at: 0.75, rgb: [232, 92, 56] },
  { at: 1, rgb: [168, 20, 84] }
]

const DEPTH_STOPS: { at: number; rgb: Rgb }[] = [
  { at: 0, rgb: [190, 235, 255] },
  { at: 0.35, rgb: [86, 176, 250] },
  { at: 0.65, rgb: [30, 90, 224] },
  { at: 0.85, rgb: [24, 45, 150] },
  { at: 1, rgb: [60, 12, 160] }
]

const TRANSIT_STOPS: { at: number; rgb: Rgb }[] = [
  { at: 0, rgb: [240, 255, 210] },
  { at: 0.5, rgb: [120, 214, 160] },
  { at: 0.85, rgb: [36, 160, 196] },
  { at: 1, rgb: [18, 60, 150] }
]

export function rainGradientCss(): string {
  return gradientCssFromStops(RAIN_STOPS)
}

export function runoffGradientCss(): string {
  return gradientCssFromStops(RUNOFF_STOPS)
}

export function depthGradientCss(): string {
  return gradientCssFromStops(DEPTH_STOPS)
}

export function transitGradientCss(): string {
  return gradientCssFromStops(TRANSIT_STOPS)
}

export type ValueSurfaceStyle = {
  opacity: number
  mode: 'rain' | 'runoff' | 'depth' | 'transit' | 'mask'
  max: number
  min?: number
  fill?: Rgb
  transparentZero?: boolean
}

function mapValueRgb(style: ValueSurfaceStyle, value: number): Rgb {
  const min = style.min ?? 0
  const max = Math.max(style.max, min + 1e-6)
  const t = (value - min) / (max - min)
  if (style.mode === 'rain') return rampValue(RAIN_STOPS, t)
  if (style.mode === 'runoff') return rampValue(RUNOFF_STOPS, t)
  if (style.mode === 'depth') return rampValue(DEPTH_STOPS, t)
  if (style.mode === 'transit') return rampValue(TRANSIT_STOPS, t)
  return style.fill ?? [90, 160, 220]
}

/**
 * 通用栅格表面图元：支持 rain/runoff/depth/transit 连续配色与 mask 单色，
 * 与 hydro-render 中 buildRasterSurfacePrimitive 视觉一致（贴地半透明着色）。
 */
export function buildValueSurfacePrimitive(
  grid: HydGrid,
  cornerH: Float32Array,
  values: Float32Array,
  style: ValueSurfaceStyle
): Cesium.Primitive {
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
      const rgb = mapValueRgb(style, value)
      const active = !style.transparentZero || value > 0
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

// 土地覆盖分区表面：按类色着色（仅用于示意下垫面）
export function buildZoneSurfacePrimitive(
  grid: HydGrid,
  cornerH: Float32Array,
  zones: Uint8Array,
  classCount: number,
  opacity: number
): Cesium.Primitive {
  const rgbCache: Rgb[] = []
  for (let i = 0; i < classCount; i += 1) {
    const css = zoneColor(i, classCount)
    const color = Cesium.Color.fromCssColorString(css)
    rgbCache.push([Math.round(color.red * 255), Math.round(color.green * 255), Math.round(color.blue * 255)])
  }
  const lookup = (value: number): Rgb => rgbCache[value % rgbCache.length] ?? [160, 160, 160]
  return buildMaskPrimitive(grid, cornerH, zones, lookup, opacity)
}

function buildMaskPrimitive(
  grid: HydGrid,
  cornerH: Float32Array,
  values: Uint8Array,
  lookup: (value: number) => Rgb,
  opacity: number
): Cesium.Primitive {
  const { cols, rows, bounds, cellLon, cellLat } = grid
  const cells = cols * rows
  const alphaByte = Math.round(Math.min(1, Math.max(0, opacity)) * 255)
  const positions = new Float64Array(cells * 6 * 3)
  const colors = new Uint8Array(cells * 6 * 4)
  const w = cols + 1
  let base = 0
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell = row * cols + col
      const rgb = lookup(values[cell])
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
      for (const tri of [
        [0, 1, 3],
        [1, 2, 3]
      ]) {
        for (const corner of tri) {
          const point = points[corner]
          const cartesian = Cesium.Cartesian3.fromDegrees(point.lon, point.lat, point.h)
          positions[base * 3] = cartesian.x
          positions[base * 3 + 1] = cartesian.y
          positions[base * 3 + 2] = cartesian.z
          colors[base * 4] = rgb[0]
          colors[base * 4 + 1] = rgb[1]
          colors[base * 4 + 2] = rgb[2]
          colors[base * 4 + 3] = alphaByte
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

export function depthLegendCss(): string {
  return depthGradientCss()
}

export function maxOf(values: Float32Array): number {
  let max = 0
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > max) max = values[i]
  }
  return max
}

export function floodLevelCss(): string {
  const parts: string[] = []
  const count = DEPTH_LEVEL_COLORS.length
  for (let i = 0; i < count; i += 1) {
    parts.push(`${DEPTH_LEVEL_COLORS[i]} ${Math.round((i / Math.max(1, count - 1)) * 100)}%`)
  }
  return `linear-gradient(90deg, ${parts.join(',')})`
}
