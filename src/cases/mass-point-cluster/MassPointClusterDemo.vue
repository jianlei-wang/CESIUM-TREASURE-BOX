<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  BillboardCollection,
  BoundingSphere,
  Cartesian3,
  Color,
  HeadingPitchRange,
  HorizontalOrigin,
  Math as CesiumMath,
  Matrix4,
  PointPrimitiveCollection,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Cartesian2,
  type PerspectiveFrustum,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import InfoTip from '../../components/InfoTip.vue'
import { CLUSTER_WORKER_SOURCE } from './cluster-worker-source'

type ClusterResult = {
  longitude: number
  latitude: number
  pointCount: number
}

type ClusterResponse = {
  type: 'clusterResult'
  epoch: number
  requestId: number
  clusters: ClusterResult[]
  singles: Int32Array
  visibleCount: number
  computeTime: number
}

type DataReadyResponse = {
  type: 'dataReady'
  epoch: number
  requestId: number
}

type ClusterLevel = {
  min: number
  max: number
  color: string
}

type PickedId =
  | { type: 'cluster'; data: ClusterResult }
  | { type: 'point'; data: { index: number } }

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const count = ref(100000)
const pixelRange = ref(60)
const minimumClusterSize = ref(2)
const pointSize = ref(7)
const showSingles = ref(true)
const generating = ref(false)
const progress = ref(0)
const visibleCount = ref(0)
const clusterCount = ref(0)
const singleCount = ref(0)
const computeTime = ref(0)
const pickedInfo = ref('点击聚合点或散点查看信息')

const COUNT_OPTIONS = [10000, 50000, 100000, 200000, 500000]
const CATEGORY_COLORS = ['#ffd54a', '#4a9eff', '#ff5c5c', '#2ecc71'].map((value) =>
  Color.fromCssColorString(value)
)

const CLUSTER_LEVELS: ClusterLevel[] = [
  { min: 2, max: 10, color: '#2ecc71' },
  { min: 11, max: 50, color: '#3498db' },
  { min: 51, max: 200, color: '#f39c12' },
  { min: 201, max: 1000, color: '#e74c3c' },
  { min: 1001, max: 5000, color: '#9b59b6' },
  { min: 5001, max: Number.POSITIVE_INFINITY, color: '#8e44ad' }
]

// 聚合图标尺寸随聚合点数量按对数增长，数量越多图标越大。
const CLUSTER_ICON_MIN_SIZE = 28
const CLUSTER_ICON_MAX_SIZE = 76
const CLUSTER_ICON_GROWTH = 3.4
const CLUSTER_ICON_OVERSAMPLE = 2

const HOTSPOTS: Array<[number, number]> = [
  [116.4, 39.9],
  [121.47, 31.23],
  [113.26, 23.13],
  [104.07, 30.67],
  [108.94, 34.34],
  [114.3, 30.6],
  [120.15, 30.28],
  [106.55, 29.56],
  [123.43, 41.8],
  [102.71, 25.05],
  [87.62, 43.82],
  [91.11, 29.65]
]

const displayCount = computed(() =>
  count.value >= 10000 ? `${count.value / 10000}万` : String(count.value)
)

let viewer: Viewer | undefined
let worker: Worker | undefined
let workerUrl: string | undefined
let pointCollection: PointPrimitiveCollection | undefined
let billboardCollection: BillboardCollection | undefined
let handler: ScreenSpaceEventHandler | undefined

let lons: Float64Array | undefined
let lats: Float64Array | undefined
let xyz: Float64Array | undefined
let categories: Uint8Array | undefined

let generationToken = 0
let epoch = 0
let dataReady = false
let requestSeq = 0
let running = false
let pending = false
let debounceTimer: ReturnType<typeof setTimeout> | undefined

type ClusterIcon = { url: string; size: number }

const iconCache = new Map<string, ClusterIcon>()
const scratchCartesian = new Cartesian3()

