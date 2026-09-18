import * as THREE from 'three'
import { DURATION, type HazardStage, clamp, stageIndex } from './model'

/** 三维要素标注定义 */
export interface HazardLabelDef {
  id: string
  text: string
  detail: string
  /** slide：滑坡要素；debris：泥石流要素；eng：防治工程 */
  kind: 'slide' | 'debris' | 'eng'
  /** 进度小于该值时隐藏（默认 0） */
  from?: number
}

export interface OverlayLabel extends HazardLabelDef {
  el: HTMLDivElement
  on: boolean
}

export interface HazardThreeCallbacks {
  onProgress?: (p: number, playing: boolean, stage: number) => void
  onReady?: () => void
}

export interface HazardThreeOptions {
  stages: HazardStage[]
  /** 一轮演示时长（秒） */
  duration?: number
  /** 相机默认半径 */
  radius?: number
  /** 相机默认目标高度 */
  targetY?: number
  fogColor?: number
  fogNear?: number
  fogFar?: number
  background?: 'sky' | 'gradient'
}

/**
 * Three.js 山地灾害演示基类。
 *
 * 统一封装渲染器、光照、天空、轨道相机、降雨粒子、HTML 要素标注与播放控制，
 * 滑坡 / 泥石流两类演示只需实现地形与致灾体的构建和逐帧更新即可。
 */
export abstract class HazardThreeBase {
  protected readonly container: HTMLElement
  protected readonly renderer: THREE.WebGLRenderer
  protected readonly scene: THREE.Scene
  protected readonly camera: THREE.PerspectiveCamera
  protected readonly root: THREE.Group
  protected readonly stages: HazardStage[]
  protected readonly duration: number
  protected readonly options: HazardThreeOptions

  protected readonly overlay: HTMLDivElement
  protected readonly tipEl: HTMLDivElement
  protected readonly tipTitle: HTMLDivElement
  protected readonly tipBody: HTMLDivElement

  private readonly clock = new THREE.Clock()
  private readonly observer: ResizeObserver
  private rafId = 0
  private disposed = false
  private readonly callbacks: HazardThreeCallbacks

  protected readonly state = {
    p: 0,
    playing: false,
    speed: 1,
    labels: true,
    eng: false,
    rain: false,
    spin: false
  }

  protected readonly cam = {
    tx: 0,
    ty: 9,
    tz: 0,
    theta: -0.42,
    phi: 1.02,
    r: 66,
    gtx: 0,
    gty: 9,
    gtz: 0,
    gtheta: -0.42,
    gphi: 1.02,
    gr: 66
  }

  private rain: THREE.LineSegments
  private readonly rainGeo: THREE.BufferGeometry
  private readonly rainStates: { x: number; y: number; z: number; v: number }[] = []
  private static readonly RAIN_N = 520

  private pointers = new Map<number, { x: number; y: number }>()
  private lastX = 0
  private lastY = 0
  private dragBtn = -1
  private lastDist = 0

  private readonly onPointerDown: (e: PointerEvent) => void
  private readonly onPointerMove: (e: PointerEvent) => void
  private readonly onPointerUp: (e: PointerEvent) => void
  private readonly onWheel: (e: WheelEvent) => void
  private readonly onContextMenu: (e: Event) => void
  private readonly onKeyDown: (e: KeyboardEvent) => void

  constructor(container: HTMLElement, options: HazardThreeOptions, callbacks: HazardThreeCallbacks = {}) {
    this.container = container
    this.options = options
    this.callbacks = callbacks
    this.stages = options.stages
    this.duration = options.duration ?? DURATION

    const pixelRatio = Math.min(2, window.devicePixelRatio || 1)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.renderer.domElement.style.touchAction = 'none'
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(options.fogColor ?? 0x1a2836, options.fogNear ?? 110, options.fogFar ?? 260)
    this.camera = new THREE.PerspectiveCamera(42, 1, 1, 600)

    this.buildSky()
    this.buildLights()

    this.root = new THREE.Group()
    this.scene.add(this.root)

    const radius = options.radius ?? 66
    const targetY = options.targetY ?? 9
    for (const k of ['tx', 'gtx', 'tz', 'gtz'] as const) this.cam[k] = 0
    for (const k of ['ty', 'gty'] as const) this.cam[k] = targetY
    for (const k of ['r', 'gr'] as const) this.cam[k] = radius
    this.applyCam()

    const rain = this.buildRain()
    this.rain = rain.mesh
    this.rainGeo = rain.geo
    this.rainStates = rain.states

    this.overlay = document.createElement('div')
    Object.assign(this.overlay.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '15'
    } as CSSStyleDeclaration)
    container.appendChild(this.overlay)

