<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Color,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Entity
} from 'cesium'
import { RidgeValleyScene, type LineStyle } from './RidgeValleyScene'
import { loadWorldTerrain } from '../../lib/cesium-scene'
import { pickCartographic } from '../measure-lib/pick'
import {
  boundsFromPolygon,
  gridFromBoundsMeters,
  sampleTerrainDem,
  type LonLat
} from '../ridge-valley-lib/terrain-sample'
import { RAMPS, SURFACE_MODE_GROUPS, renderRasterCanvas, type SurfaceMode, type RasterRenderOptions } from '../ridge-valley-lib/palette'
import { analyzeDem, type AnalysisResult, type AnalysisParams, type DemData, type Point } from '../ridge-valley-lib/hydrology'
import { vectorizeMasks } from '../ridge-valley-lib/vectorize'
import InfoTip from '../../components/InfoTip.vue'
import { createReportPdfUrl, exportReportPdf, type RidgeReportModel, type ReportSection } from './report'

const SAMPLE_REGION = { lon: 101.85, lat: 29.55, altitude: 130000 }
const REPORT_TITLE = '山脊线 / 山谷线提取分析报告'

const HINTS = {
  cellMeters:
    '以米为单位的地面采样间距，决定 DEM 栅格分辨率。间距越小越精细，但采样点数与耗时越多；超出点数上限时会自动放宽间距。',
  focalWindow:
    '焦点统计的邻域窗口大小（奇数格数）。窗口越大，正负地形判定越平滑，可抑制小尺度噪声，但会弱化细小地形。',
  ridgeThreshold:
    '正地形像元的筛选阈值（0~1）。阈值越高，仅保留更突出的山脊候选，输出更接近主山脊。',
  valleyThreshold:
    '负地形像元的筛选阈值（0~1）。阈值越高，仅保留更明显的山谷候选。',
  fillDepressions:
    '水文分析前是否填充 DEM 洼地，避免水流在局部低点中断，使汇流累积更连续。',
  minLineLength:
    '矢量化后折线的最小像素长度，用于过滤零碎短线段，保留主要线状地形。',
  simplifyTolerance:
    'Douglas-Peucker 折线简化容差（像素）。值越大，顶点越少、线条越平滑。',
  mode:
    '选择要查看的中间过程或结果栅格图层，例如高程、晕渲、坡度、汇流累积、脊谷掩膜与骨架。',
  hillshadeStrength:
    '晕渲底图中地形明暗阴影的叠加强度，0 表示不叠加晕渲。',
  sunAzimuth:
    '晕渲光照的太阳方位角，0° 为正北，顺时针增大。',
  sunAltitude:
    '晕渲光照的太阳高度角，角度越低阴影越长、立体感越强。',
  lineStyle:
    '设置山脊线/山谷线的显示开关、颜色与线宽。线条会贴合真实地形表面绘制。'
}

const ROUTE_OVERVIEW = {
  title: '山脊线 / 山谷线提取技术路线',
  intro:
    '基于 DEM 的水文分析思路：先用焦点统计区分正、负地形；山脊以原始 DEM、山谷以反地形分别进入同一条水文链路，提取零汇流像元后细化并矢量化。',
  steps: [
    {
      title: '1. 焦点统计与正负地形',
      text: '对 DEM 做邻域均值滤波，计算每个像元与邻域均值之差。差值为正（相对凸起）判为正地形，为负（相对凹陷）判为负地形，再结合阈值得到正/负地形掩膜。'
    },
    {
      title: '2. DEM 预处理',
      text: '按需对参与计算的表面进行洼地填充，消除内部封闭低点，保证水流方向连续可解。'
    },
    {
      title: '3. D8 流向与汇流累积',
      text: '采用 D8 最陡下降法计算流向，再沿拓扑顺序累加汇流累积量；遇到有向环时回退处理，避免死循环。'
    },
    {
      title: '4. 零汇流候选',
      text: '汇流累积量为零（没有上游来水）的像元即潜在的山脊或山谷候选，分别来自原始 DEM 与反地形。'
    },
    {
      title: '5. 邻域统计与阈值筛选',
      text: '统计候选像元邻域内的占比，结合山脊/山谷阈值与正负地形掩膜，得到更干净的脊/谷候选栅格。'
    },
    {
      title: '6. 细化与矢量化',
      text: '用 Zhang-Suen 算法细化候选栅格得到单像素骨架，再沿骨架游走成有序折线，经 RDP 简化并按最短线长过滤。'
    },
    {
      title: '7. 贴地可视化',
      text: '栅格结果以 ClassificationType.TERRAIN 贴地图层叠加到真实地形上，折线沿地形表面抬高绘制，保证线条不被栅格图层遮挡。'
    }
  ]
}

const container = ref<HTMLElement | null>(null)
const previewCanvas = ref<HTMLCanvasElement | null>(null)
const statusMessage = ref('正在初始化 Cesium 场景…')
const isReady = ref(false)
const isRunning = ref(false)
const hasResult = ref(false)
const infoOpen = ref(false)

const reportOpen = ref(false)
const reportPdfUrl = ref('')
const reportPdfMode = ref(false)
const pdfLoading = ref(false)
const reportPaper = ref<HTMLElement | null>(null)
const reportImage = ref('')

const terrainReady = ref(false)
const terrainHint = ref('')
const isDrawing = ref(false)
const drawPoints = ref<LonLat[]>([])
const sampleCellMeters = ref(90)

const focalWindow = ref(9)
const ridgeThreshold = ref(0.35)
const valleyThreshold = ref(0.35)
const fillDepressions = ref(true)
const minLineLength = ref(6)
const simplifyTolerance = ref(1.5)

const mode = ref<SurfaceMode>('combined')
const hillshadeStrength = ref(0.55)
const sunAzimuth = ref(315)
const sunAltitude = ref(45)

const ridgeColor = ref('#ff5a4d')
const valleyColor = ref('#49b6ff')
const ridgeWidth = ref(3)
const valleyWidth = ref(3)
const showRidge = ref(true)
const showValley = ref(true)

const stats = ref({
  ridgePixels: 0,
  valleyPixels: 0,
  ridgeLines: 0,
  valleyLines: 0,
  ridgeLengthKm: 0,
  valleyLengthKm: 0
})

