/**
 * 火灾工程几何层 —— 三维建筑白模、街区道路骨架、火源火焰柱、环境风与疏散指引、距离标尺。
 *
 * 与体场共享同一局部 ENU 坐标系：所有布局以归一化体域坐标（x/y 水平、z 垂直）描述，
 * 经 VolumeEngine 的 modelMatrix 映射到世界坐标，保证体场、几何、粒子三者对齐。
 *
 * 建筑包围盒同时作为 Worker 的障碍物输入（firePayload.buildings），使烟气场严格绕避建筑。
 */

import {
  BoxGeometry,
  Cartesian2,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  ConstantProperty,
  CylinderGeometry,
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
import type { FireImpact } from './fire-analysis'
import type { FirePayload, VolumeEngine } from '../../lib/volume-engine/VolumeEngine'
import { FIRE_CONFIG, type FireSourceDef } from '../../lib/volume-engine/scenes'

export type FireEngineeringState = {
  buildingsVisible: boolean
  roadsVisible: boolean
  sourcesVisible: boolean
  windVisible: boolean
  escapeVisible: boolean
  impacts: FireImpact[]
  tempThreshold: number
  smokeThreshold: number
  windDir: number
  windSpeed: number
  timeStep: number
}

export type FireEngineeringLayer = {
  update(state: FireEngineeringState): void
  destroy(): void
}

/** 组装火灾 Worker 输入：火源事件曲线（高度由起火楼层决定）+ 建筑障碍物 */
export function firePayload(timeSteps: number): FirePayload {
  const totalMinutes = Math.max(1, (timeSteps - 1) * FIRE_CONFIG.timeStepMinutes)
  return {
    sources: FIRE_CONFIG.sources.map((s) => {
      const b = FIRE_CONFIG.buildings.find((x) => x.id === s.buildingId)
      const floors = b?.floors ?? 10
      const height = b?.height ?? 0.2
      const z = Math.max(0.02, ((s.floor - 0.5) / Math.max(1, floors)) * height)
      return {
        id: s.id,
        x: s.x,
        y: s.y,
        z,
        radius: s.radius,
        start: s.start,
        peak: s.peak,
        end: s.end,
        heatRelease: s.heatRelease,
        smokeYield: s.smokeYield,
        sourceType: s.sourceType
      }
    }),
    buildings: FIRE_CONFIG.buildings.map((b) => ({ x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, height: b.height, floors: b.floors })),
    ambientTemp: FIRE_CONFIG.ambientTemp,
    timeStepMinutes: FIRE_CONFIG.timeStepMinutes,
    totalMinutes
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / Math.max(1e-6, b - a)))
  return t * t * (3 - 2 * t)
}

