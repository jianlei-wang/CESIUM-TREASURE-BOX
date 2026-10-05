import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import type { MonitoringStation, StudyArea } from '@rt/types/model'
import { SpatialTransform } from './spatial'

// Cesium 1.144 的公开类型未声明 Scene.context / Scene.fxaa，但运行时存在；
// 这里用最小内部结构做一次类型收窄，避免污染其余代码。
interface CesiumSceneInternals {
  context: {
    _gl: WebGLRenderingContext | WebGL2RenderingContext
    webgl2: boolean
    depthTexture: unknown
  }
  fxaa: boolean
}

function sceneInternals(scene: Cesium.Scene): CesiumSceneInternals {
  return scene as unknown as CesiumSceneInternals
}

const depthCaptureFragment = `
uniform sampler2D depthTexture;
uniform vec4 uSeaPlaneEye;
in vec2 v_textureCoordinates;

vec4 packDepth32(float value) {
  value = clamp(value, 0.0, 1.0);
  const vec4 shift = vec4(1.0, 255.0, 65025.0, 16581375.0);
  const vec4 mask = vec4(0.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0);
  vec4 res = fract(value * shift);
  res -= res.gbaa * mask;
  return res;
}

void main() {
  float rawDepth = texture(depthTexture, v_textureCoordinates).r;
  if (rawDepth >= 0.999999) {
    out_FragColor = packDepth32(1.0);
    return;
  }

  // Cesium 1.144 提供该坐标重建函数；当前工程关闭 logarithmicDepthBuffer，直接得到 eye-space position。
  vec3 eyePosition = czm_windowToEyeCoordinates(gl_FragCoord.xy, rawDepth).xyz;
  float eyeDepth = max(-eyePosition.z, 0.0);

  // Cesium scene depth 同时可能包含海面、陆地和海底地形。只过滤“恰好在海平面附近”的几何，
  // 保留海面以上的岛屿/陆地，也保留世界海洋地形模式下位于海面以下的海底地形作为 blocker。
  float signedSeaHeight = dot(uSeaPlaneEye.xyz, eyePosition) + uSeaPlaneEye.w;
  if (abs(signedSeaHeight) <= 1.5) {
    out_FragColor = packDepth32(1.0);
    return;
  }

  const float DEPTH_SCALE = 2000000.0;
  float normalized = clamp(eyeDepth / DEPTH_SCALE, 0.0, 1.0);
  out_FragColor = packDepth32(normalized);
}`

