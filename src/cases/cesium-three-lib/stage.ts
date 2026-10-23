import * as THREE from 'three'
import { Cartesian3, Matrix4, Transforms, type Viewer } from 'cesium'
import type { CameraSpec, GeoAnchor } from './types'

export type FrameHandler = (dt: number) => void

export class GeoThreeStage {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly root: THREE.Group

  onFrame: FrameHandler | null = null

  private readonly viewer: Viewer
  private readonly container: HTMLElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly observer: ResizeObserver
  private readonly removePostRender: () => void
  private readonly axisSwap = new Matrix4(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1)
  private readonly enuToEcef = new Matrix4()
  private readonly threeToEcef = new Matrix4()
  private readonly viewMatrix = new Matrix4()
  private readonly worldMatrix = new Matrix4()
  private readonly matrixArray: number[] = new Array<number>(16)
  private readonly anchor: GeoAnchor
  private accumulator = 0
  private lastTime = performance.now()
  private disposed = false

  constructor(viewer: Viewer, container: HTMLElement, anchor: GeoAnchor) {
    this.viewer = viewer
    this.container = container
    this.anchor = anchor

    const pixelRatio = Math.min(1.75, window.devicePixelRatio || 1)
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
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.4, 2.2e7)
    this.camera.matrixAutoUpdate = false
    this.root = new THREE.Group()
    this.scene.add(this.root)

    const hemisphere = new THREE.HemisphereLight(0xd8f2ff, 0x1a2730, 1.25)
    this.scene.add(hemisphere)
    const keyLight = new THREE.DirectionalLight(0xfff1d6, 2.1)
    keyLight.position.set(-120, 210, 140)
    this.scene.add(keyLight)
    const rimLight = new THREE.DirectionalLight(0x5fb6e8, 0.7)
    rimLight.position.set(180, 90, -160)
    this.scene.add(rimLight)

    this.setAnchor(anchor)
    this.resize()
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(container)
    this.removePostRender = viewer.scene.postRender.addEventListener(() => this.renderFrame()) as unknown as () => void
    this.renderFrame()
  }

  setAnchor(anchor: GeoAnchor): void {
    const origin = Cartesian3.fromDegrees(anchor.lon, anchor.lat, anchor.height)
    Transforms.eastNorthUpToFixedFrame(origin, undefined, this.enuToEcef)
    Matrix4.multiply(this.enuToEcef, this.axisSwap, this.threeToEcef)
  }

  setView(camera: CameraSpec): void {
    const range = camera.range
    const pitch = (camera.pitch * Math.PI) / 180
    const heading = (camera.heading * Math.PI) / 180
    const targetY = camera.targetY ?? 0
    const horizontal = range * Math.cos(pitch)
    const east = -horizontal * Math.sin(heading)
    const north = -horizontal * Math.cos(heading)
    const up = targetY + range * Math.sin(-pitch)
    const destination = Matrix4.multiplyByPoint(this.enuToEcef, new Cartesian3(east, north, up), new Cartesian3())
    this.viewer.camera.setView({ destination, orientation: { heading, pitch, roll: 0 } })
  }

  focus(target: THREE.Vector3, camera: Partial<CameraSpec>): void {
    const range = camera.range ?? 120
    const pitch = ((camera.pitch ?? -28) * Math.PI) / 180
    const heading = ((camera.heading ?? 18) * Math.PI) / 180
    const horizontal = range * Math.cos(pitch)
    const east = target.x - horizontal * Math.sin(heading)
    const north = -target.z - horizontal * Math.cos(heading)
    const up = target.y + range * Math.sin(-pitch)
    const destination = Matrix4.multiplyByPoint(this.enuToEcef, new Cartesian3(east, north, up), new Cartesian3())
    this.viewer.camera.setView({ destination, orientation: { heading, pitch, roll: 0 } })
  }

  setVisible(visible: boolean): void {
    this.renderer.domElement.style.display = visible ? 'block' : 'none'
  }

  private resize(): void {
    if (this.disposed) return
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(width, height, false)
  }

  private renderFrame(): void {
    if (this.disposed || this.viewer.isDestroyed()) return
    const now = performance.now()
    const elapsed = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000))
    this.lastTime = now
    const fixedDt = 1 / 60
    this.accumulator += elapsed
    let steps = 0
    while (this.accumulator >= fixedDt && steps < 5) {
      this.onFrame?.(fixedDt)
      this.accumulator -= fixedDt
      steps += 1
    }
    if (steps >= 5 && this.accumulator >= fixedDt) this.accumulator = 0

    Matrix4.multiply(this.viewer.camera.viewMatrix, this.threeToEcef, this.viewMatrix)
    Matrix4.inverse(this.viewMatrix, this.worldMatrix)
    Matrix4.toArray(this.worldMatrix, this.matrixArray)
    this.camera.matrix.fromArray(this.matrixArray)
    this.camera.matrixWorld.fromArray(this.matrixArray)
    this.camera.matrixWorldNeedsUpdate = false
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert()
    Matrix4.toArray(this.viewer.camera.frustum.projectionMatrix, this.matrixArray)
    this.camera.projectionMatrix.fromArray(this.matrixArray)
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert()

    this.renderer.render(this.scene, this.camera)
  }

  getAnchor(): GeoAnchor {
    return this.anchor
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.onFrame = null
    this.observer.disconnect()
    this.removePostRender()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.scene.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(material)) {
        for (const item of material) item.dispose()
      } else if (material) {
        material.dispose()
      }
    })
    this.scene.clear()
  }
}
