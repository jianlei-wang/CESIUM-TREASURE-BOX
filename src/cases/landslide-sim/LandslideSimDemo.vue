<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as Cesium from 'cesium'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  HeightReference,
  Math as CesiumMath,
  PolygonHierarchy,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  sampleTerrainMostDetailed,
  type Entity,
  type TerrainProvider,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, loadWorldTerrain, type SceneCallbacks } from '../../lib/cesium-scene'
import { makeGrid, SweSolver, type LonLat, type SweGrid } from './swe-solver'
import { extractImpact, impactToGeoJSON, impactToKml, initHeightFromPolygon, type ImpactResult } from './impact'
import { pickPosition } from '../measure-lib/pick'

type RegionBounds = { west: number; east: number; south: number; north: number }
const EXAMPLE_BOUNDS: RegionBounds = { west: 103.838, east: 103.846, south: 31.672, north: 31.68 }
let WEST = EXAMPLE_BOUNDS.west
let EAST = EXAMPLE_BOUNDS.east
let SOUTH = EXAMPLE_BOUNDS.south
let NORTH = EXAMPLE_BOUNDS.north
type SourcePolicy = 'default' | 'keep' | 'clear'
const RESOLUTION_OPTIONS = [40, 60, 80, 120, 160]
const MIN_DIM = 24
const MAX_DIM = 160
const MIN_SPACING = 10
let NX = 80
let NY = 80
let LX = NX + 1
let LY = NY + 1

const DEFAULT_SOURCE: LonLat[] = [
  { lon: 103.8413, lat: 31.6791 },
  { lon: 103.8429, lat: 31.6792 },
  { lon: 103.8431, lat: 31.6778 },
  { lon: 103.8411, lat: 31.6777 }
]

const ROUTE_OVERVIEW = {
  title: '滑坡动态模拟 · 数值模型工作台',
  intro:
    '框选真实地形区域后，可按行列数或间距设定采样精度，再离散成求解网格并采样成带明暗的 3D 山体；在坡顶源区给定滑体方量后，用深度积分浅水波方程（SWE）+ Voellmy 摩擦推进，滑体像粘性流体一样顺坡面流动、铺展并最终停积，全程用彩色流体层实时表达厚度与速度。',
  layers: [
    {
      key: '1',
      title: '第 1 层 · 地形与网格',
      text: '默认加载示例区域的 Cesium World Terrain 真实高程。也可按水文分析升级版的方式框选任意矩形，完成后自动清除旧采样区与源区并重新采样。采样精度支持按行列数或按间距，网格随精度变化；高程点构成山体曲面，按高程着色并叠加光照明暗。'
    },
    {
      key: '2',
      title: '第 2 层 · 源区与初值',
      text: '红色为源区多边形。点击“绘制源区”可重新圈定，源区方量控制滑体总量，初始厚度按坡度分布，摩擦角 δ 与 Voellmy ξ 控制底摩阻与湍流阻力。'
    },
    {
      key: '3',
      title: '第 3 层 · 流体推进',
      text: '求解器在每个格点更新厚度 h 与动量 hu/hv，采用 Rusanov 通量 + 静水重构，坡面压力与重力由真实 DEM 床面驱动。播放时彩色流体层逐帧重建，厚度或速度颜色实时变化，直观看到“起动-加速-铺展-停积”全过程。'
    },
    {
      key: '4',
      title: '第 4 层 · 成果',
      text: '运动稳定后自动提取影响范围（橙色），给出面积、运动距离与 H/L（Fahrboschung），支持 GeoJSON / KML 导出。'
    }
  ]
}

const container = ref<HTMLElement | null>(null)
const infoOpen = ref(false)
const statusMessage = ref('正在构建地形…')
const busy = ref(false)
const progress = ref(0)
const terrainNote = ref('正在加载 Cesium World Terrain…')
const regionBounds = ref<RegionBounds>({ ...EXAMPLE_BOUNDS })
const isLoaded = ref(false)
const samplingMode = ref<'dim' | 'spacing'>('dim')
const resolutionDim = ref(80)
const spacingMeters = ref(20)
const usedSamplingNote = ref('')

const playing = ref(false)
const drawing = ref(false)
const drawTarget = ref<'source' | 'region'>('source')
const colorMode = ref<'thickness' | 'velocity'>('thickness')
const frictionAngle = ref(9)
const voellmyXi = ref(600)
const volumeInput = ref(2.2e5)
const playbackSpeed = ref(1)
const threshold = ref(0.1)

const simTime = ref('0.0 s')
const volumeText = ref('-')
const conserveText = ref('-')
const maxHText = ref('-')
const maxVText = ref('-')
const impactText = ref('尚未提取')
const drawHint = ref('')
const frameCount = ref(0)
const timelineIndex = ref(0)
const timelinePreview = ref(false)
const timelineLabel = computed(() => {
  const s = frameSnapshots[timelineIndex.value]
  if (!frameCount.value || !s) return '暂无过程记录'
  return `${s.t.toFixed(1)} s · 第 ${timelineIndex.value + 1}/${frameCount.value} 帧`
})
const legendCss = computed(() =>
  colorMode.value === 'velocity'
    ? 'linear-gradient(90deg, #4666c8, #54d2b0, #f2d63c, #e2543c)'
    : 'linear-gradient(90deg, #f0dca0, #e8a05a, #c25430, #6a1f14)'
)
const regionLabel = computed(() => {
  const bounds = regionBounds.value
  if (!bounds) return '未选择'
  return `${bounds.west.toFixed(4)} ~ ${bounds.east.toFixed(4)}°E`
})
const drawingRect = computed(() => drawing.value && drawTarget.value === 'region')

let viewer: Viewer | undefined
let imageryLayer: Cesium.ImageryLayer | undefined
let worldTerrain: TerrainProvider | undefined
let solver: SweSolver | undefined
let grid: SweGrid | undefined
let sourceRing: LonLat[] = DEFAULT_SOURCE.map((p) => ({ ...p }))
let draftRing: LonLat[] = []
let initialVolume = 0
let terrainPrimitive: Cesium.Primitive | undefined
let flowPrimitive: Cesium.Primitive | undefined
let flowRefreshAcc = 0
let sourceEntity: Entity | undefined
let impactEntity: Entity | undefined
let draftEntity: Entity | undefined
let regionEntity: Entity | undefined
let regionDraftEntity: Entity | undefined
let regionCornerA: LonLat | undefined
let handler: ScreenSpaceEventHandler | undefined
let lastTs = 0
let disposed = false
let impactCache: ImpactResult | undefined
let ground = new Float32Array(LX * LY)
let analysisRun = 0
let samplingTimer: ReturnType<typeof setTimeout> | undefined

type FrameSnapshot = {
  t: number
  h: Float32Array
  hu: Float32Array
  hv: Float32Array
  maxH: number
  maxV: number
  volume: number
}
let frameSnapshots: FrameSnapshot[] = []
let recordInterval = 0.08
let lastRecordT = -1
const RECORD_LIMIT = 600
type FlowField = { h: Float32Array; hu: Float32Array; hv: Float32Array; maxH: number; maxV: number }

const appearanceVertex = `
  in vec3 position3DHigh;
  in vec3 position3DLow;
  in float batchId;
  in vec4 color;
  out vec4 v_color;
  void main()
  {
    vec4 position = czm_translateRelativeToEye(position3DHigh, position3DLow);
    v_color = color;
    gl_Position = czm_modelViewProjectionRelativeToEye * position;
  }
`
const appearanceFragment = `
  in vec4 v_color;
  void main()
  {
    out_FragColor = v_color;
  }
`

