import { Cartesian2, Cartesian3, Math as CesiumMath, Rectangle, SceneMode, type Scene, type Viewer } from 'cesium'
import { WindParticleSystem } from './windParticleSystem'
import { deepMerge, computeSpeedFromComponents } from './utils'
import type { ViewerParameters, WindData3D, WindLayerOptions } from './types'
import CustomPrimitive from './customPrimitive'

export const DefaultOptions: WindLayerOptions = {
  particlesTextureSize: 128,
  dropRate: 0.003,
  dropRateBump: 0.01,
  speedFactor: 1.0,
  lineWidth: { min: 1, max: 2 },
  lineLength: { min: 20, max: 100 },
  heightScale: 1,
  colors: ['white'],
  flipY: false,
  useViewerBounds: false,
  pixelSizeMode: 'data',
  dynamic: true
}

export class WindLayer3D {
  private _show = true
  private _isDestroyed = false
  private _updateViewerParametersBound: () => void
  viewer: Viewer
  scene: Scene
  options: WindLayerOptions
  windData: WindData3D
  viewerParameters: ViewerParameters
  particleSystem: WindParticleSystem
  primitives: CustomPrimitive[] = []

  constructor(viewer: Viewer, windData: WindData3D, options: Partial<WindLayerOptions>) {
    this.viewer = viewer
    this.scene = viewer.scene
    this.options = { ...DefaultOptions, ...options }
    this.windData = this.processWindData(windData)

    this.viewerParameters = {
      lonRange: new Cartesian2(-180, 180),
      latRange: new Cartesian2(-90, 90),
      pixelSize: 1000.0,
      sceneMode: this.scene.mode
    }
    this.updateViewerParameters()

    this.particleSystem = new WindParticleSystem(
      (this.scene as unknown as { context: object }).context,
      this.windData,
      this.options,
      this.viewerParameters,
      this.scene
    )
    this.add()

    this._updateViewerParametersBound = this.updateViewerParameters.bind(this)
    this.setupEventListeners()
  }

  get show(): boolean {
    return this._show
  }

  set show(value: boolean) {
    if (this._show !== value) {
      this._show = value
      this.updatePrimitivesVisibility(value)
    }
  }

  setupEventListeners(): void {
    this.viewer.camera.percentageChanged = 0.01
    this.viewer.camera.changed.addEventListener(this._updateViewerParametersBound)
    this.scene.morphComplete.addEventListener(this._updateViewerParametersBound)
    window.addEventListener('resize', this._updateViewerParametersBound)
  }

  removeEventListeners(): void {
    this.viewer.camera.changed.removeEventListener(this._updateViewerParametersBound)
    this.scene.morphComplete.removeEventListener(this._updateViewerParametersBound)
    window.removeEventListener('resize', this._updateViewerParametersBound)
  }

  processWindData(windData: WindData3D): WindData3D {
    if (!windData.speed?.array) {
      const { array, min, max } = computeSpeedFromComponents(
        windData.u.array,
        windData.v.array,
        windData.w.array
      )
      windData = { ...windData, speed: { array, min, max } }
    }
    return windData
  }

