/**
 * PM2.5 环境业务叠加层 —— 城市建筑、体域骨架、地面网格、固定污染源、风矢与边界层顶面。
 *
 * 与浓度体共享同一局部 ENU 坐标系：所有布局以归一化体域坐标描述，经 VolumeEngine 的
 * modelMatrix 映射到世界坐标，保证污染源 / 风场 / 边界层与浓度体严格对齐。
 */

import {
  BoxGeometry,
  Cartesian2,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  HorizontalOrigin,
  LabelStyle,
  Matrix4,
  Material,
  PerInstanceColorAppearance,
  PolylineCollection,
  Primitive,
  Rectangle,
  RectangleGraphics,
  ConstantPositionProperty,
  ConstantProperty,
  ColorMaterialProperty,
  VerticalOrigin,
  type Entity,
  type Viewer
} from 'cesium'
import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'
import { PM25_CONFIG } from '../../lib/volume-engine/scenes'
import type { Pm25SourceDef } from '../../lib/volume-engine/scenes'

export type Pm25OverlayLayers = {
  city: boolean
  frame: boolean
  sources: boolean
  wind: boolean
  blh: boolean
}

export type Pm25Meteorology = {
  windFrom: number
  windSpeed: number
  blh: number
  activeSources: number
}

export type Pm25Overlay = {
  setVisible: (options: Partial<Pm25OverlayLayers>) => void
  updateMeteorology: (met: Partial<Pm25Meteorology>) => void
  destroy: () => void
}

/** 程序化城市建筑白模：集中在城区面源附近，作为污染受体空间参照 */
const CITY_BLOCKS = [
  { x0: 0.45, x1: 0.49, y0: 0.45, y1: 0.49, h: 0.07 },
  { x0: 0.51, x1: 0.56, y0: 0.47, y1: 0.53, h: 0.11 },
  { x0: 0.43, x1: 0.47, y0: 0.54, y1: 0.58, h: 0.05 },
  { x0: 0.53, x1: 0.58, y0: 0.56, y1: 0.62, h: 0.08 },
  { x0: 0.48, x1: 0.52, y0: 0.6, y1: 0.65, h: 0.06 },
  { x0: 0.58, x1: 0.63, y0: 0.44, y1: 0.49, h: 0.09 },
  { x0: 0.4, x1: 0.44, y0: 0.42, y1: 0.46, h: 0.04 },
  { x0: 0.55, x1: 0.6, y0: 0.36, y1: 0.4, h: 0.06 }
]

const SOURCE_COLORS: Record<Pm25SourceDef['type'], string> = {
  stack: '#ff7e4d',
  area: '#ffd21e',
  road: '#65d3eb'
}

function css(color: string): Color {
  return Color.fromCssColorString(color)
}

function colorMaterial(color: Color): Material {
  return Material.fromType(Material.ColorType, { color })
}

function sectorPoints(
  local: (x: number, y: number, z: number) => Cartesian3,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  segments = 24
): Cartesian3[] {
  const points: Cartesian3[] = []
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2
    points.push(local(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, cz))
  }
  return points
}

