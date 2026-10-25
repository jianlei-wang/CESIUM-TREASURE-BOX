<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as Cesium from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import { createHeatmapCanvas, type GradientStops, type HeatPoint, type HeatmapResult } from '../heatmap-lib/heatmap-engine'

type Center = { lon: number; lat: number; value: number; sigma: number; weight: number }
type Scenario = {
  id: string
  label: string
  bounds: { west: number; south: number; east: number; north: number }
  centers: Center[]
  count: number
}

const SCENARIOS: Scenario[] = [
  {
    id: 'core',
    label: '单核聚集',
    bounds: { west: 108.925, south: 34.19, east: 109.0, north: 34.255 },
    centers: [{ lon: 108.962, lat: 34.221, value: 92, sigma: 0.011, weight: 1 }],
    count: 340
  },
  {
    id: 'dual',
    label: '双核扩散',
    bounds: { west: 108.925, south: 34.19, east: 109.0, north: 34.255 },
    centers: [
      { lon: 108.945, lat: 34.214, value: 82, sigma: 0.009, weight: 0.55 },
      { lon: 108.981, lat: 34.234, value: 96, sigma: 0.008, weight: 0.45 }
    ],
    count: 460
  },
  {
    id: 'corridor',
    label: '带状走廊',
    bounds: { west: 108.925, south: 34.19, east: 109.0, north: 34.255 },
    centers: [
      { lon: 108.934, lat: 34.2, value: 58, sigma: 0.012, weight: 0.3 },
      { lon: 108.958, lat: 34.218, value: 78, sigma: 0.01, weight: 0.35 },
      { lon: 108.984, lat: 34.238, value: 95, sigma: 0.009, weight: 0.35 }
    ],
    count: 420
  }
]

const PALETTES: Array<{ id: string; label: string; stops: GradientStops }> = [
  {
    id: 'thermal',
    label: '冷蓝到赤红',
    stops: { 0: 'rgb(24,48,120)', 0.35: 'rgb(0,196,220)', 0.55: 'rgb(24,214,120)', 0.75: 'yellow', 0.92: 'rgb(238,64,32)', 1: 'rgb(150,0,0)' }
  },
  {
    id: 'magma',
    label: '深紫到亮黄',
    stops: { 0: 'rgb(52,10,84)', 0.35: 'rgb(150,28,120)', 0.62: 'rgb(232,82,64)', 0.82: 'rgb(250,168,48)', 1: 'rgb(255,246,180)' }
  },
  {
    id: 'ocean',
    label: '青绿到橙',
    stops: { 0: 'rgb(12,58,94)', 0.4: 'rgb(24,148,154)', 0.65: 'rgb(126,206,138)', 0.85: 'rgb(244,196,84)', 1: 'rgb(250,110,60)' }
  }
]

const container = ref<HTMLElement>()
const statusMessage = ref('')
const sceneId = ref('core')
const paletteId = ref('thermal')
const radius = ref(34)
const blur = ref(0.82)
const gridResolution = ref(72)
const heightScale = ref(1800)
const surfaceOpacity = ref(0.9)
const showPoints = ref(false)
const randomSeed = ref(20261025)
const activeSceneLabel = ref('单核聚集')
const metricPoints = ref('0')
const metricPeak = ref('0')
const metricVertices = ref('0')
const metricRange = ref('-')

const activePalette = computed(() => PALETTES.find((item) => item.id === paletteId.value) ?? PALETTES[0])
const legendGradient = computed(() => {
  const stops = activePalette.value.stops
  const parts = Object.keys(stops)
    .sort((a, b) => Number(a) - Number(b))
    .map((position) => `${stops[position]} ${(Number(position) * 100).toFixed(1)}%`)
  return `linear-gradient(90deg, ${parts.join(', ')})`
})

let viewer: ReturnType<typeof createMapScene> | undefined
let surfacePrimitive: Cesium.Primitive | undefined
let pointCollection: Cesium.PointPrimitiveCollection | undefined
let currentPoints: HeatPoint[] = []
let currentScene = SCENARIOS[0]
let disposed = false

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-7)
  const v = Math.max(random(), 1e-7)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function generatePoints(scene: Scenario, seed: number): HeatPoint[] {
  const random = mulberry32(seed)
  const points: HeatPoint[] = []
  const totalWeight = scene.centers.reduce((sum, center) => sum + center.weight, 0)
  for (let i = 0; i < scene.count; i += 1) {
    let pick = random() * totalWeight
    let center = scene.centers[0]
    for (const candidate of scene.centers) {
      pick -= candidate.weight
      if (pick <= 0) {
        center = candidate
        break
      }
    }
    const lon = center.lon + gaussian(random) * center.sigma
    const lat = center.lat + gaussian(random) * center.sigma
    if (lon < scene.bounds.west || lon > scene.bounds.east || lat < scene.bounds.south || lat > scene.bounds.north) {
      continue
    }
    const value = Math.max(4, Math.min(100, center.value + gaussian(random) * 11))
    points.push({ x: lon, y: lat, value })
  }
  return points
}

