<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as Cesium from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import { createHeatmapCanvas, type GradientStops } from '../heatmap-lib/heatmap-engine'
import { generateSceneData, heatmapScenes, type HeatmapScene } from '../heatmap-lib/heatmap-data'

const container = ref<HTMLElement>()
const statusMessage = ref('')
const resultMessage = ref('')

const sceneId = ref('beijing-clusters')
const radius = ref(70)
const maxOpacity = ref(0.9)
const minOpacity = ref(0.1)
const blur = ref(0.85)
const canvasWidth = ref(1000)
const paletteId = ref('default')
const useFixedRange = ref(false)
const fixedMin = ref(0)
const fixedMax = ref(1000)
const adaptiveRadius = ref(true)
const randomSeed = ref(20260827)

const activeSceneLabel = ref('')
const metricPoints = ref('0')
const metricRange = ref('-')
const legendGradient = ref('')

const palettes: Array<{ id: string; label: string; stops: GradientStops }> = [
  {
    id: 'default',
    label: '蓝绿黄红',
    stops: { 0.25: 'rgb(0,0,255)', 0.55: 'rgb(0,255,0)', 0.85: 'yellow', 1: 'rgb(255,0,0)' }
  },
  {
    id: 'thermal',
    label: '热成像',
    stops: { 0: 'rgb(30,53,149)', 0.35: 'rgb(0,199,235)', 0.55: 'rgb(0,221,80)', 0.75: 'yellow', 0.95: 'rgb(230,0,0)', 1: 'rgb(150,0,0)' }
  },
  {
    id: 'hot',
    label: '黑红黄白',
    stops: { 0: 'rgb(0,0,0)', 0.4: 'rgb(255,0,0)', 0.7: 'rgb(255,255,0)', 1: 'rgb(255,255,255)' }
  },
  {
    id: 'viridis',
    label: '紫青黄',
    stops: { 0: 'rgb(68,1,84)', 0.3: 'rgb(59,82,139)', 0.55: 'rgb(33,145,140)', 0.8: 'rgb(94,201,98)', 1: 'rgb(253,231,37)' }
  }
]

const activePalette = () => palettes.find((item) => item.id === paletteId.value) ?? palettes[0]

let viewer: ReturnType<typeof createMapScene> | undefined
let disposed = false
let heatmapEntity: Cesium.Entity | undefined
let cameraMoveEndListener: (() => void) | undefined
let lastCameraHeight = 0
let initRadiusValue = 70

function gradientCss(stops: GradientStops): string {
  const parts = Object.keys(stops)
    .sort((a, b) => Number(a) - Number(b))
    .map((position) => `${stops[position]} ${(Number(position) * 100).toFixed(1)}%`)
  return `linear-gradient(90deg, ${parts.join(', ')})`
}

function updateLegend(): void {
  legendGradient.value = gradientCss(activePalette().stops)
}

function updateHeatmap(): void {
  if (!viewer || viewer.isDestroyed()) return
  const scene = heatmapScenes.find((item) => item.id === sceneId.value) ?? heatmapScenes[0]
  const data = generateSceneData(scene, randomSeed.value)
  const gradient = activePalette().stops
  const heatmap = createHeatmapCanvas(data.points, scene.bounds, {
    radius: radius.value,
    blur: blur.value,
    maxOpacity: maxOpacity.value,
    minOpacity: minOpacity.value,
    gradient,
    canvasWidth: canvasWidth.value,
    min: useFixedRange.value ? fixedMin.value : undefined,
    max: useFixedRange.value ? fixedMax.value : undefined
  })
  const dataUrl = heatmap.canvas.toDataURL()
  const material = new Cesium.ImageMaterialProperty({
    image: dataUrl,
    transparent: true
  })
  if (!heatmapEntity) {
    heatmapEntity = viewer.entities.add({
      rectangle: {
        coordinates: Cesium.Rectangle.fromDegrees(
          scene.bounds.west,
          scene.bounds.south,
          scene.bounds.east,
          scene.bounds.north
        ),
        material
      }
    })
  } else {
    heatmapEntity.rectangle!.material = material
  }
  activeSceneLabel.value = scene.label
  metricPoints.value = data.points.length.toLocaleString()
  metricRange.value = `${data.valueMin.toFixed(0)} ~ ${data.valueMax.toFixed(0)}`
  initRadiusValue = radius.value
  lastCameraHeight = viewer.camera.getMagnitude()
  updateLegend()
}

function flyToScene(scene: HeatmapScene): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(
      scene.bounds.west - 0.6,
      scene.bounds.south - 0.6,
      scene.bounds.east + 0.6,
      scene.bounds.north + 0.6
    ),
    duration: 1.2
  })
}

