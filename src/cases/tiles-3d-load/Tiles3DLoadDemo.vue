<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  Cartographic,
  Cesium3DTilesInspector,
  Cesium3DTileset,
  Color,
  DirectionalLight,
  Matrix4,
  SunLight,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  loadWorldTerrain,
  type SceneCallbacks
} from '../../lib/cesium-scene'

const DEFAULT_URL =
  'https://app.larkview.cn/lkstationfile/projects/project_1468b9682b6e4b4198cbea2a6ae9b815/layers/model/%E4%BC%9A%E6%98%8C_%E5%80%BE%E6%96%9C%E6%91%84%E5%BD%B1_20250905_1/tileset.json'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const modelUrl = ref(DEFAULT_URL)
const showModel = ref(true)
const lightShadow = ref(true)
const inspector = ref(false)
const loading = ref(false)

let viewer: Viewer | undefined
let tileset: Cesium3DTileset | undefined
let inspectorWidget: Cesium3DTilesInspector | undefined
let inspectorContainer: HTMLDivElement | undefined
let disposed = false

function offsetHeight(model: Cesium3DTileset, height: number): void {
  const boundingSphere = model.boundingSphere
  const cartographic = Cartographic.fromCartesian(boundingSphere.center)
  const { longitude, latitude } = cartographic
  const surface = Cartesian3.fromRadians(longitude, latitude, 0)
  const offset = Cartesian3.fromRadians(longitude, latitude, height)
  const translation = Cartesian3.subtract(offset, surface, new Cartesian3())
  model.modelMatrix = Matrix4.fromTranslation(translation)
}

async function addModel(url: string): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  loading.value = true
  try {
    const model = await Cesium3DTileset.fromUrl(url)
    model.tileLoad.addEventListener((tile) => {
      tile.tileset.trimLoadedTiles()
    })
    offsetHeight(model, 555)
    viewer.scene.primitives.add(model)
    tileset = model
    await viewer.flyTo(model)
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

function removeModel(): void {
  if (!viewer || !tileset) return
  viewer.scene.primitives.remove(tileset)
  tileset = undefined
}

async function onShowModelChange(value: boolean): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  if (value && !tileset) {
    await addModel(modelUrl.value)
  } else if (!value && tileset) {
    removeModel()
  }
}

function onLightShadowChange(value: boolean): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.scene.globe.enableLighting = value
  viewer.shadows = value
  if (value) {
    viewer.scene.light = new DirectionalLight({
      direction: Cartesian3.normalize(new Cartesian3(-0.5, -0.6, 0.7), new Cartesian3()),
      color: Color.WHITE,
      intensity: 3.0
    })
    viewer.scene.shadowMap.maximumDistance = 20000
  } else {
    viewer.scene.light = new SunLight()
  }
  viewer.scene.requestRender()
}

function onInspectorChange(value: boolean): void {
  if (!viewer || viewer.isDestroyed()) return
  if (value) {
    if (!inspectorWidget) {
      inspectorContainer = document.createElement('div')
      inspectorContainer.className = 'tiles-inspector-container'
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
    statusMessage.value = '正在加载Cesium World Terrain...'
    await loadWorldTerrain(viewer)
    if (disposed || !viewer || viewer.isDestroyed()) return
    statusMessage.value = '正在加载 3DTiles 模型...'
    await addModel(modelUrl.value)
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
  <div class="tiles-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="tiles-panel">
      <div class="panel-title">加载 3DTiles 模型</div>
      <label class="url-row">
        <span class="url-label">模型地址</span>
        <input v-model="modelUrl" class="url-input" :disabled="loading" />
      </label>
      <div class="row">
        <span class="row-label">显示模型</span>
        <button class="toggle" :class="{ on: showModel }" :aria-label="showModel ? '隐藏模型' : '显示模型'" @click="showModel = !showModel; onShowModelChange(showModel)"><i></i></button>
      </div>
      <div class="row">
        <span class="row-label">阴影光源</span>
        <button class="toggle" :class="{ on: lightShadow }" :aria-label="lightShadow ? '关闭阴影光源' : '开启阴影光源'" @click="lightShadow = !lightShadow; onLightShadowChange(lightShadow)"><i></i></button>
      </div>
      <div class="row">
        <span class="row-label">监视器</span>
        <button class="toggle" :class="{ on: inspector }" :aria-label="inspector ? '关闭监视器' : '开启监视器'" @click="inspector = !inspector; onInspectorChange(inspector)"><i></i></button>
      </div>
      <div v-if="loading" class="loading-tip">模型加载中…</div>
      <div class="hint">加载外部 3DTiles 服务需网络可达；加载完成后自动定位到模型。</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.tiles-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.tiles-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 8px; width: 252px; padding: 11px; border: 1px solid rgba(157, 188, 224, 0.22); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.url-row { display: flex; align-items: center; gap: 6px; }.url-label { flex: 0 0 56px; color: #8ea5c2; font-size: 10px; }
.url-input { flex: 1; min-width: 0; height: 26px; padding: 0 7px; border-radius: 6px; border: 1px solid rgba(157, 188, 224, 0.24); outline: 0; background: rgba(8, 21, 40, 0.55); color: #e6eef9; font-size: 10px; }
.row { display: flex; align-items: center; justify-content: space-between; }.row-label { color: #c3d5e8; font-size: 11px; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(157, 188, 224, 0.35); cursor: pointer; }.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform 0.2s; }.toggle.on { background: #2f80ed; }.toggle.on i { transform: translateX(18px); }
.loading-tip { font-size: 10px; color: #8ea5c2; }
.hint { font-size: 10px; color: #6d84a3; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>

<style>
.tiles-inspector-container {
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
