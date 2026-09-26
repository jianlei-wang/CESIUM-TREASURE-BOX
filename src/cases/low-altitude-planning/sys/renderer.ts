import {
  BoundingSphere,
  BoxGeometry,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  ComponentDatatype,
  CustomDataSource,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  GeometryInstance,
  HorizontalOrigin,
  LabelCollection,
  LabelStyle,
  Material,
  Matrix4,
  PerInstanceColorAppearance,
  PointPrimitiveCollection,
  PolygonGeometry,
  PolylineCollection,
  PolylineGlowMaterialProperty,
  Primitive,
  PrimitiveType,
  StripeMaterialProperty,
  Transforms,
  VerticalOrigin,
  type Model,
  type Viewer
} from 'cesium'
import { createDroneModel, droneModelMatrix } from './drone'
import { GRID_STATE_META, rampColor } from './geosot'
import type {
  AirspaceVisibility,
  AirspaceZone,
  Device,
  ElevationModel,
  Fence,
  GridCell,
  LayerFlags,
  LonLat,
  Obstacle,
  PickPayload,
  Poi,
  RenderMode,
  RoutePlan,
  Track
} from './types'
import { circleRing, elevationAt, pointInRing } from './util'

const AIRSPACE_COLOR: Record<AirspaceZone['type'], Color> = {
  forbid: Color.fromCssColorString('#e74c3c'),
  restrict: Color.fromCssColorString('#f1c40f'),
  free: Color.fromCssColorString('#2ecc71')
}

/** 贴合地表构建体块时抬升的余量，避免与地形面片 z-fighting 或轻微下陷入地下。 */
const GROUND_LIFT = 2

