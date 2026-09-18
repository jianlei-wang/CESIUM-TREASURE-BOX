<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorGeometryInstanceAttribute,
  EllipsoidGeometry,
  EllipsoidOutlineGeometry,
  GeometryInstance,
  Material,
  MaterialAppearance,
  Math as CesiumMath,
  PerInstanceColorAppearance,
  Primitive,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Transforms,
  WallGeometry,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { pickPosition } from '../measure-lib'
import { calcScanPoints } from '../radar-scan-lib/scan-geometry'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const placing = ref(false)
const paused = ref(false)
const hasRadar = ref(false)

const colorHex = ref('#00dcff')
const opacity = ref(0.6)
const range = ref(50000)
const speed = ref(1)
const sweepAngle = ref(90)
const showEllipsoid = ref(true)
const showWall = ref(true)

const DEFAULT_LON = 120
const DEFAULT_LAT = 36

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let removeTick: (() => void) | undefined
let wallPrimitive: Primitive | undefined
let ellipsoidPrimitive: Primitive | undefined
let outlinePrimitive: Primitive | undefined
let heading = 0
let positionArr: number[] = []
let currentLon = DEFAULT_LON
let currentLat = DEFAULT_LAT

function makeColor(): Color {
  return Color.fromCssColorString(colorHex.value).withAlpha(opacity.value)
}

function removeAllPrimitives(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (wallPrimitive) {
    viewer.scene.primitives.remove(wallPrimitive)
    wallPrimitive = undefined
  }
  if (ellipsoidPrimitive) {
    viewer.scene.primitives.remove(ellipsoidPrimitive)
    ellipsoidPrimitive = undefined
  }
  if (outlinePrimitive) {
    viewer.scene.primitives.remove(outlinePrimitive)
    outlinePrimitive = undefined
  }
}

function buildEllipsoid(): void {
  if (!viewer || viewer.isDestroyed() || !showEllipsoid.value) return
  const radii = new Cartesian3(range.value, range.value, range.value)
  const modelMatrix = Transforms.eastNorthUpToFixedFrame(
    Cartesian3.fromDegrees(currentLon, currentLat)
  )
  const ellipsoidGeometry = EllipsoidGeometry.createGeometry(
    new EllipsoidGeometry({
      radii,
      maximumCone: CesiumMath.toRadians(90)
    })
  )
  const outlineGeometry = EllipsoidOutlineGeometry.createGeometry(
    new EllipsoidOutlineGeometry({
      radii,
      maximumCone: CesiumMath.toRadians(90)
    })
  )
  if (!ellipsoidGeometry || !outlineGeometry) return

  ellipsoidPrimitive = new Primitive({
    asynchronous: false,
    modelMatrix,
    geometryInstances: new GeometryInstance({
      geometry: ellipsoidGeometry
    }),
    appearance: new MaterialAppearance({
      material: Material.fromType('Color', { color: makeColor() }),
      translucent: true
    })
  })
  viewer.scene.primitives.add(ellipsoidPrimitive)

  outlinePrimitive = new Primitive({
    asynchronous: false,
    modelMatrix,
    geometryInstances: new GeometryInstance({
      geometry: outlineGeometry,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(makeColor())
      }
    }),
    appearance: new PerInstanceColorAppearance({ flat: true, translucent: true })
  })
  viewer.scene.primitives.add(outlinePrimitive)
}

function buildWall(): void {
  if (!viewer || viewer.isDestroyed() || !showWall.value || positionArr.length < 3) return
  const wallGeometry = WallGeometry.createGeometry(
    new WallGeometry({
      positions: Cartesian3.fromDegreesArrayHeights(positionArr)
    })
  )
  if (!wallGeometry) return
  wallPrimitive = new Primitive({
    asynchronous: false,
    geometryInstances: new GeometryInstance({
      geometry: wallGeometry
    }),
    appearance: new MaterialAppearance({
      material: Material.fromType('Color', { color: makeColor() }),
      translucent: true
    })
  })
  viewer.scene.primitives.add(wallPrimitive)
}

function rebuildAll(): void {
  removeAllPrimitives()
  buildEllipsoid()
  buildWall()
}

