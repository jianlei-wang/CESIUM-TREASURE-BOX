/**
 * 地下水污染羽流场景叠加 —— 地下含水层骨架、地下水流线 / 流向、抽采井捕获区与井网。
 *
 * 所有折线合并为一次 setLines 调用并按折线序号着色（地质边界、井管、捕获环）；
 * 地下水流线单独交由引擎 setFlowBeads 渲染为禁用深度测试的顶部点串，避免被不透明体数据遮挡。
 * 叠加对象挂到引擎通用注记层，随案例组件销毁统一释放。
 */

import { Color } from 'cesium'
import type { LineOverlayResult, VolumeEngine } from '../../lib/volume-engine/VolumeEngine'
import { PLUME_CONFIG } from '../../lib/volume-engine/scenes'

export type PlumeOverlayState = {
  /** 地下水流线 / 流向箭头 */
  flowVisible: boolean
  /** 井网 */
  wellsVisible: boolean
  /** 含水层骨架 */
  aquifersVisible: boolean
  /** 含水层 / 弱透水层半透明地质体 */
  aquiferBodiesVisible: boolean
  /** 地质体不透明度缩放（相对各层自身 opacity 的倍率） */
  aquiferBodiesOpacity: number
  /** 抽采井捕获区 */
  captureVisible: boolean
  activeWellId?: string
  timeStep?: number
  /** Worker 返回的分层流线（局部米坐标） */
  flowLines?: LineOverlayResult | null
}

export type PlumeOverlayHandle = {
  update(state: Partial<PlumeOverlayState>): void
  destroy(): void
}

const WELL_COLORS: Record<string, string> = {
  source: '#ff5a3c',
  monitor: '#65d3eb',
  extract: '#7ee787'
}

const WELL_LABELS: Record<string, string> = {
  source: '污染源',
  monitor: '监测井',
  extract: '抽出井'
}

type Rgb = [number, number, number]

function hexToRgb(hex: string): Rgb {
  const c = hex.replace('#', '')
  return [parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255]
}

const AQUITARD_RGB: Rgb = [0.72, 0.63, 0.42]
const FLOW_RGB: Rgb = [0.31, 0.82, 1.0]
const CAPTURE_RGB: Rgb = [0.5, 0.91, 0.53]

type LineBuilder = {
  positions: number[]
  offsets: number[]
  speeds: number[]
  colors: number[]
}

function newBuilder(): LineBuilder {
  return { positions: [], offsets: [0], speeds: [], colors: [] }
}

function addLine(b: LineBuilder, pts: number[][], color: Rgb, speed = 1): void {
  if (pts.length < 2) return
  for (const p of pts) {
    b.positions.push(p[0], p[1], p[2])
    b.speeds.push(speed)
  }
  b.offsets.push(b.positions.length / 3)
  b.colors.push(color[0], color[1], color[2])
}

function finish(b: LineBuilder): LineOverlayResult {
  return {
    positions: new Float32Array(b.positions),
    offsets: new Uint32Array(b.offsets),
    speeds: new Float32Array(b.speeds),
    colors: new Float32Array(b.colors)
  }
}

