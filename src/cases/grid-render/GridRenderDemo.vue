<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Cartesian2, Ellipsoid, Math as CesiumMath, PerspectiveFrustum, ScreenSpaceEventHandler, ScreenSpaceEventType, type Viewer } from 'cesium'
import { cellArea, cellToBoundary, cellToLatLng, cellToParent, isValidCell, latLngToCell } from 'h3-js'
import { beidouHeightLevelFor, beidouHeightStep, cellAt } from './grid/beidou'
import {
  beidouLevelForHeight,
  buildBeidou,
  buildDggs,
  buildGraticule,
  buildHydro,
  dggsResolutionForHeight,
  formatInterval,
  graticuleIntervalFor
} from './grid/engines'
import { GridRenderer } from './grid/renderer'
import { addGridImagery, createGridViewer, destroyGridViewer, pickLonLat, setGridCamera } from './grid/scene'
import {
  DEFAULT_GRID_STYLES,
  GRID_EN_LABELS,
  GRID_LABELS,
  GRID_TYPES,
  type AreaBounds,
  type CellInfo,
  type GridBuild,
  type GridStyles,
  type GridType,
  type LonLat
} from './grid/types'
import {
  CAPABILITY_DIMENSIONS,
  CAPABILITY_MATRIX,
  DGGS_CANDIDATES,
  ENGINEERING,
  ROADMAP_INTRO,
  ROADMAP_LAYERS,
  ROADMAP_PIPELINE,
  ROADMAP_SECTIONS,
  ROADMAP_TAGS,
  ROADMAP_TITLE
} from './grid/roadmap'

const DEMO_CENTER = { lon: 101.225, lat: 27.925 }
const DEMO_BOUNDS: AreaBounds = { west: 101.0, south: 27.75, east: 101.45, north: 28.1 }
const HYDRO_REGION: AreaBounds = { west: 101.05, south: 27.78, east: 101.4, north: 28.05 }
const METERS_PER_DEG_LAT = 111320
const DEG = Math.PI / 180

const MAX_CELLS: Record<GridType, number> = { graticule: 600, beidou: 6000, hydro: 3000, dggs: 6000 }

/** 二维贴地渲染的相机高度上限：超出后降级为抬升椭球面渲染，保障全球视角流畅。 */
const GROUND_CLAMP_MAX_HEIGHT = 120000

const GRATICULE_OPTIONS = [30, 15, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001]
const BEIDOU_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const HYDRO_OPTIONS = [2000, 1000, 500, 250, 100, 50, 25]
const DGGS_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const HYDRO_STEPS: Array<{ minHeight: number; step: number }> = [
  { minHeight: 500_000, step: 2000 },
  { minHeight: 200_000, step: 1000 },
  { minHeight: 80_000, step: 500 },
  { minHeight: 30_000, step: 250 },
  { minHeight: 12_000, step: 100 },
  { minHeight: 5_000, step: 50 },
  { minHeight: 0, step: 25 }
]

const EMPTY_BUILD: GridBuild = { lines: [], polygons: [], labels: [], count: 0, note: '', levelValue: 0, downgraded: false }

function hydroStepForHeight(height: number): number {
  for (const item of HYDRO_STEPS) {
    if (height >= item.minHeight) return item.step
  }
  return 25
}

function cloneStyles(): GridStyles {
  return {
    graticule: { ...DEFAULT_GRID_STYLES.graticule },
    beidou: { ...DEFAULT_GRID_STYLES.beidou },
    hydro: { ...DEFAULT_GRID_STYLES.hydro },
    dggs: { ...DEFAULT_GRID_STYLES.dggs }
  }
}

const styles = reactive<GridStyles>(cloneStyles())
const autoLod = ref(true)
const manual = reactive<Record<GridType, number>>({ graticule: 0.05, beidou: 6, hydro: 250, dggs: 6 })
const current = reactive<Record<GridType, number>>({ graticule: 0.05, beidou: 6, hydro: 250, dggs: 6 })
const counts = reactive<Record<GridType, number>>({ graticule: 0, beidou: 0, hydro: 0, dggs: 0 })
const notes = reactive<Record<GridType, string>>({ graticule: '', beidou: '', hydro: '', dggs: '' })
const downgraded = reactive<Record<GridType, boolean>>({ graticule: false, beidou: false, hydro: false, dggs: false })
/** 北斗三维网格体当前生效的高度域信息（层级 / 分层数 / 单层厚度）。 */
const beidouHeightDomain = ref<{ level: number; layers: number; thickness: number } | null>(null)

const stats = reactive({ height: 0, lon: 0, lat: 0, zoom: 0, fps: 0, west: 0, south: 0, east: 0, north: 0 })
const pick = ref<CellInfo | null>(null)
const hoverTip = ref<{ x: number; y: number; code: string; label: string } | null>(null)
const hoverPick = ref(false)
/** 只显示研究区：仅渲染固定研究区范围内的网格，不随视域无限扩张。 */
const studyOnly = ref(false)
const banner = ref('')
const roadmapOpen = ref(false)
const layerDockOpen = ref(true)
const expanded = ref<GridType | null>('beidou')

const container = ref<HTMLDivElement | null>(null)
let viewer: Viewer | undefined
let renderer: GridRenderer | undefined
let inputHandler: ScreenSpaceEventHandler | undefined
let canvasEl: HTMLCanvasElement | undefined
let disposed = false
let rebuildTimer: number | undefined
let bannerTimer: number | undefined
let highlightRing: LonLat[] | null = null
let frames = 0
let fpsAt = 0
let lastHoverAt = 0

const activeGridCount = computed(() => GRID_TYPES.filter((type) => styles[type].enabled).length)
const totalCells = computed(() => GRID_TYPES.reduce((sum, type) => sum + counts[type], 0))
const fpsClass = computed(() => (stats.fps >= 45 ? 'good' : stats.fps >= 24 ? 'warn' : 'bad'))
const gridOverview = computed(() =>
  GRID_TYPES.map((type) => ({
    type,
    label: GRID_LABELS[type],
    en: GRID_EN_LABELS[type],
    color: styles[type].strokeColor,
    enabled: styles[type].enabled,
    count: counts[type],
    note: notes[type],
    downgraded: downgraded[type]
  }))
)

function flashBanner(message: string, duration = 5000): void {
  banner.value = message
  if (bannerTimer !== undefined) window.clearTimeout(bannerTimer)
  bannerTimer = window.setTimeout(() => {
    bannerTimer = undefined
    if (banner.value === message) banner.value = ''
  }, duration)
}

function viewBounds(): AreaBounds {
  if (!viewer || viewer.isDestroyed()) return { ...DEMO_BOUNDS }
  const rect = viewer.camera.computeViewRectangle(Ellipsoid.WGS84)
  if (!rect) return { ...DEMO_BOUNDS }
  const west = Math.max(-180, CesiumMath.toDegrees(rect.west))
  const east = Math.min(180, CesiumMath.toDegrees(rect.east))
  const south = Math.max(-85, CesiumMath.toDegrees(rect.south))
  const north = Math.min(85, CesiumMath.toDegrees(rect.north))
  const padLon = Math.max(0.0004, (east - west) * 0.03)
  const padLat = Math.max(0.0004, (north - south) * 0.03)
  return {
    west: Math.max(-180, west - padLon),
    east: Math.min(180, east + padLon),
    south: Math.max(-85, south - padLat),
    north: Math.min(85, north + padLat)
  }
}

