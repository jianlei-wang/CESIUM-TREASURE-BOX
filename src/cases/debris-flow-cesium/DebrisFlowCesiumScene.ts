import { Color, PointPrimitiveCollection, type Primitive } from 'cesium'
import {
  BD,
  BW,
  BASE_Y,
  DEBRIS_STAGES,
  debrisColor,
  debrisFront,
  fanGrow,
  pathBed,
  pathWidth,
  pathX,
  pathZ,
  smooth,
  valleyH
} from '../geo-hazard-lib/model'
import {
  HazardCesiumBase,
  clampByte,
  type CesiumHazardCallbacks,
  type GridData,
  type HazardBox
} from '../geo-hazard-lib/cesium-base'

export { DEBRIS_STAGES as STAGES } from '../geo-hazard-lib/model'

const ORIGIN_LON = 103.72
const ORIGIN_LAT = 32.06
const S = 10

const GNX = 54
const GNZ = 58
const FLOW_N = 96
const FLOW_M = 6
const DAM_T = 0.46

/** 村庄房屋尺寸（模型单位） */
const HOUSE_W = 3.2
const HOUSE_H = 2.6
const HOUSE_D = 2.8
/** 堆积扇扇形半径（模型单位，与 Three.js 版一致） */
const FAN_RX = 15
const FAN_RZ = 12

function gamma(v: number): number {
  return clampByte(255 * Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2))
}

function shadeOf(fn: (x: number, z: number) => number, x: number, z: number): number {
  const e = 1.1
  const hx = fn(x + e, z) - fn(x - e, z)
  const hz = fn(x, z + e) - fn(x, z - e)
  const nx = -hx / (2 * e)
  const ny = 1
  const nz = -hz / (2 * e)
  const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz)
  const d = (nx * -0.42 + ny * 0.8 + nz * 0.44) * inv
  return 0.5 + 0.5 * Math.max(0, Math.min(1, d))
}

/**
 * 泥石流 Cesium 演示：以解析式沟谷地形为底，龙头裹挟泥浆石块沿沟道阵性下泄，
 * 沟口堆积扇逐渐扩展并威胁村庄，叠加物源松散体与防治工程。
 */
export class DebrisFlowCesiumScene extends HazardCesiumBase {
  private boulders!: PointPrimitiveCollection
  private fan?: Primitive
  private village?: Primitive
  private eng?: Primitive
  private readonly housePos: { x: number; z: number; baseY: number }[] = []
  private readonly houseBury: number[] = []
  private readonly flowBase: { x: number; w: number; z: number }[] = []
  private readonly boulderSeeds: { t: number; lat: number; sc: number }[] = []
  private curFront = 0
  private lastFlowFront = Number.NaN
  private lastEng = false
  private lastFlowTime = -1
  private lastFan = -1
  private lastFanEng = false

  constructor(container: HTMLElement, callbacks: CesiumHazardCallbacks = {}) {
    super(
      container,
      { stages: DEBRIS_STAGES, lon: ORIGIN_LON, lat: ORIGIN_LAT, scale: S, yShift: 0 },
      callbacks
    )
    this.bootstrap()
  }

  protected buildScene(): void {
    const g = this.buildGrid(
      GNX,
      GNZ,
      -BW / 2,
      -BD / 2,
      BW / GNX,
      BD / GNZ,
      valleyH,
      (x, z, y, out) => {
        debrisColor(x, z, y, out as [number, number, number])
        const sh = shadeOf(valleyH, x, z)
        out[0] = gamma(out[0] * sh)
        out[1] = gamma(out[1] * sh)
        out[2] = gamma(out[2] * sh)
      },
      BASE_Y
    )
    this.setPrimitive('terrain', this.makePrimitive(g, false))

    for (let k = 0; k <= FLOW_N; k += 1) {
      const t = k / FLOW_N
      this.flowBase.push({ x: pathX(t), w: pathWidth(t), z: pathZ(t) })
    }

    for (let i = 0; i < 30; i += 1) {
      this.boulderSeeds.push({ t: 0.02 + Math.random() * 0.9, lat: (Math.random() - 0.5) * 1.4, sc: 0.5 + Math.random() * 0.9 })
    }
    this.boulders = new PointPrimitiveCollection()
    for (let i = 0; i < this.boulderSeeds.length; i += 1) {
      this.boulders.add({
        position: this.toWorld(0, 0, 0),
        color: Color.fromCssColorString('#8c7d68'),
        pixelSize: 3,
        outlineColor: Color.fromCssColorString('#3a3026').withAlpha(0.6),
        outlineWidth: 1
      })
    }
    this.boulders.show = true
    this.viewer.scene.primitives.add(this.boulders)

    this.buildFan()
    this.buildVillage()
    this.buildEngineering()
    this.buildLabels()
  }

