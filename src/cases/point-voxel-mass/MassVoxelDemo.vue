<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  ClippingPlane,
  ClippingPlaneCollection,
  Color,
  CustomShader,
  Matrix4,
  MetadataComponentType,
  MetadataType,
  PixelDatatype,
  PixelFormat,
  PointPrimitiveCollection,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  TextureUniform,
  Transforms,
  UniformType,
  VoxelContent,
  VoxelPrimitive,
  VoxelShapeType,
  Math as CesiumMath,
  type PointPrimitive,
  type VoxelProvider,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import InfoTip from '../../components/InfoTip.vue'
import { VOXEL_WORKER_SOURCE } from './voxel-worker-source'

/** 场景中心与体数据包围盒（局部 ENU 米坐标以中心为原点） */
const CENTER = { lon: 116.39, lat: 39.91, height: 300 }
const VOLUME = { width: 4200, depth: 4200, height: 2400 }
const MIN_X = -VOLUME.width / 2
const MAX_X = VOLUME.width / 2
const MIN_Y = -VOLUME.depth / 2
const MAX_Y = VOLUME.depth / 2
const MIN_Z = 0
const MAX_Z = VOLUME.height
const CENTER_LOCAL = { x: 0, y: 0, z: (MIN_Z + MAX_Z) / 2 }
const HALF_DIAGONAL = 0.5 * Math.sqrt(VOLUME.width ** 2 + VOLUME.depth ** 2 + VOLUME.height ** 2)
const VOL_MIN = [MIN_X, MIN_Y, MIN_Z]
const VOL_SIZE = [VOLUME.width, VOLUME.depth, VOLUME.height]

/** 传递函数查找表宽度（256×1 RGBA 纹理） */
const LUT_WIDTH = 256

type PaletteDef = { label: string; stops: [number, number, number][] }

/** 色带：每个色带映射为一张 256×1 传递函数纹理，由片元着色器统一采样 */
const PALETTES: PaletteDef[] = [
  { label: 'Viridis', stops: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]] },
  { label: 'Turbo', stops: [[48, 18, 59], [70, 134, 251], [27, 229, 181], [170, 255, 72], [251, 126, 33], [122, 4, 3]] },
  { label: '冷暖', stops: [[59, 76, 192], [141, 176, 254], [221, 221, 221], [247, 164, 137], [180, 4, 38]] },
  { label: '地形', stops: [[26, 52, 90], [46, 125, 77], [180, 190, 120], [150, 100, 60], [255, 255, 255]] },
  { label: '彩虹', stops: [[110, 64, 170], [0, 200, 255], [0, 255, 160], [255, 255, 0], [255, 120, 0], [255, 0, 0]] },
  { label: 'Jet', stops: [[0, 0, 143], [0, 0, 255], [0, 255, 255], [255, 255, 0], [255, 0, 0], [128, 0, 0]] }
]

function lerpStops(stops: [number, number, number][], t: number): [number, number, number] {
  const c = t < 0 ? 0 : t > 1 ? 1 : t
  const scaled = c * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(scaled))
  const local = scaled - i
  const a = stops[i]
  const b = stops[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * local),
    Math.round(a[1] + (b[1] - a[1]) * local),
    Math.round(a[2] + (b[2] - a[2]) * local)
  ]
}

/**
 * 生成 256×1 RGBA 传递函数：RGB 为色带，A 为带基底的平滑上升曲线。
 * alphaFloor 控制低值体元素保留的基底不透明度：越大越完整覆盖点云数据域，
 * 为 0 时低值完全透明、仅显示异常团块；高值平滑抬升至不透明以突出异常体。
 */
function buildLut(index: number, alphaFloor: number): Uint8Array {
  const stops = PALETTES[index].stops
  const lut = new Uint8Array(LUT_WIDTH * 4)
  const floor = Math.max(0, Math.min(1, alphaFloor))
  for (let i = 0; i < LUT_WIDTH; i += 1) {
    const t = i / (LUT_WIDTH - 1)
    const [r, g, b] = lerpStops(stops, t)
    lut[i * 4] = r
    lut[i * 4 + 1] = g
    lut[i * 4 + 2] = b
    const ramp = t * t * (3 - 2 * t)
    lut[i * 4 + 3] = Math.round(255 * (floor + (1 - floor) * ramp))
  }
  return lut
}

/** 覆盖基底默认值：低值体元素的最低不透明度 */
const DEFAULT_COVERAGE = 0.32

/** 分辨率预设：tileSize 为每个瓦片的体素边长，levels 为 LOD 层级数 */
type Preset = { label: string; tileSize: number; levels: number }
const PRESETS: Preset[] = [
  { label: '128³', tileSize: 16, levels: 4 },
  { label: '192³', tileSize: 24, levels: 4 },
  { label: '256³', tileSize: 32, levels: 4 },
  { label: '256³ 细瓦片', tileSize: 16, levels: 5 }
]

let currentLut = buildLut(0, DEFAULT_COVERAGE)

function makeLutTexture(lut: Uint8Array): TextureUniform {
  return new TextureUniform({
    typedArray: lut,
    width: LUT_WIDTH,
    height: 1,
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
    repeat: false,
    minificationFilter: TextureMinificationFilter.LINEAR,
    magnificationFilter: TextureMagnificationFilter.LINEAR
  })
}

/** 体元素元数据 (value, valid) 交由片元着色器做传递函数映射 */
const voxelShader = new CustomShader({
  uniforms: {
    uTransferFunction: { type: UniformType.SAMPLER_2D, value: makeLutTexture(currentLut) },
    uValueMin: { type: UniformType.FLOAT, value: 0 },
    uValueMax: { type: UniformType.FLOAT, value: 1 },
    uOpacity: { type: UniformType.FLOAT, value: 0.85 },
    uShading: { type: UniformType.FLOAT, value: 0.5 }
  },
  fragmentShaderText: `
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      vec2 meta = fsInput.metadata.color;
      float value = meta.r;
      float valid = meta.g;
      vec3 color = vec3(0.0);
      float alpha = 0.0;
      if (valid > 0.5) {
        float t = clamp((value - uValueMin) / max(0.000001, uValueMax - uValueMin), 0.0, 1.0);
        vec4 c = texture(uTransferFunction, vec2(t, 0.5));
        color = c.rgb;
        alpha = uOpacity * c.a;
      }
      float ndotl = max(dot(normalize(fsInput.attributes.normalEC), normalize(vec3(0.3, 0.5, 0.8))), 0.0);
      float shade = mix(1.0, 0.6 + 0.4 * ndotl, uShading);
      material.diffuse = color * shade;
      material.alpha = alpha;
    }
  `
})

