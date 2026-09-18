<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import * as Cesium from 'cesium'
import { createMapScene, destroyScene, loadBingImagery } from '../../lib/cesium-scene'
import { pickCartographic } from '../measure-lib/pick'
import { buildDefaultCity, type BuildingBox, type CityModel } from '../sunshine-lib/city'
import {
  applyBuildingStyles,
  renderCityBuildings,
  type BuildingRenderEntry
} from '../urban-analysis-lib/render'
import { pointInPolygon, polygonAreaSquareMeters } from '../urban-analysis-lib/geometry'
import { HEIGHT_RESTRICTION_HELP } from '../urban-analysis-lib/help'

type Ring = { lon: number; lat: number }
type DrawMode = 'none' | 'polygon' | 'rectangle'

const ZONE_VOLUME_ID = 'height-zone-volume'
const ZONE_TOP_ID = 'height-zone-top'
const ZONE_OUTLINE_ID = 'height-zone-outline'
const ZONE_LABEL_ID = 'height-zone-label'
const PREVIEW_ID = 'height-zone-preview'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const isLoaded = ref(false)
const drawMode = ref<DrawMode>('none')
const helpOpen = ref(false)
const activeHelpKey = ref<string | undefined>(HEIGHT_RESTRICTION_HELP[0]?.key)

const zoneRing = shallowRef<Ring[]>([])
const buildingCount = ref(0)

const form = reactive({
  limitHeight: 60,
  heightMode: 'relative' as 'relative' | 'absolute',
  groundBase: 0
})

const display = reactive({
  showVolume: true,
  volumeOpacity: 0.24,
  volumeColor: '#37c6ff',
  showTop: true,
  topOpacity: 0.3,
  showOutline: true,
  showBuildings: true,
  buildingOpacity: 0.9,
  onlyViolations: false,
  highlightColor: '#ff4d4f'
})

const city = shallowRef<CityModel | undefined>()
let viewer: Cesium.Viewer | undefined
let handler: Cesium.ScreenSpaceEventHandler | undefined
let buildingEntries: BuildingRenderEntry[] = []
let tempRing: Ring[] = []
let rectAnchor: Ring | null = null

const zoneBottom = computed(() => (form.heightMode === 'relative' ? form.groundBase : 0))
const limitTop = computed(() =>
  form.heightMode === 'relative' ? form.groundBase + form.limitHeight : form.limitHeight
)

const stats = computed(() => {
  const model = city.value
  const ring = zoneRing.value
  const empty = {
    total: 0,
    violationCount: 0,
    compliantCount: 0,
    violationRate: 0,
    maxExceedance: 0,
    avgExceedance: 0,
    maxHeight: 0,
    minHeight: 0,
    avgHeight: 0,
    area: 0,
    violationIds: new Set<string>(),
    rows: [] as { building: BuildingBox; exceedance: number }[]
  }
  if (!model || ring.length < 3) return empty
  const inside = model.buildings.filter((b) => pointInPolygon((b.west + b.east) / 2, (b.south + b.north) / 2, ring))
  const top = limitTop.value
  const rows = inside
    .filter((b) => b.topHeight > top)
    .map((b) => ({ building: b, exceedance: b.topHeight - top }))
    .sort((a, b) => b.exceedance - a.exceedance)
  const heights = inside.map((b) => b.topHeight)
  const totalExceed = rows.reduce((sum, row) => sum + row.exceedance, 0)
  return {
    total: inside.length,
    violationCount: rows.length,
    compliantCount: inside.length - rows.length,
    violationRate: inside.length > 0 ? (rows.length / inside.length) * 100 : 0,
    maxExceedance: rows.length > 0 ? rows[0].exceedance : 0,
    avgExceedance: rows.length > 0 ? totalExceed / rows.length : 0,
    maxHeight: heights.length > 0 ? Math.max(...heights) : 0,
    minHeight: heights.length > 0 ? Math.min(...heights) : 0,
    avgHeight: heights.length > 0 ? heights.reduce((s, h) => s + h, 0) / heights.length : 0,
    area: polygonAreaSquareMeters(ring, model.center.lat),
    violationIds: new Set(rows.map((row) => row.building.id)),
    rows
  }
})

const zoneAreaText = computed(() => {
  const area = stats.value.area
  if (area <= 0) return '—'
  return area >= 100000 ? `${(area / 1000000).toFixed(3)} km²` : `${Math.round(area)} m²`
})

function defaultRing(model: CityModel): Ring[] {
  const dLon = 0.0021
  const dLat = 0.0018
  const { lon, lat } = model.center
  return [
    { lon: lon - dLon, lat: lat - dLat },
    { lon: lon + dLon, lat: lat - dLat },
    { lon: lon + dLon, lat: lat + dLat },
    { lon: lon - dLon, lat: lat + dLat }
  ]
}

