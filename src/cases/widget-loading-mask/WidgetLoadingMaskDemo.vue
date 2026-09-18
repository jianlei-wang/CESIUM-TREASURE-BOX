<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Cartesian3, type Viewer } from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const loading = ref(true)

let viewer: Viewer | undefined
let loadTimer: number | undefined

function simulateLoading(duration = 2200): void {
  loading.value = true
  if (loadTimer) window.clearTimeout(loadTimer)
  loadTimer = window.setTimeout(() => {
    loading.value = false
  }, duration)
}

onMounted(async () => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => {
      statusMessage.value = ''
      simulateLoading()
    }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.camera.setView({ destination: Cartesian3.fromDegrees(118.8, 32.05, 260000) })
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (loadTimer) window.clearTimeout(loadTimer)
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="widget-shell">
    <div ref="container" class="cesium-container"></div>

    <div v-if="loading" class="cesium-loading-mask">
      <div class="loading">
        <span></span><span></span><span></span><span></span><span></span>
      </div>
    </div>

    <div class="control-panel">
      <div class="panel-title">加载遮罩控件</div>
      <div class="row">
        <span class="row-label">遮罩状态</span>
        <span class="state" :class="{ active: loading }">{{ loading ? '加载中…' : '已就绪' }}</span>
      </div>
      <button class="btn" @click="simulateLoading()">模拟加载 2.2 秒</button>
      <p class="hint">
        全屏半透明遮罩配合五个错峰闪烁的光点，用于底图 / 数据加载期间的过渡反馈。真实项目中可在异步任务开始前显示、完成后隐藏。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.widget-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.cesium-loading-mask { position: absolute; inset: 0; z-index: 20; display: flex; justify-content: center; align-items: center; background: rgba(0, 0, 0, 0.6); }
.loading { width: 150px; height: 15px; margin: 0 auto; }
.loading span { display: inline-block; width: 15px; height: 100%; margin-right: 5px; border-radius: 50%; background: #b8e9ff; animation: load 1.04s ease infinite; }
.loading span:last-child { margin-right: 0; }
.loading span:nth-child(1) { animation-delay: 0.13s; }
.loading span:nth-child(2) { animation-delay: 0.26s; }
.loading span:nth-child(3) { animation-delay: 0.39s; }
.loading span:nth-child(4) { animation-delay: 0.52s; }
.loading span:nth-child(5) { animation-delay: 0.65s; }
@keyframes load {
  0% { opacity: 1; transform: scale(1.3); }
  100% { opacity: 0.2; transform: scale(0.3); }
}
.control-panel { position: absolute; top: 12px; left: 12px; z-index: 30; width: 260px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.state { color: #ffb648; font-size: 11px; }
.state.active { color: #4ee6c2; }
.btn { margin-top: 10px; padding: 5px 12px; border: 1px solid rgba(157, 188, 224, 0.4); border-radius: 6px; background: rgba(47, 128, 237, 0.25); color: #dce8f5; font-size: 11px; cursor: pointer; }
.btn:hover { background: rgba(47, 128, 237, 0.45); }
.hint { margin: 10px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