/** 网格生成范围：默认按当前视域；开启「只显示研究区」后与固定研究区求交。 */
function buildBounds(): AreaBounds {
  const vb = viewBounds()
  if (!studyOnly.value) return vb
  const west = Math.max(vb.west, DEMO_BOUNDS.west)
  const east = Math.min(vb.east, DEMO_BOUNDS.east)
  const south = Math.max(vb.south, DEMO_BOUNDS.south)
  const north = Math.min(vb.north, DEMO_BOUNDS.north)
  if (east <= west || north <= south) {
    return { west: DEMO_BOUNDS.west, south: DEMO_BOUNDS.south, east: DEMO_BOUNDS.west - 1e-6, north: DEMO_BOUNDS.south - 1e-6 }
  }
  return { west, south, east, north }
}

/** 由相机高度与视场角反算 Web Mercator 近似缩放层级（用于状态栏显示）。 */
function zoomLevel(): number {
  if (!viewer || viewer.isDestroyed()) return 0
  const frustum = viewer.camera.frustum
  if (!(frustum instanceof PerspectiveFrustum)) return 0
  const canvasHeight = viewer.scene.canvas.clientHeight || viewer.scene.canvas.height || 1
  const fovy = frustum.fovy || Math.PI / 3
  const metersPerPixel = (2 * viewer.camera.positionCartographic.height * Math.tan(fovy / 2)) / canvasHeight
  const circumference = 2 * Math.PI * 6378137
  const zoom = Math.log2(circumference / (256 * Math.max(metersPerPixel, 1e-6)))
  return Math.max(0, Math.min(22, zoom))
}

function updateStats(): void {
  if (!viewer || viewer.isDestroyed()) return
  const carto = viewer.camera.positionCartographic
  stats.height = carto.height
  stats.lon = CesiumMath.toDegrees(carto.longitude)
  stats.lat = CesiumMath.toDegrees(carto.latitude)
  stats.zoom = zoomLevel()
}

function rebuild(): void {
  if (disposed || !viewer || viewer.isDestroyed() || !renderer) return
  updateStats()
  const height = stats.height
  const bounds = buildBounds()
  stats.west = bounds.west
  stats.south = bounds.south
  stats.east = bounds.east
  stats.north = bounds.north

  const graticuleLevel = autoLod.value ? graticuleIntervalFor(height) : manual.graticule
  const beidouLevelValue = autoLod.value ? beidouLevelForHeight(height, stats.lat) : manual.beidou
  const hydroLevel = autoLod.value ? hydroStepForHeight(height) : manual.hydro
  const dggsLevel = autoLod.value ? dggsResolutionForHeight(height) : manual.dggs

  const graticuleBuild = styles.graticule.enabled ? buildGraticule(bounds, graticuleLevel) : EMPTY_BUILD
  const beidouSolidHeight = styles.beidou.renderMode === 'solid' ? styles.beidou.solidHeight : 0
  // 三维网格体为保证单元近立方体，需按体高选取更细的水平层级，故放宽单元预算。
  const beidouCellBudget = beidouSolidHeight > 0 ? Math.max(MAX_CELLS.beidou, 8000) : MAX_CELLS.beidou
  const beidouBuild = styles.beidou.enabled
    ? buildBeidou(bounds, beidouLevelValue, beidouCellBudget, 90, beidouSolidHeight)
    : EMPTY_BUILD
  const hydroBuild = styles.hydro.enabled ? buildHydro(HYDRO_REGION, hydroLevel, MAX_CELLS.hydro) : EMPTY_BUILD
  const dggsBuild = styles.dggs.enabled ? buildDggs(bounds, dggsLevel, MAX_CELLS.dggs) : EMPTY_BUILD

  // 贴地渲染仅与相机高度相关：低于阈值时真实贴合椭球面，倾斜视角同样贴地。
  renderer.setGroundClamp(stats.height <= GROUND_CLAMP_MAX_HEIGHT)
  renderer.beginFrame()
  renderer.update('graticule', graticuleBuild, styles.graticule)
  renderer.update('beidou', beidouBuild, styles.beidou)
  renderer.update('hydro', hydroBuild, styles.hydro)
  renderer.update('dggs', dggsBuild, styles.dggs)
  renderer.endFrame()

  const builds: Array<[GridType, GridBuild, number]> = [
    ['graticule', graticuleBuild, graticuleLevel],
    ['beidou', beidouBuild, beidouLevelValue],
    ['hydro', hydroBuild, hydroLevel],
    ['dggs', dggsBuild, dggsLevel]
  ]
  for (const [type, build, fallback] of builds) {
    counts[type] = build.count
    notes[type] = build.note
    downgraded[type] = build.downgraded
    current[type] = build.levelValue > 0 ? build.levelValue : fallback
  }
  beidouHeightDomain.value = styles.beidou.enabled ? beidouBuild.heightDomain ?? null : null
}

function scheduleRebuild(delay = 240): void {
  if (disposed) return
  if (rebuildTimer !== undefined) window.clearTimeout(rebuildTimer)
  rebuildTimer = window.setTimeout(() => {
    rebuildTimer = undefined
    rebuild()
  }, delay)
}

function setColor(type: GridType, event: Event): void {
  const value = (event.target as HTMLInputElement).value
  styles[type].strokeColor = value
  styles[type].fillColor = value
  scheduleRebuild(60)
}

function onStyleChange(): void {
  scheduleRebuild(60)
}

function toggleGrid(type: GridType): void {
  styles[type].enabled = !styles[type].enabled
  if (styles[type].enabled) flashBanner(`${GRID_LABELS[type]} 已开启`)
  scheduleRebuild(0)
}

/** 手风琴：同一时刻仅展开一个网格分组，再次点击标题收起。 */
function toggleAccordion(type: GridType): void {
  expanded.value = expanded.value === type ? null : type
}

function toggleAutoLod(): void {
  autoLod.value = !autoLod.value
  if (!autoLod.value) {
    manual.graticule = current.graticule
    manual.beidou = current.beidou
    manual.hydro = current.hydro
    manual.dggs = current.dggs
    flashBanner('已切换为手动层级，可在左侧逐类调整')
  } else {
    flashBanner('已开启自动 LOD，层级随相机高度变化')
  }
  scheduleRebuild(0)
}

function locate(): void {
  if (!viewer || viewer.isDestroyed()) return
  setGridCamera(viewer, DEMO_BOUNDS)
  scheduleRebuild(320)
  flashBanner('已定位到研究区（四川木里一带）')
}

function resetAll(): void {
  Object.assign(styles, cloneStyles())
  autoLod.value = true
  manual.graticule = 0.05
  manual.beidou = 6
  manual.hydro = 250
  manual.dggs = 6
  pick.value = null
  hoverTip.value = null
  highlightRing = null
  renderer?.setHighlight(null)
  locate()
}

function rectRing(west: number, south: number, east: number, north: number): LonLat[] {
  return [
    { lon: west, lat: south },
    { lon: east, lat: south },
    { lon: east, lat: north },
    { lon: west, lat: north },
    { lon: west, lat: south }
  ]
}

