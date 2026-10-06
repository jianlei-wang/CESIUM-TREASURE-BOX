/**
 * Data Layer —— 真实地理数据加载 / 解析 / 适配。
 *
 * 支持 GeoJSON、TopoJSON、CSV、JSON、MVT/PBF、GeoTIFF 等真实格式，
 * 统一转换为列式 {@link GeoPointBuffer} 或面要素集合供空间 / 分析层使用。
 */
import { csvParse, geoPath } from 'd3'
import { feature as topoFeature } from 'topojson-client'
import { GeoPointBufferBuilder, type GeoPointBuffer } from '../../core/buffer'

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export type GeoGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'MultiPoint'; coordinates: Array<[number, number]> }
  | { type: 'LineString'; coordinates: Array<[number, number]> }
  | { type: 'MultiLineString'; coordinates: Array<Array<[number, number]>> }
  | { type: 'Polygon'; coordinates: Array<Array<[number, number]>> }
  | { type: 'MultiPolygon'; coordinates: Array<Array<Array<[number, number]>>> }

export type GeoFeature = {
  type: 'Feature'
  properties: Record<string, JsonValue>
  geometry: GeoGeometry
}

export type GeoFeatureCollection = {
  type: 'FeatureCollection'
  features: GeoFeature[]
}

export type CsvFieldMap = {
  lon: string
  lat: string
  value?: string
  category?: string
  time?: string
}

export type CsvParseOptions = CsvFieldMap & {
  /** 时间解析：返回毫秒时间戳。 */
  parseTime?: (raw: string) => number
  /** 类别解析：返回整数编号。 */
  parseCategory?: (raw: string) => number
}

export async function loadText(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`加载失败 ${response.status}: ${url}`)
  return response.text()
}

const cache = new Map<string, Promise<unknown>>()

/** 带缓存的异步加载：同一资源在会话内只拉取一次。 */
export function cachedLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = cache.get(key)
  if (existing) return existing as Promise<T>
  const promise = loader().catch((reason) => {
    cache.delete(key)
    throw reason
  })
  cache.set(key, promise)
  return promise
}

export async function loadJson<T = JsonValue>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`加载失败 ${response.status}: ${url}`)
  return (await response.json()) as T
}

export async function loadArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`加载失败 ${response.status}: ${url}`)
  return response.arrayBuffer()
}

/** 解析 CSV 文本为点缓冲；字段名可配置。 */
export function parseCsvPoints(text: string, options: CsvParseOptions): GeoPointBuffer {
  const rows = csvParse(text) as unknown as Array<Record<string, string>>
  const builder = new GeoPointBufferBuilder(rows.length)
  for (const row of rows) {
    const lon = Number(row[options.lon])
    const lat = Number(row[options.lat])
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    const value = options.value ? Number(row[options.value]) : 1
    const category = options.category
      ? options.parseCategory
        ? options.parseCategory(row[options.category])
        : Number(row[options.category]) || 0
      : 0
    const time = options.time
      ? options.parseTime
        ? options.parseTime(row[options.time])
        : Number(row[options.time]) || 0
      : 0
    builder.push(lon, lat, Number.isFinite(value) ? value : 1, category, time)
  }
  return builder.build()
}

export async function loadCsvPoints(url: string, options: CsvParseOptions): Promise<GeoPointBuffer> {
  return parseCsvPoints(await loadText(url), options)
}

/** 解析 GeoJSON Point/MultiPoint 为点缓冲。 */
export function parseGeoJsonPoints(collection: GeoFeatureCollection | GeoFeature): GeoPointBuffer {
  const features = collection.type === 'FeatureCollection' ? collection.features : [collection]
  let count = 0
  for (const item of features) {
    if (item.geometry.type === 'Point') count += 1
    else if (item.geometry.type === 'MultiPoint') count += item.geometry.coordinates.length
  }
  const builder = new GeoPointBufferBuilder(count)
  let category = 0
  for (const item of features) {
    const value = Number((item.properties.value as number) ?? 1)
    const time = Number((item.properties.time as number) ?? 0)
    if (item.geometry.type === 'Point') {
      const [lon, lat] = item.geometry.coordinates
      builder.push(lon, lat, Number.isFinite(value) ? value : 1, category, time)
    } else if (item.geometry.type === 'MultiPoint') {
      for (const [lon, lat] of item.geometry.coordinates) builder.push(lon, lat, value, category, time)
    }
    category += 1
  }
  return builder.build()
}

export async function loadGeoJsonPoints(url: string): Promise<GeoPointBuffer> {
  return parseGeoJsonPoints((await loadJson(url)) as GeoFeatureCollection)
}

/** 提取面 / 线要素（用于等值线、区域聚合、MVT 编码）。 */
export function parseGeoJsonFeatures(collection: GeoFeatureCollection): GeoFeature[] {
  return collection.features ?? []
}

export async function loadGeoJsonFeatures(url: string): Promise<GeoFeature[]> {
  return parseGeoJsonFeatures((await loadJson(url)) as GeoFeatureCollection)
}

/** TopoJSON → GeoJSON 要素。 */
export function parseTopoJsonFeatures(topology: Record<string, unknown>, objectName?: string): GeoFeature[] {
  const objects = (topology.objects ?? {}) as Record<string, unknown>
  const key = objectName ?? Object.keys(objects)[0]
  if (!key || !objects[key]) return []
  return (topoFeature(topology as never, objects[key] as never) as unknown as GeoFeatureCollection).features
}

export async function loadTopoJsonFeatures(url: string, objectName?: string): Promise<GeoFeature[]> {
  return parseTopoJsonFeatures((await loadJson<Record<string, unknown>>(url)), objectName)
}

export type Bounds = { west: number; south: number; east: number; north: number }

/** 计算要素集合的经纬度包围盒。 */
export function featureBounds(features: GeoFeature[]): Bounds {
  let west = Number.POSITIVE_INFINITY
  let south = Number.POSITIVE_INFINITY
  let east = Number.NEGATIVE_INFINITY
  let north = Number.NEGATIVE_INFINITY
  const visit = (coords: unknown): void => {
    if (typeof coords === 'number') return
    if (Array.isArray(coords)) {
      if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        const lon = coords[0] as number
        const lat = coords[1] as number
        if (lon < west) west = lon
        if (lon > east) east = lon
        if (lat < south) south = lat
        if (lat > north) north = lat
        return
      }
      for (const child of coords) visit(child)
    }
  }
  for (const item of features) visit((item.geometry as { coordinates: unknown }).coordinates)
  if (!Number.isFinite(west)) return { west: -180, south: -90, east: 180, north: 90 }
  return { west, south, east, north }
}

/** 面要素质心（用于区域聚合 / 标签）。 */
export function featureCentroid(current: GeoFeature, all: GeoFeature[] = [current]): [number, number] {
  const collection: GeoFeatureCollection = { type: 'FeatureCollection', features: all }
  const path = geoPath()
  const centroid = path.centroid(collection as never)
  if (Number.isFinite(centroid[0]) && Number.isFinite(centroid[1])) return [centroid[0], centroid[1]]
  const bounds = featureBounds([current])
  return [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2]
}

export * from './geotiff'

export { decodeMvt, encodeMvt, type MvtTile, type MvtLayer, type MvtFeature, type MvtGeometryInput } from '../parsers/mvt'
