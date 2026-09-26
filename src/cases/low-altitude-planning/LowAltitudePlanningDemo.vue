<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartographic,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Cesium3DTileset,
  type Viewer
} from 'cesium'
import { buildGrid, GRID_LEVEL_OPTIONS, GRID_STATE_META } from './sys/geosot'
import {
  AREA_LABEL,
  buildDevices,
  buildFences,
  buildFlightPlans,
  buildLogs,
  buildObstacles,
  buildSeedAlarms,
  DEMO_BOUNDS,
  DEMO_CENTER,
  DEMO_SEED,
  deviceStats,
  MOCK_AIRSPACES,
  MOCK_POI,
  MOCK_ROLES,
  MOCK_USERS
} from './sys/mock'
import {
  defaultTaskPoints,
  planAreaRoute,
  planSurroundRoute,
  planWaypointRoutes,
  type PlannerContext
} from './sys/planning'
import { SystemRenderer, type GridStyle } from './sys/renderer'
import {
  addOsmWhiteModels,
  addSystemImagery,
  addSystemTerrain,
  createSystemViewer,
  destroySystemViewer,
  flyToLonLat,
  pickLonLat,
  setSystemCamera
} from './sys/scene'
import { SimulationFlight, type FlightHud } from './sys/flight'
import { DRONE_CREDIT } from './sys/drone'
import { MonitorSimulation } from './sys/monitor'
import {
  ROADMAP_INTRO,
  ROADMAP_LAYERS,
  ROADMAP_MILESTONES,
  ROADMAP_MODULES,
  ROADMAP_PIPELINE,
  ROADMAP_SCHEMA,
  ROADMAP_TAGS,
  ROADMAP_TITLE
} from './sys/roadmap'
import type {
  AirspaceZone,
  Alarm,
  Device,
  Fence,
  GridCell,
  LayerFlags,
  LayerKey,
  LonLat,
  PickPayload,
  RenderMode,
  RoutePlan,
  RouteType,
  SystemModuleId,
  Track
} from './sys/types'
import { formatClock, haversine, pointInRing } from './sys/util'

type SystemModule = { id: SystemModuleId; label: string; en: string }

const MODULES: SystemModule[] = [
  { id: 'scene', label: '场景可视', en: 'SCENE' },
  { id: 'route', label: '航线规划', en: 'ROUTE' },
  { id: 'flight', label: '模拟飞行', en: 'FLIGHT' },
  { id: 'monitor', label: '实时监控', en: 'MONITOR' },
  { id: 'airspace', label: '空域管理', en: 'AIRSPACE' },
  { id: 'data', label: '数据管理', en: 'DATA' },
  { id: 'system', label: '系统管理', en: 'SYSTEM' }
]

const RENDER_MODES: Array<{ value: RenderMode; label: string; desc: string }> = [
  { value: 'single', label: '单值渲染', desc: '按网格状态常量着色（禁飞/限飞/占用/适飞）' },
  { value: 'graduated', label: '分级渲染', desc: '按网格风险数值区间映射色带' },
  { value: 'pointCloud', label: '点云渲染', desc: '以点云表达单元密度与规模' },
  { value: 'heatmap', label: '热力图', desc: '按单元建筑密度生成热力分布' },
  { value: 'trajectory', label: '轨迹图', desc: '网格线为底，叠加实时航迹' }
]

const LAYER_META: Array<{ key: LayerKey; label: string; color: string }> = [
  { key: 'grid', label: '北斗网格', color: '#38bdf8' },
  { key: 'forbid', label: '禁飞区', color: '#e74c3c' },
  { key: 'restrict', label: '限飞区', color: '#f1c40f' },
  { key: 'free', label: '适飞区', color: '#2ecc71' },
  { key: 'model', label: '三维白模', color: '#e2e8f0' },
  { key: 'obstacle', label: '规划建筑体块', color: '#9aa8b8' },
  { key: 'route', label: '规划航线', color: '#22d3ee' },
  { key: 'track', label: '实时航迹', color: '#a78bfa' },
  { key: 'device', label: '无人机', color: '#38bdf8' },
  { key: 'poi', label: '兴趣点', color: '#facc15' },
  { key: 'fence', label: '电子围栏', color: '#22d3ee' }
]

const DATA_TABS = [
  { key: 'device', label: '设备台账' },
  { key: 'plan', label: '飞行计划' },
  { key: 'alarm', label: '告警台账' },
  { key: 'stats', label: '统计报表' }
] as const

const SYSTEM_TABS = [
  { key: 'user', label: '用户管理' },
  { key: 'role', label: '角色权限' },
  { key: 'log', label: '日志审计' },
  { key: 'param', label: '参数配置' }
] as const

const ALARM_LEVEL_META: Record<Alarm['level'], { label: string; color: string }> = {
  urgent: { label: '紧急', color: '#ef4444' },
  warn: { label: '警告', color: '#f59e0b' },
  info: { label: '提醒', color: '#38bdf8' }
}

const container = ref<HTMLElement>()
let viewer: Viewer | undefined
let renderer: SystemRenderer | undefined
let flight: SimulationFlight | undefined
let monitor: MonitorSimulation | undefined
let modelTileset: Cesium3DTileset | undefined
let handler: ScreenSpaceEventHandler | undefined
let statsTimer: number | undefined
let fpsTimer: number | undefined
let frameCount = 0
let lastFpsAt = performance.now()

const activeModule = ref<SystemModuleId>('scene')
const layers = reactive<LayerFlags>({
  grid: true,
  forbid: true,
  restrict: true,
  free: true,
  model: true,
  obstacle: false,
  route: true,
  track: true,
  device: false,
  fence: true,
  poi: true
})

const renderMode = ref<RenderMode>('single')
const gridLevel = ref(17)
const gridOpacity = ref(0.5)
const gridSolid = ref(false)
const gridAltMin = ref(0)
const gridAltMax = ref(120)
const depthTest = ref(true)

const airspaces = reactive<AirspaceZone[]>(JSON.parse(JSON.stringify(MOCK_AIRSPACES)) as AirspaceZone[])
const fences = reactive<Fence[]>(buildFences())
const obstacles = buildObstacles()
const devices = reactive<Device[]>(buildDevices())
const plans = buildFlightPlans()
const logs = buildLogs()

const gridCells = ref<GridCell[]>([])
const routes = ref<RoutePlan[]>([])
const selectedRouteId = ref<string>('')
const tracks = ref<Track[]>([])
const alarms = ref<Alarm[]>(buildSeedAlarms())
const monitorRunning = ref(false)
const monitorSpeed = ref(1)

const pick = ref<PickPayload | null>(null)
const statusMessage = ref('正在初始化 Cesium 场景…')
const banner = ref('')
const tool = ref<'pick' | 'waypoint-start' | 'waypoint-end' | 'area-draw' | 'surround-center'>('pick')
const draftPoints = ref<LonLat[]>([])
const taskStart = ref<LonLat>()
const taskEnd = ref<LonLat>()
const taskAlt = ref(110)
const routeType = ref<RouteType>('waypoint')
const areaSpacing = ref(130)
const surroundRadius = ref(420)
const surroundCenter = ref<LonLat>()
const planning = ref(false)

const hud = reactive<FlightHud>({
  lon: DEMO_CENTER.lon,
  lat: DEMO_CENTER.lat,
  alt: 0,
  speed: 0,
  heading: 0,
  remaining: 0,
  progress: 0,
  phase: '待起飞'
})
const flightSpeed = ref(8)
const flightProgress = ref(0)
const followCamera = ref(false)

const stats = reactive({ height: 0, zoom: 0, lon: DEMO_CENTER.lon, lat: DEMO_CENTER.lat, fps: 0, west: 0, east: 0, south: 0, north: 0 })
const clockText = ref(formatClock(new Date()))
const roadmapOpen = ref(false)
const dataTab = ref<(typeof DATA_TABS)[number]['key']>('device')
const systemTab = ref<(typeof SYSTEM_TABS)[number]['key']>('user')
const alarmFilter = ref<'all' | 'pending' | Alarm['level']>('all')
let statusTimer: number | undefined

function flashStatus(message: string, duration = 4600): void {
  statusMessage.value = message
  if (statusTimer !== undefined) window.clearTimeout(statusTimer)
  statusTimer = window.setTimeout(() => {
    statusTimer = undefined
    if (statusMessage.value === message) statusMessage.value = ''
  }, duration)
}

const context = computed<PlannerContext>(() => ({
  bounds: DEMO_BOUNDS,
  airspaces: airspaces as AirspaceZone[],
  obstacles,
  seed: DEMO_SEED
}))

