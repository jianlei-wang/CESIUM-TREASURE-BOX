import { DRY_EPS, cellCenter, type LonLat, type SweGrid, type SweSolver } from './swe-solver'

export type ImpactResult = {
  ring: LonLat[]
  areaM2: number
  areaKm2: number
  maxThickness: number
  avgThickness: number
  depositVolume: number
  threshold: number
  travelDistance: number
  verticalDrop: number
  fahrboschungAngle: number
}

export function initHeightFromPolygon(grid: SweGrid, zb: Float32Array, ring: LonLat[], volume: number): Float32Array {
  const h = new Float32Array(grid.nx * grid.ny)
  let covered = 0
  const slopes: number[] = []
  for (let j = 0; j < grid.ny; j += 1) {
    for (let i = 0; i < grid.nx; i += 1) {
      const { lon, lat } = cellCenter(grid, i, j)
      if (!pointInRing(lon, lat, ring)) continue
      const k = j * grid.nx + i
      h[k] = 1
      covered += 1
      slopes.push(cellSlope(zb, grid, i, j))
    }
  }
  if (covered === 0) return h
  const cellArea = grid.dx * grid.dy
  const hAvg = volume / (covered * cellArea)
  let p = 0
  for (let k = 0; k < h.length; k += 1) {
    if (h[k] <= 0) continue
    const slope = slopes[p]
    p += 1
    h[k] = hAvg * (1 + 0.3 * Math.min(slope, 45) / 45)
  }
  let sum = 0
  for (let k = 0; k < h.length; k += 1) sum += h[k]
  const scale = sum > 0 ? volume / (sum * cellArea) : 1
  for (let k = 0; k < h.length; k += 1) h[k] *= scale
  return h
}

function pointInRing(lon: number, lat: number, ring: LonLat[]): boolean {
  let inside = false
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a, a += 1) {
    const xi = ring[a].lon
    const yi = ring[a].lat
    const xj = ring[b].lon
    const yj = ring[b].lat
    const hit = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-16) + xi
    if (hit) inside = !inside
  }
  return inside
}

function cellSlope(zb: Float32Array, grid: SweGrid, i: number, j: number): number {
  const { nx, ny, dx, dy } = grid
  const k = j * nx + i
  const il = Math.max(0, i - 1)
  const ir = Math.min(nx - 1, i + 1)
  const jd = Math.max(0, j - 1)
  const ju = Math.min(ny - 1, j + 1)
  const dzdx = (zb[j * nx + ir] - zb[j * nx + il]) / Math.max(dx * (ir - il), 1)
  const dzdy = (zb[ju * nx + i] - zb[jd * nx + i]) / Math.max(dy * (ju - jd), 1)
  return (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI
}

export function extractImpact(solver: SweSolver, source: LonLat[], threshold = 0.1): ImpactResult {
  const { grid, h, zb } = solver
  const { nx, ny, dx, dy } = grid
  const binary = new Uint8Array(nx * ny)
  let deposit = 0
  let wet = 0
  let maxH = 0
  for (let k = 0; k < h.length; k += 1) {
    if (h[k] > threshold) {
      binary[k] = 1
      deposit += h[k]
      wet += 1
    }
    if (h[k] > maxH) {
      maxH = h[k]
    }
  }
  const ringGrid = traceLargestContour(binary, nx, ny)
  const ring = ringGrid.map(([x, y]) => ({
    lon: grid.west + (x / nx) * (grid.east - grid.west),
    lat: grid.south + (y / ny) * (grid.north - grid.south)
  }))
  const simplified = douglasPeucker(ring, 0.000012)
  const areaM2 = wet * dx * dy
  const sourceCentroid = centroid(source)
  const front = farthestPoint(simplified.length ? simplified : source, sourceCentroid)
  const travelDistance = haversine(sourceCentroid, front)
  let zMax = -Infinity
  let zMin = Infinity
  for (let k = 0; k < zb.length; k += 1) {
    if (h[k] <= DRY_EPS && !pointInRing(cellCenter(grid, k % nx, Math.floor(k / nx)).lon, cellCenter(grid, k % nx, Math.floor(k / nx)).lat, source)) {
      continue
    }
    if (pointInRing(cellCenter(grid, k % nx, Math.floor(k / nx)).lon, cellCenter(grid, k % nx, Math.floor(k / nx)).lat, source)) {
      if (zb[k] > zMax) zMax = zb[k]
    }
    if (binary[k]) {
      if (zb[k] < zMin) zMin = zb[k]
    }
  }
  if (!Number.isFinite(zMax)) zMax = zb[0]
  if (!Number.isFinite(zMin)) zMin = zb[zb.length - 1]
  const verticalDrop = Math.max(0, zMax - zMin)
  const angle = travelDistance > 1 ? (Math.atan(verticalDrop / travelDistance) * 180) / Math.PI : 0
  return {
    ring: simplified.length >= 3 ? simplified : source.slice(),
    areaM2,
    areaKm2: areaM2 / 1e6,
    maxThickness: maxH,
    avgThickness: wet > 0 ? deposit / wet : 0,
    depositVolume: deposit * dx * dy,
    threshold,
    travelDistance,
    verticalDrop,
    fahrboschungAngle: angle
  }
}

function centroid(ring: LonLat[]): LonLat {
  let lon = 0
  let lat = 0
  for (const p of ring) {
    lon += p.lon
    lat += p.lat
  }
  const n = Math.max(ring.length, 1)
  return { lon: lon / n, lat: lat / n }
}

function farthestPoint(ring: LonLat[], origin: LonLat): LonLat {
  let best = origin
  let bestD = -1
  for (const p of ring) {
    const d = haversine(origin, p)
    if (d > bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

function haversine(a: LonLat, b: LonLat): number {
  const R = 6371000
  const p1 = (a.lat * Math.PI) / 180
  const p2 = (b.lat * Math.PI) / 180
  const dp = ((b.lat - a.lat) * Math.PI) / 180
  const dl = ((b.lon - a.lon) * Math.PI) / 180
  const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

function traceLargestContour(binary: Uint8Array, nx: number, ny: number): [number, number][] {
  const labels = new Int32Array(nx * ny)
  let best = 0
  let bestCount = 0
  let tag = 0
  const qx: number[] = []
  const qy: number[] = []
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const k = j * nx + i
      if (!binary[k] || labels[k]) continue
      tag += 1
      let count = 0
      qx.length = 0
      qy.length = 0
      qx.push(i)
      qy.push(j)
      labels[k] = tag
      while (qx.length) {
        const x = qx.pop() as number
        const y = qy.pop() as number
        count += 1
        const nbs = [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1]
        ]
        for (const [nx2, ny2] of nbs) {
          if (nx2 < 0 || ny2 < 0 || nx2 >= nx || ny2 >= ny) continue
          const kk = ny2 * nx + nx2
          if (!binary[kk] || labels[kk]) continue
          labels[kk] = tag
          qx.push(nx2)
          qy.push(ny2)
        }
      }
      if (count > bestCount) {
        bestCount = count
        best = tag
      }
    }
  }
  if (!best) return []
  let startX = -1
  let startY = -1
  for (let j = 0; j < ny && startX < 0; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      if (labels[j * nx + i] === best) {
        startX = i
        startY = j
        break
      }
    }
  }
  if (startX < 0) return []
  const ring: [number, number][] = []
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      if (labels[j * nx + i] !== best) continue
      const edge =
        i === 0 ||
        j === 0 ||
        i === nx - 1 ||
        j === ny - 1 ||
        labels[j * nx + i - 1] !== best ||
        labels[j * nx + i + 1] !== best ||
        labels[(j - 1) * nx + i] !== best ||
        labels[(j + 1) * nx + i] !== best
      if (edge) ring.push([i + 0.5, j + 0.5])
    }
  }
  ring.sort((a, b) => Math.atan2(a[1] - startY, a[0] - startX) - Math.atan2(b[1] - startY, b[0] - startX))
  return ring
}

