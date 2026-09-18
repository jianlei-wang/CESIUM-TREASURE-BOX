import { Cartographic, Math as CesiumMath, Rectangle } from 'cesium'

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 生成 N×N 网格点：row0 为北、col0 为西，索引 = row * N + col，取格子中心。
 */
export function makeGridCartographics(rectangle: Rectangle, size: number): Cartographic[] {
  const positions: Cartographic[] = new Array(size * size)
  const { west, east, south, north } = rectangle
  let index = 0
  for (let row = 0; row < size; row += 1) {
    const latitude = CesiumMath.lerp(north, south, (row + 0.5) / size)
    for (let col = 0; col < size; col += 1) {
      const longitude = CesiumMath.lerp(west, east, (col + 0.5) / size)
      positions[index] = new Cartographic(longitude, latitude)
      index += 1
    }
  }
  return positions
}

/** 依据 N×N 网格的经纬度单元格中心，生成与 heights 同序的经纬度数组（单位为度，row0=北、col0=西） */
export function gridLonLat(rectangle: Rectangle, size: number): { lons: Float32Array; lats: Float32Array } {
  const lons = new Float32Array(size * size)
  const lats = new Float32Array(size * size)
  const west = CesiumMath.toDegrees(rectangle.west)
  const east = CesiumMath.toDegrees(rectangle.east)
  const south = CesiumMath.toDegrees(rectangle.south)
  const north = CesiumMath.toDegrees(rectangle.north)
  let index = 0
  for (let row = 0; row < size; row += 1) {
    const latitude = CesiumMath.lerp(north, south, (row + 0.5) / size)
    for (let col = 0; col < size; col += 1) {
      lons[index] = CesiumMath.lerp(west, east, (col + 0.5) / size)
      lats[index] = latitude
      index += 1
    }
  }
  return { lons, lats }
}

/** 射线法判断点是否在多边形内（经纬度） */
export function pointInPolygon(lon: number, lat: number, polygon: Array<[number, number]>): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

/** 由多边形顶点计算外接矩形（经纬度） */
export function polygonToRectangle(polygon: Array<[number, number]>): Rectangle | undefined {
  if (polygon.length < 3) return undefined
  let west = Number.POSITIVE_INFINITY
  let east = Number.NEGATIVE_INFINITY
  let south = Number.POSITIVE_INFINITY
  let north = Number.NEGATIVE_INFINITY
  for (const [lon, lat] of polygon) {
    west = Math.min(west, lon)
    east = Math.max(east, lon)
    south = Math.min(south, lat)
    north = Math.max(north, lat)
  }
  if (!(east > west) || !(north > south)) return undefined
  return Rectangle.fromDegrees(west, south, east, north)
}

/** 标记多边形外（或 NaN）的格子；返回 mask[maskedCount] */
export function buildMask(
  rectangle: Rectangle,
  size: number,
  polygon?: Array<[number, number]> | null
): { mask: Uint8Array; maskedCount: number } {
  const mask = new Uint8Array(size * size).fill(1)
  if (!polygon || polygon.length < 3) return { mask, maskedCount: 0 }
  const { lons, lats } = gridLonLat(rectangle, size)
  let maskedCount = 0
  for (let i = 0; i < mask.length; i += 1) {
    if (!pointInPolygon(lons[i], lats[i], polygon)) {
      mask[i] = 0
      maskedCount += 1
    }
  }
  return { mask, maskedCount }
}

export function applyMask(heights: Float32Array, mask: Uint8Array): void {
  for (let i = 0; i < heights.length; i += 1) {
    if (!mask[i]) heights[i] = Number.NaN
  }
}

export type HeightStats = {
  validCount: number
  holeCount: number
  min: number
  max: number
  mean: number
}

