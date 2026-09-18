<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  ClockRange,
  ConstantProperty,
  CzmlDataSource,
  defined,
  JulianDate,
  Math as CesiumMath,
  type DataSource,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import czml from './czmlData'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const playing = ref(false)
const followed = ref(false)
const showPath = ref(true)
const showLabel = ref(true)
const speed = ref(20)
const simClock = ref('')
const flightOver = ref(false)

const speeds = [5, 10, 20, 50, 100]

let viewer: Viewer | undefined
let dataSource: DataSource | undefined
let disposed = false
let startTime: JulianDate | undefined
let stopTime: JulianDate | undefined
let tickListener: (() => void) | undefined

const padDestination = Cartesian3.fromDegrees(-80.653, 28.471, 260000)

function padView(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.setView({
    destination: padDestination,
    orientation: { heading: 0, pitch: CesiumMath.toRadians(-35), roll: 0 }
  })
}

function syncTracked(): void {
  if (!viewer || !dataSource || viewer.isDestroyed()) return
  const rocket = dataSource.entities.getById('Vulcan')
  if (followed.value && defined(rocket)) {
    viewer.trackedEntity = rocket
  } else if (viewer.trackedEntity) {
    viewer.trackedEntity = undefined
  }
}

function onPlayToggle(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (!playing.value) {
    if (flightOver.value) resetFlight()
    viewer.clock.shouldAnimate = true
    playing.value = true
  } else {
    viewer.clock.shouldAnimate = false
    playing.value = false
  }
}

function onSpeedChange(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.clock.multiplier = speed.value
}

function resetFlight(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.clock.shouldAnimate = false
  playing.value = false
  flightOver.value = false
  if (defined(startTime)) viewer.clock.currentTime = startTime.clone()
  refreshSimClock()
  padView()
}

function onFollowChange(value: boolean): void {
  if (!viewer || viewer.isDestroyed()) return
  if (!value && viewer.trackedEntity) {
    viewer.trackedEntity = undefined
  } else if (value) {
    syncTracked()
  }
}

function onPathChange(): void {
  if (!viewer || !dataSource || viewer.isDestroyed()) return
  const rocket = dataSource.entities.getById('Vulcan')
  if (defined(rocket) && defined(rocket.path)) {
    rocket.path.show = new ConstantProperty(showPath.value)
  }
}

function onLabelChange(): void {
  if (!viewer || !dataSource || viewer.isDestroyed()) return
  const rocket = dataSource.entities.getById('Vulcan')
  if (defined(rocket) && defined(rocket.label)) {
    rocket.label.show = new ConstantProperty(showLabel.value)
  }
}

function zoomToTrajectory(): void {
  if (!viewer || !dataSource || viewer.isDestroyed()) return
  followed.value = false
  viewer.trackedEntity = undefined
  void viewer.zoomTo(dataSource)
}

