import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export interface EngineOptions {
  camera?: {
    fov?: number
    near?: number
    far?: number
    position?: [number, number, number]
  }
  background?: string
  controls?: {
    enablePan?: boolean
    enableZoom?: boolean
    enableRotate?: boolean
    zoomSpeed?: number
    minDistance?: number
    maxDistance?: number
    maxPolarAngle?: number
    minPolarAngle?: number
    autoRotate?: boolean
    autoRotateSpeed?: number
    enableDamping?: boolean
    target?: [number, number, number]
  }
  pixelRatio?: number
  fog?: { color: string; near: number; far: number }
  shadows?: boolean
  toneMapping?: THREE.ToneMapping
}

const easeInOutSine = (x: number): number => -(Math.cos(Math.PI * x) - 1) / 2

/**
 * 命令式 Three.js 引擎：renderer/scene/camera/OrbitControls/帧循环/销毁。
 * 对应参考工程 @react-three/fiber 的 Canvas + drei OrbitControls。
 */
export class DatavEngine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  readonly timer = new THREE.Timer()

  private container: HTMLElement
  private frames: Array<(dt: number, elapsed: number) => void> = []
  private rafId = 0
  private observer: ResizeObserver | null = null
  private disposed = false
  private pixelRatio: number
  private customRender: ((renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) => void) | null = null

  constructor(container: HTMLElement, opts: EngineOptions = {}) {
    this.container = container
    this.pixelRatio = Math.min(opts.pixelRatio ?? 1.5, 2)

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = opts.toneMapping ?? THREE.NoToneMapping
    if (opts.shadows) {
      this.renderer.shadowMap.enabled = true
      this.renderer.shadowMap.type = THREE.PCFShadowMap
    }
    this.renderer.setPixelRatio(this.pixelRatio)
    const canvas = this.renderer.domElement
    canvas.className = 'datav-engine-canvas'
    canvas.style.display = 'block'
    canvas.style.position = 'absolute'
    canvas.style.left = '0'
    canvas.style.top = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.zIndex = '0'
    canvas.style.pointerEvents = 'auto'
    container.insertBefore(canvas, container.firstChild)

    this.scene = new THREE.Scene()
    if (opts.background) this.scene.background = new THREE.Color(opts.background)
    if (opts.fog) this.scene.fog = new THREE.Fog(opts.fog.color, opts.fog.near, opts.fog.far)

    const cam = opts.camera ?? {}
    this.camera = new THREE.PerspectiveCamera(cam.fov ?? 70, 1, cam.near ?? 0.1, cam.far ?? 2000)
    if (cam.position) this.camera.position.set(...cam.position)

    const ctrl = opts.controls ?? {}
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enablePan = ctrl.enablePan ?? true
    this.controls.enableZoom = ctrl.enableZoom ?? true
    this.controls.enableRotate = ctrl.enableRotate ?? true
    this.controls.zoomSpeed = ctrl.zoomSpeed ?? 0.3
    if (ctrl.minDistance !== undefined) this.controls.minDistance = ctrl.minDistance
    if (ctrl.maxDistance !== undefined) this.controls.maxDistance = ctrl.maxDistance
    if (ctrl.maxPolarAngle !== undefined) this.controls.maxPolarAngle = ctrl.maxPolarAngle
    if (ctrl.minPolarAngle !== undefined) this.controls.minPolarAngle = ctrl.minPolarAngle
    this.controls.autoRotate = ctrl.autoRotate ?? false
    this.controls.autoRotateSpeed = ctrl.autoRotateSpeed ?? 2
    this.controls.enableDamping = ctrl.enableDamping ?? true
    if (ctrl.target) this.controls.target.set(...ctrl.target)

    this.timer.connect(document)
    this.resize()
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(container)

    this.loop()
  }

  resize(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  addFrame(fn: (dt: number, elapsed: number) => void): () => void {
    this.frames.push(fn)
    return () => {
      const i = this.frames.indexOf(fn)
      if (i >= 0) this.frames.splice(i, 1)
    }
  }

  setCustomRender(
    fn: ((renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) => void) | null
  ): void {
    this.customRender = fn
  }

  /**
   * 视角入场动画：camPos from -> to，sine.inOut，结束后可启用 controls。
   */
  introMove(from: [number, number, number], to: [number, number, number], duration = 1.5, onDone?: () => void): void {
    this.controls.enabled = false
    this.camera.position.set(...from)
    const start = this.timer.getElapsed()
    const self = this
    const stop = this.addFrame(function animate(dt, elapsed) {
      const t = Math.min((elapsed - start) / duration, 1)
      const e = easeInOutSine(t)
      self.camera.position.set(
        from[0] + (to[0] - from[0]) * e,
        from[1] + (to[1] - from[1]) * e,
        from[2] + (to[2] - from[2]) * e
      )
      void dt
      if (t >= 1) {
        stop()
        self.controls.enabled = true
        onDone?.()
      }
    })
  }

  private loop = (time?: number): void => {
    if (this.disposed) return
    this.rafId = requestAnimationFrame(this.loop)
    this.timer.update(time)
    const dt = this.timer.getDelta()
    const elapsed = this.timer.getElapsed()
    for (const fn of [...this.frames]) fn(dt, elapsed)
    this.controls.update()
    if (this.customRender) this.customRender(this.renderer, this.scene, this.camera)
    else this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.rafId)
    this.timer.dispose()
    this.observer?.disconnect()
    this.observer = null
    this.frames = []
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const material = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(material)) material.forEach((m) => this.disposeMaterial(m))
      else if (material) this.disposeMaterial(material)
    })
    this.controls.dispose()
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
  }

  private disposeMaterial(mat: THREE.Material): void {
    const m = mat as THREE.Material & { map?: THREE.Texture | null; normalMap?: THREE.Texture | null; displacementMap?: THREE.Texture | null }
    for (const key of ['map', 'normalMap', 'displacementMap'] as const) {
      const tex = m[key]
      if (tex) tex.dispose()
    }
    mat.dispose()
  }
}
