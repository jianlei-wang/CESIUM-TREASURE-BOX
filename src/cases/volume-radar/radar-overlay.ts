/**
 * 雷达业务叠加层 —— 雷达站、距离圈、方位标注与回波顶高参考环。
 *
 * 与体场共享同一局部 ENU 坐标系（归一化体域坐标 x/y 水平、z 垂直），经 VolumeEngine 的
 * modelMatrix 映射到世界坐标，保证叠加层与回波体严格对齐。所有几何均可在运行期整体显隐。
 */

import {
  Cartesian2,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  CylinderGeometry,
  GeometryInstance,
  HorizontalOrigin,
  LabelStyle,
  Matrix4,
  Material,
  PerInstanceColorAppearance,
  PolylineCollection,
  Primitive,
  VerticalOrigin,
  type Viewer
} from 'cesium'
import { RADAR_CONFIG } from '../../lib/volume-engine/scenes'
import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'

export type RadarOverlayOptions = {
  /** 距离圈（整圈） */
  rings?: boolean
  /** 方位辐条与 N/E/S/W 标注 */
  directions?: boolean
  /** 雷达站塔标与站名 */
  station?: boolean
  /** 回波顶高参考环 */
  topLadder?: boolean
}

export type RadarOverlay = {
  /** 运行期切换各子层的显隐 */
  setVisible: (options: RadarOverlayOptions) => void
  destroy: () => void
}

const RING_SEGMENTS = 96

function css(color: string): Color {
  return Color.fromCssColorString(color)
}

function circlePoints(
  local: (x: number, y: number, z: number) => Cartesian3,
  cx: number,
  cy: number,
  cz: number,
  radius: number
): Cartesian3[] {
  const points: Cartesian3[] = []
  for (let i = 0; i <= RING_SEGMENTS; i += 1) {
    const a = (i / RING_SEGMENTS) * Math.PI * 2
    points.push(local(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, cz))
  }
  return points
}

function installCollection(viewer: Viewer, modelMatrix: Matrix4, primitives: Primitive[]): PolylineCollection {
  const collection = new PolylineCollection({ modelMatrix })
  viewer.scene.primitives.add(collection)
  primitives.push(collection as unknown as Primitive)
  return collection
}

function line(collection: PolylineCollection, positions: Cartesian3[], color: Color, width: number): void {
  collection.add({ positions, width, material: Material.fromType(Material.ColorType, { color }) })
}

