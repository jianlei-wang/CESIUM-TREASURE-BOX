import * as THREE from 'three'
import type * as Cesium from 'cesium'
import type { GridSpec } from '@rt/types/model'
import { SpatialTransform } from './spatial'
import { CesiumEngine } from './cesium-engine'
import { VolumeRenderer, type VolumeRenderState, type VolumeAtlasBinding } from '@rt/rendering/volume-renderer'
import { SurfaceFieldRenderer, type SurfaceAtlasBinding } from '@rt/rendering/surface-renderer'
import { FlowParticleRenderer } from '@rt/rendering/particle-renderer'
import { CrossSectionRenderer } from '@rt/rendering/cross-section-renderer'
import { DepthAwareCompositeRenderer, getThreeTextureHandle } from '@rt/rendering/composite-renderer'
import { GpuFlowParticleSimulator } from '@rt/simulation/gpu-flow-particle-simulator'

export interface ThreeFieldRenderOptions {
  showVolume: boolean
  showSurface: boolean
  showFlow: boolean
  showSection: boolean
  thresholdLow: number
  thresholdHigh: number
  density: number
  surfaceOpacity: number
  flowOpacity: number
  particleStyle: ParticleStyle
  renderMode: VolumeRenderState['renderMode']
  isoValue: number
  isoThickness: number
  clipEnabled: boolean
  clipDepth: number
  sectionX: number
  sectionAxis: 'x' | 'y'
}

export type ParticleStyle = 'star' | 'arrow' | 'diamond' | 'ring'
export type FlowRenderer = FlowParticleRenderer | GpuFlowParticleSimulator

export class ThreeOverlayEngine {
  readonly canvas: HTMLCanvasElement
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly volume: VolumeRenderer
  readonly surface: SurfaceFieldRenderer
  readonly section: CrossSectionRenderer
  readonly compositor: DepthAwareCompositeRenderer
  flow: FlowRenderer

  private readonly cesium: CesiumEngine
  private readonly grid: GridSpec
  private disposed = false
  private overlayTarget: THREE.WebGLRenderTarget
  private lastRenderTime = 0
  private pixelRatio = 1
  private options: ThreeFieldRenderOptions
  // 当前默认采用“直接绘制到 Cesium 默认 framebuffer”路径。
  // 这样 Cesium 原生场景保留在底层，Three 科学图层直接叠加，绕开 MRT + Fullscreen Composite
  // 在不同 Cesium framebuffer 生命周期下可能造成的黑屏/空白问题。
  private renderPath: 'direct' | 'composite' = 'direct'

