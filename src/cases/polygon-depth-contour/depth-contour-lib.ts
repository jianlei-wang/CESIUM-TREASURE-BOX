import * as Cesium from 'cesium'

export type LonLat = { lon: number; lat: number }

export type PaletteKey = 'terrain' | 'coolwarm' | 'thermal'

export const PALETTE_OPTIONS: { value: PaletteKey; label: string; stops: string[] }[] = [
  { value: 'terrain', label: '地形色带', stops: ['#2e7d46', '#7ac04a', '#c9e287', '#f4e064', '#dfa03c', '#b06a32', '#8b7a66', '#ffffff'] },
  { value: 'coolwarm', label: '冷暖色带', stops: ['#2b5fbf', '#4a91d6', '#8fc3ec', '#f1f3f4', '#e8a25a', '#d9643f', '#a32925'] },
  { value: 'thermal', label: '热力色带', stops: ['#7a0177', '#c51b7d', '#f768a1', '#fdd0a2', '#ffffb2', '#b8e186', '#4dac26', '#1a9850'] }
]

export function paletteGradientCss(key: PaletteKey): string {
  const option = PALETTE_OPTIONS.find((item) => item.value === key)
  return `linear-gradient(90deg, ${option?.stops.join(', ') ?? ''})`
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)]
}

export function rampRgb(key: PaletteKey, t: number): [number, number, number] {
  const stops = (PALETTE_OPTIONS.find((item) => item.value === key)?.stops ?? PALETTE_OPTIONS[0].stops).map(hexToRgb)
  const clamped = Math.min(1, Math.max(0, t))
  const scaled = clamped * (stops.length - 1)
  const index = Math.min(stops.length - 2, Math.floor(scaled))
  const local = scaled - index
  const from = stops[index]
  const to = stops[index + 1]
  return [
    Math.round(from[0] + (to[0] - from[0]) * local),
    Math.round(from[1] + (to[1] - from[1]) * local),
    Math.round(from[2] + (to[2] - from[2]) * local)
  ]
}

export type SampleGrid = {
  nx: number
  ny: number
  west: number
  north: number
  cellLon: number
  cellLat: number
  heights: Float32Array
  minInside: number
  maxInside: number
  insideCount: number
}

export type GridGeometry = {
  nx: number
  ny: number
  west: number
  north: number
  cellLon: number
  cellLat: number
}

export type Ring = { lon: number; lat: number }[]

export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]
    const b = ring[j]
    if (a.lat > lat !== b.lat > lat && lon < ((b.lon - a.lon) * (lat - a.lat)) / (b.lat - a.lat) + a.lon) {
      inside = !inside
    }
  }
  return inside
}

function ringBounds(ring: Ring): { west: number; east: number; south: number; north: number } {
  let west = Number.POSITIVE_INFINITY
  let east = Number.NEGATIVE_INFINITY
  let south = Number.POSITIVE_INFINITY
  let north = Number.NEGATIVE_INFINITY
  for (const point of ring) {
    if (point.lon < west) west = point.lon
    if (point.lon > east) east = point.lon
    if (point.lat < south) south = point.lat
    if (point.lat > north) north = point.lat
  }
  return { west, east, south, north }
}

export function buildGridGeometry(ring: Ring, maxDimension: number): GridGeometry {
  const bounds = ringBounds(ring)
  const latCenter = (bounds.south + bounds.north) / 2
  const metersPerDegLat = 111320
  const metersPerDegLon = 111320 * Math.cos((latCenter * Math.PI) / 180)
  const spanLat = Math.max(1e-6, bounds.north - bounds.south) * metersPerDegLat
  const spanLon = Math.max(1e-6, bounds.east - bounds.west) * metersPerDegLon
  const cellMeters = Math.max(spanLon, spanLat) / Math.max(1, maxDimension - 1)
  const nx = Math.max(3, Math.min(maxDimension + 1, Math.ceil(spanLon / cellMeters) + 1))
  const ny = Math.max(3, Math.min(maxDimension + 1, Math.ceil(spanLat / cellMeters) + 1))
  return {
    nx,
    ny,
    west: bounds.west,
    north: bounds.north,
    cellLon: (bounds.east - bounds.west) / (nx - 1),
    cellLat: (bounds.south - bounds.north) / (ny - 1)
  }
}

