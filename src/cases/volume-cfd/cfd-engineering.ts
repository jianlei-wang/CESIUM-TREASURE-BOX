/**
 * CFD 工程几何层 —— 街区建筑白模 + 仿真域 + 出入口 / 主风向标注。
 *
 * 与体场共享同一局部 ENU 坐标系：所有布局以归一化体域坐标（x/y 水平、z 垂直）描述，
 * 经 VolumeEngine 的 modelMatrix 映射到世界坐标，保证体场、几何、粒子三者对齐。
 *
 * 建筑包围盒同时作为 Worker 的障碍物输入（cfdGeometryPayload），使速度 / 压力 / 温度
 * 三场与几何严格一致。
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
  Material,
  Matrix4,
  PerInstanceColorAppearance,
  PolylineCollection,
  Primitive,
  VerticalOrigin,
  type Viewer
} from 'cesium'
import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'

export type EngBox = {
  /** 归一化体域范围 */
  x0: number
  x1: number
  y0: number
  y1: number
  /** 归一化高度（顶面） */
  h: number
  name?: string
}

/** 程序化街区：保留上游开阔区作为热源，形成穿城尾流与热羽抬升的典型工况 */
export const CFD_BUILDINGS: EngBox[] = [
  { x0: 0.36, x1: 0.44, y0: 0.3, y1: 0.38, h: 0.3, name: 'A 栋' },
  { x0: 0.48, x1: 0.54, y0: 0.28, y1: 0.34, h: 0.2, name: 'B 栋' },
  { x0: 0.58, x1: 0.68, y0: 0.3, y1: 0.4, h: 0.4, name: 'C 栋' },
  { x0: 0.34, x1: 0.42, y0: 0.52, y1: 0.6, h: 0.36, name: 'D 栋' },
  { x0: 0.46, x1: 0.54, y0: 0.5, y1: 0.58, h: 0.62, name: '主塔' },
  { x0: 0.6, x1: 0.7, y0: 0.54, y1: 0.64, h: 0.28, name: 'E 栋' },
  { x0: 0.4, x1: 0.46, y0: 0.68, y1: 0.74, h: 0.18, name: 'F 栋' },
  { x0: 0.52, x1: 0.6, y0: 0.7, y1: 0.78, h: 0.24, name: 'G 栋' },
  { x0: 0.3, x1: 0.34, y0: 0.66, y1: 0.72, h: 0.14, name: 'H 栋' }
]

/** 扁平化障碍物包围盒，供 Worker 构建实体掩膜 */
export function cfdGeometryPayload(): number[] {
  const out: number[] = []
  for (const b of CFD_BUILDINGS) out.push(b.x0, b.x1, b.y0, b.y1, b.h)
  return out
}

type Edge = [number, number, number, number, number, number]

function boxEdges(min: [number, number, number], max: [number, number, number]): Edge[] {
  const [x0, y0, z0] = min
  const [x1, y1, z1] = max
  const c: [number, number, number][] = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
  ]
  const pairs = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7]
  ]
  return pairs.map(([a, b]) => [...c[a], ...c[b]] as Edge)
}

function colorMaterial(color: Color): Material {
  return Material.fromType(Material.ColorType, { color })
}

function addEdges(collection: PolylineCollection, edges: Edge[], color: Color, width: number): void {
  for (const e of edges) {
    collection.add({
      positions: [new Cartesian3(e[0], e[1], e[2]), new Cartesian3(e[3], e[4], e[5])],
      width,
      material: colorMaterial(color)
    })
  }
}

export type CfdEngineeringLayer = { destroy: () => void }

