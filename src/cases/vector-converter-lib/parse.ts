import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import shp from 'shpjs'
import {
  emptyModel,
  transformModel
} from './crs'
import type {
  CRSId,
  FeatureProps,
  FormatId,
  Geometry,
  GeometryType,
  GroupNode,
  ParseOptions,
  ParseResult,
  Position,
  VectorFeature,
  VectorModel
} from './types'

export function detectFormat(name: string, buffer: ArrayBuffer): FormatId {
  const lower = name.toLowerCase()
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  if (ext === 'geojson') return 'geojson'
  if (ext === 'kml') return 'kml'
  if (ext === 'ovkml') return 'ovkml'
  if (ext === 'kmz') return 'kmz'
  if (ext === 'ovkmz') return 'ovkmz'
  if (ext === 'ovjsn') return 'ovjsn'
  if (ext === 'ovobj') return 'ovobj'
  if (ext === 'gpx') return 'gpx'
  if (ext === 'wkt') return 'wkt'
  if (ext === 'csv') return 'csv'
  if (ext === 'shp' || ext === 'zip') return 'shp'
  if (ext === 'json' || ext === 'txt') {
    const text = safeDecode(buffer).trimStart()
    if (text.startsWith('<')) {
      if (text.includes('<gpx')) return 'gpx'
      return 'kml'
    }
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        const data = JSON.parse(text) as Record<string, unknown>
        if (data && typeof data === 'object' && 'ObjItems' in data) return 'ovjsn'
        return 'geojson'
      } catch {
        return 'geojson'
      }
    }
    if (/^\s*(MULTI)?(POINT|LINESTRING|POLYGON|GEOMETRYCOLLECTION)/i.test(text)) return 'wkt'
    return 'csv'
  }
  if (/^\s*(MULTI)?(POINT|LINESTRING|POLYGON|GEOMETRYCOLLECTION)/i.test(safeDecode(buffer))) return 'wkt'
  return 'geojson'
}

function safeDecode(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  } catch {
    return ''
  }
}

function makeFeature(geometry: Geometry, properties: FeatureProps, groupPath?: string[]): VectorFeature {
  return { type: 'Feature', geometry, properties, groupPath }
}

function buildModel(
  format: FormatId,
  sourceCrs: CRSId,
  features: VectorFeature[],
  groupTree: GroupNode[],
  name?: string
): VectorModel {
  const model = emptyModel(format, sourceCrs)
  model.features = features
  model.metadata.groupTree = groupTree
  model.metadata.name = name
  return model
}

function normalizeGeometryType(type: string): GeometryType | null {
  const t = type.replace(/z$/i, '').toLowerCase()
  switch (t) {
    case 'point':
      return 'Point'
    case 'multipoint':
      return 'MultiPoint'
    case 'linestring':
      return 'LineString'
    case 'multilinestring':
      return 'MultiLineString'
    case 'polygon':
      return 'Polygon'
    case 'multipolygon':
      return 'MultiPolygon'
    default:
      return null
  }
}

function geojsonToFeatures(input: unknown, warnings: string[]): VectorFeature[] {
  const features: VectorFeature[] = []
  const pushGeometry = (geometry: unknown, props: FeatureProps, path?: string[]) => {
    if (!geometry || typeof geometry !== 'object') return
    const g = geometry as { type?: string; geometries?: unknown[]; coordinates?: unknown }
    if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
      for (const child of g.geometries) pushGeometry(child, props, path)
      return
    }
    const type = g.type ? normalizeGeometryType(g.type) : null
    if (!type || g.coordinates === undefined) {
      warnings.push(`忽略无法识别的几何: ${String(g.type)}`)
      return
    }
    const props2: FeatureProps = { ...props }
    features.push(makeFeature({ type, coordinates: g.coordinates }, props2, path))
  }

  const root = input as { type?: string; features?: unknown[]; geometry?: unknown; properties?: unknown } | null
  if (root && root.type === 'FeatureCollection' && Array.isArray(root.features)) {
    for (const item of root.features) {
      const f = item as { geometry?: unknown; properties?: Record<string, unknown> }
      pushGeometry(f.geometry, (f.properties ?? {}) as FeatureProps)
    }
  } else if (root && root.type === 'Feature') {
    pushGeometry(root.geometry, (root.properties ?? {}) as FeatureProps)
  } else {
    pushGeometry(root, {})
  }
  return features
}