function cartesianFromRing(ring: Ring[]): Cesium.Cartesian3[] {
  const flat: number[] = []
  for (const point of ring) flat.push(point.lon, point.lat)
  return Cesium.Cartesian3.fromDegreesArray(flat)
}

function refreshStyles(): void {
  if (!viewer) return
  const ids = stats.value.violationIds
  for (const entry of buildingEntries) {
    entry.entity.show = display.showBuildings && (!display.onlyViolations || ids.has(entry.building.id))
  }
  applyBuildingStyles(buildingEntries, {
    opacity: display.buildingOpacity,
    highlight: ids,
    violationColor: Cesium.Color.fromCssColorString(display.highlightColor)
  })
}

function removeZoneVisuals(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const id of [ZONE_VOLUME_ID, ZONE_TOP_ID, ZONE_OUTLINE_ID, ZONE_LABEL_ID, PREVIEW_ID]) {
    viewer.entities.removeById(id)
  }
}

function renderZone(): void {
  if (!viewer || viewer.isDestroyed()) return
  removeZoneVisuals()
  const ring = zoneRing.value
  if (ring.length < 3) return
  const hierarchyPositions = cartesianFromRing(ring)
  const volumeColor = Cesium.Color.fromCssColorString(display.volumeColor)

  if (display.showVolume) {
    viewer.entities.add({
      id: ZONE_VOLUME_ID,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(hierarchyPositions),
        height: zoneBottom.value,
        extrudedHeight: limitTop.value,
        material: volumeColor.withAlpha(display.volumeOpacity),
        outline: false,
        perPositionHeight: false
      }
    })
  }

  if (display.showTop) {
    viewer.entities.add({
      id: ZONE_TOP_ID,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(hierarchyPositions),
        height: limitTop.value,
        material: volumeColor.withAlpha(display.topOpacity),
        outline: true,
        outlineColor: volumeColor.withAlpha(0.95)
      }
    })
  }

  if (display.showOutline) {
    viewer.entities.add({
      id: ZONE_OUTLINE_ID,
      polyline: {
        positions: [...hierarchyPositions, hierarchyPositions[0]],
        width: 2,
        material: volumeColor,
        clampToGround: false
      }
    })
  }

  const labelPosition = Cesium.Cartesian3.fromDegrees(ring[0].lon, ring[0].lat, limitTop.value)
  viewer.entities.add({
    id: ZONE_LABEL_ID,
    position: labelPosition,
    label: {
      text: `限高 ${limitTop.value.toFixed(0)} m`,
      font: 'bold 12px sans-serif',
      fillColor: Cesium.Color.fromCssColorString('#e8f7ff'),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('#0a1c33').withAlpha(0.8),
      pixelOffset: new Cesium.Cartesian2(0, -14),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM
    }
  })
}

function previewRing(cursor?: Ring): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.entities.removeById(PREVIEW_ID)
  const ring = cursor ? [...tempRing, cursor] : [...tempRing]
  if (ring.length < 2) return
  const positions = cartesianFromRing(ring)
  if (ring.length >= 3) {
    viewer.entities.add({
      id: PREVIEW_ID,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: Cesium.Color.YELLOW.withAlpha(0.2),
        outline: true,
        outlineColor: Cesium.Color.YELLOW.withAlpha(0.9)
      }
    })
  } else {
    viewer.entities.add({
      id: PREVIEW_ID,
      polyline: { positions, width: 2, material: Cesium.Color.YELLOW }
    })
  }
}

function clearHandler(): void {
  if (!handler) return
  handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
  handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE)
  handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK)
}

function pickRing(position: Cesium.Cartesian2): Ring | undefined {
  if (!viewer) return undefined
  const carto = pickCartographic(viewer.scene, position)
  if (!carto) return undefined
  return { lon: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) }
}

function cancelDraw(): void {
  drawMode.value = 'none'
  tempRing = []
  rectAnchor = null
  clearHandler()
  if (viewer) viewer.entities.removeById(PREVIEW_ID)
}

function startPolygonDraw(): void {
  if (!viewer || !handler) return
  cancelDraw()
  drawMode.value = 'polygon'
  tempRing = []
  handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const point = pickRing(movement.position)
    if (!point) return
    tempRing.push(point)
    previewRing()
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
  handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
    const point = pickRing(movement.endPosition)
    if (point) previewRing(point)
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
  handler.setInputAction(() => finishPolygonDraw(), Cesium.ScreenSpaceEventType.RIGHT_CLICK)
}

