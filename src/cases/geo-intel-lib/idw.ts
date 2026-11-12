export type Bbox = { latMin: number; latMax: number; lonMin: number; lonMax: number }

export type InterpPoint = { lat: number; lon: number; value: number }

export type InterpGrid = {
  data: Float32Array
  variance: Float32Array
  width: number
  height: number
  latMin: number
  latMax: number
  lonMin: number
  lonMax: number
  valueMin: number
  valueMax: number
}

export type ColorStop = { stop: number; r: number; g: number; b: number; a?: number }

const EARTH_RADIUS_M = 6371000

type KDPoint = { x: number; y: number; value: number }

type KDNode = {
  point: KDPoint
  left: KDNode | null
  right: KDNode | null
}

export function projectToLocal(lat: number, lon: number, centerLat: number, centerLon: number): { x: number; y: number } {
  const latR = (lat * Math.PI) / 180
  const lonR = (lon * Math.PI) / 180
  const cLatR = (centerLat * Math.PI) / 180
  const cLonR = (centerLon * Math.PI) / 180
  return {
    x: (lonR - cLonR) * Math.cos(cLatR) * EARTH_RADIUS_M,
    y: (latR - cLatR) * EARTH_RADIUS_M
  }
}

function buildKDTree(points: KDPoint[], depth = 0): KDNode | null {
  if (points.length === 0) return null
  const axis = depth % 2
  points.sort((a, b) => (axis === 0 ? a.x - b.x : a.y - b.y))
  const mid = Math.floor(points.length / 2)
  return {
    point: points[mid],
    left: buildKDTree(points.slice(0, mid), depth + 1),
    right: buildKDTree(points.slice(mid + 1), depth + 1)
  }
}

function distSq(a: KDPoint, x: number, y: number): number {
  const dx = a.x - x
  const dy = a.y - y
  return dx * dx + dy * dy
}

function nearestK(
  tree: KDNode | null,
  x: number,
  y: number,
  k: number,
  depth = 0,
  heap: Array<{ dist: number; point: KDPoint }> = []
): Array<{ dist: number; point: KDPoint }> {
  if (!tree) return heap
  const d = distSq(tree.point, x, y)
  if (heap.length < k) {
    heap.push({ dist: d, point: tree.point })
    heap.sort((a, b) => b.dist - a.dist)
  } else if (d < heap[0].dist) {
    heap[0] = { dist: d, point: tree.point }
    heap.sort((a, b) => b.dist - a.dist)
  }
  const axis = depth % 2
  const diff = axis === 0 ? x - tree.point.x : y - tree.point.y
  const first = diff < 0 ? tree.left : tree.right
  const second = diff < 0 ? tree.right : tree.left
  nearestK(first, x, y, k, depth + 1, heap)
  if (heap.length < k || diff * diff < heap[0].dist) {
    nearestK(second, x, y, k, depth + 1, heap)
  }
  return heap
}

export function interpolateIDW(
  points: InterpPoint[],
  bbox: Bbox,
  gridWidth: number,
  gridHeight: number,
  power = 2,
  neighbors = 12,
  reachM: number = Infinity
): InterpGrid {
  const centerLat = (bbox.latMin + bbox.latMax) / 2
  const centerLon = (bbox.lonMin + bbox.lonMax) / 2
  const projected = points.map((p) => {
    const { x, y } = projectToLocal(p.lat, p.lon, centerLat, centerLon)
    return { x, y, value: p.value }
  })
  const tree = buildKDTree(projected)
  const bboxMin = projectToLocal(bbox.latMin, bbox.lonMin, centerLat, centerLon)
  const bboxMax = projectToLocal(bbox.latMax, bbox.lonMax, centerLat, centerLon)
  const data = new Float32Array(gridWidth * gridHeight)
  const variance = new Float32Array(gridWidth * gridHeight)
  let valueMin = Infinity
  let valueMax = -Infinity
  const xStep = (bboxMax.x - bboxMin.x) / gridWidth
  const yStep = (bboxMax.y - bboxMin.y) / gridHeight

  for (let row = 0; row < gridHeight; row += 1) {
    const y = bboxMin.y + (row + 0.5) * yStep
    for (let col = 0; col < gridWidth; col += 1) {
      const x = bboxMin.x + (col + 0.5) * xStep
      const nbrs = nearestK(tree, x, y, Math.min(neighbors, projected.length))
      let weightSum = 0
      let valueSum = 0
      let closestDist = Infinity
      for (const n of nbrs) {
        if (n.dist < 1e-12) {
          valueSum = n.point.value
          weightSum = 1
          closestDist = 0
          break
        }
        const w = 1 / Math.pow(n.dist, power / 2)
        weightSum += w
        valueSum += w * n.point.value
        if (n.dist < closestDist) closestDist = n.dist
      }
      const idx = row * gridWidth + col
      if (Math.sqrt(closestDist) > reachM || weightSum <= 0) {
        data[idx] = Number.NaN
        variance[idx] = 0
        continue
      }
      const value = valueSum / weightSum
      data[idx] = value
      let varianceEstimate = 0
      if (nbrs.length > 1) {
        for (const n of nbrs) {
          const w = 1 / Math.pow(Math.max(n.dist, 1e-12), power / 2)
          const diff = n.point.value - value
          varianceEstimate += w * diff * diff
        }
        varianceEstimate /= (weightSum * (nbrs.length - 1)) / nbrs.length
      }
      variance[idx] = Math.sqrt(varianceEstimate)
      if (value < valueMin) valueMin = value
      if (value > valueMax) valueMax = value
    }
  }

  return {
    data,
    variance,
    width: gridWidth,
    height: gridHeight,
    latMin: bbox.latMin,
    latMax: bbox.latMax,
    lonMin: bbox.lonMin,
    lonMax: bbox.lonMax,
    valueMin: Number.isFinite(valueMin) ? valueMin : 0,
    valueMax: Number.isFinite(valueMax) ? valueMax : 1
  }
}