const container = ref<HTMLElement | null>(null)
const previewCanvas = ref<HTMLCanvasElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const showVolume = ref(true)
const showPoints = ref(false)

/** 控制面板折叠状态：窄视口默认收起，避免与左侧剖切/图例面板重叠 */
const COLLAPSE_WIDTH = 620
const panelOpen = ref(true)
const shellWidth = ref(Number.POSITIVE_INFINITY)
let shellObserver: ResizeObserver | undefined

function togglePanel(): void {
  panelOpen.value = !panelOpen.value
}

watch(shellWidth, (width, previous) => {
  const narrow = width < COLLAPSE_WIDTH
  const wasNarrow = previous < COLLAPSE_WIDTH
  if (narrow !== wasNarrow) panelOpen.value = !narrow
})

const presetIndex = ref(2)
const pointCount = ref(20000)
const seed = ref(20260928)
const neighborK = ref(16)
const searchRadius = ref(0.18)
const idwPower = ref(2)
const fillEmpty = ref(true)
const smoothPasses = ref(1)

const palette = ref(0)
const opacity = ref(0.85)
const coverage = ref(DEFAULT_COVERAGE)
const valueMin = ref(0)
const valueMax = ref(1)
const stepSize = ref(1)
const sse = ref(12)
const nearest = ref(false)
const pointSize = ref(3)

const clip = reactive({ enabled: true, azimuth: 45, tilt: 0, offset: 0, flip: false })

const stats = reactive({
  points: 0,
  buildTime: 0,
  dataMin: 0,
  dataMax: 1,
  tilesReady: 0,
  pending: 0
})

const picked = ref<{ value: number; valid: boolean; tileIndex: number; sampleIndex: number } | null>(null)
const hasSlice = ref(false)

const activePreset = computed(() => PRESETS[presetIndex.value])
const fullDims = computed(() => activePreset.value.tileSize * 2 ** (activePreset.value.levels - 1))
const totalTiles = computed(() => (8 ** activePreset.value.levels - 1) / 7)
const effectiveVoxels = computed(() => fullDims.value ** 3)
const neighborOptions = [8, 16, 32]

const legendStyle = computed(() => {
  const stops = PALETTES[palette.value].stops.map((s) => `rgb(${s[0]}, ${s[1]}, ${s[2]})`).join(', ')
  return { background: `linear-gradient(90deg, ${stops})` }
})

const normalText = computed(() => {
  const n = clipNormal()
  return `${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}`
})

let viewer: Viewer | undefined
let voxelPrimitive: VoxelPrimitive | undefined
let pointCollection: PointPrimitiveCollection | undefined
let pointPrimitives: PointPrimitive[] = []
let handler: ScreenSpaceEventHandler | undefined
let clipCollection: ClippingPlaneCollection | undefined
let clipPlane: ClippingPlane | undefined

let cloudValues: Float32Array | undefined
let worker: Worker | undefined
let workerUrl: string | undefined
let buildToken = 0
let requestSeq = 0
const pendingExtracts = new Map<number, { resolve: (metadata: Float32Array) => void; reject: (error: Error) => void }>()

/** 当前体数据采样参数（每次瓦片请求时下发给 Worker，变化无需重建点集） */
function sampleParams() {
  return {
    k: neighborK.value,
    radius: searchRadius.value,
    power: idwPower.value,
    fillEmpty: fillEmpty.value,
    smoothPasses: smoothPasses.value
  }
}

function modelMatrix(): Matrix4 {
  return Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(CENTER.lon, CENTER.lat, CENTER.height))
}

/** 剖切面法线（局部 ENU 坐标，单位向量） */
function clipNormal(): { x: number; y: number; z: number } {
  const az = CesiumMath.toRadians(clip.azimuth)
  const tilt = CesiumMath.toRadians(clip.tilt)
  return {
    x: Math.cos(tilt) * Math.cos(az),
    y: Math.cos(tilt) * Math.sin(az),
    z: Math.sin(tilt)
  }
}

/** 剖切面上的一点：位于体积中心，沿法线按偏移量平移 */
function clipPlanePoint(n: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const halfExtent = 0.5 * (Math.abs(n.x) * VOLUME.width + Math.abs(n.y) * VOLUME.depth + Math.abs(n.z) * VOLUME.height)
  const s = (clip.offset / 100) * halfExtent
  return {
    x: CENTER_LOCAL.x + n.x * s,
    y: CENTER_LOCAL.y + n.y * s,
    z: CENTER_LOCAL.z + n.z * s
  }
}

/** 剖切面基向量（与采样一致）：e1 = normalize(cross(up, n))，e2 = cross(n, e1) */
function clipBasis(n: { x: number; y: number; z: number }) {
  const upX = Math.abs(n.z) > 0.9 ? 1 : 0
  const upZ = Math.abs(n.z) > 0.9 ? 0 : 1
  let e1x = -upZ * n.y
  let e1y = upZ * n.x - upX * n.z
  let e1z = upX * n.y
  const len = Math.hypot(e1x, e1y, e1z) || 1
  e1x /= len
  e1y /= len
  e1z /= len
  return {
    e1: [e1x, e1y, e1z],
    e2: [n.y * e1z - n.z * e1y, n.z * e1x - n.x * e1z, n.x * e1y - n.y * e1x]
  }
}