function pickDggs(lon: number, lat: number): CellInfo | null {
  const res = current.dggs
  let cell: string
  try {
    cell = latLngToCell(lat, lon, res)
  } catch {
    return null
  }
  if (!cell || !isValidCell(cell)) return null
  let center: number[]
  let parentId = cell
  let areaKm2 = 0
  try {
    center = cellToLatLng(cell) as unknown as number[]
    parentId = res > 0 ? cellToParent(cell, res - 1) : cell
    areaKm2 = cellArea(cell, 'km2')
  } catch {
    return null
  }
  return {
    gridType: 'dggs',
    title: 'DGGS 六边形单元',
    subtitle: 'OGC DGGS · H3 孔径 7',
    rows: [
      { label: '单元编码', value: cell },
      { label: '分辨率', value: `res ${res}` },
      { label: '中心经纬', value: `${center[1].toFixed(5)}°, ${center[0].toFixed(5)}°` },
      { label: '父级编码', value: parentId },
      { label: '单元面积', value: `${areaKm2.toFixed(3)} km²` }
    ]
  }
}

function pickBeidou(lon: number, lat: number): CellInfo {
  const cell = cellAt(lon, lat, current.beidou)
  const rows: Array<{ label: string; value: string }> = [
    { label: '位置码', value: cell.code },
    { label: '层级', value: `${cell.level} 级` },
    { label: '行列号', value: `行 ${cell.row} · 列 ${cell.col}` },
    { label: '经度范围', value: `${cell.west.toFixed(5)}° ~ ${cell.east.toFixed(5)}°` },
    { label: '纬度范围', value: `${cell.south.toFixed(5)}° ~ ${cell.north.toFixed(5)}°` },
    { label: '单元尺寸', value: `${cell.widthM.toFixed(0)} m × ${cell.heightM.toFixed(0)} m` }
  ]
  let subtitle = 'GB/T 39409-2020 二维位置码'
  if (styles.beidou.renderMode === 'solid') {
    // 回显当前实际生效的高度域（水平/高度同级以保证近立方体）。
    const level = beidouHeightDomain.value?.level ?? beidouHeightLevelFor(styles.beidou.solidHeight)
    const thickness = beidouHeightDomain.value?.thickness ?? beidouHeightStep(level)
    const layers = beidouHeightDomain.value?.layers ?? Math.max(1, Math.ceil(styles.beidou.solidHeight / thickness))
    subtitle = 'GB/T 39409-2020 三维位置码'
    rows.push({ label: '高度域层级', value: `Lh ${level} 级（与水平同级）` })
    rows.push({ label: '单层厚度 Δh', value: `${thickness >= 1000 ? `${(thickness / 1000).toFixed(1)} km` : `${thickness.toFixed(0)} m`}` })
    rows.push({ label: '高度分层', value: `${layers} 层（自地面向上）` })
  }
  return {
    gridType: 'beidou',
    title: '北斗网格单元',
    subtitle,
    rows
  }
}

function pickHydro(lon: number, lat: number): CellInfo | null {
  const centerLat = (HYDRO_REGION.south + HYDRO_REGION.north) / 2
  const step = current.hydro
  const dLat = step / METERS_PER_DEG_LAT
  const dLon = step / (METERS_PER_DEG_LAT * Math.max(0.15, Math.cos(centerLat * DEG)))
  const col = Math.floor((lon - HYDRO_REGION.west) / dLon)
  const row = Math.floor((lat - HYDRO_REGION.south) / dLat)
  const rows = Math.max(1, Math.ceil((HYDRO_REGION.north - HYDRO_REGION.south) / dLat))
  const cols = Math.max(1, Math.ceil((HYDRO_REGION.east - HYDRO_REGION.west) / dLon))
  if (row < 0 || col < 0 || row >= rows || col >= cols) return null
  const west = HYDRO_REGION.west + col * dLon
  const south = HYDRO_REGION.south + row * dLat
  const east = Math.min(HYDRO_REGION.east, west + dLon)
  const north = Math.min(HYDRO_REGION.north, south + dLat)
  return {
    gridType: 'hydro',
    title: '水文网格单元',
    subtitle: '目标流域规则格网',
    rows: [
      { label: '行列号', value: `R${row + 1} C${col + 1}` },
      { label: '步长', value: step >= 1000 ? `${(step / 1000).toFixed(step % 1000 === 0 ? 0 : 1)} km` : `${step} m` },
      { label: '经度范围', value: `${west.toFixed(5)}° ~ ${east.toFixed(5)}°` },
      { label: '纬度范围', value: `${south.toFixed(5)}° ~ ${north.toFixed(5)}°` },
      { label: '格网规模', value: `${rows} 行 × ${cols} 列` }
    ]
  }
}

function pickGraticule(lon: number, lat: number): CellInfo {
  const interval = current.graticule
  const west = Math.floor(lon / interval) * interval
  const south = Math.floor(lat / interval) * interval
  return {
    gridType: 'graticule',
    title: '经纬网格分幅',
    subtitle: '等经纬度间隔剖分',
    rows: [
      { label: '间隔', value: formatInterval(interval) },
      { label: '经度带', value: `${west.toFixed(5)}° ~ ${(west + interval).toFixed(5)}°` },
      { label: '纬度带', value: `${south.toFixed(5)}° ~ ${(south + interval).toFixed(5)}°` }
    ]
  }
}

function pickCell(lon: number, lat: number): { info: CellInfo; ring: LonLat[] } | null {
  // 仅允许拾取当前实际生成范围内的单元；「只显示研究区」时进一步限制在研究区内，
  // 避免点击研究区外/视域外仍回显单元信息。
  if (lon < stats.west || lon > stats.east || lat < stats.south || lat > stats.north) return null
  if (
    studyOnly.value &&
    (lon < DEMO_BOUNDS.west || lon > DEMO_BOUNDS.east || lat < DEMO_BOUNDS.south || lat > DEMO_BOUNDS.north)
  ) {
    return null
  }
  if (styles.dggs.enabled) {
    const info = pickDggs(lon, lat)
    if (info) {
      const res = current.dggs
      const cell = latLngToCell(lat, lon, res)
      const boundary = cellToBoundary(cell, false) as unknown as number[][]
      const ring: LonLat[] = boundary.map((p) => ({ lat: p[0], lon: p[1] }))
      if (ring.length) ring.push({ ...ring[0] })
      return { info, ring }
    }
  }
  if (styles.beidou.enabled) {
    const info = pickBeidou(lon, lat)
    const cell = cellAt(lon, lat, current.beidou)
    return { info, ring: rectRing(cell.west, cell.south, cell.east, cell.north) }
  }
  if (styles.hydro.enabled) {
    const info = pickHydro(lon, lat)
    if (info) {
      const centerLat = (HYDRO_REGION.south + HYDRO_REGION.north) / 2
      const step = current.hydro
      const dLat = step / METERS_PER_DEG_LAT
      const dLon = step / (METERS_PER_DEG_LAT * Math.max(0.15, Math.cos(centerLat * DEG)))
      const col = Math.floor((lon - HYDRO_REGION.west) / dLon)
      const row = Math.floor((lat - HYDRO_REGION.south) / dLat)
      const west = HYDRO_REGION.west + col * dLon
      const south = HYDRO_REGION.south + row * dLat
      const east = Math.min(HYDRO_REGION.east, west + dLon)
      const north = Math.min(HYDRO_REGION.north, south + dLat)
      return { info, ring: rectRing(west, south, east, north) }
    }
  }
  if (styles.graticule.enabled) {
    const info = pickGraticule(lon, lat)
    const interval = current.graticule
    const west = Math.floor(lon / interval) * interval
    const south = Math.floor(lat / interval) * interval
    return { info, ring: rectRing(west, south, west + interval, south + interval) }
  }
  return null
}

