<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as Cesium from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import { createHeatmapCanvas, type GradientStops } from '../heatmap-lib/heatmap-engine'
import { generateSceneData, heatmapScenes, type HeatmapScene } from '../heatmap-lib/heatmap-data'

const container = ref<HTMLElement>()
const statusMessage = ref('')
const resultMessage = ref('')

const sceneId = ref('beijing-clusters')
const primitiveMode = ref<'TRIANGLES' | 'LINES'>('TRIANGLES')
const radius = ref(60)
const blur = ref(0.85)
const maxOpacity = ref(0.8)
const minOpacity = ref(0)
const gridResolution = ref(60)
const heatmapWidth = ref(200)
const heightScale = ref(3000)
const baseElevation = ref(0)
const surfaceOpacity = ref(0.9)
const paletteId = ref('default')
const useFixedRange = ref(false)
const fixedMin = ref(0)
const fixedMax = ref(1000)
const randomSeed = ref(20260827)

const activeSceneLabel = ref('')
const metricPoints = ref('0')
const metricRange = ref('-')
const metricVertices = ref('0')
const legendGradient = ref('')

const palettes: Array<{ id: string; label: string; stops: GradientStops }> = [
  {
    id: 'default',
    label: '蓝绿黄红',
    stops: { 0.25: 'rgb(0,0,255)', 0.55: 'rgb(0,255,0)', 0.85: 'yellow', 1: 'rgb(255,0,0)' }
  },
  {
    id: 'thermal',
    label: '热成像',
    stops: { 0: 'rgb(30,53,149)', 0.35: 'rgb(0,199,235)', 0.55: 'rgb(0,221,80)', 0.75: 'yellow', 0.95: 'rgb(230,0,0)', 1: 'rgb(150,0,0)' }
  },
  {
    id: 'hot',
    label: '黑红黄白',
    stops: { 0: 'rgb(0,0,0)', 0.4: 'rgb(255,0,0)', 0.7: 'rgb(255,255,0)', 1: 'rgb(255,255,255)' }
  },
  {
    id: 'viridis',
    label: '紫青黄',
    stops: { 0: 'rgb(68,1,84)', 0.3: 'rgb(59,82,139)', 0.55: 'rgb(33,145,140)', 0.8: 'rgb(94,201,98)', 1: 'rgb(253,231,37)' }
  }
]

const activePalette = () => palettes.find((item) => item.id === paletteId.value) ?? palettes[0]

let viewer: ReturnType<typeof createMapScene> | undefined
let disposed = false
let heatmapPrimitive: Cesium.Primitive | undefined
let sceneCenter = { lon: 116.46, lat: 39.92 }

function gradientCss(stops: GradientStops): string {
  const parts = Object.keys(stops)
    .sort((a, b) => Number(a) - Number(b))
    .map((position) => `${stops[position]} ${(Number(position) * 100).toFixed(1)}%`)
  return `linear-gradient(90deg, ${parts.join(', ')})`
}

function floatToByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)))
}