function onWorkerMessage(event: MessageEvent): void {
  const message = event.data
  if (!message || message.epoch !== buildToken) return
  if (message.type === 'buildDone') {
    stats.buildTime = Math.round(message.stats.buildTime * 10) / 10
    stats.points = message.stats.points
    stats.dataMin = message.stats.dataMin
    stats.dataMax = message.stats.dataMax
    cloudValues = message.cloud.values as Float32Array
    createPrimitive()
    createPointCloud(message.cloud.positions as Float32Array)
    refreshShader()
    updateClipPlane()
    requestClipPreview(false)
    statusMessage.value =
      '✓ ' +
      stats.points.toLocaleString() +
      ' 采样点 → ' +
      fullDims.value +
      '³ 有效分辨率（' +
      activePreset.value.tileSize +
      '³ / 瓦片 · ' +
      activePreset.value.levels +
      ' 级 LOD）· 建点数 ' +
      stats.buildTime +
      ' ms'
    viewer?.scene.requestRender()
    return
  }
  if (message.type === 'extractDone') {
    const pending = pendingExtracts.get(message.requestId)
    if (pending) {
      pendingExtracts.delete(message.requestId)
      pending.resolve(message.metadata as Float32Array)
    }
    viewer?.scene.requestRender()
    return
  }
  if (message.type === 'sliceDone') {
    drawSlice(message.values as Float32Array, message.valid as Uint8Array, message.size as number)
  }
}

function createWorker(): Worker {
  const blob = new Blob([VOXEL_WORKER_SOURCE], { type: 'application/javascript' })
  workerUrl = URL.createObjectURL(blob)
  const instance = new Worker(workerUrl)
  instance.onmessage = onWorkerMessage
  instance.onerror = (event) => {
    statusMessage.value = '体数据 Worker 异常：' + (event.message || 'unknown')
  }
  return instance
}

function requestData(options: { tileLevel?: number; tileX?: number; tileY?: number; tileZ?: number }): Promise<VoxelContent> {
  const instance = worker
  const dim = activePreset.value.tileSize + 2
  if (!instance) {
    return Promise.resolve(VoxelContent.fromMetadataArray([new Float32Array(dim * dim * dim * 2)]))
  }
  return new Promise<VoxelContent>((resolve, reject) => {
    const requestId = (requestSeq += 1)
    pendingExtracts.set(requestId, {
      resolve: (metadata: Float32Array) => resolve(VoxelContent.fromMetadataArray([metadata])),
      reject
    })
    instance.postMessage({
      type: 'extract',
      epoch: buildToken,
      requestId,
      tileLevel: options.tileLevel ?? 0,
      tileX: options.tileX ?? 0,
      tileY: options.tileY ?? 0,
      tileZ: options.tileZ ?? 0,
      tileSize: activePreset.value.tileSize,
      params: sampleParams()
    })
  })
}

function createPrimitive(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (voxelPrimitive) {
    viewer.scene.primitives.remove(voxelPrimitive)
    voxelPrimitive = undefined
  }
  const preset = activePreset.value
  const provider = {
    shape: VoxelShapeType.BOX,
    dimensions: new Cartesian3(preset.tileSize, preset.tileSize, preset.tileSize),
    paddingBefore: new Cartesian3(1, 1, 1),
    paddingAfter: new Cartesian3(1, 1, 1),
    shapeTransform: Matrix4.IDENTITY,
    globalTransform: Matrix4.IDENTITY,
    minBounds: new Cartesian3(MIN_X, MIN_Y, MIN_Z),
    maxBounds: new Cartesian3(MAX_X, MAX_Y, MAX_Z),
    names: ['color'],
    types: [MetadataType.VEC2],
    componentTypes: [MetadataComponentType.FLOAT32],
    availableLevels: preset.levels,
    requestData
  } as unknown as VoxelProvider

  const primitive = new VoxelPrimitive({
    provider,
    modelMatrix: modelMatrix(),
    customShader: voxelShader,
    calculateStatistics: false
  })
  primitive.screenSpaceError = sse.value
  primitive.stepSize = stepSize.value
  primitive.nearestSampling = nearest.value
  primitive.minBounds = new Cartesian3(MIN_X, MIN_Y, MIN_Z)
  primitive.maxBounds = new Cartesian3(MAX_X, MAX_Y, MAX_Z)
  primitive.show = showVolume.value

  primitive.loadProgress.addEventListener((pending: number, processing: number) => {
    stats.pending = pending + processing
    const statistics = (
      primitive as unknown as {
        statistics?: { numberOfTilesWithContentReady: number }
      }
    ).statistics
    if (statistics) stats.tilesReady = statistics.numberOfTilesWithContentReady
    viewer?.scene.requestRender()
  })

  clipPlane = new ClippingPlane(new Cartesian3(0, 0, 1), 0)
  clipCollection = new ClippingPlaneCollection({
    modelMatrix: modelMatrix(),
    enabled: clip.enabled,
    planes: [clipPlane]
  })
  primitive.clippingPlanes = clipCollection

  viewer.scene.primitives.add(primitive)
  voxelPrimitive = primitive
}

function createPointCloud(positions: Float32Array): void {
  if (!viewer || viewer.isDestroyed()) return
  if (pointCollection) {
    viewer.scene.primitives.remove(pointCollection)
    pointCollection = undefined
    pointPrimitives = []
  }
  const collection = new PointPrimitiveCollection({ modelMatrix: modelMatrix() })
  const span = stats.dataMax - stats.dataMin || 1
  const values = cloudValues
  const count = values ? values.length : 0
  for (let i = 0; i < count; i += 1) {
    const x = MIN_X + positions[i * 3] * VOLUME.width
    const y = MIN_Y + positions[i * 3 + 1] * VOLUME.depth
    const z = MIN_Z + positions[i * 3 + 2] * VOLUME.height
    const t = ((values as Float32Array)[i] - stats.dataMin) / span
    const lutIndex = Math.max(0, Math.min(LUT_WIDTH - 1, Math.round(t * (LUT_WIDTH - 1))))
    const point = collection.add({
      position: new Cartesian3(x, y, z),
      pixelSize: pointSize.value,
      color: new Color(
        currentLut[lutIndex * 4] / 255,
        currentLut[lutIndex * 4 + 1] / 255,
        currentLut[lutIndex * 4 + 2] / 255,
        0.9
      ),
      disableDepthTestDistance: 0
    })
    pointPrimitives.push(point)
  }
  collection.show = showPoints.value
  viewer.scene.primitives.add(collection)
  pointCollection = collection
}

