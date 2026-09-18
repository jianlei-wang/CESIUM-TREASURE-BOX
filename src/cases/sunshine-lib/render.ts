/**
 * 日照分析三维渲染：建筑白模、地面日照色斑、日照等值线、太阳轨迹与太阳指示。
 */

import * as Cesium from 'cesium'
import type { CityModel } from './city'
import { localToLonLat } from './city'
import type { SunGrid } from './analysis'
import { gridNodeLocal } from './analysis'

/** 日照时数色带：红（少）→ 橙 → 黄 → 浅绿 → 绿（多） */
const SUNSHINE_STOPS: [number, number, number][] = [
  [178, 24, 43],
  [239, 138, 44],
  [253, 219, 106],
  [166, 217, 106],
  [26, 152, 80]
]

export function sunshineRgb(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t))
  const scaled = clamped * (SUNSHINE_STOPS.length - 1)
  const index = Math.min(SUNSHINE_STOPS.length - 2, Math.floor(scaled))
  const local = scaled - index
  const from = SUNSHINE_STOPS[index]
  const to = SUNSHINE_STOPS[index + 1]
  return [
    Math.round(from[0] + (to[0] - from[0]) * local),
    Math.round(from[1] + (to[1] - from[1]) * local),
    Math.round(from[2] + (to[2] - from[2]) * local)
  ]
}

export function sunshineGradientCss(): string {
  return `linear-gradient(90deg, ${SUNSHINE_STOPS.map((rgb) => `rgb(${rgb.join(',')})`).join(', ')})`
}

/** 阴影率色带：绿（少阴影）→ 黄 → 红（多阴影），即日照色带的反向 */
export function shadowRgb(t: number): [number, number, number] {
  return sunshineRgb(1 - t)
}

export function shadowGradientCss(): string {
  return `linear-gradient(90deg, ${[...SUNSHINE_STOPS].reverse().map((rgb) => `rgb(${rgb.join(',')})`).join(', ')})`
}

const BUILDING_LOW = [206, 216, 228] as const
const BUILDING_HIGH = [64, 106, 176] as const

function buildingColor(topHeight: number, alpha: number): Cesium.Color {
  const t = Math.max(0, Math.min(1, topHeight / 170))
  const r = Math.round(BUILDING_LOW[0] + (BUILDING_HIGH[0] - BUILDING_LOW[0]) * t)
  const g = Math.round(BUILDING_LOW[1] + (BUILDING_HIGH[1] - BUILDING_LOW[1]) * t)
  const b = Math.round(BUILDING_LOW[2] + (BUILDING_HIGH[2] - BUILDING_LOW[2]) * t)
  return Cesium.Color.fromBytes(r, g, b, Math.round(alpha * 255))
}

export function buildingHeightCss(): string {
  return 'linear-gradient(90deg, rgb(206,216,228), rgb(64,106,176))'
}

/** 生成建筑白模实体（拉伸多边形） */
export function renderBuildings(
  viewer: Cesium.Viewer,
  city: CityModel,
  opacity = 1,
  shadowMode?: Cesium.ShadowMode
): Cesium.Entity[] {
  const entities: Cesium.Entity[] = []
  for (const building of city.buildings) {
    const positions = Cesium.Cartesian3.fromDegreesArray([
      building.west, building.south,
      building.east, building.south,
      building.east, building.north,
      building.west, building.north
    ])
    const entity = viewer.entities.add({
      id: `sunshine-building-${building.id}`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        height: building.baseHeight,
        extrudedHeight: building.topHeight,
        material: buildingColor(building.topHeight, opacity),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#0b1c33').withAlpha(0.5),
        closeTop: true,
        closeBottom: false,
        ...(shadowMode !== undefined ? { shadows: shadowMode } : {})
      },
      properties: {
        buildingId: building.id,
        buildingName: building.name,
        buildingHeight: building.topHeight
      }
    })
    entities.push(entity)
  }
  return entities
}

/** 更新建筑白模透明度 */
export function updateBuildingOpacity(entities: Cesium.Entity[], city: CityModel, opacity: number): void {
  for (const entity of entities) {
    const buildingId = entity.properties?.buildingId?.getValue(Cesium.JulianDate.now()) as string | undefined
    const building = city.buildings.find((item) => item.id === buildingId)
    if (!building || !entity.polygon) continue
    entity.polygon.material = new Cesium.ColorMaterialProperty(buildingColor(building.topHeight, opacity))
  }
}

/** 局部 ENU 米坐标 → 世界坐标（地平高度为 z） */
export function localToCartesian(city: CityModel, x: number, y: number, z: number): Cesium.Cartesian3 {
  const { lon, lat } = localToLonLat(city, x, y)
  return Cesium.Cartesian3.fromDegrees(lon, lat, z)
}