function createMeshGeometry(
  resolution: number,
  bounds: { west: number; south: number; east: number; north: number },
  heatmap: { shadowData: Uint8ClampedArray | null; colorData: Uint8ClampedArray | null; width: number; height: number }
): Cesium.Geometry {
  const vertexCount = resolution * resolution
  const positions = new Float64Array(vertexCount * 3)
  const colors = new Uint8Array(vertexCount * 4)
  const alpha = Math.round(surfaceOpacity.value * 255)
  const lonRange = bounds.east - bounds.west || 1
  const latRange = bounds.north - bounds.south || 1
  const canvasW = heatmap.width
  const canvasH = heatmap.height
  const intensityData = heatmap.shadowData
  const colorData = heatmap.colorData

  let positionOffset = 0
  let colorOffset = 0
  for (let j = 0; j < resolution; j += 1) {
    const lat = bounds.north - (latRange * j) / (resolution - 1)
    const canvasY = Math.min(canvasH - 1, Math.max(0, ((bounds.north - lat) / latRange) * canvasH))
    for (let i = 0; i < resolution; i += 1) {
      const lon = bounds.west + (lonRange * i) / (resolution - 1)
      const canvasX = Math.min(canvasW - 1, Math.max(0, ((lon - bounds.west) / lonRange) * canvasW))
      let intensity = 0
      let red = 90
      let green = 150
      let blue = 200
      let intensityAlpha = 255
      const pixelIndex = (Math.round(canvasY) * canvasW + Math.round(canvasX)) * 4
      if (intensityData && colorData && pixelIndex >= 0 && pixelIndex + 3 < colorData.length) {
        intensity = intensityData[pixelIndex + 3] / 255
        red = colorData[pixelIndex]
        green = colorData[pixelIndex + 1]
        blue = colorData[pixelIndex + 2]
        intensityAlpha = colorData[pixelIndex + 3]
      }
      const height = baseElevation.value + intensity * heightScale.value
      const position = Cesium.Cartesian3.fromDegrees(lon, lat, height)
      positions[positionOffset] = position.x
      positions[positionOffset + 1] = position.y
      positions[positionOffset + 2] = position.z
      colors[colorOffset] = floatToByte(red / 255)
      colors[colorOffset + 1] = floatToByte(green / 255)
      colors[colorOffset + 2] = floatToByte(blue / 255)
      colors[colorOffset + 3] = Math.round((intensityAlpha / 255) * alpha)
      positionOffset += 3
      colorOffset += 4
    }
  }

  const indices: number[] = []
  if (primitiveMode.value === 'TRIANGLES') {
    for (let j = 0; j < resolution - 1; j += 1) {
      for (let i = 0; i < resolution - 1; i += 1) {
        const topLeft = j * resolution + i
        const topRight = topLeft + 1
        const bottomLeft = (j + 1) * resolution + i
        const bottomRight = bottomLeft + 1
        indices.push(topLeft, bottomLeft, bottomRight)
        indices.push(topLeft, bottomRight, topRight)
      }
    }
  } else {
    for (let j = 0; j < resolution; j += 1) {
      for (let i = 0; i < resolution - 1; i += 1) {
        const index = j * resolution + i
        indices.push(index, index + 1)
      }
    }
    for (let i = 0; i < resolution; i += 1) {
      for (let j = 0; j < resolution - 1; j += 1) {
        const index = j * resolution + i
        indices.push(index, index + resolution)
      }
    }
  }

  const attributes = new Cesium.GeometryAttributes()
  attributes.position = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positions
  })
  attributes.color = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
    componentsPerAttribute: 4,
    normalize: true,
    values: colors
  })

  return new Cesium.Geometry({
    attributes,
    indices: indices.length && Math.max(...indices) > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
    primitiveType: primitiveMode.value === 'LINES' ? Cesium.PrimitiveType.LINES : Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(positions)
  })
}

function createSurfaceAppearance(): Cesium.Appearance {
  return new Cesium.Appearance({
    translucent: true,
    closed: false,
    renderState: {
      depthTest: { enabled: false },
      cull: { enabled: false },
      blending: Cesium.BlendingState.ALPHA_BLEND
    },
    vertexShaderSource: `
      in vec3 position3DHigh;
      in vec3 position3DLow;
      in float batchId;
      in vec4 color;
      out vec4 v_color;
      void main()
      {
        vec4 position = czm_translateRelativeToEye(position3DHigh, position3DLow);
        v_color = color;
        gl_Position = czm_modelViewProjectionRelativeToEye * position;
      }
    `,
    fragmentShaderSource: `
      in vec4 v_color;
      void main()
      {
        out_FragColor = v_color;
      }
    `
  })
}

function rebuildMesh(): void {
  if (!viewer || viewer.isDestroyed()) return
  const scene = heatmapScenes.find((item) => item.id === sceneId.value) ?? heatmapScenes[0]
  const data = generateSceneData(scene, randomSeed.value)
  const gradient = activePalette().stops
  const heatmap = createHeatmapCanvas(data.points, scene.bounds, {
    radius: radius.value,
    blur: blur.value,
    maxOpacity: maxOpacity.value,
    minOpacity: minOpacity.value,
    gradient,
    canvasWidth: heatmapWidth.value,
    min: useFixedRange.value ? fixedMin.value : undefined,
    max: useFixedRange.value ? fixedMax.value : undefined
  })
  const geometry = createMeshGeometry(gridResolution.value, scene.bounds, heatmap)
  const nextPrimitive = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({ geometry }),
    appearance: createSurfaceAppearance(),
    asynchronous: false,
    allowPicking: false
  })
  if (heatmapPrimitive) {
    viewer.scene.primitives.remove(heatmapPrimitive)
    heatmapPrimitive = undefined
  }
  heatmapPrimitive = viewer.scene.primitives.add(nextPrimitive)
  activeSceneLabel.value = scene.label
  metricPoints.value = data.points.length.toLocaleString()
  metricRange.value = `${data.valueMin.toFixed(0)} ~ ${data.valueMax.toFixed(0)}`
  metricVertices.value = (gridResolution.value * gridResolution.value).toLocaleString()
  sceneCenter = { lon: (scene.bounds.west + scene.bounds.east) / 2, lat: (scene.bounds.south + scene.bounds.north) / 2 }
  viewer.scene.requestRender()
}

