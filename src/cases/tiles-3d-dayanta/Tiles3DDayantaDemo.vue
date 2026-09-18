<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  Cartographic,
  Cesium3DTileColorBlendMode,
  Cesium3DTilesInspector,
  Cesium3DTileset,
  Cesium3DTileStyle,
  Matrix4,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  loadWorldTerrain,
  type SceneCallbacks
} from '../../lib/cesium-scene'

const TILESET_URL = '/dayanta/tileset.json'
const STYLE_COLORS = ['white', 'cyan', 'orange', 'red', 'green']

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const showModel = ref(true)
const heightOffset = ref(0)
const alphaValue = ref(100)
const styleColorIndex = ref(0)
const blendModeIndex = ref(2)
const blendAmount = ref(0.5)
const screenSpaceError = ref(16)
const enableLighting = ref(false)
const depthTest = ref(true)
const inspector = ref(false)
const loading = ref(false)

const BLEND_MODES = [
  { value: Cesium3DTileColorBlendMode.REPLACE, label: '替换' },
  { value: Cesium3DTileColorBlendMode.HIGHLIGHT, label: '高亮' },
  { value: Cesium3DTileColorBlendMode.MIX, label: '混合' }
]

let viewer: Viewer | undefined
let tileset: Cesium3DTileset | undefined
let inspectorWidget: Cesium3DTilesInspector | undefined
let inspectorContainer: HTMLDivElement | undefined
let disposed = false

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

function applyScreenSpaceError(): void {
  if (!viewer || !tileset || viewer.isDestroyed()) return
  tileset.maximumScreenSpaceError = screenSpaceError.value
  viewer.scene.requestRender()
}

function onShowModelChange(value: boolean): void {
  if (!viewer || viewer.isDestroyed() || !tileset) return
  tileset.show = value
  viewer.scene.requestRender()
}

function onLightingChange(value: boolean): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.scene.globe.enableLighting = value
  viewer.scene.requestRender()
}

function onDepthTestChange(value: boolean): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.scene.globe.depthTestAgainstTerrain = value
  viewer.scene.requestRender()
}

function onInspectorChange(value: boolean): void {
  if (!viewer || viewer.isDestroyed()) return
  if (value) {
    if (!inspectorWidget) {
      inspectorContainer = document.createElement('div')
      inspectorContainer.className = 'dayanta-inspector-container'
      viewer.container.appendChild(inspectorContainer)
      inspectorWidget = new Cesium3DTilesInspector(inspectorContainer, viewer.scene)
    }
    if (inspectorContainer) {
      inspectorContainer.style.display = 'block'
    }
  } else {
    if (inspectorWidget) {
      inspectorWidget.destroy()
      inspectorWidget = undefined
    }
    if (inspectorContainer) {
      inspectorContainer.remove()
      inspectorContainer = undefined
    }
  }
  viewer.scene.requestRender()
}

async function addModel(): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  loading.value = true
  try {
    const model = await Cesium3DTileset.fromUrl(TILESET_URL)
    model.maximumScreenSpaceError = screenSpaceError.value
    viewer.scene.primitives.add(model)
    tileset = model
    applyHeight()
    applyStyle()
    await viewer.flyTo(model, { offset: undefined })
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

async function onReset(): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  removeModel()
  heightOffset.value = 0
  alphaValue.value = 100
  styleColorIndex.value = 0
  blendModeIndex.value = 2
  blendAmount.value = 0.5
  screenSpaceError.value = 16
  showModel.value = true
  await addModel()
}

onMounted(async () => {
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
    viewer.scene.globe.depthTestAgainstTerrain = depthTest.value
    viewer.scene.globe.maximumScreenSpaceError = 2
    statusMessage.value = '正在加载 Cesium World Terrain…'
    await loadWorldTerrain(viewer)
    if (disposed || !viewer || viewer.isDestroyed()) return
    statusMessage.value = '正在加载大雁塔 3D Tiles 模型…'
    await addModel()
  } catch (error) {
    if (!disposed) {
      statusMessage.value = error instanceof Error ? error.message : String(error)
    }
  }
})

