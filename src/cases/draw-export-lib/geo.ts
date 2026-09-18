import proj4 from 'proj4'

export type CRSId = 'wgs84' | 'mercator' | 'beijing54' | 'xian80'

export type CRS = {
  id: CRSId
  label: string
  proj4Def: string | null
  prjWkt: string
}

export const CRS_LIST: CRS[] = [
  {
    id: 'wgs84',
    label: 'WGS84(经纬度 4326)',
    proj4Def: null,
    prjWkt: 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]'
  },
  {
    id: 'mercator',
    label: 'Web墨卡托(3857)',
    proj4Def: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs',
    prjWkt: 'PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]],PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["False_Easting",0],PARAMETER["False_Northing",0],PARAMETER["Central_Meridian",0],PARAMETER["Standard_Parallel_1",0],PARAMETER["Auxiliary_Sphere_Type",0],UNIT["Meter",1]]'
  },
  {
    id: 'beijing54',
    label: '北京54(3°带,中央经线117°)',
    proj4Def: '+proj=tmerc +lat_0=0 +lon_0=117 +k=1 +x_0=500000 +y_0=0 +ellps=krass +units=m +no_defs',
    prjWkt: 'PROJCS["Beijing_1954_3_Degree_GK_CM_117E",GEOGCS["GCS_Beijing_1954",DATUM["D_Beijing_1954",SPHEROID["Krassowsky_1940",6378245,298.3]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000],PARAMETER["False_Northing",0],PARAMETER["Central_Meridian",117],PARAMETER["Scale_Factor",1],PARAMETER["Latitude_Of_Origin",0],UNIT["Meter",1]]'
  },
  {
    id: 'xian80',
    label: '西安80(3°带,中央经线117°)',
    proj4Def: '+proj=tmerc +lat_0=0 +lon_0=117 +k=1 +x_0=500000 +y_0=0 +a=6378140 +rf=298.257 +units=m +no_defs',
    prjWkt: 'PROJCS["Xian_1980_3_Degree_GK_CM_117E",GEOGCS["GCS_Xian_1980",DATUM["D_Xian_1980",SPHEROID["Xian_1980",6378140,298.257]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000],PARAMETER["False_Northing",0],PARAMETER["Central_Meridian",117],PARAMETER["Scale_Factor",1],PARAMETER["Latitude_Of_Origin",0],UNIT["Meter",1]]'
  }
]

export function getCRS(id: CRSId): CRS {
  return CRS_LIST.find((c) => c.id === id) ?? CRS_LIST[0]
}

export function makeConverter(crs: CRS): (coord: [number, number]) => [number, number] {
  if (!crs.proj4Def) {
    return (coord: [number, number]) => [coord[0], coord[1]]
  }
  const convert = proj4('EPSG:4326', crs.proj4Def)
  return (coord: [number, number]) => {
    const out = convert.forward([coord[0], coord[1]])
    return [out[0], out[1]]
  }
}

export function transformCoordinates<T>(coords: T, convert: (c: [number, number]) => [number, number]): T {
  if (typeof coords === 'number') return coords
  if (Array.isArray(coords)) {
    const first = coords[0]
    if (first !== undefined && typeof first === 'number') {
      return convert([coords[0], coords[1]]) as unknown as T
    }
    return (coords as unknown[]).map((c) => transformCoordinates(c, convert)) as unknown as T
  }
  return coords
}

export type GeoJSONGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'Polygon'; coordinates: [number, number][][] }

export type GeoJSONFeature = {
  type: 'Feature'
  properties: Record<string, string | number>
  geometry: GeoJSONGeometry
}

export type GeoJSONFeatureCollection = {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
}

export function featuresByType(fc: GeoJSONFeatureCollection): {
  point: GeoJSONFeature[]
  line: GeoJSONFeature[]
  polygon: GeoJSONFeature[]
} {
  return {
    point: fc.features.filter((f) => f.geometry.type === 'Point'),
    line: fc.features.filter((f) => f.geometry.type === 'LineString'),
    polygon: fc.features.filter((f) => f.geometry.type === 'Polygon')
  }
}

export function getPresentTypes(fc: GeoJSONFeatureCollection): GeoJSONGeometry['type'][] {
  const types = new Set<GeoJSONGeometry['type']>()
  for (const f of fc.features) types.add(f.geometry.type)
  return [...types]
}