function flyToScene(scene: HeatmapScene): void {
  if (!viewer || viewer.isDestroyed()) return
  const centerLon = (scene.bounds.west + scene.bounds.east) / 2
  const centerLat = (scene.bounds.south + scene.bounds.north) / 2
  const span = Math.max(scene.bounds.east - scene.bounds.west, scene.bounds.north - scene.bounds.south)
  const distance = Math.max(30000, span * 25000)
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, distance),
    orientation: {
      heading: Cesium.Math.toRadians(-35),
      pitch: Cesium.Math.toRadians(-42),
      roll: 0
    },
    duration: 1.2
  })
}

function onSceneChange(): void {
  const scene = heatmapScenes.find((item) => item.id === sceneId.value) ?? heatmapScenes[0]
  radius.value = scene.defaultRadius
  flyToScene(scene)
  rebuildMesh()
  resultMessage.value = `已切换到 ${scene.label}`
}

function onParamChange(): void {
  rebuildMesh()
}

function onRegenerate(): void {
  randomSeed.value = Math.floor(Math.random() * 1e9)
  rebuildMesh()
  resultMessage.value = '三维热力图已重新生成'
}

function updateLegend(): void {
  legendGradient.value = gradientCss(activePalette().stops)
}

function onPaletteChange(): void {
  updateLegend()
  rebuildMesh()
}

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    const scene = heatmapScenes.find((item) => item.id === sceneId.value) ?? heatmapScenes[0]
    radius.value = scene.defaultRadius
    const centerLon = (scene.bounds.west + scene.bounds.east) / 2
    const centerLat = (scene.bounds.south + scene.bounds.north) / 2
    const span = Math.max(scene.bounds.east - scene.bounds.west, scene.bounds.north - scene.bounds.south)
    const distance = Math.max(30000, span * 25000)
    sceneCenter = { lon: centerLon, lat: centerLat }
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, distance),
      orientation: {
        heading: Cesium.Math.toRadians(-35),
        pitch: Cesium.Math.toRadians(-42),
        roll: 0
      }
    })
    updateLegend()
    rebuildMesh()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  if (viewer && heatmapPrimitive) {
    viewer.scene.primitives.remove(heatmapPrimitive)
    heatmapPrimitive = undefined
  }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="hm3-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="hm3-panel">
      <div class="panel-title">三维热力图</div>
      <div class="panel-subtitle">数据采样构建地形热力网格</div>

      <div class="section-title">数据源</div>
      <div class="hm3-row">
        <select v-model="sceneId" class="hm3-select" aria-label="数据场景" @change="onSceneChange">
          <option v-for="scene in heatmapScenes" :key="scene.id" :value="scene.id">{{ scene.label }}</option>
        </select>
        <button class="hm3-btn" aria-label="随机重新生成数据" @click="onRegenerate">随机生成</button>
      </div>
      <div class="hm3-hint">{{ activeSceneLabel }} · {{ metricPoints }} 个数据点</div>

      <div class="section-title">形态</div>
      <div class="hm3-row">
        <button class="hm3-toggle" :class="{ on: primitiveMode === 'TRIANGLES' }" aria-label="面状模式" @click="primitiveMode = 'TRIANGLES'; onParamChange()">面状</button>
        <button class="hm3-toggle" :class="{ on: primitiveMode === 'LINES' }" aria-label="网格模式" @click="primitiveMode = 'LINES'; onParamChange()">网格</button>
      </div>

      <div class="section-title">渲染参数</div>
      <div class="hm3-param"><span>热力半径</span><input v-model.number="radius" type="range" min="15" max="120" step="5" @change="onParamChange" /><b>{{ radius }}</b></div>
      <div class="hm3-param"><span>模糊度</span><input v-model.number="blur" type="range" min="0.2" max="1" step="0.05" @change="onParamChange" /><b>{{ blur.toFixed(2) }}</b></div>
      <div class="hm3-param"><span>网格分辨率</span><input v-model.number="gridResolution" type="range" min="20" max="120" step="10" @change="onParamChange" /><b>{{ gridResolution }}</b></div>
      <div class="hm3-param"><span>热力分辨率</span><input v-model.number="heatmapWidth" type="range" min="100" max="400" step="50" @change="onParamChange" /><b>{{ heatmapWidth }}</b></div>
      <div class="hm3-param"><span>高度倍率</span><input v-model.number="heightScale" type="range" min="200" max="8000" step="200" @change="onParamChange" /><b>{{ heightScale }}</b></div>
      <div class="hm3-param"><span>基准高度</span><input v-model.number="baseElevation" type="range" min="0" max="2000" step="100" @change="onParamChange" /><b>{{ baseElevation }}</b></div>
      <div class="hm3-param"><span>透明度</span><input v-model.number="surfaceOpacity" type="range" min="0.2" max="1" step="0.05" @change="onParamChange" /><b>{{ surfaceOpacity.toFixed(2) }}</b></div>

      <div class="section-title">色带</div>
      <select v-model="paletteId" class="hm3-select" aria-label="色带" @change="onPaletteChange">
        <option v-for="item in palettes" :key="item.id" :value="item.id">{{ item.label }}</option>
      </select>
      <div class="hm3-legend" :style="{ background: legendGradient }"></div>
      <div class="hm3-legend-labels"><span>低</span><span>高</span></div>

      <div class="section-title">数据范围</div>
      <div class="hm3-row">
        <button class="hm3-toggle" :class="{ on: useFixedRange }" aria-label="固定范围开关" @click="useFixedRange = !useFixedRange; onParamChange()">{{ useFixedRange ? '固定范围: 开' : '固定范围: 关' }}</button>
      </div>
      <div v-if="useFixedRange" class="hm3-row">
        <input v-model.number="fixedMin" class="hm3-number" type="number" min="0" max="1000" aria-label="固定最小值" @change="onParamChange" />
        <span class="hm3-sep">~</span>
        <input v-model.number="fixedMax" class="hm3-number" type="number" min="0" max="1000" aria-label="固定最大值" @change="onParamChange" />
      </div>

      <div class="hm3-metrics">
        <div><span>数据范围</span><strong>{{ metricRange }}</strong></div>
        <div><span>网格顶点</span><strong>{{ metricVertices }}</strong></div>
      </div>

      <div v-if="resultMessage" class="hm3-hint">{{ resultMessage }}</div>
    </div>

    <div v-if="statusMessage" class="hm3-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.hm3-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #061421; color: #e8fbff; font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif; }