function buildGeometry(resolution: number, scene: Scenario, heatmap: HeatmapResult): Cesium.Geometry {
  const vertexCount = resolution * resolution
  const positions = new Float64Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const texCoords = new Float32Array(vertexCount * 2)
  const lonRange = scene.bounds.east - scene.bounds.west
  const latRange = scene.bounds.north - scene.bounds.south
  const data = heatmap.shadowData
  let positionOffset = 0
  let normalOffset = 0
  let stOffset = 0
  let peak = 0

  for (let j = 0; j < resolution; j += 1) {
    const v = j / (resolution - 1)
    const lat = scene.bounds.south + latRange * v
    const canvasY = Math.min(heatmap.height - 1, Math.max(0, ((scene.bounds.north - lat) / latRange) * heatmap.height))
    for (let i = 0; i < resolution; i += 1) {
      const u = i / (resolution - 1)
      const lon = scene.bounds.west + lonRange * u
      const canvasX = Math.min(heatmap.width - 1, Math.max(0, u * heatmap.width))
      let intensity = 0
      if (data) {
        const pixelIndex = (Math.round(canvasY) * heatmap.width + Math.round(canvasX)) * 4
        if (pixelIndex >= 0 && pixelIndex + 3 < data.length) {
          intensity = data[pixelIndex + 3] / 255
        }
      }
      const height = intensity * heightScale.value
      peak = Math.max(peak, height)
      const position = Cesium.Cartesian3.fromDegrees(lon, lat, height)
      positions[positionOffset] = position.x
      positions[positionOffset + 1] = position.y
      positions[positionOffset + 2] = position.z
      const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(position, new Cesium.Cartesian3())
      normals[normalOffset] = normal.x
      normals[normalOffset + 1] = normal.y
      normals[normalOffset + 2] = normal.z
      texCoords[stOffset] = u
      texCoords[stOffset + 1] = v
      positionOffset += 3
      normalOffset += 3
      stOffset += 2
    }
  }

  const indices = new Uint32Array((resolution - 1) * (resolution - 1) * 6)
  let indexOffset = 0
  for (let j = 0; j < resolution - 1; j += 1) {
    for (let i = 0; i < resolution - 1; i += 1) {
      const topLeft = j * resolution + i
      const topRight = topLeft + 1
      const bottomLeft = (j + 1) * resolution + i
      const bottomRight = bottomLeft + 1
      indices[indexOffset] = topLeft
      indices[indexOffset + 1] = bottomLeft
      indices[indexOffset + 2] = bottomRight
      indices[indexOffset + 3] = topLeft
      indices[indexOffset + 4] = bottomRight
      indices[indexOffset + 5] = topRight
      indexOffset += 6
    }
  }

  const attributes = new Cesium.GeometryAttributes()
  attributes.position = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positions
  })
  attributes.normal = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.FLOAT,
    componentsPerAttribute: 3,
    values: normals
  })
  attributes.st = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.FLOAT,
    componentsPerAttribute: 2,
    values: texCoords
  })

  metricPeak.value = Math.round(peak).toLocaleString()
  return new Cesium.Geometry({
    attributes,
    indices,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(positions)
  })
}

function createAppearance(heatmap: HeatmapResult): Cesium.MaterialAppearance {
  const material = new Cesium.Material({
    fabric: {
      type: 'Image',
      uniforms: {
        image: heatmap.canvas,
        repeat: new Cesium.Cartesian2(1, 1),
        color: new Cesium.Color(1, 1, 1, surfaceOpacity.value)
      }
    },
    translucent: true
  })
  return new Cesium.MaterialAppearance({
    material,
    translucent: true,
    closed: false,
    flat: true,
    faceForward: true,
    renderState: {
      depthTest: { enabled: true },
      cull: { enabled: false },
      blending: Cesium.BlendingState.ALPHA_BLEND
    }
  })
}

function rebuildPoints(scene: Scenario): void {
  if (!viewer || viewer.isDestroyed()) return
  if (!pointCollection) {
    pointCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection()) as Cesium.PointPrimitiveCollection
  }
  pointCollection.removeAll()
  const step = Math.max(1, Math.floor(currentPoints.length / 260))
  for (let i = 0; i < currentPoints.length; i += step) {
    const point = currentPoints[i]
    pointCollection.add({
      position: Cesium.Cartesian3.fromDegrees(point.x, point.y, 30),
      pixelSize: 4,
      color: Cesium.Color.fromCssColorString('#fff1c9').withAlpha(0.85),
      outlineColor: Cesium.Color.fromCssColorString('#5b3b17').withAlpha(0.75),
      outlineWidth: 1
    })
  }
  pointCollection.show = showPoints.value
  void scene
}

