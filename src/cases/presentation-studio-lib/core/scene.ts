import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cesium3DTileColorBlendMode,
  Cesium3DTileStyle,
  Cesium3DTileset,
  ClippingPlane,
  buildModuleUrl,
  ClippingPlaneCollection,
  Color,
  ColorMaterialProperty,
  ConstantPositionProperty,
  ConstantProperty,
  EllipsoidTerrainProvider,
  GeoJsonDataSource,
  HorizontalOrigin,
  Ion,
  JulianDate,
  LabelCollection,
  LabelStyle,
  Material,
  NearFarScalar,
  PerspectiveFrustum,
  PointPrimitiveCollection,
  PolylineGlowMaterialProperty,
  SceneTransforms,
  ShadowMode,
  TileMapServiceImageryProvider,
  VerticalOrigin,
  Viewer,
  type ImageryLayer,
  type TerrainProvider
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { recordDiagnostic } from './diagnostics'
import { DataSourceRegistry, createImageryProvider, createTerrainProvider } from './data-sources'
import { DAYANTA_SCENE_TEMPLATE, type SceneTemplate } from './scene-template'
import { clamp } from './timeline'
import { runtimeConfig } from '../../../runtime-config'
import type { CameraPose, CustomLayer, LayerId, RuntimeState } from './types'

const MIN_CAMERA_CLEARANCE = 4
const MAX_CAMERA_HEIGHT = 3000000

const CESIUM_ION_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmNGI3MTJlZi1kNGFmLTQ1OWQtYmJiMC0yMDViNjM0ZDdjYzMiLCJpZCI6Mzg2MzU3LCJpYXQiOjE3NzAwODA5MDJ9.-ggs9Xfr6ptMLXTs0MS7xdieNVFr7TMV7yyd-yjxyHw'

export type CustomLayerStatus = 'empty' | 'loading' | 'ready' | 'error'

export interface CustomLayerState {
  id: string
  status: CustomLayerStatus
  message?: string
}

export interface SceneReadiness {
  viewerReady: boolean
  metadataReady: boolean
  visualReady: boolean
  exportReady: boolean
  pendingAssets: number
  missingAssets: string[]
  warnings: string[]
}

const ANALYSIS_SHADER = `
uniform float contourOn;
uniform vec4 contourColor;
uniform float contourSpacing;
uniform float contourWidth;
uniform float slopeOn;
uniform vec4 slopeLow;
uniform vec4 slopeHigh;
uniform float slopeAlpha;

czm_material czm_getMaterial(czm_materialInput materialInput)
{
  czm_material material = czm_getDefaultMaterial(materialInput);
  float height = materialInput.height;
  float alpha = 0.0;
  vec3 color = material.diffuse;

  if (slopeOn > 0.001) {
    float dx = abs(dFdx(height));
    float dy = abs(dFdy(height));
    float slope = clamp(length(vec2(dx, dy)) * 1.55, 0.0, 1.0);
    color = mix(slopeLow.rgb, slopeHigh.rgb, slope);
    alpha = slopeAlpha;
  }

  if (contourOn > 0.001) {
    float distanceToContour = mod(height, contourSpacing);
    float dF = max(abs(dFdx(height)), abs(dFdy(height))) * czm_pixelRatio * contourWidth;
    float line = distanceToContour < dF ? 1.0 : 0.0;
    color = mix(color, contourColor.rgb, line * contourColor.a);
    alpha = max(alpha, line * contourColor.a);
  }

  material.diffuse = color;
  material.alpha = alpha;
  return material;
}
`

export interface SceneCallbacks {
  onStatus?: (message: string, detail?: string) => void
  onWarning?: (message: string) => void
}

export interface ScreenPoint {
  x: number
  y: number
  visible: boolean
}

type PointItem = ReturnType<PointPrimitiveCollection['add']>
type LabelItem = ReturnType<LabelCollection['add']>

interface CustomLayerHandle {
  kind: CustomLayer['kind']
  uri: string
  tileset?: Cesium3DTileset
  dataSource?: GeoJsonDataSource
  dispose: () => void
}

interface LandmarkVisual {
  point: PointItem
  label: LabelItem
  color: Color
}

interface BeaconVisual {
  pillar: ReturnType<Viewer['entities']['add']>
  ring: ReturnType<Viewer['entities']['add']>
  pillarMaterial: ColorMaterialProperty
  ringMaterial: ColorMaterialProperty
  baseHeight: number
  color: Color
  base: Cartesian3
  longitude: number
  latitude: number
  groundHeight: number
}

