<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ConstantProperty,
  GeometryInstance,
  Math as CesiumMath,
  Material,
  MaterialAppearance,
  PolylineGraphics,
  Primitive,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  WallGeometry,
  type Entity,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { pickPosition } from '../measure-lib'
import colorsPng from './assets/colors.png'

const WALL_SOURCE = `
  uniform float mode;
  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    vec4 colorImage = texture(image, vec2(fract(st.t * rep - speed * czm_frameNumber * 0.005), st.t * rep));
    if (mode > 0.5) {
      material.diffuse = color.rgb;
      material.emission = colorImage.rgb * color.rgb * 0.5;
    } else {
      material.diffuse = colorImage.rgb * color.rgb;
    }
    material.alpha = colorImage.a * color.a;
    return material;
  }
`

const DEFAULT_LONLATS = [
  115.6434, 28.76762,
  115.6432, 28.76762,
  115.6432, 28.76756,
  115.6434, 28.76756,
  115.6434, 28.76762
]

type WallRecord = {
  id: number
  lonLats: number[]
}

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const drawing = ref(false)
const wallCount = ref(0)

const colorHex = ref('#ee5522')
const speed = ref(3)
const rep = ref(4)
const wallHeight = ref(10)
const minHeight = ref(0)
const shaderMode = ref<'solid' | 'stain'>('stain')

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let removeTick: (() => void) | undefined
let records: WallRecord[] = []
let wallPrimitives: Primitive[] = []
let drawingEntity: Entity | undefined
let currentLonLats: number[] = []
let lastLonLat: [number, number] | undefined
let idCounter = 1

function buildWall(lonLats: number[]): Primitive {
  if (!viewer || viewer.isDestroyed()) return undefined as unknown as Primitive
  const positions = Cartesian3.fromDegreesArray(lonLats)
  const count = lonLats.length / 2
  const wallInstance = new GeometryInstance({
    geometry: new WallGeometry({
      positions,
      maximumHeights: new Array(count).fill(wallHeight.value),
      minimumHeights: new Array(count).fill(minHeight.value)
    })
  })
  const wallAppearance = new MaterialAppearance({
    material: new Material({
      fabric: {
        uniforms: {
          color: Color.fromCssColorString(colorHex.value),
          image: colorsPng,
          speed: speed.value,
          rep: rep.value,
          mode: shaderMode.value === 'solid' ? 1 : 0
        },
        source: WALL_SOURCE
      }
    }),
    translucent: true
  })
  const primitive = new Primitive({
    geometryInstances: wallInstance,
    appearance: wallAppearance,
    releaseGeometryInstances: false
  })
  viewer.scene.primitives.add(primitive)
  return primitive
}

function addWall(lonLats: number[]): void {
  if (lonLats.length < 4) return
  const record: WallRecord = { id: idCounter++, lonLats: [...lonLats] }
  records.push(record)
  wallPrimitives.push(buildWall(record.lonLats))
  wallCount.value = records.length
  resultMessage.value = `已添加动态围墙 #${record.id}(${lonLats.length / 2} 个顶点)`
}

function rebuildAllWalls(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const p of wallPrimitives) viewer.scene.primitives.remove(p)
  wallPrimitives = []
  for (const r of records) wallPrimitives.push(buildWall(r.lonLats))
  if (records.length > 0) resultMessage.value = `已更新 ${records.length} 堵围墙参数`
}

function clearPreview(): void {
  if (viewer && !viewer.isDestroyed() && drawingEntity) {
    viewer.entities.remove(drawingEntity)
  }
  drawingEntity = undefined
  currentLonLats = []
  lastLonLat = undefined
}

function refreshPreview(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (!drawingEntity) {
    drawingEntity = viewer.entities.add({
      polyline: {
        positions: [] as never,
        width: 2,
        material: Color.fromCssColorString(colorHex.value).withAlpha(0.8)
      }
    })
  }
  const coords: number[] = []
  for (let i = 0; i < currentLonLats.length; i += 2) {
    coords.push(currentLonLats[i], currentLonLats[i + 1], 10)
  }
  if (lastLonLat) coords.push(lastLonLat[0], lastLonLat[1], 10)
  const positions = Cartesian3.fromDegreesArrayHeights(coords)
  const polyline = drawingEntity.polyline as PolylineGraphics
  polyline.positions = new ConstantProperty(positions) as never
}

