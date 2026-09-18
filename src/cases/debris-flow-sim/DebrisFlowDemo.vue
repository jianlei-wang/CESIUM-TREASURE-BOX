<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  BoundingSphere,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  GeoJsonDataSource,
  HeadingPitchRange,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Entity,
  type Viewer
} from 'cesium'
import type { Feature, FeatureCollection } from 'geojson'
import { createMapScene, destroyScene, loadBingImagery, loadWorldTerrain, type SceneCallbacks } from '../../lib/cesium-scene'
import { SimulationDomain } from '../debris-flow-lib/domain'
import { DebrisFlowSimulation } from '../debris-flow-lib/gpu-sim'
import {
  BRUSH_LABELS,
  DEFAULT_PARAMETERS,
  PARAMETER_HINTS,
  VISUAL_MODE_LABELS,
  type BrushKind,
  type DebrisFlowParameters,
  type VisualMode
} from '../debris-flow-lib/types'
import {
  buildReportBodyHtml,
  downloadBlob,
  nowStamp,
  renderReportPdf,
  type DebrisReportModel,
  type ReportSection
} from './report'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图与地形…')
const running = ref(false)
const recording = ref(true)
const drawingMode = ref(false)
const reportEl = ref<HTMLElement | null>(null)
const reportOpen = ref(false)
const reportHtml = ref('')

interface RegionOption {
  id: string
  label: string
  lon: number
  lat: number
  width: number
  height: number
}

const REGION_PRESETS: RegionOption[] = [
  { id: 'zhouqu', label: '甘肃舟曲', lon: 104.37, lat: 33.79, width: 3000, height: 3000 },
  { id: 'wenchuan', label: '四川汶川', lon: 103.6, lat: 31.45, width: 4000, height: 4000 },
  { id: 'jiangjiagou', label: '云南蒋家沟', lon: 103.13, lat: 26.24, width: 4000, height: 4000 }
]

const GRID_RES = 512
const GRID_RES_OPTIONS = [256, 384, 512, 768, 1024]
const MIN_SPAN = 800
const MAX_SPAN = 12000

const BRUSH_RADIUS_MIN = 1
const BRUSH_RADIUS_MAX = 10

const ui = reactive({
  regionId: REGION_PRESETS[0].id,
  gridRes: GRID_RES,
  showBrushGhost: true,
  ghostOpacity: 0.6,
  brush: 'water' as BrushKind,
  brushRadius: 4,
  brushStrength: 0.4,
  rainOn: true,
  rainfall: 40,
  timeScale: 1,
  visualMode: 0 as VisualMode,
  erosionThreshold: 0.0005,
  impactThreshold: 0.0001,
  parameters: { ...DEFAULT_PARAMETERS } as DebrisFlowParameters
})

const stats = reactive({
  frame: 0,
  simTime: 0,
  substeps: 0,
  maxDepth: 0,
  maxSpeed: 0,
  erodedVolume: 0,
  depositedVolume: 0,
  wetCells: 0,
  fps: 0
})

const timeline = reactive({
  index: 0,
  active: false,
  count: 0,
  limit: 0
})

const vectorInfo = reactive({ count: 0 })
const impactInfo = reactive({ count: 0 })

const parameterControls: Array<{ key: keyof DebrisFlowParameters; label: string; min: number; max: number; step: number }> = [
  { key: 'yieldStress', label: '屈服应力 τy (Pa)', min: 0, max: 2000, step: 10 },
  { key: 'consistencyK', label: '稠度系数 K', min: 0, max: 200, step: 1 },
  { key: 'flowIndexN', label: '流动指数 n', min: 0.1, max: 1.5, step: 0.05 },
  { key: 'erosionCoeff', label: '侵蚀系数 Er', min: 0, max: 5e-4, step: 1e-5 },
  { key: 'depositionCoeff', label: '沉积系数 Dr', min: 0, max: 0.5, step: 0.01 },
  { key: 'criticalShear', label: '临界剪应力 τc (Pa)', min: 0, max: 100, step: 1 },
  { key: 'maxConcentration', label: '最大浓度 Cmax', min: 0.1, max: 0.9, step: 0.02 },
  { key: 'cflNumber', label: 'CFL 数', min: 0.1, max: 0.9, step: 0.05 },
  { key: 'maxSubsteps', label: '最大子步数', min: 1, max: 20, step: 1 },
  { key: 'erosionVertexScale', label: '侵蚀显示倍率', min: 0.5, max: 5, step: 0.1 }
]

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let domain: SimulationDomain | undefined
let sim: DebrisFlowSimulation | undefined
let dragging = false
let statsTimer = 0
let drawFirst: Cartesian3 | undefined
let drawEntity: Entity | undefined
let drawCorners: Cartesian3[] = []
let regionEntity: Entity | undefined
let vectorDataSource: GeoJsonDataSource | undefined
let impactDataSource: GeoJsonDataSource | undefined
let currentRegion: RegionOption | undefined

function formatValue(value: number): string {
  if (Math.abs(value) < 0.001 && value !== 0) return value.toExponential(1)
  return Number.isInteger(value) ? String(value) : value.toFixed(3)
}

function thresholdMm(): string {
  return (ui.erosionThreshold * 1000).toFixed(3)
}

function impactThresholdMm(): string {
  return (ui.impactThreshold * 1000).toFixed(3)
}

function formatVolume(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}e6 m³`
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}e3 m³`
  return `${value.toFixed(1)} m³`
}

/** 优先使用深度拾取，失败时回退到地形/椭球面求交，保证区域边缘也能取到网格坐标。 */
function pickCartesian(position: Cartesian2): Cartesian3 | null {
  if (!viewer || viewer.isDestroyed()) return null
  const scene = viewer.scene
  const direct = scene.pickPosition(position)
  if (direct) return direct
  const ray = viewer.camera.getPickRay(position)
  if (ray) {
    const picked = scene.globe.pick(ray, scene)
    if (picked) return picked
  }
  return viewer.camera.pickEllipsoid(position, scene.globe.ellipsoid) ?? null
}

function positionToGrid(position: Cartesian2): { i: number; j: number } | null {
  if (!viewer || viewer.isDestroyed() || !domain) return null
  const cartesian = pickCartesian(position)
  if (!cartesian) return null
  const enu = domain.ecefToENU(cartesian)
  const grid = domain.enuToGrid(enu.e, enu.n)
  const i = Math.floor(grid.i)
  const j = Math.floor(grid.j)
  if (i < 0 || j < 0 || i >= domain.gridResX || j >= domain.gridResY) return null
  return { i, j }
}

function effectiveBrushRadius(): number {
  return ui.brush === 'breach' ? ui.brushRadius * 2 : ui.brushRadius
}

