<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  Math as CesiumMath,
  SceneTransforms,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Transforms,
  type Entity,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'

type AxisName = 'x' | 'y' | 'z'

const AXIS_META: Record<AxisName, { label: string; color: string }> = {
  x: { label: 'X（东）', color: '#ff4d4f' },
  y: { label: 'Y（北）', color: '#f7c948' },
  z: { label: 'Z（上）', color: '#52de6e' }
}
const HOVER_COLOR = '#ffe14d'
const AXIS_NAMES: AxisName[] = ['x', 'y', 'z']

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载地图…')

const centerLon = ref(116.3649)
const centerLat = ref(39.9975)
const centerHeight = ref(0)
const axisLength = ref(2000)
const baseWidth = ref(3)
const hoverWidth = ref(6)
const activeWidth = ref(12)
const showLabels = ref(true)
const showHandles = ref(true)
const showBasemap = ref(true)
const logThrottle = ref(200)
const hoverTolerance = ref(14)
const axisColors = ref<Record<AxisName, string>>({ x: '#ff4d4f', y: '#f7c948', z: '#52de6e' })

const liveCoordText = ref('')
const lastLogText = ref('')

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let imageryLayer: ReturnType<Viewer['imageryLayers']['addImageryProvider']> | undefined
const onWindowMouseUp = (): void => { finishDrag() }

let currentCenter = Cartesian3.fromDegrees(116.3649, 39.9975, 0)
let dirX = new Cartesian3(1, 0, 0)
let dirY = new Cartesian3(0, 1, 0)
let dirZ = new Cartesian3(0, 0, 1)

let activeAxis: AxisName | null = null
let hoverAxis: AxisName | null = null
let dragStartWindow = new Cartesian2(0, 0)
let dragStartCenter = new Cartesian3()
let dragAxisDir = new Cartesian3()
let dragTotalMeters = 0
let lastMoveLog = 0
let lastHoverPick = 0

const axes: Record<AxisName, { line: Entity; handle: Entity; label: Entity }> = {
  x: { line: undefined as unknown as Entity, handle: undefined as unknown as Entity, label: undefined as unknown as Entity },
  y: { line: undefined as unknown as Entity, handle: undefined as unknown as Entity, label: undefined as unknown as Entity },
  z: { line: undefined as unknown as Entity, handle: undefined as unknown as Entity, label: undefined as unknown as Entity }
}
let originEntity: Entity | undefined