  private buildFan(): void {
    this.fan = this.makePrimitive(this.fanGrid(0), true)
    this.fan.show = false
    this.viewer.scene.primitives.add(this.fan)
  }

  /** 沟口堆积扇：与 Three.js 版一致的扇形（半椭圆扇面），随进度向外扩展 */
  private fanGrid(grow: number): GridData {
    const seg = 30
    const rings = 5
    const fx = pathX(1)
    const fz = pathZ(1) - 1.5
    const fy = pathBed(1) - 0.3
    const scl = 0.28 + grow
    const cols = seg + 1
    const vc = 1 + rings * cols
    const positions = new Float64Array(vc * 3)
    const colors = new Uint8Array(vc * 4)
    const indices = new Uint32Array(seg * 3 + (rings - 1) * seg * 6)
    const put = (idx: number, lx: number, ly: number, lz: number, t: number, shade: number): void => {
      const p = this.toWorld(fx + lx, fy + ly, fz + lz)
      positions[idx * 3] = p.x
      positions[idx * 3 + 1] = p.y
      positions[idx * 3 + 2] = p.z
      const k = (0.86 + 0.14 * (1 - t)) * shade
      colors[idx * 4] = gamma(0.702 * k)
      colors[idx * 4 + 1] = gamma(0.627 * k)
      colors[idx * 4 + 2] = gamma(0.494 * k)
      colors[idx * 4 + 3] = clampByte(255 * (0.94 - 0.46 * t))
    }
    put(0, 0, 0.12, 0, 0, 1)
    for (let r = 0; r < rings; r += 1) {
      const rr = (r + 1) / rings
      for (let i = 0; i <= seg; i += 1) {
        const a = -Math.PI * 0.52 + (Math.PI * 1.04 * i) / seg
        const rise = Math.cos(a * 1.7)
        const lx = Math.sin(a) * rr * FAN_RX * scl
        const lz = Math.cos(a) * rr * FAN_RZ * scl
        const ly = (0.12 + 0.26 * rise) * rr
        put(1 + r * cols + i, lx, ly, lz, rr, 0.86 + 0.18 * rise)
      }
    }
    let o = 0
    for (let i = 0; i < seg; i += 1) {
      indices[o] = 0
      indices[o + 1] = 1 + i
      indices[o + 2] = 2 + i
      o += 3
    }
    for (let r = 0; r < rings - 1; r += 1) {
      for (let i = 0; i < seg; i += 1) {
        const a = 1 + r * cols + i
        const b = a + 1
        const c = a + cols
        const d = c + 1
        indices[o] = a
        indices[o + 1] = c
        indices[o + 2] = b
        indices[o + 3] = b
        indices[o + 4] = c
        indices[o + 5] = d
        o += 6
      }
    }
    return { positions, colors, indices, vertexCount: vc }
  }

  private rebuildFan(grow: number): void {
    if (this.fan) this.viewer.scene.primitives.remove(this.fan)
    this.fan = this.makePrimitive(this.fanGrid(grow), true)
    this.fan.show = grow > 0.02
    this.viewer.scene.primitives.add(this.fan)
  }

  private buildVillage(): void {
    const cx = pathX(1)
    const spots: [number, number][] = [
      [cx - 6.5, 19.5],
      [cx - 2.5, 20.8],
      [cx + 2.6, 20.2],
      [cx + 6.8, 21.4],
      [cx - 4.4, 23.4],
      [cx + 4.6, 23.8]
    ]
    for (const [x, z] of spots) {
      this.housePos.push({ x, z, baseY: Math.max(valleyH(x, z), 0.06) })
      this.houseBury.push(0)
    }
    this.village = this.makeBoxes(this.houseBoxes())
    this.viewer.scene.primitives.add(this.village)
  }

  private houseBoxes(): HazardBox[] {
    return this.housePos.map((hp, i) => ({
      x: hp.x,
      y: hp.baseY + HOUSE_H / 2 - this.houseBury[i],
      z: hp.z,
      w: HOUSE_W,
      h: HOUSE_H,
      d: HOUSE_D,
      color: '#d8d2c4'
    }))
  }

  private rebuildVillage(): void {
    if (this.village) this.viewer.scene.primitives.remove(this.village)
    this.village = this.makeBoxes(this.houseBoxes())
    this.viewer.scene.primitives.add(this.village)
  }

