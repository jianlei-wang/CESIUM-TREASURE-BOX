export type Sounding = {
  lon: number
  lat: number
  depth: number
}

export type DepthCell = {
  west: number
  south: number
  east: number
  north: number
  depth: number
}

export type GridBounds = {
  west: number
  south: number
  east: number
  north: number
}

export type InterpolationGrid = {
  cells: DepthCell[]
  bounds: GridBounds
  min: number
  max: number
  colorMin: number
  colorMax: number
  krigingModel?: VariogramModel
  method: string
  resolution: number
}

export type VariogramModel = {
  range: number
  sill: number
  nugget: number
  partialSill: number
  maxLag: number
  type: string
  observed: Array<{ count: number; distance: number; gamma: number }>
}

export type PaletteStop = [number, [number, number, number]]

export type ColorPalette = {
  label: string
  value: string
  stops: PaletteStop[]
}

export const CENTER = { lon: 121.92, lat: 30.72 }
export const EXTENT = { west: 121.76, south: 30.58, east: 122.08, north: 30.86 }

export function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

export function bathymetryField(lon: number, lat: number): number {
  const x = (lon - CENTER.lon) * 92
  const y = (lat - CENTER.lat) * 111
  const trench = 22 * Math.exp(-((x + 4) ** 2 / 70 + (y - 1) ** 2 / 18))
  const bank = -7 * Math.exp(-((x - 5) ** 2 / 18 + (y + 4) ** 2 / 28))
  const navigationChannel = 5.5 * Math.exp(-((x + 1.5) ** 2 / 6 + (y + 5) ** 2 / 72))
  const scourHole = 3.2 * Math.exp(-((x - 7) ** 2 / 4 + (y - 3) ** 2 / 5))
  const ripples = 2.4 * Math.sin(x * 0.55) + 1.7 * Math.cos(y * 0.7)
  return Math.max(3, 24 + trench + bank + navigationChannel + scourHole + ripples)
}

export function createSoundings(count = 2600): Sounding[] {
  const random = seededRandom(20260531)
  const points: Sounding[] = []
  for (let i = 0; i < count; i += 1) {
    const corridor = i % 5 === 0
    const lon = corridor
      ? EXTENT.west + (EXTENT.east - EXTENT.west) * random()
      : CENTER.lon + (random() - 0.5) * (EXTENT.east - EXTENT.west) * 0.92
    const lat = corridor
      ? EXTENT.south + (EXTENT.north - EXTENT.south) * (0.5 + 0.44 * Math.sin(i * 0.09)) + (random() - 0.5) * 0.018
      : CENTER.lat + (random() - 0.5) * (EXTENT.north - EXTENT.south) * 0.9
    const noise = (random() - 0.5) * 1.5
    const depth = -(bathymetryField(lon, lat) + noise)
    points.push({ lon, lat, depth })
  }
  return points
}

export const colorPalettes: ColorPalette[] = [
  {
    label: '深海蓝紫',
    value: 'ocean',
    stops: [
      [0, [30, 53, 149]],
      [0.28, [45, 111, 187]],
      [0.58, [69, 179, 192]],
      [0.82, [172, 221, 171]],
      [1, [247, 236, 142]]
    ]
  },
  {
    label: '测深冷暖',
    value: 'thermal',
    stops: [
      [0, [66, 53, 148]],
      [0.25, [50, 118, 186]],
      [0.5, [44, 179, 164]],
      [0.75, [246, 204, 92]],
      [1, [218, 72, 70]]
    ]
  },
  {
    label: '航道青蓝',
    value: 'channel',
    stops: [
      [0, [20, 38, 92]],
      [0.32, [33, 100, 158]],
      [0.64, [39, 166, 175]],
      [1, [186, 232, 214]]
    ]
  },
  {
    label: '安全分级',
    value: 'safety',
    stops: [
      [0, [36, 81, 151]],
      [0.36, [51, 149, 178]],
      [0.68, [241, 196, 83]],
      [1, [216, 87, 71]]
    ]
  }
]

export function depthToColor(depth: number, min: number, max: number, paletteValue = 'ocean', reverse = false): [number, number, number] {
  const palette = colorPalettes.find((item) => item.value === paletteValue) || colorPalettes[0]
  let t = Math.max(0, Math.min(1, (depth - min) / (max - min || 1)))
  if (reverse) t = 1 - t
  const stops = palette.stops
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [aStop, a] = stops[i]
    const [bStop, b] = stops[i + 1]
    if (t >= aStop && t <= bStop) {
      const local = (t - aStop) / (bStop - aStop)
      return a.map((channel, index) => Math.round(channel + (b[index] - channel) * local)) as [number, number, number]
    }
  }
  return stops[stops.length - 1][1]
}

