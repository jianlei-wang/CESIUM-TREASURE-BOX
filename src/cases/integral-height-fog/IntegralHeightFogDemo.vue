<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Cartesian3, Color, PostProcessStage, type Viewer } from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  loadWorldTerrain,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { INTEGRAL_HEIGHT_FOG_FRAGMENT } from '../../lib/weather'

const container = ref<HTMLElement | null>(null)
const enabled = ref(true)
const fogType = ref<'lin' | 'exp'>('lin')
const fogColor = ref('#ccd1d6')
const fogHeight = ref(1000)
const globalDensity = ref(0.6)
const heightFalloff = ref(0.002)
const fogStartDistance = ref(500)
const brightness = ref(0.95)
const statusMessage = ref('正在加载 Bing 地图…')
let viewer: Viewer | undefined
let stage: PostProcessStage | undefined
let disposed = false

function updateStage(): void {
  if (stage) stage.enabled = enabled.value
}

watch([enabled, fogType, fogColor, fogHeight, globalDensity, heightFalloff, fogStartDistance, brightness], updateStage)

async function mountScene(): Promise<void> {
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
    if (disposed || viewer.isDestroyed()) return

    stage = new PostProcessStage({
      fragmentShader: INTEGRAL_HEIGHT_FOG_FRAGMENT,
      uniforms: {
        u_earthRadiusOnCamera: () => {
          if (!viewer) return 6378137
          return Cartesian3.magnitude(viewer.camera.positionWC) - viewer.camera.positionCartographic.height
        },
        u_cameraHeight: () => viewer?.camera.positionCartographic.height ?? 0,
        u_fogHeight: () => fogHeight.value,
        u_fogColor: () => Color.fromCssColorString(fogColor.value),
        u_globalDensity: () => globalDensity.value,
        u_heightFalloff: () => heightFalloff.value,
        u_fogStartDistance: () => fogStartDistance.value,
        isLinearFog: () => fogType.value === 'lin' ? 1 : 0,
        brightness: () => brightness.value
      }
    })
    viewer.scene.postProcessStages.add(stage)
    statusMessage.value = ''
  } catch (error) {
    if (!disposed) statusMessage.value = error instanceof Error ? error.message : String(error)
  }
}

onMounted(() => { void mountScene() })

onBeforeUnmount(() => {
  disposed = true
  if (viewer && stage) viewer.scene.postProcessStages.remove(stage)
  stage = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="integral-fog-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="integral-fog-panel">
      <div class="panel-title">浓度积分高度雾</div>
      <div class="toggle-row">
        <span class="toggle-label">效果开关</span>
        <button class="toggle" :class="{ on: enabled }" :aria-label="enabled ? '关闭雾效' : '开启雾效'" @click="enabled = !enabled"><i></i></button>
      </div>
      <div class="mode-row">
        <button :class="{ active: fogType === 'lin' }" @click="fogType = 'lin'">线性积分</button>
        <button :class="{ active: fogType === 'exp' }" @click="fogType = 'exp'">指数积分</button>
      </div>
      <label class="param-row"><span>雾颜色</span><input v-model="fogColor" type="color" /></label>
      <label class="param-row"><span>最大高度</span><input v-model.number="fogHeight" class="param-slider" type="range" min="100" max="3000" step="50" /><b>{{ fogHeight }}m</b></label>
      <label class="param-row"><span>全局浓度</span><input v-model.number="globalDensity" class="param-slider" type="range" min="0.1" max="2" step="0.1" /><b>{{ globalDensity.toFixed(1) }}</b></label>
      <label v-if="fogType === 'exp'" class="param-row"><span>衰减系数</span><input v-model.number="heightFalloff" class="param-slider" type="range" min="0.0001" max="0.01" step="0.0001" /><b>{{ heightFalloff.toFixed(4) }}</b></label>
      <label class="param-row"><span>起始距离</span><input v-model.number="fogStartDistance" class="param-slider" type="range" min="100" max="2000" step="50" /><b>{{ fogStartDistance }}m</b></label>
      <label class="param-row"><span>场景亮度</span><input v-model.number="brightness" class="param-slider" type="range" min="0.4" max="1.3" step="0.05" /><b>{{ brightness.toFixed(2) }}</b></label>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.integral-fog-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #162a3a; }
.cesium-container { width: 100%; height: 100%; }
.integral-fog-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 9px; width: 254px; padding: 11px; border: 1px solid rgba(173, 200, 215, 0.25); border-radius: 9px; background: rgba(18, 35, 48, 0.84); backdrop-filter: blur(6px); color: #d9e8ee; }
.panel-title { font-size: 12px; font-weight: 700; }.toggle-row { display: flex; align-items: center; justify-content: space-between; }.toggle-label, .param-row span { font-size: 11px; color: #c4d4dc; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(173, 200, 215, 0.35); cursor: pointer; }.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e2f0f4; transition: transform .2s; }.toggle.on { background: #5d9bb6; }.toggle.on i { transform: translateX(18px); }
.mode-row { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }.mode-row button { padding: 6px 4px; border: 1px solid rgba(173, 200, 215, .25); border-radius: 5px; color: #a9c0ca; background: rgba(255,255,255,.04); font-size: 10px; }.mode-row button.active { color: #fff; background: #4e879f; }
.param-row { display: flex; align-items: center; gap: 7px; }.param-row > span { flex: 0 0 55px; }.param-row input[type='color'] { width: 32px; height: 20px; padding: 0; border: 0; background: transparent; }.param-slider { flex: 1; min-width: 0; height: 4px; accent-color: #79afc3; }.param-row b { flex: 0 0 46px; color: #9bb5c1; font-size: 9px; font-weight: 400; text-align: right; }.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