  private buildEngineering(): void {
    const boxes: HazardBox[] = []
    for (const tt of [DAM_T, 0.3]) {
      boxes.push({
        x: pathX(tt),
        y: pathBed(tt) + 1.8,
        z: pathZ(tt),
        w: pathWidth(tt) * 1.5,
        h: 3.6,
        d: 1.5,
        color: '#9aa3ab'
      })
    }
    const cx = pathX(1)
    for (const side of [-1, 1]) {
      const gx = cx + side * 3.4
      boxes.push({
        x: gx,
        y: Math.max(valleyH(gx, 19), 0.06) + 1.1,
        z: 19,
        w: 1,
        h: 2.2,
        d: 10,
        color: '#9aa3ab'
      })
    }
    const fz = pathZ(0.86)
    boxes.push({
      x: pathX(0.86),
      y: Math.max(valleyH(pathX(0.86), fz), 0.06) + 0.25,
      z: fz,
      w: 9,
      h: 0.5,
      d: 7,
      color: '#8d969e'
    })
    this.eng = this.makeBoxes(boxes)
    this.eng.show = false
    this.viewer.scene.primitives.add(this.eng)
  }

  private buildLabels(): void {
    const teal = '#5fbfa8'
    this.addLabels({
      'db-source': { text: '形成区（物源区）', color: teal, off: 4 },
      'db-channel': { text: '流通区（沟道）', color: teal, off: 4 },
      'db-head': { text: '龙头', color: teal, off: 4 },
      'db-surge': { text: '阵流（波状流）', color: teal, off: 3 },
      'db-fan': { text: '堆积扇', color: teal, off: 4 },
      'db-boulder': { text: '漂砾', color: teal, off: 3 },
      'db-village': { text: '沟口村庄', color: teal, off: 4 },
      'eg-dam': { text: '拦挡坝（谷坊）', color: '#cfdae6', off: 5 },
      'eg-groove': { text: '排导槽', color: '#cfdae6', off: 4 },
      'eg-field': { text: '停淤场', color: '#cfdae6', off: 4 }
    })
  }

  protected onEngineering(on: boolean): void {
    if (this.eng) this.eng.show = on
  }

  private flowHeight(t: number, front: number): number {
    if (t >= front) return 0
    const lead = smooth(0, 0.03, front - t)
    const tail = smooth(0, 0.05, t)
    const surge = 0.72 + 0.28 * Math.sin((front - t) * 52.0)
    const headBulge = 1 + 1.0 * Math.exp(-Math.pow((front - t) / 0.03, 2))
    return 2.3 * lead * tail * surge * headBulge * (0.72 + 0.28 * (1 - t))
  }

  private flowGrid(front: number, muddy: number): GridData {
    const gw = FLOW_M + 1
    const positions = new Float64Array((FLOW_N + 1) * gw * 3)
    const colors = new Uint8Array((FLOW_N + 1) * gw * 4)
    const indices = new Uint32Array(FLOW_N * FLOW_M * 6)
    let o = 0
    for (let k = 0; k < FLOW_N; k += 1) {
      for (let j = 0; j < FLOW_M; j += 1) {
        const a = k * gw + j
        const b = a + 1
        const c = a + gw
        const d = c + 1
        indices[o] = a
        indices[o + 1] = c
        indices[o + 2] = b
        indices[o + 3] = b
        indices[o + 4] = c
        indices[o + 5] = d
        o += 6
      }
    }
    const cr = 0.34 + 0.06 * (1 - muddy)
    const cg = 0.2 + 0.04 * (1 - muddy)
    const cb = 0.08 + 0.24 * (1 - muddy)
    for (let k = 0; k <= FLOW_N; k += 1) {
      const base = this.flowBase[k]
      const t = k / FLOW_N
      const h = front > 0 ? this.flowHeight(t, front) : 0
      for (let j = 0; j <= FLOW_M; j += 1) {
        const lat = -1 + (2 * j) / FLOW_M
        const x = base.x + lat * base.w * 0.94
        const crown = Math.sqrt(Math.max(0, 1 - lat * lat))
        const y = valleyH(x, base.z) + (h > 0.001 ? h * crown : -0.85)
        const idx = k * gw + j
        const p = this.toWorld(x, y, base.z)
        positions[idx * 3] = p.x
        positions[idx * 3 + 1] = p.y
        positions[idx * 3 + 2] = p.z
        colors[idx * 4] = gamma(cr)
        colors[idx * 4 + 1] = gamma(cg)
        colors[idx * 4 + 2] = gamma(cb)
        colors[idx * 4 + 3] = 255
      }
    }
    return { positions, colors, indices, vertexCount: (FLOW_N + 1) * gw }
  }

