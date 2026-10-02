/**
 * 三维风场 —— 场景骨架
 *
 * 为风场体域提供分析参照系：体域线框、地面网格与 footprint、高度刻度、
 * 风向罗盘圈，以及随参数更新的主导风向箭头。全部以体域局部 ENU 坐标构建，
 * 通过 VolumeEngine 的局部坐标系挂载到 Cesium 场景，销毁时统一清理。
 */
import {
  Cartesian2,
  Cartesian3,
  Color,
  HorizontalOrigin,
  LabelCollection,
  LabelStyle,
  Material,
  Matrix4,
  PolylineCollection,
  VerticalOrigin,
  type Viewer
} from 'cesium'
import { createWindVortices, sampleWindField, type WindFieldParams, type WindVortex } from '../../lib/vector-field-engine/windField'
import { PALETTES, lerpStops } from '../../lib/volume-engine/palette'

export type WindSkeletonOptions = {
  viewer: Viewer
  modelMatrix: Matrix4
  /** 体域尺寸（米）：base 相对锚点，height 为垂向厚度 */
  width: number
  depth: number
  height: number
  base: number
  /** 锚点海拔（米），用于高度标注的绝对数值 */
  anchorHeight: number
  /** 高度刻度数量 */
  tickCount?: number
  /** 主导风向（来向，度） */
  dominantFrom?: number
  /** 风场参数：用于在体域底面绘制风场 footprint（地面风场投影） */
  fieldParams?: Partial<WindFieldParams>
}

export type WindSkeleton = {
  setVisible(visible: boolean): void
  setDominantDirection(fromDir: number): void
  setFieldParams(params: Partial<WindFieldParams>): void
  dispose(): void
}

const GRID_COLOR = Color.fromCssColorString('#2f6fa8').withAlpha(0.35)
const BOX_COLOR = Color.fromCssColorString('#4f9fd8').withAlpha(0.55)
const FOOTPRINT_COLOR = Color.fromCssColorString('#67e8f9').withAlpha(0.8)
const TICK_COLOR = Color.fromCssColorString('#9fd0f0').withAlpha(0.75)
const COMPASS_COLOR = Color.fromCssColorString('#7fb8e0').withAlpha(0.55)
const ARROW_COLOR = Color.fromCssColorString('#ffd21e').withAlpha(0.95)

function v3(x: number, y: number, z: number): Cartesian3 {
  return new Cartesian3(x, y, z)
}

function addSegment(
  collection: PolylineCollection,
  a: Cartesian3,
  b: Cartesian3,
  width: number,
  color: Color
): void {
  collection.add({
    positions: [a, b],
    width,
    material: Material.fromType('Color', { color })
  })
}

/** 气象方位角 → 局部 ENU 水平方向（东=+x，北=+y） */
function azimuthToDir(azimuthDeg: number): { x: number; y: number } {
  const rad = (azimuthDeg * Math.PI) / 180
  return { x: Math.sin(rad), y: Math.cos(rad) }
}

function buildArrow(
  collection: PolylineCollection,
  center: Cartesian3,
  dir: { x: number; y: number },
  length: number
): void {
  collection.removeAll()
  const half = length / 2
  const tail = v3(center.x - dir.x * half, center.y - dir.y * half, center.z)
  const tip = v3(center.x + dir.x * half, center.y + dir.y * half, center.z)
  addSegment(collection, tail, tip, 4, ARROW_COLOR)
  const headLen = length * 0.22
  const spread = 0.42
  const cos = Math.cos(spread)
  const sin = Math.sin(spread)
  for (const sign of [1, -1]) {
    const hx = dir.x * cos - dir.y * sin * sign
    const hy = dir.y * cos + dir.x * sin * sign
    addSegment(
      collection,
      tip,
      v3(tip.x - hx * headLen, tip.y - hy * headLen, tip.z),
      4,
      ARROW_COLOR
    )
  }
}