export function createSampleGrid(ring: Ring, maxDimension: number): SampleGrid {
  const geometry = buildGridGeometry(ring, maxDimension)
  const { nx, ny, west, north, cellLon, cellLat } = geometry
  const heights = new Float32Array(nx * ny)
  heights.fill(Number.NaN)
  let minInside = Number.POSITIVE_INFINITY
  let maxInside = Number.NEGATIVE_INFINITY
  let insideCount = 0
  for (let row = 0; row < ny; row += 1) {
    const lat = north + row * cellLat
    for (let col = 0; col < nx; col += 1) {
      const lon = west + col * cellLon
      if (pointInRing(lon, lat, ring)) {
        insideCount += 1
      }
    }
  }
  return { nx, ny, west, north, cellLon, cellLat, heights, minInside, maxInside, insideCount }
}

export function nodeLonLat(grid: SampleGrid | GridGeometry, row: number, col: number): LonLat {
  return { lon: grid.west + col * grid.cellLon, lat: grid.north + row * grid.cellLat }
}

export function fillGridStats(grid: SampleGrid, ring: Ring): void {
  grid.minInside = Number.POSITIVE_INFINITY
  grid.maxInside = Number.NEGATIVE_INFINITY
  grid.insideCount = 0
  for (let row = 0; row < grid.ny; row += 1) {
    for (let col = 0; col < grid.nx; col += 1) {
      const { lon, lat } = nodeLonLat(grid, row, col)
      if (!pointInRing(lon, lat, ring)) continue
      const height = grid.heights[row * grid.nx + col]
      if (!Number.isFinite(height)) continue
      if (height < grid.minInside) grid.minInside = height
      if (height > grid.maxInside) grid.maxInside = height
      grid.insideCount += 1
    }
  }
}

export function sampleHeightAt(grid: SampleGrid, row: number, col: number): number {
  const clampedRow = Math.min(grid.ny - 1, Math.max(0, row))
  const clampedCol = Math.min(grid.nx - 1, Math.max(0, col))
  const value = grid.heights[clampedRow * grid.nx + clampedCol]
  return Number.isFinite(value) ? value : 0
}

export function bilinearHeight(grid: SampleGrid, lon: number, lat: number): number {
  const colFloat = (lon - grid.west) / grid.cellLon
  const rowFloat = (lat - grid.north) / grid.cellLat
  const col = Math.min(grid.nx - 2, Math.max(0, Math.floor(colFloat)))
  const row = Math.min(grid.ny - 2, Math.max(0, Math.floor(rowFloat)))
  const tx = Math.min(1, Math.max(0, colFloat - col))
  const ty = Math.min(1, Math.max(0, rowFloat - row))
  const top = sampleHeightAt(grid, row, col) * (1 - tx) + sampleHeightAt(grid, row, col + 1) * tx
  const bottom = sampleHeightAt(grid, row + 1, col) * (1 - tx) + sampleHeightAt(grid, row + 1, col + 1) * tx
  return top * (1 - ty) + bottom * ty
}

export function rayRingIntersection(origin: LonLat, target: LonLat, ring: Ring): LonLat | undefined {
  const dx = target.lon - origin.lon
  const dy = target.lat - origin.lat
  const dirLengthSq = dx * dx + dy * dy
  if (dirLengthSq < 1e-18) return undefined
  let bestT = Number.POSITIVE_INFINITY
  let best: LonLat | undefined
  const cross = (ux: number, uy: number, vx: number, vy: number): number => ux * vy - uy * vx
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]
    const b = ring[j]
    const ex = b.lon - a.lon
    const ey = b.lat - a.lat
    const denom = cross(dx, dy, ex, ey)
    if (Math.abs(denom) < 1e-14) continue
    const t = cross(a.lon - origin.lon, a.lat - origin.lat, ex, ey) / denom
    if (t < -1e-9 || t > bestT) continue
    const s = cross(a.lon - origin.lon, a.lat - origin.lat, dx, dy) / denom
    if (s < -1e-9 || s > 1 + 1e-9) continue
    bestT = t
    best = { lon: origin.lon + dx * t, lat: origin.lat + dy * t }
  }
  return best
}