export function paletteToGradient(paletteValue = 'ocean', reverse = false): string {
  const palette = colorPalettes.find((item) => item.value === paletteValue) || colorPalettes[0]
  const stops = reverse
    ? palette.stops.map(([stop, rgb]) => [1 - stop, rgb] as PaletteStop).reverse()
    : palette.stops
  const cssStops = stops.map(([stop, [r, g, b]]) => `rgb(${r}, ${g}, ${b}) ${Math.round(stop * 100)}%`)
  return `linear-gradient(90deg, ${cssStops.join(', ')})`
}

export const interpolationMethods = [
  { label: 'IDW 反距离权重', value: 'idw' },
  { label: 'Kriging 克里金', value: 'kriging' },
  { label: 'Spline 样条函数', value: 'spline' },
  { label: '自然邻域', value: 'natural' }
]

export function getBounds(points: Sounding[]): GridBounds {
  return points.reduce(
    (bounds, point) => ({
      west: Math.min(bounds.west, point.lon),
      south: Math.min(bounds.south, point.lat),
      east: Math.max(bounds.east, point.lon),
      north: Math.max(bounds.north, point.lat)
    }),
    { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity }
  )
}

export function distanceMeters(point: Sounding, lon: number, lat: number): number {
  const dx = (point.lon - lon) * 92000 * Math.cos((lat * Math.PI) / 180)
  const dy = (point.lat - lat) * 111000
  return Math.sqrt(dx * dx + dy * dy)
}