  updateViewerParameters(): void {
    const scene = this.viewer.scene
    const canvas = scene.canvas
    const corners = [
      { x: 0, y: 0 },
      { x: 0, y: canvas.clientHeight },
      { x: canvas.clientWidth, y: 0 },
      { x: canvas.clientWidth, y: canvas.clientHeight }
    ]

    let minLon = 180
    let maxLon = -180
    let minLat = 90
    let maxLat = -90
    let isOutsideGlobe = false

    for (const corner of corners) {
      const cartesian = scene.camera.pickEllipsoid(
        new Cartesian2(corner.x, corner.y),
        scene.globe.ellipsoid
      )
      if (!cartesian) {
        isOutsideGlobe = true
        break
      }
      const cartographic = scene.globe.ellipsoid.cartesianToCartographic(cartesian)
      const lon = CesiumMath.toDegrees(cartographic.longitude)
      const lat = CesiumMath.toDegrees(cartographic.latitude)
      minLon = Math.min(minLon, lon)
      maxLon = Math.max(maxLon, lon)
      minLat = Math.min(minLat, lat)
      maxLat = Math.max(maxLat, lat)
    }

    if (!isOutsideGlobe) {
      const lonRange = new Cartesian2(
        Math.max(this.windData.bounds.west, minLon),
        Math.min(this.windData.bounds.east, maxLon)
      )
      const latRange = new Cartesian2(
        Math.max(this.windData.bounds.south, minLat),
        Math.min(this.windData.bounds.north, maxLat)
      )

      const lonBuffer = (lonRange.y - lonRange.x) * 0.05
      const latBuffer = (latRange.y - latRange.x) * 0.05
      lonRange.x = Math.max(this.windData.bounds.west, lonRange.x - lonBuffer)
      lonRange.y = Math.min(this.windData.bounds.east, lonRange.y + lonBuffer)
      latRange.x = Math.max(this.windData.bounds.south, latRange.x - latBuffer)
      latRange.y = Math.min(this.windData.bounds.north, latRange.y + latBuffer)

      this.viewerParameters.lonRange = lonRange
      this.viewerParameters.latRange = latRange

      if (this.options.pixelSizeMode !== 'screen') {
        const dataLonRange = this.windData.bounds.east - this.windData.bounds.west
        const dataLatRange = this.windData.bounds.north - this.windData.bounds.south
        const visibleRatioLon = (lonRange.y - lonRange.x) / dataLonRange
        const visibleRatioLat = (latRange.y - latRange.x) / dataLatRange
        const visibleRatio = Math.min(visibleRatioLon, visibleRatioLat)
        const pixelSize = 1000 * visibleRatio
        if (pixelSize > 0) {
          this.viewerParameters.pixelSize = Math.max(0, Math.min(1000, pixelSize))
        }
      }
    }

    if (this.options.pixelSizeMode === 'screen') {
      const screenPixelSize = this.computeScreenPixelSize()
      if (screenPixelSize > 0 && isFinite(screenPixelSize)) {
        this.viewerParameters.pixelSize = screenPixelSize
      }
    }

    this.viewerParameters.sceneMode = this.scene.mode
    this.particleSystem?.applyViewerParameters(this.viewerParameters)
  }

  /**
   * 依据相机到体域中心的距离估算真实「米/像素」。
   * 局地体域尺寸远小于全球风场，沿用数据范围比例会把像素尺度高估上百倍，
   * 导致粒子拖尾与位移远超体域边界；此模式使拖尾在屏幕上保持稳定像素长度。
   */
  private computeScreenPixelSize(): number {
    const scene = this.viewer.scene
    const canvas = scene.canvas
    const camera = scene.camera
    const fovy = (camera.frustum as { fovy?: number }).fovy ?? Math.PI / 3

    const bounds = this.windData.bounds
    const levels = this.windData.levels
    const centerLon = (bounds.west + bounds.east) / 2
    const centerLat = (bounds.south + bounds.north) / 2
    const centerHeight = levels.length ? (levels[0] + levels[levels.length - 1]) / 2 : 0
    const center = Cartesian3.fromDegrees(centerLon, centerLat, centerHeight)

    const distance = Cartesian3.distance(camera.positionWC, center)
    const viewportHeight = Math.max(canvas.clientHeight || canvas.height || 1, 1)
    return (2 * distance * Math.tan(fovy / 2)) / viewportHeight
  }

  updateWindData(data: WindData3D): void {
    if (this._isDestroyed) return
    this.windData = this.processWindData(data)
    this.particleSystem.computing.updateWindData(this.windData)
    this.viewer.scene.requestRender()
  }

  updateOptions(options: Partial<WindLayerOptions>): void {
    if (this._isDestroyed) return
    this.options = deepMerge(options, this.options)
    this.particleSystem.changeOptions(options)
    this.viewer.scene.requestRender()
  }

  zoomTo(duration = 0): void {
    if (this.windData.bounds) {
      const rectangle = Rectangle.fromDegrees(
        this.windData.bounds.west,
        this.windData.bounds.south,
        this.windData.bounds.east,
        this.windData.bounds.north
      )
      this.viewer.camera.flyTo({ destination: rectangle, duration })
    }
  }

  add(): void {
    this.primitives = this.particleSystem.getPrimitives()
    this.primitives.forEach((primitive) => {
      this.scene.primitives.add(primitive)
    })
  }

  remove(): void {
    this.primitives.forEach((primitive) => {
      this.scene.primitives.remove(primitive)
    })
    this.primitives = []
  }

  isDestroyed(): boolean {
    return this._isDestroyed
  }

  destroy(): void {
    this.remove()
    this.removeEventListeners()
    this.particleSystem.destroy()
    this._isDestroyed = true
  }

  updatePrimitivesVisibility(visibility: boolean): void {
    const show = visibility !== undefined ? visibility : this._show
    this.primitives.forEach((primitive) => {
      primitive.show = show
    })
  }
}

export default WindLayer3D

export type { WindData3D, ViewerParameters }
export { SceneMode }