function opaqueAppearance(): Cesium.Appearance {
  return new Cesium.Appearance({
    translucent: false,
    closed: false,
    renderState: {
      depthTest: { enabled: true },
      cull: { enabled: false },
      blending: Cesium.BlendingState.DISABLED
    },
    vertexShaderSource: appearanceVertex,
    fragmentShaderSource: appearanceFragment
  })
}

function translucentAppearance(): Cesium.Appearance {
  return new Cesium.Appearance({
    translucent: true,
    closed: false,
    renderState: {
      depthTest: { enabled: true },
      cull: { enabled: false },
      blending: Cesium.BlendingState.ALPHA_BLEND
    },
    vertexShaderSource: appearanceVertex,
    fragmentShaderSource: appearanceFragment
  })
}

function groundAtLonLat(lon: number, lat: number): number {
  const u = Math.min(1, Math.max(0, (lon - WEST) / (EAST - WEST)))
  const v = Math.min(1, Math.max(0, (lat - SOUTH) / (NORTH - SOUTH)))
  const px = u * NX
  const py = v * NY
  const i0 = Math.min(NX - 1, Math.max(0, Math.floor(px)))
  const j0 = Math.min(NY - 1, Math.max(0, Math.floor(py)))
  const i1 = Math.min(NX, i0 + 1)
  const j1 = Math.min(NY, j0 + 1)
  const fx = px - i0
  const fy = py - j0
  const g00 = ground[j0 * LX + i0]
  const g10 = ground[j0 * LX + i1]
  const g01 = ground[j1 * LX + i0]
  const g11 = ground[j1 * LX + i1]
  return g00 * (1 - fx) * (1 - fy) + g10 * fx * (1 - fy) + g01 * (1 - fx) * fy + g11 * fx * fy
}

function terrainColor(z: number, zMin: number, zMax: number, shade: number): number[] {
  const t = zMax > zMin ? Math.min(1, Math.max(0, (z - zMin) / (zMax - zMin))) : 0.5
  let r: number
  let g: number
  let b: number
  if (t < 0.45) {
    const s = t / 0.45
    r = 96 + (168 - 96) * s
    g = 138 + (140 - 138) * s
    b = 82 + (86 - 82) * s
  } else if (t < 0.75) {
    const s = (t - 0.45) / 0.3
    r = 168 + (178 - 168) * s
    g = 140 + (142 - 140) * s
    b = 86 + (90 - 86) * s
  } else {
    const s = (t - 0.75) / 0.25
    r = 178 + (232 - 178) * s
    g = 142 + (224 - 142) * s
    b = 90 + (216 - 90) * s
  }
  return [Math.round(r * shade), Math.round(g * shade), Math.round(b * shade)]
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

function shadeAt(i: number, j: number): number {
  const il = Math.max(0, i - 1)
  const ir = Math.min(LX - 1, i + 1)
  const jd = Math.max(0, j - 1)
  const ju = Math.min(LY - 1, j + 1)
  const dlon = ground[j * LX + ir] - ground[j * LX + il]
  const dlat = ground[ju * LX + i] - ground[jd * LX + i]
  const nx = -dlon
  const ny = -dlat
  const nz = 1
  const len = Math.hypot(nx, ny, nz) || 1
  const lx = 0.45
  const ly = 0.55
  const lz = 0.7
  const dot = Math.max(0, (nx * lx + ny * ly + nz * lz) / len)
  return 0.5 + 0.5 * dot
}

function rebuildTerrainPrimitive(): void {
  if (!viewer || viewer.isDestroyed()) return
  const vertexCount = LX * LY
  const positions = new Float64Array(vertexCount * 3)
  const colors = new Uint8Array(vertexCount * 4)
  let zMin = Number.POSITIVE_INFINITY
  let zMax = Number.NEGATIVE_INFINITY
  for (let j = 0; j < LY; j += 1) {
    for (let i = 0; i < LX; i += 1) {
      const z = ground[j * LX + i]
      if (z < zMin) zMin = z
      if (z > zMax) zMax = z
    }
  }
  let po = 0
  let co = 0
  for (let j = 0; j < LY; j += 1) {
    const lat = SOUTH + (j / NY) * (NORTH - SOUTH)
    for (let i = 0; i < LX; i += 1) {
      const lon = WEST + (i / NX) * (EAST - WEST)
      const z = ground[j * LX + i]
      const p = Cartesian3.fromDegrees(lon, lat, z)
      positions[po] = p.x
      positions[po + 1] = p.y
      positions[po + 2] = p.z
      const [r, g, b] = terrainColor(z, zMin, zMax, shadeAt(i, j))
      colors[co] = r
      colors[co + 1] = g
      colors[co + 2] = b
      colors[co + 3] = 255
      po += 3
      co += 4
    }
  }
  const indices: number[] = []
  for (let j = 0; j < LY - 1; j += 1) {
    for (let i = 0; i < LX - 1; i += 1) {
      const tl = j * LX + i
      const tr = tl + 1
      const bl = (j + 1) * LX + i
      const br = bl + 1
      indices.push(tl, bl, br)
      indices.push(tl, br, tr)
    }
  }
  const attributes = new Cesium.GeometryAttributes()
  attributes.position = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positions
  })
  attributes.color = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
    componentsPerAttribute: 4,
    normalize: true,
    values: colors
  })
  const boundingSphere = Cesium.BoundingSphere.fromVertices(positions)
  if (!Number.isFinite(boundingSphere.radius) || boundingSphere.radius <= 0) boundingSphere.radius = 1
  const geometry = new Cesium.Geometry({
    attributes,
    indices: meshIndices(indices),
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere
  })
  const next = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({ geometry }),
    appearance: opaqueAppearance(),
    asynchronous: false,
    allowPicking: false
  })
  if (terrainPrimitive) {
    viewer.scene.primitives.remove(terrainPrimitive)
    terrainPrimitive = undefined
  }
  terrainPrimitive = viewer.scene.primitives.add(next)
}

function sampleCellValue(arr: Float32Array, px: number, py: number): number {
  const fx = px - 0.5
  const fy = py - 0.5
  const i0 = Math.min(NX - 1, Math.max(0, Math.floor(fx)))
  const j0 = Math.min(NY - 1, Math.max(0, Math.floor(fy)))
  const i1 = Math.min(NX - 1, i0 + 1)
  const j1 = Math.min(NY - 1, j0 + 1)
  const wx = fx - i0
  const wy = fy - j0
  return (
    arr[j0 * NX + i0] * (1 - wx) * (1 - wy) +
    arr[j0 * NX + i1] * wx * (1 - wy) +
    arr[j1 * NX + i0] * (1 - wx) * wy +
    arr[j1 * NX + i1] * wx * wy
  )
}