export function computeStats(heights: Float32Array, mask: Uint8Array): HeightStats {
  let validCount = 0
  let holeCount = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  for (let i = 0; i < heights.length; i += 1) {
    if (!mask[i]) continue
    const h = heights[i]
    if (Number.isFinite(h)) {
      validCount += 1
      sum += h
      if (h < min) min = h
      if (h > max) max = h
    } else {
      holeCount += 1
    }
  }
  return {
    validCount,
    holeCount,
    min: validCount ? min : Number.NaN,
    max: validCount ? max : Number.NaN,
    mean: validCount ? sum / validCount : Number.NaN
  }
}

/** 高度场转灰度图；无数据渲染为品红。transparentNoData=true 时无数据改为全透明（用于贴图叠加） */
export function heightsToImageData(
  heights: Float32Array,
  size: number,
  min: number,
  max: number,
  transparentNoData = false
): ImageData {
  const image = new ImageData(size, size)
  const data = image.data
  const span = max > min ? max - min : 1
  for (let i = 0; i < heights.length; i += 1) {
    const h = heights[i]
    const o = i * 4
    if (!Number.isFinite(h)) {
      if (transparentNoData) {
        data[o] = 0
        data[o + 1] = 0
        data[o + 2] = 0
        data[o + 3] = 0
      } else {
        data[o] = 255
        data[o + 1] = 0
        data[o + 2] = 255
        data[o + 3] = 255
      }
      continue
    }
    const t = Math.max(0, Math.min(1, (h - min) / span))
    const v = Math.round(28 + t * 212)
    data[o] = v
    data[o + 1] = v
    data[o + 2] = v
    data[o + 3] = 255
  }
  return image
}

/** 把 Cesium Rectangle（弧度）转为 WGS84 度的范围对象，供 GeoTIFF 等成果使用 */
export function rectangleToDegreesBounds(rectangle: Rectangle): {
  west: number
  south: number
  east: number
  north: number
} {
  return {
    west: CesiumMath.toDegrees(rectangle.west),
    south: CesiumMath.toDegrees(rectangle.south),
    east: CesiumMath.toDegrees(rectangle.east),
    north: CesiumMath.toDegrees(rectangle.north)
  }
}

/** 与基准逐像素做差：蓝 = a 低于基准，红 = a 高于基准，白 = 接近零；无数据为品红 */
export function diffToImageData(
  heights: Float32Array,
  base: Float32Array,
  size: number,
  range: number
): ImageData {
  const image = new ImageData(size, size)
  const data = image.data
  const span = range > 0 ? range : 1
  for (let i = 0; i < heights.length; i += 1) {
    const a = heights[i]
    const b = base[i]
    const o = i * 4
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      data[o] = 255
      data[o + 1] = 0
      data[o + 2] = 255
      data[o + 3] = 255
      continue
    }
    const d = Math.max(-1, Math.min(1, (a - b) / span))
    data[o] = Math.round(d > 0 ? 255 : (1 + d) * 255)
    data[o + 1] = Math.round((1 - Math.abs(d)) * 255)
    data[o + 2] = Math.round(d < 0 ? 255 : (1 - d) * 255)
    data[o + 3] = 255
  }
  return image
}

export function diffStats(a: Float32Array, b: Float32Array): { mae: number; rmse: number; count: number } {
  let count = 0
  let sum = 0
  let sumSq = 0
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]
    const y = b[i]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const d = x - y
    count += 1
    sum += Math.abs(d)
    sumSq += d * d
  }
  return {
    count,
    mae: count ? sum / count : Number.NaN,
    rmse: count ? Math.sqrt(sumSq / count) : Number.NaN
  }
}

export function imageDataToDataUrl(image: ImageData): string {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL()
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function downloadF32(heights: Float32Array, filename: string): void {
  downloadBlob(new Blob([heights.buffer as ArrayBuffer], { type: 'application/octet-stream' }), filename)
}

export function downloadImageData(image: ImageData, filename: string): void {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.putImageData(image, 0, 0)
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, filename)
  }, 'image/png')
}

export function formatNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}