async function parseGeoJson(buffer: ArrayBuffer, warnings: string[]): Promise<VectorFeature[]> {
  const text = safeDecode(buffer)
  const data = JSON.parse(text) as Record<string, unknown>
  if (data && typeof data === 'object' && 'objects' in data && 'arcs' in data) {
    const converted = topoJsonToGeoJson(data as TopoJson, warnings)
    return geojsonToFeatures(converted, warnings)
  }
  return geojsonToFeatures(data, warnings)
}

type TopoJson = {
  type: 'Topology'
  transform?: { scale: [number, number]; translate: [number, number] }
  arcs: number[][][]
  objects: Record<string, { type: string; geometries?: unknown[]; arcs?: unknown; properties?: unknown }>
}

function topoJsonToGeoJson(topo: TopoJson, warnings: string[]): unknown {
  const transform = topo.transform
  const arcs = topo.arcs.map((arc) =>
    arc.reduce<number[][]>((acc, p, i) => {
      const prev = i > 0 ? acc[i - 1] : [0, 0]
      const point = transform
        ? [p[0] * transform.scale[0] + transform.translate[0], p[1] * transform.scale[1] + transform.translate[1]]
        : [p[0] + prev[0], p[1] + prev[1]]
      acc.push(point)
      return acc
    }, [])
  )
  const getArc = (index: number): number[][] => (index < 0 ? [...arcs[~index]].reverse() : [...arcs[index]])
  const features: VectorFeature[] = []
  const objectKeys = Object.keys(topo.objects)
  for (const key of objectKeys) {
    const obj = topo.objects[key]
    if (!obj || obj.type !== 'GeometryCollection' || !Array.isArray(obj.geometries)) continue
    for (const geometry of obj.geometries as Array<{ type: string; arcs?: unknown; properties?: unknown; coordinates?: unknown }>) {
      const type = normalizeGeometryType(geometry.type)
      if (!type && geometry.type !== 'GeometryCollection') {
        warnings.push(`TopoJSON 几何类型 ${geometry.type} 暂不支持`)
        continue
      }
      const coords = topoCoordinates(type, geometry.arcs, getArc)
      features.push(makeFeature({ type: type as GeometryType, coordinates: coords }, (geometry.properties ?? {}) as FeatureProps))
    }
  }
  return { type: 'FeatureCollection', features }
}

function topoCoordinates(type: GeometryType | null, arcs: unknown, getArc: (i: number) => number[][]): unknown {
  const line = (arcIndexes: number[]) => arcIndexes.flatMap((i) => getArc(i))
  if (type === 'LineString') return line((arcs as number[]) ?? [])
  if (type === 'MultiLineString') return ((arcs as number[][]) ?? []).map((a) => line(a))
  if (type === 'Polygon') return ((arcs as number[][]) ?? []).map((ring) => line(ring))
  if (type === 'MultiPolygon') return ((arcs as number[][][]) ?? []).map((poly) => poly.map((ring) => line(ring)))
  if (type === 'Point') return (arcs as Position) ?? [0, 0]
  if (type === 'MultiPoint') return (arcs as Position[]) ?? []
  return arcs
}

function xmlParser(): DOMParser {
  return new DOMParser()
}

function firstChildEl(el: Element | Document | null, name: string): Element | null {
  if (!el) return null
  for (let n = el.firstElementChild; n; n = n.nextElementSibling) if (n.localName === name) return n
  return null
}

function childEls(el: Element | Document | null, name: string): Element[] {
  const out: Element[] = []
  if (!el) return out
  for (let n = el.firstElementChild; n; n = n.nextElementSibling) if (n.localName === name) out.push(n)
  return out
}

function deepChild(el: Element | null, name: string): Element | null {
  if (!el) return null
  const list = el.getElementsByTagName('*')
  for (let i = 0; i < list.length; i += 1) if (list[i].localName === name) return list[i]
  return null
}

function elText(el: Element | null): string {
  return el?.textContent?.trim() ?? ''
}

function parseCoordinateText(text: string): Position[] {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => token.split(',').map((v) => Number(v)))
    .filter((arr) => arr.length >= 2 && Number.isFinite(arr[0]) && Number.isFinite(arr[1]))
    .map((arr) => (arr.length >= 3 ? [arr[0], arr[1], arr[2]] : [arr[0], arr[1]]))
}