function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function approximateGaussian(): number {
  return (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 1.5
}

function getLevelIndex(pointCountValue: number): number {
  for (let i = 0; i < CLUSTER_LEVELS.length; i++) {
    if (pointCountValue >= CLUSTER_LEVELS[i].min && pointCountValue <= CLUSTER_LEVELS[i].max) return i
  }
  return CLUSTER_LEVELS.length - 1
}

function formatCount(value: number): string {
  return value > 999 ? `${(value / 1000).toFixed(1)}k` : String(value)
}

function getClusterIconSize(pointCountValue: number): number {
  const raw = CLUSTER_ICON_MIN_SIZE + CLUSTER_ICON_GROWTH * Math.log2(Math.max(2, pointCountValue))
  return Math.round(Math.min(CLUSTER_ICON_MAX_SIZE, Math.max(CLUSTER_ICON_MIN_SIZE, raw)))
}

function getClusterIcon(pointCountValue: number): ClusterIcon {
  const levelIndex = getLevelIndex(pointCountValue)
  const size = getClusterIconSize(pointCountValue)
  const key = `${levelIndex}-${size}`
  const cached = iconCache.get(key)
  if (cached) return cached

  const level = CLUSTER_LEVELS[levelIndex]
  const ratio = CLUSTER_ICON_OVERSAMPLE
  const canvas = document.createElement('canvas')
  canvas.width = size * ratio
  canvas.height = size * ratio
  const ctx = canvas.getContext('2d')
  if (!ctx) return { url: '', size }

  ctx.scale(ratio, ratio)
  const center = size / 2
  const radius = center - 1.5

  ctx.beginPath()
  ctx.arc(center, center, radius, 0, Math.PI * 2)
  ctx.fillStyle = level.color
  ctx.fill()
  ctx.lineWidth = Math.max(1.5, size * 0.05)
  ctx.strokeStyle = 'rgba(255,255,255,0.92)'
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(center, center, radius * 0.8, 0, Math.PI * 2)
  ctx.lineWidth = Math.max(1, size * 0.025)
  ctx.strokeStyle = 'rgba(255,255,255,0.32)'
  ctx.stroke()

  // 数量直接绘制在聚合图标内部，字号随图标尺寸自适应。
  const text = formatCount(pointCountValue)
  let fontSize = size * 0.44
  ctx.font = `bold ${fontSize}px Arial`
  const maxTextWidth = size * 0.68
  const textWidth = ctx.measureText(text).width
  if (textWidth > maxTextWidth) {
    fontSize *= maxTextWidth / textWidth
    ctx.font = `bold ${fontSize}px Arial`
  }
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, center, center + fontSize * 0.04)

  const icon: ClusterIcon = { url: canvas.toDataURL(), size }
  iconCache.set(key, icon)
  return icon
}

function createCollections(): void {
  if (!viewer) return
  pointCollection = viewer.scene.primitives.add(new PointPrimitiveCollection())
  billboardCollection = viewer.scene.primitives.add(new BillboardCollection({ scene: viewer.scene }))
}

function clearPrimitives(): void {
  pointCollection?.removeAll()
  billboardCollection?.removeAll()
  visibleCount.value = 0
  clusterCount.value = 0
  singleCount.value = 0
  computeTime.value = 0
}

async function buildPoints(): Promise<void> {
  const total = count.value
  const token = generationToken
  const lonsArray = new Float64Array(total)
  const latsArray = new Float64Array(total)
  const positions = new Float64Array(total * 3)
  const categoryArray = new Uint8Array(total)
  const cartesian = new Cartesian3()
  const chunkSize = 20000

  for (let start = 0; start < total; start += chunkSize) {
    if (token !== generationToken) return
    const end = Math.min(start + chunkSize, total)
    for (let i = start; i < end; i++) {
      let lon: number
      let lat: number
      if (Math.random() < 0.4) {
        const spot = HOTSPOTS[Math.floor(Math.random() * HOTSPOTS.length)]
        lon = spot[0] + approximateGaussian() * 0.6
        lat = spot[1] + approximateGaussian() * 0.5
      } else {
        lon = 73 + Math.random() * 62
        lat = 18 + Math.random() * 35
      }
      lonsArray[i] = lon
      latsArray[i] = lat
      Cartesian3.fromDegrees(lon, lat, 0, undefined, cartesian)
      positions[i * 3] = cartesian.x
      positions[i * 3 + 1] = cartesian.y
      positions[i * 3 + 2] = cartesian.z
      categoryArray[i] = Math.floor(Math.random() * CATEGORY_COLORS.length)
    }
    progress.value = end / total
    await nextFrame()
  }

  if (token !== generationToken) return
  lons = lonsArray
  lats = latsArray
  xyz = positions
  categories = categoryArray
}

