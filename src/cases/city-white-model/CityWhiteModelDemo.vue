<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  Cartographic,
  Cesium3DTileColorBlendMode,
  Cesium3DTileset,
  Cesium3DTileStyle,
  Color,
  Math as CesiumMath,
  Matrix4,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'

const TILESET_URL =
  'https://data.3dbag.nl/v20250903/cesium3dtiles/lod22/tileset.json'

const AMSTERDAM = { lon: 4.9041, lat: 52.3676 }
const LOD_OPTIONS = [
  { label: 'LOD 2.2（精细）', suffix: 'lod22' },
  { label: 'LOD 1.3（简化）', suffix: 'lod13' },
  { label: 'LOD 1.2（最简）', suffix: 'lod12' }
]
const STYLE_COLORS = ['white', 'silver', 'cyan', 'orange']
const BLEND_MODES = [
  { value: Cesium3DTileColorBlendMode.REPLACE, label: '替换' },
  { value: Cesium3DTileColorBlendMode.HIGHLIGHT, label: '高亮' },
  { value: Cesium3DTileColorBlendMode.MIX, label: '混合' }
]

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const lodIndex = ref(0)
const styleColorIndex = ref(0)
const alphaValue = ref(100)
const blendModeIndex = ref(2)
const blendAmount = ref(0.5)
const screenSpaceError = ref(16)
const cacheBytes = ref(512)
const maxOverflow = ref(256)
const skipLod = ref(true)
const dynamicError = ref(false)
const heightOffset = ref(0)
const loading = ref(false)

const perfFps = ref(0)
const perfTiles = ref(0)
const perfTriangles = ref(0)
const perfMemory = ref(0)
const perfQueue = ref(0)

let viewer: Viewer | undefined
let tileset: Cesium3DTileset | undefined
let disposed = false
let perfTimer: number | undefined
let lastFrameTime = 0

function buildUrl(suffix: string): string {
  return `https://data.3dbag.nl/v20250903/cesium3dtiles/${suffix}/tileset.json`
}

function applyStyle(): void {
  if (!viewer || !tileset || viewer.isDestroyed()) return
  const colorName = STYLE_COLORS[styleColorIndex.value]
  const alpha = Math.max(0, Math.min(1, alphaValue.value / 100))
  if (alpha >= 1 && styleColorIndex.value === 0) {
    tileset.style = undefined
  } else {
    tileset.style = new Cesium3DTileStyle({
      color: `color('${colorName}', ${alpha})`
    })
  }
  tileset.colorBlendMode = BLEND_MODES[blendModeIndex.value].value as Cesium3DTileColorBlendMode
  tileset.colorBlendAmount = blendAmount.value
  viewer.scene.requestRender()
}

function applyHeight(): void {
  if (!viewer || !tileset || viewer.isDestroyed()) return
  const boundingSphere = tileset.boundingSphere
  const cartographic = Cartographic.fromCartesian(boundingSphere.center)
  const { longitude, latitude } = cartographic
  const surface = Cartesian3.fromRadians(longitude, latitude, 0)
  const offset = Cartesian3.fromRadians(longitude, latitude, heightOffset.value)
  const translation = Cartesian3.subtract(offset, surface, new Cartesian3())
  tileset.modelMatrix = Matrix4.fromTranslation(translation)
  viewer.scene.requestRender()
}

function applyPerformance(): void {
  if (!viewer || !tileset || viewer.isDestroyed()) return
  tileset.maximumScreenSpaceError = screenSpaceError.value
  tileset.cacheBytes = cacheBytes.value * 1024 * 1024
  tileset.maximumCacheOverflowBytes = maxOverflow.value * 1024 * 1024
  tileset.skipLevelOfDetail = skipLod.value
  tileset.dynamicScreenSpaceError = dynamicError.value
  viewer.scene.requestRender()
}