    this.tipEl = document.createElement('div')
    Object.assign(this.tipEl.style, {
      position: 'absolute',
      zIndex: '40',
      maxWidth: '290px',
      display: 'none',
      padding: '10px 12px',
      border: '1px solid #f0b429',
      borderRadius: '9px',
      background: 'rgba(10,17,24,.95)',
      color: '#dfe9f2',
      fontSize: '12.5px',
      lineHeight: '1.75',
      boxShadow: '0 8px 26px rgba(0,0,0,.5)',
      pointerEvents: 'auto'
    } as CSSStyleDeclaration)
    this.tipTitle = document.createElement('div')
    Object.assign(this.tipTitle.style, { color: '#f0b429', fontWeight: '700', fontSize: '13.5px', marginBottom: '5px' })
    this.tipBody = document.createElement('div')
    Object.assign(this.tipBody.style, { color: '#bccbda' })
    this.tipEl.appendChild(this.tipTitle)
    this.tipEl.appendChild(this.tipBody)
    container.appendChild(this.tipEl)

    this.onPointerDown = (e) => this.handlePointerDown(e)
    this.onPointerMove = (e) => this.handlePointerMove(e)
    this.onPointerUp = (e) => this.handlePointerUp(e)
    this.onWheel = (e) => this.handleWheel(e)
    this.onContextMenu = (e) => e.preventDefault()
    this.onKeyDown = (e) => this.handleKeyDown(e)

