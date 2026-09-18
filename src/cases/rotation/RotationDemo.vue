<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Cartesian3, Math as CesiumMath, type Viewer } from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const autoRotate = ref(true)
const speedDeg = ref(30)
const axisKey = ref<'x' | 'y' | 'z'>('z')

const AXIS_MAP: Record<'x' | 'y' | 'z', Cartesian3> = {
  x: Cartesian3.UNIT_X,
  y: Cartesian3.UNIT_Y,
  z: Cartesian3.UNIT_Z
}

let viewer: Viewer | undefined
let removeTick: (() => void) | undefined
let lastFrame = performance.now()

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(116.3649, 39.9975, 2000000)
    })

    removeTick = viewer.clock.onTick.addEventListener(() => {
      if (!viewer || viewer.isDestroyed() || !autoRotate.value) return
      const now = performance.now()
      const delta = Math.min((now - lastFrame) / 1000, 0.1)
      lastFrame = now
      const angle = CesiumMath.toRadians(speedDeg.value * delta)
      viewer.scene.camera.rotate(AXIS_MAP[axisKey.value], angle)
    })
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  removeTick?.()
  removeTick = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="rotation-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">初始化自转</div>

      <button class="action-button primary" :class="{ active: autoRotate }" @click="autoRotate = !autoRotate">
        {{ autoRotate ? '自转中…' : '已暂停' }}
      </button>

      <div class="section-title">旋转参数</div>
      <div class="control-row">
        <span class="row-label">角速度(°/s)</span>
        <input v-model.number="speedDeg" type="range" min="1" max="360" step="1" />
        <span class="row-value">{{ speedDeg }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">旋转轴</span>
        <div class="mode-group">
          <button class="mode-button" :class="{ active: axisKey === 'z' }" @click="axisKey = 'z'">Z 轴</button>
          <button class="mode-button" :class="{ active: axisKey === 'y' }" @click="axisKey = 'y'">Y 轴</button>
          <button class="mode-button" :class="{ active: axisKey === 'x' }" @click="axisKey = 'x'">X 轴</button>
        </div>
      </div>

      <p class="hint">开启后相机绕所选世界轴持续旋转；调整角速度与旋转轴即时生效。</p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.rotation-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 248px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 48px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.mode-group { display: flex; gap: 4px; }
.mode-button { height: 22px; padding: 0 8px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: #2c3a52; color: #c3d5e8; font-size: 10px; cursor: pointer; }
.mode-button.active { background: #2f80ed; color: #eef4ff; border-color: #2f80ed; }
.action-button { width: 100%; height: 28px; margin-top: 6px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; }
.action-button.primary { background: #2f80ed; color: #eef4ff; }
.action-button.primary.active { background: #1f6f96; }
.hint { margin: 8px 0 0; font-size: 11px; color: #7f96b3; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
