<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Color,
  ConstantPositionProperty,
  HeightReference,
  HorizontalOrigin,
  VerticalOrigin,
  type Entity,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, loadWorldTerrain, type SceneCallbacks } from '../../lib/cesium-scene'
import { PresentationEngine } from './PresentationEngine'
import { demoPresentation, type Presentation } from './presentation'

const CENTER_LON = 116.397
const CENTER_LAT = 39.908
const ROAD_RADIUS = 450
const CAR_SPEED = 55
const CAR_COUNT = 16

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载场景…')
const ready = ref(false)
const isPlaying = ref(false)
const currentTime = ref(0)
const speed = ref(1)
const loop = ref(false)
const frameTick = ref(0)
const popupVisible = ref(false)
const popupData = ref<{ title: string; content: string; longitude: number; latitude: number; height: number } | null>(null)

let viewer: Viewer | undefined
let engine: PresentationEngine | undefined
let buildingEntities: Entity[] = []
let pipeEntities: Entity[] = []
let roadTrackEntity: Entity | undefined
let roadPointEntities: Entity[] = []
let mainLabelEntity: Entity | undefined
let roadActive = false
let effectStartTime = 0
const roadOffsets: number[] = []

const circumference = 2 * Math.PI * ROAD_RADIUS
const roadLonOffset = ROAD_RADIUS / (111320 * Math.cos((CENTER_LAT * Math.PI) / 180))
const roadLatOffset = ROAD_RADIUS / 110540

const ticks = computed(() => {
  const arr: number[] = []
  for (let i = 0; i <= demoPresentation.duration; i += 10) arr.push(i)
  return arr
})

const progressPercent = computed(() => (demoPresentation.duration > 0 ? (currentTime.value / demoPresentation.duration) * 100 : 0))

const popupStyle = computed(() => {
  const popup = popupData.value
  void frameTick.value
  if (!popupVisible.value || !popup || !viewer || !container.value) return { display: 'none' }
  const cart = Cartesian3.fromDegrees(popup.longitude, popup.latitude, popup.height)
  const win = viewer.scene.cartesianToCanvasCoordinates(cart)
  if (!win) return { display: 'none' }
  const width = container.value.clientWidth || 800
  const height = container.value.clientHeight || 500
  const left = Math.max(8, Math.min(width - 320, win.x + 16))
  const top = Math.max(8, Math.min(height - 150, win.y - 46))
  return { left: `${left}px`, top: `${top}px` }
})