function nearestSamples(points: Sounding[], lon: number, lat: number, count: number): Array<{ point: Sounding; distance: number }> {
  return points
    .map((point) => ({ point, distance: distanceMeters(point, lon, lat) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
}

export function interpolateIdw(points: Sounding[], lon: number, lat: number, options: { power?: number; limit?: number } = {}): number {
  const power = options.power ?? 2.15
  const limit = options.limit ?? 80
  const samples = nearestSamples(points, lon, lat, limit)
  let weightSum = 0
  let valueSum = 0
  for (const sample of samples) {
    if (sample.distance < 0.5) return sample.point.depth
    const weight = 1 / sample.distance ** power
    weightSum += weight
    valueSum += sample.point.depth * weight
  }
  return valueSum / weightSum
}

function semivariogramShape(distance: number, range: number, type: string): number {
  const ratio = Math.max(0, distance / Math.max(range, 1))
  if (type === 'spherical') {
    return ratio >= 1 ? 1 : 1.5 * ratio - 0.5 * ratio ** 3
  }
  if (type === 'gaussian') return 1 - Math.exp(-3 * ratio ** 2)
  return 1 - Math.exp(-3 * ratio)
}

function semivariogramByDistance(distance: number, model: VariogramModel): number {
  if (distance <= 0) return 0
  return model.nugget + model.partialSill * semivariogramShape(distance, model.range, model.type)
}

export function fitVariogramModel(points: Sounding[], options: { maxLag?: number; binCount?: number; maxPairs?: number; nuggetRatio?: number } = {}): VariogramModel {
  const maxLag = options.maxLag ?? 14500
  const binCount = options.binCount ?? 12
  const maxPairs = Math.min(options.maxPairs ?? 18000, (points.length * (points.length - 1)) / 2)
  const mean = points.reduce((sum, point) => sum + point.depth, 0) / points.length
  const sampleVariance = Math.max(
    1e-6,
    points.reduce((sum, point) => sum + (point.depth - mean) ** 2, 0) / Math.max(1, points.length - 1)
  )
  const bins = Array.from({ length: binCount }, () => ({ count: 0, distance: 0, gamma: 0 }))
  const random = seededRandom(20260729)
  let accepted = 0
  let attempts = 0
  const attemptLimit = maxPairs * 8

  while (accepted < maxPairs && attempts < attemptLimit) {
    attempts += 1
    const first = points[Math.floor(random() * points.length)]
    const second = points[Math.floor(random() * points.length)]
    if (first === second) continue
    const distance = distanceMeters(first, second.lon, second.lat)
    if (distance <= 0 || distance > maxLag) continue
    const index = Math.min(binCount - 1, Math.floor((distance / maxLag) * binCount))
    const bin = bins[index]
    bin.count += 1
    bin.distance += distance
    bin.gamma += 0.5 * (first.depth - second.depth) ** 2
    accepted += 1
  }

  const observed = bins
    .filter((bin) => bin.count > 0)
    .map((bin) => ({ count: bin.count, distance: bin.distance / bin.count, gamma: bin.gamma / bin.count }))
  const tailGamma = observed.length
    ? observed.slice(-Math.min(3, observed.length)).reduce((sum, bin) => sum + bin.gamma, 0) / Math.min(3, observed.length)
    : sampleVariance
  const targetSill = Math.max(1e-6, (sampleVariance + tailGamma) / 2)
  const requestedNugget = targetSill * (options.nuggetRatio ?? 0.02)
  const firstLagNugget = observed[0] ? Math.min(observed[0].gamma, targetSill * 0.3) : requestedNugget
  const nugget = Math.max(1e-6, Math.min(targetSill * 0.5, (requestedNugget + firstLagNugget) / 2))
  let range = Math.max(250, maxLag * 0.5)
  let sill = targetSill
  let type = 'exponential'
  let bestError = Infinity

  for (const candidateType of ['spherical', 'exponential', 'gaussian']) {
    for (let rangeIndex = 0; rangeIndex < 60; rangeIndex += 1) {
      const candidateRange = maxLag * (0.04 + (1.76 * rangeIndex) / 59)
      for (const multiplier of [0.6, 0.8, 1, 1.2, 1.4]) {
        const candidateSill = Math.max(nugget + 1e-6, targetSill * multiplier)
        const candidateModel = {
          type: candidateType,
          range: candidateRange,
          sill: candidateSill,
          nugget,
          partialSill: candidateSill - nugget,
          maxLag,
          observed
        }
        const error = observed.reduce((sum, bin) => {
          const residual = bin.gamma - semivariogramByDistance(bin.distance, candidateModel)
          return sum + bin.count * residual ** 2
        }, 0)
        if (error < bestError) {
          bestError = error
          range = candidateRange
          sill = candidateSill
          type = candidateType
        }
      }
    }
  }
  return { range, sill, nugget, partialSill: sill - nugget, maxLag, observed, type }
}

function interpolateKriging(points: Sounding[], lon: number, lat: number, options: { range?: number; limit?: number; nuggetRatio?: number; model?: VariogramModel } = {}): number {
  const samples = nearestSamples(points, lon, lat, options.limit ?? 22)
  if (samples[0]?.distance < 0.5) return samples[0].point.depth
  const model = options.model ?? fitVariogramModel(points, {
    maxLag: options.range ?? 14500,
    nuggetRatio: options.nuggetRatio ?? 0.02
  })
  const size = samples.length + 1
  const matrix = Array.from({ length: size }, () => Array(size).fill(0))
  const vector = Array(size).fill(0)
  for (let row = 0; row < samples.length; row += 1) {
    for (let col = 0; col < samples.length; col += 1) {
      matrix[row][col] = row === col
        ? 0
        : semivariogramByDistance(distanceMeters(samples[row].point, samples[col].point.lon, samples[col].point.lat), model)
    }
    matrix[row][size - 1] = 1
    matrix[size - 1][row] = 1
    vector[row] = semivariogramByDistance(samples[row].distance, model)
  }
  vector[size - 1] = 1
  const weights = solveLinearSystem(matrix, vector)
  if (!weights) return interpolateIdw(points, lon, lat, { power: 2, limit: options.limit ?? 22 })
  let valueSum = 0
  for (let index = 0; index < samples.length; index += 1) {
    valueSum += samples[index].point.depth * weights[index]
  }
  return valueSum
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length
  const a = matrix.map((row, index) => [...row, vector[index]])
  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
    }
    [a[col], a[pivot]] = [a[pivot], a[col]]
    if (Math.abs(a[pivot][col]) < 1e-11) return null
    const divisor = a[col][col]
    for (let c = col; c <= n; c += 1) a[col][c] /= divisor
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue
      const factor = a[row][col]
      for (let c = col; c <= n; c += 1) a[row][c] -= factor * a[col][c]
    }
  }
  return a.map((row) => row[n])
}

function thinPlate(r: number): number {
  if (r <= 1e-9) return 0
  const scaled = r / 1000
  return scaled * scaled * Math.log(scaled)
}