function rebuildSurface(): void {
  if (!viewer || viewer.isDestroyed()) return
  const scene = SCENARIOS.find((item) => item.id === sceneId.value) ?? SCENARIOS[0]
  currentScene = scene
  currentPoints = generatePoints(scene, randomSeed.value)
  if (currentPoints.length === 0) {
    metricPoints.value = '0'
    metricRange.value = '-'
    metricPeak.value = '0'
    return
  }
  const heatmap = createHeatmapCanvas(currentPoints, scene.bounds, {
    radius: radius.value,
    blur: blur.value,
    maxOpacity: 0.92,
    minOpacity: 0,
    gradient: activePalette.value.stops,
    canvasWidth: 320
  })
  const geometry = buildGeometry(gridResolution.value, scene, heatmap)
  const nextPrimitive = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({ geometry }),
    appearance: createAppearance(heatmap),
    asynchronous: false,
    allowPicking: false
  })
  if (surfacePrimitive) {
    viewer.scene.primitives.remove(surfacePrimitive)
    surfacePrimitive = undefined
  }
  surfacePrimitive = viewer.scene.primitives.add(nextPrimitive)
  activeSceneLabel.value = scene.label
  metricPoints.value = currentPoints.length.toLocaleString()
  metricVertices.value = (gridResolution.value * gridResolution.value).toLocaleString()
  metricRange.value = `${Math.min(...currentPoints.map((point) => point.value)).toFixed(0)} ~ ${Math.max(
    ...currentPoints.map((point) => point.value)
  ).toFixed(0)}`
  rebuildPoints(scene)
  viewer.scene.requestRender()
}

function surfaceView(duration: number): void {
  if (!viewer || viewer.isDestroyed()) return
  const scene = currentScene
  const centerLon = (scene.bounds.west + scene.bounds.east) / 2
  const centerLat = (scene.bounds.south + scene.bounds.north) / 2
  const spanLon = (scene.bounds.east - scene.bounds.west) * 111320 * Math.cos(Cesium.Math.toRadians(centerLat))
  const spanLat = (scene.bounds.north - scene.bounds.south) * 110540
  const radius = Math.max(900, Math.max(spanLon, spanLat) * 0.62)
  const center = Cesium.Cartesian3.fromDegrees(centerLon, centerLat, heightScale.value * 0.35)
  const offset = new Cesium.HeadingPitchRange(
    Cesium.Math.toRadians(-35),
    Cesium.Math.toRadians(-42),
    radius * 2.4
  )
  if (duration <= 0) {
    viewer.camera.lookAt(center, offset)
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
    return
  }
  viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, radius), { offset, duration })
}

function flyToSurface(): void {
  surfaceView(1.3)
}

function onSceneChange(): void {
  randomSeed.value = Math.floor(Math.random() * 1e9)
  rebuildSurface()
  flyToSurface()
}

function onRegenerate(): void {
  randomSeed.value = Math.floor(Math.random() * 1e9)
  rebuildSurface()
}

function onPaletteChange(): void {
  rebuildSurface()
}

function onTogglePoints(): void {
  if (pointCollection) pointCollection.show = showPoints.value
}

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => {
      statusMessage.value = message
    },
    onBasemapReady: () => {
      statusMessage.value = ''
    }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    rebuildSurface()
    surfaceView(0)
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  if (viewer && !viewer.isDestroyed()) {
    if (surfacePrimitive) {
      viewer.scene.primitives.remove(surfacePrimitive)
      surfacePrimitive = undefined
    }
    if (pointCollection) {
      viewer.scene.primitives.remove(pointCollection)
      pointCollection = undefined
    }
  }
  destroyScene(viewer)
  viewer = undefined
  void disposed
})
</script>