function formatTime(seconds: number): string {
  const min = Math.floor(seconds / 60)
  const sec = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${min}:${sec}`
}

function timePercent(time: number): number {
  return (time / demoPresentation.duration) * 100
}

function createBuildings(): void {
  if (!viewer) return
  const palette = ['#dce3ec', '#c9d4e0', '#b8c6d4', '#a8b8c9', '#8fa3b8', '#d5dbe3', '#b0bec5']
  for (let i = 0; i < 26; i += 1) {
    const lon = CENTER_LON + (Math.random() - 0.5) * 0.0075
    const lat = CENTER_LAT + (Math.random() - 0.5) * 0.006
    const height = 25 + Math.random() * 90
    const width = 25 + Math.random() * 40
    buildingEntities.push(viewer.entities.add({
      position: Cartesian3.fromDegrees(lon, lat),
      box: {
        dimensions: new Cartesian3(width, width, height),
        material: Color.fromCssColorString(palette[i % palette.length]).withAlpha(0.95),
        outline: true,
        outlineColor: Color.WHITE.withAlpha(0.5),
        heightReference: HeightReference.CLAMP_TO_GROUND
      },
      show: false
    }))
  }
  buildingEntities.push(viewer.entities.add({
    position: Cartesian3.fromDegrees(CENTER_LON + 0.0005, CENTER_LAT + 0.0005),
    box: {
      dimensions: new Cartesian3(70, 70, 130),
      material: Color.fromCssColorString('#2f80ed').withAlpha(0.95),
      outline: true,
      outlineColor: Color.WHITE.withAlpha(0.7),
      heightReference: HeightReference.CLAMP_TO_GROUND
    },
    show: false
  }))
  mainLabelEntity = viewer.entities.add({
    position: Cartesian3.fromDegrees(CENTER_LON + 0.0005, CENTER_LAT + 0.0005, 142),
    label: {
      text: '科创中心大厦',
      font: '14px sans-serif',
      fillColor: Color.WHITE,
      outlineColor: Color.BLACK,
      outlineWidth: 3,
      showBackground: true,
      backgroundColor: Color.fromCssColorString('#0a2030').withAlpha(0.85),
      verticalOrigin: VerticalOrigin.BOTTOM,
      horizontalOrigin: HorizontalOrigin.CENTER,
      pixelOffset: new Cartesian2(0, -8),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    show: false
  })
}

function createPipes(): void {
  if (!viewer) return
  const v = viewer
  const pipeLevel = -30
  const segments: number[][] = [
    [CENTER_LON - 0.003, CENTER_LAT - 0.002, CENTER_LON + 0.003, CENTER_LAT - 0.002],
    [CENTER_LON - 0.002, CENTER_LAT - 0.002, CENTER_LON - 0.002, CENTER_LAT + 0.002],
    [CENTER_LON + 0.002, CENTER_LAT - 0.001, CENTER_LON + 0.002, CENTER_LAT + 0.002],
    [CENTER_LON - 0.002, CENTER_LAT + 0.002, CENTER_LON + 0.002, CENTER_LAT + 0.002]
  ]
  segments.forEach((seg) => {
    pipeEntities.push(v.entities.add({
      polyline: {
        positions: Cartesian3.fromDegreesArrayHeights([
          seg[0], seg[1], pipeLevel,
          seg[2], seg[3], pipeLevel
        ]),
        width: 6,
        material: Color.fromCssColorString('#2fd7e8').withAlpha(0.95)
      },
      show: false
    }))
  })
  const joints: number[][] = [
    [CENTER_LON - 0.002, CENTER_LAT - 0.002],
    [CENTER_LON - 0.002, CENTER_LAT + 0.002],
    [CENTER_LON + 0.002, CENTER_LAT + 0.002]
  ]
  joints.forEach((joint) => {
    pipeEntities.push(v.entities.add({
      position: Cartesian3.fromDegrees(joint[0], joint[1], pipeLevel),
      point: {
        pixelSize: 9,
        color: Color.fromCssColorString('#4de3f2').withAlpha(0.95),
        outlineColor: Color.WHITE,
        outlineWidth: 1
      },
      show: false
    }))
  })
}

function createRoad(): void {
  if (!viewer) return
  const positions: Cartesian3[] = []
  const steps = 48
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2
    positions.push(Cartesian3.fromDegrees(
      CENTER_LON + Math.cos(angle) * roadLonOffset,
      CENTER_LAT + Math.sin(angle) * roadLatOffset,
      52
    ))
  }
  roadTrackEntity = viewer.entities.add({
    polyline: {
      positions,
      width: 4,
      material: Color.fromCssColorString('#2f80ed').withAlpha(0.55)
    },
    show: false
  })
  roadPointEntities = []
  for (let i = 0; i < CAR_COUNT; i += 1) {
    const dist = (i / CAR_COUNT) * circumference
    roadOffsets.push(dist)
    roadPointEntities.push(viewer.entities.add({
      position: Cartesian3.fromDegrees(
        CENTER_LON + Math.cos(dist / ROAD_RADIUS) * roadLonOffset,
        CENTER_LAT + Math.sin(dist / ROAD_RADIUS) * roadLatOffset,
        54
      ),
      point: {
        pixelSize: 6,
        color: Color.fromCssColorString('#ffd54a'),
        outlineColor: Color.WHITE,
        outlineWidth: 1.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      show: false
    }))
  }
}

function updateRoadPoints(): void {
  if (!roadActive || roadPointEntities.length === 0) return
  const elapsed = currentTime.value - effectStartTime
  roadPointEntities.forEach((entity, i) => {
    const dist = (elapsed * CAR_SPEED + roadOffsets[i]) % circumference
    const angle = dist / ROAD_RADIUS
    entity.position = new ConstantPositionProperty(Cartesian3.fromDegrees(
      CENTER_LON + Math.cos(angle) * roadLonOffset,
      CENTER_LAT + Math.sin(angle) * roadLatOffset,
      54
    ))
  })
}

function setLayerVisible(layerId: string, visible: boolean): void {
  if (layerId === 'buildings-3d') {
    buildingEntities.forEach((entity) => { entity.show = visible })
  } else if (layerId === 'underground-pipe') {
    pipeEntities.forEach((entity) => { entity.show = visible })
  }
}

function setLabelVisible(labelId: string, visible: boolean): void {
  if (labelId === 'building-main-label' && mainLabelEntity) {
    mainLabelEntity.show = visible
  }
}

function setEffectActive(effectId: string, active: boolean): void {
  if (effectId !== 'road-flow') return
  roadActive = active
  if (roadTrackEntity) roadTrackEntity.show = active
  roadPointEntities.forEach((entity) => { entity.show = active })
  if (active) effectStartTime = currentTime.value
}

function closePopup(): void {
  popupVisible.value = false
  popupData.value = null
}

function restoreScene(): void {
  closePopup()
  setLayerVisible('buildings-3d', false)
  setLayerVisible('underground-pipe', false)
  setLabelVisible('building-main-label', false)
  setEffectActive('road-flow', false)
}

function togglePlay(): void {
  if (!engine) return
  if (isPlaying.value) {
    engine.pause()
    isPlaying.value = false
  } else {
    if (currentTime.value >= demoPresentation.duration - 0.1) {
      restoreScene()
      engine.seek(0)
    }
    engine.play()
    isPlaying.value = true
  }
}

function reset(): void {
  if (!engine) return
  restoreScene()
  engine.seek(0)
  isPlaying.value = false
}

function seekTo(time: number): void {
  if (!engine) return
  engine.seek(time)
  isPlaying.value = false
}

function onSpeedChange(event: Event): void {
  const target = event.target as HTMLSelectElement
  const value = Number(target.value)
  speed.value = value
  engine?.setSpeed(value)
}

function onLoopChange(): void {
  engine?.setLoop(loop.value)
}

function handleTrackClick(event: MouseEvent): void {
  const el = container.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const percent = (event.clientX - rect.left) / rect.width
  seekTo(Math.max(0, Math.min(demoPresentation.duration, percent * demoPresentation.duration)))
}

async function mountScene(): Promise<void> {
  if (!container.value) return
  const callbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '正在加载地形与园区场景…' }
  }
  try {
    viewer = createMapScene(container.value, callbacks)
    loadBingImagery(viewer, callbacks)
    await loadWorldTerrain(viewer)
    if (!viewer || viewer.isDestroyed()) return

    createBuildings()
    createPipes()
    createRoad()

    engine = new PresentationEngine(viewer)
    engine.on('timeupdate', (detail) => {
      if (detail.event === 'timeupdate') {
        currentTime.value = detail.seconds
        frameTick.value += 1
        updateRoadPoints()
      }
    })
    engine.on('layer', (detail) => {
      if (detail.event === 'layer') setLayerVisible(detail.layerId, detail.visible)
    })
    engine.on('label', (detail) => {
      if (detail.event === 'label') setLabelVisible(detail.labelId, detail.visible)
    })
    engine.on('effect', (detail) => {
      if (detail.event === 'effect') setEffectActive(detail.effectId, detail.active)
    })
    engine.on('popup', (detail) => {
      if (detail.event !== 'popup') return
      if (detail.visible && detail.title !== undefined) {
        popupData.value = {
          title: detail.title,
          content: detail.content ?? '',
          longitude: detail.longitude ?? CENTER_LON,
          latitude: detail.latitude ?? CENTER_LAT,
          height: detail.height ?? 140
        }
        popupVisible.value = true
      } else {
        closePopup()
      }
    })
    engine.on('restore', () => { restoreScene() })
    engine.on('ended', () => { isPlaying.value = false })

    engine.load(demoPresentation)
    ready.value = true
    statusMessage.value = '场景已就绪，点击「播放」开始三维演示。'
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
}

onMounted(() => { void mountScene() })

onBeforeUnmount(() => {
  engine?.dispose()
  engine = undefined
  buildingEntities = []
  pipeEntities = []
  roadPointEntities = []
  roadTrackEntity = undefined
  mainLabelEntity = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="presentation-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="demo-title">
      <h3>三维场景演示</h3>
      <p>{{ demoPresentation.name }} · 全程 {{ demoPresentation.duration }}s</p>
      <p class="status-line">{{ statusMessage }}</p>
    </div>

    <div v-if="popupVisible" class="info-popup" :style="popupStyle">
      <h4>{{ popupData?.title }}</h4>
      <p>{{ popupData?.content }}</p>
      <button @click="closePopup">关闭</button>
    </div>

    <div v-if="ready" class="presentation-controls">
      <button class="ctrl-btn primary" @click="togglePlay">{{ isPlaying ? '暂停' : '播放' }}</button>
      <button class="ctrl-btn" @click="reset">重置</button>
      <select class="speed-select" :value="speed" @change="onSpeedChange">
        <option :value="0.5">0.5x</option>
        <option :value="1">1x</option>
        <option :value="2">2x</option>
      </select>
      <span class="time-display">{{ formatTime(currentTime) }} / {{ formatTime(demoPresentation.duration) }}</span>
      <label class="loop-item">
        <input v-model="loop" type="checkbox" @change="onLoopChange" />
        循环
      </label>
    </div>

    <div v-if="ready && demoPresentation.config.showTimeline" class="timeline-container" @click="handleTrackClick">
      <div class="timeline-track">
        <div class="timeline-progress" :style="{ width: progressPercent + '%' }"></div>
        <div
          v-for="kf in demoPresentation.keyframes"
          :key="kf.id"
          class="keyframe-marker"
          :style="{ left: timePercent(kf.time) + '%' }"
          :title="'关键帧 ' + formatTime(kf.time)"
          @click.stop="seekTo(kf.time)"
        ></div>
        <div
          v-for="ev in demoPresentation.events"
          :key="ev.id"
          class="event-marker"
          :class="ev.type"
          :style="{ left: timePercent(ev.time) + '%' }"
          :title="ev.type + ' @ ' + formatTime(ev.time)"
          @click.stop="seekTo(ev.time)"
        ></div>
        <div class="playhead" :style="{ left: progressPercent + '%' }"></div>
      </div>
      <div class="timeline-scale">
        <span v-for="tick in ticks" :key="tick" :style="{ left: timePercent(tick) + '%' }">{{ formatTime(tick) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.presentation-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.demo-title { position: absolute; top: 12px; left: 12px; z-index: 20; color: #fff; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8); pointer-events: none; }
.demo-title h3 { margin: 0 0 2px; font-size: 15px; }
.demo-title p { margin: 0; font-size: 11px; color: #cfe0f2; }
.demo-title .status-line { margin-top: 4px; color: #ffd54a; font-size: 10px; }
.info-popup { position: absolute; z-index: 30; width: 300px; padding: 14px; border: 1px solid #2f80ed; border-radius: 8px; background: rgba(8, 26, 54, 0.95); color: #fff; box-sizing: border-box; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4); }
.info-popup h4 { margin: 0 0 8px; color: #ffc107; font-size: 14px; }
.info-popup p { margin: 0 0 10px; font-size: 12px; line-height: 1.6; color: #dce8f5; }
.info-popup button { padding: 5px 14px; border: 0; border-radius: 4px; background: #2f80ed; color: #fff; font-size: 12px; cursor: pointer; }
.presentation-controls { position: absolute; bottom: 96px; left: 50%; transform: translateX(-50%); z-index: 25; display: flex; align-items: center; gap: 10px; padding: 8px 16px; border-radius: 8px; background: rgba(6, 22, 44, 0.88); border: 1px solid rgba(157, 188, 224, 0.22); color: #fff; font-size: 12px; }
.ctrl-btn { padding: 5px 14px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 4px; background: #2c3a52; color: #dce8f5; font-size: 12px; cursor: pointer; }
.ctrl-btn.primary { background: #2f80ed; border-color: #2f80ed; color: #fff; }
.ctrl-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.speed-select { padding: 4px 6px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 4px; background: #12233f; color: #dce8f5; font-size: 12px; }
.time-display { min-width: 84px; text-align: center; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #cfe0f2; }
.loop-item { display: flex; align-items: center; gap: 4px; color: #cfe0f2; font-size: 11px; cursor: pointer; }
.timeline-container { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 25; width: 78%; max-width: 1160px; padding: 8px 0; border-radius: 8px; background: rgba(6, 22, 44, 0.88); border: 1px solid rgba(157, 188, 224, 0.22); }
.timeline-track { position: relative; height: 10px; margin: 0 16px; background: #22344f; border-radius: 5px; cursor: pointer; }
.timeline-progress { position: absolute; top: 0; left: 0; height: 100%; background: #2f80ed; border-radius: 5px; pointer-events: none; }
.keyframe-marker { position: absolute; top: -5px; width: 16px; height: 16px; background: #ffc107; border: 2px solid #fff; border-radius: 50%; transform: translateX(-50%); cursor: pointer; z-index: 2; box-sizing: border-box; }
.event-marker { position: absolute; top: -2px; width: 11px; height: 11px; transform: translateX(-50%) rotate(45deg); z-index: 1; cursor: pointer; }
.event-marker.popup_open { background: #ff9800; }
.event-marker.popup_close { background: #ffb74d; }
.event-marker.layer_show { background: #2196f3; }
.event-marker.layer_hide { background: #64b5f6; }
.event-marker.effect_start { background: #4caf50; }
.event-marker.effect_stop { background: #81c784; }
.event-marker.label_show { background: #9c27b0; }
.event-marker.label_hide { background: #ba68c8; }
.event-marker.custom { background: #f44336; }
.playhead { position: absolute; top: -7px; width: 2px; height: 24px; background: #fff; transform: translateX(-50%); pointer-events: none; z-index: 3; }
.timeline-scale { position: relative; height: 18px; margin: 6px 16px 0; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.timeline-scale span { position: absolute; transform: translateX(-50%); }
</style>
