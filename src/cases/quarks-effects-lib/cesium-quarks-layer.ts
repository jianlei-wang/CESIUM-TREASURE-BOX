import * as THREE from 'three'
import { BatchedRenderer, type ParticleSystem } from 'three.quarks'
import { Cartesian3, Matrix4, Transforms, type Viewer } from 'cesium'

export interface QuarksOrigin {
  lon: number
  lat: number
  height: number
}

/**
 * 将 three.js + three.quarks 粒子场景叠加到 Cesium 地球之上。
 *
 * 做法：在 Cesium 容器上覆盖一层透明 WebGL canvas，three 世界坐标取
 * 以特效锚点为中心的局部 ENU 坐标系（y 轴向上，x 轴向东，z 轴向南），
 * 每帧用 Cesium 相机的 view/projection 矩阵推算出 three 相机位姿，
 * 保证粒子与地球视角严格对齐，同时避免 ECEF 大坐标带来的浮点抖动。
 */
export class CesiumQuarksLayer {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly batchRenderer: BatchedRenderer

  /** 每帧回调（在更新粒子系统前调用），用于烟花换位等动态逻辑 */
  onFrame: ((delta: number) => void) | null = null

  private readonly viewer: Viewer
  private readonly container: HTMLElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly timer = new THREE.Timer()
  private readonly observer: ResizeObserver
  private readonly removePostRender: () => void
  private readonly systems = new Set<ParticleSystem>()

  // three.js(x,y,z) -> ENU(x, -z, y)：three +y 向上、+z 向 (ENU 东=x/北=y/上=z)。
  // 注意 Cesium.Matrix4 构造函数参数为“行优先”，前四个参数是第 0 行。
  private readonly axisSwap = new Matrix4(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1)
  private readonly enuToEcef = new Matrix4()
  private readonly threeToEcef = new Matrix4()
  private readonly tmpView = new Matrix4()
  private readonly tmpWorld = new Matrix4()
  private readonly arr: number[] = new Array<number>(16)
  private disposed = false

  constructor(viewer: Viewer, container: HTMLElement, origin: QuarksOrigin) {
    this.viewer = viewer
    this.container = container

    const pixelRatio = Math.min(2, window.devicePixelRatio || 1)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.autoClear = true
    const canvas = this.renderer.domElement
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      zIndex: '5',
      pointerEvents: 'none'
    } as CSSStyleDeclaration)
    container.appendChild(canvas)

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1e8)
    this.camera.matrixAutoUpdate = false
    this.batchRenderer = new BatchedRenderer()
    this.scene.add(this.batchRenderer)

    this.setOrigin(origin)
    this.resize()
    this.timer.connect(document)

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(container)

    this.removePostRender = viewer.scene.postRender.addEventListener(() => this.render()) as unknown as () => void
    this.render()
  }

  setOrigin(origin: QuarksOrigin): void {
    Transforms.eastNorthUpToFixedFrame(
      Cartesian3.fromDegrees(origin.lon, origin.lat, origin.height),
      undefined,
      this.enuToEcef
    )
    Matrix4.multiply(this.enuToEcef, this.axisSwap, this.threeToEcef)
  }

  addSystem(system: ParticleSystem): void {
    if (this.systems.has(system)) return
    this.systems.add(system)
    this.scene.add(system.emitter)
    this.batchRenderer.addSystem(system)
    system.play()
  }

  removeSystem(system: ParticleSystem): void {
    if (!this.systems.has(system)) return
    this.systems.delete(system)
    this.batchRenderer.deleteSystem(system)
    this.scene.remove(system.emitter)
    system.dispose()
  }

  clearSystems(): void {
    for (const system of Array.from(this.systems)) this.removeSystem(system)
  }

  private resize(): void {
    if (this.disposed) return
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(width, height, false)
  }

  private render(): void {
    if (this.disposed || this.viewer.isDestroyed()) return

    this.timer.update()
    const delta = Math.min(0.1, this.timer.getDelta())
    this.onFrame?.(delta)
    this.batchRenderer.update(delta)

    const cesiumCamera = this.viewer.camera
    Matrix4.multiply(cesiumCamera.viewMatrix, this.threeToEcef, this.tmpView)
    Matrix4.inverse(this.tmpView, this.tmpWorld)
    Matrix4.toArray(this.tmpWorld, this.arr)
    this.camera.matrix.fromArray(this.arr)
    this.camera.matrixWorld.fromArray(this.arr)
    this.camera.matrixWorldNeedsUpdate = false
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert()

    Matrix4.toArray(cesiumCamera.frustum.projectionMatrix, this.arr)
    this.camera.projectionMatrix.fromArray(this.arr)
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert()

    this.renderer.render(this.scene, this.camera)
  }

  getCanvas(): HTMLCanvasElement {
    return this.renderer.domElement
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearSystems()
    this.observer.disconnect()
    this.removePostRender()
    this.timer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
