<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import type { Viewer } from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { WindLayer3D } from './lib'
import {
  generateWindData3D,
  downloadWindData3D,
  normalizeWindData,
  DEFAULT_LEVELS,
  type WindData3D
} from './lib'
import windDataUrl from './data/wind_3d.json?url'

const container = ref<HTMLElement | null>(null)
const errorMessage = ref('')
const statusMessage = ref('正在加载 Bing 地图…')
const loading = ref(false)

const WIND_COLORS = [
  'rgb(175, 240, 91)', 'rgb(150, 243, 87)', 'rgb(124, 246, 88)',
  'rgb(100, 247, 95)', 'rgb(78, 246, 105)', 'rgb(59, 242, 119)',
  'rgb(44, 237, 135)', 'rgb(34, 229, 153)', 'rgb(27, 218, 170)',
  'rgb(25, 206, 186)', 'rgb(27, 192, 201)', 'rgb(32, 177, 212)',
  'rgb(41, 161, 221)', 'rgb(51, 145, 225)', 'rgb(62, 129, 225)',
  'rgb(74, 113, 221)', 'rgb(85, 99, 213)', 'rgb(95, 86, 201)',
  'rgb(104, 74, 187)', 'rgb(110, 64, 170)'
]

const controls = reactive({
  particles: 256,
  speed: 0.3,
  height: 10,
  length: 200,
  dynamic: true
})

const generator = reactive({
  west: 97.5,
  south: 1.0,
  east: 109.99,
  north: 5.55,
  nx: 128,
  ny: 96,
  nz: 6,
  levels: [...DEFAULT_LEVELS]
})

let viewer: Viewer | undefined
let layer: WindLayer3D | undefined
let disposed = false

