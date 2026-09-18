import { Color, PointPrimitiveCollection, type Primitive } from 'cesium'
import {
  BD,
  BW,
  BASE_Y,
  SLIDE_HALFW,
  SLIDE_STAGES,
  SLIDE_DEEP,
  ZA,
  ZAP,
  ZB,
  ZC0,
  landslideColor,
  slideS,
  slideSurf,
  slideThick,
  slideTopAt,
  smooth,
  terrainH
} from '../geo-hazard-lib/model'
import {
  HazardCesiumBase,
  clampByte,
  type CesiumHazardCallbacks,
  type GridData,
  type HazardBox
} from '../geo-hazard-lib/cesium-base'

export { SLIDE_STAGES as STAGES } from '../geo-hazard-lib/model'

/** 场景锚点：岷江上游叠溪一带的高山峡谷区 */
const ORIGIN_LON = 103.72
const ORIGIN_LAT = 32.06
/** 模型单位 → 米 */
const S = 10

const GNX = 52
const GNZ = 56
const BNX = 34
const BNZ = 46

/** 村庄房屋尺寸（模型单位） */
const HOUSE_W = 3.2
const HOUSE_H = 2.6
const HOUSE_D = 2.8

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
 * 滑坡 Cesium 演示：以解析式圈椅状斜坡为地形，滑体沿滑动面整体变形下滑，
 * 并在高速段解体；叠加裂缝、滑体碎屑与坡脚村庄、防治工程标注。
 */
export class LandslideCesiumScene extends HazardCesiumBase {
  private debris!: PointPrimitiveCollection
  private village?: Primitive
  private eng?: Primitive
  private readonly housePos: { x: number; z: number; baseY: number }[] = []
  private readonly houseBury: number[] = []
  private readonly boulderSeeds: { x: number; zl: number; sc: number }[] = []
  private curS = 0
  private lastBodyS = Number.NaN
  private lastEng = false
  private lastBodyTime = -1

  constructor(container: HTMLElement, callbacks: CesiumHazardCallbacks = {}) {
    super(
      container,
      { stages: SLIDE_STAGES, lon: ORIGIN_LON, lat: ORIGIN_LAT, scale: S, yShift: 0 },
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
      terrainH,
      (x, z, y, out) => {
        landslideColor(x, z, y, out as [number, number, number])
        const sh = shadeOf(terrainH, x, z)
        out[0] = gamma(out[0] * sh)
        out[1] = gamma(out[1] * sh)
        out[2] = gamma(out[2] * sh)
      },
      BASE_Y
    )
    this.setPrimitive('terrain', this.makePrimitive(g, false))

    for (let i = 0; i < 40; i += 1) {
      this.boulderSeeds.push({
        x: (Math.random() - 0.5) * SLIDE_HALFW * 1.7,
        zl: ZA + Math.random() * (ZB - ZA),
        sc: 0.6 + Math.random() * 1.1
      })
    }
    this.debris = new PointPrimitiveCollection()
    for (let i = 0; i < this.boulderSeeds.length; i += 1) {
      this.debris.add({
        position: this.toWorld(0, 0, 0),
        color: Color.fromCssColorString('#a9927a'),
        pixelSize: 3,
        outlineColor: Color.fromCssColorString('#3a3026').withAlpha(0.6),
        outlineWidth: 1
      })
    }
    this.debris.show = false
    this.viewer.scene.primitives.add(this.debris)

    this.buildVillage()
    this.buildEngineering()
    this.buildLabels()
  }