const timing = ref({
  focal: 0,
  ridgeHydro: 0,
  valleyHydro: 0,
  vectorize: 0,
  total: 0
})

let scene: RidgeValleyScene | undefined
let dem: DemData | null = null
let result: AnalysisResult | null = null
let rasterCanvas: HTMLCanvasElement | null = null

let handler: ScreenSpaceEventHandler | undefined
let draftPositions: Cartesian3[] = []
let draftEntity: Entity | null = null
let draftPoints: Entity[] = []

const modeOptions = SURFACE_MODE_GROUPS

const currentModeLabel = computed(() => {
  for (const group of SURFACE_MODE_GROUPS) {
    const found = group.modes.find((m) => m.id === mode.value)
    if (found) return found.label
  }
  return mode.value
})

const gridPreview = computed(() => {
  const bounds = boundsFromPolygon(drawPoints.value)
  if (!bounds) return null
  return gridFromBoundsMeters(bounds, sampleCellMeters.value)
})

type LegendItem = { color: string; label: string }
type LayerLegend = {
  title: string
  description: string
  ramp?: string
  rampLabels?: string[]
  items?: LegendItem[]
}

function rampCss(name: keyof typeof RAMPS): string {
  const stops = RAMPS[name]
  const parts = stops.map(([p, r, g, b]) => `rgb(${r}, ${g}, ${b}) ${Math.round(p * 100)}%`)
  return `linear-gradient(90deg, ${parts.join(', ')})`
}

function dirLegend(): LegendItem[] {
  const dirs: [string, number][] = [
    ['东', 0],
    ['东南', 45],
    ['南', 90],
    ['西南', 135],
    ['西', 180],
    ['西北', 225],
    ['北', 270],
    ['东北', 315]
  ]
  return dirs.map(([label, hue]) => ({ color: `hsl(${hue}, 85%, 60%)`, label }))
}

function legendFor(id: SurfaceMode): LayerLegend {
  const ridge = ridgeColor.value
  const valley = valleyColor.value
  switch (id) {
    case 'elevation':
      return { title: '高程着色', description: '按高程分层设色：低地深绿，中段黄褐，高海拔过渡为灰白。用于快速了解区域地形起伏与高程分布。', ramp: rampCss('terrain'), rampLabels: ['低', '高'] }
    case 'hillshade':
      return { title: '地形晕渲', description: '模拟太阳光照的明暗阴影：暗处为背光坡，亮处为迎光坡，用于判断地形立体感与坡面朝向。', ramp: rampCss('gray'), rampLabels: ['背光', '受光'] }
    case 'slope':
      return { title: '坡度', description: '由高程梯度计算的坡度（0°~60° 归一化）：蓝绿为缓坡，黄红为陡坡，可用于识别山脊两侧的陡缓过渡。', ramp: rampCss('thermal'), rampLabels: ['缓 0°', '陡 ≥60°'] }
    case 'aspect':
      return { title: '坡向', description: '坡向色环，色相表示坡面法线的朝向（北→东→南→西），同一山脊两侧的坡向差异明显。', items: [{ color: 'hsl(0, 72%, 62%)', label: '北' }, { color: 'hsl(90, 72%, 62%)', label: '东' }, { color: 'hsl(180, 72%, 62%)', label: '南' }, { color: 'hsl(270, 72%, 62%)', label: '西' }] }
    case 'focalMean':
      return { title: '焦点均值', description: '焦点统计得到的邻域均值高程，相当于平滑后的地形表面，与原始高程之差即正负地形判据。', ramp: rampCss('terrain'), rampLabels: ['低', '高'] }
    case 'difference':
      return { title: '高程差值', description: '像元高程与邻域均值之差：红色为相对凸起的正地形（山脊候选），蓝色为相对凹陷的负地形（山谷候选），白色为过渡。', ramp: rampCss('diverging'), rampLabels: ['负地形', '0', '正地形'] }
    case 'terrainClass':
      return { title: '正负地形', description: '结合差值阈值划分的掩膜：绿色为正地形，蓝色为负地形，深色为过渡区，分别作为山脊链与山谷链的输入。', items: [{ color: 'rgb(46, 160, 90)', label: '正地形' }, { color: 'rgb(30, 38, 48)', label: '过渡' }, { color: 'rgb(58, 120, 220)', label: '负地形' }] }
    case 'flowDir':
    case 'inverseFlowDir':
      return { title: id === 'flowDir' ? '流向 (D8)' : '反地形流向 (D8)', description: 'D8 最陡下降法计算的流向，八方向色环表示每个像元的水流去向，深色表示无流向（洼地或边界）。', items: dirLegend() }
    case 'flowAcc':
    case 'inverseFlowAcc':
      return { title: id === 'flowAcc' ? '汇流累积' : '反地形汇流累积', description: '沿流向累积的上游像元数（对数显示）：蓝绿偏低，黄红偏高，数值越高表示汇流越集中。', ramp: rampCss('thermal'), rampLabels: ['低', '高'] }
    case 'flowAccZero':
      return { title: '零汇流候选', description: '汇流累积为零的像元，即没有上游来水的位置，是山脊候选的初始集合。', items: [{ color: 'rgb(250, 210, 70)', label: '零汇流' }, { color: 'rgb(22, 28, 38)', label: '其他' }] }
    case 'inverseAccZero':
      return { title: '反地形零汇流', description: '反地形上汇流为零的像元，对应山谷候选的初始集合。', items: [{ color: 'rgb(120, 220, 250)', label: '零汇流' }, { color: 'rgb(22, 28, 38)', label: '其他' }] }
    case 'neighborAcc':
    case 'inverseNeighborAcc':
      return { title: id === 'neighborAcc' ? '邻域统计' : '反地形邻域统计', description: '零汇流候选像元在邻域内的占比，越亮表示脊/谷特征越集中，用于抑制孤立噪声。', ramp: rampCss('thermal'), rampLabels: ['分散', '集中'] }
    case 'ridgeMask':
      return { title: '山脊栅格', description: '结合正地形掩膜、阈值与邻域统计后得到的山脊候选栅格，将进一步细化与矢量化。', items: [{ color: ridge, label: '山脊候选' }, { color: 'rgb(22, 28, 38)', label: '其他' }] }
    case 'valleyMask':
      return { title: '山谷栅格', description: '结合负地形掩膜、阈值与邻域统计后得到的山谷候选栅格，将进一步细化与矢量化。', items: [{ color: valley, label: '山谷候选' }, { color: 'rgb(22, 28, 38)', label: '其他' }] }
    case 'ridgeSkeleton':
      return { title: '山脊骨架', description: 'Zhang-Suen 细化后的单像素山脊骨架，是折线矢量化的直接来源。', items: [{ color: ridge, label: '山脊骨架' }, { color: 'rgb(22, 28, 38)', label: '其他' }] }
    case 'valleySkeleton':
      return { title: '山谷骨架', description: 'Zhang-Suen 细化后的单像素山谷骨架，是折线矢量化的直接来源。', items: [{ color: valley, label: '山谷骨架' }, { color: 'rgb(22, 28, 38)', label: '其他' }] }
    default:
      return { title: '提取结果叠加', description: '灰阶晕渲底图叠加山脊候选（红）与山谷候选（蓝）栅格，并在地图线要素层显示提取出的折线。', items: [{ color: ridge, label: '山脊栅格' }, { color: valley, label: '山谷栅格' }, { color: 'rgb(180, 200, 214)', label: '晕渲底图' }] }
  }
}