const sceneCallbacks: SceneCallbacks = {
  onStatus: (message) => {
    statusMessage.value = message
  },
  onBasemapReady: () => {
    statusMessage.value = ''
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function applyOptions(): void {
  if (!layer) return
  layer.updateOptions({
    particlesTextureSize: controls.particles,
    speedFactor: controls.speed,
    heightScale: controls.height,
    lineLength: { min: 20, max: controls.length },
    dynamic: controls.dynamic
  })
}

async function loadWindData(data: WindData3D): Promise<void> {
  if (!viewer || disposed || viewer.isDestroyed()) return
  if (layer) {
    layer.destroy()
    layer = undefined
  }
  layer = new WindLayer3D(viewer, data, {
    colors: WIND_COLORS,
    particlesTextureSize: controls.particles,
    lineWidth: { min: 0.4, max: 1.3 },
    lineLength: { min: 20, max: controls.length },
    heightScale: controls.height,
    speedFactor: controls.speed,
    dropRate: 0.003,
    dropRateBump: 0.001,
    useViewerBounds: true,
    dynamic: controls.dynamic
  })
  layer.zoomTo(0)
  statusMessage.value = ''
}

async function loadSampleData(): Promise<void> {
  if (!viewer || disposed || viewer.isDestroyed()) return
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(windDataUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const raw = await response.json()
    await loadWindData(normalizeWindData(raw))
  } catch (error) {
    errorMessage.value = `风场数据加载失败：${toErrorMessage(error)}`
  } finally {
    loading.value = false
  }
}

function handleGenerate(): void {
  try {
    const data = generateWindData3D({
      west: generator.west,
      south: generator.south,
      east: generator.east,
      north: generator.north,
      nx: generator.nx,
      ny: generator.ny,
      nz: generator.nz,
      levels: generator.levels
    })
    loadWindData(data).catch((error) => {
      errorMessage.value = `风场数据加载失败：${toErrorMessage(error)}`
    })
  } catch (error) {
    errorMessage.value = `生成风场数据失败：${toErrorMessage(error)}`
  }
}

function handleDownload(): void {
  try {
    const data = generateWindData3D({
      west: generator.west,
      south: generator.south,
      east: generator.east,
      north: generator.north,
      nx: generator.nx,
      ny: generator.ny,
      nz: generator.nz,
      levels: generator.levels
    })
    downloadWindData3D(data, `wind_3d_${Date.now()}.json`)
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = `下载风场数据失败：${toErrorMessage(error)}`
  }
}

function handleZoom(): void {
  layer?.zoomTo(1)
}

onMounted(() => {
  if (!container.value) return

  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
  } catch (error) {
    errorMessage.value = toErrorMessage(error)
    statusMessage.value = ''
  }

  if (viewer) {
    loadSampleData()
  }
})

onBeforeUnmount(() => {
  disposed = true
  layer?.destroy()
  layer = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="wind-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="wind-panel">
      <div class="panel-title">三维风场</div>

      <div class="section">
        <div class="section-title">示例数据</div>
        <button class="file-btn" :disabled="loading" @click="loadSampleData">
          {{ loading ? '加载中…' : '加载示例风场' }}
        </button>
      </div>

      <div class="section">
        <div class="section-title">自定义四至生成</div>
        <div class="bounds-grid">
          <label class="field">
            <span>西</span>
            <input v-model.number="generator.west" type="number" step="0.01" />
          </label>
          <label class="field">
            <span>东</span>
            <input v-model.number="generator.east" type="number" step="0.01" />
          </label>
          <label class="field">
            <span>南</span>
            <input v-model.number="generator.south" type="number" step="0.01" />
          </label>
          <label class="field">
            <span>北</span>
            <input v-model.number="generator.north" type="number" step="0.01" />
          </label>
        </div>
        <div class="grid-row">
          <label class="field">
            <span>网格 nx</span>
            <input v-model.number="generator.nx" type="number" min="4" max="256" step="4" />
          </label>
          <label class="field">
            <span>ny</span>
            <input v-model.number="generator.ny" type="number" min="4" max="256" step="4" />
          </label>
          <label class="field">
            <span>层级</span>
            <input v-model.number="generator.nz" type="number" min="2" max="10" step="1" />
          </label>
        </div>
        <div class="btn-row">
          <button class="file-btn" @click="handleGenerate">生成并加载</button>
          <button class="file-btn" @click="handleDownload">下载 JSON</button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">渲染控制</div>
        <label class="slider-row">
          <span>粒子 {{ controls.particles }}</span>
          <input v-model.number="controls.particles" type="range" min="64" max="512" step="8" @input="applyOptions" />
        </label>
        <label class="slider-row">
          <span>速度 {{ controls.speed.toFixed(2) }}</span>
          <input v-model.number="controls.speed" type="range" min="0.05" max="2" step="0.05" @input="applyOptions" />
        </label>
        <label class="slider-row">
          <span>高度 {{ controls.height }}x</span>
          <input v-model.number="controls.height" type="range" min="1" max="40" step="1" @input="applyOptions" />
        </label>
        <label class="slider-row">
          <span>线长 {{ controls.length }}</span>
          <input v-model.number="controls.length" type="range" min="20" max="300" step="5" @input="applyOptions" />
        </label>
        <label class="check-row">
          <input v-model="controls.dynamic" type="checkbox" @change="applyOptions" />
          <span>动态粒子</span>
        </label>
      </div>

      <div class="btn-row">
        <button class="file-btn" @click="handleZoom">缩放到数据范围</button>
      </div>
    </div>

    <div v-if="errorMessage" class="wind-error">{{ errorMessage }}</div>
    <div v-if="statusMessage" class="wind-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.wind-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
  border-radius: 8px;
  background: #152b4c;
}
.cesium-container {
  width: 100%;
  height: 100%;
}
.wind-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 236px;
  max-height: calc(100% - 24px);
  overflow-y: auto;
  padding: 11px;
  border-radius: 9px;
  background: rgba(10, 26, 52, 0.82);
  border: 1px solid rgba(157, 188, 224, 0.22);
  backdrop-filter: blur(6px);
  color: #dce8f5;
}
.panel-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-top: 8px;
  border-top: 1px dashed rgba(157, 188, 224, 0.18);
}
.section-title {
  font-size: 10px;
  color: #8ea5c2;
}
.file-btn {
  width: 100%;
  padding: 6px 4px;
  border-radius: 6px;
  border: 1px solid rgba(157, 188, 224, 0.28);
  background: transparent;
  color: #c4d3e8;
  font-size: 11px;
  cursor: pointer;
}
.file-btn:hover {
  color: #fff;
  border-color: #5eacf5;
  background: rgba(75, 145, 220, 0.14);
}
.file-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.bounds-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
}
.grid-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 5px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.field span {
  font-size: 9px;
  color: #8ea5c2;
}
.field input {
  width: 100%;
  padding: 3px 5px;
  border-radius: 4px;
  border: 1px solid rgba(157, 188, 224, 0.24);
  background: rgba(20, 42, 78, 0.6);
  color: #e6eef9;
  font-size: 11px;
}
.btn-row {
  display: flex;
  gap: 6px;
}
.slider-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 10px;
  color: #c4d3e8;
}
.slider-row input[type='range'] {
  width: 100%;
}
.check-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #c4d3e8;
}
.wind-error {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 10;
  max-width: 60%;
  padding: 7px 10px;
  border-radius: 6px;
  background: rgba(80, 20, 30, 0.9);
  border: 1px solid rgba(255, 157, 157, 0.4);
  color: #ffb4b4;
  font-size: 10px;
  line-height: 1.5;
}
.wind-status {
  position: absolute;
  inset: 0;
  z-index: 9;
  display: grid;
  place-items: center;
  padding: 24px;
  color: #dce8f5;
  background: rgba(8, 21, 40, 0.72);
  font-size: 12px;
}
</style>
