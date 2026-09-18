<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, triggerRef, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  ClassificationType,
  Color,
  ColorGeometryInstanceAttribute,
  ConstantProperty,
  GeometryInstance,
  GroundPrimitive,
  HeightReference,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  PolylineArrowMaterialProperty,
  Rectangle,
  sampleTerrainMostDetailed,
  type Entity,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, loadWorldTerrain, type SceneCallbacks } from '../../lib/cesium-scene'
import InfoTip from '../../components/InfoTip.vue'
import {
  DEFAULT_SIM_PLAN,
  buildScenario,
  recomputeLevels,
  simulateNetwork,
  type SimulationResult
} from '../slope-gnss-warning-lib/simulate'
import {
  computeGridExtent,
  computeZoneSnapshot,
  gridSpecFromBounds,
  makeGridSpec,
  type GridSpec,
  type StationState
} from '../slope-gnss-warning-lib/zones'
import { makeProjector, type Projector } from '../slope-gnss-warning-lib/projection'
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_ZONE_CONFIG,
  SCENARIO_PRESETS,
  WARNING_LEVEL_COLOR,
  WARNING_LEVEL_TEXT,
  WarningLevel,
  type DemGrid,
  type Ring,
  type SlopeProfile,
  type ThresholdConfig,
  type WarningLevelValue,
  type ZoneConfig,
  type ZoneSnapshot
} from '../slope-gnss-warning-lib/types'
import {
  buildReportBodyHtml,
  buildWordBlob,
  downloadBlob,
  nowStamp,
  renderReportPdf,
  type SlopeReportModel
} from '../slope-gnss-warning-lib/report'

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, CanvasRenderer])

const container = ref<HTMLElement | null>(null)
const chartContainer = ref<HTMLElement | null>(null)
const reportEl = ref<HTMLElement | null>(null)
const statusMessage = ref('正在初始化三维场景…')
const sceneReady = ref(false)
const computing = ref(false)
const reportOpen = ref(false)
const reportHtml = ref('')
const exporting = ref(false)
const selectedStationId = ref('')
const profile = ref<SlopeProfile>(JSON.parse(JSON.stringify(SCENARIO_PRESETS[0].profile)))

const ui = reactive({
  presetId: SCENARIO_PRESETS[0].id as string,
  index: 0,
  playing: false,
  speed: 6,
  vectorScale: 0.05,
  showCore: true,
  showKey: true,
  showInfluence: true,
  showStations: true,
  showVectors: true,
  showBoundary: true,
  thresholds: JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS)) as ThresholdConfig,
  zoneConfig: JSON.parse(JSON.stringify(DEFAULT_ZONE_CONFIG)) as ZoneConfig
})

const sim = shallowRef<SimulationResult>()
const dem = shallowRef<DemGrid>()
const currentSnapshot = shallowRef<ZoneSnapshot>()
const boundary = shallowRef<[number, number][]>([])

let viewer: Viewer | undefined
let projector: Projector | undefined
let zoneSpec: GridSpec | undefined
let loadToken = 0
let timer: number | undefined
let debounce: number | undefined
let chart: echarts.ECharts | undefined
const snapshots = new Map<number, ZoneSnapshot>()
const stationEntities = new Map<string, { point: Entity; vector: Entity }>()
let boundaryEntity: Entity | undefined
let baseEntity: Entity | undefined
let zonePrimitives: GroundPrimitive[] = []
let zoneOutlineEntities: Entity[] = []

const totalSteps = computed(() => sim.value?.times.length ?? 0)

const currentTimeText = computed(() => {
  const result = sim.value
  if (!result || totalSteps.value === 0) return '--'
  return formatTime(result.times[Math.min(ui.index, totalSteps.value - 1)])
})

const currentObs = computed(() => {
  const result = sim.value
  if (!result) return []
  const index = Math.min(ui.index, result.times.length - 1)
  return result.stations.map((station) => ({
    station,
    obs: result.observations[station.id][index]
  }))
})

const activeStation = computed(() => {
  const result = sim.value
  if (!result || result.stations.length === 0) return undefined
  const found = selectedStationId.value ? result.stations.find((s) => s.id === selectedStationId.value) : undefined
  if (found && found.id !== 'BASE') return found
  const ranked = currentObs.value.filter((item) => item.station.id !== 'BASE')
  ranked.sort((a, b) => b.obs.level - a.obs.level || b.obs.v - a.obs.v)
  return ranked[0]?.station
})

const networkLevelText = computed(() =>
  currentSnapshot.value ? WARNING_LEVEL_TEXT[currentSnapshot.value.networkLevel] : '--'
)

const areaText = computed(() => {
  const stats = currentSnapshot.value?.stats
  if (!stats) return '核心 -- / 重点 -- / 影响 --'
  return `核心 ${(stats.coreAreaM2 / 10000).toFixed(2)} / 重点 ${(stats.keyAreaM2 / 10000).toFixed(2)} / 影响 ${(
    stats.influenceAreaM2 / 10000
  ).toFixed(2)} 万m²`
})

function formatTime(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`
}

function formatShort(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:00`
}

function levelColor(level: WarningLevelValue): Color {
  return Color.fromCssColorString(WARNING_LEVEL_COLOR[level] ?? '#ffffff')
}

/* ------------------------------ 场景构建 ------------------------------ */

function syntheticHeight(x: number, y: number): number {
  const toeY = -420
  const base = 620
  const slope = 0.32
  const ground = y > toeY ? base + (y - toeY) * slope : base
  return ground + 16 * Math.sin(x / 140) + 9 * Math.cos(y / 240) - 12 * Math.cos(x / 260)
}

function syntheticDem(extent: GridSpec['extent'], projectorInstance: Projector, nx: number, ny: number): DemGrid {
  const z: number[] = new Array(nx * ny).fill(0)
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const lon = extent.west + ((extent.east - extent.west) * i) / (nx - 1)
      const lat = extent.south + ((extent.north - extent.south) * j) / (ny - 1)
      const [x, y] = projectorInstance.toLocal(lon, lat)
      z[j * nx + i] = syntheticHeight(x, y)
    }
  }
  const [xMin, yMin] = projectorInstance.toLocal(extent.west, extent.south)
  const [xMax, yMax] = projectorInstance.toLocal(extent.east, extent.north)
  return {
    ...extent,
    nx,
    ny,
    dx: Math.abs(xMax - xMin) / (nx - 1),
    dy: Math.abs(yMax - yMin) / (ny - 1),
    z,
    synthetic: true
  }
}

async function buildDem(
  source: Viewer,
  extent: GridSpec['extent'],
  projectorInstance: Projector,
  nx: number,
  ny: number
): Promise<DemGrid> {
  const positions: Cartographic[] = []
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const lon = extent.west + ((extent.east - extent.west) * i) / (nx - 1)
      const lat = extent.south + ((extent.north - extent.south) * j) / (ny - 1)
      positions.push(Cartographic.fromDegrees(lon, lat))
    }
  }

  let heights: number[] = []
  try {
    const samples = await sampleTerrainMostDetailed(source.terrainProvider, positions)
    heights = samples.map((sample) => sample.height)
  } catch {
    heights = []
  }

  const finite = heights.filter((value) => Number.isFinite(value))
  const minHeight = finite.length > 0 ? Math.min(...finite) : 0
  const maxHeight = finite.length > 0 ? Math.max(...finite) : 0
  const usable = finite.length >= positions.length * 0.55 && maxHeight - minHeight >= 8
  if (!usable) return syntheticDem(extent, projectorInstance, nx, ny)

  const [xMin, yMin] = projectorInstance.toLocal(extent.west, extent.south)
  const [xMax, yMax] = projectorInstance.toLocal(extent.east, extent.north)
  return {
    ...extent,
    nx,
    ny,
    dx: Math.abs(xMax - xMin) / (nx - 1),
    dy: Math.abs(yMax - yMin) / (ny - 1),
    z: heights.map((value) => (Number.isFinite(value) ? value : minHeight)),
    synthetic: false
  }
}

