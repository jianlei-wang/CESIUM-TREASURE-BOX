<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Cartesian3, EllipsoidTerrainProvider, type Viewer } from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import RiverWater from '../river-flowfield-lib/river-water'
import surfaceUrl from './data/water-surface.geojson?url'
import centerlineUrl from './data/centerline.geojson?url'

type CenterlineJson = {
  type: string
  features?: Array<{ type: string; geometry?: unknown }>
  geometry?: unknown
}

const WATER_LEVEL = 31

const ui = reactive({
  speed: 1.4,
  flowMultiplier: -1.2,
  foamScale: 1.2,
  foamOffset: 0.2,
  shoreWidth: 0.15,
  deepColor: '#061a14',
  shallowColor: '#147a61',
  alpha: 1,
  exposure: 1.68,
  specularColor: '#e0e5e1',
  specularIntensity: 0.3,
  specularShininess: 220,
  specularAA: 1,
  skyColor: '#7ab5ad',
  fresnelIntensity: 0.14,
  fresnelPower: 5.8,
  showMeteor: false,
  meteorLength: 190,
  meteorWidth: 11,
  flowSpeed: 1.8,
  tailLength: 0.94,
  meteorAlpha: 1,
  meteorSpacing: 2,
  showFlowmap: false
})

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
let viewer: Viewer | undefined
let river: InstanceType<typeof RiverWater> | undefined
let parsedPositions: unknown[] = []
let parsedCenterline: CenterlineJson | null = null
let disposed = false

function parsePolygonToCartesian(geojson: CenterlineJson, height: number): Cartesian3[] {
  const feature = geojson.features?.[0] ?? geojson
  const geometry = (feature as { geometry?: { type?: string; coordinates?: unknown } }).geometry
  if (!geometry) return []
  const coordinates = geometry.coordinates as unknown
  const ring: number[][] =
    geometry.type === 'Polygon'
      ? (coordinates as number[][][])[0]
      : (coordinates as number[][][][])[0][0]
  const flat: number[] = []
  for (const point of ring) {
    flat.push(point[0], point[1], height)
  }
  return Cartesian3.fromDegreesArrayHeights(flat)
}

async function fetchRiverData(): Promise<{ positions: Cartesian3[]; centerline: CenterlineJson }> {
  const [surfaceRes, centerlineRes] = await Promise.all([
    fetch(surfaceUrl).then((res) => res.json()),
    fetch(centerlineUrl).then((res) => res.json())
  ])
  return {
    positions: parsePolygonToCartesian(surfaceRes as CenterlineJson, WATER_LEVEL),
    centerline: centerlineRes as CenterlineJson
  }
}

function buildRiver(): void {
  if (!viewer || disposed) return
  if (parsedPositions.length === 0 || !parsedCenterline) return

  river?.destroy()
  river = new RiverWater(viewer, parsedPositions, parsedCenterline, WATER_LEVEL, { ...ui })
  river.params.showMeteor = ui.showMeteor
  river.flyToTest()
}

async function reloadRiver(): Promise<void> {
  statusMessage.value = '正在重新烘焙水面…'
  const data = await fetchRiverData()
  if (disposed || !viewer) return
  parsedPositions = data.positions
  parsedCenterline = data.centerline
  buildRiver()
  statusMessage.value = ''
}

function onLive(key: keyof typeof ui): void {
  if (!river) return
  river.params[key] = ui[key]
  river.updateUniforms()
}

function onMeteorLive(key: keyof typeof ui): void {
  if (!river) return
  river.updateParams({
    meteorLength: ui.meteorLength,
    meteorWidth: ui.meteorWidth,
    flowSpeed: ui.flowSpeed,
    tailLength: ui.tailLength,
    meteorAlpha: ui.meteorAlpha,
    meteorSpacing: ui.meteorSpacing
  })
  river.params[key] = ui[key]
}

function onShowMeteor(): void {
  if (!river) return
  river.params.showMeteor = ui.showMeteor
  river.updateUniforms()
}

function onFlowmapToggle(): void {
  river?.toggleDebugCanvas(ui.showFlowmap)
}

function locate(): void {
  river?.flyToTest()
}