const passthroughFragment = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
void main() {
  out_FragColor = texture(colorTexture, v_textureCoordinates);
}`

export class CesiumEngine {
  readonly viewer: Cesium.Viewer
  readonly spatial: SpatialTransform
  readonly studyArea: StudyArea
  readonly canvas: HTMLCanvasElement
  private stationEntities: Cesium.Entity[] = []
  private eventRectangle?: Cesium.Entity
  private islandEntities: Cesium.Entity[] = []
  private shorelineEntities: Cesium.Entity[] = []
  private depthCaptureStage?: Cesium.PostProcessStage
  private depthComposite?: Cesium.PostProcessStageComposite
  private readonly seaPlaneEye = new Cesium.Cartesian4()
  private readonly scratchSeaNormalWorld = new Cesium.Cartesian3()
  private readonly scratchSeaNormalEye = new Cesium.Cartesian3()
  private readonly scratchSeaOriginEye = new Cesium.Cartesian3()

  constructor(container: HTMLElement, studyArea: StudyArea) {
    this.studyArea = studyArea
    this.spatial = new SpatialTransform(studyArea)
    const terrainMode = (import.meta.env.VITE_CESIUM_TERRAIN_MODE ?? 'ellipsoid').toLowerCase()
    const useWorldTerrain = terrainMode === 'world-terrain'
    const useWorldBathymetry = terrainMode === 'world-bathymetry'
    const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN
    if ((useWorldTerrain || useWorldBathymetry) && ionToken) {
      Cesium.Ion.defaultAccessToken = ionToken
    }

    const terrainOptions = (useWorldTerrain || useWorldBathymetry)
      ? {
        terrain: useWorldTerrain
          ? Cesium.Terrain.fromWorldTerrain({ requestVertexNormals: true, requestWaterMask: true })
          : Cesium.Terrain.fromWorldBathymetry({ requestVertexNormals: true })
      }
      : { terrainProvider: new Cesium.EllipsoidTerrainProvider() }

    this.viewer = new Cesium.Viewer(container, {
      baseLayerPicker: false,
      baseLayer: false,
      ...terrainOptions,
      animation: false,
      timeline: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      selectionIndicator: false,
      infoBox: false,
      scene3DOnly: true,
      shouldAnimate: false,
      skyBox: false,
      skyAtmosphere: false,
      contextOptions: {
        webgl: {
          alpha: false,
          depth: true,
          stencil: false,
          antialias: true,
          preserveDrawingBuffer: false,
        },
      },
      requestRenderMode: false,
    })

    this.canvas = this.viewer.scene.canvas
    this.configureScene()
    this.configureImagery()
    this.configureDepthCapture()
    this.flyToStudyArea()
  }

  get gl(): WebGLRenderingContext | WebGL2RenderingContext {
    return sceneInternals(this.viewer.scene).context._gl
  }

  get isWebGL2(): boolean {
    return sceneInternals(this.viewer.scene).context.webgl2
  }

  get depthOcclusionSupported(): boolean {
    return Boolean(sceneInternals(this.viewer.scene).context.depthTexture && this.depthCaptureStage && this.depthComposite)
  }

  /**
   * Returns Cesium's post-process-produced linear eye-depth texture. The actual WebGL handle belongs
   * to the same context as Three because both render through this.canvas.
   */
  get depthTexture(): WebGLTexture | null {
    const cesiumTexture = this.depthCaptureStage?.outputTexture as unknown as { _texture?: WebGLTexture } | undefined
    return cesiumTexture?._texture ?? null
  }

  get depthTextureSize(): { width: number; height: number } {
    return {
      width: this.viewer.scene.drawingBufferWidth,
      height: this.viewer.scene.drawingBufferHeight,
    }
  }

  get terrainMode(): string {
    return (import.meta.env.VITE_CESIUM_TERRAIN_MODE ?? 'ellipsoid').toLowerCase()
  }

  destroy(): void {
    this.viewer.destroy()
  }

  addStudyAreaOverlay(): void {
    const center = this.studyArea.center
    const halfX = this.studyArea.sizeX / 2
    const halfY = this.studyArea.sizeY / 2
    const corners = [
      this.offsetDegrees(center.longitude, center.latitude, -halfX, -halfY),
      this.offsetDegrees(center.longitude, center.latitude, halfX, -halfY),
      this.offsetDegrees(center.longitude, center.latitude, halfX, halfY),
      this.offsetDegrees(center.longitude, center.latitude, -halfX, halfY),
    ]
    const hierarchy = new Cesium.PolygonHierarchy(
      corners.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, 0)),
    )
    this.eventRectangle = this.viewer.entities.add({
      name: '赤潮模拟研究区',
      polygon: {
        hierarchy,
        material: Cesium.Color.CYAN.withAlpha(0.035),
        outline: true,
        outlineColor: Cesium.Color.CYAN.withAlpha(0.45),
        height: 0,
        extrudedHeight: 0,
      },
    })
    this.addSyntheticCoastlineAndIslands()
  }

  addStations(stations: MonitoringStation[], onSelect: (station: MonitoringStation) => void): void {
    this.stationEntities.forEach((entity) => this.viewer.entities.remove(entity))
    this.stationEntities = stations.map((station) => {
      const entity = this.viewer.entities.add({
        id: station.id,
        name: station.name,
        position: Cesium.Cartesian3.fromDegrees(station.longitude, station.latitude, 8),
        point: {
          pixelSize: 8,
          color: Cesium.Color.CYAN,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: station.name,
          font: '12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#081722').withAlpha(0.85),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 180_000),
        },
      })
      return entity
    })

    this.viewer.selectedEntityChanged.addEventListener((entity) => {
      if (!entity) return
      const station = stations.find((item) => item.id === entity.id)
      if (station) onSelect(station)
    })
  }

  private configureImagery(): void {
    // Viewer 以 baseLayer: false 关闭了 Ion 默认底图（无 token 也能运行），这里显式挂载重影像图层。
    // 默认 ArcGIS World Imagery：WGS84 切片、无需 token，与研究区实体（经纬度定位）严格对齐；
    // 若网络访问受限，可在 .env 中用 VITE_IMAGERY_URL 切换（模板示例见 .env.example）。
    const customTemplate = import.meta.env.VITE_IMAGERY_URL
    const provider = customTemplate
      ? new Cesium.UrlTemplateImageryProvider({
        url: customTemplate,
        subdomains: ['1', '2', '3', '4'],
        maximumLevel: 18,
        credit: '自定义影像服务',
      })
      : new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 18,
        credit: 'Esri, Maxar, Earthstar Geographics',
      })
    this.viewer.imageryLayers.addImageryProvider(provider)
  }

  private configureDepthCapture(): void {
    const scene = this.viewer.scene
    if (!sceneInternals(scene).context.depthTexture) return

    this.depthCaptureStage = new Cesium.PostProcessStage({
      name: 'redTideLinearEyeDepthCapture',
      fragmentShader: depthCaptureFragment,
      uniforms: {
        uSeaPlaneEye: () => this.getSeaPlaneEye(),
      },
      pixelFormat: Cesium.PixelFormat.RGBA,
      pixelDatatype: Cesium.PixelDatatype.UNSIGNED_BYTE,
      sampleMode: Cesium.PostProcessStageSampleMode.NEAREST,
    })

    const passthroughStage = new Cesium.PostProcessStage({
      name: 'redTideDepthColorPassthrough',
      fragmentShader: passthroughFragment,
      pixelFormat: Cesium.PixelFormat.RGBA,
      pixelDatatype: Cesium.PixelDatatype.UNSIGNED_BYTE,
      sampleMode: Cesium.PostProcessStageSampleMode.LINEAR,
    })

    // Both stages consume the original Cesium scene output. Only the second stage is finally copied to the canvas;
    // the first stage's output remains available to Three for terrain/island occlusion.
    this.depthComposite = new Cesium.PostProcessStageComposite({
      name: 'redTideDepthPipeline',
      stages: [this.depthCaptureStage, passthroughStage],
      inputPreviousStageTexture: false,
    })

    scene.postProcessStages.add(this.depthComposite)
  }

  private getSeaPlaneEye(): Cesium.Cartesian4 {
    const localOrigin = this.spatial.originCartesian
    const view = this.viewer.camera.viewMatrix

    Cesium.Matrix4.multiplyByPoint(view, localOrigin, this.scratchSeaOriginEye)
    Cesium.Matrix4.multiplyByPointAsVector(
      this.spatial.localToWorld,
      Cesium.Cartesian3.UNIT_Z,
      this.scratchSeaNormalWorld,
    )
    Cesium.Matrix4.multiplyByPointAsVector(view, this.scratchSeaNormalWorld, this.scratchSeaNormalEye)
    Cesium.Cartesian3.normalize(this.scratchSeaNormalEye, this.scratchSeaNormalEye)

    // plane: n · x + d = 0, 海平面通过研究区原点。
    // 注意：Cesium.Cartesian4 没有 Three.js 风格的 .set()，需直接赋值。
    this.seaPlaneEye.x = this.scratchSeaNormalEye.x
    this.seaPlaneEye.y = this.scratchSeaNormalEye.y
    this.seaPlaneEye.z = this.scratchSeaNormalEye.z
    this.seaPlaneEye.w = -Cesium.Cartesian3.dot(this.scratchSeaNormalEye, this.scratchSeaOriginEye)
    return this.seaPlaneEye
  }

  private addSyntheticCoastlineAndIslands(): void {
    this.islandEntities.forEach((entity) => this.viewer.entities.remove(entity))
    this.shorelineEntities.forEach((entity) => this.viewer.entities.remove(entity))
    this.islandEntities = []
    this.shorelineEntities = []

    // 本地示范陆块：用于无后端/无地形服务时验证“赤潮体→Cesium深度→复合”遮挡链路。
    // 后续接入真实 Cesium TerrainProvider 时无需改 Three 合成器，深度来源会自动替换为真实地形深度。
    const islands = [
      { east: -43_000, north: 14_000, width: 18_000, height: 11_000, top: 96, bottom: -620 },
      { east: 25_000, north: 24_000, width: 16_000, height: 9_000, top: 72, bottom: -420 },
      { east: 43_000, north: -20_000, width: 14_000, height: 13_000, top: 128, bottom: -760 },
    ]

    for (const [index, island] of islands.entries()) {
      const points = [
        [-0.55, -0.35], [-0.10, -0.52], [0.40, -0.36], [0.58, 0.12], [0.22, 0.48], [-0.32, 0.42], [-0.55, -0.35],
      ] as Array<[number, number]>
      const corners = points.map(([px, py]) => this.offsetDegrees(
        this.studyArea.center.longitude,
        this.studyArea.center.latitude,
        island.east + px * island.width,
        island.north + py * island.height,
      ))
      const hierarchy = new Cesium.PolygonHierarchy(
        corners.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, island.top)),
      )
      const entity = this.viewer.entities.add({
        id: `demo-island-${index + 1}`,
        name: `示范岛屿 ${index + 1}`,
        polygon: {
          hierarchy,
          height: island.bottom,
          extrudedHeight: island.top,
          material: Cesium.Color.fromCssColorString('#1f3945').withAlpha(0.98),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#79d8d0').withAlpha(0.72),
        },
      })
      this.islandEntities.push(entity)

      const shoreline = this.viewer.entities.add({
        id: `demo-shore-${index + 1}`,
        polyline: {
          positions: corners.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, island.top + 2)),
          width: 2,
          material: Cesium.Color.fromCssColorString('#83efe5').withAlpha(0.68),
          clampToGround: false,
        },
      })
      this.shorelineEntities.push(shoreline)
    }
  }

  /**
   * 设置地表（地球表面）透明度：1 为完全不透明，0 为完全透明。
   * 通过 globe.translucency 实现；接近 1 时直接关闭半透明通道以保证深度捕获管线行为不变。
   */
  setGlobeOpacity(alpha: number): void {
    const globe = this.viewer.scene.globe
    const translucent = alpha < 0.999
    globe.translucency.enabled = translucent
    if (translucent) {
      globe.translucency.frontFaceAlpha = alpha
      globe.translucency.backFaceAlpha = alpha
    }
  }

  private configureScene(): void {
    const scene = this.viewer.scene
    scene.backgroundColor = Cesium.Color.fromCssColorString('#06131c')
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#082333')
    scene.globe.showGroundAtmosphere = false
    scene.globe.enableLighting = false
    scene.globe.depthTestAgainstTerrain = true
    sceneInternals(scene).fxaa = true
    scene.msaaSamples = 2
    scene.screenSpaceCameraController.minimumZoomDistance = 2_000
    scene.screenSpaceCameraController.maximumZoomDistance = 5_000_000
    scene.requestRenderMode = false
    scene.logarithmicDepthBuffer = false
  }

  private flyToStudyArea(): void {
    const { longitude, latitude } = this.studyArea.center
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(longitude, latitude - 0.18, 130_000),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-42),
        roll: 0,
      },
      duration: 0,
    })
  }

  private offsetDegrees(lon: number, lat: number, eastMeters: number, northMeters: number): [number, number] {
    const metersPerDegreeLat = 110_574
    const metersPerDegreeLon = 111_320 * Math.cos(Cesium.Math.toRadians(lat))
    return [lon + eastMeters / metersPerDegreeLon, lat + northMeters / metersPerDegreeLat]
  }
}