function rebuildZoneSpec(): void {
  if (!projector || boundary.value.length === 0) return
  zoneSpec = makeGridSpec(computeGridExtent(boundary.value, 320, projector), projector, ui.zoneConfig)
}

async function loadScenario(presetId: string): Promise<void> {
  const preset = SCENARIO_PRESETS.find((item) => item.id === presetId) ?? SCENARIO_PRESETS[0]
  const token = ++loadToken
  computing.value = true
  statusMessage.value = `正在构建 ${preset.label} 监测网并采样地形…`
  ui.playing = false
  stopTimer()

  profile.value = JSON.parse(JSON.stringify(preset.profile))
  const scenario = buildScenario(preset.lon, preset.lat, DEFAULT_SIM_PLAN.seed)
  boundary.value = scenario.boundary
  const localProjector = makeProjector(preset.lon, preset.lat)
  projector = localProjector

  const demExtent = computeGridExtent(scenario.boundary, 1500, localProjector)
  let demGrid = syntheticDem(demExtent, localProjector, 44, 48)
  const source = viewer
  if (source && !source.isDestroyed()) {
    try {
      demGrid = await buildDem(source, demExtent, localProjector, 44, 48)
    } catch {
      /* 保留合成地形 */
    }
  }
  if (token !== loadToken) return

  dem.value = demGrid
  const result = simulateNetwork(DEFAULT_SIM_PLAN, scenario.stations, ui.thresholds)
  sim.value = result
  snapshots.clear()
  rebuildZoneSpec()

  ui.index = 0
  selectedStationId.value = ''
  rebuildBoundary()
  rebuildStations()
  renderCurrent()
  focusCamera()
  computing.value = false
  statusMessage.value = demGrid.synthetic
    ? '地形采样不可用，已采用合成地形（分区推演仍可运行）。'
    : '场景已就绪：点击「开始回放」查看位移演进与三级影响区。'
  window.setTimeout(() => {
    if (!computing.value) statusMessage.value = ''
  }, 4200)
}

function focusCamera(): void {
  if (!viewer || viewer.isDestroyed() || boundary.value.length === 0 || !projector) return
  const extent = computeGridExtent(boundary.value, 900, projector)
  viewer.camera.flyTo({
    destination: Rectangle.fromDegrees(extent.west, extent.south, extent.east, extent.north),
    duration: 1.4
  })
}

/** 真实地形就绪后重新采样高程，并用真实地形刷新当前分区。 */
async function refreshDem(): Promise<void> {
  const source = viewer
  const currentSim = sim.value
  const localProjector = projector
  if (!source || source.isDestroyed() || !localProjector || boundary.value.length === 0 || !currentSim) return
  if (dem.value && !dem.value.synthetic) return
  const extent = computeGridExtent(boundary.value, 1500, localProjector)
  let grid: DemGrid
  try {
    grid = await buildDem(source, extent, localProjector, 44, 48)
  } catch {
    return
  }
  if (grid.synthetic || sim.value !== currentSim) return
  dem.value = grid
  snapshots.clear()
  renderCurrent()
  statusMessage.value = '已接入 Cesium World Terrain 真实高程，三级影响区已刷新。'
  window.setTimeout(() => {
    if (!computing.value) statusMessage.value = ''
  }, 4200)
}

/* ------------------------------ 实体更新 ------------------------------ */

function rebuildBoundary(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (boundaryEntity) {
    viewer.entities.remove(boundaryEntity)
    boundaryEntity = undefined
  }
  if (boundary.value.length < 2) return
  boundaryEntity = viewer.entities.add({
    polyline: {
      positions: Cartesian3.fromDegreesArray(boundary.value.flat()),
      clampToGround: true,
      width: 2.5,
      material: Color.fromCssColorString('#7ef0ff').withAlpha(0.9),
      show: ui.showBoundary
    }
  })
}

function buildZoneInstances(polys: Ring[][], color: Color): GeometryInstance[] {
  const instances: GeometryInstance[] = []
  for (const poly of polys) {
    const outer = poly[0]
    if (!outer || outer.length < 4) continue
    const holes = poly
      .slice(1)
      .filter((ring) => ring.length >= 4)
      .map((ring) => new PolygonHierarchy(Cartesian3.fromDegreesArray(ring.flat())))
    const hierarchy = new PolygonHierarchy(Cartesian3.fromDegreesArray(outer.flat()), holes)
    instances.push(
      new GeometryInstance({
        geometry: new PolygonGeometry({
          polygonHierarchy: hierarchy,
          vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT
        }),
        attributes: { color: ColorGeometryInstanceAttribute.fromColor(color) }
      })
    )
  }
  return instances
}

function rebuildZones(snapshot: ZoneSnapshot): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const primitive of zonePrimitives) viewer.scene.primitives.remove(primitive)
  zonePrimitives = []
  for (const entity of zoneOutlineEntities) viewer.entities.remove(entity)
  zoneOutlineEntities = []

  const layers: { polys: Ring[][] | null; color: Color; visible: boolean }[] = [
    { polys: snapshot.influence, color: Color.fromCssColorString('#ffd21e').withAlpha(0.16), visible: ui.showInfluence },
    { polys: snapshot.key, color: Color.fromCssColorString('#ff7f00').withAlpha(0.26), visible: ui.showKey },
    { polys: snapshot.core, color: Color.fromCssColorString('#ff2020').withAlpha(0.36), visible: ui.showCore }
  ]

  for (const layer of layers) {
    if (!layer.visible || !layer.polys || layer.polys.length === 0) continue
    const instances = buildZoneInstances(layer.polys, layer.color)
    if (instances.length === 0) continue
    const primitive = new GroundPrimitive({
      geometryInstances: instances,
      appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
      classificationType: ClassificationType.BOTH,
      asynchronous: false
    })
    viewer.scene.primitives.add(primitive)
    zonePrimitives.push(primitive)

    for (const poly of layer.polys) {
      const outer = poly[0]
      if (!outer || outer.length < 2) continue
      zoneOutlineEntities.push(
        viewer.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArray(outer.flat()),
            clampToGround: true,
            width: 2,
            material: layer.color.withAlpha(0.95)
          }
        })
      )
    }
  }
}

