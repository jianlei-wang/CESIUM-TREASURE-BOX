<script setup lang="ts">
import { Cartesian2, Cartesian3, Color, ScreenSpaceEventHandler, ScreenSpaceEventType, ShadowMode, type Viewer } from 'cesium'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { createMapScene, destroyScene, loadBingImagery, loadWorldTerrain, type SceneCallbacks } from '../../lib/cesium-scene'
import { pickPosition } from '../measure-lib/pick'
import { ViewShedAnalysis } from '../viewshed-lib/viewshed-engine'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const loading = ref(true)

const near = ref(1)
const far = ref(1200)
const fov = ref(90)
const vAngle = ref(60)
const xRotation = ref(0)
const yRotation = ref(0)
const shadowSize = ref(2048)
const debug = ref(true)
const picking = ref<'observe' | 'target' | null>(null)

let viewer: Viewer | undefined
let viewshed: ViewShedAnalysis | undefined
let handler: ScreenSpaceEventHandler | undefined
let observeEntity: any
let viewEntity: any
let rotation = { x: 0, y: 0 }

const OBSERVE = Cartesian3.fromDegrees(121.479933144824, 29.79248487011, 104.167)
const VIEW_TARGET = Cartesian3.fromDegrees(121.478780989946, 29.789676141017, 2.621)

function updateAspectRatio(): void {
  if (!viewshed) return
  viewshed.aspectRatio = fov.value / vAngle.value
}

function rotateByDelta(axis: 'x' | 'y', value: number, rotate: (delta: number) => void): void {
  const delta = value - rotation[axis]
  rotate(delta)
  rotation[axis] = value
}

function setObserve(position: Cartesian3): void {
  if (!viewshed || !viewer) return
  viewshed.observe = position
  observeEntity = addPoint(position, Color.GOLD, '观察点')
  statusMessage.value = '观察点已更新。'
}

function setViewTarget(position: Cartesian3): void {
  if (!viewshed || !viewer) return
  viewshed.viewPosition = position
  viewEntity = addPoint(position, Color.RED, '目标点')
  statusMessage.value = '观察方向已更新。'
}

function addPoint(position: Cartesian3, color: Color, labelText: string) {
  if (!viewer) return undefined
  if (viewer.entities.values.some((entity: any) => entity.id === `viewshed-${labelText}`)) {
    const existing = viewer.entities.getById(`viewshed-${labelText}`) as any
    existing.position = position
    return existing
  }
  return viewer.entities.add({
    id: `viewshed-${labelText}`,
    position,
    point: { pixelSize: 12, color, outlineColor: Color.WHITE, outlineWidth: 2 },
    label: {
      text: labelText,
      font: '12px sans-serif',
      fillColor: Color.WHITE,
      outlineColor: Color.fromCssColorString('#102b40'),
      outlineWidth: 3,
      style: 2,
      pixelOffset: new Cartesian2(0, -16)
    }
  })
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!picking.value || !viewer) return
  const position = pickPosition(viewer.scene, event.position)
  if (!position) return
  if (picking.value === 'observe') setObserve(position)
  else setViewTarget(position)
  stopPicking()
}

function startPicking(mode: 'observe' | 'target'): void {
  picking.value = mode
  if (!handler) {
    handler = new ScreenSpaceEventHandler(viewer!.scene.canvas)
  }
  handler.setInputAction(onLeftClick, ScreenSpaceEventType.LEFT_CLICK)
  statusMessage.value = mode === 'observe' ? '请在地图上点击以设置观察点' : '请在地图上点击以设置观察目标点'
}

function stopPicking(): void {
  picking.value = null
}

async function mountScene(): Promise<void> {
  if (!container.value) return
  const callbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '正在加载地形…' }
  }
  try {
    viewer = createMapScene(container.value, callbacks)
    loadBingImagery(viewer, callbacks)
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.scene.globe.maximumScreenSpaceError = 2
    statusMessage.value = '正在加载Cesium World Terrain...'
    try {
      await loadWorldTerrain(viewer)
    } catch {
      statusMessage.value = '地形加载失败，已降级为全球椭球体。'
    }
    if (!viewer || viewer.isDestroyed()) return

    addBuilding(121.47943, 29.79203, 52, 46, 88)
    addBuilding(121.48012, 29.79198, 40, 36, 66)
    addBuilding(121.47971, 29.79081, 58, 50, 102)
    addBuilding(121.48045, 29.79072, 46, 42, 58)
    addBuilding(121.47884, 29.79012, 50, 44, 74)
    addBuilding(121.47934, 29.78992, 36, 32, 42)

    observeEntity = addPoint(OBSERVE, Color.GOLD, '观察点')
    viewEntity = addPoint(VIEW_TARGET, Color.RED, '目标点')

    viewshed = new ViewShedAnalysis(viewer, {
      observe: OBSERVE,
      viewPosition: VIEW_TARGET,
      size: shadowSize.value,
      near: near.value,
      fov: fov.value,
      aspectRatio: fov.value / vAngle.value,
      debug: debug.value
    })
    viewshed.update()

    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(121.4797, 29.7915, 320),
      orientation: { heading: 0, pitch: -0.9, roll: 0 }
    })

    handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction(onLeftClick, ScreenSpaceEventType.LEFT_CLICK)

    loading.value = false
    statusMessage.value = '可视域分析已就绪，可拖动视角或调整参数观察遮挡效果。'
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
    loading.value = false
  }
}

function addBuilding(lon: number, lat: number, width: number, depth: number, height: number): void {
  if (!viewer) return
  viewer.entities.add({
    position: Cartesian3.fromDegrees(lon, lat, height / 2),
    box: {
      dimensions: new Cartesian3(width, depth, height),
      material: Color.fromCssColorString('#d9a066').withAlpha(0.95),
      outline: true,
      outlineColor: Color.WHITE,
      shadows: ShadowMode.ENABLED
    }
  })
}