function flowColor(h: number, v: number, maxH: number, maxV: number): number[] {
  const th = Math.min(1, h / Math.max(maxH, 0.2))
  const vn = Math.min(1, v / Math.max(maxV, 0.5))
  const x = colorMode.value === 'velocity' ? vn : th
  let r: number
  let g: number
  let b: number
  if (colorMode.value === 'velocity') {
    if (x < 0.33) {
      const s = x / 0.33
      r = 70 + (80 - 70) * s
      g = 102 + (210 - 102) * s
      b = 200 + (176 - 200) * s
    } else if (x < 0.66) {
      const s = (x - 0.33) / 0.33
      r = 80 + (242 - 80) * s
      g = 210 + (214 - 210) * s
      b = 176 + (60 - 176) * s
    } else {
      const s = (x - 0.66) / 0.34
      r = 242 + (226 - 242) * s
      g = 214 + (84 - 214) * s
      b = 60 + (60 - 60) * s
    }
  } else {
    if (x < 0.5) {
      const s = x / 0.5
      r = 240 + (232 - 240) * s
      g = 220 + (160 - 220) * s
      b = 160 + (90 - 160) * s
    } else {
      const s = (x - 0.5) / 0.5
      r = 232 + (106 - 232) * s
      g = 160 + (31 - 160) * s
      b = 90 + (20 - 90) * s
    }
  }
  const alpha = 80 + 175 * Math.min(1, h / 0.8)
  return [r, g, b, alpha]
}

function rebuildFlowPrimitive(field?: FlowField): void {
  if (!viewer || viewer.isDestroyed() || !solver) return
  const vertexCount = LX * LY
  const positions = new Float64Array(vertexCount * 3)
  const colors = new Uint8Array(vertexCount * 4)
  const maxH = Math.max(field?.maxH ?? solver.maxThickness, 0.2)
  const maxV = Math.max(field?.maxV ?? solver.maxSpeed, 0.5)
  const hArr = field?.h ?? solver.h
  const huArr = field?.hu ?? solver.hu
  const hvArr = field?.hv ?? solver.hv
  let po = 0
  let co = 0
  for (let j = 0; j < LY; j += 1) {
    const lat = SOUTH + (j / NY) * (NORTH - SOUTH)
    for (let i = 0; i < LX; i += 1) {
      const lon = WEST + (i / NX) * (EAST - WEST)
      const gzRaw = ground[j * LX + i]
      const gz = Number.isFinite(gzRaw) ? gzRaw : 0
      const hcRaw = sampleCellValue(hArr, i, j)
      const hc = Number.isFinite(hcRaw) && hcRaw > 0 ? hcRaw : 0
      const huRaw = sampleCellValue(huArr, i, j)
      const hvRaw = sampleCellValue(hvArr, i, j)
      const hu = Number.isFinite(huRaw) ? huRaw : 0
      const hv = Number.isFinite(hvRaw) ? hvRaw : 0
      const vel = hc > 0.01 ? Math.hypot(hu, hv) / hc : 0
      const p = Cartesian3.fromDegrees(lon, lat, gz + Math.max(0.02, hc))
      positions[po] = p.x
      positions[po + 1] = p.y
      positions[po + 2] = p.z
      const [r, g, b, a] = hc <= 0.005 ? [0, 0, 0, 0] : flowColor(hc, vel, maxH, maxV)
      colors[co] = clampByte(r)
      colors[co + 1] = clampByte(g)
      colors[co + 2] = clampByte(b)
      colors[co + 3] = a
      po += 3
      co += 4
    }
  }
  const indices: number[] = []
  for (let j = 0; j < LY - 1; j += 1) {
    for (let i = 0; i < LX - 1; i += 1) {
      const tl = j * LX + i
      const tr = tl + 1
      const bl = (j + 1) * LX + i
      const br = bl + 1
      indices.push(tl, bl, br)
      indices.push(tl, br, tr)
    }
  }
  const attributes = new Cesium.GeometryAttributes()
  attributes.position = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positions
  })
  attributes.color = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
    componentsPerAttribute: 4,
    normalize: true,
    values: colors
  })
  const boundingSphere = Cesium.BoundingSphere.fromVertices(positions)
  if (!Number.isFinite(boundingSphere.radius) || boundingSphere.radius <= 0) boundingSphere.radius = 1
  const geometry = new Cesium.Geometry({
    attributes,
    indices: meshIndices(indices),
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere
  })
  const next = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({ geometry }),
    appearance: translucentAppearance(),
    asynchronous: false,
    allowPicking: false
  })
  if (flowPrimitive) {
    viewer.scene.primitives.remove(flowPrimitive)
    flowPrimitive = undefined
  }
  flowPrimitive = viewer.scene.primitives.add(next)
  viewer.scene.requestRender()
}

function formatVolume(m3: number): string {
  if (m3 >= 1e4) return `${(m3 / 1e4).toFixed(2)} 万 m³`
  return `${m3.toFixed(0)} m³`
}

function setStatus(message: string): void {
  statusMessage.value = message
}

function toast(message: string): void {
  setStatus(message)
  window.setTimeout(() => {
    if (statusMessage.value === message) statusMessage.value = ''
  }, 3600)
}

function lonLatToLiftedRing(ring: LonLat[], lift = 0.5): Cartesian3[] {
  return ring.map((p) => Cartesian3.fromDegrees(p.lon, p.lat, groundAtLonLat(p.lon, p.lat) + lift))
}

function setSourceHierarchy(): void {
  if (!viewer) return
  if (sourceEntity) {
    viewer.entities.remove(sourceEntity)
    sourceEntity = undefined
  }
  if (sourceRing.length < 3) return
  sourceEntity = viewer.entities.add({
    polygon: {
      hierarchy: new PolygonHierarchy(lonLatToLiftedRing(sourceRing)),
      material: Color.fromCssColorString('#ef5350').withAlpha(0.42),
      outline: true,
      outlineColor: Color.fromCssColorString('#ffcdd2'),
      perPositionHeight: true
    }
  })
}

function setImpactHierarchy(ring: LonLat[] | null): void {
  if (!viewer) return
  if (impactEntity) {
    viewer.entities.remove(impactEntity)
    impactEntity = undefined
  }
  if (!ring || ring.length < 3) return
  impactEntity = viewer.entities.add({
    polygon: {
      hierarchy: new PolygonHierarchy(lonLatToLiftedRing(ring)),
      material: Color.fromCssColorString('#ffb300').withAlpha(0.4),
      outline: true,
      outlineColor: Color.fromCssColorString('#ffe082'),
      perPositionHeight: true
    }
  })
}

function setDraftHierarchy(): void {
  if (!viewer) return
  if (draftEntity) viewer.entities.remove(draftEntity)
  if (draftRing.length < 2) return
  draftEntity = viewer.entities.add({
    polyline: {
      positions: lonLatToLiftedRing(draftRing.concat(draftRing[0])),
      width: 3,
      material: Color.fromCssColorString('#fff59d'),
      clampToGround: false
    }
  })
}

function regionRingFromCorners(a: LonLat, b: LonLat): LonLat[] {
  const west = Math.min(a.lon, b.lon)
  const east = Math.max(a.lon, b.lon)
  const south = Math.min(a.lat, b.lat)
  const north = Math.max(a.lat, b.lat)
  return [
    { lon: west, lat: south },
    { lon: east, lat: south },
    { lon: east, lat: north },
    { lon: west, lat: north }
  ]
}

function boundsFromCorners(a: LonLat, b: LonLat): RegionBounds {
  return {
    west: Math.min(a.lon, b.lon),
    east: Math.max(a.lon, b.lon),
    south: Math.min(a.lat, b.lat),
    north: Math.max(a.lat, b.lat)
  }
}

function regionRingFromBounds(bounds: RegionBounds): LonLat[] {
  return [
    { lon: bounds.west, lat: bounds.south },
    { lon: bounds.east, lat: bounds.south },
    { lon: bounds.east, lat: bounds.north },
    { lon: bounds.west, lat: bounds.north }
  ]
}

