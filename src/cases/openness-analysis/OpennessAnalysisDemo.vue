<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import * as Cesium from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, loadWorldTerrain } from '../../lib/cesium-scene'
import { pickCartographic } from '../measure-lib/pick'
import { buildDefaultCity, type CityModel } from '../sunshine-lib/city'
import {
  buildEnuFrame,
  enuToWorld,
  enuDirectionToWorld,
  fibonacciSphere,
  firstBuildingHit,
  buildingHorizon,
  terrainHorizon,
  RAD2DEG,
  type LocalDir,
  type EnuFrame
} from '../urban-analysis-lib/geometry'
import {
  renderCityBuildings,
  createObserverMarker,
  createAnalysisSphere,
  createSamplePoints,
  setBuildingsVisible,
  removeEntityById,
  type BuildingRenderEntry
} from '../urban-analysis-lib/render'
import { OPENNESS_HELP } from '../urban-analysis-lib/help'

type OpenSample = { direction: LocalDir; occluded: boolean }

const SPHERE_ID = 'urban-analysis-sphere'
const OBSERVER_ID = 'urban-observer'

const container = ref<HTMLElement | null>(null)
const heatCanvas = ref<HTMLCanvasElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const isLoaded = ref(false)
const terrainReady = ref(false)
const helpOpen = ref(false)
const activeHelpKey = ref<string | undefined>(OPENNESS_HELP[0]?.key)

const city = shallowRef<CityModel | undefined>()
const samples = shallowRef<OpenSample[]>([])

const observer = reactive({ lon: 116.4074, lat: 39.9042, offset: 3 })

const form = reactive({
  sampleCount: 800,
  maxRadius: 1500,
  observerOffset: 3,
  mode: 'sphere' as 'hemisphere' | 'sphere',
  includeBuildings: true,
  includeTerrain: false,
  terrainStep: 60,
  showSphere: true,
  showSamples: true
})

const display = reactive({
  sphereColor: '#37c6ff',
  sphereOpacity: 0.08,
  skyColor: '#35e0c8',
  occludedColor: '#ff6b6b'
})

const metrics = reactive({
  positive: 90,
  negative: 90,
  svf: 1,
  omni: 1,
  occludedUpper: 0,
  upperCount: 0,
  total: 0
})

let viewer: Cesium.Viewer | undefined
let handler: Cesium.ScreenSpaceEventHandler | undefined
let buildingEntries: BuildingRenderEntry[] = []
let sampleCollection: Cesium.PointPrimitiveCollection | undefined

function removeAnalyticVisuals(): void {
  if (!viewer || viewer.isDestroyed()) return
  removeEntityById(viewer, SPHERE_ID)
  removeEntityById(viewer, OBSERVER_ID)
  if (sampleCollection) {
    viewer.scene.primitives.remove(sampleCollection)
    if (!sampleCollection.isDestroyed()) sampleCollection.destroy()
    sampleCollection = undefined
  }
}

/** 单方向遮挡判定：建筑包围盒 + 可选真实地形 */
function castDirection(frame: EnuFrame, origin: Cesium.Cartesian3, dir: LocalDir): boolean {
  const maxRadius = form.maxRadius
  let nearest = Number.POSITIVE_INFINITY

  if (form.includeBuildings && city.value) {
    const hit = firstBuildingHit(city.value, 0, 0, observer.offset, dir.east, dir.north, dir.up, maxRadius)
    if (hit !== null) nearest = hit
  }

  if (form.includeTerrain && terrainReady.value && viewer) {
    const worldDir = enuDirectionToWorld(frame, dir.east, dir.north, dir.up)
    const ray = new Cesium.Ray(origin, worldDir)
    const hit = viewer.scene.globe.pick(ray, viewer.scene)
    if (hit) {
      const distance = Cesium.Cartesian3.distance(origin, hit)
      if (distance > 0.05 && distance <= nearest && distance <= maxRadius) nearest = distance
    }
  }

  return nearest !== Number.POSITIVE_INFINITY
}