let statusTimer: number | undefined
function clearStatus(): void {
  if (statusTimer !== undefined) window.clearTimeout(statusTimer)
  statusTimer = undefined
  statusMessage.value = ''
}
function flashStatus(message: string): void {
  clearStatus()
  statusMessage.value = message
  statusTimer = window.setTimeout(() => {
    statusMessage.value = ''
    statusTimer = undefined
  }, 3000)
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function computeDirs(center: Cartesian3): void {
  const m = Transforms.eastNorthUpToFixedFrame(center)
  dirX = new Cartesian3(m[0], m[1], m[2])
  dirY = new Cartesian3(m[4], m[5], m[6])
  dirZ = new Cartesian3(m[8], m[9], m[10])
}

function axisEnd(dir: Cartesian3, length = axisLength.value): Cartesian3 {
  return Cartesian3.add(currentCenter, Cartesian3.multiplyByScalar(dir, length, new Cartesian3()), new Cartesian3())
}

function axisColorFor(name: AxisName): Color {
  if (activeAxis === name || hoverAxis === name) return Color.fromCssColorString(HOVER_COLOR)
  return Color.fromCssColorString(axisColors.value[name])
}

function axisWidthFor(name: AxisName): number {
  if (activeAxis === name) return activeWidth.value
  if (hoverAxis === name) return hoverWidth.value
  return baseWidth.value
}

function refreshAxisStyle(): void {
  if (!viewer || viewer.isDestroyed()) return
  AXIS_NAMES.forEach((name) => {
    const axis = axes[name]
    if (!axis.line) return
    const color = axisColorFor(name)
    const polyline = axis.line.polyline!
    polyline.width = new ConstantProperty(axisWidthFor(name))
    polyline.material = new ColorMaterialProperty(color)
    if (axis.handle.point) axis.handle.point.color = new ConstantProperty(color)
    axis.handle.show = activeAxis === name ? true : showHandles.value
    axis.label.show = showLabels.value
  })
}

function createAxis(name: AxisName, dir: Cartesian3): void {
  if (!viewer) return
  const color = Color.fromCssColorString(axisColors.value[name])
  const line = viewer.entities.add({
    id: `xyz-line-${name}`,
    polyline: {
      positions: new CallbackProperty(
        () => [currentCenter, axisEnd(dir)],
        false
      ),
      width: baseWidth.value,
      material: color,
      clampToGround: false
    }
  })
  const handle = viewer.entities.add({
    id: `xyz-handle-${name}`,
    position: new CallbackProperty(() => axisEnd(dir), false) as unknown as Entity['position'],
    point: {
      pixelSize: 10,
      color,
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    show: showHandles.value
  })
  const label = viewer.entities.add({
    id: `xyz-label-${name}`,
    position: new CallbackProperty(() => axisEnd(dir), false) as unknown as Entity['position'],
    label: {
      text: name.toUpperCase(),
      font: 'bold 16px sans-serif',
      fillColor: Color.WHITE,
      outlineColor: Color.BLACK,
      outlineWidth: 3,
      pixelOffset: new Cartesian2(10, -12),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    show: showLabels.value
  })
  axes[name] = { line, handle, label }
}

function createOrigin(): void {
  if (!viewer) return
  originEntity = viewer.entities.add({
    id: 'xyz-origin',
    position: new CallbackProperty(() => currentCenter, false) as unknown as Parameters<typeof viewer.entities.add>[0]['position'],
    point: {
      pixelSize: 8,
      color: Color.fromCssColorString('#e8f1fb'),
      outlineColor: Color.BLACK,
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })
}

function removeAxes(): void {
  if (!viewer || viewer.isDestroyed()) return
  AXIS_NAMES.forEach((name) => {
    const axis = axes[name]
    if (axis.line) viewer?.entities.remove(axis.line)
    if (axis.handle) viewer?.entities.remove(axis.handle)
    if (axis.label) viewer?.entities.remove(axis.label)
  })
  if (originEntity) viewer.entities.remove(originEntity)
  originEntity = undefined
}

function rebuildAxes(): void {
  if (!viewer) return
  activeAxis = null
  hoverAxis = null
  removeAxes()
  computeDirs(currentCenter)
  AXIS_NAMES.forEach((name) => {
    createAxis(name, name === 'x' ? dirX : name === 'y' ? dirY : dirZ)
  })
  createOrigin()
  refreshAxisStyle()
  syncLiveCoord()
}

function axisOf(id: string): AxisName | null {
  const match = id.match(/^xyz-(?:line|handle|label)-([xyz])$/)
  return match ? (match[1] as AxisName) : null
}

// 坐标系统说明（源码 + 像素取证定案，勿改）：
// ScreenSpaceEventHandler 的 position/endPosition、Scene.pick、SceneTransforms.worldToWindowCoordinates
// 三者统一使用 canvas 相对坐标（事件坐标内部已减 canvas 的 getBoundingClientRect 偏移）。
// 若再加页面偏移会造成拾取位置与真实渲染轴错位。
function pickedAxis(windowPos: Cartesian2): AxisName | null {
  if (!viewer) return null
  const picked = viewer.scene.pick(windowPos)
  if (!picked || !picked.id) return null
  const id = String(picked.id.id ?? picked.id)
  return axisOf(id)
}

function axisDirFor(name: AxisName): Cartesian3 {
  return name === 'x' ? dirX : name === 'y' ? dirY : dirZ
}

function windowForPoint(cartesian: Cartesian3): Cartesian2 | null {
  if (!viewer) return null
  return SceneTransforms.worldToWindowCoordinates(viewer.scene, cartesian) ?? null
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-6) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function nearestAxisByDistance(windowPos: Cartesian2): AxisName | null {
  if (!viewer) return null
  const centerWin = windowForPoint(currentCenter)
  if (!centerWin) return null
  let bestName: AxisName | null = null
  let bestDistance = Infinity
  AXIS_NAMES.forEach((name) => {
    const endWin = windowForPoint(axisEnd(axisDirFor(name)))
    if (!endWin) return
    const distance = distanceToSegment(
      windowPos.x, windowPos.y,
      centerWin.x, centerWin.y,
      endWin.x, endWin.y
    )
    if (distance < bestDistance) {
      bestDistance = distance
      bestName = name
    }
  })
  return bestDistance <= hoverTolerance.value ? bestName : null
}

function axisAt(windowPos: Cartesian2): AxisName | null {
  const picked = pickedAxis(windowPos)
  if (picked) return picked
  return nearestAxisByDistance(windowPos)
}

function screenMetersPerPixelAxis(dir: Cartesian3, center: Cartesian3): Cartesian2 | null {
  if (!viewer) return null
  const near = Cartesian3.add(center, dir, new Cartesian3())
  const a = SceneTransforms.worldToWindowCoordinates(viewer.scene, center)
  const b = SceneTransforms.worldToWindowCoordinates(viewer.scene, near)
  if (!a || !b) return null
  return new Cartesian2(b.x - a.x, b.y - a.y)
}

function syncLiveCoord(): void {
  liveCoordText.value = `经度 ${centerLon.value.toFixed(6)}°   纬度 ${centerLat.value.toFixed(6)}°   高度 ${centerHeight.value.toFixed(2)}m`
}

function formatDelta(meters: number): string {
  const sign = meters >= 0 ? '+' : '-'
  return `${sign}${Math.abs(meters).toFixed(2)}m`
}

function logMove(meters: number, name: AxisName): void {
  const now = performance.now()
  if (now - lastMoveLog < logThrottle.value) return
  lastMoveLog = now
  const meta = AXIS_META[name]
  const message = `[XYZ坐标轴] 沿${meta.label}轴平移 ${formatDelta(meters)}，中心点坐标：经度 ${centerLon.value.toFixed(6)}°，纬度 ${centerLat.value.toFixed(6)}°，高度 ${centerHeight.value.toFixed(2)}m`
  console.log(message)
  lastLogText.value = `沿${meta.label}平移 ${formatDelta(meters)}`
}

function logDragStart(name: AxisName): void {
  const meta = AXIS_META[name]
  console.log(`[XYZ坐标轴] 开始拖动 ${meta.label}轴，中心点坐标：经度 ${centerLon.value.toFixed(6)}°，纬度 ${centerLat.value.toFixed(6)}°，高度 ${centerHeight.value.toFixed(2)}m`)
}

function logDragEnd(meters: number, name: AxisName): void {
  const meta = AXIS_META[name]
  console.log(`[XYZ坐标轴] 平移完成：沿${meta.label}轴累计移动 ${formatDelta(meters)}，中心点坐标：经度 ${centerLon.value.toFixed(6)}°，纬度 ${centerLat.value.toFixed(6)}°，高度 ${centerHeight.value.toFixed(2)}m`)
}

function setRotateEnabled(enabled: boolean): void {
  const controller = viewer?.scene.screenSpaceCameraController
  if (controller) controller.enableRotate = enabled
}

function onMouseMove(event: { endPosition: Cartesian2 }): void {
  if (!viewer) return
  if (activeAxis) {
    const meters = dragMeters(event.endPosition)
    if (meters === null) return
    const delta = Cartesian3.multiplyByScalar(dragAxisDir, meters, new Cartesian3())
    currentCenter = Cartesian3.add(dragStartCenter, delta, new Cartesian3())
    const carto = Cartographic.fromCartesian(currentCenter)
    centerLon.value = CesiumMath.toDegrees(carto.longitude)
    centerLat.value = CesiumMath.toDegrees(carto.latitude)
    centerHeight.value = carto.height
    dragTotalMeters = meters
    syncLiveCoord()
    logMove(meters, activeAxis)
    return
  }

  const now = performance.now()
  if (now - lastHoverPick < 50) return
  lastHoverPick = now
  const picked = axisAt(event.endPosition)
  if (picked !== hoverAxis) {
    hoverAxis = picked
    refreshAxisStyle()
    viewer.canvas.style.cursor = picked ? 'grab' : ''
  }
}

function dragMeters(windowPos: Cartesian2): number | null {
  const vpx = screenMetersPerPixelAxis(dragAxisDir, dragStartCenter)
  if (!vpx) return null
  const len2 = vpx.x * vpx.x + vpx.y * vpx.y
  if (len2 < 1e-4) return null
  const dx = windowPos.x - dragStartWindow.x
  const dy = windowPos.y - dragStartWindow.y
  return (dx * vpx.x + dy * vpx.y) / len2
}

function onLeftDown(event: { position: Cartesian2 }): void {
  if (!viewer) return
  const name = axisAt(event.position)
  if (!name) return
  activeAxis = name
  hoverAxis = name
  dragStartWindow = event.position.clone()
  dragStartCenter = Cartesian3.clone(currentCenter)
  dragAxisDir = name === 'x' ? Cartesian3.clone(dirX) : name === 'y' ? Cartesian3.clone(dirY) : Cartesian3.clone(dirZ)
  dragTotalMeters = 0
  lastMoveLog = 0
  setRotateEnabled(false)
  viewer.canvas.style.cursor = 'grabbing'
  refreshAxisStyle()
  logDragStart(name)
}

function finishDrag(): void {
  if (!activeAxis || !viewer) return
  const name = activeAxis
  logDragEnd(dragTotalMeters, name)
  activeAxis = null
  hoverAxis = null
  setRotateEnabled(true)
  viewer.canvas.style.cursor = ''
  refreshAxisStyle()
}

function onLeftUp(): void {
  finishDrag()
}

function onMouseLeave(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (activeAxis) {
    finishDrag()
    return
  }
  hoverAxis = null
  refreshAxisStyle()
  viewer.canvas.style.cursor = ''
}

function applyCenter(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (!isFiniteNumber(centerLon.value) || !isFiniteNumber(centerLat.value) || !isFiniteNumber(centerHeight.value)) {
    flashStatus('中心点坐标数值无效，请检查输入')
    return
  }
  if (centerLon.value < -180 || centerLon.value > 180 || centerLat.value < -90 || centerLat.value > 90) {
    flashStatus('经纬度超出有效范围（经度 ±180，纬度 ±90）')
    return
  }
  currentCenter = Cartesian3.fromDegrees(centerLon.value, centerLat.value, centerHeight.value)
  rebuildAxes()
  flyToCenter()
  flashStatus('中心点已更新，坐标轴已重建')
}

function flyToCenter(): void {
  if (!viewer) return
  const height = Math.max(5000, axisLength.value * 2.5 + 1000)
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(centerLon.value, centerLat.value, centerHeight.value + height),
    duration: 0.8
  })
}

function resetView(): void {
  if (!viewer) return
  const height = Math.max(5000, axisLength.value * 2.5 + 1000)
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(centerLon.value, centerLat.value, centerHeight.value + height),
    duration: 0.8
  })
}