export class PresentationScene {
  private viewer: Viewer | undefined
  private imageryLayer: ImageryLayer | undefined
  private terrainProvider: TerrainProvider | undefined
  private ellipsoidTerrain = new EllipsoidTerrainProvider()
  private tileset: Cesium3DTileset | undefined
  private clippingCollection: ClippingPlaneCollection | undefined
  private clippingPlane: ClippingPlane | undefined
  private clippingBase = 0
  private clippingHeight = 100
  private pointCollection: PointPrimitiveCollection | undefined
  private labelCollection: LabelCollection | undefined
  private landmarks: LandmarkVisual[] = []
  private beacons: BeaconVisual[] = []
  private routeEntity: ReturnType<Viewer['entities']['add']> | undefined
  private routeCursor: ReturnType<Viewer['entities']['add']> | undefined
  private recordingEntity: ReturnType<Viewer['entities']['add']> | undefined
  private analysisMaterial: Material | undefined
  private analysisActive = false
  private lastRoute: RuntimeState['route'] = null
  private lastPose: CameraPose | null = null
  private lastLayerAlpha = new Map<LayerId, number>()
  private lastDayantaAlpha = -1
  private lastRouteAlpha = -1
  private lastLandmarkAlpha = -1
  private lastLandmarkProgress = -1
  private lastBeaconAlpha = -1
  private lastBeaconProgress = -1
  private terrainEnabled = false
  private shadowsEnabled = true
  private lightingEnabled = true
  private atmosphereEnabled = true
  private contoursEnabled = false
  private destroyRequested = false
  private lastRuntime: RuntimeState | null = null
  private callbacks: SceneCallbacks
  private readonly template: SceneTemplate
  private readonly dataSources: DataSourceRegistry
  private readiness: SceneReadiness = {
    viewerReady: false,
    metadataReady: false,
    visualReady: false,
    exportReady: false,
    pendingAssets: 0,
    missingAssets: [],
    warnings: []
  }
  private assetTasks = new Set<Promise<unknown>>()
  private generation = 0
  private extraTilesets = new Map<string, Cesium3DTileset>()
  private customLayerHandles = new Map<string, CustomLayerHandle>()
  private customLayerEpoch = 0
  private customLayerStates = new Map<string, CustomLayerState>()
  private groundHeightCache = new Map<string, number>()

  constructor(
    private readonly container: HTMLElement,
    callbacks: SceneCallbacks = {},
    template: SceneTemplate = DAYANTA_SCENE_TEMPLATE,
    dataSources: DataSourceRegistry = new DataSourceRegistry()
  ) {
    this.callbacks = callbacks
    this.template = template
    this.dataSources = dataSources
  }

  getReadiness(): SceneReadiness {
    return { ...this.readiness, missingAssets: [...this.readiness.missingAssets], warnings: [...this.readiness.warnings] }
  }

  getDataSourceStates() {
    return this.dataSources.snapshot()
  }

  getCustomLayerStates(): CustomLayerState[] {
    return [...this.customLayerStates.values()].map((state) => ({ ...state }))
  }

  private markMissing(asset: string, reason: string): void {
    if (!this.readiness.missingAssets.includes(asset)) this.readiness.missingAssets.push(asset)
    this.readiness.warnings.push(`${asset}：${reason}`)
    this.callbacks.onWarning?.(`资源未就绪：${asset}（${reason}）`)
  }

  private clearMissing(asset: string): void {
    this.readiness.missingAssets = this.readiness.missingAssets.filter((item) => item !== asset)
    const prefix = `${asset}：`
    this.readiness.warnings = this.readiness.warnings.filter((item) => !item.startsWith(prefix))
  }

  private updateReadiness(): void {
    this.readiness.pendingAssets = this.assetTasks.size
    this.readiness.exportReady =
      this.readiness.viewerReady &&
      this.readiness.metadataReady &&
      this.readiness.visualReady &&
      this.readiness.pendingAssets === 0
  }

