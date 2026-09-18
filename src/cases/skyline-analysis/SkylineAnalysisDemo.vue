<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import * as Cesium from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, loadWorldTerrain } from '../../lib/cesium-scene'
import { pickCartographic } from '../measure-lib/pick'
import { buildDefaultCity, type CityModel } from '../sunshine-lib/city'
import {
  renderCityBuildings,
  createObserverMarker,
  skylinePositions,
  type BuildingRenderEntry
} from '../urban-analysis-lib/render'
import {
  buildEnuFrame,
  buildingHorizon,
  terrainHorizon,
  type EnuFrame
} from '../urban-analysis-lib/geometry'
import { SKYLINE_HELP } from '../urban-analysis-lib/help'

type SkySample = { azimuth: number; elevation: number; distance: number; occluded: boolean }

const SKYLINE_ID = 'skyline-line'
const SURFACE_ID = 'skyline-surface'
const OBSERVER_ID = 'urban-observer'
const RAY_PREFIX = 'skyline-ray-'

const container = ref<HTMLElement | null>(null)
const polarCanvas = ref<HTMLCanvasElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const isLoaded = ref(false)
const terrainReady = ref(false)
const helpOpen = ref(false)
const activeHelpKey = ref<string | undefined>(SKYLINE_HELP[0]?.key)

const city = shallowRef<CityModel | undefined>()
const samples = shallowRef<SkySample[]>([])

const observer = reactive({ lon: 116.4074, lat: 39.9042, offset: 25 })

const form = reactive({
  azStart: 0,
  azEnd: 360,
  azStep: 1,
  maxRadius: 2000,
  observerOffset: 25,
  adaptive: true,
  adaptiveThreshold: 0.5,
  includeBuildings: true,
  includeTerrain: false,
  terrainStep: 60
})

const display = reactive({
  showSkyline: true,
  showRays: true,
  showSurface: true,
  skylineColor: '#ffd666',
  skylineWidth: 2,
  surfaceOpacity: 0.16
})

const stats = reactive({
  minElevation: 0,
  maxElevation: 0,
  avgElevation: 0,
  maxAzimuth: 0,
  maxDistance: 0,
  skyFraction: 0,
  rayCount: 0,
  terrainUsed: false
})

let viewer: Cesium.Viewer | undefined
let handler: Cesium.ScreenSpaceEventHandler | undefined
let buildingEntries: BuildingRenderEntry[] = []

function removeSkylineVisuals(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.entities.removeById(SKYLINE_ID)
  viewer.entities.removeById(SURFACE_ID)
  for (const entity of [...viewer.entities.values]) {
    if (entity.id.startsWith(RAY_PREFIX)) viewer.entities.remove(entity)
  }
}

function castHorizon(frame: EnuFrame, azimuth: number, maxRadius: number): SkySample {
  const model = city.value
  let elevation = 0
  let distance = maxRadius
  let occluded = false
  if (!model) return { azimuth, elevation, distance, occluded }
  if (form.includeBuildings) {
    const hit = buildingHorizon(model, 0, 0, observer.offset, azimuth, maxRadius)
    if (hit) {
      elevation = hit.elevation
      distance = hit.distance
      occluded = true
    }
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
    if (hit && (!occluded || hit.elevation > elevation)) {
      elevation = hit.elevation
      distance = hit.distance
      occluded = true
    }
  }
  return { azimuth, elevation, distance, occluded }
}

function analyze(): void {
  if (!viewer || !city.value) return
  const origin = Cesium.Cartesian3.fromDegrees(observer.lon, observer.lat, observer.offset)
  const frame = buildEnuFrame(origin)
  const maxRadius = form.maxRadius
  const stepRad = Math.max(0.0005, Cesium.Math.toRadians(form.azStep))
  const startRad = Cesium.Math.toRadians(form.azStart)
  const endRad = Cesium.Math.toRadians(form.azEnd)

  const result: SkySample[] = []
  if (endRad >= startRad) {
    const count = Math.max(1, Math.round((endRad - startRad) / stepRad))
    for (let i = 0; i <= count; i += 1) {
      result.push(castHorizon(frame, startRad + i * stepRad, maxRadius))
    }
  }

  if (form.adaptive && result.length > 1) {
    const threshold = Cesium.Math.toRadians(form.adaptiveThreshold)
    const minSpan = Cesium.Math.toRadians(0.1)
    const extra: SkySample[] = []
    const recurse = (a0: SkySample, a1: SkySample, depth: number): void => {
      const span = a1.azimuth - a0.azimuth
      if (depth >= 3 || span <= minSpan) return
      const midAz = (a0.azimuth + a1.azimuth) / 2
      const mid = castHorizon(frame, midAz, maxRadius)
      const interp = (a0.elevation + a1.elevation) / 2
      if (Math.abs(mid.elevation - interp) > threshold) {
        recurse(a0, mid, depth + 1)
        extra.push(mid)
        recurse(mid, a1, depth + 1)
      }
    }
    for (let i = 0; i < result.length - 1; i += 1) recurse(result[i], result[i + 1], 0)
    result.push(...extra)
  }

  result.sort((a, b) => a.azimuth - b.azimuth)
  samples.value = result
  updateStats(result)
  renderDome(frame, origin, result)
  drawPolar(result)
}

