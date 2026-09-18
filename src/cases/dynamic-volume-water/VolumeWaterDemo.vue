<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartographic,
  Color,
  PointPrimitiveCollection,
  PolylineCollection,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Cartesian2,
  type Cartesian3
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, loadWorldTerrain, type SceneCallbacks } from '../../lib/cesium-scene'
import { pickCartographic, pickPosition } from '../measure-lib/pick'
import { makeLineMaterial } from '../measure-lib/material'
import { WATER_RANGE_MODES, VolumeWaterSurface, type PolygonPosition } from './VolumeWaterSurface'
import { LIJIANG_WATER_POSITIONS } from '../water-reflection/water-positions'

const TO_DEGREES = 180 / Math.PI

const DEFAULT_POLYGON_TEXT = LIJIANG_WATER_POSITIONS.map(
  ([lon, lat]) => `${lon},${lat}`
).join('; ')

const container = ref<HTMLElement>()
const statusMessage = ref('')
const resultMessage = ref('')

const animate = ref(true)
const timeScale = ref(1)
const speed = ref(0.72)
const waveScale = ref(12)
const waveHeight = ref(0.82)
const geometryWaveHeight = ref(520)
const choppy = ref(4.2)
const foam = ref(0.58)
const normalStrength = ref(1.9)
const fresnel = ref(0.78)
const specular = ref(2.35)
const alpha = ref(0.92)
const deepColor = ref('#084260')
const shallowColor = ref('#36c0c6')
const foamColor = ref('#e7faff')

const rangeMode = ref<string>(WATER_RANGE_MODES.POLYGON)
const meshSegments = ref(160)
const planeWidth = ref(7200)
const planeDepth = ref(4200)
const planeHeight = ref(2400)
const planeLon = ref(100.66)
const planeLat = ref(26.55)
const polygonText = ref(DEFAULT_POLYGON_TEXT)

const drawing = ref(false)

let viewer: ReturnType<typeof createMapScene> | undefined
let surface: VolumeWaterSurface | undefined
let handler: ScreenSpaceEventHandler | undefined
let vertexPoints: PointPrimitiveCollection | undefined
let previewLine: PolylineCollection | undefined
let currentVertices: Cartesian3[] = []
let lastPreviewPos: Cartesian3 | undefined
let lastClickTime = 0
let lastClickPos: { x: number; y: number } | undefined
let disposed = false

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16)
  ]
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
}

function parsePolygonText(text: string): PolygonPosition[] | null {
  const parts = text
    .split(/[;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 3) return null

  const points: PolygonPosition[] = []
  for (const part of parts) {
    const match = part.split(',')
    if (match.length !== 2) return null
    const lon = Number(match[0])
    const lat = Number(match[1])
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
    points.push([lon, lat])
  }
  return points
}

function syncMotionUniforms(): void {
  if (!surface) return
  const p = surface.params
  p.animate = animate.value
  p.timeScale = timeScale.value
  p.speed = speed.value
  p.waveScale = waveScale.value
  p.waveHeight = waveHeight.value
  p.geometryWaveHeight = geometryWaveHeight.value
  p.choppy = choppy.value
  p.foam = foam.value
  p.normalStrength = normalStrength.value
  p.fresnel = fresnel.value
  p.specular = specular.value
  p.alpha = alpha.value
  p.deepColor = hexToRgb(deepColor.value)
  p.shallowColor = hexToRgb(shallowColor.value)
  p.foamColor = hexToRgb(foamColor.value)
  surface.updateUniforms()
}

function syncRangeUniforms(): void {
  if (!surface) return
  surface.params.meshSegments = meshSegments.value
  surface.params.planeWidth = planeWidth.value
  surface.params.planeDepth = planeDepth.value
  surface.params.planeHeight = planeHeight.value
  surface.params.planeLon = planeLon.value
  surface.params.planeLat = planeLat.value
}

function applyAreaRebuild(): void {
  if (!surface) return
  syncRangeUniforms()
  surface.rebuild()
  surface.flyTo()
}

function applyPositionUpdate(): void {
  if (!surface) return
  syncRangeUniforms()
  surface.updatePosition()
}

function applyRangeMode(): void {
  if (!surface) return
  if (rangeMode.value === WATER_RANGE_MODES.RECTANGLE) {
    surface.params.rangeMode = WATER_RANGE_MODES.RECTANGLE
  } else {
    if (surface.params.polygonPositions.length < 3) {
      resultMessage.value = '多边形顶点不足，请先指定多边形'
      rangeMode.value = WATER_RANGE_MODES.RECTANGLE
      return
    }
    surface.params.rangeMode = WATER_RANGE_MODES.POLYGON
  }
  surface.rebuild()
  surface.flyTo()
}

function applyPolygonFromText(): void {
  const points = parsePolygonText(polygonText.value)
  if (!points) {
    resultMessage.value = '坐标格式错误，请使用"经度,纬度;经度,纬度"格式'
    return
  }
  if (!surface || !surface.setPolygon(points)) {
    resultMessage.value = '多边形顶点不足，至少需要 3 个点'
    return
  }
  rangeMode.value = WATER_RANGE_MODES.POLYGON
  resultMessage.value = `已应用多边形水面（${points.length} 个顶点）`
}

function updatePreview(): void {
  vertexPoints?.removeAll()
  previewLine?.removeAll()
  if (!drawing.value || currentVertices.length === 0) return

  for (const v of currentVertices) {
    vertexPoints?.add({
      position: v,
      color: Color.fromCssColorString('#ffd166'),
      pixelSize: 8,
      outlineColor: Color.WHITE,
      outlineWidth: 1.5,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    })
  }

  if (currentVertices.length >= 2) {
    const borderPositions = lastPreviewPos
      ? [...currentVertices, lastPreviewPos, currentVertices[0]]
      : [...currentVertices, currentVertices[0]]
    const previewColor = Color.fromCssColorString('#8ab4f8')
    previewColor.alpha = 0.85
    previewLine?.add({
      positions: borderPositions,
      width: 2,
      material: makeLineMaterial(previewColor)
    })
  }
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !drawing.value) return

  const now = performance.now()
  if (
    lastClickPos &&
    now - lastClickTime < 350 &&
    Math.abs(event.position.x - lastClickPos.x) < 6 &&
    Math.abs(event.position.y - lastClickPos.y) < 6
  ) {
    return
  }
  lastClickTime = now
  lastClickPos = { x: event.position.x, y: event.position.y }

  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  currentVertices.push(pos)
  resultMessage.value = `已采集 ${currentVertices.length} 个顶点`
  updatePreview()
}