function updateBrushGhost(position: Cartesian2): void {
  if (!sim || !domain || !viewer || viewer.isDestroyed()) return
  if (!ui.showBrushGhost || ui.brush === 'rain' || ui.brush === 'erase') {
    sim.setBrushGhost(0, 0, 0, false)
    return
  }
  const cartesian = pickCartesian(position)
  if (!cartesian) {
    sim.setBrushGhost(0, 0, 0, false)
    return
  }
  const enu = domain.ecefToENU(cartesian)
  const grid = domain.enuToGrid(enu.e, enu.n)
  const inside = grid.i >= 0 && grid.i <= domain.gridResX && grid.j >= 0 && grid.j <= domain.gridResY
  sim.setBrushGhost(grid.i, grid.j, effectiveBrushRadius(), inside, ui.ghostOpacity)
}

function applyBrush(position: Cartesian2, clickOnly: boolean): void {
  if (!sim) return
  const grid = positionToGrid(position)
  if (!grid) return
  switch (ui.brush) {
    case 'water':
      sim.injectWater(grid.i, grid.j, ui.brushRadius, ui.brushStrength)
      break
    case 'sediment':
      sim.injectSediment(grid.i, grid.j, ui.brushRadius, ui.brushStrength)
      break
    case 'obstacle':
      sim.markObstacle(grid.i, grid.j, ui.brushRadius)
      break
    case 'breach':
      if (clickOnly) sim.breachDam(grid.i, grid.j, ui.brushRadius * 2, ui.brushStrength * 200, 0.45)
      break
    case 'rain':
      if (clickOnly) ui.rainOn = !ui.rainOn
      break
    case 'erase':
      if (clickOnly) sim.erase()
      break
  }
}

function domainCorners(target: SimulationDomain): Cartesian3[] {
  const r = target.rectangle
  const c0 = Cartesian3.fromRadians(r.west, r.south, 0)
  const c1 = Cartesian3.fromRadians(r.east, r.south, 0)
  const c2 = Cartesian3.fromRadians(r.east, r.north, 0)
  const c3 = Cartesian3.fromRadians(r.west, r.north, 0)
  return [c0, c1, c2, c3, c0]
}

function updateRegionBoundary(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (regionEntity) {
    viewer.entities.remove(regionEntity)
    regionEntity = undefined
  }
  if (!domain) return
  regionEntity = viewer.entities.add({
    polyline: {
      positions: domainCorners(domain),
      clampToGround: true,
      width: 2.5,
      material: Color.CYAN
    }
  })
}

function flyToDomain(target: SimulationDomain, duration = 1.2): void {
  if (!viewer || viewer.isDestroyed()) return
  const diagonal = Math.hypot(target.widthMeters, target.heightMeters)
  const radius = diagonal * 0.62 + 800
  const sphere = new BoundingSphere(target.enuToCartesian(0, 0, 0), radius)
  const range = radius / Math.tan(CesiumMath.toRadians(30))
  viewer.camera.flyToBoundingSphere(sphere, {
    offset: new HeadingPitchRange(0, CesiumMath.toRadians(-58), range),
    duration
  })
}

function pickGlobeCartesian(position: Cartesian2): Cartesian3 | null {
  if (!viewer || viewer.isDestroyed()) return null
  const scene = viewer.scene
  const ray = viewer.camera.getPickRay(position)
  if (ray) {
    const picked = scene.globe.pick(ray, scene)
    if (picked) return picked
  }
  return viewer.camera.pickEllipsoid(position, scene.globe.ellipsoid) ?? null
}

function rectCorners(a: Cartesian3, b: Cartesian3): Cartesian3[] {
  const ca = Cartographic.fromCartesian(a)
  const cb = Cartographic.fromCartesian(b)
  const w = Math.min(ca.longitude, cb.longitude)
  const e = Math.max(ca.longitude, cb.longitude)
  const s = Math.min(ca.latitude, cb.latitude)
  const n = Math.max(ca.latitude, cb.latitude)
  const c0 = Cartesian3.fromRadians(w, s, 0)
  const c1 = Cartesian3.fromRadians(e, s, 0)
  const c2 = Cartesian3.fromRadians(e, n, 0)
  const c3 = Cartesian3.fromRadians(w, n, 0)
  return [c0, c1, c2, c3, c0]
}

function ensureDrawEntity(): void {
  if (!viewer || viewer.isDestroyed() || drawEntity) return
  drawEntity = viewer.entities.add({
    polyline: {
      positions: new CallbackProperty(() => drawCorners, false),
      clampToGround: true,
      width: 3,
      material: Color.YELLOW
    }
  })
}

function removeDrawEntity(): void {
  if (viewer && !viewer.isDestroyed() && drawEntity) viewer.entities.remove(drawEntity)
  drawEntity = undefined
  drawCorners = []
}

function enterDrawMode(): void {
  if (!viewer || viewer.isDestroyed()) return
  drawFirst = undefined
  drawingMode.value = true
  removeDrawEntity()
  statusMessage.value = '自定义框选：在地图上依次点击矩形对角两点（再次点击「自定义框选」取消）'
}

function cancelDraw(): void {
  drawFirst = undefined
  drawingMode.value = false
  removeDrawEntity()
  statusMessage.value = ''
}

function updateDrawPreview(position: Cartesian2): void {
  if (!drawFirst) return
  const cart = pickGlobeCartesian(position)
  if (!cart) return
  drawCorners = rectCorners(drawFirst, cart)
  ensureDrawEntity()
}

function finishDraw(a: Cartesian3, b: Cartesian3): void {
  const ca = Cartographic.fromCartesian(a)
  const cb = Cartographic.fromCartesian(b)
  const lonA = CesiumMath.toDegrees(ca.longitude)
  const lonB = CesiumMath.toDegrees(cb.longitude)
  const latA = CesiumMath.toDegrees(ca.latitude)
  const latB = CesiumMath.toDegrees(cb.latitude)
  const centerLon = (lonA + lonB) / 2
  const centerLat = (latA + latB) / 2
  const metersPerDegree = 111320
  const width = Math.min(
    MAX_SPAN,
    Math.max(MIN_SPAN, Math.abs(lonB - lonA) * metersPerDegree * Math.max(Math.cos(CesiumMath.toRadians(centerLat)), 1e-6))
  )
  const height = Math.min(MAX_SPAN, Math.max(MIN_SPAN, Math.abs(latB - latA) * metersPerDegree))
  cancelDraw()
  ui.regionId = 'custom'
  void applyRegion(centerLon, centerLat, width, height, '自定义区域')
}

function handleDrawClick(position: Cartesian2): void {
  const cart = pickGlobeCartesian(position)
  if (!cart) return
  if (!drawFirst) {
    drawFirst = Cartesian3.clone(cart)
    drawCorners = rectCorners(cart, cart)
    ensureDrawEntity()
    return
  }
  finishDraw(drawFirst, cart)
}

