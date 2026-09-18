<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  Rectangle,
  Resource,
  sampleTerrainMostDetailed,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Math as CesiumMath,
  type Entity,
  type Viewer
} from 'cesium'
import depthMapUrl from './depth-map.webp'
import { createMapScene, destroyScene, loadBingImagery, loadWorldTerrain, type SceneCallbacks } from '../../lib/cesium-scene'
import { FluidDemo, type SimParams } from '../flood-sim-lib/fluid-demo'
import { getDamPos, type Extent } from '../flood-sim-lib/shaders'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const running = ref(false)
const pickingDam = ref(false)
const waterSourceText = ref('(0.62, 0.10)')
const damPosText = ref('未设置')

const EXTENT: Extent = [
  85.2844047,
  28.1153162568,
  85.6062847,
  28.5734562568
]
const DEFAULT_WATER_SOURCE = new Cartesian2(0.62, 0.1)

const ui = reactive({
  waterAddRate: 0.001,
  waterSourceRadius: 0.03,
  attenuation: 0.995,
  strenght: 0.2,
  minTotalFlow: 0.0001,
  initialWaterLevel: 0,
  depth: 180,
  evaporationRate: 0.0,
  waterAlpha: 1.0,
  shallowColor: '#2f6fdd',
  deepColor: '#0b3c91',
  gradientDepth: 0.3,
  minElevation: 4300,
  maxElevation: 5800,
  damHeight: 0.0,
  setDam: false
})

const simParams: SimParams = {
  waterAddRate: ui.waterAddRate,
  waterSourceRadius: ui.waterSourceRadius,
  attenuation: ui.attenuation,
  strenght: ui.strenght,
  minTotalFlow: ui.minTotalFlow,
  initialWaterLevel: ui.initialWaterLevel,
  depth: ui.depth,
  evaporationRate: ui.evaporationRate,
  waterAlpha: ui.waterAlpha,
  shallow: Color.fromCssColorString(ui.shallowColor),
  deep: Color.fromCssColorString(ui.deepColor),
  gradientDepth: ui.gradientDepth,
  minElevation: ui.minElevation,
  maxElevation: ui.maxElevation,
  damHeight: ui.damHeight,
  setDam: ui.setDam,
  waterSource: DEFAULT_WATER_SOURCE,
  damStart: new Cartesian2(0.8, 0),
  damEnd: new Cartesian2(1.0, 0.2)
}

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let sim: FluidDemo | undefined
let waterMarker: Entity | undefined
let wallPositions: number[] = []
let recordPos: number[] = []

function drawWall(): Entity {
  if (!viewer) throw new Error('viewer missing')
  const wall = viewer.entities.add({
    name: 'Dam wall',
    wall: {
      positions: new CallbackProperty(() => {
        return Cartesian3.fromDegreesArray(wallPositions)
      }, false),
      maximumHeights: [simParams.minElevation, simParams.minElevation],
      minimumHeights: new CallbackProperty(() => {
        const height = (simParams.maxElevation - simParams.minElevation) * simParams.damHeight
        return [simParams.minElevation + height, simParams.minElevation + height]
      }, false),
      material: Color.WHITE.withAlpha(0.85),
      outline: false,
      outlineColor: Color.BLACK
    }
  })
  return wall
}

function updateWaterMarker(position: Cartesian3): void {
  if (!viewer) return
  if (waterMarker) viewer.entities.remove(waterMarker)
  waterMarker = viewer.entities.add({
    position,
    point: {
      pixelSize: 10,
      color: Color.fromCssColorString('#ff5252'),
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })
}

function onCanvasClick(movement: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed()) return
  const pickedPosition = viewer.scene.pickPosition(movement.position)
  if (!pickedPosition) return
  if (ui.setDam) {
    if (recordPos.length >= 4) return
    const cartographic = Cartographic.fromCartesian(pickedPosition)
    const lon = CesiumMath.toDegrees(cartographic.longitude)
    const lat = CesiumMath.toDegrees(cartographic.latitude)
    recordPos.push(lon, lat)
    if (recordPos.length === 4) {
      wallPositions = [...recordPos]
      recordPos = []
      if (sim && sim.blueWall) {
        viewer.entities.remove(sim.blueWall)
        sim.blueWall = undefined
      }
      simParams.damStart = getDamPos(wallPositions[0], wallPositions[1], EXTENT)
      simParams.damEnd = getDamPos(wallPositions[2], wallPositions[3], EXTENT)
      if (sim) sim.blueWall = drawWall()
      damPosText.value = `${wallPositions[0].toFixed(5)}, ${wallPositions[1].toFixed(5)} → ${wallPositions[2].toFixed(5)}, ${wallPositions[3].toFixed(5)}`
    }
    return
  }
  const cartographic = Cartographic.fromCartesian(pickedPosition)
  const lon = CesiumMath.toDegrees(cartographic.longitude)
  const lat = CesiumMath.toDegrees(cartographic.latitude)
  const [minLon, minLat, maxLon, maxLat] = EXTENT
  const x = (lon - minLon) / (maxLon - minLon)
  const y = 1 - (lat - minLat) / (maxLat - minLat)
  const pos = new Cartesian2(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)))
  simParams.waterSource = pos
  if (sim) sim.setWaterPos(pos)
  waterSourceText.value = `(${pos.x.toFixed(4)}, ${pos.y.toFixed(4)})`
  updateWaterMarker(pickedPosition)
}