function applyPointColors(): void {
  const values = cloudValues
  if (!values) return
  const span = stats.dataMax - stats.dataMin || 1
  for (let i = 0; i < pointPrimitives.length; i += 1) {
    const t = (values[i] - stats.dataMin) / span
    const lutIndex = Math.max(0, Math.min(LUT_WIDTH - 1, Math.round(t * (LUT_WIDTH - 1))))
    pointPrimitives[i].color = new Color(
      currentLut[lutIndex * 4] / 255,
      currentLut[lutIndex * 4 + 1] / 255,
      currentLut[lutIndex * 4 + 2] / 255,
      0.9
    )
  }
  viewer?.scene.requestRender()
}

function applyPointSize(): void {
  for (let i = 0; i < pointPrimitives.length; i += 1) pointPrimitives[i].pixelSize = pointSize.value
  viewer?.scene.requestRender()
}

function refreshShader(): void {
  voxelShader.uniforms.uValueMin.value = valueMin.value
  voxelShader.uniforms.uValueMax.value = valueMax.value
  voxelShader.uniforms.uOpacity.value = opacity.value
  voxelShader.uniforms.uShading.value = 0.5
  viewer?.scene.requestRender()
}

function refreshLut(): void {
  currentLut = buildLut(palette.value, coverage.value)
  voxelShader?.setUniform('uTransferFunction', makeLutTexture(currentLut))
  applyPointColors()
  redrawLastSlice()
  requestAnimationFrame(() => viewer?.scene.requestRender())
}

function selectPalette(index: number): void {
  palette.value = index
  refreshLut()
}

function onCoverageChange(): void {
  refreshLut()
}

function togglePoints(): void {
  showPoints.value = !showPoints.value
  if (pointCollection) pointCollection.show = showPoints.value
  viewer?.scene.requestRender()
}

function toggleVolume(): void {
  showVolume.value = !showVolume.value
  if (voxelPrimitive) voxelPrimitive.show = showVolume.value
  viewer?.scene.requestRender()
}

function toggleFillEmpty(): void {
  fillEmpty.value = !fillEmpty.value
  reloadTiles()
}

function toggleNearest(): void {
  nearest.value = !nearest.value
  if (voxelPrimitive) voxelPrimitive.nearestSampling = nearest.value
  viewer?.scene.requestRender()
}

function applyStepSize(): void {
  if (voxelPrimitive) voxelPrimitive.stepSize = stepSize.value
  viewer?.scene.requestRender()
}

function applySse(): void {
  if (voxelPrimitive) voxelPrimitive.screenSpaceError = sse.value
  viewer?.scene.requestRender()
}

function updateClipPlane(): void {
  if (!clipCollection || !clipPlane || !viewer || viewer.isDestroyed()) return
  const n = clipNormal()
  const p = clipPlanePoint(n)
  let nx = n.x
  let ny = n.y
  let nz = n.z
  if (clip.flip) {
    nx = -nx
    ny = -ny
    nz = -nz
  }
  clipPlane.normal = new Cartesian3(nx, ny, nz)
  clipPlane.distance = -(nx * p.x + ny * p.y + nz * p.z)
  clipCollection.enabled = clip.enabled
  viewer.scene.requestRender()
}

function toggleClipEnabled(): void {
  clip.enabled = !clip.enabled
  updateClipPlane()
  requestClipPreview(false)
}

function toggleClipFlip(): void {
  clip.flip = !clip.flip
  updateClipPlane()
  requestClipPreview(false)
}

let previewTimer: ReturnType<typeof setTimeout> | undefined
let previewQueued = false

function onClipInput(): void {
  updateClipPlane()
  if (!previewQueued) {
    previewQueued = true
    requestAnimationFrame(() => {
      previewQueued = false
      requestClipPreview(false)
    })
  }
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => requestClipPreview(true), 140)
}

function onRangeChange(): void {
  refreshShader()
  redrawLastSlice()
}

function onOpacityChange(): void {
  refreshShader()
  redrawLastSlice()
}

let lastSlice: { values: Float32Array; valid: Uint8Array; size: number } | undefined

function requestClipPreview(high: boolean): void {
  const instance = worker
  if (!instance) return
  const size = high ? 256 : 112
  const n = clipNormal()
  const p = clipPlanePoint(n)
  const { e1, e2 } = clipBasis(n)
  instance.postMessage({
    type: 'slice',
    epoch: buildToken,
    requestId: (requestSeq += 1),
    size,
    normal: [n.x, n.y, n.z],
    point: [p.x, p.y, p.z],
    e1,
    e2,
    halfDiag: HALF_DIAGONAL,
    volMin: VOL_MIN,
    volSize: VOL_SIZE,
    params: sampleParams()
  })
}

function drawSlice(values: Float32Array, valid: Uint8Array, size: number): void {
  lastSlice = { values, valid, size }
  redrawLastSlice()
}

function redrawLastSlice(): void {
  const canvas = previewCanvas.value
  const slice = lastSlice
  if (!canvas || !slice) return
  const context = canvas.getContext('2d')
  if (!context) return
  if (canvas.width !== slice.size) {
    canvas.width = slice.size
    canvas.height = slice.size
  }
  const image = context.createImageData(slice.size, slice.size)
  const data = image.data
  const span = stats.dataMax - stats.dataMin || 1
  const rangeSpan = valueMax.value - valueMin.value
  const rangeScale = 1 / (Math.abs(rangeSpan) < 1e-6 ? 1e-6 : rangeSpan)
  const alphaBase = opacity.value
  for (let i = 0; i < slice.size * slice.size; i += 1) {
    if (!slice.valid[i]) {
      data[i * 4 + 3] = 0
      continue
    }
    const nrm = (slice.values[i] - stats.dataMin) / span
    const t = Math.max(0, Math.min(1, (nrm - valueMin.value) * rangeScale))
    const lutIndex = Math.round(t * (LUT_WIDTH - 1))
    data[i * 4] = currentLut[lutIndex * 4]
    data[i * 4 + 1] = currentLut[lutIndex * 4 + 1]
    data[i * 4 + 2] = currentLut[lutIndex * 4 + 2]
    data[i * 4 + 3] = Math.round(alphaBase * currentLut[lutIndex * 4 + 3])
  }
  context.putImageData(image, 0, 0)
  hasSlice.value = true
}

