<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Cartesian3, Math as CesiumMath, type Viewer } from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import {
  DynamicPolygonLayer,
  type DynamicPolygonStats,
  type PolygonColorMode,
  type PolygonShape
} from './DynamicPolygonLayer'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')

const count = ref(20000)
const shape = ref<PolygonShape>('mixed')
const interval = ref(50)
const speed = ref(120)
const radius = ref(40)
const extent = ref(12000)
const heightOffset = ref(30)
const colorMode = ref<PolygonColorMode>('alternate')
const color1 = ref('#ff7a45')
const color2 = ref('#4a9eff')
const opacity = ref(0.8)
const paused = ref(false)

const stats = ref<DynamicPolygonStats>({
  entityCount: 0,
  fps: 0,
  tickMs: 0,
  uploadBytes: 0,
  interval: 50
})

const COUNT_OPTIONS = [10000, 20000, 50000, 100000]
const INTERVAL_OPTIONS = [20, 50, 100, 200]
const SHAPE_OPTIONS: { value: PolygonShape; label: string }[] = [
  { value: 'triangle', label: '三角形' },
  { value: 'quad', label: '四边形' },
  { value: 'pentagon', label: '五边形' },
  { value: 'mixed', label: '混合' }
]

let viewer: Viewer | undefined
let layer: DynamicPolygonLayer | undefined
let rebuildTimer: ReturnType<typeof setTimeout> | undefined

