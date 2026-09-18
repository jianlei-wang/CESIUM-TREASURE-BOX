<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as Cesium from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  loadWorldTerrain,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { pickPosition } from '../measure-lib/pick'
import {
  buildHydroGrid,
  cellCenter,
  computeD8Direction,
  fillDepressions,
  type DirResult,
  type FillResult,
  type HydBounds,
  type HydGrid
} from '../hydro-analysis/hydro-lib'
import {
  buildCornerHeights,
  buildFlowArrowsPrimitive,
  buildRasterSurfacePrimitive,
  DIR_COLORS
} from '../hydro-analysis/hydro-render'
import {
  buildGeoJson,
  buildShpZip,
  downloadBytes,
  downloadText,
  writeGeoTiffFloat32,
  type HydFeature,
  type HydFeatureAttrs,
  type HydFeatureKind
} from '../hydro-analysis-pro/export-formats'
import { stepHelpByKey } from './step-help'
import {
  buildStormPrecip,
  buildUniformPrecip,
  cellMeters,
  classifyDepths,
  componentRingLonLat,
  computeRunoffDepth,
  DEFAULT_ALPHA,
  DEFAULT_CN,
  DEFAULT_SYNTH,
  DEPTH_BREAKS,
  floodComponents,
  generateSyntheticDem,
  generateZoneGrid,
  identifyDepressions,
  planAEqualVolumeFill,
  planBDepressionRouting,
  routeFlowVolumes,
  statsToCsv,
  ZONE_NAMES,
  type DepressionResult,
  type InundationResult,
  type SynthDemParams
} from './flood-forecast-lib'
import {
  buildValueSurfacePrimitive,
  buildZoneSurfacePrimitive,
  depthGradientCss,
  rainGradientCss,
  runoffGradientCss,
  transitGradientCss
} from './flood-render'

const RESOLUTION_OPTIONS = [90, 120, 160, 200]
const MIN_SPACING = 20
const MAX_COLSPAN = 300
const MAX_ROWS = 900
const ARROW_STRIDE_OPTIONS = [2, 3, 4, 5, 6]
const ARROW_DIRECTIONS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']

const EXAMPLE_BOUNDS: HydBounds = { west: 108.94, east: 109.04, south: 34.02, north: 34.1 }

const STEPS = [
  { key: 1, label: '① DEM 与模拟数据' },
  { key: 2, label: '② 洼地填平与识别' },
  { key: 3, label: '③ D8 流向' },
  { key: 4, label: '④ 降水与产流' },
  { key: 5, label: '⑤ 汇流演算' },
  { key: 6, label: '⑥ 淹没模拟' },
  { key: 7, label: '⑦ 淹没分级统计' }
] as const

const ROUTE_OVERVIEW = {
  title: '区域产水与淹没预测 · 技术路线说明',
  intro:
    '以 DEM 为地形基础，叠加气象预报降水与下垫面（土地利用/土壤）信息，完成"地形预处理 → 产流 → 汇流 → 蓄水/淹没 → 范围与面积提取"的完整链路。工具内所有输入数据（DEM、降水场、下垫面分区）均可本地生成模拟数据或由参数直接控制，可离线复现同一场次分析。',
  layers: [
    {
      key: '1',
      title: '第 1 层 · 数据输入与网格化',
      text: '以 DEM 为地形地基，气象预报降水作为产流驱动量，土地利用/覆盖与土壤类型用于确定 CN 或径流系数。降水预报按 0.1° 量级格点输出，需重采样到与 DEM 相同的网格与坐标系。'
    },
    {
      key: '2',
      title: '第 2 层 · DEM 水文预处理',
      text: '填洼区分伪洼地与真实洼地/塘坝（真实蓄水区保留）；采用 D8 计算流向；沿流向累加上游来水得到汇流累积量；由填洼前后高程差识别真实洼地，逐个给出蓄水容量、出口高程与体积-水位关系，作为淹没分析的核心对象。'
    },
    {
      key: '3',
      title: '第 3 层 · 产流计算',
      text: '优先 SCS-CN：S=25400/CN−254，初损 Ia=0.2·S，径流 Q=(P−Ia)²/(P−Ia+S)；CN 由土地利用+水文土壤组共同决定。无此类数据时退化为径流系数法 Q=α·P。逐格径流深乘格面积得到产水体积。'
    },
    {
      key: '4',
      title: '第 4 层 · 汇流与淹没',
      text: '每个栅格的产水量沿 D8 向下游传递并逐级累加，得到逐格过境水量。淹没提供两套可选方案：A 等体积平面灌水（按 DEM 高程自低到高逐级充填至总产水体积）；B 洼地蓄水+溢流（洼地先拦蓄、蓄满后经出口向下游级联溢流）。'
    },
    {
      key: '5',
      title: '第 5 层 · 成果与统计',
      text: '淹没水深按 <0.3 m、0.3~1 m、1~2 m、>2 m 分级统计面积与占比；叠加 0.7/1.0/1.3 三档降水情景得到淹没范围区间估计；成果可导出 GeoTIFF 栅格、GeoJSON/SHP 矢量与统计 CSV。'
    }
  ]
}

const infoOpen = ref(false)

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图与 Cesium World Terrain…')
const isLoaded = ref(false)
const busy = ref(false)
const drawingRect = ref(false)
const progress = ref(0)
const stage = ref(0)
const activeHelpKey = ref<number | undefined>(undefined)
const resultsPanelOpen = ref(true)

type RasterSnap = {
  width: number
  height: number
  west: number
  north: number
  cellLon: number
  cellLat: number
  values: Float32Array
  description: string
}

type VecSnap = {
  kind: HydFeatureKind
  paths: { lon: number; lat: number }[][]
  attrsList: HydFeatureAttrs[]
}

type ResultEntry = {
  key: string
  step: number
  title: string
  note: string
  raster?: RasterSnap
  vector?: VecSnap
}
const resultEntries = reactive<ResultEntry[]>([])

const dataSource = ref<'terrain' | 'synthetic'>('synthetic')
const resolutionDim = ref(160)
const samplingMode = ref<'dim' | 'spacing'>('dim')
const spacingMeters = ref(100)
const usedSamplingNote = ref('')
const terrainReady = ref(false)
const synthP = reactive<SynthDemParams>({ ...DEFAULT_SYNTH })

const minDepDepth = ref(0.6)
const arrowStride = ref(4)
const arrowAlpha = ref(0.9)
const baseOpacity = ref(0.95)

const precipMode = ref<'uniform' | 'storm'>('uniform')
const precipAmount = ref(90)
const scenario = ref(1)
const stormCenterU = ref(0.55)
const stormCenterV = ref(0.45)
const stormRadius = ref(0.32)
const stormUneven = ref(0.08)
const stormSeed = ref(3)

const runoffModel = ref<'cn' | 'alpha'>('cn')
const uniformCn = ref(74)
const uniformAlpha = ref(0.55)
const zoneEnabled = ref(false)
const zoneCount = ref(4)
const zoneSeed = ref(8)
const zoneCnValues = reactive<number[]>(DEFAULT_CN.slice())
const zoneAlphaValues = reactive<number[]>(DEFAULT_ALPHA.slice())
const zoneOpacity = ref(0.5)
const rainOpacity = ref(0.5)
const runoffOpacity = ref(0.62)
const transitOpacity = ref(0.62)
const waterOpacity = ref(0.72)
const scenarioSlots = [0.7, 1.0, 1.3]

const inundationMethod = ref<'A' | 'B'>('B')
const detainShare = ref(1)

const demAutoFill = ref(true)
const demCoverageText = ref('—')

const demVisible = ref(true)
const raiseVisible = ref(true)
const depVisible = ref(true)
const arrowVisible = ref(true)
const zoneVisible = ref(true)
const rainVisible = ref(true)
const runoffVisible = ref(true)
const transitVisible = ref(true)
const waterVisible = ref(true)
const boundaryVisible = ref(true)
const regionRectVisible = ref(true)
const legendVisible = ref(true)

const gridInfoText = ref('—')
const demRangeText = ref('—')
const fillStatsText = ref('—')
const depStatsText = ref('—')
const dirStatsText = ref('—')
const runoffStatsText = ref('—')
const transitStatsText = ref('—')
const floodStatsText = ref('—')
const floodTitleText = ref('—')
const scenarioRows = ref<
  { factor: number; precipM3: number; areaKm2: number; peakM: number; storedM3: number; outflowM3: number }[]
>([])

type StatRow = { label: string; cells: number; areaKm2: number; pct: number; color: string }
const depthStatRows = ref<StatRow[]>([])
const depthStatTotal = ref<{ cells: number; areaKm2: number } | undefined>()

type ReportKV = { label: string; value: string }
type ReportTable = { caption: string; head: string[]; body: (string | number)[][] }
type ReportSection = { title: string; kv?: ReportKV[]; lines?: string[]; table?: ReportTable }
type ReportModel = { generatedAt: string; intro: string; sections: ReportSection[] }
const reportModel = ref<ReportModel | null>(null)

const demCss = computed(() => 'linear-gradient(90deg, #25602e 0%, #5a7d32 25%, #b09b46 50%, #c8a86a 75%, #f2e5d5 100%)')
const raiseCss = computed(() => 'linear-gradient(90deg, rgba(2,119,189,0.05) 0%, rgba(255,122,72,0.9) 100%)')
const rainCss = computed(() => rainGradientCss())
const runoffCss = computed(() => runoffGradientCss())
const transitCss = computed(() => transitGradientCss())
const depthCss = computed(() => depthGradientCss())
const regionLabel = computed(() => {
  if (!regionBounds.value) return '未选择'
  return `${regionBounds.value.west.toFixed(4)} ~ ${regionBounds.value.east.toFixed(4)}°E`
})
const activeHelp = computed(() => (activeHelpKey.value === undefined ? undefined : stepHelpByKey(activeHelpKey.value)))
function toggleHelp(key: number): void {
  activeHelpKey.value = activeHelpKey.value === key ? undefined : key
}
function wm3Text(v: number): string {
  return `${(v / 1e4).toFixed(2)} 万 m³`
}

function onoffText(flag: boolean): string {
  return flag ? '开启' : '关闭'
}

function regionExtentText(b: HydBounds): string {
  const midLat = ((b.south + b.north) / 2) * Math.PI / 180
  const lonSpan = Math.max(1e-6, b.east - b.west) * 111.32 * Math.cos(midLat)
  const latSpan = Math.max(1e-6, b.north - b.south) * 111.32
  return `经度 ${b.west.toFixed(4)}~${b.east.toFixed(4)}°，纬度 ${b.south.toFixed(4)}~${b.north.toFixed(4)}°，范围约 ${lonSpan.toFixed(2)} km × ${latSpan.toFixed(2)} km（${(lonSpan * latSpan).toFixed(3)} km²）`
}

function samplingSummaryText(): string {
  if (stage.value > 0 && usedSamplingNote.value) return usedSamplingNote.value
  const bounds = regionBounds.value
  if (!bounds) return '—'
  const dims = gridDimsForSampling(bounds)
  return samplingMode.value === 'spacing'
    ? `按间距 ${Math.max(MIN_SPACING, spacingMeters.value)} m → ${dims.cols}×${dims.rows}`
    : `按行列 ${resolutionDim.value}`
}

let viewer: Cesium.Viewer | undefined
let handler: Cesium.ScreenSpaceEventHandler | undefined
let analysisRun = 0
let hydGrid: HydGrid | undefined
let cornerH: Float32Array | undefined
let fillResult: FillResult | undefined
let depResult: DepressionResult | undefined
let dirResult: DirResult | undefined
let precipF: Float32Array | undefined
let zoneGridF: Uint8Array | undefined
let zoneValuesF: number[] = []
let runoffDepth: Float32Array | undefined
let localVolume: Float64Array | undefined
let transitResult: { transit: Float64Array; outflow: number; drained: number } | undefined
let inunResult: InundationResult | undefined
const regionBounds = ref<HydBounds | undefined>()

let regionRectEntity: Cesium.Entity | undefined
let draftEntity: Cesium.Entity | undefined
let rectStart: { lon: number; lat: number } | undefined

const demPrim = ref<Cesium.Primitive | undefined>()
const raisePrim = ref<Cesium.Primitive | undefined>()
const arrowPrim = ref<Cesium.Primitive | undefined>()
const zonePrim = ref<Cesium.Primitive | undefined>()
const rainPrim = ref<Cesium.Primitive | undefined>()
const runoffPrim = ref<Cesium.Primitive | undefined>()
const transitPrim = ref<Cesium.Primitive | undefined>()
const waterPrim = ref<Cesium.Primitive | undefined>()

const depEntities: Cesium.Entity[] = []
const floodEntities: Cesium.Entity[] = []

function cellSnapshot(grid: HydGrid, values: Float32Array, description: string): RasterSnap {
  return {
    width: grid.cols,
    height: grid.rows,
    west: grid.bounds.west,
    north: grid.bounds.north,
    cellLon: grid.cellLon,
    cellLat: grid.cellLat,
    values: new Float32Array(values),
    description
  }
}

function rasterToTiff(entry: RasterSnap): Uint8Array {
  return writeGeoTiffFloat32({
    width: entry.width,
    height: entry.height,
    west: entry.west,
    north: entry.north,
    cellLon: entry.cellLon,
    cellLat: entry.cellLat,
    values: entry.values,
    description: entry.description
  })
}

function clearResults(): void {
  resultEntries.length = 0
}

function exportEntryRaster(entry: ResultEntry): void {
  if (!entry.raster) return
  const bytes = rasterToTiff(entry.raster)
  downloadBytes(bytes, `${entry.key}.tif`, 'image/tiff')
}

function exportEntryVector(entry: ResultEntry, format: 'geojson' | 'shp'): void {
  const vector = entry.vector
  if (!vector) return
  const features: HydFeature[] = vector.paths.map((path, index) => ({
    kind: vector.kind,
    path,
    attrs: vector.attrsList[index] ?? {}
  }))
  const base = entry.key
  if (format === 'geojson') {
    const geoFeatures = features.map((feature) => {
      const coordinates: number[][] =
        feature.kind === 'Point'
          ? [[feature.path[0].lon, feature.path[0].lat]]
          : feature.path.map((p) => [p.lon, p.lat])
      if (feature.kind === 'Polygon' && coordinates.length > 0) {
        const first = coordinates[0]
        const last = coordinates[coordinates.length - 1]
        if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push(first)
      }
      return {
        type: 'Feature' as const,
        properties: feature.attrs as Record<string, unknown>,
        geometry: {
          type: (feature.kind === 'Line' ? 'LineString' : feature.kind) as 'LineString' | 'Polygon' | 'Point',
          coordinates
        }
      }
    })
    downloadText(buildGeoJson(geoFeatures as never, base), `${base}.geojson`, 'application/geo+json')
  } else {
    const zip = buildShpZip(base, features)
    if (zip.length > 0) downloadBytes(zip, `${base}.zip`, 'application/zip')
  }
}

