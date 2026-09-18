import {
  Appearance,
  ArcType,
  BlendingState,
  BoundingSphere,
  BoxEmitter,
  CallbackPositionProperty,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Color,
  ComponentDatatype,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  GeometryInstance,
  LabelStyle,
  Matrix3,
  Matrix4,
  ParticleSystem,
  PointPrimitiveCollection,
  Primitive,
  PrimitiveType,
  Quaternion,
  Transforms,
  VerticalOrigin,
  type Entity,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery } from '../../lib/cesium-scene'
import {
  DAM_X,
  DX,
  DXW,
  DZ,
  DZW,
  LX,
  LZ,
  NX,
  NXW,
  NZ,
  NZW,
  PKEYS,
  STEPS,
  backwaterX,
  bed,
  terrainColor,
  terrainH,
  waterY,
  type PKey
} from '../barrier-lake-lib/model'

export { STEP_COUNT, STEP_META, type BarrierLakeStepMeta } from '../barrier-lake-lib/model'

export interface BarrierLakeCesiumCallbacks {
  onStepChange: (index: number) => void
  onReady?: () => void
}

/** 模型单位 → 米 */
const S = 10
/** 峡谷所锚定的经纬度（岷江上游叠溪一带的高山峡谷区） */
const ORIGIN_LON = 103.72
const ORIGIN_LAT = 32.06
/** 让最低河床贴合椭球面，避免地形沉入地下 */
const Y_SHIFT = 9.9
const BASE_Y = -2.4

const GW = NX + 1
const GH = NZ + 1
const GW_W = NXW + 1
const GH_W = NZW + 1

function yOf(x: number, z: number, dam: number, breach: number, slide = 0): number {
  return terrainH(x, z, dam, breach, slide) + Y_SHIFT
}

const terrainAppearanceVS = `
in vec3 position3DHigh;
in vec3 position3DLow;
in float batchId;
in vec4 color;
out vec4 v_color;
void main()
{
  vec4 position = czm_translateRelativeToEye(position3DHigh, position3DLow);
  v_color = color;
  gl_Position = czm_modelViewProjectionRelativeToEye * position;
}
`

const terrainAppearanceFS = `
in vec4 v_color;
void main()
{
  out_FragColor = v_color;
}
`

const waterAppearanceVS = `
in vec3 position3DHigh;
in vec3 position3DLow;
in float batchId;
in vec4 color;
in float aDepth;
in vec2 aLocal;
in float aAmp;
in float aFlow;
out vec4 v_color;
out float v_depth;
out vec2 v_local;
out float v_amp;
out float v_flow;
void main()
{
  vec4 position = czm_translateRelativeToEye(position3DHigh, position3DLow);
  v_color = color;
  v_depth = aDepth;
  v_local = aLocal;
  v_amp = aAmp;
  v_flow = aFlow;
  gl_Position = czm_modelViewProjectionRelativeToEye * position;
}
`

const waterAppearanceFS = `
in vec4 v_color;
in float v_depth;
in vec2 v_local;
in float v_amp;
in float v_flow;
void main()
{
  if (v_depth <= 0.03) {
    discard;
  }
  float dn = clamp(v_depth / 5.5, 0.0, 1.0);
  float t = czm_frameNumber * 0.016;
  float s = sin(v_local.x * 0.52 - t * (2.0 + v_flow * 7.0) + sin(v_local.y * 0.28) * 1.6);
  vec3 col = v_color.rgb + smoothstep(0.82, 1.0, s) * (0.10 + v_flow * 0.10);
  col += vec3(0.09) * pow(1.0 - dn, 3.0);
  out_FragColor = vec4(col, v_color.a);
}
`

interface DebrisData {
  sx: number
  sy: number
  sz: number
  ex: number
  ez: number
  eyOff: number
  dl: number
  hop: number
  x: number
  z: number
  y: number
}

interface LabelEntry {
  text: string
  color: string
  off: number
  cart: Cartesian3
  ground: Cartesian3
  show: boolean
  entity?: Entity
}

export class BarrierLakeCesiumScene {
  private viewer: Viewer
  private enu: Matrix4
  private callbacks: BarrierLakeCesiumCallbacks
  private flashEl: HTMLElement | null

  private terrainPrimitive: Primitive | undefined
  private waterPrimitive: Primitive | undefined
  private scarPrimitive: Primitive | undefined
  private debris: PointPrimitiveCollection
  private debrisData: DebrisData[] = []
  private foam: PointPrimitiveCollection
  private foamData: { x: number; z: number }[] = []
  private rain: ParticleSystem