const currentLegend = computed<LayerLegend>(() => legendFor(mode.value))

const legendText = computed(() => currentLegend.value.description)

function rasterOptions(): RasterRenderOptions {
  return {
    mode: mode.value,
    hillshadeStrength: hillshadeStrength.value,
    sunAzimuth: sunAzimuth.value,
    sunAltitude: sunAltitude.value,
    ridgeColor: ridgeColor.value,
    valleyColor: valleyColor.value
  }
}

function currentLineStyle(): LineStyle {
  return {
    ridgeColor: ridgeColor.value,
    valleyColor: valleyColor.value,
    ridgeWidth: ridgeWidth.value,
    valleyWidth: valleyWidth.value
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30))
}

function renderRaster(): void {
  if (!dem || !result || !scene) return
  rasterCanvas = renderRasterCanvas(dem, result, rasterOptions())
  scene.updateTexture(rasterCanvas)
  drawPreview()
}

function drawPreview(): void {
  const target = previewCanvas.value
  if (!target || !rasterCanvas) return
  const ctx = target.getContext('2d')
  if (!ctx) return
  target.width = rasterCanvas.width
  target.height = rasterCanvas.height
  ctx.clearRect(0, 0, target.width, target.height)
  ctx.drawImage(rasterCanvas, 0, 0)
}

function updateStats(): void {
  if (!result) return
  stats.value = {
    ridgePixels: result.ridgePixels,
    valleyPixels: result.valleyPixels,
    ridgeLines: result.ridgeLines.length,
    valleyLines: result.valleyLines.length,
    ridgeLengthKm: Number(result.ridgeLengthKm.toFixed(2)),
    valleyLengthKm: Number(result.valleyLengthKm.toFixed(2))
  }
  timing.value = {
    focal: Number(result.timing.focal.toFixed(1)),
    ridgeHydro: Number(result.timing.ridgeHydro.toFixed(1)),
    valleyHydro: Number(result.timing.valleyHydro.toFixed(1)),
    vectorize: Number(result.timing.vectorize.toFixed(1)),
    total: Number(result.timing.total.toFixed(1))
  }
}

function analysisParams(): AnalysisParams {
  const window = Math.max(1, Math.round(focalWindow.value) | 1)
  return {
    focalWindow: window,
    ridgeThreshold: ridgeThreshold.value,
    valleyThreshold: valleyThreshold.value,
    fillDepressions: fillDepressions.value,
    minLineLength: minLineLength.value,
    simplifyTolerance: simplifyTolerance.value
  }
}

function analyzeCurrentDem(): void {
  if (!dem || !scene) return
  result = analyzeDem(dem, analysisParams(), vectorizeMasks)
  scene.setAnalysis(dem, result)
  scene.setLineStyle(currentLineStyle())
  scene.setLineVisibility(showRidge.value, showValley.value)
  renderRaster()
  updateStats()
  hasResult.value = true
}

async function ensureTerrain(): Promise<boolean> {
  if (!scene) return false
  const viewer = scene.getViewer()
  const provider = viewer.terrainProvider as unknown as { availability?: unknown } | undefined
  if (provider && provider.availability) {
    terrainReady.value = true
    terrainHint.value = '真实地形已就绪'
    return true
  }
  terrainHint.value = '正在加载 Cesium 全球地形…'
  try {
    await loadWorldTerrain(viewer)
    terrainReady.value = true
    terrainHint.value = '真实地形已就绪'
    return true
  } catch (error) {
    terrainReady.value = false
    terrainHint.value = `地形加载失败：${error instanceof Error ? error.message : String(error)}`
    return false
  }
}

function flyToSampleRegion(): void {
  const viewer = scene?.getViewer()
  if (!viewer) return
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(SAMPLE_REGION.lon - 0.35, SAMPLE_REGION.lat - 0.28, SAMPLE_REGION.altitude),
    orientation: { heading: 0.35, pitch: -0.7, roll: 0 },
    duration: 1.4
  })
}

function stopDrawingHandler(): void {
  handler?.destroy()
  handler = undefined
  isDrawing.value = false
  const viewer = scene?.getViewer()
  if (viewer && !viewer.isDestroyed()) viewer.canvas.style.cursor = 'default'
}

function clearDraftEntities(): void {
  const viewer = scene?.getViewer()
  if (!viewer || viewer.isDestroyed()) return
  if (draftEntity) viewer.entities.remove(draftEntity)
  draftEntity = null
  for (const point of draftPoints) viewer.entities.remove(point)
  draftPoints = []
}

function refreshDraft(): void {
  const viewer = scene?.getViewer()
  clearDraftEntities()
  if (!viewer || viewer.isDestroyed() || draftPositions.length === 0) return
  if (draftPositions.length >= 2) {
    draftEntity = viewer.entities.add({
      polyline: {
        positions: draftPositions.slice(),
        width: 2.5,
        material: Color.fromCssColorString('#ffd166')
      }
    })
  }
  for (const position of draftPositions) {
    draftPoints.push(
      viewer.entities.add({
        position,
        point: {
          pixelSize: 7,
          color: Color.fromCssColorString('#ffd166'),
          outlineColor: Color.fromCssColorString('#1b2a44'),
          outlineWidth: 2
        }
      })
    )
  }
}