function putEntry(id: string, entry: Omit<ResultEntry, 'key'>): void {
  const full = { ...entry, key: id }
  const index = resultEntries.findIndex((item) => item.key === id)
  if (index >= 0) resultEntries[index] = full
  else resultEntries.push(full)
}

function removeEntriesWithStepGreater(step: number): void {
  for (let i = resultEntries.length - 1; i >= 0; i -= 1) {
    if (resultEntries[i].step > step) resultEntries.splice(i, 1)
  }
}

const entryLayerRefs: Record<string, { value: boolean }> = {
  dem: demVisible,
  filldem: raiseVisible,
  raise: raiseVisible,
  depressions: depVisible,
  dir: arrowVisible,
  precip: rainVisible,
  runoff: runoffVisible,
  transit: transitVisible,
  'flood-depth': waterVisible,
  'flood-mask': waterVisible,
  'flood-boundary': boundaryVisible
}

function layerVisibleByEntry(key: string): boolean {
  const entryRef = entryLayerRefs[key]
  return entryRef === undefined ? true : entryRef.value
}

function setLayerVisibleByEntry(key: string, value: boolean): void {
  const entryRef = entryLayerRefs[key]
  if (entryRef !== undefined) {
    entryRef.value = value
    applyStageRendering()
  }
}

function setStatus(message: string): void {
  statusMessage.value = message
}

function removePrimitive(primitive: Cesium.Primitive | undefined): void {
  if (!viewer || !primitive || viewer.isDestroyed()) return
  viewer.scene.primitives.remove(primitive)
}

function removeLayerPrims(): void {
  removePrimitive(demPrim.value); demPrim.value = undefined
  removePrimitive(raisePrim.value); raisePrim.value = undefined
  removePrimitive(arrowPrim.value); arrowPrim.value = undefined
  removePrimitive(zonePrim.value); zonePrim.value = undefined
  removePrimitive(rainPrim.value); rainPrim.value = undefined
  removePrimitive(runoffPrim.value); runoffPrim.value = undefined
  removePrimitive(transitPrim.value); transitPrim.value = undefined
  removePrimitive(waterPrim.value); waterPrim.value = undefined
}

function removeEntities(list: Cesium.Entity[]): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const entity of list) viewer.entities.remove(entity)
  list.length = 0
}

function regionRing(bounds: HydBounds): { lon: number; lat: number }[] {
  return [
    { lon: bounds.west, lat: bounds.north },
    { lon: bounds.east, lat: bounds.north },
    { lon: bounds.east, lat: bounds.south },
    { lon: bounds.west, lat: bounds.south }
  ]
}

function ringToCartesians(points: { lon: number; lat: number }[]): Cesium.Cartesian3[] {
  return points.map((point) => Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 0))
}

function rectPolygonOptions(ring: { lon: number; lat: number }[], color: Cesium.Color): Cesium.PolygonGraphics.ConstructorOptions {
  return {
    hierarchy: new Cesium.PolygonHierarchy(ringToCartesians(ring)),
    material: color.withAlpha(0.12),
    outline: true,
    outlineColor: color.withAlpha(0.95),
    outlineWidth: 2,
    perPositionHeight: false,
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    classificationType: Cesium.ClassificationType.BOTH
  }
}

function showRegionRect(bounds: HydBounds): void {
  if (!viewer || viewer.isDestroyed()) return
  const ring = regionRing(bounds)
  const color = Cesium.Color.fromCssColorString('#ffcf5c')
  if (!regionRectEntity) {
    regionRectEntity = viewer.entities.add({
      polygon: rectPolygonOptions(ring, color)
    }) as unknown as Cesium.Entity
  } else {
    const polygon = regionRectEntity.polygon
    if (polygon) {
      polygon.hierarchy = new Cesium.ConstantProperty(new Cesium.PolygonHierarchy(ringToCartesians(ring)))
      polygon.show = new Cesium.ConstantProperty(regionRectVisible.value)
    }
  }
}

function clearLayers(): void {
  analysisRun += 1
  hydGrid = undefined
  cornerH = undefined
  fillResult = undefined
  depResult = undefined
  dirResult = undefined
  precipF = undefined
  zoneGridF = undefined
  zoneValuesF = []
  runoffDepth = undefined
  localVolume = undefined
  transitResult = undefined
  inunResult = undefined
  clearResults()
  activeHelpKey.value = undefined
  stage.value = 0
  regionBounds.value = undefined
  rectStart = undefined
  drawingRect.value = false
  removeLayerPrims()
  removeEntities(depEntities)
  removeEntities(floodEntities)
  if (regionRectEntity && viewer && !viewer.isDestroyed()) {
    viewer.entities.remove(regionRectEntity)
    regionRectEntity = undefined
  }
  gridInfoText.value = '—'
  demRangeText.value = '—'
  fillStatsText.value = '—'
  depStatsText.value = '—'
  dirStatsText.value = '—'
  runoffStatsText.value = '—'
  transitStatsText.value = '—'
  floodStatsText.value = '—'
  floodTitleText.value = '—'
  depthStatRows.value = []
  depthStatTotal.value = undefined
  scenarioRows.value = []
  progress.value = 0
}

function resetPickingFlags(): void {
  drawingRect.value = false
  rectStart = undefined
  if (draftEntity && viewer && !viewer.isDestroyed()) {
    viewer.entities.remove(draftEntity)
    draftEntity = undefined
  }
}

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function gridDimsForSampling(bounds: HydBounds): { cols: number; rows?: number } {
  if (samplingMode.value !== 'spacing') return { cols: resolutionDim.value }
  const spacing = Math.max(MIN_SPACING, spacingMeters.value)
  const midLat = ((bounds.south + bounds.north) / 2) * Math.PI / 180
  const lonSpanM = Math.max(1e-6, bounds.east - bounds.west) * 111320 * Math.cos(midLat)
  const latSpanM = Math.max(1e-6, bounds.north - bounds.south) * 111320
  const cols = Math.max(8, Math.min(MAX_COLSPAN, Math.round(lonSpanM / spacing)))
  const rows = Math.max(8, Math.min(MAX_ROWS, Math.round(latSpanM / spacing)))
  return { cols, rows }
}

function computeRange(grid: HydGrid): void {
  let minH = Number.POSITIVE_INFINITY
  let maxH = Number.NEGATIVE_INFINITY
  for (let i = 0; i < grid.dem.length; i += 1) {
    const h = grid.dem[i]
    if (h < minH) minH = h
    if (h > maxH) maxH = h
  }
  grid.demMin = minH
  grid.demMax = maxH
}

function terrainFillPass(grid: HydGrid, arr: Float32Array, vertical: boolean, forward: boolean): number {
  const { cols, rows } = grid
  let changed = 0
  if (vertical) {
    if (forward) {
      for (let r = 1; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const cur = r * cols + c
          if (arr[cur] > 0) continue
          const up = arr[cur - cols]
          if (up > 0) { arr[cur] = up; changed += 1 }
        }
      }
    } else {
      for (let r = rows - 2; r >= 0; r -= 1) {
        for (let c = 0; c < cols; c += 1) {
          const cur = r * cols + c
          if (arr[cur] > 0) continue
          const down = arr[cur + cols]
          if (down > 0) { arr[cur] = down; changed += 1 }
        }
      }
    }
    return changed
  }
  if (forward) {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 1; c < cols; c += 1) {
        const cur = r * cols + c
        if (arr[cur] > 0) continue
        const left = arr[cur - 1]
        if (left > 0) { arr[cur] = left; changed += 1 }
      }
    }
  } else {
    for (let r = 0; r < rows; r += 1) {
      for (let c = cols - 2; c >= 0; c -= 1) {
        const cur = r * cols + c
        if (arr[cur] > 0) continue
        const right = arr[cur + 1]
        if (right > 0) { arr[cur] = right; changed += 1 }
      }
    }
  }
  return changed
}

function fillMissingTerrain(grid: HydGrid): { valid: number; missing: number; filled: number } {
  const arr = grid.dem
  let valid = 0
  let missing = 0
  for (let i = 0; i < arr.length; i += 1) {
    if (arr[i] > 0) valid += 1
    else missing += 1
  }
  if (valid === 0 || missing === 0 || !demAutoFill.value) {
    return { valid, missing, filled: 0 }
  }
  const original = new Float32Array(arr)
  for (let pass = 0; pass < 3; pass += 1) {
    const before = countZeroOf(arr)
    terrainFillPass(grid, arr, true, true)
    terrainFillPass(grid, arr, true, false)
    terrainFillPass(grid, arr, false, true)
    terrainFillPass(grid, arr, false, false)
    if (countZeroOf(arr) === 0 || countZeroOf(arr) === before) break
  }
  let filled = 0
  for (let i = 0; i < arr.length; i += 1) {
    if (arr[i] > 0 && original[i] <= 0) filled += 1
  }
  return { valid, missing, filled }
}

function countZeroOf(arr: Float32Array): number {
  let count = 0
  for (let i = 0; i < arr.length; i += 1) if (arr[i] <= 0) count += 1
  return count
}

const groundMaxCache = new Map<string, number>()

function boundsKey(bounds: HydBounds): string {
  return `${bounds.west.toFixed(4)}_${bounds.east.toFixed(4)}_${bounds.south.toFixed(4)}_${bounds.north.toFixed(4)}`
}

async function estimateGroundMax(bounds: HydBounds): Promise<number> {
  if (!viewer || viewer.isDestroyed() || !terrainReady.value) return 0
  const key = boundsKey(bounds)
  if (groundMaxCache.has(key)) return groundMaxCache.get(key) as number
  const samples: Cesium.Cartographic[] = []
  const steps = 10
  for (let i = 0; i <= steps; i += 1) {
    for (let j = 0; j <= steps; j += 1) {
      const lon = bounds.west + (bounds.east - bounds.west) * (j / steps)
      const lat = bounds.south + (bounds.north - bounds.south) * (i / steps)
      samples.push(Cesium.Cartographic.fromDegrees(lon, lat))
    }
  }
  try {
    const result = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, samples)
    let max = 0
    for (const sample of result) {
      if (Number.isFinite(sample.height) && (sample.height as number) > max) max = sample.height as number
    }
    groundMaxCache.set(key, max)
    return max
  } catch {
    groundMaxCache.set(key, 0)
    return 0
  }
}

function synthesizeDem(grid: HydGrid, groundMax: number): void {
  const values = generateSyntheticDem(grid, synthP)
  let minPre = Number.POSITIVE_INFINITY
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] < minPre) minPre = values[i]
  }
  const effectiveBase = Math.max(synthP.baseAlt, groundMax + 160)
  const shift = effectiveBase - minPre
  for (let i = 0; i < values.length; i += 1) {
    grid.dem[i] = values[i] + shift
  }
  computeRange(grid)
}

async function sampleDem(runId: number, grid: HydGrid): Promise<boolean> {
  if (!viewer || viewer.isDestroyed()) return false
  const totalRows = grid.rows
  const batchRows = Math.max(1, Math.min(totalRows, Math.floor(6000 / grid.cols)))
  for (let startRow = 0; startRow < totalRows; startRow += batchRows) {
    if (runId !== analysisRun || viewer.isDestroyed()) return false
    const endRow = Math.min(totalRows, startRow + batchRows)
    const samples: Cesium.Cartographic[] = []
    for (let row = startRow; row < endRow; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const point = cellCenter(grid, row, col)
        samples.push(Cesium.Cartographic.fromDegrees(point.lon, point.lat))
      }
    }
    setStatus(`正在采样区域地形高程…${Math.round((startRow / totalRows) * 100)}%`)
    progress.value = Math.round((startRow / totalRows) * 80)
    await yieldFrame()
    try {
      const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, samples)
      if (runId !== analysisRun || viewer.isDestroyed()) return false
      let index = 0
      for (let row = startRow; row < endRow; row += 1) {
        for (let col = 0; col < grid.cols; col += 1) {
          const height = sampled[index]?.height
          grid.dem[row * grid.cols + col] = Number.isFinite(height) ? (height as number) : 0
          index += 1
        }
      }
    } catch {
      if (runId !== analysisRun || viewer.isDestroyed()) return false
      for (let row = startRow; row < endRow; row += 1) {
        for (let col = 0; col < grid.cols; col += 1) {
          grid.dem[row * grid.cols + col] = 0
        }
      }
    }
    progress.value = Math.min(80, Math.round((endRow / totalRows) * 80))
    await yieldFrame()
  }
  computeRange(grid)
  return true
}