function downloadClipPreview(): void {
  const canvas = previewCanvas.value
  if (!canvas) return
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `voxel-slice-az${clip.azimuth}-tilt${clip.tilt}-off${clip.offset}.png`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, 'image/png')
}

function handlePick(position: Cartesian2): void {
  if (!voxelPrimitive || !viewer || viewer.isDestroyed()) {
    picked.value = null
    return
  }
  const cell = viewer.scene.pickVoxel(position)
  if (!cell || cell.primitive !== voxelPrimitive) {
    picked.value = null
    return
  }
  const property = cell.getProperty('color') as Float32Array | undefined
  picked.value = {
    value: property ? property[0] : 0,
    valid: property ? property[1] > 0.5 : false,
    tileIndex: cell.tileIndex,
    sampleIndex: cell.sampleIndex
  }
}

function disposePrimitive(): void {
  if (voxelPrimitive && viewer && !viewer.isDestroyed()) viewer.scene.primitives.remove(voxelPrimitive)
  voxelPrimitive = undefined
  clipPlane = undefined
  clipCollection = undefined
}

function disposePoints(): void {
  if (pointCollection && viewer && !viewer.isDestroyed()) viewer.scene.primitives.remove(pointCollection)
  pointCollection = undefined
  pointPrimitives = []
}

/** 仅重新抽取瓦片：点集与空间哈希保持不变，用于 K/半径/幂次/平滑等采样参数变更 */
function reloadTiles(): void {
  if (!viewer || viewer.isDestroyed()) return
  disposePrimitive()
  createPrimitive()
  updateClipPlane()
  requestClipPreview(false)
  viewer.scene.requestRender()
}

/** 重建点集与空间哈希（Worker），用于采样点/种子/分辨率预设变更 */
function rebuild(): void {
  if (!viewer || viewer.isDestroyed()) return
  statusMessage.value = '正在重建海量体数据…'
  disposePrimitive()
  disposePoints()
  pendingExtracts.forEach((pending) => pending.reject(new Error('rebuild')))
  pendingExtracts.clear()
  if (worker) {
    worker.terminate()
    worker = undefined
  }
  if (workerUrl) {
    URL.revokeObjectURL(workerUrl)
    workerUrl = undefined
  }
  buildToken += 1
  worker = createWorker()
  worker.postMessage({
    type: 'build',
    epoch: buildToken,
    params: { pointCount: pointCount.value, seed: seed.value }
  })
}

function resetCamera(duration: number): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(CENTER.lon, CENTER.lat - 0.022, 3000),
    orientation: {
      heading: CesiumMath.toRadians(0),
      pitch: CesiumMath.toRadians(-30),
      roll: 0
    },
    duration
  })
}