function sendData(): void {
  if (!worker || !lons || !lats || !xyz) return
  const positionCopy = xyz.slice()
  const lonCopy = lons.slice()
  const latCopy = lats.slice()
  worker.postMessage(
    {
      type: 'setData',
      epoch,
      requestId: ++requestSeq,
      data: {
        count: lons.length,
        position: positionCopy,
        lons: lonCopy,
        lats: latCopy
      }
    },
    [positionCopy.buffer, lonCopy.buffer, latCopy.buffer]
  )
}

function getCameraParams() {
  const camera = viewer!.camera
  const view = Matrix4.toArray(camera.viewMatrix, new Array(16)) as number[]
  const projection = Matrix4.toArray(
    (camera.frustum as PerspectiveFrustum).projectionMatrix,
    new Array(16)
  ) as number[]
  const canvas = viewer!.scene.canvas
  const position = camera.positionWC
  const radii = viewer!.scene.globe?.ellipsoid.radii
  return {
    view: Float64Array.from(view),
    projection: Float64Array.from(projection),
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    cameraPosition: Float64Array.from([position.x, position.y, position.z]),
    ellipsoidRadii: radii ? Float64Array.from([radii.x, radii.y, radii.z]) : undefined
  }
}

function requestCluster(): void {
  if (!dataReady || !worker || !viewer || viewer.isDestroyed()) return
  running = true
  worker.postMessage({
    type: 'cluster',
    epoch,
    requestId: ++requestSeq,
    camera: getCameraParams(),
    options: {
      pixelRange: pixelRange.value,
      minimumClusterSize: minimumClusterSize.value
    }
  })
}

function scheduleCluster(delay = 60): void {
  if (!dataReady || !worker || !viewer || viewer.isDestroyed()) return
  if (running) {
    pending = true
    return
  }
  if (debounceTimer) return
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined
    requestCluster()
  }, delay)
}

function onCameraChanged(): void {
  scheduleCluster()
}

function onWorkerMessage(event: MessageEvent): void {
  const data = event.data as ClusterResponse | DataReadyResponse | undefined
  if (!data || data.epoch !== epoch) return

  if (data.type === 'dataReady') {
    dataReady = true
    scheduleCluster(0)
    return
  }

  if (data.type === 'clusterResult') {
    running = false
    if (data.requestId === requestSeq) applyResult(data)
    if (pending) {
      pending = false
      scheduleCluster(60)
    }
  }
}

function applyResult(result: ClusterResponse): void {
  if (!viewer || viewer.isDestroyed()) return
  const points = pointCollection
  const billboards = billboardCollection
  if (!points || !billboards || !xyz || !categories) return

  billboards.removeAll()
  points.removeAll()

  for (let i = 0; i < result.clusters.length; i++) {
    const cluster = result.clusters[i]
    const icon = getClusterIcon(cluster.pointCount)
    const position = Cartesian3.fromDegrees(
      cluster.longitude,
      cluster.latitude,
      0,
      undefined,
      scratchCartesian
    )
    const pickId: PickedId = { type: 'cluster', data: cluster }
    billboards.add({
      position,
      image: icon.url,
      width: icon.size,
      height: icon.size,
      verticalOrigin: VerticalOrigin.CENTER,
      horizontalOrigin: HorizontalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      id: pickId
    })
  }

  if (showSingles.value) {
    const singles = result.singles
    for (let i = 0; i < singles.length; i++) {
      const index = singles[i]
      scratchCartesian.x = xyz[index * 3]
      scratchCartesian.y = xyz[index * 3 + 1]
      scratchCartesian.z = xyz[index * 3 + 2]
      points.add({
        position: scratchCartesian,
        color: CATEGORY_COLORS[categories[index]],
        pixelSize: pointSize.value,
        outlineColor: Color.WHITE,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: { type: 'point', data: { index } } as PickedId
      })
    }
  }

  visibleCount.value = result.visibleCount
  clusterCount.value = result.clusters.length
  singleCount.value = showSingles.value ? result.singles.length : 0
  computeTime.value = Math.round(result.computeTime)
}

function createWorker(): void {
  const blob = new Blob([CLUSTER_WORKER_SOURCE], { type: 'application/javascript' })
  workerUrl = URL.createObjectURL(blob)
  worker = new Worker(workerUrl)
  worker.onmessage = onWorkerMessage
  worker.onerror = (event) => {
    statusMessage.value = `聚合 Worker 异常：${event.message}`
  }
}

