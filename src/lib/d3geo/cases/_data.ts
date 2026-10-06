/**
 * 案例共享的真实数据装配。
 *
 * 只做「真实格式 → 列式缓冲 / 要素」的转换，不产生随机数据。
 * 唯一允许随机数据的路径是 `data/synthetic`（性能压测）。
 */
import { csvParse, csvParseRows } from 'd3'
import { GeoPointBufferBuilder, type GeoPointBuffer, type FlowBuffer } from '../core/buffer'
import { cachedLoad, loadJson, loadText, parseGeoJsonPoints, type GeoFeatureCollection } from '../data/loaders'
import { DATA } from './_kit'

export type QuakeProperties = {
  mag: number | null
  time: number
  place?: string
  magType?: string
  depth?: number
}

/** USGS 地震 GeoJSON → 点缓冲（value = 震级，time = 发震时刻，category = 震级分档）。 */
export function parseQuakePoints(collection: GeoFeatureCollection): GeoPointBuffer {
  const features = collection.features.filter((feature) => feature.geometry.type === 'Point')
  const builder = new GeoPointBufferBuilder(features.length)
  for (const feature of features) {
    const props = feature.properties as unknown as QuakeProperties
    const [lon, lat] = (feature.geometry as { coordinates: [number, number] }).coordinates
    const mag = Number(props.mag ?? 1)
    const depth = Number((props as unknown as { depth?: number }).depth ?? 0)
    const category = mag < 2 ? 0 : mag < 3 ? 1 : mag < 4 ? 2 : mag < 5 ? 3 : mag < 6 ? 4 : 5
    builder.push(Number.isFinite(lon) ? lon : 0, Number.isFinite(lat) ? lat : 0, Number.isFinite(mag) ? mag : 1, category, Number(props.time ?? 0))
    void depth
  }
  return builder.build()
}

/** 会话内缓存的真实地震数据（USGS 近一月，含时间 / 震级 / 位置）。 */
export function loadQuakes(): Promise<GeoPointBuffer> {
  return cachedLoad('usgs-quakes-month', async () => {
    const collection = await loadJson<GeoFeatureCollection>(DATA.usgsQuakes)
    return parseQuakePoints(collection)
  })
}

/** 真实世界城市点（GeoJSON Point，真实经纬度）。 */
export function loadCities(): Promise<GeoPointBuffer> {
  return cachedLoad('world-cities', async () => {
    const collection = await loadJson<GeoFeatureCollection>(DATA.worldCities)
    return parseGeoJsonPoints(collection)
  })
}

export type AirportNode = { iata: string; lon: number; lat: number; name: string; country: string }

/** 解析 OpenFlights airports.csv：iata,name,lon,lat,country,continent,size。 */
export function parseAirports(text: string): Map<string, AirportNode> {
  const rows = csvParse(text) as unknown as Array<Record<string, string>>
  const map = new Map<string, AirportNode>()
  for (const row of rows) {
    const iata = row.iata
    if (!iata) continue
    const lon = Number(row.lon)
    const lat = Number(row.lat)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    map.set(iata, { iata, lon, lat, name: row.name ?? iata, country: row.country ?? '' })
  }
  return map
}

export type RoutesData = { flow: FlowBuffer; nodes: AirportNode[]; routeCount: number }

/**
 * 解析真实航线 OD（OpenFlights routes.dat）+ 机场坐标（airports.csv）。
 * 每一行航线记一次 OD，value 用同一 OD 对出现的次数累加。
 */
export function parseRoutes(airportText: string, routesText: string): RoutesData {
  const airports = parseAirports(airportText)
  const rows = csvParseRows(routesText) as unknown as string[][]
  const pairs = new Map<string, { a: AirportNode; b: AirportNode; value: number }>()
  let routeCount = 0
  for (const row of rows) {
    if (row.length < 5) continue
    const source = row[2]
    const dest = row[4]
    if (!source || !dest || source === dest) continue
    const a = airports.get(source)
    const b = airports.get(dest)
    if (!a || !b) continue
    routeCount += 1
    const key = `${source}->${dest}`
    const existing = pairs.get(key)
    if (existing) existing.value += 1
    else pairs.set(key, { a, b, value: 1 })
  }
  const entries = [...pairs.values()]
  const originLon = new Float32Array(entries.length)
  const originLat = new Float32Array(entries.length)
  const destLon = new Float32Array(entries.length)
  const destLat = new Float32Array(entries.length)
  const values = new Float32Array(entries.length)
  const categories = new Uint16Array(entries.length)
  entries.forEach((entry, index) => {
    originLon[index] = entry.a.lon
    originLat[index] = entry.a.lat
    destLon[index] = entry.b.lon
    destLat[index] = entry.b.lat
    values[index] = entry.value
    categories[index] = index % 6
  })
  return {
    flow: { length: entries.length, originLon, originLat, destLon, destLat, values, categories },
    nodes: [...airports.values()],
    routeCount
  }
}

export function loadRoutes(): Promise<RoutesData> {
  return cachedLoad('openflights-routes', async () => {
    const [airportText, routesText] = await Promise.all([loadText(DATA.airportsCsv), loadText(DATA.airlineRoutes)])
    return parseRoutes(airportText, routesText)
  })
}

/** 世界国家 TopoJSON → 面要素（用于 MVT / 边界）。 */
export function loadWorldTopo(): Promise<Record<string, unknown>> {
  return cachedLoad('world-countries-topo', () => loadJson<Record<string, unknown>>(DATA.worldCountries))
}