function applyHighlight(info: CellInfo, ring: LonLat[]): void {
  const style = styles[info.gridType]
  renderer?.setHighlight(ring, style.renderMode, style.solidHeight)
}

function cellCode(info: CellInfo): string {
  const codeRow = info.rows.find((row) => row.label === '位置码' || row.label === '单元编码')
  return codeRow?.value ?? info.title
}

function highlightLocked(): void {
  if (pick.value && highlightRing) applyHighlight(pick.value, highlightRing)
  else renderer?.setHighlight(null)
}

function handlePick(lon: number, lat: number): void {
  const result = pickCell(lon, lat)
  if (!result) {
    pick.value = null
    highlightRing = null
    renderer?.setHighlight(null)
    return
  }
  pick.value = result.info
  highlightRing = result.ring
  hoverTip.value = null
  applyHighlight(result.info, result.ring)
}

/** 悬浮拾取：即时高亮当前单元，并以鼠标 tip 显示单元编号。 */
function handleHover(lon: number, lat: number, x: number, y: number): void {
  const result = pickCell(lon, lat)
  if (!result) {
    clearHover()
    return
  }
  hoverTip.value = { x, y, code: cellCode(result.info), label: GRID_LABELS[result.info.gridType] }
  applyHighlight(result.info, result.ring)
}

function clearHover(): void {
  hoverTip.value = null
  highlightLocked()
}

function toggleHoverPick(): void {
  hoverPick.value = !hoverPick.value
  if (!hoverPick.value) clearHover()
}

function toggleStudyOnly(): void {
  studyOnly.value = !studyOnly.value
  flashBanner(studyOnly.value ? '仅渲染研究区范围内的网格' : '已恢复为按视域范围渲染')
  scheduleRebuild(0)
}

function clearPick(): void {
  pick.value = null
  hoverTip.value = null
  highlightRing = null
  renderer?.setHighlight(null)
}

function onCameraChanged(): void {
  scheduleRebuild()
}

onMounted(() => {
  if (!container.value) return
  viewer = createGridViewer(container.value)
  renderer = new GridRenderer(viewer)
  addGridImagery(viewer, { onStatus: (message) => flashBanner(message) })

  inputHandler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  inputHandler.setInputAction((event: { position: Cartesian2 }) => {
    if (!viewer || viewer.isDestroyed()) return
    const ll = pickLonLat(viewer.scene, event.position)
    if (ll) handlePick(ll.lon, ll.lat)
  }, ScreenSpaceEventType.LEFT_CLICK)
  inputHandler.setInputAction((event: { endPosition: Cartesian2 }) => {
    if (!viewer || viewer.isDestroyed() || !hoverPick.value) return
    const now = performance.now()
    if (now - lastHoverAt < 140) return
    lastHoverAt = now
    const ll = pickLonLat(viewer.scene, event.endPosition)
    if (ll) handleHover(ll.lon, ll.lat, event.endPosition.x, event.endPosition.y)
    else clearHover()
  }, ScreenSpaceEventType.MOUSE_MOVE)
  canvasEl = viewer.scene.canvas
  canvasEl.addEventListener('mouseleave', clearHover)

  viewer.camera.changed.addEventListener(onCameraChanged)
  viewer.camera.moveEnd.addEventListener(onCameraChanged)

  frames = 0
  fpsAt = performance.now()
  viewer.scene.postRender.addEventListener(() => {
    if (disposed) return
    frames += 1
    const now = performance.now()
    if (now - fpsAt >= 1000) {
      stats.fps = Math.round((frames * 1000) / (now - fpsAt))
      frames = 0
      fpsAt = now
    }
  })

  setGridCamera(viewer, DEMO_BOUNDS)
  scheduleRebuild(60)
  flashBanner('地理网格渲染系统就绪：支持经纬 / 北斗 / 水文 / DGGS 四类网格')
})