.cesium-container { width: 100%; height: 100%; }
.hm3-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 7px; width: 240px; max-height: calc(100% - 24px); overflow-y: auto; padding: 11px; border: 1px solid rgba(91, 255, 226, 0.28); border-radius: 9px; background: rgba(8, 28, 43, 0.9); backdrop-filter: blur(6px); }
.panel-title { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
.panel-subtitle { font-size: 11px; color: #7da9b8; }
.section-title { margin-top: 4px; padding: 2px 0 1px; border-bottom: 1px solid rgba(91, 255, 226, 0.18); font-size: 11px; font-weight: 700; color: #5fffe0; }
.hm3-row { display: flex; align-items: center; gap: 6px; }
.hm3-select { flex: 1; width: 100%; height: 24px; border: 1px solid rgba(91, 255, 226, 0.24); border-radius: 5px; background: rgba(13, 42, 58, 0.78); color: #d9eff6; font-size: 11px; }
.hm3-btn { height: 24px; padding: 0 10px; border: 0; border-radius: 5px; background: #257f9e; color: #edfaff; cursor: pointer; font-size: 11px; }
.hm3-toggle { height: 22px; padding: 0 10px; border: 1px solid rgba(91, 255, 226, 0.24); border-radius: 5px; background: rgba(13, 42, 58, 0.78); color: #7da9b8; font-size: 11px; cursor: pointer; }
.hm3-toggle.on { color: #e8fbff; border-color: #5fffe0; }
.hm3-param { display: flex; align-items: center; gap: 8px; }
.hm3-param span { flex: 0 0 68px; font-size: 11px; color: #bdd9e4; }
.hm3-param input { flex: 1; min-width: 0; height: 4px; accent-color: #5fffe0; }
.hm3-param b { flex: 0 0 34px; color: #9cc9d8; font-size: 10px; text-align: right; }
.hm3-hint { padding: 4px 7px; border-radius: 5px; background: rgba(13, 42, 58, 0.6); color: #7da9b8; font-size: 11px; line-height: 1.4; }
.hm3-legend { height: 10px; border-radius: 5px; border: 1px solid rgba(91, 255, 226, 0.25); }
.hm3-legend-labels { display: flex; justify-content: space-between; color: #7da9b8; font-size: 10px; }
.hm3-number { width: 70px; height: 22px; border: 1px solid rgba(91, 255, 226, 0.24); border-radius: 5px; background: rgba(13, 42, 58, 0.78); color: #d9eff6; font-size: 11px; text-align: center; }
.hm3-sep { color: #7da9b8; }
.hm3-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.hm3-metrics > div { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border: 1px solid rgba(54, 141, 255, 0.18); border-radius: 6px; background: rgba(13, 42, 58, 0.6); }
.hm3-metrics span { font-size: 10px; color: #7da9b8; }
.hm3-metrics strong { font-size: 12px; color: #e8fbff; }
.hm3-status { position: absolute; inset: 0; z-index: 9; display: grid; place-items: center; padding: 24px; color: #d9eff6; background: rgba(4, 23, 37, 0.72); font-size: 12px; }
</style>
