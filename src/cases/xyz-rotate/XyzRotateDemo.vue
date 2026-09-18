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
  Matrix3,
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
const rotX = ref(0)
const rotY = ref(0)
const rotZ = ref(0)
const ringRadius = ref(1800)
const baseWidth = ref(3)
const hoverWidth = ref(6)
const activeWidth = ref(12)
const showLabels = ref(true)
const showRings = ref(true)
const showBasemap = ref(true)
const logThrottle = ref(200)
const hoverTolerance = ref(14)
const axisColors = ref<Record<AxisName, string>>({ x: '#ff4d4f', y: '#f7c948', z: '#52de6e' })

const liveAttitudeText = ref('')
const lastLogText = ref('')

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let imageryLayer: ReturnType<Viewer['imageryLayers']['addImageryProvider']> | undefined
const onWindowMouseUp = (): void => { finishDrag() }

let currentCenter = Cartesian3.fromDegrees(116.3649, 39.9975, 0)
// 当地 ENU 基（世界系单位向量），随中心点重建
let basisE = new Cartesian3(1, 0, 0)
let basisN = new Cartesian3(0, 1, 0)
let basisU = new Cartesian3(0, 0, 1)
// 姿态旋转矩阵：R = Rz(rotZ)·Ry(rotY)·Rx(rotX)，作用在 ENU 基上得到当前轴方向
let rotMatrix = Matrix3.IDENTITY.clone()
let dirX = new Cartesian3(1, 0, 0)
let dirY = new Cartesian3(0, 1, 0)
let dirZ = new Cartesian3(0, 0, 1)

let activeAxis: AxisName | null = null
let hoverAxis: AxisName | null = null
let dragPivot = new Cartesian2(0, 0)
let dragLastAngle = 0
let dragAxis: AxisName | null = null
let dragTotalDeg = 0
let lastMoveLog = 0
let lastHoverPick = 0

// 每环所在平面正交向量：绕 axis 轴的环由另外两个正交向量张成
const RING_B = (name: AxisName): Cartesian3 => (name === 'x' ? dirY : name === 'y' ? dirZ : dirX)
const RING_C = (name: AxisName): Cartesian3 => (name === 'x' ? dirZ : name === 'y' ? dirX : dirY)

