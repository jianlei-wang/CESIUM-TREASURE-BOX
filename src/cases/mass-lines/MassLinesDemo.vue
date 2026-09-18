<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  PolylineColorAppearance,
  PolylineGeometry,
  Primitive,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const count = ref(100000)
const span = ref(1)
const colorMode = ref<'alternate' | 'single' | 'random'>('alternate')
const color1 = ref('#ff5c5c')
const color2 = ref('#4a9eff')
const width = ref(1.5)
const opacity = ref(0.8)
const generating = ref(false)
const progress = ref(0)
const elapsedMs = ref(0)
const renderedCount = ref(0)

const COUNT_OPTIONS = [10000, 50000, 100000, 500000, 1000000]

let viewer: Viewer | undefined
let linePrimitive: Primitive | undefined
let generationToken = 0

function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function randomPositions(): number[] {
  const vertexCount = 2 + Math.floor(Math.random() * 3)
  const lon = Math.random() * 360 - 180
  const lat = Math.random() * 180 - 90
  const positions: number[] = []
  for (let i = 0; i < vertexCount; i++) {
    positions.push(lon + (Math.random() - 0.5) * span.value, lat + (Math.random() - 0.5) * span.value)
  }
  return positions
}

function resolveColor(index: number): Color {
  if (colorMode.value === 'single') {
    return Color.fromCssColorString(color1.value).withAlpha(opacity.value)
  }
  if (colorMode.value === 'random') {
    return Color.fromHsl(Math.random(), 0.75, 0.6, opacity.value)
  }
  const base = index % 2 === 0 ? color1.value : color2.value
  return Color.fromCssColorString(base).withAlpha(opacity.value)
}

function removePrimitive(): void {
  if (linePrimitive && viewer && !viewer.isDestroyed()) {
    viewer.scene.primitives.remove(linePrimitive)
  }
  linePrimitive = undefined
}

async function regenerate(): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  const token = ++generationToken
  removePrimitive()
  generating.value = true
  progress.value = 0
  renderedCount.value = 0
  const startedAt = performance.now()

  const total = count.value
  const chunkSize = 10000
  const instances: GeometryInstance[] = []
  for (let i = 0; i < total; i += chunkSize) {
    if (token !== generationToken) return
    const end = Math.min(i + chunkSize, total)
    for (let j = i; j < end; j++) {
      instances.push(
        new GeometryInstance({
          geometry: new PolylineGeometry({
            positions: Cartesian3.fromDegreesArray(randomPositions()),
            width: width.value * 3,
            vertexFormat: PolylineColorAppearance.VERTEX_FORMAT
          }),
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(resolveColor(j))
          },
          id: `mass-line-${j}`
        })
      )
    }
    progress.value = end / total
    await nextFrame()
  }

  if (token !== generationToken) return
  linePrimitive = new Primitive({
    asynchronous: false,
    geometryInstances: instances,
    appearance: new PolylineColorAppearance()
  })
  viewer.scene.primitives.add(linePrimitive)
  renderedCount.value = total
  elapsedMs.value = Math.round(performance.now() - startedAt)
  generating.value = false
  progress.value = 1
  statusMessage.value = ''
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
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(116.3649, 39.9975, 4000000)
    })
    regenerate()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  generationToken += 1
  removePrimitive()
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="mass-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">海量不规则线加载</div>

      <div class="section-title">数量</div>
      <div class="count-group">
        <button
          v-for="option in COUNT_OPTIONS"
          :key="option"
          class="count-button"
          :class="{ active: count === option }"
          :disabled="generating"
          @click="count = option"
        >
          {{ option >= 10000 ? `${option / 10000}万` : option }}
        </button>
      </div>

      <div class="section-title">生成参数</div>
      <div class="control-row">
        <span class="row-label">随机范围(°)</span>
        <input v-model.number="span" type="range" min="0.2" max="5" step="0.1" :disabled="generating" />
        <span class="row-value">{{ span.toFixed(1) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">线宽</span>
        <input v-model.number="width" type="range" min="0.5" max="5" step="0.5" :disabled="generating" />
        <span class="row-value">{{ width.toFixed(1) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">透明度</span>
        <input v-model.number="opacity" type="range" min="0.1" max="1" step="0.05" :disabled="generating" />
        <span class="row-value">{{ opacity.toFixed(2) }}</span>
      </div>

      <div class="section-title">颜色模式</div>
      <div class="mode-group">
        <button class="mode-button" :class="{ active: colorMode === 'alternate' }" :disabled="generating" @click="colorMode = 'alternate'">双色交替</button>
        <button class="mode-button" :class="{ active: colorMode === 'single' }" :disabled="generating" @click="colorMode = 'single'">单色</button>
        <button class="mode-button" :class="{ active: colorMode === 'random' }" :disabled="generating" @click="colorMode = 'random'">随机</button>
      </div>
      <div v-if="colorMode !== 'random'" class="color-row">
        <label v-if="colorMode === 'alternate'" class="color-field">
          <span class="field-label">颜色一</span>
          <input v-model="color1" type="color" :disabled="generating" />
        </label>
        <label v-if="colorMode === 'alternate'" class="color-field">
          <span class="field-label">颜色二</span>
          <input v-model="color2" type="color" :disabled="generating" />
        </label>
        <label v-else class="color-field">
          <span class="field-label">颜色</span>
          <input v-model="color1" type="color" :disabled="generating" />
        </label>
      </div>

      <button class="action-button primary" :disabled="generating" @click="regenerate">
        {{ generating ? `生成中 ${Math.round(progress * 100)}%…` : '重新生成' }}
      </button>

      <p class="hint">
        <template v-if="generating">正在生成 {{ count >= 10000 ? `${count / 10000}万` : count }} 条不规则线，请稍候…</template>
        <template v-else>当前已渲染 {{ renderedCount >= 10000 ? `${renderedCount / 10000}万` : renderedCount }} 条{{ elapsedMs ? `，耗时 ${elapsedMs} ms` : '' }}</template>
      </p>
      <p class="warn">Primitive 批量实例渲染；十万级流畅，百万级生成与渲染耗时较长、内存占用高。</p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.mass-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 268px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.count-group { display: flex; flex-wrap: wrap; gap: 4px; }
.count-button { height: 22px; padding: 0 8px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: #2c3a52; color: #c3d5e8; font-size: 10px; cursor: pointer; }
.count-button.active { background: #2f80ed; color: #eef4ff; border-color: #2f80ed; }
.count-button:disabled, .mode-button:disabled, .action-button:disabled, input:disabled { opacity: 0.5; cursor: not-allowed; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 42px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.mode-group { display: flex; gap: 4px; }
.mode-button { flex: 1; height: 22px; padding: 0 4px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: #2c3a52; color: #c3d5e8; font-size: 10px; cursor: pointer; }
.mode-button.active { background: #2f80ed; color: #eef4ff; border-color: #2f80ed; }
.color-row { display: flex; gap: 8px; margin-top: 6px; }
.color-field { display: flex; align-items: center; gap: 5px; flex: 1; }
.field-label { color: #c3d5e8; font-size: 10px; }
.color-field input[type="color"] { width: 100%; height: 22px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: transparent; cursor: pointer; }
.action-button { width: 100%; height: 28px; margin-top: 10px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.hint { margin: 8px 0 0; font-size: 10px; color: #9fb8d4; line-height: 1.5; }
.warn { margin: 4px 0 0; font-size: 10px; color: #c99a5a; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