onMounted(async () => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '正在加载河道数据…' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.terrainProvider = new EllipsoidTerrainProvider()
    loadBingImagery(viewer, sceneCallbacks)
    const data = await fetchRiverData()
    if (disposed || !viewer) return
    parsedPositions = data.positions
    parsedCenterline = data.centerline
    buildRiver()
    statusMessage.value = ''
  } catch (error) {
    if (!disposed) {
      statusMessage.value = error instanceof Error ? error.message : String(error)
    }
  }
})

onBeforeUnmount(() => {
  disposed = true
  river?.destroy()
  river = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="river-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="river-panel">
      <div class="panel-title">河道流场水面</div>
      <div class="action-row">
        <button class="action-button" @click="locate">定位河段</button>
        <button class="action-button" @click="reloadRiver">重新烘焙</button>
      </div>

      <div class="group-label">流速与形态</div>
      <div class="param-row"><span class="param-label">基础流速</span><input v-model.number="ui.speed" class="param-slider" type="range" min="0.05" max="3" step="0.01" @input="onLive('speed')" /><span class="param-value">{{ ui.speed.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">流向调正反</span><input v-model.number="ui.flowMultiplier" class="param-slider" type="range" min="-3" max="3" step="0.1" @input="onLive('flowMultiplier')" /><span class="param-value">{{ ui.flowMultiplier.toFixed(1) }}</span></div>
      <div class="param-row"><span class="param-label">漫滩边缘羽化</span><input v-model.number="ui.shoreWidth" class="param-slider" type="range" min="0.05" max="3" step="0.05" @input="onLive('shoreWidth')" /><span class="param-value">{{ ui.shoreWidth.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">泡沫聚集强度</span><input v-model.number="ui.foamScale" class="param-slider" type="range" min="0" max="4" step="0.1" @input="onLive('foamScale')" /><span class="param-value">{{ ui.foamScale.toFixed(1) }}</span></div>
      <div class="param-row"><span class="param-label">泡沫生成阈值</span><input v-model.number="ui.foamOffset" class="param-slider" type="range" min="0" max="1" step="0.01" @input="onLive('foamOffset')" /><span class="param-value">{{ ui.foamOffset.toFixed(2) }}</span></div>

      <div class="group-label">水体色彩</div>
      <div class="param-row"><span class="param-label">深水区基色</span><input v-model="ui.deepColor" class="color-input" type="color" @input="onLive('deepColor')" /></div>
      <div class="param-row"><span class="param-label">浅水区基色</span><input v-model="ui.shallowColor" class="color-input" type="color" @input="onLive('shallowColor')" /></div>
      <div class="param-row"><span class="param-label">水体不透明度</span><input v-model.number="ui.alpha" class="param-slider" type="range" min="0" max="1" step="0.01" @input="onLive('alpha')" /><span class="param-value">{{ ui.alpha.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">后期亮度增益</span><input v-model.number="ui.exposure" class="param-slider" type="range" min="0.1" max="4" step="0.1" @input="onLive('exposure')" /><span class="param-value">{{ ui.exposure.toFixed(1) }}</span></div>

      <div class="group-label">光学反射</div>
      <div class="param-row"><span class="param-label">镜面高光颜色</span><input v-model="ui.specularColor" class="color-input" type="color" @input="onLive('specularColor')" /></div>
      <div class="param-row"><span class="param-label">太阳高光强度</span><input v-model.number="ui.specularIntensity" class="param-slider" type="range" min="0" max="5" step="0.1" @input="onLive('specularIntensity')" /><span class="param-value">{{ ui.specularIntensity.toFixed(1) }}</span></div>
      <div class="param-row"><span class="param-label">高光斑点聚拢度</span><input v-model.number="ui.specularShininess" class="param-slider" type="range" min="10" max="500" step="5" @input="onLive('specularShininess')" /><span class="param-value">{{ ui.specularShininess }}</span></div>
      <div class="param-row"><span class="param-label">高光抗锯齿</span><input v-model.number="ui.specularAA" class="param-slider" type="range" min="0" max="3" step="0.05" @input="onLive('specularAA')" /><span class="param-value">{{ ui.specularAA.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">环境天空反射色</span><input v-model="ui.skyColor" class="color-input" type="color" @input="onLive('skyColor')" /></div>
      <div class="param-row"><span class="param-label">菲涅尔反射强弱</span><input v-model.number="ui.fresnelIntensity" class="param-slider" type="range" min="0" max="2" step="0.05" @input="onLive('fresnelIntensity')" /><span class="param-value">{{ ui.fresnelIntensity.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">反射角边缘锐度</span><input v-model.number="ui.fresnelPower" class="param-slider" type="range" min="1" max="10" step="0.1" @input="onLive('fresnelPower')" /><span class="param-value">{{ ui.fresnelPower.toFixed(1) }}</span></div>

      <div class="group-label">流向箭头</div>
      <div class="toggle-row"><span class="toggle-label">启用流向箭头</span><button class="toggle" :class="{ on: ui.showMeteor }" :aria-label="ui.showMeteor ? '关闭流向箭头' : '开启流向箭头'" @click="ui.showMeteor = !ui.showMeteor; onShowMeteor()"><i></i></button></div>
      <div class="param-row"><span class="param-label">粒子长度(m)</span><input v-model.number="ui.meteorLength" class="param-slider" type="range" min="10" max="200" step="5" @input="onMeteorLive('meteorLength')" /><span class="param-value">{{ ui.meteorLength }}</span></div>
      <div class="param-row"><span class="param-label">粒子宽度(m)</span><input v-model.number="ui.meteorWidth" class="param-slider" type="range" min="0.5" max="20" step="0.5" @input="onMeteorLive('meteorWidth')" /><span class="param-value">{{ ui.meteorWidth.toFixed(1) }}</span></div>
      <div class="param-row"><span class="param-label">粒子滚动速度</span><input v-model.number="ui.flowSpeed" class="param-slider" type="range" min="0.1" max="6" step="0.1" @input="onMeteorLive('flowSpeed')" /><span class="param-value">{{ ui.flowSpeed.toFixed(1) }}</span></div>
      <div class="param-row"><span class="param-label">粒子衰减拖尾</span><input v-model.number="ui.tailLength" class="param-slider" type="range" min="0.1" max="0.99" step="0.01" @input="onMeteorLive('tailLength')" /><span class="param-value">{{ ui.tailLength.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">粒子透明度</span><input v-model.number="ui.meteorAlpha" class="param-slider" type="range" min="0" max="1" step="0.05" @input="onMeteorLive('meteorAlpha')" /><span class="param-value">{{ ui.meteorAlpha.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">网格采样步长</span><input v-model.number="ui.meteorSpacing" class="param-slider" type="range" min="1" max="60" step="1" @input="onMeteorLive('meteorSpacing')" /><span class="param-value">{{ ui.meteorSpacing }}</span></div>

      <div class="group-label">烘焙场调试</div>
      <div class="toggle-row"><span class="toggle-label">投影流场贴图</span><button class="toggle" :class="{ on: ui.showFlowmap }" :aria-label="ui.showFlowmap ? '关闭流场贴图' : '开启流场贴图'" @click="ui.showFlowmap = !ui.showFlowmap; onFlowmapToggle()"><i></i></button></div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.river-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.river-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 6px; width: 260px; max-height: calc(100% - 24px); overflow-y: auto; padding: 11px; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 32, 49, 0.84); backdrop-filter: blur(6px); color: #ddf2f8; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.group-label { margin-top: 4px; padding-top: 6px; border-top: 1px solid rgba(137, 210, 233, 0.18); color: #8fd3ea; font-size: 11px; font-weight: 600; }
.action-row { display: flex; gap: 8px; }
.action-button { flex: 1; height: 25px; border: 0; border-radius: 5px; background: #257f9e; color: #edfaff; cursor: pointer; font-size: 11px; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; }
.toggle-label, .param-label { font-size: 11px; color: #bdd9e4; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(137, 210, 233, 0.35); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e8f8fb; transition: transform 0.2s; }
.toggle.on { background: #36a8cc; }.toggle.on i { transform: translateX(18px); }
.param-row { display: flex; align-items: center; gap: 8px; }.param-label { flex: 0 0 74px; }.param-slider { flex: 1; min-width: 0; height: 4px; accent-color: #52c4e8; }.param-value { flex: 0 0 32px; color: #9cc9d8; font-size: 10px; text-align: right; }
.color-input { flex: 1; min-width: 0; height: 22px; padding: 0; border: 1px solid rgba(137, 210, 233, 0.24); border-radius: 4px; background: transparent; cursor: pointer; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