function finishPolygonDraw(): void {
  if (tempRing.length >= 3) {
    zoneRing.value = tempRing.slice()
    renderZone()
    refreshStyles()
  }
  cancelDraw()
}

function startRectangleDraw(): void {
  if (!viewer || !handler) return
  cancelDraw()
  drawMode.value = 'rectangle'
  rectAnchor = null
  handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const point = pickRing(movement.position)
    if (!point) return
    if (!rectAnchor) {
      rectAnchor = point
    } else {
      zoneRing.value = rectangleRing(rectAnchor, point)
      renderZone()
      refreshStyles()
      cancelDraw()
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
  handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
    if (!rectAnchor) return
    const point = pickRing(movement.endPosition)
    if (!point) return
    tempRing = rectangleRing(rectAnchor, point)
    previewRing()
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
}

function rectangleRing(a: Ring, b: Ring): Ring[] {
  return [
    { lon: a.lon, lat: a.lat },
    { lon: b.lon, lat: a.lat },
    { lon: b.lon, lat: b.lat },
    { lon: a.lon, lat: b.lat }
  ]
}

function resetZone(): void {
  const model = city.value
  if (!model) return
  zoneRing.value = defaultRing(model)
  renderZone()
  refreshStyles()
}

function clearZone(): void {
  cancelDraw()
  zoneRing.value = []
  removeZoneVisuals()
  refreshStyles()
}

function toggleHelp(key: string): void {
  activeHelpKey.value = activeHelpKey.value === key ? undefined : key
}

watch(
  [() => form.limitHeight, () => form.heightMode, () => form.groundBase, () => display.showVolume, () => display.showTop, () => display.showOutline, () => display.volumeOpacity, () => display.topOpacity, () => display.volumeColor],
  () => {
    renderZone()
    refreshStyles()
  }
)

watch(
  [() => display.showBuildings, () => display.buildingOpacity, () => display.onlyViolations, () => display.highlightColor, stats],
  () => refreshStyles()
)

onMounted(() => {
  if (!container.value) return
  const model = buildDefaultCity()
  city.value = model
  buildingCount.value = model.buildings.length

  viewer = createMapScene(container.value)
  handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  loadBingImagery(viewer, { onStatus: (message) => (statusMessage.value = message) })
  buildingEntries = renderCityBuildings(viewer, model, display.buildingOpacity)

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(model.center.lon, model.center.lat - 0.0045, 1250),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-38),
      roll: 0
    },
    duration: 0
  })

  resetZone()
  isLoaded.value = true
})