/** 在集合中追加一支水平箭头（不清理既有内容，用于网格化 footprint） */
function pushHorizontalArrow(
  collection: PolylineCollection,
  center: Cartesian3,
  dir: { x: number; y: number },
  length: number,
  color: Color
): void {
  const half = length / 2
  const tail = v3(center.x - dir.x * half, center.y - dir.y * half, center.z)
  const tip = v3(center.x + dir.x * half, center.y + dir.y * half, center.z)
  addSegment(collection, tail, tip, 2, color)
  const headLen = Math.min(length * 0.45, 90)
  const spread = 0.5
  const cos = Math.cos(spread)
  const sin = Math.sin(spread)
  for (const sign of [1, -1]) {
    const hx = dir.x * cos - dir.y * sin * sign
    const hy = dir.y * cos + dir.x * sin * sign
    addSegment(collection, tip, v3(tip.x - hx * headLen, tip.y - hy * headLen, tip.z), 2, color)
  }
}

/** 由风速映射到 wind 色带颜色，低值略透明、高值更醒目 */
function speedColor(speed: number, maxSpeed: number): Color {
  const t = maxSpeed > 0 ? Math.min(1, Math.max(0, speed / maxSpeed)) : 0
  const [r, g, b] = lerpStops(PALETTES.wind.stops, t)
  return new Color(r / 255, g / 255, b / 255, 0.35 + 0.5 * t)
}

