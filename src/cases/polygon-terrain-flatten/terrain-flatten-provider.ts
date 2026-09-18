import type { Scene, TerrainData, TerrainProvider } from 'cesium'
import { pointInRing, type Ring } from '../polygon-depth-contour/depth-contour-lib'

type TileRectRadians = {
  west: number
  south: number
  east: number
  north: number
}

type LoadedTileLike = {
  level: number
  rectangle: TileRectRadians
  state: number
  _southwestChild?: LoadedTileLike
  _southeastChild?: LoadedTileLike
  _northwestChild?: LoadedTileLike
  _northeastChild?: LoadedTileLike
  freeResources: () => void
}

const TILE_STATE_START = 0
const TILE_STATE_DONE = 2

type QuantizedTerrainData = TerrainData & {
  _quantizedVertices?: Uint16Array
  _minimumHeight?: number
  _maximumHeight?: number
}

export type FlattenTerrainOptions = {
  ringDeg: Ring
  targetHeight: number
}

export type FlattenTerrainStats = {
  seenTiles: number
  touchedTiles: number
  flattenedVertices: number
}

const MAX_SHORT = 32767
const RAD_TO_DEG = 180 / Math.PI

const stats: FlattenTerrainStats = {
  seenTiles: 0,
  touchedTiles: 0,
  flattenedVertices: 0
}

export function resetFlattenTerrainStats(): void {
  stats.seenTiles = 0
  stats.touchedTiles = 0
  stats.flattenedVertices = 0
}

export function readFlattenTerrainStats(): FlattenTerrainStats {
  return { ...stats }
}

function ringBoundsDeg(ring: Ring): { minLon: number; minLat: number; maxLon: number; maxLat: number } {
  let minLon = Number.POSITIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLon = Number.NEGATIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  for (const point of ring) {
    if (point.lon < minLon) minLon = point.lon
    if (point.lon > maxLon) maxLon = point.lon
    if (point.lat < minLat) minLat = point.lat
    if (point.lat > maxLat) maxLat = point.lat
  }
  return { minLon, minLat, maxLon, maxLat }
}

export function ringIntersectsTile(ring: Ring, tileRect: TileRectRadians): boolean {
  const box = ringBoundsDeg(ring)
  const tileWestDeg = tileRect.west * RAD_TO_DEG
  const tileSouthDeg = tileRect.south * RAD_TO_DEG
  const tileEastDeg = tileRect.east * RAD_TO_DEG
  const tileNorthDeg = tileRect.north * RAD_TO_DEG
  if (box.maxLon < tileWestDeg || box.minLon > tileEastDeg) return false
  if (box.maxLat < tileSouthDeg || box.minLat > tileNorthDeg) return false
  return true
}

export function flattenQuantizedTile(
  data: QuantizedTerrainData,
  tileRect: TileRectRadians,
  options: FlattenTerrainOptions
): TerrainData {
  const quantized = data._quantizedVertices
  if (!quantized || quantized.length === 0) return data
  const minHeight = data._minimumHeight
  const maxHeight = data._maximumHeight
  if (minHeight === undefined || maxHeight === undefined) return data
  if (!Number.isFinite(minHeight) || !Number.isFinite(maxHeight)) return data

  const vertexCount = quantized.length / 3
  if (!Number.isInteger(vertexCount)) return data

  const tileWestDeg = tileRect.west * RAD_TO_DEG
  const tileSouthDeg = tileRect.south * RAD_TO_DEG
  const lonSpanDeg = (tileRect.east - tileRect.west) * RAD_TO_DEG
  const latSpanDeg = (tileRect.north - tileRect.south) * RAD_TO_DEG
  const heightSpan = maxHeight - minHeight

  let changedCount = 0
  let anyChanged = false
  let minNew = Number.POSITIVE_INFINITY
  let maxNew = Number.NEGATIVE_INFINITY

  for (let i = 0; i < vertexCount; i += 1) {
    const rawU = quantized[i]
    const rawV = quantized[i + vertexCount]
    const rawH = quantized[i + vertexCount * 2]
    const lonDeg = tileWestDeg + (rawU / MAX_SHORT) * lonSpanDeg
    const latDeg = tileSouthDeg + (rawV / MAX_SHORT) * latSpanDeg
    const height = minHeight + (rawH / MAX_SHORT) * heightSpan
    if (pointInRing(lonDeg, latDeg, options.ringDeg)) {
      if (Math.abs(height - options.targetHeight) > 1e-3) {
        anyChanged = true
        changedCount += 1
      }
      if (options.targetHeight < minNew) minNew = options.targetHeight
      if (options.targetHeight > maxNew) maxNew = options.targetHeight
    } else {
      if (height < minNew) minNew = height
      if (height > maxNew) maxNew = height
    }
  }

  if (!anyChanged || !Number.isFinite(minNew) || !Number.isFinite(maxNew)) return data

  const reencoded = new Uint16Array(quantized.length)
  const newHeightSpan = maxNew - minNew
  for (let i = 0; i < vertexCount; i += 1) {
    const rawU = quantized[i]
    const rawV = quantized[i + vertexCount]
    const rawH = quantized[i + vertexCount * 2]
    const lonDeg = tileWestDeg + (rawU / MAX_SHORT) * lonSpanDeg
    const latDeg = tileSouthDeg + (rawV / MAX_SHORT) * latSpanDeg
    let height: number
    if (pointInRing(lonDeg, latDeg, options.ringDeg)) {
      height = options.targetHeight
    } else {
      height = minHeight + (rawH / MAX_SHORT) * heightSpan
    }
    let quantizedHeight = 0
    if (newHeightSpan > 0) {
      quantizedHeight = ((height - minNew) / newHeightSpan) * MAX_SHORT
      if (quantizedHeight <= 0) quantizedHeight = 0
      else if (quantizedHeight >= MAX_SHORT) quantizedHeight = MAX_SHORT
      else quantizedHeight = Math.round(quantizedHeight)
    }
    reencoded[i] = rawU
    reencoded[i + vertexCount] = rawV
    reencoded[i + vertexCount * 2] = quantizedHeight
  }

  data._minimumHeight = minNew
  data._maximumHeight = maxNew
  data._quantizedVertices = reencoded

  stats.touchedTiles += 1
  stats.flattenedVertices += changedCount
  return data
}

