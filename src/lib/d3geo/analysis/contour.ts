import { contours } from 'd3'
import type { GridField } from './density'

export type LonLat = [number, number]
export type ContourBand = { value: number; polygons: LonLat[][][] }

/** 用 d3.contours 在格网场上生成等值线 / 等值面（转换为经纬度环）。 */
export function contourBands(field: GridField, thresholds: number[]): ContourBand[] {
  const generator = contours().size([field.width, field.height]).thresholds(thresholds)
  const shapes = generator(field.values as unknown as number[]) as unknown as Array<{
    value: number
    coordinates: number[][][][]
  }>
  const lonSpan = field.bounds.east - field.bounds.west
  const latSpan = field.bounds.north - field.bounds.south
  const toLonLat = (x: number, y: number): LonLat => [
    field.bounds.west + (x / Math.max(1, field.width - 1)) * lonSpan,
    field.bounds.south + (y / Math.max(1, field.height - 1)) * latSpan
  ]
  return shapes.map((shape) => ({
    value: shape.value,
    polygons: shape.coordinates.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => toLonLat(x, y))))
  }))
}

/** 生成等值线阈值数组（线性）。 */
export function contourThresholds(min: number, max: number, count: number): number[] {
  const thresholds: number[] = []
  for (let i = 1; i <= count; i += 1) thresholds.push(min + ((max - min) * i) / (count + 1))
  return thresholds
}