export type SurfaceBuildOptions = {
  palette: PaletteKey
  opacity: number
  minHeight: number
  maxHeight: number
}

export function buildSurfaceGeometry(grid: SampleGrid, ring: Ring, options: SurfaceBuildOptions): Cesium.Geometry {
  const { nx, ny, west, north, cellLon, cellLat } = grid
  const cellRowCount = ny - 1
  const cellColCount = nx - 1
  const pending: { row: number; col: number }[] = []
  const range = options.maxHeight - options.minHeight
  const alphaByte = Math.round(Math.min(1, Math.max(0, options.opacity)) * 255)

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
      const t = range > 0 ? (height - options.minHeight) / range : 0
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

export function createSurfaceAppearance(): Cesium.Appearance {
  return new Cesium.Appearance({
    translucent: true,
    closed: false,
    renderState: {
      depthTest: { enabled: false },
      cull: { enabled: false },
      blending: Cesium.BlendingState.ALPHA_BLEND
    },
    vertexShaderSource: `
      in vec3 position3DHigh;
      in vec3 position3DLow;
      in float batchId;
      in vec4 color;
      out vec4 v_color;
      void main()
      {
        vec4 position = czm_translateRelativeToEye(position3DHigh, position3DLow);
        v_color = color;
        gl_Position = czm_modelViewProjectionRelativeToEye * position;
      }
    `,
    fragmentShaderSource: `
      in vec4 v_color;
      void main()
      {
        out_FragColor = v_color;
      }
    `
  })
}

export type ContourLevel = {
  level: number
  pieces: LonLat[][]
}

export type ContourResult = {
  levels: number[]
  byLevel: ContourLevel[]
  segmentCount: number
  pieceCount: number
  usedInterval: number
}

const MAX_LEVELS = 320

function splitSampleEdge(a: LonLat, b: LonLat, ta: number, tb: number): LonLat {
  const t = ta / (ta - tb || 1)
  return { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t }
}

export function computeContours(grid: SampleGrid, ring: Ring, interval: number, minHeight: number, maxHeight: number): ContourResult {
  const range = Math.max(1e-6, maxHeight - minHeight)
  let usedInterval = interval
  if (usedInterval <= 0 || range / usedInterval > MAX_LEVELS) {
    usedInterval = Math.ceil((range / MAX_LEVELS) * 100) / 100
  }
  const levels: number[] = []
  const startLevel = Math.floor(minHeight / usedInterval) * usedInterval
  for (let level = startLevel; level <= maxHeight + 1e-9; level += usedInterval) {
    if (level < minHeight - 1e-9) continue
    levels.push(Math.round(level * 100) / 100)
  }
  const byLevel: ContourLevel[] = levels.map((level) => ({ level, pieces: [] }))
  const subdivisions = 20
  const simplifyEpsilon = Math.max(grid.cellLon, Math.abs(grid.cellLat)) * 0.02
  const sliverLength = Math.max(grid.cellLon, Math.abs(grid.cellLat)) * 0.12

  const ringTest = (lon: number, lat: number): boolean => pointInRing(lon, lat, ring)

  const simplifyPiece = (points: LonLat[], epsilon: number): LonLat[] => {
    if (points.length <= 2) return points
    let maxDistance = 0
    let maxIndex = 0
    const first = points[0]
    const last = points[points.length - 1]
    const dx = last.lon - first.lon
    const dy = last.lat - first.lat
    const denom = Math.hypot(dx, dy)
    for (let i = 1; i < points.length - 1; i += 1) {
      let distance: number
      if (denom < 1e-14) {
        distance = Math.hypot(points[i].lon - first.lon, points[i].lat - first.lat)
      } else {
        distance = Math.abs((points[i].lon - first.lon) * dy - (points[i].lat - first.lat) * dx) / denom
      }
      if (distance > maxDistance) {
        maxDistance = distance
        maxIndex = i
      }
    }
    if (maxDistance <= epsilon) {
      return [first, last]
    }
    const left = simplifyPiece(points.slice(0, maxIndex + 1), epsilon)
    const right = simplifyPiece(points.slice(maxIndex), epsilon)
    return left.slice(0, -1).concat(right)
  }

  const pieceLength = (points: LonLat[]): number => {
    let length = 0
    for (let i = 1; i < points.length; i += 1) {
      length += Math.hypot(points[i].lon - points[i - 1].lon, points[i].lat - points[i - 1].lat)
    }
    return length
  }

  const chainLevel = (raw: LonLat[][]): LonLat[][] => {
    const linkEps = Math.max(grid.cellLon, Math.abs(grid.cellLat)) * 1e-6
    const keyOf = (p: LonLat): string =>
      `${Math.round(p.lon / linkEps)},${Math.round(p.lat / linkEps)}`
    const buckets = new Map<string, number[]>()
    const portPoint = (raw: LonLat[][], port: number): LonLat => {
      const segment = raw[port >> 1]
      return port & 1 ? segment[segment.length - 1] : segment[0]
    }
    const put = (key: string, port: number): void => {
      const list = buckets.get(key)
      if (list) list.push(port)
      else buckets.set(key, [port])
    }
    for (let port = 0; port < raw.length * 2; port += 1) {
      put(keyOf(portPoint(raw, port)), port)
    }
    const used = new Array<boolean>(raw.length * 2).fill(false)
    const chains: LonLat[][] = []
    for (let start = 0; start < used.length; start += 1) {
      if (used[start]) continue
      const points: LonLat[] = [portPoint(raw, start)]
      used[start] = true
      let current = start
      for (;;) {
        const mate = (current & 1) === 0 ? current + 1 : current - 1
        if (used[mate]) break
        used[mate] = true
        const point = portPoint(raw, mate)
        points.push(point)
        let next = -1
        for (const candidate of buckets.get(keyOf(point)) ?? []) {
          if (!used[candidate] && candidate !== mate) {
            next = candidate
            break
          }
        }
        if (next === -1) break
        current = next
      }
      if (points.length < 2) continue
      if (
        Math.abs(points[0].lon - points[points.length - 1].lon) < linkEps &&
        Math.abs(points[0].lat - points[points.length - 1].lat) < linkEps
      ) {
        points.pop()
      }
      if (points.length < 2) continue
      const simplified = simplifyPiece(points, simplifyEpsilon)
      if (simplified.length >= 2 && pieceLength(simplified) >= sliverLength) {
        chains.push(simplified)
      }
    }
    return chains
  }

  for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
    const threshold = levels[levelIndex]
    const raw: LonLat[][] = []
    for (let row = 0; row < grid.ny - 1; row += 1) {
      for (let col = 0; col < grid.nx - 1; col += 1) {
        const tlIndex = row * grid.nx + col
        const trIndex = tlIndex + 1
        const blIndex = tlIndex + grid.nx
        const brIndex = blIndex + 1
        const tl = grid.heights[tlIndex]
        const tr = grid.heights[trIndex]
        const bl = grid.heights[blIndex]
        const br = grid.heights[brIndex]
        if (!Number.isFinite(tl) || !Number.isFinite(tr) || !Number.isFinite(bl) || !Number.isFinite(br)) continue
        const tlUp = tl >= threshold ? 1 : 0
        const trUp = tr >= threshold ? 1 : 0
        const brUp = br >= threshold ? 1 : 0
        const blUp = bl >= threshold ? 1 : 0
        const mask = tlUp | (trUp << 1) | (brUp << 2) | (blUp << 3)
        if (mask === 0 || mask === 15) continue
        const pTL = nodeLonLat(grid, row, col)
        const pTR = nodeLonLat(grid, row, col + 1)
        const pBL = nodeLonLat(grid, row + 1, col)
        const pBR = nodeLonLat(grid, row + 1, col + 1)
        const crossings: LonLat[] = []
        if (tlUp !== trUp) crossings.push(splitSampleEdge(pTL, pTR, threshold - tl, threshold - tr))
        if (trUp !== brUp) crossings.push(splitSampleEdge(pTR, pBR, threshold - tr, threshold - br))
        if (brUp !== blUp) crossings.push(splitSampleEdge(pBR, pBL, threshold - br, threshold - bl))
        if (blUp !== tlUp) crossings.push(splitSampleEdge(pBL, pTL, threshold - bl, threshold - tl))
        let pairs: [number, number][]
        if (crossings.length === 2) {
          pairs = [[0, 1]]
        } else {
          pairs = crossings.length === 4 ? [[0, 1], [2, 3]] : []
        }
        for (const [ia, ib] of pairs) {
          const a = crossings[ia]
          const b = crossings[ib]
          const aIn = ringTest(a.lon, a.lat)
          const bIn = ringTest(b.lon, b.lat)
          if (aIn && bIn) {
            raw.push([a, b])
            continue
          }
          const samples: { lon: number; lat: number; inside: boolean }[] = []
          for (let step = 0; step <= subdivisions; step += 1) {
            const t = step / subdivisions
            const lon = a.lon + (b.lon - a.lon) * t
            const lat = a.lat + (b.lat - a.lat) * t
            samples.push({ lon, lat, inside: ringTest(lon, lat) })
          }
          const refineBoundary = (
            from: { lon: number; lat: number; inside: boolean },
            to: { lon: number; lat: number; inside: boolean }
          ): LonLat => {
            const keepInside = from.inside
            let lo: { lon: number; lat: number } = from
            let hi: { lon: number; lat: number } = to
            for (let iter = 0; iter < 28; iter += 1) {
              const mid = { lon: (lo.lon + hi.lon) / 2, lat: (lo.lat + hi.lat) / 2 }
              if (ringTest(mid.lon, mid.lat) === keepInside) lo = mid
              else hi = mid
            }
            return { lon: (lo.lon + hi.lon) / 2, lat: (lo.lat + hi.lat) / 2 }
          }
          const insideRuns: LonLat[][] = []
          let current: LonLat[] = []
          for (let i = 0; i < samples.length; i += 1) {
            const sample = samples[i]
            if (sample.inside) {
              if (current.length === 0 && i > 0) {
                current.push(refineBoundary(samples[i - 1], sample))
              }
              current.push(sample)
            } else if (current.length > 0) {
              current.push(refineBoundary(samples[i - 1], sample))
              insideRuns.push(current)
              current = []
            }
          }
          if (current.length > 0) insideRuns.push(current)
          for (const run of insideRuns) {
            if (run.length >= 2) raw.push(run)
          }
        }
      }
    }
    byLevel[levelIndex].pieces = chainLevel(raw)
  }

  let segmentCount = 0
  let pieceCount = 0
  for (const level of byLevel) {
    for (const piece of level.pieces) {
      pieceCount += 1
      segmentCount += piece.length - 1
    }
  }
  return { levels, byLevel, segmentCount, pieceCount, usedInterval }
}