function onMouseMove(event: { endPosition: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !drawing.value) return
  const pos = pickPosition(viewer.scene, event.endPosition)
  if (!pos) return
  lastPreviewPos = pos
  updatePreview()
}

function finishPolygon(): void {
  if (!drawing.value) return
  drawing.value = false
  lastPreviewPos = undefined
  vertexPoints?.removeAll()
  previewLine?.removeAll()

  if (currentVertices.length < 3) {
    currentVertices.length = 0
    resultMessage.value = '点数不足，至少需要 3 个点'
    return
  }

  const points = currentVertices.map((vertex) => {
    const carto = Cartographic.fromCartesian(vertex)
    return [carto.longitude * TO_DEGREES, carto.latitude * TO_DEGREES] as PolygonPosition
  })
  const rounded = points.map(
    (point) => [Number(point[0].toFixed(5)), Number(point[1].toFixed(5))] as PolygonPosition
  )
  currentVertices.length = 0

  if (!surface || !surface.setPolygon(rounded)) {
    resultMessage.value = '多边形顶点不足'
    return
  }
  polygonText.value = rounded.map((point) => `${point[0]},${point[1]}`).join('; ')
  rangeMode.value = WATER_RANGE_MODES.POLYGON
  resultMessage.value = `多边形水面创建成功（${rounded.length} 个顶点）`
}

function startDraw(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (drawing.value) {
    resultMessage.value = '正在绘制中，右键或双击结束'
    return
  }
  drawing.value = true
  currentVertices.length = 0
  lastPreviewPos = undefined
  lastClickTime = 0
  lastClickPos = undefined
  resultMessage.value = '地图左键添加顶点，右键或双击完成多边形'
}

watch([animate, timeScale, speed, waveScale, waveHeight, geometryWaveHeight, choppy, foam, normalStrength, fresnel, specular, alpha], () => syncMotionUniforms())
watch([deepColor, shallowColor, foamColor], () => syncMotionUniforms())
watch(rangeMode, () => applyRangeMode())