async function applyRegion(lon: number, lat: number, width: number, height: number, label: string): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  stop()
  clearVectorPreview()
  clearImpactPreview()
  timeline.count = 0
  timeline.index = 0
  timeline.active = false
  currentRegion = { id: ui.regionId, label, lon, lat, width, height }
  domain = new SimulationDomain({
    centerLon: lon,
    centerLat: lat,
    widthMeters: width,
    heightMeters: height,
    gridResX: ui.gridRes,
    gridResY: ui.gridRes
  })
  updateRegionBoundary()
  stats.frame = 0
  stats.substeps = 0
  stats.simTime = 0
  statusMessage.value = `正在切换至${label}并采样地形…`
  flyToDomain(domain)
  await start()
}

function selectPreset(preset: RegionOption): void {
  if (drawingMode.value) cancelDraw()
  ui.regionId = preset.id
  void applyRegion(preset.lon, preset.lat, preset.width, preset.height, preset.label)
}

function installHandlers(): void {
  if (!viewer) return
  handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  handler.setInputAction((event: { position: Cartesian2 }) => {
    if (drawingMode.value) return
    dragging = true
    applyBrush(event.position, true)
  }, ScreenSpaceEventType.LEFT_DOWN)
  handler.setInputAction((event: { endPosition: Cartesian2 }) => {
    if (drawingMode.value) {
      updateDrawPreview(event.endPosition)
      return
    }
    updateBrushGhost(event.endPosition)
    if (dragging) applyBrush(event.endPosition, false)
  }, ScreenSpaceEventType.MOUSE_MOVE)
  handler.setInputAction(() => {
    dragging = false
  }, ScreenSpaceEventType.LEFT_UP)
  handler.setInputAction((event: { position: Cartesian2 }) => {
    if (drawingMode.value) {
      handleDrawClick(event.position)
      return
    }
    updateBrushGhost(event.position)
    applyBrush(event.position, true)
  }, ScreenSpaceEventType.LEFT_CLICK)
}

async function start(): Promise<void> {
  if (!viewer || viewer.isDestroyed() || !domain || sim) return
  statusMessage.value = '正在采样地形并初始化 GPU 管线…'
  try {
    const instance = new DebrisFlowSimulation({
      viewer,
      domain,
      terrainProvider: viewer.terrainProvider,
      parameters: { ...ui.parameters },
      gridRes: ui.gridRes,
      visualMode: ui.visualMode,
      onStatus: (message) => {
        statusMessage.value = message
      }
    })
    sim = instance
    await instance.initialize()
    if (!viewer || viewer.isDestroyed()) {
      instance.destroy()
      sim = undefined
      return
    }
    viewer.scene.primitives.add(instance as never)
    instance.setRainfall(ui.rainOn ? ui.rainfall : 0)
    instance.setGhostOpacity(ui.ghostOpacity)
    instance.setErosionReference(ui.erosionThreshold)
    recording.value = instance.isHistoryRecording()
    timeline.limit = instance.getHistoryLimit()
    instance.play()
    running.value = true
    statusMessage.value = ''
  } catch (error) {
    sim = undefined
    statusMessage.value = `初始化失败：${error instanceof Error ? error.message : String(error)}`
  }
}

function stop(): void {
  if (sim) {
    sim.destroy()
    sim = undefined
  }
  running.value = false
  statusMessage.value = ''
}

function toggle(): void {
  if (!sim) {
    void start()
    return
  }
  if (timeline.active) goLive()
  if (sim.isPaused()) {
    sim.play()
    running.value = true
  } else {
    sim.pause()
    running.value = false
  }
}

function toggleHistoryRecording(): void {
  if (!sim) return
  const next = !sim.isHistoryRecording()
  sim.setHistoryRecording(next)
  recording.value = next
  statusMessage.value = next ? '已继续记录历史关键帧' : '已停止记录历史关键帧'
  window.setTimeout(() => {
    if (statusMessage.value.startsWith('已停止记录') || statusMessage.value.startsWith('已继续记录')) statusMessage.value = ''
  }, 2200)
}

function step(): void {
  if (!sim) return
  if (sim.isHistoryMode()) goLive()
  sim.step(4)
}

function reset(): void {
  sim?.reset()
  sim?.play()
  sim?.setRainfall(ui.rainOn ? ui.rainfall : 0)
  sim?.setErosionReference(ui.erosionThreshold)
  recording.value = sim ? sim.isHistoryRecording() : true
  running.value = !!sim
  timeline.count = 0
  timeline.index = 0
  timeline.active = false
  clearVectorPreview()
  clearImpactPreview()
}

function flushParameters(): void {
  if (!sim) return
  for (const control of parameterControls) {
    sim.setParameter(control.key, ui.parameters[control.key])
  }
}

function scrubTimeline(): void {
  if (!sim || timeline.count === 0) return
  const idx = Math.min(timeline.count - 1, Math.max(0, Math.round(timeline.index)))
  timeline.index = idx
  timeline.active = true
  sim.setHistoryFrame(idx)
}

function goLive(): void {
  timeline.active = false
  sim?.resumeLive()
}

function buildErosionGeoJson(): FeatureCollection | null {
  if (!sim || !domain) return null
  const snap = sim.exportSnapshot()
  if (!snap) return null
  const { width, height, terrain } = snap
  const activeDomain = domain
  const lonLatAt = (i: number, j: number): [number, number] => {
    const e = (i / width - 0.5) * activeDomain.widthMeters
    const n = (j / height - 0.5) * activeDomain.heightMeters
    const carto = Cartographic.fromCartesian(activeDomain.enuToCartesian(e, n, 0))
    return [CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude)]
  }
  const threshold = ui.erosionThreshold
  const cellArea = activeDomain.cellArea
  const region = currentRegion?.label ?? '未设置'
  const timeS = Number(stats.simTime.toFixed(2))
  const features: Feature[] = []
  for (let j = 0; j < height; j += 1) {
    let runStart = -1
    let runMax = 0
    let runSum = 0
    for (let i = 0; i <= width; i += 1) {
      const lowering =
        i < width ? terrain[(j * width + i) * 4 + 1] - terrain[(j * width + i) * 4] : -Infinity
      if (lowering > threshold) {
        if (runStart < 0) {
          runStart = i
          runMax = lowering
          runSum = lowering
        } else {
          if (lowering > runMax) runMax = lowering
          runSum += lowering
        }
      } else if (runStart >= 0) {
        const cells = i - runStart
        const ring = [lonLatAt(runStart, j), lonLatAt(i, j), lonLatAt(i, j + 1), lonLatAt(runStart, j + 1), lonLatAt(runStart, j)]
        features.push({
          type: 'Feature',
          properties: {
            kind: 'erosion',
            region,
            time_s: timeS,
            threshold_m: Number(threshold.toFixed(6)),
            area_m2: Number((cells * cellArea).toFixed(1)),
            grid_cells: cells,
            max_lowering_m: Number(runMax.toFixed(5)),
            mean_lowering_m: Number((runSum / cells).toFixed(5))
          },
          geometry: { type: 'Polygon', coordinates: [ring] }
        })
        runStart = -1
      }
    }
  }
  return { type: 'FeatureCollection', features }
}