function startDrawing(): void {
  const viewer = scene?.getViewer()
  if (!viewer || isDrawing.value || isRunning.value) return
  cancelDrawing()
  isDrawing.value = true
  viewer.canvas.style.cursor = 'crosshair'
  handler = new ScreenSpaceEventHandler(viewer.canvas)
  handler.setInputAction((event: { position: Cartesian2 }) => {
    const carto = pickCartographic(viewer.scene, event.position)
    if (!carto) return
    draftPositions.push(Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height ?? 0))
    drawPoints.value = [
      ...drawPoints.value,
      { lon: (carto.longitude * 180) / Math.PI, lat: (carto.latitude * 180) / Math.PI }
    ]
    refreshDraft()
  }, ScreenSpaceEventType.LEFT_CLICK)
  handler.setInputAction(() => { void finishDrawing() }, ScreenSpaceEventType.RIGHT_CLICK)
  handler.setInputAction(() => { void finishDrawing() }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
}

function cancelDrawing(): void {
  stopDrawingHandler()
  draftPositions = []
  drawPoints.value = []
  clearDraftEntities()
}

async function finishDrawing(): Promise<void> {
  if (!isDrawing.value) return
  stopDrawingHandler()
  if (drawPoints.value.length < 3) {
    statusMessage.value = '至少需要 3 个顶点才能构成分析区域'
    draftPositions = []
    drawPoints.value = []
    clearDraftEntities()
    return
  }
  await runDrawnExtraction()
}

async function runDrawnExtraction(): Promise<void> {
  if (!scene || isRunning.value) return
  const bounds = boundsFromPolygon(drawPoints.value)
  if (!bounds) {
    statusMessage.value = '绘制的多边形范围无效，请重新绘制'
    return
  }
  const ready = await ensureTerrain()
  if (!ready) {
    statusMessage.value = terrainHint.value || '真实地形不可用，无法采样'
    return
  }
  isRunning.value = true
  hasResult.value = false
  statusMessage.value = '正在采样真实地形高程…'
  await nextFrame()
  try {
    dem = await sampleTerrainDem(
      scene.getViewer().terrainProvider,
      bounds,
      { cellMeters: sampleCellMeters.value },
      (done, total) => {
        statusMessage.value = `正在采样真实地形 ${Math.round((done / total) * 100)}%`
      }
    )
    statusMessage.value = '正在执行水文分析与矢量化…'
    scene.setRenderMode('drape')
    await nextFrame()
    analyzeCurrentDem()
    statusMessage.value = ''
    scene.flyTo('oblique')
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    isRunning.value = false
  }
}

async function runAnalysis(): Promise<void> {
  if (!scene || isRunning.value) return
  if (!dem) {
    statusMessage.value = '请先在地图上绘制分析区域'
    return
  }
  isRunning.value = true
  statusMessage.value = '正在执行水文分析与矢量化…'
  await nextFrame()
  try {
    analyzeCurrentDem()
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    isRunning.value = false
  }
}

function resetParams(): void {
  focalWindow.value = 9
  ridgeThreshold.value = 0.35
  valleyThreshold.value = 0.35
  fillDepressions.value = true
  minLineLength.value = 6
  simplifyTolerance.value = 1.5
}