function updateStats(result: SkySample[]): void {
  if (result.length === 0) return
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let sky = 0
  let maxAzimuth = 0
  let maxDistance = form.maxRadius
  for (const sample of result) {
    if (sample.elevation < min) min = sample.elevation
    if (sample.elevation > max) {
      max = sample.elevation
      maxAzimuth = sample.azimuth
      maxDistance = sample.distance
    }
    sum += sample.elevation
    if (!sample.occluded) sky += 1
  }
  stats.minElevation = (min * 180) / Math.PI
  stats.maxElevation = (max * 180) / Math.PI
  stats.avgElevation = ((sum / result.length) * 180) / Math.PI
  stats.maxAzimuth = (maxAzimuth * 180) / Math.PI
  stats.maxDistance = maxDistance
  stats.skyFraction = sky / result.length
  stats.rayCount = result.length
  stats.terrainUsed = form.includeTerrain && terrainReady.value
}

function renderDome(frame: EnuFrame, origin: Cesium.Cartesian3, result: SkySample[]): void {
  if (!viewer || result.length === 0) return
  removeSkylineVisuals()
  const color = Cesium.Color.fromCssColorString(display.skylineColor)
  const domeRadius = form.maxRadius
  const dome = skylinePositions(frame, result, domeRadius)
  const closed = form.azStart === 0 && form.azEnd >= 360 && dome.length > 2
  const linePositions = closed ? [...dome, dome[0]] : dome

  if (display.showSurface && linePositions.length > 2) {
    viewer.entities.add({
      id: SURFACE_ID,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy([origin, ...linePositions]),
        perPositionHeight: true,
        material: color.withAlpha(display.surfaceOpacity),
        outline: false
      }
    })
  }

  if (display.showRays) {
    const stride = Math.max(1, Math.ceil(dome.length / 48))
    for (let i = 0; i < dome.length; i += stride) {
      viewer.entities.add({
        id: `${RAY_PREFIX}${i}`,
        polyline: {
          positions: [origin, dome[i]],
          width: 1,
          material: color.withAlpha(0.28),
          arcType: Cesium.ArcType.NONE
        }
      })
    }
  }

  if (display.showSkyline && linePositions.length > 1) {
    viewer.entities.add({
      id: SKYLINE_ID,
      polyline: {
        positions: linePositions,
        width: display.skylineWidth,
        material: new Cesium.PolylineGlowMaterialProperty({ color, glowPower: 0.22 }),
        arcType: Cesium.ArcType.NONE
      }
    })
  }

  viewer.entities.removeById(OBSERVER_ID)
  createObserverMarker(viewer, origin, `观测点 ${observer.offset.toFixed(0)}m`)
}