function flushParams(): void {
  simParams.waterAddRate = ui.waterAddRate
  simParams.waterSourceRadius = ui.waterSourceRadius
  simParams.attenuation = ui.attenuation
  simParams.strenght = ui.strenght
  simParams.minTotalFlow = ui.minTotalFlow
  simParams.initialWaterLevel = ui.initialWaterLevel
  simParams.depth = ui.depth
  simParams.evaporationRate = ui.evaporationRate
  simParams.waterAlpha = ui.waterAlpha
  simParams.shallow = Color.fromCssColorString(ui.shallowColor)
  simParams.deep = Color.fromCssColorString(ui.deepColor)
  simParams.gradientDepth = ui.gradientDepth
  simParams.minElevation = ui.minElevation
  simParams.maxElevation = ui.maxElevation
  simParams.damHeight = ui.damHeight
  simParams.setDam = ui.setDam
}

async function startSimulation(): Promise<void> {
  if (!viewer || viewer.isDestroyed() || sim) return
  statusMessage.value = '正在加载深度图与初始化流体模拟…'
  try {
    const image = (await Resource.fetchImage({ url: depthMapUrl })) as HTMLImageElement
    if (!viewer || viewer.isDestroyed()) return
    flushParams()
    sim = new FluidDemo(viewer, simParams, image, EXTENT)
    sim.waterPos = simParams.waterSource
    if (ui.setDam && wallPositions.length === 4) {
      sim.blueWall = drawWall()
    }
    running.value = true
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
}

function stopSimulation(): void {
  if (sim) {
    sim.destroy()
    sim = undefined
  }
  if (waterMarker && viewer) {
    viewer.entities.remove(waterMarker)
    waterMarker = undefined
  }
  running.value = false
  statusMessage.value = ''
}

function toggleSimulation(): void {
  if (running.value) {
    stopSimulation()
  } else {
    void startSimulation()
  }
}

function onElevationChange(): void {
  if (running.value) {
    stopSimulation()
    void startSimulation()
  }
}

function resetWaterSource(): void {
  simParams.waterSource = DEFAULT_WATER_SOURCE
  if (sim) sim.setWaterPos(DEFAULT_WATER_SOURCE)
  waterSourceText.value = `(${DEFAULT_WATER_SOURCE.x.toFixed(2)}, ${DEFAULT_WATER_SOURCE.y.toFixed(2)})`
  if (waterMarker && viewer) {
    viewer.entities.remove(waterMarker)
    waterMarker = undefined
  }
}

async function alignToRealTerrain(): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  statusMessage.value = '正在采样真实地形高程以对齐模拟范围…'
  const [west, south, east, north] = EXTENT
  const samples: Cartographic[] = []
  const grid = 33
  for (let i = 0; i < grid; i += 1) {
    for (let j = 0; j < grid; j += 1) {
      samples.push(Cartographic.fromDegrees(
        west + (east - west) * (i / (grid - 1)),
        south + (north - south) * (j / (grid - 1))
      ))
    }
  }
  try {
    const sampled = await sampleTerrainMostDetailed(viewer.terrainProvider, samples)
    if (!viewer || viewer.isDestroyed()) return
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const s of sampled) {
      if (s.height < min) min = s.height
      if (s.height > max) max = s.height
    }
    if (Number.isFinite(min) && Number.isFinite(max)) {
      ui.minElevation = Math.max(0, Math.floor(min - 100))
      ui.maxElevation = Math.ceil(max + 100)
      statusMessage.value = `已按真实地形对齐：${Math.floor(min)}m ~ ${Math.ceil(max)}m`
      window.setTimeout(() => {
        if (!viewer || viewer.isDestroyed()) return
        statusMessage.value = ''
      }, 3000)
    }
  } catch (error) {
    if (viewer && !viewer.isDestroyed()) statusMessage.value = '真实地形高程采样失败，保持默认范围'
  }
}

