<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  Appearance,
  ArcType,
  BlendingState,
  Cartesian3,
  Cartographic,
  Color,
  Math as CesiumMath,
  Ellipsoid,
  GeometryInstance,
  HeadingPitchRange,
  Matrix4,
  PolygonHierarchy,
  Primitive,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Cartesian2,
  type Entity,
  type Material,
  type TerrainProvider,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  loadWorldTerrain,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import {
  RIVER_WATER_FRAGMENT_SHADER,
  RIVER_WATER_VERTEX_SHADER,
  createRiverWaterMaterial,
  setRiverWaterUvScale,
  updateRiverWaterMaterial,
  type RiverWaterParams
} from '../river-channel-lib/water-material'
import {
  FLOW_ARROW_STYLES,
  RIVER_FLOW_FRAGMENT_SHADER,
  RIVER_FLOW_VERTEX_SHADER,
  createRiverFlowMaterial,
  setRiverFlowUvScale,
  updateRiverFlowMaterial,
  type RiverFlowArrowParams
} from '../river-channel-lib/flow-overlay'
import {
  boundsSizeMeters,
  buildWaterMesh,
  computeFlowField,
  estimateWaterLevel,
  sampleTerrainGrid,
  type FlowField,
  type LonLatPolygon,
  type TerrainGrid
} from '../river-channel-lib/terrain-water'

/** 龙羊峡水库一带：黄河上游深切峡谷，河谷蜿蜒、两岸高差大。 */
const BOUNDS = { west: 100.62, south: 35.92, east: 101.0, north: 36.22 }
const GRID_COLS = 176
/** 箭头层相对水面的抬高量（米），避免与水层争深度 */
const ARROW_ELEVATION = 12

const arrows = reactive<RiverFlowArrowParams>({
  style: 'comet',
  spacing: 0.8,
  length: 0.45,
  width: 0.16,
  speed: 60,
  intensity: 0.72,
  color: '#ffe680'
})

const ui = reactive<RiverWaterParams & { waterLevel: number }>({
  baseColor: '#ffffff',
  baseAlpha: 0.85,
  depthValue: 3,
  distortion: 0.1,
  shallowColor: '#8fd8ea',
  shallowAlpha: 0.45,
  deepColor: '#0f4f7a',
  deepAlpha: 0.92,
  fresnelColor: '#bfe4f5',
  fresnelPower: 4.7,
  reflectIntensity: 1.2,
  reflectMix: 0.5,
  flowSpeed: 120,
  flowAngle: 0,
  foamMix: 0.6,
  foamSpeed: 160,
  foamScale: 2.4,
  foamIntensity: 18,
  waveHeight: 0.16,
  waveAmplitude: 0.47,
  waveDensity: 2000,
  waveSmooth: 800,
  specular: 12,
  specularColor: '#ffffff',
  waterLevel: 0
})

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const stats = ref('')
const flowBearing = ref(0)
const flowCells = ref(0)
const showFlow = ref(true)
const drawing = ref(false)
const draftPoints = ref<LonLatPolygon>([])
const channelPoints = ref<LonLatPolygon>([])

let viewer: Viewer | undefined
let terrain: TerrainProvider | undefined
let grid: TerrainGrid | undefined
let flowField: FlowField | undefined
let material: Material | undefined
let arrowMaterial: Material | undefined
let primitive: Primitive | undefined
let arrowPrimitive: Primitive | undefined
let inputHandler: ScreenSpaceEventHandler | undefined
let draftEntity: Entity | undefined
let areaEntity: Entity | undefined
let channelPolygon: LonLatPolygon | undefined
let waterBase = 2650
let disposed = false
let rebuildTimer: number | undefined

const waterLevelMin = computed(() => Math.round(waterBase - 200))
const waterLevelMax = computed(() => Math.round(waterBase + 200))

const bearingLabel = computed(() => {
  const directions = ['正北', '东北', '正东', '东南', '正南', '西南', '正西', '西北']
  const index = Math.round(((flowBearing.value % 360) + 360) % 360 / 45) % 8
  return `${flowBearing.value.toFixed(0)}° ${directions[index]}`
})