onBeforeUnmount(() => {
  cancelDraw()
  handler?.destroy()
  handler = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="hr-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">空间分析-控高分析</div>

      <div class="section-title">限高区域</div>
      <div class="button-row">
        <button class="action-button" :class="{ active: drawMode === 'polygon' }" :disabled="!isLoaded" @click="startPolygonDraw">
          多边形
        </button>
        <button class="action-button" :class="{ active: drawMode === 'rectangle' }" :disabled="!isLoaded" @click="startRectangleDraw">
          矩形
        </button>
      </div>
      <div class="button-row">
        <button class="action-button ghost" :disabled="!isLoaded" @click="resetZone">默认区域</button>
        <button class="action-button ghost" :disabled="!isLoaded" @click="clearZone">清除区域</button>
      </div>
      <div class="row-note">
        {{ drawMode === 'none' ? '点击地图可拾取顶点；右键闭合多边形' : drawMode === 'polygon' ? '左键逐点绘制，右键闭合' : '左键两次确定矩形对角点' }}
      </div>
      <div class="row-note">区域面积 {{ zoneAreaText }} · 顶点 {{ zoneRing.length }}</div>

      <div class="section-title">限高参数</div>
      <div class="control-row">
        <span class="row-label">限高模式</span>
        <select v-model="form.heightMode">
          <option value="relative">相对地面</option>
          <option value="absolute">绝对海拔</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">限高值</span>
        <input v-model.number="form.limitHeight" type="range" min="10" max="200" step="5" />
        <span class="row-value">{{ form.limitHeight }}m</span>
      </div>
      <div class="control-row">
        <span class="row-label">限高面</span>
        <span class="row-value wide">{{ limitTop.toFixed(0) }}m</span>
      </div>
      <div class="control-row" v-if="form.heightMode === 'relative'">
        <span class="row-label">地面基准</span>
        <input v-model.number="form.groundBase" type="range" min="0" max="60" step="1" />
        <span class="row-value">{{ form.groundBase }}m</span>
      </div>

      <div class="section-title">限高体样式</div>
      <label class="switch-row"><span>显示限高体</span><input v-model="display.showVolume" type="checkbox" /></label>
      <div class="control-row">
        <span class="row-label">柱体透明度</span>
        <input v-model.number="display.volumeOpacity" type="range" min="0.05" max="0.6" step="0.01" :disabled="!display.showVolume" />
        <span class="row-value">{{ display.volumeOpacity.toFixed(2) }}</span>
      </div>
      <label class="switch-row"><span>限高顶面</span><input v-model="display.showTop" type="checkbox" /></label>
      <label class="switch-row"><span>区域轮廓</span><input v-model="display.showOutline" type="checkbox" /></label>
      <div class="control-row">
        <span class="row-label">柱体颜色</span>
        <input v-model="display.volumeColor" type="color" />
      </div>

      <div class="section-title">建筑与检测</div>
      <label class="switch-row"><span>显示建筑</span><input v-model="display.showBuildings" type="checkbox" /></label>
      <label class="switch-row"><span>仅显示超高建筑</span><input v-model="display.onlyViolations" type="checkbox" /></label>
      <div class="control-row">
        <span class="row-label">建筑透明度</span>
        <input v-model.number="display.buildingOpacity" type="range" min="0.2" max="1" step="0.05" />
        <span class="row-value">{{ display.buildingOpacity.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">高超颜色</span>
        <input v-model="display.highlightColor" type="color" />
      </div>

      <div class="section-title">统计结果</div>
      <div class="stat-grid">
        <div class="stat-cell"><span>建筑总数</span><b>{{ stats.total }}</b></div>
        <div class="stat-cell"><span>超高数</span><b class="danger">{{ stats.violationCount }}</b></div>
        <div class="stat-cell"><span>超高率</span><b>{{ stats.violationRate.toFixed(1) }}%</b></div>
        <div class="stat-cell"><span>最大超高</span><b class="danger">{{ stats.maxExceedance.toFixed(1) }}m</b></div>
        <div class="stat-cell"><span>平均超高</span><b>{{ stats.avgExceedance.toFixed(1) }}m</b></div>
        <div class="stat-cell"><span>平均高度</span><b>{{ stats.avgHeight.toFixed(1) }}m</b></div>
      </div>

      <button class="help-toggle" @click="helpOpen = !helpOpen">功能实现说明</button>
      <div v-if="helpOpen" class="help-panel">
        <div class="help-head">
          <span>功能实现说明</span>
          <button class="help-close" @click="helpOpen = false">×</button>
        </div>
        <div v-for="item in HEIGHT_RESTRICTION_HELP" :key="item.key" class="help-item">
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
        在场景中绘制或选择限高区域并设定限高值，系统自动识别区域内超高建筑并高亮；街区共 {{ buildingCount }} 栋建筑。
      </p>
    </div>

    <div v-if="!isLoaded" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.hr-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #0f2438; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 5px; width: 282px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; box-sizing: border-box; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 26, 44, 0.9); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.panel-title { font-size: 12px; font-weight: 700; margin-bottom: 2px; }
.section-title { margin-top: 7px; margin-bottom: 2px; padding-bottom: 2px; border-bottom: 1px solid rgba(137, 210, 233, 0.16); font-size: 11px; font-weight: 700; color: #7fd0e6; }
.button-row { display: flex; gap: 6px; }
.action-button { flex: 1; min-height: 26px; border: 1px solid rgba(137, 210, 233, 0.35); border-radius: 5px; background: #143450; color: #d9eff6; cursor: pointer; font-size: 11px; }
.action-button.active { background: #257f9e; border-color: #45b4d6; }
.action-button.ghost { background: rgba(20, 52, 80, 0.6); }
.action-button:disabled { cursor: default; opacity: 0.5; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 2px 0; color: #c3d8e6; }
.row-label { flex: 0 0 auto; }
.row-value { flex: 0 0 56px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.row-value.wide { flex: 0 0 auto; color: #ffd666; }
.row-note { font-size: 10px; color: #7fd0e6; line-height: 1.5; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row select { width: 128px; height: 22px; padding: 0 5px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.control-row input[type="color"] { width: 40px; height: 22px; padding: 0; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; }
.switch-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; color: #c3d8e6; }
.switch-row input { cursor: pointer; }
.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 2px; }
.stat-cell { display: flex; flex-direction: column; gap: 2px; padding: 5px 4px; border: 1px solid rgba(137, 210, 233, 0.2); border-radius: 5px; background: rgba(16, 43, 64, 0.55); text-align: center; }
.stat-cell span { font-size: 9px; color: #8fb0c8; }
.stat-cell b { font-size: 12px; color: #d9eff6; }
.stat-cell b.danger { color: #ff7875; }
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