function rebuildStations(): void {
  if (!viewer || viewer.isDestroyed() || !sim.value) return
  for (const entry of stationEntities.values()) {
    viewer.entities.remove(entry.point)
    viewer.entities.remove(entry.vector)
  }
  stationEntities.clear()
  if (baseEntity) {
    viewer.entities.remove(baseEntity)
    baseEntity = undefined
  }

  const base = sim.value.stations.find((station) => station.id === 'BASE')
  if (base) {
    baseEntity = viewer.entities.add({
      position: Cartesian3.fromDegrees(base.lon, base.lat),
      point: {
        pixelSize: 10,
        color: Color.fromCssColorString('#ffffff'),
        outlineColor: Color.fromCssColorString('#1b5faa'),
        outlineWidth: 3,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: '基准站',
        font: '600 12px "Microsoft YaHei", sans-serif',
        fillColor: Color.fromCssColorString('#bfe8ff'),
        pixelOffset: new Cartesian2(0, -16),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
  }

  for (const station of sim.value.stations) {
    if (station.id === 'BASE') continue
    const point = viewer.entities.add({
      position: Cartesian3.fromDegrees(station.lon, station.lat),
      point: {
        pixelSize: 13,
        color: Color.WHITE,
        outlineColor: Color.fromCssColorString('#0b1c2c'),
        outlineWidth: 2,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: station.id,
        font: '600 12px "Microsoft YaHei", sans-serif',
        fillColor: Color.WHITE,
        outlineColor: Color.fromCssColorString('#000000'),
        outlineWidth: 2,
        style: 2,
        pixelOffset: new Cartesian2(0, -18),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: ui.showStations
      }
    })
    const vector = viewer.entities.add({
      polyline: {
        positions: [],
        width: 3,
        clampToGround: true,
        material: new PolylineArrowMaterialProperty(Color.WHITE)
      }
    })
    stationEntities.set(station.id, { point, vector })
  }
}

function updateStations(index: number): void {
  const result = sim.value
  if (!result || !viewer || viewer.isDestroyed() || !projector) return
  for (const station of result.stations) {
    if (station.id === 'BASE') continue
    const entry = stationEntities.get(station.id)
    if (!entry) continue
    const obs = result.observations[station.id][index]
    const color = obs.qualityOk ? levelColor(obs.level) : Color.fromCssColorString('#8a97a6')
    entry.point.point!.color = new ConstantProperty(color)
    entry.point.point!.pixelSize = new ConstantProperty(obs.level >= WarningLevel.Orange ? 16 : 13)
    entry.point.label!.show = new ConstantProperty(ui.showStations)
    entry.vector.show = Boolean(ui.showVectors)

    if (!ui.showVectors || !obs.qualityOk) {
      entry.vector.polyline!.positions = new ConstantProperty([])
      continue
    }
    const [x0, y0] = projector.toLocal(station.lon, station.lat)
    const scale = ui.vectorScale
    const [lon1, lat1] = projector.toLngLat(x0 + obs.dE * scale, y0 + obs.dN * scale)
    entry.vector.polyline!.positions = new ConstantProperty([
      Cartesian3.fromDegrees(station.lon, station.lat),
      Cartesian3.fromDegrees(lon1, lat1)
    ])
    entry.vector.polyline!.material = new PolylineArrowMaterialProperty(levelColor(obs.level))
  }

  if (boundaryEntity) boundaryEntity.show = ui.showBoundary
}

/* ------------------------------ 快照与图表 ------------------------------ */

function buildStationStates(index: number): StationState[] {
  const result = sim.value
  if (!result) return []
  return result.stations.map((station) => {
    const obs = result.observations[station.id][index]
    return {
      id: station.id,
      lon: station.lon,
      lat: station.lat,
      v: obs.v,
      level: obs.level,
      qualityOk: obs.qualityOk,
      azimuth: obs.azimuth
    }
  })
}

function getSnapshot(index: number): ZoneSnapshot | undefined {
  const result = sim.value
  if (!result || !dem.value || !zoneSpec || !projector) return undefined
  const cached = snapshots.get(index)
  if (cached) return cached
  const snapshot = computeZoneSnapshot({
    index,
    time: result.times[index],
    stations: buildStationStates(index),
    boundary: boundary.value,
    zoneSpec,
    dem: dem.value,
    thickness: profile.value.thickness,
    zoneConfig: ui.zoneConfig,
    thresholdConfig: ui.thresholds,
    slopeProfile: profile.value
  })
  snapshots.set(index, snapshot)
  return snapshot
}

function renderCurrent(): void {
  const result = sim.value
  if (!result) return
  const index = Math.min(ui.index, result.times.length - 1)
  ui.index = index
  const snapshot = getSnapshot(index)
  if (!snapshot) return
  currentSnapshot.value = snapshot
  rebuildZones(snapshot)
  updateStations(index)
  updateChart(index)
}

function buildChartOption(index: number): echarts.EChartsCoreOption {
  const result = sim.value
  const station = activeStation.value
  if (!result || !station) return {}
  const series = result.observations[station.id]
  const labels = result.times.map((time) => formatShort(time))
  const displacement = series.map((obs) => Number(obs.dH.toFixed(1)))
  const velocity = series.map((obs) => Number(obs.v.toFixed(3)))
  const rain = result.rain.map((obs) => Number(obs.rain1h.toFixed(1)))

  return {
    animation: false,
    grid: { left: 46, right: 48, top: 34, bottom: 26 },
    legend: { top: 2, textStyle: { color: '#bdd9e4', fontSize: 10 } },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(8,21,40,0.92)', borderColor: '#2f80ed', textStyle: { color: '#e8f4fa', fontSize: 11 } },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#8fb0c6', fontSize: 9 },
      axisLine: { lineStyle: { color: 'rgba(137,210,233,0.35)' } }
    },
    yAxis: [
      {
        type: 'value',
        name: '位移(mm)',
        nameTextStyle: { color: '#8fb0c6', fontSize: 9 },
        axisLabel: { color: '#8fb0c6', fontSize: 9 },
        splitLine: { lineStyle: { color: 'rgba(137,210,233,0.12)' } }
      },
      {
        type: 'value',
        name: '速率(mm/h)',
        nameTextStyle: { color: '#8fb0c6', fontSize: 9 },
        axisLabel: { color: '#8fb0c6', fontSize: 9 },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: '累计位移',
        type: 'line',
        yAxisIndex: 0,
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 2, color: '#36c5e8' },
        data: displacement,
        markLine: {
          symbol: 'none',
          silent: true,
          label: { color: '#ffd21e', fontSize: 9 },
          lineStyle: { color: '#ffd21e', type: 'dashed' },
          data: [{ xAxis: index }]
        }
      },
      {
        name: '合速率',
        type: 'line',
        yAxisIndex: 1,
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 2, color: '#ff7f00' },
        data: velocity
      },
      {
        name: '逐时降雨',
        type: 'bar',
        yAxisIndex: 1,
        itemStyle: { color: 'rgba(61,139,255,0.35)' },
        barWidth: '60%',
        data: rain
      }
    ]
  }
}

function updateChart(index: number): void {
  if (!chart) return
  chart.setOption(buildChartOption(index), { notMerge: true })
}

/* ------------------------------ 回放控制 ------------------------------ */

function stopTimer(): void {
  if (timer !== undefined) {
    window.clearInterval(timer)
    timer = undefined
  }
}

function startTimer(): void {
  stopTimer()
  const interval = Math.max(60, Math.round(1000 / ui.speed))
  timer = window.setInterval(() => {
    const total = totalSteps.value
    if (total === 0) return
    if (ui.index >= total - 1) {
      ui.playing = false
      stopTimer()
      return
    }
    ui.index += 1
    renderCurrent()
  }, interval)
}

function togglePlay(): void {
  ui.playing = !ui.playing
  if (ui.playing) startTimer()
  else stopTimer()
}

function seek(value: number): void {
  ui.index = Math.max(0, Math.min(value, totalSteps.value - 1))
  renderCurrent()
}

function selectStation(id: string): void {
  selectedStationId.value = id
  updateChart(ui.index)
}

/* ------------------------------ 报告 ------------------------------ */

async function captureGlobe(): Promise<string | null> {
  const source = viewer
  if (!source || source.isDestroyed()) return null
  const previous = source.resolutionScale
  try {
    source.resolutionScale = Math.max(2, window.devicePixelRatio || 1)
    source.render()
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())))
    return source.scene.canvas.toDataURL('image/png')
  } catch {
    return null
  } finally {
    source.resolutionScale = previous
    source.render()
  }
}

