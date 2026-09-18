import {
  Appearance,
  ArcType,
  BlendingState,
  BoundingSphere,
  BoxEmitter,
  BoxGeometry,
  CallbackPositionProperty,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  ComponentDatatype,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  GeometryInstance,
  LabelStyle,
  Matrix3,
  Matrix4,
  ParticleSystem,
  PerInstanceColorAppearance,
  Primitive,
  PrimitiveType,
  Quaternion,
  Transforms,
  VerticalOrigin,
  type Entity,
  type Particle,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery } from '../../lib/cesium-scene'
import { DURATION, clamp, stageIndex, type HazardStage } from './model'

/** 顶点颜色着色器（不透光地形 / 致灾体） */
export const HAZARD_VS = `
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

export const HAZARD_FS = `
in vec4 v_color;
void main()
{
  out_FragColor = v_color;
}
`

/** 半透明面着色器（流体 / 范围面） */
export const HAZARD_ALPHA_FS = `
in vec4 v_color;
void main()
{
  out_FragColor = v_color;
}
`

export interface CesiumHazardCallbacks {
  onProgress?: (p: number, playing: boolean, stage: number) => void
  onReady?: () => void
}

export interface CesiumHazardOptions {
  stages: HazardStage[]
  duration?: number
  /** 场景锚点经纬度 */
  lon: number
  lat: number
  /** 模型单位 → 米 */
  scale?: number
  /** 抬升高度（米），使最低点贴合椭球面 */
  yShift?: number
}

export interface CesiumLabelDef {
  text: string
  color: string
  /** 标注在目标点上方的高度（模型单位） */
  off: number
}

interface LabelEntry {
  def: CesiumLabelDef
  cart: Cartesian3
  ground: Cartesian3
  show: boolean
  entity?: Entity
}

/** 由二维高程网格生成的几何数据 */
export interface GridData {
  positions: Float64Array
  colors: Uint8Array
  indices: Uint32Array
  vertexCount: number
}

/** 用于批量构建实心盒子的描述（尺寸与位置均为模型单位） */
export interface HazardBox {
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  color: string
}

/**
 * 山地灾害 Cesium 演示基类。
 *
 * 统一封装 viewer、影像、ENU 局部坐标系、顶点着色 Primitive、Entity 标注、
 * 降雨粒子与按进度播放的控制逻辑；子类只需实现地形与致灾体的构建和逐帧更新。
 */
export abstract class HazardCesiumBase {
  protected readonly viewer: Viewer
  protected readonly enu: Matrix4
  protected readonly callbacks: CesiumHazardCallbacks
  protected readonly stages: HazardStage[]
  protected readonly duration: number
  protected readonly scale: number
  protected readonly yShift: number

  protected readonly state = {
    p: 0,
    playing: false,
    speed: 1,
    labels: true,
    eng: false,
    rain: false,
    spin: false
  }

  protected time = 0
  protected disposed = false

  private last = performance.now()
  private rafId = 0
  private lastEmit = 0

  private readonly labels: Record<string, LabelEntry> = {}
  private readonly rain: ParticleSystem
  private readonly primitives: Record<string, Primitive | undefined> = {}

  constructor(container: HTMLElement, options: CesiumHazardOptions, callbacks: CesiumHazardCallbacks = {}) {
    this.callbacks = callbacks
    this.stages = options.stages
    this.duration = options.duration ?? DURATION
    this.scale = options.scale ?? 10
    this.yShift = options.yShift ?? 0
    this.enu = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(options.lon, options.lat, 0))

    this.viewer = createMapScene(container)
    loadBingImagery(this.viewer)

    // 粒子系统按 frameState.time 计算发射与位移，时钟暂停时 dt 恒为 0（粒子不会出现），
    // 因此本类场景统一让时钟随真实时间推进。
    this.viewer.clock.shouldAnimate = true

    this.rain = new ParticleSystem({
      image: makeRainImage(),
      imageSize: new Cartesian2(2.4, 22),
      startColor: Color.fromCssColorString('#bcdff5').withAlpha(0.72),
      endColor: Color.fromCssColorString('#bcdff5').withAlpha(0.0),
      minimumSpeed: 1,
      maximumSpeed: 1,
      minimumParticleLife: 1.5,
      maximumParticleLife: 2.4,
      emissionRate: 0,
      loop: true,
      emitter: new BoxEmitter(new Cartesian3(62 * this.scale, 62 * this.scale, 18 * this.scale)),
      modelMatrix: Matrix4.clone(this.enu),
      emitterModelMatrix: Matrix4.fromTranslation(new Cartesian3(0, 0, 26 * this.scale)),
      updateCallback: (particle: Particle) => {
        Cartesian3.normalize(particle.position, particle.velocity)
        Cartesian3.multiplyByScalar(particle.velocity, -6 * this.scale, particle.velocity)
      }
    })
    this.rain.show = false
    this.viewer.scene.primitives.add(this.rain)
  }

  /** 由子类在字段初始化完成后调用：构建场景、初始化状态并启动主循环 */
  protected bootstrap(): void {
    this.buildScene()
    this.update(0, 0)
    this.setViewPreset(3)
    this.callbacks.onReady?.()
    this.rafId = requestAnimationFrame(this.frame)
  }

  /** 子类实现：构建地形、致灾体、标注与工程构筑物 */
  protected abstract buildScene(): void
  /** 子类实现：按进度更新致灾体与动态对象 */
  protected abstract update(p: number, dt: number): void

  /* ------------------------------------------------------------------
     坐标与几何
     ------------------------------------------------------------------ */
  protected toWorld(x: number, y: number, z: number, result?: Cartesian3): Cartesian3 {
    const out = result ?? new Cartesian3()
    return Matrix4.multiplyByPoint(this.enu, new Cartesian3(x * this.scale, z * this.scale, (y + this.yShift) * this.scale), out)
  }

  /** 由二维高程网格构建顶点着色数据（默认带四周裙边） */
  protected buildGrid(
    nx: number,
    nz: number,
    x0: number,
    z0: number,
    dx: number,
    dz: number,
    yFn: (x: number, z: number) => number,
    colorFn: (x: number, z: number, y: number, out: number[]) => void,
    skirtBaseY?: number
  ): GridData {
    const gw = nx + 1
    const gh = nz + 1
    const top = gw * gh
    const boundary: number[] = []
    if (skirtBaseY !== undefined) {
      for (let i = 0; i < gw; i += 1) boundary.push(i)
      for (let j = 1; j < gh; j += 1) boundary.push(j * gw + gw - 1)
      for (let i = gw - 2; i >= 0; i -= 1) boundary.push((gh - 1) * gw + i)
      for (let j = gh - 2; j >= 1; j -= 1) boundary.push(j * gw)
    }
    const vc = top + boundary.length
    const positions = new Float64Array(vc * 3)
    const colors = new Uint8Array(vc * 4)
    const rgb: number[] = [0, 0, 0]
    for (let j = 0; j < gh; j += 1) {
      for (let i = 0; i < gw; i += 1) {
        const k = j * gw + i
        const x = x0 + i * dx
        const z = z0 + j * dz
        const y = yFn(x, z)
        const p = this.toWorld(x, y, z)
        positions[k * 3] = p.x
        positions[k * 3 + 1] = p.y
        positions[k * 3 + 2] = p.z
        colorFn(x, z, y, rgb)
        colors[k * 4] = clampByte(rgb[0])
        colors[k * 4 + 1] = clampByte(rgb[1])
        colors[k * 4 + 2] = clampByte(rgb[2])
        colors[k * 4 + 3] = 255
      }
    }
    for (let b = 0; b < boundary.length; b += 1) {
      const src = boundary[b]
      const k = top + b
      const x = x0 + (src % gw) * dx
      const z = z0 + Math.floor(src / gw) * dz
      const p = this.toWorld(x, skirtBaseY ?? 0, z)
      positions[k * 3] = p.x
      positions[k * 3 + 1] = p.y
      positions[k * 3 + 2] = p.z
      colors[k * 4] = (colors[src * 4] * 0.44) | 0
      colors[k * 4 + 1] = (colors[src * 4 + 1] * 0.44) | 0
      colors[k * 4 + 2] = (colors[src * 4 + 2] * 0.44) | 0
      colors[k * 4 + 3] = 255
    }
    const surface = nx * nz * 6
    const skirt = boundary.length * 6
    const indices = new Uint32Array(surface + skirt)
    let o = 0
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
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

  /** 用当前位置与颜色构建一个 Primitive */
  protected makePrimitive(data: GridData, translucent = false): Primitive {
    const attributes = new GeometryAttributes() as GeometryAttributes & Record<string, GeometryAttribute | undefined>
    attributes.position = new GeometryAttribute({
      componentDatatype: ComponentDatatype.DOUBLE,
      componentsPerAttribute: 3,
      values: data.positions
    })
    attributes.color = new GeometryAttribute({
      componentDatatype: ComponentDatatype.UNSIGNED_BYTE,
      componentsPerAttribute: 4,
      normalize: true,
      values: data.colors
    })
    const geometry = new Geometry({
      attributes,
      indices: data.indices,
      primitiveType: PrimitiveType.TRIANGLES,
      boundingSphere: BoundingSphere.fromVertices(data.positions)
    })
    const appearance = new Appearance({
      translucent,
      closed: false,
      renderState: {
        depthTest: { enabled: true },
        depthMask: !translucent,
        cull: { enabled: false },
        blending: translucent ? BlendingState.ALPHA_BLEND : BlendingState.DISABLED
      },
      vertexShaderSource: HAZARD_VS,
      fragmentShaderSource: translucent ? HAZARD_ALPHA_FS : HAZARD_FS
    })
    return new Primitive({
      geometryInstances: new GeometryInstance({ geometry }),
      appearance,
      asynchronous: false,
      allowPicking: false
    })
  }

  /** 生成与 ENU 对齐、中心位于 (x, y, z) 的盒子模型矩阵 */
  protected boxMatrix(x: number, y: number, z: number): Matrix4 {
    return Matrix4.multiply(
      this.enu,
      Matrix4.fromTranslation(new Cartesian3(x * this.scale, z * this.scale, (y + this.yShift) * this.scale)),
      new Matrix4()
    )
  }

  /** 使用 Cesium 标准几何管线批量构建实心盒子，可整体显隐 */
  protected makeBoxes(boxes: HazardBox[]): Primitive {
    const instances = boxes.map(
      (b) =>
        new GeometryInstance({
          geometry: BoxGeometry.fromDimensions({
            dimensions: new Cartesian3(b.w * this.scale, b.d * this.scale, b.h * this.scale),
            vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT
          }),
          modelMatrix: this.boxMatrix(b.x, b.y, b.z),
          attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString(b.color)) }
        })
    )
    return new Primitive({
      geometryInstances: instances,
      appearance: new PerInstanceColorAppearance({ closed: true }),
      asynchronous: false,
      allowPicking: false
    })
  }

  /** 替换某个槽位的 Primitive（自动移除旧的） */
  protected setPrimitive(slot: string, prim: Primitive | undefined): void {
    const old = this.primitives[slot]
    if (old) this.viewer.scene.primitives.remove(old)
    this.primitives[slot] = prim
    if (prim) this.viewer.scene.primitives.add(prim)
  }

  protected removePrimitive(slot: string): void {
    this.setPrimitive(slot, undefined)
  }

  /* ------------------------------------------------------------------
     标注
     ------------------------------------------------------------------ */
  protected addLabels(defs: Record<string, CesiumLabelDef>): void {
    for (const key of Object.keys(defs)) {
      const def = defs[key]
      const entry: LabelEntry = { def, cart: new Cartesian3(), ground: new Cartesian3(), show: false }
      const labelColor = Color.fromCssColorString(def.color)
      entry.entity = this.viewer.entities.add({
        show: false,
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
      this.labels[key] = entry
    }
  }

  protected setLabelPos(key: string, x: number, y: number, z: number): void {
    const L = this.labels[key]
    if (!L) return
    this.toWorld(x, y + 0.3, z, L.ground)
    this.toWorld(x, y + L.def.off, z, L.cart)
  }

  protected showLabel(key: string, on: boolean): void {
    const L = this.labels[key]
    if (!L) return
    L.show = on
    if (L.entity) L.entity.show = on
  }

  setLabels(on: boolean): void {
    this.state.labels = on
    if (!on) for (const key of Object.keys(this.labels)) this.showLabel(key, false)
  }

  /* ------------------------------------------------------------------
     播放控制
     ------------------------------------------------------------------ */
  setPlaying(on: boolean): void {
    if (on && this.state.p >= 0.999) this.state.p = 0
    this.state.playing = on
    this.emit()
  }

  isPlaying(): boolean {
    return this.state.playing
  }

  setSpeed(v: number): void {
    this.state.speed = v
  }

  setProgress(v: number): void {
    this.state.p = clamp(v, 0, 1)
    this.update(this.state.p, 0)
    this.emit()
  }

  getProgress(): number {
    return this.state.p
  }

  gotoStage(i: number): void {
    const stage = this.stages[clamp(i, 0, this.stages.length - 1)]
    this.state.playing = false
    this.setProgress(stage.start + 0.004)
  }

  setEngineering(on: boolean): void {
    this.state.eng = on
    this.onEngineering(on)
    this.update(this.state.p, 0)
  }

  setRain(on: boolean): void {
    this.state.rain = on
  }

  setSpin(on: boolean): void {
    this.state.spin = on
  }

  protected onEngineering(_on: boolean): void {}

  private emit(): void {
    this.callbacks.onProgress?.(this.state.p, this.state.playing, stageIndex(this.stages, this.state.p))
  }

  /* ------------------------------------------------------------------
     视角
     ------------------------------------------------------------------ */
  /** 将相机置于 eyeWorld 并朝向 targetWorld；本地天顶作为 up */
  protected aimAt(eyeWorld: Cartesian3, targetWorld: Cartesian3): void {
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

  protected applyView(eye: [number, number, number], target: [number, number, number]): void {
    this.aimAt(this.toWorld(eye[0], eye[1], eye[2]), this.toWorld(target[0], target[1], target[2]))
  }

  protected orbitSpin(dt: number): void {
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

  /** 子类可覆写以提供不同机位 */
  setViewPreset(id?: number): void {
    void id
  }

  /* ------------------------------------------------------------------
     主循环
     ------------------------------------------------------------------ */
  private frame = (now: number): void => {
    if (this.disposed) return
    this.rafId = requestAnimationFrame(this.frame)
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    this.time += dt

    if (this.state.playing) {
      this.state.p += (dt / this.duration) * this.state.speed
      if (this.state.p >= 1) {
        this.state.p = 1
        this.state.playing = false
      }
    }

    this.update(this.state.p, dt)

    const rainOn = this.state.rain
    this.rain.show = rainOn
    this.rain.emissionRate = rainOn ? 620 : 0

    if (this.state.spin) this.orbitSpin(dt)

    if (this.state.playing) {
      this.lastEmit += dt
      if (this.lastEmit > 0.1) {
        this.lastEmit = 0
        this.emit()
      }
    }
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.rafId)
    destroyScene(this.viewer)
  }
}

export function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

export function makeRainImage(): string {
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