/** 在引擎场景中装配工程几何层，返回卸载函数 */
export function installCfdEngineering(engine: VolumeEngine): CfdEngineeringLayer {
  const viewer = engine.getViewer() as Viewer | undefined
  if (!viewer || viewer.isDestroyed()) return { destroy: () => undefined }

  const modelMatrix = engine.getModelMatrix()
  const V = engine.spec.volume
  const local = (x: number, y: number, z: number): Cartesian3 => {
    const p = engine.localFromNormalized(x, y, z)
    return new Cartesian3(p.x, p.y, p.z)
  }

  /* ---- 建筑白模（半透明实体 + 边线） ---- */
  const primitives: Primitive[] = []
  const edgeCollection = new PolylineCollection({ modelMatrix })
  const buildingColor = Color.fromCssColorString('#c9d8e8').withAlpha(0.82)
  const edgeColor = Color.fromCssColorString('#eaf2fb').withAlpha(0.5)
  for (const b of CFD_BUILDINGS) {
    const cx = (b.x0 + b.x1) / 2
    const cy = (b.y0 + b.y1) / 2
    const center = local(cx, cy, b.h / 2)
    const dims = new Cartesian3((b.x1 - b.x0) * V.width, (b.y1 - b.y0) * V.depth, b.h * V.height)
    const geometry = BoxGeometry.fromDimensions({ dimensions: dims })
    const instance = new GeometryInstance({
      geometry,
      modelMatrix: Matrix4.fromTranslation(center),
      attributes: { color: ColorGeometryInstanceAttribute.fromColor(buildingColor) },
      id: b.name
    })
    const primitive = new Primitive({
      geometryInstances: instance,
      appearance: new PerInstanceColorAppearance({ translucent: true, closed: true }),
      asynchronous: false
    })
    primitive.modelMatrix = Matrix4.clone(modelMatrix)
    viewer.scene.primitives.add(primitive)
    primitives.push(primitive)

    const cLo = local(b.x0, b.y0, 0)
    const cHi = local(b.x1, b.y1, b.h)
    addEdges(
      edgeCollection,
      boxEdges(
        [Math.min(cLo.x, cHi.x), Math.min(cLo.y, cHi.y), cLo.z],
        [Math.max(cLo.x, cHi.x), Math.max(cLo.y, cHi.y), cHi.z]
      ),
      edgeColor,
      1.2
    )
  }
  viewer.scene.primitives.add(edgeCollection)
  primitives.push(edgeCollection as unknown as Primitive)

  /* ---- 仿真域线框 ---- */
  const domainCollection = new PolylineCollection({ modelMatrix })
  const dLo = local(0, 0, 0)
  const dHi = local(1, 1, 1)
  addEdges(
    domainCollection,
    boxEdges([dLo.x, dLo.y, dLo.z], [dHi.x, dHi.y, dHi.z]),
    Color.fromCssColorString('#4fd1c5').withAlpha(0.55),
    1.6
  )
  viewer.scene.primitives.add(domainCollection)
  primitives.push(domainCollection as unknown as Primitive)

  /* ---- 入口 / 出口边界面 + 主风向 ---- */
  const boundaryCollection = new PolylineCollection({ modelMatrix })
  const inletColor = Color.fromCssColorString('#4fd1c5')
  const outletColor = Color.fromCssColorString('#f6ad55')
  const bankHeight = 0.42
  for (let i = 0; i <= 8; i += 1) {
    const y = 0.08 + (0.84 * i) / 8
    boundaryCollection.add({ positions: [local(0, y, 0), local(0, y, bankHeight)], width: 1.4, material: colorMaterial(inletColor) })
    boundaryCollection.add({ positions: [local(1, y, 0), local(1, y, bankHeight)], width: 1.4, material: colorMaterial(outletColor) })
  }
  const windZ = 0.12
  boundaryCollection.add({ positions: [local(-0.06, 0.5, windZ), local(0.2, 0.5, windZ)], width: 2.6, material: colorMaterial(inletColor) })
  boundaryCollection.add({ positions: [local(0.2, 0.5, windZ), local(0.15, 0.535, windZ)], width: 2.6, material: colorMaterial(inletColor) })
  boundaryCollection.add({ positions: [local(0.2, 0.5, windZ), local(0.15, 0.465, windZ)], width: 2.6, material: colorMaterial(inletColor) })
  viewer.scene.primitives.add(boundaryCollection)
  primitives.push(boundaryCollection as unknown as Primitive)

  /* ---- 工程标注 ---- */
  const labelRows: { x: number; y: number; z: number; text: string; color: string }[] = [
    { x: -0.02, y: 0.5, z: 0.2, text: '主导风向  +X', color: '#4fd1c5' },
    { x: 0.0, y: 0.14, z: 0.46, text: '入口边界', color: '#4fd1c5' },
    { x: 0.98, y: 0.14, z: 0.46, text: '出口边界', color: '#f6ad55' },
    { x: 0.85, y: 0.5, z: 0.3, text: '尾流恢复区', color: '#9fd8ff' },
    { x: 0.22, y: 0.42, z: 0.04, text: '热源', color: '#f06030' }
  ]
  const entities = labelRows.map((row) =>
    viewer.entities.add({
      position: engine.worldFromNormalized(row.x, row.y, row.z),
      label: {
        text: row.text,
        font: '12px "PingFang SC", "Microsoft YaHei", sans-serif',
        style: LabelStyle.FILL_AND_OUTLINE,
        fillColor: Color.fromCssColorString(row.color),
        outlineColor: Color.fromCssColorString('#08131f'),
        outlineWidth: 4,
        verticalOrigin: VerticalOrigin.BOTTOM,
        horizontalOrigin: HorizontalOrigin.CENTER,
        pixelOffset: new Cartesian2(0, -6),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
  )

  engine.requestRender()

  return {
    destroy: () => {
      if (viewer.isDestroyed()) return
      for (const primitive of primitives) viewer.scene.primitives.remove(primitive)
      for (const entity of entities) viewer.entities.remove(entity)
      engine.requestRender()
    }
  }
}