function buildReportModel(shot: string | null): SlopeReportModel {
  const result = sim.value
  const snapshot = currentSnapshot.value
  if (!result || !snapshot) throw new Error('场景尚未就绪')
  const index = ui.index
  const rows = result.stations.map((station) => {
    const obs = result.observations[station.id][index]
    return [
      station.id,
      obs.dH.toFixed(1),
      obs.v.toFixed(2),
      obs.tangentAngle === null ? '--' : obs.tangentAngle.toFixed(1),
      `${obs.sats}`,
      obs.pdop.toFixed(2),
      obs.qualityOk ? '合格' : '降权',
      WARNING_LEVEL_TEXT[obs.level]
    ]
  })
  const red = currentObs.value.filter((item) => item.obs.level >= WarningLevel.Red).map((item) => item.station.id)
  const orange = currentObs.value.filter((item) => item.obs.level === WarningLevel.Orange).map((item) => item.station.id)

  const suggestions: string[] = []
  if (snapshot.networkLevel >= WarningLevel.Red) {
    suggestions.push('立即启动红色警报响应：划定红色核心区并组织受威胁人员撤离，封闭省道与航道。')
    suggestions.push('加密监测频次至 1 次/小时，安排专人值守并同步上报主管部门。')
  } else if (snapshot.networkLevel === WarningLevel.Orange) {
    suggestions.push('启动橙色警戒响应：限制核心区通行，做好受威胁对象转移准备。')
  } else if (snapshot.networkLevel === WarningLevel.Yellow) {
    suggestions.push('启动黄色警示响应：加强巡查，复核排水与坡面防护措施。')
  } else {
    suggestions.push('维持常态监测，关注降雨耦合与切线角发展趋势。')
  }
  suggestions.push('依据 Fukuzono 反速率模型持续更新破坏时刻预测，动态校核三级影响区范围。')

  return {
    generatedAt: formatTime(Date.now()),
    title: '边坡 GNSS 位移监测预警与三级影响区分析报告',
    subtitle: `${profile.value.name}（${profile.value.code}） · ${profile.value.material}`,
    intro: `本报告基于 ${result.stations.length} 个 GNSS 监测点（含 1 个基准站）于 ${formatTime(
      result.times[0]
    )} 至 ${formatTime(result.times[result.times.length - 1])} 的时序数据，采用改进切线角与 Fukuzono 反速率判据开展三级预警判别，并结合 IDW 变形场与能量线滑距推演生成核心区、重点区、影响区范围。报告时次：${formatTime(
      snapshot.time
    )}。`,
    watermark: '本报告由边坡 GNSS 位移预警系统自动生成，仅供防灾决策参考。',
    sections: [
      {
        title: '一、工程概况',
        kv: [
          { label: '边坡名称', value: profile.value.name },
          { label: '边坡编号', value: profile.value.code },
          { label: '中心坐标', value: `${profile.value.lon.toFixed(4)}, ${profile.value.lat.toFixed(4)}` },
          { label: '坡体类型', value: profile.value.material },
          { label: '平均滑体厚度', value: `${profile.value.thickness} m` },
          { label: '监测点数量', value: `${result.stations.length - 1} 个（另设 1 个基准站）` },
          { label: '监测时段', value: `${formatTime(result.times[0])} ~ ${formatTime(result.times[result.times.length - 1])}` },
          { label: '数据分辨率', value: `每 ${DEFAULT_SIM_PLAN.intervalH} 小时一个历元，共 ${result.times.length} 个历元` }
        ]
      },
      {
        title: '二、监测数据与时次指标',
        table: {
          caption: `报告时次 ${formatTime(snapshot.time)} 各监测点指标`,
          head: ['点号', '累计位移(mm)', '合速率(mm/h)', '切线角(°)', '卫星数', 'PDOP', '数据质量', '预警等级'],
          body: rows
        },
        lines: [
          '说明：速率由 16 历元滑动窗口一次线性回归斜率给出；切线角为坐标归一化后的改进切线角，用于识别等速蠕变向加速变形的转折。'
        ]
      },
      {
        title: '三、预警判据与率定',
        kv: [
          { label: '速率阈值(mm/d)', value: `蓝 ${ui.thresholds.rateMmd.blue} / 黄 ${ui.thresholds.rateMmd.yellow} / 橙 ${ui.thresholds.rateMmd.orange} / 红 ${ui.thresholds.rateMmd.red}` },
          { label: '切线角阈值(°)', value: `黄 ${ui.thresholds.tangentAngle.yellow} / 橙 ${ui.thresholds.tangentAngle.orange} / 红 ${ui.thresholds.tangentAngle.red}` },
          { label: '累计位移阈值(mm)', value: `黄 ${ui.thresholds.cumulativeMm.yellow} / 橙 ${ui.thresholds.cumulativeMm.orange} / 红 ${ui.thresholds.cumulativeMm.red}` },
          { label: '质量门限', value: `卫星数 ≥ ${ui.thresholds.qualityGate.minSats}，PDOP ≤ ${ui.thresholds.qualityGate.maxPdop}，RMS_H ≤ ${ui.thresholds.qualityGate.maxRmsH}，RMS_V ≤ ${ui.thresholds.qualityGate.maxRmsV}` },
          { label: '升级确认/降级滞回', value: `${ui.thresholds.confirm.upgradeEpochs} / ${ui.thresholds.confirm.downgradeEpochs} 个历元` },
          { label: '降雨耦合', value: ui.thresholds.rainCoupling.enabled ? `启用，1h 雨量 ≥ ${ui.thresholds.rainCoupling.rain1hTrigger} mm 且速率放大 ≥ ${ui.thresholds.rainCoupling.rateFactor} 倍时触发黄色` : '未启用' }
        ],
        lines: ['判据取速率、切线角、累计位移与降雨耦合四类指标的高值作为单站原始等级，再经升级确认与降级滞回状态机输出最终等级。']
      },
      {
        title: '四、三级影响区范围',
        kv: [
          { label: '当前预警等级', value: WARNING_LEVEL_TEXT[snapshot.networkLevel] },
          { label: '核心区面积', value: `${(snapshot.stats.coreAreaM2 / 10000).toFixed(3)} 万 m²` },
          { label: '重点区面积', value: `${(snapshot.stats.keyAreaM2 / 10000).toFixed(3)} 万 m²` },
          { label: '影响区面积', value: `${(snapshot.stats.influenceAreaM2 / 10000).toFixed(3)} 万 m²` },
          { label: '推演滑距', value: snapshot.stats.runoutLengthM === null ? '--' : `${snapshot.stats.runoutLengthM.toFixed(0)} m` },
          { label: '潜在滑体体积', value: `${snapshot.stats.volumeM3.toFixed(0)} m³` },
          { label: '地形摩擦系数 f', value: snapshot.stats.frictionF.toFixed(3) },
          { label: '分区置信度', value: `${(snapshot.stats.confidence * 100).toFixed(1)}%` }
        ],
        lines: [
          '核心区：速率达红色阈值的等值线范围与滑坡边界求交，并并入红色预警站点缓冲区。',
          '重点区：橙色阈值等值线范围与核心区外扩缓冲的并集，扣除核心区后裁剪至滑坡边界。',
          '影响区：由核心区与重点区沿高程流路推演的滑距走廊，按坡脚堆积扇扩散后扣除前两级区域。'
        ]
      },
      {
        title: '五、承灾体与处置建议',
        table: {
          caption: '影响区内主要承灾体',
          head: ['类型', '名称', '所处区域'],
          body: profile.value.elementsAtRisk.map((item, i) => [item.type, item.name, i === 0 ? '核心区 / 重点区' : i === 1 ? '重点区 / 影响区' : '影响区'])
        },
        lines: suggestions
      },
      ...(shot
        ? [{ title: '六、现场态势截图', image: shot }]
        : []),
      {
        title: '附：触发与关注站点',
        lines: [
          `红色警报站点：${red.length > 0 ? red.join('、') : '无'}`,
          `橙色警戒站点：${orange.length > 0 ? orange.join('、') : '无'}`,
          `分区结果基于 IDW 各向异性变形场与 D8 流路推演，受监测点密度与地形精度影响，请结合现场巡查综合判断。`
        ]
      }
    ]
  }
}