/**
 * 整体影响范围：将「侵蚀 / 淤积 / 积水」影响过的网格按块聚合、纵向合并为矩形多边形，
 * 每个多边形携带面积、最大侵蚀、最大淤积、平均床面变化、积水格点等属性。
 */
function buildImpactGeoJson(): FeatureCollection | null {
  if (!sim || !domain) return null
  const snap = sim.exportSnapshot()
  if (!snap) return null
  const { width, height, terrain, flux } = snap
  const activeDomain = domain
  const threshold = ui.impactThreshold
  const minDepth = ui.parameters.minDepth
  const cellArea = activeDomain.cellArea

  const lonLatAt = (i: number, j: number): [number, number] => {
    const e = (i / width - 0.5) * activeDomain.widthMeters
    const n = (j / height - 0.5) * activeDomain.heightMeters
    const carto = Cartographic.fromCartesian(activeDomain.enuToCartesian(e, n, 0))
    return [CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude)]
  }

  const block = Math.max(2, Math.round(width / 64))
  const bw = Math.ceil(width / block)
  const bh = Math.ceil(height / block)
  const anyImpact = new Uint8Array(bw * bh)
  const wetCells = new Float64Array(bw * bh)
  const maxEro = new Float64Array(bw * bh)
  const maxDep = new Float64Array(bw * bh)
  const changeSum = new Float64Array(bw * bh)
  const cellCount = new Float64Array(bw * bh)

  for (let j = 0; j < height; j += 1) {
    const bj = Math.min(bh - 1, Math.floor(j / block))
    for (let i = 0; i < width; i += 1) {
      const k = (j * width + i) * 4
      const change = terrain[k + 1] - terrain[k]
      const wet = flux[k] > minDepth
      const b = bj * bw + Math.min(bw - 1, Math.floor(i / block))
      if (Math.abs(change) > threshold || wet) anyImpact[b] = 1
      if (change > maxEro[b]) maxEro[b] = change
      if (-change > maxDep[b]) maxDep[b] = -change
      changeSum[b] += Math.abs(change)
      cellCount[b] += 1
      if (wet) wetCells[b] += 1
    }
  }

  interface Rect {
    i0: number
    i1: number
    j0: number
    j1: number
  }
  const rects: Rect[] = []
  let open: Rect[] = []
  for (let bj = 0; bj < bh; bj += 1) {
    const runs: Array<[number, number]> = []
    let start = -1
    for (let bi = 0; bi <= bw; bi += 1) {
      const on = bi < bw && anyImpact[bj * bw + bi] === 1
      if (on && start < 0) start = bi
      else if (!on && start >= 0) {
        runs.push([start, bi])
        start = -1
      }
    }
    const used = new Array<boolean>(runs.length).fill(false)
    const nextOpen: Rect[] = []
    for (const rect of open) {
      const idx = runs.findIndex((r, k) => !used[k] && r[0] === rect.i0 && r[1] === rect.i1)
      if (idx >= 0) {
        used[idx] = true
        rect.j1 = bj + 1
        nextOpen.push(rect)
      } else {
        rects.push(rect)
      }
    }
    runs.forEach((r, idx) => {
      if (!used[idx]) nextOpen.push({ i0: r[0], i1: r[1], j0: bj, j1: bj + 1 })
    })
    open = nextOpen
  }
  rects.push(...open)

  const region = currentRegion?.label ?? '未设置'
  const timeS = Number(stats.simTime.toFixed(2))
  const features: Feature[] = []
  for (const rect of rects) {
    let cells = 0
    let wet = 0
    let erosion = 0
    let deposition = 0
    let sum = 0
    for (let bj = rect.j0; bj < rect.j1; bj += 1) {
      for (let bi = rect.i0; bi < rect.i1; bi += 1) {
        const b = bj * bw + bi
        cells += cellCount[b]
        wet += wetCells[b]
        if (maxEro[b] > erosion) erosion = maxEro[b]
        if (maxDep[b] > deposition) deposition = maxDep[b]
        sum += changeSum[b]
      }
    }
    const i0 = rect.i0 * block
    const i1 = Math.min(width, rect.i1 * block)
    const j0 = rect.j0 * block
    const j1 = Math.min(height, rect.j1 * block)
    const ring = [lonLatAt(i0, j0), lonLatAt(i1, j0), lonLatAt(i1, j1), lonLatAt(i0, j1), lonLatAt(i0, j0)]
    features.push({
      type: 'Feature',
      properties: {
        kind: 'impact',
        region,
        time_s: timeS,
        threshold_m: Number(threshold.toFixed(6)),
        area_m2: Number((cells * cellArea).toFixed(1)),
        grid_cells: Math.round(cells),
        wet_cells: Math.round(wet),
        max_erosion_m: Number(erosion.toFixed(5)),
        max_deposition_m: Number(deposition.toFixed(5)),
        mean_abs_change_m: cells > 0 ? Number((sum / cells).toFixed(5)) : 0,
        has_erosion: erosion > threshold ? 1 : 0,
        has_deposition: deposition > threshold ? 1 : 0,
        has_inundation: wet > 0 ? 1 : 0
      },
      geometry: { type: 'Polygon', coordinates: [ring] }
    })
  }
  return { type: 'FeatureCollection', features }
}

function clearVectorPreview(): void {
  if (viewer && !viewer.isDestroyed() && vectorDataSource) {
    viewer.dataSources.remove(vectorDataSource, true)
  }
  vectorDataSource = undefined
  vectorInfo.count = 0
}

function clearImpactPreview(): void {
  if (viewer && !viewer.isDestroyed() && impactDataSource) {
    viewer.dataSources.remove(impactDataSource, true)
  }
  impactDataSource = undefined
  impactInfo.count = 0
}

async function previewErosionVectors(): Promise<void> {
  if (!viewer || viewer.isDestroyed() || !sim) return
  const geojson = buildErosionGeoJson()
  if (!geojson) {
    statusMessage.value = '请先开始模拟并产生侵蚀后再矢量化'
    return
  }
  clearVectorPreview()
  vectorInfo.count = geojson.features.length
  if (geojson.features.length === 0) {
    statusMessage.value = `当前阈值（${thresholdMm()} mm）下未检测到侵蚀范围，可调低阈值后重试`
    return
  }
  try {
    vectorDataSource = await GeoJsonDataSource.load(geojson as never, {
      clampToGround: true,
      stroke: Color.fromCssColorString('#ff2d55'),
      strokeWidth: 1.5,
      fill: Color.fromCssColorString('#ff2d55').withAlpha(0.35)
    })
    await viewer.dataSources.add(vectorDataSource)
    statusMessage.value = `已矢量化侵蚀范围：${geojson.features.length} 个多边形`
    window.setTimeout(() => {
      if (statusMessage.value.startsWith('已矢量化')) statusMessage.value = ''
    }, 2600)
  } catch (error) {
    statusMessage.value = `矢量化失败：${error instanceof Error ? error.message : String(error)}`
  }
}