/** 规划航线起点/终点使用的矢量图钉图标（内嵌 SVG，无需外部资源）。 */
function markerIcon(kind: 'start' | 'end'): string {
  const fill = kind === 'start' ? '#22d3ee' : '#f472b6'
  const stroke = kind === 'start' ? '#e6feff' : '#ffe4f0'
  const pin = `<path d="M16 1C8 1 1.5 7.6 1.5 15.6 1.5 26.2 16 43 16 43s14.5-16.8 14.5-27.4C30.5 7.6 24 1 16 1z" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>`
  const inner = '<circle cx="16" cy="15.6" r="9.6" fill="#04121f"/>'
  const glyph =
    kind === 'start'
      ? '<polygon points="12.6,10 22.2,15.6 12.6,21.2" fill="#22d3ee"/>'
      : '<rect x="11.4" y="8.2" width="1.9" height="14.6" rx="0.95" fill="#ffe4f0"/><path d="M13.3 8.7h8.6v6.2h-8.6z" fill="#ffe4f0"/><rect x="15.4" y="8.7" width="2.2" height="3.1" fill="#4a0d2b"/><rect x="19.9" y="11.8" width="2" height="3.1" fill="#4a0d2b"/>'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="44" viewBox="0 0 32 44">${pin}${inner}${glyph}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const DEVICE_COLOR: Record<Device['status'], Color> = {
  online: Color.fromCssColorString('#38bdf8'),
  offline: Color.fromCssColorString('#94a3b8'),
  fault: Color.fromCssColorString('#ef4444')
}

export type GridStyle = {
  mode: RenderMode
  opacity: number
  solid: boolean
  altMin: number
  altMax: number
  showFill: boolean
}

function cellColor(cell: GridCell, mode: RenderMode, min: number, max: number): Color {
  if (mode === 'single') return Color.fromCssColorString(GRID_STATE_META[cell.state].color)
  const span = Math.max(1, max - min)
  if (mode === 'graduated') return Color.fromCssColorString(rampColor((cell.value - min) / span))
  if (mode === 'heatmap') return Color.fromCssColorString(rampColor(cell.density))
  return Color.fromCssColorString(GRID_STATE_META[cell.state].color)
}

function cellLift(height: number): number {
  return height + 1.5
}

/** 面片与网格线之间的抬升差，避免共面导致的 z-fighting。 */
const GRID_FILL_LIFT = 2
const GRID_LINE_LIFT = 3.5

/** PolylineCollection 的 material 必须是 Material 实例，不能直接传 Color。 */
function lineMaterial(color: Color): Material {
  return Material.fromType(Material.ColorType, { color })
}

function polygonCartesians(cell: GridCell, height: number): Cartesian3[] {
  const h = cellLift(height)
  return [
    Cartesian3.fromDegrees(cell.west, cell.south, h),
    Cartesian3.fromDegrees(cell.east, cell.south, h),
    Cartesian3.fromDegrees(cell.east, cell.north, h),
    Cartesian3.fromDegrees(cell.west, cell.north, h)
  ]
}

/** 低空规划系统渲染内核：网格 / 空域 / 障碍 / 航线 / 航迹 / 设备 / POI。 */
export class SystemRenderer {
  private readonly viewer: Viewer
  private gridFill: Primitive | undefined
  private gridSolid: Primitive | undefined
  private gridLines: PolylineCollection | undefined
  private gridPoints: PointPrimitiveCollection | undefined
  private airspaceSolid: Primitive | undefined
  private airspaceOutline: PolylineCollection | undefined
  private obstacleSolid: Primitive | undefined
  private readonly routeLines: PolylineCollection
  private readonly routeMarks: PointPrimitiveCollection
  private readonly trackLines: PolylineCollection
  private readonly devicePoints: PointPrimitiveCollection
  private readonly deviceLabels: LabelCollection
  private readonly droneModels = new Map<string, Model>()
  private readonly droneLoading = new Set<string>()
  private readonly droneFailed = new Set<string>()
  private droneActiveLoads = 0
  private readonly maxDroneLoads = 3
  private deviceVisible = true
  private lastDevices: Device[] = []
  private readonly poiPoints: PointPrimitiveCollection
  private readonly poiLabels: LabelCollection
  private readonly fenceSource: CustomDataSource
  private readonly highlightLines: PolylineCollection
  private readonly draftLines: PolylineCollection
  private readonly taskSource: CustomDataSource
  private routeColor = new Map<string, Color>()
  /** 作业区地表高程模型，用于把“真高”换算为椭球高。 */
  private elevation: ElevationModel | undefined

  /** 设置地表高程模型；网格生成后需重新调用 setGrid 才会生效。 */
  setElevationModel(model: ElevationModel | undefined): void {
    this.elevation = model
  }

  /** 某点地表高程（无模型时为 0）。 */
  private groundAt(lon: number, lat: number): number {
    return elevationAt(this.elevation, lon, lat)
  }

  /** 真高 → 椭球高。 */
  private alt(height: number, lon: number, lat: number): number {
    return height + this.groundAt(lon, lat)
  }

  /** 一组点中的最高地表高程，用于保证体块整体不沉入地形。 */
  private maxGround(points: LonLat[]): number {
    let max = 0
    for (const p of points) max = Math.max(max, this.groundAt(p.lon, p.lat))
    return max
  }

  /**
   * 一组点所围区域内的最高地表高程：同时取边界点与高程模型落在该区域内的网格点，
   * 避免只采样边界/中心时遗漏区域内部的高地，导致体块底部沉入地形。
   */
  private maxGroundArea(points: LonLat[]): number {
    let max = this.maxGround(points)
    const model = this.elevation
    if (!model || points.length === 0) return max
    let west = Infinity
    let east = -Infinity
    let south = Infinity
    let north = -Infinity
    for (const p of points) {
      west = Math.min(west, p.lon)
      east = Math.max(east, p.lon)
      south = Math.min(south, p.lat)
      north = Math.max(north, p.lat)
    }
    for (let iy = 0; iy < model.ny; iy += 1) {
      const lat = model.south + (iy / (model.ny - 1)) * (model.north - model.south)
      if (lat < south || lat > north) continue
      for (let ix = 0; ix < model.nx; ix += 1) {
        const lon = model.west + (ix / (model.nx - 1)) * (model.east - model.west)
        if (lon < west || lon > east) continue
        const h = model.heights[iy * model.nx + ix]
        if (Number.isFinite(h)) max = Math.max(max, h)
      }
    }
    return max
  }

  /**
   * 区域内地表最低高程（再下探一个余量），作为立体要素的底平面。
   * 让底平面落在所有地形之下，体块侧壁自然插入地形，避免悬空缝隙或被地形“吞没”的观感。
   */
  private terrainFloor(): number {
    const model = this.elevation
    if (!model) return -GROUND_LIFT
    let min = Infinity
    for (const h of model.heights) {
      if (Number.isFinite(h)) min = Math.min(min, h)
    }
    return (Number.isFinite(min) ? min : 0) - GROUND_LIFT
  }

  /**
   * 构建贴合地形的空域体网格：顶面与侧壁均按各顶点真实地表高程 + 规定真高生成，
   * 使体块随地形起伏，既不会悬空也不会没入地表。
   */
  private buildZoneVolume(ring: LonLat[], height: number, circle?: { center: LonLat; radius: number }): Geometry {
    const positions: number[] = []
    const indices: number[] = []
    const addVertex = (lon: number, lat: number, above: number): number => {
      const c = Cartesian3.fromDegrees(lon, lat, this.groundAt(lon, lat) + above)
      positions.push(c.x, c.y, c.z)
      return positions.length / 3 - 1
    }
    // 顶面
    if (circle) {
      const na = 72
      const nr = 12
      const row = na + 1
      for (let i = 0; i <= nr; i += 1) {
        const r = (circle.radius * i) / nr
        const points = r === 0 ? Array.from({ length: row }, () => circle.center) : circleRing(circle.center, r, na)
        for (const p of points) addVertex(p.lon, p.lat, height)
      }
      for (let i = 0; i < nr; i += 1) {
        for (let j = 0; j < na; j += 1) {
          const a0 = i * row + j
          const a1 = a0 + 1
          const b0 = (i + 1) * row + j
          const b1 = b0 + 1
          indices.push(a0, a1, b1, a0, b1, b0)
        }
      }
    } else {
      let west = Infinity
      let east = -Infinity
      let south = Infinity
      let north = -Infinity
      for (const p of ring) {
        west = Math.min(west, p.lon)
        east = Math.max(east, p.lon)
        south = Math.min(south, p.lat)
        north = Math.max(north, p.lat)
      }
      const spanLon = Math.max(1e-6, east - west)
      const spanLat = Math.max(1e-6, north - south)
      const nx = Math.max(1, Math.min(80, Math.round(spanLon / 0.0012)))
      const ny = Math.max(1, Math.min(80, Math.round(spanLat / 0.0012)))
      const grid: number[][] = []
      for (let iy = 0; iy <= ny; iy += 1) {
        grid[iy] = []
        const lat = south + (iy / ny) * spanLat
        for (let ix = 0; ix <= nx; ix += 1) {
          grid[iy][ix] = addVertex(west + (ix / nx) * spanLon, lat, height)
        }
      }
      for (let iy = 0; iy < ny; iy += 1) {
        for (let ix = 0; ix < nx; ix += 1) {
          const clon = west + ((ix + 0.5) / nx) * spanLon
          const clat = south + ((iy + 0.5) / ny) * spanLat
          if (!pointInRing({ lon: clon, lat: clat }, ring)) continue
          const v00 = grid[iy][ix]
          const v10 = grid[iy][ix + 1]
          const v11 = grid[iy + 1][ix + 1]
          const v01 = grid[iy + 1][ix]
          indices.push(v00, v10, v11, v00, v11, v01)
        }
      }
    }
    // 侧壁
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      if (a.lon === b.lon && a.lat === b.lat) continue
      const b0 = addVertex(a.lon, a.lat, 0)
      const b1 = addVertex(b.lon, b.lat, 0)
      const t1 = addVertex(b.lon, b.lat, height)
      const t0 = addVertex(a.lon, a.lat, height)
      indices.push(b0, b1, t1, b0, t1, t0)
    }
    const values = new Float64Array(positions)
    const attributes = new GeometryAttributes()
    attributes.position = new GeometryAttribute({
      componentDatatype: ComponentDatatype.DOUBLE,
      componentsPerAttribute: 3,
      values
    })
    return new Geometry({
      attributes,
      indices: new Uint32Array(indices),
      primitiveType: PrimitiveType.TRIANGLES,
      boundingSphere: BoundingSphere.fromVertices(values)
    })
  }

  constructor(viewer: Viewer) {
    this.viewer = viewer
    this.routeLines = new PolylineCollection()
    this.routeMarks = new PointPrimitiveCollection()
    this.trackLines = new PolylineCollection()
    this.devicePoints = new PointPrimitiveCollection()
    this.deviceLabels = new LabelCollection()
    this.poiPoints = new PointPrimitiveCollection()
    this.poiLabels = new LabelCollection()
    this.fenceSource = new CustomDataSource('lap-fence')
    this.highlightLines = new PolylineCollection()
    this.draftLines = new PolylineCollection()
    this.taskSource = new CustomDataSource('lap-task')
    const primitives = viewer.scene.primitives
    primitives.add(this.draftLines)
    primitives.add(this.trackLines)
    primitives.add(this.routeLines)
    primitives.add(this.routeMarks)
    primitives.add(this.poiPoints)
    primitives.add(this.poiLabels)
    primitives.add(this.devicePoints)
    primitives.add(this.deviceLabels)
    primitives.add(this.highlightLines)
    void viewer.dataSources.add(this.fenceSource)
    void viewer.dataSources.add(this.taskSource)
  }

  private removePrimitive(current: Primitive | undefined): undefined {
    if (current && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(current)
    }
    return undefined
  }

  private removeCollection(
    current: PolylineCollection | PointPrimitiveCollection | undefined
  ): undefined {
    if (current && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(current)
    }
    return undefined
  }

  clearGrid(): void {
    this.gridFill = this.removePrimitive(this.gridFill)
    this.gridSolid = this.removePrimitive(this.gridSolid)
    this.gridLines = this.removeCollection(this.gridLines)
    this.gridPoints = this.removeCollection(this.gridPoints)
  }

  setGrid(cells: GridCell[], style: GridStyle): void {
    this.clearGrid()
    if (!cells.length || this.viewer.isDestroyed()) return
    const values = cells.map((c) => c.value)
    const min = Math.min(...values)
    const max = Math.max(...values)

    if (style.mode === 'pointCloud') {
      this.gridPoints = new PointPrimitiveCollection()
      for (const cell of cells) {
        this.gridPoints.add({
          position: Cartesian3.fromDegrees(
            cell.centerLon,
            cell.centerLat,
            this.alt(cellLift(style.altMin), cell.centerLon, cell.centerLat)
          ),
          color: Color.fromCssColorString(rampColor(cell.density)).withAlpha(0.9),
          pixelSize: 3 + cell.value / 60,
          id: { kind: 'grid', cell } satisfies PickPayload
        })
      }
      this.viewer.scene.primitives.add(this.gridPoints)
      return
    }

    const lineColorFor = (cell: GridCell) =>
      cellColor(cell, style.mode, min, max).withAlpha(Math.max(0.35, style.opacity))

    if (style.solid) {
      const instances: GeometryInstance[] = []
      for (const cell of cells) {
        const width = (cell.east - cell.west) * 111320 * Math.cos((cell.centerLat * Math.PI) / 180)
        const depth = (cell.north - cell.south) * 111320
        const height = Math.max(20, (cell.altMax - cell.altMin) || 60)
        const box = new BoxGeometry({
          minimum: new Cartesian3(-width / 2, -depth / 2, -height / 2),
          maximum: new Cartesian3(width / 2, depth / 2, height / 2),
          vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT
        })
        instances.push(
          new GeometryInstance({
            geometry: box,
            modelMatrix: Transforms.eastNorthUpToFixedFrame(
              Cartesian3.fromDegrees(cell.centerLon, cell.centerLat, this.alt(cell.altMin + height / 2, cell.centerLon, cell.centerLat))
            ),
            attributes: {
              color: ColorGeometryInstanceAttribute.fromColor(
                cellColor(cell, style.mode, min, max).withAlpha(style.opacity * 0.55)
              )
            },
            id: { kind: 'grid', cell } satisfies PickPayload
          })
        )
      }
      this.gridSolid = new Primitive({
        geometryInstances: instances,
        appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
        asynchronous: false
      })
      this.viewer.scene.primitives.add(this.gridSolid)
      return
    }

    if (style.showFill) {
      const instances: GeometryInstance[] = []
      for (const cell of cells) {
        instances.push(
          new GeometryInstance({
            geometry: PolygonGeometry.fromPositions({
              positions: polygonCartesians(cell, 0),
              height: this.alt(style.altMin + GRID_FILL_LIFT, cell.centerLon, cell.centerLat),
              vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT
            }),
            attributes: {
              color: ColorGeometryInstanceAttribute.fromColor(
                cellColor(cell, style.mode, min, max).withAlpha(style.opacity * 0.42)
              )
            },
            id: { kind: 'grid', cell } satisfies PickPayload
          })
        )
      }
      this.gridFill = new Primitive({
        geometryInstances: instances,
        appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
        asynchronous: false
      })
      this.viewer.scene.primitives.add(this.gridFill)
    }

    // 网格线按“唯一边”绘制：共享边只提交一次，避免相邻单元共面线重叠闪烁。
    this.gridLines = new PolylineCollection()
    const emitted = new Set<string>()
    for (const cell of cells) {
      const corners: LonLat[] = [
        { lon: cell.west, lat: cell.south },
        { lon: cell.east, lat: cell.south },
        { lon: cell.east, lat: cell.north },
        { lon: cell.west, lat: cell.north }
      ]
      for (let i = 0; i < 4; i += 1) {
        const a = corners[i]
        const b = corners[(i + 1) % 4]
        const ka = `${a.lon.toFixed(7)},${a.lat.toFixed(7)}`
        const kb = `${b.lon.toFixed(7)},${b.lat.toFixed(7)}`
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
        if (emitted.has(key)) continue
        emitted.add(key)
        const lineHeight = this.alt(
          style.altMin + GRID_LINE_LIFT,
          (a.lon + b.lon) / 2,
          (a.lat + b.lat) / 2
        )
        this.gridLines.add({
          positions: [
            Cartesian3.fromDegrees(a.lon, a.lat, lineHeight),
            Cartesian3.fromDegrees(b.lon, b.lat, lineHeight)
          ],
          width: 1,
          material: lineMaterial(lineColorFor(cell)),
          id: { kind: 'grid', cell } satisfies PickPayload
        })
      }
    }
    this.viewer.scene.primitives.add(this.gridLines)
  }

  setAirspaces(zones: AirspaceZone[], visible: AirspaceVisibility): void {
    this.airspaceSolid = this.removePrimitive(this.airspaceSolid)
    this.airspaceOutline = this.removeCollection(this.airspaceOutline)
    if (this.viewer.isDestroyed()) return
    const instances: GeometryInstance[] = []
    const outlines = new PolylineCollection()
    for (const zone of zones) {
      if (!zone.active || !visible[zone.type]) continue
      const color = AIRSPACE_COLOR[zone.type]
      const altMax = Math.max(10, zone.altMax)
      const circle = zone.shape === 'circle' ? { center: zone.center, radius: zone.radius } : undefined
      const ring = circle ? circleRing(zone.center, zone.radius, 72) : zone.ring
      if (ring.length < 3) continue
      instances.push(
        new GeometryInstance({
          geometry: this.buildZoneVolume(ring, altMax, circle),
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(color.withAlpha(0.28))
          },
          id: { kind: 'airspace', zone } satisfies PickPayload
        })
      )
      // 顶/底轮廓与立柱均按实际地表高程贴合，避免出现悬空或没入地下的观感。
      const topRing = ring.map((p) =>
        Cartesian3.fromDegrees(p.lon, p.lat, this.groundAt(p.lon, p.lat) + altMax)
      )
      const baseRing = ring.map((p) => Cartesian3.fromDegrees(p.lon, p.lat, this.groundAt(p.lon, p.lat)))
      outlines.add({
        positions: [...topRing, topRing[0]],
        width: 2,
        material: lineMaterial(color),
        id: { kind: 'airspace', zone }
      })
      outlines.add({ positions: [...baseRing, baseRing[0]], width: 1, material: lineMaterial(color.withAlpha(0.5)) })
      const step = Math.max(1, Math.floor(ring.length / 24))
      for (let i = 0; i < ring.length; i += step) {
        outlines.add({ positions: [baseRing[i], topRing[i]], width: 1, material: lineMaterial(color.withAlpha(0.5)) })
      }
    }
    if (instances.length) {
      this.airspaceSolid = new Primitive({
        geometryInstances: instances,
        appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
        asynchronous: false
      })
      this.viewer.scene.primitives.add(this.airspaceSolid)
    }
    this.airspaceOutline = outlines
    this.viewer.scene.primitives.add(outlines)
  }

  setObstacles(obstacles: Obstacle[], visible: boolean): void {
    this.obstacleSolid = this.removePrimitive(this.obstacleSolid)
    if (!visible || !obstacles.length || this.viewer.isDestroyed()) return
    const instances: GeometryInstance[] = []
    for (const ob of obstacles) {
      const width = (ob.east - ob.west) * 111320 * Math.cos((ob.center.lat * Math.PI) / 180)
      const depth = (ob.north - ob.south) * 111320
      const corners = [
        { lon: ob.west, lat: ob.south },
        { lon: ob.east, lat: ob.south },
        { lon: ob.west, lat: ob.north },
        { lon: ob.east, lat: ob.north }
      ]
      const base = this.maxGroundArea(corners) + GROUND_LIFT
      instances.push(
        new GeometryInstance({
          geometry: BoxGeometry.fromDimensions({
            dimensions: new Cartesian3(Math.max(6, width), Math.max(6, depth), ob.height),
            vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT
          }),
          modelMatrix: Transforms.eastNorthUpToFixedFrame(
            Cartesian3.fromDegrees(ob.center.lon, ob.center.lat, base + ob.height / 2)
          ),
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(
              Color.fromCssColorString(ob.kind === 'tower' ? '#7f8ea3' : '#9aa8b8').withAlpha(0.88)
            )
          },
          id: { kind: 'obstacle', obstacle: ob } satisfies PickPayload
        })
      )
    }
    this.obstacleSolid = new Primitive({
      geometryInstances: instances,
      appearance: new PerInstanceColorAppearance({ flat: true }),
      asynchronous: false
    })
    this.viewer.scene.primitives.add(this.obstacleSolid)
  }

  setRoutes(routes: RoutePlan[], visible: boolean, selectedId?: string): void {
    this.routeLines.removeAll()
    this.routeMarks.removeAll()
    this.routeColor.clear()
    if (!visible) return
    for (const route of routes) {
      const isSelected = route.id === selectedId || route.status === 'selected'
      const color = Color.fromCssColorString(route.color)
      this.routeColor.set(route.id, color)
      const positions = route.points.map((p) => Cartesian3.fromDegrees(p.lon, p.lat, this.alt(Math.max(6, p.alt), p.lon, p.lat)))
      if (positions.length > 1) {
        this.routeLines.add({
          positions,
          width: isSelected ? 5 : 2.4,
          material: lineMaterial(isSelected ? color : color.withAlpha(0.6)),
          id: { kind: 'route', route } satisfies PickPayload
        })
      }
      for (const point of route.points) {
        this.routeMarks.add({
          position: Cartesian3.fromDegrees(point.lon, point.lat, this.alt(Math.max(6, point.alt), point.lon, point.lat)),
          color: isSelected ? Color.WHITE : color.withAlpha(0.85),
          pixelSize: isSelected ? 7 : 5
        })
      }
    }
  }

  setTracks(tracks: Track[], visible: boolean, progress?: Map<string, number>): void {
    this.trackLines.removeAll()
    if (!visible) return
    for (const track of tracks) {
      const ratio = progress?.get(track.deviceNo) ?? 1
      const count = Math.max(2, Math.floor(track.points.length * Math.min(1, Math.max(0.02, ratio))))
      const slice = track.points.slice(0, count)
      const positions = slice.map((p) => Cartesian3.fromDegrees(p.lon, p.lat, this.alt(Math.max(4, p.alt), p.lon, p.lat)))
      if (positions.length > 1) {
        this.trackLines.add({
          positions,
          width: 2.2,
          material: lineMaterial(Color.fromCssColorString(track.color).withAlpha(0.85))
        })
      }
    }
  }

  setDevices(devices: Device[], visible: boolean): void {
    this.deviceVisible = visible
    this.lastDevices = devices
    this.devicePoints.removeAll()
    this.deviceLabels.removeAll()
    if (this.viewer.isDestroyed()) return
    const ids = new Set(devices.map((d) => d.id))
    for (const [id, model] of this.droneModels) {
      if (!ids.has(id)) {
        this.viewer.scene.primitives.remove(model)
        this.droneModels.delete(id)
      }
    }
    for (const device of devices) {
      const model = this.droneModels.get(device.id)
      const position = Cartesian3.fromDegrees(device.lon, device.lat, this.alt(device.alt, device.lon, device.lat))
      if (model) {
        model.show = visible
        model.modelMatrix = droneModelMatrix(position, device.heading)
      }
      if (!visible) continue
      this.devicePoints.add({
        position,
        color: DEVICE_COLOR[device.status],
        pixelSize: device.status === 'online' ? 9 : 7,
        outlineColor: Color.WHITE.withAlpha(0.85),
        outlineWidth: 1.5,
        show: !model,
        id: { kind: 'device', device } satisfies PickPayload
      })
      this.deviceLabels.add({
        position: Cartesian3.fromDegrees(device.lon, device.lat, this.alt(device.alt + 26, device.lon, device.lat)),
        text: device.no,
        font: '11px sans-serif',
        fillColor: Color.fromCssColorString('#dbeafe'),
        outlineColor: Color.fromCssColorString('#0b1d30'),
        outlineWidth: 2,
        style: LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -6),
        scale: 0.9,
        show: !model
      })
      if (
        !model &&
        !this.droneLoading.has(device.id) &&
        !this.droneFailed.has(device.id) &&
        this.droneActiveLoads < this.maxDroneLoads
      ) {
        this.droneLoading.add(device.id)
        this.droneActiveLoads += 1
        void createDroneModel({
          position,
          heading: device.heading,
          minimumPixelSize: 44,
          id: { kind: 'device', device } satisfies PickPayload
        })
          .then((created) => {
            this.droneLoading.delete(device.id)
            this.droneActiveLoads -= 1
            if (this.viewer.isDestroyed()) {
              created.destroy()
              return
            }
            created.show = this.deviceVisible
            this.viewer.scene.primitives.add(created)
            this.droneModels.set(device.id, created)
            this.setDevices(this.lastDevices, this.deviceVisible)
          })
          .catch((error) => {
            this.droneLoading.delete(device.id)
            this.droneActiveLoads -= 1
            this.droneFailed.add(device.id)
            console.warn('[lap] 无人机模型加载失败，已回退为点标记:', device.id, error)
            if (!this.viewer.isDestroyed()) this.setDevices(this.lastDevices, this.deviceVisible)
          })
      }
    }
  }

  setPoi(pois: Poi[], visible: boolean): void {
    this.poiPoints.removeAll()
    this.poiLabels.removeAll()
    if (!visible) return
    for (const poi of pois) {
      this.poiPoints.add({
        position: Cartesian3.fromDegrees(poi.lon, poi.lat, this.alt(4, poi.lon, poi.lat)),
        color: Color.fromCssColorString('#facc15'),
        pixelSize: 8,
        outlineColor: Color.fromCssColorString('#0b1d30'),
        outlineWidth: 1.5
      })
      this.poiLabels.add({
        position: Cartesian3.fromDegrees(poi.lon, poi.lat, this.alt(4, poi.lon, poi.lat)),
        text: poi.name,
        font: '11px sans-serif',
        fillColor: Color.fromCssColorString('#fde68a'),
        outlineColor: Color.fromCssColorString('#0b1d30'),
        outlineWidth: 2,
        style: LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: HorizontalOrigin.LEFT,
        verticalOrigin: VerticalOrigin.CENTER,
        pixelOffset: new Cartesian2(10, 0),
        scale: 0.9
      })
    }
  }

  /** 电子围栏：动态立体墙 + 发光顶边，条纹沿水平方向流动。 */
  setFences(fences: Fence[], visible: boolean): void {
    this.fenceSource.show = visible
    this.fenceSource.entities.removeAll()
    if (!visible || this.viewer.isDestroyed()) return
    for (const fence of fences) {
      if (fence.ring.length < 2) continue
      const floor = this.terrainFloor()
      const wallTop = this.maxGroundArea(fence.ring) + Math.max(80, fence.alt + 140)
      const positions = fence.ring.map((p) => Cartesian3.fromDegrees(p.lon, p.lat, floor))
      const topPositions = fence.ring.map((p) => Cartesian3.fromDegrees(p.lon, p.lat, wallTop))
      const color = Color.fromCssColorString(fence.color)
      // 使用真实时间驱动条纹流动，避免依赖 Cesium Clock（暂停时也能持续动画）。
      const offsetProperty = new CallbackProperty(() => (performance.now() % 4000) / 4000, false)
      this.fenceSource.entities.add({
        id: fence.id,
        name: fence.name,
        wall: {
          positions,
          minimumHeights: positions.map(() => floor),
          maximumHeights: positions.map(() => wallTop),
          material: new StripeMaterialProperty({
            evenColor: color.withAlpha(0.42),
            oddColor: color.withAlpha(0.04),
            repeat: 6,
            offset: offsetProperty
          })
        },
        polyline: {
          positions: [...topPositions, topPositions[0]],
          width: 2.6,
          clampToGround: false,
          material: new PolylineGlowMaterialProperty({
            glowPower: 0.24,
            color: color.withAlpha(0.95)
          })
        }
      })
    }
  }

  setHighlight(ring: Array<{ lon: number; lat: number }>, alt: number, color = '#38bdf8'): void {
    this.highlightLines.removeAll()
    if (ring.length < 2) return
    const positions = ring.map((p) => Cartesian3.fromDegrees(p.lon, p.lat, this.alt(Math.max(6, alt), p.lon, p.lat)))
    this.highlightLines.add({
      positions: [...positions, positions[0]],
      width: 3,
      material: lineMaterial(Color.fromCssColorString(color).withAlpha(0.95))
    })
  }

  setDraft(points: Array<{ lon: number; lat: number; alt?: number }>): void {
    this.draftLines.removeAll()
    if (points.length < 2) return
    this.draftLines.add({
      positions: points.map((p) =>
        Cartesian3.fromDegrees(p.lon, p.lat, this.alt(Math.max(6, p.alt ?? 60), p.lon, p.lat))
      ),
      width: 2.4,
      material: lineMaterial(Color.fromCssColorString('#f472b6').withAlpha(0.95))
    })
  }

  setTaskPoints(start: LonLat | undefined, end: LonLat | undefined, alt = 60): void {
    this.taskSource.entities.removeAll()
    if (this.viewer.isDestroyed()) return
    // 屏幕空间上下跳动（与 Cesium Clock 无关），起点/终点错开相位。
    const bounce = (phase: number): number => {
      const t = ((performance.now() + phase) % 1400) / 1400
      return Math.abs(Math.sin(Math.PI * t)) * 10
    }
    const add = (point: LonLat, kind: 'start' | 'end', label: string, phase: number) => {
      const position = Cartesian3.fromDegrees(
        point.lon,
        point.lat,
        this.alt(Math.max(4, alt), point.lon, point.lat)
      )
      this.taskSource.entities.add({
        position,
        billboard: {
          image: markerIcon(kind),
          width: 32,
          height: 44,
          verticalOrigin: VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          pixelOffset: new CallbackProperty(() => new Cartesian2(0, -bounce(phase)), false)
        },
        label: {
          text: label,
          font: '600 13px sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.fromCssColorString('#0b1d30'),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new CallbackProperty(() => new Cartesian2(0, -50 - bounce(phase)), false),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      })
    }
    if (start) add(start, 'start', '起点', 0)
    if (end) add(end, 'end', '终点', 700)
  }

  setLayers(flags: LayerFlags): void {
    if (this.gridFill) this.gridFill.show = flags.grid
    if (this.gridSolid) this.gridSolid.show = flags.grid
    if (this.gridLines) this.gridLines.show = flags.grid
    if (this.gridPoints) this.gridPoints.show = flags.grid
    const airspaceVisible = flags.forbid || flags.restrict || flags.free
    if (this.airspaceSolid) this.airspaceSolid.show = airspaceVisible
    if (this.airspaceOutline) this.airspaceOutline.show = airspaceVisible
    if (this.obstacleSolid) this.obstacleSolid.show = flags.obstacle
    this.routeLines.show = flags.route
    this.routeMarks.show = flags.route
    this.trackLines.show = flags.track
    this.devicePoints.show = flags.device
    this.deviceLabels.show = flags.device
    for (const model of this.droneModels.values()) model.show = flags.device
    this.poiPoints.show = flags.poi
    this.poiLabels.show = flags.poi
    this.fenceSource.show = flags.fence
    this.taskSource.show = flags.route
  }

  destroy(): void {
    if (this.viewer.isDestroyed()) return
  }
}