async function ensureStepDem(): Promise<boolean> {
  if (hydGrid && stage.value >= 1) return true
  if (!viewer || viewer.isDestroyed() || !regionBounds.value) return false
  if (dataSource.value === 'terrain' && !terrainReady.value) {
    setStatus('真实地形模式需要加载 Cesium World Terrain，请稍后或切换为模拟 DEM 合成')
    return false
  }
  const runId = ++analysisRun
  busy.value = true
  progress.value = 2
  const dims = gridDimsForSampling(regionBounds.value)
  const grid = buildHydroGrid(regionBounds.value, dims.cols, dims.rows)
  hydGrid = grid
  if (dataSource.value === 'synthetic') {
    const groundMax = await estimateGroundMax(regionBounds.value)
    if (runId !== analysisRun || viewer.isDestroyed()) {
      busy.value = false
      return false
    }
    synthesizeDem(grid, groundMax)
  } else {
    const ok = await sampleDem(runId, grid)
    if (runId !== analysisRun || viewer.isDestroyed()) {
      busy.value = false
      return false
    }
    if (!ok || !Number.isFinite(grid.demMax) || grid.demMax <= 0) {
      setStatus('未获取到区域地形高度，请确认已加载 Cesium World Terrain 后重试')
      busy.value = false
      return false
    }
    const total = grid.dem.length
    const coverage = fillMissingTerrain(grid)
    if (coverage.filled > 0) {
      demCoverageText.value =
        `真实数据有效 ${Math.round((coverage.valid / total) * 100)}%，已自动补齐缺失 ${coverage.filled.toLocaleString()} 像元`
      computeRange(grid)
      setStatus(`地形采样完成，部分区域无真实高程，已用相邻高程自动外推补齐（共 ${coverage.filled.toLocaleString()} 像元）`)
    } else if (coverage.missing > 0) {
      demCoverageText.value = `真实数据有效 ${Math.round((coverage.valid / total) * 100)}%，仍存在 ${coverage.missing.toLocaleString()} 个无数据像元`
      setStatus('地形采样完成，但部分区域无真实高程。可在「DEM 图层」开启"自动补齐无数据"后重新生成')
    } else {
      demCoverageText.value = '全区有效真实高程'
    }
  }
  if (dataSource.value === 'synthetic') {
    demCoverageText.value = '模拟合成数据（全区有效）'
  }
  cornerH = buildCornerHeights(grid)
  stage.value = 1
  updateGridStats()
  usedSamplingNote.value = samplingMode.value === 'spacing'
    ? `间距 ${Math.max(MIN_SPACING, spacingMeters.value)} m → ${grid.cols}×${grid.rows}`
    : `网格 ${grid.cols}×${grid.rows}`
  refreshResultEntries()
  showRegionRect(regionBounds.value)
  buildBaseLayer()
  if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender()
  setStatus(dataSource.value === 'synthetic' ? '模拟 DEM 已合成，可逐步执行后续分析' : 'DEM 采样完成，可逐步执行后续分析')
  progress.value = 100
  busy.value = false
  return true
}

function buildPrecipField(amountMm: number): Float32Array {
  if (!hydGrid) return new Float32Array(0)
  if (precipMode.value === 'storm') {
    return buildStormPrecip(hydGrid, {
      centerU: stormCenterU.value,
      centerV: stormCenterV.value,
      peakMm: Math.max(0, amountMm),
      radiusFrac: Math.max(0.05, Math.min(1, stormRadius.value)),
      uneven: Math.max(0, Math.min(0.5, stormUneven.value)),
      seed: stormSeed.value
    })
  }
  return buildUniformPrecip(hydGrid, Math.max(0, amountMm))
}

function currentZoneGrid(): Uint8Array {
  if (!hydGrid) return new Uint8Array(0)
  if (!zoneEnabled.value) return new Uint8Array(hydGrid.cols * hydGrid.rows)
  return generateZoneGrid(hydGrid, zoneCount.value, zoneSeed.value)
}

function currentZoneValues(): number[] {
  const count = zoneEnabled.value ? Math.max(1, Math.min(ZONE_NAMES.length, zoneCount.value)) : 1
  if (runoffModel.value === 'cn') {
    const values: number[] = []
    for (let i = 0; i < count; i += 1) values.push(zoneCnValues[i] ?? DEFAULT_CN[i % DEFAULT_CN.length])
    return runoffModel.value === 'cn' ? values : values
  }
  const values: number[] = []
  for (let i = 0; i < count; i += 1) values.push(zoneAlphaValues[i] ?? DEFAULT_ALPHA[i % DEFAULT_ALPHA.length])
  return values
}

function currentUniformValue(): number {
  return runoffModel.value === 'cn' ? uniformCn.value : uniformAlpha.value
}

function computeLocalVolume(runoffMm: Float32Array): Float64Array {
  if (!hydGrid) return new Float64Array(0)
  const { area } = cellMeters(hydGrid)
  const vol = new Float64Array(runoffMm.length)
  for (let i = 0; i < runoffMm.length; i += 1) {
    vol[i] = (runoffMm[i] / 1000) * area * detainShare.value
  }
  return vol
}

function computeFillIdentify(): void {
  if (!hydGrid) return
  fillResult = fillDepressions(hydGrid)
  depResult = identifyDepressions(hydGrid, fillResult.filled, minDepDepth.value)
}

function computeDirection(): void {
  if (!hydGrid || !fillResult) return
  dirResult = computeD8Direction(hydGrid, fillResult.filled)
}

function computeRainfall(): void {
  if (!hydGrid) return
  const grid = hydGrid
  precipF = buildPrecipField(precipAmount.value * scenario.value)
  zoneGridF = currentZoneGrid()
  const values = zoneEnabled.value ? currentZoneValues() : [currentUniformValue()]
  zoneValuesF = values
  const zones = zoneEnabled.value
    ? (zoneGridF as Uint8Array)
    : (zoneGridF as Uint8Array)
  runoffDepth = computeRunoffDepth(grid, runoffModel.value, precipF as Float32Array, zones, values)
  localVolume = computeLocalVolume(runoffDepth)
}

function computeTransit(): void {
  if (!hydGrid || !dirResult || !localVolume) return
  transitResult = routeFlowVolumes(hydGrid, dirResult.dir, localVolume)
}

function computeInundation(): void {
  if (!hydGrid || !localVolume) return
  const grid = hydGrid
  if (inundationMethod.value === 'A') {
    inunResult = planAEqualVolumeFill(grid, localVolume, runoffDepth as Float32Array)
  } else {
    if (!dirResult || !depResult) return
    inunResult = planBDepressionRouting(grid, dirResult.dir, depResult, localVolume)
  }
}

function syncComputeThrough(target: number, from = 1): void {
  if (!hydGrid) return
  if (target >= 2 && from <= 2) computeFillIdentify()
  if (target >= 3 && from <= 3) computeDirection()
  if (target >= 4 && from <= 4) computeRainfall()
  if (target >= 5 && from <= 5) computeTransit()
  if (target >= 6 && from <= 6) computeInundation()
}

function runoffLocalMax(runoff: Float32Array): number {
  let max = 0
  for (let i = 0; i < runoff.length; i += 1) if (runoff[i] > max) max = runoff[i]
  return max
}

function transitValuesMax(): number {
  if (!transitResult) return 0
  let max = 0
  for (let i = 0; i < transitResult.transit.length; i += 1) {
    if (transitResult.transit[i] > max) max = transitResult.transit[i]
  }
  return max
}

function maxFloat(values: Float32Array): number {
  let max = 0
  for (let i = 0; i < values.length; i += 1) if (values[i] > max) max = values[i]
  return max
}

function buildBaseLayer(): void {
  if (!viewer || !hydGrid || !cornerH || viewer.isDestroyed()) return
  removePrimitive(demPrim.value)
  demPrim.value = buildRasterSurfacePrimitive(hydGrid, cornerH, hydGrid.dem, {
    mode: 'elevation',
    opacity: baseOpacity.value,
    min: hydGrid.demMin,
    max: hydGrid.demMax
  })
  if (demPrim.value) {
    viewer.scene.primitives.add(demPrim.value)
    demPrim.value.show = demVisible.value
  }
}

function buildRaiseLayer(): void {
  if (!viewer || !hydGrid || !cornerH || !fillResult || viewer.isDestroyed()) return
  const grid = hydGrid
  const raiseValues = new Float32Array(grid.dem.length)
  for (let i = 0; i < raiseValues.length; i += 1) {
    raiseValues[i] = fillResult.filled[i] - grid.dem[i]
  }
  removePrimitive(raisePrim.value)
  raisePrim.value = buildRasterSurfacePrimitive(grid, cornerH, raiseValues, {
    mode: 'raise',
    opacity: 0.62,
    min: 0,
    max: Math.max(1, fillResult.maxRaise),
    zeroAlpha: true
  })
  if (raisePrim.value) {
    viewer.scene.primitives.add(raisePrim.value)
    raisePrim.value.show = raiseVisible.value
  }
}

function buildDepEntities(): void {
  if (!viewer || !hydGrid || !cornerH || !depResult || viewer.isDestroyed()) return
  const v = viewer
  removeEntities(depEntities)
  const grid = hydGrid
  const ch = cornerH
  const palette = ['#ffb74d', '#4f9dff', '#2ad4a0', '#e16bf0', '#ff5d7a', '#7ef0e0', '#ffd666']
  depResult.deps.forEach((dep, index) => {
    const ring = componentRingLonLat(grid, dep.cells)
    if (ring.length < 3) return
    const positions = ring.map((p) => {
      const height = elevationAt(ch, p.lon, p.lat) + 6
      return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, height)
    })
    const color = Cesium.Color.fromCssColorString(palette[index % palette.length])
    const entity = v.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: color.withAlpha(0.16),
        outline: true,
        outlineColor: color.withAlpha(0.95),
        outlineWidth: 1.6,
        perPositionHeight: true
      }
    }) as Cesium.Entity
    depEntities.push(entity)
    if (index % 2 === 0) {
      const center = cellCenter(grid, dep.centerRow, dep.centerCol)
      const label = v.entities.add({
        position: Cesium.Cartesian3.fromDegrees(center.lon, center.lat, elevationAt(ch, center.lon, center.lat) + 14),
        label: {
          text: `洼${dep.id + 1}`,
          font: '11px sans-serif',
          fillColor: color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          pixelOffset: new Cesium.Cartesian2(0, -16)
        }
      }) as Cesium.Entity
      depEntities.push(label)
    }
  })
}

function buildArrowLayer(): void {
  if (!viewer || !hydGrid || !cornerH || !dirResult || viewer.isDestroyed()) return
  removePrimitive(arrowPrim.value)
  arrowPrim.value = buildFlowArrowsPrimitive(hydGrid, cornerH, dirResult.dir, {
    stride: arrowStride.value,
    alpha: arrowAlpha.value
  })
  if (arrowPrim.value) {
    viewer.scene.primitives.add(arrowPrim.value)
    arrowPrim.value.show = arrowVisible.value
  }
}

function buildZoneLayer(): void {
  if (!viewer || !hydGrid || !cornerH || !zoneGridF || !zoneEnabled.value || viewer.isDestroyed()) return
  removePrimitive(zonePrim.value)
  zonePrim.value = buildZoneSurfacePrimitive(hydGrid, cornerH, zoneGridF, Math.max(1, zoneCount.value), zoneOpacity.value)
  if (zonePrim.value) {
    viewer.scene.primitives.add(zonePrim.value)
    zonePrim.value.show = zoneVisible.value
  }
}

function buildRainLayer(): void {
  if (!viewer || !hydGrid || !cornerH || !precipF || viewer.isDestroyed()) return
  removePrimitive(rainPrim.value)
  rainPrim.value = buildValueSurfacePrimitive(hydGrid, cornerH, precipF, {
    mode: 'rain',
    opacity: rainOpacity.value,
    max: Math.max(1, precipAmount.value * scenario.value * 1.1)
  })
  if (rainPrim.value) {
    viewer.scene.primitives.add(rainPrim.value)
    rainPrim.value.show = rainVisible.value
  }
}

function buildRunoffLayer(): void {
  if (!viewer || !hydGrid || !cornerH || !runoffDepth || viewer.isDestroyed()) return
  removePrimitive(runoffPrim.value)
  runoffPrim.value = buildValueSurfacePrimitive(hydGrid, cornerH, runoffDepth, {
    mode: 'runoff',
    opacity: runoffOpacity.value,
    max: Math.max(1, runoffLocalMax(runoffDepth))
  })
  if (runoffPrim.value) {
    viewer.scene.primitives.add(runoffPrim.value)
    runoffPrim.value.show = runoffVisible.value
  }
}

function buildTransitLayer(): void {
  if (!viewer || !hydGrid || !cornerH || !transitResult || viewer.isDestroyed()) return
  const logValues = new Float32Array(transitResult.transit.length)
  for (let i = 0; i < transitResult.transit.length; i += 1) {
    logValues[i] = Math.log10(1 + transitResult.transit[i])
  }
  removePrimitive(transitPrim.value)
  transitPrim.value = buildValueSurfacePrimitive(hydGrid, cornerH, logValues, {
    mode: 'transit',
    opacity: transitOpacity.value,
    max: Math.max(1, maxFloat(logValues)),
    transparentZero: true
  })
  if (transitPrim.value) {
    viewer.scene.primitives.add(transitPrim.value)
    transitPrim.value.show = transitVisible.value
  }
}

function buildWaterLayer(): void {
  if (!viewer || !hydGrid || !cornerH || !inunResult || viewer.isDestroyed()) return
  removePrimitive(waterPrim.value)
  const maxDepth = Math.max(1, maxFloat(inunResult.depth))
  waterPrim.value = buildValueSurfacePrimitive(hydGrid, cornerH, inunResult.depth, {
    mode: 'depth',
    opacity: waterOpacity.value,
    max: maxDepth,
    transparentZero: true
  })
  if (waterPrim.value) {
    viewer.scene.primitives.add(waterPrim.value)
    waterPrim.value.show = waterVisible.value
  }
}

function buildFloodEntities(): void {
  if (!viewer || !hydGrid || !cornerH || !inunResult || viewer.isDestroyed()) return
  const v = viewer
  removeEntities(floodEntities)
  const grid = hydGrid
  const ch = cornerH
  const { area } = cellMeters(grid)
  const flooded = new Uint8Array(inunResult.depth.length)
  for (let i = 0; i < inunResult.depth.length; i += 1) {
    if (inunResult.depth[i] > 0.001) flooded[i] = 1
  }
  const comps = floodComponents(grid, flooded)
  const color = Cesium.Color.fromCssColorString('#58c6ff')
  comps.slice(0, 24).forEach((comp) => {
    const ring = componentRingLonLat(grid, comp)
    if (ring.length < 3) return
    const positions = ring.map((p) => {
      const height = elevationAt(ch, p.lon, p.lat) + 5
      return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, height)
    })
    const entity = v.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: color.withAlpha(0.12),
        outline: true,
        outlineColor: color.withAlpha(0.9),
        outlineWidth: 1.6,
        perPositionHeight: true
      }
    }) as Cesium.Entity
    floodEntities.push(entity)
  })
  void area
}

function elevationAt(cornerHeights: Float32Array, lon: number, lat: number): number {
  if (!hydGrid) return 0
  const grid = hydGrid
  const fx = (lon - grid.bounds.west) / Math.max(1e-9, grid.bounds.east - grid.bounds.west)
  const fy = (grid.bounds.north - lat) / Math.max(1e-9, grid.bounds.north - grid.bounds.south)
  const gx = Math.max(0, Math.min(grid.cols, Math.round(fx * grid.cols)))
  const gy = Math.max(0, Math.min(grid.rows, Math.round(fy * grid.rows)))
  return cornerHeights[gy * (grid.cols + 1) + gx] ?? 0
}