function drawPolar(result: SkySample[]): void {
  const canvas = polarCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const size = canvas.width
  const cx = size / 2
  const cy = size / 2
  const R = size / 2 - 16
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = 'rgba(6, 22, 38, 0.9)'
  ctx.fillRect(0, 0, size, size)

  ctx.strokeStyle = 'rgba(127, 208, 230, 0.25)'
  ctx.lineWidth = 1
  for (let i = 1; i <= 4; i += 1) {
    ctx.beginPath()
    ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.moveTo(cx, cy - R)
  ctx.lineTo(cx, cy + R)
  ctx.moveTo(cx - R, cy)
  ctx.lineTo(cx + R, cy)
  ctx.stroke()

  ctx.fillStyle = '#8fb0c8'
  ctx.font = '9px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('N', cx, cy - R - 4)
  ctx.fillText('S', cx, cy + R + 10)
  ctx.fillText('E', cx + R + 8, cy + 3)
  ctx.fillText('W', cx - R - 8, cy + 3)

  if (result.length < 2) return
  const maxDeg = 90
  ctx.beginPath()
  let started = false
  for (const sample of result) {
    const deg = Math.max(0, Math.min(maxDeg, (sample.elevation * 180) / Math.PI))
    const r = (R * deg) / maxDeg
    const x = cx + r * Math.sin(sample.azimuth)
    const y = cy - r * Math.cos(sample.azimuth)
    if (!started) {
      ctx.moveTo(x, y)
      started = true
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.closePath()
  ctx.fillStyle = 'rgba(255, 214, 102, 0.28)'
  ctx.fill()
  ctx.strokeStyle = '#ffd666'
  ctx.lineWidth = 1.6
  ctx.stroke()
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
  [() => form.azStart, () => form.azEnd, () => form.azStep, () => form.maxRadius, () => form.observerOffset, () => form.adaptive, () => form.adaptiveThreshold, () => form.includeBuildings, () => form.terrainStep],
  () => analyze()
)

watch(
  [() => display.showSkyline, () => display.showRays, () => display.showSurface, () => display.skylineColor, () => display.skylineWidth, () => display.surfaceOpacity],
  () => {
    if (!viewer || !city.value) return
    const origin = Cesium.Cartesian3.fromDegrees(observer.lon, observer.lat, observer.offset)
    renderDome(buildEnuFrame(origin), origin, samples.value)
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
  <div class="sky-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">空间分析-天际线分析</div>

      <div class="section-title">观测点</div>
      <div class="row-note">经度 {{ observer.lon.toFixed(5) }} · 纬度 {{ observer.lat.toFixed(5) }}</div>
      <div class="control-row">
        <span class="row-label">观测高度</span>
        <input v-model.number="form.observerOffset" type="range" min="1.6" max="200" step="1" />
        <span class="row-value">{{ form.observerOffset }}m</span>
      </div>
      <div class="row-note">在地图上单击即可移动观测点</div>

      <div class="section-title">采样参数</div>
      <div class="control-row">
        <span class="row-label">起始方位</span>
        <input v-model.number="form.azStart" type="range" min="0" max="360" step="5" />
        <span class="row-value">{{ form.azStart }}°</span>
      </div>
      <div class="control-row">
        <span class="row-label">结束方位</span>
        <input v-model.number="form.azEnd" type="range" min="0" max="360" step="5" />
        <span class="row-value">{{ form.azEnd }}°</span>
      </div>
      <div class="control-row">
        <span class="row-label">采样间隔</span>
        <input v-model.number="form.azStep" type="range" min="0.5" max="10" step="0.5" />
        <span class="row-value">{{ form.azStep }}°</span>
      </div>
      <div class="control-row">
        <span class="row-label">分析半径</span>
        <input v-model.number="form.maxRadius" type="range" min="500" max="5000" step="100" />
        <span class="row-value">{{ form.maxRadius }}m</span>
      </div>
      <label class="switch-row"><span>自适应细分</span><input v-model="form.adaptive" type="checkbox" /></label>
      <div class="control-row" v-if="form.adaptive">
        <span class="row-label">细分阈值</span>
        <input v-model.number="form.adaptiveThreshold" type="range" min="0.1" max="3" step="0.1" />
        <span class="row-value">{{ form.adaptiveThreshold.toFixed(1) }}°</span>
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
      <label class="switch-row"><span>天际线</span><input v-model="display.showSkyline" type="checkbox" /></label>
      <label class="switch-row"><span>射线束</span><input v-model="display.showRays" type="checkbox" /></label>
      <label class="switch-row"><span>可见天空面</span><input v-model="display.showSurface" type="checkbox" /></label>
      <div class="control-row">
        <span class="row-label">天际线颜色</span>
        <input v-model="display.skylineColor" type="color" />
      </div>
      <div class="control-row">
        <span class="row-label">线宽</span>
        <input v-model.number="display.skylineWidth" type="range" min="1" max="6" step="0.5" />
        <span class="row-value">{{ display.skylineWidth }}</span>
      </div>

      <div class="section-title">极坐标天际线</div>
      <canvas ref="polarCanvas" class="polar-canvas" width="220" height="220"></canvas>

      <div class="section-title">量化读数</div>
      <div class="stat-grid">
        <div class="stat-cell"><span>最大遮挡</span><b>{{ stats.maxElevation.toFixed(1) }}°</b></div>
        <div class="stat-cell"><span>平均遮挡</span><b>{{ stats.avgElevation.toFixed(1) }}°</b></div>
        <div class="stat-cell"><span>可见天空</span><b>{{ (stats.skyFraction * 100).toFixed(1) }}%</b></div>
        <div class="stat-cell"><span>最高方位</span><b>{{ stats.maxAzimuth.toFixed(0) }}°</b></div>
        <div class="stat-cell"><span>遮挡距离</span><b>{{ Math.round(stats.maxDistance) }}m</b></div>
        <div class="stat-cell"><span>射线数</span><b>{{ stats.rayCount }}</b></div>
      </div>

      <button class="help-toggle" @click="helpOpen = !helpOpen">功能实现说明</button>
      <div v-if="helpOpen" class="help-panel">
        <div class="help-head">
          <span>功能实现说明</span>
          <button class="help-close" @click="helpOpen = false">×</button>
        </div>
        <div v-for="item in SKYLINE_HELP" :key="item.key" class="help-item">
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
        从观测点沿方位角发射射线，取各方向最高遮挡点构建三维天际线；单击地图可移动观测点实时重算。
      </p>
    </div>

    <div v-if="!isLoaded" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.sky-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #0f2438; }
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
.switch-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; color: #c3d8e6; }
.switch-row input { cursor: pointer; }
.polar-canvas { width: 100%; height: auto; border-radius: 6px; border: 1px solid rgba(137, 210, 233, 0.25); margin-top: 3px; }
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
