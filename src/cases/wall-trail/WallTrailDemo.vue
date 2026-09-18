<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { pickPosition } from '../measure-lib'
import {
  createWallEntity,
  registerWallMaterials,
  removeWallEntity,
  rectPositions,
  updateWallEntity,
  type WallEntityOptions
} from '../wall-effects-lib'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const placing = ref(false)

const colorHex = ref('#33cc66')
const opacity = ref(0.7)
const speed = ref(3)
const widthMeters = ref(800)
const depthMeters = ref(600)
const height = ref(250)

const DEFAULT_LON = 120.38
const DEFAULT_LAT = 36.08

const WALL_ID = 'wall-trail'
const CURRENT_POS = { lon: DEFAULT_LON, lat: DEFAULT_LAT }

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined

function buildPositions(): Array<[number, number, number]> {
  return rectPositions(CURRENT_POS.lon, CURRENT_POS.lat, widthMeters.value, depthMeters.value, height.value)
}

function buildOptions(): WallEntityOptions {
  return {
    id: WALL_ID,
    positions: buildPositions(),
    kind: 'WallTrail',
    material: {
      color: Color.fromCssColorString(colorHex.value).withAlpha(opacity.value),
      speed: speed.value,
      image: '/images/wall-fence.png'
    },
    outline: true
  }
}

function place(lon: number, lat: number): void {
  if (!viewer || viewer.isDestroyed()) return
  CURRENT_POS.lon = lon
  CURRENT_POS.lat = lat
  createWallEntity(viewer, buildOptions())
  resultMessage.value = `流动墙体已放置于 ${lon.toFixed(4)}, ${lat.toFixed(4)}`
}

function updateEffect(): void {
  if (!viewer || viewer.isDestroyed()) return
  const entity = viewer.entities.getById(`dc-wall-${WALL_ID}`)
  if (!entity) {
    place(DEFAULT_LON, DEFAULT_LAT)
    return
  }
  updateWallEntity(viewer, WALL_ID, {
    positions: buildPositions(),
    material: {
      color: Color.fromCssColorString(colorHex.value).withAlpha(opacity.value),
      speed: speed.value
    }
  })
  resultMessage.value = '流动墙体参数已更新'
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !placing.value) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  const carto = Cartographic.fromCartesian(pos)
  place(CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude))
}

watch([colorHex, opacity, speed, widthMeters, depthMeters, height], () => {
  if (viewer && !viewer.isDestroyed()) updateEffect()
})

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    registerWallMaterials()
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(DEFAULT_LON, DEFAULT_LAT, 6000)
    })

    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)

    place(DEFAULT_LON, DEFAULT_LAT)
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  handler?.destroy()
  handler = undefined
  removeWallEntity(viewer, WALL_ID)
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="wall-trail-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">流动墙体效果</div>

      <button class="action-button primary" :class="{ active: placing }" @click="placing = !placing">
        {{ placing ? '放置中… 点击地图定位' : '点击地图放置墙体' }}
      </button>
      <button class="action-button neutral" @click="place(DEFAULT_LON, DEFAULT_LAT)">重置默认位置</button>

      <div class="section-title">墙体参数</div>
      <div class="control-row">
        <span class="row-label">颜色</span>
        <input v-model="colorHex" type="color" class="color-input" />
      </div>
      <div class="control-row">
        <span class="row-label">透明度</span>
        <input v-model.number="opacity" type="range" min="0.1" max="1" step="0.05" />
        <span class="row-value">{{ opacity.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">流动速度</span>
        <input v-model.number="speed" type="range" min="0.5" max="10" step="0.5" />
        <span class="row-value">{{ speed.toFixed(1) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">墙宽(m)</span>
        <input v-model.number="widthMeters" type="range" min="200" max="2000" step="50" />
        <span class="row-value">{{ widthMeters }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">墙深(m)</span>
        <input v-model.number="depthMeters" type="range" min="200" max="2000" step="50" />
        <span class="row-value">{{ depthMeters }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">墙高(m)</span>
        <input v-model.number="height" type="range" min="50" max="600" step="10" />
        <span class="row-value">{{ height }}</span>
      </div>

      <p class="hint">栅栏纹理沿墙体向上流动；开启放置后单击地图可移动位置，参数修改实时生效。</p>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.wall-trail-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 248px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 48px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row input[type="color"] { width: 40px; height: 24px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 5px; background: transparent; cursor: pointer; }
.action-button { width: 100%; height: 28px; margin-top: 6px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; }
.action-button.primary { background: #2f80ed; color: #eef4ff; }
.action-button.primary.active { background: #1f6f96; }
.action-button.neutral { background: #2c3a52; color: #c3d5e8; }
.hint { margin: 8px 0 0; font-size: 11px; color: #7f96b3; line-height: 1.5; }
.result-message { margin-top: 6px; font-size: 11px; color: #8be0b2; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
