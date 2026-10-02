/**
 * 地质业务叠加层 —— 三维体域框、深度标尺、指北针、断层面、层位界面与钻孔柱状。
 *
 * 与体场共享同一局部 ENU 坐标系（归一化体域坐标 x/y 水平、z 垂直），经 VolumeEngine 的
 * modelMatrix 映射到世界坐标；localFromNormalized 已包含垂向夸张，故叠加层随夸张设置自动对齐。
 * 层位界面与钻孔分层依据 Worker 回传的构造起伏栅格（relief）实时推算，保证与体场严格一致。
 */

import {
  Cartesian2,
  Cartesian3,
  Color,
  HorizontalOrigin,
  LabelStyle,
  Material,
  PolylineCollection,
  VerticalOrigin,
  type Entity,
  type Primitive,
  type Viewer
} from 'cesium'
import { GEOLOGY_CONFIG } from '../../lib/volume-engine/scenes'
import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'

export type GeologyOverlayOptions = {
  /** 三维体域框线 + 深度标尺 + 指北针 */
  frame?: boolean
  /** 断层面 */
  faults?: boolean
  /** 层位界面网格 */
  horizons?: boolean
  /** 钻孔柱状与井名 */
  boreholes?: boolean
}

export type GeologyStructure = {
  /** 构造起伏栅格（联系 geoShift：层界 z = 1 - 接触面 + 起伏） */
  relief: Float32Array
  res: number
  contacts: number[]
}

export type GeologyOverlayGroupState = {
  show: boolean
  labels: number
  labelsVisible: number
}

export type GeologyOverlayDebug = {
  frame: GeologyOverlayGroupState
  horizons: GeologyOverlayGroupState
  faults: GeologyOverlayGroupState
  boreholes: GeologyOverlayGroupState
}

export type GeologyOverlay = {
  setVisible: (options: GeologyOverlayOptions) => void
  /** 分析结果回传后更新层位界面与钻孔分层 */
  updateStructure: (structure: GeologyStructure) => void
  /** 垂向夸张变化后按现有结构重绘 */
  rebuild: () => void
  /** 叠加图层与标注的显隐状态快照（供自动化验证） */
  debug: () => GeologyOverlayDebug
  destroy: () => void
}

function css(color: string, alpha = 1): Color {
  return Color.fromCssColorString(color).withAlpha(alpha)
}

function cssFromRgb(rgb: [number, number, number], alpha = 1): Color {
  return new Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, alpha)
}

const HORIZON_GRID = 7