function applyView(): void {
  if (!viewer) return
  const center = Cartesian3.fromDegrees(
    (BOUNDS.west + BOUNDS.east) / 2,
    (BOUNDS.south + BOUNDS.north) / 2,
    waterBase
  )
  viewer.camera.lookAt(
    center,
    new HeadingPitchRange(0, CesiumMath.toRadians(-40), 36000)
  )
  viewer.camera.lookAtTransform(Matrix4.IDENTITY)
}

function computeFlow(): void {
  if (!grid) return
  flowField = computeFlowField(grid, ui.waterLevel, channelPolygon)
  flowBearing.value = flowField.bearing
  flowCells.value = flowField.corridorCells
}

function rebuildAll(): void {
  computeFlow()
  buildWater()
  buildArrows()
}

/** 动态流向箭头层：和水面共用一份流向数据，由 GPU 连续滚动渲染。 */
function buildArrows(): void {
  if (!viewer || !grid || !flowField) return
  const mesh = buildWaterMesh(grid, ui.waterLevel, flowField, ARROW_ELEVATION, channelPolygon)
  if (!arrowMaterial) arrowMaterial = createRiverFlowMaterial({ ...arrows })
  setRiverFlowUvScale(arrowMaterial, mesh.widthMeters, mesh.heightMeters)
  updateRiverFlowMaterial(arrowMaterial, arrows)

  const instance = new GeometryInstance({ geometry: mesh.geometry })
  const next = new Primitive({
    geometryInstances: instance,
    appearance: new Appearance({
      material: arrowMaterial,
      translucent: true,
      closed: false,
      renderState: {
        depthTest: { enabled: true },
        depthMask: false,
        cull: { enabled: false },
        blending: BlendingState.ALPHA_BLEND
      },
      vertexShaderSource: RIVER_FLOW_VERTEX_SHADER,
      fragmentShaderSource: RIVER_FLOW_FRAGMENT_SHADER
    }),
    asynchronous: false,
    allowPicking: false
  })
  next.show = showFlow.value
  if (arrowPrimitive) viewer.scene.primitives.remove(arrowPrimitive)
  arrowPrimitive = viewer.scene.primitives.add(next) as Primitive
}

function buildWater(): void {
  if (!viewer || !grid || !flowField) return
  const mesh = buildWaterMesh(grid, ui.waterLevel, flowField, 0, channelPolygon)
  if (!material) material = createRiverWaterMaterial({ ...ui })
  setRiverWaterUvScale(material, mesh.widthMeters, mesh.heightMeters)
  updateRiverWaterMaterial(material, ui)

  const instance = new GeometryInstance({ geometry: mesh.geometry })
  const next = new Primitive({
    geometryInstances: instance,
    appearance: new Appearance({
      material,
      translucent: true,
      closed: false,
      renderState: {
        depthTest: { enabled: true },
        depthMask: false,
        cull: { enabled: false },
        blending: BlendingState.ALPHA_BLEND
      },
      vertexShaderSource: RIVER_WATER_VERTEX_SHADER,
      fragmentShaderSource: RIVER_WATER_FRAGMENT_SHADER
    }),
    asynchronous: false,
    allowPicking: false
  })
  if (primitive) viewer.scene.primitives.remove(primitive)
  primitive = viewer.scene.primitives.add(next) as Primitive
}

async function loadTerrain(): Promise<void> {
  if (!viewer || !terrain) return
  const { widthMeters, heightMeters } = boundsSizeMeters(BOUNDS)
  const rows = Math.max(8, Math.round((GRID_COLS * heightMeters) / widthMeters))
  statusMessage.value = '正在采样地形高度… 0%'
  const sampled = await sampleTerrainGrid(terrain, BOUNDS, GRID_COLS, rows, (done, total) => {
    statusMessage.value = `正在采样地形高度… ${Math.round((done / total) * 100)}%`
  })
  if (disposed || !viewer) return
  grid = sampled
  waterBase = Math.round(estimateWaterLevel(sampled, 0.1))
  ui.waterLevel = waterBase
  rebuildAll()
  applyView()
  stats.value = `地形 ${Math.round(sampled.min)}~${Math.round(sampled.max)}m · 网格 ${sampled.cols}×${sampled.rows}`
  statusMessage.value = ''
}

