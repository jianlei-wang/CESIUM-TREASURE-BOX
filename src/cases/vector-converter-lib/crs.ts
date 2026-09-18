import proj4 from 'proj4'
import type { CRSId, Position, VectorFeature, VectorModel } from './types'

export type CRSDef = {
  id: CRSId
  label: string
  kind: 'geographic' | 'gcj' | 'bd' | 'projected'
  proj4Def: string | null
  prjWkt: string
  note?: string
}

const WGS84_WKT =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]'
const CGCS2000_WKT =
  'GEOGCS["GCS_China_Geodetic_Coordinate_System_2000",DATUM["D_China_2000",SPHEROID["CGCS2000",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]'
const MERCATOR_WKT =
  'PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]],PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["False_Easting",0],PARAMETER["False_Northing",0],PARAMETER["Central_Meridian",0],PARAMETER["Standard_Parallel_1",0],PARAMETER["Auxiliary_Sphere_Type",0],UNIT["Meter",1]]'
const GK117_WKT =
  'PROJCS["CGCS2000_3_Degree_GK_CM_117E",GEOGCS["GCS_China_Geodetic_Coordinate_System_2000",DATUM["D_China_2000",SPHEROID["CGCS2000",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000],PARAMETER["False_Northing",0],PARAMETER["Central_Meridian",117],PARAMETER["Scale_Factor",1],PARAMETER["Latitude_Of_Origin",0],UNIT["Meter",1]]'

export const CRS_LIST: CRSDef[] = [
  { id: 'wgs84', label: 'WGS84 经纬度 (EPSG:4326)', kind: 'geographic', proj4Def: null, prjWkt: WGS84_WKT },
  { id: 'cgcs2000', label: 'CGCS2000 经纬度 (EPSG:4490)', kind: 'geographic', proj4Def: '+proj=longlat +ellps=GRS80 +no_defs', prjWkt: CGCS2000_WKT, note: '与 WGS84 差异小于 0.1mm，近似等同' },
  { id: 'gcj02', label: 'GCJ02 火星坐标 (高德/腾讯/奥维)', kind: 'gcj', proj4Def: null, prjWkt: WGS84_WKT, note: '国测局加密坐标，需纠偏' },
  { id: 'bd09', label: 'BD09 百度坐标', kind: 'bd', proj4Def: null, prjWkt: WGS84_WKT },
  { id: 'webmercator', label: 'Web 墨卡托 (EPSG:3857)', kind: 'projected', proj4Def: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs', prjWkt: MERCATOR_WKT },
  { id: 'gk117', label: 'CGCS2000 高斯投影 3°带 CM117°', kind: 'projected', proj4Def: '+proj=tmerc +lat_0=0 +lon_0=117 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs', prjWkt: GK117_WKT }
]

export function getCRS(id: CRSId): CRSDef {
  return CRS_LIST.find((c) => c.id === id) ?? CRS_LIST[0]
}

const PI = Math.PI
const X_PI = (PI * 3000) / 180
const GCJ_A = 6378245.0
const GCJ_EE = 0.00669342162296594323

function outOfChina(lon: number, lat: number): boolean {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x: number, y: number): number {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3
  ret += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3
  ret += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3
  return ret
}

function transformLon(x: number, y: number): number {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3
  ret += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3
  ret += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3
  return ret
}

function wgs84ToGcj02(lon: number, lat: number): [number, number] {
  if (outOfChina(lon, lat)) return [lon, lat]
  let dLat = transformLat(lon - 105, lat - 35)
  let dLon = transformLon(lon - 105, lat - 35)
  const radLat = (lat / 180) * PI
  let magic = Math.sin(radLat)
  magic = 1 - GCJ_EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * PI)
  dLon = (dLon * 180) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * PI)
  return [lon + dLon, lat + dLat]
}

function gcj02ToWgs84(lon: number, lat: number): [number, number] {
  if (outOfChina(lon, lat)) return [lon, lat]
  let dLat = transformLat(lon - 105, lat - 35)
  let dLon = transformLon(lon - 105, lat - 35)
  const radLat = (lat / 180) * PI
  let magic = Math.sin(radLat)
  magic = 1 - GCJ_EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * PI)
  dLon = (dLon * 180) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * PI)
  const mgLat = lat + dLat
  const mgLon = lon + dLon
  return [lon * 2 - mgLon, lat * 2 - mgLat]
}

