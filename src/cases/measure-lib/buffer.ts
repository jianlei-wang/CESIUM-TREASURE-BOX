import * as jstsModule from 'jsts'
import { center } from '@turf/center'
import { geoAzimuthalEquidistant } from 'd3-geo'
import { feature, point, lineString, polygon, earthRadius } from '@turf/helpers'
import type { Feature, Geometry, Polygon as TurfPolygon, Position } from 'geojson'

export type JoinStyle = 'round' | 'miter' | 'bevel'
export type EndCapStyle = 'round' | 'flat' | 'square'

export type BufferParams = {
  radius: number
  joinStyle: JoinStyle
  endCapStyle: EndCapStyle
  steps: number
}

type JstsNamespace = typeof jstsModule
type JstsApi = JstsNamespace['default']
const jstsNs = jstsModule as unknown as { operation?: unknown; default?: JstsNamespace }
const jsts = (jstsNs.operation ? jstsNs : jstsNs.default) as unknown as JstsApi
const { BufferOp, BufferParameters } = jsts.operation.buffer
const { GeoJSONReader, GeoJSONWriter } = jsts.io
const reader = new GeoJSONReader()
const writer = new GeoJSONWriter()

const JOIN_STYLE: Record<JoinStyle, number> = {
  round: BufferParameters.JOIN_ROUND,
  miter: BufferParameters.JOIN_MITRE,
  bevel: BufferParameters.JOIN_BEVEL
}

const CAP_STYLE: Record<EndCapStyle, number> = {
  round: BufferParameters.CAP_ROUND,
  flat: BufferParameters.CAP_FLAT,
  square: BufferParameters.CAP_SQUARE
}

type Projection = {
  project: (coords: [number, number]) => [number, number]
  invert: (coords: [number, number]) => [number, number]
}

function defineProjection(geometry: Geometry): Projection {
  const centerPoint = center(feature(geometry) as unknown as Feature).geometry.coordinates as [number, number]
  const proj = geoAzimuthalEquidistant().rotate([-centerPoint[0], -centerPoint[1]]).scale(earthRadius)
  return {
    project: (coords: [number, number]) => {
      const out = proj(coords)!
      return [out[0], out[1]]
    },
    invert: (coords: [number, number]) => {
      const out = proj.invert!(coords)!
      return [out[0], out[1]]
    }
  }
}

function projectCoords(coords: unknown, proj: Projection): unknown {
  if (typeof (coords as unknown[])[0] !== 'object') {
    return proj.project(coords as unknown as [number, number])
  }
  return (coords as unknown[]).map((c) => projectCoords(c, proj))
}

function unprojectCoords(coords: unknown, proj: Projection): unknown {
  if (typeof (coords as unknown[])[0] !== 'object') {
    return proj.invert(coords as unknown as [number, number])
  }
  return (coords as unknown[]).map((c) => unprojectCoords(c, proj))
}

function bufferGeometry(geometry: Geometry, params: BufferParams): TurfPolygon | null {
  const proj = defineProjection(geometry)
  const coordinates = (geometry as { coordinates: unknown }).coordinates
  const projected = {
    type: geometry.type,
    coordinates: projectCoords(coordinates, proj)
  }
  const geom = reader.read(projected)
  const bufParams = new BufferParameters()
  bufParams.setQuadrantSegments(Math.max(1, params.steps))
  bufParams.setJoinStyle(JOIN_STYLE[params.joinStyle])
  bufParams.setEndCapStyle(CAP_STYLE[params.endCapStyle])
  const buffered = new BufferOp(geom, bufParams).getResultGeometry(params.radius)
  const written = writer.write(buffered)
  const result: { type: string; coordinates: unknown } = {
    type: written.type,
    coordinates: unprojectCoords(written.coordinates, proj)
  }
  if (result.type === 'Polygon') {
    return { type: 'Polygon', coordinates: result.coordinates as Position[][] }
  }
  if (result.type === 'MultiPolygon') {
    const polys = result.coordinates as Position[][][]
    return { type: 'Polygon', coordinates: polys[0] }
  }
  return null
}

function toTurfPolygon(result: TurfPolygon | null): TurfPolygon | null {
  return result
}

export function pointBuffer(lng: number, lat: number, params: BufferParams): TurfPolygon | null {
  const result = bufferGeometry(point([lng, lat]).geometry, params)
  return toTurfPolygon(result)
}

export function lineBuffer(lngLats: [number, number][], params: BufferParams): TurfPolygon | null {
  if (lngLats.length < 2) return null
  const result = bufferGeometry(lineString(lngLats).geometry, params)
  return toTurfPolygon(result)
}

export function polygonBuffer(lngLats: [number, number][], params: BufferParams): TurfPolygon | null {
  if (lngLats.length < 3) return null
  const ring = closeRing(lngLats)
  const result = bufferGeometry(polygon([ring]).geometry, params)
  return toTurfPolygon(result)
}

function closeRing(lngLats: [number, number][]): [number, number][] {
  const first = lngLats[0]
  const last = lngLats[lngLats.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) return lngLats
  return [...lngLats, first]
}

export function bufferOuterRing(bufferPoly: TurfPolygon): Position[] {
  return bufferPoly.coordinates[0]
}