function applyStageRendering(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (demPrim.value) demPrim.value.show = demVisible.value
  if (raisePrim.value) raisePrim.value.show = raiseVisible.value
  if (arrowPrim.value) arrowPrim.value.show = arrowVisible.value
  if (zonePrim.value) zonePrim.value.show = zoneVisible.value
  if (rainPrim.value) rainPrim.value.show = rainVisible.value
  if (runoffPrim.value) runoffPrim.value.show = runoffVisible.value
  if (transitPrim.value) transitPrim.value.show = transitVisible.value
  if (waterPrim.value) waterPrim.value.show = waterVisible.value
  for (const entity of depEntities) entity.show = depVisible.value
  for (const entity of floodEntities) entity.show = boundaryVisible.value
  if (regionRectEntity?.polygon) regionRectEntity.polygon.show = new Cesium.ConstantProperty(regionRectVisible.value)
  if (viewer) viewer.scene.requestRender()
}

function updateGridStats(): void {
  if (!hydGrid) return
  const grid = hydGrid
  gridInfoText.value = `${grid.cols}×${grid.rows}，约 ${Math.round((grid.cellLon + grid.cellLat) / 2 * 111320).toLocaleString()} m/格`
  demRangeText.value = `${grid.demMin.toFixed(1)} ~ ${grid.demMax.toFixed(1)} m`
}

function sumFloat(values: Float32Array): number {
  let sum = 0
  for (let i = 0; i < values.length; i += 1) sum += values[i]
  return sum
}

function meanMm(values: Float32Array): number {
  if (values.length === 0) return 0
  return sumFloat(values) / values.length
}

function refreshStatsTexts(): void {
  if (!hydGrid) return
  const grid = hydGrid
  updateGridStats()
  if (fillResult) {
    fillStatsText.value = `抬升 ${fillResult.raisedCells} 格，最大 ${fillResult.maxRaise.toFixed(2)} m`
  }
  if (depResult) {
    depStatsText.value = `识别 ${depResult.identified} 个真实洼地，总蓄满容量 ${wm3Text(depResult.totalCapacity)}`
  }
  if (dirResult) {
    dirStatsText.value = `${dirResult.sinks} 个边界出口，流向箭头按 D8 着色`
  }
  if (runoffDepth && localVolume) {
    let precipSum = 0
    for (let i = 0; i < localVolume.length; i += 1) precipSum += localVolume[i]
    const { area } = cellMeters(grid)
    runoffStatsText.value = `均降水 ${meanMm(precipF as Float32Array).toFixed(1)} mm，产流体积 ${wm3Text(precipSum / detainShare.value)}（滞蓄系数 ${detainShare.value}）`
    void area
  }
  if (transitResult) {
    transitStatsText.value = `出口径流总量 ${wm3Text(transitResult.outflow)}，最大单格过水 ${(transitResult.outflow > 0 ? (transitValuesMax()) : 0).toFixed(0)} m³`
  }
  if (inunResult) {
    const maxDepth = maxFloat(inunResult.depth)
    floodStatsText.value =
      `淹没 ${inunResult.floodedCells.toLocaleString()} 格 / ${inunResult.floodedAreaKm2.toFixed(3)} km²，峰值水深 ${maxDepth.toFixed(2)} m`
    floodTitleText.value = inunResult.method === 'A' ? '方案 A：等体积平面淹没' : '方案 B：洼地蓄水 + 溢流'
  }
}

function refreshResultEntries(): void {
  if (!hydGrid) return
  const grid = hydGrid
  removeEntriesWithStepGreater(stage.value)
  putEntry('dem', {
    step: 1,
    title: 'DEM 高程',
    note: usedSamplingNote.value || (dataSource.value === 'synthetic' ? '模拟合成' : '真实地形采样'),
    raster: cellSnapshot(grid, grid.dem, 'DEM 高程（米）；可来自 Cesium World Terrain 真实采样或本地确定性模拟合成。EPSG:4326。')
  })
  if (stage.value >= 2 && fillResult) {
    putEntry('filldem', {
      step: 2,
      title: '填洼后 DEM',
      note: `抬升 ${fillResult.raisedCells} 格`,
      raster: cellSnapshot(grid, fillResult.filled, '洼地填平后的 DEM 高程（米），用于 D8 流向计算；EPSG:4326。')
    })
    const raiseValues = new Float32Array(grid.dem.length)
    for (let i = 0; i < raiseValues.length; i += 1) raiseValues[i] = fillResult.filled[i] - grid.dem[i]
    putEntry('raise', {
      step: 2,
      title: '洼地抬升量',
      note: `最大 ${fillResult.maxRaise.toFixed(2)} m`,
      raster: cellSnapshot(grid, raiseValues, '洼地填平抬升量（米），0 表示未抬升；EPSG:4326。')
    })
  }
  if (stage.value >= 2 && depResult) {
    const rings: { lon: number; lat: number }[][] = []
    const attrs: HydFeatureAttrs[] = []
    for (const dep of depResult.deps) {
      const ring = componentRingLonLat(grid, dep.cells)
      if (ring.length < 3) continue
      rings.push(ring)
      attrs.push({
        id: dep.id + 1,
        cells: dep.cells.length,
        capacity_m3: Math.round(dep.capacity),
        outlet_m: Math.round(dep.outletLevel * 100) / 100,
        min_m: Math.round(dep.minGround * 100) / 100
      })
    }
    if (rings.length > 0) {
      putEntry('depressions', {
        step: 2,
        title: '真实洼地边界',
        note: `${rings.length} 个蓄水区`,
        vector: { kind: 'Polygon', paths: rings, attrsList: attrs }
      })
    }
  }
  if (stage.value >= 3 && dirResult) {
    const values = new Float32Array(dirResult.dir.length)
    for (let i = 0; i < values.length; i += 1) values[i] = dirResult.dir[i]
    putEntry('dir', {
      step: 3,
      title: 'D8 流向编码',
      note: '0~7 = 北/东北/东/东南/南/西南/西/西北，-1 = 出水口',
      raster: cellSnapshot(grid, values, 'D8 流向编码栅格：0~7 对应北/东北/东/东南/南/西南/西/西北，-1 为边界出水口。')
    })
  }
  if (stage.value >= 4 && precipF && runoffDepth && localVolume) {
    putEntry('precip', {
      step: 4,
      title: '降水场',
      note: `${precipMode.value === 'uniform' ? '均匀降水' : '雨核+空间不均匀'} × 情景 ${scenario.value}`,
      raster: cellSnapshot(grid, precipF, '逐格累计降水量（毫米）。均匀模式全区恒定；雨核模式按高斯衰减并叠加空间不均匀噪声。')
    })
    putEntry('runoff', {
      step: 4,
      title: '产流深',
      note: runoffModel.value === 'cn' ? 'SCS-CN 曲线数法' : '径流系数法',
      raster: cellSnapshot(grid, runoffDepth, '逐格产流深（毫米），SCS-CN 或径流系数模型按分区下垫面参数计算。')
    })
  }
  if (stage.value >= 5 && transitResult) {
    const logValues = new Float32Array(transitResult.transit.length)
    for (let i = 0; i < logValues.length; i += 1) logValues[i] = Math.log10(1 + transitResult.transit[i])
    putEntry('transit', {
      step: 5,
      title: '汇流过境水量',
      note: `出口总量 ${wm3Text(transitResult.outflow)}`,
      raster: cellSnapshot(grid, logValues, '逐格过境水量对数（log10(1+m³)），反映沿 D8 的产水汇聚强度。')
    })
  }
  if (stage.value >= 6 && inunResult) {
    putEntry('flood-depth', {
      step: 6,
      title: '淹没水深',
      note: inunResult.method === 'A' ? '等体积平面淹没' : '洼地蓄水+溢流',
      raster: cellSnapshot(grid, inunResult.depth, `逐格淹没水深（米）。${inunResult.method === 'A' ? '方法A将全区产水量自低到高等体积灌水' : '方法B按 D8 汇流、洼地蓄满后向下游溢流'}。`)
    })
    const flooded = new Uint8Array(inunResult.depth.length)
    for (let i = 0; i < flooded.length; i += 1) flooded[i] = inunResult.depth[i] > 0.001 ? 1 : 0
    putEntry('flood-mask', {
      step: 6,
      title: '淹没范围掩膜',
      note: `${inunResult.floodedCells.toLocaleString()} 格`,
      raster: cellSnapshot(grid, new Float32Array(flooded), '淹没范围二值掩膜（1 = 水深>0）；EPSG:4326。')
    })
    const comps = floodComponents(grid, flooded)
    const rings: { lon: number; lat: number }[][] = []
    const attrs: HydFeatureAttrs[] = []
    for (const comp of comps) {
      const ring = componentRingLonLat(grid, comp)
      if (ring.length < 3) continue
      rings.push(ring)
      attrs.push({ comp: rings.length, cells: comp.length })
    }
    if (rings.length > 0) {
      putEntry('flood-boundary', {
        step: 6,
        title: '淹没范围边界',
        note: `${rings.length} 个独立水面`,
        vector: { kind: 'Polygon', paths: rings, attrsList: attrs }
      })
    }
  }
}

function computeDepthStats(): void {
  if (!hydGrid || !inunResult) {
    depthStatRows.value = []
    depthStatTotal.value = undefined
    return
  }
  const stats = classifyDepths(hydGrid, inunResult.depth, DEPTH_BREAKS)
  depthStatRows.value = stats.rows
  depthStatTotal.value = { cells: stats.totalCells, areaKm2: stats.totalAreaKm2 }
}

function simulateScenario(factor: number): { areaKm2: number; peakM: number; storedM3: number; outflowM3: number; precipM3: number } {
  if (!hydGrid || !localVolume) return { areaKm2: 0, peakM: 0, storedM3: 0, outflowM3: 0, precipM3: 0 }
  const grid = hydGrid
  const factorPrecip = buildPrecipField(precipAmount.value * factor)
  const values = zoneEnabled.value ? currentZoneValues() : [currentUniformValue()]
  const zones = zoneEnabled.value ? currentZoneGrid() : new Uint8Array(grid.cols * grid.rows)
  const depth = computeRunoffDepth(grid, runoffModel.value, factorPrecip, zones, values)
  const { area } = cellMeters(grid)
  const vol = new Float64Array(depth.length)
  let precipSum = 0
  for (let i = 0; i < depth.length; i += 1) {
    const v = (depth[i] / 1000) * area * detainShare.value
    vol[i] = v
    precipSum += v
  }
  if (inundationMethod.value === 'A') {
    const res = planAEqualVolumeFill(grid, vol, depth)
    return { areaKm2: res.floodedAreaKm2, peakM: maxFloat(res.depth), storedM3: res.storedVolume, outflowM3: res.outflowVolume, precipM3: precipSum }
  }
  if (!dirResult || !depResult) return { areaKm2: 0, peakM: 0, storedM3: 0, outflowM3: 0, precipM3: precipSum }
  const res = planBDepressionRouting(grid, dirResult.dir, depResult, vol)
  return { areaKm2: res.floodedAreaKm2, peakM: maxFloat(res.depth), storedM3: res.storedVolume, outflowM3: res.outflowVolume, precipM3: precipSum }
}

function refreshScenarioTable(): void {
  scenarioRows.value = scenarioSlots.map((factor) => {
    const sim = simulateScenario(factor)
    return { factor, precipM3: sim.precipM3, areaKm2: sim.areaKm2, peakM: sim.peakM, storedM3: sim.storedM3, outflowM3: sim.outflowM3 }
  })
}

function downloadScenarioCsv(): void {
  const lines = ['降水情景,产流体积(m³),淹没面积(km²),峰值水深(m),滞留水量(m³),出流(m³)']
  for (const row of scenarioRows.value) {
    lines.push(`${row.factor},${Math.round(row.precipM3)},${row.areaKm2.toFixed(4)},${row.peakM.toFixed(3)},${Math.round(row.storedM3)},${Math.round(row.outflowM3)}`)
  }
  downloadText(lines.join('\n'), 'flood-scenarios.csv', 'text/csv')
}

function downloadStatsCsv(): void {
  if (!hydGrid || !inunResult) return
  const stats = classifyDepths(hydGrid, inunResult.depth, DEPTH_BREAKS)
  downloadText(statsToCsv(stats, '区域淹没水深分级统计（淹没面积占比按淹没范围计）'), 'flood-stats.csv', 'text/csv')
}