function createRadar(lon: number, lat: number): void {
  if (!viewer || viewer.isDestroyed()) return
  removeAllPrimitives()
  currentLon = lon
  currentLat = lat
  heading = 0
  positionArr = calcScanPoints(lon, lat, range.value, heading, sweepAngle.value)
  rebuildAll()
  hasRadar.value = true
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !placing.value) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  const carto = Cartographic.fromCartesian(pos)
  createRadar(CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude))
}

function clearRadar(): void {
  removeAllPrimitives()
  hasRadar.value = false
  heading = 0
  positionArr = []
}

watch([colorHex, opacity, range, speed, sweepAngle, showEllipsoid, showWall], () => {
  if (viewer && !viewer.isDestroyed() && hasRadar.value) rebuildAll()
})

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
      destination: Cartesian3.fromDegrees(DEFAULT_LON + 0.6, DEFAULT_LAT, 150000)
    })

    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)

    removeTick = viewer.clock.onTick.addEventListener(() => {
      if (!viewer || viewer.isDestroyed()) return
      if (!hasRadar.value || paused.value) return
      heading += speed.value
      if (heading >= 360) heading -= 360
      positionArr = calcScanPoints(currentLon, currentLat, range.value, heading, sweepAngle.value)
      if (wallPrimitive) viewer.scene.primitives.remove(wallPrimitive)
      buildWall()
    })

    createRadar(DEFAULT_LON, DEFAULT_LAT)
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  removeTick?.()
  removeTick = undefined
  handler?.destroy()
  handler = undefined
  clearRadar()
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="scan-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">雷达扫描(Primitive)</div>

      <button class="action-button primary" :class="{ active: placing }" @click="placing = !placing">
        {{ placing ? '放置中… 点击地图定位' : '点击地图放置雷达' }}
      </button>
      <div class="button-row">
        <button class="action-button half" @click="paused = !paused">{{ paused ? '继续扫描' : '暂停扫描' }}</button>
        <button class="action-button half danger" @click="clearRadar">清除雷达</button>
      </div>

      <div class="section-title">扫描参数</div>
      <div class="control-row">
        <span class="row-label">颜色</span>
        <input v-model="colorHex" type="color" class="color-input" />
      </div>
      <div class="control-row">
        <span class="row-label">透明度</span>
        <input v-model.number="opacity" type="range" min="0.05" max="1" step="0.05" />
        <span class="row-value">{{ opacity.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">扫描范围(m)</span>
        <input v-model.number="range" type="range" min="5000" max="100000" step="1000" />
        <span class="row-value">{{ range }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">旋转速度(°/帧)</span>
        <input v-model.number="speed" type="range" min="0.5" max="10" step="0.5" />
        <span class="row-value">{{ speed.toFixed(1) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">竖立张角(°)</span>
        <input v-model.number="sweepAngle" type="range" min="10" max="180" step="5" />
        <span class="row-value">{{ sweepAngle }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">半球</span>
        <button class="toggle-button" :class="{ on: showEllipsoid }" @click="showEllipsoid = !showEllipsoid">{{ showEllipsoid ? '显示' : '隐藏' }}</button>
      </div>
      <div class="control-row">
        <span class="row-label">扫描面</span>
        <button class="toggle-button" :class="{ on: showWall }" @click="showWall = !showWall">{{ showWall ? '显示' : '隐藏' }}</button>
      </div>

      <p class="hint">Primitive 实现，扫描面每帧重建；参数修改实时重建。</p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.scan-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
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
.action-button.half { width: calc(50% - 3px); background: #2c3a52; color: #c3d5e8; }
.action-button.half.danger { background: #7a3b4a; color: #ffe3ea; }
.button-row { display: flex; gap: 6px; }
.toggle-button { width: 52px; height: 22px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: #2c3a52; color: #9fb8d4; font-size: 10px; cursor: pointer; }
.toggle-button.on { background: #1f6f96; color: #dff1ff; border-color: #1f6f96; }
.hint { margin: 8px 0 0; font-size: 11px; color: #7f96b3; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