function applyFar(value: number): void {
  if (viewshed) viewshed.far = value
}

function applyNear(value: number): void {
  if (viewshed) viewshed.near = value
}

function applyFov(value: number): void {
  if (!viewshed) return
  viewshed.fov = value
  updateAspectRatio()
}

function applyVAngle(value: number): void {
  vAngle.value = value
  updateAspectRatio()
}

function applyShadowSize(value: number): void {
  if (!viewshed) return
  ;(viewshed as any)._options.size = value
  viewshed.update()
}

onMounted(() => { void mountScene() })

onBeforeUnmount(() => {
  stopPicking()
  handler?.destroy()
  handler = undefined
  if (viewshed) {
    viewshed.destroy()
  }
  viewshed = undefined
  observeEntity = undefined
  viewEntity = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="viewshed-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="viewshed-panel">
      <div class="panel-title">可视域分析</div>

      <div class="pick-row">
        <button class="pick-button" :class="{ active: picking === 'observe' }" :disabled="loading" @click="picking === 'observe' ? stopPicking() : startPicking('observe')">设置观察点</button>
        <button class="pick-button" :class="{ active: picking === 'target' }" :disabled="loading" @click="picking === 'target' ? stopPicking() : startPicking('target')">设置方向点</button>
      </div>

      <label class="param-row">近截面(m)<span class="param-value">{{ near }}</span></label>
      <input class="range" type="range" min="0.5" max="10" step="0.1" v-model.number="near" :disabled="loading" @input="applyNear(near)" />

      <label class="param-row">远截面(m)<span class="param-value">{{ far }}</span></label>
      <input class="range" type="range" min="200" max="3000" step="10" v-model.number="far" :disabled="loading" @input="applyFar(far)" />

      <label class="param-row">水平夹角(°)<span class="param-value">{{ fov }}</span></label>
      <input class="range" type="range" min="20" max="160" step="1" v-model.number="fov" :disabled="loading" @input="applyFov(fov)" />

      <label class="param-row">垂直夹角(°)<span class="param-value">{{ vAngle }}</span></label>
      <input class="range" type="range" min="10" max="90" step="1" v-model.number="vAngle" :disabled="loading" @input="applyVAngle(vAngle)" />

      <label class="param-row">水平旋转(°)<span class="param-value">{{ xRotation }}</span></label>
      <input class="range" type="range" min="-45" max="45" step="1" v-model.number="xRotation" :disabled="loading" @input="rotateByDelta('x', xRotation, (delta: number) => viewshed?.rotateLeft(delta))" />

      <label class="param-row">垂直旋转(°)<span class="param-value">{{ yRotation }}</span></label>
      <input class="range" type="range" min="-45" max="45" step="1" v-model.number="yRotation" :disabled="loading" @input="rotateByDelta('y', yRotation, (delta: number) => viewshed?.rotateUp(delta))" />

      <label class="param-row">阴影分辨率<span class="param-value">{{ shadowSize }}</span></label>
      <select class="select" v-model.number="shadowSize" :disabled="loading" @change="applyShadowSize(shadowSize)">
        <option :value="1024">1024</option>
        <option :value="2048">2048</option>
        <option :value="4096">4096</option>
      </select>

      <div class="row">
        <span class="row-label">显示视锥</span>
        <button class="toggle" :class="{ on: debug }" aria-label="显示视锥" :disabled="loading" @click="debug = !debug; viewshed!.debug = debug"><i></i></button>
      </div>

      <p class="hint">拖动视角浏览，绿色区域可见、红色区域被遮挡；可点击地图重新设置观察点与方向点。</p>
    </div>

    <div v-if="loading" class="status-mask">{{ statusMessage }}</div>
    <div v-else-if="statusMessage" class="status-toast">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.viewshed-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.viewshed-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 8px; width: 236px; padding: 12px; border: 1px solid rgba(137,210,233,.3); border-radius: 9px; background: rgba(8,32,49,.88); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.panel-title { font-size: 12px; font-weight: 700; }
.pick-row { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.pick-button { min-height: 27px; border: 1px solid rgba(137,210,233,.3); border-radius: 5px; background: rgba(137,210,233,.14); color: #d9eff6; cursor: pointer; font-size: 10px; }
.pick-button.active { border-color: #36c5e8; background: #257f9e; color: #fff; }
.pick-button:disabled { opacity: .5; cursor: default; }
.param-row { display: flex; align-items: center; justify-content: space-between; color: #bdd9e4; }
.param-value { min-width: 44px; text-align: right; color: #eaf7fb; font-variant-numeric: tabular-nums; }
.range { width: 100%; accent-color: #36c5e8; }
.select { width: 100%; border: 1px solid rgba(137,210,233,.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; padding: 3px 4px; }
.row { display: flex; align-items: center; justify-content: space-between; }.row-label { color: #bdd9e4; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(137,210,233,.35); cursor: pointer; }.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform .2s; }.toggle.on { background: #2f80ed; }.toggle.on i { transform: translateX(18px); }
.toggle:disabled { opacity: .5; cursor: default; }
.hint { margin: 0; color: #a4c6d2; font-size: 10px; line-height: 1.4; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
.status-toast { position: absolute; top: 12px; left: 50%; z-index: 9; transform: translateX(-50%); max-width: 70%; padding: 8px 16px; border: 1px solid rgba(137,210,233,.35); border-radius: 999px; background: rgba(8,32,49,.88); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; text-align: center; pointer-events: none; }
</style>