/** 正开敞度：各方位角天空高度的均值（90° − 平均遮挡俯仰角） */
function positiveOpenness(frame: EnuFrame): number {
  const ringCount = 180
  const maxRadius = form.maxRadius
  let sum = 0
  for (let i = 0; i < ringCount; i += 1) {
    const azimuth = (i * Math.PI * 2) / ringCount
    let elevation = 0
    if (form.includeBuildings && city.value) {
      const hit = buildingHorizon(city.value, 0, 0, observer.offset, azimuth, maxRadius)
      if (hit) elevation = Math.max(elevation, hit.elevation)
    }
    if (form.includeTerrain && terrainReady.value && viewer) {
      const hit = terrainHorizon(
        viewer,
        frame,
        azimuth,
        maxRadius,
        form.terrainStep,
        observer.offset,
        viewer.scene.globe.ellipsoid
      )
      if (hit) elevation = Math.max(elevation, hit.elevation)
    }
    sum += Math.max(elevation, 0)
  }
  return Math.max(0, 90 - (sum / ringCount) * RAD2DEG)
}

/** 负开敞度：下半球地面（地形）引起的平均下沉角，平坦地面约 90° */
function negativeOpenness(frame: EnuFrame): number {
  if (!(form.includeTerrain && terrainReady.value && viewer)) return 90
  const ringCount = 120
  const maxRadius = form.maxRadius
  const step = Math.max(10, form.terrainStep)
  let sum = 0
  for (let i = 0; i < ringCount; i += 1) {
    const azimuth = (i * Math.PI * 2) / ringCount
    const dx = Math.sin(azimuth)
    const dy = Math.cos(azimuth)
    let minElevation = 0
    for (let d = Math.min(step, maxRadius); d <= maxRadius; d += step) {
      const world = enuToWorld(frame, dx * d, dy * d, 0)
      const carto = Cesium.Cartographic.fromCartesian(world, viewer!.scene.globe.ellipsoid)
      const height = viewer!.scene.globe.getHeight(carto)
      if (height === undefined) continue
      const elevation = Math.atan2(height - observer.offset, d)
      if (elevation < minElevation) minElevation = elevation
    }
    sum += -minElevation
  }
  return Math.max(0, 90 - (sum / ringCount) * RAD2DEG)
}

function analyze(): void {
  if (!viewer || !city.value) return
  const origin = Cesium.Cartesian3.fromDegrees(observer.lon, observer.lat, observer.offset)
  const frame = buildEnuFrame(origin)

  const dirs = fibonacciSphere(Math.max(100, form.sampleCount) * 2)
  const result: OpenSample[] = dirs.map((dir) => ({ direction: dir, occluded: castDirection(frame, origin, dir) }))
  samples.value = result

  const upper = result.filter((sample) => sample.direction.up > 1e-4)
  const skySphere = result.filter((sample) => !sample.occluded).length
  const skyUpper = upper.filter((sample) => !sample.occluded).length
  const occludedUpper = upper.length - skyUpper

  metrics.positive = positiveOpenness(frame)
  metrics.negative = negativeOpenness(frame)
  metrics.svf = upper.length > 0 ? skyUpper / upper.length : 1
  metrics.omni = result.length > 0 ? skySphere / result.length : 1
  metrics.occludedUpper = occludedUpper
  metrics.upperCount = upper.length
  metrics.total = result.length

  renderVisuals(frame, origin)
}

function renderVisuals(frame: EnuFrame, origin: Cesium.Cartesian3): void {
  if (!viewer) return
  removeAnalyticVisuals()

  if (form.showSphere) {
    createAnalysisSphere(
      viewer,
      frame,
      form.maxRadius,
      Cesium.Color.fromCssColorString(display.sphereColor),
      display.sphereOpacity
    )
  }

  createObserverMarker(viewer, origin, `分析点 ${observer.offset.toFixed(0)}m`)

  if (form.showSamples && samples.value.length > 0) {
    const visible = form.mode === 'hemisphere' ? samples.value.filter((s) => s.direction.up > 1e-4) : samples.value
    sampleCollection = createSamplePoints(
      frame,
      visible,
      form.maxRadius,
      Cesium.Color.fromCssColorString(display.skyColor),
      Cesium.Color.fromCssColorString(display.occludedColor)
    )
    viewer.scene.primitives.add(sampleCollection)
  }

  drawHeatmap()
}