function pointInRing(lon: number, lat: number, ring: Array<[number, number]>): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function pointInAnyRing(lon: number, lat: number, rings: Array<Array<[number, number]>>): boolean {
  return rings.some((ring) => pointInRing(lon, lat, ring))
}

function bilinearAt(grid: InterpGrid, gx: number, gy: number): number {
  const r0 = Math.max(0, Math.min(grid.height - 1, Math.floor(gy)))
  const c0 = Math.max(0, Math.min(grid.width - 1, Math.floor(gx)))
  const r1 = Math.min(grid.height - 1, r0 + 1)
  const c1 = Math.min(grid.width - 1, c0 + 1)
  const fx = Math.max(0, Math.min(1, gx - c0))
  const fy = Math.max(0, Math.min(1, gy - r0))
  const v00 = grid.data[r0 * grid.width + c0]
  const v01 = grid.data[r0 * grid.width + c1]
  const v10 = grid.data[r1 * grid.width + c0]
  const v11 = grid.data[r1 * grid.width + c1]
  const finiteCorners = [v00, v01, v10, v11].filter((v) => Number.isFinite(v))
  if (!finiteCorners.length) return Number.NaN
  if (!Number.isFinite(v00) || !Number.isFinite(v01) || !Number.isFinite(v10) || !Number.isFinite(v11)) {
    const corners = [
      { d: fx * fx + fy * fy, v: v00 },
      { d: (1 - fx) * (1 - fx) + fy * fy, v: v01 },
      { d: fx * fx + (1 - fy) * (1 - fy), v: v10 },
      { d: (1 - fx) * (1 - fx) + (1 - fy) * (1 - fy), v: v11 }
    ]
      .filter((c) => Number.isFinite(c.v))
      .sort((a, b) => a.d - b.d)
    return corners.length ? (corners[0].v as number) : Number.NaN
  }
  const top = v00 + (v01 - v00) * fx
  const bottom = v10 + (v11 - v10) * fx
  return top + (bottom - top) * fy
}

function sampleStops(stops: ColorStop[], t: number): { r: number; g: number; b: number; a: number } {
  const clamped = Math.max(0, Math.min(1, t))
  for (let i = 0; i < stops.length - 1; i += 1) {
    const s0 = stops[i]
    const s1 = stops[i + 1]
    if (clamped >= s0.stop && clamped <= s1.stop) {
      const seg = s1.stop === s0.stop ? 0 : (clamped - s0.stop) / (s1.stop - s0.stop)
      return {
        r: Math.round(s0.r + (s1.r - s0.r) * seg),
        g: Math.round(s0.g + (s1.g - s0.g) * seg),
        b: Math.round(s0.b + (s1.b - s0.b) * seg),
        a: Math.round((s0.a ?? 200) + ((s1.a ?? 200) - (s0.a ?? 200)) * seg)
      }
    }
  }
  const last = stops[stops.length - 1]
  return { r: last.r, g: last.g, b: last.b, a: last.a ?? 200 }
}