function updatePerf(): void {
  if (!viewer || !tileset || viewer.isDestroyed()) return
  const now = performance.now()
  if (lastFrameTime > 0) {
    const dt = (now - lastFrameTime) / 1000
    if (dt > 0) perfFps.value = Math.round(1 / dt)
  }
  lastFrameTime = now
  const stats = tileset.statistics
  perfTiles.value = stats?.numberOfTilesWithContentReady ?? 0
  perfTriangles.value = stats?.trianglesLength ?? 0
  perfMemory.value = Math.round(tileset.totalMemoryUsageInBytes / (1024 * 1024))
  perfQueue.value = stats?.numberOfPendingRequests ?? 0
}

async function addModel(): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  loading.value = true
  try {
    const model = await Cesium3DTileset.fromUrl(buildUrl(LOD_OPTIONS[lodIndex.value].suffix))
    model.maximumScreenSpaceError = screenSpaceError.value
    model.cacheBytes = cacheBytes.value * 1024 * 1024
    model.maximumCacheOverflowBytes = maxOverflow.value * 1024 * 1024
    model.skipLevelOfDetail = skipLod.value
    model.dynamicScreenSpaceError = dynamicError.value
    viewer.scene.primitives.add(model)
    tileset = model
    applyHeight()
    applyStyle()
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(AMSTERDAM.lon, AMSTERDAM.lat, 18000),
      orientation: { heading: -1.1, pitch: -CesiumMath.PI_OVER_TWO + 0.22, roll: 0 }
    })
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

function removeModel(): void {
  if (!viewer || viewer.isDestroyed() || !tileset) return
  viewer.scene.primitives.remove(tileset)
  tileset = undefined
}

async function onLodChange(): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  removeModel()
  statusMessage.value = `正在加载 ${LOD_OPTIONS[lodIndex.value].label} 建筑模型…`
  await addModel()
}

async function onReset(): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  removeModel()
  lodIndex.value = 0
  styleColorIndex.value = 0
  alphaValue.value = 100
  blendModeIndex.value = 2
  blendAmount.value = 0.5
  screenSpaceError.value = 16
  cacheBytes.value = 512
  maxOverflow.value = 256
  skipLod.value = true
  dynamicError.value = false
  heightOffset.value = 0
  statusMessage.value = '正在加载 LOD 2.2（精细）建筑模型…'
  await addModel()
}

function onFlyToCity(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(AMSTERDAM.lon, AMSTERDAM.lat, 18000),
    orientation: { heading: -1.1, pitch: -CesiumMath.PI_OVER_TWO + 0.22, roll: 0 }
  })
}

onMounted(async () => {
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
    statusMessage.value = '正在加载荷兰全境建筑白模…'
    await addModel()
    if (disposed || !viewer || viewer.isDestroyed()) return
    perfTimer = window.setInterval(updatePerf, 300)
  } catch (error) {
    if (!disposed) {
      statusMessage.value = error instanceof Error ? error.message : String(error)
    }
  }
})