function kmlGeometryFromElement(el: Element): Geometry | null {
  const local = el.localName?.toLowerCase() ?? ''
  if (local === 'point') {
    const coords = deepChild(el, 'coordinates')
    const parsed = parseCoordinateText(elText(coords))
    if (parsed.length === 0) return null
    return { type: 'Point', coordinates: parsed[0] }
  }
  if (local === 'linestring' || local === 'linearring') {
    const coords = deepChild(el, 'coordinates')
    return { type: 'LineString', coordinates: parseCoordinateText(elText(coords)) }
  }
  if (local === 'polygon') {
    const outer = deepChild(el, 'outerBoundaryIs')
    const outerRing = outer ? deepChild(outer, 'coordinates') : null
    const rings: Position[][] = []
    if (outerRing) rings.push(parseCoordinateText(elText(outerRing)))
    for (const inner of childEls(el, 'innerBoundaryIs')) {
      const ring = deepChild(inner, 'coordinates')
      if (ring) rings.push(parseCoordinateText(elText(ring)))
    }
    if (rings.length === 0) return null
    return { type: 'Polygon', coordinates: rings }
  }
  if (local === 'track') {
    const points: Position[] = []
    for (const coord of childEls(el, 'coord')) {
      const parts = elText(coord).split(/\s+/).map((v) => Number(v))
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) points.push([parts[0], parts[1], parts[2] ?? 0])
    }
    return { type: 'LineString', coordinates: points }
  }
  return null
}

function collectKmlGeometries(el: Element, acc: Geometry[]): void {
  const local = el.localName?.toLowerCase() ?? ''
  if (local === 'multigeometry') {
    for (let n = el.firstElementChild; n; n = n.nextElementSibling) collectKmlGeometries(n, acc)
    return
  }
  const geometry = kmlGeometryFromElement(el)
  if (geometry) acc.push(geometry)
}

function parseKmlExtendedData(placemark: Element): FeatureProps {
  const props: FeatureProps = {}
  for (const data of deepChildrenByLocal(placemark, 'Data')) {
    const name = data.getAttribute('name') ?? ''
    const value = elText(deepChild(data, 'value'))
    if (name) props[name] = value
  }
  for (const simple of deepChildrenByLocal(placemark, 'SimpleData')) {
    const name = simple.getAttribute('name') ?? ''
    if (name) props[name] = elText(simple)
  }
  return props
}

function deepChildrenByLocal(el: Element, name: string): Element[] {
  const out: Element[] = []
  const list = el.getElementsByTagName('*')
  for (let i = 0; i < list.length; i += 1) if (list[i].localName === name) out.push(list[i])
  return out
}

async function xmlText(buffer: ArrayBuffer): Promise<string> {
  return safeDecode(buffer)
}

function parseKmlDocument(text: string, warnings: string[], format: FormatId, sourceCrs: CRSId): ParseResult {
  const doc = xmlParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('KML 解析失败：XML 格式错误')
  const features: VectorFeature[] = []
  const groupTree: GroupNode[] = []
  const root = doc.documentElement

  const walkContainer = (container: Element, path: string[], tree: GroupNode[]): void => {
    for (let child = container.firstElementChild; child; child = child.nextElementSibling) {
      const local = child.localName?.toLowerCase() ?? ''
      if (local === 'folder' || local === 'document') {
        const name = elText(firstChildEl(child, 'name')) || '未命名分组'
        const node: GroupNode = { name, children: [] }
        tree.push(node)
        walkContainer(child, [...path, name], node.children as GroupNode[])
      } else if (local === 'placemark') {
        const name = elText(firstChildEl(child, 'name'))
        const description = elText(firstChildEl(child, 'description'))
        const props: FeatureProps = { ...parseKmlExtendedData(child) }
        if (name) props.name = name
        if (description) props.description = description
        const geometries: Geometry[] = []
        for (let g = child.firstElementChild; g; g = g.nextElementSibling) {
          const gl = g.localName?.toLowerCase() ?? ''
          if (['point', 'linestring', 'linearring', 'polygon', 'multigeometry', 'track'].includes(gl)) {
            collectKmlGeometries(g, geometries)
          }
        }
        if (geometries.length === 0) {
          warnings.push(`Placemark「${name || '未命名'}」未包含几何，已跳过`)
          continue
        }
        for (const geometry of geometries) features.push(makeFeature(geometry, props, path))
      }
    }
  }

  if (root) walkContainer(root, [], groupTree)
  const model = buildModel(format, sourceCrs, features, groupTree)
  return { model, warnings }
}

function ovTypeToGeometry(type: number): GeometryType | null {
  if (type === 7) return 'Point'
  if (type === 8 || type === 10) return 'LineString'
  if (type === 9) return 'Polygon'
  return null
}

