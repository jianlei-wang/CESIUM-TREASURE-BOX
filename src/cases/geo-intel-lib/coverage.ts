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

export type CoverageBand = {
  nearM: number
  farM: number
}

const DEG = Math.PI / 180

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export function coverageRangeBand(spec: SensorSpec): CoverageBand {
  const halfV = (Math.min(spec.fovDeg, 170) / 2) * DEG
  const pitch = Math.max(spec.pitchDeg, 1) * DEG
  const farByPitch = pitch - halfV > 0.5 * DEG ? spec.heightM / Math.tan(pitch - halfV) : Number.POSITIVE_INFINITY
  const nearByPitch = spec.heightM / Math.tan(Math.min(pitch + halfV, 88.5 * DEG))
  const farM = Math.max(60, Math.min(farByPitch, spec.rangeM))
  const nearM = Math.max(spec.minRangeM, Math.min(nearByPitch, farM * 0.85))
  return { nearM, farM }
}

export function evaluateCoverage(
  spec: SensorSpec,
  lat: number,
  lon: number,
  band: CoverageBand = coverageRangeBand(spec)
): CoverageCell {
  const dist = haversineM(spec.lat, spec.lon, lat, lon)
  if (dist > band.farM || dist < band.nearM) {
    return { visibility: 0, rangeM: dist, bearingDeltaDeg: 180 }
  }
  const bearing = initialBearing(spec.lat, spec.lon, lat, lon)
  const delta = Math.abs(((bearing - spec.azimuthDeg + 540) % 360) - 180)
  const half = spec.fovDeg / 2
  if (delta > half) {
    return { visibility: 0, rangeM: dist, bearingDeltaDeg: delta }
  }
  const angularFalloff = Math.cos((Math.min(delta, half) / Math.max(half, 0.001)) * (Math.PI / 2))
  const span = Math.max(1, band.farM - band.nearM)
  const t = Math.min(1, Math.max(0, (dist - band.nearM) / span))
  const rangeFalloff = Math.pow(1 - t, 0.65)
  const edgeRamp = smoothstep(0, 0.08, t) * smoothstep(1, 0.9, t)
  const visibility = Math.max(0, angularFalloff * rangeFalloff * edgeRamp)
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
  const bands = specs.map((spec) => coverageRangeBand(spec))
  for (let row = 0; row < height; row += 1) {
    const lat = bbox.latMax - (row + 0.5) * dLat
    for (let col = 0; col < width; col += 1) {
      const lon = bbox.lonMin + (col + 0.5) * dLon
      let best = 0
      for (let i = 0; i < specs.length; i += 1) {
        const cell = evaluateCoverage(specs[i], lat, lon, bands[i])
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

export function coverageFootprint(
  spec: SensorSpec,
  segments = 32,
  band: CoverageBand = coverageRangeBand(spec)
): Array<[number, number]> {
  const ring: Array<[number, number]> = []
  const start = spec.azimuthDeg - spec.fovDeg / 2
  const end = spec.azimuthDeg + spec.fovDeg / 2
  for (let i = 0; i <= segments; i += 1) {
    const bearing = start + ((end - start) * i) / segments
    const p = destinationPoint(spec.lat, spec.lon, bearing, band.farM)
    ring.push([p.lon, p.lat])
  }
  for (let i = segments; i >= 0; i -= 1) {
    const bearing = start + ((end - start) * i) / segments
    const p = destinationPoint(spec.lat, spec.lon, bearing, band.nearM)
    ring.push([p.lon, p.lat])
  }
  return ring
}

export function coverageAreaKm2(spec: SensorSpec, band: CoverageBand = coverageRangeBand(spec)): number {
  const sector = Math.PI * (spec.fovDeg / 360)
  return (sector * (band.farM * band.farM - band.nearM * band.nearM)) / 1e6
}