function toggleBasemap(show: boolean): void {
  if (imageryLayer) imageryLayer.show = show
}

watch([axisLength, baseWidth, hoverWidth, activeWidth, showLabels, showHandles], () => {
  refreshAxisStyle()
})
watch(axisColors, () => {
  refreshAxisStyle()
}, { deep: true })

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { clearStatus() }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks, (layer) => { imageryLayer = layer })

    handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction(onMouseMove, ScreenSpaceEventType.MOUSE_MOVE)
    handler.setInputAction(onLeftDown, ScreenSpaceEventType.LEFT_DOWN)
    handler.setInputAction(onLeftUp, ScreenSpaceEventType.LEFT_UP)
    viewer.scene.canvas.addEventListener('mouseleave', onMouseLeave)
    window.addEventListener('mouseup', onWindowMouseUp)
    window.addEventListener('blur', onWindowMouseUp)

    currentCenter = Cartesian3.fromDegrees(centerLon.value, centerLat.value, centerHeight.value)
    rebuildAxes()
    flyToCenter()
    clearStatus()
  } catch (error) {
    flashStatus(error instanceof Error ? error.message : String(error))
  }
})

onBeforeUnmount(() => {
  if (statusTimer !== undefined) window.clearTimeout(statusTimer)
  statusTimer = undefined
  if (viewer) viewer.scene.canvas.removeEventListener('mouseleave', onMouseLeave)
  window.removeEventListener('mouseup', onWindowMouseUp)
  window.removeEventListener('blur', onWindowMouseUp)
  handler?.destroy()
  handler = undefined
  axes.x = undefined as unknown as { line: Entity; handle: Entity; label: Entity }
  axes.y = undefined as unknown as { line: Entity; handle: Entity; label: Entity }
  axes.z = undefined as unknown as { line: Entity; handle: Entity; label: Entity }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="xyz-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">自定义XYZ坐标轴-拖拽平移</div>

      <div class="section-title">中心点坐标</div>
      <div class="coordinate-row">
        <div class="coordinate-field">
          <span class="field-label">经度</span>
          <input v-model.number="centerLon" type="number" step="0.000001" placeholder="经度" />
        </div>
        <div class="coordinate-field">
          <span class="field-label">纬度</span>
          <input v-model.number="centerLat" type="number" step="0.000001" placeholder="纬度" />
        </div>
        <div class="coordinate-field">
          <span class="field-label">高度(m)</span>
          <input v-model.number="centerHeight" type="number" step="1" placeholder="高度" />
        </div>
      </div>
      <div class="button-row">
        <button class="action-button primary" @click="applyCenter">应用中心点</button>
        <button class="action-button secondary" @click="resetView">回到中心点</button>
      </div>

      <div class="section-title">当前中心点（拖动同步更新）</div>
      <div class="live-coord">{{ liveCoordText }}</div>
      <div class="last-log" v-if="lastLogText">最近操作：{{ lastLogText }}</div>

      <div class="section-title">轴参数</div>
      <div class="control-row">
        <span class="row-label">轴长度(m)</span>
        <input v-model.number="axisLength" type="range" min="200" max="10000" step="100" />
        <span class="row-value">{{ axisLength }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">基础线宽</span>
        <input v-model.number="baseWidth" type="range" min="1" max="8" step="0.5" />
        <span class="row-value">{{ baseWidth }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">悬停线宽</span>
        <input v-model.number="hoverWidth" type="range" min="2" max="12" step="0.5" />
        <span class="row-value">{{ hoverWidth }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">按下线宽</span>
        <input v-model.number="activeWidth" type="range" min="4" max="20" step="0.5" />
        <span class="row-value">{{ activeWidth }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">打印节流(ms)</span>
        <input v-model.number="logThrottle" type="range" min="50" max="1000" step="50" />
        <span class="row-value">{{ logThrottle }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">拾取容差(px)</span>
        <input v-model.number="hoverTolerance" type="range" min="6" max="30" step="1" />
        <span class="row-value">{{ hoverTolerance }}</span>
      </div>

      <div class="section-title">轴颜色</div>
      <div class="color-row" v-for="name in (['x', 'y', 'z'] as AxisName[])" :key="name">
        <span class="axis-swatch" :style="{ background: axisColors[name] }"></span>
        <span class="axis-name">{{ AXIS_META[name].label }}</span>
        <input v-model="axisColors[name]" type="color" class="color-input" />
      </div>

      <div class="section-title">显示</div>
      <div class="control-row">
        <span class="row-label">轴端标签 X/Y/Z</span>
        <label class="switch">
          <input v-model="showLabels" type="checkbox" />
          <span class="switch-slider"></span>
        </label>
      </div>
      <div class="control-row">
        <span class="row-label">轴端拖拽手柄</span>
        <label class="switch">
          <input v-model="showHandles" type="checkbox" />
          <span class="switch-slider"></span>
        </label>
      </div>
      <div class="control-row">
        <span class="row-label">Bing 底图</span>
        <label class="switch">
          <input :checked="showBasemap" type="checkbox" @change="(e) => { showBasemap = (e.target as HTMLInputElement).checked; toggleBasemap(showBasemap) }" />
          <span class="switch-slider"></span>
        </label>
      </div>

      <p class="hint">操作：鼠标放到轴上高亮为黄色；按住鼠标左键轴加粗，沿轴方向拖动中心点平移，坐标实时同步，控制台输出平移信息。</p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.xyz-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; width: 320px; max-height: calc(100% - 24px); padding: 12px; overflow: auto; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.coordinate-row { display: flex; align-items: flex-end; gap: 6px; }
.coordinate-field { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.field-label { color: #c3d5e8; font-size: 10px; }
.coordinate-field input { width: 100%; height: 24px; padding: 0 6px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: #1a2c4a; color: #e8f1fb; font-size: 11px; box-sizing: border-box; }
.action-button { height: 26px; padding: 0 10px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; white-space: nowrap; }
.action-button.primary { background: #2f80ed; color: #eef4ff; }
.action-button.secondary { flex: 1; background: #2c3a52; color: #c3d5e8; }
.button-row { display: flex; gap: 6px; margin-top: 8px; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 40px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.switch { position: relative; display: inline-block; width: 30px; height: 16px; flex: 0 0 auto; }
.switch input { opacity: 0; width: 0; height: 0; }
.switch-slider { position: absolute; inset: 0; border-radius: 8px; background: #2c3a52; transition: background 0.2s; }
.switch-slider::before { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #9fb8d4; transition: transform 0.2s; }
.switch input:checked + .switch-slider { background: #2f80ed; }
.switch input:checked + .switch-slider::before { transform: translateX(14px); background: #ffffff; }
.color-row { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
.axis-swatch { width: 14px; height: 14px; border-radius: 3px; border: 1px solid rgba(255, 255, 255, 0.35); flex: 0 0 auto; }
.axis-name { flex: 1; color: #c3d5e8; font-size: 11px; }
.color-input { width: 42px; height: 22px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: #1a2c4a; }
.live-coord { padding: 6px 8px; border: 1px solid rgba(137, 210, 233, 0.35); border-radius: 5px; background: rgba(26, 44, 74, 0.6); color: #ffe14d; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.6; }
.last-log { margin-top: 4px; font-size: 10px; color: #7f96b3; }
.hint { margin: 8px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.6; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