function initWaterScene(): void {
  if (disposed || !viewer || viewer.isDestroyed()) return
  statusMessage.value = ''

  const scene = viewer.scene
  scene.globe.enableLighting = true
  scene.highDynamicRange = true
  scene.postProcessStages.fxaa.enabled = true

  surface = new VolumeWaterSurface({ viewer })
  surface.addToScene()
  surface.flyTo(1)

  vertexPoints = viewer.scene.primitives.add(new PointPrimitiveCollection())
  previewLine = viewer.scene.primitives.add(new PolylineCollection())

  handler = new ScreenSpaceEventHandler(viewer.canvas)
  handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)
  handler.setInputAction((event: { endPosition: Cartesian2 }) => onMouseMove(event), ScreenSpaceEventType.MOUSE_MOVE)
  handler.setInputAction(() => onRightClick(), ScreenSpaceEventType.RIGHT_CLICK)
  handler.setInputAction(() => finishPolygon(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
}

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }

  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.scene.globe.maximumScreenSpaceError = 2
    statusMessage.value = '正在加载Cesium World Terrain...'
    void loadWorldTerrain(viewer)
      .then(() => {
        if (disposed || !viewer || viewer.isDestroyed()) return
        initWaterScene()
      })
      .catch(() => {
        if (disposed || !viewer || viewer.isDestroyed()) return
        initWaterScene()
      })
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

function onRightClick(): void {
  if (drawing.value) finishPolygon()
}