export function installPm25Overlay(engine: VolumeEngine, met: Pm25Meteorology): Pm25Overlay {
  const viewerMaybe = engine.getViewer()
  if (!viewerMaybe || viewerMaybe.isDestroyed()) {
    return { setVisible: () => undefined, updateMeteorology: () => undefined, destroy: () => undefined }
  }
  const viewer: Viewer = viewerMaybe

  const modelMatrix = engine.getModelMatrix()
  const V = engine.spec.volume
  const local = (x: number, y: number, z: number): Cartesian3 => {
    const p = engine.localFromNormalized(x, y, z)
    return new Cartesian3(p.x, p.y, p.z)
  }

  const primitives: Primitive[] = []
  const worldLabels: Entity[] = []
  const sourceLabels: Entity[] = []

  const frameCollection = new PolylineCollection({ modelMatrix })
  const gridCollection = new PolylineCollection({ modelMatrix })
  const sourceCollection = new PolylineCollection({ modelMatrix })
  const windCollection = new PolylineCollection({ modelMatrix })
  for (const collection of [frameCollection, gridCollection, sourceCollection, windCollection]) {
    viewer.scene.primitives.add(collection)
    primitives.push(collection as unknown as Primitive)
  }

  function addLabel(x: number, y: number, z: number, text: string, color: Color): Entity {
    return viewer.entities.add({
      position: engine.worldFromNormalized(x, y, z),
      label: {
        text,
        font: '11px "PingFang SC", "Microsoft YaHei", sans-serif',
        style: LabelStyle.FILL_AND_OUTLINE,
        fillColor: color,
        outlineColor: css('#08131f'),
        outlineWidth: 3,
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -4),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
  }

  /* ---- 体域骨架 ---- */
  const lo = local(0, 0, 0)
  const hi = local(1, 1, 1)
  const corners: [number, number, number][] = [
    [lo.x, lo.y, lo.z], [hi.x, lo.y, lo.z], [hi.x, hi.y, lo.z], [lo.x, hi.y, lo.z],
    [lo.x, lo.y, hi.z], [hi.x, lo.y, hi.z], [hi.x, hi.y, hi.z], [lo.x, hi.y, hi.z]
  ]
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
  for (const [a, b] of edges) {
    frameCollection.add({
      positions: [new Cartesian3(...corners[a]), new Cartesian3(...corners[b])],
      width: 1.2,
      material: colorMaterial(css('#4fd1c5').withAlpha(0.35))
    })
  }
  worldLabels.push(addLabel(0.5, 0, 0, `${(V.width / 1000).toFixed(0)} km × ${(V.depth / 1000).toFixed(0)} km × ${(V.height / 1000).toFixed(1)} km`, css('#9fd8ff')))

  /* ---- 地面网格 ---- */
  const divisions = 8
  for (let i = 0; i <= divisions; i += 1) {
    const t = i / divisions
    gridCollection.add({ positions: [local(t, 0, 0.002), local(t, 1, 0.002)], width: 1, material: colorMaterial(css('#3f6d8a').withAlpha(0.28)) })
    gridCollection.add({ positions: [local(0, t, 0.002), local(1, t, 0.002)], width: 1, material: colorMaterial(css('#3f6d8a').withAlpha(0.28)) })
  }

  /* ---- 固定污染源 ---- */
  for (const source of PM25_CONFIG.sources) {
    const color = css(SOURCE_COLORS[source.type])
    const zTop = source.type === 'stack' ? 0.16 : 0.04
    if (source.type === 'road') {
      const heading = ((source.heading ?? 0) * Math.PI) / 180
      const len = (source.length ?? 0.4) * 0.5
      const hx = Math.cos(heading) * len
      const hy = Math.sin(heading) * len
      sourceCollection.add({
        positions: [local(source.x - hx, source.y - hy, 0.004), local(source.x + hx, source.y + hy, 0.004)],
        width: 3,
        material: colorMaterial(color.withAlpha(0.85))
      })
    } else if (source.type === 'area') {
      sourceCollection.add({
        positions: sectorPoints(local, source.x, source.y, 0.004, 0.035),
        width: 2,
        material: colorMaterial(color.withAlpha(0.8))
      })
    } else {
      sourceCollection.add({
        positions: [local(source.x, source.y, 0.004), local(source.x, source.y, zTop)],
        width: 2.2,
        material: colorMaterial(color.withAlpha(0.9))
      })
    }
    sourceLabels.push(addLabel(source.x, source.y, zTop + 0.01, `${source.id} ${source.name}`, color))
  }

  /* ---- 城市建筑白模（可切换） ---- */
  const cityPrimitives: Primitive[] = []
  for (const b of CITY_BLOCKS) {
    // 注意：localFromNormalized 第三参数是归一化高度 0~1（非米），中心取 b.h/2 使楼体底面贴合地面
    const center = local((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.h / 2)
    const dims = new Cartesian3((b.x1 - b.x0) * V.width, (b.y1 - b.y0) * V.depth, b.h * V.height)
    const instance = new GeometryInstance({
      geometry: BoxGeometry.fromDimensions({ dimensions: dims }),
      modelMatrix: Matrix4.fromTranslation(center),
      attributes: { color: ColorGeometryInstanceAttribute.fromColor(css('#c9d8e8').withAlpha(0.5)) }
    })
    const primitive = new Primitive({
      geometryInstances: instance,
      appearance: new PerInstanceColorAppearance({ translucent: true, closed: true }),
      asynchronous: false
    })
    primitive.modelMatrix = Matrix4.clone(modelMatrix)
    viewer.scene.primitives.add(primitive)
    cityPrimitives.push(primitive)
  }

  /* ---- 边界层顶面 ---- */
  const sw = engine.worldFromNormalized(0, 0, 0)
  const ne = engine.worldFromNormalized(1, 1, 0)
  const rect = Rectangle.fromCartesianArray([Cartesian3.clone(sw), Cartesian3.clone(ne)])
  const blhMaterial = new ColorMaterialProperty(css('#7fd6ff').withAlpha(0.05))
  const blhEntity = viewer.entities.add({
    rectangle: new RectangleGraphics({
      coordinates: rect,
      material: blhMaterial,
      height: new ConstantProperty(met.blh * V.height)
    })
  })
  const blhLabel = addLabel(0.04, 0.96, met.blh + 0.01, `边界层顶 ${(met.blh * V.height).toFixed(0)} m`, css('#bfe6ff'))

  /* ---- 风矢（下风向），方向随气象更新 ---- */
  let windLabel: Entity | undefined
  function rebuildWind(current: Pm25Meteorology): void {
    windCollection.removeAll()
    if (windLabel) {
      viewer.entities.remove(windLabel)
      windLabel = undefined
    }
    const downwind = current.windFrom + 180
    const rad = (downwind * Math.PI) / 180
    const dx = Math.cos(rad)
    const dy = Math.sin(rad)
    const cx = 0.14
    const cy = 0.86
    const len = 0.18
    const z = 0.02
    const head = local(cx + dx * len, cy + dy * len, z)
    const tail = local(cx - dx * len, cy - dy * len, z)
    const color = css('#4fd1c5')
    windCollection.add({ positions: [tail, head], width: 2.6, material: colorMaterial(color) })
    const left = local(cx + dx * len * 0.7 - dy * len * 0.35, cy + dy * len * 0.7 + dx * len * 0.35, z)
    const right = local(cx + dx * len * 0.7 + dy * len * 0.35, cy + dy * len * 0.7 - dx * len * 0.35, z)
    windCollection.add({ positions: [head, left], width: 2.2, material: colorMaterial(color) })
    windCollection.add({ positions: [head, right], width: 2.2, material: colorMaterial(color) })
    windLabel = addLabel(cx, cy, z + 0.02, `风向 ${Math.round(current.windFrom)}° · ${current.windSpeed.toFixed(1)} m/s`, color)
  }
  rebuildWind(met)

  const state: Pm25OverlayLayers = { city: false, frame: true, sources: true, wind: true, blh: false }

  function setVisible(options: Partial<Pm25OverlayLayers>): void {
    Object.assign(state, options)
    frameCollection.show = state.frame
    gridCollection.show = state.frame
    sourceCollection.show = state.sources
    windCollection.show = state.wind
    for (let i = 0; i < sourceLabels.length; i += 1) {
      sourceLabels[i].show = state.sources && i < met.activeSources
    }
    if (windLabel) windLabel.show = state.wind
    blhEntity.show = state.blh
    blhLabel.show = state.blh
    for (const primitive of cityPrimitives) primitive.show = state.city
    engine.requestRender()
  }

  function updateMeteorology(next: Partial<Pm25Meteorology>): void {
    Object.assign(met, next)
    rebuildWind(met)
    if (blhEntity.rectangle) blhEntity.rectangle.height = new ConstantProperty(met.blh * V.height)
    blhLabel.position = new ConstantPositionProperty(engine.worldFromNormalized(0.04, 0.96, met.blh + 0.01))
    for (let i = 0; i < sourceLabels.length; i += 1) {
      sourceLabels[i].show = state.sources && i < met.activeSources
    }
    engine.requestRender()
  }

  setVisible(state)

  return {
    setVisible,
    updateMeteorology,
    destroy: () => {
      if (viewer.isDestroyed()) return
      for (const primitive of primitives) viewer.scene.primitives.remove(primitive)
      for (const primitive of cityPrimitives) viewer.scene.primitives.remove(primitive)
      for (const entity of worldLabels) viewer.entities.remove(entity)
      for (const label of sourceLabels) viewer.entities.remove(label)
      viewer.entities.remove(blhEntity)
      if (windLabel) viewer.entities.remove(windLabel)
      engine.requestRender()
    }
  }
}