function buildSplineModel(points: Sounding[], lon: number, lat: number, options: { maxSamples?: number; regularization?: number } = {}):
  | { sites: Array<{ point: Sounding; distance: number; x: number; y: number }>; weights: number[]; trend: number[] }
  | null {
  const maxSamples = options.maxSamples ?? 32
  const regularization = options.regularization ?? 0.08
  const samples = nearestSamples(points, lon, lat, maxSamples)
  const sampleCount = samples.length
  const size = sampleCount + 3
  const latitudeScale = 92000 * Math.cos((lat * Math.PI) / 180)
  const sites = samples.map((sample) => ({
    point: sample.point,
    distance: sample.distance,
    x: ((sample.point.lon - lon) * latitudeScale) / 1000,
    y: ((sample.point.lat - lat) * 111000) / 1000
  }))
  const matrix = Array.from({ length: size }, () => Array(size).fill(0))
  const vector = Array(size).fill(0)
  for (let row = 0; row < sampleCount; row += 1) {
    for (let col = 0; col < sampleCount; col += 1) {
      matrix[row][col] = thinPlate(distanceMeters(sites[row].point, sites[col].point.lon, sites[col].point.lat))
        + (row === col ? regularization : 0)
    }
    matrix[row][sampleCount] = 1
    matrix[row][sampleCount + 1] = sites[row].x
    matrix[row][sampleCount + 2] = sites[row].y
    matrix[sampleCount][row] = 1
    matrix[sampleCount + 1][row] = sites[row].x
    matrix[sampleCount + 2][row] = sites[row].y
    vector[row] = sites[row].point.depth
  }
  const solution = solveLinearSystem(matrix, vector)
  return solution
    ? { sites, weights: solution.slice(0, sampleCount), trend: solution.slice(sampleCount) }
    : null
}

function interpolateSpline(points: Sounding[], lon: number, lat: number, options: { maxSamples?: number; regularization?: number } = {}): number {
  const model = buildSplineModel(points, lon, lat, options)
  if (!model) return interpolateIdw(points, lon, lat, { power: 2, limit: options.maxSamples ?? 32 })
  if (model.sites[0]?.distance < 0.5) return model.sites[0].point.depth
  let value = model.trend[0]
  for (let i = 0; i < model.sites.length; i += 1) {
    value += model.weights[i] * thinPlate(distanceMeters(model.sites[i].point, lon, lat))
  }
  return value
}

function clipPolygonToHalfPlane(polygon: Array<{ x: number; y: number }>, normalX: number, normalY: number, constant: number): Array<{ x: number; y: number }> {
  const clipped: Array<{ x: number; y: number }> = []
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]
    const next = polygon[(index + 1) % polygon.length]
    const currentValue = normalX * current.x + normalY * current.y - constant
    const nextValue = normalX * next.x + normalY * next.y - constant
    const currentInside = currentValue <= 1e-9
    const nextInside = nextValue <= 1e-9
    if (currentInside) clipped.push(current)
    if (currentInside !== nextInside) {
      const ratio = currentValue / (currentValue - nextValue)
      clipped.push({
        x: current.x + (next.x - current.x) * ratio,
        y: current.y + (next.y - current.y) * ratio
      })
    }
  }
  return clipped
}

function polygonArea(polygon: Array<{ x: number; y: number }>): number {
  let twiceArea = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]
    const next = polygon[(index + 1) % polygon.length]
    twiceArea += current.x * next.y - next.x * current.y
  }
  return Math.abs(twiceArea) / 2
}

function interpolateNaturalNeighbor(points: Sounding[], lon: number, lat: number, options: { limit?: number; expansion?: number } = {}): number {
  const coreLimit = options.limit ?? 14
  const expansion = options.expansion ?? 1.08
  const candidateCount = Math.min(points.length, Math.max(6, Math.round(coreLimit * expansion)))
  const samples = nearestSamples(points, lon, lat, candidateCount)
  if (samples[0]?.distance < 0.5) return samples[0].point.depth
  const latitudeScale = 92000 * Math.cos((lat * Math.PI) / 180)
  const sites = samples.map((sample) => ({
    point: sample.point,
    x: (sample.point.lon - lon) * latitudeScale,
    y: (sample.point.lat - lat) * 111000
  }))
  const localRadius = Math.max(1, samples[samples.length - 1]?.distance || 1) * 3
  let queryCell: Array<{ x: number; y: number }> = [
    { x: -localRadius, y: -localRadius },
    { x: localRadius, y: -localRadius },
    { x: localRadius, y: localRadius },
    { x: -localRadius, y: localRadius }
  ]
  for (const site of sites) {
    queryCell = clipPolygonToHalfPlane(queryCell, site.x, site.y, (site.x ** 2 + site.y ** 2) / 2)
    if (queryCell.length < 3) break
  }
  if (queryCell.length < 3 || polygonArea(queryCell) < 1e-6) {
    return interpolateIdw(points, lon, lat, { power: 2, limit: candidateCount })
  }
  let weightSum = 0
  let valueSum = 0
  for (let index = 0; index < sites.length; index += 1) {
    const site = sites[index]
    let stolenCell = queryCell.map((vertex) => ({ ...vertex }))
    for (let otherIndex = 0; otherIndex < sites.length; otherIndex += 1) {
      if (index === otherIndex) continue
      const other = sites[otherIndex]
      const normalX = other.x - site.x
      const normalY = other.y - site.y
      const constant = (other.x ** 2 + other.y ** 2 - site.x ** 2 - site.y ** 2) / 2
      stolenCell = clipPolygonToHalfPlane(stolenCell, normalX, normalY, constant)
      if (stolenCell.length < 3) break
    }
    const weight = stolenCell.length >= 3 ? polygonArea(stolenCell) : 0
    weightSum += weight
    valueSum += site.point.depth * weight
  }
  return weightSum > 1e-9
    ? valueSum / weightSum
    : interpolateIdw(points, lon, lat, { power: 2, limit: candidateCount })
}