<template>
  <div class="chs-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="chs-panel">
      <div class="panel-title">三维热力曲面</div>
      <div class="panel-subtitle">采样点 → 热力纹理 → 抬升曲面</div>

      <div class="section-title">数据场景</div>
      <div class="chs-row">
        <select v-model="sceneId" class="chs-select" aria-label="数据场景" @change="onSceneChange">
          <option v-for="scene in SCENARIOS" :key="scene.id" :value="scene.id">{{ scene.label }}</option>
        </select>
        <button class="chs-btn" @click="onRegenerate">重新采样</button>
      </div>
      <div class="chs-hint">{{ activeSceneLabel }} · {{ metricPoints }} 个采样点 · 值域 {{ metricRange }}</div>

      <div class="section-title">曲面</div>
      <div class="chs-param"><span>热力半径</span><input v-model.number="radius" type="range" min="16" max="70" step="2" @change="rebuildSurface" /><b>{{ radius }}</b></div>
      <div class="chs-param"><span>模糊度</span><input v-model.number="blur" type="range" min="0.3" max="1" step="0.02" @change="rebuildSurface" /><b>{{ blur.toFixed(2) }}</b></div>
      <div class="chs-param"><span>网格分辨率</span><input v-model.number="gridResolution" type="range" min="32" max="128" step="8" @change="rebuildSurface" /><b>{{ gridResolution }}</b></div>
      <div class="chs-param"><span>高度倍率</span><input v-model.number="heightScale" type="range" min="400" max="4000" step="100" @change="rebuildSurface" /><b>{{ heightScale }}</b></div>
      <div class="chs-param"><span>曲面透明度</span><input v-model.number="surfaceOpacity" type="range" min="0.25" max="1" step="0.05" @change="rebuildSurface" /><b>{{ surfaceOpacity.toFixed(2) }}</b></div>

      <div class="section-title">色带</div>
      <select v-model="paletteId" class="chs-select" aria-label="色带" @change="onPaletteChange">
        <option v-for="item in PALETTES" :key="item.id" :value="item.id">{{ item.label }}</option>
      </select>
      <div class="chs-legend" :style="{ background: legendGradient }"></div>
      <div class="chs-legend-labels"><span>低</span><span>高</span></div>

      <div class="chs-row">
        <button class="chs-toggle" :class="{ on: showPoints }" @click="showPoints = !showPoints; onTogglePoints()">
          {{ showPoints ? '采样点: 开' : '采样点: 关' }}
        </button>
        <button class="chs-btn ghost" @click="flyToSurface">重置视角</button>
      </div>

      <div class="chs-metrics">
        <div><span>网格顶点</span><strong>{{ metricVertices }}</strong></div>
        <div><span>峰值高度</span><strong>{{ metricPeak }} m</strong></div>
      </div>
    </div>

    <div v-if="statusMessage" class="chs-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.chs-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #061421; color: #e8fbff; font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif; }
.cesium-container { width: 100%; height: 100%; }
.chs-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 7px; width: 248px; max-height: calc(100% - 24px); overflow-y: auto; padding: 11px; border: 1px solid rgba(91, 255, 226, 0.28); border-radius: 9px; background: rgba(8, 28, 43, 0.9); backdrop-filter: blur(6px); }
.panel-title { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
.panel-subtitle { font-size: 11px; color: #7da9b8; }
.section-title { margin-top: 4px; padding: 2px 0 1px; border-bottom: 1px solid rgba(91, 255, 226, 0.18); font-size: 11px; font-weight: 700; color: #5fffe0; }
.chs-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.chs-select { flex: 1; width: 100%; height: 24px; border: 1px solid rgba(91, 255, 226, 0.24); border-radius: 5px; background: rgba(13, 42, 58, 0.78); color: #d9eff6; font-size: 11px; }
.chs-btn { height: 24px; padding: 0 10px; border: 0; border-radius: 5px; background: #257f9e; color: #edfaff; cursor: pointer; font-size: 11px; }
.chs-btn.ghost { background: rgba(13, 42, 58, 0.78); border: 1px solid rgba(91, 255, 226, 0.24); color: #b9dce7; }
.chs-toggle { height: 24px; padding: 0 10px; border: 1px solid rgba(91, 255, 226, 0.24); border-radius: 5px; background: rgba(13, 42, 58, 0.78); color: #7da9b8; font-size: 11px; cursor: pointer; }
.chs-toggle.on { color: #e8fbff; border-color: #5fffe0; }
.chs-param { display: flex; align-items: center; gap: 8px; }
.chs-param span { flex: 0 0 74px; font-size: 11px; color: #bdd9e4; }
.chs-param input { flex: 1; min-width: 0; height: 4px; accent-color: #5fffe0; }
.chs-param b { flex: 0 0 38px; color: #9cc9d8; font-size: 10px; text-align: right; }
.chs-hint { padding: 4px 7px; border-radius: 5px; background: rgba(13, 42, 58, 0.6); color: #7da9b8; font-size: 11px; line-height: 1.4; }
.chs-legend { height: 10px; border-radius: 5px; border: 1px solid rgba(91, 255, 226, 0.25); }
.chs-legend-labels { display: flex; justify-content: space-between; color: #7da9b8; font-size: 10px; }
.chs-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.chs-metrics > div { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border: 1px solid rgba(54, 141, 255, 0.18); border-radius: 6px; background: rgba(13, 42, 58, 0.6); }
.chs-metrics span { font-size: 10px; color: #7da9b8; }
.chs-metrics strong { font-size: 12px; color: #e8fbff; }
.chs-status { position: absolute; inset: 0; z-index: 9; display: grid; place-items: center; padding: 24px; color: #d9eff6; background: rgba(4, 23, 37, 0.72); font-size: 12px; }
</style>