function onSceneChange(): void {
  const scene = heatmapScenes.find((item) => item.id === sceneId.value) ?? heatmapScenes[0]
  radius.value = scene.defaultRadius
  flyToScene(scene)
  updateHeatmap()
  resultMessage.value = `已切换到 ${scene.label}`
}

function onParamChange(): void {
  updateHeatmap()
}

function onRegenerate(): void {
  randomSeed.value = Math.floor(Math.random() * 1e9)
  updateHeatmap()
  resultMessage.value = '热力图已重新生成'
}

function bindCameraListener(): void {
  if (!viewer) return
  if (cameraMoveEndListener) {
    viewer.camera.moveEnd.removeEventListener(cameraMoveEndListener)
    cameraMoveEndListener = undefined
  }
  if (!adaptiveRadius.value) return
  const maxRadius = 120
  const minHeight = 6375000
  const maxHeight = 10000000
  cameraMoveEndListener = () => {
    if (disposed || !viewer || viewer.isDestroyed()) return
    const height = viewer.camera.getMagnitude()
    if (Math.abs(height - lastCameraHeight) < 1500) return
    lastCameraHeight = height
    const base = initRadiusValue
    const nextRadius = Math.round(base + ((maxRadius - base) * (height - minHeight)) / (maxHeight - minHeight))
    if (nextRadius >= 20 && nextRadius <= 200 && nextRadius !== radius.value) {
      radius.value = nextRadius
      updateHeatmap()
    }
  }
  viewer.camera.moveEnd.addEventListener(cameraMoveEndListener)
}