    const cv = this.renderer.domElement
    cv.addEventListener('pointerdown', this.onPointerDown)
    cv.addEventListener('pointermove', this.onPointerMove)
    cv.addEventListener('pointerup', this.onPointerUp)
    cv.addEventListener('pointercancel', this.onPointerUp)
    cv.addEventListener('contextmenu', this.onContextMenu)
    cv.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('keydown', this.onKeyDown)
    container.addEventListener('pointerdown', this.closeTip)

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(container)
    this.resize()
  }

  /**
   * 由子类构造函数在自身字段初始化完成后调用：
   * 构建场景内容并启动渲染主循环。
   */
  protected bootstrap(): void {
    this.buildContent()
    this.updateHazard(0, 0)
    this.updateLabels(0)
    this.callbacks.onReady?.()
    this.rafId = requestAnimationFrame(this.frame)
  }

  /* ------------------------------------------------------------------
     子类需要实现的能力
     ------------------------------------------------------------------ */
  /** 构建地形与致灾体等场景内容 */
  protected abstract buildContent(): void
  /** 逐帧更新致灾体状态 */
  protected abstract updateHazard(p: number, dt: number): void
  /** 逐帧更新要素标注位置 */
  protected abstract updateLabels(p: number): void
  /** 防治工程开关变化 */
  protected abstract onEngineering(on: boolean): void

  /* ------------------------------------------------------------------
     天空与光照
     ------------------------------------------------------------------ */
  private buildSky(): void {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(560, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          cTop: { value: new THREE.Color(0x24425c) },
          cBot: { value: new THREE.Color(0x0e1a24) }
        },
        vertexShader:
          'varying float vy; void main(){ vy = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader:
          'uniform vec3 cTop; uniform vec3 cBot; varying float vy; void main(){ float t = clamp(vy*0.5+0.5,0.0,1.0); gl_FragColor = vec4(mix(cBot,cTop,pow(t,0.85)),1.0); }'
      })
    )
    this.scene.add(sky)
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xbcd8f0, 0x3a2f22, 0.62))
    const sun = new THREE.DirectionalLight(0xfff2dc, 1.05)
    sun.position.set(-52, 86, 58)
    sun.castShadow = true
    sun.shadow.mapSize.width = 2048
    sun.shadow.mapSize.height = 2048
    sun.shadow.camera.left = -78
    sun.shadow.camera.right = 78
    sun.shadow.camera.top = 78
    sun.shadow.camera.bottom = -78
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 260
    sun.shadow.bias = -0.0012
    this.scene.add(sun)
    const fill = new THREE.DirectionalLight(0x8fb6d8, 0.3)
    fill.position.set(60, 40, -50)
    this.scene.add(fill)
  }

  /* ------------------------------------------------------------------
     降雨
     ------------------------------------------------------------------ */
  private buildRain(): {
    mesh: THREE.LineSegments
    geo: THREE.BufferGeometry
    states: { x: number; y: number; z: number; v: number }[]
  } {
    const n = HazardThreeBase.RAIN_N
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(n * 6)
    const states: { x: number; y: number; z: number; v: number }[] = []
    for (let i = 0; i < n; i += 1) {
      states.push({
        x: -52 + Math.random() * 104,
        y: Math.random() * 46,
        z: -28 + Math.random() * 56,
        v: 26 + Math.random() * 22
      })
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mesh = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0x6fb6e8, transparent: true, opacity: 0.5 })
    )
    mesh.visible = false
    mesh.frustumCulled = false
    this.scene.add(mesh)
    return { mesh, geo, states }
  }

  private updateRain(dt: number): void {
    if (!this.state.rain) {
      this.rain.visible = false
      return
    }
    this.rain.visible = true
    const arr = this.rainGeo.attributes.position.array as Float32Array
    for (let i = 0; i < this.rainStates.length; i += 1) {
      const st = this.rainStates[i]
      st.y -= st.v * dt
      if (st.y < -2) {
        st.y = 40 + Math.random() * 12
        st.x = -52 + Math.random() * 104
        st.z = -28 + Math.random() * 56
      }
      const o = i * 6
      arr[o] = st.x
      arr[o + 1] = st.y
      arr[o + 2] = st.z
      arr[o + 3] = st.x + 0.25
      arr[o + 4] = st.y - 1.15
      arr[o + 5] = st.z
    }
    this.rainGeo.attributes.position.needsUpdate = true
  }

  /* ------------------------------------------------------------------
     标注
     ------------------------------------------------------------------ */
  protected addLabel(def: HazardLabelDef): OverlayLabel {
    const el = document.createElement('div')
    const isDebris = def.kind === 'debris'
    const isEng = def.kind === 'eng'
    el.textContent = def.text
    Object.assign(el.style, {
      position: 'absolute',
      transform: 'translate(-50%,-50%)',
      pointerEvents: 'auto',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      padding: '2px 8px',
      borderRadius: '20px',
      fontSize: '12px',
      transition: '0.15s',
      border: `1px solid ${isDebris ? 'rgba(93,190,168,.6)' : isEng ? 'rgba(150,170,190,.6)' : 'rgba(240,180,41,.55)'}`,
      color: isDebris ? '#b6f0e0' : isEng ? '#cfdae6' : '#ffe1a3',
      background: isEng ? 'rgba(20,30,40,.85)' : 'rgba(10,18,26,.82)'
    } as CSSStyleDeclaration)
    const hoverBg = isDebris ? '#2f8f7d' : isEng ? '#8fa3b5' : '#f0b429'
    const hoverFg = isDebris || !isEng ? (isDebris ? '#ffffff' : '#1a252f') : '#101a24'
    el.addEventListener('mouseenter', () => {
      el.style.background = hoverBg
      el.style.color = hoverFg
    })
    el.addEventListener('mouseleave', () => {
      el.style.background = isEng ? 'rgba(20,30,40,.85)' : 'rgba(10,18,26,.82)'
      el.style.color = isDebris ? '#b6f0e0' : isEng ? '#cfdae6' : '#ffe1a3'
    })
    el.addEventListener('click', (ev) => {
      ev.stopPropagation()
      this.showTip(def, el)
    })
    this.overlay.appendChild(el)
    return { ...def, el, on: false }
  }

  private showTip(def: HazardLabelDef, el: HTMLElement): void {
    this.tipTitle.textContent = def.text
    this.tipBody.innerHTML = def.detail
    this.tipEl.style.display = 'block'
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    const lx = parseFloat(el.style.left || '0')
    const ly = parseFloat(el.style.top || '0')
    this.tipEl.style.left = clamp(lx + 16, 8, Math.max(8, w - 298)) + 'px'
    this.tipEl.style.top = clamp(ly - 40, 8, Math.max(8, h - 150)) + 'px'
  }

  private closeTip = (): void => {
    this.tipEl.style.display = 'none'
  }

  /** 将标注投影到屏幕，并处理越界与总开关 */
  protected placeLabel(label: OverlayLabel, x: number, y: number, z: number): void {
    this._v.set(x, y, z)
    this._v.project(this.camera)
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (this._v.z > 1 || this._v.z < -1) {
      label.on = false
      label.el.style.display = 'none'
      return
    }
    const px = (this._v.x * 0.5 + 0.5) * w
    const py = (-this._v.y * 0.5 + 0.5) * h
    if (px < -60 || px > w + 60 || py < -30 || py > h + 30) {
      label.on = false
      label.el.style.display = 'none'
      return
    }
    label.on = true
    label.el.style.display = ''
    label.el.style.left = px.toFixed(1) + 'px'
    label.el.style.top = py.toFixed(1) + 'px'
  }

  protected hideLabel(label: OverlayLabel): void {
    label.on = false
    label.el.style.display = 'none'
  }

  /** 综合标注总开关、工程开关与阶段进度，返回该标注是否应显示 */
  protected labelAllowed(label: OverlayLabel, p: number): boolean {
    if (!this.state.labels) return false
    if (label.kind === 'eng' && !this.state.eng) return false
    if (label.from && p < label.from) return false
    return true
  }

  /* ------------------------------------------------------------------
     相机
     ------------------------------------------------------------------ */
  private readonly _v = new THREE.Vector3()

  private applyCam(): void {
    const sp = Math.sin(this.cam.phi)
    const cp = Math.cos(this.cam.phi)
    this.camera.position.set(
      this.cam.tx + this.cam.r * sp * Math.sin(this.cam.theta),
      this.cam.ty + this.cam.r * cp,
      this.cam.tz + this.cam.r * sp * Math.cos(this.cam.theta)
    )
    this.camera.lookAt(this.cam.tx, this.cam.ty, this.cam.tz)
  }

  private handlePointerDown(e: PointerEvent): void {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    this.lastX = e.clientX
    this.lastY = e.clientY
    this.dragBtn = e.button
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      this.lastDist = Math.hypot(a.x - b.x, a.y - b.y)
    }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (this.lastDist > 0) {
        this.cam.gr = clamp(this.cam.gr * (1 + (this.lastDist - dist) * 0.004), 28, 240)
      }
      this.lastDist = dist
      return
    }
    const dx = e.clientX - this.lastX
    const dy = e.clientY - this.lastY
    this.lastX = e.clientX
    this.lastY = e.clientY
    if (this.dragBtn === 2) {
      const k = this.cam.gr * 0.0016
      const right = new THREE.Vector3(Math.cos(this.cam.theta), 0, -Math.sin(this.cam.theta))
      const fwd = new THREE.Vector3(-Math.sin(this.cam.theta), 0, -Math.cos(this.cam.theta))
      this.cam.gtx = clamp(this.cam.gtx - right.x * dx * k - fwd.x * dy * k, -40, 40)
      this.cam.gtz = clamp(this.cam.gtz - right.z * dx * k - fwd.z * dy * k, -40, 40)
      this.cam.tx = this.cam.gtx
      this.cam.tz = this.cam.gtz
      return
    }
    this.cam.gtheta -= dx * 0.005
    this.cam.gphi = clamp(this.cam.gphi - dy * 0.005, 0.12, 1.52)
    this.cam.theta = this.cam.gtheta
    this.cam.phi = this.cam.gphi
  }

  private handlePointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId)
    if (this.pointers.size < 2) this.lastDist = 0
    if (this.pointers.size === 0) this.dragBtn = -1
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault()
    this.cam.gr = clamp(this.cam.gr * (1 + (e.deltaY > 0 ? 0.08 : -0.08)), 28, 240)
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const tag = e.target && (e.target as HTMLElement).tagName ? (e.target as HTMLElement).tagName.toLowerCase() : ''
    if (tag === 'input' || tag === 'textarea') return
    if (e.code === 'Space') {
      e.preventDefault()
      this.setPlaying(!this.state.playing)
    } else if (e.code === 'ArrowRight') {
      e.preventDefault()
      this.setPlaying(false)
      this.setProgress(this.state.p + 0.02)
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault()
      this.setPlaying(false)
      this.setProgress(this.state.p - 0.02)
    } else if (e.code === 'Home') {
      this.setProgress(0)
    } else if (e.code === 'End') {
      this.setProgress(1)
    }
  }

  private resize(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  /* ------------------------------------------------------------------
     对外控制
     ------------------------------------------------------------------ */
  setPlaying(on: boolean): void {
    if (on && this.state.p >= 0.999) this.state.p = 0
    this.state.playing = on
    this.emitProgress()
  }

  isPlaying(): boolean {
    return this.state.playing
  }

  setSpeed(v: number): void {
    this.state.speed = v
  }

  setProgress(v: number): void {
    this.state.p = clamp(v, 0, 1)
    this.updateHazard(this.state.p, 0)
    this.updateLabels(this.state.p)
    this.emitProgress()
  }

  getProgress(): number {
    return this.state.p
  }

  gotoStage(i: number): void {
    const stage = this.stages[clamp(i, 0, this.stages.length - 1)]
    this.state.playing = false
    this.setProgress(stage.start + 0.004)
  }

  setLabels(on: boolean): void {
    this.state.labels = on
    if (!on) this.overlay.querySelectorAll('div').forEach((el) => ((el as HTMLElement).style.display = 'none'))
  }

  setSpin(on: boolean): void {
    this.state.spin = on
  }

  setRain(on: boolean): void {
    this.state.rain = on
  }

  setEngineering(on: boolean): void {
    this.state.eng = on
    this.onEngineering(on)
    this.updateHazard(this.state.p, 0)
    this.updateLabels(this.state.p)
  }

  setViewPreset(id: number): void {
    const R = this.options.radius ?? 66
    const targetY = this.options.targetY ?? 9
    let theta = -0.42
    let phi = 1.02
    let rMul = 1
    if (id === 1) {
      theta = -0.3
      phi = 0.3
      rMul = 0.98
    } else if (id === 2) {
      theta = 0
      phi = 1.3
      rMul = 0.94
    } else if (id === 3) {
      theta = -1.46
      phi = 1.32
      rMul = 0.92
    }
    this.cam.gtheta = theta
    this.cam.gphi = phi
    this.cam.gr = R * rMul
    this.cam.gtx = 0
    this.cam.gtz = 0
    this.cam.gty = id === 1 ? targetY * 0.45 : targetY
  }

  private emitProgress(): void {
    this.callbacks.onProgress?.(this.state.p, this.state.playing, stageIndex(this.stages, this.state.p))
  }

  private frame = (): void => {
    if (this.disposed) return
    this.rafId = requestAnimationFrame(this.frame)
    const dt = Math.min(this.clock.getDelta(), 0.05)

    if (this.state.playing) {
      this.state.p += (dt / this.duration) * this.state.speed
      if (this.state.p >= 1) {
        this.state.p = 1
        this.state.playing = false
      }
    }
    const p = this.state.p

    this.updateHazard(p, dt)
    this.updateRain(dt)

    if (this.state.spin) this.cam.gtheta += dt * 0.14
    const ease = 1 - Math.pow(0.001, dt)
    this.cam.theta = this.lerp(this.cam.theta, this.cam.gtheta, ease)
    this.cam.phi = this.lerp(this.cam.phi, this.cam.gphi, ease)
    this.cam.r = this.lerp(this.cam.r, this.cam.gr, 1 - Math.pow(0.004, dt))
    this.cam.tx = this.lerp(this.cam.tx, this.cam.gtx, 1 - Math.pow(0.004, dt))
    this.cam.ty = this.lerp(this.cam.ty, this.cam.gty, 1 - Math.pow(0.004, dt))
    this.cam.tz = this.lerp(this.cam.tz, this.cam.gtz, 1 - Math.pow(0.004, dt))
    this.applyCam()

    this.updateLabels(p)
    this.renderer.render(this.scene, this.camera)
    if (this.state.playing) this.emitProgress()
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.rafId)
    this.observer.disconnect()
    const cv = this.renderer.domElement
    cv.removeEventListener('pointerdown', this.onPointerDown)
    cv.removeEventListener('pointermove', this.onPointerMove)
    cv.removeEventListener('pointerup', this.onPointerUp)
    cv.removeEventListener('pointercancel', this.onPointerUp)
    cv.removeEventListener('contextmenu', this.onContextMenu)
    cv.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('keydown', this.onKeyDown)
    this.container.removeEventListener('pointerdown', this.closeTip)
    this.overlay.remove()
    this.tipEl.remove()
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat?.dispose()
    })
    this.renderer.dispose()
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
  }
}