async function openReport(): Promise<void> {
  if (!currentSnapshot.value) return
  reportOpen.value = true
  statusMessage.value = '正在生成分析报告…'
  const shot = await captureGlobe()
  try {
    reportHtml.value = buildReportBodyHtml(buildReportModel(shot))
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
    reportOpen.value = false
    return
  }
  statusMessage.value = ''
  await nextTick()
}

async function exportPdf(): Promise<void> {
  if (!reportEl.value) return
  exporting.value = true
  try {
    const blob = await renderReportPdf(reportEl.value)
    downloadBlob(blob, `边坡GNSS预警报告-${nowStamp()}.pdf`)
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : 'PDF 导出失败'
  } finally {
    exporting.value = false
  }
}

function exportWord(): void {
  if (!reportHtml.value) return
  downloadBlob(buildWordBlob(reportHtml.value), `边坡GNSS预警报告-${nowStamp()}.doc`)
}

/* ------------------------------ 生命周期 ------------------------------ */

onMounted(() => {
  if (!container.value) return
  const callbacks: SceneCallbacks = {
    onStatus: (message) => {
      statusMessage.value = message
    },
    onBasemapReady: () => {
      statusMessage.value = '正在加载 Cesium World Terrain…'
    }
  }
  try {
    viewer = createMapScene(container.value, callbacks)
    loadBingImagery(viewer, callbacks)
    if (!viewer || viewer.isDestroyed()) return
    viewer.scene.globe.depthTestAgainstTerrain = false
    sceneReady.value = true
    void loadScenario(ui.presetId)
    void loadWorldTerrain(viewer)
      .then(() => refreshDem())
      .catch(() => undefined)
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
    return
  }
  if (chartContainer.value) {
    chart = echarts.init(chartContainer.value)
  }
})

onBeforeUnmount(() => {
  stopTimer()
  if (debounce !== undefined) window.clearTimeout(debounce)
  chart?.dispose()
  chart = undefined
  destroyScene(viewer)
  viewer = undefined
})

watch(
  () => ui.thresholds,
  () => {
    if (!sim.value) return
    if (debounce !== undefined) window.clearTimeout(debounce)
    debounce = window.setTimeout(() => {
      if (!sim.value) return
      recomputeLevels(sim.value, ui.thresholds)
      triggerRef(sim)
      snapshots.clear()
      renderCurrent()
    }, 220)
  },
  { deep: true }
)

watch(
  () => ui.zoneConfig,
  () => {
    if (!sim.value) return
    if (debounce !== undefined) window.clearTimeout(debounce)
    debounce = window.setTimeout(() => {
      snapshots.clear()
      rebuildZoneSpec()
      renderCurrent()
    }, 260)
  },
  { deep: true }
)

watch(
  () => [ui.showCore, ui.showKey, ui.showInfluence],
  () => {
    if (currentSnapshot.value) rebuildZones(currentSnapshot.value)
  }
)

watch(
  () => [ui.showStations, ui.showVectors, ui.showBoundary],
  () => {
    updateStations(ui.index)
  }
)

watch(
  () => ui.presetId,
  (id) => {
    if (sceneReady.value) void loadScenario(id)
  }
)

watch(
  () => ui.playing,
  (playing) => {
    if (playing) startTimer()
    else stopTimer()
  }
)

watch(
  () => ui.speed,
  () => {
    if (ui.playing) startTimer()
  }
)
</script>

