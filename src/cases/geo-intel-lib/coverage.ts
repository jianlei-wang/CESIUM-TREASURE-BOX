import { destinationPoint, haversineM, initialBearing } from './geometry'
import type { Bbox } from './idw'

export type SensorSpec = {
  lat: number
  lon: number
  heightM: number
  azimuthDeg: number
  fovDeg: number
  rangeM: number
  minRangeM: number
  pitchDeg: number
}

export type CoverageCell = {
  visibility: number
  rangeM: number
  bearingDeltaDeg: number
}

export function evaluateCoverage(spec: SensorSpec, lat: number, lon: number): CoverageCell {
  const dist = haversineM(spec.lat, spec.lon, lat, lon)
  if (dist > spec.rangeM || dist < spec.minRangeM) {
    return { visibility: 0, rangeM: dist, bearingDeltaDeg: 180 }
  }
  const bearing = initialBearing(spec.lat, spec.lon, lat, lon)
  const delta = Math.abs(((bearing - spec.azimuthDeg + 540) % 360) - 180)
  const half = spec.fovDeg / 2
  if (delta > half) {
    return { visibility: 0, rangeM: dist, bearingDeltaDeg: delta }
  }
  const angularFalloff = Math.cos((Math.min(delta, half) / Math.max(half, 0.001)) * (Math.PI / 2))
  const rangeFalloff = Math.pow(1 - Math.min(1, dist / spec.rangeM), 0.65)
  const groundAngle = Math.atan2(spec.heightM, Math.max(dist, 1)) * (180 / Math.PI)
  const pitchMatch = Math.max(0, Math.cos(((groundAngle - spec.pitchDeg) * Math.PI) / 180))
  const visibility = Math.max(0, angularFalloff * rangeFalloff * (0.55 + 0.45 * pitchMatch))
  return { visibility, rangeM: dist, bearingDeltaDeg: delta }
}

export function coverageCanvas(
  specs: SensorSpec[],
  bbox: Bbox,
  width: number,
  height: number,
  stopColor: (t: number) => { r: number; g: number; b: number; a: number }
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const image = ctx.createImageData(width, height)
  const dLat = (bbox.latMax - bbox.latMin) / height
  const dLon = (bbox.lonMax - bbox.lonMin) / width
  for (let row = 0; row < height; row += 1) {
    const lat = bbox.latMax - (row + 0.5) * dLat
    for (let col = 0; col < width; col += 1) {
      const lon = bbox.lonMin + (col + 0.5) * dLon
      let best = 0
      for (const spec of specs) {
        const cell = evaluateCoverage(spec, lat, lon)
        if (cell.visibility > best) best = cell.visibility
      }
      const idx = (row * width + col) * 4
      if (best <= 0.01) {
        image.data[idx + 3] = 0
        continue
      }
      const color = stopColor(best)
      image.data[idx] = color.r
      image.data[idx + 1] = color.g
      image.data[idx + 2] = color.b
      image.data[idx + 3] = color.a
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

export function coverageFootprint(spec: SensorSpec, segments = 24): Array<[number, number]> {
  const ring: Array<[number, number]> = [[spec.lon, spec.lat]]
  const start = spec.azimuthDeg - spec.fovDeg / 2
  const end = spec.azimuthDeg + spec.fovDeg / 2
  for (let i = 0; i <= segments; i += 1) {
    const bearing = start + ((end - start) * i) / segments
    const p = destinationPoint(spec.lat, spec.lon, bearing, spec.rangeM)
    ring.push([p.lon, p.lat])
  }
  ring.push([spec.lon, spec.lat])
  return ring
}

export function coverageAreaKm2(spec: SensorSpec): number {
  return (Math.PI * spec.rangeM * spec.rangeM * (spec.fovDeg / 360)) / 1e6
}
