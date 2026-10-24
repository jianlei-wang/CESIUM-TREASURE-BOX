import * as THREE from 'three'
import { Cartesian3, Matrix4, Transforms, type Viewer } from 'cesium'
import type { CameraSpec, GeoAnchor } from './types'
import { PerformanceMonitor } from './core/PerformanceMonitor'
import { ResourceTracker } from './core/ResourceTracker'
import { QualityGovernor, type QualityPreset } from './core/QualityGovernor'
import { GpuTimer } from './core/GpuTimer'
import { OcclusionProxySet, type OcclusionProxy } from './core/OcclusionProxy'

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
  private lastTime = performance.now()
  private disposed = false
  private readonly quality = new QualityGovernor('auto')
  private readonly monitor = new PerformanceMonitor()
  private readonly resources = new ResourceTracker()
  private readonly occlusion = new OcclusionProxySet()
  private readonly gpuTimer: GpuTimer
  private orbit = false

  constructor(viewer: Viewer, container: HTMLElement, anchor: GeoAnchor) {
    this.viewer = viewer
    this.container = container
    this.anchor = anchor

    viewer.resolutionScale = this.quality.scale
    viewer.scene.postProcessStages.fxaa.enabled = false
    viewer.scene.globe.maximumScreenSpaceError = 4
    viewer.scene.globe.showGroundAtmosphere = false
    viewer.scene.fog.enabled = false
    if (viewer.scene.sun) viewer.scene.sun.show = false

    const pixelRatio = Math.min(1.5, window.devicePixelRatio || 1)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.autoClear = true
    this.gpuTimer = new GpuTimer(this.renderer.getContext())
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

    this.monitor.start()
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

  setView(camera: CameraSpec, duration = 0): void {
    const range = camera.range
    const pitch = (camera.pitch * Math.PI) / 180
    const heading = (camera.heading * Math.PI) / 180
    const targetY = camera.targetY ?? 0
    const horizontal = range * Math.cos(pitch)
    const east = -horizontal * Math.sin(heading)
    const north = -horizontal * Math.cos(heading)
    const up = targetY + range * Math.sin(-pitch)
    const destination = Matrix4.multiplyByPoint(this.enuToEcef, new Cartesian3(east, north, up), new Cartesian3())
    if (duration > 0) {
      this.viewer.camera.flyTo({ destination, orientation: { heading, pitch, roll: 0 }, duration })
    } else {
      this.viewer.camera.setView({ destination, orientation: { heading, pitch, roll: 0 } })
    }
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

  setAutoOrbit(enabled: boolean): void {
    this.orbit = enabled
  }

  setQualityPreset(preset: QualityPreset): void {
    const scale = this.quality.setPreset(preset)
    this.applyQualityScale(scale)
    this.monitor.setQuality(scale)
  }

  getQualityPreset(): QualityPreset {
    return this.quality.qualityPreset
  }

  setOcclusionProxies(proxies: OcclusionProxy[]): void {
    this.occlusion.clear()
    for (const proxy of proxies) this.occlusion.add(proxy)
  }

  testOcclusion(origin: [number, number, number], target: [number, number, number]): boolean {
    return this.occlusion.occluded(origin, target)
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
    const raw = Math.max(0, (now - this.lastTime) / 1000)
    this.lastTime = now
    const elapsed = Math.min(0.5, raw)
    if (elapsed > 0) this.onFrame?.(elapsed)
    this.applyQualityScale(this.quality.sample(raw))
    this.monitor.gpuFrame(this.gpuTimer.poll())
    this.monitor.frame(raw * 1000, {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: this.renderer.info.programs?.length ?? 0
    })
    this.monitor.setQuality(this.quality.scale)
    if (this.orbit) {
      const cartographic = this.viewer.camera.positionCartographic
      this.viewer.camera.setView({
        destination: Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, cartographic.height),
        orientation: { heading: this.viewer.camera.heading + raw * 0.08, pitch: this.viewer.camera.pitch, roll: 0 }
      })
    }

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

    this.gpuTimer.begin()
    this.renderer.render(this.scene, this.camera)
    this.gpuTimer.end()
  }

  private applyQualityScale(scale: number): void {
    if (Math.abs(scale - this.viewer.resolutionScale) < 0.001) return
    this.viewer.resolutionScale = scale
    const pixelRatio = Math.min(1.5, window.devicePixelRatio || 1) * (scale < 0.7 ? 0.9 : 1)
    this.renderer.setPixelRatio(pixelRatio)
  }

  getAnchor(): GeoAnchor {
    return this.anchor
  }

  getPerformance() {
    this.resources.trackObjectOnce(this.root)
    this.monitor.setResources(this.resources.report())
    return this.monitor.snapshot()
  }

  getResources() {
    return this.resources.report()
  }

  recordPhysics(ms: number): void {
    this.monitor.physicsStep(ms)
  }

  setBacklog(milliseconds: number, droppedSeconds: number): void {
    this.monitor.setBacklog(milliseconds, droppedSeconds)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.onFrame = null
    this.observer.disconnect()
    this.removePostRender()
    this.gpuTimer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.resources.trackObjectOnce(this.root)
    this.resources.disposeAll()
    this.scene.clear()
    this.monitor.dispose()
  }
}