onBeforeUnmount(() => {
  disposed = true
  if (perfTimer !== undefined) {
    window.clearInterval(perfTimer)
    perfTimer = undefined
  }
  removeModel()
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="city-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">城市建筑白模</div>

      <div class="section-title">数据层级</div>
      <div class="control-row">
        <span class="row-label">LOD 精度</span>
        <select v-model.number="lodIndex" class="select-input" @change="onLodChange">
          <option v-for="(o, i) in LOD_OPTIONS" :key="o.suffix" :value="i">{{ o.label }}</option>
        </select>
      </div>

      <div class="section-title">渲染参数</div>
      <div class="control-row">
        <span class="row-label">着色</span>
        <select v-model.number="styleColorIndex" class="select-input" @change="applyStyle">
          <option v-for="(c, i) in STYLE_COLORS" :key="c" :value="i">{{ c }}</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">透明度</span>
        <input v-model.number="alphaValue" type="range" min="0" max="100" step="1" @input="applyStyle" />
        <span class="row-value">{{ alphaValue }}%</span>
      </div>
      <div class="control-row">
        <span class="row-label">混合模式</span>
        <select v-model.number="blendModeIndex" class="select-input" @change="applyStyle">
          <option v-for="(m, i) in BLEND_MODES" :key="m.label" :value="i">{{ m.label }}</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">混合度</span>
        <input v-model.number="blendAmount" type="range" min="0" max="1" step="0.01" @input="applyStyle" />
        <span class="row-value">{{ blendAmount.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">高度偏移</span>
        <input v-model.number="heightOffset" type="range" min="-200" max="200" step="10" @input="applyHeight" />
        <span class="row-value">{{ heightOffset }}m</span>
      </div>

      <div class="section-title">性能参数</div>
      <div class="control-row">
        <span class="row-label">屏幕空间误差</span>
        <input v-model.number="screenSpaceError" type="range" min="2" max="64" step="1" @input="applyPerformance" />
        <span class="row-value">{{ screenSpaceError }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">缓存内存(MB)</span>
        <input v-model.number="cacheBytes" type="range" min="128" max="2048" step="64" @input="applyPerformance" />
        <span class="row-value">{{ cacheBytes }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">溢出上限(MB)</span>
        <input v-model.number="maxOverflow" type="range" min="0" max="1024" step="64" @input="applyPerformance" />
        <span class="row-value">{{ maxOverflow }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">跳过细节层级</span>
        <button class="toggle" :class="{ on: skipLod }" :aria-label="skipLod ? '关闭跳过细节层级' : '开启跳过细节层级'" @click="skipLod = !skipLod; applyPerformance()"><i></i></button>
      </div>
      <div class="control-row">
        <span class="row-label">动态误差</span>
        <button class="toggle" :class="{ on: dynamicError }" :aria-label="dynamicError ? '关闭动态误差' : '开启动态误差'" @click="dynamicError = !dynamicError; applyPerformance()"><i></i></button>
      </div>

      <div class="section-title">实时性能</div>
      <div class="perf-grid">
        <div class="perf-item"><span class="perf-key">帧率</span><em class="perf-val">{{ perfFps }} FPS</em></div>
        <div class="perf-item"><span class="perf-key">已加载瓦片</span><em class="perf-val">{{ perfTiles }}</em></div>
        <div class="perf-item"><span class="perf-key">三角面数</span><em class="perf-val">{{ perfTriangles.toLocaleString() }}</em></div>
        <div class="perf-item"><span class="perf-key">GPU 内存</span><em class="perf-val">{{ perfMemory }} MB</em></div>
        <div class="perf-item"><span class="perf-key">排队瓦片</span><em class="perf-val">{{ perfQueue }}</em></div>
      </div>

      <div class="btn-row">
        <button class="action-btn" :disabled="!tileset" @click="onFlyToCity">定位阿姆斯特丹</button>
        <button class="action-btn" :disabled="loading" @click="onReset">重置</button>
      </div>
      <div v-if="loading" class="loading-tip">模型加载中…</div>
      <p class="hint">加载荷兰全境建筑白模数据源，通过屏幕空间误差、瓦片缓存、内存上限与 LOD 跳级控制渲染细节与性能。</p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.city-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 248px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 44px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.select-input { width: 108px; height: 24px; padding: 0 4px; border-radius: 5px; border: 1px solid rgba(157, 188, 224, 0.24); background: rgba(8, 21, 40, 0.55); color: #e6eef9; font-size: 11px; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(157, 188, 224, 0.35); cursor: pointer; flex: 0 0 auto; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform 0.2s; }
.toggle.on { background: #2f80ed; }
.toggle.on i { transform: translateX(18px); }
.perf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; }
.perf-item { display: flex; flex-direction: column; padding: 4px 6px; border-radius: 5px; background: rgba(8, 21, 40, 0.55); }
.perf-key { font-size: 10px; color: #8ea5c2; }
.perf-val { font-style: normal; font-size: 11px; color: #8be0b2; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.btn-row { display: flex; gap: 6px; margin-top: 8px; }
.action-btn { flex: 1; height: 26px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.action-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.loading-tip { margin-top: 6px; font-size: 10px; color: #8ea5c2; }
.hint { margin: 8px 0 0; font-size: 10px; color: #6d84a3; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