function onLive(): void {
  if (material) updateRiverWaterMaterial(material, ui)
}

function onArrowLive(): void {
  if (arrowMaterial) updateRiverFlowMaterial(arrowMaterial, arrows)
}

function onWaterLevel(): void {
  if (rebuildTimer !== undefined) window.clearTimeout(rebuildTimer)
  rebuildTimer = window.setTimeout(() => {
    rebuildTimer = undefined
    rebuildAll()
  }, 140)
}

function onShowFlow(): void {
  if (arrowPrimitive) arrowPrimitive.show = showFlow.value
}

function locate(): void {
  applyView()
}

/** 把草稿顶点画成一条贴地折线，便于边画边看。 */
function renderDraft(): void {
  if (!viewer) return
  if (draftEntity) {
    viewer.entities.remove(draftEntity)
    draftEntity = undefined
  }
  if (draftPoints.value.length === 0) return
  draftEntity = viewer.entities.add({
    polyline: {
      positions: draftPoints.value.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, 0)),
      width: 2.5,
      clampToGround: true,
      arcType: ArcType.GEODESIC,
      material: Color.fromCssColorString('#5ff0ff')
    }
  })
}

function startDrawing(): void {
  if (!viewer) return
  drawing.value = true
  draftPoints.value = []
  statusMessage.value = '在地图上依次单击添加河道边界顶点'
  renderDraft()
}

function addDraftPoint(windowPosition: Cartesian2): void {
  if (!viewer || !drawing.value) return
  const ray = viewer.camera.getPickRay(windowPosition)
  if (!ray) return
  const picked =
    viewer.scene.globe.pick(ray, viewer.scene) ??
    viewer.camera.pickEllipsoid(windowPosition, Ellipsoid.WGS84)
  if (!picked) return
  const carto = Cartographic.fromCartesian(picked)
  if (!carto) return
  draftPoints.value = [
    ...draftPoints.value,
    [CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude)]
  ]
  renderDraft()
  statusMessage.value = `河道边界已添加 ${draftPoints.value.length} 个顶点，点击「完成绘制」生成水面`
}

function finishDrawing(): void {
  if (!viewer) return
  if (draftPoints.value.length < 3) {
    statusMessage.value = '河道多边形至少需要 3 个顶点'
    return
  }
  drawing.value = false
  channelPolygon = [...draftPoints.value]
  channelPoints.value = channelPolygon
  draftPoints.value = []
  if (draftEntity) {
    viewer.entities.remove(draftEntity)
    draftEntity = undefined
  }
  renderArea()
  if (grid) {
    waterBase = Math.round(estimateWaterLevel(grid, 0.1, channelPolygon))
    ui.waterLevel = waterBase
  }
  rebuildAll()
  statusMessage.value = ''
}

function cancelDrawing(): void {
  drawing.value = false
  draftPoints.value = []
  if (viewer && draftEntity) {
    viewer.entities.remove(draftEntity)
    draftEntity = undefined
  }
  statusMessage.value = ''
}

/** 绘制完成后用半透明多边形标出河道范围。 */
function renderArea(): void {
  if (!viewer) return
  if (areaEntity) {
    viewer.entities.remove(areaEntity)
    areaEntity = undefined
  }
  if (!channelPolygon || channelPolygon.length < 3) return
  const positions = channelPolygon.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, 0))
  areaEntity = viewer.entities.add({
    polygon: {
      hierarchy: new PolygonHierarchy(positions),
      material: Color.fromCssColorString('#38c6f4').withAlpha(0.14)
    },
    polyline: {
      positions: [...positions, positions[0]],
      width: 2.5,
      clampToGround: true,
      arcType: ArcType.GEODESIC,
      material: Color.fromCssColorString('#5ff0ff')
    }
  })
}