/** 太阳在场景中的世界坐标（沿太阳方向距离场景中心 radius 米） */
export function sunWorldPosition(
  city: CityModel,
  direction: { east: number; north: number; up: number },
  radius: number,
  groundHeight: number
): Cesium.Cartesian3 {
  return localToCartesian(city, direction.east * radius, direction.north * radius, groundHeight + direction.up * radius)
}

/** 创建场景中心参考点（用于太阳轨迹与光线的位置基准） */
export function createSceneCenterMarker(
  viewer: Cesium.Viewer,
  position: Cesium.Cartesian3,
  label: string
): Cesium.Entity {
  return viewer.entities.add({
    position,
    point: {
      pixelSize: 7,
      color: Cesium.Color.fromCssColorString('#ffd666'),
      outlineColor: Cesium.Color.fromCssColorString('#5b4b12'),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: label,
      font: '12px sans-serif',
      fillColor: Cesium.Color.fromCssColorString('#ffe9a8'),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('#0a1c33').withAlpha(0.7),
      pixelOffset: new Cesium.Cartesian2(0, -18),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })
}

export type SunPathResult = {
  /** 地平线以上的太阳轨迹点 */
  daytime: Cesium.Cartesian3[]
  /** 完整轨迹（含地平线以下，虚线展示） */
  full: Cesium.Cartesian3[]
  sunrise: number | null
  sunset: number | null
}

/** 绘制当日的太阳轨迹（局部 ENU 圆顶弧线） */
export function buildSunPath(
  city: CityModel,
  ctx: { computeAt: (minutes: number) => { altitude: number; direction: { east: number; north: number; up: number } } },
  radius: number,
  groundHeight: number
): SunPathResult {
  const daytime: Cesium.Cartesian3[] = []
  const full: Cesium.Cartesian3[] = []
  let sunrise: number | null = null
  let sunset: number | null = null
  for (let minutes = 0; minutes <= 1440; minutes += 10) {
    const sun = ctx.computeAt(minutes)
    const point = sunWorldPosition(city, sun.direction, radius, groundHeight)
    full.push(point)
    if (sun.altitude > 0) {
      daytime.push(point)
      if (sunrise === null) sunrise = minutes
      sunset = minutes
    }
  }
  return { daytime, full, sunrise, sunset }
}

/** 生成当日太阳轨迹实体（含地平线以上实线与地平线以下虚线） */
export function renderSunPath(
  viewer: Cesium.Viewer,
  path: SunPathResult
): Cesium.Entity[] {
  const entities: Cesium.Entity[] = []
  if (path.daytime.length >= 2) {
    entities.push(
      viewer.entities.add({
        id: 'sunshine-sunpath-day',
        polyline: {
          positions: path.daytime,
          width: 2,
          material: new Cesium.PolylineGlowMaterialProperty({
            color: Cesium.Color.fromCssColorString('#ffcc55').withAlpha(0.85),
            glowPower: 0.18
          }),
          arcType: Cesium.ArcType.NONE
        }
      })
    )
  }
  if (path.full.length >= 2) {
    entities.push(
      viewer.entities.add({
        id: 'sunshine-sunpath-night',
        polyline: {
          positions: path.full,
          width: 1,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString('#5f7ea6').withAlpha(0.55),
            dashLength: 12
          }),
          arcType: Cesium.ArcType.NONE
        }
      })
    )
  }
  return entities
}

/** 创建 / 更新太阳指示（发光点 + 标签） */
export function createSunIndicator(viewer: Cesium.Viewer): Cesium.Entity {
  return viewer.entities.add({
    id: 'sunshine-sun-indicator',
    position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
    billboard: {
      image: makeSunCanvas(),
      scale: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: '',
      font: '12px sans-serif',
      fillColor: Cesium.Color.fromCssColorString('#fff4c2'),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('#3a2c05').withAlpha(0.75),
      pixelOffset: new Cesium.Cartesian2(0, -26),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM
    }
  })
}

function makeSunCanvas(): HTMLCanvasElement {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(255,255,240,1)')
    gradient.addColorStop(0.35, 'rgba(255,214,102,0.95)')
    gradient.addColorStop(0.7, 'rgba(255,170,60,0.35)')
    gradient.addColorStop(1, 'rgba(255,160,40,0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
    ctx.fill()
  }
  return canvas
}