  constructor(
    cesium: CesiumEngine,
    grid: GridSpec,
    initialField8: Uint8Array,
    initialSurface8: Uint8Array,
    initialParticles: Float32Array,
    initialParticleIntensities: Float32Array,
    spatial: SpatialTransform,
    initialOptions: ThreeFieldRenderOptions,
  ) {
    this.cesium = cesium
    this.grid = grid
    this.canvas = cesium.canvas
    this.options = initialOptions

    const context = cesium.gl
    if (!(context instanceof WebGL2RenderingContext)) throw new Error('Cesium 当前未使用 WebGL2，无法建立共享 Three.js 渲染链。')
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      context,
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance',
      depth: true,
      stencil: false,
      logarithmicDepthBuffer: false,
      reversedDepthBuffer: false,
    })
    this.renderer.setPixelRatio(1)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.sortObjects = true
    this.renderer.autoClear = false
    this.renderer.autoClearColor = false
    this.renderer.autoClearDepth = false
    this.renderer.autoClearStencil = false

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 10_000_000)
    this.camera.up.set(0, 0, 1)

    this.volume = new VolumeRenderer(this.renderer, grid, initialField8)
    this.surface = new SurfaceFieldRenderer(this.scene, grid, initialSurface8)
    this.section = new CrossSectionRenderer(this.scene, grid)
    this.flow = new FlowParticleRenderer(this.scene, this.grid, initialParticles, initialParticleIntensities)
    this.compositor = new DepthAwareCompositeRenderer(this.renderer)

    this.overlayTarget = this.createOverlayTarget(1, 1)
    this.applyOptions(initialOptions)
    this.resize()
    this.updateCamera(spatial, cesium.viewer.camera)
  }

  get supportsGpgpu(): boolean {
    if (!this.renderer.capabilities.isWebGL2) return false
    return Boolean(this.renderer.extensions.has('EXT_color_buffer_float'))
  }

  get depthOcclusionSupported(): boolean { return this.cesium.depthOcclusionSupported }

  get pipelineLabel(): string {
    return this.depthOcclusionSupported ? 'Cesium + Three Direct + Cesium Depth' : 'Cesium + Three Direct（无深度遮挡）'
  }

  get renderPathLabel(): string {
    return this.renderPath === 'direct' ? 'direct-framebuffer' : 'offscreen-composite'
  }

  get sceneObjectCount(): number {
    return this.scene.children.length
  }

  enableGpuFlow(): GpuFlowParticleSimulator {
    if (this.flow instanceof GpuFlowParticleSimulator) return this.flow
    this.flow.dispose()
    const gpuFlow = new GpuFlowParticleSimulator(this.renderer, this.scene, this.grid, 8192)
    gpuFlow.setStyle(this.options.particleStyle)
    this.flow = gpuFlow
    return gpuFlow
  }

  useCpuFlow(): FlowParticleRenderer {
    if (this.flow instanceof FlowParticleRenderer) return this.flow
    this.flow.dispose()
    const cpuFlow = new FlowParticleRenderer(this.scene, this.grid, new Float32Array(5200 * 3), new Float32Array(5200))
    this.flow = cpuFlow
    return cpuFlow
  }

  bindGpuField(texture: THREE.Texture, nx: number, ny: number, nz: number): void {
    const binding: VolumeAtlasBinding = { texture, nx, ny, nz }
    this.volume.bindAtlas(binding)
    const surfaceBinding: SurfaceAtlasBinding = { texture, nx, ny, nz }
    this.surface.bindAtlas(surfaceBinding)
    this.section.bindAtlas(texture)
    if (this.flow instanceof GpuFlowParticleSimulator) this.flow.bindFieldTexture(texture)
  }

  updateCamera(spatial: SpatialTransform, cesiumCamera: Cesium.Camera): void {
    spatial.cameraToThree(cesiumCamera, this.camera)
    this.camera.aspect = this.canvas.clientWidth / Math.max(this.canvas.clientHeight, 1)
    this.camera.updateProjectionMatrix()
    this.camera.userData.localCameraPosition = spatial.cameraLocalPosition(
      cesiumCamera,
      this.camera.userData.localCameraPosition ?? new THREE.Vector3(),
    )
    this.volume.updateCamera(this.camera.userData.localCameraPosition, this.camera)
  }

  updateField(field8: Uint8Array, surface8: Uint8Array, particles: Float32Array, particleIntensities: Float32Array, elapsedSeconds: number): void {
    this.volume.updateField(field8)
    this.surface.updateSurface(surface8)
    if (this.flow instanceof FlowParticleRenderer) this.flow.updateParticleData(particles, particleIntensities)
    this.volume.updateTime(elapsedSeconds)
    this.section.bindVolume(this.volume.fallbackTexture)
  }

  updateTime(elapsedSeconds: number): void {
    this.volume.updateTime(elapsedSeconds)
  }

  applyOptions(options: ThreeFieldRenderOptions): void {
    this.options = options
    this.volume.setVisible(options.showVolume)
    this.surface.setVisible(options.showSurface)
    this.flow.setVisible(options.showFlow)
    this.section.setVisible(options.showSection)
    this.volume.setThreshold(options.thresholdLow, options.thresholdHigh)
    this.surface.setThreshold(options.thresholdLow, options.thresholdHigh)
    this.section.setThreshold(options.thresholdLow, options.thresholdHigh)
    this.volume.setDensity(options.density)
    this.surface.setOpacity(options.surfaceOpacity)
    this.flow.setOpacity(options.flowOpacity)
    this.flow.setStyle(options.particleStyle)
    this.volume.setScientificState({
      renderMode: options.renderMode,
      isoValue: options.isoValue,
      isoThickness: options.isoThickness,
      clipEnabled: options.clipEnabled,
      clipDepth: options.clipDepth,
    })
    this.section.setAxis(options.sectionAxis)
    this.section.setIsoValue(options.isoValue)
    this.section.setOpacity(Math.min(0.82, options.surfaceOpacity + 0.14))
    this.section.setSectionX(options.sectionX)
  }

  /** 首帧预热：显式编译/初始化所有关键材质与 RenderTarget，避免首次 postRender 时才创建 GPU 资源导致黑屏。 */
  warmup(): void {
    this.renderer.resetState()
    this.resize()
    this.renderer.compile(this.scene, this.camera)
    this.renderer.compile(this.volume.scene, this.camera)
    this.volume.warmup(this.renderer, this.camera)
    this.renderer.setRenderTarget(this.overlayTarget)
    this.renderer.clear(true, true, false)
    this.renderer.render(this.scene, this.camera)
    this.renderer.setRenderTarget(null)
    this.renderer.resetState()
  }

  renderAfterCesium(): void {
    if (this.disposed) return
    const startedAt = performance.now()
    this.renderer.resetState()
    this.resize()

    // 共享 WebGL2 Context 的第一原则：不要清除 Cesium 已经绘制好的颜色/深度。
    // 直接路径将 Three 场景作为前景层绘制在 Cesium 默认 framebuffer 上。
    if (this.renderPath === 'direct') {
      this.volume.bindCesiumOcclusionDepth(this.depthOcclusionSupported ? this.cesium.depthTexture : null)

      // 先画体渲染，再画表层场 / 剖面 / 粒子，使粒子成为最上层动态信息。
      if (this.options.showVolume) {
        this.volume.renderDirect(this.renderer, this.camera)
      }

      this.renderer.setRenderTarget(null)
      this.renderer.setScissorTest(false)
      this.renderer.setViewport(0, 0, this.canvas.width, this.canvas.height)
      this.renderer.setClearColor(0, 0)
      this.renderer.render(this.scene, this.camera)
      this.renderer.resetState()
      this.lastRenderTime = performance.now() - startedAt
      return
    }

    // Legacy composite path 保留用于后续需要 MRT 深度复合时的研究验证。
    this.renderer.setRenderTarget(this.overlayTarget)
    this.renderer.setClearColor(0, 0)
    this.renderer.clear(true, true, false)
    this.renderer.render(this.scene, this.camera)
    this.renderer.setRenderTarget(null)

    this.volume.bindCesiumOcclusionDepth(this.depthOcclusionSupported ? this.cesium.depthTexture : null)
    this.volume.renderToTarget(this.renderer, this.camera)

    const volumeColor = getThreeTextureHandle(this.renderer, this.volume.colorTexture)
    const volumeDepth = getThreeTextureHandle(this.renderer, this.volume.linearDepthTexture)
    const overlayColor = getThreeTextureHandle(this.renderer, this.overlayTarget.texture)
    const overlayDepth = getThreeTextureHandle(this.renderer, this.overlayTarget.depthTexture)
    const cesiumDepth = this.cesium.depthTexture

    this.compositor.render({
      volumeColor,
      volumeDepth,
      overlayColor,
      overlayDepth,
      cesiumDepth,
      hasVolume: this.options.showVolume && Boolean(volumeColor && volumeDepth),
      hasOverlay: Boolean((this.options.showSurface || this.options.showFlow || this.options.showSection) && overlayColor && overlayDepth),
      hasCesiumDepth: this.depthOcclusionSupported && Boolean(cesiumDepth),
    }, this.camera.near, this.camera.far)

    this.lastRenderTime = performance.now() - startedAt
  }

  get lastGpuRenderMs(): number { return this.lastRenderTime }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.volume.dispose()
    this.surface.dispose()
    this.section.dispose()
    this.flow.dispose()
    this.compositor.dispose()
    this.overlayTarget.dispose()
    this.renderer.dispose()
  }

  private readonly resize = (): void => {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (width <= 0 || height <= 0) return
    const drawingWidth = Math.max(1, this.canvas.width)
    const drawingHeight = Math.max(1, this.canvas.height)
    this.pixelRatio = drawingWidth / width
    // Cesium owns the shared canvas size. Never call renderer.setSize() here, otherwise Three can overwrite
    // Cesium's drawing buffer dimensions and break depth-texture alignment.
    this.renderer.setViewport(0, 0, drawingWidth, drawingHeight)
    this.overlayTarget.setSize(drawingWidth, drawingHeight)
    this.volume.setSize(drawingWidth, drawingHeight)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  private createOverlayTarget(width: number, height: number): THREE.WebGLRenderTarget {
    const depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType)
    depthTexture.format = THREE.DepthFormat
    depthTexture.minFilter = THREE.NearestFilter
    depthTexture.magFilter = THREE.NearestFilter
    const target = new THREE.WebGLRenderTarget(width, height, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
    })
    target.texture.colorSpace = THREE.NoColorSpace
    return target
  }
}