function onAdaptiveToggle(): void {
  bindCameraListener()
  updateHeatmap()
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
    const scene = heatmapScenes.find((item) => item.id === sceneId.value) ?? heatmapScenes[0]
    radius.value = scene.defaultRadius
    viewer.camera.setView({
      destination: Cesium.Rectangle.fromDegrees(
        scene.bounds.west - 0.6,
        scene.bounds.south - 0.6,
        scene.bounds.east + 0.6,
        scene.bounds.north + 0.6
      )
    })
    updateHeatmap()
    bindCameraListener()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  if (cameraMoveEndListener && viewer) {
    viewer.camera.moveEnd.removeEventListener(cameraMoveEndListener)
    cameraMoveEndListener = undefined
  }
  if (viewer && heatmapEntity) {
    viewer.entities.remove(heatmapEntity)
    heatmapEntity = undefined
  }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="hm2-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="hm2-panel">
      <div class="panel-title">热力图</div>
      <div class="panel-subtitle">Canvas 密度热力渲染</div>

      <div class="section-title">数据源</div>
      <div class="hm2-row">
        <select v-model="sceneId" class="hm2-select" aria-label="数据场景" @change="onSceneChange">
          <option v-for="scene in heatmapScenes" :key="scene.id" :value="scene.id">{{ scene.label }}</option>
        </select>
        <button class="hm2-btn" aria-label="随机重新生成数据" @click="onRegenerate">随机生成</button>
      </div>
      <div class="hm2-hint">{{ activeSceneLabel }} · {{ metricPoints }} 个数据点</div>

      <div class="section-title">渲染参数</div>
      <div class="hm2-param"><span>热力半径</span><input v-model.number="radius" type="range" min="15" max="160" step="5" @change="onParamChange" /><b>{{ radius }}</b></div>
      <div class="hm2-param"><span>最大透明度</span><input v-model.number="maxOpacity" type="range" min="0.2" max="1" step="0.05" @change="onParamChange" /><b>{{ maxOpacity.toFixed(2) }}</b></div>
      <div class="hm2-param"><span>最小透明度</span><input v-model.number="minOpacity" type="range" min="0" max="0.5" step="0.05" @change="onParamChange" /><b>{{ minOpacity.toFixed(2) }}</b></div>
      <div class="hm2-param"><span>模糊度</span><input v-model.number="blur" type="range" min="0.2" max="1" step="0.05" @change="onParamChange" /><b>{{ blur.toFixed(2) }}</b></div>
      <div class="hm2-param"><span>画布宽度</span><input v-model.number="canvasWidth" type="range" min="400" max="2000" step="100" @change="onParamChange" /><b>{{ canvasWidth }}</b></div>

      <div class="section-title">色带</div>
      <select v-model="paletteId" class="hm2-select" aria-label="色带" @change="onParamChange">
        <option v-for="item in palettes" :key="item.id" :value="item.id">{{ item.label }}</option>
      </select>
      <div class="hm2-legend" :style="{ background: legendGradient }"></div>
      <div class="hm2-legend-labels"><span>低</span><span>高</span></div>

      <div class="section-title">数据范围</div>
      <div class="hm2-row">
        <button class="hm2-toggle" :class="{ on: useFixedRange }" aria-label="固定范围开关" @click="useFixedRange = !useFixedRange; onParamChange()">{{ useFixedRange ? '固定范围: 开' : '固定范围: 关' }}</button>
        <button class="hm2-toggle" :class="{ on: adaptiveRadius }" aria-label="相机自适应半径" @click="onAdaptiveToggle">{{ adaptiveRadius ? '半径随视角: 开' : '半径随视角: 关' }}</button>
      </div>
      <div v-if="useFixedRange" class="hm2-row">
        <input v-model.number="fixedMin" class="hm2-number" type="number" min="0" max="1000" aria-label="固定最小值" @change="onParamChange" />
        <span class="hm2-sep">~</span>
        <input v-model.number="fixedMax" class="hm2-number" type="number" min="0" max="1000" aria-label="固定最大值" @change="onParamChange" />
      </div>

      <div class="hm2-metrics">
        <div><span>数据范围</span><strong>{{ metricRange }}</strong></div>
        <div><span>数据点数</span><strong>{{ metricPoints }}</strong></div>
      </div>

      <div v-if="resultMessage" class="hm2-hint">{{ resultMessage }}</div>
    </div>

    <div v-if="statusMessage" class="hm2-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.hm2-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #061421; color: #e8fbff; font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif; }
.cesium-container { width: 100%; height: 100%; }
.hm2-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 7px; width: 240px; max-height: calc(100% - 24px); overflow-y: auto; padding: 11px; border: 1px solid rgba(91, 255, 226, 0.28); border-radius: 9px; background: rgba(8, 28, 43, 0.9); backdrop-filter: blur(6px); }
.panel-title { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
.panel-subtitle { font-size: 11px; color: #7da9b8; }
.section-title { margin-top: 4px; padding: 2px 0 1px; border-bottom: 1px solid rgba(91, 255, 226, 0.18); font-size: 11px; font-weight: 700; color: #5fffe0; }
.hm2-row { display: flex; align-items: center; gap: 6px; }
.hm2-select { flex: 1; width: 100%; height: 24px; border: 1px solid rgba(91, 255, 226, 0.24); border-radius: 5px; background: rgba(13, 42, 58, 0.78); color: #d9eff6; font-size: 11px; }
.hm2-btn { height: 24px; padding: 0 10px; border: 0; border-radius: 5px; background: #257f9e; color: #edfaff; cursor: pointer; font-size: 11px; }
.hm2-toggle { height: 22px; padding: 0 8px; border: 1px solid rgba(91, 255, 226, 0.24); border-radius: 5px; background: rgba(13, 42, 58, 0.78); color: #7da9b8; font-size: 11px; cursor: pointer; }
.hm2-toggle.on { color: #e8fbff; border-color: #5fffe0; }
.hm2-param { display: flex; align-items: center; gap: 8px; }
.hm2-param span { flex: 0 0 64px; font-size: 11px; color: #bdd9e4; }
.hm2-param input { flex: 1; min-width: 0; height: 4px; accent-color: #5fffe0; }
.hm2-param b { flex: 0 0 34px; color: #9cc9d8; font-size: 10px; text-align: right; }
.hm2-hint { padding: 4px 7px; border-radius: 5px; background: rgba(13, 42, 58, 0.6); color: #7da9b8; font-size: 11px; line-height: 1.4; }
.hm2-legend { height: 10px; border-radius: 5px; border: 1px solid rgba(91, 255, 226, 0.25); }
.hm2-legend-labels { display: flex; justify-content: space-between; color: #7da9b8; font-size: 10px; }
.hm2-number { width: 70px; height: 22px; border: 1px solid rgba(91, 255, 226, 0.24); border-radius: 5px; background: rgba(13, 42, 58, 0.78); color: #d9eff6; font-size: 11px; text-align: center; }
.hm2-sep { color: #7da9b8; }
.hm2-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.hm2-metrics > div { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border: 1px solid rgba(54, 141, 255, 0.18); border-radius: 6px; background: rgba(13, 42, 58, 0.6); }
.hm2-metrics span { font-size: 10px; color: #7da9b8; }
.hm2-metrics strong { font-size: 12px; color: #e8fbff; }
.hm2-status { position: absolute; inset: 0; z-index: 9; display: grid; place-items: center; padding: 24px; color: #d9eff6; background: rgba(4, 23, 37, 0.72); font-size: 12px; }
</style>
