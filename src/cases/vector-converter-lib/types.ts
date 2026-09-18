export type Position = [number, number] | [number, number, number]

export type GeometryType =
  | 'Point'
  | 'MultiPoint'
  | 'LineString'
  | 'MultiLineString'
  | 'Polygon'
  | 'MultiPolygon'

export type Geometry = {
  type: GeometryType
  coordinates: unknown
}

export type FeatureProps = Record<string, string | number | boolean | null>

export type VectorFeature = {
  type: 'Feature'
  geometry: Geometry
  properties: FeatureProps
  groupPath?: string[]
}

export type GroupNode = {
  name: string
  children?: GroupNode[]
}

export type VectorModel = {
  type: 'FeatureCollection'
  features: VectorFeature[]
  metadata: {
    sourceFormat: FormatId
    sourceCrs: CRSId
    name?: string
    groupTree: GroupNode[]
    generatedAt: string
  }
}

export type CRSId = 'wgs84' | 'cgcs2000' | 'gcj02' | 'bd09' | 'webmercator' | 'gk117'

export type FormatId =
  | 'geojson'
  | 'kml'
  | 'kmz'
  | 'ovkml'
  | 'ovkmz'
  | 'ovjsn'
  | 'ovobj'
  | 'gpx'
  | 'wkt'
  | 'csv'
  | 'shp'

export type ParseOptions = {
  sourceCrs: CRSId
  csvColumns?: { lon: string; lat: string; name?: string; height?: string }
}

export type SerializeOptions = {
  targetCrs: CRSId
  baseName: string
}

export type ParseResult = {
  model: VectorModel
  warnings: string[]
}

export type SerializeResult = {
  blob: Blob
  filename: string
  warnings: string[]
}