onBeforeUnmount(() => {
  disposed = true
  if (rebuildTimer !== undefined) window.clearTimeout(rebuildTimer)
  if (bannerTimer !== undefined) window.clearTimeout(bannerTimer)
  if (viewer && !viewer.isDestroyed()) {
    viewer.camera.changed.removeEventListener(onCameraChanged)
    viewer.camera.moveEnd.removeEventListener(onCameraChanged)
  }
  inputHandler?.destroy()
  inputHandler = undefined
  canvasEl?.removeEventListener('mouseleave', clearHover)
  canvasEl = undefined
  renderer?.dispose()
  renderer = undefined
  destroyGridViewer(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="gr-system">
    <header class="gr-topbar">
      <div class="gr-identity">
        <span class="gr-emblem">GG</span>
        <div class="gr-identity-text">
          <p class="gr-system-name">地理网格渲染系统</p>
          <p class="gr-system-meta">经纬 · 北斗（GB/T 39409）· 水文 · DGGS（H3）统一渲染内核</p>
        </div>
        <span class="gr-run-state" :class="{ live: autoLod }"><i></i>{{ autoLod ? '自动 LOD 运行中' : '手动层级' }}</span>
      </div>
      <div class="gr-toolbar">
        <button class="gr-tool" @click="locate">定位研究区</button>
        <button class="gr-tool" :class="{ active: studyOnly }" @click="toggleStudyOnly">只显示研究区</button>
        <button class="gr-tool" :class="{ active: !autoLod }" @click="toggleAutoLod">{{ autoLod ? '关闭自动 LOD' : '开启自动 LOD' }}</button>
        <button class="gr-tool" @click="clearPick">清除拾取</button>
        <button class="gr-tool" @click="resetAll">重置</button>
        <button class="gr-tool" :class="{ active: hoverPick }" @click="toggleHoverPick">悬浮拾取</button>
        <button class="gr-tool accent" @click="roadmapOpen = true">技术路线</button>
      </div>
    </header>

    <div class="gr-main">
      <aside class="gr-sidebar">
        <div class="gr-sidebar-head">
          <span>网格参数配置</span>
          <em>实时生效</em>
        </div>

        <template v-for="type in GRID_TYPES" :key="type">
          <div
            class="group-label collapsible"
            :class="{ open: expanded === type }"
            @click="toggleAccordion(type)"
          >
            <span>{{ GRID_LABELS[type] }}<em class="gr-en">{{ GRID_EN_LABELS[type] }}</em></span>
            <i></i>
          </div>
          <div v-if="expanded === type" class="gr-accordion-body">
            <div class="param-row">
              <span class="param-label">网格图层</span>
              <input v-model="styles[type].enabled" class="toggle-input" type="checkbox" @change="onStyleChange" />
            </div>
            <div class="param-row">
              <span class="param-label">{{ type === 'graticule' ? '间隔' : type === 'beidou' ? '剖分层级' : type === 'hydro' ? '步长' : '分辨率' }}</span>
              <select v-if="!autoLod" v-model.number="manual[type]" class="select-input" @change="onStyleChange">
                <template v-if="type === 'graticule'"><option v-for="v in GRATICULE_OPTIONS" :key="v" :value="v">{{ formatInterval(v) }}</option></template>
                <template v-else-if="type === 'beidou'"><option v-for="v in BEIDOU_OPTIONS" :key="v" :value="v">{{ v }} 级</option></template>
                <template v-else-if="type === 'hydro'"><option v-for="v in HYDRO_OPTIONS" :key="v" :value="v">{{ v >= 1000 ? `${v / 1000} km` : `${v} m` }}</option></template>
                <template v-else><option v-for="v in DGGS_OPTIONS" :key="v" :value="v">res {{ v }}</option></template>
              </select>
              <span v-else class="param-static">{{ type === 'graticule' ? formatInterval(current[type]) : type === 'beidou' ? `${current[type]} 级` : type === 'hydro' ? `${current[type] >= 1000 ? `${current[type] / 1000} km` : `${current[type]} m`}` : `res ${current[type]}` }}</span>
            </div>
            <div v-if="type === 'beidou'" class="param-row">
              <span class="param-label">渲染模式</span>
              <select v-model="styles.beidou.renderMode" class="select-input" @change="onStyleChange">
                <option value="ground">二维贴地网格</option>
                <option value="solid">三维网格体</option>
              </select>
            </div>
            <div v-if="type === 'beidou' && styles.beidou.renderMode === 'solid'" class="param-row">
              <span class="param-label">网格体高(m)</span>
              <input v-model.number="styles.beidou.solidHeight" class="param-slider" type="range" min="500" max="14000" step="250" @input="onStyleChange" />
              <span class="param-value">{{ styles.beidou.solidHeight }}</span>
            </div>
            <div v-if="type === 'beidou' && styles.beidou.renderMode === 'solid'" class="stats-line">
              高度域 Lh <b>{{ beidouHeightDomain ? beidouHeightDomain.level : '—' }}</b> 级 · 单层
              <b>{{ beidouHeightDomain ? (beidouHeightDomain.thickness >= 1000 ? `${(beidouHeightDomain.thickness / 1000).toFixed(1)} km` : `${beidouHeightDomain.thickness.toFixed(0)} m`) : '—' }}</b>
              · 共 <b>{{ beidouHeightDomain ? beidouHeightDomain.layers : 0 }}</b> 层
            </div>
            <div class="param-row">
              <span class="param-label">网格线色</span>
              <input :value="styles[type].strokeColor" class="color-input" type="color" @input="setColor(type, $event)" />
            </div>
            <div class="param-row">
              <span class="param-label">线宽</span>
              <input v-model.number="styles[type].strokeWidth" class="param-slider" type="range" min="0.5" max="6" step="0.1" @input="onStyleChange" />
              <span class="param-value">{{ styles[type].strokeWidth.toFixed(1) }}</span>
            </div>
            <div class="param-row">
              <span class="param-label">线透明</span>
              <input v-model.number="styles[type].strokeAlpha" class="param-slider" type="range" min="0" max="1" step="0.02" @input="onStyleChange" />
              <span class="param-value">{{ styles[type].strokeAlpha.toFixed(2) }}</span>
            </div>
            <div class="param-row">
              <span class="param-label">填充透明</span>
              <input v-model.number="styles[type].fillAlpha" class="param-slider" type="range" min="0" max="0.6" step="0.01" @input="onStyleChange" />
              <span class="param-value">{{ styles[type].fillAlpha.toFixed(2) }}</span>
            </div>
            <div class="param-row"><span class="param-label">单元标注</span><input v-model="styles[type].labelVisible" class="toggle-input" type="checkbox" @change="onStyleChange" /></div>
            <div class="stats-line">
              覆盖 <b>{{ counts[type] }}</b> {{ type === 'graticule' ? '条网格线' : '个单元' }}
              <span v-if="downgraded[type]" class="gr-warn">· 已自动调整</span>
            </div>
            <div class="stats-line">{{ notes[type] || '—' }}</div>
          </div>
        </template>
      </aside>

      <main class="gr-stage">
        <div ref="container" class="cesium-container"></div>
        <div class="gr-map-caption">四川木里一带 · 中心 {{ DEMO_CENTER.lon }}°E / {{ DEMO_CENTER.lat }}°N · 网格以椭球面为基座</div>

        <button class="gr-metrics-toggle" :class="{ active: pick }" @click="pick ? clearPick() : undefined">
          <span class="gr-dot" :style="{ background: pick ? styles[pick.gridType].strokeColor : '#64748b' }"></span>
          <span>{{ pick ? pick.title : '单元拾取' }}</span>
        </button>
        <div v-if="pick" class="gr-pick-panel">
          <div class="gr-pick-head">
            <div>
              <p class="gr-pick-title">{{ pick.title }}</p>
              <p class="gr-pick-sub">{{ pick.subtitle }}</p>
            </div>
            <button class="gr-pick-close" title="清除" @click="clearPick">×</button>
          </div>
          <div class="gr-pick-body">
            <div v-for="row in pick.rows" :key="row.label" class="gr-kv">
              <span>{{ row.label }}</span>
              <b>{{ row.value }}</b>
            </div>
          </div>
        </div>

        <div v-if="hoverTip" class="gr-hover-tip" :style="{ left: `${hoverTip.x}px`, top: `${hoverTip.y}px` }">
          <span class="gr-hover-tip-code">{{ hoverTip.code }}</span>
          <span class="gr-hover-tip-label">{{ hoverTip.label }}</span>
        </div>

        <div class="gr-layer-dock" :class="{ collapsed: !layerDockOpen }">
          <button class="gr-layer-head" @click="layerDockOpen = !layerDockOpen">
            <span class="gr-layer-title">网格图层</span>
            <span class="gr-layer-count">{{ activeGridCount }}/{{ GRID_TYPES.length }}</span>
            <i class="gr-layer-caret"></i>
          </button>
          <div v-show="layerDockOpen" class="gr-layer-body">
            <button
              v-for="item in gridOverview"
              :key="item.type"
              class="gr-layer-item"
              :class="{ on: item.enabled }"
              @click="toggleGrid(item.type)"
            >
              <span class="gr-layer-swatch" :style="{ background: item.color }"></span>
              <span class="gr-layer-label">{{ item.label }}<em>{{ item.en }}</em></span>
              <span class="gr-layer-switch"><i></i></span>
            </button>
          </div>
        </div>

        <div v-if="banner" class="gr-banner">{{ banner }}</div>
      </main>

      <aside class="gr-inspector">
        <div class="gr-panel-head">网格概览</div>
        <div v-for="item in gridOverview" :key="`ov-${item.type}`" class="gr-ov" :class="{ off: !item.enabled }">
          <div class="gr-ov-head">
            <span class="gr-layer-swatch" :style="{ background: item.color }"></span>
            <span class="gr-ov-name">{{ item.label }}</span>
            <b>{{ item.count }}</b>
          </div>
          <div class="gr-ov-note">{{ item.enabled ? item.note : '未启用' }}</div>
        </div>

        <div class="gr-panel-head">渲染内核分层</div>
        <div v-for="layer in ROADMAP_LAYERS" :key="layer.name" class="gr-arch">
          <div class="gr-arch-name">{{ layer.name }}<em>{{ layer.en }}</em></div>
          <div class="gr-arch-desc">{{ layer.desc }}</div>
        </div>
      </aside>
    </div>

    <footer class="gr-statusbar">
      <span class="gr-status-group">视点高度 <b>{{ (stats.height / 1000).toFixed(1) }} km</b></span>
      <span class="gr-status-group">缩放层级 <b>z{{ stats.zoom.toFixed(1) }}</b></span>
      <span class="gr-status-group">视点经纬 <b>{{ stats.lon.toFixed(3) }}°, {{ stats.lat.toFixed(3) }}°</b></span>
      <span class="gr-status-group">视域 <b>{{ stats.west.toFixed(2) }}~{{ stats.east.toFixed(2) }}°E / {{ stats.south.toFixed(2) }}~{{ stats.north.toFixed(2) }}°N</b></span>
      <span class="gr-status-group">单元总数 <b>{{ totalCells }}</b></span>
      <span class="gr-status-group gr-fps" :class="fpsClass">FPS <b>{{ stats.fps }}</b></span>
      <span class="gr-status-group">LOD <b>{{ autoLod ? '自动' : '手动' }}</b></span>
      <span class="gr-status-group">网格 <b>{{ activeGridCount }}/4</b></span>
    </footer>

    <div v-if="roadmapOpen" class="gr-roadmap">
      <div class="gr-roadmap-head">
        <span>{{ ROADMAP_TITLE }}</span>
        <button class="gr-roadmap-close" @click="roadmapOpen = false">关闭</button>
      </div>
      <div class="gr-roadmap-body">
        <p class="gr-roadmap-intro">{{ ROADMAP_INTRO }}</p>
        <div class="gr-tags">
          <span v-for="tag in ROADMAP_TAGS" :key="tag">{{ tag }}</span>
        </div>

        <h4>渲染管线</h4>
        <div class="gr-pipeline">
          <template v-for="(step, index) in ROADMAP_PIPELINE" :key="step.title">
            <div class="gr-pipe-step">
              <b>{{ step.title }}</b>
              <span>{{ step.detail }}</span>
            </div>
            <span v-if="index < ROADMAP_PIPELINE.length - 1" class="gr-pipe-arrow">→</span>
          </template>
        </div>

        <h4>四层架构</h4>
        <div class="gr-roadmap-layers">
          <div v-for="layer in ROADMAP_LAYERS" :key="layer.name" class="gr-roadmap-layer">
            <div class="gr-roadmap-layer-title">{{ layer.name }}<em>{{ layer.en }}</em></div>
            <div class="gr-roadmap-layer-desc">{{ layer.desc }}</div>
            <ul>
              <li v-for="item in layer.items" :key="item">{{ item }}</li>
            </ul>
          </div>
        </div>

        <h4>DGGS 选型对比</h4>
        <div class="gr-table">
          <div class="gr-table-row gr-table-head">
            <span>方案</span><span>单元 / 投影</span><span>孔径与层级</span><span>前端生态</span><span>结论</span>
          </div>
          <div v-for="item in DGGS_CANDIDATES" :key="item.name" class="gr-table-row" :class="{ prime: item.recommended }">
            <span>{{ item.name }}</span>
            <span>{{ item.cell }}</span>
            <span>{{ item.aperture }}</span>
            <span>{{ item.lib }}</span>
            <span>{{ item.verdict }}</span>
          </div>
        </div>

        <h4>能力矩阵</h4>
        <div class="gr-table gr-matrix">
          <div class="gr-table-row gr-table-head">
            <span>网格类型</span>
            <span v-for="dim in CAPABILITY_DIMENSIONS" :key="dim">{{ dim }}</span>
          </div>
          <div v-for="row in CAPABILITY_MATRIX" :key="row.name" class="gr-table-row">
            <span>{{ row.name }}</span>
            <span v-for="(score, index) in row.scores" :key="index" class="gr-score-cell">
              <i class="gr-score-bar" :style="{ width: `${score * 10}%`, background: row.color }"></i>
              <b>{{ score }}</b>
            </span>
          </div>
        </div>

        <h4>公共内核 · 交互 · 性能 · 风险</h4>
        <div class="gr-roadmap-sections">
          <div v-for="section in ROADMAP_SECTIONS" :key="section.title" class="gr-roadmap-section">
            <div class="gr-roadmap-section-title">{{ section.title }}</div>
            <p>{{ section.summary }}</p>
            <ul>
              <li v-for="bullet in section.bullets" :key="bullet">{{ bullet }}</li>
            </ul>
          </div>
        </div>

        <h4>工程选型</h4>
        <div class="gr-table">
          <div class="gr-table-row gr-table-head">
            <span>事项</span><span>选型</span><span>说明</span>
          </div>
          <div v-for="item in ENGINEERING" :key="item.item" class="gr-table-row gr-table-eng">
            <span>{{ item.item }}</span><span>{{ item.choice }}</span><span>{{ item.note }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gr-system {
  --gr-bg: #06121f;
  --gr-panel: #0b1d30;
  --gr-panel-2: #0f2740;
  --gr-line: rgba(125, 178, 224, 0.16);
  --gr-text: #dceafa;
  --gr-muted: #86a3c0;
  --gr-accent: #2dd4bf;
  --gr-accent-2: #38bdf8;
  --gr-warn: #fbbf24;
  display: grid;
  grid-template-rows: 58px minmax(0, 1fr) 46px;
  width: 100%;
  height: 100%;
  min-height: 420px;
  overflow: hidden;
  background: var(--gr-bg);
  color: var(--gr-text);
  position: relative;
  font-size: 13px;
}
.gr-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(45, 212, 191, 0.24);
  background: linear-gradient(180deg, #08202e, #0a1524);
}
.gr-identity { display: flex; align-items: center; gap: 10px; min-width: 0; }
.gr-emblem {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: linear-gradient(145deg, #2dd4bf, #0e7490);
  color: #04222a;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.04em;
}
.gr-identity-text { min-width: 0; }
.gr-system-name { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: 0.02em; }
.gr-system-meta { margin: 2px 0 0; font-size: 11px; color: var(--gr-muted); }
.gr-run-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  margin-left: 6px;
  padding: 4px 9px;
  border: 1px solid rgba(150, 180, 210, 0.24);
  border-radius: 999px;
  color: #9fb3c8;
  font-size: 11px;
}
.gr-run-state i { width: 7px; height: 7px; border-radius: 50%; background: #7d8ea1; }
.gr-run-state.live { color: var(--gr-accent); border-color: rgba(45, 212, 191, 0.42); }
.gr-run-state.live i { background: var(--gr-accent); box-shadow: 0 0 8px var(--gr-accent); }
.gr-toolbar { display: flex; gap: 8px; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; }
.gr-tool {
  height: 30px;
  padding: 0 13px;
  border: 1px solid rgba(157, 188, 224, 0.26);
  border-radius: 6px;
  background: rgba(20, 32, 50, 0.85);
  color: #cfe0f2;
  font-size: 12px;
  cursor: pointer;
}
.gr-tool:hover { border-color: var(--gr-accent-2); color: #fff; }
.gr-tool.active { border-color: var(--gr-accent); color: var(--gr-accent); }
.gr-tool.accent {
  border-color: transparent;
  background: linear-gradient(145deg, #2dd4bf, #0e7490);
  color: #04222a;
  font-weight: 600;
}
.gr-main { display: grid; grid-template-columns: 268px minmax(0, 1fr) 292px; min-height: 0; }
.gr-sidebar,
.gr-inspector {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  background: var(--gr-panel);
}
.gr-sidebar { border-right: 1px solid var(--gr-line); }
.gr-inspector { border-left: 1px solid var(--gr-line); }
.gr-sidebar-head,
.gr-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #8fb6de;
}
.gr-sidebar-head { margin-bottom: 2px; }
.gr-sidebar-head em { font-style: normal; font-weight: 400; font-size: 10px; color: #7f93a8; }
.group-label {
  margin-top: 6px;
  padding-top: 9px;
  border-top: 1px solid var(--gr-line);
  color: var(--gr-accent);
  font-size: 11.5px;
  font-weight: 600;
}
.group-label .gr-en { margin-left: 6px; font-style: normal; font-weight: 400; color: #6d8aa6; font-size: 10px; }
.group-label.collapsible {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 9px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
}
.group-label.collapsible i {
  width: 7px;
  height: 7px;
  border-right: 1.5px solid #6f8aa4;
  border-bottom: 1.5px solid #6f8aa4;
  transform: rotate(45deg);
  transition: transform 0.18s ease;
}
.group-label.collapsible.open i { transform: rotate(-135deg); }
.group-label.collapsible.open {
  color: #eafffb;
  background: rgba(45, 212, 191, 0.1);
  box-shadow: inset 2px 0 0 var(--gr-accent);
}
.group-label.collapsible.open .gr-en { color: #8fd9cf; }
.gr-accordion-body {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 2px 0 4px;
  padding: 10px 10px 11px;
  border-left: 2px solid rgba(45, 212, 191, 0.3);
  border-radius: 0 6px 6px 0;
  background: rgba(15, 39, 64, 0.42);
}
.param-row { display: flex; align-items: center; gap: 8px; min-height: 22px; }
.param-label { flex: 0 0 72px; color: #a9c1d8; font-size: 11.5px; }
.param-value { flex: 0 0 34px; text-align: right; color: #cfe4f6; font-size: 11px; font-variant-numeric: tabular-nums; }
.param-static { flex: 1; text-align: right; color: #cfe4f6; font-size: 11.5px; }
.param-slider { flex: 1; min-width: 0; accent-color: var(--gr-accent); }
.toggle-input { margin-left: auto; accent-color: var(--gr-accent); }
.color-input { margin-left: auto; width: 42px; height: 20px; padding: 0; border: 1px solid var(--gr-line); border-radius: 4px; background: transparent; cursor: pointer; }
.select-input {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 6px;
  border: 1px solid var(--gr-line);
  border-radius: 4px;
  background: var(--gr-panel-2);
  color: var(--gr-text);
  font-size: 11.5px;
}
.stats-line { color: #8ba6c2; font-size: 10.5px; line-height: 1.5; }
.stats-line b { color: #d9ecff; }
.gr-warn { color: var(--gr-warn); }
.gr-stage { position: relative; min-width: 0; min-height: 0; }
.cesium-container { position: absolute; inset: 0; }
.gr-map-caption {
  position: absolute;
  left: 12px;
  bottom: 12px;
  padding: 4px 10px;
  border: 1px solid var(--gr-line);
  border-radius: 6px;
  background: rgba(6, 18, 31, 0.72);
  color: #a9c1d8;
  font-size: 11px;
}
.gr-metrics-toggle {
  position: absolute;
  top: 12px;
  left: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--gr-line);
  border-radius: 999px;
  background: rgba(9, 25, 40, 0.82);
  color: #cfe4f6;
  font-size: 11.5px;
  cursor: pointer;
}
.gr-dot { width: 8px; height: 8px; border-radius: 50%; }
.gr-pick-panel {
  position: absolute;
  top: 48px;
  left: 12px;
  width: 268px;
  max-width: calc(100% - 24px);
  border: 1px solid rgba(45, 212, 191, 0.3);
  border-radius: 8px;
  background: rgba(8, 22, 36, 0.94);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}
.gr-pick-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 9px 11px; border-bottom: 1px solid var(--gr-line); }
.gr-pick-title { margin: 0; font-size: 12.5px; font-weight: 700; color: #e4f4ff; }
.gr-pick-sub { margin: 2px 0 0; font-size: 10.5px; color: var(--gr-muted); }
.gr-pick-close { width: 20px; height: 20px; border: none; border-radius: 4px; background: rgba(120, 150, 180, 0.16); color: #cfe4f6; cursor: pointer; }
.gr-pick-body { padding: 8px 11px 10px; display: flex; flex-direction: column; gap: 6px; }
.gr-hover-tip {
  position: absolute;
  z-index: 6;
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  padding: 4px 9px;
  border: 1px solid rgba(45, 212, 191, 0.45);
  border-radius: 6px;
  background: rgba(6, 20, 33, 0.92);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  transform: translate(14px, 14px);
  white-space: nowrap;
}
.gr-hover-tip-code { font-family: "DM Mono", monospace; font-size: 12px; font-weight: 700; color: #7cf0dc; }
.gr-hover-tip-label { font-size: 10px; color: #8ba6c2; }
.gr-kv { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 11px; }
.gr-kv span { color: #8ba6c2; flex: 0 0 auto; }
.gr-kv b { color: #e2f2ff; font-weight: 600; text-align: right; word-break: break-all; }
.gr-kv-strong b { color: var(--gr-accent); }
.gr-layer-dock {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 188px;
  border: 1px solid var(--gr-line);
  border-radius: 8px;
  background: rgba(9, 25, 40, 0.9);
  overflow: hidden;
}
.gr-layer-dock.collapsed { width: auto; }
.gr-layer-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-bottom: 1px solid var(--gr-line);
  background: transparent;
  color: #d6e8f7;
  font-size: 11.5px;
  cursor: pointer;
}
.gr-layer-dock.collapsed .gr-layer-head { border-bottom: none; }
.gr-layer-title { flex: 1; text-align: left; }
.gr-layer-count { color: var(--gr-accent); font-size: 10.5px; }
.gr-layer-caret { width: 6px; height: 6px; border-right: 1.5px solid #7fa0bd; border-bottom: 1.5px solid #7fa0bd; transform: rotate(-135deg); transition: transform 0.18s ease; }
.gr-layer-dock.collapsed .gr-layer-caret { transform: rotate(45deg); }
.gr-layer-body { display: flex; flex-direction: column; padding: 6px; gap: 4px; }
.gr-layer-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: rgba(16, 36, 56, 0.6);
  color: #9fb8cf;
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}
.gr-layer-item.on { border-color: rgba(45, 212, 191, 0.32); color: #e3f6ff; background: rgba(20, 48, 64, 0.8); }
.gr-layer-swatch { width: 10px; height: 10px; border-radius: 3px; flex: 0 0 auto; }
.gr-layer-label { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.gr-layer-label em { font-style: normal; font-size: 9.5px; color: #6f8aa4; }
.gr-layer-switch { position: relative; width: 26px; height: 14px; border-radius: 999px; background: #24384f; flex: 0 0 auto; transition: background 0.16s ease; }
.gr-layer-switch i { position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%; background: #7d93a8; transition: left 0.16s ease, background 0.16s ease; }
.gr-layer-item.on .gr-layer-switch { background: rgba(45, 212, 191, 0.5); }
.gr-layer-item.on .gr-layer-switch i { left: 14px; background: #eafffb; }
.gr-banner {
  position: absolute;
  left: 50%;
  top: 12px;
  transform: translateX(-50%);
  padding: 5px 14px;
  border: 1px solid rgba(45, 212, 191, 0.34);
  border-radius: 999px;
  background: rgba(6, 22, 34, 0.86);
  color: #cdeef0;
  font-size: 11.5px;
  max-width: 70%;
  text-align: center;
}
.gr-inspector .gr-kv { padding: 3px 0; border-bottom: 1px dashed rgba(125, 178, 224, 0.1); }
.gr-ov { padding: 6px 8px; border: 1px solid var(--gr-line); border-radius: 6px; background: rgba(14, 32, 50, 0.6); }
.gr-ov.off { opacity: 0.5; }
.gr-ov-head { display: flex; align-items: center; gap: 7px; font-size: 11.5px; }
.gr-ov-name { flex: 1; color: #d6e8f7; }
.gr-ov-head b { color: var(--gr-accent); font-variant-numeric: tabular-nums; }
.gr-ov-note { margin-top: 3px; font-size: 10px; color: #7f9ab5; }
.gr-arch { padding: 5px 8px; border-left: 2px solid rgba(56, 189, 248, 0.5); }
.gr-arch-name { font-size: 11.5px; font-weight: 600; color: #d6e8f7; }
.gr-arch-name em { margin-left: 6px; font-style: normal; font-size: 9.5px; color: #6f8aa4; }
.gr-arch-desc { font-size: 10px; color: #7f9ab5; }
.gr-statusbar {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 0 16px;
  border-top: 1px solid var(--gr-line);
  background: #091a2a;
  font-size: 11.5px;
  color: #8ba6c2;
  overflow: hidden;
  white-space: nowrap;
}
.gr-status-group b { color: #dceafa; font-variant-numeric: tabular-nums; }
.gr-fps.good b { color: var(--gr-accent); }
.gr-fps.warn b { color: var(--gr-warn); }
.gr-fps.bad b { color: #f87171; }
.gr-roadmap {
  position: absolute;
  inset: 24px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(45, 212, 191, 0.34);
  border-radius: 10px;
  background: #08182a;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.gr-roadmap-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  border-bottom: 1px solid var(--gr-line);
  font-size: 14px;
  font-weight: 700;
  color: #e4f4ff;
  background: linear-gradient(180deg, #0a2434, #0a1a2b);
}
.gr-roadmap-close { height: 28px; padding: 0 12px; border: 1px solid var(--gr-line); border-radius: 6px; background: rgba(20, 40, 60, 0.8); color: #cfe0f2; cursor: pointer; }
.gr-roadmap-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 18px 22px; }
.gr-roadmap-intro { margin: 0 0 12px; line-height: 1.7; color: #b9d2e8; font-size: 12.5px; }
.gr-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.gr-tags span { padding: 3px 10px; border: 1px solid rgba(45, 212, 191, 0.3); border-radius: 999px; color: var(--gr-accent); font-size: 11px; }
.gr-roadmap h4 { margin: 20px 0 10px; font-size: 13px; color: #bfe3ff; border-left: 3px solid var(--gr-accent); padding-left: 9px; }
.gr-pipeline { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.gr-pipe-step { padding: 8px 12px; border: 1px solid var(--gr-line); border-radius: 8px; background: rgba(15, 39, 64, 0.6); }
.gr-pipe-step b { display: block; font-size: 12px; color: #e4f4ff; }
.gr-pipe-step span { font-size: 10.5px; color: #86a3c0; }
.gr-pipe-arrow { color: var(--gr-accent); }
.gr-roadmap-layers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.gr-roadmap-layer { padding: 10px 12px; border: 1px solid var(--gr-line); border-radius: 8px; background: rgba(12, 32, 52, 0.55); }
.gr-roadmap-layer-title { font-size: 12.5px; font-weight: 700; color: #dceafa; }
.gr-roadmap-layer-title em { margin-left: 7px; font-style: normal; font-size: 10px; color: #6f8aa4; }
.gr-roadmap-layer-desc { margin: 3px 0 6px; font-size: 11px; color: #8ba6c2; }
.gr-roadmap-layer ul,
.gr-roadmap-section ul { margin: 0; padding-left: 16px; }
.gr-roadmap-layer li,
.gr-roadmap-section li { font-size: 11px; color: #aec7dd; line-height: 1.65; }
.gr-table { border: 1px solid var(--gr-line); border-radius: 8px; overflow: hidden; }
.gr-table-row { display: grid; grid-template-columns: 1.1fr 1.3fr 1.3fr 1.6fr 2fr; gap: 0; border-top: 1px solid var(--gr-line); }
.gr-table-row:first-child { border-top: none; }
.gr-table-row > span { padding: 7px 10px; font-size: 11px; color: #b9d2e8; border-left: 1px solid var(--gr-line); }
.gr-table-row > span:first-child { border-left: none; }
.gr-table-head > span { background: rgba(15, 45, 70, 0.8); color: #9fd9ea; font-weight: 700; }
.gr-table-row.prime > span { background: rgba(45, 212, 191, 0.07); }
.gr-matrix .gr-table-row { grid-template-columns: 1.1fr repeat(5, 1fr); }
.gr-table-eng { grid-template-columns: 1fr 1.5fr 2.4fr; }
.gr-score-cell { position: relative; display: flex; align-items: center; justify-content: center; }
.gr-score-bar { position: absolute; left: 0; top: 0; bottom: 0; opacity: 0.22; }
.gr-score-cell b { position: relative; font-size: 11px; }
.gr-roadmap-sections { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.gr-roadmap-section { padding: 10px 12px; border: 1px solid var(--gr-line); border-radius: 8px; background: rgba(12, 32, 52, 0.55); }
.gr-roadmap-section-title { font-size: 12px; font-weight: 700; color: #dceafa; margin-bottom: 4px; }
.gr-roadmap-section p { margin: 0 0 6px; font-size: 11px; color: #8ba6c2; }

@media (max-width: 1180px) {
  .gr-main { grid-template-columns: 240px minmax(0, 1fr); }
  .gr-inspector { display: none; }
}
@media (max-width: 900px) {
  .gr-main { grid-template-columns: minmax(0, 1fr); }
  .gr-sidebar { display: none; }
  .gr-roadmap { inset: 10px; }
  .gr-roadmap-layers,
  .gr-roadmap-sections { grid-template-columns: minmax(0, 1fr); }
}
</style>