export function createWindSkeleton(options: WindSkeletonOptions): WindSkeleton {
  const { viewer, modelMatrix, width, depth, height, base, anchorHeight } = options
  const halfW = width / 2
  const halfD = depth / 2
  const top = base + height
  const tickCount = Math.max(2, options.tickCount ?? 6)

  const lines = new PolylineCollection({ modelMatrix })
  const labels = new LabelCollection({ modelMatrix })
  const arrow = new PolylineCollection({ modelMatrix })
  const groundArrows = new PolylineCollection({ modelMatrix })
  viewer.scene.primitives.add(lines)
  viewer.scene.primitives.add(labels)
  viewer.scene.primitives.add(arrow)
  viewer.scene.primitives.add(groundArrows)

  /* ---- 地面网格与 footprint ---- */
  const gridDivisions = 8
  for (let i = 0; i <= gridDivisions; i += 1) {
    const t = i / gridDivisions
    const x = -halfW + width * t
    const y = -halfD + depth * t
    addSegment(lines, v3(x, -halfD, base), v3(x, halfD, base), 1, GRID_COLOR)
    addSegment(lines, v3(-halfW, y, base), v3(halfW, y, base), 1, GRID_COLOR)
  }
  const footprint: Cartesian3[] = [
    v3(-halfW, -halfD, base),
    v3(halfW, -halfD, base),
    v3(halfW, halfD, base),
    v3(-halfW, halfD, base),
    v3(-halfW, -halfD, base)
  ]
  lines.add({ positions: footprint, width: 3, material: Material.fromType('Color', { color: FOOTPRINT_COLOR }) })

  /* ---- 体域线框 ---- */
  const corners = [
    v3(-halfW, -halfD, base),
    v3(halfW, -halfD, base),
    v3(halfW, halfD, base),
    v3(-halfW, halfD, base)
  ]
  for (const corner of corners) {
    addSegment(lines, corner, v3(corner.x, corner.y, top), 2, BOX_COLOR)
  }
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i]
    const b = corners[(i + 1) % 4]
    addSegment(lines, v3(a.x, a.y, top), v3(b.x, b.y, top), 2, BOX_COLOR)
  }

  /* ---- 高度刻度（左侧竖线 + 刻度短线 + 标注） ---- */
  const tickX = -halfW - width * 0.03
  const tickY = -halfD - depth * 0.03
  addSegment(lines, v3(tickX, tickY, base), v3(tickX, tickY, top), 1.5, TICK_COLOR)
  for (let i = 0; i < tickCount; i += 1) {
    const t = i / (tickCount - 1)
    const z = base + height * t
    addSegment(lines, v3(tickX, tickY, z), v3(tickX + width * 0.04, tickY, z), 1.5, TICK_COLOR)
    labels.add({
      position: v3(tickX - width * 0.01, tickY, z),
      text: `${Math.round(anchorHeight + z)} m`,
      font: '11px sans-serif',
      style: LabelStyle.FILL_AND_OUTLINE,
      fillColor: Color.fromCssColorString('#cfe6f7'),
      outlineColor: Color.fromCssColorString('#061428'),
      outlineWidth: 2,
      horizontalOrigin: HorizontalOrigin.RIGHT,
      verticalOrigin: VerticalOrigin.CENTER,
      pixelOffset: new Cartesian2(-6, 0)
    })
  }

  /* ---- 风向罗盘圈 ---- */
  const ringRadius = Math.min(width, depth) * 0.3
  const ringSegments = 72
  let prev: Cartesian3 | undefined
  for (let i = 0; i <= ringSegments; i += 1) {
    const a = (i / ringSegments) * Math.PI * 2
    const point = v3(Math.sin(a) * ringRadius, Math.cos(a) * ringRadius, base + 1)
    if (prev) addSegment(lines, prev, point, 1.2, COMPASS_COLOR)
    prev = point
  }
  const compassLabels: { dir: { x: number; y: number }; text: string }[] = [
    { dir: { x: 0, y: 1 }, text: 'N' },
    { dir: { x: 1, y: 0 }, text: 'E' },
    { dir: { x: 0, y: -1 }, text: 'S' },
    { dir: { x: -1, y: 0 }, text: 'W' }
  ]
  for (const item of compassLabels) {
    labels.add({
      position: v3(item.dir.x * ringRadius * 1.12, item.dir.y * ringRadius * 1.12, base + 1),
      text: item.text,
      font: 'bold 12px sans-serif',
      style: LabelStyle.FILL_AND_OUTLINE,
      fillColor: Color.fromCssColorString('#dcecfb'),
      outlineColor: Color.fromCssColorString('#061428'),
      outlineWidth: 2,
      horizontalOrigin: HorizontalOrigin.CENTER,
      verticalOrigin: VerticalOrigin.CENTER
    })
  }

  /* ---- 主导风向箭头 ---- */
  const arrowCenter = v3(0, 0, base + height * 0.06)
  const arrowLength = Math.min(width, depth) * 0.42
  const applyDirection = (fromDir: number): void => {
    const toDir = fromDir + 180
    buildArrow(arrow, arrowCenter, azimuthToDir(toDir), arrowLength)
  }
  applyDirection(options.dominantFrom ?? 235)

  let visible = true

  /* ---- 地面风场 footprint：底面速度投影箭头，锚定风场覆盖范围 ---- */
  const buildFootprint = (fieldParams: Partial<WindFieldParams>): void => {
    groundArrows.removeAll()
    if (!fieldParams || Object.keys(fieldParams).length === 0) return
    const vortices: WindVortex[] = createWindVortices(fieldParams)
    const divisions = 6
    const cellW = width / divisions
    const cellD = depth / divisions
    const maxArrow = Math.min(cellW, cellD) * 0.62
    const maxSpeed = (fieldParams.baseSpeed ?? 9) * 1.9 || 1
    for (let gy = 0; gy < divisions; gy += 1) {
      for (let gx = 0; gx < divisions; gx += 1) {
        const nx = (gx + 0.5) / divisions
        const ny = (gy + 0.5) / divisions
        const sample = sampleWindField(nx, ny, 0.02, fieldParams, vortices)
        const speed = Math.sqrt(sample.u * sample.u + sample.v * sample.v)
        if (speed < 1e-4) continue
        const dir = { x: sample.u / speed, y: sample.v / speed }
        const len = Math.max(10, maxArrow * Math.min(1, speed / maxSpeed))
        const center = v3(-halfW + cellW * (gx + 0.5), -halfD + cellD * (gy + 0.5), base + 2)
        pushHorizontalArrow(groundArrows, center, dir, len, speedColor(speed, maxSpeed))
      }
    }
    if (visible) viewer.scene.requestRender()
  }
  buildFootprint(options.fieldParams ?? {})

  const setVisible = (value: boolean): void => {
    visible = value
    lines.show = value
    labels.show = value
    arrow.show = value
    groundArrows.show = value
    viewer.scene.requestRender()
  }

  return {
    setVisible,
    setDominantDirection: (fromDir: number) => {
      applyDirection(fromDir)
      if (visible) viewer.scene.requestRender()
    },
    setFieldParams: (params: Partial<WindFieldParams>) => {
      buildFootprint(params)
    },
    dispose: () => {
      for (const collection of [lines, labels, arrow, groundArrows]) {
        if (!viewer.isDestroyed() && viewer.scene.primitives.contains(collection)) {
          viewer.scene.primitives.remove(collection)
        }
      }
    }
  }
}