const uploadLabel = computed(() => {
  const bytes = stats.value.uploadBytes
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${(bytes / 1024).toFixed(1)} KB`
})

function scheduleRebuild(): void {
  if (rebuildTimer) clearTimeout(rebuildTimer)
  rebuildTimer = setTimeout(() => {
    destroyLayer()
    createLayer()
  }, 40)
}

function createLayer(): void {
  if (!viewer || viewer.isDestroyed()) return
  layer = new DynamicPolygonLayer(
    viewer,
    {
      cellCount: count.value,
      extent: extent.value,
      radius: radius.value,
      heightOffset: heightOffset.value,
      shape: shape.value,
      colorMode: colorMode.value,
      color1: color1.value,
      color2: color2.value,
      interval: interval.value,
      speed: speed.value,
      paused: paused.value,
      opacity: opacity.value
    },
    (next) => { stats.value = next }
  )
}

function destroyLayer(): void {
  layer?.destroy()
  layer = undefined
}

watch([interval, speed, paused], () => {
  layer?.setDynamic({ interval: interval.value, speed: speed.value, paused: paused.value })
})

watch(opacity, () => {
  layer?.setOpacity(opacity.value)
})

watch([count, shape, radius, extent, heightOffset, colorMode, color1, color2], scheduleRebuild)

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
      destination: Cartesian3.fromDegrees(116.391, 39.807, 21000),
      orientation: {
        heading: CesiumMath.toRadians(0),
        pitch: CesiumMath.toRadians(-52),
        roll: 0
      }
    })
    createLayer()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (rebuildTimer) clearTimeout(rebuildTimer)
  destroyLayer()
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="mass-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">海量动态多边形 · 实时位置更新</div>

      <div class="section-title">面数量</div>
      <div class="button-group">
        <button
          v-for="option in COUNT_OPTIONS"
          :key="option"
          class="chip"
          :class="{ active: count === option }"
          @click="count = option"
        >
          {{ option >= 10000 ? `${option / 10000}万` : option }}
        </button>
      </div>

      <div class="section-title">面形状</div>
      <div class="button-group">
        <button
          v-for="option in SHAPE_OPTIONS"
          :key="option.value"
          class="chip"
          :class="{ active: shape === option.value }"
          @click="shape = option.value"
        >
          {{ option.label }}
        </button>
      </div>

      <div class="section-title">实时更新</div>
      <div class="control-row">
        <span class="row-label">更新间隔</span>
        <div class="button-group compact">
          <button
            v-for="option in INTERVAL_OPTIONS"
            :key="option"
            class="chip"
            :class="{ active: interval === option }"
            @click="interval = option"
          >
            {{ option }}ms
          </button>
        </div>
      </div>
      <div class="control-row">
        <span class="row-label">移动速度</span>
        <input v-model.number="speed" type="range" min="0" max="400" step="10" />
        <span class="row-value">{{ speed }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">暂停更新</span>
        <label class="switch">
          <input v-model="paused" type="checkbox" />
          <span class="switch-slider"></span>
        </label>
      </div>

      <div class="section-title">面参数</div>
      <div class="control-row">
        <span class="row-label">面半径(m)</span>
        <input v-model.number="radius" type="range" min="10" max="200" step="5" />
        <span class="row-value">{{ radius }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">区域边长(m)</span>
        <input v-model.number="extent" type="range" min="4000" max="40000" step="1000" />
        <span class="row-value">{{ extent }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">抬升(m)</span>
        <input v-model.number="heightOffset" type="range" min="0" max="300" step="10" />
        <span class="row-value">{{ heightOffset }}</span>
      </div>

      <div class="section-title">颜色</div>
      <div class="button-group">
        <button class="chip" :class="{ active: colorMode === 'alternate' }" @click="colorMode = 'alternate'">双色交替</button>
        <button class="chip" :class="{ active: colorMode === 'single' }" @click="colorMode = 'single'">单色</button>
        <button class="chip" :class="{ active: colorMode === 'random' }" @click="colorMode = 'random'">随机</button>
      </div>
      <div v-if="colorMode !== 'random'" class="color-row">
        <label v-if="colorMode === 'alternate'" class="color-field">
          <span class="field-label">颜色一</span>
          <input v-model="color1" type="color" />
        </label>
        <label v-if="colorMode === 'alternate'" class="color-field">
          <span class="field-label">颜色二</span>
          <input v-model="color2" type="color" />
        </label>
        <label v-else class="color-field">
          <span class="field-label">颜色</span>
          <input v-model="color1" type="color" />
        </label>
      </div>
      <div class="control-row">
        <span class="row-label">透明度</span>
        <input v-model.number="opacity" type="range" min="0.1" max="1" step="0.05" />
        <span class="row-value">{{ opacity.toFixed(2) }}</span>
      </div>

      <button class="action-button primary" @click="scheduleRebuild">重新生成</button>

      <div class="stats">
        <div class="stat"><span class="stat-label">面数量</span><span class="stat-value">{{ stats.entityCount.toLocaleString() }}</span></div>
        <div class="stat"><span class="stat-label">帧率</span><span class="stat-value">{{ stats.fps.toFixed(1) }} FPS</span></div>
        <div class="stat"><span class="stat-label">更新耗时</span><span class="stat-value">{{ stats.tickMs.toFixed(2) }} ms</span></div>
        <div class="stat"><span class="stat-label">单次上载</span><span class="stat-value">{{ uploadLabel }}</span></div>
      </div>

      <p class="hint">面位置存于浮点纹理：每 {{ stats.interval }}ms 仅更新一次位置数据并整批上载，顶点在 GPU 上双缓冲插值渲染，单次 DrawCall 完成全部面绘制。</p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.mass-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 274px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.button-group { display: flex; flex-wrap: wrap; gap: 4px; }
.button-group.compact { flex: 1; }
.chip { height: 22px; padding: 0 8px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: #2c3a52; color: #c3d5e8; font-size: 10px; cursor: pointer; }
.chip.active { background: #2f80ed; color: #eef4ff; border-color: #2f80ed; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 42px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.switch { position: relative; display: inline-block; width: 30px; height: 16px; flex: 0 0 auto; }
.switch input { opacity: 0; width: 0; height: 0; }
.switch-slider { position: absolute; inset: 0; border-radius: 8px; background: #2c3a52; transition: background 0.2s; }
.switch-slider::before { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #9fb8d4; transition: transform 0.2s; }
.switch input:checked + .switch-slider { background: #2f80ed; }
.switch input:checked + .switch-slider::before { transform: translateX(14px); background: #ffffff; }
.color-row { display: flex; gap: 8px; margin-top: 6px; }
.color-field { display: flex; align-items: center; gap: 5px; flex: 1; }
.field-label { color: #c3d5e8; font-size: 10px; }
.color-field input[type="color"] { width: 100%; height: 22px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: transparent; cursor: pointer; }
.action-button { width: 100%; height: 28px; margin-top: 10px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; margin-top: 10px; padding: 8px; border-radius: 6px; background: rgba(21, 43, 76, 0.7); }
.stat { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.stat-label { color: #8ea5c2; font-size: 10px; }
.stat-value { color: #cfe0f2; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.hint { margin: 8px 0 0; font-size: 10px; color: #9fb8d4; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