function collectReport(): ReportModel {
  const now = new Date()
  const generatedAt = `${now.toLocaleDateString('zh-CN')} ${now.toLocaleTimeString('zh-CN')}`
  const sections: ReportSection[] = []
  const bounds = regionBounds.value
  const dataSourceLabel = dataSource.value === 'synthetic' ? '模拟 DEM 合成' : '真实地形采样（Cesium World Terrain）'
  const gridAvail = hydGrid !== undefined

  const regionKv: ReportKV[] = []
  if (bounds) regionKv.push({ label: '分析区域', value: regionExtentText(bounds) })
  else regionKv.push({ label: '分析区域', value: '尚未选择' })
  regionKv.push(
    { label: '数据源', value: dataSourceLabel },
    { label: '网格设置', value: samplingSummaryText() },
    { label: 'DEM 覆盖', value: gridAvail ? demCoverageText.value : '尚未生成 DEM' }
  )
  if (bounds && dataSource.value === 'terrain') {
    regionKv.push({ label: '无数据自动补齐', value: onoffText(demAutoFill.value) })
  }
  sections.push({ title: '一、区域与数据设置', kv: regionKv })

  if (dataSource.value === 'synthetic') {
    const demKv: ReportKV[] = [
      { label: '基准高程', value: `${synthP.baseAlt} m` },
      { label: '南北落差', value: `${synthP.southFall} m` },
      { label: '东西落差', value: `${synthP.eastFall} m` },
      { label: '谷线幅度 / 频率 / 角度', value: `${synthP.waveAmp} m / ${synthP.waveFreq} / ${Math.round((synthP.waveAngle * 180) / Math.PI)}°` },
      { label: '噪声幅度', value: `${synthP.noiseAmp} m` },
      { label: '真实洼地', value: `${synthP.poolCount} 个，深 ${synthP.poolDepth} m，尺寸 ${(synthP.poolSize * 100).toFixed(0)}%` },
      { label: '随机种子', value: String(synthP.seed) }
    ]
    if (bounds && stage.value > 0) {
      demKv.unshift({ label: 'DEM 高程范围', value: demRangeText.value })
    }
    sections.push({ title: '二、合成 DEM 参数', kv: demKv })
  }

  const modelKv: ReportKV[] = [
    { label: '填洼识别最小深度', value: `${minDepDepth.value.toFixed(1)} m` },
    { label: '降水模式', value: precipMode.value === 'uniform' ? '均匀降水' : '雨核 + 空间不均匀' },
    { label: '时段累计降水', value: `${precipAmount.value} mm` },
    { label: '当前降水情景系数', value: `${scenario.value}×` }
  ]
  if (precipMode.value === 'storm') {
    modelKv.push(
      { label: '雨核中心', value: `U ${stormCenterU.value.toFixed(2)} / V ${stormCenterV.value.toFixed(2)}` },
      { label: '雨核半径', value: `${stormRadius.value.toFixed(2)}` },
      { label: '不均匀度', value: `${stormUneven.value.toFixed(2)}` }
    )
  }
  if (runoffModel.value === 'cn') {
    modelKv.push({ label: '产流模型', value: 'SCS-CN 曲线数法' })
  } else {
    modelKv.push({ label: '产流模型', value: '径流系数法' })
  }
  if (zoneEnabled.value) {
    modelKv.push({ label: '下垫面分区', value: `Voronoi 模拟 ${zoneCount.value} 区，种子 ${zoneSeed.value}` })
    const values = currentZoneValues()
    const unit = runoffModel.value === 'cn' ? 'CN' : 'α'
    for (let i = 0; i < Math.min(zoneCount.value, ZONE_NAMES.length); i += 1) {
      modelKv.push({ label: `分区 ${ZONE_NAMES[i]}`, value: `${values[i]} (${unit})` })
    }
  } else {
    modelKv.push({
      label: runoffModel.value === 'cn' ? '全区 CN 值' : '全区径流系数',
      value: runoffModel.value === 'cn' ? `${uniformCn.value}` : `${uniformAlpha.value}`
    })
  }
  modelKv.push({ label: '淹没方案', value: inundationMethod.value === 'A' ? '方案 A · 等体积平面' : '方案 B · 洼地蓄水 + 溢流' })
  if (inundationMethod.value === 'B') modelKv.push({ label: '滞蓄系数', value: `${detainShare.value.toFixed(2)}` })
  sections.push({ title: '三、分析模型参数', kv: modelKv })

  const statKv: ReportKV[] = []
  if (gridAvail) {
    statKv.push({ label: '网格规模', value: gridInfoText.value })
    if (stage.value >= 2 && fillResult) statKv.push({ label: '填洼处理', value: fillStatsText.value })
    if (stage.value >= 2 && depResult) statKv.push({ label: '真实洼地', value: depStatsText.value })
    if (stage.value >= 3 && dirResult) statKv.push({ label: 'D8 流向', value: dirStatsText.value })
    if (stage.value >= 4 && runoffDepth && localVolume) statKv.push({ label: '降水与产流', value: runoffStatsText.value })
    if (stage.value >= 5 && transitResult) statKv.push({ label: '汇流演算', value: transitStatsText.value })
    if (stage.value >= 6 && inunResult) statKv.push({ label: '淹没模拟', value: `${floodTitleText.value}；${floodStatsText.value}` })
  } else {
    statKv.push({ label: '状态', value: '尚未生成 DEM，暂无可统计成果' })
  }
  sections.push({ title: '四、执行成果统计', kv: statKv })

  if (depthStatRows.value.length > 0 && depthStatTotal.value) {
    const rows = depthStatRows.value.map((row) => [row.label, row.areaKm2.toFixed(3), `${row.pct.toFixed(1)}%`])
    rows.push(['合计（淹没范围）', depthStatTotal.value.areaKm2.toFixed(3), '100%'])
    sections.push({
      title: '五、淹没水深分级统计',
      table: {
        caption: `淹没总范围 ${depthStatTotal.value.areaKm2.toFixed(3)} km²，按网格水深分级统计`,
        head: ['水深', '面积 km²', '占比'],
        body: rows
      }
    })
  }
  if (scenarioRows.value.length > 0) {
    sections.push({
      title: '六、降水情景对比',
      table: {
        caption: '在当前参数基础上按 0.7× / 1.0× / 1.3× 缩放降水总量重算',
        head: ['降水情景', '产流体积', '淹没面积 km²', '峰值水深 m', '滞留水量', '出流'],
        body: scenarioRows.value.map((row) => [
          `×${row.factor}`,
          wm3Text(row.precipM3),
          row.areaKm2.toFixed(3),
          row.peakM.toFixed(2),
          wm3Text(row.storedM3),
          wm3Text(row.outflowM3)
        ])
      }
    })
  }
  if (depResult && depResult.identified > 0) {
    const deps = depResult.deps.slice(0, 40)
    sections.push({
      title: '七、真实洼地明细',
      table: {
        caption: depResult.identified > deps.length ? `共识别 ${depResult.identified} 个洼地，仅列出前 ${deps.length} 个` : `共识别 ${depResult.identified} 个洼地`,
        head: ['编号', '像元数', '蓄满容量', '出口高程 m', '洼地低点 m'],
        body: deps.map((dep) => [dep.id + 1, dep.cells.length, wm3Text(dep.capacity), dep.outletLevel.toFixed(2), dep.minGround.toFixed(2)])
      }
    })
  }
  if (resultEntries.length > 0) {
    sections.push({
      title: '八、成果数据清单',
      table: {
        caption: '左侧「分析成果」面板中的全部可导出数据项',
        head: ['阶段', '成果名称', '说明'],
        body: resultEntries.map((entry) => [`S${entry.step}`, entry.title, entry.note])
      }
    })
  }

  return {
    generatedAt,
    intro:
      '本报告由「DEM+气象预报 · 区域产水与淹没预测」案例生成，汇总当前所选区域、参数配置与已执行步骤的统计结果。所有输入数据可由本地模拟合成，不依赖外部远端数据源，可离线复现同一场次。',
    sections
  }
}

function openReportPreview(): void {
  if (busy.value || stage.value === 0) return
  reportModel.value = collectReport()
}

function closeReport(): void {
  reportModel.value = null
}

function printReport(): void {
  if (!reportModel.value) return
  const win = window.open('', '_blank', 'width=920,height=1000')
  if (!win) {
    setStatus('浏览器已拦截打印窗口，请允许本页弹出窗口后重试；也可改用「下载 Word(.docx)」导出')
    return
  }
  win.document.write(buildReportStandaloneHtml(reportModel.value))
  win.document.close()
  win.focus()
  setTimeout(() => {
    try {
      win.print()
    } catch {
      setStatus('打印窗口已打开，请在其中选择「另存为 PDF」')
    }
  }, 400)
}