onBeforeUnmount(() => {
  disposed = true
  if (inspectorWidget) {
    inspectorWidget.destroy()
    inspectorWidget = undefined
  }
  if (inspectorContainer) {
    inspectorContainer.remove()
    inspectorContainer = undefined
  }
  removeModel()
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="dayanta-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="dayanta-panel">
      <div class="panel-title">大雁塔 3D Tiles 参数调整</div>

      <div class="row">
        <span class="row-label">显示模型</span>
        <button class="toggle" :class="{ on: showModel }" :aria-label="showModel ? '隐藏模型' : '显示模型'" @click="showModel = !showModel; onShowModelChange(showModel)"><i></i></button>
      </div>
      <div class="row">
        <span class="row-label">高度偏移(m)</span>
        <input v-model.number="heightOffset" class="num-input" type="number" step="5" @change="applyHeight" />
      </div>
      <div class="row">
        <span class="row-label">透明度</span>
        <span class="slider-wrap">
          <input v-model.number="alphaValue" class="slider" type="range" min="0" max="100" step="1" @input="applyStyle" />
          <em class="slider-val">{{ alphaValue }}%</em>
        </span>
      </div>
      <div class="row">
        <span class="row-label">着色</span>
        <select v-model.number="styleColorIndex" class="select-input" @change="applyStyle">
          <option v-for="(c, i) in STYLE_COLORS" :key="i" :value="i">{{ c }}</option>
        </select>
      </div>
      <div class="row">
        <span class="row-label">混合模式</span>
        <select v-model.number="blendModeIndex" class="select-input" @change="applyStyle">
          <option v-for="(m, i) in BLEND_MODES" :key="i" :value="i">{{ m.label }}</option>
        </select>
      </div>
      <div class="row">
        <span class="row-label">混合度</span>
        <span class="slider-wrap">
          <input v-model.number="blendAmount" class="slider" type="range" min="0" max="1" step="0.01" @input="applyStyle" />
          <em class="slider-val">{{ blendAmount.toFixed(2) }}</em>
        </span>
      </div>
      <div class="row">
        <span class="row-label">屏幕空间误差</span>
        <span class="slider-wrap">
          <input v-model.number="screenSpaceError" class="slider" type="range" min="2" max="64" step="1" @input="applyScreenSpaceError" />
          <em class="slider-val">{{ screenSpaceError }}</em>
        </span>
      </div>
      <div class="row">
        <span class="row-label">场景光照</span>
        <button class="toggle" :class="{ on: enableLighting }" :aria-label="enableLighting ? '关闭光照' : '开启光照'" @click="enableLighting = !enableLighting; onLightingChange(enableLighting)"><i></i></button>
      </div>
      <div class="row">
        <span class="row-label">深度测试</span>
        <button class="toggle" :class="{ on: depthTest }" :aria-label="depthTest ? '关闭深度测试' : '开启深度测试'" @click="depthTest = !depthTest; onDepthTestChange(depthTest)"><i></i></button>
      </div>
      <div class="row">
        <span class="row-label">监视器</span>
        <button class="toggle" :class="{ on: inspector }" :aria-label="inspector ? '关闭监视器' : '开启监视器'" @click="inspector = !inspector; onInspectorChange(inspector)"><i></i></button>
      </div>

      <div class="btn-row">
        <button class="action-btn" :disabled="!tileset" @click="viewer && tileset && viewer.flyTo(tileset)">定位模型</button>
        <button class="action-btn" :disabled="loading" @click="onReset">重置</button>
      </div>
      <div v-if="loading" class="loading-tip">模型加载中…</div>
      <div class="hint">本地内置大雁塔 3D Tiles 模型（约 16MB），支持高度/透明度/着色/精度等参数实时调整。</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.dayanta-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.dayanta-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 7px; width: 260px; max-height: calc(100% - 24px); overflow-y: auto; padding: 11px; border: 1px solid rgba(157, 188, 224, 0.22); border-radius: 9px; background: rgba(10, 26, 52, 0.88); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(157, 188, 224, 0.35); cursor: pointer; flex: 0 0 auto; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform 0.2s; }
.toggle.on { background: #2f80ed; }
.toggle.on i { transform: translateX(18px); }
.num-input { width: 84px; height: 24px; padding: 0 6px; border-radius: 5px; border: 1px solid rgba(157, 188, 224, 0.24); outline: 0; background: rgba(8, 21, 40, 0.55); color: #e6eef9; font-size: 11px; text-align: right; }
.slider-wrap { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
.slider { flex: 1; min-width: 0; accent-color: #2f80ed; }
.slider-val { flex: 0 0 40px; text-align: right; font-style: normal; font-size: 10px; color: #8ea5c2; }
.select-input { width: 96px; height: 24px; padding: 0 4px; border-radius: 5px; border: 1px solid rgba(157, 188, 224, 0.24); background: rgba(8, 21, 40, 0.55); color: #e6eef9; font-size: 11px; }
.btn-row { display: flex; gap: 6px; }
.action-btn { flex: 1; height: 26px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.action-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.loading-tip { font-size: 10px; color: #8ea5c2; }
.hint { font-size: 10px; color: #6d84a3; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>

<style>
.dayanta-inspector-container {
  display: block;
  position: absolute;
  top: 12px;
  left: 12px;
  right: auto;
  max-height: calc(100% - 24px);
  box-sizing: border-box;
  overflow-y: auto;
  overflow-x: hidden;
  z-index: 11;
}
</style>
