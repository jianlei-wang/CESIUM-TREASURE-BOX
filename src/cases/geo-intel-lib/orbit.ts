const MU = 398600.4418
const EARTH_RADIUS_KM = 6378.137
const DEG = Math.PI / 180

export type OrbitElements = {
  semiMajorAxisKm: number
  eccentricity: number
  inclinationDeg: number
  raanDeg: number
  argPerigeeDeg: number
  meanAnomalyDeg: number
  epochMs: number
}

export type EciPoint = { x: number; y: number; z: number }

export function meanMotionRadPerSec(aKm: number): number {
  return Math.sqrt(MU / (aKm * aKm * aKm))
}

export function keplerSolve(meanAnomaly: number, e: number): number {
  let E = meanAnomaly
  for (let i = 0; i < 12; i += 1) {
    const f = E - e * Math.sin(E) - meanAnomaly
    const fp = 1 - e * Math.cos(E)
    E -= f / fp
    if (Math.abs(f) < 1e-10) break
  }
  return E
}

export function propagateEci(elements: OrbitElements, atMs: number): EciPoint {
  const n = meanMotionRadPerSec(elements.semiMajorAxisKm)
  const dtSec = (atMs - elements.epochMs) / 1000
  const M = (elements.meanAnomalyDeg * DEG + n * dtSec) % (Math.PI * 2)
  const e = elements.eccentricity
  const E = keplerSolve(M < 0 ? M + Math.PI * 2 : M, e)
  const a = elements.semiMajorAxisKm
  const xv = a * (Math.cos(E) - e)
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E)

  const r = Math.hypot(xv, yv)
  const vx = Math.sqrt(MU / a) * (-Math.sin(E)) / (1 - e * Math.cos(E))
  const vy = Math.sqrt(MU / a) * (Math.sqrt(1 - e * e) * Math.cos(E)) / (1 - e * Math.cos(E))
  const trueAnomaly = Math.atan2(yv, xv)
  const argLat = trueAnomaly + elements.argPerigeeDeg * DEG

  const cosO = Math.cos(elements.raanDeg * DEG)
  const sinO = Math.sin(elements.raanDeg * DEG)
  const cosI = Math.cos(elements.inclinationDeg * DEG)
  const sinI = Math.sin(elements.inclinationDeg * DEG)
  const cosU = Math.cos(argLat)
  const sinU = Math.sin(argLat)

  const x = r * (cosO * cosU - sinO * sinU * cosI)
  const y = r * (sinO * cosU + cosO * sinU * cosI)
  const z = r * (sinU * sinI)
  void vx
  void vy
  return { x, y, z }
}

export function eciToGeodetic(p: EciPoint, atMs: number): { lat: number; lon: number; heightKm: number } {
  const gmst = greenwichSiderealTime(atMs)
  const lon = Math.atan2(p.y, p.x) - gmst
  const r = Math.hypot(p.x, p.y)
  const lat = Math.atan2(p.z, r)
  const radius = Math.hypot(p.x, p.y, p.z)
  return {
    lat: lat / DEG,
    lon: normalizeLon(lon / DEG),
    heightKm: radius - EARTH_RADIUS_KM
  }
}

export function greenwichSiderealTime(atMs: number): number {
  const jd = 2440587.5 + atMs / 86400000
  const T = (jd - 2451545.0) / 36525
  const gmstDeg =
    280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000
  return ((gmstDeg % 360) + 360) % 360 * DEG
}

export function normalizeLon(lon: number): number {
  return ((lon + 540) % 360) - 180
}

export function orbitalPeriodSec(aKm: number): number {
  return (2 * Math.PI) / meanMotionRadPerSec(aKm)
}

export function groundTrack(
  elements: OrbitElements,
  startMs: number,
  durationSec: number,
  samples: number
): Array<{ lat: number; lon: number; heightKm: number; t: number }> {
  const out: Array<{ lat: number; lon: number; heightKm: number; t: number }> = []
  for (let i = 0; i <= samples; i += 1) {
    const t = startMs + (durationSec * 1000 * i) / samples
    const eci = propagateEci(elements, t)
    const g = eciToGeodetic(eci, t)
    out.push({ ...g, t })
  }
  return out
}

export function splitGroundTrack(
  track: Array<{ lat: number; lon: number }>
): Array<Array<{ lat: number; lon: number }>> {
  const segments: Array<Array<{ lat: number; lon: number }>> = []
  let current: Array<{ lat: number; lon: number }> = []
  for (let i = 0; i < track.length; i += 1) {
    if (i > 0 && Math.abs(track[i].lon - track[i - 1].lon) > 180) {
      if (current.length) segments.push(current)
      current = []
    }
    current.push(track[i])
  }
  if (current.length) segments.push(current)
  return segments
}