const axes: Record<AxisName, { ring: Entity; label: Entity }> = {
  x: { ring: undefined as unknown as Entity, label: undefined as unknown as Entity },
  y: { ring: undefined as unknown as Entity, label: undefined as unknown as Entity },
  z: { ring: undefined as unknown as Entity, label: undefined as unknown as Entity }
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

function computeBasis(center: Cartesian3): void {
  const m = Transforms.eastNorthUpToFixedFrame(center)
  basisE = new Cartesian3(m[0], m[1], m[2])
  basisN = new Cartesian3(m[4], m[5], m[6])
  basisU = new Cartesian3(m[8], m[9], m[10])
}

function refreshDirs(): void {
  dirX = Matrix3.multiplyByVector(rotMatrix, basisE, new Cartesian3())
  dirY = Matrix3.multiplyByVector(rotMatrix, basisN, new Cartesian3())
  dirZ = Matrix3.multiplyByVector(rotMatrix, basisU, new Cartesian3())
}

function attitudeToText(): string {
  const fmt = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(4)}°`
  return `绕X(东) ${fmt(rotX.value)}   绕Y(北) ${fmt(rotY.value)}   绕Z(上) ${fmt(rotZ.value)}`
}

// 从 R=Rz(γ)Ry(β)Rx(α) 提取 α/β/γ（度），同步面板
function extractAttitude(): void {
  const col0 = Matrix3.getColumn(rotMatrix, 0, new Cartesian3())
  const col1 = Matrix3.getColumn(rotMatrix, 1, new Cartesian3())
  const col2 = Matrix3.getColumn(rotMatrix, 2, new Cartesian3())
  const beta = Math.asin(CesiumMath.clamp(-col0.z, -1, 1))
  const gamma = Math.atan2(col0.y, col0.x)
  const alpha = Math.atan2(col1.z, col2.z)
  rotX.value = CesiumMath.toDegrees(alpha)
  rotY.value = CesiumMath.toDegrees(beta)
  rotZ.value = CesiumMath.toDegrees(gamma)
  syncLive()
}

// 由面板角度重建姿态矩阵 R = Rz(rotZ)·Ry(rotY)·Rx(rotX)
function rebuildFromAttitude(): void {
  const rx = CesiumMath.toRadians(rotX.value)
  const ry = CesiumMath.toRadians(rotY.value)
  const rz = CesiumMath.toRadians(rotZ.value)
  const r = new Matrix3()
  Matrix3.multiply(Matrix3.fromRotationZ(rz, new Matrix3()), Matrix3.fromRotationY(ry, new Matrix3()), r)
  Matrix3.multiply(r, Matrix3.fromRotationX(rx, new Matrix3()), r)
  rotMatrix = r
  refreshDirs()
  syncLive()
}

function ringPointAt(name: AxisName, theta: number): Cartesian3 {
  const b = RING_B(name)
  const c = RING_C(name)
  const p = Cartesian3.add(
    Cartesian3.add(
      currentCenter,
      Cartesian3.multiplyByScalar(b, ringRadius.value * Math.cos(theta), new Cartesian3()),
      new Cartesian3()
    ),
    Cartesian3.multiplyByScalar(c, ringRadius.value * Math.sin(theta), new Cartesian3()),
    new Cartesian3()
  )
  return p
}

const RING_SEGMENTS = 72

// 环形轴（位于过原点、垂直该轴方向的平面内）
function ringPoints(name: AxisName): Cartesian3[] {
  const points: Cartesian3[] = []
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const theta = (i / RING_SEGMENTS) * CesiumMath.TWO_PI
    points.push(ringPointAt(name, theta))
  }
  return points
}

function labelPhase(name: AxisName): number {
  return name === 'x' ? Math.PI / 4 : name === 'y' ? (Math.PI * 3) / 4 : -Math.PI / 4
}

function ringLabelPoint(name: AxisName): Cartesian3 {
  return ringPointAt(name, labelPhase(name))
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
    if (!axis.ring) return
    const color = axisColorFor(name)
    const polyline = axis.ring.polyline!
    polyline.width = new ConstantProperty(axisWidthFor(name))
    polyline.material = new ColorMaterialProperty(color)
    axis.ring.show = showRings.value
    axis.label.show = showLabels.value
  })
}

function createRing(name: AxisName): void {
  if (!viewer) return
  const color = Color.fromCssColorString(axisColors.value[name])
  const ring = viewer.entities.add({
    id: `xyzr-ring-${name}`,
    polyline: {
      positions: new CallbackProperty(() => ringPoints(name), false),
      width: baseWidth.value,
      material: new ColorMaterialProperty(color),
      clampToGround: false
    },
    show: showRings.value
  })
  const label = viewer.entities.add({
    id: `xyzr-label-${name}`,
    position: new CallbackProperty(() => ringLabelPoint(name), false) as unknown as Entity['position'],
    label: {
      text: name.toUpperCase(),
      font: 'bold 15px sans-serif',
      fillColor: Color.WHITE,
      outlineColor: Color.BLACK,
      outlineWidth: 3,
      pixelOffset: new Cartesian2(12, -10),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    show: showLabels.value
  })
  axes[name] = { ring, label }
}

function createOrigin(): void {
  if (!viewer) return
  originEntity = viewer.entities.add({
    id: 'xyzr-origin',
    position: new CallbackProperty(() => currentCenter, false) as unknown as Parameters<typeof viewer.entities.add>[0]['position'],
    point: {
      pixelSize: 6,
      color: Color.fromCssColorString('#e8f1fb'),
      outlineColor: Color.BLACK,
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })
}

function removeRings(): void {
  if (!viewer || viewer.isDestroyed()) return
  AXIS_NAMES.forEach((name) => {
    const axis = axes[name]
    if (axis.ring) viewer?.entities.remove(axis.ring)
    if (axis.label) viewer?.entities.remove(axis.label)
  })
  if (originEntity) viewer.entities.remove(originEntity)
  originEntity = undefined
}

function rebuildRings(): void {
  if (!viewer) return
  activeAxis = null
  hoverAxis = null
  removeRings()
  computeBasis(currentCenter)
  rotMatrix = Matrix3.IDENTITY.clone()
  rotX.value = 0
  rotY.value = 0
  rotZ.value = 0
  refreshDirs()
  AXIS_NAMES.forEach((name) => {
    createRing(name)
  })
  createOrigin()
  refreshAxisStyle()
  syncLive()
}

function syncLive(): void {
  liveAttitudeText.value = attitudeToText()
}

function axisOf(id: string): AxisName | null {
  const match = id.match(/^xyzr-(?:ring|label)-([xyz])$/)
  return match ? (match[1] as AxisName) : null
}

// 坐标系统说明（源码 + 像素取证定案，勿改）：
// ScreenSpaceEventHandler 的 position/endPosition、Scene.pick、SceneTransforms.worldToWindowCoordinates
// 三者统一使用 canvas 相对坐标（事件坐标内部已减 canvas 的 getBoundingClientRect 偏移）。
function pickedAxis(windowPos: Cartesian2): AxisName | null {
  if (!viewer) return null
  const picked = viewer.scene.pick(windowPos)
  if (!picked || !picked.id) return null
  const id = String(picked.id.id ?? picked.id)
  return axisOf(id)
}

function nearestAxisByDistance(windowPos: Cartesian2): AxisName | null {
  if (!viewer) return null
  let bestName: AxisName | null = null
  let bestDistance = Infinity
  AXIS_NAMES.forEach((name) => {
    // 环采样点投影到屏幕求鼠标到环的最小距离（容差拾取兜底）
    const pts = ringPoints(name)
    for (const p of pts) {
      const win = SceneTransforms.worldToWindowCoordinates(viewer!.scene, p)
      if (!win) continue
      const d = Math.hypot(windowPos.x - win.x, windowPos.y - win.y)
      if (d < bestDistance) {
        bestDistance = d
        bestName = name
      }
    }
  })
  return bestDistance <= hoverTolerance.value ? bestName : null
}

function axisAt(windowPos: Cartesian2): AxisName | null {
  const picked = pickedAxis(windowPos)
  if (picked) return picked
  return nearestAxisByDistance(windowPos)
}

function setRotateEnabled(enabled: boolean): void {
  const controller = viewer?.scene.screenSpaceCameraController
  if (controller) controller.enableRotate = enabled
}

function formatAngle(deg: number): string {
  return `${deg >= 0 ? '+' : ''}${deg.toFixed(2)}°`
}

function logMessage(kind: 'start' | 'move' | 'end', deg: number): string {
  const meta = dragAxis ? AXIS_META[dragAxis] : { label: '' }
  if (kind === 'start') {
    return `[XYZ坐标轴旋转] 开始拖动绕${meta.label}轴旋转，当前姿态：${attitudeToText()}`
  }
  if (kind === 'move') {
    return `[XYZ坐标轴旋转] 绕${meta.label}轴旋转 ${formatAngle(deg)}，当前姿态：${attitudeToText()}`
  }
  return `[XYZ坐标轴旋转] 旋转完成：绕${meta.label}轴累计旋转 ${formatAngle(deg)}，当前姿态：${attitudeToText()}`
}

function logRotate(kind: 'start' | 'move' | 'end', deg: number): void {
  const message = logMessage(kind, deg)
  console.log(message)
  lastLogText.value = message.replace(/^\[XYZ坐标轴旋转\]\s*/, '')
}

function wrapAngleRad(angle: number): number {
  while (angle > Math.PI) angle -= CesiumMath.TWO_PI
  while (angle < -Math.PI) angle += CesiumMath.TWO_PI
  return angle
}

function screenAngle(windowPos: Cartesian2): number | null {
  const pivot = windowForPoint(currentCenter)
  if (!pivot) return null
  dragPivot = pivot
  return Math.atan2(windowPos.y - pivot.y, windowPos.x - pivot.x)
}

function windowForPoint(cartesian: Cartesian3): Cartesian2 | null {
  if (!viewer) return null
  return SceneTransforms.worldToWindowCoordinates(viewer.scene, cartesian) ?? null
}

function applyBodyRotation(name: AxisName, deltaDeg: number): void {
  const rad = CesiumMath.toRadians(deltaDeg)
  const rot = name === 'x' ? Matrix3.fromRotationX(rad, new Matrix3())
    : name === 'y' ? Matrix3.fromRotationY(rad, new Matrix3())
      : Matrix3.fromRotationZ(rad, new Matrix3())
  Matrix3.multiply(rotMatrix, rot, rotMatrix)
  refreshDirs()
  extractAttitude()
}

function onMouseMove(event: { endPosition: Cartesian2 }): void {
  if (!viewer) return
  if (activeAxis && dragAxis) {
    const angle = screenAngle(event.endPosition)
    if (angle === null) return
    const delta = wrapAngleRad(angle - dragLastAngle)
    if (Math.abs(delta) < 0.0005) return
    dragLastAngle = angle
    const deg = CesiumMath.toDegrees(delta)
    dragTotalDeg += deg
    applyBodyRotation(dragAxis, deg)
    const now = performance.now()
    if (now - lastMoveLog >= logThrottle.value) {
      lastMoveLog = now
      logRotate('move', dragTotalDeg)
    }
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

function onLeftDown(event: { position: Cartesian2 }): void {
  if (!viewer) return
  const name = axisAt(event.position)
  if (!name) return
  const angle = screenAngle(event.position)
  if (angle === null) return
  activeAxis = name
  hoverAxis = name
  dragAxis = name
  dragLastAngle = angle
  dragTotalDeg = 0
  lastMoveLog = 0
  setRotateEnabled(false)
  viewer.canvas.style.cursor = 'grabbing'
  refreshAxisStyle()
  logRotate('start', 0)
}

function finishDrag(): void {
  if (!activeAxis || !dragAxis || !viewer) return
  const name = dragAxis
  logRotate('end', dragTotalDeg)
  activeAxis = null
  hoverAxis = null
  dragAxis = null
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

function flyToCenter(): void {
  if (!viewer) return
  const height = Math.max(6000, ringRadius.value * 3 + 1500)
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(centerLon.value, centerLat.value, centerHeight.value + height),
    duration: 0.8
  })
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
  rebuildRings()
  flyToCenter()
  flashStatus('中心点已更新，环形轴已重建')
}

function applyAttitude(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (!AXIS_NAMES.every((n) => isFiniteNumber(n === 'x' ? rotX.value : n === 'y' ? rotY.value : rotZ.value))) {
    flashStatus('姿态角度数值无效，请检查输入')
    return
  }
  rebuildFromAttitude()
  refreshAxisStyle()
  flashStatus('姿态已应用')
}

function resetAttitude(): void {
  rotX.value = 0
  rotY.value = 0
  rotZ.value = 0
  rebuildFromAttitude()
  refreshAxisStyle()
  flashStatus('姿态已重置为初始方向')
}

function resetView(): void {
  flyToCenter()
}

function toggleBasemap(show: boolean): void {
  if (imageryLayer) imageryLayer.show = show
}

watch([ringRadius, baseWidth, hoverWidth, activeWidth, showLabels, showRings], () => {
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
    rebuildRings()
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
  axes.x = { ring: undefined as unknown as Entity, label: undefined as unknown as Entity }
  axes.y = { ring: undefined as unknown as Entity, label: undefined as unknown as Entity }
  axes.z = { ring: undefined as unknown as Entity, label: undefined as unknown as Entity }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="xyz-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">自定义XYZ球形坐标轴-拖拽旋转</div>

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

      <div class="section-title">姿态角（绕环所在轴方向旋转）</div>
      <div class="coordinate-row">
        <div class="coordinate-field">
          <span class="field-label">绕X(东)°</span>
          <input v-model.number="rotX" type="number" step="1" placeholder="绕X" />
        </div>
        <div class="coordinate-field">
          <span class="field-label">绕Y(北)°</span>
          <input v-model.number="rotY" type="number" step="1" placeholder="绕Y" />
        </div>
        <div class="coordinate-field">
          <span class="field-label">绕Z(上)°</span>
          <input v-model.number="rotZ" type="number" step="1" placeholder="绕Z" />
        </div>
      </div>
      <div class="button-row">
        <button class="action-button primary" @click="applyAttitude">应用姿态</button>
        <button class="action-button secondary" @click="resetAttitude">重置姿态</button>
      </div>

      <div class="section-title">当前姿态（拖动同步更新）</div>
      <div class="live-coord">{{ liveAttitudeText }}</div>
      <div class="last-log" v-if="lastLogText">最近操作：{{ lastLogText }}</div>

      <div class="section-title">环形轴参数</div>
      <div class="control-row">
        <span class="row-label">环形轴半径(m)</span>
        <input v-model.number="ringRadius" type="range" min="300" max="8000" step="100" />
        <span class="row-value">{{ ringRadius }}</span>
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

      <div class="section-title">环形轴颜色</div>
      <div class="color-row" v-for="name in (['x', 'y', 'z'] as AxisName[])" :key="name">
        <span class="axis-swatch" :style="{ background: axisColors[name] }"></span>
        <span class="axis-name">{{ AXIS_META[name].label }}环</span>
        <input v-model="axisColors[name]" type="color" class="color-input" />
      </div>

      <div class="section-title">显示</div>
      <div class="control-row">
        <span class="row-label">环形轴标识 X/Y/Z</span>
        <label class="switch">
          <input v-model="showLabels" type="checkbox" />
          <span class="switch-slider"></span>
        </label>
      </div>
      <div class="control-row">
        <span class="row-label">环形轴显示</span>
        <label class="switch">
          <input v-model="showRings" type="checkbox" />
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

      <p class="hint">操作：鼠标放到环形轴上高亮为黄色并加宽；按住左键环形轴再加粗，拖动鼠标使整个坐标系绕环所在轴方向旋转，姿态角实时同步，控制台输出旋转信息。</p>
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