const selectedRoute = computed(() => routes.value.find((r) => r.id === selectedRouteId.value))
const deviceStat = computed(() => deviceStats(devices as Device[]))
const pendingAlarmCount = computed(() => alarms.value.filter((a) => a.status === 'pending').length)
const filteredAlarms = computed(() =>
  alarms.value.filter((alarm) => {
    if (alarmFilter.value === 'all') return true
    if (alarmFilter.value === 'pending') return alarm.status === 'pending'
    return alarm.level === alarmFilter.value
  })
)
const currentModule = computed(() => MODULES.find((m) => m.id === activeModule.value))
const gridSummary = computed(() => {
  const base = { free: 0, restricted: 0, forbid: 0, used: 0 }
  for (const cell of gridCells.value) {
    if (cell.state === 'free') base.free += 1
    else if (cell.state === 'used') base.used += 1
    else if (cell.state === 'restrict') base.restricted += 1
    else base.forbid += 1
  }
  return base
})
const selectedDevice = computed(() =>
  pick.value?.kind === 'device' ? pick.value.device : undefined
)
const selectedCell = computed(() => (pick.value?.kind === 'grid' ? pick.value.cell : undefined))
const selectedZone = computed(() => (pick.value?.kind === 'airspace' ? pick.value.zone : undefined))
const selectedObstacle = computed(() =>
  pick.value?.kind === 'obstacle' ? pick.value.obstacle : undefined
)
const legendItems = computed(() => {
  const items: Array<{ label: string; color: string }> = []
  if (layers.grid) {
    for (const meta of Object.values(GRID_STATE_META)) items.push({ label: meta.label, color: meta.color })
  }
  for (const meta of LAYER_META) {
    if (meta.key === 'grid') continue
    if (layers[meta.key]) items.push({ label: meta.label, color: meta.color })
  }
  return items
})
const cellRisk = computed(() => {
  const cell = selectedCell.value
  if (!cell) return null
  const center = { lon: cell.centerLon, lat: cell.centerLat }
  const zones = (airspaces as AirspaceZone[]).filter((zone) => {
    if (!zone.active) return false
    return zone.shape === 'polygon'
      ? pointInRing(center, zone.ring)
      : haversine(center, zone.center) <= zone.radius
  })
  const hits = obstacles.filter(
    (o) =>
      center.lon >= o.west && center.lon <= o.east && center.lat >= o.south && center.lat <= o.north
  )
  const maxHeight = hits.reduce((m, o) => Math.max(m, o.height), 0)
  const factors: string[] = []
  for (const zone of zones) {
    const label = zone.type === 'forbid' ? '禁飞区' : zone.type === 'restrict' ? '限飞区' : '适飞区'
    factors.push(`中心点落在「${zone.name}」（${label}）内，该空域管制高度 ${zone.altMin}~${zone.altMax} m`)
  }
  for (const o of hits) {
    factors.push(`单元内有建筑障碍「${o.name}」，限高 ${o.height} m（${o.kind === 'tower' ? '高塔' : '建筑'}）`)
  }
  if (cell.density > 0) {
    factors.push(`障碍密度 ${(cell.density * 100).toFixed(0)}%，体块对该单元形成一定空间压制`)
  }
  if (maxHeight >= cell.altMax) {
    factors.push(`建筑限高 ${maxHeight} m 已达到或超过本高度域上限 ${cell.altMax} m，存在垂直冲突风险`)
  }
  if (!zones.length && !hits.length) {
    factors.push('单元内无空域管制与建筑障碍压占，空间开阔')
  }

  let stateReason = ''
  if (cell.state === 'forbid') {
    stateReason = `中心点落入禁飞空域${zones.map((z) => `「${z.name}」`).join('、')}，按空域管制规则评定为禁飞状态，全高度禁止无人机活动。`
  } else if (cell.state === 'restrict') {
    stateReason = `中心点位于限飞空域${zones.map((z) => `「${z.name}」`).join('、')}，未触及禁飞条件但受高度/报备限制，评定为限飞状态。`
  } else if (cell.state === 'used') {
    stateReason = '单元不在禁飞/限飞空域内，但处于城市飞行活动密集区，占用指数超过阈值，评定为占用状态，需关注冲突与避让。'
  } else {
    stateReason = '单元不在任何禁飞/限飞空域内，且无建筑障碍压占，满足适飞条件，评定为适飞状态。'
  }

  const valueReason =
    hits.length > 0
      ? `风险数值 ${cell.value} 由单元内建筑限高累加得到（${hits.map((o) => o.height).join(' + ')} = ${hits.reduce((s, o) => s + o.height, 0)}），表征障碍对低空通行走廊的综合压制强度。`
      : `风险数值 ${cell.value} 由基础活动指数 30 与随机占用因子叠加生成，反映该单元的低空活动密度与潜在冲突概率。`

  let level = '低'
  if (cell.state === 'forbid' || maxHeight >= cell.altMax) level = '高'
  else if (cell.state === 'restrict' || cell.value >= 150) level = '较高'
  else if (cell.state === 'used' || cell.value >= 80) level = '中'

  const advice =
    level === '高'
      ? '禁止规划航线穿越；如需作业须申请空域并采用绕飞方案。'
      : level === '较高'
        ? '航线应避开或提升至最高障碍物之上，并预留 30 m 以上垂直余量。'
        : level === '中'
          ? '可规划航线，但建议保持视距内飞行并加强冲突监视。'
          : '可作为常规航路使用，按标准程序执行即可。'

  const summary = `该单元当前评定为 ${GRID_STATE_META[cell.state].label}，综合风险等级为「${level}」。${factors[0] ?? ''}`
  return { level, summary, stateReason, valueReason, factors, advice }
})

const dataStats = computed(() => ({
  flights: plans.length,
  online: deviceStat.value.online,
  alarms: alarms.value.length,
  routes: routes.value.length,
  airspaceUse: Math.round(
    (airspaces.filter((z) => z.type !== 'free').length / Math.max(1, airspaces.length)) * 100
  )
}))

function initClock(): void {
  clockText.value = formatClock(new Date())
  window.setInterval(() => {
    clockText.value = formatClock(new Date())
  }, 1000)
}

async function initViewer(): Promise<void> {
  if (!container.value) return
  viewer = createSystemViewer(container.value)
  if (import.meta.env.DEV) {
    ;(window as unknown as { __lapViewer?: Viewer }).__lapViewer = viewer
  }
  viewer.scene.globe.depthTestAgainstTerrain = depthTest.value
  renderer = new SystemRenderer(viewer)
  flight = new SimulationFlight(viewer)
  flight.onHud((next) => {
    Object.assign(hud, next)
    flightProgress.value = Math.round(next.progress * 1000)
  })
  monitor = new MonitorSimulation(devices as Device[], airspaces as AirspaceZone[], buildSeedAlarms())
  monitor.onUpdate((payload) => {
    tracks.value = payload.tracks
    alarms.value = payload.alarms
    renderer?.setTracks(payload.tracks, layers.track, payload.progress)
    renderer?.setDevices(devices as Device[], layers.device)
  })
  addSystemImagery(viewer, (message) => flashStatus(message))
  void addSystemTerrain(viewer, DEMO_BOUNDS, (message) => flashStatus(message)).then((elevation) => {
    renderer?.setElevationModel(elevation)
    refreshGrid()
    refreshAirspaces()
    refreshObstacles()
    refreshFences()
    renderer?.setPoi(MOCK_POI, layers.poi)
    renderer?.setTracks(tracks.value, layers.track)
    renderer?.setDevices(devices as Device[], layers.device)
    refreshTaskPoints()
  })
  void addOsmWhiteModels(viewer, (message) => flashStatus(message)).then((tileset) => {
    modelTileset = tileset
    if (tileset) tileset.show = layers.model
  })
  setSystemCamera(viewer, DEMO_BOUNDS)
  refreshGrid()
  refreshAirspaces()
  refreshObstacles()
  refreshFences()
  renderer.setPoi(MOCK_POI, layers.poi)
  renderer.setLayers(layers)
  bindInteraction()
  bindStats()
  const preset = defaultTaskPoints(DEMO_BOUNDS)
  taskStart.value = preset.start
  taskEnd.value = preset.end
  refreshTaskPoints()
  await nextTick()
  flashStatus(`低空作业区已就绪：${AREA_LABEL}`)
}

function refreshGrid(): void {
  if (!renderer) return
  gridCells.value = buildGrid({
    bounds: DEMO_BOUNDS,
    level: gridLevel.value,
    altMin: gridAltMin.value,
    altMax: gridAltMax.value,
    airspaces: airspaces as AirspaceZone[],
    obstacles,
    seed: DEMO_SEED
  })
  const style: GridStyle = {
    mode: renderMode.value,
    opacity: gridOpacity.value,
    solid: gridSolid.value,
    altMin: gridAltMin.value,
    altMax: gridAltMax.value,
    showFill: renderMode.value !== 'trajectory'
  }
  renderer.setGrid(gridCells.value, style)
  renderer.setLayers(layers)
}

function airspaceVisibility() {
  return { forbid: layers.forbid, restrict: layers.restrict, free: layers.free }
}

function refreshAirspaces(): void {
  renderer?.setAirspaces(airspaces as AirspaceZone[], airspaceVisibility())
  renderer?.setLayers(layers)
}

function refreshFences(): void {
  renderer?.setFences(fences as Fence[], layers.fence)
  renderer?.setLayers(layers)
}

function setDepthTest(): void {
  if (!viewer) return
  viewer.scene.globe.depthTestAgainstTerrain = depthTest.value
  flashStatus(depthTest.value ? '已开启深度检测：要素与地表遮挡关系生效' : '已关闭深度检测')
}

function refreshTaskPoints(): void {
  renderer?.setTaskPoints(taskStart.value, taskEnd.value, taskAlt.value)
}

/** 以目标点为中心生成一个小的菱形环，用于单点拾取的位置反馈。 */
function markerRing(point: LonLat, size = 0.00016): LonLat[] {
  return [
    { lon: point.lon - size, lat: point.lat },
    { lon: point.lon, lat: point.lat - size },
    { lon: point.lon + size, lat: point.lat },
    { lon: point.lon, lat: point.lat + size }
  ]
}

function refreshObstacles(): void {
  renderer?.setObstacles(obstacles, layers.obstacle)
  renderer?.setLayers(layers)
}

function refreshRoutes(): void {
  renderer?.setRoutes(routes.value, layers.route, selectedRouteId.value)
  renderer?.setLayers(layers)
}