  private labels: Record<string, LabelEntry> = {}
  private labelOn = true
  private spin = false
  private rainManual = false

  private st: Record<PKey, number>
  private fromSt: Record<PKey, number>
  private toSt: Record<PKey, number>
  private cur = 0
  private animT = 1
  private animDur = 1
  private playing = false
  private playTimer = 0

  private lastDam = Number.NaN
  private lastBreach = Number.NaN
  private lastSlide = Number.NaN
  private lastLevel = Number.NaN
  private lastScar = Number.NaN
  private rebuildAcc = 0
  private waterRelight = false

  private time = 0
  private last = performance.now()
  private rafId = 0
  private disposed = false
  private flashT = 0

  constructor(container: HTMLElement, callbacks: BarrierLakeCesiumCallbacks, flashEl: HTMLElement | null = null) {
    this.callbacks = callbacks
    this.flashEl = flashEl
    this.enu = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(ORIGIN_LON, ORIGIN_LAT, 0))

    this.viewer = createMapScene(container)
    loadBingImagery(this.viewer)

    this.debris = new PointPrimitiveCollection()
    this.viewer.scene.primitives.add(this.debris)
    this.buildDebris()

    this.foam = new PointPrimitiveCollection()
    this.viewer.scene.primitives.add(this.foam)
    this.buildFoam()

    this.rain = new ParticleSystem({
      image: makeRainImage(),
      imageSize: new Cartesian2(2.2, 18),
      startColor: Color.fromCssColorString('#aad8ef').withAlpha(0.6),
      endColor: Color.fromCssColorString('#aad8ef').withAlpha(0.0),
      minimumSpeed: 55,
      maximumSpeed: 90,
      minimumParticleLife: 0.55,
      maximumParticleLife: 0.95,
      emissionRate: 0,
      loop: true,
      emitter: new BoxEmitter(new Cartesian3(LX * S, 40, LZ * S)),
      modelMatrix: Matrix4.clone(this.enu),
      emitterModelMatrix: Matrix4.fromTranslation(new Cartesian3(0, 0, 620))
    })
    this.viewer.scene.primitives.add(this.rain)

    this.buildLabels()

    this.st = {} as Record<PKey, number>
    this.fromSt = {} as Record<PKey, number>
    this.toSt = {} as Record<PKey, number>
    for (const k of PKEYS) this.st[k] = STEPS[0].p[k]

    this.rebuildTerrain(0, 0, 0)
    this.rebuildWater(STEPS[0].p)
    this.rebuildScar(0)
    this.updateDebris(0, 0)