function buildReportStandaloneHtml(model: ReportModel): string {
  const escapeHtml = (value: string | number): string =>
    String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  let sectionsHtml = ''
  for (const section of model.sections) {
    sectionsHtml += `<h2>${escapeHtml(section.title)}</h2>`
    if (section.kv && section.kv.length > 0) {
      let kvHtml = ''
      for (const pair of section.kv) kvHtml += `<tr><th>${escapeHtml(pair.label)}</th><td>${escapeHtml(pair.value)}</td></tr>`
      sectionsHtml += `<table class="kv">${kvHtml}</table>`
    }
    if (section.table) {
      if (section.table.caption) sectionsHtml += `<p class="caption">${escapeHtml(section.table.caption)}</p>`
      let bodyHtml = '<tr>'
      for (const head of section.table.head) bodyHtml += `<th>${escapeHtml(head)}</th>`
      bodyHtml += '</tr>'
      for (const row of section.table.body) {
        bodyHtml += '<tr>'
        for (const cell of row) bodyHtml += `<td>${escapeHtml(cell)}</td>`
        bodyHtml += '</tr>'
      }
      sectionsHtml += `<table>${bodyHtml}</table>`
    }
    if (section.lines && section.lines.length > 0) {
      for (const line of section.lines) sectionsHtml += `<p>${escapeHtml(line)}</p>`
    }
  }
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>区域产水与淹没预测 · 分析报告</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif; color: #1e2f3d; }
  .page { max-width: 780px; margin: 0 auto; padding: 20px 6px; }
  h1 { font-size: 20px; margin: 0 0 4px; color: #17324d; }
  .meta { font-size: 11px; color: #6a7b8a; margin: 0 0 6px; }
  .intro { font-size: 12px; line-height: 1.7; color: #3b5061; margin: 0 0 6px; }
  h2 { font-size: 15px; color: #124c7d; margin: 16px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #cfe0ec; page-break-after: avoid; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; font-size: 11px; }
  th, td { border: 1px solid #b9c6d2; padding: 3px 7px; text-align: left; vertical-align: top; word-break: break-all; }
  th { background: #e8f1f8; color: #17324d; }
  table.kv th { width: 28%; background: #f2f7fb; }
  .caption { font-size: 11px; color: #5b6b7a; margin: 2px 0; }
  p { font-size: 12px; line-height: 1.7; }
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="page">
    <h1>区域产水与淹没预测 · 分析报告</h1>
    <p class="meta">生成时间：${escapeHtml(model.generatedAt)}</p>
    <p class="intro">${escapeHtml(model.intro)}</p>
    ${sectionsHtml}
  </div>
</body>
</html>`
}

async function exportReportDocx(): Promise<void> {
  if (busy.value || stage.value === 0) return
  const model = collectReport()
  const {
    AlignmentType,
    BorderStyle,
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType
  } = await import('docx')
  const cellParagraph = (text: string | number, header = false): InstanceType<typeof Paragraph> =>
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({
          text: String(text),
          bold: header,
          font: { name: '等线', eastAsia: '等线', ascii: 'Arial', hAnsi: 'Arial' },
          size: header ? 20 : 18
        })
      ]
    })
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = []
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: '区域产水与淹没预测 · 分析报告', bold: true, size: 40, font: { name: '等线', eastAsia: '等线', ascii: 'Arial', hAnsi: 'Arial' } })
      ],
      spacing: { after: 120 }
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `生成时间：${model.generatedAt}`, size: 18, color: '5B6B7A' })
      ],
      spacing: { after: 80 }
    }),
    new Paragraph({
      children: [
        new TextRun({ text: model.intro, size: 20, color: '3B5061' })
      ],
      spacing: { after: 120 }
    })
  )
  const cellBorders = {
    top: { style: BorderStyle.SINGLE, size: 4, color: 'B9C6D2' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'B9C6D2' },
    left: { style: BorderStyle.SINGLE, size: 4, color: 'B9C6D2' },
    right: { style: BorderStyle.SINGLE, size: 4, color: 'B9C6D2' }
  }
  for (const section of model.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: section.title, bold: true, size: 30 })],
        spacing: { before: 220, after: 100 }
      })
    )
    if (section.kv && section.kv.length > 0) {
      const table = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: cellBorders.top,
          bottom: cellBorders.bottom,
          left: cellBorders.left,
          right: cellBorders.right,
          insideHorizontal: cellBorders.top,
          insideVertical: cellBorders.left
        },
        rows: section.kv.map((pair) =>
          new TableRow({
            children: [
              new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, borders: cellBorders, children: [cellParagraph(pair.label, true)] }),
              new TableCell({ width: { size: 70, type: WidthType.PERCENTAGE }, borders: cellBorders, children: [cellParagraph(pair.value)] })
            ]
          })
        )
      })
      children.push(table)
    }
    if (section.table) {
      const head = new TableRow({
        children: section.table.head.map((cell) => new TableCell({ borders: cellBorders, shading: { fill: 'E8F1F8' }, children: [cellParagraph(cell, true)] }))
      })
      const body = section.table.body.map(
        (row) => new TableRow({ children: row.map((cell) => new TableCell({ borders: cellBorders, children: [cellParagraph(cell)] })) })
      )
      children.push(
        new Paragraph({
          children: [new TextRun({ text: section.table.caption, size: 16, color: '5B6B7A', italics: true })],
          spacing: { after: 60 }
        }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [head, ...body] })
      )
    }
    if (section.lines && section.lines.length > 0) {
      for (const line of section.lines) {
        children.push(new Paragraph({ children: [new TextRun({ text: line, size: 20 })], spacing: { after: 40 } }))
      }
    }
  }
  const wordDocument = new Document({
    creator: '区域产水与淹没预测',
    title: '区域产水与淹没预测 · 分析报告',
    sections: [{ children }]
  })
  const blob = await Packer.toBlob(wordDocument)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `flood-forecast-report-${nowStamp()}.docx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  setStatus('分析报告已生成，正在下载 Word(.docx) 文件')
}

function nowStamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

function rebuildVisibleLayers(): void {
  if (!hydGrid || !cornerH || !viewer || viewer.isDestroyed()) return
  buildBaseLayer()
  if (fillResult) buildRaiseLayer()
  if (depResult) buildDepEntities()
  if (dirResult) buildArrowLayer()
  if (zoneEnabled.value && zoneGridF) buildZoneLayer()
  if (precipF) buildRainLayer()
  if (runoffDepth) buildRunoffLayer()
  if (transitResult) buildTransitLayer()
  if (inunResult) buildWaterLayer()
  if (inunResult) buildFloodEntities()
  refreshStatsTexts()
  refreshResultEntries()
  computeDepthStats()
  if (stage.value >= 7) refreshScenarioTable()
  applyStageRendering()
}

function recomputeFromStep(from: number): boolean {
  if (!hydGrid || busy.value) return false
  busy.value = true
  try {
    syncComputeThrough(stage.value, from)
    rebuildVisibleLayers()
    busy.value = false
    return true
  } catch (error) {
    setStatus(`计算失败：${error instanceof Error ? error.message : String(error)}`)
    progress.value = 0
    busy.value = false
    return false
  }
}

async function rerunFromStep(target: number): Promise<void> {
  if (busy.value || !viewer || viewer.isDestroyed()) return
  const previousStage = stage.value
  if (target === 1) {
    const bounds = regionBounds.value
    if (!bounds) {
      setStatus('尚无分析区域，请先框选或使用示例区域')
      return
    }
    busy.value = true
    progress.value = 3
    setStatus(`正在按当前区域与数据参数重新生成 DEM…`)
    await yieldFrame()
    clearLayers()
    regionBounds.value = bounds
    const ok = await ensureStepDem()
    if (!ok) return
    if (previousStage > 1) {
      stage.value = previousStage
      if (recomputeFromStep(2)) {
        setStatus(`已从第 1 步起按当前参数重新分析（完成至步骤 ${previousStage}）`)
      }
    } else {
      setStatus('已按当前参数重新生成 DEM')
    }
    return
  }
  if (recomputeFromStep(target)) {
    stage.value = previousStage
    setStatus(`已从步骤 ${target} 起按当前参数重新分析（完成至步骤 ${previousStage}）`)
  }
}

async function executeStep(target: number): Promise<void> {
  if (!viewer || viewer.isDestroyed() || busy.value) return
  if (stage.value >= target) {
    await rerunFromStep(target)
    return
  }
  const ok = await ensureStepDem()
  if (!ok || !hydGrid) return
  if (stage.value >= target) return
  busy.value = true
  setStatus(`正在执行步骤 ${target}：${STEPS[target - 1].label.slice(3)}…`)
  progress.value = 80
  await yieldFrame()
  try {
    syncComputeThrough(target)
  } catch (error) {
    busy.value = false
    progress.value = 0
    setStatus(`步骤 ${target} 计算失败：${error instanceof Error ? error.message : String(error)}`)
    return
  }
  stage.value = target
  rebuildVisibleLayers()
  progress.value = 100
  busy.value = false
  if (target === 7) {
    refreshScenarioTable()
    setStatus('步骤 7 完成。水深分级统计与三档降水情景对比已更新')
  } else {
    setStatus(`${STEPS[target - 1].label} 完成`)
  }
}

function clearResult(): void {
  if (busy.value) return
  clearLayers()
  resetPickingFlags()
  setStatus('已清除分析结果，可点击「示例区域」或「框选区域」重新开始')
}

async function startAnalysis(bounds: HydBounds): Promise<void> {
  if (busy.value || !viewer || viewer.isDestroyed()) return
  clearLayers()
  resetPickingFlags()
  regionBounds.value = { west: bounds.west, east: bounds.east, south: bounds.south, north: bounds.north }
  await ensureStepDem()
}

function useExampleRegion(): void {
  if (!isLoaded.value || busy.value || !viewer) return
  void startAnalysis(EXAMPLE_BOUNDS)
}

function flyToBounds(bounds: HydBounds): void {
  if (!viewer) return
  const centerLon = (bounds.west + bounds.east) / 2
  const centerLat = (bounds.south + bounds.north) / 2
  const widthMeters = Cesium.Cartesian3.distance(
    Cesium.Cartesian3.fromDegrees(bounds.west, centerLat),
    Cesium.Cartesian3.fromDegrees(bounds.east, centerLat)
  )
  const heightMeters = Cesium.Cartesian3.distance(
    Cesium.Cartesian3.fromDegrees(centerLon, bounds.south),
    Cesium.Cartesian3.fromDegrees(centerLon, bounds.north)
  )
  const maxSpan = Math.max(widthMeters, heightMeters, 1000)
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, Math.max(1800, maxSpan * 2.4)),
    duration: 1.0
  })
}

function drawRegionPreview(cursorPosition?: Cesium.Cartesian3): void {
  if (!viewer || viewer.isDestroyed() || !rectStart) return
  if (draftEntity) {
    viewer.entities.remove(draftEntity)
    draftEntity = undefined
  }
  if (!cursorPosition) return
  const cursor = Cesium.Cartographic.fromCartesian(cursorPosition, viewer.scene.globe.ellipsoid)
  const lon = Cesium.Math.toDegrees(cursor.longitude)
  const lat = Cesium.Math.toDegrees(cursor.latitude)
  const bounds = {
    west: Math.min(rectStart.lon, lon),
    east: Math.max(rectStart.lon, lon),
    south: Math.min(rectStart.lat, lat),
    north: Math.max(rectStart.lat, lat)
  }
  const color = Cesium.Color.fromCssColorString('#ffcf5c')
  draftEntity = viewer.entities.add({
    polygon: rectPolygonOptions(regionRing(bounds), color)
  }) as unknown as Cesium.Entity
}

function startRectDraw(): void {
  if (!isLoaded.value || busy.value || !viewer) return
  resetPickingFlags()
  clearLayers()
  drawingRect.value = true
  setStatus('在地图上单击确定矩形区域一角，移动鼠标后再次单击完成框选')
}

function onLeftClick(event: { position: Cesium.Cartesian2 }): void {
  if (!viewer || !isLoaded.value) return
  const position = pickPosition(viewer.scene, event.position)
  if (!position) return
  if (drawingRect.value && !busy.value) {
    const carto = Cesium.Cartographic.fromCartesian(position, viewer.scene.globe.ellipsoid)
    if (!rectStart) {
      rectStart = { lon: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) }
      setStatus('已确定第一角，移动鼠标预览后再次单击完成框选')
      return
    }
    const lon = Cesium.Math.toDegrees(carto.longitude)
    const lat = Cesium.Math.toDegrees(carto.latitude)
    const bounds = {
      west: Math.min(rectStart.lon, lon),
      east: Math.max(rectStart.lon, lon),
      south: Math.min(rectStart.lat, lat),
      north: Math.max(rectStart.lat, lat)
    }
    drawingRect.value = false
    rectStart = undefined
    if (draftEntity) {
      viewer.entities.remove(draftEntity)
      draftEntity = undefined
    }
    if (bounds.east - bounds.west < 0.004 || bounds.north - bounds.south < 0.004) {
      setStatus('框选范围过小，请框选更大范围（约 0.005° 以上）')
      return
    }
    setStatus('正在对框选区域构建 DEM 并执行分析…')
    void startAnalysis(bounds)
  }
}

function onMouseMove(event: { endPosition: Cesium.Cartesian2 }): void {
  if (!viewer || !drawingRect.value || busy.value) return
  const position = pickPosition(viewer.scene, event.endPosition)
  if (position) drawRegionPreview(position)
}

function onRightClick(): void {
  if (drawingRect.value) {
    drawingRect.value = false
    rectStart = undefined
    if (draftEntity && viewer) {
      viewer.entities.remove(draftEntity)
      draftEntity = undefined
    }
    setStatus('已取消框选')
  }
}

async function mountScene(): Promise<void> {
  if (!container.value) return
  const callbacks: SceneCallbacks = {
    onStatus: setStatus,
    onBasemapReady: () => { setStatus('正在加载 Cesium World Terrain…') }
  }
  try {
    viewer = createMapScene(container.value, callbacks)
    loadBingImagery(viewer, callbacks)
    try {
      await loadWorldTerrain(viewer)
      terrainReady.value = true
    } catch {
      setStatus('真实地形加载失败，已启用模拟 DEM 合成模式，可直接分析演示')
    }
    if (!viewer || viewer.isDestroyed()) return
    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((event: { position: Cesium.Cartesian2 }) => onLeftClick(event), Cesium.ScreenSpaceEventType.LEFT_CLICK)
    handler.setInputAction((event: { endPosition: Cesium.Cartesian2 }) => onMouseMove(event), Cesium.ScreenSpaceEventType.MOUSE_MOVE)
    handler.setInputAction(() => onRightClick(), Cesium.ScreenSpaceEventType.RIGHT_CLICK)
    isLoaded.value = true
    await useExampleRegion()
    flyToBounds(EXAMPLE_BOUNDS)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error))
  }
}

function scheduleRestart(): void {
  if (busy.value) return
  const bounds = regionBounds.value
  if (!bounds) return
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    if (regionBounds.value) void startAnalysis(regionBounds.value)
  }, 500)
}
let restartTimer: ReturnType<typeof setTimeout> | undefined

watch(dataSource, () => {
  if (!busy.value) scheduleRestart()
})
watch([resolutionDim], () => {
  if (!busy.value && regionBounds.value) scheduleRestart()
})
watch([samplingMode, spacingMeters], () => {
  if (!busy.value && regionBounds.value) scheduleRestart()
})
watch(
  () => ({ ...synthP }),
  () => {
    if (!busy.value && dataSource.value === 'synthetic') scheduleRestart()
  }
)

watch(minDepDepth, () => {
  if (!busy.value && stage.value >= 2) recomputeFromStep(2)
})
watch([arrowStride, arrowAlpha], () => {
  if (!busy.value && stage.value >= 3) {
    buildArrowLayer()
    applyStageRendering()
  }
})
watch([runoffModel, uniformCn, uniformAlpha, zoneEnabled, zoneCount, zoneSeed], () => {
  if (!busy.value && stage.value >= 4) recomputeFromStep(4)
})
watch(
  () => ({ precipMode, precipAmount, scenario, stormCenterU, stormCenterV, stormRadius, stormUneven, stormSeed, detainShare }),
  () => {
    if (!busy.value && stage.value >= 4) recomputeFromStep(4)
  }
)
watch(
  () => ({ cn: zoneCnValues.slice(), alpha: zoneAlphaValues.slice() }),
  () => {
    if (!busy.value && stage.value >= 4 && zoneEnabled.value) recomputeFromStep(4)
  }
)
watch(inundationMethod, () => {
  if (!busy.value && stage.value >= 6) recomputeFromStep(6)
})

watch(
  [
    demVisible,
    raiseVisible,
    depVisible,
    arrowVisible,
    zoneVisible,
    rainVisible,
    runoffVisible,
    transitVisible,
    waterVisible,
    boundaryVisible,
    regionRectVisible
  ],
  () => {
    if (!busy.value) applyStageRendering()
  }
)

watch([baseOpacity, zoneOpacity, rainOpacity, runoffOpacity, transitOpacity, waterOpacity], () => {
  if (!busy.value && hydGrid) {
    rebuildVisibleLayers()
  }
})

watch(demAutoFill, () => {
  if (!busy.value && stage.value >= 1 && dataSource.value === 'terrain') {
    const bounds = regionBounds.value
    if (bounds) void startAnalysis(bounds)
  }
})

onBeforeUnmount(() => {
  analysisRun += 1
  clearTimeout(restartTimer)
  handler?.destroy()
  handler = undefined
  if (viewer && !viewer.isDestroyed()) {
    removeLayerPrims()
    removeEntities(depEntities)
    removeEntities(floodEntities)
    if (regionRectEntity) viewer.entities.remove(regionRectEntity)
    if (draftEntity) viewer.entities.remove(draftEntity)
  }
  destroyScene(viewer)
  viewer = undefined
})

onMounted(() => { void mountScene() })
</script>

