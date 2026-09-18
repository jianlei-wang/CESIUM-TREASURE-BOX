<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Cartesian3, Cartographic, Cesium3DTileset, Matrix4, type Viewer } from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  loadWorldTerrain,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import Flatten from './Flatten'

const MODEL_URL = 'https://app.larkview.cn/lkstationfile/projects/project_1468b9682b6e4b4198cbea2a6ae9b815/layers/model/会昌_倾斜摄影_20250905_1/tileset.json'

const FLAT_REGION_POSITIONS = [
  new Cartesian3(-2496764.3305735635, 5194659.0739088245, 2723291.684294914),
  new Cartesian3(-2496871.560840603, 5194632.9391253935, 2723293.4302219413),
  new Cartesian3(-2496888.006309254, 5194665.904477011, 2723206.5715125515),
  new Cartesian3(-2496785.420688826, 5194704.91080695, 2723205.988085272)
]

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const flatEnabled = ref(false)
const loading = ref(false)

let viewer: Viewer | undefined
let tileset: Cesium3DTileset | undefined
let flatter: Flatten | undefined
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

async function loadModel(): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  loading.value = true
  try {
    const model = await Cesium3DTileset.fromUrl(MODEL_URL)
    model.tileLoad.addEventListener((tile) => {
      tile.tileset.trimLoadedTiles()
    })
    offsetHeight(model, 555)
    viewer.scene.primitives.add(model)
    tileset = model
    await viewer.zoomTo(model)
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

function startFlat(): void {
  if (!tileset) return
  flatter = new Flatten(tileset, { height: -50 })
  flatter.addRegion({ positions: FLAT_REGION_POSITIONS, id: new Date().getTime().toString() })
}

function endFlat(): void {
  if (flatter) {
    flatter.destroy()
    flatter = undefined
  }
}

function onFlatChange(value: boolean): void {
  if (value) {
    startFlat()
  } else {
    endFlat()
  }
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
    await loadModel()
  } catch (error) {
    if (!disposed) {
      statusMessage.value = error instanceof Error ? error.message : String(error)
    }
  }
})

onBeforeUnmount(() => {
  disposed = true
  endFlat()
  if (viewer && tileset && !viewer.isDestroyed()) {
    viewer.scene.primitives.remove(tileset)
  }
  tileset = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="flatten-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="flatten-panel">
      <div class="panel-title">3DTiles 模型压平</div>
      <div class="row">
        <span class="row-label">模型压平</span>
        <button class="toggle" :class="{ on: flatEnabled }" :aria-label="flatEnabled ? '取消压平' : '开始压平'" @click="flatEnabled = !flatEnabled; onFlatChange(flatEnabled)"><i></i></button>
      </div>
      <div v-if="loading" class="loading-tip">模型加载中…</div>
      <div class="hint">开启后对模型中心的矩形区域进行下压（-50 米），关闭恢复原始模型。</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.flatten-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.flatten-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 8px; width: 252px; padding: 11px; border: 1px solid rgba(157, 188, 224, 0.22); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.row { display: flex; align-items: center; justify-content: space-between; }.row-label { color: #c3d5e8; font-size: 11px; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(157, 188, 224, 0.35); cursor: pointer; }.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform 0.2s; }.toggle.on { background: #2f80ed; }.toggle.on i { transform: translateX(18px); }
.loading-tip { font-size: 10px; color: #8ea5c2; }
.hint { font-size: 10px; color: #6d84a3; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