type FlattenState = {
  options: FlattenTerrainOptions | null
}

export type FlattenTerrainController = {
  terrainProvider: TerrainProvider
  setOptions: (options: FlattenTerrainOptions | null) => void
  getOptions: () => FlattenTerrainOptions | null
}

export function createFlattenTerrainProvider(base: TerrainProvider): FlattenTerrainController {
  const typedBase = base as unknown as {
    requestTileGeometry: (x: number, y: number, level: number, request?: unknown) => Promise<TerrainData> | undefined
    tilingScheme: {
      tileXYToRectangle: (x: number, y: number, level: number) => { west: number; south: number; east: number; north: number }
    }
  }
  const originalRequest = typedBase.requestTileGeometry.bind(typedBase)
  const getTileRect = (x: number, y: number, level: number): TileRectRadians => {
    const rect = typedBase.tilingScheme.tileXYToRectangle(x, y, level)
    return { west: rect.west, south: rect.south, east: rect.east, north: rect.north }
  }
  const state: FlattenState = { options: null }
  const wrapper = Object.create(base) as TerrainProvider
  ;(wrapper as unknown as { requestTileGeometry: (x: number, y: number, level: number, request?: unknown) => Promise<TerrainData> | undefined }).requestTileGeometry =
    function requestTileGeometry(x: number, y: number, level: number, request?: unknown): Promise<TerrainData> | undefined {
      const promise = originalRequest(x, y, level, request)
      if (!promise) return undefined
      const options = state.options
      if (!options) return promise
      return promise.then((data: TerrainData) => {
        const quantized = (data as QuantizedTerrainData)._quantizedVertices
        if (!quantized || quantized.length === 0) return data
        stats.seenTiles += 1
        const tileRect = getTileRect(x, y, level)
        if (!ringIntersectsTile(options.ringDeg, tileRect)) return data
        return flattenQuantizedTile(data as QuantizedTerrainData, tileRect, options)
      })
    }
  return {
    terrainProvider: wrapper,
    setOptions: (options) => { state.options = options },
    getOptions: () => state.options
  }
}

function hasLoadedChildIntersectingRing(tile: LoadedTileLike, ring: Ring): boolean {
  const candidates = [tile._southwestChild, tile._southeastChild, tile._northwestChild, tile._northeastChild]
  for (const child of candidates) {
    if (child && child.state !== TILE_STATE_START && ringIntersectsTile(ring, child.rectangle)) {
      return true
    }
  }
  return false
}

type QuadtreePrimitiveLike = {
  forEachLoadedTile?: (fn: (tile: LoadedTileLike) => void) => void
}

export function invalidateTilesIntersectingRing(scene: Scene, ring: Ring): void {
  const quadtree = (scene as unknown as { globe?: { _surface?: QuadtreePrimitiveLike } }).globe?._surface
  if (!quadtree || typeof quadtree.forEachLoadedTile !== 'function') return
  const tiles: LoadedTileLike[] = []
  quadtree.forEachLoadedTile((tile) => {
    if (tile.state === TILE_STATE_START || tile.state !== TILE_STATE_DONE) return
    if (!ringIntersectsTile(ring, tile.rectangle)) return
    if (hasLoadedChildIntersectingRing(tile, ring)) return
    tiles.push(tile)
  })
  for (const tile of tiles) {
    tile.freeResources()
  }
  if (tiles.length > 0) {
    scene.requestRender()
  }
}