function parseOvJson(buffer: ArrayBuffer, warnings: string[], format: FormatId, sourceCrs: CRSId): ParseResult {
  const text = safeDecode(buffer).replace(/^\uFEFF/, '')
  if (!text.trimStart().startsWith('{')) {
    throw new Error('该 OVOBJ 为二进制格式，无法直接解析，请在奥维互动地图中「另存为 OVJSN」后重新导入')
  }
  const data = JSON.parse(text) as { ObjItems?: unknown[] }
  const features: VectorFeature[] = []
  const groupTree: GroupNode[] = []

  const readPoints = (detail: Record<string, unknown>): Position[] => {
    const raw = (detail.Points ?? detail.LonLat ?? detail.points) as unknown
    const list = Array.isArray(raw) ? raw : []
    const points: Position[] = []
    for (const item of list) {
      if (Array.isArray(item)) {
        const nums = item.map((v) => Number(v))
        if (nums.length >= 2 && Number.isFinite(nums[0]) && Number.isFinite(nums[1])) points.push([nums[0], nums[1], nums[2] ?? 0])
      } else if (item && typeof item === 'object') {
        const p = item as Record<string, unknown>
        const lon = Number(p.Lng ?? p.lng ?? p.Lon ?? p.lon ?? p.x)
        const lat = Number(p.Lat ?? p.lat ?? p.y)
        const alt = Number(p.Alt ?? p.alt ?? p.height ?? 0)
        if (Number.isFinite(lon) && Number.isFinite(lat)) points.push([lon, lat, Number.isFinite(alt) ? alt : 0])
      }
    }
    return points
  }

  const walk = (items: unknown[], path: string[], tree: GroupNode[]): void => {
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue
      const item = raw as { Type?: number; Object?: Record<string, unknown> }
      const type = Number(item.Type)
      const obj = (item.Object ?? {}) as Record<string, unknown>
      const detail = (obj.ObjectDetail ?? {}) as Record<string, unknown>
      const name = String(obj.Name ?? obj.name ?? '')
      if (type === 30 || type === 1 || type === 2 || type === 5) {
        const node: GroupNode = { name: name || '未命名分组', children: [] }
        tree.push(node)
        const children = (detail.ObjChildren ?? detail.Children ?? detail.Items) as unknown
        if (Array.isArray(children)) walk(children, [...path, node.name], node.children as GroupNode[])
        continue
      }
      const geometryType = ovTypeToGeometry(type)
      if (!geometryType) continue
      let geometry: Geometry
      if (geometryType === 'Point') {
        const lon = Number(detail.Lng ?? detail.lng ?? detail.Lon ?? detail.lon)
        const lat = Number(detail.Lat ?? detail.lat)
        const alt = Number(detail.Alt ?? detail.alt ?? detail.Altitude ?? 0)
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
          warnings.push(`标签「${name || '未命名'}」缺少坐标，已跳过`)
          continue
        }
        geometry = { type: 'Point', coordinates: [lon, lat, Number.isFinite(alt) ? alt : 0] }
      } else {
        const points = readPoints(detail)
        if (points.length < 2) {
          warnings.push(`「${name || '未命名'}」坐标点不足，已跳过`)
          continue
        }
        geometry = { type: geometryType, coordinates: points }
      }
      const props: FeatureProps = {}
      if (name) props.name = name
      const desc = String(detail.Description ?? detail.desc ?? '')
      if (desc) props.description = desc
      features.push(makeFeature(geometry, props, path))
    }
  }

  const items = Array.isArray(data.ObjItems) ? data.ObjItems : []
  walk(items, [], groupTree)
  return { model: buildModel(format, sourceCrs, features, groupTree), warnings }
}