function drawHeatmap(): void {
  const canvas = heatCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const width = canvas.width
  const height = canvas.height
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(6, 22, 38, 0.92)'
  ctx.fillRect(0, 0, width, height)

  ctx.strokeStyle = 'rgba(127, 208, 230, 0.18)'
  ctx.lineWidth = 1
  const elevMin = form.mode === 'hemisphere' ? 0 : -90
  const elevMax = 90
  for (let e = elevMin; e <= elevMax; e += 30) {
    const y = ((elevMax - e) / (elevMax - elevMin)) * height
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
  for (let a = 0; a <= 360; a += 45) {
    const x = (a / 360) * width
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }

  const span = elevMax - elevMin
  for (const sample of samples.value) {
    if (form.mode === 'hemisphere' && sample.direction.up <= 1e-4) continue
    const azimuth = (Math.atan2(sample.direction.east, sample.direction.north) * RAD2DEG + 360) % 360
    const elevation = Math.asin(Math.max(-1, Math.min(1, sample.direction.up))) * RAD2DEG
    const x = (azimuth / 360) * width
    const y = ((elevMax - elevation) / span) * height
    ctx.fillStyle = sample.occluded ? display.occludedColor : display.skyColor
    ctx.fillRect(x - 1.2, y - 1.2, 2.4, 2.4)
  }

  ctx.fillStyle = '#8fb0c8'
  ctx.font = '9px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('方位角 0°→360°', 4, height - 4)
}

async function ensureTerrain(): Promise<void> {
  if (!viewer || terrainReady.value) return
  statusMessage.value = '正在加载真实地形…'
  try {
    await loadWorldTerrain(viewer)
    terrainReady.value = true
    statusMessage.value = ''
  } catch {
    terrainReady.value = false
    statusMessage.value = '地形加载失败，已回退为仅建筑分析'
  }
}

function setupObserverPick(): void {
  if (!viewer || !handler) return
  handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const carto = pickCartographic(viewer!.scene, movement.position)
    if (!carto) return
    observer.lon = Cesium.Math.toDegrees(carto.longitude)
    observer.lat = Cesium.Math.toDegrees(carto.latitude)
    analyze()
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
}

function toggleHelp(key: string): void {
  activeHelpKey.value = activeHelpKey.value === key ? undefined : key
}

watch(
  [
    () => form.sampleCount,
    () => form.maxRadius,
    () => form.observerOffset,
    () => form.mode,
    () => form.includeBuildings,
    () => form.terrainStep
  ],
  () => analyze()
)

watch(
  [() => display.sphereColor, () => display.sphereOpacity, () => display.skyColor, () => display.occludedColor, () => form.showSphere, () => form.showSamples],
  () => {
    if (!viewer || !city.value) return
    const origin = Cesium.Cartesian3.fromDegrees(observer.lon, observer.lat, observer.offset)
    renderVisuals(buildEnuFrame(origin), origin)
  }
)

watch(
  () => form.includeTerrain,
  async (value) => {
    if (value) await ensureTerrain()
    analyze()
  }
)

watch(
  () => form.observerOffset,
  (value) => {
    observer.offset = value
  }
)

watch(
  () => form.includeBuildings,
  (value) => {
    setBuildingsVisible(buildingEntries, value)
  }
)

onMounted(() => {
  if (!container.value) return
  const model = buildDefaultCity()
  city.value = model
  observer.lon = model.center.lon
  observer.lat = model.center.lat
  observer.offset = form.observerOffset

  viewer = createMapScene(container.value)
  handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  loadBingImagery(viewer, { onStatus: (message) => (statusMessage.value = message) })
  buildingEntries = renderCityBuildings(viewer, model, 0.9)

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(model.center.lon, model.center.lat - 0.006, 1500),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-40),
      roll: 0
    },
    duration: 0
  })

  setupObserverPick()
  isLoaded.value = true
  analyze()
})

