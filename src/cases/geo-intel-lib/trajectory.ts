import { destinationPoint, haversineM, initialBearing } from './geometry'

export type TrackSample = { lat: number; lon: number; heightM: number; tSec: number }

export type PredictOptions = {
  horizonSec: number
  stepSec: number
  turnRateDegPerSec: number
  speedBiasPct: number
  climbMps: number
  confidenceBaseM: number
  confidenceGrowthMps: number
}

export const DEFAULT_PREDICT: PredictOptions = {
  horizonSec: 600,
  stepSec: 30,
  turnRateDegPerSec: 0.02,
  speedBiasPct: 0,
  climbMps: 0,
  confidenceBaseM: 60,
  confidenceGrowthMps: 0.55
}

export function summarizeTrack(samples: TrackSample[]): {
  speedMps: number
  headingDeg: number
  verticalMps: number
  totalKm: number
} {
  if (samples.length < 2) {
    return { speedMps: 0, headingDeg: 0, verticalMps: 0, totalKm: 0 }
  }
  let dist = 0
  for (let i = 1; i < samples.length; i += 1) {
    dist += haversineM(samples[i - 1].lat, samples[i - 1].lon, samples[i].lat, samples[i].lon)
  }
  const first = samples[0]
  const last = samples[samples.length - 1]
  const dt = Math.max(1, last.tSec - first.tSec)
  const heightDelta = last.heightM - first.heightM
  const recent = samples.slice(-3)
  const headingDeg = initialBearing(
    recent[0].lat,
    recent[0].lon,
    recent[recent.length - 1].lat,
    recent[recent.length - 1].lon
  )
  return {
    speedMps: dist / dt,
    headingDeg,
    verticalMps: heightDelta / dt,
    totalKm: dist / 1000
  }
}

export function predictTrack(
  samples: TrackSample[],
  options: PredictOptions
): Array<{ lat: number; lon: number; heightM: number; tSec: number; uncertaintyM: number }> {
  const summary = summarizeTrack(samples)
  const last = samples[samples.length - 1] ?? { lat: 0, lon: 0, heightM: 0, tSec: 0 }
  const speed = summary.speedMps * (1 + options.speedBiasPct / 100)
  const out: Array<{ lat: number; lon: number; heightM: number; tSec: number; uncertaintyM: number }> = []
  const steps = Math.max(1, Math.round(options.horizonSec / options.stepSec))
  let lat = last.lat
  let lon = last.lon
  let height = last.heightM
  let bearing = summary.headingDeg
  for (let i = 1; i <= steps; i += 1) {
    const dt = options.stepSec
    bearing = (bearing + options.turnRateDegPerSec * dt + 360) % 360
    const p = destinationPoint(lat, lon, bearing, speed * dt)
    lat = p.lat
    lon = p.lon
    height = Math.max(0, height + options.climbMps * dt)
    const uncertaintyM = options.confidenceBaseM + options.confidenceGrowthMps * (i * dt) + Math.abs(options.speedBiasPct) * 8
    out.push({ lat, lon, heightM: height, tSec: last.tSec + i * dt, uncertaintyM })
  }
  return out
}

export function confidenceConePolygon(
  predicted: Array<{ lat: number; lon: number; uncertaintyM: number }>,
  samples: TrackSample[]
): Array<[number, number]> {
  if (!predicted.length || !samples.length) return []
  const last = samples[samples.length - 1]
  const left: Array<[number, number]> = []
  const right: Array<[number, number]> = []
  for (const p of predicted) {
    const bearing = initialBearing(last.lat, last.lon, p.lat, p.lon)
    const l = destinationPoint(p.lat, p.lon, bearing - 90, p.uncertaintyM)
    const r = destinationPoint(p.lat, p.lon, bearing + 90, p.uncertaintyM)
    left.push([l.lon, l.lat])
    right.push([r.lon, r.lat])
  }
  return [...left, ...right.reverse()]
}

export function generateHistory(
  startLat: number,
  startLon: number,
  startHeight: number,
  startBearing: number,
  speedMps: number,
  samples: number,
  stepSec: number,
  turnRate: number,
  climbMps: number
): TrackSample[] {
  const out: TrackSample[] = []
  let lat = startLat
  let lon = startLon
  let height = startHeight
  let bearing = startBearing
  for (let i = 0; i < samples; i += 1) {
    out.push({ lat, lon, heightM: height, tSec: i * stepSec })
    bearing = (bearing + turnRate * stepSec + 360) % 360
    const p = destinationPoint(lat, lon, bearing, speedMps * stepSec)
    lat = p.lat
    lon = p.lon
    height = Math.max(0, height + climbMps * stepSec)
  }
  return out
}