export function installPlumeOverlay(engine: VolumeEngine): PlumeOverlayHandle {
  const v = engine.spec.volume
  const config = PLUME_CONFIG
  const flowRad = (config.flowDir * Math.PI) / 180
  const totalDepth = config.aquifers[config.aquifers.length - 1]?.bottom || 120
  const sourceWell = config.wells.find((w) => w.kind === 'source') ?? config.wells[0]
  const extractWell = config.wells.find((w) => w.kind === 'extract')

  let lastState: PlumeOverlayState = {
    flowVisible: true,
    wellsVisible: true,
    aquifersVisible: true,
    aquiferBodiesVisible: true,
    aquiferBodiesOpacity: 0.7,
    captureVisible: true
  }

  const L = (x: number, y: number, z: number): number[] => {
    const c = engine.localFromNormalized(x, y, z)
    return [c.x, c.y, c.z]
  }
  const depthZ = (m: number): number => 1 - Math.min(1, Math.max(0, m / totalDepth))

  function addAquiferSkeleton(b: LineBuilder): void {
    for (const a of config.aquifers) {
      const color = a.type === 'aquifer' ? hexToRgb(a.color) : AQUITARD_RGB
      const zTop = depthZ(a.top)
      const zBottom = depthZ(a.bottom)
      for (const z of [zTop, zBottom]) {
        const ring = [
          [0.02, 0.02, z],
          [0.98, 0.02, z],
          [0.98, 0.98, z],
          [0.02, 0.98, z],
          [0.02, 0.02, z]
        ].map((p) => L(p[0], p[1], p[2]))
        addLine(b, ring, color)
      }
    }
    // 四角立柱，形成三维地层框架
    for (const [cx, cy] of [
      [0.02, 0.02],
      [0.98, 0.02],
      [0.98, 0.98],
      [0.02, 0.98]
    ]) {
      addLine(b, [L(cx, cy, 1), L(cx, cy, 0)], [0.55, 0.68, 0.85])
    }
  }

  function addFlowArrows(b: LineBuilder): void {
    const z = depthZ(config.waterTableM)
    const len = 0.16
    for (let gy = 0.2; gy <= 0.8; gy += 0.2) {
      for (let gx = 0.2; gx <= 0.8; gx += 0.3) {
        const ex = gx + Math.cos(flowRad) * len
        const ey = gy + Math.sin(flowRad) * len
        addLine(b, [L(gx, gy, z), L(ex, ey, z)], FLOW_RGB)
        const bx = ex - Math.cos(flowRad - 0.5) * 0.05
        const by = ey - Math.sin(flowRad - 0.5) * 0.05
        const bx2 = ex - Math.cos(flowRad + 0.5) * 0.05
        const by2 = ey - Math.sin(flowRad + 0.5) * 0.05
        addLine(b, [L(ex, ey, z), L(bx, by, z)], FLOW_RGB)
        addLine(b, [L(ex, ey, z), L(bx2, by2, z)], FLOW_RGB)
      }
    }
  }

  function addWells(b: LineBuilder): void {
    for (const w of config.wells) {
      const color = hexToRgb(WELL_COLORS[w.kind] ?? '#65d3eb')
      // 井管（地表 → 孔底）
      addLine(b, [L(w.x, w.y, 1), L(w.x, w.y, depthZ(w.depth))], [color[0] * 0.5, color[1] * 0.5, color[2] * 0.5])
      // 筛管区间（高亮）
      addLine(b, [L(w.x, w.y, depthZ(w.screenTop)), L(w.x, w.y, depthZ(w.screenBottom))], color)
    }
  }

  function addCapture(b: LineBuilder, timeStep: number): void {
    if (!extractWell) return
    const radius = config.captureRadiusM / config.domainSizeM
    const bandC = 0.5 * (extractWell.screenTop + extractWell.screenBottom)
    const grow = timeStep >= config.captureStartStep ? 1 + 0.06 * (timeStep - config.captureStartStep) : 1
    const zLevels = [extractWell.screenTop, bandC, extractWell.screenBottom]
    for (const m of zLevels) {
      const z = depthZ(m)
      const ring: number[][] = []
      for (let a = 0; a <= 32; a += 1) {
        const ang = (a / 32) * Math.PI * 2
        ring.push(L(extractWell.x + Math.cos(ang) * radius * grow, extractWell.y + Math.sin(ang) * radius * grow, z))
      }
      addLine(b, ring, CAPTURE_RGB)
    }
    // 抽采影响半径的竖向轮廓，突出捕获体积
    const zTop = depthZ(extractWell.screenTop)
    const zBottom = depthZ(extractWell.screenBottom)
    for (let a = 0; a < 4; a += 1) {
      const ang = (a / 4) * Math.PI * 2
      const x = extractWell.x + Math.cos(ang) * radius * grow
      const y = extractWell.y + Math.sin(ang) * radius * grow
      addLine(b, [L(x, y, zTop), L(x, y, zBottom)], [CAPTURE_RGB[0] * 0.6, CAPTURE_RGB[1] * 0.6, CAPTURE_RGB[2] * 0.6])
    }
  }

  function rebuildLines(state: PlumeOverlayState): void {
    const b = newBuilder()
    if (state.aquifersVisible) addAquiferSkeleton(b)
    if (state.wellsVisible) addWells(b)
    if (state.captureVisible) addCapture(b, state.timeStep ?? 0)
    if (state.flowVisible && !state.flowLines) addFlowArrows(b)
    const base = finish(b)
    // 地质骨架 / 井管 / 捕获环：独立 base 层，纯色 + 稳定线宽
    engine.setLines(base.positions.length ? base : undefined, { layer: 'base', width: 1.5, alphaStart: 0.72, alphaEnd: 0.88 })

    // 地下水流线：体内折线会被不透明体数据遮挡，改用“顶部点串”直绘于体数据之上，
    // 以沿线渐变的点径 / 透明度表达由尾到头的流向，保证各含水层流线始终可见。
    const flow = state.flowVisible && state.flowLines && state.flowLines.positions.length ? state.flowLines : null
    engine.setFlowBeads(flow ?? undefined, {
      speedPalette: 'flow',
      speedMin: 0.3,
      speedMax: 1.3,
      pixelSize: 3.0,
      stride: 2
    })
  }

  function drawWells(state: PlumeOverlayState): void {
    if (!state.wellsVisible) {
      engine.clearOverlayPoints()
      return
    }
    const points = config.wells.map((w) => {
      const active = w.id === state.activeWellId
      return {
        position: engine.localFromNormalized(w.x, w.y, 1),
        color: Color.fromCssColorString(WELL_COLORS[w.kind] ?? '#65d3eb').withAlpha(active ? 1 : 0.9),
        pixelSize: active ? 13 : 9,
        label: `${w.id}`,
        labelColor: active ? Color.WHITE : Color.fromCssColorString('#cfe5ff')
      }
    })
    engine.setOverlayPoints(points)
  }

  // 分层地质体：按含水层 / 弱透水层的埋深区间构建半透明盒体，直观呈现地层结构
  const levelBodies = config.aquifers.map((a) => ({
    minX: 0.02,
    maxX: 0.98,
    minY: 0.02,
    maxY: 0.98,
    minZ: depthZ(a.bottom),
    maxZ: depthZ(a.top),
    color: hexToRgb(a.color),
    opacity: a.opacity
  }))
  engine.setLevelBodies(levelBodies, lastState.aquiferBodiesVisible, lastState.aquiferBodiesOpacity)
  engine.setLevelBodiesOpacity(lastState.aquiferBodiesOpacity)

  return {
    update(state: PlumeOverlayState): void {
      lastState = { ...lastState, ...state }
      rebuildLines(lastState)
      drawWells(lastState)
      engine.setLevelBodiesVisible(lastState.aquiferBodiesVisible)
      engine.setLevelBodiesOpacity(lastState.aquiferBodiesOpacity)
    },
    destroy(): void {
      engine.setLines(undefined, { layer: 'base' })
      engine.clearFlowBeads()
      engine.clearLevelBodies()
      engine.clearOverlayPoints()
    }
  }
}

export { WELL_LABELS, WELL_COLORS }