export type ContourColorMode = 'ramp' | 'brown' | 'slate' | 'white'

export function levelColor(mode: ContourColorMode, palette: PaletteKey, level: number, minHeight: number, maxHeight: number, alpha: number): Cesium.Color {
  const range = Math.max(1e-6, maxHeight - minHeight)
  let rgb: [number, number, number]
  if (mode === 'ramp') {
    rgb = rampRgb(palette, (level - minHeight) / range)
  } else {
    const fixed: Record<string, string> = { brown: '#8a5a2b', slate: '#37474f', white: '#ffffff' }
    const value = fixed[mode] ?? '#8a5a2b'
    const parsed = hexToRgb(value)
    rgb = parsed
  }
  const tinted = mode === 'ramp' ? [Math.round(rgb[0] * 0.62), Math.round(rgb[1] * 0.62), Math.round(rgb[2] * 0.62)] : rgb
  return Cesium.Color.fromBytes(tinted[0], tinted[1], tinted[2], Math.round(Math.min(1, Math.max(0, alpha)) * 255))
}

export function buildContourPrimitive(
  result: ContourResult,
  grid: SampleGrid,
  mode: ContourColorMode,
  palette: PaletteKey,
  width: number,
  alpha: number,
  minHeight: number,
  maxHeight: number,
  heightOffset = 14
): Cesium.Primitive {
  const instances: Cesium.GeometryInstance[] = []
  const vertexFormat = Cesium.PolylineColorAppearance.VERTEX_FORMAT
  for (let levelIndex = 0; levelIndex < result.byLevel.length; levelIndex += 1) {
    const entry = result.byLevel[levelIndex]
    const color = levelColor(mode, palette, entry.level, minHeight, maxHeight, alpha)
    for (const piece of entry.pieces) {
      const flatLonLat: number[] = []
      const vertexColors: Cesium.Color[] = []
      for (const point of piece) {
        flatLonLat.push(point.lon, point.lat, bilinearHeight(grid, point.lon, point.lat) + heightOffset)
        vertexColors.push(color)
      }
      instances.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: Cesium.Cartesian3.fromDegreesArrayHeights(flatLonLat),
            width: Math.max(1, Math.round(width)),
            vertexFormat,
            colors: vertexColors,
            colorsPerVertex: true
          })
        })
      )
    }
  }
  return new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
    asynchronous: false,
    allowPicking: false
  })
}