/** 火源事件强度曲线（与 Worker fireSourceIntensity 保持一致），用于火焰柱高度 */
export function fireIntensityAt(s: FireSourceDef, tn: number): number {
  if (tn <= s.start || tn >= s.end) return 0
  const v = tn < s.peak ? smoothstep(s.start, Math.max(s.start + 0.001, s.peak), tn) : 1 - smoothstep(s.peak, Math.max(s.peak + 0.001, s.end), tn)
  return Math.max(0, Math.min(1, v))
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

/** 在引擎场景中装配火灾工程层 */
export function installFireEngineering(engine: VolumeEngine): FireEngineeringLayer {
  const viewer = engine.getViewer() as Viewer | undefined
  if (!viewer || viewer.isDestroyed()) return { update: () => undefined, destroy: () => undefined }

  const modelMatrix = engine.getModelMatrix()
  const V = engine.spec.volume
  const local = (x: number, y: number, z: number): Cartesian3 => {
    const p = engine.localFromNormalized(x, y, z)
    return new Cartesian3(p.x, p.y, p.z)
  }

  const staticPrimitives: Primitive[] = []
  const threatPrimitives: Primitive[] = []
  const sourcePrimitives: Primitive[] = []
  const buildingSolids: Primitive[] = []
  const labelEntities: import('cesium').Entity[] = []
  const roadLabels: import('cesium').Entity[] = []
  const escapeLabels: import('cesium').Entity[] = []
  let sourceEntities: import('cesium').Entity[] = []
  let destroyed = false

  /* ---- 建筑白模（半透明实体 + 边线） ---- */
  const buildingColor = Color.fromCssColorString('#b9cde0').withAlpha(0.55)
  const edgeColor = Color.fromCssColorString('#eaf2fb').withAlpha(0.45)
  const buildingEdgeCollection = new PolylineCollection({ modelMatrix })
  for (const b of FIRE_CONFIG.buildings) {
    const cx = (b.x0 + b.x1) / 2
    const cy = (b.y0 + b.y1) / 2
    const center = local(cx, cy, b.height / 2)
    const dims = new Cartesian3((b.x1 - b.x0) * V.width, (b.y1 - b.y0) * V.depth, b.height * V.height)
    const geometry = BoxGeometry.fromDimensions({ dimensions: dims })
    const instance = new GeometryInstance({
      geometry,
      modelMatrix: Matrix4.fromTranslation(center),
      attributes: { color: ColorGeometryInstanceAttribute.fromColor(buildingColor) },
      id: b.id
    })
    const primitive = new Primitive({
      geometryInstances: instance,
      appearance: new PerInstanceColorAppearance({ translucent: true, closed: true }),
      asynchronous: false
    })
    primitive.modelMatrix = Matrix4.clone(modelMatrix)
    viewer.scene.primitives.add(primitive)
    staticPrimitives.push(primitive)
    buildingSolids.push(primitive)

    const cLo = local(b.x0, b.y0, 0)
    const cHi = local(b.x1, b.y1, b.height)
    addEdges(
      buildingEdgeCollection,
      boxEdges(
        [Math.min(cLo.x, cHi.x), Math.min(cLo.y, cHi.y), cLo.z],
        [Math.max(cLo.x, cHi.x), Math.max(cLo.y, cHi.y), cHi.z]
      ),
      edgeColor,
      1.1
    )
  }
  viewer.scene.primitives.add(buildingEdgeCollection)
  staticPrimitives.push(buildingEdgeCollection as unknown as Primitive)

  /* ---- 街区道路骨架 ---- */
  const roadCollection = new PolylineCollection({ modelMatrix })
  const roadColors: Record<string, Color> = {
    main: Color.fromCssColorString('#f2c94c').withAlpha(0.5),
    secondary: Color.fromCssColorString('#cfd8e3').withAlpha(0.32),
    fire: Color.fromCssColorString('#ff6b4a').withAlpha(0.7)
  }
  const roadWidths: Record<string, number> = { main: 4.4, secondary: 2.6, fire: 5.5 }
  for (const road of FIRE_CONFIG.roads) {
    const positions = road.points.map(([x, y]) => local(x, y, 0.004))
    roadCollection.add({ positions, width: roadWidths[road.kind] ?? 3, material: colorMaterial(roadColors[road.kind] ?? roadColors.secondary) })
  }
  viewer.scene.primitives.add(roadCollection)
  staticPrimitives.push(roadCollection as unknown as Primitive)

  /* ---- 仿真域底框 + 距离标尺 ---- */
  const frameCollection = new PolylineCollection({ modelMatrix })
  const frameColor = Color.fromCssColorString('#4fd1c5').withAlpha(0.4)
  addEdges(
    frameCollection,
    boxEdges([local(0, 0, 0).x, local(0, 0, 0).y, local(0, 0, 0).z], [local(1, 1, 1).x, local(1, 1, 1).y, local(1, 1, 1).z]),
    frameColor,
    1.4
  )
  // 沿北边界每 100 m 一个刻度（体域宽 900 m）
  const rulerTicks: { x: number; text: string }[] = []
  for (let m = 0; m <= 900; m += 100) {
    const nx = m / V.width
    frameCollection.add({
      positions: [local(nx, 0, 0), local(nx, 0, 0.03)],
      width: 1.6,
      material: colorMaterial(Color.fromCssColorString('#8fd3ff').withAlpha(0.55))
    })
    if (m % 200 === 0) rulerTicks.push({ x: nx, text: `${m} m` })
  }
  viewer.scene.primitives.add(frameCollection)
  staticPrimitives.push(frameCollection as unknown as Primitive)

  /* ---- 静态文字标注（道路 / 标尺 / 风向） ---- */
  const makeLabel = (x: number, y: number, z: number, text: string, color: string, size = 12): import('cesium').Entity =>
    viewer.entities.add({
      position: engine.worldFromNormalized(x, y, z),
      label: {
        text,
        font: `${size}px "PingFang SC", "Microsoft YaHei", sans-serif`,
        style: LabelStyle.FILL_AND_OUTLINE,
        fillColor: Color.fromCssColorString(color),
        outlineColor: Color.fromCssColorString('#08131f'),
        outlineWidth: 4,
        verticalOrigin: VerticalOrigin.BOTTOM,
        horizontalOrigin: HorizontalOrigin.CENTER,
        pixelOffset: new Cartesian2(0, -6),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
  for (const t of rulerTicks) labelEntities.push(makeLabel(t.x, -0.015, 0.02, t.text, '#8fd3ff', 11))
  roadLabels.push(makeLabel(0.06, 0.405, 0.02, '主干道', '#f2c94c', 11))
  roadLabels.push(makeLabel(0.405, 0.94, 0.02, '主干道', '#f2c94c', 11))
  labelEntities.push(...roadLabels)

  /* ---- 环境风箭头 ---- */
  const windEntity = viewer.entities.add({
    position: engine.worldFromNormalized(0.18, 0.86, 0.32),
    label: {
      text: '环境风',
      font: '12px "PingFang SC", "Microsoft YaHei", sans-serif',
      style: LabelStyle.FILL_AND_OUTLINE,
      fillColor: Color.fromCssColorString('#7ee0ff'),
      outlineColor: Color.fromCssColorString('#08131f'),
      outlineWidth: 4,
      verticalOrigin: VerticalOrigin.BOTTOM,
      horizontalOrigin: HorizontalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })
  labelEntities.push(windEntity)

  /* ---- 疏散指引（静态：向上风向两侧撤离） ---- */
  const escapeCollection = new PolylineCollection({ modelMatrix })
  const escapeColor = Color.fromCssColorString('#7ee787')
  const escapePaths: [number, number][][] = [
    [[0.46, 0.52], [0.2, 0.3], [0.05, 0.16]],
    [[0.58, 0.59], [0.34, 0.8], [0.1, 0.94]]
  ]
  for (const path of escapePaths) {
    const positions = path.map(([x, y]) => local(x, y, 0.01))
    escapeCollection.add({ positions, width: 3.2, material: colorMaterial(escapeColor.withAlpha(0.85)) })
    // 箭头头部
    const last = path[path.length - 1]
    const prev = path[path.length - 2]
    const dx = last[0] - prev[0]
    const dy = last[1] - prev[1]
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len
    const tip = local(last[0], last[1], 0.01)
    const back = local(last[0] - ux * 0.04, last[1] - uy * 0.04, 0.01)
    const side = local(last[0] - ux * 0.04 - uy * 0.025, last[1] - uy * 0.04 + ux * 0.025, 0.01)
    const side2 = local(last[0] - ux * 0.04 + uy * 0.025, last[1] - uy * 0.04 - ux * 0.025, 0.01)
    escapeCollection.add({ positions: [back, tip], width: 3.2, material: colorMaterial(escapeColor) })
    escapeCollection.add({ positions: [side, tip, side2], width: 3.2, material: colorMaterial(escapeColor) })
  }
  viewer.scene.primitives.add(escapeCollection)
  staticPrimitives.push(escapeCollection as unknown as Primitive)
  escapeLabels.push(makeLabel(0.05, 0.16, 0.03, '疏散集结点 A', '#7ee787', 12))
  escapeLabels.push(makeLabel(0.1, 0.94, 0.03, '疏散集结点 B', '#7ee787', 12))
  labelEntities.push(...escapeLabels)

  engine.requestRender()

  /* ---- 动态层：受威胁建筑高亮 + 火源火焰柱 ---- */
  let threatSignature = ''
  function rebuildThreats(state: FireEngineeringState): void {
    for (const p of threatPrimitives) viewer!.scene.primitives.remove(p)
    threatPrimitives.length = 0
    const byId = new Map(state.impacts.map((im) => [im.id, im]))
    const threatColor = Color.fromCssColorString('#ff3b1f').withAlpha(0.42)
    const threatEdge = Color.fromCssColorString('#ff7a4a').withAlpha(0.85)
    const threatEdgeCollection = new PolylineCollection({ modelMatrix })
    let any = false
    for (const b of FIRE_CONFIG.buildings) {
      const im = byId.get(b.id)
      const threat = im ? im.temp >= state.tempThreshold || im.smoke >= state.smokeThreshold : false
      if (!threat) continue
      any = true
      const cx = (b.x0 + b.x1) / 2
      const cy = (b.y0 + b.y1) / 2
      const center = local(cx, cy, b.height / 2)
      const dims = new Cartesian3((b.x1 - b.x0) * V.width * 1.04, (b.y1 - b.y0) * V.depth * 1.04, b.height * V.height * 1.03)
      const primitive = new Primitive({
        geometryInstances: new GeometryInstance({
          geometry: BoxGeometry.fromDimensions({ dimensions: dims }),
          modelMatrix: Matrix4.fromTranslation(center),
          attributes: { color: ColorGeometryInstanceAttribute.fromColor(threatColor) }
        }),
        appearance: new PerInstanceColorAppearance({ translucent: true, closed: true }),
        asynchronous: false
      })
      primitive.modelMatrix = Matrix4.clone(modelMatrix)
      viewer!.scene.primitives.add(primitive)
      threatPrimitives.push(primitive)
      const cLo = local(b.x0, b.y0, 0)
      const cHi = local(b.x1, b.y1, b.height)
      addEdges(
        threatEdgeCollection,
        boxEdges(
          [Math.min(cLo.x, cHi.x), Math.min(cLo.y, cHi.y), cLo.z],
          [Math.max(cLo.x, cHi.x), Math.max(cLo.y, cHi.y), cHi.z]
        ),
        threatEdge,
        2
      )
    }
    if (any) {
      viewer!.scene.primitives.add(threatEdgeCollection)
      threatPrimitives.push(threatEdgeCollection as unknown as Primitive)
    }
  }

  function rebuildSources(state: FireEngineeringState): void {
    for (const p of sourcePrimitives) viewer!.scene.primitives.remove(p)
    sourcePrimitives.length = 0
    for (const e of sourceEntities) viewer!.entities.remove(e)
    sourceEntities = []
    if (!state.sourcesVisible) return
    const tn = engine.spec.timeSteps > 1 ? state.timeStep / (engine.spec.timeSteps - 1) : 0
    FIRE_CONFIG.sources.forEach((s) => {
      const b = FIRE_CONFIG.buildings.find((x) => x.id === s.buildingId)
      const floors = b?.floors ?? 10
      const height = b?.height ?? 0.2
      const baseZ = Math.max(0.02, ((s.floor - 0.5) / Math.max(1, floors)) * height)
      const inten = fireIntensityAt(s, tn)
      if (inten > 0.02) {
        const flameLen = (0.03 + 0.1 * inten * s.heatRelease) * 1
        const center = local(s.x, s.y, Math.min(0.94, baseZ + flameLen / 2))
        const dims = new CylinderGeometry({
          length: flameLen * V.height,
          topRadius: 0.006 * V.width * (0.7 + 0.5 * inten),
          bottomRadius: 0.02 * V.width * (0.8 + 0.6 * inten)
        })
        const color = s.sourceType === 'primary'
          ? Color.fromCssColorString('#ff4d1f').withAlpha(0.85)
          : s.sourceType === 'ignition'
            ? Color.fromCssColorString('#ff8a2f').withAlpha(0.8)
            : Color.fromCssColorString('#ffd166').withAlpha(0.75)
        const primitive = new Primitive({
          geometryInstances: new GeometryInstance({
            geometry: dims,
            modelMatrix: Matrix4.fromTranslation(center),
            attributes: { color: ColorGeometryInstanceAttribute.fromColor(color) }
          }),
          appearance: new PerInstanceColorAppearance({ translucent: true, closed: false }),
          asynchronous: false
        })
        primitive.modelMatrix = Matrix4.clone(modelMatrix)
        viewer!.scene.primitives.add(primitive)
        sourcePrimitives.push(primitive)
      }
      sourceEntities.push(
        makeLabel(s.x, s.y, Math.min(0.95, baseZ + 0.03), `${s.id} ${s.name}`, inten > 0.02 ? '#ffd9c2' : '#9fb8d4', 11)
      )
    })
  }

  function rebuildWind(state: FireEngineeringState): void {
    const text = `环境风 ${state.windSpeed.toFixed(1)} m/s · ${state.windDir}°`
    windEntity.label!.text = new ConstantProperty(text)
    windEntity.show = state.windVisible
  }

  function rebuildEscape(state: FireEngineeringState): void {
    escapeCollection.show = state.escapeVisible
  }

  return {
    update(state: FireEngineeringState): void {
      if (destroyed) return
      for (const p of buildingSolids) p.show = state.buildingsVisible
      buildingEdgeCollection.show = state.buildingsVisible
      for (const e of roadLabels) e.show = state.roadsVisible
      roadCollection.show = state.roadsVisible
      escapeCollection.show = state.escapeVisible
      for (const e of escapeLabels) e.show = state.escapeVisible
      rebuildWind(state)
      rebuildSources(state)
      const signature = FIRE_CONFIG.buildings
        .map((b) => {
          const im = state.impacts.find((i) => i.id === b.id)
          const threat = im ? im.temp >= state.tempThreshold || im.smoke >= state.smokeThreshold : false
          return threat ? '1' : '0'
        })
        .join('')
      if (state.buildingsVisible && signature !== threatSignature) {
        threatSignature = signature
        rebuildThreats(state)
      } else if (!state.buildingsVisible && threatPrimitives.length) {
        for (const p of threatPrimitives) viewer.scene.primitives.remove(p)
        threatPrimitives.length = 0
        threatSignature = ''
      }
      engine.requestRender()
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      if (viewer.isDestroyed()) return
      for (const p of staticPrimitives) viewer.scene.primitives.remove(p)
      for (const p of threatPrimitives) viewer.scene.primitives.remove(p)
      for (const p of sourcePrimitives) viewer.scene.primitives.remove(p)
      for (const e of labelEntities) viewer.entities.remove(e)
      for (const e of sourceEntities) viewer.entities.remove(e)
      engine.requestRender()
    }
  }
}