watch(
  () => [ui.minElevation, ui.maxElevation, ui.initialWaterLevel],
  () => onElevationChange()
)
watch(ui, () => flushParams(), { deep: true })

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => {
      statusMessage.value = message
    },
    onBasemapReady: () => {
      statusMessage.value = '正在加载Cesium World Terrain...'
    }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    if (!viewer || viewer.isDestroyed()) return
    viewer.scene.globe.depthTestAgainstTerrain = true
    void loadWorldTerrain(viewer)
      .then(() => {
        void alignToRealTerrain()
      })
      .catch(() => {
        if (viewer && !viewer.isDestroyed()) statusMessage.value = '地形加载失败，已降级为椭球面'
      })
      .finally(() => {
        if (!viewer || viewer.isDestroyed()) return
        statusMessage.value = ''
        viewer.camera.flyTo({
          destination: Rectangle.fromDegrees(EXTENT[0], EXTENT[1], EXTENT[2], EXTENT[3]),
          duration: 1.0
        })
      })
    handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((movement: { position: Cartesian2 }) => {
      onCanvasClick(movement)
    }, ScreenSpaceEventType.LEFT_CLICK)
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  stopSimulation()
  if (handler && !handler.isDestroyed()) handler.destroy()
  handler = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="fl-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">洪水淹没模拟</div>

      <button class="start-btn" :class="{ running }" @click="toggleSimulation">
        {{ running ? '停止模拟' : '开始模拟' }}
      </button>

      <div class="sec-title">模拟控制</div>
      <div class="row">
        <span class="row-label">水源点</span>
        <span class="val mono">{{ waterSourceText }}</span>
      </div>
      <div class="row">
        <span class="row-label">水闸状态</span>
        <span class="val mono">{{ ui.setDam ? `已设置 ${damPosText}` : '未启用' }}</span>
      </div>
      <button class="mini-btn" @click="resetWaterSource">重置水源点</button>

      <div class="sec-title">演进区域</div>
      <div class="slider-row">
        <label>最低高程(m) <em>{{ ui.minElevation }}</em></label>
        <input type="range" min="3600" max="6000" step="10" v-model.number="ui.minElevation" />
      </div>
      <div class="slider-row">
        <label>最高高程(m) <em>{{ ui.maxElevation }}</em></label>
        <input type="range" min="4000" max="8000" step="10" v-model.number="ui.maxElevation" />
      </div>
      <div class="row">
        <span class="row-label">绘制水闸（点击地图两点）</span>
        <button class="toggle" :class="{ on: ui.setDam }" :aria-label="ui.setDam ? '关闭水闸' : '开启水闸'" @click="ui.setDam = !ui.setDam"><i></i></button>
      </div>
      <div class="slider-row">
        <label>水闸高度 <em>{{ ui.damHeight.toFixed(2) }}</em></label>
        <input type="range" min="0" max="1" step="0.01" v-model.number="ui.damHeight" />
      </div>

      <div class="sec-title">洪水流体参数</div>
      <div class="slider-row">
        <label>水流增加速率 <em>{{ ui.waterAddRate.toFixed(4) }}</em></label>
        <input type="range" min="0.0001" max="0.01" step="0.0001" v-model.number="ui.waterAddRate" />
      </div>
      <div class="slider-row">
        <label>水源半径 <em>{{ ui.waterSourceRadius.toFixed(3) }}</em></label>
        <input type="range" min="0.005" max="0.5" step="0.005" v-model.number="ui.waterSourceRadius" />
      </div>
      <div class="slider-row">
        <label>衰减（水波） <em>{{ ui.attenuation.toFixed(3) }}</em></label>
        <input type="range" min="0" max="1" step="0.001" v-model.number="ui.attenuation" />
      </div>
      <div class="slider-row">
        <label>强度扰动 <em>{{ ui.strenght.toFixed(3) }}</em></label>
        <input type="range" min="0" max="1" step="0.001" v-model.number="ui.strenght" />
      </div>
      <div class="slider-row">
        <label>最小水流 <em>{{ ui.minTotalFlow.toFixed(5) }}</em></label>
        <input type="range" min="0.00005" max="0.0003" step="0.00001" v-model.number="ui.minTotalFlow" />
      </div>
      <div class="slider-row">
        <label>初始水位 <em>{{ ui.initialWaterLevel.toFixed(3) }}</em></label>
        <input type="range" min="0" max="1" step="0.01" v-model.number="ui.initialWaterLevel" />
      </div>
      <div class="slider-row">
        <label>光线步进次数 <em>{{ ui.depth }}</em></label>
        <input type="range" min="50" max="500" step="10" v-model.number="ui.depth" />
      </div>
      <div class="slider-row">
        <label>蒸发率 <em>{{ ui.evaporationRate.toFixed(4) }}</em></label>
        <input type="range" min="0" max="0.001" step="0.00001" v-model.number="ui.evaporationRate" />
      </div>
      <div class="slider-row">
        <label>水流透明度 <em>{{ ui.waterAlpha.toFixed(3) }}</em></label>
        <input type="range" min="0.001" max="1" step="0.001" v-model.number="ui.waterAlpha" />
      </div>
      <div class="row">
        <span class="row-label">浅水区颜色</span>
        <input type="color" v-model="ui.shallowColor" />
      </div>
      <div class="row">
        <span class="row-label">深水区颜色</span>
        <input type="color" v-model="ui.deepColor" />
      </div>
      <div class="slider-row">
        <label>颜色渐变深度 <em>{{ ui.gradientDepth.toFixed(2) }}</em></label>
        <input type="range" min="0.05" max="1" step="0.01" v-model.number="ui.gradientDepth" />
      </div>
      <p class="hint">
        <b>操作：</b>点击地图任意位置可将水源点移动到该处（水从该点持续涌入）；勾选「绘制水闸」后依次点击地图两点即可建立挡水墙。<br />
        <b>深度图：</b>采用用户提供的 1024×1024 高程深度图，映射到 85.28°E~85.61°E、28.12°N~28.57°N（约 30km×51km）区域。<br />
        <b>地形对照：</b>场景加载 Cesium World Terrain 全球地形，启动后自动采样真实地形高程并对齐模拟范围（最低/最高高程滑杆自动贴合真实地形），便于判断模拟区域真实位置。<br />
        <b>模拟原理：</b>GPU 双缓冲流体模拟（地形高程+水深双通道纹理、四方向流量守恒更新）叠加光线步进水渲染，逐像素求水面与地形交点并计算反射高光。<br />
        <b>注意：</b>初始水位 / 最低·最高高程 变更后需要重新开始模拟生效；其余参数运行中实时调整。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.fl-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 288px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.88); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; max-height: calc(100% - 24px); overflow-y: auto; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.start-btn { width: 100%; margin-top: 10px; padding: 7px 0; border: 1px solid rgba(101, 211, 235, 0.5); border-radius: 6px; background: rgba(47, 128, 237, 0.22); color: #65d3eb; font-size: 12px; font-weight: 700; cursor: pointer; }
.start-btn.running { background: rgba(255, 82, 82, 0.25); border-color: rgba(255, 82, 82, 0.55); color: #ff8a8a; }
.mini-btn { width: 100%; margin-top: 6px; padding: 4px 0; border: 1px solid rgba(157, 188, 224, 0.35); border-radius: 6px; background: transparent; color: #9fb3cc; font-size: 11px; cursor: pointer; }
.sec-title { margin-top: 12px; font-size: 11px; font-weight: 700; color: #65d3eb; letter-spacing: 0.03em; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.row-label { color: #c3d5e8; font-size: 11px; }
.val { font-size: 11px; color: #65d3eb; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(157, 188, 224, 0.35); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform 0.2s; }
.toggle.on { background: #2f80ed; }
.toggle.on i { transform: translateX(18px); }
.slider-row { margin-top: 9px; }
.slider-row label { display: flex; justify-content: space-between; align-items: center; color: #c3d5e8; font-size: 11px; }
.slider-row label em { font-style: normal; color: #65d3eb; font-weight: 700; }
.slider-row input[type="range"] { width: 100%; margin: 3px 0 0; accent-color: #2f80ed; background: transparent; }
.row input[type="color"] { width: 34px; height: 22px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.35); border-radius: 4px; background: transparent; cursor: pointer; }
.hint { margin: 12px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.hint b { color: #9fb3cc; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