function regionCartesians(ring: LonLat[]): Cartesian3[] {
  return ring.map((p) => Cartesian3.fromDegrees(p.lon, p.lat))
}

function removeRegionDraft(): void {
  if (regionDraftEntity && viewer && !viewer.isDestroyed()) viewer.entities.remove(regionDraftEntity)
  regionDraftEntity = undefined
}

function updateRegionDraft(ring: LonLat[]): void {
  if (!viewer || viewer.isDestroyed()) return
  removeRegionDraft()
  regionDraftEntity = viewer.entities.add({
    polygon: {
      hierarchy: new PolygonHierarchy(regionCartesians(ring)),
      material: Color.fromCssColorString('#ffcf5c').withAlpha(0.14),
      outline: true,
      outlineColor: Color.fromCssColorString('#ffcf5c'),
      height: 0,
      heightReference: HeightReference.CLAMP_TO_GROUND
    }
  })
  viewer.scene.requestRender()
}

function setRegionHierarchy(ring: LonLat[]): void {
  if (!viewer || viewer.isDestroyed()) return
  if (regionEntity) viewer.entities.remove(regionEntity)
  regionEntity = viewer.entities.add({
    polygon: {
      hierarchy: new PolygonHierarchy(lonLatToLiftedRing(ring, 1.0)),
      material: Color.fromCssColorString('#ffcf5c').withAlpha(0.08),
      outline: true,
      outlineColor: Color.fromCssColorString('#ffcf5c').withAlpha(0.9),
      perPositionHeight: true
    }
  })
  viewer.scene.requestRender()
}

function removeRegionEntity(): void {
  if (regionEntity && viewer && !viewer.isDestroyed()) viewer.entities.remove(regionEntity)
  regionEntity = undefined
}

function rebuildStaticOverlays(): void {
  setSourceHierarchy()
  if (impactCache) setImpactHierarchy(impactCache.ring)
  setDraftHierarchy()
}

function refreshStats(): void {
  if (!solver) return
  const current = solver.volume()
  simTime.value = `${solver.time.toFixed(1)} s`
  volumeText.value = formatVolume(current)
  const ratio = initialVolume > 0 ? current / initialVolume : 1
  conserveText.value = `${(ratio * 100).toFixed(1)}%`
  maxHText.value = `${solver.maxThickness.toFixed(2)} m`
  maxVText.value = `${solver.maxSpeed.toFixed(2)} m/s`
}

function clearSnapshots(): void {
  frameSnapshots = []
  lastRecordT = -1
  frameCount.value = 0
  timelineIndex.value = 0
  timelinePreview.value = false
}

function decimateSnapshots(): void {
  const kept: FrameSnapshot[] = []
  for (let i = 0; i < frameSnapshots.length; i += 2) kept.push(frameSnapshots[i])
  const last = frameSnapshots[frameSnapshots.length - 1]
  if (kept.length && kept[kept.length - 1] !== last) kept.push(last)
  frameSnapshots = kept
  recordInterval *= 2
  frameCount.value = frameSnapshots.length
  timelineIndex.value = Math.min(timelineIndex.value, frameSnapshots.length - 1)
}

function recordFrame(): void {
  if (!solver) return
  frameSnapshots.push({
    t: solver.time,
    h: solver.h.slice(),
    hu: solver.hu.slice(),
    hv: solver.hv.slice(),
    maxH: solver.maxThickness,
    maxV: solver.maxSpeed,
    volume: solver.volume()
  })
  if (frameSnapshots.length > RECORD_LIMIT) decimateSnapshots()
  frameCount.value = frameSnapshots.length
}

function previewSnapshot(index: number): void {
  const s = frameSnapshots[index]
  if (!s) return
  timelinePreview.value = true
  rebuildFlowPrimitive({ h: s.h, hu: s.hu, hv: s.hv, maxH: s.maxH, maxV: s.maxV })
  simTime.value = `${s.t.toFixed(1)} s`
  volumeText.value = formatVolume(s.volume)
  const ratio = initialVolume > 0 ? s.volume / initialVolume : 1
  conserveText.value = `${(ratio * 100).toFixed(1)}%`
  maxHText.value = `${s.maxH.toFixed(2)} m`
  maxVText.value = `${s.maxV.toFixed(2)} m/s`
}

function seekTimeline(): void {
  if (!frameCount.value) return
  playing.value = false
  previewSnapshot(timelineIndex.value)
}

function onTimelineInput(event: Event): void {
  timelineIndex.value = Number((event.target as HTMLInputElement).value)
  seekTimeline()
}

function exitTimelinePreview(): void {
  if (!timelinePreview.value) return
  timelinePreview.value = false
  timelineIndex.value = Math.max(0, frameSnapshots.length - 1)
  rebuildFlowPrimitive()
  refreshStats()
}

function exportSeries(): void {
  if (!frameSnapshots.length) {
    toast('暂无过程数据，请先播放模拟')
    return
  }
  const cellArea = (grid?.dx ?? 0) * (grid?.dy ?? 0)
  const lines = ['time_s,volume_m3,max_thickness_m,max_speed_m_s,affected_area_m2']
  for (const s of frameSnapshots) {
    let wet = 0
    for (let k = 0; k < s.h.length; k += 1) if (s.h[k] > threshold.value) wet += 1
    lines.push([s.t.toFixed(2), s.volume.toFixed(1), s.maxH.toFixed(3), s.maxV.toFixed(3), (wet * cellArea).toFixed(1)].join(','))
  }
  downloadText('landslide-process-series.csv', lines.join('\n'), 'text/csv')
  toast(`已导出 ${frameSnapshots.length} 帧过程数据`)
}

function applySourceToSolver(): void {
  if (!solver) return
  solver.frictionAngleDeg = frictionAngle.value
  solver.voellmyXi = voellmyXi.value
  const h0 = initHeightFromPolygon(solver.grid, solver.zb, sourceRing, volumeInput.value)
  solver.setInitialHeight(h0)
  initialVolume = solver.volume()
  impactCache = undefined
  setImpactHierarchy(null)
  impactText.value = '尚未提取'
  rebuildFlowPrimitive()
  refreshStats()
  clearSnapshots()
  lastRecordT = solver.time
  recordFrame()
}

function tick(): void {
  if (disposed || !solver || !playing.value) return
  const now = performance.now()
  const dt = Math.min(0.08, (now - lastTs) / 1000) * playbackSpeed.value
  lastTs = now
  solver.frictionAngleDeg = frictionAngle.value
  solver.voellmyXi = voellmyXi.value
  solver.advance(dt * 4, 6)
  refreshStats()
  if (solver.time - lastRecordT >= recordInterval) {
    lastRecordT = solver.time
    recordFrame()
    timelineIndex.value = frameSnapshots.length - 1
  }
  flowRefreshAcc += dt
  if (flowRefreshAcc > 0.06) {
    flowRefreshAcc = 0
    rebuildFlowPrimitive()
  }
  if (solver.isSettled()) {
    playing.value = false
    extractNow()
    toast('运动已趋于稳定，已提取影响范围')
  }
}

function play(): void {
  if (!solver || busy.value) return
  if (sourceRing.length < 3) {
    toast('请先绘制源区后再播放模拟')
    return
  }
  if (timelinePreview.value && !solver.isSettled()) {
    exitTimelinePreview()
  } else if (solver.isSettled() || solver.time === 0) {
    applySourceToSolver()
  }
  playing.value = true
  lastTs = performance.now()
}