function finishDrawing(): void {
  if (currentLonLats.length >= 4) {
    addWall(currentLonLats)
  } else {
    resultMessage.value = '围墙至少需要 2 个顶点，请继续绘制或清除'
  }
  clearPreview()
  drawing.value = false
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !drawing.value) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  const carto = Cartographic.fromCartesian(pos)
  const lon = CesiumMath.toDegrees(carto.longitude)
  const lat = CesiumMath.toDegrees(carto.latitude)
  currentLonLats.push(lon, lat)
  lastLonLat = [lon, lat]
  refreshPreview()
}

function onRightClick(): void {
  if (drawing.value) finishDrawing()
}

function onDoubleClick(): void {
  if (drawing.value) finishDrawing()
}

function clearAll(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const p of wallPrimitives) viewer.scene.primitives.remove(p)
  wallPrimitives = []
  records = []
  wallCount.value = 0
  clearPreview()
  drawing.value = false
  resultMessage.value = '已清除全部动态围墙'
}

watch([colorHex, speed, rep, wallHeight, minHeight, shaderMode], () => {
  if (viewer && !viewer.isDestroyed() && records.length > 0) rebuildAllWalls()
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
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(115.6433, 28.7676, 120)
    })

    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)
    handler.setInputAction(() => onRightClick(), ScreenSpaceEventType.RIGHT_CLICK)
    handler.setInputAction(() => onDoubleClick(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

    removeTick = viewer.clock.onTick.addEventListener(() => {
      if (drawing.value && lastLonLat) viewer?.scene.requestRender()
    })

    addWall(DEFAULT_LONLATS)
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
  clearAll()
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="wall-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">动态围墙效果</div>

      <button class="action-button primary" :class="{ active: drawing }" @click="drawing = !drawing; if (!drawing) clearPreview()">
        {{ drawing ? '绘制中… 单击加点，双击/右键完成' : '绘制围墙路径' }}
      </button>
      <button class="action-button danger" @click="clearAll">清除全部({{ wallCount }})</button>

      <div class="section-title">围墙参数</div>
      <div class="control-row">
        <span class="row-label">着色模式</span>
        <div class="mode-group">
          <button class="mode-button" :class="{ active: shaderMode === 'stain' }" @click="shaderMode = 'stain'">染色纹理</button>
          <button class="mode-button" :class="{ active: shaderMode === 'solid' }" @click="shaderMode = 'solid'">纯色高光</button>
        </div>
      </div>
      <div class="control-row">
        <span class="row-label">颜色</span>
        <input v-model="colorHex" type="color" class="color-input" />
      </div>
      <div class="control-row">
        <span class="row-label">流动速度</span>
        <input v-model.number="speed" type="range" min="1" max="20" step="0.5" />
        <span class="row-value">{{ speed.toFixed(1) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">纹理重复</span>
        <input v-model.number="rep" type="range" min="1" max="20" step="1" />
        <span class="row-value">{{ rep }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">墙高(m)</span>
        <input v-model.number="wallHeight" type="range" min="2" max="200" step="1" />
        <span class="row-value">{{ wallHeight }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">底部高度(m)</span>
        <input v-model.number="minHeight" type="range" min="0" max="50" step="1" />
        <span class="row-value">{{ minHeight }}</span>
      </div>

      <p class="hint">开启绘制后在地图上单击加点，双击或右键完成围墙；参数修改实时作用于所有墙体。</p>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.wall-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 248px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 48px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row input[type="color"] { width: 40px; height: 24px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 5px; background: transparent; cursor: pointer; }
.mode-group { display: flex; gap: 4px; }
.mode-button { height: 22px; padding: 0 8px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: #2c3a52; color: #c3d5e8; font-size: 10px; cursor: pointer; }
.mode-button.active { background: #2f80ed; color: #eef4ff; border-color: #2f80ed; }
.action-button { width: 100%; height: 28px; margin-top: 6px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; }
.action-button.primary { background: #2f80ed; color: #eef4ff; }
.action-button.primary.active { background: #1f6f96; }
.action-button.danger { background: #7a3b4a; color: #ffe3ea; }
.hint { margin: 8px 0 0; font-size: 11px; color: #7f96b3; line-height: 1.5; }
.result-message { margin-top: 6px; font-size: 11px; color: #8be0b2; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