  protected update(p: number, _dt: number): void {
    const muddy = smooth(0.1, 0.34, p)
    const front = this.state.eng ? Math.min(debrisFront(p), DAM_T - 0.01) : debrisFront(p)
    this.curFront = front

    const needFlow =
      Number.isNaN(this.lastFlowFront) ||
      this.state.eng !== this.lastEng ||
      (Math.abs(front - this.lastFlowFront) > 0.008 && this.time - this.lastFlowTime > 0.07)
    if (needFlow) {
      this.setPrimitive('flow', this.makePrimitive(this.flowGrid(front, muddy), true))
      this.lastFlowFront = front
      this.lastEng = this.state.eng
      this.lastFlowTime = this.time
    }

    for (let i = 0; i < this.boulderSeeds.length; i += 1) {
      const sd = this.boulderSeeds[i]
      let bt = sd.t
      if (this.state.eng) bt = Math.min(sd.t, DAM_T - 0.02)
      else if (front > sd.t) bt = Math.max(0, front - 0.02 - (i % 5) * 0.016)
      const bx = pathX(bt) + sd.lat * pathWidth(bt) * 0.7
      const by = Math.max(valleyH(bx, pathZ(bt)), 0.06) + 0.34
      const pt = this.boulders.get(i)
      if (pt) {
        pt.position = this.toWorld(bx, by, pathZ(bt))
        pt.pixelSize = 2.5 + sd.sc * 3
      }
    }

    const fan = this.state.eng ? 0 : fanGrow(p)
    if (Math.abs(fan - this.lastFan) > 0.02 || this.state.eng !== this.lastFanEng) {
      this.rebuildFan(fan)
      this.lastFan = fan
      this.lastFanEng = this.state.eng
    }
    if (this.fan) this.fan.show = fan > 0.02

    let dirty = false
    for (let h = 0; h < this.housePos.length; h += 1) {
      const hp = this.housePos[h]
      const bur = smooth(18, 20.5, hp.z) * fan * 2.0
      if (Math.abs(bur - this.houseBury[h]) > 0.02) dirty = true
      this.houseBury[h] = bur
    }
    if (dirty) this.rebuildVillage()

    this.applyLabels(p, front)
  }

  private applyLabels(p: number, front: number): void {
    const on = this.state.labels
    this.showLabel('db-source', on)
    this.showLabel('db-channel', on)
    this.showLabel('db-head', on && front > 0.02 && front < 0.995)
    this.showLabel('db-surge', on && front > 0.25)
    this.showLabel('db-fan', on && front > 0.9)
    this.showLabel('db-boulder', on && p > 0.24)
    this.showLabel('db-village', on && p > 0.4)
    this.showLabel('eg-dam', on && this.state.eng)
    this.showLabel('eg-groove', on && this.state.eng)
    this.showLabel('eg-field', on && this.state.eng)

    this.setLabelPos('db-source', -9, Math.max(valleyH(-9, pathZ(0)), 0) + 1, pathZ(0))
    this.setLabelPos('db-channel', 11, Math.max(valleyH(11, -4), 0) + 1, -4)
    this.setLabelPos('db-head', pathX(front), pathBed(front) + 1, pathZ(front))
    const bt = Math.max(0, front - 0.14)
    this.setLabelPos('db-surge', pathX(bt) - pathWidth(bt) * 0.8, pathBed(bt) + 1, pathZ(bt))
    this.setLabelPos('db-fan', pathX(1) + 5, pathBed(1) + 1, pathZ(1) + 3)
    this.setLabelPos('db-boulder', -4, Math.max(valleyH(-4, 2), 0) + 1, 2)
    this.setLabelPos('db-village', pathX(1), Math.max(valleyH(pathX(1), 22.5), 0) + 1, 22.5)
    this.setLabelPos('eg-dam', pathX(DAM_T), pathBed(DAM_T) + 2, pathZ(DAM_T))
    this.setLabelPos('eg-groove', pathX(1) + 3.4, Math.max(valleyH(pathX(1) + 3.4, 19), 0) + 1, 19)
    this.setLabelPos('eg-field', pathX(0.86), Math.max(valleyH(pathX(0.86), pathZ(0.86)), 0) + 1, pathZ(0.86))
  }

  setViewPreset(id = 3): void {
    if (id === 1) this.applyView([0, 230, 30], [0, 6, 0])
    else if (id === 2) this.applyView([8, 84, 176], [0, 8, 0])
    else if (id === 4) this.applyView([-150, 56, 10], [6, 8, 0])
    else this.applyView([-44, 126, 156], [0, 8, -4])
  }
}