export function renderGridToCanvas(
  grid: InterpGrid,
  stops: ColorStop[],
  rings?: Array<Array<[number, number]>>,
  upscaleOverride?: number
): HTMLCanvasElement {
  const upscale =
    upscaleOverride ?? Math.min(4, Math.max(1, Math.floor(512 / Math.max(grid.width, grid.height))))
  const width = grid.width * upscale
  const height = grid.height * upscale
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const image = ctx.createImageData(width, height)
  const range = grid.valueMax - grid.valueMin || 1
  const dLon = (grid.lonMax - grid.lonMin) / grid.width
  const dLat = (grid.latMax - grid.latMin) / grid.height

  for (let py = 0; py < height; py += 1) {
    const lat = grid.latMax - ((py + 0.5) * dLat) / upscale
    const gy = ((lat - grid.latMin) / (grid.latMax - grid.latMin || 1)) * grid.height - 0.5
    for (let px = 0; px < width; px += 1) {
      const lon = grid.lonMin + ((px + 0.5) * dLon) / upscale
      const idx = (py * width + px) * 4
      if (rings?.length && !pointInAnyRing(lon, lat, rings)) {
        image.data[idx + 3] = 0
        continue
      }
      const gx = ((lon - grid.lonMin) / (grid.lonMax - grid.lonMin || 1)) * grid.width - 0.5
      const value = bilinearAt(grid, gx, gy)
      if (!Number.isFinite(value)) {
        image.data[idx + 3] = 0
        continue
      }
      const color = sampleStops(stops, (value - grid.valueMin) / range)
      image.data[idx] = color.r
      image.data[idx + 1] = color.g
      image.data[idx + 2] = color.b
      image.data[idx + 3] = color.a
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

export function renderVarianceToCanvas(grid: InterpGrid, rings?: Array<Array<[number, number]>>): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = grid.width
  canvas.height = grid.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const image = ctx.createImageData(grid.width, grid.height)
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < grid.variance.length; i += 1) {
    const v = grid.variance[i]
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  const span = max - min || 1
  const dLon = (grid.lonMax - grid.lonMin) / grid.width
  const dLat = (grid.latMax - grid.latMin) / grid.height
  for (let row = 0; row < grid.height; row += 1) {
    const lat = grid.latMin + (row + 0.5) * dLat
    for (let col = 0; col < grid.width; col += 1) {
      const pi = ((grid.height - 1 - row) * grid.width + col) * 4
      const lon = grid.lonMin + (col + 0.5) * dLon
      if (rings?.length && !pointInAnyRing(lon, lat, rings)) {
        image.data[pi + 3] = 0
        continue
      }
      const t = (grid.variance[row * grid.width + col] - min) / span
      image.data[pi] = Math.round(255 * (1 - t))
      image.data[pi + 1] = Math.round(90 + 120 * (1 - t))
      image.data[pi + 2] = Math.round(60 + 40 * (1 - t))
      image.data[pi + 3] = 128
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

export function probeGridValue(
  grid: InterpGrid,
  lat: number,
  lon: number
): { value: number; lat: number; lon: number; cellX: number; cellY: number } | null {
  if (lat < grid.latMin || lat > grid.latMax || lon < grid.lonMin || lon > grid.lonMax) return null
  const x = Math.max(0, Math.min(grid.width - 1, Math.floor(((lon - grid.lonMin) / (grid.lonMax - grid.lonMin || 1)) * grid.width)))
  const y = Math.max(0, Math.min(grid.height - 1, Math.floor(((lat - grid.latMin) / (grid.latMax - grid.latMin || 1)) * grid.height)))
  const value = grid.data[y * grid.width + x]
  if (!Number.isFinite(value)) return null
  return {
    value,
    lat: grid.latMin + ((y + 0.5) / grid.height) * (grid.latMax - grid.latMin),
    lon: grid.lonMin + ((x + 0.5) / grid.width) * (grid.lonMax - grid.lonMin),
    cellX: x,
    cellY: y
  }
}

export function legendGradientCSS(stops: ColorStop[], direction = 'to top'): string {
  return `linear-gradient(${direction}, ${stops
    .map((c) => `rgb(${c.r},${c.g},${c.b}) ${Math.round(c.stop * 100)}%`)
    .join(', ')})`
}

export const GRID_PALETTES: Array<{ id: string; label: string; stops: ColorStop[] }> = [
  {
    id: 'thermal',
    label: '蓝色到暖红',
    stops: [
      { stop: 0, r: 20, g: 40, b: 180 },
      { stop: 0.25, r: 30, g: 120, b: 220 },
      { stop: 0.5, r: 50, g: 200, b: 100 },
      { stop: 0.75, r: 220, g: 200, b: 50 },
      { stop: 1, r: 200, g: 30, b: 30 }
    ]
  },
  {
    id: 'ironbow',
    label: '铁虹热像',
    stops: [
      { stop: 0, r: 0, g: 0, b: 0 },
      { stop: 0.25, r: 25, g: 0, b: 140 },
      { stop: 0.5, r: 0, g: 170, b: 190 },
      { stop: 0.75, r: 250, g: 210, b: 30 },
      { stop: 1, r: 255, g: 255, b: 255 }
    ]
  },
  {
    id: 'viridis',
    label: '紫青黄',
    stops: [
      { stop: 0, r: 68, g: 1, b: 84 },
      { stop: 0.3, r: 59, g: 82, b: 139 },
      { stop: 0.55, r: 33, g: 145, b: 140 },
      { stop: 0.8, r: 94, g: 201, b: 98 },
      { stop: 1, r: 253, g: 231, b: 37 }
    ]
  },
  {
    id: 'risk',
    label: '风险分级',
    stops: [
      { stop: 0, r: 40, g: 140, b: 90 },
      { stop: 0.35, r: 230, g: 210, b: 70 },
      { stop: 0.6, r: 240, g: 140, b: 40 },
      { stop: 0.8, r: 220, g: 60, b: 50 },
      { stop: 1, r: 140, g: 20, b: 60 }
    ]
  }
]

export function paletteStops(id: string): ColorStop[] {
  return (GRID_PALETTES.find((p) => p.id === id) ?? GRID_PALETTES[0]).stops
}