  private trackAsset(id: string, task: Promise<unknown>, required: boolean): Promise<void> {
    const tracked = task
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        if (required) this.markMissing(id, message)
        else this.readiness.warnings.push(`${id}：${message}`)
      })
      .finally(() => {
        this.assetTasks.delete(tracked)
        this.updateReadiness()
      })
    this.assetTasks.add(tracked)
    this.updateReadiness()
    return tracked.then(() => undefined)
  }

  async waitUntilVisible(timeoutMs = 20000): Promise<SceneReadiness> {
    if (!this.assetTasks.size) {
      this.readiness.visualReady = true
      this.updateReadiness()
      return this.getReadiness()
    }
    await Promise.race([
      Promise.allSettled([...this.assetTasks]),
      new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs))
    ])
    if (this.assetTasks.size) {
      this.readiness.warnings.push('等待资源就绪超时，导出将继续，但可能缺少部分资源')
    }
    this.readiness.visualReady = true
    this.updateReadiness()
    return this.getReadiness()
  }

  async addTilesetAsset(uri: string, options: { maximumScreenSpaceError?: number } = {}): Promise<() => void> {
    if (!this.viewer || this.viewer.isDestroyed()) throw new Error('场景尚未就绪')
    const generation = this.generation
    const url = new URL(uri, document.baseURI).toString()
    const tileset = await Cesium3DTileset.fromUrl(url, {
      maximumScreenSpaceError: options.maximumScreenSpaceError ?? 8,
      skipLevelOfDetail: true,
      preferLeaves: true
    })
    if (this.destroyRequested || generation !== this.generation || !this.viewer || this.viewer.isDestroyed()) {
      tileset.destroy()
      throw new Error('场景已销毁，资源加载被取消')
    }
    this.viewer.scene.primitives.add(tileset)
    const id = `tileset_${this.extraTilesets.size + 1}`
    this.extraTilesets.set(id, tileset)
    return () => {
      this.extraTilesets.delete(id)
      if (this.viewer && !this.viewer.isDestroyed()) this.viewer.scene.primitives.remove(tileset)
      else if (!tileset.isDestroyed()) tileset.destroy()
    }
  }

  private disposeCustomHandle(handle: CustomLayerHandle): void {
    try {
      handle.dispose()
    } catch {
      /* 单个自定义图层释放失败不阻塞其余资源回收 */
    }
  }

  private applyCustomVisibility(handle: CustomLayerHandle, layer: CustomLayer): void {
    const visible = layer.visible !== false
    const opacity = clamp(Number(layer.opacity ?? 1), 0, 1)
    if (handle.tileset) {
      handle.tileset.show = visible && opacity > 0.01
      if (opacity >= 0.995) handle.tileset.style = undefined
      else if (opacity > 0.01) {
        handle.tileset.style = new Cesium3DTileStyle({ color: `rgba(255, 255, 255, ${opacity})` })
      }
    }
    if (handle.dataSource) handle.dataSource.show = visible && opacity > 0.01
  }

  private async createCustomHandle(layer: CustomLayer): Promise<CustomLayerHandle> {
    if (!this.viewer || this.viewer.isDestroyed()) throw new Error('场景尚未就绪')
    const url = new URL(layer.uri, document.baseURI).toString()
    const generation = this.generation
    if (layer.kind === 'geojson') {
      const dataSource = await GeoJsonDataSource.load(url, { clampToGround: true })
      if (this.destroyRequested || generation !== this.generation || !this.viewer || this.viewer.isDestroyed()) {
        throw new Error('场景已销毁，资源加载被取消')
      }
      await this.viewer.dataSources.add(dataSource)
      return {
        kind: layer.kind,
        uri: layer.uri,
        dataSource,
        dispose: () => {
          if (this.viewer && !this.viewer.isDestroyed()) this.viewer.dataSources.remove(dataSource, true)
        }
      }
    }
    const tileset = await Cesium3DTileset.fromUrl(url, {
      maximumScreenSpaceError: 8,
      skipLevelOfDetail: true,
      preferLeaves: true
    })
    if (this.destroyRequested || generation !== this.generation || !this.viewer || this.viewer.isDestroyed()) {
      tileset.destroy()
      throw new Error('场景已销毁，资源加载被取消')
    }
    this.viewer.scene.primitives.add(tileset)
    return {
      kind: layer.kind,
      uri: layer.uri,
      tileset,
      dispose: () => {
        if (this.viewer && !this.viewer.isDestroyed()) this.viewer.scene.primitives.remove(tileset)
        else if (!tileset.isDestroyed()) tileset.destroy()
      }
    }
  }

  /** 增量同步自定义图层：先回收已删除项，再按 URI 复用未变更项。 */
  async syncCustomLayers(layers: CustomLayer[]): Promise<void> {
    if (!this.viewer || this.viewer.isDestroyed()) return
    const epoch = ++this.customLayerEpoch
    const desired = new Set(layers.map((layer) => layer.id))
    for (const [id, handle] of [...this.customLayerHandles]) {
      if (!desired.has(id)) {
        this.disposeCustomHandle(handle)
        this.customLayerHandles.delete(id)
      }
    }
    for (const id of [...this.customLayerStates.keys()]) {
      if (!desired.has(id)) this.customLayerStates.delete(id)
    }
    for (const layer of layers) {
      const assetLabel = `图层 ${layer.name}`
      if (!layer.uri.trim()) {
        this.customLayerStates.set(layer.id, { id: layer.id, status: 'empty', message: '尚未设置资源地址' })
        continue
      }
      const existing = this.customLayerHandles.get(layer.id)
      if (existing && existing.uri === layer.uri && existing.kind === layer.kind) {
        this.applyCustomVisibility(existing, layer)
        this.customLayerStates.set(layer.id, { id: layer.id, status: 'ready' })
        this.clearMissing(assetLabel)
        continue
      }
      if (existing) {
        this.disposeCustomHandle(existing)
        this.customLayerHandles.delete(layer.id)
      }
      if (epoch !== this.customLayerEpoch || this.destroyRequested) continue
      this.customLayerStates.set(layer.id, { id: layer.id, status: 'loading' })
      try {
        const handle = await this.createCustomHandle(layer)
        if (epoch !== this.customLayerEpoch || this.destroyRequested) {
          this.disposeCustomHandle(handle)
          continue
        }
        this.applyCustomVisibility(handle, layer)
        this.customLayerHandles.set(layer.id, handle)
        this.customLayerStates.set(layer.id, { id: layer.id, status: 'ready' })
        this.clearMissing(assetLabel)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        recordDiagnostic('resource', 'custom-layer-failed', 'error', { layer: layer.id, kind: layer.kind, message })
        if (epoch === this.customLayerEpoch) {
          this.customLayerStates.set(layer.id, { id: layer.id, status: 'error', message })
          this.markMissing(assetLabel, message)
        }
      }
    }
  }

  get canvas(): HTMLCanvasElement | null {
    return this.viewer?.scene.canvas ?? null
  }

  get isReady(): boolean {
    return Boolean(this.viewer && !this.viewer.isDestroyed())
  }

  get hasTileset(): boolean {
    return Boolean(this.tileset)
  }

  async init(): Promise<void> {
    this.generation += 1
    const generation = this.generation
    Ion.defaultAccessToken = runtimeConfig.cesiumIonToken || CESIUM_ION_TOKEN
    this.callbacks.onStatus?.('正在建立三维场景', 'Cesium Viewer · 1.144')
    const hiddenCredit = document.createElement('div')
    hiddenCredit.style.display = 'none'
    this.viewer = new Viewer(this.container, {
      animation: false,
      timeline: false,
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      selectionIndicator: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      scene3DOnly: true,
      shouldAnimate: false,
      creditContainer: hiddenCredit
    })
    const viewer = this.viewer
    if (import.meta.env.DEV && this.template.debugGlobal) {
      ;(window as unknown as Record<string, unknown>).__psViewer = viewer
    }
    this.readiness.viewerReady = true
    this.updateReadiness()
    viewer.clock.currentTime = JulianDate.fromIso8601('2026-06-21T04:00:00Z')
    viewer.clock.shouldAnimate = false
    viewer.scene.backgroundColor = Color.fromCssColorString('#040a12')
    viewer.scene.globe.baseColor = Color.fromCssColorString('#07121f')
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.scene.globe.maximumScreenSpaceError = 2
    viewer.scene.globe.shadows = ShadowMode.RECEIVE_ONLY
    viewer.scene.globe.enableLighting = true
    viewer.scene.globe.showGroundAtmosphere = true
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 12
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 6000000
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true
    if (viewer.scene.skyBox) viewer.scene.skyBox.show = true
    viewer.scene.fog.enabled = false
    viewer.scene.fog.density = 0.00012
    viewer.shadows = true

    this.callbacks.onStatus?.('加载卫星影像', 'Bing Maps · 失败自动切换 OSM')
    this.addImagery()

    if (this.template.landmarks.length) {
      this.callbacks.onStatus?.('加载城市地标', `${this.template.landmarks.length} 处地标 · 光柱与航线`)
      this.addLandmarkLayers()
      this.addBeaconLayer()
    }
    this.addRouteLayers()
    this.readiness.metadataReady = true
    this.updateReadiness()

    const tasks: Promise<void>[] = []
    if (this.template.tileset) {
      this.callbacks.onStatus?.('加载场景 3D Tiles', `${this.template.tileset.name} · 本地模型`)
      tasks.push(this.trackAsset(this.template.tileset.id, this.loadTileset(generation), this.template.tileset.required))
    } else {
      this.readiness.visualReady = true
    }
    tasks.push(this.trackAsset(this.template.terrainSourceId, this.loadTerrain(generation), false))
    await Promise.race([
      Promise.allSettled(tasks),
      new Promise<void>((resolve) => window.setTimeout(resolve, 12000))
    ])
    if (generation !== this.generation || this.destroyRequested) return
    if (!this.assetTasks.size) {
      this.readiness.visualReady = true
      this.updateReadiness()
    }
    if (this.readiness.exportReady) {
      this.callbacks.onStatus?.('场景就绪', '演示工程已可播放，导出资源已就绪')
    } else {
      this.callbacks.onStatus?.('场景可用', '部分资源仍在加载，导出将等待资源就绪')
    }
  }

  private addImagery(): void {
    if (!this.viewer) return
    void this.addBaseImagery()
    const primary = this.dataSources.get(this.template.imagerySourceId)
    const fallback = (primary && this.dataSources.fallbackOf(primary.id)) ?? this.dataSources.get('imagery_osm')
    try {
      if (!primary) throw new Error('未配置影像服务')
      this.imageryLayer = this.viewer.imageryLayers.addImageryProvider(createImageryProvider(primary))
      this.dataSources.mark(primary.id, 'healthy')
      let failures = 0
      this.imageryLayer.errorEvent.addEventListener(() => {
        failures += 1
        this.dataSources.mark(primary.id, 'degraded', '影像瓦片请求失败')
        if (failures >= 4 && fallback && this.imageryLayer && this.viewer && !this.viewer.isDestroyed()) {
          this.callbacks.onWarning?.(`${primary.name} 加载异常，已切换 ${fallback.name}`)
          this.viewer.imageryLayers.remove(this.imageryLayer, true)
          this.imageryLayer = this.viewer.imageryLayers.addImageryProvider(createImageryProvider(fallback))
          this.dataSources.mark(fallback.id, 'healthy')
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      recordDiagnostic('resource', 'imagery-failed', 'error', { source: primary?.id ?? 'imagery', message })
      this.dataSources.mark(primary?.id ?? 'imagery', 'failed', message)
      this.callbacks.onWarning?.(`影像服务初始化失败，使用 ${fallback?.name ?? '纯色球体'}`)
      if (fallback && this.viewer && !this.viewer.isDestroyed()) {
        this.imageryLayer = this.viewer.imageryLayers.addImageryProvider(createImageryProvider(fallback))
        this.dataSources.mark(fallback.id, 'healthy')
      }
    }
  }

  private async addBaseImagery(): Promise<void> {
    try {
      const provider = await TileMapServiceImageryProvider.fromUrl(
        buildModuleUrl('Assets/Textures/NaturalEarthII')
      )
      if (this.destroyRequested || !this.viewer || this.viewer.isDestroyed()) return
      const baseLayer = this.viewer.imageryLayers.addImageryProvider(provider, 0)
      baseLayer.brightness = 0.5
      baseLayer.contrast = 1.1
      baseLayer.saturation = 0.5
      baseLayer.gamma = 0.9
    } catch {
      // 本地底图不可用时保留纯色球体，等待在线影像
    }
  }

  private async loadTerrain(generation: number): Promise<void> {
    const definition = this.dataSources.get(this.template.terrainSourceId)
    if (!definition || definition.provider === 'ellipsoid') return
    try {
      const provider = await createTerrainProvider(definition)
      if (this.destroyRequested || generation !== this.generation) return
      this.terrainProvider = provider
      this.dataSources.mark(definition.id, 'healthy')
      if (this.terrainEnabled && this.viewer && !this.viewer.isDestroyed()) {
        this.viewer.terrainProvider = provider
        this.callbacks.onStatus?.('真实地形已加载', definition.name)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      recordDiagnostic('resource', 'terrain-failed', 'error', { source: definition.id, message })
      this.dataSources.mark(definition.id, 'failed', message)
      const fallback = this.dataSources.fallbackOf(definition.id)
      this.callbacks.onWarning?.(`真实地形加载失败，使用 ${fallback?.name ?? '椭球地形'}`)
      this.terrainProvider = undefined
    }
  }

  private async loadTileset(generation: number): Promise<void> {
    if (!this.viewer || !this.template.tileset) return
    try {
      const url = new URL(this.template.tileset.uri, document.baseURI).toString()
      const tileset = await Cesium3DTileset.fromUrl(url, {
        maximumScreenSpaceError: this.template.tileset.maximumScreenSpaceError,
        skipLevelOfDetail: true,
        preferLeaves: true
      })
      if (this.destroyRequested || generation !== this.generation || !this.viewer || this.viewer.isDestroyed()) {
        tileset.destroy()
        return
      }
      tileset.shadows = ShadowMode.ENABLED
      this.viewer.scene.primitives.add(tileset)
      this.tileset = tileset
      this.prepareClipping(tileset)
      if (this.lastRuntime) this.applyRuntime(this.lastRuntime)
      this.callbacks.onStatus?.(`${this.template.tileset.name} 已加载`, '3D Tiles · 本地资源')
      this.readiness.visualReady = true
      this.updateReadiness()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      recordDiagnostic('resource', 'tileset-failed', 'error', { source: this.template.tileset.id, message })
      this.markMissing(this.template.tileset.id, `3D Tiles 加载失败：${message}`)
      this.readiness.visualReady = true
      this.updateReadiness()
    }
  }

  private prepareClipping(tileset: Cesium3DTileset): void {
    if (!this.viewer) return
    const center = tileset.boundingSphere.center
    const carto = Cartographic.fromCartesian(center)
    const up = this.viewer.scene.globe.ellipsoid.geodeticSurfaceNormal(center, new Cartesian3())
    const centerHeight = Math.max(24, carto.height)
    this.clippingBase = Cartesian3.dot(up, center) - centerHeight
    this.clippingHeight = centerHeight * 2 + 12
    const down = Cartesian3.negate(up, new Cartesian3())
    this.clippingPlane = new ClippingPlane(down, this.clippingBase + this.clippingHeight)
    this.clippingCollection = new ClippingPlaneCollection({
      planes: [this.clippingPlane],
      unionClippingRegions: true,
      edgeColor: Color.fromCssColorString('#5ee0ff').withAlpha(0.85),
      edgeWidth: 2
    })
    this.clippingCollection.enabled = false
    tileset.clippingPlanes = this.clippingCollection
  }

  private addLandmarkLayers(): void {
    if (!this.viewer) return
    this.pointCollection = new PointPrimitiveCollection()
    this.labelCollection = new LabelCollection()
    this.viewer.scene.primitives.add(this.pointCollection)
    this.viewer.scene.primitives.add(this.labelCollection)
    for (const item of this.template.landmarks) {
      const color = Color.fromCssColorString(item.color)
      const position = Cartesian3.fromDegrees(item.longitude, item.latitude, item.height + 4)
      const point = this.pointCollection.add({
        position,
        pixelSize: 8,
        color,
        outlineColor: Color.fromCssColorString('#04101c').withAlpha(0.9),
        outlineWidth: 2.4,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new NearFarScalar(300, 1.5, 9000, 0.55)
      })
      const label = this.labelCollection.add({
        position: Cartesian3.fromDegrees(item.longitude, item.latitude, item.height + 12),
        text: item.name,
        font: '600 14px "PingFang SC", "Microsoft YaHei", sans-serif',
        style: LabelStyle.FILL_AND_OUTLINE,
        fillColor: Color.WHITE,
        outlineColor: Color.fromCssColorString('#04101c'),
        outlineWidth: 3,
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -16),
        showBackground: true,
        backgroundColor: Color.fromCssColorString('#06111f').withAlpha(0.7),
        backgroundPadding: new Cartesian2(10, 6),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new NearFarScalar(300, 1.05, 9000, 0.5)
      })
      this.landmarks.push({ point, label, color })
    }
  }

  private addBeaconLayer(): void {
    if (!this.viewer) return
    for (const item of this.template.landmarks) {
      const color = Color.fromCssColorString(item.color)
      const pillarMaterial = new ColorMaterialProperty(color.withAlpha(0.16))
      const ringMaterial = new ColorMaterialProperty(color.withAlpha(0.2))
      const base = Cartesian3.fromDegrees(item.longitude, item.latitude, item.height)
      const pillar = this.viewer.entities.add({
        position: Cartesian3.fromDegrees(item.longitude, item.latitude, item.height + item.beaconHeight / 2),
        show: false,
        cylinder: {
          length: item.beaconHeight,
          topRadius: 1.1,
          bottomRadius: 3.2,
          material: pillarMaterial,
          outline: false
        }
      })
      const ring = this.viewer.entities.add({
        position: base,
        show: false,
        ellipse: {
          semiMajorAxis: 26,
          semiMinorAxis: 26,
          height: item.height + 1,
          material: ringMaterial,
          outline: true,
          outlineColor: color.withAlpha(0.55)
        }
      })
      this.beacons.push({
        pillar,
        ring,
        pillarMaterial,
        ringMaterial,
        baseHeight: item.beaconHeight,
        color,
        base,
        longitude: item.longitude,
        latitude: item.latitude,
        groundHeight: item.height
      })
    }
  }

  private addRouteLayers(): void {
    if (!this.viewer) return
    this.routeEntity = this.viewer.entities.add({
      show: false,
      polyline: {
        positions: [],
        width: 4,
        material: new PolylineGlowMaterialProperty({
          color: Color.fromCssColorString('#5ee0ff').withAlpha(0.9),
          glowPower: 0.28,
          taperPower: 0.55
        })
      }
    })
    this.routeCursor = this.viewer.entities.add({
      show: false,
      position: Cartesian3.fromDegrees(108.9642, 34.2186, 300),
      point: {
        pixelSize: 11,
        color: Color.fromCssColorString('#ffc76a'),
        outlineColor: Color.WHITE.withAlpha(0.9),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
    this.recordingEntity = this.viewer.entities.add({
      show: false,
      polyline: {
        positions: [],
        width: 3,
        material: new PolylineGlowMaterialProperty({
          color: Color.fromCssColorString('#ff6b7a').withAlpha(0.95),
          glowPower: 0.35
        })
      }
    })
  }

  setRecordingTrail(samples: CameraPose[]): void {
    if (!this.recordingEntity) return
    const positions = samples.map((sample) =>
      Cartesian3.fromDegrees(sample.longitude, sample.latitude, sample.height)
    )
    this.recordingEntity.polyline!.positions = new ConstantProperty(positions)
    this.recordingEntity.show = positions.length > 1
  }

  clearRecordingTrail(): void {
    if (!this.recordingEntity) return
    this.recordingEntity.polyline!.positions = new ConstantProperty([])
    this.recordingEntity.show = false
  }

  getPose(): CameraPose {
    if (!this.viewer || this.viewer.isDestroyed()) {
      return { longitude: 108.9642, latitude: 34.2186, height: 1000, heading: 0, pitch: -35, roll: 0, fov: 50 }
    }
    const camera = this.viewer.camera
    const carto = camera.positionCartographic
    const frustum = camera.frustum
    const fov = frustum instanceof PerspectiveFrustum && frustum.fov ? (frustum.fov * 180) / Math.PI : 50
    return {
      longitude: (carto.longitude * 180) / Math.PI,
      latitude: (carto.latitude * 180) / Math.PI,
      height: carto.height,
      heading: ((camera.heading * 180) / Math.PI + 360) % 360,
      pitch: (camera.pitch * 180) / Math.PI,
      roll: (camera.roll * 180) / Math.PI,
      fov
    }
  }

  setPose(pose: CameraPose, force = false): void {
    if (!this.viewer || this.viewer.isDestroyed()) return
    const safeHeight = this.safeCameraHeight(pose.longitude, pose.latitude, pose.height)
    const effective: CameraPose = { ...pose, height: safeHeight }
    if (!force && this.lastPose && this.poseClose(this.lastPose, effective)) return
    const camera = this.viewer.camera
    camera.setView({
      destination: Cartesian3.fromDegrees(effective.longitude, effective.latitude, effective.height),
      orientation: {
        heading: (effective.heading * Math.PI) / 180,
        pitch: (effective.pitch * Math.PI) / 180,
        roll: (effective.roll * Math.PI) / 180
      }
    })
    const frustum = camera.frustum
    if (frustum instanceof PerspectiveFrustum) {
      frustum.fov = (clamp(effective.fov, 15, 110) * Math.PI) / 180
    }
    this.lastPose = effective
  }

  private safeCameraHeight(longitude: number, latitude: number, height: number): number {
    const ceiling = Math.min(MAX_CAMERA_HEIGHT, Math.max(-500, height))
    const ground = this.groundHeightAt(longitude, latitude)
    if (ground === null) return ceiling
    return Math.max(ceiling, ground + MIN_CAMERA_CLEARANCE)
  }

  private groundHeightAt(longitude: number, latitude: number): number | null {
    if (!this.viewer || this.viewer.isDestroyed()) return null
    const key = `${longitude.toFixed(5)}:${latitude.toFixed(5)}`
    const cached = this.groundHeightCache.get(key)
    if (cached !== undefined) return cached
    try {
      const sampled = this.viewer.scene.globe.getHeight(Cartographic.fromDegrees(longitude, latitude))
      if (typeof sampled !== 'number' || !Number.isFinite(sampled)) return null
      if (this.groundHeightCache.size > 512) this.groundHeightCache.clear()
      this.groundHeightCache.set(key, sampled)
      return sampled
    } catch {
      return null
    }
  }

  private poseClose(left: CameraPose, right: CameraPose): boolean {
    return (
      Math.abs(left.longitude - right.longitude) < 0.0000004 &&
      Math.abs(left.latitude - right.latitude) < 0.0000004 &&
      Math.abs(left.height - right.height) < 0.02 &&
      Math.abs(left.heading - right.heading) < 0.01 &&
      Math.abs(left.pitch - right.pitch) < 0.01 &&
      Math.abs(left.roll - right.roll) < 0.01 &&
      Math.abs(left.fov - right.fov) < 0.01
    )
  }

  setCameraInputs(enabled: boolean): void {
    if (!this.viewer || this.viewer.isDestroyed()) return
    this.viewer.scene.screenSpaceCameraController.enableInputs = enabled
  }

  applyRuntime(runtime: RuntimeState): void {
    if (!this.viewer || this.viewer.isDestroyed()) return
    this.lastRuntime = runtime
    this.setPose(runtime.camera)
    this.applyImagery(runtime.layers.imagery)
    this.applyTerrain(runtime.layers.terrain > 0.5)
    this.applyDayanta(runtime.layers.dayanta)
    this.applyGrowth(runtime.timeProgress.dayanta)
    this.applyLandmarks(runtime.layers.landmarks, runtime.timeProgress.landmarks)
    this.applyBeacons(runtime.layers.beacons, runtime.timeProgress.beacons)
    this.applyRoute(runtime.route, runtime.layers.route)
    this.applyCursor(runtime.routeCursor)
    this.applyEffects(runtime)
  }

  private applyImagery(opacity: number): void {
    if (!this.imageryLayer) return
    const alpha = clamp(opacity, 0, 1)
    if (Math.abs((this.lastLayerAlpha.get('imagery') ?? -1) - alpha) > 0.004) {
      this.imageryLayer.alpha = alpha
      this.lastLayerAlpha.set('imagery', alpha)
    }
  }

  private applyTerrain(enabled: boolean): void {
    if (!this.viewer || this.viewer.isDestroyed()) return
    if (enabled === this.terrainEnabled) return
    this.terrainEnabled = enabled
    this.groundHeightCache.clear()
    this.lastPose = null
    this.viewer.terrainProvider = enabled && this.terrainProvider ? this.terrainProvider : this.ellipsoidTerrain
  }

  private applyDayanta(alpha: number): void {
    if (!this.tileset) return
    const value = clamp(alpha, 0, 1)
    if (Math.abs(value - this.lastDayantaAlpha) < 0.01) return
    this.lastDayantaAlpha = value
    this.tileset.show = value > 0.01
    if (value >= 0.995) {
      this.tileset.style = undefined
      return
    }
    this.tileset.colorBlendMode = Cesium3DTileColorBlendMode.MIX
    this.tileset.colorBlendAmount = 0.18
    this.tileset.style = new Cesium3DTileStyle({
      color: `color('white', ${value.toFixed(3)})`
    })
  }

  private applyGrowth(progress: number): void {
    if (!this.clippingPlane || !this.clippingCollection) return
    const value = clamp(progress, 0, 1)
    if (value >= 0.999) {
      this.clippingCollection.enabled = false
      return
    }
    this.clippingCollection.enabled = true
    this.clippingPlane.distance = this.clippingBase + value * this.clippingHeight
  }

  private applyLandmarks(alpha: number, reveal: number): void {
    const layer = clamp(alpha, 0, 1)
    const progress = clamp(reveal, 0, 1)
    if (Math.abs(layer - this.lastLandmarkAlpha) < 0.006 && Math.abs(progress - this.lastLandmarkProgress) < 0.002) {
      return
    }
    this.lastLandmarkAlpha = layer
    this.lastLandmarkProgress = progress
    const count = this.landmarks.length
    const revealPosition = progress * (count + 0.35)
    this.landmarks.forEach((visual, index) => {
      const local = clamp(revealPosition - index, 0, 1)
      const opacity = layer * local
      visual.point.show = opacity > 0.01
      visual.label.show = opacity > 0.01
      if (opacity > 0.01) {
        visual.point.color = visual.color.withAlpha(opacity)
        visual.label.fillColor = Color.WHITE.withAlpha(opacity)
        visual.label.outlineColor = Color.fromCssColorString('#04101c').withAlpha(opacity)
        visual.label.backgroundColor = Color.fromCssColorString('#06111f').withAlpha(0.72 * opacity)
      }
    })
  }

  private applyBeacons(alpha: number, progress: number): void {
    const layer = clamp(alpha, 0, 1)
    const energy = clamp(progress, 0, 1)
    if (
      Math.abs(layer - this.lastBeaconAlpha) < 0.006 &&
      Math.abs(energy - this.lastBeaconProgress) < 0.006
    ) {
      return
    }
    this.lastBeaconAlpha = layer
    this.lastBeaconProgress = energy
    for (const visual of this.beacons) {
      const opacity = layer * (0.35 + energy * 0.65)
      const length = visual.baseHeight * (0.35 + energy * 0.65)
      visual.pillar.show = opacity > 0.01
      visual.ring.show = opacity > 0.01
      if (opacity <= 0.01) continue
      visual.pillarMaterial.color = new ConstantProperty(visual.color.withAlpha(0.11 * opacity))
      visual.ringMaterial.color = new ConstantProperty(visual.color.withAlpha(0.24 * opacity))
      visual.pillar.cylinder!.length = new ConstantProperty(length)
      visual.pillar.position = new ConstantPositionProperty(
        Cartesian3.fromDegrees(visual.longitude, visual.latitude, visual.groundHeight + length / 2)
      )
    }
  }

  private applyRoute(route: RuntimeState['route'], alpha: number): void {
    if (!this.routeEntity) return
    const layer = clamp(alpha, 0, 1)
    if (route !== this.lastRoute) {
      this.lastRoute = route
      const positions =
        route && route.samples.length > 1
          ? route.samples.map((sample) =>
              Cartesian3.fromDegrees(
                sample.longitude,
                sample.latitude,
                sample.height + route.altitudeOffset
              )
            )
          : []
      this.routeEntity.polyline!.positions = new ConstantProperty(positions)
      this.routeEntity.show = positions.length > 1 && layer > 0.01
      this.routeEntity.polyline!.material = new PolylineGlowMaterialProperty({
        color: Color.fromCssColorString('#5ee0ff').withAlpha(0.92 * layer),
        glowPower: 0.28,
        taperPower: 0.55
      })
      this.lastRouteAlpha = layer
      return
    }
    if (Math.abs(layer - this.lastRouteAlpha) < 0.01) return
    this.lastRouteAlpha = layer
    this.routeEntity.show = Boolean(route && route.samples.length > 1) && layer > 0.01
    this.routeEntity.polyline!.material = new PolylineGlowMaterialProperty({
      color: Color.fromCssColorString('#5ee0ff').withAlpha(0.92 * layer),
      glowPower: 0.28,
      taperPower: 0.55
    })
  }

  private applyCursor(pose: CameraPose | null): void {
    if (!this.routeCursor) return
    if (!pose) {
      this.routeCursor.show = false
      return
    }
    this.routeCursor.show = true
    this.routeCursor.position = new ConstantPositionProperty(
      Cartesian3.fromDegrees(pose.longitude, pose.latitude, pose.height)
    )
  }

  private applyEffects(runtime: RuntimeState): void {
    if (!this.viewer || this.viewer.isDestroyed()) return
    const scene = this.viewer.scene
    const shadows = runtime.effects.shadows > 0.5
    if (shadows !== this.shadowsEnabled) {
      this.shadowsEnabled = shadows
      this.viewer.shadows = shadows
      if (this.tileset) this.tileset.shadows = shadows ? ShadowMode.ENABLED : ShadowMode.DISABLED
    }
    const lighting = runtime.effects.lighting > 0.5
    if (lighting !== this.lightingEnabled) {
      this.lightingEnabled = lighting
      scene.globe.enableLighting = lighting
    }
    const atmosphere = runtime.effects.atmosphere > 0.5
    if (atmosphere !== this.atmosphereEnabled) {
      this.atmosphereEnabled = atmosphere
      if (scene.skyAtmosphere) scene.skyAtmosphere.show = atmosphere
      if (scene.skyBox) scene.skyBox.show = atmosphere
      scene.globe.showGroundAtmosphere = atmosphere
    }
    const fog = runtime.effects.fog
    scene.fog.enabled = fog > 0.02
    if (fog > 0.02) {
      scene.fog.density = 0.00002 + clamp(fog, 0, 1) * 0.00042
    }
    this.applyAnalysis(runtime.effects.contour, runtime.effects.slope)
  }

  private applyAnalysis(contour: number, slope: number): void {
    if (!this.viewer || this.viewer.isDestroyed()) return
    const active = contour > 0.01 || slope > 0.01
    if (!active) {
      if (this.analysisActive) {
        this.viewer.scene.globe.material = undefined
        this.analysisActive = false
        this.contoursEnabled = false
      }
      return
    }
    if (!this.analysisMaterial) {
      this.analysisMaterial = new Material({
        fabric: {
          type: 'StudioTerrainAnalysis',
          uniforms: {
            contourOn: 1,
            contourColor: new Color(0.37, 0.88, 1, 0.95),
            contourSpacing: 32,
            contourWidth: 1.2,
            slopeOn: 0,
            slopeLow: Color.fromCssColorString('#0d3444'),
            slopeHigh: Color.fromCssColorString('#ffb066'),
            slopeAlpha: 0
          },
          source: ANALYSIS_SHADER
        },
        translucent: true
      })
    }
    if (!this.analysisActive) {
      this.viewer.scene.globe.material = this.analysisMaterial
      this.analysisActive = true
    }
    const uniforms = this.analysisMaterial.uniforms as Record<string, unknown>
    uniforms.contourOn = clamp(contour, 0, 1)
    uniforms.contourColor = new Color(0.37, 0.88, 1, 0.95 * clamp(contour, 0, 1))
    uniforms.contourSpacing = 32
    uniforms.contourWidth = 1.25
    uniforms.slopeOn = slope > 0.01 ? 1 : 0
    uniforms.slopeAlpha = 0.72 * clamp(slope, 0, 1)
    this.contoursEnabled = contour > 0.5
  }

  project(longitude: number, latitude: number, height: number): ScreenPoint {
    if (!this.viewer || this.viewer.isDestroyed()) return { x: 0, y: 0, visible: false }
    const position = Cartesian3.fromDegrees(longitude, latitude, height)
    const result = SceneTransforms.worldToWindowCoordinates(this.viewer.scene, position, new Cartesian2())
    if (!result) return { x: 0, y: 0, visible: false }
    return { x: result.x, y: result.y, visible: true }
  }

  addPostRenderListener(callback: () => void): () => void {
    if (!this.viewer || this.viewer.isDestroyed()) return () => undefined
    const handler = () => callback()
    this.viewer.scene.postRender.addEventListener(handler)
    return () => {
      if (this.viewer && !this.viewer.isDestroyed()) {
        this.viewer.scene.postRender.removeEventListener(handler)
      }
    }
  }

  setResolutionScale(scale: number): void {
    if (!this.viewer || this.viewer.isDestroyed()) return
    this.viewer.resolutionScale = clamp(scale, 0.5, 3)
    this.viewer.resize()
    this.viewer.scene.requestRender()
  }

  requestRender(): void {
    if (!this.viewer || this.viewer.isDestroyed()) return
    this.viewer.scene.requestRender()
  }

  destroy(): void {
    this.destroyRequested = true
    this.generation += 1
    this.assetTasks.clear()
    this.lastRuntime = null
    const exposed = (window as unknown as Record<string, unknown>).__psViewer
    if (exposed && this.viewer && exposed === this.viewer) {
      delete (window as unknown as Record<string, unknown>).__psViewer
    }
    for (const tileset of this.extraTilesets.values()) {
      if (!tileset.isDestroyed()) {
        if (this.viewer && !this.viewer.isDestroyed()) this.viewer.scene.primitives.remove(tileset)
        else tileset.destroy()
      }
    }
    this.extraTilesets.clear()
    this.readiness = {
      viewerReady: false,
      metadataReady: false,
      visualReady: false,
      exportReady: false,
      pendingAssets: 0,
      missingAssets: [],
      warnings: []
    }
    if (this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.scene.globe.material = undefined
    }
    if (this.analysisMaterial) {
      this.analysisMaterial.destroy()
      this.analysisMaterial = undefined
    }
    this.clippingCollection = undefined
    this.clippingPlane = undefined
    this.tileset = undefined
    if (this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.destroy()
    }
    this.viewer = undefined
    this.landmarks = []
    this.beacons = []
    this.pointCollection = undefined
    this.labelCollection = undefined
    this.routeEntity = undefined
    this.routeCursor = undefined
    this.recordingEntity = undefined
    this.imageryLayer = undefined
    this.terrainProvider = undefined
    this.lastLayerAlpha.clear()
  }
}