function setupInteraction(): void {
  if (!viewer) return
  handler = new ScreenSpaceEventHandler(viewer.scene.canvas)

  handler.setInputAction(
    (movement: { position: Cartesian2 }) => {
      if (!viewer || viewer.isDestroyed()) return
      const picked = viewer.scene.pick(movement.position) as { id?: PickedId } | undefined
      if (!picked || !picked.id) {
        pickedInfo.value = '未拾取到目标'
        return
      }
      if (picked.id.type === 'cluster') {
        const cluster = picked.id.data
        pickedInfo.value = `聚合点：${cluster.pointCount} 个点（${cluster.longitude.toFixed(4)}, ${cluster.latitude.toFixed(4)}）`
      } else {
        pickedInfo.value = `散点：索引 ${picked.id.data.index}`
      }
    },
    ScreenSpaceEventType.LEFT_CLICK
  )

  handler.setInputAction(
    (movement: { startPosition: Cartesian2; endPosition: Cartesian2 }) => {
      if (!viewer || viewer.isDestroyed()) return
      const picked = viewer.scene.pick(movement.endPosition) as { id?: PickedId } | undefined
      viewer.scene.canvas.style.cursor = picked && picked.id ? 'pointer' : 'default'
    },
    ScreenSpaceEventType.MOUSE_MOVE
  )

  handler.setInputAction(
    (movement: { position: Cartesian2 }) => {
      if (!viewer || viewer.isDestroyed()) return
      const picked = viewer.scene.pick(movement.position) as { id?: PickedId } | undefined
      if (!picked || !picked.id || picked.id.type !== 'cluster') return
      const cluster = picked.id.data
      const center = Cartesian3.fromDegrees(cluster.longitude, cluster.latitude, 0)
      const radius = Math.max(2000, Math.sqrt(cluster.pointCount) * 400)
      viewer.camera.flyToBoundingSphere(new BoundingSphere(center, radius), {
        duration: 1.2,
        offset: new HeadingPitchRange(0, CesiumMath.toRadians(-55), 0)
      })
    },
    ScreenSpaceEventType.LEFT_DOUBLE_CLICK
  )
}

async function regenerate(): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  generationToken += 1
  const token = generationToken
  epoch += 1
  dataReady = false
  running = false
  pending = false
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = undefined
  }

  generating.value = true
  progress.value = 0
  clearPrimitives()
  pickedInfo.value = '点击聚合点或散点查看信息'

  await buildPoints()
  if (token !== generationToken) return

  sendData()
  generating.value = false
  progress.value = 1
}

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => {
      statusMessage.value = message
    },
    onBasemapReady: () => {
      statusMessage.value = ''
    }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    createCollections()
    createWorker()
    setupInteraction()
    viewer.camera.percentageChanged = 0.02
    viewer.camera.moveEnd.addEventListener(onCameraChanged)
    viewer.camera.changed.addEventListener(onCameraChanged)
    viewer.camera.setView({ destination: Cartesian3.fromDegrees(104.0, 32.0, 9000000) })
    regenerate()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  generationToken += 1
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = undefined
  }
  if (viewer && !viewer.isDestroyed()) {
    viewer.camera.moveEnd.removeEventListener(onCameraChanged)
    viewer.camera.changed.removeEventListener(onCameraChanged)
  }
  if (handler) {
    handler.destroy()
    handler = undefined
  }
  if (worker) {
    worker.terminate()
    worker = undefined
  }
  if (workerUrl) {
    URL.revokeObjectURL(workerUrl)
    workerUrl = undefined
  }
  clearPrimitives()
  pointCollection = undefined
  billboardCollection = undefined
  destroyScene(viewer)
  viewer = undefined
  lons = undefined
  lats = undefined
  xyz = undefined
  categories = undefined
  iconCache.clear()
})
</script>