function exportErosionGeoJson(): void {
  const geojson = buildErosionGeoJson()
  if (!geojson || geojson.features.length === 0) {
    statusMessage.value = `当前阈值（${thresholdMm()} mm）下没有可导出的侵蚀范围`
    return
  }
  vectorInfo.count = geojson.features.length
  downloadBlob(
    new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' }),
    `debris-erosion-${nowStamp()}.geojson`
  )
  statusMessage.value = `已导出 GeoJSON（${geojson.features.length} 个多边形）`
  window.setTimeout(() => {
    if (statusMessage.value.startsWith('已导出')) statusMessage.value = ''
  }, 2600)
}

async function previewImpactVectors(): Promise<void> {
  if (!viewer || viewer.isDestroyed() || !sim) return
  const geojson = buildImpactGeoJson()
  if (!geojson) {
    statusMessage.value = '请先开始模拟并产生影响后再矢量化'
    return
  }
  clearImpactPreview()
  impactInfo.count = geojson.features.length
  if (geojson.features.length === 0) {
    statusMessage.value = `当前影响阈值（${impactThresholdMm()} mm）下未检测到影响范围，可调低阈值后重试`
    return
  }
  try {
    impactDataSource = await GeoJsonDataSource.load(geojson as never, {
      clampToGround: true,
      stroke: Color.fromCssColorString('#ff9f1a'),
      strokeWidth: 2,
      fill: Color.fromCssColorString('#ff9f1a').withAlpha(0.3)
    })
    impactDataSource.name = '整体影响范围'
    await viewer.dataSources.add(impactDataSource)
    statusMessage.value = `已矢量化整体影响范围：${geojson.features.length} 个多边形（含属性）`
    window.setTimeout(() => {
      if (statusMessage.value.startsWith('已矢量化整体')) statusMessage.value = ''
    }, 2600)
  } catch (error) {
    statusMessage.value = `整体影响范围矢量化失败：${error instanceof Error ? error.message : String(error)}`
  }
}

function exportImpactGeoJson(): void {
  const geojson = buildImpactGeoJson()
  if (!geojson || geojson.features.length === 0) {
    statusMessage.value = `当前影响阈值（${impactThresholdMm()} mm）下没有可导出的影响范围`
    return
  }
  impactInfo.count = geojson.features.length
  downloadBlob(
    new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' }),
    `debris-impact-${nowStamp()}.geojson`
  )
  statusMessage.value = `已导出整体影响范围 GeoJSON（${geojson.features.length} 个多边形，含属性）`
  window.setTimeout(() => {
    if (statusMessage.value.startsWith('已导出整体')) statusMessage.value = ''
  }, 2600)
}

function buildReportModel(): DebrisReportModel {
  const region = currentRegion
  const frames = sim?.getHistoryInfo() ?? []
  const sections: ReportSection[] = []

  sections.push({
    title: '模拟区域',
    kv: [
      { label: '区域名称', value: region?.label ?? '未设置' },
      { label: '中心经纬度', value: region ? `${region.lon.toFixed(4)}°, ${region.lat.toFixed(4)}°` : '-' },
      { label: '区域范围', value: region ? `${region.width.toFixed(0)} m × ${region.height.toFixed(0)} m` : '-' },
      { label: '网格精度', value: `${ui.gridRes} × ${ui.gridRes}` },
      { label: 'DEM 来源', value: 'Cesium World Terrain' }
    ],
    lines: ['高程通过 sampleTerrainMostDetailed 采样后双线性插值至模拟网格，覆盖层贴地叠加显示。']
  })

  sections.push({
    title: '当前运行统计',
    kv: [
      { label: '模拟步数', value: `${stats.frame} 帧 / ${stats.substeps} 子步` },
      { label: '模拟时间', value: `${stats.simTime.toFixed(1)} s` },
      { label: '最大水深', value: `${stats.maxDepth.toFixed(2)} m` },
      { label: '最大流速', value: `${stats.maxSpeed.toFixed(2)} m/s` },
      { label: '湿润格点', value: `${stats.wetCells}` },
      { label: '侵蚀体积', value: formatVolume(stats.erodedVolume) },
      { label: '淤积体积', value: formatVolume(stats.depositedVolume) }
    ]
  })

  sections.push({
    title: '侵蚀时间序列',
    table: {
      caption: '按时间顺序记录的关键帧统计，用于回溯各时段侵蚀发展。',
      head: ['时间 (s)', '最大水深 (m)', '最大流速 (m/s)', '侵蚀体积 (m³)', '淤积体积 (m³)'],
      body: frames.map((f) => [
        f.time.toFixed(1),
        f.maxDepth.toFixed(2),
        f.maxSpeed.toFixed(2),
        f.erodedVolume.toFixed(1),
        f.depositedVolume.toFixed(1)
      ])
    }
  })

  sections.push({
    title: '侵蚀范围矢量化',
    kv: [
      { label: '侵蚀阈值', value: `${thresholdMm()} mm（床面下切深度）` },
      { label: '侵蚀多边形数', value: `${vectorInfo.count}` },
      { label: '影响阈值', value: `${impactThresholdMm()} mm（含淤积与积水）` },
      { label: '整体影响多边形数', value: `${impactInfo.count}` }
    ],
    lines: [
      '侵蚀范围按床面下切深度超过阈值合并为多边形；整体影响范围按侵蚀/淤积/积水影响过的网格聚合，并携带面积、最大侵蚀/淤积、平均床面变化、积水格点等属性。',
      '矢量范围可在三维场景中叠加预览，并导出为 GeoJSON 供 GIS 软件进一步分析。'
    ]
  })

  sections.push({
    title: '本构与侵蚀参数',
    table: {
      caption: 'HBP 本构与超额剪切应力侵蚀模型参数。',
      head: ['参数', '取值', '说明'],
      body: parameterControls.map((c) => [c.label, formatValue(ui.parameters[c.key]), PARAMETER_HINTS[c.key]])
    }
  })

  return {
    generatedAt: new Date().toLocaleString('zh-CN'),
    intro:
      '本报告汇总 GPU 泥石流地形侵蚀模拟的区域、运行统计、侵蚀时间序列、矢量化范围与本构参数，用于侵蚀发展趋势分析与成果归档。',
    sections
  }
}

function openReport(): void {
  const model = buildReportModel()
  reportHtml.value = buildReportBodyHtml(model, 'GPU 泥石流地形侵蚀分析报告')
  reportOpen.value = true
}