export function installRadarOverlay(engine: VolumeEngine, options: RadarOverlayOptions = {}): RadarOverlay {
  const viewer = engine.getViewer() as Viewer | undefined
  if (!viewer || viewer.isDestroyed()) return { setVisible: () => undefined, destroy: () => undefined }

  const modelMatrix = engine.getModelMatrix()
  const V = engine.spec.volume
  const local = (x: number, y: number, z: number): Cartesian3 => {
    const p = engine.localFromNormalized(x, y, z)
    return new Cartesian3(p.x, p.y, p.z)
  }

  const center = { x: 0.5, y: 0.5 }
  const heightKm = V.height / 1000
  // km → 归一化水平半径（体域为正方形，宽深一致）
  const kmToNorm = 1000 / V.width

  const primitives: Primitive[] = []
  const ringCollection = installCollection(viewer, modelMatrix, primitives)
  const dirCollection = installCollection(viewer, modelMatrix, primitives)
  const ladderCollection = installCollection(viewer, modelMatrix, primitives)

  /* ---- 距离圈：由内向外交替配色 ---- */
  const ringPalette = ['#36c1ea', '#2a8fd0', '#36c1ea', '#2a8fd0']
  RADAR_CONFIG.ringsKm.forEach((km, i) => {
    const r = km * kmToNorm
    if (r <= 0.001 || r > 0.72) return
    const color = css(ringPalette[i % ringPalette.length]).withAlpha(0.42)
    line(ringCollection, circlePoints(local, center.x, center.y, 0.004, r), color, 1.4)
  })

  /* ---- 方位辐条与标注 ---- */
  const maxRing = Math.min(0.72, Math.max(...RADAR_CONFIG.ringsKm) * kmToNorm)
  const dirs = [
    { dx: 0, dy: 1, label: 'N', color: '#9fd8ff' },
    { dx: 1, dy: 0, label: 'E', color: '#9fd8ff' },
    { dx: 0, dy: -1, label: 'S', color: '#9fd8ff' },
    { dx: -1, dy: 0, label: 'W', color: '#9fd8ff' }
  ]
  for (const d of dirs) {
    line(dirCollection, [local(center.x, center.y, 0.004), local(center.x + d.dx * maxRing, center.y + d.dy * maxRing, 0.004)], css(d.color).withAlpha(0.6), 2)
  }
  const dirEntities = dirs.map((d) =>
    viewer.entities.add({
      position: engine.worldFromNormalized(center.x + d.dx * maxRing, center.y + d.dy * maxRing, 0.03),
      label: {
        text: d.label,
        font: '13px "PingFang SC", "Microsoft YaHei", sans-serif',
        style: LabelStyle.FILL_AND_OUTLINE,
        fillColor: css(d.color),
        outlineColor: css('#08131f'),
        outlineWidth: 4,
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
  )

  /* ---- 回波顶高参考环：等间距水平圆环 + 高度标注 ---- */
  const ladderRadius = 0.4
  const ladderEntities = RADAR_CONFIG.echoTopBands.map((km) => {
    const z = Math.min(0.98, km / heightKm)
    line(ladderCollection, circlePoints(local, center.x, center.y, z, ladderRadius), css('#7fd6ff').withAlpha(0.2), 1)
    return viewer.entities.add({
      position: engine.worldFromNormalized(center.x + ladderRadius, center.y, z),
      label: {
        text: `${km} km`,
        font: '11px "PingFang SC", "Microsoft YaHei", sans-serif',
        style: LabelStyle.FILL_AND_OUTLINE,
        fillColor: css('#bfe6ff'),
        outlineColor: css('#08131f'),
        outlineWidth: 3,
        horizontalOrigin: HorizontalOrigin.LEFT,
        verticalOrigin: VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
  })

  /* ---- 雷达站：细圆柱塔标 + 站名 ---- */
  const stationColor = css('#ffd21e')
  const stationTop = 0.02
  const stationLength = stationTop * V.height
  const stationInstance = new GeometryInstance({
    geometry: new CylinderGeometry({
      length: stationLength,
      topRadius: 180,
      bottomRadius: 180,
      slices: 20
    }),
    modelMatrix: Matrix4.fromTranslation(local(center.x, center.y, stationTop / 2)),
    attributes: { color: ColorGeometryInstanceAttribute.fromColor(stationColor.withAlpha(0.95)) },
    id: 'radar-station'
  })
  const stationPrimitive = new Primitive({
    geometryInstances: stationInstance,
    appearance: new PerInstanceColorAppearance({ translucent: true, closed: true }),
    asynchronous: false
  })
  stationPrimitive.modelMatrix = Matrix4.clone(modelMatrix)
  viewer.scene.primitives.add(stationPrimitive)
  primitives.push(stationPrimitive)

  const stationGeo = { lon: engine.spec.center.lon, lat: engine.spec.center.lat }
  const stationEntity = viewer.entities.add({
    position: engine.worldFromNormalized(center.x, center.y, stationTop + 0.005),
    label: {
      text: `天气雷达站  ${stationGeo.lon.toString()}°E\n海拔 ${RADAR_CONFIG.stationHeightM} m`,
      font: '12px "PingFang SC", "Microsoft YaHei", sans-serif',
      style: LabelStyle.FILL_AND_OUTLINE,
      fillColor: stationColor,
      outlineColor: css('#3a2600'),
      outlineWidth: 4,
      horizontalOrigin: HorizontalOrigin.CENTER,
      verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(0, -4),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })

  function setVisible(partial: RadarOverlayOptions): void {
    Object.assign(options, partial)
    ringCollection.show = options.rings !== false
    dirCollection.show = options.directions !== false
    ladderCollection.show = options.topLadder !== false
    for (const e of dirEntities) e.show = options.directions !== false
    for (const e of ladderEntities) e.show = options.topLadder !== false
    stationPrimitive.show = options.station !== false
    stationEntity.show = options.station !== false
    engine.requestRender()
  }
  setVisible(options)

  return {
    setVisible,
    destroy: () => {
      if (viewer.isDestroyed()) return
      for (const primitive of primitives) viewer.scene.primitives.remove(primitive)
      for (const e of dirEntities) viewer.entities.remove(e)
      for (const e of ladderEntities) viewer.entities.remove(e)
      viewer.entities.remove(stationEntity)
      engine.requestRender()
    }
  }
}