    this.gotoStep(0, true)
    this.setViewPreset(0)
    this.callbacks.onReady?.()
    this.rafId = requestAnimationFrame(this.frame)
  }

  private toWorld(x: number, y: number, z: number, result?: Cartesian3): Cartesian3 {
    const out = result ?? new Cartesian3()
    return Matrix4.multiplyByPoint(this.enu, new Cartesian3(x * S, z * S, y * S), out)
  }

  private shade(x: number, z: number, dam: number, breach: number, slide: number): number {
    const e = 1.6
    const hx = yOf(x + e, z, dam, breach, slide) - yOf(x - e, z, dam, breach, slide)
    const hz = yOf(x, z + e, dam, breach, slide) - yOf(x, z - e, dam, breach, slide)
    const nx = -hx / (2 * e)
    const ny = 1
    const nz = -hz / (2 * e)
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz)
    const d = (nx * -0.42 + ny * 0.78 + nz * 0.46) * inv
    return 0.52 + 0.48 * Math.max(0, Math.min(1, d))
  }

  private boundaryNodes(): number[] {
    const list: number[] = []
    for (let i = 0; i < GW; i += 1) list.push(i)
    for (let j = 1; j < GH; j += 1) list.push(j * GW + GW - 1)
    for (let i = GW - 2; i >= 0; i -= 1) list.push((GH - 1) * GW + i)
    for (let j = GH - 2; j >= 1; j -= 1) list.push(j * GW)
    return list
  }

  private rebuildTerrain(dam: number, breach: number, slide: number): void {
    const boundary = this.boundaryNodes()
    const topCount = GW * GH
    const vertCount = topCount + boundary.length
    const positions = new Float64Array(vertCount * 3)
    const colors = new Uint8Array(vertCount * 4)
    const rgb: number[] = [0, 0, 0]

    for (let j = 0; j < GH; j += 1) {
      for (let i = 0; i < GW; i += 1) {
        const k = j * GW + i
        const x = -LX / 2 + i * DX
        const z = -LZ / 2 + j * DZ
        const y = yOf(x, z, dam, breach, slide)
        const p = this.toWorld(x, y, z)
        positions[k * 3] = p.x
        positions[k * 3 + 1] = p.y
        positions[k * 3 + 2] = p.z
        terrainColor(x, z, terrainH(x, z, dam, breach, slide), dam, breach, slide, rgb)
        const sh = this.shade(x, z, dam, breach, slide)
        colors[k * 4] = clampByte(rgb[0] * sh)
        colors[k * 4 + 1] = clampByte(rgb[1] * sh)
        colors[k * 4 + 2] = clampByte(rgb[2] * sh)
        colors[k * 4 + 3] = 255
      }
    }

    for (let b = 0; b < boundary.length; b += 1) {
      const src = boundary[b]
      const k = topCount + b
      const x = -LX / 2 + (src % GW) * DX
      const z = -LZ / 2 + Math.floor(src / GW) * DZ
      const p = this.toWorld(x, BASE_Y, z)
      positions[k * 3] = p.x
      positions[k * 3 + 1] = p.y
      positions[k * 3 + 2] = p.z
      colors[k * 4] = clampByte((colors[src * 4] / 255) * 0.46)
      colors[k * 4 + 1] = clampByte((colors[src * 4 + 1] / 255) * 0.46)
      colors[k * 4 + 2] = clampByte((colors[src * 4 + 2] / 255) * 0.46)
      colors[k * 4 + 3] = 255
    }

    const surfaceIndices = NX * NZ * 6
    const skirtIndices = boundary.length * 6
    const indices = new Uint32Array(surfaceIndices + skirtIndices)
    let o = 0
    for (let j = 0; j < NZ; j += 1) {
      for (let i = 0; i < NX; i += 1) {
        const a = j * GW + i
        const b = a + 1
        const c = a + GW
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
      const b0 = topCount + b
      const b1 = topCount + ((b + 1) % boundary.length)
      indices[o] = t0
      indices[o + 1] = b0
      indices[o + 2] = t1
      indices[o + 3] = t1
      indices[o + 4] = b0
      indices[o + 5] = b1
      o += 6
    }

    const attributes = new GeometryAttributes()
    attributes.position = new GeometryAttribute({
      componentDatatype: ComponentDatatype.DOUBLE,
      componentsPerAttribute: 3,
      values: positions
    })
    attributes.color = new GeometryAttribute({
      componentDatatype: ComponentDatatype.UNSIGNED_BYTE,
      componentsPerAttribute: 4,
      normalize: true,
      values: colors
    })
    const geometry = new Geometry({
      attributes,
      indices,
      primitiveType: PrimitiveType.TRIANGLES,
      boundingSphere: BoundingSphere.fromVertices(positions)
    })
    const next = new Primitive({
      geometryInstances: new GeometryInstance({ geometry }),
      appearance: this.terrainAppearance(),
      asynchronous: false,
      allowPicking: false
    })
    if (this.terrainPrimitive) this.viewer.scene.primitives.remove(this.terrainPrimitive)
    this.terrainPrimitive = this.viewer.scene.primitives.add(next)

    this.lastDam = dam
    this.lastBreach = breach
    this.lastSlide = slide
    this.waterRelight = true
  }

  private terrainAppearance(): Appearance {
    return new Appearance({
      translucent: false,
      closed: false,
      renderState: {
        depthTest: { enabled: true },
        cull: { enabled: false },
        blending: BlendingState.DISABLED
      },
      vertexShaderSource: terrainAppearanceVS,
      fragmentShaderSource: terrainAppearanceFS
    })
  }

  private rebuildWater(p: Record<PKey, number>): void {
    const vertCount = GW_W * GH_W
    const positions = new Float64Array(vertCount * 3)
    const colors = new Uint8Array(vertCount * 4)
    const depth = new Float32Array(vertCount)
    const local = new Float32Array(vertCount * 2)
    const amp = new Float32Array(vertCount)
    const flow = new Float32Array(vertCount)
    const shal: [number, number, number] = [
      0.44 + (0.8 - 0.44) * p.turbid,
      0.63 + (0.68 - 0.63) * p.turbid,
      0.66 + (0.44 - 0.66) * p.turbid
    ]
    const deep: [number, number, number] = [
      0.09 + (0.4 - 0.09) * p.turbid,
      0.31 + (0.3 - 0.31) * p.turbid,
      0.52 + (0.15 - 0.52) * p.turbid
    ]

    for (let j = 0; j < GH_W; j += 1) {
      for (let i = 0; i < GW_W; i += 1) {
        const k = j * GW_W + i
        const x = -LX / 2 + i * DXW
        const z = -LZ / 2 + j * DZW
        const terr = terrainH(x, z, p.dam, p.breach, p.slide)
        const wy = waterY(x, p.level, p.depth, p.ds, p.flood)
        // 河道被坝体堵断时（坝下游基本无来水），强制下游断流，避免地形微起伏残留水膜
        let d = wy - terr
        if (x > DAM_X + 2 && p.ds < 0.12) d = -1
        const p3 = this.toWorld(x, wy + Y_SHIFT, z)
        positions[k * 3] = p3.x
        positions[k * 3 + 1] = p3.y
        positions[k * 3 + 2] = p3.z

        const dn = Math.max(0, Math.min(1, d / 5.5))
        const cr = shal[0] + (deep[0] - shal[0]) * dn + Math.pow(1 - dn, 3) * 0.09
        const cg = shal[1] + (deep[1] - shal[1]) * dn
        const cb = shal[2] + (deep[2] - shal[2]) * dn
        colors[k * 4] = clampByte(cr)
        colors[k * 4 + 1] = clampByte(cg)
        colors[k * 4 + 2] = clampByte(cb)
        colors[k * 4 + 3] = clampByte(0.6 + 0.33 * dn)
        depth[k] = d
        local[k * 2] = x
        local[k * 2 + 1] = z
        amp[k] = p.wave
        flow[k] = p.flow
      }
    }

    const indices = new Uint32Array(NXW * NZW * 6)
    let o = 0
    for (let j = 0; j < NZW; j += 1) {
      for (let i = 0; i < NXW; i += 1) {
        const a = j * GW_W + i
        const b = a + 1
        const c = a + GW_W
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

    const attributes = new GeometryAttributes() as GeometryAttributes &
      Record<string, GeometryAttribute | undefined>
    attributes.position = new GeometryAttribute({
      componentDatatype: ComponentDatatype.DOUBLE,
      componentsPerAttribute: 3,
      values: positions
    })
    attributes.color = new GeometryAttribute({
      componentDatatype: ComponentDatatype.UNSIGNED_BYTE,
      componentsPerAttribute: 4,
      normalize: true,
      values: colors
    })
    attributes.aDepth = new GeometryAttribute({
      componentDatatype: ComponentDatatype.FLOAT,
      componentsPerAttribute: 1,
      values: depth
    })
    attributes.aLocal = new GeometryAttribute({
      componentDatatype: ComponentDatatype.FLOAT,
      componentsPerAttribute: 2,
      values: local
    })
    attributes.aAmp = new GeometryAttribute({
      componentDatatype: ComponentDatatype.FLOAT,
      componentsPerAttribute: 1,
      values: amp
    })
    attributes.aFlow = new GeometryAttribute({
      componentDatatype: ComponentDatatype.FLOAT,
      componentsPerAttribute: 1,
      values: flow
    })
    const geometry = new Geometry({
      attributes,
      indices,
      primitiveType: PrimitiveType.TRIANGLES,
      boundingSphere: BoundingSphere.fromVertices(positions)
    })
    const next = new Primitive({
      geometryInstances: new GeometryInstance({ geometry }),
      appearance: new Appearance({
        translucent: true,
        closed: false,
        renderState: {
          depthTest: { enabled: true },
          depthMask: false,
          cull: { enabled: false },
          blending: BlendingState.ALPHA_BLEND
        },
        vertexShaderSource: waterAppearanceVS,
        fragmentShaderSource: waterAppearanceFS
      }),
      asynchronous: false,
      allowPicking: false
    })
    if (this.waterPrimitive) this.viewer.scene.primitives.remove(this.waterPrimitive)
    this.waterPrimitive = this.viewer.scene.primitives.add(next)
    this.lastLevel = p.level
    this.waterRelight = false
  }

  /** 滑坡源区范围：贴附在失稳坡体上的半透明范围面，随 scar 参数淡入淡出 */
  private rebuildScar(scar: number): void {
    if (scar <= 0.02) {
      if (this.scarPrimitive) {
        this.viewer.scene.primitives.remove(this.scarPrimitive)
        this.scarPrimitive = undefined
      }
      this.lastScar = scar
      return
    }
    const SNX = 26
    const SNZ = 16
    const SGW = SNX + 1
    const SGH = SNZ + 1
    const centerX = DAM_X - 24
    const centerZ = -40
    const halfX = 27
    const halfZ = 15
    const a = Math.max(0, Math.min(0.85, scar * 0.85))
    const positions = new Float64Array(SGW * SGH * 3)
    const colors = new Uint8Array(SGW * SGH * 4)
    const cr = clampByte(0.48)
    const cg = clampByte(0.36)
    const cb = clampByte(0.23)
    const ca = clampByte(a)
    for (let j = 0; j < SGH; j += 1) {
      for (let i = 0; i < SGW; i += 1) {
        const k = j * SGW + i
        const x = centerX - halfX + (i / SNX) * halfX * 2
        const z = centerZ - halfZ + (j / SNZ) * halfZ * 2
        const p = this.toWorld(x, terrainH(x, z, 0, 0) + 0.35 + Y_SHIFT, z)
        positions[k * 3] = p.x
        positions[k * 3 + 1] = p.y
        positions[k * 3 + 2] = p.z
        colors[k * 4] = cr
        colors[k * 4 + 1] = cg
        colors[k * 4 + 2] = cb
        colors[k * 4 + 3] = ca
      }
    }
    const indices = new Uint32Array(SNX * SNZ * 6)
    let o = 0
    for (let j = 0; j < SNZ; j += 1) {
      for (let i = 0; i < SNX; i += 1) {
        const p = j * SGW + i
        const q = p + 1
        const r = p + SGW
        const s = r + 1
        indices[o] = p
        indices[o + 1] = r
        indices[o + 2] = q
        indices[o + 3] = q
        indices[o + 4] = r
        indices[o + 5] = s
        o += 6
      }
    }
    const attributes = new GeometryAttributes()
    attributes.position = new GeometryAttribute({
      componentDatatype: ComponentDatatype.DOUBLE,
      componentsPerAttribute: 3,
      values: positions
    })
    attributes.color = new GeometryAttribute({
      componentDatatype: ComponentDatatype.UNSIGNED_BYTE,
      componentsPerAttribute: 4,
      normalize: true,
      values: colors
    })
    const geometry = new Geometry({
      attributes,
      indices,
      primitiveType: PrimitiveType.TRIANGLES,
      boundingSphere: BoundingSphere.fromVertices(positions)
    })
    const next = new Primitive({
      geometryInstances: new GeometryInstance({ geometry }),
      appearance: new Appearance({
        translucent: true,
        closed: false,
        renderState: {
          depthTest: { enabled: true },
          depthMask: false,
          cull: { enabled: false },
          blending: BlendingState.ALPHA_BLEND
        },
        vertexShaderSource: terrainAppearanceVS,
        fragmentShaderSource: terrainAppearanceFS
      }),
      asynchronous: false,
      allowPicking: false
    })
    if (this.scarPrimitive) this.viewer.scene.primitives.remove(this.scarPrimitive)
    this.scarPrimitive = this.viewer.scene.primitives.add(next)
    this.lastScar = scar
  }

  private buildDebris(): void {
    const RN = 300
    const cols = ['#8a7d6b', '#7b6a55', '#a3865f', '#6e5d49', '#9c8a6e', '#756551', '#b0906a', '#5f5142']
    const gauss = (): number => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5
    for (let i = 0; i < RN; i += 1) {
      const sx = DAM_X - 46 + Math.random() * 52
      const sz = -54 + Math.random() * 30
      const d: DebrisData = {
        sx,
        sy: yOf(sx, sz, 0, 0) + 1.5,
        sz,
        ex: DAM_X + gauss() * 11,
        ez: gauss() * 20,
        eyOff: -0.3 - Math.random() * 2.0,
        dl: Math.random() * 0.28,
        hop: 1.5 + Math.random() * 4.5,
        x: sx,
        y: 0,
        z: sz
      }
      this.debrisData.push(d)
      this.debris.add({
        position: this.toWorld(sx, d.sy, sz),
        color: Color.fromCssColorString(cols[(Math.random() * cols.length) | 0]),
        pixelSize: 3 + Math.random() * 4,
        outlineColor: Color.fromCssColorString('#3a3228').withAlpha(0.6),
        outlineWidth: 1
      })
    }
    this.debris.show = false
  }

  private updateDebris(slide: number, dam: number): void {
    const visible = slide > 0.02
    this.debris.show = visible
    if (!visible) return
    for (let i = 0; i < this.debrisData.length; i += 1) {
      const d = this.debrisData[i]
      const t = Math.max(0, Math.min(1, (slide - d.dl) / (1 - d.dl)))
      const te = t * t * (3 - 2 * t)
      const targetY = yOf(d.ex, d.ez, dam, 0, slide) + d.eyOff
      const x = d.sx + (d.ex - d.sx) * te
      const z = d.sz + (d.ez - d.sz) * te
      const y = d.sy * (1 - te) + targetY * te + Math.sin(Math.PI * te) * d.hop * 0.55
      d.x = x
      d.y = y
      d.z = z
      const pt = this.debris.get(i)
      if (pt) pt.position = this.toWorld(x, y, z)
    }
  }

  private buildFoam(): void {
    const FN = 220
    for (let i = 0; i < FN; i += 1) {
      const x = DAM_X + 4 + Math.random() * 95
      const z = -16 + Math.random() * 32
      this.foamData.push({ x, z })
      this.foam.add({
        position: this.toWorld(x, yOf(x, z, 0, 0), z),
        color: Color.WHITE.withAlpha(0.85),
        pixelSize: 2.5
      })
    }
    this.foam.show = false
  }

  private updateFoam(p: Record<PKey, number>, dt: number): void {
    const visible = p.flood > 0.05
    this.foam.show = visible
    if (!visible) return
    for (let i = 0; i < this.foamData.length; i += 1) {
      const f = this.foamData[i]
      f.x += (7 + p.flow * 12) * dt
      if (f.x > 128) {
        f.x = DAM_X + 2 + Math.random() * 30
        f.z = -16 + Math.random() * 32
      }
      const wy = waterY(f.x, p.level, p.depth, p.ds, p.flood)
      const pt = this.foam.get(i)
      if (pt) pt.position = this.toWorld(f.x, wy + Y_SHIFT + 0.25 + Math.sin(this.time * 6 + i) * 0.35, f.z)
    }
  }

  private buildLabels(): void {
    const defs: Record<string, { text: string; color: string; off: number }> = {
      valley: { text: '深切河谷（V形谷）', color: '#8fd0e8', off: 9 },
      river: { text: '原河道水面', color: '#5fb6d8', off: 7 },
      quake: { text: '地震 / 强降雨触发', color: '#e0644a', off: 8 },
      crack: { text: '坡体拉裂 · 失稳', color: '#d8a24a', off: 8 },
      slide: { text: '滑坡体高速下滑', color: '#d8a24a', off: 9 },
      source: { text: '滑坡源区', color: '#c98a55', off: 9 },
      dam: { text: '堰塞坝（松散堆积体）', color: '#d8a24a', off: 8 },
      lake: { text: '堰塞湖 · 回水区', color: '#5fb6d8', off: 8 },
      end: { text: '回水末端', color: '#8fd0e8', off: 7 },
      dry: { text: '下游断流', color: '#c98a55', off: 6 },
      spill: { text: '漫顶溢流 · 冲刷成槽', color: '#e0644a', off: 9 },
      breach: { text: '溃口 · 库水骤泄', color: '#e0644a', off: 9 },
      flood: { text: '下游洪峰', color: '#e0644a', off: 7 },
      stable: { text: '稳定湖盆 · 长期保存', color: '#62b183', off: 9 }
    }
    for (const key of Object.keys(defs)) {
      const def = defs[key]
      const entry: LabelEntry = {
        text: def.text,
        color: def.color,
        off: def.off,
        cart: new Cartesian3(),
        ground: new Cartesian3(),
        show: false
      }
      const labelColor = Color.fromCssColorString(def.color)
      const entity = this.viewer.entities.add({
        position: new CallbackPositionProperty(() => entry.cart, false),
        label: {
          text: def.text,
          font: '600 15px "Microsoft YaHei","PingFang SC",sans-serif',
          fillColor: Color.fromCssColorString('#eaf3fa'),
          outlineColor: Color.fromCssColorString('#0a1219'),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -8),
          showBackground: true,
          backgroundColor: Color.fromCssColorString('#0a1219').withAlpha(0.82),
          backgroundPadding: new Cartesian2(9, 5),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        polyline: {
          positions: new CallbackProperty(() => [entry.ground, entry.cart], false),
          width: 1.4,
          arcType: ArcType.NONE,
          material: labelColor.withAlpha(0.6)
        }
      })
      entry.entity = entity
      this.labels[key] = entry
    }
  }

  private setLabel(L: LabelEntry, x: number, y: number, z: number, off: number): void {
    this.toWorld(x, y + 0.3, z, L.ground)
    this.toWorld(x, y + off, z, L.cart)
  }

  private applyLabels(p: Record<PKey, number>): void {
    const show: Record<string, boolean> = {}
    for (const k of STEPS[this.cur].labels) show[k] = true
    const damTopY = yOf(DAM_X, 0, p.dam, p.breach)
    const lakeY = Math.max(bed(-20) + p.depth, p.level) + Y_SHIFT
    const endX = backwaterX(p.level, p.depth)
    const L = this.labels
    if (show.valley) this.setLabel(L.valley, -88, yOf(-88, 0, p.dam, p.breach) + 1, 0, 9)
    if (show.river) this.setLabel(L.river, -66, bed(-66) + p.depth + 0.4 + Y_SHIFT, 0, 7)
    if (show.quake) this.setLabel(L.quake, DAM_X - 24, yOf(DAM_X - 24, -34, 0, 0) + 22, -34, 8)
    if (show.crack) this.setLabel(L.crack, DAM_X - 34, yOf(DAM_X - 34, -45, 0, 0) + 3, -45, 8)
    if (show.source) this.setLabel(L.source, DAM_X - 24, yOf(DAM_X - 24, -40, 0, 0) + 4, -40, 9)
    if (show.slide) this.setLabel(L.slide, DAM_X - 20, yOf(DAM_X - 20, -18, p.dam, p.breach) + 6, -18, 9)
    if (show.dam) this.setLabel(L.dam, DAM_X, damTopY + 1.5, 0, 8)
    if (show.lake) this.setLabel(L.lake, -18, lakeY + 1, 0, 8)
    if (show.end) this.setLabel(L.end, endX, Math.max(bed(endX) + p.depth, p.level) + Y_SHIFT + 0.6, 0, 7)
    if (show.dry) this.setLabel(L.dry, 86, bed(86) + 1.0 + Y_SHIFT, 0, 6)
    if (show.spill) this.setLabel(L.spill, DAM_X, damTopY + 3.5, 0, 9)
    if (show.breach) this.setLabel(L.breach, DAM_X + 4, yOf(DAM_X + 4, 0, p.dam, p.breach) + 3, 0, 9)
    if (show.flood) this.setLabel(L.flood, 104, bed(104) + p.depth + p.flood * 4.2 + Y_SHIFT + 1.5, 0, 7)
    if (show.stable) this.setLabel(L.stable, -22, Math.max(bed(-22) + p.depth, p.level) + Y_SHIFT + 1, 0, 9)

    for (const key of Object.keys(L)) {
      const on = this.labelOn && !!show[key]
      L[key].show = on
      if (L[key].entity) L[key].entity.show = on
    }
  }

  /** 将相机置于 eyeWorld 并朝向 targetWorld；本地天顶作为 up */
  private aimAt(eyeWorld: Cartesian3, targetWorld: Cartesian3): void {
    const direction = Cartesian3.normalize(Cartesian3.subtract(targetWorld, eyeWorld, new Cartesian3()), new Cartesian3())
    const worldUp = Cartesian3.normalize(
      Matrix4.multiplyByPointAsVector(this.enu, new Cartesian3(0, 0, 1), new Cartesian3()),
      new Cartesian3()
    )
    const dot = Cartesian3.dot(worldUp, direction)
    const up = Cartesian3.normalize(
      Cartesian3.subtract(worldUp, Cartesian3.multiplyByScalar(direction, dot, new Cartesian3()), new Cartesian3()),
      new Cartesian3()
    )
    this.viewer.camera.setView({ destination: eyeWorld, orientation: { direction, up } })
  }

  /** 一次性设定视角；之后相机交由 Cesium 默认键鼠控制 */
  private applyView(eye: [number, number, number], target: [number, number, number]): void {
    this.aimAt(this.toWorld(eye[0], eye[1], eye[2]), this.toWorld(target[0], target[1], target[2]))
  }

  /** 自动旋转：绕场景中心与本地天顶轴缓慢环绕 */
  private orbitSpin(dt: number): void {
    const targetWorld = this.toWorld(0, 6, 0)
    const offset = Cartesian3.subtract(this.viewer.camera.positionWC, targetWorld, new Cartesian3())
    if (Cartesian3.magnitude(offset) < 1e-3) return
    const axis = Cartesian3.normalize(
      Matrix4.multiplyByPointAsVector(this.enu, new Cartesian3(0, 0, 1), new Cartesian3()),
      new Cartesian3()
    )
    const m = Matrix3.fromQuaternion(Quaternion.fromAxisAngle(axis, dt * 0.18), new Matrix3())
    Matrix3.multiplyByVector(m, offset, offset)
    this.aimAt(Cartesian3.add(targetWorld, offset, new Cartesian3()), targetWorld)
  }

  private easeInOut(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  }

  gotoStep(i: number, instant = false): void {
    this.cur = Math.max(0, Math.min(STEPS.length - 1, i))
    for (const k of PKEYS) {
      this.fromSt[k] = this.st[k]
      this.toSt[k] = STEPS[this.cur].p[k]
    }
    this.animT = instant ? 1 : 0
    this.animDur = instant ? 0.001 : STEPS[this.cur].dur
    if (instant) for (const k of PKEYS) this.st[k] = this.toSt[k]
    this.playTimer = 0
    this.callbacks.onStepChange(this.cur)
  }

  nextStep(): void {
    if (this.cur < STEPS.length - 1) this.gotoStep(this.cur + 1)
    else this.playing = false
  }

  prevStep(): void {
    if (this.cur > 0) this.gotoStep(this.cur - 1)
  }

  reset(): void {
    this.playing = false
    this.gotoStep(0)
    this.setViewPreset(0)
  }

  setPlaying(on: boolean): void {
    this.playing = on
    if (on && this.cur === STEPS.length - 1) this.gotoStep(0)
    this.playTimer = 0
  }

  isPlaying(): boolean {
    return this.playing
  }

  getCurrentStep(): number {
    return this.cur
  }

  setLabels(on: boolean): void {
    this.labelOn = on
  }

  setSpin(on: boolean): void {
    this.spin = on
  }

  setRainManual(on: boolean): void {
    this.rainManual = on
  }

  setViewPreset(id: number): void {
    if (id === 1) this.applyView([13, 250, 87], [0, 6, 0])
    else if (id === 2) this.applyView([28, 82, 186], [0, 6, 0])
    else if (id === 3) this.applyView([59, 62, -82], [12, 16, 0])
    else if (id === 4) this.applyView([-114, 90, 32], [10, 12, 0])
    else this.applyView([26, 170, 173], [0, 6, 0])
  }

  private frame = (now: number): void => {
    if (this.disposed) return
    this.rafId = requestAnimationFrame(this.frame)
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    this.time += dt

    if (this.animT < 1) {
      this.animT = Math.min(1, this.animT + dt / this.animDur)
      const e = this.easeInOut(this.animT)
      for (const k of PKEYS) this.st[k] = this.fromSt[k] + (this.toSt[k] - this.fromSt[k]) * e
    }
    if (this.playing) {
      this.playTimer += dt
      if (this.playTimer > STEPS[this.cur].dur + 1.9) this.nextStep()
    }

    const p = this.st
    this.rebuildAcc += dt
    const shapeChanged =
      Math.abs(p.dam - this.lastDam) > 0.004 ||
      Math.abs(p.breach - this.lastBreach) > 0.002 ||
      Math.abs(p.slide - this.lastSlide) > 0.004
    const levelChanged = Math.abs(p.level - this.lastLevel) > 0.05
    if (this.rebuildAcc > 0.09 && (shapeChanged || levelChanged || this.waterRelight)) {
      if (shapeChanged) this.rebuildTerrain(p.dam, p.breach, p.slide)
      if (shapeChanged || levelChanged) this.rebuildWater(p)
      this.rebuildAcc = 0
    }
    if (Math.abs(p.scar - this.lastScar) > 0.02) this.rebuildScar(p.scar)

    this.updateDebris(p.slide, p.dam)
    this.updateFoam(p, dt)

    const rainAll = Math.min(1.4, p.rain + (this.rainManual ? 0.9 : 0))
    this.rain.show = rainAll > 0.02
    this.rain.emissionRate = rainAll > 0.02 ? rainAll * 130 : 0

    const q = p.quake
    this.flashT = Math.max(0, this.flashT - dt * 2.2)
    if (q > 0.01) this.flashT = 0.35 + Math.random() * 0.45
    if (this.flashEl) this.flashEl.style.opacity = (this.flashT * q * 0.9).toFixed(3)

    this.applyLabels(p)
    if (this.spin) this.orbitSpin(dt)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.rafId)
    this.labels = {}
    this.debrisData = []
    this.foamData = []
    destroyScene(this.viewer)
  }
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)))
}

function makeRainImage(): string {
  const cv = document.createElement('canvas')
  cv.width = 4
  cv.height = 32
  const ctx = cv.getContext('2d')
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 32)
    g.addColorStop(0, 'rgba(170,216,239,0)')
    g.addColorStop(0.5, 'rgba(190,230,250,0.9)')
    g.addColorStop(1, 'rgba(170,216,239,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 4, 32)
  }
  return cv.toDataURL()
}