  private buildVillage(): void {
    const spots: [number, number][] = [
      [-7.5, 15.5],
      [-2.5, 16.4],
      [2.6, 15.8],
      [7.4, 16.6],
      [-5.0, 19.2],
      [4.0, 19.6]
    ]
    for (const [x, z] of spots) {
      this.housePos.push({ x, z, baseY: Math.max(terrainH(x, z), 0.06) })
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
    const zc = ZA - 3.4
    for (let i = 0; i < 14; i += 1) {
      const x = -14 + (28 * i) / 13
      const g = Math.max(terrainH(x, zc), 0.06)
      boxes.push({ x, y: g + 0.28, z: zc, w: 1.6, h: 0.55, d: 1.3, color: '#9aa3ab' })
    }
    for (let k = 0; k < 6; k += 1) {
      const px = -11 + k * 4.4
      const g = Math.max(terrainH(px, 3.2), 0.06)
      boxes.push({ x: px, y: g - 2.4, z: 3.2, w: 1.05, h: 8.2, d: 1.05, color: '#9aa3ab' })
    }
    for (let m = 0; m < 12; m += 1) {
      const wx = -13 + (26 * m) / 11
      const g = Math.max(terrainH(wx, 12.2), 0.06)
      boxes.push({ x: wx, y: g + 1.2, z: 12.2, w: 1.8, h: 3.4, d: 1.1, color: '#8d969e' })
    }
    this.eng = this.makeBoxes(boxes)
    this.eng.show = false
    this.viewer.scene.primitives.add(this.eng)
  }

  private buildLabels(): void {
    const gold = '#f0b429'
    this.addLabels({
      'lb-body': { text: '滑坡体', color: gold, off: 4 },
      'lb-surf': { text: '滑动面（滑带）', color: gold, off: 3 },
      'lb-wall': { text: '滑坡壁', color: gold, off: 4 },
      'lb-tongue': { text: '滑坡舌', color: gold, off: 4 },
      'lb-crack': { text: '拉张裂缝', color: gold, off: 3 },
      'lb-bury': { text: '被掩埋的村庄', color: gold, off: 4 },
      'eg-drain': { text: '截排水沟', color: '#cfdae6', off: 3 },
      'eg-pile': { text: '抗滑桩', color: '#cfdae6', off: 5 },
      'eg-wall': { text: '抗滑挡墙', color: '#cfdae6', off: 5 }
    })
  }

  protected onEngineering(on: boolean): void {
    if (this.eng) this.eng.show = on
  }

  /** 滑体顶面 + 侧裙边构成的实体几何 */
  private slideGrid(s: number): GridData {
    const gw = BNX + 1
    const gh = BNZ + 1
    const top = gw * gh
    const boundary: number[] = []
    for (let i = 0; i < gw; i += 1) boundary.push(i)
    for (let j = 1; j < gh; j += 1) boundary.push(j * gw + gw - 1)
    for (let i = gw - 2; i >= 0; i -= 1) boundary.push((gh - 1) * gw + i)
    for (let j = gh - 2; j >= 1; j -= 1) boundary.push(j * gw)
    const vc = top + boundary.length
    const positions = new Float64Array(vc * 3)
    const colors = new Uint8Array(vc * 4)
    const x0 = -SLIDE_HALFW
    const dx = (2 * SLIDE_HALFW) / BNX
    const dz = (ZB - ZAP) / BNZ
    const topFn = (xx: number, zz: number): number => slideTopAt(xx, zz - s, s)
    for (let j = 0; j < gh; j += 1) {
      const zl = ZAP + j * dz
      for (let i = 0; i < gw; i += 1) {
        const x = x0 + i * dx
        const k = j * gw + i
        const y = topFn(x, zl + s)
        const p = this.toWorld(x, y, zl + s)
        positions[k * 3] = p.x
        positions[k * 3 + 1] = p.y
        positions[k * 3 + 2] = p.z
        const taper = slideThick(x, zl) / SLIDE_DEEP
        const sh = shadeOf(topFn, x, zl + s)
        colors[k * 4] = gamma((0.42 + 0.16 * (1 - taper)) * sh)
        colors[k * 4 + 1] = gamma((0.31 + 0.12 * (1 - taper)) * sh)
        colors[k * 4 + 2] = gamma((0.2 + 0.08 * (1 - taper)) * sh)
        colors[k * 4 + 3] = 255
      }
    }
    for (let b = 0; b < boundary.length; b += 1) {
      const src = boundary[b]
      const k = top + b
      const x = x0 + (src % gw) * dx
      const zl = ZAP + Math.floor(src / gw) * dz
      const p = this.toWorld(x, slideSurf(x, zl + s), zl + s)
      positions[k * 3] = p.x
      positions[k * 3 + 1] = p.y
      positions[k * 3 + 2] = p.z
      colors[k * 4] = (colors[src * 4] * 0.6) | 0
      colors[k * 4 + 1] = (colors[src * 4 + 1] * 0.6) | 0
      colors[k * 4 + 2] = (colors[src * 4 + 2] * 0.6) | 0
      colors[k * 4 + 3] = 255
    }
    const indices = new Uint32Array(BNX * BNZ * 6 + boundary.length * 6)
    let o = 0
    for (let j = 0; j < BNZ; j += 1) {
      for (let i = 0; i < BNX; i += 1) {
        const a = j * gw + i
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
    for (let b = 0; b < boundary.length; b += 1) {
      const t0 = boundary[b]
      const t1 = boundary[(b + 1) % boundary.length]
      const b0 = top + b
      const b1 = top + ((b + 1) % boundary.length)
      indices[o] = t0
      indices[o + 1] = b0
      indices[o + 2] = t1
      indices[o + 3] = t1
      indices[o + 4] = b0
      indices[o + 5] = b1
      o += 6
    }
    return { positions, colors, indices, vertexCount: vc }
  }

  protected update(p: number, _dt: number): void {
    let s = slideS(p)
    if (this.state.eng) s = 0
    this.curS = s
    const needBody =
      Number.isNaN(this.lastBodyS) ||
      this.state.eng !== this.lastEng ||
      (Math.abs(s - this.lastBodyS) > 0.015 && this.time - this.lastBodyTime > 0.07)
    if (needBody) {
      this.setPrimitive('body', this.makePrimitive(this.slideGrid(s), false))
      this.lastBodyS = s
      this.lastEng = this.state.eng
      this.lastBodyTime = this.time
    }

    const dis = this.state.eng ? 0 : smooth(0.36, 0.6, p)
    const visible = dis > 0.02
    this.debris.show = visible
    if (visible) {
      const zFront = ZB + s - 1.5
      for (let i = 0; i < this.boulderSeeds.length; i += 1) {
        const sd = this.boulderSeeds[i]
        const zz = zFront + ((i % 7) + 1) * dis * 1.4
        const xx = sd.x * (0.6 + 0.4 * dis)
        const yy = Math.max(terrainH(xx, zz), 0.06) + 0.5
        const pt = this.debris.get(i)
        if (pt) {
          pt.position = this.toWorld(xx, yy, zz)
          pt.pixelSize = 2.5 + sd.sc * dis * 3.5
        }
      }
    }

    let dirty = false
    for (let h = 0; h < this.housePos.length; h += 1) {
      const hp = this.housePos[h]
      const bur = smooth(ZB + s + 1.5, ZB + s - 3.5, hp.z) * smooth(0.5, 0.72, p) * 1.5
      if (Math.abs(bur - this.houseBury[h]) > 0.02) dirty = true
      this.houseBury[h] = bur
    }
    if (dirty) this.rebuildVillage()
    this.applyLabels(p, s, dis)
  }

  private applyLabels(p: number, s: number, dis: number): void {
    const on = this.state.labels
    this.showLabel('lb-body', on)
    this.showLabel('lb-surf', on)
    this.showLabel('lb-wall', on && s > 1.4)
    this.showLabel('lb-tongue', on && p > 0.3)
    this.showLabel('lb-crack', on && p > 0.05)
    this.showLabel('lb-bury', on && dis > 0.3)
    this.showLabel('eg-drain', on && this.state.eng)
    this.showLabel('eg-pile', on && this.state.eng)
    this.showLabel('eg-wall', on && this.state.eng)

    this.setLabelPos('lb-body', 0, slideTopAt(0, ZC0, s) + 1, ZC0 + s)
    this.setLabelPos('lb-surf', -10.5, slideSurf(-10.5, -6 + s) + 1, -6 + s)
    this.setLabelPos('lb-wall', 0, Math.max(slideSurf(0, ZA + s), 0) + 1, ZA + s)
    this.setLabelPos('lb-tongue', 0, slideTopAt(0, ZB - 0.6, s) + 1, Math.min(ZB + s + 0.8, 21.5))
    this.setLabelPos('lb-crack', 9.5, Math.max(terrainH(9.5, ZA - 4.6), 0) + 1, ZA - 4.6)
    this.setLabelPos('lb-bury', 0, Math.max(terrainH(0, 17.5), 0) + 1, 17.5)
    this.setLabelPos('eg-drain', 0, Math.max(terrainH(0, ZA - 3.4), 0) + 1, ZA - 3.4)
    this.setLabelPos('eg-pile', -5, Math.max(terrainH(-5, 3.2), 0) + 1.5, 3.2)
    this.setLabelPos('eg-wall', 8, Math.max(terrainH(8, 12.2), 0) + 1.5, 12.2)
  }

  setViewPreset(id = 3): void {
    if (id === 1) this.applyView([0, 210, 30], [0, 6, 0])
    else if (id === 2) this.applyView([6, 78, 168], [0, 8, 0])
    else if (id === 4) this.applyView([-156, 52, 6], [6, 8, 0])
    else this.applyView([-40, 120, 150], [0, 8, -6])
  }
}