function bindInteraction(): void {
  if (!viewer) return
  handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  handler.setInputAction((movement: { position: Cartesian2 }) => {
    const lonLat = pickLonLat(viewer!.scene, movement.position)
    if (!lonLat) return
    if (tool.value === 'area-draw') {
      draftPoints.value.push(lonLat)
      renderer?.setDraft(draftPoints.value)
      flashStatus(`已绘制 ${draftPoints.value.length} 个顶点，双击或右键结束`)
      return
    }
    if (tool.value === 'waypoint-start') {
      taskStart.value = lonLat
      tool.value = 'pick'
      refreshTaskPoints()
      flashStatus(`起点已设定：${lonLat.lon.toFixed(5)}°E / ${lonLat.lat.toFixed(5)}°N`)
      return
    }
    if (tool.value === 'waypoint-end') {
      taskEnd.value = lonLat
      tool.value = 'pick'
      refreshTaskPoints()
      flashStatus(`终点已设定：${lonLat.lon.toFixed(5)}°E / ${lonLat.lat.toFixed(5)}°N`)
      return
    }
    if (tool.value === 'surround-center') {
      surroundCenter.value = lonLat
      tool.value = 'pick'
      renderer?.setHighlight(markerRing(lonLat), taskAlt.value, '#facc15')
      flashStatus('环绕中心已设定，可生成环绕航线')
      return
    }
    handleScenePick(movement.position)
  }, ScreenSpaceEventType.LEFT_CLICK)

  handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
    if (tool.value !== 'area-draw' || !viewer) return
    const lonLat = pickLonLat(viewer.scene, movement.endPosition)
    if (lonLat) {
      renderer?.setDraft([...draftPoints.value, lonLat])
    }
  }, ScreenSpaceEventType.MOUSE_MOVE)

  handler.setInputAction(() => finishAreaDraw(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
  handler.setInputAction(() => finishAreaDraw(), ScreenSpaceEventType.RIGHT_CLICK)
}

function handleScenePick(position: Cartesian2): void {
  if (!viewer) return
  const picked = viewer.scene.pick(position) as { id?: unknown } | undefined
  const raw = picked?.id
  if (!raw || typeof raw !== 'object') {
    pick.value = null
    renderer?.setHighlight([], 0)
    return
  }
  if (!('kind' in raw)) {
    const entityId = (raw as { id?: unknown }).id
    const fence = typeof entityId === 'string' ? (fences as Fence[]).find((f) => f.id === entityId) : undefined
    if (!fence) {
      pick.value = null
      renderer?.setHighlight([], 0)
      return
    }
    renderer?.setHighlight([], 0)
    pick.value = { kind: 'fence', fence }
    renderer?.setHighlight(fence.ring, fence.alt + 60, fence.color)
    flashStatus(`电子围栏：${fence.name}`)
    return
  }
  const payload = raw as PickPayload
  renderer?.setHighlight([], 0)
  pick.value = payload
  if (payload.kind === 'grid') {
    const cell = payload.cell
    renderer?.setHighlight(
      [
        { lon: cell.west, lat: cell.south },
        { lon: cell.east, lat: cell.south },
        { lon: cell.east, lat: cell.north },
        { lon: cell.west, lat: cell.north }
      ],
      cell.altMin,
      GRID_STATE_META[cell.state].color
    )
    flashStatus(`网格 ${cell.code} · ${GRID_STATE_META[cell.state].label}`)
  } else if (payload.kind === 'route') {
    selectedRouteId.value = payload.route.id
    refreshRoutes()
    flashStatus(`已选中航线：${payload.route.name}`)
  } else if (payload.kind === 'airspace') {
    const zone = payload.zone
    renderer?.setHighlight(zone.shape === 'polygon' ? zone.ring : [], zone.altMax, '#f8fafc')
    activeModule.value = 'airspace'
    flashStatus(`空域：${zone.name}`)
  } else if (payload.kind === 'device') {
    activeModule.value = 'monitor'
    flashStatus(`设备：${payload.device.name}`)
  } else if (payload.kind === 'obstacle') {
    flashStatus(`建筑障碍：${payload.obstacle.name}`)
  } else if (payload.kind === 'fence') {
    const fence = payload.fence
    renderer?.setHighlight(fence.ring, fence.alt + 60, fence.color)
    flashStatus(`电子围栏：${fence.name}`)
  }
}

function startAreaDraw(): void {
  tool.value = 'area-draw'
  draftPoints.value = []
  renderer?.setDraft([])
  if (viewer) viewer.scene.screenSpaceCameraController.enableInputs = false
  flashStatus('请在场景中依次单击绘制区域，双击或右键结束')
}

function finishAreaDraw(): void {
  if (tool.value !== 'area-draw') return
  tool.value = 'pick'
  if (viewer) viewer.scene.screenSpaceCameraController.enableInputs = true
  if (draftPoints.value.length < 3) {
    draftPoints.value = []
    renderer?.setDraft([])
    flashStatus('顶点不足 3 个，已取消绘制')
    return
  }
  renderer?.setHighlight(draftPoints.value, taskAlt.value, '#38bdf8')
  flashStatus(`区域绘制完成，共 ${draftPoints.value.length} 个顶点`)
}

function generateWaypoint(): void {
  if (!taskStart.value || !taskEnd.value) {
    flashStatus('请先拾取起点与终点')
    return
  }
  planning.value = true
  flashStatus('正在执行栅格 A* 搜索与 B 样条平滑…')
  window.setTimeout(() => {
    const plans = planWaypointRoutes(
      { start: taskStart.value!, end: taskEnd.value!, alt: taskAlt.value },
      context.value
    )
    routes.value = plans
    selectedRouteId.value = plans[0]?.id ?? ''
    planning.value = false
    refreshRoutes()
    flashStatus(`已生成 ${plans.length} 个候选方案，请选择并评估`)
  }, 30)
}

function generateArea(): void {
  if (draftPoints.value.length < 3) {
    flashStatus('请先绘制面状区域')
    return
  }
  const plan = planAreaRoute(draftPoints.value, areaSpacing.value, taskAlt.value, context.value)
  routes.value = [plan]
  selectedRouteId.value = plan.id
  refreshRoutes()
  flashStatus(`面状扫测航线已生成，共 ${plan.points.length} 个航点`)
}

function generateSurround(): void {
  if (!surroundCenter.value) {
    flashStatus('请先拾取环绕中心')
    return
  }
  const plan = planSurroundRoute(
    surroundCenter.value,
    surroundRadius.value,
    taskAlt.value,
    context.value
  )
  routes.value = [plan]
  selectedRouteId.value = plan.id
  refreshRoutes()
  flashStatus(`环绕航线已生成，半径 ${surroundRadius.value} m`)
}

function selectRoute(id: string): void {
  selectedRouteId.value = id
  refreshRoutes()
  const route = routes.value.find((r) => r.id === id)
  if (route && route.points.length) {
    const mid = route.points[Math.floor(route.points.length / 2)]
    flyToLonLat(viewer!, mid, mid.alt, 2400)
  }
}

function enterFlight(): void {
  if (!selectedRoute.value) {
    flashStatus('请先在航线规划模块生成并选择方案')
    return
  }
  activeModule.value = 'flight'
  flight?.load(selectedRoute.value)
  flightSlideTo(0)
  flashStatus(`已装载航线：${selectedRoute.value.name}，点击开始模拟飞行`)
}

function flightPlay(): void {
  flight?.play()
  followCamera.value = true
  flight?.follow()
}

function flightPause(): void {
  flight?.pause()
}

function flightSlideTo(value: number): void {
  const progress = Math.min(1, Math.max(0, value / 1000))
  flight?.seek(progress)
  flightProgress.value = Math.round(progress * 1000)
}

function flightSpeedChange(value: number): void {
  flightSpeed.value = value
  flight?.setSpeed(value)
}

function onFlightProgressInput(event: Event): void {
  flightSlideTo(Number((event.target as HTMLInputElement).value))
}

function onFlightSpeedInput(event: Event): void {
  flightSpeedChange(Number((event.target as HTMLInputElement).value))
}

function onMonitorSpeedInput(event: Event): void {
  monitorSpeedChange(Number((event.target as HTMLInputElement).value))
}

function toggleFollow(): void {
  followCamera.value = !followCamera.value
  if (followCamera.value) flight?.follow()
  else flight?.unfollow()
}

function toggleMonitor(): void {
  if (!monitor) return
  monitorRunning.value = !monitorRunning.value
  if (monitorRunning.value) {
    monitor.start()
    if (layers.track) renderer?.setTracks(tracks.value, true)
    flashStatus('实时监控已启动，正在接收设备航迹')
  } else {
    monitor.stop()
    flashStatus('实时监控已暂停')
  }
}

function monitorSpeedChange(value: number): void {
  monitorSpeed.value = value
  monitor?.setSpeed(value)
}

function handleAlarm(id: string): void {
  monitor?.handleAlarm(id)
  alarms.value = alarms.value.map((a) => (a.id === id ? { ...a, status: 'handled' } : a))
  flashStatus('告警已确认处置')
}

function locateAlarm(alarm: Alarm): void {
  flyToLonLat(viewer!, { lon: alarm.lon, lat: alarm.lat }, alarm.alt, 1400)
  flashStatus(`已定位告警位置：设备 ${alarm.deviceNo}`)
}

function locateDevice(device: Device): void {
  pick.value = { kind: 'device', device }
  flyToLonLat(viewer!, { lon: device.lon, lat: device.lat }, device.alt, 1200)
}

function toggleZone(zone: AirspaceZone): void {
  zone.active = !zone.active
  refreshAirspaces()
  refreshGrid()
}

function locateZone(zone: AirspaceZone): void {
  const center =
    zone.shape === 'polygon' && zone.ring.length
      ? zone.ring.reduce(
          (sum, p) => ({ lon: sum.lon + p.lon / zone.ring.length, lat: sum.lat + p.lat / zone.ring.length }),
          { lon: 0, lat: 0 }
        )
      : zone.center
  flyToLonLat(viewer!, center, zone.altMax, 2600)
  pick.value = { kind: 'airspace', zone }
}

function locateArea(): void {
  setSystemCamera(viewer!, DEMO_BOUNDS)
  flashStatus('已定位低空作业区')
}

function resetView(): void {
  pick.value = null
  draftPoints.value = []
  routes.value = []
  selectedRouteId.value = ''
  tool.value = 'pick'
  layers.track = false
  refreshRoutes()
  renderer?.setDraft([])
  renderer?.setHighlight([], 0)
  const preset = defaultTaskPoints(DEMO_BOUNDS)
  taskStart.value = preset.start
  taskEnd.value = preset.end
  surroundCenter.value = undefined
  refreshTaskPoints()
  renderer?.setTracks([], false)
  flashStatus('已重置场景与规划状态')
}

function bindStats(): void {
  if (!viewer) return
  const update = () => {
    if (!viewer || viewer.isDestroyed()) return
    const carto = Cartographic.fromCartesian(viewer.camera.positionWC)
    if (carto) {
      stats.height = carto.height
      stats.lon = CesiumMath.toDegrees(carto.longitude)
      stats.lat = CesiumMath.toDegrees(carto.latitude)
      stats.zoom = Math.max(0, 20 - Math.log2(Math.max(80, carto.height)))
    }
    const rect = viewer.camera.computeViewRectangle()
    if (rect) {
      stats.west = CesiumMath.toDegrees(rect.west)
      stats.east = CesiumMath.toDegrees(rect.east)
      stats.south = CesiumMath.toDegrees(rect.south)
      stats.north = CesiumMath.toDegrees(rect.north)
    }
  }
  update()
  statsTimer = window.setInterval(update, 800)
  viewer.scene.postRender.addEventListener(() => {
    frameCount += 1
  })
  fpsTimer = window.setInterval(() => {
    const now = performance.now()
    stats.fps = Math.round((frameCount * 1000) / Math.max(1, now - lastFpsAt))
    frameCount = 0
    lastFpsAt = now
  }, 1000)
}

watch([gridLevel, renderMode, gridSolid], () => refreshGrid())
watch([gridAltMin, gridAltMax], () => refreshGrid())
watch(
  layers,
  () => {
    renderer?.setAirspaces(airspaces as AirspaceZone[], airspaceVisibility())
    renderer?.setObstacles(obstacles, layers.obstacle)
    renderer?.setFences(fences as Fence[], layers.fence)
    renderer?.setLayers(layers)
    if (modelTileset) modelTileset.show = layers.model
  },
  { deep: true }
)
watch(
  () => layers.device,
  (visible) => renderer?.setDevices(devices as Device[], visible)
)
watch(taskAlt, () => refreshTaskPoints())

onMounted(async () => {
  initClock()
  await nextTick()
  await initViewer()
})

onBeforeUnmount(() => {
  monitor?.stop()
  flight?.dispose()
  handler?.destroy()
  if (statsTimer !== undefined) window.clearInterval(statsTimer)
  if (fpsTimer !== undefined) window.clearInterval(fpsTimer)
  if (statusTimer !== undefined) window.clearTimeout(statusTimer)
  renderer?.destroy()
  destroySystemViewer(viewer)
})
</script>

<template>
  <div class="lap-system">
    <header class="lap-topbar">
      <div class="lap-identity">
        <span class="lap-emblem">LA</span>
        <div class="lap-identity-text">
          <p class="lap-system-name">低空规划系统</p>
          <p class="lap-system-meta">基于 Cesium 1.144 · 空域数字化 · 场景网格可视 · 航线智能规划 · 模拟飞行 · 实时监控</p>
        </div>
      </div>
      <nav class="lap-nav">
        <button
          v-for="module in MODULES"
          :key="module.id"
          class="lap-nav-item"
          :class="{ active: activeModule === module.id }"
          @click="activeModule = module.id"
        >
          <b>{{ module.label }}</b>
          <em>{{ module.en }}</em>
        </button>
      </nav>
      <div class="lap-topbar-right">
        <span class="lap-clock">{{ clockText }}</span>
        <span class="lap-user">规划员 · admin</span>
        <button class="lap-tool accent" @click="roadmapOpen = true">系统·技术说明</button>
      </div>
    </header>

    <div class="lap-main">
      <aside class="lap-side">
        <!-- 场景可视 -->
        <template v-if="activeModule === 'scene'">
          <div class="lap-panel-head">场景渲染配置<em>实时生效</em></div>
          <label class="lap-field">
            <span>渲染模式</span>
            <select v-model="renderMode" class="lap-select">
              <option v-for="m in RENDER_MODES" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
          </label>
          <p class="lap-hint">{{ RENDER_MODES.find((m) => m.value === renderMode)?.desc }}</p>
          <label class="lap-field">
            <span>网格层级</span>
            <select v-model.number="gridLevel" class="lap-select">
              <option v-for="l in GRID_LEVEL_OPTIONS" :key="l" :value="l">L{{ l }} · 约 {{ l <= 16 ? '1 km' : l === 17 ? '500 m' : l === 18 ? '250 m' : l === 19 ? '120 m' : '60 m' }}</option>
            </select>
          </label>
          <label class="lap-field">
            <span>网格透明度</span>
            <input v-model.number="gridOpacity" type="range" min="0.15" max="0.95" step="0.05" @change="refreshGrid" />
            <b>{{ gridOpacity.toFixed(2) }}</b>
          </label>
          <label class="lap-field">
            <span>三维网格体</span>
            <input v-model="gridSolid" type="checkbox" class="lap-toggle" />
          </label>
          <div class="lap-field">
            <span>高度域(m)</span>
            <input v-model.number="gridAltMin" type="number" class="lap-number" min="0" max="280" step="20" />
            <input v-model.number="gridAltMax" type="number" class="lap-number" min="20" max="300" step="20" />
          </div>
          <div class="lap-stats">
            <span>网格单元 <b>{{ gridCells.length }}</b></span>
            <span>适飞 <b>{{ gridSummary.free }}</b></span>
            <span>占用 <b>{{ gridSummary.used }}</b></span>
            <span>限飞 <b class="warn">{{ gridSummary.restricted }}</b></span>
            <span>禁飞 <b class="danger">{{ gridSummary.forbid }}</b></span>
          </div>
        </template>

        <!-- 航线规划 -->
        <template v-else-if="activeModule === 'route'">
          <div class="lap-panel-head">航线智能规划<em>A* · B样条</em></div>
          <div class="lap-seg">
            <button :class="{ active: routeType === 'waypoint' }" @click="routeType = 'waypoint'">航点航线</button>
            <button :class="{ active: routeType === 'area' }" @click="routeType = 'area'">面状扫测</button>
            <button :class="{ active: routeType === 'surround' }" @click="routeType = 'surround'">环绕航线</button>
          </div>

          <template v-if="routeType === 'waypoint'">
            <button class="lap-action" :class="{ active: tool === 'waypoint-start' }" @click="tool = 'waypoint-start'">
              拾取起点
            </button>
            <button class="lap-action" :class="{ active: tool === 'waypoint-end' }" @click="tool = 'waypoint-end'">
              拾取终点
            </button>
            <p class="lap-hint">
              起点 {{ taskStart ? `${taskStart.lon.toFixed(4)}°E / ${taskStart.lat.toFixed(4)}°N` : '未设置' }}；终点
              {{ taskEnd ? `${taskEnd.lon.toFixed(4)}°E / ${taskEnd.lat.toFixed(4)}°N` : '未设置' }}
            </p>
            <label class="lap-field">
              <span>巡航真高</span>
              <input v-model.number="taskAlt" type="range" min="40" max="240" step="10" />
              <b>{{ taskAlt }} m</b>
            </label>
            <button class="lap-action primary" :disabled="planning" @click="generateWaypoint">
              {{ planning ? '规划中…' : '生成候选方案' }}
            </button>
          </template>

          <template v-else-if="routeType === 'area'">
            <button class="lap-action" :class="{ active: tool === 'area-draw' }" @click="startAreaDraw">绘制区域</button>
            <button class="lap-action" @click="finishAreaDraw">结束绘制</button>
            <p class="lap-hint">已绘制 {{ draftPoints.length }} 个顶点（至少 3 个）</p>
            <label class="lap-field">
              <span>航线间距</span>
              <input v-model.number="areaSpacing" type="range" min="60" max="300" step="10" />
              <b>{{ areaSpacing }} m</b>
            </label>
            <label class="lap-field">
              <span>巡航真高</span>
              <input v-model.number="taskAlt" type="range" min="40" max="240" step="10" />
              <b>{{ taskAlt }} m</b>
            </label>
            <button class="lap-action primary" @click="generateArea">生成面状航线</button>
          </template>

          <template v-else>
            <button class="lap-action" :class="{ active: tool === 'surround-center' }" @click="tool = 'surround-center'">
              拾取环绕中心
            </button>
            <p class="lap-hint">中心 {{ surroundCenter ? `${surroundCenter.lon.toFixed(4)}°E / ${surroundCenter.lat.toFixed(4)}°N` : '未设置' }}</p>
            <label class="lap-field">
              <span>环绕半径</span>
              <input v-model.number="surroundRadius" type="range" min="150" max="1200" step="20" />
              <b>{{ surroundRadius }} m</b>
            </label>
            <label class="lap-field">
              <span>巡航真高</span>
              <input v-model.number="taskAlt" type="range" min="40" max="240" step="10" />
              <b>{{ taskAlt }} m</b>
            </label>
            <button class="lap-action primary" @click="generateSurround">生成环绕航线</button>
          </template>

          <div class="lap-panel-head">候选方案<em>{{ routes.length }} 个</em></div>
          <button
            v-for="route in routes"
            :key="route.id"
            class="lap-plan"
            :class="{ active: route.id === selectedRouteId }"
            @click="selectRoute(route.id)"
          >
            <span class="lap-plan-name">{{ route.name }}</span>
            <span class="lap-plan-meta">综合评分 {{ route.score.toFixed(0) }} · 风险 {{ (route.risk * 100).toFixed(0) }}%</span>
          </button>
          <button class="lap-action primary" @click="enterFlight">选定并模拟飞行</button>
        </template>

        <!-- 模拟飞行 -->
        <template v-else-if="activeModule === 'flight'">
          <div class="lap-panel-head">模拟飞行控制<em>Clock 时间轴</em></div>
          <p class="lap-hint">
            {{ selectedRoute ? `当前航线：${selectedRoute.name}` : '未选择航线，请先到航线规划模块生成方案' }}
          </p>
          <div class="lap-row">
            <button class="lap-action" @click="flightPlay">播放</button>
            <button class="lap-action" @click="flightPause">暂停</button>
            <button class="lap-action" @click="flightSlideTo(0)">复位</button>
          </div>
          <label class="lap-field">
            <span>播放进度</span>
            <input
              :value="flightProgress"
              type="range"
              min="0"
              max="1000"
              step="1"
              @input="onFlightProgressInput"
            />
            <b>{{ (flightProgress / 10).toFixed(0) }}%</b>
          </label>
          <label class="lap-field">
            <span>倍速</span>
            <input
              :value="flightSpeed"
              type="range"
              min="1"
              max="40"
              step="1"
              @input="onFlightSpeedInput"
            />
            <b>{{ flightSpeed }}×</b>
          </label>
          <label class="lap-field">
            <span>相机跟随</span>
            <input :checked="followCamera" type="checkbox" class="lap-toggle" @change="toggleFollow" />
          </label>
          <div class="lap-panel-head">HUD 飞行参数</div>
          <div class="lap-kv"><span>飞行阶段</span><b>{{ hud.phase }}</b></div>
          <div class="lap-kv"><span>速度</span><b>{{ hud.speed }} km/h</b></div>
          <div class="lap-kv"><span>真高 / 海拔</span><b>{{ hud.alt.toFixed(0) }} m</b></div>
          <div class="lap-kv"><span>航向</span><b>{{ hud.heading }}°</b></div>
          <div class="lap-kv"><span>经纬</span><b>{{ hud.lon.toFixed(5) }}, {{ hud.lat.toFixed(5) }}</b></div>
          <div class="lap-kv"><span>剩余里程</span><b>{{ (hud.remaining / 1000).toFixed(2) }} km</b></div>
        </template>

        <!-- 实时监控 -->
        <template v-else-if="activeModule === 'monitor'">
          <div class="lap-panel-head">实时监控<em>{{ monitorRunning ? '运行中' : '已暂停' }}</em></div>
          <div class="lap-row">
            <button class="lap-action primary" @click="toggleMonitor">{{ monitorRunning ? '暂停监控' : '启动监控' }}</button>
          </div>
          <label class="lap-field">
            <span>仿真倍率</span>
            <input
              :value="monitorSpeed"
              type="range"
              min="1"
              max="6"
              step="1"
              @input="onMonitorSpeedInput"
            />
            <b>{{ monitorSpeed }}×</b>
          </label>
          <div class="lap-stats">
            <span>在线 <b>{{ deviceStat.online }}</b></span>
            <span>离线 <b>{{ deviceStat.offline }}</b></span>
            <span>故障 <b class="danger">{{ deviceStat.fault }}</b></span>
          </div>
          <div class="lap-panel-head">实时告警</div>
          <div class="lap-seg small">
            <button :class="{ active: alarmFilter === 'all' }" @click="alarmFilter = 'all'">全部</button>
            <button :class="{ active: alarmFilter === 'pending' }" @click="alarmFilter = 'pending'">待处置</button>
            <button :class="{ active: alarmFilter === 'urgent' }" @click="alarmFilter = 'urgent'">紧急</button>
          </div>
          <div class="lap-alarm-list">
            <div v-for="alarm in filteredAlarms.slice(0, 12)" :key="alarm.id" class="lap-alarm">
              <span class="lap-alarm-tag" :style="{ background: ALARM_LEVEL_META[alarm.level].color }">
                {{ alarm.type }}
              </span>
              <span class="lap-alarm-text">{{ alarm.content }}</span>
              <span class="lap-alarm-time">{{ alarm.time.slice(11) }}</span>
              <button class="lap-mini" @click="locateAlarm(alarm)">定位</button>
              <button v-if="alarm.status === 'pending'" class="lap-mini" @click="handleAlarm(alarm.id)">处置</button>
            </div>
            <p v-if="!filteredAlarms.length" class="lap-hint">暂无告警</p>
          </div>
          <div class="lap-panel-head">设备列表</div>
          <button
            v-for="device in devices"
            :key="device.id"
            class="lap-device"
            :class="device.status"
            @click="locateDevice(device)"
          >
            <span class="lap-device-dot"></span>
            <span>{{ device.no }} · {{ device.name }}</span>
            <b>{{ device.battery.toFixed(0) }}%</b>
          </button>
        </template>

        <!-- 空域管理 -->
        <template v-else-if="activeModule === 'airspace'">
          <div class="lap-panel-head">空域与电子围栏<em>{{ airspaces.length }} 个</em></div>
          <div class="lap-zone-list">
            <div v-for="zone in airspaces" :key="zone.id" class="lap-zone" :class="zone.type">
              <div class="lap-zone-main" @click="locateZone(zone)">
                <span class="lap-zone-badge">{{ zone.type === 'forbid' ? '禁飞' : zone.type === 'restrict' ? '限飞' : '适飞' }}</span>
                <span>{{ zone.name }}</span>
              </div>
              <div class="lap-zone-meta">
                高度 {{ zone.altMin }}~{{ zone.altMax }} m
                <button class="lap-mini" @click="toggleZone(zone)">{{ zone.active ? '停用' : '启用' }}</button>
              </div>
            </div>
          </div>
          <div class="lap-panel-head">空域网格化</div>
          <p class="lap-hint">
            当前网格层级 L{{ gridLevel }}，共 {{ gridCells.length }} 个单元，其中禁飞 {{ gridSummary.forbid }}、
            限飞 {{ gridSummary.restricted }}、适飞 {{ gridSummary.free }}。
          </p>
          <button class="lap-action" @click="activeModule = 'scene'">前往场景网格可视</button>
        </template>

        <!-- 数据管理 -->
        <template v-else-if="activeModule === 'data'">
          <div class="lap-panel-head">数据与业务管理<em>台账 / 报表</em></div>
          <div class="lap-seg small">
            <button v-for="tab in DATA_TABS" :key="tab.key" :class="{ active: dataTab === tab.key }" @click="dataTab = tab.key">
              {{ tab.label }}
            </button>
          </div>
          <div class="lap-table" v-if="dataTab === 'device'">
            <div class="lap-table-row head"><span>编号</span><span>机型</span><span>状态</span><span>电量</span></div>
            <div v-for="device in devices.slice(0, 12)" :key="device.id" class="lap-table-row">
              <span>{{ device.no }}</span><span>{{ device.model }}</span><span>{{ device.status }}</span><span>{{ device.battery.toFixed(0) }}%</span>
            </div>
          </div>
          <div class="lap-table" v-else-if="dataTab === 'plan'">
            <div class="lap-table-row head"><span>计划</span><span>设备</span><span>状态</span><span>高度</span></div>
            <div v-for="plan in plans" :key="plan.id" class="lap-table-row">
              <span>{{ plan.name }}</span><span>{{ plan.deviceNo }}</span><span>{{ plan.status }}</span><span>{{ plan.alt }} m</span>
            </div>
          </div>
          <div class="lap-table" v-else-if="dataTab === 'alarm'">
            <div class="lap-table-row head"><span>类型</span><span>设备</span><span>等级</span><span>状态</span></div>
            <div v-for="alarm in alarms.slice(0, 12)" :key="alarm.id" class="lap-table-row">
              <span>{{ alarm.type }}</span><span>{{ alarm.deviceNo }}</span><span>{{ alarm.level }}</span><span>{{ alarm.status === 'pending' ? '待处置' : '已处置' }}</span>
            </div>
          </div>
          <div class="lap-report" v-else>
            <div v-for="(value, key) in dataStats" :key="key" class="lap-bar">
              <span>{{ key }}</span>
              <i :style="{ width: `${Math.min(100, Number(value) * 8)}%` }"></i>
              <b>{{ value }}</b>
            </div>
          </div>
        </template>

        <!-- 系统管理 -->
        <template v-else>
          <div class="lap-panel-head">系统管理<em>RBAC / 审计</em></div>
          <div class="lap-seg small">
            <button v-for="tab in SYSTEM_TABS" :key="tab.key" :class="{ active: systemTab === tab.key }" @click="systemTab = tab.key">
              {{ tab.label }}
            </button>
          </div>
          <div class="lap-table" v-if="systemTab === 'user'">
            <div class="lap-table-row head"><span>账号</span><span>姓名</span><span>角色</span></div>
            <div v-for="user in MOCK_USERS" :key="user.id" class="lap-table-row">
              <span>{{ user.account }}</span><span>{{ user.name }}</span><span>{{ user.role }}</span>
            </div>
          </div>
          <div class="lap-table" v-else-if="systemTab === 'role'">
            <div class="lap-table-row head"><span>角色</span><span>用户</span><span>权限</span></div>
            <div v-for="role in MOCK_ROLES" :key="role.id" class="lap-table-row">
              <span>{{ role.name }}</span><span>{{ role.users }}</span><span>{{ role.perms }}</span>
            </div>
          </div>
          <div class="lap-table" v-else-if="systemTab === 'log'">
            <div class="lap-table-row head"><span>操作人</span><span>动作</span><span>时间</span></div>
            <div v-for="log in logs" :key="log.id" class="lap-table-row">
              <span>{{ log.operator }}</span><span>{{ log.action }}</span><span>{{ log.time.slice(11) }}</span>
            </div>
          </div>
          <div v-else class="lap-params">
            <div class="lap-kv"><span>默认网格层级</span><b>L17</b></div>
            <div class="lap-kv"><span>适飞真高上限</span><b>120 m</b></div>
            <div class="lap-kv"><span>越界告警阈值</span><b>30 m</b></div>
            <div class="lap-kv"><span>冲突水平间隔</span><b>50 m</b></div>
            <div class="lap-kv"><span>低电量提醒</span><b>25%</b></div>
          </div>
        </template>
      </aside>

      <main class="lap-stage">
        <div ref="container" class="lap-cesium"></div>
        <div class="lap-stage-title">
          <b>{{ currentModule?.label }}</b>
          <span>{{ AREA_LABEL }} · 中心 {{ DEMO_CENTER.lon }}°E / {{ DEMO_CENTER.lat }}°N</span>
        </div>
        <div class="lap-layers">
          <div class="lap-legend-head">场景树 / 图层</div>
          <button
            v-for="item in LAYER_META"
            :key="item.key"
            class="lap-layer"
            :class="{ on: layers[item.key] }"
            @click="layers[item.key] = !layers[item.key]"
          >
            <span class="lap-swatch" :style="{ background: item.color }"></span>
            <span>{{ item.label }}</span>
            <span class="lap-switch"><i></i></span>
          </button>
        </div>
        <div v-if="legendItems.length" class="lap-legend">
          <div class="lap-legend-head">图例</div>
          <div v-for="(item, index) in legendItems" :key="index" class="lap-legend-row">
            <span class="lap-swatch" :style="{ background: item.color }"></span>{{ item.label }}
          </div>
        </div>
        <div v-if="tool !== 'pick'" class="lap-drawing">正在交互：{{ tool === 'area-draw' ? '绘制区域，双击 / 右键结束' : tool === 'waypoint-start' ? '单击设置起点' : tool === 'waypoint-end' ? '单击设置终点' : '单击设置环绕中心' }}</div>
        <div v-if="statusMessage" class="lap-toast">{{ statusMessage }}</div>
      </main>

      <aside class="lap-inspector">
        <template v-if="selectedCell">
          <div class="lap-panel-head">网格单元详情</div>
          <div class="lap-kv"><span>网格码</span><b>{{ selectedCell.code }}</b></div>
          <div class="lap-kv"><span>层级</span><b>L{{ selectedCell.level }}</b></div>
          <div class="lap-kv"><span>状态</span><b>{{ GRID_STATE_META[selectedCell.state].label }}</b></div>
          <div class="lap-kv"><span>行列号</span><b>{{ selectedCell.row }} / {{ selectedCell.col }}</b></div>
          <div class="lap-kv"><span>经纬范围</span><b>{{ selectedCell.west.toFixed(4) }}~{{ selectedCell.east.toFixed(4) }}</b></div>
          <div class="lap-kv"><span>中心点</span><b>{{ selectedCell.centerLon.toFixed(5) }}, {{ selectedCell.centerLat.toFixed(5) }}</b></div>
          <div class="lap-kv"><span>高度域</span><b>{{ selectedCell.altMin }}~{{ selectedCell.altMax }} m</b></div>
          <div class="lap-kv"><span>风险数值</span><b>{{ selectedCell.value }}</b></div>
          <template v-if="cellRisk">
            <div class="lap-panel-head">风险说明<em>{{ cellRisk.level }}</em></div>
            <p class="lap-note">{{ cellRisk.summary }}</p>
            <div class="lap-kv"><span>风险等级</span><b>{{ cellRisk.level }}</b></div>
            <div class="lap-panel-head">状态评定依据</div>
            <p class="lap-note">{{ cellRisk.stateReason }}</p>
            <div class="lap-panel-head">风险数值成因</div>
            <p class="lap-note">{{ cellRisk.valueReason }}</p>
            <div class="lap-panel-head">风险因素</div>
            <p v-for="factor in cellRisk.factors" :key="factor" class="lap-note">· {{ factor }}</p>
            <div class="lap-panel-head">处置建议</div>
            <p class="lap-note">{{ cellRisk.advice }}</p>
          </template>
        </template>

        <template v-else-if="selectedObstacle">
          <div class="lap-panel-head">建筑障碍详情</div>
          <div class="lap-kv"><span>名称</span><b>{{ selectedObstacle.name }}</b></div>
          <div class="lap-kv"><span>类型</span><b>{{ selectedObstacle.kind === 'tower' ? '高塔' : '建筑' }}</b></div>
          <div class="lap-kv"><span>限高</span><b>{{ selectedObstacle.height }} m</b></div>
          <div class="lap-kv"><span>中心</span><b>{{ selectedObstacle.center.lon.toFixed(5) }}, {{ selectedObstacle.center.lat.toFixed(5) }}</b></div>
        </template>

        <template v-else-if="selectedRoute">
          <div class="lap-panel-head">航线方案评估</div>
          <div class="lap-kv"><span>方案</span><b>{{ selectedRoute.name }}</b></div>
          <div class="lap-kv"><span>类型</span><b>{{ selectedRoute.type === 'waypoint' ? '航点航线' : selectedRoute.type === 'area' ? '面状扫测' : '环绕航线' }}</b></div>
          <div class="lap-kv"><span>航点数量</span><b>{{ selectedRoute.points.length }}</b></div>
          <div class="lap-kv"><span>航程</span><b>{{ (selectedRoute.length / 1000).toFixed(2) }} km</b></div>
          <div class="lap-kv"><span>预计耗时</span><b>{{ (selectedRoute.duration / 60).toFixed(1) }} min</b></div>
          <div class="lap-kv"><span>能耗</span><b>{{ selectedRoute.energy.toFixed(0) }}%</b></div>
          <div class="lap-kv"><span>风险指数</span><b>{{ (selectedRoute.risk * 100).toFixed(0) }}%</b></div>
          <div class="lap-kv"><span>综合评分</span><b>{{ selectedRoute.score.toFixed(0) }}</b></div>
          <div class="lap-panel-head">约束校验</div>
          <p v-for="note in selectedRoute.notes" :key="note" class="lap-note">· {{ note }}</p>
          <button class="lap-action primary" @click="enterFlight">进入模拟飞行</button>
        </template>

        <template v-else-if="selectedDevice">
          <div class="lap-panel-head">设备详情</div>
          <div class="lap-kv"><span>编号</span><b>{{ selectedDevice.no }}</b></div>
          <div class="lap-kv"><span>名称</span><b>{{ selectedDevice.name }}</b></div>
          <div class="lap-kv"><span>机型</span><b>{{ selectedDevice.model }}</b></div>
          <div class="lap-kv"><span>状态</span><b>{{ selectedDevice.status }}</b></div>
          <div class="lap-kv"><span>任务</span><b>{{ selectedDevice.task }}</b></div>
          <div class="lap-kv"><span>位置</span><b>{{ selectedDevice.lon.toFixed(5) }}, {{ selectedDevice.lat.toFixed(5) }}</b></div>
          <div class="lap-kv"><span>高度</span><b>{{ selectedDevice.alt }} m</b></div>
          <div class="lap-kv"><span>速度</span><b>{{ selectedDevice.speed }} km/h</b></div>
          <div class="lap-kv"><span>电量</span><b>{{ selectedDevice.battery.toFixed(0) }}%</b></div>
          <div class="lap-kv"><span>信号强度</span><b>{{ selectedDevice.signal }}%</b></div>
          <div class="lap-kv"><span>温度</span><b>{{ selectedDevice.temperature }} ℃</b></div>
          <div class="lap-kv"><span>更新时间</span><b>{{ selectedDevice.updatedAt.slice(11) }}</b></div>
        </template>

        <template v-else-if="selectedZone">
          <div class="lap-panel-head">空域详情</div>
          <div class="lap-kv"><span>名称</span><b>{{ selectedZone.name }}</b></div>
          <div class="lap-kv"><span>类型</span><b>{{ selectedZone.type === 'forbid' ? '禁飞区' : selectedZone.type === 'restrict' ? '限飞区' : '适飞区' }}</b></div>
          <div class="lap-kv"><span>形状</span><b>{{ selectedZone.shape === 'circle' ? `圆形 r=${selectedZone.radius}m` : `${selectedZone.ring.length} 边形` }}</b></div>
          <div class="lap-kv"><span>高度范围</span><b>{{ selectedZone.altMin }}~{{ selectedZone.altMax }} m</b></div>
          <div class="lap-kv"><span>状态</span><b>{{ selectedZone.active ? '生效中' : '已停用' }}</b></div>
          <p class="lap-note">{{ selectedZone.desc }}</p>
        </template>

        <template v-else>
          <div class="lap-panel-head">运行概览</div>
          <div class="lap-kv"><span>作业区</span><b>{{ AREA_LABEL }}</b></div>
          <div class="lap-kv"><span>网格单元</span><b>{{ gridCells.length }}</b></div>
          <div class="lap-kv"><span>建筑障碍</span><b>{{ obstacles.length }}</b></div>
          <div class="lap-kv"><span>空域区划</span><b>{{ airspaces.length }}</b></div>
          <div class="lap-kv"><span>在线设备</span><b>{{ deviceStat.online }}</b></div>
          <div class="lap-kv"><span>待处置告警</span><b>{{ pendingAlarmCount }}</b></div>
          <div class="lap-kv"><span>航线方案</span><b>{{ routes.length }}</b></div>
          <div class="lap-panel-head">性能与状态</div>
          <div class="lap-kv"><span>视点高度</span><b>{{ (stats.height / 1000).toFixed(1) }} km</b></div>
          <div class="lap-kv"><span>缩放层级</span><b>z{{ stats.zoom.toFixed(1) }}</b></div>
          <div class="lap-kv"><span>渲染帧率</span><b>{{ stats.fps }} FPS</b></div>
          <div class="lap-kv"><span>监控状态</span><b>{{ monitorRunning ? '运行中' : '已暂停' }}</b></div>
        </template>
      </aside>
    </div>

    <footer class="lap-statusbar">
      <span class="lap-status-item">视点高度 <b>{{ (stats.height / 1000).toFixed(2) }} km</b></span>
      <span class="lap-status-item">缩放 <b>z{{ stats.zoom.toFixed(1) }}</b></span>
      <span class="lap-status-item">视点 <b>{{ stats.lon.toFixed(3) }}°, {{ stats.lat.toFixed(3) }}°</b></span>
      <span class="lap-status-item">视域 <b>{{ stats.west.toFixed(2) }}~{{ stats.east.toFixed(2) }}°E</b></span>
      <span class="lap-status-item">网格 <b>{{ gridCells.length }}</b></span>
      <span class="lap-status-item">航线方案 <b>{{ routes.length }}</b></span>
      <span class="lap-status-item">设备在线 <b>{{ deviceStat.online }}/{{ devices.length }}</b></span>
      <span class="lap-status-item">待处置告警 <b class="danger">{{ pendingAlarmCount }}</b></span>
      <span class="lap-status-item">FPS <b>{{ stats.fps }}</b></span>
      <label class="lap-status-item lap-depth">
        <input v-model="depthTest" type="checkbox" class="lap-toggle" @change="setDepthTest" />
        深度检测
      </label>
      <span class="lap-status-item push">
        <button class="lap-mini" @click="locateArea">定位作业区</button>
        <button class="lap-mini" @click="resetView">重置</button>
      </span>
    </footer>

    <div v-if="roadmapOpen" class="lap-roadmap">
      <div class="lap-roadmap-head">
        <span>{{ ROADMAP_TITLE }}</span>
        <button class="lap-roadmap-close" @click="roadmapOpen = false">关闭</button>
      </div>
      <div class="lap-roadmap-body">
        <p class="lap-roadmap-intro">{{ ROADMAP_INTRO }}</p>
        <div class="lap-tags"><span v-for="tag in ROADMAP_TAGS" :key="tag">{{ tag }}</span></div>
        <h4>数据与渲染管线</h4>
        <div class="lap-pipeline">
          <template v-for="(step, index) in ROADMAP_PIPELINE" :key="step.title">
            <div class="lap-pipe"><b>{{ step.title }}</b><span>{{ step.detail }}</span></div>
            <span v-if="index < ROADMAP_PIPELINE.length - 1" class="lap-arrow">→</span>
          </template>
        </div>
        <h4>技术架构分层</h4>
        <div class="lap-cards">
          <div v-for="layer in ROADMAP_LAYERS" :key="layer.name" class="lap-card">
            <div class="lap-card-title">{{ layer.name }}<em>{{ layer.en }}</em></div>
            <p>{{ layer.desc }}</p>
            <ul><li v-for="item in layer.items" :key="item">{{ item }}</li></ul>
          </div>
        </div>
        <h4>关键技术实现要点</h4>
        <div class="lap-cards">
          <div v-for="mile in ROADMAP_MILESTONES" :key="mile.phase" class="lap-card">
            <div class="lap-card-title">{{ mile.phase }}</div>
            <p>{{ mile.title }}</p>
            <p class="lap-muted">{{ mile.detail }}</p>
          </div>
        </div>
        <h4>核心数据结构</h4>
        <div class="lap-table wide">
          <div class="lap-table-row head"><span>表</span><span>关键字段</span><span>说明</span></div>
          <div v-for="row in ROADMAP_SCHEMA" :key="row.table" class="lap-table-row">
            <span>{{ row.table }}</span><span>{{ row.fields }}</span><span>{{ row.note }}</span>
          </div>
        </div>
        <h4>系统功能模块</h4>
        <div class="lap-cards">
          <div v-for="module in ROADMAP_MODULES" :key="module.name" class="lap-card">
            <div class="lap-card-title">{{ module.name }}<em>{{ module.kind }}</em></div>
            <p>{{ module.desc }}</p>
          </div>
        </div>
        <p class="lap-muted">{{ DRONE_CREDIT }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lap-system {
  --lap-bg: #06121f;
  --lap-panel: #0b1d30;
  --lap-panel-2: #0f2740;
  --lap-line: rgba(125, 178, 224, 0.16);
  --lap-text: #dceafa;
  --lap-muted: #86a3c0;
  --lap-accent: #38bdf8;
  --lap-accent-2: #22d3ee;
  --lap-warn: #fbbf24;
  --lap-danger: #f87171;
  display: grid;
  grid-template-rows: 58px minmax(0, 1fr) 44px;
  width: 100%;
  height: 100%;
  min-height: 460px;
  overflow: hidden;
  background: var(--lap-bg);
  color: var(--lap-text);
  position: relative;
  font-size: 13px;
}
.lap-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(56, 189, 248, 0.26);
  background: linear-gradient(180deg, #08202e, #0a1524);
}
.lap-identity { display: flex; align-items: center; gap: 10px; min-width: 0; }
.lap-emblem {
  display: grid; place-items: center; flex: 0 0 auto; width: 34px; height: 34px;
  border-radius: 8px; background: linear-gradient(145deg, #38bdf8, #0e7490);
  color: #04222a; font-size: 13px; font-weight: 800; letter-spacing: 0.04em;
}
.lap-identity-text { min-width: 0; }
.lap-system-name { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: 0.02em; }
.lap-system-meta { margin: 2px 0 0; font-size: 11px; color: var(--lap-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lap-metrics { display: flex; gap: 8px; flex-wrap: wrap; }
.lap-chip {
  padding: 4px 10px; border: 1px solid var(--lap-line); border-radius: 999px;
  font-size: 11px; color: var(--lap-muted); white-space: nowrap;
}
.lap-chip b { color: var(--lap-text); }
.lap-chip b.warn, .warn { color: var(--lap-warn); }
.danger { color: var(--lap-danger); }
.lap-topbar-right { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
.lap-clock { font-variant-numeric: tabular-nums; color: #9fd7f5; font-size: 12px; }
.lap-user { font-size: 11.5px; color: var(--lap-muted); }
.lap-tool {
  height: 30px; padding: 0 13px; border: 1px solid rgba(157, 188, 224, 0.26); border-radius: 6px;
  background: rgba(20, 32, 50, 0.85); color: #cfe0f2; font-size: 12px; cursor: pointer;
}
.lap-tool:hover { border-color: var(--lap-accent); color: #fff; }
.lap-tool.accent { border-color: transparent; background: linear-gradient(145deg, #38bdf8, #0e7490); color: #04222a; font-weight: 600; }
.lap-main { display: grid; grid-template-columns: 288px minmax(0, 1fr) 300px; min-height: 0; }
.lap-nav {
  display: flex; align-items: center; gap: 2px; flex: 1 1 auto; min-width: 0;
  overflow-x: auto; justify-content: center; padding: 0 6px;
}
.lap-nav-item {
  display: flex; flex-direction: row; align-items: baseline; gap: 5px;
  padding: 6px 11px; border: 1px solid transparent; border-radius: 8px;
  background: transparent; color: var(--lap-muted); cursor: pointer; font-size: 12px;
  white-space: nowrap; flex: 0 0 auto;
}
.lap-nav-item b { font-weight: 600; }
.lap-nav-item em { font-style: normal; font-size: 9px; letter-spacing: 0.04em; opacity: 0.7; }
.lap-nav-item:hover { background: rgba(56, 189, 248, 0.08); color: #cfe0f2; }
.lap-nav-item.active { background: linear-gradient(145deg, rgba(56,189,248,.22), rgba(14,116,144,.28)); border-color: rgba(56,189,248,.5); color: #fff; }
.lap-side, .lap-inspector {
  display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow-y: auto; padding: 12px;
  background: var(--lap-panel);
}
.lap-side { border-right: 1px solid var(--lap-line); }
.lap-inspector { border-left: 1px solid var(--lap-line); }
.lap-panel-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-top: 4px; font-size: 11.5px; font-weight: 700; letter-spacing: 0.06em; color: #8fb6de;
}
.lap-panel-head em { font-style: normal; font-weight: 400; font-size: 10px; color: #7f93a8; }
.lap-field { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--lap-muted); }
.lap-field > span { flex: 0 0 62px; }
.lap-field > input[type='range'] { flex: 1; accent-color: var(--lap-accent); }
.lap-field > b { flex: 0 0 auto; color: var(--lap-text); font-size: 11.5px; }
.lap-select, .lap-number {
  flex: 1; min-width: 0; height: 28px; padding: 0 6px; border: 1px solid var(--lap-line);
  border-radius: 6px; background: rgba(8, 24, 40, 0.9); color: var(--lap-text); font-size: 12px;
}
.lap-number { flex: 1 1 0; }
.lap-toggle { width: 16px; height: 16px; accent-color: var(--lap-accent); }
.lap-hint { margin: 2px 0; font-size: 11.5px; color: var(--lap-muted); line-height: 1.6; }
.lap-layer, .lap-device, .lap-plan, .lap-zone-main {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 9px;
  border: 1px solid var(--lap-line); border-radius: 7px; background: rgba(8, 24, 40, 0.55);
  color: var(--lap-text); font-size: 12px; cursor: pointer; text-align: left;
}
.lap-layer { justify-content: flex-start; }
.lap-layer span:nth-child(2), .lap-device span:nth-child(2) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lap-layer.on { border-color: rgba(56, 189, 248, 0.55); background: rgba(56, 189, 248, 0.12); }
.lap-swatch { width: 10px; height: 10px; border-radius: 3px; flex: 0 0 auto; }
.lap-switch { width: 26px; height: 14px; border-radius: 999px; background: rgba(120, 150, 180, 0.35); position: relative; flex: 0 0 auto; }
.lap-switch i { position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%; background: #cbd5e1; transition: all .15s; }
.lap-layer.on .lap-switch { background: rgba(56, 189, 248, 0.6); }
.lap-layer.on .lap-switch i { left: 14px; background: #fff; }
.lap-stats { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11.5px; color: var(--lap-muted); margin-top: 4px; }
.lap-stats b { color: var(--lap-text); }
.lap-seg { display: flex; gap: 4px; }
.lap-seg button {
  flex: 1; height: 28px; border: 1px solid var(--lap-line); border-radius: 6px;
  background: rgba(8, 24, 40, 0.7); color: var(--lap-muted); font-size: 11.5px; cursor: pointer;
}
.lap-seg button.active { border-color: var(--lap-accent); color: #fff; background: rgba(56, 189, 248, 0.16); }
.lap-seg.small button { font-size: 11px; }
.lap-action {
  height: 30px; padding: 0 12px; border: 1px solid var(--lap-line); border-radius: 7px;
  background: rgba(8, 24, 40, 0.7); color: #cfe0f2; font-size: 12px; cursor: pointer;
}
.lap-action:hover { border-color: var(--lap-accent); color: #fff; }
.lap-action.active { border-color: var(--lap-accent-2); color: var(--lap-accent-2); }
.lap-action.primary { border-color: transparent; background: linear-gradient(145deg, #38bdf8, #0e7490); color: #04222a; font-weight: 600; }
.lap-action:disabled { opacity: 0.5; cursor: default; }
.lap-row { display: flex; gap: 6px; }
.lap-row .lap-action { flex: 1; }
.lap-plan { flex-direction: column; align-items: flex-start; gap: 2px; }
.lap-plan.active { border-color: var(--lap-accent); background: rgba(56, 189, 248, 0.14); }
.lap-plan-name { font-weight: 600; }
.lap-plan-meta { font-size: 10.5px; color: var(--lap-muted); }
.lap-kv { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--lap-muted); border-bottom: 1px dashed rgba(125,178,224,.12); padding: 3px 0; }
.lap-kv b { color: var(--lap-text); font-weight: 500; text-align: right; word-break: break-all; }
.lap-note { margin: 2px 0; font-size: 11.5px; color: var(--lap-muted); line-height: 1.6; }
.lap-mini {
  padding: 2px 8px; border: 1px solid var(--lap-line); border-radius: 5px;
  background: rgba(8, 24, 40, 0.8); color: #bcd2e6; font-size: 10.5px; cursor: pointer;
}
.lap-mini:hover { border-color: var(--lap-accent); color: #fff; }
.lap-alarm-list { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; }
.lap-alarm { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 6px; align-items: center; padding: 6px 7px; border: 1px solid var(--lap-line); border-radius: 7px; background: rgba(8,24,40,.5); }
.lap-alarm-tag { grid-row: span 2; padding: 3px 6px; border-radius: 5px; color: #06121f; font-size: 10.5px; font-weight: 700; }
.lap-alarm-text { font-size: 11px; color: var(--lap-text); }
.lap-alarm-time { font-size: 10px; color: var(--lap-muted); }
.lap-alarm .lap-mini { grid-column: auto; }
.lap-device { position: relative; }
.lap-device-dot { width: 8px; height: 8px; border-radius: 50%; background: #38bdf8; }
.lap-device.online .lap-device-dot { background: #38bdf8; box-shadow: 0 0 6px #38bdf8; }
.lap-device.offline .lap-device-dot { background: #94a3b8; }
.lap-device.fault .lap-device-dot { background: #ef4444; box-shadow: 0 0 6px #ef4444; }
.lap-zone { border: 1px solid var(--lap-line); border-radius: 7px; overflow: hidden; }
.lap-zone-main { border: 0; border-radius: 0; }
.lap-zone-badge { padding: 2px 7px; border-radius: 5px; font-size: 10.5px; font-weight: 700; color: #06121f; }
.lap-zone.forbid .lap-zone-badge { background: #e74c3c; color: #fff; }
.lap-zone.restrict .lap-zone-badge { background: #f1c40f; }
.lap-zone.free .lap-zone-badge { background: #2ecc71; }
.lap-zone-meta { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; font-size: 10.5px; color: var(--lap-muted); background: rgba(8,24,40,.5); }
.lap-table { display: flex; flex-direction: column; border: 1px solid var(--lap-line); border-radius: 8px; overflow: hidden; }
.lap-table-row { display: grid; grid-template-columns: 0.8fr 1fr 0.7fr 0.7fr; gap: 6px; padding: 5px 8px; font-size: 10.5px; color: var(--lap-muted); border-top: 1px solid rgba(125,178,224,.1); }
.lap-table-row.head { background: rgba(31,78,121,.4); color: #cfe0f2; font-weight: 600; border-top: 0; }
.lap-table.wide .lap-table-row { grid-template-columns: 0.8fr 2fr 1.2fr; font-size: 12px; }
.lap-report { display: flex; flex-direction: column; gap: 6px; }
.lap-bar { display: grid; grid-template-columns: 80px 1fr 40px; align-items: center; gap: 8px; font-size: 11px; color: var(--lap-muted); }
.lap-bar i { height: 8px; border-radius: 4px; background: linear-gradient(90deg, #38bdf8, #22d3ee); }
.lap-bar b { color: var(--lap-text); text-align: right; }
.lap-params { display: flex; flex-direction: column; }
.lap-stage { position: relative; min-width: 0; min-height: 0; overflow: hidden; }
.lap-cesium { position: absolute; inset: 0; }
.lap-stage-title {
  position: absolute; left: 14px; top: 12px; z-index: 4; padding: 6px 12px;
  border: 1px solid rgba(56,189,248,.3); border-radius: 8px; background: rgba(6,18,31,.72);
  backdrop-filter: blur(6px); font-size: 11.5px; color: var(--lap-muted);
}
.lap-stage-title b { display: block; color: #e0f2fe; font-size: 13px; }
.lap-layers {
  position: absolute; right: 14px; top: 12px; z-index: 4; width: 154px;
  max-height: 58%; overflow-y: auto;
  padding: 6px 8px; border: 1px solid var(--lap-line); border-radius: 8px;
  background: rgba(6,18,31,.78); backdrop-filter: blur(6px);
  display: flex; flex-direction: column; gap: 3px;
}
.lap-layers .lap-layer { padding: 4px 7px; font-size: 11px; gap: 6px; }
.lap-layers .lap-switch { width: 24px; height: 13px; }
.lap-layers .lap-switch i { width: 9px; height: 9px; }
.lap-layers .lap-layer.on .lap-switch i { left: 13px; }
.lap-legend {
  position: absolute; left: 14px; bottom: 18px; z-index: 4; width: 196px;
  max-height: 42%; overflow-y: auto;
  padding: 6px 8px; border: 1px solid var(--lap-line); border-radius: 8px;
  background: rgba(6,18,31,.74); backdrop-filter: blur(6px);
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 10px; row-gap: 3px;
}
.lap-legend-head { grid-column: 1 / -1; font-size: 10.5px; font-weight: 700; color: #8fb6de; margin-bottom: 3px; }
.lap-legend-row {
  display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--lap-text);
  margin: 0; min-width: 0; white-space: nowrap;
}
.lap-legend .lap-swatch { width: 9px; height: 9px; flex: 0 0 auto; }
.lap-drawing {
  position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 4;
  padding: 6px 14px; border-radius: 999px; background: rgba(244,114,182,.18);
  border: 1px solid rgba(244,114,182,.6); color: #fbcfe8; font-size: 12px;
}
.lap-toast {
  position: absolute; left: 50%; top: 14px; transform: translateX(-50%); z-index: 5;
  max-width: 62%; padding: 7px 16px; border-radius: 999px; background: rgba(14,116,144,.85);
  border: 1px solid rgba(56,189,248,.5); color: #e0f2fe; font-size: 12px; text-align: center;
}
.lap-statusbar {
  display: flex; align-items: center; gap: 16px; padding: 0 16px; overflow-x: auto;
  border-top: 1px solid var(--lap-line); background: #08202e; font-size: 11.5px; color: var(--lap-muted);
  white-space: nowrap;
}
.lap-status-item b { color: var(--lap-text); }
.lap-depth { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
.lap-status-item.push { margin-left: auto; display: flex; gap: 6px; }
.lap-roadmap {
  position: absolute; inset: 0; z-index: 20; display: flex; flex-direction: column;
  background: rgba(4, 12, 22, 0.94);
}
.lap-roadmap-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 18px; border-bottom: 1px solid var(--lap-line); font-size: 14px; font-weight: 700; color: #e0f2fe;
}
.lap-roadmap-close {
  padding: 5px 14px; border: 1px solid var(--lap-line); border-radius: 7px;
  background: rgba(8,24,40,.8); color: #cfe0f2; cursor: pointer; font-size: 12px;
}
.lap-roadmap-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 22px 30px; max-width: 1100px; margin: 0 auto; width: 100%; }
.lap-roadmap-intro { color: var(--lap-muted); line-height: 1.8; }
.lap-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
.lap-tags span { padding: 3px 10px; border-radius: 999px; background: rgba(56,189,248,.14); color: #7dd3fc; font-size: 11px; }
.lap-roadmap-body h4 { margin: 20px 0 10px; font-size: 13px; color: #8fb6de; letter-spacing: 0.06em; }
.lap-pipeline { display: flex; flex-wrap: wrap; align-items: stretch; gap: 6px; }
.lap-pipe { flex: 1 1 150px; padding: 8px 10px; border: 1px solid var(--lap-line); border-radius: 8px; background: rgba(8,24,40,.6); }
.lap-pipe b { display: block; color: #e0f2fe; font-size: 12px; }
.lap-pipe span, .lap-arrow { color: var(--lap-muted); font-size: 11px; }
.lap-arrow { align-self: center; }
.lap-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.lap-card { padding: 10px 12px; border: 1px solid var(--lap-line); border-radius: 8px; background: rgba(8,24,40,.6); }
.lap-card-title { color: #e0f2fe; font-size: 12.5px; font-weight: 700; }
.lap-card-title em { margin-left: 6px; font-style: normal; font-size: 10px; color: #6d8aa6; }
.lap-card p { margin: 5px 0; font-size: 11.5px; color: var(--lap-muted); line-height: 1.6; }
.lap-card ul { margin: 4px 0 0 14px; padding: 0; }
.lap-card li { font-size: 11px; color: var(--lap-muted); line-height: 1.7; }
.lap-muted { color: #6d8aa6 !important; }
.lap-mod { padding: 6px 0; border-bottom: 1px dashed rgba(125,178,224,.14); }
.lap-mod b { color: #e0f2fe; font-size: 11.5px; }
.lap-mod span { margin-left: 6px; font-size: 10px; color: var(--lap-accent); }
.lap-mod p { margin: 3px 0 0; font-size: 11px; color: var(--lap-muted); line-height: 1.6; }
@media (max-width: 1280px) {
  .lap-main { grid-template-columns: 78px 250px minmax(0, 1fr) 262px; }
}
@media (max-width: 980px) {
  .lap-metrics { display: none; }
  .lap-system-meta { display: none; }
}
</style>