onMounted(() => {
  if (!container.value) return

  shellWidth.value = container.value.clientWidth
  if (typeof ResizeObserver !== 'undefined') {
    shellObserver = new ResizeObserver((entries) => {
      for (const entry of entries) shellWidth.value = entry.contentRect.width
    })
    shellObserver.observe(container.value)
  }

  const webgl2 = (() => {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('experimental-webgl2'))
  })()
  if (!webgl2) {
    statusMessage.value = '当前浏览器/显卡没有可用的 WebGL2，Cesium VoxelPrimitive 需要 WebGL2'
    return
  }

  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    if (!viewer || viewer.isDestroyed()) return

    // 静态体数据观察场景：仅在需要变化时渲染，显著降低空闲时 CPU/GPU 占用
    viewer.scene.requestRenderMode = true
    viewer.scene.maximumRenderTimeChange = Infinity
    resetCamera(0)

    handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction(
      (movement: { endPosition: Cartesian2 }) => handlePick(movement.endPosition),
      ScreenSpaceEventType.MOUSE_MOVE
    )

    rebuild()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer)
  shellObserver?.disconnect()
  shellObserver = undefined
  if (handler && !handler.isDestroyed()) handler.destroy()
  handler = undefined
  pendingExtracts.forEach((pending) => pending.reject(new Error('dispose')))
  pendingExtracts.clear()
  if (worker) {
    worker.terminate()
    worker = undefined
  }
  if (workerUrl) {
    URL.revokeObjectURL(workerUrl)
    workerUrl = undefined
  }
  disposePrimitive()
  disposePoints()
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="pv-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel" :class="{ 'is-collapsed': !panelOpen }">
      <div class="panel-head">
        <span class="panel-title">高性能海量体元素渲染</span>
        <button class="panel-toggle" title="收起控制面板" @click="togglePanel">›</button>
      </div>
      <p class="status" :class="{ ok: statusMessage.startsWith('✓') }">{{ statusMessage }}</p>

      <div class="section-title">
        点数据源
        <InfoTip title="点数据源" text="由模拟标量场生成的离散空间点集（x/y/z 坐标 + 数值），作为海量体数据重建的输入。点集生成、空间哈希与插值全部在 Web Worker 中完成。" />
      </div>
      <div class="control-row">
        <span class="row-label">
          采样点数
          <InfoTip title="采样点数" text="离散采样点数量。点越多，重建出的体数据越接近连续场，Worker 建立空间索引的耗时略有增加。" />
        </span>
        <input type="range" min="2000" max="200000" step="2000" v-model.number="pointCount" @change="rebuild" />
        <span class="row-value">{{ pointCount.toLocaleString() }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          随机种子
          <InfoTip title="随机种子" text="控制随机点生成。相同种子得到完全相同的点集与重建结果，便于复现与对比。" />
        </span>
        <input type="range" min="1" max="99999" step="1" v-model.number="seed" @change="rebuild" />
        <span class="row-value">{{ seed }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          显示原始点云
          <InfoTip title="显示原始点云" text="叠加显示原始离散采样点（超量自动抽稀至 2 万），用于对比插值前后差异。" />
        </span>
        <button class="switch-button" :class="{ 'is-on': showPoints }" role="switch" :aria-checked="showPoints" @click="togglePoints">
          <span class="switch-knob"></span>
        </button>
      </div>
      <div class="control-row">
        <span class="row-label">
          点尺寸
          <InfoTip title="点尺寸" text="原始点云中点图元的像素直径。" />
        </span>
        <input type="range" min="1" max="8" step="1" v-model.number="pointSize" @input="applyPointSize" />
        <span class="row-value">{{ pointSize }}px</span>
      </div>

      <div class="section-title">
        体数据 LOD
        <InfoTip title="体数据 LOD" text="体数据按八叉树组织为多级瓦片：每个瓦片 tileSize³ 体素，层级越高覆盖范围越小、分辨率越高。Cesium 依据屏幕误差自动流式加载合适的层级，实现远处低分辨率、近处高分辨率。" />
      </div>
      <div class="palette-row">
        <button
          v-for="(item, i) in PRESETS"
          :key="item.label"
          type="button"
          class="palette-button"
          :class="{ active: presetIndex === i }"
          @click="presetIndex = i; rebuild()"
        >
          {{ item.label }}
        </button>
      </div>
      <div class="control-row">
        <span class="row-label">瓦片 / LOD</span>
        <span class="row-value">{{ activePreset.tileSize }}³ · {{ activePreset.levels }} 级</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          K 近邻数
          <InfoTip title="K 近邻数" text="每个体素取最近的 K 个采样点做反距离加权（IDW）插值。相比旧的“候选点上限 + 等间隔抽稀”，K 近邻更稳定、无明显空间偏差。" />
        </span>
        <div class="mini-buttons">
          <button
            v-for="value in neighborOptions"
            :key="value"
            type="button"
            class="mini-button"
            :class="{ active: neighborK === value }"
            @click="neighborK = value; reloadTiles()"
          >
            {{ value }}
          </button>
        </div>
      </div>
      <div class="control-row">
        <span class="row-label">
          搜索半径
          <InfoTip title="搜索半径" text="IDW 仅统计该半径内的近邻（归一化空间）。半径外的近邻权重为 0；半径内不足时按需用最近点填充。" />
        </span>
        <input type="range" min="0.04" max="0.4" step="0.01" v-model.number="searchRadius" @change="reloadTiles" />
        <span class="row-value">{{ searchRadius.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          距离幂次
          <InfoTip title="距离幂次" text="IDW 权重衰减指数。越大越接近最近邻、边界越锐利；越小过渡越平缓。" />
        </span>
        <input type="range" min="1" max="4" step="0.5" v-model.number="idwPower" @change="reloadTiles" />
        <span class="row-value">{{ idwPower.toFixed(1) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          空体元素最近邻填充
          <InfoTip title="空体元素最近邻填充" text="当体素在搜索半径内没有采样点时，改用最近采样点的值填充，避免体渲染出现空洞。" />
        </span>
        <button class="switch-button" :class="{ 'is-on': fillEmpty }" role="switch" :aria-checked="fillEmpty" @click="toggleFillEmpty">
          <span class="switch-knob"></span>
        </button>
      </div>
      <div class="control-row">
        <span class="row-label">
          高斯平滑轮数
          <InfoTip title="高斯平滑轮数" text="对体数据标量场做严格可分离（X→Y→Z）的三维高斯平滑，每轮复杂度约为 9N。数值越大过渡越圆滑、块状边界越弱。" />
        </span>
        <input type="range" min="0" max="3" step="1" v-model.number="smoothPasses" @change="reloadTiles" />
        <span class="row-value">{{ smoothPasses }}</span>
      </div>

      <div class="section-title">
        体渲染参数
        <InfoTip title="体渲染参数" text="色带以 256×1 传递函数纹理实现，片元着色器统一按纹理采样颜色与透明度。" />
      </div>
      <div class="palette-row">
        <button
          v-for="(item, i) in PALETTES"
          :key="item.label"
          type="button"
          class="palette-button"
          :class="{ active: palette === i }"
          @click="selectPalette(i)"
        >
          {{ item.label }}
        </button>
      </div>
      <div class="control-row">
        <span class="row-label">
          不透明度
          <InfoTip title="不透明度" text="体渲染整体透明度。越低越能透过前方结构看到后方数值分布。" />
        </span>
        <input type="range" min="0.1" max="1" step="0.02" v-model.number="opacity" @input="onOpacityChange" />
        <span class="row-value">{{ opacity.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          覆盖基底
          <InfoTip title="覆盖基底" text="低值体元素保留的最低不透明度。数值越大，体元素越完整覆盖点云所在数据域；为 0 时低值完全透明，仅显示异常团块。" />
        </span>
        <input type="range" min="0" max="0.9" step="0.02" v-model.number="coverage" @input="onCoverageChange" />
        <span class="row-value">{{ coverage.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          值域下限
          <InfoTip title="值域下限" text="数值映射下限，低于该值的体元素不再显示，用于突出目标区间。" />
        </span>
        <input type="range" min="0" max="1" step="0.02" v-model.number="valueMin" @input="onRangeChange" />
        <span class="row-value">{{ valueMin.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          值域上限
          <InfoTip title="值域上限" text="数值映射上限，与下限共同拉伸对比度。" />
        </span>
        <input type="range" min="0" max="1" step="0.02" v-model.number="valueMax" @input="onRangeChange" />
        <span class="row-value">{{ valueMax.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          光线步长
          <InfoTip title="光线步长" text="GPU 光线步进的采样步长。越小越精细，性能开销越大。" />
        </span>
        <input type="range" min="0.3" max="3" step="0.1" v-model.number="stepSize" @input="applyStepSize" />
        <span class="row-value">{{ stepSize }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          屏幕误差
          <InfoTip title="屏幕误差" text="LOD 细分阈值。体数据瓦片按屏幕空间误差决定是否下钻到更高层级：越小越倾向高分辨率，显存与请求量越大。" />
        </span>
        <input type="range" min="4" max="64" step="2" v-model.number="sse" @input="applySse" />
        <span class="row-value">{{ sse }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          最近邻采样
          <InfoTip title="最近邻采样" text="体元素采样方式。开启后呈清晰方块状，关闭则平滑过渡。" />
        </span>
        <button class="switch-button" :class="{ 'is-on': nearest }" role="switch" :aria-checked="nearest" @click="toggleNearest">
          <span class="switch-knob"></span>
        </button>
      </div>
      <div class="control-row">
        <span class="row-label">
          显示体元素
          <InfoTip title="显示体元素" text="是否显示体渲染结果，关闭后仅保留原始点云。" />
        </span>
        <button class="switch-button" :class="{ 'is-on': showVolume }" role="switch" :aria-checked="showVolume" @click="toggleVolume">
          <span class="switch-knob"></span>
        </button>
      </div>

      <div class="section-title">
        任意方向剖切
        <InfoTip title="任意方向剖切" text="沿任意方位角与倾角剖切体数据，切面采样同样在 Worker 中完成。拖动时使用低分辨率实时预览，松开后自动生成高分辨率切面。" />
      </div>
      <div class="control-row">
        <span class="row-label">
          启用剖切
          <InfoTip title="启用剖切" text="开启后按当前平面裁剪体元素，仅保留法线指向的一侧。" />
        </span>
        <button class="switch-button" :class="{ 'is-on': clip.enabled }" role="switch" :aria-checked="clip.enabled" @click="toggleClipEnabled">
          <span class="switch-knob"></span>
        </button>
      </div>
      <div class="control-row">
        <span class="row-label">
          方位角
          <InfoTip title="方位角" text="剖切面法线在水平面内的投影方向，0-360°。" />
        </span>
        <input type="range" min="0" max="360" step="1" v-model.number="clip.azimuth" @input="onClipInput" @change="onClipInput" />
        <span class="row-value">{{ clip.azimuth }}°</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          倾角
          <InfoTip title="倾角" text="剖切面法线仰角，0° 为竖直切面，90° 为水平切面。" />
        </span>
        <input type="range" min="0" max="90" step="1" v-model.number="clip.tilt" @input="onClipInput" @change="onClipInput" />
        <span class="row-value">{{ clip.tilt }}°</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          偏移
          <InfoTip title="偏移" text="剖切面沿法线的平移量，-100%~100%。" />
        </span>
        <input type="range" min="-100" max="100" step="1" v-model.number="clip.offset" @input="onClipInput" @change="onClipInput" />
        <span class="row-value">{{ clip.offset }}%</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          反转保留侧
          <InfoTip title="反转保留侧" text="翻转剖切面法线，改为保留另一侧体元素。" />
        </span>
        <button class="switch-button" :class="{ 'is-on': clip.flip }" role="switch" :aria-checked="clip.flip" @click="toggleClipFlip">
          <span class="switch-knob"></span>
        </button>
      </div>

      <div class="actions">
        <button class="action-button" @click="rebuild">重新生成</button>
        <button class="action-button" @click="resetCamera(1)">恢复视图</button>
      </div>
    </div>

    <button v-if="!panelOpen" class="panel-restore" title="展开控制面板" @click="togglePanel">控制面板</button>

    <div class="left-stack">
      <div class="clip-panel">
        <div class="clip-title">剖切面预览</div>
        <div class="clip-image-wrap">
          <canvas ref="previewCanvas" class="clip-canvas" :class="{ hidden: !hasSlice }"></canvas>
          <div v-if="!hasSlice" class="clip-empty">暂无切面</div>
        </div>
        <div class="clip-meta">
          <div class="clip-meta-row"><span>方位角</span><b>{{ clip.azimuth }}°</b></div>
          <div class="clip-meta-row"><span>倾角</span><b>{{ clip.tilt }}°</b></div>
          <div class="clip-meta-row"><span>偏移</span><b>{{ clip.offset }}%</b></div>
          <div class="clip-meta-row"><span>保留侧</span><b>{{ clip.flip ? '反向' : '正向' }}</b></div>
          <div class="clip-meta-row"><span>法线</span><b>({{ normalText }})</b></div>
        </div>
        <button class="clip-download" :disabled="!hasSlice" @click="downloadClipPreview">下载 PNG</button>
      </div>

      <div class="legend-panel">
        <div class="legend-title">图例 / 数据说明</div>
        <div class="legend-bar" :style="legendStyle"></div>
        <div class="legend-caption"><span>低值 {{ stats.dataMin.toFixed(3) }}</span><span>高值 {{ stats.dataMax.toFixed(3) }}</span></div>
        <div class="stat"><span>采样点数</span><b>{{ stats.points.toLocaleString() }}</b></div>
        <div class="stat"><span>有效分辨率</span><b>{{ fullDims }}³</b></div>
        <div class="stat"><span>体元素总量</span><b>{{ effectiveVoxels.toLocaleString() }}</b></div>
        <div class="stat"><span>瓦片规格</span><b>{{ activePreset.tileSize }}³ × {{ activePreset.levels }} 级</b></div>
        <div class="stat"><span>瓦片总数</span><b>{{ totalTiles.toLocaleString() }}</b></div>
        <div class="stat"><span>已加载瓦片</span><b>{{ stats.tilesReady.toLocaleString() }}</b></div>
        <div class="stat"><span>待处理请求</span><b>{{ stats.pending }}</b></div>
        <div class="stat"><span>建点数耗时</span><b>{{ stats.buildTime }} ms</b></div>
      </div>
    </div>

    <div v-if="picked" class="pick-panel">
      <div class="pick-title">体元素信息</div>
      <div v-if="picked.valid">
        <div class="pick-row"><span>数值</span><b>{{ picked.value.toFixed(3) }}</b></div>
        <div class="pick-row"><span>瓦片索引</span><b>{{ picked.tileIndex }}</b></div>
        <div class="pick-row"><span>样本索引</span><b>{{ picked.sampleIndex }}</b></div>
      </div>
      <div v-else class="pick-empty">该处为空体元素</div>
    </div>
  </div>
</template>

<style scoped>
.pv-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }

.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: min(272px, calc(100% - 24px)); max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; box-sizing: border-box; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.88); backdrop-filter: blur(6px); color: #dce8f5; transition: transform 0.28s ease, opacity 0.2s ease; }
.control-panel.is-collapsed { transform: translateX(calc(100% + 24px)); opacity: 0; pointer-events: none; }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.panel-toggle { flex: 0 0 auto; width: 24px; height: 20px; border: 1px solid rgba(157, 188, 224, 0.45); border-radius: 5px; background: rgba(23, 48, 88, 0.6); color: #cfe5ff; font-size: 13px; line-height: 1; cursor: pointer; transition: background 0.2s, color 0.2s; }
.panel-toggle:hover { background: rgba(47, 128, 237, 0.3); color: #fff; }
.panel-restore { position: absolute; top: 12px; right: 12px; z-index: 11; padding: 7px 12px; border: 1px solid rgba(101, 211, 235, 0.45); border-radius: 8px; background: rgba(8, 24, 48, 0.9); backdrop-filter: blur(6px); color: #9fd8ff; font-size: 11px; cursor: pointer; transition: background 0.2s, color 0.2s; }
.panel-restore:hover { background: rgba(47, 128, 237, 0.32); color: #fff; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.status { margin: 5px 0 0; font-size: 10px; line-height: 1.5; color: #9fd8ff; }
.status.ok { color: #66ff99; }
.section-title { display: flex; align-items: center; gap: 4px; margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 1 1 auto; min-width: 0; display: inline-flex; align-items: center; gap: 4px; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 62px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 0 0 84px; min-width: 0; accent-color: #2f80ed; }
.switch-button { position: relative; flex: 0 0 auto; width: 34px; height: 18px; border: 0; border-radius: 9px; background: #40506b; cursor: pointer; transition: background 0.2s; }
.switch-button.is-on { background: #2f80ed; }
.switch-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #eef4ff; transition: transform 0.2s; }
.switch-button.is-on .switch-knob { transform: translateX(16px); }
.palette-row { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.palette-button { flex: 1 1 30%; padding: 4px 0; border: 1px solid rgba(157, 188, 224, 0.35); border-radius: 5px; background: rgba(255, 255, 255, 0.06); color: #b9d2ea; font-size: 10px; cursor: pointer; }
.palette-button:hover { border-color: #5eacf5; color: #fff; }
.palette-button.active { border-color: #2f80ed; background: #2f80ed; color: #fff; font-weight: 600; }
.mini-buttons { display: flex; gap: 4px; }
.mini-button { width: 30px; height: 20px; border: 1px solid rgba(157, 188, 224, 0.35); border-radius: 5px; background: rgba(255, 255, 255, 0.06); color: #b9d2ea; font-size: 10px; cursor: pointer; }
.mini-button.active { border-color: #2f80ed; background: #2f80ed; color: #fff; font-weight: 600; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.action-button { flex: 1 1 calc(50% - 3px); height: 26px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.action-button:hover { background: #3f8ef5; }

.left-stack { position: absolute; top: 12px; left: 12px; bottom: 12px; z-index: 10; width: min(224px, calc(100% - 24px)); display: flex; flex-direction: column; gap: 10px; overflow-x: hidden; overflow-y: auto; pointer-events: none; scrollbar-width: thin; }
.left-stack > * { pointer-events: auto; }
.clip-panel { position: relative; flex: 0 0 auto; width: 100%; padding: 10px; box-sizing: border-box; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.88); backdrop-filter: blur(6px); color: #dce8f5; }
.clip-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 7px; color: #65d3eb; }
.clip-image-wrap { position: relative; width: 160px; height: 160px; box-sizing: border-box; border-radius: 6px; border: 1px solid rgba(157, 188, 224, 0.35); overflow: hidden; background-color: #0b1f3a; background-image: linear-gradient(45deg, rgba(255, 255, 255, 0.07) 25%, transparent 25%), linear-gradient(-45deg, rgba(255, 255, 255, 0.07) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.07) 75%), linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.07) 75%); background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0; }
.clip-canvas { display: block; width: 100%; height: 100%; }
.clip-canvas.hidden { display: none; }
.clip-empty { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #7f96b3; font-size: 11px; }
.clip-meta { margin-top: 8px; }
.clip-meta-row { display: flex; justify-content: space-between; align-items: center; margin-top: 3px; font-size: 10px; }
.clip-meta-row span { color: #9fb8d4; }
.clip-meta-row b { color: #dce8f5; font-weight: 700; font-variant-numeric: tabular-nums; }
.clip-download { width: 100%; height: 24px; margin-top: 8px; border: 1px solid rgba(47, 128, 237, 0.7); border-radius: 5px; background: rgba(47, 128, 237, 0.18); color: #9fd8ff; font-size: 11px; cursor: pointer; }
.clip-download:hover:not(:disabled) { background: rgba(47, 128, 237, 0.32); color: #eaf6ff; }
.clip-download:disabled { opacity: 0.45; cursor: not-allowed; }

.legend-panel { position: relative; flex: 1 1 auto; min-height: 160px; overflow-y: auto; width: 100%; padding: 10px 12px; box-sizing: border-box; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.88); backdrop-filter: blur(6px); color: #dce8f5; }
.legend-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 6px; color: #65d3eb; }
.legend-bar { height: 10px; border-radius: 3px; border: 1px solid rgba(255, 255, 255, 0.25); }
.legend-caption { display: flex; justify-content: space-between; margin: 3px 0 6px; font-size: 10px; color: #9fc8e8; }
.stat { display: flex; justify-content: space-between; align-items: center; margin-top: 3px; font-size: 11px; }
.stat span { color: #c3d5e8; }
.stat b { color: #65d3eb; font-weight: 700; font-variant-numeric: tabular-nums; }

.pick-panel { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); z-index: 10; min-width: 210px; padding: 9px 13px; box-sizing: border-box; border: 1px solid rgba(101, 211, 235, 0.4); border-radius: 8px; background: rgba(8, 24, 48, 0.9); backdrop-filter: blur(6px); font-size: 11px; color: #dce8f5; }
.pick-title { font-size: 12px; font-weight: 700; color: #65d3eb; letter-spacing: 0.04em; margin-bottom: 4px; }
.pick-row { display: flex; justify-content: space-between; align-items: center; margin-top: 5px; }
.pick-row span { color: #c3d5e8; }
.pick-row b { color: #ffffff; font-variant-numeric: tabular-nums; }
.pick-empty { color: #9fc8e8; line-height: 1.5; }

@media (max-width: 560px) {
  .control-panel { left: 12px; right: 12px; width: auto; max-height: 70%; }
  .pick-panel { bottom: auto; top: 50%; transform: translate(-50%, -50%); min-width: 0; max-width: calc(100% - 24px); }
}
</style>