export function chooseLabelPoints(result: ContourResult, grid: SampleGrid, every: number, minLevelLength = 0.0006): { level: number; lon: number; lat: number }[] {
  const points: { level: number; lon: number; lat: number }[] = []
  for (let levelIndex = 0; levelIndex < result.byLevel.length; levelIndex += 1) {
    if (every > 1 && levelIndex % every !== 0) continue
    const entry = result.byLevel[levelIndex]
    let bestScore = Number.POSITIVE_INFINITY
    let best: { lon: number; lat: number } | undefined
    for (const piece of entry.pieces) {
      const n = piece.length
      if (n < 2) continue
      let length = 0
      for (let i = 1; i < n; i += 1) {
        length += Math.hypot(piece[i].lon - piece[i - 1].lon, piece[i].lat - piece[i - 1].lat)
      }
      if (length < minLevelLength) continue
      const midLon = piece[Math.floor(n / 2)].lon
      const midLat = piece[Math.floor(n / 2)].lat
      const latMeters = 111320
      const lonMeters = latMeters * Math.cos((midLat * Math.PI) / 180)
      const stepLat = Math.abs(grid.cellLat) * 3
      const stepLon = grid.cellLon * 3
      const hEast = bilinearHeight(grid, Math.min(grid.west + grid.cellLon * (grid.nx - 1), midLon + stepLon), midLat)
      const hWest = bilinearHeight(grid, Math.max(grid.west, midLon - stepLon), midLat)
      const hNorth = bilinearHeight(grid, midLon, Math.min(grid.north, midLat + stepLat))
      const hSouth = bilinearHeight(grid, midLon, Math.max(grid.north + grid.cellLat * (grid.ny - 1), midLat - stepLat))
      const slopeX = (hEast - hWest) / (lonMeters * stepLon * 2)
      const slopeY = (hNorth - hSouth) / (latMeters * stepLat * 2)
      const score = slopeX * slopeX + slopeY * slopeY
      if (score < bestScore) {
        bestScore = score
        best = { lon: midLon, lat: midLat }
      }
    }
    if (best) {
      points.push({ level: entry.level, ...best })
    }
  }
  return points
}

export function formatLevel(level: number): string {
  if (Math.round(level) === level) return String(Math.round(level))
  if (Math.abs(level) < 10) return level.toFixed(1)
  return level.toFixed(1)
}