function exportGeoJson(): void {
  if (!dem || !result) return
  const toCoords = (lines: Point[][]): number[][][] =>
    lines.map((line) =>
      line.map(([c, r]) => {
        const lon = dem!.west + (c / Math.max(1, dem!.width - 1)) * (dem!.east - dem!.west)
        const lat = dem!.north - (r / Math.max(1, dem!.height - 1)) * (dem!.north - dem!.south)
        const ci = Math.max(0, Math.min(dem!.width - 1, Math.round(c)))
        const ri = Math.max(0, Math.min(dem!.height - 1, Math.round(r)))
        const height = dem!.values[ri * dem!.width + ci]
        return [Number(lon.toFixed(6)), Number(lat.toFixed(6)), Number(height.toFixed(2))]
      })
    )
  const featureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: 'ridge', count: result.ridgeLines.length },
        geometry: { type: 'MultiLineString', coordinates: toCoords(result.ridgeLines) }
      },
      {
        type: 'Feature',
        properties: { kind: 'valley', count: result.valleyLines.length },
        geometry: { type: 'MultiLineString', coordinates: toCoords(result.valleyLines) }
      }
    ]
  }
  const blob = new Blob([JSON.stringify(featureCollection)], { type: 'application/geo+json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'ridge-valley-drawn.geojson'
  a.click()
  URL.revokeObjectURL(url)
}

function exportPreview(): void {
  if (!rasterCanvas) return
  const a = document.createElement('a')
  a.href = rasterCanvas.toDataURL('image/png')
  a.download = `ridge-valley-${mode.value}-drawn.png`
  a.click()
}

function cellSizeMeters(): number {
  if (!dem) return 0
  const cellY = (((dem.north - dem.south) * Math.PI) / 180) * 6378137 / Math.max(1, dem.height - 1)
  return Number(cellY.toFixed(1))
}

const reportModel = computed<RidgeReportModel | null>(() => {
  if (!dem || !result) return null
  const p = analysisParams()
  const cell = cellSizeMeters()
  const bounds = `${dem.west.toFixed(5)}, ${dem.south.toFixed(5)} ~ ${dem.east.toFixed(5)}, ${dem.north.toFixed(5)}`
  const sections: ReportSection[] = [
    {
      title: '一、数据概况',
      kv: [
        { label: '数据来源', value: dem.source || 'Cesium 全球地形（真实地形采样）' },
        { label: '经度范围', value: `${dem.west.toFixed(5)}° ~ ${dem.east.toFixed(5)}°` },
        { label: '纬度范围', value: `${dem.south.toFixed(5)}° ~ ${dem.north.toFixed(5)}°` },
        { label: '栅格尺寸', value: `${dem.width} × ${dem.height}（${dem.width * dem.height} 像元）` },
        { label: '采样间距', value: `约 ${cell} m` },
        { label: '高程范围', value: `${dem.minHeight.toFixed(1)} ~ ${dem.maxHeight.toFixed(1)} m（均值 ${dem.meanHeight.toFixed(1)} m）` },
        { label: '分析区域', value: bounds }
      ]
    },
    {
      title: '二、分析参数',
      kv: [
        { label: '焦点统计窗口', value: `${p.focalWindow} × ${p.focalWindow} 格` },
        { label: '山脊阈值', value: p.ridgeThreshold.toFixed(2) },
        { label: '山谷阈值', value: p.valleyThreshold.toFixed(2) },
        { label: '洼地填充', value: p.fillDepressions ? '启用' : '关闭' },
        { label: '最短线长', value: `${p.minLineLength} px` },
        { label: '折线简化容差', value: `${p.simplifyTolerance.toFixed(1)} px` }
      ]
    },
    {
      title: '三、提取结果',
      kv: [
        { label: '山脊线', value: `${stats.value.ridgeLines} 条，总长约 ${stats.value.ridgeLengthKm} km` },
        { label: '山谷线', value: `${stats.value.valleyLines} 条，总长约 ${stats.value.valleyLengthKm} km` },
        { label: '山脊候选像元', value: `${stats.value.ridgePixels}` },
        { label: '山谷候选像元', value: `${stats.value.valleyPixels}` }
      ]
    },
    {
      title: '四、图层预览',
      lines: [`当前图层：${currentModeLabel.value}。${currentLegend.value.description}`],
      image: reportImage.value ? { src: reportImage.value, caption: `${currentModeLabel.value} 栅格预览` } : undefined
    },
    {
      title: '五、耗时统计',
      kv: [
        { label: '焦点统计', value: `${timing.value.focal} ms` },
        { label: '山脊水文链', value: `${timing.value.ridgeHydro} ms` },
        { label: '山谷水文链', value: `${timing.value.valleyHydro} ms` },
        { label: '矢量化', value: `${timing.value.vectorize} ms` },
        { label: '合计', value: `${timing.value.total} ms` }
      ]
    },
    {
      title: '六、方法说明',
      lines: [
        '1. 焦点统计：对 DEM 做邻域均值滤波，计算像元与邻域均值之差，正值判为正地形，负值判为负地形。',
        '2. DEM 预处理：按需填充洼地，消除内部封闭低点，保证水流方向连续可解。',
        '3. D8 流向与汇流累积：采用最陡下降法计算流向，再沿拓扑顺序累加汇流累积量。',
        '4. 零汇流候选：汇流累积为零的像元作为山脊/山谷候选，山脊取自原始 DEM，山谷取自反地形。',
        '5. 邻域统计与阈值筛选：结合邻域占比、正负地形掩膜与阈值得到干净的候选栅格。',
        '6. 细化与矢量化：Zhang-Suen 细化得到单像素骨架，骨架游走成折线后经 RDP 简化与最短线长过滤。',
        '7. 可视化：栅格结果贴地叠加到真实地形，折线沿地形表面绘制。'
      ]
    }
  ]
  return {
    generatedAt: new Date().toLocaleString('zh-CN'),
    intro: `本报告由「山脊线 / 山谷线提取」案例自动生成，基于真实地形 DEM 的水文分析提取山脊线与山谷线，汇总数据概况、分析参数、提取结果、图层预览与耗时统计，可用于地形特征分析与提取方案比选。`,
    sections
  }
})

async function openReportPreview(): Promise<void> {
  if (!dem || !result) {
    statusMessage.value = '请先绘制区域并完成一次提取'
    return
  }
  reportImage.value = rasterCanvas ? rasterCanvas.toDataURL('image/png') : ''
  reportOpen.value = true
  reportPdfMode.value = false
  await nextTick()
  await previewPdf()
}

async function previewPdf(): Promise<void> {
  reportPdfMode.value = false
  await nextTick()
  if (!reportPaper.value) return
  pdfLoading.value = true
  try {
    const url = await createReportPdfUrl(reportPaper.value)
    if (reportPdfUrl.value) URL.revokeObjectURL(reportPdfUrl.value)
    reportPdfUrl.value = url
    reportPdfMode.value = true
  } catch {
    statusMessage.value = 'PDF 预览生成失败，已切换为网页版预览'
    reportPdfMode.value = false
  } finally {
    pdfLoading.value = false
  }
}

async function onExportPdf(): Promise<void> {
  reportPdfMode.value = false
  await nextTick()
  if (!reportPaper.value) return
  try {
    await exportReportPdf(reportPaper.value, 'ridge-valley-extraction-report')
  } catch {
    statusMessage.value = 'PDF 导出失败，请重试'
  }
}

function closeReport(): void {
  if (reportPdfUrl.value) {
    URL.revokeObjectURL(reportPdfUrl.value)
    reportPdfUrl.value = ''
  }
  reportPdfMode.value = false
  reportOpen.value = false
}


watch([mode, hillshadeStrength, sunAzimuth, sunAltitude], renderRaster)
watch([ridgeColor, valleyColor, ridgeWidth, valleyWidth], () => scene?.setLineStyle(currentLineStyle()))
watch([showRidge, showValley], ([r, v]) => scene?.setLineVisibility(r, v))

onMounted(async () => {
  if (!container.value) return
  try {
    scene = new RidgeValleyScene(container.value, {
      onStatus: (message) => { statusMessage.value = message },
      onBasemapReady: () => { statusMessage.value = '正在加载 Cesium 全球地形…' }
    })
    isReady.value = true
    flyToSampleRegion()
    const ready = await ensureTerrain()
    if (ready) scene.setRenderMode('drape')
    statusMessage.value = ready ? '' : terrainHint.value
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  stopDrawingHandler()
  if (reportPdfUrl.value) URL.revokeObjectURL(reportPdfUrl.value)
  scene?.dispose()
  scene = undefined
})
</script>

<template>
  <div class="rv-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title-row">
        <span class="panel-title">山脊线 / 山谷线提取</span>
        <button class="route-info-btn" title="查看技术路线说明" @click="infoOpen = true">技术路线</button>
      </div>

      <div class="section-title">数据源 · 真实地形</div>
      <p class="row-note">左键在地图上添加多边形顶点，右键或双击闭合，随后自动采样真实地形高程并提取。</p>
      <div class="control-row">
        <span class="row-label">采样间距<InfoTip :text="HINTS.cellMeters" /></span>
        <input v-model.number="sampleCellMeters" type="number" min="5" max="500" step="5" :disabled="isRunning" />
        <span class="row-unit">m</span>
      </div>
      <p class="row-note" v-if="gridPreview">
        预计栅格 {{ gridPreview.width }} × {{ gridPreview.height }}（{{ gridPreview.points }} 点）<template v-if="gridPreview.adjusted">，已按点数上限放宽至约 {{ Math.round(gridPreview.cellMeters) }} m</template>
      </p>
      <div class="button-row">
        <button class="action-button" :disabled="isRunning" @click="isDrawing ? finishDrawing() : startDrawing()">
          {{ isDrawing ? '完成绘制' : '开始绘制' }}
        </button>
        <button class="action-button ghost" :disabled="isRunning" @click="cancelDrawing">清除区域</button>
      </div>
      <p class="row-note">已选顶点：{{ drawPoints.length }}</p>
      <p class="row-note" v-if="terrainHint">{{ terrainHint }}</p>

      <div class="section-title">提取参数</div>
      <div class="control-row">
        <span class="row-label">焦点窗口<InfoTip :text="HINTS.focalWindow" /></span>
        <input v-model.number="focalWindow" type="number" min="3" max="31" step="2" :disabled="isRunning" />
        <span class="row-unit">格</span>
      </div>
      <div class="control-row">
        <span class="row-label">山脊阈值<InfoTip :text="HINTS.ridgeThreshold" /></span>
        <input v-model.number="ridgeThreshold" type="range" min="0" max="1" step="0.01" :disabled="isRunning" />
        <span class="row-value">{{ ridgeThreshold.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">山谷阈值<InfoTip :text="HINTS.valleyThreshold" /></span>
        <input v-model.number="valleyThreshold" type="range" min="0" max="1" step="0.01" :disabled="isRunning" />
        <span class="row-value">{{ valleyThreshold.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">填洼处理<InfoTip :text="HINTS.fillDepressions" /></span>
        <label class="switch-row">
          <input v-model="fillDepressions" type="checkbox" :disabled="isRunning" />
          <span>启用</span>
        </label>
      </div>
      <div class="control-row">
        <span class="row-label">最短线长<InfoTip :text="HINTS.minLineLength" /></span>
        <input v-model.number="minLineLength" type="number" min="1" max="60" step="1" :disabled="isRunning" />
        <span class="row-unit">px</span>
      </div>
      <div class="control-row">
        <span class="row-label">简化容差<InfoTip :text="HINTS.simplifyTolerance" /></span>
        <input v-model.number="simplifyTolerance" type="range" min="0" max="4" step="0.1" :disabled="isRunning" />
        <span class="row-value">{{ simplifyTolerance.toFixed(1) }}</span>
      </div>

      <button class="action-button primary" :disabled="!isReady || isRunning" @click="runAnalysis">
        {{ isRunning ? '提取中…' : '重新提取' }}
      </button>
      <div class="button-row">
        <button class="action-button ghost" :disabled="isRunning" @click="resetParams">重置参数</button>
        <button class="action-button ghost" :disabled="!hasResult" @click="exportGeoJson">导出 GeoJSON</button>
      </div>

      <template v-if="hasResult">
        <div class="section-title">图层与渲染</div>
        <div class="control-row">
          <span class="row-label">显示图层<InfoTip :text="HINTS.mode" /></span>
          <select v-model="mode">
            <optgroup v-for="g in modeOptions" :key="g.label" :label="g.label">
              <option v-for="m in g.modes" :key="m.id" :value="m.id">{{ m.label }}</option>
            </optgroup>
          </select>
        </div>
        <p class="row-note">{{ legendText }}</p>
        <div class="control-row">
          <span class="row-label">晕渲强度<InfoTip :text="HINTS.hillshadeStrength" /></span>
          <input v-model.number="hillshadeStrength" type="range" min="0" max="1" step="0.05" />
          <span class="row-value">{{ Math.round(hillshadeStrength * 100) }}%</span>
        </div>
        <div class="control-row">
          <span class="row-label">太阳方位<InfoTip :text="HINTS.sunAzimuth" /></span>
          <input v-model.number="sunAzimuth" type="range" min="0" max="360" step="5" />
          <span class="row-value">{{ sunAzimuth }}°</span>
        </div>
        <div class="control-row">
          <span class="row-label">太阳高度<InfoTip :text="HINTS.sunAltitude" /></span>
          <input v-model.number="sunAltitude" type="range" min="5" max="90" step="5" />
          <span class="row-value">{{ sunAltitude }}°</span>
        </div>

        <div class="section-title">线要素样式</div>
        <div class="control-row">
          <span class="row-label">山脊线<InfoTip :text="HINTS.lineStyle" /></span>
          <label class="switch-row"><input v-model="showRidge" type="checkbox" /><span>显示</span></label>
          <input v-model="ridgeColor" type="color" class="color-input" />
          <input v-model.number="ridgeWidth" type="range" min="1" max="8" step="0.5" class="mini-range" />
        </div>
        <div class="control-row">
          <span class="row-label">山谷线<InfoTip :text="HINTS.lineStyle" /></span>
          <label class="switch-row"><input v-model="showValley" type="checkbox" /><span>显示</span></label>
          <input v-model="valleyColor" type="color" class="color-input" />
          <input v-model.number="valleyWidth" type="range" min="1" max="8" step="0.5" class="mini-range" />
        </div>

        <div class="section-title">提取结果</div>
        <div class="result-grid">
          <div class="result-item ridge"><span>山脊线</span><b>{{ stats.ridgeLines }} 条 / {{ stats.ridgeLengthKm }} km</b></div>
          <div class="result-item valley"><span>山谷线</span><b>{{ stats.valleyLines }} 条 / {{ stats.valleyLengthKm }} km</b></div>
          <div class="result-item"><span>山脊像元</span><b>{{ stats.ridgePixels }}</b></div>
          <div class="result-item"><span>山谷像元</span><b>{{ stats.valleyPixels }}</b></div>
        </div>

        <div class="section-title">耗时统计（ms）</div>
        <div class="result-grid">
          <div class="result-item"><span>焦点统计</span><b>{{ timing.focal }}</b></div>
          <div class="result-item"><span>山脊水文链</span><b>{{ timing.ridgeHydro }}</b></div>
          <div class="result-item"><span>山谷水文链</span><b>{{ timing.valleyHydro }}</b></div>
          <div class="result-item"><span>矢量化</span><b>{{ timing.vectorize }}</b></div>
          <div class="result-item"><span>总计</span><b>{{ timing.total }}</b></div>
        </div>

        <div class="section-title">栅格预览 · {{ currentModeLabel }}</div>
        <canvas ref="previewCanvas" class="preview-canvas"></canvas>
        <button class="action-button ghost" @click="exportPreview">导出当前图层 PNG</button>
        <button class="action-button" @click="openReportPreview">生成分析报告</button>

        <div class="view-row">
          <button class="mode-button" @click="scene?.flyTo('top')">俯视</button>
          <button class="mode-button" @click="scene?.flyTo('oblique')">斜视</button>
        </div>
      </template>

      <p class="hint">
        流程：焦点统计区分正负地形 → 山脊用原始 DEM、山谷用反地形，分别执行填洼、D8 流向、汇流累积 → 提取零汇流候选 → 邻域统计与阈值筛选 → Zhang-Suen 细化与折线矢量化 → 贴地绘制。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>

    <div v-if="hasResult" class="layer-legend">
      <div class="layer-legend-head">{{ currentLegend.title }}</div>
      <div v-if="currentLegend.ramp" class="legend-bar" :style="{ background: currentLegend.ramp }"></div>
      <div v-if="currentLegend.rampLabels" class="legend-labels">
        <span v-for="label in currentLegend.rampLabels" :key="label">{{ label }}</span>
      </div>
      <div v-if="currentLegend.items" class="legend-items">
        <span v-for="item in currentLegend.items" :key="item.label" class="legend-item">
          <i class="legend-swatch" :style="{ background: item.color }"></i>{{ item.label }}
        </span>
      </div>
      <p class="layer-legend-desc">{{ currentLegend.description }}</p>
    </div>

    <div v-if="infoOpen" class="route-overlay" @click.self="infoOpen = false">
      <div class="route-modal">
        <div class="route-head">
          <span class="route-title">{{ ROUTE_OVERVIEW.title }}</span>
          <button class="route-close" title="关闭" @click="infoOpen = false">×</button>
        </div>
        <div class="route-body">
          <p class="route-intro">{{ ROUTE_OVERVIEW.intro }}</p>
          <div v-for="step in ROUTE_OVERVIEW.steps" :key="step.title" class="route-step">
            <div class="route-step-title">{{ step.title }}</div>
            <p class="route-text">{{ step.text }}</p>
          </div>
        </div>
      </div>
    </div>

    <div v-if="reportOpen && reportModel" class="report-backdrop">
      <div class="report-toolbar">
        <span class="report-toolbar-title">分析报告 · 在线预览与导出</span>
        <span class="report-actions">
          <button class="report-btn" :class="{ active: !reportPdfMode }" @click="reportPdfMode = false">网页版</button>
          <button class="report-btn" :class="{ active: reportPdfMode }" @click="previewPdf">PDF 在线预览</button>
          <button class="report-btn accent" @click="onExportPdf">导出 PDF</button>
          <button class="report-close" title="关闭预览" @click="closeReport">×</button>
        </span>
      </div>
      <div class="report-body">
        <div v-show="!reportPdfMode" class="report-scroll">
          <div ref="reportPaper" class="report-doc">
            <h1 class="report-h1">{{ REPORT_TITLE }}</h1>
            <p class="report-meta">生成时间：{{ reportModel.generatedAt }}</p>
            <p class="report-intro">{{ reportModel.intro }}</p>
            <template v-for="section in reportModel.sections" :key="section.title">
              <h2 class="report-h2">{{ section.title }}</h2>
              <dl v-if="section.kv && section.kv.length" class="report-kv">
                <template v-for="pair in section.kv" :key="pair.label">
                  <dt>{{ pair.label }}</dt>
                  <dd>{{ pair.value }}</dd>
                </template>
              </dl>
              <p v-for="(line, lineIndex) in section.lines || []" :key="lineIndex" class="report-line">{{ line }}</p>
              <figure v-if="section.image" class="report-figure">
                <img :src="section.image.src" :alt="section.image.caption || '栅格预览'" />
                <figcaption v-if="section.image.caption">{{ section.image.caption }}</figcaption>
              </figure>
            </template>
          </div>
        </div>
        <div v-if="reportPdfMode" class="report-pdf">
          <div v-if="pdfLoading" class="pdf-loading">正在生成 PDF 预览…</div>
          <iframe v-else-if="reportPdfUrl" :src="reportPdfUrl" class="pdf-frame" title="报告 PDF 预览"></iframe>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rv-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 296px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.route-info-btn { flex: 0 0 auto; min-height: 22px; padding: 0 9px; border: 1px solid rgba(255, 199, 92, 0.55); border-radius: 11px; background: rgba(255, 199, 92, 0.16); color: #ffd666; cursor: pointer; font-size: 10px; line-height: 1; }
.route-info-btn:hover { background: rgba(255, 199, 92, 0.32); }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; min-width: 62px; display: inline-flex; align-items: center; gap: 3px; color: #c3d5e8; font-size: 11px; }
.row-unit { flex: 0 0 16px; text-align: right; color: #9fb8d4; font-size: 10px; }
.row-value { flex: 0 0 40px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.row-note { margin: 0 0 6px; font-size: 10px; color: #7f96b3; line-height: 1.4; }
.control-row input[type="number"] { flex: 1; min-width: 0; width: 64px; height: 22px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 4px; background: rgba(20, 43, 80, 0.7); color: #dce8f5; font-size: 11px; padding: 0 6px; box-sizing: border-box; }
.control-row select { flex: 1; min-width: 0; height: 22px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 4px; background: rgba(20, 43, 80, 0.7); color: #dce8f5; font-size: 11px; padding: 0 4px; box-sizing: border-box; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.mini-range { flex: 0 0 56px; }
.color-input { flex: 0 0 26px; width: 26px; height: 22px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 4px; background: transparent; cursor: pointer; }
.switch-row { display: flex; align-items: center; gap: 4px; color: #c3d5e8; font-size: 11px; cursor: pointer; flex: 0 0 auto; }
.switch-row input { accent-color: #2f80ed; }
.action-button { width: 100%; height: 28px; margin-top: 10px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.action-button.ghost { background: rgba(47, 128, 237, 0.22); color: #cfe1ff; border: 1px solid rgba(157, 188, 224, 0.32); }
.action-button:disabled { opacity: 0.5; cursor: not-allowed; }
.button-row { display: flex; gap: 6px; }
.button-row .action-button { margin-top: 6px; }
.result-grid { margin-top: 4px; display: grid; gap: 4px; }
.result-item { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; border-radius: 4px; background: rgba(23, 48, 88, 0.55); font-size: 11px; }
.result-item span { color: #9fb8d4; }
.result-item b { color: #eaf3ff; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; }
.result-item.ridge b { color: #ff7a6e; }
.result-item.valley b { color: #66c6ff; }
.preview-canvas { width: 100%; height: auto; display: block; margin-top: 4px; border: 1px solid rgba(157, 188, 224, 0.25); border-radius: 4px; image-rendering: pixelated; background: #0b1626; }
.view-row { display: flex; gap: 6px; margin-top: 8px; }
.mode-button { flex: 1; height: 24px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 4px; background: rgba(20, 43, 80, 0.55); color: #cfe1ff; font-size: 11px; cursor: pointer; }
.mode-button:hover { background: rgba(47, 128, 237, 0.35); }
.hint { margin: 10px 0 0; font-size: 10px; color: #9fb8d4; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
.route-overlay { position: absolute; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 26px; box-sizing: border-box; background: rgba(4, 13, 26, 0.6); backdrop-filter: blur(2px); }
.route-modal { display: flex; flex-direction: column; width: min(560px, 92%); max-height: 88%; padding: 14px 16px; box-sizing: border-box; border: 1px solid rgba(255, 199, 92, 0.5); border-radius: 10px; background: rgba(10, 28, 48, 0.97); box-shadow: 0 10px 36px rgba(0, 0, 0, 0.45); color: #e3f2f8; }
.route-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid rgba(255, 199, 92, 0.28); }
.route-title { font-size: 13px; font-weight: 700; color: #ffd666; }
.route-close { border: 0; background: transparent; color: #ffd666; font-size: 18px; line-height: 1; cursor: pointer; }
.route-body { display: flex; flex-direction: column; gap: 9px; overflow-y: auto; padding: 10px 2px 2px; }
.route-intro { margin: 0; font-size: 11px; line-height: 1.7; color: #bfe0ee; }
.route-step { padding: 8px 10px; border: 1px solid rgba(137, 210, 233, 0.16); border-radius: 7px; background: rgba(21, 48, 78, 0.35); }
.route-step-title { font-size: 11px; font-weight: 700; color: #7fd0e6; }
.route-text { margin: 4px 0 0; font-size: 11px; line-height: 1.75; color: #c7dce8; }
.layer-legend { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 8; width: min(420px, 68%); padding: 9px 12px; box-sizing: border-box; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 8px; background: rgba(10, 26, 52, 0.88); backdrop-filter: blur(6px); color: #dce8f5; pointer-events: none; }
.layer-legend-head { font-size: 11px; font-weight: 700; color: #eaf3ff; }
.legend-bar { height: 10px; margin-top: 5px; border-radius: 3px; border: 1px solid rgba(157, 188, 224, 0.25); }
.legend-labels { display: flex; justify-content: space-between; margin-top: 2px; font-size: 9px; color: #9fb8d4; }
.legend-items { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 5px; font-size: 10px; color: #c3d5e8; }
.legend-item { display: inline-flex; align-items: center; gap: 4px; }
.legend-swatch { display: inline-block; width: 11px; height: 11px; border-radius: 2px; border: 1px solid rgba(157, 188, 224, 0.35); }
.layer-legend-desc { margin: 6px 0 0; font-size: 10px; line-height: 1.5; color: #b9cde0; }
.report-backdrop { position: absolute; inset: 0; z-index: 90; display: flex; flex-direction: column; background: #fff; color: #16232e; }
.report-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 16px; border-bottom: 1px solid #d5dee5; background: #eef4f8; }
.report-toolbar-title { font-size: 13px; font-weight: 700; color: #17324d; }
.report-actions { display: flex; align-items: center; gap: 8px; }
.report-btn { border: 1px solid #2f80ed; border-radius: 5px; padding: 4px 12px; cursor: pointer; background: #fff; color: #2f80ed; font-size: 12px; }
.report-btn.active { background: #2f80ed; color: #fff; }
.report-btn.accent { border-color: #c9971c; background: #c9971c; color: #fff; }
.report-close { border: 0; background: transparent; color: #5b6b7a; cursor: pointer; font-size: 20px; line-height: 1; }
.report-body { flex: 1; min-height: 0; display: flex; }
.report-scroll { flex: 1; overflow: auto; }
.report-pdf { flex: 1; min-height: 0; display: flex; }
.pdf-frame { flex: 1; width: 100%; border: 0; }
.pdf-loading { margin: auto; color: #5b6b7a; font-size: 13px; }
.report-doc { width: 820px; max-width: 100%; margin: 0 auto; padding: 24px 34px 44px; box-sizing: border-box; background: #fff; }
.report-h1 { margin: 0 0 6px; font-size: 20px; color: #17324d; }
.report-meta { margin: 0 0 6px; font-size: 11px; color: #6a7b8a; }
.report-intro { margin: 0 0 10px; font-size: 12px; line-height: 1.6; color: #3b5061; }
.report-h2 { margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #cfe0ec; font-size: 14px; color: #124c7d; }
.report-kv { display: grid; grid-template-columns: 180px 1fr; gap: 2px 10px; margin: 4px 0 6px; font-size: 12px; }
.report-kv dt { color: #3c5a73; font-weight: 600; }
.report-kv dd { margin: 0; color: #1e2f3d; }
.report-line { margin: 3px 0; font-size: 12px; line-height: 1.6; color: #1e2f3d; }
.report-figure { margin: 8px 0 4px; }
.report-figure img { display: block; width: 100%; height: auto; border: 1px solid #c9d6e0; image-rendering: pixelated; }
.report-figure figcaption { margin-top: 4px; font-size: 11px; color: #5b6b7a; }
</style>
