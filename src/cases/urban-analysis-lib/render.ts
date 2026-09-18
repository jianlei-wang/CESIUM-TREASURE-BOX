/**
 * 城市三维分析共享渲染库：建筑白模、观测点标记、天际线穹顶、球面采样可视化。
 */

import * as Cesium from 'cesium'
import type { CityModel, BuildingBox } from '../sunshine-lib/city'
import type { EnuFrame } from './geometry'
import { enuToWorld } from './geometry'

const BUILDING_LOW = [206, 216, 228] as const
const BUILDING_HIGH = [64, 106, 176] as const

export function heightColor(topHeight: number, alpha = 1): Cesium.Color {
  const t = Math.max(0, Math.min(1, topHeight / 170))
  const r = Math.round(BUILDING_LOW[0] + (BUILDING_HIGH[0] - BUILDING_LOW[0]) * t)
  const g = Math.round(BUILDING_LOW[1] + (BUILDING_HIGH[1] - BUILDING_LOW[1]) * t)
  const b = Math.round(BUILDING_LOW[2] + (BUILDING_HIGH[2] - BUILDING_LOW[2]) * t)
  return Cesium.Color.fromBytes(r, g, b, Math.round(alpha * 255))
}

export type BuildingRenderEntry = {
  building: BuildingBox
  entity: Cesium.Entity
}

export function renderCityBuildings(
  viewer: Cesium.Viewer,
  city: CityModel,
  opacity = 1
): BuildingRenderEntry[] {
  const entries: BuildingRenderEntry[] = []
  for (const building of city.buildings) {
    const positions = Cesium.Cartesian3.fromDegreesArray([
      building.west,
      building.south,
      building.east,
      building.south,
      building.east,
      building.north,
      building.west,
      building.north
    ])
    const entity = viewer.entities.add({
      id: `urban-building-${building.id}`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        height: building.baseHeight,
        extrudedHeight: building.topHeight,
        material: heightColor(building.topHeight, opacity),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#0b1c33').withAlpha(0.5),
        closeTop: true,
        closeBottom: false
      },
      properties: {
        buildingId: building.id,
        buildingName: building.name,
        buildingHeight: building.topHeight
      }
    })
    entries.push({ building, entity })
  }
  return entries
}

export type StyleOptions = {
  opacity: number
  highlight?: Set<string>
  highlightColor?: Cesium.Color
  violationColor?: Cesium.Color
}

/** 按建筑高度着色，并高亮指定建筑（如超限建筑） */
export function applyBuildingStyles(
  entries: BuildingRenderEntry[],
  options: StyleOptions
): void {
  const highlight = options.highlight
  const violationColor = options.violationColor ?? Cesium.Color.fromCssColorString('#ff4d4f')
  for (const { building, entity } of entries) {
    if (!entity.polygon) continue
    if (highlight && highlight.has(building.id)) {
      entity.polygon.material = new Cesium.ColorMaterialProperty(violationColor.withAlpha(0.92))
    } else {
      entity.polygon.material = new Cesium.ColorMaterialProperty(heightColor(building.topHeight, options.opacity))
    }
  }
}

/** 隐藏 / 显示全部建筑 */
export function setBuildingsVisible(entries: BuildingRenderEntry[], visible: boolean): void {
  for (const { entity } of entries) entity.show = visible
}

/** 创建观测点标记（圆点 + 标签） */
export function createObserverMarker(
  viewer: Cesium.Viewer,
  position: Cesium.Cartesian3,
  labelText: string
): Cesium.Entity {
  return viewer.entities.add({
    id: 'urban-observer',
    position,
    point: {
      pixelSize: 12,
      color: Cesium.Color.fromCssColorString('#ffd666'),
      outlineColor: Cesium.Color.fromCssColorString('#5b4b12'),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: labelText,
      font: 'bold 12px sans-serif',
      fillColor: Cesium.Color.fromCssColorString('#fff4c2'),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('#0a1c33').withAlpha(0.78),
      pixelOffset: new Cesium.Cartesian2(0, -22),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM
    }
  })
}

/** 构建天际线三维折线：按方位角把俯仰角投射到半径为 domeRadius 的穹顶 */
export function skylinePositions(
  frame: EnuFrame,
  samples: { azimuth: number; elevation: number }[],
  domeRadius: number
): Cesium.Cartesian3[] {
  const positions: Cesium.Cartesian3[] = []
  for (const sample of samples) {
    const cosE = Math.cos(sample.elevation)
    positions.push(
      enuToWorld(
        frame,
        Math.sin(sample.azimuth) * cosE * domeRadius,
        Math.cos(sample.azimuth) * cosE * domeRadius,
        Math.sin(sample.elevation) * domeRadius
      )
    )
  }
  return positions
}

/** 创建/更新分析球体（半透明面 + 轮廓线） */
export function createAnalysisSphere(
  viewer: Cesium.Viewer,
  frame: EnuFrame,
  radius: number,
  color: Cesium.Color,
  opacity: number
): Cesium.Entity {
  return viewer.entities.add({
    id: 'urban-analysis-sphere',
    position: frame.origin,
    ellipsoid: {
      radii: new Cesium.Cartesian3(radius, radius, radius),
      material: color.withAlpha(opacity),
      outline: true,
      outlineColor: color.withAlpha(Math.min(1, opacity + 0.35)),
      slicePartitions: 24,
      stackPartitions: 12
    }
  })
}

export function removeEntityById(viewer: Cesium.Viewer, id: string): void {
  if (!viewer.isDestroyed()) viewer.entities.removeById(id)
}

/** 采样点集合：按是否遮挡着色（红=遮挡，青=天空） */
export function createSamplePoints(
  frame: EnuFrame,
  samples: { direction: { east: number; north: number; up: number }; occluded: boolean }[],
  radius: number,
  skyColor: Cesium.Color,
  occludedColor: Cesium.Color
): Cesium.PointPrimitiveCollection {
  const collection = new Cesium.PointPrimitiveCollection()
  for (const sample of samples) {
    const d = sample.direction
    collection.add({
      position: enuToWorld(frame, d.east * radius, d.north * radius, d.up * radius),
      pixelSize: 3,
      color: sample.occluded ? occludedColor : skyColor
    })
  }
  return collection
}