function gcj02ToBd09(lon: number, lat: number): [number, number] {
  const z = Math.sqrt(lon * lon + lat * lat) + 0.00002 * Math.sin(lat * X_PI)
  const theta = Math.atan2(lat, lon) + 0.000003 * Math.cos(lon * X_PI)
  return [z * Math.cos(theta) + 0.0065, z * Math.sin(theta) + 0.006]
}

function bd09ToGcj02(lon: number, lat: number): [number, number] {
  const x = lon - 0.0065
  const y = lat - 0.006
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI)
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI)
  return [z * Math.cos(theta), z * Math.sin(theta)]
}

function toLonLat(pos: Position): [number, number] {
  return [pos[0], pos[1]]
}

function fromLonLat(lon: number, lat: number, height?: number): Position {
  return height === undefined ? [lon, lat] : [lon, lat, height]
}

function projectedToLonLat(def: CRSDef, x: number, y: number): [number, number] {
  const out = proj4(def.proj4Def as string, 'EPSG:4326', [x, y])
  return [out[0], out[1]]
}

function lonLatToProjected(def: CRSDef, lon: number, lat: number): [number, number] {
  const out = proj4('EPSG:4326', def.proj4Def as string, [lon, lat])
  return [out[0], out[1]]
}

/** 将任意源坐标系坐标转换为 WGS84 经纬度 */
export function toWgs84(lon: number, lat: number, from: CRSId): [number, number] {
  const def = getCRS(from)
  if (def.kind === 'projected') return projectedToLonLat(def, lon, lat)
  if (from === 'gcj02') return gcj02ToWgs84(lon, lat)
  if (from === 'bd09') return gcj02ToWgs84(...bd09ToGcj02(lon, lat))
  return [lon, lat]
}

/** 将 WGS84 经纬度转换为任意目标坐标系坐标 */
export function fromWgs84(lon: number, lat: number, to: CRSId): [number, number] {
  const def = getCRS(to)
  if (def.kind === 'projected') return lonLatToProjected(def, lon, lat)
  if (to === 'gcj02') return wgs84ToGcj02(lon, lat)
  if (to === 'bd09') return gcj02ToBd09(...wgs84ToGcj02(lon, lat))
  return [lon, lat]
}

function transformPosition(pos: Position, from: CRSId, to: CRSId): Position {
  const [lon, lat] = toLonLat(pos)
  const height = pos.length > 2 ? pos[2] : undefined
  if (from === to) return fromLonLat(lon, lat, height)
  const [x, y] = fromWgs84(...toWgs84(lon, lat, from), to)
  return fromLonLat(x, y, height)
}

function transformDeep(coords: unknown, from: CRSId, to: CRSId): unknown {
  if (!Array.isArray(coords)) return coords
  const first = coords[0]
  if (first === undefined) return coords
  if (typeof first === 'number') return transformPosition(coords as Position, from, to)
  return (coords as unknown[]).map((c) => transformDeep(c, from, to))
}

export function transformFeature(feature: VectorFeature, from: CRSId, to: CRSId): VectorFeature {
  if (from === to) return feature
  return {
    ...feature,
    geometry: { ...feature.geometry, coordinates: transformDeep(feature.geometry.coordinates, from, to) }
  }
}

export function transformModel(model: VectorModel, from: CRSId, to: CRSId): VectorModel {
  if (from === to) return model
  return {
    ...model,
    features: model.features.map((f) => transformFeature(f, from, to)),
    metadata: { ...model.metadata, sourceCrs: to }
  }
}

export function forEachPosition(coords: unknown, fn: (pos: Position) => void): void {
  if (!Array.isArray(coords)) return
  const first = coords[0]
  if (first === undefined) return
  if (typeof first === 'number') {
    fn(coords as Position)
    return
  }
  for (const c of coords as unknown[]) forEachPosition(c, fn)
}

export function emptyModel(sourceFormat: VectorModel['metadata']['sourceFormat'], sourceCrs: CRSId): VectorModel {
  return {
    type: 'FeatureCollection',
    features: [],
    metadata: { sourceFormat, sourceCrs, groupTree: [], generatedAt: new Date().toISOString() }
  }
}
