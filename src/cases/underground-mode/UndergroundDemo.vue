<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  ConstantPositionProperty,
  ConstantProperty,
  Math as CesiumMath,
  NearFarScalar,
  type Entity,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  loadWorldTerrain,
  type SceneCallbacks
} from '../../lib/cesium-scene'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const undergroundOn = ref(false)
const alpha = ref(0.45)
const depth = ref(45)
const scale = ref(1)

const MODEL_URL = '/data/model/metro_station/scene.gltf'

let viewer: Viewer | undefined
let disposed = false
let modelEntity: Entity | undefined

function setGlobeAlpha(): void {
  if (!viewer || viewer.isDestroyed()) return
  const translucency = viewer.scene.globe.translucency
  const opacity = undergroundOn.value ? alpha.value : 1.0
  translucency.frontFaceAlphaByDistance = new NearFarScalar(1.5e2, opacity, 8.0e6, opacity)
}

function applyUnderground(): void {
  if (!viewer || viewer.isDestroyed()) return
  const globe = viewer.scene.globe
  const translucency = globe.translucency
  translucency.enabled = undergroundOn.value
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = !undergroundOn.value
  setGlobeAlpha()
}

function onAlphaChange(): void {
  setGlobeAlpha()
}

function onDepthScaleChange(): void {
  if (!viewer || viewer.isDestroyed() || !modelEntity) return
  modelEntity.position = new ConstantPositionProperty(Cartesian3.fromDegrees(119.5, 35.5, -depth.value))
  const m = modelEntity.model
  if (m) m.scale = new ConstantProperty(scale.value)
}

function flyAbove(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(119.5, 35.5, 14000),
    orientation: { heading: 0, pitch: CesiumMath.toRadians(-60), roll: 0 },
    duration: 2
  })
}

function flyUnderground(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (!undergroundOn.value) {
    undergroundOn.value = true
    applyUnderground()
  }
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(119.5, 35.5, -depth.value - 220),
    orientation: { heading: 0, pitch: 0, roll: 0 },
    duration: 2
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
    statusMessage.value = '正在加载地形…'
    await loadWorldTerrain(viewer).catch(() => undefined)
    if (disposed || !viewer || viewer.isDestroyed()) return
    viewer.scene.globe.depthTestAgainstTerrain = true

    modelEntity = viewer.entities.add({
      name: '地铁站',
      position: Cartesian3.fromDegrees(119.5, 35.5, -depth.value),
      model: {
        uri: MODEL_URL,
        scale: scale.value
      }
    })
    applyUnderground()
    flyAbove()
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  destroyScene(viewer)
  viewer = undefined
  modelEntity = undefined
})
</script>

<template>
  <div class="ug-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="ug-panel">
      <div class="panel-title">地下模式-地铁站</div>
      <div class="row">
        <span class="row-label">地下模式</span>
        <button class="toggle" :class="{ on: undergroundOn }" aria-label="切换地下模式" @click="undergroundOn = !undergroundOn; applyUnderground()"><i></i></button>
        <span class="state-text">{{ undergroundOn ? '已开启' : '已关闭' }}</span>
      </div>
      <div class="row">
        <span class="row-label">地表透明度</span>
        <input v-model.number="alpha" class="slider" type="range" min="0" max="1" step="0.05" :disabled="!undergroundOn" @change="onAlphaChange" />
        <b class="value">{{ alpha.toFixed(2) }}</b>
      </div>
      <div class="row">
        <span class="row-label">站体埋深</span>
        <input v-model.number="depth" class="slider" type="range" min="10" max="160" step="5" @change="onDepthScaleChange" />
        <b class="value">{{ depth }}m</b>
      </div>
      <div class="row">
        <span class="row-label">模型比例</span>
        <input v-model.number="scale" class="slider" type="range" min="0.5" max="2.5" step="0.1" @change="onDepthScaleChange" />
        <b class="value">{{ scale.toFixed(1) }}</b>
      </div>
      <div class="row">
        <span class="row-label">视角</span>
        <div class="seg-group">
          <button class="seg" @click="flyAbove">地上视角</button>
          <button class="seg" @click="flyUnderground">地下视角</button>
        </div>
      </div>
      <div class="hint">通过开启地球半透明并关闭相机碰撞检测进入地下，可查看埋设于地表下方的地铁站模型（连云港 119.5E/35.5N）。</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.ug-shell {
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
.ug-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  width: 268px;
  padding: 11px;
  border: 1px solid rgba(157, 188, 224, 0.22);
  border-radius: 9px;
  background: rgba(10, 26, 52, 0.86);
  backdrop-filter: blur(6px);
  color: #dce8f5;
  font-size: 12px;
}
.panel-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #8ec8ff;
  margin-bottom: 6px;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 7px 0;
}
.row-label {
  flex: 0 0 68px;
  color: #c3d5e8;
  font-size: 11px;
}
.state-text {
  color: #7fe0c0;
  font-size: 11px;
}
.slider {
  flex: 1;
  min-width: 0;
  accent-color: #2f80ed;
}
.slider:disabled {
  opacity: 0.45;
}
.value {
  flex: 0 0 38px;
  color: #9fc2cf;
  font-size: 10px;
  text-align: right;
}
.seg-group {
  display: flex;
  gap: 4px;
}
.seg {
  padding: 2px 9px;
  border: 1px solid rgba(120, 180, 255, 0.45);
  background: transparent;
  color: #cfe4ff;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}
.seg:hover {
  background: rgba(47, 128, 237, 0.3);
}
.toggle {
  flex: none;
  position: relative;
  width: 36px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(157, 188, 224, 0.35);
  cursor: pointer;
}
.toggle i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #e7f5f8;
  transition: transform 0.2s;
}
.toggle.on {
  background: #2f80ed;
}
.toggle.on i {
  transform: translateX(18px);
}
.hint {
  margin-top: 8px;
  border-top: 1px solid rgba(157, 188, 224, 0.2);
  padding-top: 6px;
  color: #6d84a3;
  font-size: 10px;
  line-height: 1.6;
}
.status-mask {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: 380px;
  padding: 8px 14px;
  border: 1px solid rgba(137, 210, 233, 0.4);
  border-radius: 7px;
  color: #e8f4fa;
  background: rgba(8, 21, 40, 0.88);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35);
  font-size: 12px;
  pointer-events: none;
  text-align: center;
  line-height: 1.5;
}
</style>
