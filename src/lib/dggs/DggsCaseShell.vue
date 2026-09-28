<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch
} from 'vue'
import {
  Cartesian2,
  Ellipsoid,
  Math as CesiumMath,
  PerspectiveFrustum,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../cesium-scene'
import { getDggsSystem, type DggsSettings } from './index'
import type { PanelField } from './spec'
import { DggsCesiumLayer, type DggsLabelItem } from './cesium-layer'
import type { Feature, FeatureCollection, Polygon } from 'geojson'

const props = defineProps<{ systemId: string }>()

const system = getDggsSystem(props.systemId)

const EMPTY: FeatureCollection<Polygon> = { type: 'FeatureCollection', features: [] }
const GEOMETRY_KEYS = ['resolution', 'autoResolution', 'topology', 'projection', 'aperture', 'dggrsType']
/**
 * 网格相对椭球面的抬升高度：按屏幕像素折算（约 LIFT_PIXELS 个像素对应的地面米数），
 * 既在远景避免与底图深度冲突，又在近景收敛到亚像素级，避免高缩放时网格/标注/高亮偏移。
 */
const LIFT_PIXELS = 1.5
const MIN_LIFT = 0.1
const MAX_LIFT = 220
const DEFAULT_CAMERA_ZOOM = 1.6

const FALLBACK_SETTINGS: DggsSettings = {
  autoResolution: true,
  resolution: 0,
  fillColor: '#2563eb',
  fillOpacity: 0.08,
  lineColor: '#2563eb',
  lineWidth: 1,
  showLabels: true,
  includeNeighbors: false,
  includeParents: false
}

const settings = reactive<DggsSettings>(
  system ? { ...system.defaults } : { ...FALLBACK_SETTINGS }
)
const zoom = ref(DEFAULT_CAMERA_ZOOM)

const grid = shallowRef<FeatureCollection<Polygon>>(EMPTY)
const gridIds = new Set<string>()
const selectedId = ref<string | null>(null)
const selectedFeature = shallowRef<Feature<Polygon> | null>(null)
const neighborFeatures = shallowRef<Feature<Polygon>[]>([])
const parentFeatures = shallowRef<Feature<Polygon>[]>([])
const overlayData = shallowRef<FeatureCollection<Polygon> | null>(null)

const error = ref<string | null>(null)
const loading = ref(Boolean(system?.requiresLoad))
const cursor = ref<{ lon: number; lat: number } | null>(null)
const banner = ref('')
const cellCount = ref(0)

const mapEl = ref<HTMLElement | null>(null)
let viewer: Viewer | undefined
let layer: DggsCesiumLayer | undefined
let handler: ScreenSpaceEventHandler | undefined
let buildTimer: number | undefined
let bannerTimer: number | undefined
let lastMoveAt = 0
let loaded = false
let buildToken = 0

const resolution = computed(() => {
  if (!system) return 0
  return settings.autoResolution
    ? system.resolutionForZoom(zoom.value, settings)
    : Number(settings.resolution)
})

function showBanner(message: string): void {
  banner.value = message
  if (bannerTimer) window.clearTimeout(bannerTimer)
  bannerTimer = window.setTimeout(() => {
    banner.value = ''
  }, 2600)
}

function errorMessage(reason: unknown): string {
  if (reason instanceof RangeError) {
    return `当前视域单元过多（上限 20000），请放大或降低分辨率。`
  }
  return reason instanceof Error ? reason.message : String(reason)
}

/** 当前视口每个屏幕像素对应的地面米数（默认透视投影，近似垂直俯视）。 */
function metersPerPixel(): number {
  if (!viewer || viewer.isDestroyed()) return 1
  const frustum = viewer.camera.frustum
  if (!(frustum instanceof PerspectiveFrustum)) return 1
  const canvasHeight = viewer.scene.canvas.clientHeight || viewer.scene.canvas.height || 1
  const fovy = frustum.fovy || Math.PI / 3
  return (2 * viewer.camera.positionCartographic.height * Math.tan(fovy / 2)) / canvasHeight
}

/** 由相机高度与视场角反算 Web Mercator 近似缩放层级（与案例库其他网格系统一致）。 */
function cameraZoom(): number {
  if (!viewer || viewer.isDestroyed()) return DEFAULT_CAMERA_ZOOM
  const frustum = viewer.camera.frustum
  if (!(frustum instanceof PerspectiveFrustum)) return DEFAULT_CAMERA_ZOOM
  const circumference = 2 * Math.PI * 6378137
  const value = Math.log2(circumference / (256 * Math.max(metersPerPixel(), 1e-6)))
  return Math.max(0, Math.min(22, value))
}

function syncZoom(): void {
  zoom.value = cameraZoom()
}

/** 当前相机高度对应的网格抬升量（米），随屏幕像素尺度收敛。 */
function baseLift(): number {
  const mpp = metersPerPixel()
  if (!Number.isFinite(mpp)) return MIN_LIFT
  return Math.min(MAX_LIFT, Math.max(MIN_LIFT, mpp * LIFT_PIXELS))
}

/** 当前相机可视经纬范围（带少量外扩，跨 180° 或全球视角时退化为全球范围）。 */
function currentBounds(): { west: number; south: number; east: number; north: number } {
  const world = { west: -180, south: -85, east: 180, north: 85 }
  if (!viewer || viewer.isDestroyed()) return world
  const rect = viewer.camera.computeViewRectangle(Ellipsoid.WGS84)
  if (!rect) return world
  let west = CesiumMath.toDegrees(rect.west)
  let east = CesiumMath.toDegrees(rect.east)
  let south = CesiumMath.toDegrees(rect.south)
  let north = CesiumMath.toDegrees(rect.north)
  if (![west, east, south, north].every((value) => Number.isFinite(value))) return world
  south = Math.max(-85, south)
  north = Math.min(85, north)
  if (east <= west || east - west > 360) {
    west = -180
    east = 180
  }
  const padLon = Math.max(0.0004, (east - west) * 0.02)
  const padLat = Math.max(0.0004, (north - south) * 0.02)
  return {
    west: Math.max(-180, west - padLon),
    east: Math.min(180, east + padLon),
    south: Math.max(-85, south - padLat),
    north: Math.min(85, north + padLat)
  }
}

/**
 * 光标对应的经纬度：优先求射线与椭球面的交点。
 * 不用 scene.pickPosition —— 它读取深度缓冲，会受已渲染图元抬升影响而产生偏差，且代价更高。
 */
function pickLonLat(position: Cartesian2): { lon: number; lat: number } | null {
  if (!viewer || viewer.isDestroyed()) return null
  const scene = viewer.scene
  let cartesian = viewer.camera.pickEllipsoid(position, Ellipsoid.WGS84)
  if (!cartesian) {
    const ray = viewer.camera.getPickRay(position)
    if (ray) cartesian = scene.globe.pick(ray, scene)
  }
  if (!cartesian) return null
  const carto = scene.globe.ellipsoid.cartesianToCartographic(cartesian)
  return {
    lon: CesiumMath.toDegrees(carto.longitude),
    lat: CesiumMath.toDegrees(carto.latitude)
  }
}

function updateOverlays(): void {
  if (!system || !selectedId.value) {
    selectedFeature.value = null
    neighborFeatures.value = []
    parentFeatures.value = []
    return
  }
  try {
    selectedFeature.value = system.cellFeature(selectedId.value, settings)
    neighborFeatures.value = settings.includeNeighbors
      ? system
          .neighborIds(selectedId.value, settings)
          .map((id) => system!.cellFeature(id, settings))
      : []
    parentFeatures.value = settings.includeParents
      ? system
          .parentIds(selectedId.value, settings)
          .map((id) => system!.cellFeature(id, settings))
      : []
  } catch {
    selectedFeature.value = null
    neighborFeatures.value = []
    parentFeatures.value = []
  }
}

function labelsFrom(features: Feature<Polygon>[]): DggsLabelItem[] {
  const items: DggsLabelItem[] = []
  for (const feature of features) {
    const properties = (feature.properties ?? {}) as { center_lng?: number; center_lat?: number }
    let lon = properties.center_lng
    let lat = properties.center_lat
    if (typeof lon !== 'number' || typeof lat !== 'number') {
      const ring = feature.geometry.coordinates[0]
      if (!ring || ring.length === 0) continue
      let sumLon = 0
      let sumLat = 0
      for (const [x, y] of ring) {
        sumLon += x
        sumLat += y
      }
      lon = sumLon / ring.length
      lat = sumLat / ring.length
    }
    items.push({ lon, lat, text: String(feature.id ?? '') })
  }
  return items
}

function render(): void {
  if (!viewer || viewer.isDestroyed() || !layer || !system) return
  layer.clear()
  const lift = baseLift()
  // 各叠加层相对网格的抬升按屏幕像素折算并设上限，避免高缩放时随缩放产生可见偏移。
  const px = metersPerPixel()
  const overlayLift = lift + Math.min(50, px * 3)
  const parentLift = lift + Math.min(50, px * 3)
  const neighborLift = lift + Math.min(30, px * 2)
  const selectedLift = lift + Math.min(70, px * 4)
  const labelLift = lift + Math.min(40, px * 2)
  const lineColor = settings.lineColor as string

  if (overlayData.value) {
    layer.renderPolygons(overlayData.value.features, {
      lineColor: '#f59e0b',
      lineWidth: 1.6,
      lift: overlayLift,
      pixelScale: px
    })
  }
  layer.renderPolygons(parentFeatures.value, {
    lineColor: '#f8fafc',
    lineWidth: 3,
    lift: parentLift,
    pixelScale: px
  })
  layer.renderPolygons(neighborFeatures.value, {
    fillColor: lineColor,
    fillAlpha: 0.22,
    lineColor,
    lineWidth: 2,
    lift: neighborLift,
    pixelScale: px
  })
  layer.renderPolygons(grid.value.features, {
    fillColor: settings.fillColor as string,
    fillAlpha: settings.fillOpacity as number,
    lineColor,
    lineWidth: settings.lineWidth as number,
    lift,
    pixelScale: px
  })
  if (selectedFeature.value) {
    layer.renderPolygons([selectedFeature.value], {
      fillColor: lineColor,
      fillAlpha: 0.35,
      lineColor: '#f8fafc',
      lineWidth: 3,
      lift: selectedLift,
      pixelScale: px
    })
  }
  if (settings.showLabels && zoom.value >= system.labelMinZoom(resolution.value)) {
    layer.renderLabels(labelsFrom(grid.value.features), {
      lineColor,
      lift: labelLift,
      pixelScale: px
    })
  }
}

async function ensureLoaded(): Promise<void> {
  if (loaded || !system) return
  if (system.load) {
    loading.value = true
    await system.load()
  }
  loaded = true
  loading.value = false
}

async function rebuild(): Promise<void> {
  if (!system || !viewer || viewer.isDestroyed()) return
  const token = ++buildToken
  try {
    await ensureLoaded()
  } catch (reason) {
    if (token === buildToken) {
      error.value = `引擎加载失败：${errorMessage(reason)}`
      loading.value = false
    }
    return
  }
  if (token !== buildToken) return
  syncZoom()
  const bounds = currentBounds()
  try {
    const fc = system.buildGrid(
      {
        west: bounds.west,
        south: bounds.south,
        east: bounds.east,
        north: bounds.north
      },
      resolution.value,
      settings
    )
    if (token !== buildToken) return
    grid.value = fc
    gridIds.clear()
    for (const feature of fc.features) {
      if (feature.id !== undefined && feature.id !== null) gridIds.add(String(feature.id))
    }
    cellCount.value = fc.features.length
    error.value = null
  } catch (reason) {
    if (token !== buildToken) return
    grid.value = EMPTY
    gridIds.clear()
    cellCount.value = 0
    error.value = errorMessage(reason)
  }
  updateOverlays()
  overlayData.value = system.overlay ? system.overlay(settings) : null
  render()
}

function scheduleRebuild(delay = 160): void {
  if (buildTimer) window.clearTimeout(buildTimer)
  buildTimer = window.setTimeout(() => {
    buildTimer = undefined
    void rebuild()
  }, delay)
}

function selectAt(position: Cartesian2): void {
  if (!system || !layer) return
  // 优先直接拾取光标下已渲染的网格实例，保证选中单元与视觉完全一致。
  const pickedId = layer.pickCellId(position)
  let id: string | null =
    pickedId && gridIds.has(pickedId) ? pickedId : null
  if (!id) {
    const picked = pickLonLat(position)
    if (!picked) return
    try {
      id = system.cellAt(picked.lon, picked.lat, resolution.value, settings)
    } catch (reason) {
      showBanner(`拾取失败：${errorMessage(reason)}`)
      return
    }
  }
  if (!id) return
  selectedId.value = id
  updateOverlays()
  render()
}

function onLeftClick(event: { position: Cartesian2 }): void {
  selectAt(event.position)
}

function onMouseMove(event: { endPosition: Cartesian2 }): void {
  const now = performance.now()
  if (now - lastMoveAt < 80) return
  lastMoveAt = now
  const picked = pickLonLat(event.endPosition)
  cursor.value = picked
}

function onCameraMoveEnd(): void {
  syncZoom()
  scheduleRebuild(180)
}

function resetView(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.flyHome(0)
  scheduleRebuild(320)
}

function zoomToCell(): void {
  const feature = selectedFeature.value
  if (!feature || !viewer || viewer.isDestroyed()) return
  const lons: number[] = []
  const lats: number[] = []
  for (const ring of feature.geometry.coordinates) {
    for (const [lon, lat] of ring) {
      lons.push(lon)
      lats.push(lat)
    }
  }
  if (lons.length === 0) return
  const west = Math.max(-180, Math.min(...lons))
  const east = Math.min(180, Math.max(...lons))
  const south = Math.max(-90, Math.min(...lats))
  const north = Math.min(90, Math.max(...lats))
  if (east <= west || north <= south) return
  viewer.camera.flyTo({
    destination: Rectangle.fromDegrees(west, south, east, north),
    duration: 0.8
  })
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function exportGeoJson(): void {
  if (!system) return
  download(
    `${system.exportName}.geojson`,
    JSON.stringify(grid.value, null, 2),
    'application/geo+json'
  )
  showBanner('已导出 GeoJSON')
}

function exportCsv(): void {
  if (!system) return
  const header = system.csvColumns.join(',')
  const rows = grid.value.features.map((feature) => system.csvRow(feature, settings).join(','))
  download(`${system.exportName}.csv`, [header, ...rows].join('\n'), 'text/csv')
  showBanner('已导出 CSV')
}

function copyId(): void {
  if (!selectedId.value) return
  navigator.clipboard?.writeText(selectedId.value).then(
    () => showBanner('已复制单元 ID'),
    () => showBanner('复制失败')
  )
}

function addAsLayer(): void {
  showBanner('已加入图层（演示环境可导出为 GeoJSON / CSV）')
}

function fieldValue(key: string): string {
  return String(settings[key] ?? '')
}

function setField(key: string, value: string): void {
  settings[key] = key === 'aperture' ? Number(value) : value
}

function isChecked(key: string): boolean {
  return Boolean(settings[key])
}

function setChecked(key: string, value: boolean): void {
  settings[key] = value
}

function fieldDisabled(field: PanelField): boolean {
  if (field.kind !== 'select' || field.disabledKey === undefined) return false
  return settings[field.disabledKey] !== field.disabledWhen
}

function setResolution(value: string): void {
  settings.resolution = Number(value)
}

const statusNote = computed(() =>
  system ? system.statusNote?.(settings, resolution.value) ?? '' : ''
)

const resolutionMin = computed(() => system?.minResolution ?? 0)
const resolutionMax = computed(() => system?.maxResolution ?? 0)
const resolutionStep = computed(() => system?.resolutionStep ?? 1)

watch(
  () => ({ ...settings }),
  (next, previous) => {
    if (!system) return
    if (GEOMETRY_KEYS.some((key) => next[key] !== previous[key])) {
      // 关闭自动分辨率时，采用当前相机推得的缩放层级，避免网格突跳到陈旧的滑块值。
      if (previous.autoResolution && !next.autoResolution) {
        const current = system.resolutionForZoom(zoom.value, settings)
        if (settings.resolution !== current) settings.resolution = current
      }
      scheduleRebuild(0)
      return
    }
    if (
      next.includeNeighbors !== previous.includeNeighbors ||
      next.includeParents !== previous.includeParents
    ) {
      updateOverlays()
    }
    if (next.showIcosahedron !== previous.showIcosahedron) {
      overlayData.value = system.overlay ? system.overlay(settings) : null
    }
    render()
  },
  { deep: true }
)

onMounted(async () => {
  if (!system) return
  const el = mapEl.value
  if (!el) return
  try {
    const callbacks: SceneCallbacks = {
      onStatus: (message) => {
        if (message) showBanner(message)
      }
    }
    viewer = createMapScene(el, callbacks)
    loadBingImagery(viewer, callbacks)
    layer = new DggsCesiumLayer(viewer)
    handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction(onLeftClick, ScreenSpaceEventType.LEFT_CLICK)
    handler.setInputAction(onMouseMove, ScreenSpaceEventType.MOUSE_MOVE)
    viewer.camera.moveEnd.addEventListener(onCameraMoveEnd)
  } catch (reason) {
    error.value = errorMessage(reason)
    return
  }
  syncZoom()
  await rebuild()
})

onBeforeUnmount(() => {
  if (buildTimer) window.clearTimeout(buildTimer)
  if (bannerTimer) window.clearTimeout(bannerTimer)
  handler?.destroy()
  handler = undefined
  layer?.dispose()
  layer = undefined
  if (viewer && !viewer.isDestroyed()) {
    viewer.camera.moveEnd.removeEventListener(onCameraMoveEnd)
  }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div v-if="system" class="dggs-shell">
    <div ref="mapEl" class="dggs-map"></div>

    <aside class="dggs-panel">
      <div class="panel-title">{{ system.title }}</div>
      <div class="panel-subtitle">{{ system.subtitle }}</div>

      <div v-if="error" class="dggs-error">{{ error }}</div>

      <div class="section-title">网格</div>
      <label class="switch-row">
        <span>自动分辨率</span>
        <input
          type="checkbox"
          :checked="settings.autoResolution"
          @change="setChecked('autoResolution', ($event.target as HTMLInputElement).checked)"
        />
      </label>

      <label class="control-row">
        <span class="row-label">{{ system.resolutionName }}</span>
        <select
          v-if="system.resolutionOptions"
          :value="String(settings.resolution)"
          :disabled="settings.autoResolution"
          @change="setResolution(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="option in system.resolutionOptions" :key="option" :value="String(option)">
            {{ option }}
          </option>
        </select>
        <span v-else class="row-value">{{ resolution }}</span>
      </label>
      <input
        v-if="!system.resolutionOptions"
        class="range-input"
        type="range"
        :min="resolutionMin"
        :max="resolutionMax"
        :step="resolutionStep"
        :value="settings.resolution"
        :disabled="settings.autoResolution"
        @input="setResolution(($event.target as HTMLInputElement).value)"
      />

      <template v-if="system.extraFields">
        <template v-for="field in system.extraFields" :key="field.key">
          <label v-if="field.kind === 'select'" class="control-row">
            <span class="row-label">{{ field.label }}</span>
            <select
              :value="fieldValue(field.key)"
              :disabled="fieldDisabled(field)"
              @change="setField(field.key, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="option in field.options" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
          <label v-else class="switch-row">
            <span>{{ field.label }}</span>
            <input
              type="checkbox"
              :checked="isChecked(field.key)"
              @change="setChecked(field.key, ($event.target as HTMLInputElement).checked)"
            />
          </label>
        </template>
      </template>

      <div class="section-title">样式</div>
      <label class="control-row">
        <span class="row-label">填充颜色</span>
        <input
          class="color-input"
          type="color"
          :value="settings.fillColor"
          @input="setField('fillColor', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="control-row">
        <span class="row-label">填充不透明度</span>
        <input
          class="range-input"
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="settings.fillOpacity"
          @input="settings.fillOpacity = Number(($event.target as HTMLInputElement).value)"
        />
        <span class="row-value">{{ settings.fillOpacity.toFixed(2) }}</span>
      </label>
      <label class="control-row">
        <span class="row-label">轮廓颜色</span>
        <input
          class="color-input"
          type="color"
          :value="settings.lineColor"
          @input="setField('lineColor', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="control-row">
        <span class="row-label">轮廓宽度</span>
        <input
          class="range-input"
          type="range"
          min="0.1"
          max="8"
          step="0.1"
          :value="settings.lineWidth"
          @input="settings.lineWidth = Number(($event.target as HTMLInputElement).value)"
        />
        <span class="row-value">{{ settings.lineWidth.toFixed(1) }}</span>
      </label>
      <label class="switch-row">
        <span>显示单元 ID</span>
        <input
          type="checkbox"
          :checked="settings.showLabels"
          @change="setChecked('showLabels', ($event.target as HTMLInputElement).checked)"
        />
      </label>
      <label class="switch-row">
        <span>包含选中单元邻域</span>
        <input
          type="checkbox"
          :checked="settings.includeNeighbors"
          @change="setChecked('includeNeighbors', ($event.target as HTMLInputElement).checked)"
        />
      </label>
      <label class="switch-row">
        <span>包含选中单元父级</span>
        <input
          type="checkbox"
          :checked="settings.includeParents"
          @change="setChecked('includeParents', ($event.target as HTMLInputElement).checked)"
        />
      </label>

      <div class="section-title">选中单元</div>
      <div class="dggs-identify">
        <template v-if="selectedId && selectedFeature">
          <dl>
            <template v-for="row in system.identify(selectedId, settings, selectedFeature)" :key="row.label">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </template>
          </dl>
          <div class="dggs-identify-actions">
            <button type="button" class="action-button" @click="copyId">复制 ID</button>
            <button type="button" class="action-button" @click="zoomToCell">缩放到单元</button>
          </div>
        </template>
        <p v-else class="dggs-hint">点击地图以识别 {{ system.english }} 单元。</p>
      </div>

      <div class="dggs-actions">
        <button type="button" class="action-button" @click="exportGeoJson">导出 GeoJSON</button>
        <button type="button" class="action-button" @click="exportCsv">导出 CSV</button>
        <button type="button" class="action-button" @click="addAsLayer">添加网格为图层</button>
        <button type="button" class="action-button ghost" @click="resetView">重置视图</button>
      </div>
    </aside>

    <div class="dggs-status">
      <span>{{ system.english }}</span>
      <span>{{ system.resolutionName }} {{ resolution }}</span>
      <span>视域 {{ cellCount.toLocaleString() }} 个单元</span>
      <span v-if="cursor">
        光标 {{ cursor.lat.toFixed(4) }}, {{ cursor.lon.toFixed(4) }}
      </span>
      <span>缩放 {{ zoom.toFixed(2) }}</span>
      <span v-if="statusNote" class="dggs-status-note">{{ statusNote }}</span>
    </div>

    <div v-if="loading" class="dggs-loading">正在加载 WASM 网格引擎…</div>
    <div v-if="banner" class="dggs-banner">{{ banner }}</div>
  </div>

  <div v-else class="dggs-missing">未找到网格系统：{{ systemId }}</div>
</template>

<style scoped>
.dggs-shell {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 8px;
  background: #152b4c;
  color: #dce8f5;
  font: 12px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif;
}

.dggs-map {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.dggs-panel {
  position: absolute;
  z-index: 10;
  top: 12px;
  right: 12px;
  width: 260px;
  max-height: calc(100% - 24px);
  overflow-y: auto;
  padding: 12px;
  box-sizing: border-box;
  border: 1px solid rgba(157, 188, 224, 0.28);
  border-radius: 9px;
  background: rgba(10, 26, 52, 0.86);
  backdrop-filter: blur(6px);
  color: #dce8f5;
}

.panel-title {
  font-size: 12px;
  font-weight: 700;
  color: #eaf2ff;
}

.panel-subtitle {
  margin-top: 2px;
  margin-bottom: 6px;
  font-size: 10px;
  color: #8ea5c2;
}

.section-title {
  margin-top: 8px;
  margin-bottom: 4px;
  padding-bottom: 2px;
  border-bottom: 1px solid rgba(157, 188, 224, 0.16);
  font-size: 11px;
  color: #8ea5c2;
}

.dggs-error {
  margin: 8px 0;
  padding: 7px 9px;
  border: 1px solid rgba(248, 113, 113, 0.4);
  border-radius: 6px;
  background: rgba(127, 29, 29, 0.35);
  color: #fecaca;
  font-size: 11px;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 11px;
  color: #c3d5e8;
}

.row-label {
  flex: 0 0 auto;
}

.row-value {
  min-width: 30px;
  margin-left: auto;
  text-align: right;
  color: #eaf2ff;
  font-variant-numeric: tabular-nums;
}

.control-row select {
  min-width: 96px;
  height: 22px;
  margin-left: auto;
  padding: 0 5px;
  border: 1px solid rgba(157, 188, 224, 0.28);
  border-radius: 4px;
  background: rgba(8, 21, 40, 0.55);
  color: #e6eef9;
  font-size: 10px;
  box-sizing: border-box;
}

.control-row select:disabled {
  opacity: 0.45;
}

.range-input {
  flex: 1;
  min-width: 0;
  accent-color: #2f80ed;
}

.range-input:disabled {
  opacity: 0.45;
}

.color-input {
  width: 36px;
  height: 22px;
  margin-left: auto;
  padding: 0;
  border: 1px solid rgba(157, 188, 224, 0.28);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 0;
  font-size: 11px;
  color: #c3d5e8;
  cursor: pointer;
}

.switch-row input {
  accent-color: #2f80ed;
}

.dggs-identify {
  padding-top: 2px;
}

.dggs-identify dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 10px;
  margin: 0;
  font-size: 11px;
}

.dggs-identify dt {
  color: #8ea5c2;
}

.dggs-identify dd {
  margin: 0;
  color: #eaf2ff;
  word-break: break-all;
  font-variant-numeric: tabular-nums;
}

.dggs-identify-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.dggs-hint {
  margin: 4px 0 0;
  color: #8ea5c2;
  font-size: 11px;
}

.dggs-actions {
  display: grid;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(157, 188, 224, 0.16);
}

.action-button {
  flex: 1;
  min-height: 26px;
  padding: 5px 8px;
  border: 1px solid rgba(157, 188, 224, 0.32);
  border-radius: 5px;
  background: rgba(47, 128, 237, 0.18);
  color: #dce8f5;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.18s;
}

.action-button:hover {
  background: rgba(47, 128, 237, 0.32);
}

.action-button.ghost {
  background: rgba(8, 21, 40, 0.4);
}

.dggs-status {
  position: absolute;
  z-index: 5;
  bottom: 12px;
  left: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  max-width: calc(100% - 300px);
  padding: 6px 10px;
  border: 1px solid rgba(157, 188, 224, 0.22);
  border-radius: 8px;
  background: rgba(8, 21, 40, 0.88);
  color: #9fb8d4;
  font-size: 11px;
  pointer-events: none;
}

.dggs-status-note {
  color: #7cb3ff;
}

.dggs-loading {
  position: absolute;
  z-index: 6;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  border: 1px solid rgba(157, 188, 224, 0.3);
  border-radius: 999px;
  background: rgba(10, 26, 52, 0.92);
  color: #dce8f5;
  font-size: 11px;
}

.dggs-banner {
  position: absolute;
  z-index: 7;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 8px;
  background: rgba(47, 128, 237, 0.92);
  color: #fff;
  font-size: 11px;
}

.dggs-missing {
  display: grid;
  place-items: center;
  height: 100%;
  color: #9fb8d2;
}
</style>