function douglasPeucker(points: LonLat[], eps: number): LonLat[] {
  if (points.length < 3) return points.slice()
  let maxD = 0
  let idx = 0
  const first = points[0]
  const last = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = perpDist(points[i], first, last)
    if (d > maxD) {
      maxD = d
      idx = i
    }
  }
  if (maxD > eps) {
    const left = douglasPeucker(points.slice(0, idx + 1), eps)
    const right = douglasPeucker(points.slice(idx), eps)
    return left.slice(0, -1).concat(right)
  }
  return [first, last]
}

function perpDist(p: LonLat, a: LonLat, b: LonLat): number {
  const x = p.lon - a.lon
  const y = p.lat - a.lat
  const dx = b.lon - a.lon
  const dy = b.lat - a.lat
  const len = Math.hypot(dx, dy) || 1
  return Math.abs(x * dy - y * dx) / len
}

export function impactToGeoJSON(source: LonLat[], impact: ImpactResult, extras: Record<string, number | string>): string {
  const close = (ring: LonLat[]) => {
    const coords = ring.map((p) => [p.lon, p.lat])
    if (coords.length && (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1])) {
      coords.push(coords[0])
    }
    return coords
  }
  const fc = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: 'source' },
        geometry: { type: 'Polygon', coordinates: [close(source)] }
      },
      {
        type: 'Feature',
        properties: {
          kind: 'impact',
          area_m2: impact.areaM2,
          area_km2: impact.areaKm2,
          max_thickness_m: impact.maxThickness,
          avg_thickness_m: impact.avgThickness,
          deposit_volume_m3: impact.depositVolume,
          travel_distance_m: impact.travelDistance,
          vertical_drop_m: impact.verticalDrop,
          fahrboschung_deg: impact.fahrboschungAngle,
          ...extras
        },
        geometry: { type: 'Polygon', coordinates: [close(impact.ring)] }
      }
    ]
  }
  return JSON.stringify(fc, null, 2)
}

export function impactToKml(source: LonLat[], impact: ImpactResult): string {
  const ringTo = (ring: LonLat[]) => {
    const pts = ring.map((p) => `${p.lon},${p.lat},0`)
    if (pts.length && pts[0] !== pts[pts.length - 1]) pts.push(pts[0])
    return pts.join(' ')
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>滑坡模拟结果</name>
    <Placemark>
      <name>源区</name>
      <Style><PolyStyle><color>7f0000ff</color></PolyStyle></Style>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>${ringTo(source)}</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>
    <Placemark>
      <name>影响范围</name>
      <description>面积 ${impact.areaKm2.toFixed(3)} km2, 最大厚度 ${impact.maxThickness.toFixed(2)} m</description>
      <Style><PolyStyle><color>7f00a5ff</color></PolyStyle></Style>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>${ringTo(impact.ring)}</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>
  </Document>
</kml>`
}
