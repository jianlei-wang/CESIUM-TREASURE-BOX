/**
 * 矢量瓦片渲染：z/x/y → 瓦片范围 → 要素裁剪 → MVT 坐标 → PBF → Cesium Primitive。
 */
import { Cartesian3, Color, PolygonHierarchy, type CustomDataSource } from 'cesium'
import type { GeoFeature } from '../data/loaders'
import { addPolyline } from '../render'
import { ramp } from '../palettes'
import type { MvtGeometryInput } from '../data/parsers/mvt'
import type { Bounds } from '../data/loaders'

export type TileCoord = { z: number; x: number; y: number }

/** 经纬度 → Web Mercator 瓦片坐标。 */
export function lonLatToTile(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom
  const x = ((lon + 180) / 360) * n
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat))
  const rad = (clampedLat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
  return { x, y }
}

/** 瓦片 → 经纬度范围。 */
export function tileBounds(coord: TileCoord): Bounds {
  const n = 2 ** coord.z
  const west = (coord.x / n) * 360 - 180
  const east = ((coord.x + 1) / n) * 360 - 180
  const north = (Math.atan(Math.sinh(Math.PI * (1 - (2 * coord.y) / n))) * 180) / Math.PI
  const south = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (coord.y + 1)) / n))) * 180) / Math.PI
  return { west, south, east, north }
}

/** 经纬度 → 瓦片内像素坐标（extent 通常 4096）。 */
export function lonLatToTilePixel(lon: number, lat: number, coord: TileCoord, extent: number): [number, number] {
  const world = 2 ** coord.z
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat))
  const rad = (clampedLat * Math.PI) / 180
  const worldX = ((lon + 180) / 360) * world * extent
  const worldY = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * world * extent
  return [worldX - coord.x * extent, worldY - coord.y * extent]
}

function geometryBounds(geometry: GeoFeature['geometry']): Bounds {
  let west = Number.POSITIVE_INFINITY
  let south = Number.POSITIVE_INFINITY
  let east = Number.NEGATIVE_INFINITY
  let north = Number.NEGATIVE_INFINITY
  const visit = (coords: unknown): void => {
    if (!Array.isArray(coords)) return
    if (typeof coords[0] === 'number') {
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
  visit((geometry as { coordinates: unknown }).coordinates)
  return { west, south, east, north }
}

function intersects(a: Bounds, b: Bounds): boolean {
  return !(a.east < b.west || a.west > b.east || a.north < b.south || a.south > b.north)
}

/**
 * 要素归属瓦片：用几何包围盒中心决定该要素由哪一块瓦片负责，保证一个真实要素
 * 只被编码与渲染一次，避免同一国家在相邻瓦片里重复叠加导致「面状要素糊在一起」。
 */
function ownerTile(geometry: GeoFeature['geometry'], zoom: number): { x: number; y: number } {
  const box = geometryBounds(geometry)
  const center = lonLatToTile((box.west + box.east) / 2, (box.south + box.north) / 2, zoom)
  return { x: Math.floor(center.x), y: Math.floor(center.y) }
}

/** 把真实面要素按 z/x/y 编码为 MVT 几何（真实 PBF 生命周期）。 */
export function tileFeatures(features: GeoFeature[], coord: TileCoord, extent = 4096): MvtGeometryInput[] {
  const bounds = tileBounds(coord)
  const output: MvtGeometryInput[] = []
  for (const item of features) {
    const geometry = item.geometry
    if (!intersects(geometryBounds(geometry), bounds)) continue
    const owner = ownerTile(geometry, coord.z)
    if (owner.x !== coord.x || owner.y !== coord.y) continue
    const name = String(item.properties.name ?? '')
    if (geometry.type === 'Polygon') {
      for (const ring of geometry.coordinates) {
        output.push({
          type: 'Polygon',
          coordinates: ring.map(([lon, lat]) => lonLatToTilePixel(lon, lat, coord, extent).map(Math.round)),
          properties: { name }
        })
      }
    } else if (geometry.type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          output.push({
            type: 'Polygon',
            coordinates: ring.map(([lon, lat]) => lonLatToTilePixel(lon, lat, coord, extent).map(Math.round)),
            properties: { name }
          })
        }
      }
    } else if (geometry.type === 'Point') {
      output.push({
        type: 'Point',
        coordinates: [lonLatToTilePixel(geometry.coordinates[0], geometry.coordinates[1], coord, extent).map(Math.round)],
        properties: { name }
      })
    }
  }
  return output
}

function hashUnit(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 1000) / 1000
}

/**
 * 把解码后的 MVT 几何渲染回经纬度（贴地填充 + 描边）。
 *
 * 注意：MVT 像素坐标是 Web Mercator 投影坐标，反算纬度必须用 Mercator 逆变换
 * （atan(sinh)），否则高纬地区几何会被线性拉伸，边界看起来像随意面状要素。
 */
export function renderTileGeometry(
  dataSource: CustomDataSource,
  geometries: MvtGeometryInput[],
  coord: TileCoord,
  extent: number,
  palette = 'viridis'
): number {
  const n = 2 ** coord.z
  const toLon = (px: number): number => ((coord.x * extent + px) / (n * extent)) * 360 - 180
  const toLat = (py: number): number => {
    const worldY = (coord.y * extent + py) / (n * extent)
    return (Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY))) * 180) / Math.PI
  }
  let count = 0
  for (const geometry of geometries) {
    const points = geometry.coordinates.map(([px, py]) => [toLon(px), toLat(py)] as [number, number])
    if (geometry.type === 'Polygon' && points.length >= 3) {
      const name = String(geometry.properties?.name ?? '')
      const fill = Color.fromCssColorString(ramp(palette, 0.2 + 0.6 * hashUnit(name))).withAlpha(0.5)
      dataSource.entities.add({
        polygon: {
          hierarchy: new PolygonHierarchy(points.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat))),
          material: fill,
          outline: true,
          outlineColor: Color.fromCssColorString('#e2e8f0').withAlpha(0.85)
        }
      })
      addPolyline(dataSource, points, { color: '#f8fafc', width: 1.3, alpha: 0.8, height: 500 })
      count += 1
    } else if (geometry.type === 'LineString' && points.length >= 2) {
      addPolyline(dataSource, points, { color: ramp(palette, 0.5), width: 2, alpha: 0.8, height: 500 })
      count += 1
    }
  }
  return count
}
