<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { pickPosition } from '../measure-lib'
import { CircleWaveMaterialProperty, registerCircleWaveMaterial } from '../water-wave-lib/wave-material'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const creating = ref(false)
const waveCount = ref(0)
const colorHex = ref('#4ad2ff')
const duration = ref(3000)
const count = ref(4)
const gradient = ref(0)
const radius = ref(1000)
const height = ref(10)

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let removeTick: (() => void) | undefined

function makeMaterial(): CircleWaveMaterialProperty {
  return new CircleWaveMaterialProperty({
    color: colorHex.value,
    duration: duration.value,
    gradient: gradient.value,
    count: count.value
  })
}

function addWave(lon: number, lat: number): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.entities.add({
    position: Cartesian3.fromDegrees(lon, lat, height.value),
    ellipse: {
      semiMinorAxis: radius.value,
      semiMajorAxis: radius.value,
      height: height.value,
      material: makeMaterial()
    }
  })
  waveCount.value += 1
  resultMessage.value = `已添加水波纹 #${waveCount.value}`
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !creating.value) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  const carto = Cartographic.fromCartesian(pos)
  addWave(CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude))
}

function updateAllWaves(): void {
  if (!viewer || viewer.isDestroyed()) return
  const material = makeMaterial()
  let updated = 0
  for (const entity of viewer.entities.values) {
    const ellipse = (entity as { ellipse?: { material?: unknown; semiMajorAxis?: unknown; semiMinorAxis?: unknown; height?: unknown } }).ellipse
    if (!ellipse) continue
    const m = ellipse.material
    if (!(m instanceof CircleWaveMaterialProperty)) continue
    const wave = m as CircleWaveMaterialProperty
    wave.color = Color.fromCssColorString(colorHex.value)
    wave.duration = duration.value
    wave.count = count.value
    wave.gradient = gradient.value
    ellipse.semiMajorAxis = radius.value
    ellipse.semiMinorAxis = radius.value
    ellipse.height = height.value
    updated += 1
  }
  void material
  if (updated > 0) resultMessage.value = `已更新 ${updated} 个水波纹参数`
}

function clearAll(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const entity of viewer.entities.values) {
    const ellipse = (entity as { ellipse?: { material?: unknown } }).ellipse
    if (ellipse?.material instanceof CircleWaveMaterialProperty) {
      viewer.entities.remove(entity)
    }
  }
  waveCount.value = 0
  resultMessage.value = '已清除全部水波纹'
}

watch([colorHex, duration, count, gradient, radius, height], () => {
  if (viewer && !viewer.isDestroyed() && waveCount.value > 0) updateAllWaves()
})

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    registerCircleWaveMaterial()
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(116.3649, 39.9975, 5000.0)
    })

    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)

    removeTick = viewer.clock.onTick.addEventListener(() => {
      if (creating.value) viewer?.scene.requestRender()
    })
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  removeTick?.()
  removeTick = undefined
  handler?.destroy()
  handler = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="wave-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">水波纹效果</div>

      <button class="action-button primary" :class="{ active: creating }" @click="creating = !creating">
        {{ creating ? '绘制中… 点击地图添加波纹' : '开始点击创建' }}
      </button>
      <button class="action-button danger" @click="clearAll">清除全部({{ waveCount }})</button>

      <div class="section-title">波纹参数</div>
      <div class="control-row">
        <span class="row-label">颜色</span>
        <input v-model="colorHex" type="color" class="color-input" />
      </div>
      <div class="control-row">
        <span class="row-label">持续时间(ms)</span>
        <input v-model.number="duration" type="range" min="500" max="5000" step="100" />
        <span class="row-value">{{ duration }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">波浪数量</span>
        <input v-model.number="count" type="range" min="1" max="9" step="1" />
        <span class="row-value">{{ count }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">渐变曲率</span>
        <input v-model.number="gradient" type="range" min="0" max="1" step="0.05" />
        <span class="row-value">{{ gradient.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">半径(m)</span>
        <input v-model.number="radius" type="range" min="100" max="3000" step="50" />
        <span class="row-value">{{ radius }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">高度(m)</span>
        <input v-model.number="height" type="range" min="0" max="500" step="10" />
        <span class="row-value">{{ height }}</span>
      </div>

      <p class="hint">开启绘制后单击地图添加水波纹；修改参数实时作用于所有波纹。</p>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.wave-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 248px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 44px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row input[type="color"] { width: 40px; height: 24px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 5px; background: transparent; cursor: pointer; }
.action-button { width: 100%; height: 28px; margin-top: 6px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; }
.action-button.primary { background: #2f80ed; color: #eef4ff; }
.action-button.primary.active { background: #1f6f96; }
.action-button.danger { background: #7a3b4a; color: #ffe3ea; }
.hint { margin: 8px 0 0; font-size: 11px; color: #7f96b3; line-height: 1.5; }
.result-message { margin-top: 6px; font-size: 11px; color: #8be0b2; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