function pause(): void {
  playing.value = false
  rebuildFlowPrimitive()
}

function resetSim(): void {
  playing.value = false
  applySourceToSolver()
  toast('已重置到源区初始条件')
}

function extractNow(): void {
  if (!solver) return
  try {
    if (solver.maxThickness <= threshold.value) {
      toast('当前无超过阈值的堆积，请先播放模拟或降低影响阈值')
      return
    }
    const result = extractImpact(solver, sourceRing, threshold.value)
    impactCache = result
    setImpactHierarchy(result.ring)
    impactText.value = `${(result.areaM2 / 1e4).toFixed(2)} 万 m² · L ${result.travelDistance.toFixed(0)} m · H/L ${result.fahrboschungAngle.toFixed(1)}°`
    viewer?.scene.requestRender()
  } catch (error) {
    toast(`提取影响范围失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportGeoJSON(): void {
  if (!solver) return
  const result = impactCache ?? extractImpact(solver, sourceRing, threshold.value)
  impactCache = result
  setImpactHierarchy(result.ring)
  downloadText(
    'landslide-impact.geojson',
    impactToGeoJSON(sourceRing, result, { simulate_time_s: Number(solver.time.toFixed(2)) }),
    'application/geo+json'
  )
}

function exportKml(): void {
  if (!solver) return
  const result = impactCache ?? extractImpact(solver, sourceRing, threshold.value)
  impactCache = result
  setImpactHierarchy(result.ring)
  downloadText('landslide-impact.kml', impactToKml(sourceRing, result), 'application/vnd.google-earth.kml+xml')
}

function clearPreviousSamplingAndSource(): void {
  playing.value = false
  removeRegionEntity()
  removeRegionDraft()
  if (sourceEntity && viewer && !viewer.isDestroyed()) viewer.entities.remove(sourceEntity)
  sourceEntity = undefined
  sourceRing = []
  impactCache = undefined
  setImpactHierarchy(null)
  impactText.value = '尚未提取'
  if (flowPrimitive && viewer && !viewer.isDestroyed()) {
    viewer.scene.primitives.remove(flowPrimitive)
    flowPrimitive = undefined
  }
  if (terrainPrimitive && viewer && !viewer.isDestroyed()) {
    viewer.scene.primitives.remove(terrainPrimitive)
    terrainPrimitive = undefined
  }
  solver = undefined
  clearSnapshots()
  if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender()
}

function startRectDraw(): void {
  if (!isLoaded.value || busy.value || !viewer) return
  drawing.value = true
  drawTarget.value = 'region'
  draftRing = []
  setDraftHierarchy()
  regionCornerA = undefined
  drawHint.value = '在地图上单击确定矩形区域一角，移动鼠标后再次单击完成框选'
  setStatus(drawHint.value)
}

function startDrawSource(): void {
  if (busy.value || !solver) return
  playing.value = false
  drawing.value = true
  drawTarget.value = 'source'
  draftRing = []
  setDraftHierarchy()
  drawHint.value = '单击加点，右键或点完成结束'
}

function finishDraw(): void {
  if (drawTarget.value === 'region') {
    drawing.value = false
    regionCornerA = undefined
    removeRegionDraft()
    drawHint.value = ''
    return
  }
  const ring = draftRing.map((p) => ({ ...p }))
  drawing.value = false
  draftRing = []
  setDraftHierarchy()
  drawHint.value = ''
  if (ring.length < 3) return
  sourceRing = ring
  setSourceHierarchy()
  applySourceToSolver()
  toast(`源区已更新，共 ${sourceRing.length} 个顶点`)
}

function pickLonLat(position: Cartesian2): LonLat | null {
  if (!viewer || viewer.isDestroyed()) return null
  const cartesian = pickPosition(viewer.scene, position)
  if (!cartesian) return null
  const c = Cartographic.fromCartesian(cartesian, viewer.scene.globe.ellipsoid)
  return { lon: CesiumMath.toDegrees(c.longitude), lat: CesiumMath.toDegrees(c.latitude) }
}

function regionIsValid(bounds: RegionBounds): boolean {
  return bounds.east - bounds.west >= 0.004 && bounds.north - bounds.south >= 0.004
}

function clampDim(value: number): number {
  return Math.max(MIN_DIM, Math.min(MAX_DIM, Math.round(value)))
}

function gridDimsForSampling(bounds: RegionBounds): { nx: number; ny: number } {
  const midLat = ((bounds.south + bounds.north) / 2) * Math.PI / 180
  const lonSpanM = Math.max(1e-6, bounds.east - bounds.west) * 111320 * Math.cos(midLat)
  const latSpanM = Math.max(1e-6, bounds.north - bounds.south) * 111320
  if (samplingMode.value === 'spacing') {
    const spacing = Math.max(MIN_SPACING, Number(spacingMeters.value) || MIN_SPACING)
    return {
      nx: clampDim(lonSpanM / spacing),
      ny: clampDim(latSpanM / spacing)
    }
  }
  const nx = clampDim(resolutionDim.value)
  return { nx, ny: clampDim((latSpanM * nx) / lonSpanM) }
}

function samplingNoteText(): string {
  const cellM = grid ? Math.max(1, Math.round((grid.dx + grid.dy) / 2)) : 0
  if (samplingMode.value === 'spacing') {
    const spacing = Math.max(MIN_SPACING, Number(spacingMeters.value) || MIN_SPACING)
    return `间距 ${spacing} m → ${NX}×${NY}，约 ${cellM} m/格`
  }
  return `列数 ${resolutionDim.value} → ${NX}×${NY}，约 ${cellM} m/格`
}

function meshIndices(indices: number[]): Uint16Array | Uint32Array {
  return LX * LY > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)
}

function applyBounds(bounds: RegionBounds): void {
  WEST = bounds.west
  EAST = bounds.east
  SOUTH = bounds.south
  NORTH = bounds.north
  const dims = gridDimsForSampling(bounds)
  NX = dims.nx
  NY = dims.ny
  LX = NX + 1
  LY = NY + 1
  ground = new Float32Array(LX * LY)
  grid = makeGrid(WEST, SOUTH, EAST, NORTH, NX, NY)
  regionBounds.value = { west: WEST, east: EAST, south: SOUTH, north: NORTH }
}

function resetScene(groundArr: Float32Array, note: string): void {
  if (!viewer || viewer.isDestroyed() || !grid) return
  ground.set(groundArr)
  const zb = new Float32Array(NX * NY)
  for (let j = 0; j < NY; j += 1) {
    for (let i = 0; i < NX; i += 1) {
      const u0 = (i / NX) * (LX - 1)
      const v0 = (j / NY) * (LY - 1)
      const iL = Math.floor(u0)
      const jL = Math.floor(v0)
      const iR = Math.min(LX - 1, iL + 1)
      const jR = Math.min(LY - 1, jL + 1)
      const fu = u0 - iL
      const fv = v0 - jL
      const g00 = ground[jL * LX + iL]
      const g10 = ground[jL * LX + iR]
      const g01 = ground[jR * LX + iL]
      const g11 = ground[jR * LX + iR]
      zb[j * NX + i] = g00 * (1 - fu) * (1 - fv) + g10 * fu * (1 - fv) + g01 * (1 - fu) * fv + g11 * fu * fv
    }
  }
  playing.value = false
  solver = new SweSolver(grid, zb)
  rebuildTerrainPrimitive()
  setSourceHierarchy()
  impactCache = undefined
  setImpactHierarchy(null)
  applySourceToSolver()
  terrainNote.value = note
  viewer.scene.requestRender()
}

function flyToOverview(): void {
  if (!viewer) return
  const centerLon = (WEST + EAST) / 2
  const centerLat = (SOUTH + NORTH) / 2
  const widthMeters = Cartesian3.distance(
    Cartesian3.fromDegrees(WEST, centerLat),
    Cartesian3.fromDegrees(EAST, centerLat)
  )
  const heightMeters = Cartesian3.distance(
    Cartesian3.fromDegrees(centerLon, SOUTH),
    Cartesian3.fromDegrees(centerLon, NORTH)
  )
  const maxSpan = Math.max(widthMeters, heightMeters, 1000)
  const latPad = Math.max(NORTH - SOUTH, 0.004) * 0.75
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(centerLon, NORTH + latPad, Math.max(2100, maxSpan * 1.6)),
    orientation: {
      heading: 0,
      pitch: CesiumMath.toRadians(-42),
      roll: 0
    },
    duration: 1.4
  })
}

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function sampleTerrainHeights(groundArr: Float32Array, runId: number): Promise<boolean> {
  if (!viewer || viewer.isDestroyed()) return false
  const targets: Array<{ i: number; j: number }> = []
  for (let j = 0; j < LY; j += 1) {
    for (let i = 0; i < LX; i += 1) {
      targets.push({ i, j })
    }
  }
  if (!targets.length) return false
  const batchSize = Math.max(1, Math.min(targets.length, 6000))
  for (let start = 0; start < targets.length; start += batchSize) {
    if (disposed || runId !== analysisRun || !viewer || viewer.isDestroyed()) return false
    const end = Math.min(targets.length, start + batchSize)
    const samples: Cartographic[] = []
    for (let t = start; t < end; t += 1) {
      const { i, j } = targets[t]
      const lat = SOUTH + (j / NY) * (NORTH - SOUTH)
      const lon = WEST + (i / NX) * (EAST - WEST)
      samples.push(Cartographic.fromDegrees(lon, lat))
    }
    progress.value = Math.round((start / targets.length) * 100)
    setStatus(`正在对框选区域进行 DEM 采样与分析…${progress.value}%`)
    await yieldFrame()
    try {
      const sampled = await sampleTerrainMostDetailed(viewer.terrainProvider, samples)
      if (disposed || runId !== analysisRun || !viewer || viewer.isDestroyed()) return false
      for (let t = start; t < end; t += 1) {
        const { i, j } = targets[t]
        const height = sampled[t - start]?.height
        groundArr[j * LX + i] = Number.isFinite(height) ? (height as number) : 0
      }
    } catch {
      return false
    }
  }
  progress.value = 100
  return true
}

async function ensureWorldTerrain(): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  if (worldTerrain) {
    viewer.terrainProvider = worldTerrain
    return
  }
  worldTerrain = await loadWorldTerrain(viewer)
}

function ensureBingImagery(): void {
  if (!viewer || viewer.isDestroyed() || imageryLayer) return
  loadBingImagery(viewer, { onStatus: setStatus }, (layer) => {
    imageryLayer = layer
  })
}

async function sampleAndBuild(bounds: RegionBounds, sourcePolicy: SourcePolicy): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  const runId = ++analysisRun
  busy.value = true
  progress.value = 2
  playing.value = false
  try {
    await ensureWorldTerrain()
    if (disposed || runId !== analysisRun || !viewer || viewer.isDestroyed()) return
    ensureBingImagery()
    applyBounds(bounds)
    const arr = new Float32Array(LX * LY)
    const ok = await sampleTerrainHeights(arr, runId)
    if (!ok || runId !== analysisRun) {
      if (runId === analysisRun) toast('真实地形采样失败，请重新框选区域')
      return
    }
    if (sourcePolicy === 'default') sourceRing = DEFAULT_SOURCE.map((p) => ({ ...p }))
    else if (sourcePolicy === 'clear') sourceRing = []
    usedSamplingNote.value = samplingNoteText()
    resetScene(arr, `Cesium World Terrain 真实地形 · ${bounds.west.toFixed(4)}~${bounds.east.toFixed(4)}°E`)
    setRegionHierarchy(regionRingFromBounds(bounds))
    if (sourcePolicy !== 'keep') flyToOverview()
    toast(
      sourcePolicy === 'default'
        ? '示例区域采样完成，可播放模拟'
        : sourcePolicy === 'keep'
          ? '已按当前精度重新采样'
          : '采样分析完成，请绘制源区后播放模拟'
    )
  } catch {
    if (runId === analysisRun) toast('Cesium World Terrain 加载失败，请检查网络后重试')
  } finally {
    if (runId === analysisRun) {
      busy.value = false
      setStatus('')
    }
  }
}

function useExampleRegion(): void {
  if (!isLoaded.value || busy.value || !viewer) return
  drawing.value = false
  regionCornerA = undefined
  removeRegionDraft()
  drawHint.value = ''
  clearPreviousSamplingAndSource()
  void sampleAndBuild(EXAMPLE_BOUNDS, 'default')
}

function onColorModeChange(): void {
  if (solver) rebuildFlowPrimitive()
}

function frameCamera(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.flyTo({
    destination: Rectangle.fromDegrees(WEST, SOUTH, EAST, NORTH),
    orientation: {
      heading: 0,
      pitch: CesiumMath.toRadians(-55),
      roll: 0
    },
    duration: 0.9
  })
}

function installHandlers(): void {
  if (!viewer || viewer.isDestroyed()) return
  handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
    if (!drawing.value) return
    const p = pickLonLat(event.position)
    if (!p) return
    if (drawTarget.value === 'region') {
      if (!regionCornerA) {
        regionCornerA = p
        drawHint.value = '已确定第一角，移动鼠标预览后再次单击完成框选'
        setStatus(drawHint.value)
        return
      }
      const bounds = boundsFromCorners(regionCornerA, p)
      regionCornerA = undefined
      drawing.value = false
      drawHint.value = ''
      removeRegionDraft()
      if (!regionIsValid(bounds)) {
        toast('框选范围过小，请框选更大范围（约 0.005° 以上）')
        return
      }
      clearPreviousSamplingAndSource()
      setStatus('正在对框选区域进行 DEM 采样与分析…')
      void sampleAndBuild(bounds, 'clear')
      return
    }
    draftRing.push(p)
    setDraftHierarchy()
    drawHint.value = `已采集 ${draftRing.length} 点，右键完成`
  }, ScreenSpaceEventType.LEFT_CLICK)
  handler.setInputAction((event: ScreenSpaceEventHandler.MotionEvent) => {
    if (!drawing.value || drawTarget.value !== 'region' || !regionCornerA) return
    const p = pickLonLat(event.endPosition)
    if (!p) return
    updateRegionDraft(regionRingFromCorners(regionCornerA, p))
  }, ScreenSpaceEventType.MOUSE_MOVE)
  handler.setInputAction(() => {
    if (drawing.value && drawTarget.value === 'region') {
      drawing.value = false
      regionCornerA = undefined
      removeRegionDraft()
      drawHint.value = ''
      setStatus('已取消框选')
      return
    }
    if (drawing.value && drawTarget.value === 'source') finishDraw()
  }, ScreenSpaceEventType.RIGHT_CLICK)
  viewer.scene.preUpdate.addEventListener(tick)
}

async function mountScene(): Promise<void> {
  if (!container.value) return
  const callbacks: SceneCallbacks = {
    onStatus: setStatus,
    onBasemapReady: () => setStatus('正在加载 Cesium World Terrain…')
  }
  viewer = createMapScene(container.value, callbacks)
  loadBingImagery(viewer, callbacks, (layer) => {
    imageryLayer = layer
  })
  viewer.scene.globe.depthTestAgainstTerrain = true
  viewer.scene.globe.baseColor = Color.fromCssColorString('#0d2036')
  grid = makeGrid(WEST, SOUTH, EAST, NORTH, NX, NY)
  installHandlers()
  isLoaded.value = true
  await sampleAndBuild(EXAMPLE_BOUNDS, 'default')
}

watch(resolutionDim, () => {
  if (!isLoaded.value || !regionBounds.value) return
  void sampleAndBuild(regionBounds.value, 'keep')
})

watch([samplingMode, spacingMeters], () => {
  if (!isLoaded.value || !regionBounds.value) return
  clearTimeout(samplingTimer)
  samplingTimer = setTimeout(() => {
    if (regionBounds.value) void sampleAndBuild(regionBounds.value, 'keep')
  }, 600)
})

onMounted(() => {
  void mountScene()
})

onBeforeUnmount(() => {
  disposed = true
  playing.value = false
  analysisRun += 1
  clearTimeout(samplingTimer)
  handler?.destroy()
  handler = undefined
  if (terrainPrimitive && viewer) viewer.scene.primitives.remove(terrainPrimitive)
  if (flowPrimitive && viewer) viewer.scene.primitives.remove(flowPrimitive)
  terrainPrimitive = undefined
  flowPrimitive = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="fy-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title-row">
        <span class="panel-title">滑坡动态模拟 · SWE + Voellmy</span>
        <button class="route-info-btn" title="查看技术路线说明" @click="infoOpen = true">技术路线</button>
      </div>

      <div class="section-title">选择区域</div>
      <div class="button-row">
        <button class="action-button primary" :disabled="!isLoaded || busy" @click="useExampleRegion">示例区域</button>
        <button class="action-button accent" :disabled="!isLoaded || busy" @click="startRectDraw">
          {{ drawingRect ? '框选中…' : '框选区域' }}
        </button>
      </div>
      <div class="control-row">
        <span class="row-label">范围</span>
        <span class="row-value region-value">{{ regionLabel }}</span>
      </div>
      <div class="mode-row">
        <button class="mode-button" :class="{ active: samplingMode === 'dim' }" :disabled="busy" @click="samplingMode = 'dim'">按行列数</button>
        <button class="mode-button" :class="{ active: samplingMode === 'spacing' }" :disabled="busy" @click="samplingMode = 'spacing'">按间距</button>
      </div>
      <div v-if="samplingMode === 'dim'" class="control-row">
        <span class="row-label">列数</span>
        <select v-model.number="resolutionDim" :disabled="busy">
          <option v-for="option in RESOLUTION_OPTIONS" :key="option" :value="option">{{ option }}</option>
        </select>
      </div>
      <div v-else class="control-row">
        <span class="row-label">间距(米)</span>
        <input v-model.number="spacingMeters" type="number" min="10" max="2000" step="10" :disabled="busy" />
      </div>
      <p class="sampling-note">{{ terrainNote }}</p>
      <p v-if="usedSamplingNote" class="sampling-note">{{ usedSamplingNote }}</p>
      <p v-if="drawingRect" class="result">单击第一角 → 移动 → 再次单击完成框选；右键取消</p>

      <div class="section-title">模拟控制</div>
      <div class="button-row">
        <button class="action-button primary" :disabled="!solver || busy || playing" @click="play">播放</button>
        <button class="action-button accent" :disabled="!playing" @click="pause">暂停</button>
        <button class="action-button danger" :disabled="!solver || busy" @click="resetSim">重置</button>
      </div>
      <div class="control-row">
        <span class="row-label">播放倍速</span>
        <input v-model.number="playbackSpeed" type="range" min="0.25" max="6" step="0.25" :disabled="busy" />
        <span class="row-value">{{ playbackSpeed.toFixed(2) }}x</span>
      </div>

      <div class="section-title">源区与流变参数</div>
      <div class="button-row">
        <button class="action-button accent" :disabled="!solver || busy || drawing" @click="startDrawSource">绘制源区</button>
        <button class="action-button primary" :disabled="!drawing || drawingRect" @click="finishDraw">完成</button>
      </div>
      <p v-if="drawing && !drawingRect" class="result">单击在山体上加点 → 右键或点完成结束</p>
      <p v-if="drawHint && !drawingRect" class="sampling-note">{{ drawHint }}</p>
      <div class="control-row">
        <span class="row-label">源区方量</span>
        <input v-model.number="volumeInput" type="range" min="50000" max="1200000" step="10000" :disabled="busy" @change="resetSim" />
        <span class="row-value wide">{{ formatVolume(volumeInput) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">摩擦角 δ</span>
        <input v-model.number="frictionAngle" type="range" min="2" max="30" step="1" :disabled="busy" @change="resetSim" />
        <span class="row-value">{{ frictionAngle }}°</span>
      </div>
      <div class="control-row">
        <span class="row-label">Voellmy ξ</span>
        <input v-model.number="voellmyXi" type="range" min="100" max="3000" step="50" :disabled="busy" @change="resetSim" />
        <span class="row-value">{{ voellmyXi }}</span>
      </div>

      <div class="section-title">流体着色</div>
      <div class="mode-row">
        <button class="mode-button" :class="{ active: colorMode === 'thickness' }" @click="colorMode = 'thickness'; onColorModeChange()">厚度</button>
        <button class="mode-button" :class="{ active: colorMode === 'velocity' }" @click="colorMode = 'velocity'; onColorModeChange()">速度</button>
      </div>
      <div class="control-row">
        <span class="row-label">影响阈值</span>
        <input v-model.number="threshold" type="range" min="0.02" max="1" step="0.02" :disabled="busy" />
        <span class="row-value">{{ threshold.toFixed(2) }} m</span>
      </div>

      <div class="section-title">定量结果</div>
      <p class="stat-line">模拟时间：{{ simTime }}</p>
      <p class="stat-line">滑体方量：{{ volumeText }}</p>
      <p class="stat-line">守恒比率：{{ conserveText }}</p>
      <p class="stat-line">最大厚度：{{ maxHText }}</p>
      <p class="stat-line">最大速度：{{ maxVText }}</p>
      <p class="stat-note">影响范围：{{ impactText }}</p>
      <div class="button-row">
        <button class="action-button primary" :disabled="!solver || busy" @click="extractNow">提取影响范围</button>
        <button class="action-button accent" :disabled="!solver || busy" @click="frameCamera">视角复位</button>
      </div>
      <div class="button-row">
        <button class="action-button accent" :disabled="!solver || busy || impactText === '尚未提取'" @click="exportGeoJSON">GeoJSON</button>
        <button class="action-button accent" :disabled="!solver || busy || impactText === '尚未提取'" @click="exportKml">KML</button>
      </div>
    </div>

    <div class="timeline-bar">
      <input
        class="timeline-range"
        type="range"
        min="0"
        :max="Math.max(0, frameCount - 1)"
        step="1"
        :value="timelineIndex"
        :disabled="!frameCount"
        @input="onTimelineInput"
      />
      <span class="timeline-label">{{ timelineLabel }}</span>
      <button class="timeline-btn" :disabled="!frameCount" @click="exportSeries">过程数据</button>
    </div>

    <div class="legend">
      <div class="legend-gradient" :style="{ background: legendCss }"></div>
      <span>红色源区 · {{ colorMode === 'velocity' ? '彩流体=速度（低→高）' : '彩流体=厚度（浅→深）' }} · 橙色=影响范围</span>
    </div>

    <div v-if="busy" class="progress-mask">
      <span>正在准备地形…</span>
      <div class="progress-bar"><i :style="{ width: progress + '%' }"></i></div>
      <span class="progress-status">{{ statusMessage }}</span>
      <span class="progress-percent">{{ progress }}%</span>
    </div>

    <div v-if="statusMessage && !busy" class="status-mask">{{ statusMessage }}</div>

    <div v-if="infoOpen" class="route-overlay" @click.self="infoOpen = false">
      <div class="route-modal">
        <div class="route-head">
          <span class="route-title">{{ ROUTE_OVERVIEW.title }}</span>
          <button class="help-close route-close" title="关闭" @click="infoOpen = false">×</button>
        </div>
        <div class="route-body">
          <p class="route-intro">{{ ROUTE_OVERVIEW.intro }}</p>
          <div v-for="layer in ROUTE_OVERVIEW.layers" :key="layer.key" class="route-layer">
            <div class="route-layer-title">{{ layer.title }}</div>
            <p class="route-text">{{ layer.text }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fy-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 5px; width: 288px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; box-sizing: border-box; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 26, 44, 0.92); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.panel-title { font-size: 12px; font-weight: 700; margin-bottom: 2px; }
.panel-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.route-info-btn { flex: 0 0 auto; min-height: 22px; padding: 0 9px; border: 1px solid rgba(255, 199, 92, 0.55); border-radius: 11px; background: rgba(255, 199, 92, 0.16); color: #ffd666; cursor: pointer; font-size: 10px; line-height: 1; }
.route-info-btn:hover { background: rgba(255, 199, 92, 0.32); }
.route-overlay { position: absolute; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 26px; box-sizing: border-box; background: rgba(4, 13, 26, 0.6); backdrop-filter: blur(2px); }
.route-modal { display: flex; flex-direction: column; width: min(560px, 92%); max-height: 88%; padding: 14px 16px; box-sizing: border-box; border: 1px solid rgba(255, 199, 92, 0.5); border-radius: 10px; background: rgba(10, 28, 48, 0.97); box-shadow: 0 10px 36px rgba(0, 0, 0, 0.45); color: #e3f2f8; }
.route-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid rgba(255, 199, 92, 0.28); }
.route-title { font-size: 13px; font-weight: 700; color: #ffd666; }
.route-close { font-size: 18px; }
.route-body { display: flex; flex-direction: column; gap: 9px; overflow-y: auto; padding: 10px 2px 2px; }
.route-intro { margin: 0; font-size: 11px; line-height: 1.7; color: #bfe0ee; }
.route-layer { padding: 8px 10px; border: 1px solid rgba(137, 210, 233, 0.16); border-radius: 7px; background: rgba(21, 48, 78, 0.35); }
.route-layer-title { font-size: 11px; font-weight: 700; color: #7fd0e6; }
.route-text { margin: 4px 0 0; font-size: 11px; line-height: 1.75; color: #c7dce8; }
.section-title { margin-top: 7px; margin-bottom: 2px; padding-bottom: 2px; border-bottom: 1px solid rgba(137, 210, 233, 0.16); font-size: 11px; font-weight: 700; color: #7fd0e6; }
.button-row { display: flex; gap: 6px; }
.action-button { flex: 1; min-height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; color: #edfaff; }
.action-button.primary { background: #257f9e; }
.action-button.accent { background: #8a6d1a; color: #fff3d6; }
.action-button.danger { background: #4a5a72; color: #ffd6d6; }
.action-button:disabled { cursor: default; opacity: 0.5; }
.result { margin: 2px 0 0; padding: 5px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; background: rgba(250, 173, 20, 0.18); color: #ffd666; text-align: center; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 2px 0; color: #c3d8e6; }
.row-label { flex: 0 0 auto; }
.row-value { flex: 0 0 44px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.row-value.wide { flex-basis: 58px; }
.region-value { flex: 1 1 auto; width: auto; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row select, .control-row input[type="number"] { width: 92px; height: 22px; padding: 0 5px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.stat-line { margin: 0; font-size: 10px; color: #9fb8d4; line-height: 1.7; }
.stat-note { margin: 0; font-size: 10px; color: #ffd666; line-height: 1.5; }
.hint { margin: 6px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.5; }
.progress-mask { position: absolute; top: 12px; left: 50%; z-index: 9; display: flex; flex-direction: column; align-items: center; gap: 5px; transform: translateX(-50%); padding: 10px 16px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; background: rgba(8, 21, 40, 0.9); color: #e8f4fa; font-size: 12px; pointer-events: none; min-width: 240px; max-width: 480px; box-sizing: border-box; }
.progress-bar { position: relative; width: 100%; height: 8px; overflow: hidden; border-radius: 4px; background: rgba(137, 210, 233, 0.2); }
.progress-bar i { position: absolute; top: 0; bottom: 0; left: 0; background: #2f80ed; }
.progress-status { font-size: 11px; color: #ffd666; text-align: center; line-height: 1.5; }
.progress-percent { font-size: 11px; color: #9fd6ef; }
.timeline-bar { position: absolute; bottom: 12px; left: 50%; z-index: 9; display: flex; align-items: center; gap: 8px; width: min(560px, 92%); transform: translateX(-50%); padding: 6px 10px; border: 1px solid rgba(137, 210, 233, 0.25); border-radius: 6px; background: rgba(8, 26, 44, 0.85); color: #bcd7e4; font-size: 10px; box-sizing: border-box; }
.timeline-range { flex: 1; min-width: 0; accent-color: #2f80ed; }
.timeline-label { flex: 0 0 auto; color: #9fd6ef; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.timeline-btn { flex: 0 0 auto; min-height: 22px; padding: 0 8px; border: 0; border-radius: 4px; background: #8a6d1a; color: #fff3d6; cursor: pointer; font-size: 10px; }
.timeline-btn:disabled { cursor: default; opacity: 0.5; }
.legend { position: absolute; bottom: 46px; left: 50%; z-index: 8; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; max-width: 92%; transform: translateX(-50%); padding: 6px 9px; border: 1px solid rgba(137, 210, 233, 0.25); border-radius: 6px; background: rgba(8, 26, 44, 0.82); color: #bcd7e4; font-size: 10px; }
.legend-gradient { width: 70px; height: 8px; border-radius: 4px; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 420px; padding: 8px 14px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
.mode-row { display: flex; gap: 4px; }
.mode-button { flex: 1; min-height: 24px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 5px; background: rgba(21, 48, 78, 0.55); color: #b9d6e4; cursor: pointer; font-size: 11px; }
.mode-button.active { border-color: rgba(47, 128, 237, 0.9); background: rgba(47, 128, 237, 0.28); color: #fff; }
.mode-button:disabled { cursor: default; opacity: 0.5; }
.sampling-note { margin: 1px 0 0; font-size: 10px; color: #7fd0e6; }
.help-close { border: 0; background: transparent; color: #cbb98a; cursor: pointer; font-size: 14px; line-height: 1; }
</style>