<template>
  <div class="cluster-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">海量点实时聚合</div>

      <div class="section-title">数量<InfoTip title="点数量" text="参与聚合的随机点总数。数据量越大越能体现屏幕空间聚合的性能优势，生成过程在 Web Worker 中完成，不阻塞主线程渲染。" /></div>
      <div class="count-group">
        <button
          v-for="option in COUNT_OPTIONS"
          :key="option"
          class="count-button"
          :class="{ active: count === option }"
          :disabled="generating"
          @click="count = option"
        >
          {{ option >= 10000 ? `${option / 10000}万` : option }}
        </button>
      </div>

      <div class="section-title">聚合参数<InfoTip title="聚合参数" text="屏幕空间聚合的核心参数：像素范围决定聚类半径，最小聚合数决定多少点才合并为一个聚合点。" /></div>
      <div class="control-row">
        <span class="row-label">像素范围<InfoTip title="像素范围" text="聚合半径（像素）。以屏幕空间距离衡量：值越大，相距更远的点会被合并进同一个聚合点，聚合点数量更少、更粗粒度。缩放地图后聚合结果会自动重算。" /></span>
        <input v-model.number="pixelRange" type="range" min="20" max="160" step="10" :disabled="generating" />
        <span class="row-value">{{ pixelRange }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">最小聚合数<InfoTip title="最小聚合数" text="形成聚合点所需的最少点数。低于该数量的点保持为独立散点，值越大越倾向保留散点、聚合点越少。" /></span>
        <input v-model.number="minimumClusterSize" type="range" min="2" max="10" step="1" :disabled="generating" />
        <span class="row-value">{{ minimumClusterSize }}</span>
      </div>

      <div class="section-title">渲染<InfoTip title="渲染" text="控制散点图元的绘制表现。渲染使用 PointPrimitiveCollection 与 BillboardCollection，聚合点以带数量的图标绘制。" /></div>
      <div class="control-row">
        <span class="row-label">散点大小<InfoTip title="散点大小" text="单个未聚合散点的像素直径。调整仅影响散点显示，不改变聚合计算与聚合结果。" /></span>
        <input v-model.number="pointSize" type="range" min="4" max="14" step="1" :disabled="generating" />
        <span class="row-value">{{ pointSize }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">显示散点<InfoTip title="显示散点" text="是否绘制未参与聚合的独立散点。关闭后只显示聚合点，便于观察大规模点的分布密度与聚合效果。" /></span>
        <button class="switch-button" :class="{ 'is-on': showSingles }" role="switch" :aria-checked="showSingles" @click="showSingles = !showSingles">
          <span class="switch-knob"></span>
        </button>
      </div>

      <button class="action-button primary" :disabled="generating" @click="regenerate">
        {{ generating ? `生成中 ${Math.round(progress * 100)}%…` : '重新生成' }}
      </button>

      <p class="hint">
        <template v-if="generating">正在生成 {{ displayCount }} 个点，请稍候…</template>
        <template v-else>可见 {{ visibleCount }} · 聚合 {{ clusterCount }} · 散点 {{ singleCount }}<span v-if="computeTime"> · 聚合 {{ computeTime }} ms</span>
          <InfoTip title="实时指标" text="可见：当前视野内参与统计的点数（已剔除视锥之外、相机背后以及被地球本体遮挡在地平线之外的点）；聚合：合并后的聚合点数量；散点：保持独立的点数；聚合耗时：Worker 完成一次屏幕空间聚合的毫秒数。缩放、平移或倾斜地图后指标会自动刷新。" />
        </template>
      </p>
      <p class="warn">Web Worker 屏幕空间网格聚合；缩放或平移后自动重新聚合，点击聚合点可拾取，双击聚合点飞行展开。</p>
    </div>

    <div class="info-bar">{{ pickedInfo }}</div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.cluster-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 268px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { display: flex; align-items: center; gap: 4px; margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.count-group { display: flex; flex-wrap: wrap; gap: 4px; }
.count-button { height: 22px; padding: 0 8px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: #2c3a52; color: #c3d5e8; font-size: 10px; cursor: pointer; }
.count-button.active { background: #2f80ed; color: #eef4ff; border-color: #2f80ed; }
.count-button:disabled, .action-button:disabled, input:disabled { opacity: 0.5; cursor: not-allowed; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 42px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.switch-button { position: relative; width: 34px; height: 18px; border: 0; border-radius: 9px; background: #40506b; cursor: pointer; transition: background 0.2s; }
.switch-button.is-on { background: #2f80ed; }
.switch-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #eef4ff; transition: transform 0.2s; }
.switch-button.is-on .switch-knob { transform: translateX(16px); }
.action-button { width: 100%; height: 28px; margin-top: 10px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.hint { margin: 8px 0 0; font-size: 10px; color: #9fb8d4; line-height: 1.5; }
.warn { margin: 4px 0 0; font-size: 10px; color: #c99a5a; line-height: 1.5; }
.info-bar { position: absolute; top: 12px; left: 12px; z-index: 10; max-width: 48%; padding: 6px 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 6px; background: rgba(10, 26, 52, 0.82); color: #dce8f5; font-size: 11px; line-height: 1.6; pointer-events: none; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