onBeforeUnmount(() => {
  disposed = true
  handler?.destroy()
  handler = undefined
  vertexPoints = undefined
  previewLine = undefined
  surface?.destroy()
  surface = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="vwater-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="vwater-panel">
      <div class="panel-title">动态体积水面</div>

      <div class="toggle-row">
        <span class="toggle-label">波浪动画</span>
        <button class="toggle" :class="{ on: animate }" aria-label="波浪动画开关" @click="animate = !animate"><i></i></button>
      </div>

      <div class="section-title">运动参数</div>
      <div class="param-row"><span class="param-label">时间缩放</span><input v-model.number="timeScale" class="param-slider" type="range" min="0.1" max="3" step="0.01" /><span class="param-value">{{ timeScale.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">流速</span><input v-model.number="speed" class="param-slider" type="range" min="0" max="2" step="0.01" /><span class="param-value">{{ speed.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">波密度</span><input v-model.number="waveScale" class="param-slider" type="range" min="2" max="30" step="0.1" /><span class="param-value">{{ waveScale.toFixed(1) }}</span></div>
      <div class="param-row"><span class="param-label">波高</span><input v-model.number="waveHeight" class="param-slider" type="range" min="0.05" max="2.2" step="0.01" /><span class="param-value">{{ waveHeight.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">几何高度</span><input v-model.number="geometryWaveHeight" class="param-slider" type="range" min="0" max="1800" step="10" /><span class="param-value">{{ geometryWaveHeight }}</span></div>
      <div class="param-row"><span class="param-label">Choppy</span><input v-model.number="choppy" class="param-slider" type="range" min="0.8" max="8" step="0.01" /><span class="param-value">{{ choppy.toFixed(2) }}</span></div>

      <div class="section-title">外观参数</div>
      <div class="param-row"><span class="param-label">泡沫</span><input v-model.number="foam" class="param-slider" type="range" min="0" max="1" step="0.01" /><span class="param-value">{{ foam.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">法线强度</span><input v-model.number="normalStrength" class="param-slider" type="range" min="0.2" max="4" step="0.01" /><span class="param-value">{{ normalStrength.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">菲涅尔</span><input v-model.number="fresnel" class="param-slider" type="range" min="0" max="1.8" step="0.01" /><span class="param-value">{{ fresnel.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">高光</span><input v-model.number="specular" class="param-slider" type="range" min="0" max="4" step="0.01" /><span class="param-value">{{ specular.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">透明度</span><input v-model.number="alpha" class="param-slider" type="range" min="0.2" max="1" step="0.01" /><span class="param-value">{{ alpha.toFixed(2) }}</span></div>
      <div class="color-row"><span class="param-label">深水色</span><input v-model="deepColor" class="color-input" type="color" aria-label="深水色" /></div>
      <div class="color-row"><span class="param-label">浅水色</span><input v-model="shallowColor" class="color-input" type="color" aria-label="浅水色" /></div>
      <div class="color-row"><span class="param-label">泡沫色</span><input v-model="foamColor" class="color-input" type="color" aria-label="泡沫色" /></div>

      <div class="section-title">范围</div>
      <div class="select-row"><span class="param-label">范围模式</span>
        <select v-model="rangeMode" class="mode-select" aria-label="范围模式">
          <option :value="WATER_RANGE_MODES.POLYGON">多边形</option>
          <option :value="WATER_RANGE_MODES.RECTANGLE">矩形</option>
        </select>
      </div>
      <div class="param-row"><span class="param-label">网格分段</span><input v-model.number="meshSegments" class="param-slider" type="range" min="24" max="260" step="1" @change="applyAreaRebuild" /><span class="param-value">{{ meshSegments }}</span></div>

      <template v-if="rangeMode === WATER_RANGE_MODES.RECTANGLE">
        <div class="param-row"><span class="param-label">中心经度</span><input v-model.number="planeLon" class="param-slider" type="range" min="99" max="102" step="0.01" @change="applyPositionUpdate" /><span class="param-value">{{ planeLon.toFixed(2) }}</span></div>
        <div class="param-row"><span class="param-label">中心纬度</span><input v-model.number="planeLat" class="param-slider" type="range" min="25" max="28" step="0.01" @change="applyPositionUpdate" /><span class="param-value">{{ planeLat.toFixed(2) }}</span></div>
        <div class="param-row"><span class="param-label">宽度(m)</span><input v-model.number="planeWidth" class="param-slider" type="range" min="1000" max="20000" step="100" @change="applyAreaRebuild" /><span class="param-value">{{ planeWidth }}</span></div>
        <div class="param-row"><span class="param-label">深度(m)</span><input v-model.number="planeDepth" class="param-slider" type="range" min="1000" max="16000" step="100" @change="applyAreaRebuild" /><span class="param-value">{{ planeDepth }}</span></div>
        <div class="param-row"><span class="param-label">高度(m)</span><input v-model.number="planeHeight" class="param-slider" type="range" min="0" max="6000" step="50" @change="applyPositionUpdate" /><span class="param-value">{{ planeHeight }}</span></div>
      </template>

      <template v-else>
        <div class="param-row"><span class="param-label">高度(m)</span><input v-model.number="planeHeight" class="param-slider" type="range" min="0" max="6000" step="50" @change="applyPositionUpdate" /><span class="param-value">{{ planeHeight }}</span></div>
        <label class="boundary-label" for="vwater-boundary">多边形坐标</label>
        <textarea id="vwater-boundary" v-model="polygonText" class="boundary-input" aria-label="多边形边界坐标"></textarea>
        <div class="btn-row">
          <button class="apply-button" @click="applyPolygonFromText">应用多边形</button>
          <button class="apply-button primary" @click="startDraw">{{ drawing ? '绘制中…' : '地图绘制' }}</button>
        </div>
      </template>

      <div v-if="resultMessage" class="result-hint">{{ resultMessage }}</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.vwater-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.vwater-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 7px; width: 252px; max-height: calc(100% - 24px); overflow-y: auto; padding: 11px; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 32, 49, 0.86); backdrop-filter: blur(6px); color: #ddf2f8; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; }
.toggle-label, .param-label, .boundary-label { font-size: 11px; color: #bdd9e4; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(137, 210, 233, 0.35); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e8f8fb; transition: transform 0.2s; }
.toggle.on { background: #36a8cc; }.toggle.on i { transform: translateX(18px); }
.section-title { margin-top: 4px; padding: 2px 0 1px; border-bottom: 1px solid rgba(137, 210, 233, 0.18); font-size: 11px; font-weight: 700; color: #6fc4e0; }
.param-row { display: flex; align-items: center; gap: 8px; }.param-label { flex: 0 0 54px; }.param-slider { flex: 1; min-width: 0; height: 4px; accent-color: #52c4e8; }.param-value { flex: 0 0 40px; color: #9cc9d8; font-size: 10px; text-align: right; }
.color-row { display: flex; align-items: center; gap: 8px; }.color-input { width: 26px; height: 18px; padding: 0; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: transparent; cursor: pointer; }
.select-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }.mode-select { flex: 1; height: 22px; border: 1px solid rgba(137, 210, 233, 0.24); border-radius: 5px; background: rgba(3, 19, 31, 0.65); color: #d9eff6; font-size: 11px; }
.boundary-label { margin-top: 2px; }.boundary-input { min-height: 46px; resize: vertical; border: 1px solid rgba(137, 210, 233, 0.24); border-radius: 5px; background: rgba(3, 19, 31, 0.65); color: #d9eff6; font: 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
.btn-row { display: flex; gap: 6px; }
.apply-button { flex: 1; height: 25px; border: 0; border-radius: 5px; background: #257f9e; color: #edfaff; cursor: pointer; font-size: 11px; }.apply-button.primary { background: #2f9d6e; }.apply-button.plain { width: 100%; flex: none; background: rgba(137, 210, 233, 0.18); }
.result-hint { padding: 6px 8px; border-radius: 5px; background: rgba(47, 157, 110, 0.16); color: #9fe6c4; font-size: 11px; line-height: 1.45; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