<template>
  <div class="sgw-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">边坡 GNSS 位移预警</div>

      <div class="case-intro">
        <div class="intro-row">
          <b>业务场景</b>面向山区公路、矿山与水电边坡的 GNSS 位移监测网，提供变形识别、分级预警、分区推演到报告输出的闭环研判能力。
          <InfoTip title="业务场景" text="以 GNSS 监测站的高频位移观测为输入，替代人工巡检的滞后判断：系统按历元自动解算变形趋势，输出单站预警等级与坡体分区，服务于地质灾害的短临预警与应急处置。" />
        </div>
        <div class="intro-row">
          <b>技术路线</b>位移解算 → 改进切线角加速识别 → 多判据取高并做升级确认与降级滞回 → 单站等级 → IDW 变形场与分级分区 → 能量线滑距推演 → 报告导出。
          <InfoTip title="技术路线" text="1) 由观测序列解算水平位移与日速率；2) 用 Saito 改进切线角识别由匀速转入加速的拐点；3) 速率、切线角、累计位移、降雨耦合四类判据取高值，经升级确认与降级滞回抑制抖动，得到单站等级；4) 反距离加权插值生成变形场并圈定核心区、重点区、影响区；5) 按能量线经验公式推演滑距与影响走廊；6) 汇总为分析报告。" />
        </div>
        <div class="intro-row">
          <b>技术方案</b>Vue 3 + CesiumJS 渲染三维场景与分区贴合面，算法库负责插值与分区，ECharts 呈现时序与等级曲线，报告由模板渲染后导出 PDF/Word。
          <InfoTip title="技术方案" text="地图层用 CesiumJS 地面贴合多边形绘制三级分区，实体点与箭头矢量表达测点等级与位移方向；算法层为独立 TypeScript 模块，实现阈值判定、IDW 插值、等值线追踪与滑距估算；图表层用 ECharts 展示位移/速率/切线角时序与等级阶梯；展示层将当前态势与分级结果渲染为 HTML 报告并导出 PDF/Word。监测网与观测序列由内置仿真按示范场景生成，便于参数率定与演示。" />
        </div>
      </div>

      <div class="sec-title">场景与监测网</div>
      <label class="select-row">
        <span>示范场景<InfoTip title="示范场景" text="切换不同边坡的监测网布设、坡体形态与观测序列。切换后会重新生成仿真观测、重算等级与分区，并把相机定位到新边坡。" /></span>
        <select v-model="ui.presetId" :disabled="computing">
          <option v-for="preset in SCENARIO_PRESETS" :key="preset.id" :value="preset.id">{{ preset.label }}</option>
        </select>
      </label>
      <button class="primary-button" :disabled="computing" @click="focusCamera">定位到边坡</button>

      <div class="sec-title">回放控制</div>
      <div class="row">
        <span class="row-label">当前时次<InfoTip title="当前时次" text="当前回放历元对应的监测时间。所有位移、速率与等级均按该时次的观测数据计算。" /></span>
        <span class="val mono">{{ currentTimeText }}</span>
      </div>
      <div class="slider-row">
        <label>时间轴<InfoTip title="时间轴" text="按监测历元回放各时次观测。拖动滑块或开始回放可逐历元查看位移、速率与预警等级的演化过程。" /> <em>{{ ui.index + 1 }} / {{ totalSteps }}</em></label>
        <input
          type="range"
          min="0"
          :max="Math.max(0, totalSteps - 1)"
          step="1"
          :value="ui.index"
          @input="seek(Number(($event.target as HTMLInputElement).value))"
        />
      </div>
      <div class="btn-row">
        <button class="start-btn" :class="{ running: ui.playing }" :disabled="computing || totalSteps === 0" @click="togglePlay">
          {{ ui.playing ? '暂停回放' : '开始回放' }}
        </button>
        <button class="mini-btn" :disabled="computing" @click="seek(0)">回到起点</button>
      </div>
      <div class="slider-row">
        <label>回放速度<InfoTip title="回放速度" text="自动回放的推进速度，单位为步/秒，即每秒前进的历元数。仅影响回放节奏，不改变任何计算结果。" /> <em>{{ ui.speed }} 步/秒</em></label>
        <input type="range" min="1" max="16" step="1" v-model.number="ui.speed" />
      </div>

      <div class="sec-title">显示选项</div>
      <div class="toggle-grid">
        <label class="switch-row"><span>核心区<InfoTip title="核心区" text="变形最强、速率最高的区域，通常由强变形测点缓冲生成，显示为红色面。" /></span><input v-model="ui.showCore" type="checkbox" /></label>
        <label class="switch-row"><span>重点区<InfoTip title="重点区" text="核心区外围需重点巡查的范围，由等值线阈值圈定，显示为橙色面。" /></span><input v-model="ui.showKey" type="checkbox" /></label>
        <label class="switch-row"><span>影响区<InfoTip title="影响区" text="按能量线与滑距走廊估算的潜在影响范围，显示为黄色面，用于圈定疏散警戒边界。" /></span><input v-model="ui.showInfluence" type="checkbox" /></label>
        <label class="switch-row"><span>监测点<InfoTip title="监测点" text="GNSS 监测站及其编号标签。圆点颜色表示该时次的预警等级，灰色表示数据质量异常。" /></span><input v-model="ui.showStations" type="checkbox" /></label>
        <label class="switch-row"><span>位移矢量<InfoTip title="位移矢量" text="以箭头表示该站的水平位移方向与大小，箭头颜色对应预警等级，长度由位移矢量比例控制。" /></span><input v-model="ui.showVectors" type="checkbox" /></label>
        <label class="switch-row"><span>坡体边界<InfoTip title="坡体边界" text="坡体范围的青色轮廓线，用于界定本次分析与推演的目标坡体。" /></span><input v-model="ui.showBoundary" type="checkbox" /></label>
      </div>
      <div class="slider-row">
        <label>位移矢量比例(m/mm)<InfoTip title="位移矢量比例" text="位移矢量在图上的放大倍数：箭头长度 = 水平位移量(mm) × 比例。值越大箭头越明显，仅影响显示，不改变位移解算结果。" /> <em>{{ ui.vectorScale.toFixed(3) }}</em></label>
        <input type="range" min="0.005" max="0.3" step="0.005" v-model.number="ui.vectorScale" />
      </div>

      <div class="sec-title">预警阈值率定</div>
      <div class="slider-row">
        <label><b class="dot" style="background:#3d8bff"></b>蓝色速率(mm/d)<InfoTip title="蓝色速率阈值" text="蓝色（关注）等级的日变形速率下限，单位 mm/d。速率达到该值即进入蓝色预警，是四级速率判据中最低的一档。" /> <em>{{ ui.thresholds.rateMmd.blue }}</em></label>
        <input type="range" min="2" max="40" step="1" v-model.number="ui.thresholds.rateMmd.blue" />
      </div>
      <div class="slider-row">
        <label><b class="dot" style="background:#ffd21e"></b>黄色速率(mm/d)<InfoTip title="黄色速率阈值" text="黄色（警示）等级的日变形速率下限，单位 mm/d。速率越高等级越高，需保证蓝色 < 黄色 < 橙色 < 红色。" /> <em>{{ ui.thresholds.rateMmd.yellow }}</em></label>
        <input type="range" min="5" max="80" step="1" v-model.number="ui.thresholds.rateMmd.yellow" />
      </div>
      <div class="slider-row">
        <label><b class="dot" style="background:#ff7f00"></b>橙色速率(mm/d)<InfoTip title="橙色速率阈值" text="橙色（警报）等级的日变形速率下限，单位 mm/d。达到该值说明坡体进入加速变形阶段，需现场核查。" /> <em>{{ ui.thresholds.rateMmd.orange }}</em></label>
        <input type="range" min="10" max="160" step="1" v-model.number="ui.thresholds.rateMmd.orange" />
      </div>
      <div class="slider-row">
        <label><b class="dot" style="background:#ff2020"></b>红色速率(mm/d)<InfoTip title="红色速率阈值" text="红色（紧急）等级的日变形速率下限，单位 mm/d。达到该值判定为临滑状态，应立即启动应急响应。" /> <em>{{ ui.thresholds.rateMmd.red }}</em></label>
        <input type="range" min="20" max="300" step="1" v-model.number="ui.thresholds.rateMmd.red" />
      </div>
      <div class="slider-row">
        <label>黄色切线角(°)<InfoTip title="黄色切线角阈值" text="改进切线角法（Saito 模型）的黄色阈值：位移-时间曲线切线角达到该角度时进入黄色预警，反映变形由匀速转入加速。" /> <em>{{ ui.thresholds.tangentAngle.yellow }}</em></label>
        <input type="range" min="25" max="70" step="1" v-model.number="ui.thresholds.tangentAngle.yellow" />
      </div>
      <div class="slider-row">
        <label>橙色切线角(°)<InfoTip title="橙色切线角阈值" text="改进切线角的橙色阈值。切线角越大加速趋势越强，是比速率更能提前反映临滑的信号。" /> <em>{{ ui.thresholds.tangentAngle.orange }}</em></label>
        <input type="range" min="55" max="85" step="1" v-model.number="ui.thresholds.tangentAngle.orange" />
      </div>
      <div class="slider-row">
        <label>红色切线角(°)<InfoTip title="红色切线角阈值" text="改进切线角的红色阈值，接近 90° 表示位移进入急剧增长阶段。" /> <em>{{ ui.thresholds.tangentAngle.red }}</em></label>
        <input type="range" min="70" max="89" step="1" v-model.number="ui.thresholds.tangentAngle.red" />
      </div>
      <div class="slider-row">
        <label>黄色累计位移(mm)<InfoTip title="黄色累计位移阈值" text="自监测起始的累计位移量黄色下限，单位 mm，用于约束长期缓慢变形导致的等级漏判。" /> <em>{{ ui.thresholds.cumulativeMm.yellow }}</em></label>
        <input type="range" min="20" max="300" step="10" v-model.number="ui.thresholds.cumulativeMm.yellow" />
      </div>
      <div class="slider-row">
        <label>橙色累计位移(mm)<InfoTip title="橙色累计位移阈值" text="累计位移的橙色下限，单位 mm。与速率、切线角判据取高值共同决定单站等级。" /> <em>{{ ui.thresholds.cumulativeMm.orange }}</em></label>
        <input type="range" min="80" max="800" step="10" v-model.number="ui.thresholds.cumulativeMm.orange" />
      </div>
      <div class="slider-row">
        <label>红色累计位移(mm)<InfoTip title="红色累计位移阈值" text="累计位移的红色下限，单位 mm，为累计位移判据的最高档。" /> <em>{{ ui.thresholds.cumulativeMm.red }}</em></label>
        <input type="range" min="150" max="1500" step="10" v-model.number="ui.thresholds.cumulativeMm.red" />
      </div>
      <div class="slider-row">
        <label>升级确认历元数<InfoTip title="升级确认历元数" text="等级升级所需的连续确认历元数。取值越大越保守，可抑制单历元噪声造成的误报。" /> <em>{{ ui.thresholds.confirm.upgradeEpochs }}</em></label>
        <input type="range" min="1" max="8" step="1" v-model.number="ui.thresholds.confirm.upgradeEpochs" />
      </div>
      <div class="slider-row">
        <label>降级滞回历元数<InfoTip title="降级滞回历元数" text="等级降级所需的连续确认历元数，通常大于升级确认数，构成滞回机制，避免等级在阈值附近反复抖动。" /> <em>{{ ui.thresholds.confirm.downgradeEpochs }}</em></label>
        <input type="range" min="1" max="16" step="1" v-model.number="ui.thresholds.confirm.downgradeEpochs" />
      </div>
      <div class="row">
        <span class="row-label">降雨耦合触发<InfoTip title="降雨耦合触发" text="开启后当 1h 雨量超过设定阈值时，按降雨耦合规则抬高预警等级；关闭则仅使用速率、切线角与累计位移判据。" /></span>
        <button class="toggle" :class="{ on: ui.thresholds.rainCoupling.enabled }" @click="ui.thresholds.rainCoupling.enabled = !ui.thresholds.rainCoupling.enabled"><i></i></button>
      </div>
      <div class="slider-row">
        <label>1h 雨量触阈(mm)<InfoTip title="降雨耦合触发阈值" text="开启降雨耦合后，1 小时雨量达到该值时按降雨影响抬高预警等级，体现暴雨诱发型滑坡的短临风险。" /> <em>{{ ui.thresholds.rainCoupling.rain1hTrigger }}</em></label>
        <input type="range" min="5" max="60" step="1" v-model.number="ui.thresholds.rainCoupling.rain1hTrigger" />
      </div>

      <div class="sec-title">分区推演参数</div>
      <div class="slider-row">
        <label>IDW 影响半径(m)<InfoTip title="IDW 影响半径" text="反距离加权插值的有效搜索半径，单位 m。半径内监测点参与插值，半径越大变形场越平缓、外推范围越广。" /> <em>{{ ui.zoneConfig.idw.radiusM }}</em></label>
        <input type="range" min="80" max="500" step="10" v-model.number="ui.zoneConfig.idw.radiusM" />
      </div>
      <div class="slider-row">
        <label>IDW 幂次<InfoTip title="IDW 幂次" text="反距离加权的幂指数 p。p 越大近邻点权重越高、等值线越贴合测点；p 越小结果越平滑。" /> <em>{{ ui.zoneConfig.idw.power.toFixed(1) }}</em></label>
        <input type="range" min="1" max="4" step="0.5" v-model.number="ui.zoneConfig.idw.power" />
      </div>
      <div class="slider-row">
        <label>格网分辨率(m)<InfoTip title="格网分辨率" text="分区推演离散网格的边长，单位 m。分辨率越高边界越精细，同时也增加推演计算量。" /> <em>{{ ui.zoneConfig.grid.targetResolutionM }}</em></label>
        <input type="range" min="10" max="60" step="2" v-model.number="ui.zoneConfig.grid.targetResolutionM" />
      </div>
      <div class="slider-row">
        <label>核心区站点缓冲(m)<InfoTip title="核心区站点缓冲" text="核心区沿测点外包的缓冲距离，单位 m，用于把点状强变形信号扩展为连续面状核心区。" /> <em>{{ ui.zoneConfig.buffer.coreStationM }}</em></label>
        <input type="range" min="5" max="80" step="5" v-model.number="ui.zoneConfig.buffer.coreStationM" />
      </div>
      <div class="slider-row">
        <label>重点区外扩(m)<InfoTip title="重点区外扩" text="重点区在核心区基础上向外的扩展距离，单位 m，表示需重点巡查的影响范围。" /> <em>{{ ui.zoneConfig.buffer.keyM }}</em></label>
        <input type="range" min="10" max="150" step="5" v-model.number="ui.zoneConfig.buffer.keyM" />
      </div>
      <div class="slider-row">
        <label>影响区缓冲(m)<InfoTip title="影响区缓冲" text="影响区的最外层缓冲距离，单位 m，为潜在影响范围，用于圈定警戒与人员疏散边界。" /> <em>{{ ui.zoneConfig.buffer.influenceM }}</em></label>
        <input type="range" min="20" max="300" step="10" v-model.number="ui.zoneConfig.buffer.influenceM" />
      </div>
      <div class="slider-row">
        <label>滑距经验系数 C<InfoTip title="滑距经验系数 C" text="滑距经验公式中的地形与滑体综合系数，参与估算坡体失稳后的最大滑动距离。" /> <em>{{ ui.zoneConfig.influence.empiricalC.toFixed(2) }}</em></label>
        <input type="range" min="0.5" max="3" step="0.05" v-model.number="ui.zoneConfig.influence.empiricalC" />
      </div>
      <div class="slider-row">
        <label>滑距经验系数 B<InfoTip title="滑距经验系数 B" text="滑距经验公式中的指数系数，控制滑距随滑体体积增长的快慢。" /> <em>{{ ui.zoneConfig.influence.empiricalB.toFixed(2) }}</em></label>
        <input type="range" min="0.05" max="0.6" step="0.01" v-model.number="ui.zoneConfig.influence.empiricalB" />
      </div>
      <div class="slider-row">
        <label>滑距上限(m)<InfoTip title="滑距上限" text="滑距估算的截断上限，单位 m，防止滑体体积异常导致影响区无限外扩。" /> <em>{{ ui.zoneConfig.influence.maxRunoutM }}</em></label>
        <input type="range" min="300" max="3000" step="50" v-model.number="ui.zoneConfig.influence.maxRunoutM" />
      </div>

      <p class="hint">
        <b>判据：</b>速率、改进切线角、累计位移与降雨耦合取高值，经升级确认与降级滞回输出单站等级。<br />
        <b>分区：</b>IDW 变形场等值线给核心区与重点区，能量线滑距走廊给影响区。<br />
        <b>率定：</b>拖动阈值滑块将即时重算等级与三级影响区范围。
      </p>
    </div>

    <div class="map-legend">
      <b class="mg-title">图例<InfoTip title="地图图例" text="面：核心区（红，变形最强）、重点区（橙）、影响区（黄），面积随阈值与滑动参数实时重算。线：青色为坡体边界。点：圆形为监测点、白底蓝圈为基准站，圆点与箭头颜色对应该站当前预警等级（白 正常 / 蓝 关注 / 黄 警示 / 橙 警报 / 红 紧急），灰色表示数据质量异常。箭头：水平位移方向与大小。" /></b>
      <span class="mg-item"><i class="mg-area" style="background: rgba(255, 32, 32, 0.36); border-color: #ff2020"></i>核心区</span>
      <span class="mg-item"><i class="mg-area" style="background: rgba(255, 127, 0, 0.26); border-color: #ff7f00"></i>重点区</span>
      <span class="mg-item"><i class="mg-area" style="background: rgba(255, 210, 30, 0.16); border-color: #ffd21e"></i>影响区</span>
      <span class="mg-item"><i class="mg-line"></i>坡体边界</span>
      <span class="mg-item"><i class="mg-point"></i>监测点</span>
      <span class="mg-item"><i class="mg-base"></i>基准站</span>
      <span class="mg-item"><i class="mg-arrow"></i>位移矢量</span>
    </div>

    <div class="stats-panel">
      <div class="panel-title">当前态势</div>
      <div class="badge" :style="{ background: WARNING_LEVEL_COLOR[currentSnapshot?.networkLevel ?? 0], color: (currentSnapshot?.networkLevel ?? 0) >= 2 ? '#3a2400' : '#08121f' }">
        {{ networkLevelText }}
      </div>
      <div class="stat-row"><span>分区面积<InfoTip title="分区面积" text="当前时次三级影响区的面积合计，反映可能受威胁的空间规模。" /></span><em>{{ areaText }}</em></div>
      <div class="stat-row"><span>推演滑距<InfoTip title="推演滑距" text="按能量线滑距经验公式估算的失稳后最大滑动距离，用于圈定影响区远近。" /></span><em>{{ currentSnapshot?.stats.runoutLengthM === null || currentSnapshot?.stats.runoutLengthM === undefined ? '--' : `${currentSnapshot.stats.runoutLengthM.toFixed(0)} m` }}</em></div>
      <div class="stat-row"><span>滑体体积<InfoTip title="滑体体积" text="由变形分区与坡体厚度估算的潜在滑体体积，是滑距与影响范围推算的输入。" /></span><em>{{ currentSnapshot ? `${currentSnapshot.stats.volumeM3.toFixed(0)} m³` : '--' }}</em></div>
      <div class="stat-row"><span>地形摩擦 f<InfoTip title="地形摩擦 f" text="由坡体几何与滑体参数换算的等效摩擦系数，值越小滑体越易远滑。" /></span><em>{{ currentSnapshot ? currentSnapshot.stats.frictionF.toFixed(3) : '--' }}</em></div>
      <div class="stat-row"><span>分区置信度<InfoTip title="分区置信度" text="分区结果的可信度，综合测点数量、数据质量与空间覆盖度评估，越接近 100% 越可靠。" /></span><em>{{ currentSnapshot ? `${(currentSnapshot.stats.confidence * 100).toFixed(1)}%` : '--' }}</em></div>
      <div class="level-legend">
        <span v-for="level in [4, 3, 2, 1, 0]" :key="level" class="legend-item">
          <b class="dot" :style="{ background: WARNING_LEVEL_COLOR[level] }"></b>{{ WARNING_LEVEL_TEXT[level] }}
        </span>
      </div>
      <div class="station-list">
        <button
          v-for="item in currentObs"
          :key="item.station.id"
          class="station-chip"
          :class="{ active: activeStation?.id === item.station.id }"
          @click="selectStation(item.station.id)"
        >
          <b class="dot" :style="{ background: item.obs.qualityOk ? WARNING_LEVEL_COLOR[item.obs.level] : '#8a97a6' }"></b>
          {{ item.station.id }}
        </button>
      </div>
      <button class="primary-button" :disabled="computing || !currentSnapshot" @click="openReport">生成分析报告</button>
    </div>

    <div class="chart-panel">
      <div class="chart-title">监测点时序（{{ activeStation?.id ?? '--' }}）</div>
      <div ref="chartContainer" class="chart-body"></div>
    </div>

    <div v-if="reportOpen" class="report-mask" @click.self="reportOpen = false">
      <div class="report-dialog">
        <div class="report-toolbar">
          <span>边坡 GNSS 预警分析报告</span>
          <div class="toolbar-actions">
            <button class="mini-btn" :disabled="exporting" @click="exportPdf">{{ exporting ? '导出中…' : '导出 PDF' }}</button>
            <button class="mini-btn" :disabled="exporting" @click="exportWord">导出 Word</button>
            <button class="mini-btn" @click="reportOpen = false">关闭</button>
          </div>
        </div>
        <div class="report-scroll">
          <div ref="reportEl" class="report-body" v-html="reportHtml"></div>
        </div>
      </div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.sgw-shell { position: relative; width: 100%; height: 100%; min-height: 420px; overflow: hidden; border-radius: 8px; background: #0b1c2c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel, .stats-panel, .chart-panel { position: absolute; z-index: 10; border: 1px solid rgba(137,210,233,.3); border-radius: 9px; background: rgba(8,32,49,.9); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.control-panel { top: 12px; right: 12px; width: 274px; max-height: calc(100% - 24px); overflow-y: auto; box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; padding: 12px; }
.stats-panel { top: 12px; left: 12px; width: 214px; display: flex; flex-direction: column; gap: 7px; padding: 12px; }
.chart-panel { left: 12px; bottom: 12px; width: min(640px, calc(100% - 320px)); padding: 8px 10px 4px; }
.panel-title { font-size: 12px; font-weight: 700; }
.case-intro { display: flex; flex-direction: column; gap: 5px; padding: 8px 9px; border: 1px solid rgba(101, 211, 235, 0.24); border-radius: 7px; background: rgba(37, 127, 158, 0.14); font-size: 10px; line-height: 1.6; color: #c2dfe9; }
.case-intro b { color: #65d3eb; margin-right: 4px; }
.map-legend { position: absolute; top: 12px; left: 238px; right: 292px; z-index: 10; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 4px 12px; padding: 6px 12px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 9px; background: rgba(8, 32, 49, 0.9); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 10px; }
.mg-title { display: inline-flex; align-items: center; gap: 4px; color: #65d3eb; font-weight: 700; }
.mg-item { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.mg-area { width: 11px; height: 11px; border: 1px solid; border-radius: 2px; }
.mg-line { width: 16px; height: 0; border-top: 2px solid #7ef0ff; }
.mg-point { width: 9px; height: 9px; border: 2px solid #0b1c2c; border-radius: 50%; background: #ffffff; }
.mg-base { width: 9px; height: 9px; border: 2px solid #1b5faa; border-radius: 50%; background: #ffffff; }
.mg-arrow { width: 16px; height: 0; border-top: 2px solid #65d3eb; }
.chart-title { font-size: 11px; color: #9fc4d8; margin-bottom: 4px; }
.chart-body { width: 100%; height: 170px; }
.sec-title { margin-top: 8px; font-size: 11px; font-weight: 700; color: #65d3eb; letter-spacing: .03em; }
.select-row { display: flex; align-items: center; justify-content: space-between; color: #bdd9e4; }
.control-panel select { max-width: 158px; border: 1px solid rgba(137,210,233,.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.primary-button, .secondary-button, .start-btn, .mini-btn { min-height: 27px; border: 0; border-radius: 5px; color: #edfaff; cursor: pointer; font-size: 11px; }
.primary-button, .start-btn { background: #257f9e; }
.mini-btn { background: rgba(137,210,233,.22); }
.primary-button:disabled, .start-btn:disabled, .mini-btn:disabled { cursor: default; opacity: .5; }
.start-btn.running { background: rgba(255,82,82,.25); border: 1px solid rgba(255,82,82,.55); color: #ff8a8a; }
.btn-row { display: flex; gap: 6px; }
.btn-row button { flex: 1; }
.row { display: flex; align-items: center; justify-content: space-between; }
.row-label { color: #bdd9e4; }
.val { color: #65d3eb; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.slider-row { margin-top: 5px; }
.slider-row label { display: flex; align-items: center; gap: 4px; color: #bdd9e4; font-size: 11px; }
.slider-row label em { font-style: normal; margin-left: auto; color: #65d3eb; font-weight: 700; }
.slider-row input[type="range"] { width: 100%; margin: 2px 0 0; accent-color: #2f80ed; background: transparent; }
.toggle-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; }
.switch-row { display: flex; align-items: center; justify-content: space-between; color: #bdd9e4; font-size: 10px; }
.switch-row input[type="checkbox"] { accent-color: #2f80ed; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(157,188,224,.35); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform .2s; }
.toggle.on { background: #2f80ed; }
.toggle.on i { transform: translateX(18px); }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.badge { padding: 5px 8px; border-radius: 6px; font-size: 12px; font-weight: 700; text-align: center; }
.stat-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 10px; color: #bdd9e4; }
.stat-row em { font-style: normal; color: #9fe0f5; text-align: right; }
.level-legend { display: flex; flex-wrap: wrap; gap: 4px 10px; padding-top: 4px; border-top: 1px solid rgba(137,210,233,.18); }
.legend-item { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; color: #cfe6f1; }
.station-list { display: flex; flex-wrap: wrap; gap: 4px; max-height: 96px; overflow-y: auto; }
.station-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 6px; border: 1px solid rgba(137,210,233,.25); border-radius: 5px; background: rgba(137,210,233,.1); color: #d8eef7; font-size: 10px; cursor: pointer; }
.station-chip.active { border-color: #65d3eb; background: rgba(101,211,235,.22); }
.hint { margin: 8px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.hint b { color: #9fb3cc; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 30; width: max-content; max-width: 420px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8,21,40,.9); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
.report-mask { position: absolute; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; background: rgba(4,12,22,.72); }
.report-dialog { display: flex; flex-direction: column; width: min(860px, 94%); max-height: 92%; border: 1px solid rgba(137,210,233,.35); border-radius: 10px; background: #0d2233; overflow: hidden; }
.report-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; border-bottom: 1px solid rgba(137,210,233,.2); color: #ddf2f8; font-size: 12px; font-weight: 700; }
.toolbar-actions { display: flex; gap: 6px; }
.report-scroll { padding: 12px; overflow-y: auto; background: #eef2f6; }
.report-body { background: #fff; }
</style>