onBeforeUnmount(() => {
  handler?.destroy()
  handler = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="open-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">空间分析-开敞度分析</div>

      <div class="section-title">分析点</div>
      <div class="row-note">经度 {{ observer.lon.toFixed(5) }} · 纬度 {{ observer.lat.toFixed(5) }}</div>
      <div class="control-row">
        <span class="row-label">分析高度</span>
        <input v-model.number="form.observerOffset" type="range" min="1.6" max="120" step="1" />
        <span class="row-value">{{ form.observerOffset }}m</span>
      </div>
      <div class="row-note">在地图上单击即可移动分析点</div>

      <div class="section-title">采样参数</div>
      <div class="control-row">
        <span class="row-label">采样数</span>
        <input v-model.number="form.sampleCount" type="range" min="200" max="2000" step="100" />
        <span class="row-value">{{ form.sampleCount }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">分析半径</span>
        <input v-model.number="form.maxRadius" type="range" min="300" max="5000" step="100" />
        <span class="row-value">{{ form.maxRadius }}m</span>
      </div>
      <div class="control-row">
        <span class="row-label">采样模式</span>
        <select v-model="form.mode" class="select-input">
          <option value="hemisphere">上半球</option>
          <option value="sphere">全球面</option>
        </select>
      </div>

      <div class="section-title">遮挡来源</div>
      <label class="switch-row"><span>包含建筑</span><input v-model="form.includeBuildings" type="checkbox" /></label>
      <label class="switch-row"><span>包含地形</span><input v-model="form.includeTerrain" type="checkbox" /></label>
      <div class="control-row" v-if="form.includeTerrain">
        <span class="row-label">地形步长</span>
        <input v-model.number="form.terrainStep" type="range" min="20" max="200" step="10" />
        <span class="row-value">{{ form.terrainStep }}m</span>
      </div>

      <div class="section-title">显示</div>
      <label class="switch-row"><span>分析球体</span><input v-model="form.showSphere" type="checkbox" /></label>
      <label class="switch-row"><span>采样点</span><input v-model="form.showSamples" type="checkbox" /></label>
      <div class="control-row">
        <span class="row-label">球体颜色</span>
        <input v-model="display.sphereColor" type="color" />
      </div>
      <div class="control-row">
        <span class="row-label">球体透明</span>
        <input v-model.number="display.sphereOpacity" type="range" min="0.02" max="0.4" step="0.01" />
        <span class="row-value">{{ display.sphereOpacity.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">天空色</span>
        <input v-model="display.skyColor" type="color" />
      </div>
      <div class="control-row">
        <span class="row-label">遮挡色</span>
        <input v-model="display.occludedColor" type="color" />
      </div>

      <div class="section-title">方向分布图</div>
      <canvas ref="heatCanvas" class="heat-canvas" width="240" height="120"></canvas>

      <div class="section-title">指标读数</div>
      <div class="stat-grid">
        <div class="stat-cell"><span>正开敞度</span><b>{{ metrics.positive.toFixed(1) }}°</b></div>
        <div class="stat-cell"><span>负开敞度</span><b>{{ metrics.negative.toFixed(1) }}°</b></div>
        <div class="stat-cell"><span>SVF</span><b>{{ metrics.svf.toFixed(3) }}</b></div>
        <div class="stat-cell"><span>全向开敞</span><b>{{ metrics.omni.toFixed(3) }}</b></div>
        <div class="stat-cell"><span>遮挡方向</span><b>{{ metrics.occludedUpper }}</b></div>
        <div class="stat-cell"><span>采样总数</span><b>{{ metrics.total }}</b></div>
      </div>

      <button class="help-toggle" @click="helpOpen = !helpOpen">功能实现说明</button>
      <div v-if="helpOpen" class="help-panel">
        <div class="help-head">
          <span>功能实现说明</span>
          <button class="help-close" @click="helpOpen = false">×</button>
        </div>
        <div v-for="item in OPENNESS_HELP" :key="item.key" class="help-item">
          <button class="help-item-head" :class="{ active: activeHelpKey === item.key }" @click="toggleHelp(item.key)">
            <span>{{ item.title }}</span><i>{{ activeHelpKey === item.key ? '−' : '+' }}</i>
          </button>
          <p v-if="activeHelpKey === item.key" class="help-summary">{{ item.summary }}</p>
          <ul v-if="activeHelpKey === item.key" class="help-detail">
            <li v-for="(line, index) in item.detail" :key="index">{{ line }}</li>
          </ul>
        </div>
      </div>

      <p class="hint">
        以 Fibonacci 球面向四周发射射线，逐方向判定建筑与地形遮挡；单击地图可移动分析点实时重算开敞度指标。
      </p>
    </div>

    <div v-if="!isLoaded" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.open-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #0f2438; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 5px; width: 282px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; box-sizing: border-box; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 26, 44, 0.9); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.panel-title { font-size: 12px; font-weight: 700; margin-bottom: 2px; }
.section-title { margin-top: 7px; margin-bottom: 2px; padding-bottom: 2px; border-bottom: 1px solid rgba(137, 210, 233, 0.16); font-size: 11px; font-weight: 700; color: #7fd0e6; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 2px 0; color: #c3d8e6; }
.row-label { flex: 0 0 auto; }
.row-value { flex: 0 0 56px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.row-note { font-size: 10px; color: #7fd0e6; line-height: 1.5; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row input[type="color"] { width: 40px; height: 22px; padding: 0; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; }
.select-input { flex: 1; min-width: 0; height: 22px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; color: #ddf2f8; font-size: 11px; }
.switch-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; color: #c3d8e6; }
.switch-row input { cursor: pointer; }
.heat-canvas { width: 100%; height: auto; border-radius: 6px; border: 1px solid rgba(137, 210, 233, 0.25); margin-top: 3px; }
.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 2px; }
.stat-cell { display: flex; flex-direction: column; gap: 2px; padding: 5px 4px; border: 1px solid rgba(137, 210, 233, 0.2); border-radius: 5px; background: rgba(16, 43, 64, 0.55); text-align: center; }
.stat-cell span { font-size: 9px; color: #8fb0c8; }
.stat-cell b { font-size: 12px; color: #d9eff6; }
.hint { margin: 6px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.5; }
.help-toggle { margin-top: 7px; min-height: 26px; border: 1px solid rgba(255, 199, 92, 0.5); border-radius: 5px; background: rgba(74, 58, 12, 0.4); color: #ffd666; cursor: pointer; font-size: 11px; }
.help-panel { margin-top: 6px; padding: 8px; border: 1px solid rgba(255, 199, 92, 0.45); border-radius: 6px; background: rgba(30, 24, 8, 0.55); }
.help-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; color: #ffd666; font-weight: 700; }
.help-close { border: 0; background: transparent; color: #cbb98a; cursor: pointer; font-size: 14px; line-height: 1; }
.help-item { border-top: 1px solid rgba(255, 199, 92, 0.16); }
.help-item-head { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 5px 0; border: 0; background: transparent; color: #e9d9ae; cursor: pointer; font-size: 11px; text-align: left; }
.help-item-head.active { color: #ffe9a8; }
.help-item-head i { font-style: normal; font-size: 13px; }
.help-summary { margin: 0 0 3px; font-size: 10px; color: #d9cdab; line-height: 1.5; }
.help-detail { margin: 0; padding-left: 15px; }
.help-detail li { font-size: 10px; color: #cbbd97; line-height: 1.55; margin-bottom: 2px; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 11; width: max-content; max-width: 440px; padding: 8px 14px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