function parseGpx(buffer: ArrayBuffer, warnings: string[], sourceCrs: CRSId): ParseResult {
  const doc = xmlParser().parseFromString(safeDecode(buffer), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('GPX 解析失败：XML 格式错误')
  const features: VectorFeature[] = []
  const root = doc.documentElement

  const readPoint = (el: Element): Position | null => {
    const lat = Number(el.getAttribute('lat'))
    const lon = Number(el.getAttribute('lon'))
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    const ele = Number(elText(firstChildEl(el, 'ele')))
    return [lon, lat, Number.isFinite(ele) ? ele : 0]
  }

  for (const wpt of childEls(root, 'wpt')) {
    const point = readPoint(wpt)
    if (!point) continue
    features.push(makeFeature({ type: 'Point', coordinates: point }, { name: elText(firstChildEl(wpt, 'name')) }))
  }
  for (const trk of childEls(root, 'trk')) {
    const name = elText(firstChildEl(trk, 'name'))
    for (const seg of childEls(trk, 'trkseg')) {
      const points = childEls(seg, 'trkpt').map(readPoint).filter((p): p is Position => p !== null)
      if (points.length >= 2) features.push(makeFeature({ type: 'LineString', coordinates: points }, { name }))
    }
  }
  for (const rte of childEls(root, 'rte')) {
    const name = elText(firstChildEl(rte, 'name'))
    const points = childEls(rte, 'rtept').map(readPoint).filter((p): p is Position => p !== null)
    if (points.length >= 2) features.push(makeFeature({ type: 'LineString', coordinates: points }, { name }))
  }
  if (features.length === 0) warnings.push('GPX 中未找到航点、轨迹或路线')
  return { model: buildModel('gpx', sourceCrs, features, []), warnings }
}

function tokenizeWkt(input: string): unknown {
  const text = input.replace(/^\s*SRID\s*=\s*\d+\s*;\s*/i, '').trim()
  const match = /^([A-Za-z]+)\s*(Z|M|ZM)?\s*/i.exec(text)
  if (!match) throw new Error('WKT 解析失败：缺少几何类型')
  const body = text.slice(match[0].length)
  let index = 0

  const skip = () => {
    while (index < body.length && /\s/.test(body[index])) index += 1
  }
  const parseNumber = (): number => {
    skip()
    const re = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/
    const m = re.exec(body.slice(index))
    if (!m) throw new Error('WKT 解析失败：坐标数值无效')
    index += m[0].length
    return Number(m[0])
  }
  const parseList = (): unknown => {
    skip()
    if (body[index] === '(') {
      index += 1
      const items: unknown[] = []
      skip()
      if (body[index] === ')') {
        index += 1
        return items
      }
      for (;;) {
        items.push(parseList())
        skip()
        if (body[index] === ',') {
          index += 1
          continue
        }
        if (body[index] === ')') {
          index += 1
          break
        }
        if (index >= body.length) break
      }
      return items
    }
    const nums: number[] = []
    for (;;) {
      nums.push(parseNumber())
      skip()
      if (index < body.length && /[\d.+-]/.test(body[index])) continue
      break
    }
    return nums
  }

  const raw = parseList()
  return { type: match[1].toUpperCase(), raw }
}

function wktRawToGeometry(type: string, raw: unknown): Geometry {
  const norm = type.replace(/Z$|M$|ZM$/i, '')
  switch (norm) {
    case 'POINT':
      return { type: 'Point', coordinates: raw }
    case 'MULTIPOINT':
      return { type: 'MultiPoint', coordinates: normalizeMultiPoint(raw) }
    case 'LINESTRING':
      return { type: 'LineString', coordinates: raw }
    case 'MULTILINESTRING':
      return { type: 'MultiLineString', coordinates: raw }
    case 'POLYGON':
      return { type: 'Polygon', coordinates: raw }
    case 'MULTIPOLYGON':
      return { type: 'MultiPolygon', coordinates: raw }
    default:
      throw new Error(`WKT 暂不支持几何类型：${type}`)
  }
}

function normalizeMultiPoint(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw
  return raw.map((item) => (Array.isArray(item) && Array.isArray(item[0]) ? item[0] : item))
}

function parseWkt(buffer: ArrayBuffer, warnings: string[], sourceCrs: CRSId): ParseResult {
  const text = safeDecode(buffer).trim()
  const statements = text.split(/\n(?=[A-Za-z])/).map((s) => s.trim()).filter(Boolean)
  const features: VectorFeature[] = []
  for (const statement of statements) {
    try {
      const { type, raw } = tokenizeWkt(statement) as { type: string; raw: unknown }
      const geometry = wktRawToGeometry(type, raw)
      features.push(makeFeature(geometry, {}))
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (features.length === 0 && warnings.length === 0) warnings.push('WKT 中未找到有效几何')
  return { model: buildModel('wkt', sourceCrs, features, []), warnings }
}

function parseCsv(buffer: ArrayBuffer, options: ParseOptions, warnings: string[]): ParseResult {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('CSV 解析失败：未找到数据表')
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true })
  if (rows.length === 0) throw new Error('CSV 解析失败：数据为空')
  const headers = Object.keys(rows[0])
  const guess = (...candidates: string[]) =>
    headers.find((h) => candidates.some((c) => h.toLowerCase().replace(/\s/g, '') === c)) ?? ''
  const lonKey = options.csvColumns?.lon || guess('lon', 'lng', 'longitude', '经度', 'x')
  const latKey = options.csvColumns?.lat || guess('lat', 'latitude', '纬度', 'y')
  if (!lonKey || !latKey) throw new Error('CSV 解析失败：未识别经纬度列，请手动指定')
  const nameKey = options.csvColumns?.name || guess('name', '名称', 'title') || ''
  const heightKey = options.csvColumns?.height || guess('height', 'alt', 'elevation', '高程', 'z') || ''

  const features: VectorFeature[] = []
  for (const row of rows) {
    const lon = Number(row[lonKey])
    const lat = Number(row[latKey])
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    const height = heightKey ? Number(row[heightKey]) : 0
    const props: FeatureProps = {}
    if (nameKey && row[nameKey] != null) props.name = String(row[nameKey])
    for (const key of headers) {
      if ([lonKey, latKey, nameKey, heightKey].includes(key)) continue
      const value = row[key]
      if (value == null) continue
      props[key] = typeof value === 'number' || typeof value === 'boolean' ? value : String(value)
    }
    features.push(makeFeature({ type: 'Point', coordinates: [lon, lat, Number.isFinite(height) ? height : 0] }, props))
  }
  if (features.length === 0) warnings.push('CSV 未解析出有效点位')
  return { model: buildModel('csv', options.sourceCrs, features, []), warnings }
}

async function parseShp(buffer: ArrayBuffer, warnings: string[]): Promise<ParseResult> {
  const result = await shp(buffer)
  const collections = Array.isArray(result) ? result : [result]
  const features: VectorFeature[] = []
  const groupTree: GroupNode[] = []
  for (const collection of collections) {
    const layerName = collection.fileName ?? '图层'
    let node = groupTree.find((g) => g.name === layerName)
    if (!node) {
      node = { name: layerName }
      groupTree.push(node)
    }
    for (const f of collection.features ?? []) {
      if (!f.geometry) continue
      const type = normalizeGeometryType(f.geometry.type)
      if (!type) {
        warnings.push(`SHP 几何类型 ${f.geometry.type} 暂不支持`)
        continue
      }
      const props: FeatureProps = {}
      for (const [key, value] of Object.entries(f.properties ?? {})) {
        if (value == null) continue
        props[key] = typeof value === 'number' || typeof value === 'boolean' ? value : String(value)
      }
      features.push(makeFeature({ type, coordinates: f.geometry.coordinates }, props, [layerName]))
    }
  }
  return { model: buildModel('shp', 'wgs84', features, groupTree), warnings }
}

export async function parseFile(file: File, options: ParseOptions, formatOverride?: FormatId): Promise<ParseResult> {
  const buffer = await file.arrayBuffer()
  const format = formatOverride ?? detectFormat(file.name, buffer)
  const warnings: string[] = []
  let result: ParseResult

  switch (format) {
    case 'geojson':
      result = { model: buildModel('geojson', options.sourceCrs, await parseGeoJson(buffer, warnings), []), warnings }
      break
    case 'kml':
    case 'ovkml':
      result = parseKmlDocument(await xmlText(buffer), warnings, format, options.sourceCrs)
      break
    case 'kmz':
    case 'ovkmz': {
      const zip = await JSZip.loadAsync(buffer)
      const entry = zip.file(/doc\.kml$/i)[0] ?? zip.file(/\.kml$/i)[0]
      if (!entry) throw new Error('KMZ/KMZ 压缩包中未找到 KML 文件')
      result = parseKmlDocument(await entry.async('string'), warnings, format, options.sourceCrs)
      break
    }
    case 'ovjsn':
    case 'ovobj':
      result = parseOvJson(buffer, warnings, format, options.sourceCrs)
      break
    case 'gpx':
      result = parseGpx(buffer, warnings, options.sourceCrs)
      break
    case 'wkt':
      result = parseWkt(buffer, warnings, options.sourceCrs)
      break
    case 'csv':
      result = parseCsv(buffer, options, warnings)
      break
    case 'shp': {
      const parsed = await parseShp(buffer, warnings)
      if (options.sourceCrs !== 'wgs84') warnings.push('SHP 由 shpjs 依 .prj 自动重投影到 WGS84，忽略手动源坐标系')
      result = parsed
      break
    }
    default:
      throw new Error(`暂不支持的文件格式：${format}`)
  }

  const model = transformModel(result.model, result.model.metadata.sourceCrs, 'wgs84')
  return { model, warnings }
}