function interpolatePoint(points: Sounding[], lon: number, lat: number, method: string, context: InterpolationContext): number {
  if (method === 'kriging') return interpolateKriging(points, lon, lat, context.kriging)
  if (method === 'spline') return interpolateSpline(points, lon, lat, context.spline)
  if (method === 'natural') return interpolateNaturalNeighbor(points, lon, lat, context.natural)
  return interpolateIdw(points, lon, lat, context.idw)
}

export type InterpolationContext = {
  idw?: { power?: number; limit?: number }
  kriging?: { range?: number; limit?: number; nuggetRatio?: number; model?: VariogramModel }
  spline?: { maxSamples?: number; regularization?: number }
  natural?: { limit?: number; expansion?: number }
}

export type InterpolationOptions = {
  marginRatio?: number
  idw?: { power?: number; limit?: number }
  kriging?: { range?: number; limit?: number; nuggetRatio?: number }
  spline?: { maxSamples?: number; regularization?: number }
  natural?: { limit?: number; expansion?: number }
}

export function interpolateGrid(points: Sounding[], method: string, resolution: number, options: InterpolationOptions = {}): InterpolationGrid {
  const bounds = getBounds(points)
  const sourceMin = Math.min(...points.map((point) => point.depth))
  const sourceMax = Math.max(...points.map((point) => point.depth))
  const marginRatio = options.marginRatio ?? 0.04
  const marginLon = (bounds.east - bounds.west) * marginRatio
  const marginLat = (bounds.north - bounds.south) * marginRatio
  const area: GridBounds = {
    west: bounds.west - marginLon,
    south: bounds.south - marginLat,
    east: bounds.east + marginLon,
    north: bounds.north + marginLat
  }
  const krigingModel = method === 'kriging'
    ? fitVariogramModel(points, {
        maxLag: options.kriging?.range,
        nuggetRatio: options.kriging?.nuggetRatio
      })
    : undefined
  const context: InterpolationContext = {
    ...options,
    kriging: { ...options.kriging, model: krigingModel }
  }
  const cells: DepthCell[] = []
  let min = Infinity
  let max = -Infinity
  for (let row = 0; row < resolution; row += 1) {
    for (let col = 0; col < resolution; col += 1) {
      const west = area.west + ((area.east - area.west) * col) / resolution
      const east = area.west + ((area.east - area.west) * (col + 1)) / resolution
      const south = area.south + ((area.north - area.south) * row) / resolution
      const north = area.south + ((area.north - area.south) * (row + 1)) / resolution
      const lon = (west + east) / 2
      const lat = (south + north) / 2
      const depth = interpolatePoint(points, lon, lat, method, context)
      min = Math.min(min, depth)
      max = Math.max(max, depth)
      cells.push({ west, south, east, north, depth })
    }
  }
  return {
    cells,
    bounds: area,
    min,
    max,
    colorMin: sourceMin,
    colorMax: sourceMax,
    krigingModel,
    method,
    resolution
  }
}

export function calculateDifferenceStats(current: InterpolationGrid, baseline: InterpolationGrid):
  { mae: number; rmse: number; maxAbs: number } | null {
  if (!current?.cells?.length || current.cells.length !== baseline?.cells?.length) return null
  const differences = current.cells.map((cell, index) => cell.depth - baseline.cells[index].depth)
  const mae = differences.reduce((sum, value) => sum + Math.abs(value), 0) / differences.length
  const rmse = Math.sqrt(differences.reduce((sum, value) => sum + value ** 2, 0) / differences.length)
  const maxAbs = Math.max(...differences.map((value) => Math.abs(value)))
  return { mae, rmse, maxAbs }
}