function clearChannel(): void {
  channelPolygon = undefined
  channelPoints.value = []
  if (viewer && areaEntity) {
    viewer.entities.remove(areaEntity)
    areaEntity = undefined
  }
  if (grid) {
    waterBase = Math.round(estimateWaterLevel(grid, 0.1))
    ui.waterLevel = waterBase
  }
  rebuildAll()
}

onMounted(async () => {
  if (!container.value) return
  const callbacks: SceneCallbacks = {
    onStatus: (message) => {
      statusMessage.value = message
    },
    onBasemapReady: () => {
      statusMessage.value = '正在加载世界地形…'
    }
  }
  try {
    viewer = createMapScene(container.value, callbacks)
    viewer.scene.globe.depthTestAgainstTerrain = true
    inputHandler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    inputHandler.setInputAction(
      (event: { position: Cartesian2 }) => addDraftPoint(event.position),
      ScreenSpaceEventType.LEFT_CLICK
    )
    loadBingImagery(viewer, callbacks)
    terrain = await loadWorldTerrain(viewer)
    if (disposed || !viewer) return
    await loadTerrain()
  } catch (error) {
    if (!disposed) statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  if (rebuildTimer !== undefined) window.clearTimeout(rebuildTimer)
  inputHandler?.destroy()
  inputHandler = undefined
  draftEntity = undefined
  areaEntity = undefined
  primitive = undefined
  material = undefined
  arrowPrimitive = undefined
  arrowMaterial = undefined
  grid = undefined
  flowField = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="river-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="river-panel">
      <div class="panel-title">真实河道水面 · 龙羊峡</div>
      <div class="action-row">
        <button class="action-button" @click="locate">定位河段</button>
        <button v-if="!drawing && !channelPoints.length" class="action-button" @click="startDrawing">绘制河道</button>
        <button v-if="drawing" class="action-button" @click="finishDrawing">完成绘制</button>
        <button v-if="drawing" class="action-button" @click="cancelDrawing">取消</button>
        <button v-if="!drawing && channelPoints.length" class="action-button" @click="clearChannel">清除河道</button>
      </div>
      <div v-if="drawing" class="hint-line">单击地图添加边界顶点（{{ draftPoints.length }} 个），完成后点「完成绘制」</div>
      <div v-else-if="channelPoints.length" class="hint-line">河道范围：手绘多边形（{{ channelPoints.length }} 个顶点）</div>
      <div v-if="stats" class="stats-line">{{ stats }}</div>
      <div v-if="flowCells" class="stats-line">自动流向 {{ bearingLabel }} · 河道格点 {{ flowCells }}</div>

      <div class="group-label">水体基础</div>
      <div class="param-row"><span class="param-label">水位(m)</span><input v-model.number="ui.waterLevel" class="param-slider" type="range" :min="waterLevelMin" :max="waterLevelMax" step="1" @input="onWaterLevel" /><span class="param-value">{{ ui.waterLevel }}</span></div>
      <div class="param-row"><span class="param-label">基础颜色</span><input v-model="ui.baseColor" class="color-input" type="color" @input="onLive" /></div>
      <div class="param-row"><span class="param-label">透明度</span><input v-model.number="ui.baseAlpha" class="param-slider" type="range" min="0" max="1" step="0.01" @input="onLive" /><span class="param-value">{{ ui.baseAlpha.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">水深值</span><input v-model.number="ui.depthValue" class="param-slider" type="range" min="0.5" max="12" step="0.1" @input="onLive" /><span class="param-value">{{ ui.depthValue.toFixed(1) }}</span></div>
      <div class="param-row"><span class="param-label">扭曲度</span><input v-model.number="ui.distortion" class="param-slider" type="range" min="0" max="1" step="0.01" @input="onLive" /><span class="param-value">{{ ui.distortion.toFixed(2) }}</span></div>

      <div class="group-label">深浅水区</div>
      <div class="param-row"><span class="param-label">浅水区颜色</span><input v-model="ui.shallowColor" class="color-input" type="color" @input="onLive" /></div>
      <div class="param-row"><span class="param-label">浅水区透明度</span><input v-model.number="ui.shallowAlpha" class="param-slider" type="range" min="0" max="1" step="0.01" @input="onLive" /><span class="param-value">{{ ui.shallowAlpha.toFixed(3) }}</span></div>
      <div class="param-row"><span class="param-label">深水区颜色</span><input v-model="ui.deepColor" class="color-input" type="color" @input="onLive" /></div>
      <div class="param-row"><span class="param-label">深水区透明度</span><input v-model.number="ui.deepAlpha" class="param-slider" type="range" min="0" max="1" step="0.001" @input="onLive" /><span class="param-value">{{ ui.deepAlpha.toFixed(3) }}</span></div>

      <div class="group-label">光学反射</div>
      <div class="param-row"><span class="param-label">菲涅尔反射色</span><input v-model="ui.fresnelColor" class="color-input" type="color" @input="onLive" /></div>
      <div class="param-row"><span class="param-label">菲涅尔系数</span><input v-model.number="ui.fresnelPower" class="param-slider" type="range" min="0.5" max="10" step="0.1" @input="onLive" /><span class="param-value">{{ ui.fresnelPower.toFixed(1) }}</span></div>
      <div class="param-row"><span class="param-label">反射强度</span><input v-model.number="ui.reflectIntensity" class="param-slider" type="range" min="0" max="3" step="0.01" @input="onLive" /><span class="param-value">{{ ui.reflectIntensity.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">反射混合度</span><input v-model.number="ui.reflectMix" class="param-slider" type="range" min="0" max="1" step="0.01" @input="onLive" /><span class="param-value">{{ ui.reflectMix.toFixed(2) }}</span></div>

      <div class="group-label">水流（流向按地形与河道自动判定）</div>
      <div class="param-row"><span class="param-label">水流速</span><input v-model.number="ui.flowSpeed" class="param-slider" type="range" min="0" max="500" step="0.5" @input="onLive" /><span class="param-value">{{ ui.flowSpeed.toFixed(1) }}</span></div>
      <div class="param-row"><span class="param-label">流向偏转(°)</span><input v-model.number="ui.flowAngle" class="param-slider" type="range" min="-180" max="180" step="1" @input="onLive" /><span class="param-value">{{ ui.flowAngle }}</span></div>

      <div class="group-label">动态流向箭头</div>
      <div class="param-row"><span class="param-label">显示箭头</span><input v-model="showFlow" type="checkbox" class="toggle-input" @change="onShowFlow" /></div>
      <div class="param-row"><span class="param-label">箭头样式</span><select v-model="arrows.style" class="select-input" @change="onArrowLive"><option v-for="item in FLOW_ARROW_STYLES" :key="item.value" :value="item.value">{{ item.label }}</option></select></div>
      <div class="param-row"><span class="param-label">箭头速度</span><input v-model.number="arrows.speed" class="param-slider" type="range" min="0" max="300" step="1" @input="onArrowLive" /><span class="param-value">{{ arrows.speed.toFixed(0) }}</span></div>
      <div class="param-row"><span class="param-label">箭头间距</span><input v-model.number="arrows.spacing" class="param-slider" type="range" min="0.3" max="3" step="0.05" @input="onArrowLive" /><span class="param-value">{{ arrows.spacing.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">箭头长度</span><input v-model.number="arrows.length" class="param-slider" type="range" min="0.1" max="0.9" step="0.01" @input="onArrowLive" /><span class="param-value">{{ arrows.length.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">箭头宽度</span><input v-model.number="arrows.width" class="param-slider" type="range" min="0.03" max="0.4" step="0.005" @input="onArrowLive" /><span class="param-value">{{ arrows.width.toFixed(3) }}</span></div>
      <div class="param-row"><span class="param-label">箭头亮度</span><input v-model.number="arrows.intensity" class="param-slider" type="range" min="0" max="1" step="0.01" @input="onArrowLive" /><span class="param-value">{{ arrows.intensity.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">箭头颜色</span><input v-model="arrows.color" class="color-input" type="color" @input="onArrowLive" /></div>

      <div class="group-label">白浪</div>
      <div class="param-row"><span class="param-label">白浪混合度</span><input v-model.number="ui.foamMix" class="param-slider" type="range" min="0" max="1" step="0.01" @input="onLive" /><span class="param-value">{{ ui.foamMix.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">白浪速度</span><input v-model.number="ui.foamSpeed" class="param-slider" type="range" min="0" max="500" step="0.5" @input="onLive" /><span class="param-value">{{ ui.foamSpeed.toFixed(1) }}</span></div>
      <div class="param-row"><span class="param-label">白浪缩放</span><input v-model.number="ui.foamScale" class="param-slider" type="range" min="0.1" max="8" step="0.01" @input="onLive" /><span class="param-value">{{ ui.foamScale.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">白浪强度</span><input v-model.number="ui.foamIntensity" class="param-slider" type="range" min="0" max="30" step="0.1" @input="onLive" /><span class="param-value">{{ ui.foamIntensity.toFixed(1) }}</span></div>

      <div class="group-label">波纹与高光</div>
      <div class="param-row"><span class="param-label">波高</span><input v-model.number="ui.waveHeight" class="param-slider" type="range" min="0" max="1" step="0.001" @input="onLive" /><span class="param-value">{{ ui.waveHeight.toFixed(3) }}</span></div>
      <div class="param-row"><span class="param-label">振幅</span><input v-model.number="ui.waveAmplitude" class="param-slider" type="range" min="0" max="1" step="0.001" @input="onLive" /><span class="param-value">{{ ui.waveAmplitude.toFixed(3) }}</span></div>
      <div class="param-row"><span class="param-label">密度</span><input v-model.number="ui.waveDensity" class="param-slider" type="range" min="100" max="4000" step="10" @input="onLive" /><span class="param-value">{{ ui.waveDensity }}</span></div>
      <div class="param-row"><span class="param-label">平滑</span><input v-model.number="ui.waveSmooth" class="param-slider" type="range" min="0" max="2000" step="5" @input="onLive" /><span class="param-value">{{ ui.waveSmooth }}</span></div>
      <div class="param-row"><span class="param-label">高光</span><input v-model.number="ui.specular" class="param-slider" type="range" min="1" max="200" step="1" @input="onLive" /><span class="param-value">{{ ui.specular }}</span></div>
      <div class="param-row"><span class="param-label">高光颜色</span><input v-model="ui.specularColor" class="color-input" type="color" @input="onLive" /></div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.river-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.river-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 6px; width: 262px; max-height: calc(100% - 24px); overflow-y: auto; padding: 11px; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 32, 49, 0.84); backdrop-filter: blur(6px); color: #ddf2f8; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.group-label { margin-top: 4px; padding-top: 6px; border-top: 1px solid rgba(137, 210, 233, 0.18); color: #8fd3ea; font-size: 11px; font-weight: 600; }
.action-row { display: flex; gap: 8px; }
.action-button { flex: 1; height: 25px; border: 0; border-radius: 5px; background: #257f9e; color: #edfaff; cursor: pointer; font-size: 11px; }
.stats-line { color: #7fb6c8; font-size: 10px; line-height: 1.4; }
.hint-line { padding: 4px 6px; border-radius: 4px; background: rgba(82, 196, 232, 0.12); color: #9fdcf0; font-size: 10px; line-height: 1.5; }
.param-row { display: flex; align-items: center; gap: 8px; }.param-label { flex: 0 0 78px; font-size: 11px; color: #bdd9e4; }.param-slider { flex: 1; min-width: 0; height: 4px; accent-color: #52c4e8; }.param-value { flex: 0 0 34px; color: #9cc9d8; font-size: 10px; text-align: right; }
.color-input { flex: 1; min-width: 0; height: 22px; padding: 0; border: 1px solid rgba(137, 210, 233, 0.24); border-radius: 4px; background: transparent; cursor: pointer; }
.toggle-input { flex: 0 0 16px; width: 16px; height: 16px; margin: 0; accent-color: #52c4e8; cursor: pointer; }
.select-input { flex: 1; min-width: 0; height: 22px; padding: 0 4px; border: 1px solid rgba(137, 210, 233, 0.24); border-radius: 4px; background: rgba(10, 34, 52, 0.9); color: #ddf2f8; font-size: 11px; cursor: pointer; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