export function installGeologyOverlay(engine: VolumeEngine, options: GeologyOverlayOptions = {}): GeologyOverlay {
  const maybeViewer = engine.getViewer()
  const noop = {
    setVisible: () => undefined,
    updateStructure: () => undefined,
    rebuild: () => undefined,
    debug: (): GeologyOverlayDebug => ({
      frame: { show: false, labels: 0, labelsVisible: 0 },
      horizons: { show: false, labels: 0, labelsVisible: 0 },
      faults: { show: false, labels: 0, labelsVisible: 0 },
      boreholes: { show: false, labels: 0, labelsVisible: 0 }
    }),
    destroy: () => undefined
  }
  if (!maybeViewer || maybeViewer.isDestroyed()) return noop
  const viewer: Viewer = maybeViewer

  const modelMatrix = engine.getModelMatrix()
  const local = (x: number, y: number, z: number): Cartesian3 => {
    const p = engine.localFromNormalized(x, y, z)
    return new Cartesian3(p.x, p.y, p.z)
  }

  const frame = new PolylineCollection({ modelMatrix })
  const horizon = new PolylineCollection({ modelMatrix })
  const fault = new PolylineCollection({ modelMatrix })
  const borehole = new PolylineCollection({ modelMatrix })
  viewer.scene.primitives.add(frame)
  viewer.scene.primitives.add(horizon)
  viewer.scene.primitives.add(fault)
  viewer.scene.primitives.add(borehole)

  let structure: GeologyStructure | null = null
  /** 标注按图层分组，随图层一起显隐（体域框/断层/钻孔各自拥有自己的文字标注） */
  type LabelGroup = 'frame' | 'faults' | 'boreholes'
  const labels: Record<LabelGroup, Entity[]> = { frame: [], faults: [], boreholes: [] }

  const line = (
    collection: PolylineCollection,
    positions: Cartesian3[],
    color: Color,
    width: number
  ): void => {
    collection.add({ positions, width, material: Material.fromType(Material.ColorType, { color }) })
  }

  const addLabel = (
    group: LabelGroup,
    x: number,
    y: number,
    z: number,
    text: string,
    color: Color,
    origin: HorizontalOrigin = HorizontalOrigin.CENTER,
    vOrigin: VerticalOrigin = VerticalOrigin.CENTER
  ): void => {
    labels[group].push(
      viewer.entities.add({
        position: engine.worldFromNormalized(x, y, z),
        label: {
          text,
          font: '11px "PingFang SC", "Microsoft YaHei", sans-serif',
          style: LabelStyle.FILL_AND_OUTLINE,
          fillColor: color,
          outlineColor: css('#08131f'),
          outlineWidth: 3,
          horizontalOrigin: origin,
          verticalOrigin: vOrigin,
          pixelOffset: new Cartesian2(0, 0),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      })
    )
  }

  function clearLabels(): void {
    for (const group of Object.keys(labels) as LabelGroup[]) {
      for (const l of labels[group].splice(0)) {
        if (!viewer.isDestroyed()) viewer.entities.remove(l)
      }
    }
  }

  function drawFrame(): void {
    frame.removeAll()
    const c: { x: number; y: number; z: number }[] = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 }
    ]
    const color = css('#7f9bb8', 0.5)
    // 底面 + 顶面的水平框
    line(frame, [...c, c[0]].map((p) => local(p.x, p.y, 0)), color, 1.3)
    line(frame, [...c, c[0]].map((p) => local(p.x, p.y, 1)), css('#9fc8e8', 0.34), 1)
    // 四条竖棱
    for (const p of c) line(frame, [local(p.x, p.y, 0), local(p.x, p.y, 1)], color, 1)
  }

  function drawRuler(): void {
    const col = css('#9fc8e8', 0.72)
    // 直立标尺线（前左棱）
    line(frame, [local(0, 0, 0), local(0, 0, 1)], col, 2)
    const heightM = engine.spec.volume.height
    for (const depth of GEOLOGY_CONFIG.depthMarks) {
      const z = Math.max(0, Math.min(1, 1 - depth / heightM))
      line(frame, [local(0, 0, z), local(0.035, 0, z)], col, 1.4)
      addLabel('frame', 0.045, 0, z, `${depth} m`, css('#bfe6ff'), HorizontalOrigin.LEFT, VerticalOrigin.CENTER)
    }
    // 地表标注与指北针
    addLabel('frame', 0, 0, 1.02, '地表', css('#e8f4ff'), HorizontalOrigin.LEFT, VerticalOrigin.BOTTOM)
    line(frame, [local(0.5, 0.5, 1), local(0.5, 0.62, 1)], css('#ffd21e', 0.9), 2)
    addLabel('frame', 0.5, 0.66, 1, 'N', css('#ffd21e'), HorizontalOrigin.CENTER, VerticalOrigin.CENTER)
  }

  function drawFault(): void {
    fault.removeAll()
    const throwAmt = engine.spec.params.faultThrow as number
    if (!throwAmt || throwAmt < 0.0005) return
    const dir = ((GEOLOGY_CONFIG.faultDir * Math.PI) / 180)
    // 断层面走向为 (cos,sin) 的法线方向，断层迹线沿垂直方向延展
    const dx = -Math.sin(dir)
    const dy = Math.cos(dir)
    const cx = 0.5
    const cy = 0.5
    const len = 0.75
    const zTop = Math.max(0, Math.min(1, 1 + throwAmt * 0.5))
    const color = css('#ff7a4a', 0.78)
    line(
      fault,
      [local(cx - dx * len, cy - dy * len, zTop), local(cx + dx * len, cy + dy * len, zTop)],
      color,
      1.8
    )
    line(
      fault,
      [local(cx - dx * len, cy - dy * len, 0), local(cx + dx * len, cy + dy * len, 0)],
      css('#ff7a4a', 0.4),
      1.2
    )
    addLabel('faults', cx + dx * len, cy + dy * len, zTop, '断层 F1', css('#ffb59a'), HorizontalOrigin.LEFT, VerticalOrigin.CENTER)
  }

  function sampleRelief(x: number, y: number): number {
    if (!structure) return 0
    const gx = Math.max(0, Math.min(structure.res - 1, Math.round(x * (structure.res - 1))))
    const gy = Math.max(0, Math.min(structure.res - 1, Math.round(y * (structure.res - 1))))
    return structure.relief[gy * structure.res + gx]
  }

  function drawHorizons(): void {
    horizon.removeAll()
    if (!structure) return
    const layers = GEOLOGY_CONFIG.layers
    structure.contacts.forEach((contact, i) => {
      const color = cssFromRgb(layers[i]?.color ?? [200, 200, 200], 0.62)
      for (let gy = 0; gy <= HORIZON_GRID; gy += 1) {
        const y = gy / HORIZON_GRID
        const pts: Cartesian3[] = []
        for (let gx = 0; gx <= HORIZON_GRID; gx += 1) {
          const x = gx / HORIZON_GRID
          const z = Math.max(0, Math.min(1, 1 - contact + sampleRelief(x, y)))
          pts.push(local(x, y, z))
        }
        line(horizon, pts, color, 1.2)
      }
      for (let gx = 0; gx <= HORIZON_GRID; gx += 1) {
        const x = gx / HORIZON_GRID
        const pts: Cartesian3[] = []
        for (let gy = 0; gy <= HORIZON_GRID; gy += 1) {
          const y = gy / HORIZON_GRID
          const z = Math.max(0, Math.min(1, 1 - contact + sampleRelief(x, y)))
          pts.push(local(x, y, z))
        }
        line(horizon, pts, color, 1.2)
      }
    })
  }

  function drawBoreholes(): void {
    borehole.removeAll()
    const layers = GEOLOGY_CONFIG.layers
    for (const hole of GEOLOGY_CONFIG.boreholes) {
      const shift = sampleRelief(hole.x, hole.y)
      // 由深到浅累加各层界面
      let zPrev = 1
      const segments: { z0: number; z1: number; code: number }[] = []
      structure?.contacts.forEach((contact, i) => {
        const zc = Math.max(0, Math.min(1, 1 - contact + shift))
        if (zPrev - zc > 1e-4) segments.push({ z0: zPrev, z1: zc, code: i + 1 })
        zPrev = zc
      })
      if (zPrev > 1e-4) segments.push({ z0: zPrev, z1: 0, code: layers.length })
      // 井身细线
      line(borehole, [local(hole.x, hole.y, 0), local(hole.x, hole.y, 1)], css('#ffd21e', 0.5), 1.2)
      for (const seg of segments) {
        const color = cssFromRgb(layers.find((l) => l.code === seg.code)?.color ?? [200, 200, 200], 0.96)
        line(borehole, [local(hole.x, hole.y, seg.z0), local(hole.x, hole.y, seg.z1)], color, 5)
      }
      addLabel('boreholes', hole.x, hole.y, 1.02, hole.id, css('#ffd21e'), HorizontalOrigin.CENTER, VerticalOrigin.BOTTOM)
    }
  }

  function applyVisibility(): void {
    frame.show = options.frame !== false
    horizon.show = options.horizons !== false
    fault.show = options.faults !== false
    borehole.show = options.boreholes !== false
    for (const group of Object.keys(labels) as LabelGroup[]) {
      const visible = options[group] !== false
      for (const entity of labels[group]) entity.show = visible
    }
  }

  function redraw(): void {
    clearLabels()
    drawFrame()
    drawRuler()
    drawFault()
    drawBoreholes()
    drawHorizons()
    applyVisibility()
    engine.requestRender()
  }

  function updateStructure(next: GeologyStructure): void {
    structure = next
    redraw()
  }

  function setVisible(partial: GeologyOverlayOptions): void {
    Object.assign(options, partial)
    applyVisibility()
    engine.requestRender()
  }

  function groupState(collection: PolylineCollection, group?: LabelGroup): GeologyOverlayGroupState {
    const list = group ? labels[group] : []
    return { show: collection.show, labels: list.length, labelsVisible: list.filter((e) => e.show).length }
  }

  function debug(): GeologyOverlayDebug {
    return {
      frame: groupState(frame, 'frame'),
      horizons: groupState(horizon),
      faults: groupState(fault, 'faults'),
      boreholes: groupState(borehole, 'boreholes')
    }
  }

  redraw()
  setVisible(options)

  return {
    setVisible,
    updateStructure,
    rebuild: redraw,
    debug,
    destroy: () => {
      if (viewer.isDestroyed()) return
      for (const collection of [frame, horizon, fault, borehole]) {
        viewer.scene.primitives.remove(collection as unknown as Primitive)
      }
      clearLabels()
      engine.requestRender()
    }
  }
}