function formatClock(): string {
  if (!viewer || viewer.isDestroyed() || !defined(viewer.clock.currentTime)) return ''
  const g = JulianDate.toGregorianDate(viewer.clock.currentTime)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(g.hour)}:${p(g.minute)}:${p(g.second)}`
}

function refreshSimClock(): void {
  simClock.value = formatClock()
  if (!viewer || viewer.isDestroyed()) return
  if (defined(stopTime) && defined(startTime)) {
    const t = viewer.clock.currentTime
    if (JulianDate.greaterThanOrEquals(t, stopTime)) {
      if (viewer.clock.shouldAnimate) {
        viewer.clock.shouldAnimate = false
        playing.value = false
        flightOver.value = true
      }
    }
  }
}

onMounted(async () => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    dataSource = await CzmlDataSource.load(czml as any)
    if (disposed || !viewer || viewer.isDestroyed()) return
    await viewer.dataSources.add(dataSource)
    startTime = viewer.clock.startTime
    stopTime = viewer.clock.stopTime
    viewer.clock.clockRange = ClockRange.LOOP_STOP
    viewer.clock.multiplier = speed.value
    viewer.clock.shouldAnimate = false
    onPathChange()
    onLabelChange()
    padView()
    tickListener = () => refreshSimClock()
    viewer.clock.onTick.addEventListener(tickListener)
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  if (viewer && !viewer.isDestroyed()) {
    if (tickListener) {
      viewer.clock.onTick.removeEventListener(tickListener)
      tickListener = undefined
    }
    viewer.trackedEntity = undefined
  }
  destroyScene(viewer)
  viewer = undefined
  dataSource = undefined
})

const playLabel = computed(() => {
  if (flightOver.value) return '重新发射'
  return playing.value ? '暂停' : '发射'
})

function doPlay(): void {
  onPlayToggle()
}

function doReset(): void {
  resetFlight()
}
</script>

<template>
  <div class="rocket-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="rocket-panel">
      <div class="panel-title">运载火箭发射</div>
      <div class="row sim-row">
        <span class="row-label">仿真时间</span>
        <b class="sim-clock">{{ simClock || '--:--:--' }}</b>
      </div>
      <div class="row">
        <span class="row-label">播放控制</span>
        <button class="btn primary" @click="doPlay">{{ playLabel }}</button>
        <button class="btn" @click="doReset">复位</button>
      </div>
      <div class="row">
        <span class="row-label">播放速度</span>
        <div class="speed-group">
          <button
            v-for="s in speeds"
            :key="s"
            class="btn speed"
            :class="{ active: speed === s }"
            @click="speed = s; onSpeedChange()"
          >{{ s }}×</button>
        </div>
      </div>
      <div class="row">
        <span class="row-label">飞行轨迹</span>
        <button class="toggle" :class="{ on: showPath }" aria-label="切换轨迹显示" @click="showPath = !showPath; onPathChange()"><i></i></button>
      </div>
      <div class="row">
        <span class="row-label">事件标注</span>
        <button class="toggle" :class="{ on: showLabel }" aria-label="切换事件标注" @click="showLabel = !showLabel; onLabelChange()"><i></i></button>
      </div>
      <div class="row">
        <span class="row-label">视角跟随</span>
        <button class="toggle" :class="{ on: followed }" aria-label="切换视角跟随" @click="followed = !followed; onFollowChange(followed)"><i></i></button>
      </div>
      <div class="row">
        <span class="row-label">完整轨迹</span>
        <button class="btn" @click="zoomToTrajectory">全局视角</button>
      </div>
      <div class="hint">基于 CZML 加载 Vulcan 火箭逐秒轨迹（含起飞到入轨）。发射后可观看全程飞行，轨迹与事件标注可独立显隐，视角可跟随火箭。</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.rocket-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
  border-radius: 8px;
  background: #152b4c;
}
.cesium-container {
  width: 100%;
  height: 100%;
}
.rocket-panel {
  position: absolute;
  top: 16px;
  left: 16px;
  width: 252px;
  padding: 12px;
  background: rgba(9, 17, 30, 0.86);
  border: 1px solid rgba(80, 160, 255, 0.4);
  border-radius: 8px;
  color: #dce8ff;
  font-size: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  z-index: 5;
}
.panel-title {
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 600;
  color: #8ec8ff;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  min-height: 24px;
}
.sim-row {
  justify-content: space-between;
}
.sim-clock {
  font-variant-numeric: tabular-nums;
  color: #7fe0c0;
  font-size: 13px;
}
.row-label {
  flex: none;
  width: 58px;
  color: #9fb6d8;
}
.speed-group {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.btn {
  padding: 3px 9px;
  border: 1px solid rgba(120, 180, 255, 0.5);
  background: transparent;
  color: #cfe4ff;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  line-height: 1.4;
}
.btn:hover {
  background: rgba(70, 140, 230, 0.25);
}
.btn.primary {
  background: rgba(40, 120, 220, 0.5);
  border-color: #4da3ff;
  color: #fff;
}
.btn.speed {
  padding: 2px 7px;
  font-size: 11px;
}
.btn.speed.active {
  background: rgba(80, 170, 255, 0.4);
  border-color: #6db6ff;
  color: #fff;
}
.toggle {
  width: 40px;
  height: 20px;
  border-radius: 10px;
  border: 1px solid rgba(120, 180, 255, 0.45);
  background: rgba(30, 50, 80, 0.6);
  padding: 0;
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
}
.toggle i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #7f97b8;
  transition: left 0.2s, background 0.2s;
}
.toggle.on {
  background: rgba(50, 140, 240, 0.5);
}
.toggle.on i {
  left: 22px;
  background: #bfe2ff;
}
.hint {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(120, 180, 255, 0.25);
  color: #7d95b8;
  line-height: 1.6;
}
.status-mask {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: 380px;
  padding: 8px 14px;
  border: 1px solid rgba(137, 210, 233, 0.4);
  border-radius: 7px;
  color: #e8f4fa;
  background: rgba(8, 21, 40, 0.88);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35);
  font-size: 12px;
  pointer-events: none;
  text-align: center;
  line-height: 1.5;
  z-index: 20;
}
</style>
