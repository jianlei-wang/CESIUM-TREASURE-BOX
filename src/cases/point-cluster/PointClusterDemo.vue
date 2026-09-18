<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  Color,
  CustomDataSource,
  Math as CesiumMath,
  VerticalOrigin,
  type Entity,
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
const count = ref(10000)
const pixelRange = ref(100)
const minimumClusterSize = ref(3)
const pointSize = ref(15)
const pointOutline = ref(3)
const pointColor = ref('#ffd54a')
const clusterColor = ref('#ff3b30')
const clusterOpacity = ref(0.8)
const generating = ref(false)
const progress = ref(0)
const elapsedMs = ref(0)
const renderedCount = ref(0)

const COUNT_OPTIONS = [5000, 10000, 50000, 100000]

let viewer: Viewer | undefined
let dataSource: CustomDataSource | undefined
let generationToken = 0
const clusterImageCache = new Map<number, string>()

function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function createClusterCanvas(size: number, count: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, 2 * Math.PI)
  const color = Color.fromCssColorString(clusterColor.value).withAlpha(clusterOpacity.value)
  ctx.fillStyle = `rgba(${Math.round(color.red * 255)}, ${Math.round(color.green * 255)}, ${Math.round(color.blue * 255)}, ${color.alpha})`
  ctx.fill()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.font = 'bold 14px Arial'
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(count), size / 2, size / 2 + 1)
  return canvas.toDataURL()
}

function getClusterImage(count: number): string {
  const cached = clusterImageCache.get(count)
  if (cached) return cached
  const size = Math.min(100, 30 + count / 10)
  const image = createClusterCanvas(size, count)
  clusterImageCache.set(count, image)
  return image
}

async function regenerate(): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  const token = ++generationToken
  generating.value = true
  progress.value = 0
  renderedCount.value = 0
  clusterImageCache.clear()
  const startedAt = performance.now()

  if (dataSource) {
    viewer.dataSources.remove(dataSource)
    dataSource = undefined
  }
  dataSource = new CustomDataSource('points')
  viewer.dataSources.add(dataSource)
  const clustering = dataSource.clustering
  clustering.enabled = true
  clustering.pixelRange = pixelRange.value
  clustering.minimumClusterSize = minimumClusterSize.value
  clustering.clusterEvent.addEventListener((clusteredEntities: Entity[], cluster) => {
    cluster.label.show = false
    cluster.billboard.show = true
    cluster.billboard.verticalOrigin = VerticalOrigin.BOTTOM
    cluster.billboard.image = getClusterImage(clusteredEntities.length)
  })

  const total = count.value
  const chunkSize = 5000
  const color = Color.fromCssColorString(pointColor.value)
  for (let i = 0; i < total; i += chunkSize) {
    if (token !== generationToken) return
    const end = Math.min(i + chunkSize, total)
    for (let j = i; j < end; j++) {
      const lon = CesiumMath.randomBetween(-180, 180)
      const lat = CesiumMath.randomBetween(-50, 50)
      dataSource.entities.add({
        position: Cartesian3.fromDegrees(lon, lat, 0),
        point: {
          pixelSize: pointSize.value,
          color,
          outlineColor: Color.WHITE,
          outlineWidth: pointOutline.value
        }
      })
    }
    progress.value = end / total
    renderedCount.value = end
    await nextFrame()
  }

  if (token !== generationToken) return
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
      destination: Cartesian3.fromDegrees(105, 20, 12000000)
    })
    regenerate()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  generationToken += 1
  if (dataSource && viewer && !viewer.isDestroyed()) {
    viewer.dataSources.remove(dataSource)
  }
  dataSource = undefined
  clusterImageCache.clear()
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="cluster-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">基本点聚合</div>

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

      <div class="section-title">聚合参数</div>
      <div class="control-row">
        <span class="row-label">像素范围</span>
        <input v-model.number="pixelRange" type="range" min="20" max="200" step="10" :disabled="generating" />
        <span class="row-value">{{ pixelRange }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">最小聚合数</span>
        <input v-model.number="minimumClusterSize" type="range" min="2" max="10" step="1" :disabled="generating" />
        <span class="row-value">{{ minimumClusterSize }}</span>
      </div>

      <div class="section-title">点样式</div>
      <div class="control-row">
        <span class="row-label">点大小</span>
        <input v-model.number="pointSize" type="range" min="6" max="30" step="1" :disabled="generating" />
        <span class="row-value">{{ pointSize }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">边框宽</span>
        <input v-model.number="pointOutline" type="range" min="1" max="6" step="1" :disabled="generating" />
        <span class="row-value">{{ pointOutline }}</span>
      </div>
      <div class="color-row">
        <label class="color-field">
          <span class="field-label">点颜色</span>
          <input v-model="pointColor" type="color" :disabled="generating" />
        </label>
      </div>

      <div class="section-title">聚合样式</div>
      <div class="control-row">
        <span class="row-label">透明度</span>
        <input v-model.number="clusterOpacity" type="range" min="0.2" max="1" step="0.05" :disabled="generating" />
        <span class="row-value">{{ clusterOpacity.toFixed(2) }}</span>
      </div>
      <div class="color-row">
        <label class="color-field">
          <span class="field-label">聚合颜色</span>
          <input v-model="clusterColor" type="color" :disabled="generating" />
        </label>
      </div>

      <button class="action-button primary" :disabled="generating" @click="regenerate">
        {{ generating ? `生成中 ${Math.round(progress * 100)}%…` : '重新生成' }}
      </button>

      <p class="hint">
        <template v-if="generating">正在生成 {{ count >= 10000 ? `${count / 10000}万` : count }} 个点，请稍候…</template>
        <template v-else>当前已生成 {{ renderedCount >= 10000 ? `${renderedCount / 10000}万` : renderedCount }} 个点{{ elapsedMs ? `，耗时 ${elapsedMs} ms` : '' }}</template>
      </p>
      <p class="warn">采用 Cesium EntityCluster 点聚合；缩小视角可见聚合效果，点击聚合点数量随缩放变化。聚合图标按数量缓存。</p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.cluster-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 268px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.count-group { display: flex; flex-wrap: wrap; gap: 4px; }
.count-button { height: 22px; padding: 0 8px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: #2c3a52; color: #c3d5e8; font-size: 10px; cursor: pointer; }
.count-button.active { background: #2f80ed; color: #eef4ff; border-color: #2f80ed; }
.count-button:disabled, .action-button:disabled, input:disabled { opacity: 0.5; cursor: not-allowed; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 42px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.color-row { display: flex; gap: 8px; margin-top: 6px; }
.color-field { display: flex; align-items: center; gap: 5px; flex: 1; }
.field-label { color: #c3d5e8; font-size: 10px; }
.color-field input[type="color"] { width: 100%; height: 22px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: transparent; cursor: pointer; }
.action-button { width: 100%; height: 28px; margin-top: 10px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.hint { margin: 8px 0 0; font-size: 10px; color: #9fb8d4; line-height: 1.5; }
.warn { margin: 4px 0 0; font-size: 10px; color: #c99a5a; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