/** 地面日照色斑：按节点日照时数着色的平面三角网格 */
export function buildGridSurface(
  city: CityModel,
  grid: SunGrid,
  opacity: number,
  groundHeight: number,
  minValue: number,
  maxValue: number,
  rgbFn: (t: number) => [number, number, number] = sunshineRgb
): Cesium.Geometry {
  const range = Math.max(1e-6, maxValue - minValue)
  const alphaByte = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
  const cellRows = grid.ny - 1
  const cellCols = grid.nx - 1
  const vertexCount = cellRows * cellCols * 6
  const positions = new Float64Array(vertexCount * 3)
  const colors = new Uint8Array(vertexCount * 4)

  const nodeIndex = (row: number, col: number): number => row * grid.nx + col

  const pushNode = (offset: number, row: number, col: number): void => {
    const { x, y } = gridNodeLocal(grid, row, col)
    const cartesian = localToCartesian(city, x, y, groundHeight)
    positions[offset] = cartesian.x
    positions[offset + 1] = cartesian.y
    positions[offset + 2] = cartesian.z
    const value = grid.heights[nodeIndex(row, col)]
    const rgb = rgbFn((value - minValue) / range)
    const colorOffset = (offset / 3) * 4
    colors[colorOffset] = rgb[0]
    colors[colorOffset + 1] = rgb[1]
    colors[colorOffset + 2] = rgb[2]
    colors[colorOffset + 3] = alphaByte
  }

  let base = 0
  for (let row = 0; row < cellRows; row += 1) {
    for (let col = 0; col < cellCols; col += 1) {
      const corners: [number, number][] = [
        [row, col],
        [row, col + 1],
        [row + 1, col + 1],
        [row, col],
        [row + 1, col + 1],
        [row + 1, col]
      ]
      for (const [r, c] of corners) {
        pushNode(base * 3, r, c)
        base += 1
      }
    }
  }

  const attributes = new Cesium.GeometryAttributes()
  attributes.position = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positions
  })
  attributes.color = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
    componentsPerAttribute: 4,
    normalize: true,
    values: colors
  })
  return new Cesium.Geometry({
    attributes,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(positions)
  })
}

export function createGridAppearance(): Cesium.Appearance {
  return new Cesium.Appearance({
    translucent: true,
    closed: false,
    renderState: {
      depthTest: { enabled: true },
      cull: { enabled: false },
      blending: Cesium.BlendingState.ALPHA_BLEND
    },
    vertexShaderSource: `
      in vec3 position3DHigh;
      in vec3 position3DLow;
      in float batchId;
      in vec4 color;
      out vec4 v_color;
      void main()
      {
        vec4 position = czm_translateRelativeToEye(position3DHigh, position3DLow);
        v_color = color;
        gl_Position = czm_modelViewProjectionRelativeToEye * position;
      }
    `,
    fragmentShaderSource: `
      in vec4 v_color;
      void main()
      {
        out_FragColor = v_color;
      }
    `
  })
}

export type FlatContourResult = {
  levels: number[]
  byLevel: { level: number; pieces: { lon: number; lat: number }[][] }[]
}

/** 平铺于地面的等值线图元（按日照时数分级） */
export function buildFlatContourPrimitive(
  result: FlatContourResult,
  minValue: number,
  maxValue: number,
  opacity: number,
  width: number,
  groundHeight: number
): Cesium.Primitive {
  const range = Math.max(1e-6, maxValue - minValue)
  const instances: Cesium.GeometryInstance[] = []
  const vertexFormat = Cesium.PolylineColorAppearance.VERTEX_FORMAT
  const alphaByte = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
  for (const level of result.byLevel) {
    const rgb = sunshineRgb((level.level - minValue) / range)
    const color = Cesium.Color.fromBytes(
      Math.round(rgb[0] * 0.45),
      Math.round(rgb[1] * 0.45),
      Math.round(rgb[2] * 0.45),
      alphaByte
    )
    for (const piece of level.pieces) {
      if (piece.length < 2) continue
      const flat: number[] = []
      for (const point of piece) {
        flat.push(point.lon, point.lat, groundHeight)
      }
      instances.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat),
            width: Math.max(1, Math.round(width)),
            vertexFormat,
            colors: piece.map(() => color),
            colorsPerVertex: true
          })
        })
      )
    }
  }
  return new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
    asynchronous: false,
    allowPicking: false
  })
}

/** 采样点标记（绿=达标、黄=临界、红=不达标） */
export function createSampleMarker(
  viewer: Cesium.Viewer,
  position: Cesium.Cartesian3,
  color: Cesium.Color,
  labelText: string
): Cesium.Entity {
  return viewer.entities.add({
    id: 'sunshine-sample-marker',
    position,
    point: {
      pixelSize: 11,
      color,
      outlineColor: Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.9),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: labelText,
      font: 'bold 12px sans-serif',
      fillColor: Cesium.Color.WHITE,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('#0a1c33').withAlpha(0.78),
      pixelOffset: new Cesium.Cartesian2(0, -22),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM
    }
  })
}