async function exportReportPdf(): Promise<void> {
  if (!reportEl.value) return
  statusMessage.value = '正在生成 PDF 分析报告…'
  try {
    const blob = await renderReportPdf(reportEl.value)
    downloadBlob(blob, `debris-flow-report-${nowStamp()}.pdf`)
    statusMessage.value = '分析报告 PDF 已导出'
  } catch (error) {
    statusMessage.value = `PDF 生成失败：${error instanceof Error ? error.message : String(error)}`
  }
}

watch(
  () => ui.parameters,
  () => flushParameters(),
  { deep: true }
)

watch(
  () => ui.visualMode,
  (mode) => sim?.setVisualMode(mode)
)

watch(
  () => ui.timeScale,
  (scale) => sim?.setTimeScale(scale)
)

watch(
  () => [ui.rainOn, ui.rainfall] as const,
  ([on, rate]) => sim?.setRainfall(on ? rate : 0)
)

watch(
  () => ui.ghostOpacity,
  (opacity) => sim?.setGhostOpacity(opacity)
)

watch(
  () => ui.erosionThreshold,
  (threshold) => sim?.setErosionReference(threshold)
)

watch(
  () => ui.gridRes,
  () => {
    const region = currentRegion
    if (!region) return
    void applyRegion(region.lon, region.lat, region.width, region.height, region.label)
  }
)

watch(
  () => [ui.showBrushGhost, ui.brush] as const,
  () => {
    if (!ui.showBrushGhost || ui.brush === 'rain' || ui.brush === 'erase') {
      sim?.setBrushGhost(0, 0, 0, false)
    }
  }
)