<template>
  <div class="fy-shell">
    <div ref="container" class="cesium-container"></div>

    <div v-if="resultsPanelOpen && resultEntries.length > 0" class="results-panel">
      <div class="results-head">
        <span class="results-title">分析成果 <em class="results-count">{{ resultEntries.length }}</em></span>
        <button class="collapse-btn" title="收起成果面板" @click="resultsPanelOpen = false">—</button>
      </div>
      <div class="results-body">
        <div v-for="entry in resultEntries" :key="entry.key" class="result-item">
          <div class="ri-title">
            <b class="ri-step">S{{ entry.step }}</b>
            <span class="ri-name">{{ entry.title }}</span>
            <label class="ri-eye" :title="layerVisibleByEntry(entry.key) ? '在地图上隐藏该图层' : '在地图上显示该图层'">
              <input
                type="checkbox"
                :checked="layerVisibleByEntry(entry.key)"
                @change="setLayerVisibleByEntry(entry.key, ($event.target as HTMLInputElement).checked)"
              />
              <span>{{ layerVisibleByEntry(entry.key) ? '显示' : '隐藏' }}</span>
            </label>
          </div>
          <div class="ri-note">{{ entry.note }}</div>
          <div class="ri-actions">
            <button v-if="entry.raster" class="export-btn" title="栅格导出 GeoTIFF（含地理坐标与说明）" @click="exportEntryRaster(entry)">TIF</button>
            <button v-if="entry.vector" class="export-btn" title="矢量导出 GeoJSON（含属性字段）" @click="exportEntryVector(entry, 'geojson')">GeoJSON</button>
            <button v-if="entry.vector" class="export-btn" title="矢量导出 SHP（shp+dbf 打包 zip，含属性）" @click="exportEntryVector(entry, 'shp')">SHP</button>
          </div>
        </div>
      </div>
    </div>
    <button v-if="!resultsPanelOpen && resultEntries.length > 0" class="results-reopen" title="展开成果面板" @click="resultsPanelOpen = true">成果 {{ resultEntries.length }}</button>

    <div class="control-panel">
      <div class="panel-title-row">
        <span class="panel-title">DEM+气象预报 · 区域产水与淹没预测</span>
        <button class="route-info-btn" title="查看模块整体技术路线说明" @click="infoOpen = true">技术路线</button>
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
        <input v-model.number="spacingMeters" type="number" min="20" max="2000" step="10" :disabled="busy" />
      </div>
      <p v-if="stage > 0" class="sampling-note">{{ usedSamplingNote }}</p>
      <label v-if="stage > 0" class="switch-row"><span>显示范围框</span><input v-model="regionRectVisible" type="checkbox" /></label>
      <button v-if="stage > 0" class="action-button danger" :disabled="busy" @click="clearResult">清除结果</button>
      <p v-if="drawingRect" class="result">单击第一角 → 移动 → 再次单击完成框选；右键取消</p>

      <div class="section-title">数据源</div>
      <div class="mode-row">
        <button class="mode-button" :class="{ active: dataSource === 'synthetic' }" :disabled="busy" @click="dataSource = 'synthetic'">模拟 DEM 合成</button>
        <button class="mode-button" :class="{ active: dataSource === 'terrain' }" :disabled="busy || !terrainReady" @click="dataSource = 'terrain'">真实地形采样</button>
      </div>
      <p v-if="dataSource === 'terrain' && !terrainReady" class="sampling-note">Cesium World Terrain 未就绪，暂不可用</p>
      <template v-if="dataSource === 'synthetic'">
        <div class="control-row">
          <span class="row-label">基准高程</span>
          <input v-model.number="synthP.baseAlt" type="number" min="0" max="2000" step="10" :disabled="busy" />
          <span class="row-value">{{ synthP.baseAlt }} m</span>
        </div>
        <div class="control-row">
          <span class="row-label">南北落差</span>
          <input v-model.number="synthP.southFall" type="range" min="0" max="400" step="5" :disabled="busy" />
          <span class="row-value">{{ synthP.southFall }} m</span>
        </div>
        <div class="control-row">
          <span class="row-label">东西落差</span>
          <input v-model.number="synthP.eastFall" type="range" min="0" max="200" step="5" :disabled="busy" />
          <span class="row-value">{{ synthP.eastFall }} m</span>
        </div>
        <div class="control-row">
          <span class="row-label">谷线幅度</span>
          <input v-model.number="synthP.waveAmp" type="range" min="0" max="200" step="2" :disabled="busy" />
          <span class="row-value">{{ synthP.waveAmp }} m</span>
        </div>
        <div class="control-row">
          <span class="row-label">谷线频率</span>
          <input v-model.number="synthP.waveFreq" type="range" min="1" max="10" step="0.5" :disabled="busy" />
          <span class="row-value">{{ synthP.waveFreq }}</span>
        </div>
        <div class="control-row">
          <span class="row-label">谷线角度</span>
          <input v-model.number="synthP.waveAngle" type="range" min="0" max="3.14" step="0.01" :disabled="busy" />
          <span class="row-value">{{ Math.round((synthP.waveAngle * 180) / Math.PI) }}°</span>
        </div>
        <div class="control-row">
          <span class="row-label">噪声幅度</span>
          <input v-model.number="synthP.noiseAmp" type="range" min="0" max="20" step="0.5" :disabled="busy" />
          <span class="row-value">{{ synthP.noiseAmp }} m</span>
        </div>
        <div class="control-row">
          <span class="row-label">真实洼地数量</span>
          <input v-model.number="synthP.poolCount" type="range" min="0" max="8" step="1" :disabled="busy" />
          <span class="row-value">{{ synthP.poolCount }}</span>
        </div>
        <div class="control-row">
          <span class="row-label">洼地深度</span>
          <input v-model.number="synthP.poolDepth" type="range" min="0" max="80" step="1" :disabled="busy" />
          <span class="row-value">{{ synthP.poolDepth }} m</span>
        </div>
        <div class="control-row">
          <span class="row-label">洼地尺寸</span>
          <input v-model.number="synthP.poolSize" type="range" min="0.02" max="0.25" step="0.01" :disabled="busy" />
          <span class="row-value">{{ synthP.poolSize.toFixed(2) }}</span>
        </div>
        <div class="control-row">
          <span class="row-label">随机种子</span>
          <input v-model.number="synthP.seed" type="number" min="0" max="9999" step="1" :disabled="busy" />
          <span class="row-value">{{ synthP.seed }}</span>
        </div>
      </template>

      <div class="section-title">逐步分析</div>
      <p v-if="stage > 0" class="sampling-note">修改参数后，点击任一已完成步骤，即可按当前参数从该步骤重新分析。</p>
      <div class="step-list">
        <div v-for="stepItem in STEPS" :key="stepItem.key" class="step-item">
          <button
            class="step-button"
            :class="{ done: stage >= stepItem.key, current: stage === stepItem.key - 1 }"
            :title="stage >= stepItem.key ? '已执行。点击将按当前参数从该步骤起重新分析' : '执行该步骤'"
            :disabled="!isLoaded || busy || (stepItem.key > 1 && stage === 0)"
            @click="executeStep(stepItem.key)"
          >
            <span class="step-check">{{ stage >= stepItem.key ? '✓' : '' }}</span>
            <span class="step-label">{{ stepItem.label }}</span>
            <span v-if="stage >= stepItem.key" class="step-rerun">重算</span>
          </button>
          <button class="help-button" :class="{ active: activeHelpKey === stepItem.key }" title="查看本步原理与实现说明" @click="toggleHelp(stepItem.key)">?</button>
        </div>
      </div>
      <div v-if="activeHelp" class="help-box">
        <div class="help-head">
          <span class="help-title">{{ activeHelp.title }}</span>
          <button class="help-close" title="收起说明" @click="activeHelpKey = undefined">×</button>
        </div>
        <p class="help-p"><b>原理：</b>{{ activeHelp.principle }}</p>
        <p class="help-p"><b>实现：</b>{{ activeHelp.implementation }}</p>
        <p class="help-p"><b>成果：</b>{{ activeHelp.outputs }}</p>
      </div>

      <template v-if="stage >= 1">
        <div class="section-title">DEM 图层</div>
        <label class="switch-row"><span>显示 DEM</span><input v-model="demVisible" type="checkbox" /></label>
        <div class="control-row">
          <span class="row-label">透明度</span>
          <input v-model.number="baseOpacity" type="range" min="0.3" max="1" step="0.05" />
          <span class="row-value">{{ baseOpacity.toFixed(2) }}</span>
        </div>
        <p class="stat-note">覆盖：{{ demCoverageText }}</p>
        <label v-if="dataSource === 'terrain'" class="switch-row">
          <span>自动补齐无数据</span>
          <input v-model="demAutoFill" type="checkbox" />
        </label>
        <p v-if="dataSource === 'terrain' && demAutoFill" class="sampling-note">真实高程缺失区将以相邻有效高程外推填充，导出完整无空洞。</p>
      </template>

      <template v-if="stage >= 2">
        <div class="section-title">洼地识别参数</div>
        <div class="control-row">
          <span class="row-label">最小深度</span>
          <input v-model.number="minDepDepth" type="range" min="0.1" max="5" step="0.1" />
          <span class="row-value">{{ minDepDepth.toFixed(1) }} m</span>
        </div>
        <label class="switch-row"><span>抬升量</span><input v-model="raiseVisible" type="checkbox" /></label>
        <label class="switch-row"><span>洼地边界</span><input v-model="depVisible" type="checkbox" /></label>
      </template>

      <template v-if="stage >= 3">
        <div class="section-title">流向图层</div>
        <label class="switch-row"><span>显示 D8 流向</span><input v-model="arrowVisible" type="checkbox" /></label>
        <div class="control-row">
          <span class="row-label">箭头密度</span>
          <select v-model.number="arrowStride">
            <option v-for="option in ARROW_STRIDE_OPTIONS" :key="option" :value="option">每 {{ option }} 格</option>
          </select>
        </div>
        <div class="control-row">
          <span class="row-label">透明度</span>
          <input v-model.number="arrowAlpha" type="range" min="0.3" max="1" step="0.05" />
          <span class="row-value">{{ arrowAlpha.toFixed(2) }}</span>
        </div>
      </template>

      <template v-if="stage >= 4">
        <div class="section-title">降水分布</div>
        <div class="mode-row">
          <button class="mode-button" :class="{ active: precipMode === 'uniform' }" @click="precipMode = 'uniform'">均匀降水</button>
          <button class="mode-button" :class="{ active: precipMode === 'storm' }" @click="precipMode = 'storm'">雨核+不均匀</button>
        </div>
        <div class="control-row">
          <span class="row-label">时段累计/峰值</span>
          <input v-model.number="precipAmount" type="range" min="5" max="300" step="5" />
          <span class="row-value">{{ precipAmount }} mm</span>
        </div>
        <div v-if="precipMode === 'storm'" class="control-row">
          <span class="row-label">雨核中心X</span>
          <input v-model.number="stormCenterU" type="range" min="0.05" max="0.95" step="0.01" />
          <span class="row-value">{{ stormCenterU.toFixed(2) }}</span>
        </div>
        <div v-if="precipMode === 'storm'" class="control-row">
          <span class="row-label">雨核中心Y</span>
          <input v-model.number="stormCenterV" type="range" min="0.05" max="0.95" step="0.01" />
          <span class="row-value">{{ stormCenterV.toFixed(2) }}</span>
        </div>
        <div v-if="precipMode === 'storm'" class="control-row">
          <span class="row-label">雨核半径</span>
          <input v-model.number="stormRadius" type="range" min="0.05" max="0.8" step="0.01" />
          <span class="row-value">{{ stormRadius.toFixed(2) }}</span>
        </div>
        <div v-if="precipMode === 'storm'" class="control-row">
          <span class="row-label">不均匀度</span>
          <input v-model.number="stormUneven" type="range" min="0" max="0.5" step="0.01" />
          <span class="row-value">{{ stormUneven.toFixed(2) }}</span>
        </div>
        <label class="switch-row"><span>降水图层</span><input v-model="rainVisible" type="checkbox" /></label>

        <div class="section-title">下垫面与产流</div>
        <div class="mode-row">
          <button class="mode-button" :class="{ active: runoffModel === 'cn' }" @click="runoffModel = 'cn'">SCS-CN</button>
          <button class="mode-button" :class="{ active: runoffModel === 'alpha' }" @click="runoffModel = 'alpha'">径流系数</button>
        </div>
        <label class="switch-row">
          <span>分区下垫面(Voronoi 模拟)</span>
          <input v-model="zoneEnabled" type="checkbox" />
        </label>
        <template v-if="zoneEnabled">
          <div class="control-row">
            <span class="row-label">分区数</span>
            <input v-model.number="zoneCount" type="range" min="2" max="6" step="1" />
            <span class="row-value">{{ zoneCount }}</span>
          </div>
          <div class="control-row">
            <span class="row-label">分区种子</span>
            <input v-model.number="zoneSeed" type="number" min="0" max="9999" step="1" />
            <span class="row-value">{{ zoneSeed }}</span>
          </div>
          <div class="zone-table">
            <div v-for="index in zoneCount" :key="index" class="zone-row">
              <span class="zone-name">{{ ZONE_NAMES[index - 1] }}</span>
              <span v-if="runoffModel === 'cn'" class="zone-edit">
                <input v-model.number="zoneCnValues[index - 1]" type="number" min="20" max="100" step="1" />
                <span class="unit">CN</span>
              </span>
              <span v-else class="zone-edit">
                <input v-model.number="zoneAlphaValues[index - 1]" type="number" min="0" max="1" step="0.01" />
                <span class="unit">α</span>
              </span>
            </div>
          </div>
          <label class="switch-row"><span>分区图层</span><input v-model="zoneVisible" type="checkbox" /></label>
        </template>
        <template v-else>
          <div v-if="runoffModel === 'cn'" class="control-row">
            <span class="row-label">CN 值</span>
            <input v-model.number="uniformCn" type="number" min="20" max="100" step="1" />
            <span class="row-value">{{ uniformCn }}</span>
          </div>
          <div v-else class="control-row">
            <span class="row-label">径流系数</span>
            <input v-model.number="uniformAlpha" type="number" min="0" max="1" step="0.01" />
            <span class="row-value">{{ uniformAlpha }}</span>
          </div>
        </template>
        <label class="switch-row"><span>产流深图层</span><input v-model="runoffVisible" type="checkbox" /></label>
        <div class="control-row">
          <span class="row-label">降水情景系数</span>
          <span class="row-value region-value">
            <span v-for="slot in scenarioSlots" :key="slot" class="scenario-chip" :class="{ active: scenario === slot }" @click="scenario = slot">{{ slot }}</span>
          </span>
        </div>
      </template>

      <template v-if="stage >= 5">
        <div class="section-title">汇流演算</div>
        <label class="switch-row"><span>过境水量图层</span><input v-model="transitVisible" type="checkbox" /></label>
      </template>

      <template v-if="stage >= 6">
        <div class="section-title">淹没方案</div>
        <div class="mode-row">
          <button class="mode-button" :class="{ active: inundationMethod === 'A' }" @click="inundationMethod = 'A'">A 等体积平面</button>
          <button class="mode-button" :class="{ active: inundationMethod === 'B' }" @click="inundationMethod = 'B'">B 洼地蓄水+溢流</button>
        </div>
        <div class="control-row">
          <span class="row-label">滞蓄系数</span>
          <input v-model.number="detainShare" type="range" min="0.1" max="1" step="0.05" />
          <span class="row-value">{{ detainShare.toFixed(2) }}</span>
        </div>
        <p class="stat-note">滞蓄系数近似扣除蒸散、下渗与区域外排水比例后参与调蓄的产水份额。</p>
        <label class="switch-row"><span>水深图层</span><input v-model="waterVisible" type="checkbox" /></label>
        <label class="switch-row"><span>水面边界</span><input v-model="boundaryVisible" type="checkbox" /></label>
      </template>

      <template v-if="stage >= 7">
        <div class="section-title">淹没分级统计</div>
        <table v-if="depthStatTotal" class="stat-table">
          <thead><tr><th>水深</th><th>面积 km²</th><th>占比</th></tr></thead>
          <tbody>
            <tr v-for="row in depthStatRows" :key="row.label">
              <td><i class="dot" :style="{ background: row.color }"></i>{{ row.label }}</td>
              <td>{{ row.areaKm2.toFixed(3) }}</td>
              <td>{{ row.pct.toFixed(1) }}%</td>
            </tr>
            <tr class="total-row">
              <td>合计</td>
              <td>{{ depthStatTotal.areaKm2.toFixed(3) }}</td>
              <td>100%</td>
            </tr>
          </tbody>
        </table>
        <div class="button-row">
          <button class="action-button primary" :disabled="depthStatTotal === undefined" @click="downloadStatsCsv">统计 CSV</button>
          <button class="action-button accent" :disabled="scenarioRows.length === 0" @click="downloadScenarioCsv">情景 CSV</button>
        </div>
        <table v-if="scenarioRows.length > 0" class="scenario-table">
          <thead><tr><th>情景</th><th>淹没 km²</th><th>峰深 m</th></tr></thead>
          <tbody>
            <tr v-for="row in scenarioRows" :key="row.factor">
              <td>×{{ row.factor }}</td>
              <td>{{ row.areaKm2.toFixed(3) }}</td>
              <td>{{ row.peakM.toFixed(2) }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <template v-if="stage > 0">
        <div class="section-title">统计</div>
        <p class="stat-line">网格：{{ gridInfoText }}</p>
        <p class="stat-line">DEM：{{ demRangeText }}</p>
        <p v-if="stage >= 2" class="stat-line">填洼：{{ fillStatsText }}</p>
        <p v-if="stage >= 2" class="stat-line">洼地：{{ depStatsText }}</p>
        <p v-if="stage >= 3" class="stat-line">流向：{{ dirStatsText }}</p>
        <p v-if="stage >= 4" class="stat-line">产流：{{ runoffStatsText }}</p>
        <p v-if="stage >= 5" class="stat-line">汇流：{{ transitStatsText }}</p>
        <p v-if="stage >= 6" class="stat-note">{{ floodTitleText }}</p>
        <p v-if="stage >= 6" class="stat-note">{{ floodStatsText }}</p>
      </template>

      <div class="section-title">整体分析报告</div>
      <div class="button-row">
        <button class="action-button primary" :disabled="stage === 0 || busy" @click="openReportPreview">预览 / 打印 PDF</button>
        <button class="action-button accent" :disabled="stage === 0 || busy" @click="exportReportDocx">下载 Word(.docx)</button>
      </div>

      <p class="hint">流程：数据(真实/模拟) → 填洼与真实洼地识别 → D8 流向 → 降水+下垫面产流 → 汇流演算 → 淹没模拟(等体积平面/洼地蓄水+溢流) → 分级统计与导出。各类参数均可调，涉及数据均可一键生成模拟场，不依赖外部数据。</p>
    </div>

    <div v-if="busy" class="progress-mask">
      <span v-if="statusMessage" class="progress-status">{{ statusMessage }}</span>
      <div class="progress-bar"><i :style="{ width: `${progress}%` }"></i></div>
      <span class="progress-percent">{{ progress }}%</span>
    </div>

    <div v-if="legendVisible && stage > 0" class="legend">
      <div class="legend-gradient" :style="{ background: demCss }"></div>
      <span>DEM 低→高</span>
      <template v-if="stage >= 2 && raiseVisible">
        <div class="legend-gradient" :style="{ background: raiseCss }"></div>
        <span>抬升量</span>
      </template>
      <template v-if="stage >= 3 && arrowVisible">
        <div class="legend-chips">
          <span v-for="(color, index) in DIR_COLORS" :key="index" class="chip" :style="{ background: color }" :title="ARROW_DIRECTIONS[index]" />
        </div>
      </template>
      <template v-if="stage >= 4 && rainVisible">
        <div class="legend-gradient" :style="{ background: rainCss }"></div>
        <span>降水 mm</span>
      </template>
      <template v-if="stage >= 4 && runoffVisible">
        <div class="legend-gradient" :style="{ background: runoffCss }"></div>
        <span>产流 mm</span>
      </template>
      <template v-if="stage >= 5 && transitVisible">
        <div class="legend-gradient" :style="{ background: transitCss }"></div>
        <span>过水量 log</span>
      </template>
      <template v-if="stage >= 6 && waterVisible">
        <div class="legend-gradient" :style="{ background: depthCss }"></div>
        <span>水深 m</span>
      </template>
    </div>

    <div v-if="statusMessage && !busy" class="status-mask">{{ statusMessage }}</div>

    <div v-if="reportModel" class="report-backdrop">
      <div class="report-toolbar">
        <span class="report-toolbar-title">整体分析报告 · 预览与导出</span>
        <span class="report-actions">
          <button class="report-btn" @click="printReport">打印 / 另存为 PDF</button>
          <button class="report-btn accent" @click="exportReportDocx">下载 Word(.docx)</button>
          <button class="report-close" title="关闭预览" @click="closeReport">×</button>
        </span>
      </div>
      <div class="report-doc">
        <h1 class="report-h1">区域产水与淹没预测 · 分析报告</h1>
        <p class="report-meta">生成时间：{{ reportModel.generatedAt }}</p>
        <p class="report-intro">{{ reportModel.intro }}</p>
        <template v-for="section in reportModel.sections" :key="section.title">
          <h2 class="report-h2">{{ section.title }}</h2>
          <dl v-if="section.kv && section.kv.length > 0" class="report-kv">
            <template v-for="pair in section.kv" :key="pair.label">
              <dt>{{ pair.label }}</dt>
              <dd>{{ pair.value }}</dd>
            </template>
          </dl>
          <table v-if="section.table" class="report-table">
            <caption v-if="section.table.caption" class="report-caption">{{ section.table.caption }}</caption>
            <thead>
              <tr><th v-for="cell in section.table.head" :key="cell">{{ cell }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in section.table.body" :key="rowIndex">
                <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
              </tr>
            </tbody>
          </table>
          <p v-for="(line, lineIndex) in section.lines || []" :key="lineIndex" class="report-line">{{ line }}</p>
        </template>
      </div>
    </div>

    <div v-if="infoOpen" class="route-overlay" @click.self="infoOpen = false">
      <div class="route-modal">
        <div class="route-head">
          <span class="route-title">{{ ROUTE_OVERVIEW.title }}</span>
          <button class="help-close route-close" title="关闭技术路线说明" @click="infoOpen = false">×</button>
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
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 5px; width: 284px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; box-sizing: border-box; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 26, 44, 0.92); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
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
.step-list { display: flex; flex-direction: column; gap: 4px; }
.step-button { display: flex; align-items: center; gap: 7px; min-height: 27px; padding: 0 8px; border: 1px solid rgba(137, 210, 233, 0.22); border-radius: 5px; background: rgba(21, 48, 78, 0.6); color: #b9d6e4; cursor: pointer; font-size: 11px; text-align: left; }
.step-button.done { border-color: rgba(45, 212, 160, 0.5); color: #9df0d8; background: rgba(15, 66, 57, 0.5); }
.step-button.current { border-color: rgba(255, 199, 92, 0.7); }
.step-button:disabled { cursor: default; opacity: 0.5; }
.step-check { flex: 0 0 13px; text-align: center; color: #2ad4a0; font-weight: 700; }
.result { margin: 2px 0 0; padding: 5px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; background: rgba(250, 173, 20, 0.18); color: #ffd666; text-align: center; }
.switch-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; color: #c3d8e6; }
.switch-row input, .control-row input[type="color"] { cursor: pointer; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 2px 0; color: #c3d8e6; }
.row-label { flex: 0 0 auto; }
.row-value { flex: 0 0 44px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
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
.legend { position: absolute; bottom: 12px; left: 50%; z-index: 8; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; max-width: 92%; transform: translateX(-50%); padding: 6px 9px; border: 1px solid rgba(137, 210, 233, 0.25); border-radius: 6px; background: rgba(8, 26, 44, 0.82); color: #bcd7e4; font-size: 10px; }
.legend-gradient { width: 70px; height: 8px; border-radius: 4px; }
.legend-chips { display: flex; gap: 3px; align-items: center; padding-left: 2px; border-left: 1px solid rgba(137, 210, 233, 0.22); }
.chip { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 420px; padding: 8px 14px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
.mode-row { display: flex; gap: 4px; }
.mode-button { flex: 1; min-height: 24px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 5px; background: rgba(21, 48, 78, 0.55); color: #b9d6e4; cursor: pointer; font-size: 11px; }
.mode-button.active { border-color: rgba(47, 128, 237, 0.9); background: rgba(47, 128, 237, 0.28); color: #fff; }
.mode-button:disabled { cursor: default; opacity: 0.5; }
.sampling-note { margin: 1px 0 0; font-size: 10px; color: #7fd0e6; }
.step-item { display: flex; align-items: stretch; gap: 4px; }
.step-item .step-button { flex: 1; }
.help-button { flex: 0 0 24px; width: 24px; min-height: 27px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 5px; background: rgba(21, 48, 78, 0.6); color: #7fd0e6; cursor: pointer; font-size: 13px; font-weight: 700; line-height: 1; }
.help-button.active { border-color: rgba(255, 199, 92, 0.9); background: rgba(255, 199, 92, 0.2); color: #ffd666; }
.help-box { margin-top: 6px; padding: 8px 9px; border: 1px solid rgba(255, 199, 92, 0.5); border-radius: 6px; background: rgba(74, 58, 12, 0.32); color: #e9d9ae; }
.help-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px; }
.help-title { font-size: 11px; font-weight: 700; color: #ffd666; }
.help-close { border: 0; background: transparent; color: #cbb98a; cursor: pointer; font-size: 14px; line-height: 1; }
.help-p { margin: 3px 0 0; font-size: 10px; line-height: 1.55; color: #d9cdab; }
.results-panel { position: absolute; top: 12px; left: 12px; z-index: 8; display: flex; flex-direction: column; width: 252px; max-height: calc(100% - 24px); padding: 9px; box-sizing: border-box; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 26, 44, 0.92); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.results-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 5px; border-bottom: 1px solid rgba(137, 210, 233, 0.16); }
.results-title { font-weight: 700; color: #7fd0e6; }
.results-count { display: inline-block; min-width: 16px; margin-left: 4px; padding: 0 4px; border-radius: 8px; background: rgba(47, 128, 237, 0.4); color: #fff; font-size: 10px; font-style: normal; text-align: center; }
.collapse-btn { border: 0; background: transparent; color: #7fd0e6; cursor: pointer; font-size: 14px; line-height: 1; }
.results-body { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; padding-top: 6px; }
.result-item { padding: 5px 6px; border: 1px solid rgba(137, 210, 233, 0.16); border-radius: 6px; background: rgba(21, 48, 78, 0.35); }
.ri-title { display: flex; align-items: center; gap: 6px; }
.ri-step { flex: 0 0 auto; padding: 0 4px; border-radius: 4px; background: rgba(47, 128, 237, 0.35); color: #cfe7ff; font-size: 9px; }
.ri-name { color: #e8f4fa; font-weight: 600; }
.ri-eye { display: flex; align-items: center; gap: 3px; margin-left: auto; color: #7fd0e6; font-size: 9px; cursor: pointer; user-select: none; }
.ri-eye input { width: auto; margin: 0; cursor: pointer; }
.ri-note { margin: 2px 0 0; font-size: 10px; color: #9fb8d4; line-height: 1.45; }
.ri-actions { display: flex; gap: 4px; margin-top: 4px; }
.export-btn { padding: 1px 7px; border: 1px solid rgba(45, 212, 160, 0.45); border-radius: 4px; background: rgba(15, 66, 57, 0.6); color: #9df0d8; cursor: pointer; font-size: 10px; }
.export-btn:hover { background: rgba(45, 212, 160, 0.35); }
.results-reopen { position: absolute; top: 12px; left: 12px; z-index: 8; padding: 5px 9px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 7px; background: rgba(8, 26, 44, 0.92); color: #7fd0e6; cursor: pointer; font-size: 11px; }
.scenario-chip { display: inline-block; margin-left: 4px; padding: 0 6px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; color: #9fb8d4; cursor: pointer; font-size: 10px; line-height: 1.7; }
.scenario-chip.active { border-color: rgba(255, 199, 92, 0.9); background: rgba(255, 199, 92, 0.22); color: #ffd666; }
.zone-table { display: flex; flex-direction: column; gap: 3px; margin: 3px 0; }
.zone-row { display: flex; align-items: center; justify-content: space-between; padding: 1px 4px; border: 1px solid rgba(137, 210, 233, 0.14); border-radius: 4px; background: rgba(21, 48, 78, 0.4); }
.zone-name { color: #c3d8e6; font-size: 10px; }
.zone-edit { display: flex; align-items: center; gap: 4px; }
.zone-edit input[type="number"] { width: 58px; }
.unit { color: #7fd0e6; font-size: 9px; }
.stat-table, .scenario-table { width: 100%; margin: 4px 0; border-collapse: collapse; font-size: 10px; }
.stat-table th, .scenario-table th { padding: 3px 4px; border-bottom: 1px solid rgba(137, 210, 233, 0.22); color: #7fd0e6; text-align: left; font-weight: 600; }
.stat-table td, .scenario-table td { padding: 2px 4px; color: #bcd7e4; text-align: right; }
.stat-table td:first-child, .scenario-table td:first-child { text-align: left; }
.stat-table .total-row td { border-top: 1px solid rgba(137, 210, 233, 0.22); color: #ffd666; font-weight: 700; }
.dot { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 2px; }
.step-label { flex: 1 1 auto; min-width: 0; }
.step-rerun { flex: 0 0 auto; margin-left: 4px; padding: 0 5px; border-radius: 9px; background: rgba(45, 212, 160, 0.2); color: #9df0d8; font-size: 9px; line-height: 1.7; }
.report-backdrop { position: absolute; inset: 0; z-index: 90; display: flex; flex-direction: column; background: #fff; color: #16232e; }
.report-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 16px; border-bottom: 1px solid #d5dee5; background: #eef4f8; }
.report-toolbar-title { font-size: 13px; font-weight: 700; color: #17324d; }
.report-actions { display: flex; align-items: center; gap: 8px; }
.report-btn { border: 1px solid #2f80ed; border-radius: 5px; padding: 4px 12px; cursor: pointer; background: #2f80ed; color: #fff; font-size: 12px; }
.report-btn.accent { border-color: #c9971c; background: #c9971c; color: #fff; }
.report-close { border: 0; background: transparent; color: #5b6b7a; cursor: pointer; font-size: 20px; line-height: 1; }
.report-doc { overflow: auto; width: 100%; max-width: 880px; margin: 0 auto; padding: 24px 34px 44px; box-sizing: border-box; }
.report-h1 { margin: 0 0 6px; font-size: 20px; color: #17324d; }
.report-meta { margin: 0 0 6px; font-size: 11px; color: #6a7b8a; }
.report-intro { margin: 0 0 10px; font-size: 12px; line-height: 1.6; color: #3b5061; }
.report-h2 { margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #cfe0ec; font-size: 14px; color: #124c7d; }
.report-caption { padding: 2px 0; font-size: 11px; color: #5b6b7a; text-align: left; }
.report-table { width: 100%; margin: 4px 0 8px; border-collapse: collapse; font-size: 11px; }
.report-table th, .report-table td { padding: 3px 7px; border: 1px solid #c9d6e0; text-align: left; vertical-align: top; }
.report-table th { background: #e8f1f8; color: #17324d; font-weight: 700; }
.report-table td { color: #2a3b4a; }
.report-kv { display: grid; grid-template-columns: 190px 1fr; gap: 2px 10px; margin: 4px 0 6px; font-size: 12px; }
.report-kv dt { color: #3c5a73; font-weight: 600; }
.report-kv dd { margin: 0; color: #1e2f3d; }
.report-line { margin: 3px 0; font-size: 12px; line-height: 1.6; color: #1e2f3d; }
</style>