onMounted(async () => {
  if (!container.value) return
  const callbacks: SceneCallbacks = {
    onStatus: (message) => {
      statusMessage.value = message
    }
  }
  try {
    viewer = createMapScene(container.value, callbacks)
    loadBingImagery(viewer, callbacks)
    viewer.scene.globe.depthTestAgainstTerrain = true

    const initial = REGION_PRESETS[0]
    currentRegion = { ...initial }
    domain = new SimulationDomain({
      centerLon: initial.lon,
      centerLat: initial.lat,
      widthMeters: initial.width,
      heightMeters: initial.height,
      gridResX: ui.gridRes,
      gridResY: ui.gridRes
    })
    updateRegionBoundary()

    await loadWorldTerrain(viewer)
    if (!viewer || viewer.isDestroyed()) return
    flyToDomain(domain)

    installHandlers()
    statsTimer = window.setInterval(() => {
      if (!sim) return
      const current = sim.getStats()
      stats.frame = current.frame
      stats.simTime = current.simTime
      stats.substeps = current.substeps
      stats.maxDepth = current.maxDepth
      stats.maxSpeed = current.maxSpeed
      stats.erodedVolume = current.erodedVolume
      stats.depositedVolume = current.depositedVolume
      stats.wetCells = current.wetCells
      const count = sim.getHistoryCount()
      timeline.count = count
      if (!timeline.active && count > 0) timeline.index = count - 1
    }, 300)

    await start()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (statsTimer) window.clearInterval(statsTimer)
  statsTimer = 0
  clearVectorPreview()
  clearImpactPreview()
  stop()
  if (handler && !handler.isDestroyed()) handler.destroy()
  handler = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="df-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">GPU 泥石流地形侵蚀</div>

      <div class="btn-row">
        <button class="start-btn" :class="{ running }" @click="toggle">{{ running ? '暂停' : '开始' }}</button>
        <button class="mini-btn" @click="step">步进</button>
        <button class="mini-btn" @click="reset">重置</button>
      </div>

      <div class="sec-title">模拟区域（中国山区）</div>
      <div class="region-grid">
        <button
          v-for="preset in REGION_PRESETS"
          :key="preset.id"
          class="brush-btn"
          :class="{ active: ui.regionId === preset.id }"
          @click="selectPreset(preset)"
        >
          {{ preset.label }}
        </button>
        <button class="brush-btn" :class="{ active: ui.regionId === 'custom' }" @click="enterDrawMode">自定义框选</button>
      </div>
      <p v-if="drawingMode" class="hint tight draw-hint">绘制中：在地图依次点击矩形对角两点。</p>
      <div class="slider-row">
        <label>网格精度 <em>{{ ui.gridRes }}×{{ ui.gridRes }}</em></label>
      </div>
      <div class="res-grid">
        <button
          v-for="res in GRID_RES_OPTIONS"
          :key="res"
          class="brush-btn"
          :class="{ active: ui.gridRes === res }"
          @click="ui.gridRes = res"
        >
          {{ res }}
        </button>
      </div>
      <p class="hint tight">青色框线为当前模拟区域边界，贴地显示；切换预设、自定义框选或精度后都会重建区域。</p>

      <div class="sec-title">笔刷</div>
      <div class="brush-grid">
        <button
          v-for="item in BRUSH_LABELS"
          :key="item.id"
          class="brush-btn"
          :class="{ active: ui.brush === item.id }"
          @click="ui.brush = item.id"
        >
          {{ item.label }}
        </button>
      </div>
      <p class="hint tight">{{ BRUSH_LABELS.find((b) => b.id === ui.brush)?.hint }}</p>
      <div class="slider-row">
        <label>笔刷半径 <em>{{ ui.brushRadius }} 格</em></label>
        <input type="range" :min="BRUSH_RADIUS_MIN" :max="BRUSH_RADIUS_MAX" step="1" v-model.number="ui.brushRadius" />
      </div>
      <div class="slider-row">
        <label>笔刷强度 <em>{{ ui.brushStrength.toFixed(2) }}</em></label>
        <input type="range" min="0.05" max="2" step="0.05" v-model.number="ui.brushStrength" />
      </div>
      <label class="toggle-row">
        <input type="checkbox" v-model="ui.showBrushGhost" />
        鼠标移动时显示笔刷覆盖网格虚影
      </label>
      <div class="slider-row">
        <label>虚影透明度 <em>{{ ui.ghostOpacity.toFixed(2) }}</em></label>
        <input type="range" min="0.1" max="1" step="0.05" v-model.number="ui.ghostOpacity" />
      </div>
      <div class="slider-row">
        <label>降雨强度 <em>{{ ui.rainfall }} mm/h</em></label>
        <input type="range" min="0" max="200" step="5" v-model.number="ui.rainfall" :disabled="!ui.rainOn" />
      </div>
      <label class="toggle-row">
        <input type="checkbox" v-model="ui.rainOn" />
        全域降雨（{{ ui.rainOn ? '已开启' : '已关闭' }}）
      </label>
      <p class="hint tight">降雨为全域持续补给，调节滑杆或勾选开关后实时生效；也可用「降雨」笔刷单击快速开关。</p>

      <div class="sec-title">可视化</div>
      <div class="mode-grid">
        <button
          v-for="mode in VISUAL_MODE_LABELS"
          :key="mode.id"
          class="brush-btn"
          :class="{ active: ui.visualMode === mode.id }"
          @click="ui.visualMode = mode.id"
        >
          {{ mode.label }}
        </button>
      </div>

      <div class="sec-title">模拟控制</div>
      <div class="slider-row">
        <label>时间倍率 <em>{{ ui.timeScale.toFixed(2) }}×</em></label>
        <input type="range" min="0.1" max="4" step="0.1" v-model.number="ui.timeScale" />
      </div>

      <div class="sec-title">时间轴回溯</div>
      <div class="slider-row">
        <label>
          历史关键帧 <em>{{ timeline.count === 0 ? '暂无' : `${timeline.index + 1} / ${timeline.count}` }}</em>
        </label>
        <input
          type="range"
          min="0"
          :max="Math.max(0, timeline.count - 1)"
          step="1"
          :disabled="timeline.count === 0"
          v-model.number="timeline.index"
          @input="scrubTimeline"
        />
      </div>
      <div class="btn-row">
        <button class="mini-btn" :class="{ active: timeline.active }" @click="scrubTimeline">回溯至此</button>
        <button class="mini-btn" @click="goLive">回到实时</button>
      </div>
      <div class="btn-row">
        <button class="mini-btn" :class="{ active: recording }" @click="toggleHistoryRecording">
          {{ recording ? '停止记录' : '继续记录' }}
        </button>
      </div>
      <p class="hint tight">
        运行过程中每约 1 秒记录一次关键帧，未点击「停止记录」前会持续滚动记录；为控制内存占用，仅保留最近 {{ timeline.limit || '—' }} 帧，超出后自动覆盖最早帧（点击「重置」时清空），可回溯查看各时段侵蚀分布。
      </p>

      <div class="sec-title">侵蚀与影响范围矢量化</div>
      <div class="slider-row">
        <label>侵蚀阈值 <em>{{ thresholdMm() }} mm</em></label>
        <input type="range" min="0.00005" max="0.005" step="0.00005" v-model.number="ui.erosionThreshold" />
      </div>
      <div class="btn-row">
        <button class="mini-btn" @click="previewErosionVectors">预览侵蚀</button>
        <button class="mini-btn" @click="exportErosionGeoJson">导出侵蚀</button>
        <button class="mini-btn" @click="clearVectorPreview">清除</button>
      </div>
      <p class="hint tight">
        侵蚀范围：床面下切深度超过阈值的网格合并为多边形（WGS84 经纬度），导出属性含面积、最大/平均下切深度。
      </p>
      <div class="slider-row">
        <label>影响阈值 <em>{{ impactThresholdMm() }} mm</em></label>
        <input type="range" min="0.00001" max="0.002" step="0.00001" v-model.number="ui.impactThreshold" />
      </div>
      <div class="btn-row">
        <button class="mini-btn" @click="previewImpactVectors">预览影响</button>
        <button class="mini-btn" @click="exportImpactGeoJson">导出影响</button>
        <button class="mini-btn" @click="clearImpactPreview">清除</button>
      </div>
      <p class="hint tight">
        整体影响范围：侵蚀、淤积或积水影响过的网格聚合并纵向合并为矩形多边形，导出属性含区域、时间、面积、最大侵蚀/淤积、平均床面变化、积水格点等。
      </p>

      <div class="sec-title">分析报告</div>
      <div class="btn-row">
        <button class="mini-btn" @click="openReport">预览报告</button>
      </div>
      <p class="hint tight">汇总区域、统计、侵蚀时间序列与参数，支持在线预览并导出 PDF。</p>

      <div class="sec-title">本构与侵蚀参数</div>
      <div class="param-block" v-for="control in parameterControls" :key="control.key">
        <div class="slider-row">
          <label>{{ control.label }} <em>{{ formatValue(ui.parameters[control.key]) }}</em></label>
          <input
            type="range"
            :min="control.min"
            :max="control.max"
            :step="control.step"
            v-model.number="ui.parameters[control.key]"
          />
        </div>
        <p class="hint tight param-hint">{{ PARAMETER_HINTS[control.key] }}</p>
      </div>

      <div class="sec-title">运行统计</div>
      <div class="row"><span class="row-label">帧 / 子步</span><span class="val">{{ stats.frame }} / {{ stats.substeps }}</span></div>
      <div class="row"><span class="row-label">模拟时间</span><span class="val">{{ stats.simTime.toFixed(1) }} s</span></div>
      <div class="row"><span class="row-label">最大水深</span><span class="val">{{ stats.maxDepth.toFixed(2) }} m</span></div>
      <div class="row"><span class="row-label">最大流速</span><span class="val">{{ stats.maxSpeed.toFixed(2) }} m/s</span></div>
      <div class="row"><span class="row-label">湿润格点</span><span class="val">{{ stats.wetCells }}</span></div>
      <div class="row"><span class="row-label">侵蚀体积</span><span class="val">{{ formatVolume(stats.erodedVolume) }}</span></div>
      <div class="row"><span class="row-label">淤积体积</span><span class="val">{{ formatVolume(stats.depositedVolume) }}</span></div>

      <p class="hint">
        <b>操作：</b>「开始/暂停」控制连续计算并保留当前状态，「步进」单帧推进，「重置」恢复初始地形；选择笔刷后在地图上拖拽注入水源/物源或标记障碍；「溃坝」「降雨」「清除」为单击生效；勾选后鼠标移动会在区域上显示笔刷覆盖的网格虚影。<br />
        <b>显示：</b>左下角图例说明当前可视化模式的颜色含义；覆盖层贴地叠加并置于地形之上，不再被山脊遮挡。<br />
        <b>原理：</b>浮点纹理双缓冲，逐子步执行 MacCormack 预测-校正浅水方程、半拉格朗日泥沙平流与超额剪切应力侵蚀沉积 MRT Pass。<br />
        <b>区域：</b>可选甘肃舟曲、四川汶川、云南蒋家沟等中国山区预设范围，或点击「自定义框选」在地图上绘制矩形区域，并可调整网格精度；青色贴地框线为当前模拟区域边界，视角会自动对准该范围；高程来自 Cesium World Terrain。
      </p>
    </div>

    <div class="legend-box">
      <div class="legend-title">结果图例</div>

      <template v-if="ui.visualMode === 1">
        <div class="legend-bar legend-depth"></div>
        <div class="legend-scale"><span>浅 0 m</span><span>深 {{ stats.maxDepth.toFixed(2) }} m</span></div>
        <p class="legend-note">水深模式：颜色越深、透明度越高表示积水越深。</p>
      </template>

      <template v-else-if="ui.visualMode === 2">
        <div class="legend-bar legend-speed"></div>
        <div class="legend-scale"><span>慢 0</span><span>快 {{ stats.maxSpeed.toFixed(2) }} m/s</span></div>
        <p class="legend-note">流速模式：蓝 → 绿 → 红表示流速由低到高，仅在水深大于阈值处显示。</p>
      </template>

      <template v-else>
        <div class="legend-bar legend-erosion"></div>
        <div class="legend-scale"><span>侵蚀</span><span>淤积</span></div>
        <div class="legend-items">
          <i class="swatch sw-water"></i><span>水流（蓝→棕随含沙浓度）</span>
          <i class="swatch sw-obstacle"></i><span>障碍（不可侵蚀）</span>
          <i class="swatch sw-ghost"></i><span>笔刷覆盖虚影</span>
        </div>
        <p class="legend-note">
          {{ ui.visualMode === 3 ? '侵蚀淤积模式' : '复合模式（干床显示侵蚀/淤积）' }}：红＝侵蚀、绿＝淤积，颜色按当前阈值
          {{ thresholdMm() }} mm 归一化，越浓表示床面变化越大。
        </p>
      </template>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>

    <div v-if="reportOpen" class="report-mask">
      <div class="report-dialog">
        <div class="report-toolbar">
          <span class="report-title">侵蚀分析报告预览</span>
          <div class="report-actions">
            <button class="mini-btn" @click="exportReportPdf">导出 PDF</button>
            <button class="mini-btn" @click="reportOpen = false">关闭</button>
          </div>
        </div>
        <div class="report-scroll">
          <div ref="reportEl" class="report-body" v-html="reportHtml"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.df-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 300px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.9); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; max-height: calc(100% - 24px); overflow-y: auto; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.btn-row { display: flex; gap: 6px; margin-top: 10px; }
.start-btn { flex: 2; padding: 7px 0; border: 1px solid rgba(101, 211, 235, 0.5); border-radius: 6px; background: rgba(47, 128, 237, 0.22); color: #65d3eb; font-size: 12px; font-weight: 700; cursor: pointer; }
.start-btn.running { background: rgba(255, 82, 82, 0.25); border-color: rgba(255, 82, 82, 0.55); color: #ff8a8a; }
.mini-btn { flex: 1; padding: 7px 0; border: 1px solid rgba(157, 188, 224, 0.35); border-radius: 6px; background: transparent; color: #9fb3cc; font-size: 12px; cursor: pointer; }
.mini-btn.active { border-color: #65d3eb; background: rgba(47, 128, 237, 0.3); color: #e8f6fb; }
.sec-title { margin-top: 12px; font-size: 11px; font-weight: 700; color: #65d3eb; letter-spacing: 0.03em; }
.brush-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-top: 8px; }
.region-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px; margin-top: 8px; }
.res-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; margin-top: 8px; }
.draw-hint { color: #f2d35a; }
.toggle-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; color: #c3d5e8; font-size: 11px; cursor: pointer; }
.toggle-row input[type="checkbox"] { accent-color: #2f80ed; }
.mode-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-top: 8px; }
.brush-btn { padding: 5px 0; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 5px; background: transparent; color: #9fb3cc; font-size: 11px; cursor: pointer; }
.brush-btn.active { border-color: #65d3eb; background: rgba(47, 128, 237, 0.3); color: #e8f6fb; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }
.row-label { color: #c3d5e8; font-size: 11px; }
.val { font-size: 11px; color: #65d3eb; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.slider-row { margin-top: 8px; }
.slider-row label { display: flex; justify-content: space-between; align-items: center; color: #c3d5e8; font-size: 11px; }
.slider-row label em { font-style: normal; color: #65d3eb; font-weight: 700; }
.slider-row input[type="range"] { width: 100%; margin: 3px 0 0; accent-color: #2f80ed; background: transparent; }
.hint { margin: 10px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.hint.tight { margin-top: 6px; }
.param-block { margin-top: 8px; }
.param-hint { margin-top: 2px; color: #6f86a3; }
.hint b { color: #9fb3cc; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
.legend-box { position: absolute; left: 12px; bottom: 12px; z-index: 8; width: 208px; padding: 9px 11px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 8px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; pointer-events: none; }
.legend-title { font-size: 11px; font-weight: 700; color: #65d3eb; letter-spacing: 0.03em; margin-bottom: 6px; }
.legend-bar { height: 10px; border-radius: 3px; border: 1px solid rgba(157,188,224,.35); }
.legend-depth { background: linear-gradient(90deg, #e6f5ff, #001f8c); }
.legend-speed { background: linear-gradient(90deg, #0d47f2, #1ad966, #f73311); }
.legend-erosion { background: linear-gradient(90deg, #d9140f, #ffffff 50%, #00b347); }
.legend-scale { display: flex; justify-content: space-between; margin-top: 3px; font-size: 10px; color: #9fb3cc; }
.legend-items { display: grid; grid-template-columns: 12px 1fr; gap: 3px 6px; align-items: center; margin-top: 6px; font-size: 10px; color: #c3d5e8; }
.legend-items .swatch { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
.sw-water { background: linear-gradient(135deg, #4a80c8, #73542e); }
.sw-obstacle { background: #f226d9; }
.sw-ghost { background: #40f2ff; }
.legend-note { margin: 6px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.5; }
.report-mask { position: absolute; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center; background: rgba(4, 12, 26, 0.72); }
.report-dialog { width: min(760px, 94%); height: min(88%, 900px); display: flex; flex-direction: column; border: 1px solid rgba(157, 188, 224, 0.4); border-radius: 10px; background: #ffffff; overflow: hidden; }
.report-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #17324d; color: #eaf3fb; }
.report-title { font-size: 13px; font-weight: 700; }
.report-actions { display: flex; gap: 8px; }
.report-actions .mini-btn { flex: none; padding: 5px 12px; border-color: rgba(157,188,224,.5); color: #dce8f5; }
.report-scroll { flex: 1; overflow: auto; padding: 18px 22px; background: #ffffff; }
.report-body { width: 100%; }
</style>

<style>
.df-report { font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif; color: #1e2f3d; }
.df-report h1 { font-size: 19px; margin: 0 0 4px; color: #17324d; }
.df-report .meta { font-size: 11px; color: #6a7b8a; margin: 0 0 6px; }
.df-report .intro { font-size: 12px; line-height: 1.7; color: #3b5061; margin: 0 0 6px; }
.df-report h2 { font-size: 14px; color: #124c7d; margin: 14px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #cfe0ec; }
.df-report table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; font-size: 11px; }
.df-report th, .df-report td { border: 1px solid #b9c6d2; padding: 3px 7px; text-align: left; vertical-align: top; word-break: break-all; }
.df-report th { background: #e8f1f8; color: #17324d; }
.df-report table.kv th { width: 30%; background: #f2f7fb; }
.df-report .caption { font-size: 11px; color: #5b6b7a; margin: 2px 0; }
.df-report p { font-size: 12px; line-height: 1.7; }
</style>
