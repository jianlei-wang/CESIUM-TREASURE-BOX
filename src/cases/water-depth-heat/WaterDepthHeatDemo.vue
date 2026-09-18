<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as Cesium from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, loadWorldTerrain, type SceneCallbacks } from '../../lib/cesium-scene'
import {
  CENTER,
  calculateDifferenceStats,
  colorPalettes,
  createSoundings,
  depthToColor,
  interpolationMethods,
  interpolateGrid,
  paletteToGradient,
  type InterpolationGrid,
  type InterpolationOptions,
  type Sounding
} from './bathymetry'

const container = ref<HTMLElement>()
const statusMessage = ref('')
const resultMessage = ref('')
const busy = ref(false)

const method = ref('idw')
const pointCount = ref(2600)
const gridResolution = ref(38)
const heightScale = ref(55)
const surfaceOpacity = ref(70)
const showPoints = ref(true)
const showSurface = ref(true)
const comparisonMethod = ref('idw')
const showDifference = ref(false)
const palette = ref('ocean')
const reversePalette = ref(false)

const idwPower = ref(2.1)
const idwLimit = ref(80)
const krigingRangeKm = ref(14.5)
const krigingLimit = ref(22)
const krigingNugget = ref(0.02)
const splineSamples = ref(32)
const splineRegularization = ref(0.02)
const naturalLimit = ref(24)
const naturalSoftness = ref(1.25)

const activeMethodLabel = computed(() => interpolationMethods.find((item) => item.value === method.value)?.label ?? '')
const pointCountLabel = computed(() => pointCount.value.toLocaleString())
const gridCellsLabel = ref('0')
const gridMaxLabel = ref('0 m')
const gridMinLabel = ref('0 m')
const krigingFittedRange = ref('计算后显示')
const krigingModelType = ref('计算后显示')
const comparisonInfo = ref('差值图关闭')
const legendGradient = ref(paletteToGradient())
const legendLeft = ref('深水')
const legendRight = ref('浅水')

let viewer: ReturnType<typeof createMapScene> | undefined
let disposed = false
let pointCollection: Cesium.PointPrimitiveCollection | undefined
let surfacePrimitive: Cesium.Primitive | undefined
let soundings: Sounding[] = []
let grid: InterpolationGrid = { cells: [], bounds: { west: 0, south: 0, east: 0, north: 0 }, min: -1, max: 0, colorMin: -1, colorMax: 0, method: 'idw', resolution: 38 }
let comparisonGrid: InterpolationGrid | null = null
let comparisonStats: { mae: number; rmse: number; maxAbs: number } | null = null

function floatToByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)))
}

function getColor(depth: number, targetGrid: InterpolationGrid, alpha = 255): Cesium.Color {
  const min = targetGrid.colorMin ?? targetGrid.min
  const max = targetGrid.colorMax ?? targetGrid.max
  const [r, g, b] = depthToColor(depth, min, max, palette.value, reversePalette.value)
  return Cesium.Color.fromBytes(r, g, b, alpha)
}

function getDifferenceColor(difference: number, maxAbsDifference: number, alpha = 255): Cesium.Color {
  const t = Math.max(0, Math.min(1, Math.abs(difference) / (maxAbsDifference || 1)))
  const center = [245, 248, 250]
  const edge = difference < 0 ? [45, 124, 181] : [211, 77, 69]
  const rgb = center.map((channel, index) => Math.round(channel + (edge[index] - channel) * t))
  return Cesium.Color.fromBytes(rgb[0], rgb[1], rgb[2], alpha)
}

function depthToHeight(depth: number): number {
  return depth * heightScale.value
}

function sampleGridDepth(targetGrid: InterpolationGrid, x: number, y: number): number {
  const resolution = targetGrid.resolution
  const maxIndex = resolution - 1
  const col = Math.max(0, Math.min(maxIndex, x * resolution - 0.5))
  const row = Math.max(0, Math.min(maxIndex, y * resolution - 0.5))
  const c0 = Math.floor(col)
  const r0 = Math.floor(row)
  const c1 = Math.min(maxIndex, c0 + 1)
  const r1 = Math.min(maxIndex, r0 + 1)
  const tx = col - c0
  const ty = row - r0
  const valueAt = (r: number, c: number) => targetGrid.cells[r * resolution + c]?.depth ?? 0
  const topDepth = valueAt(r0, c0) * (1 - tx) + valueAt(r0, c1) * tx
  const bottomDepth = valueAt(r1, c0) * (1 - tx) + valueAt(r1, c1) * tx
  return topDepth * (1 - ty) + bottomDepth * ty
}

function createSurfaceMesh(targetGrid: InterpolationGrid): Cesium.Geometry {
  const resolution = Math.round(Math.sqrt(targetGrid.cells.length))
  const vertexResolution = resolution + 1
  const vertexCount = vertexResolution * vertexResolution
  const positions = new Float64Array(vertexCount * 3)
  const colors = new Uint8Array(vertexCount * 4)
  const indices = new Uint32Array(resolution * resolution * 6)
  const alpha = Math.round((surfaceOpacity.value / 100) * 255)
  const bounds = targetGrid.bounds
  const showDiff = showDifference.value && comparisonGrid !== null
  const diffMax = comparisonStats?.maxAbs ?? 1
  let vertexOffset = 0
  let colorOffset = 0

  for (let row = 0; row < vertexResolution; row += 1) {
    const y = row / resolution
    const lat = bounds.south + (bounds.north - bounds.south) * y
    for (let col = 0; col < vertexResolution; col += 1) {
      const x = col / resolution
      const lon = bounds.west + (bounds.east - bounds.west) * x
      const depth = sampleGridDepth(targetGrid, x, y)
      const position = Cesium.Cartesian3.fromDegrees(lon, lat, depthToHeight(depth))
      const difference = showDiff && comparisonGrid
        ? depth - sampleGridDepth(comparisonGrid, x, y)
        : 0
      const color = showDiff
        ? getDifferenceColor(difference, diffMax, alpha)
        : getColor(depth, targetGrid, alpha)
      positions[vertexOffset] = position.x
      positions[vertexOffset + 1] = position.y
      positions[vertexOffset + 2] = position.z
      colors[colorOffset] = floatToByte(color.red)
      colors[colorOffset + 1] = floatToByte(color.green)
      colors[colorOffset + 2] = floatToByte(color.blue)
      colors[colorOffset + 3] = floatToByte(color.alpha)
      vertexOffset += 3
      colorOffset += 4
    }
  }

  let indexOffset = 0
  for (let row = 0; row < resolution; row += 1) {
    for (let col = 0; col < resolution; col += 1) {
      const southwest = row * vertexResolution + col
      const southeast = southwest + 1
      const northwest = southwest + vertexResolution
      const northeast = northwest + 1
      indices[indexOffset] = southwest
      indices[indexOffset + 1] = southeast
      indices[indexOffset + 2] = northeast
      indices[indexOffset + 3] = southwest
      indices[indexOffset + 4] = northeast
      indices[indexOffset + 5] = northwest
      indexOffset += 6
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
    indices,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
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

function clearSurface(): void {
  if (!viewer || !surfacePrimitive) return
  viewer.scene.primitives.remove(surfacePrimitive)
  surfacePrimitive = undefined
}

function clearPoints(): void {
  if (!viewer || !pointCollection) return
  viewer.scene.primitives.remove(pointCollection)
  pointCollection = undefined
}

function drawSurface(): void {
  if (!viewer) return
  clearSurface()
  if (!showSurface.value || !grid?.cells?.length) {
    viewer.scene.requestRender()
    return
  }
  surfacePrimitive = viewer.scene.primitives.add(
    new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: createSurfaceMesh(grid)
      }),
      appearance: createSurfaceAppearance(),
      asynchronous: false,
      allowPicking: false
    })
  )
  viewer.scene.requestRender()
}

function drawPoints(): void {
  if (!viewer) return
  clearPoints()
  if (!showPoints.value || showDifference.value || !soundings?.length || !grid?.cells?.length) {
    viewer.scene.requestRender()
    return
  }
  const collection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection())
  pointCollection = collection
  for (const point of soundings) {
    collection.add({
      position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, depthToHeight(point.depth)),
      color: getColor(point.depth, grid, 235),
      outlineColor: Cesium.Color.WHITE.withAlpha(0.65),
      outlineWidth: 1,
      pixelSize: 5,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    })
  }
  viewer.scene.requestRender()
}

function drawScene(): void {
  if (!viewer) return
  if (viewer.scene.globe) viewer.scene.globe.depthTestAgainstTerrain = false
  drawSurface()
  drawPoints()
}

function updateMetrics(): void {
  gridCellsLabel.value = grid.cells.length.toLocaleString()
  gridMaxLabel.value = `${grid.max.toFixed(1)} m`
  gridMinLabel.value = `${grid.min.toFixed(1)} m`
}

function updateKrigingModelInfo(): void {
  const model = grid?.krigingModel
  krigingFittedRange.value = model ? `${(model.range / 1000).toFixed(2)} km` : '计算后显示'
  krigingModelType.value = model
    ? ({ spherical: '球状', exponential: '指数', gaussian: '高斯' } as Record<string, string>)[model.type] ?? model.type
    : '计算后显示'
}

function updateLegend(): void {
  if (showDifference.value && comparisonStats) {
    const range = `${comparisonStats.maxAbs.toFixed(2)} m`
    legendGradient.value = 'linear-gradient(90deg, rgb(45, 124, 181), rgb(245, 248, 250), rgb(211, 77, 69))'
    legendLeft.value = `−${range}`
    legendRight.value = `+${range}`
    return
  }
  legendGradient.value = paletteToGradient(palette.value, reversePalette.value)
  legendLeft.value = reversePalette.value ? '浅水' : '深水'
  legendRight.value = reversePalette.value ? '深水' : '浅水'
}

function updateComparisonInfo(): void {
  if (!showDifference.value) {
    comparisonInfo.value = '差值图关闭'
    return
  }
  if (method.value === comparisonMethod.value) {
    comparisonInfo.value = '当前方法与基准方法相同，差值为 0'
    return
  }
  if (!comparisonStats) {
    comparisonInfo.value = '正在计算差值统计…'
    return
  }
  const { mae, rmse, maxAbs } = comparisonStats
  comparisonInfo.value = `MAE ${mae.toFixed(3)} m · RMSE ${rmse.toFixed(3)} m · 最大差 ${maxAbs.toFixed(3)} m · 差值图已隐藏测点`
}

function getInterpolationOptions(): InterpolationOptions {
  return {
    idw: { power: idwPower.value, limit: idwLimit.value },
    kriging: { range: krigingRangeKm.value * 1000, limit: krigingLimit.value, nuggetRatio: krigingNugget.value },
    spline: { maxSamples: splineSamples.value, regularization: splineRegularization.value },
    natural: { limit: naturalLimit.value, expansion: naturalSoftness.value }
  }
}

function rebuildSurface(): void {
  grid = interpolateGrid(soundings, method.value, gridResolution.value, getInterpolationOptions())
  if (showDifference.value) {
    comparisonGrid = comparisonMethod.value === method.value
      ? grid
      : interpolateGrid(soundings, comparisonMethod.value, gridResolution.value, getInterpolationOptions())
    comparisonStats = calculateDifferenceStats(grid, comparisonGrid)
  } else {
    comparisonGrid = null
    comparisonStats = null
  }
  updateMetrics()
  updateKrigingModelInfo()
  updateComparisonInfo()
  updateLegend()
  drawScene()
}

function redrawScene(): void {
  drawScene()
}

async function runAnalysis(): Promise<void> {
  busy.value = true
  await new Promise((resolve) => requestAnimationFrame(resolve))
  await new Promise((resolve) => setTimeout(resolve, 40))
  try {
    await Promise.resolve()
    rebuildSurface()
  } finally {
    busy.value = false
  }
}

function regenerate(): void {
  soundings = createSoundings(pointCount.value)
  void runAnalysis()
}

function onMethodChange(): void {
  void runAnalysis()
}

function onGeneralRebuild(): void {
  void runAnalysis()
}

function onPaletteChange(): void {
  updateLegend()
  redrawScene()
}

function onShowSwitchChange(): void {
  redrawScene()
}

function onDifferenceChange(): void {
  void runAnalysis()
}

function initWaterScene(): void {
  if (disposed || !viewer || viewer.isDestroyed()) return
  statusMessage.value = ''

  viewer.scene.globe.depthTestAgainstTerrain = false
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(CENTER.lon, CENTER.lat, 26000),
    orientation: {
      heading: Cesium.Math.toRadians(16),
      pitch: Cesium.Math.toRadians(-48),
      roll: 0
    },
    duration: 0
  })

  soundings = createSoundings(pointCount.value)
  rebuildSurface()
  resultMessage.value = '水深点位三维插值分析已就绪'
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
    statusMessage.value = '正在加载Cesium World Terrain...'
    void loadWorldTerrain(viewer)
      .then(() => {
        if (disposed || !viewer || viewer.isDestroyed()) return
        initWaterScene()
      })
      .catch(() => {
        if (disposed || !viewer || viewer.isDestroyed()) return
        initWaterScene()
      })
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  clearSurface()
  clearPoints()
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="bathy-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="bathy-panel">
      <div class="panel-title">三维水深热力分析</div>
      <div class="panel-subtitle">模拟测深点 + 多维插值</div>

      <div class="section-title">插值方法</div>
      <select v-model="method" class="mode-select" aria-label="插值方法" @change="onMethodChange">
        <option v-for="item in interpolationMethods" :key="item.value" :value="item.value">{{ item.label }}</option>
      </select>

      <div class="section-title">方法参数</div>
      <div class="param-row"><span class="param-label">距离幂次</span><input v-model.number="idwPower" class="param-slider" type="range" min="1" max="4" step="0.1" @change="onGeneralRebuild" /><span class="param-value">{{ idwPower.toFixed(1) }}</span></div>
      <div class="param-row"><span class="param-label">邻近点数</span><input v-model.number="idwLimit" class="param-slider" type="range" min="20" max="160" step="10" @change="onGeneralRebuild" /><span class="param-value">{{ idwLimit }}</span></div>
      <div class="param-row"><span class="param-label">拟合滞后</span><input v-model.number="krigingRangeKm" class="param-slider" type="range" min="4" max="40" step="0.5" @change="onGeneralRebuild" /><span class="param-value">{{ krigingRangeKm.toFixed(1) }}km</span></div>
      <div class="param-row"><span class="param-label">样本数</span><input v-model.number="krigingLimit" class="param-slider" type="range" min="8" max="36" step="2" @change="onGeneralRebuild" /><span class="param-value">{{ krigingLimit }}</span></div>
      <div class="param-row"><span class="param-label">块金比例</span><input v-model.number="krigingNugget" class="param-slider" type="range" min="0" max="0.2" step="0.01" @change="onGeneralRebuild" /><span class="param-value">{{ krigingNugget.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">样条样本</span><input v-model.number="splineSamples" class="param-slider" type="range" min="12" max="48" step="4" @change="onGeneralRebuild" /><span class="param-value">{{ splineSamples }}</span></div>
      <div class="param-row"><span class="param-label">样条正则</span><input v-model.number="splineRegularization" class="param-slider" type="range" min="0" max="0.2" step="0.01" @change="onGeneralRebuild" /><span class="param-value">{{ splineRegularization.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">候选点数</span><input v-model.number="naturalLimit" class="param-slider" type="range" min="8" max="36" step="2" @change="onGeneralRebuild" /><span class="param-value">{{ naturalLimit }}</span></div>
      <div class="param-row"><span class="param-label">候选扩展</span><input v-model.number="naturalSoftness" class="param-slider" type="range" min="1" max="1.6" step="0.05" @change="onGeneralRebuild" /><span class="param-value">{{ naturalSoftness.toFixed(2) }}</span></div>

      <div class="section-title">分析参数</div>
      <div class="param-row"><span class="param-label">采样点数</span><input v-model.number="pointCount" class="param-slider" type="range" min="800" max="5200" step="200" @change="regenerate" /><span class="param-value">{{ pointCountLabel }}</span></div>
      <div class="param-row"><span class="param-label">网格密度</span><input v-model.number="gridResolution" class="param-slider" type="range" min="20" max="58" step="2" @change="onGeneralRebuild" /><span class="param-value">{{ gridResolution }}</span></div>
      <div class="param-row"><span class="param-label">下凹倍率</span><input v-model.number="heightScale" class="param-slider" type="range" min="20" max="95" step="5" @change="redrawScene" /><span class="param-value">{{ heightScale }}</span></div>
      <div class="param-row"><span class="param-label">透明度</span><input v-model.number="surfaceOpacity" class="param-slider" type="range" min="20" max="95" step="5" @change="redrawScene" /><span class="param-value">{{ surfaceOpacity }}%</span></div>

      <div class="toggle-row">
        <span class="toggle-label">显示点位</span>
        <button class="toggle" :class="{ on: showPoints }" aria-label="显示点位开关" @click="showPoints = !showPoints; onShowSwitchChange()"><i></i></button>
        <span class="toggle-label">显示插值面</span>
        <button class="toggle" :class="{ on: showSurface }" aria-label="显示插值面开关" @click="showSurface = !showSurface; onShowSwitchChange()"><i></i></button>
      </div>

      <div class="section-title">差值对比</div>
      <select v-model="comparisonMethod" class="mode-select" aria-label="差值图基准方法" @change="onDifferenceChange">
        <option v-for="item in interpolationMethods" :key="item.value" :value="item.value">{{ item.label }}</option>
      </select>
      <div class="toggle-row">
        <span class="toggle-label">差值图</span>
        <button class="toggle" :class="{ on: showDifference }" aria-label="差值图开关" @click="showDifference = !showDifference; onDifferenceChange()"><i></i></button>
      </div>
      <div v-if="comparisonInfo" class="comparison-info">{{ comparisonInfo }}</div>

      <div class="section-title">水深色带</div>
      <div class="legend-tools">
        <select v-model="palette" class="mode-select legend-select" aria-label="水深色带" @change="onPaletteChange">
          <option v-for="item in colorPalettes" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <button class="mini-toggle" :class="{ on: reversePalette }" aria-label="色带反转" @click="reversePalette = !reversePalette; onPaletteChange()">反转</button>
      </div>
      <div class="legend-bar" :style="{ background: legendGradient }"></div>
      <div class="legend-labels"><span>{{ legendLeft }}</span><span>{{ legendRight }}</span></div>

      <div class="metric-grid">
        <div><span>水深点</span><strong>{{ pointCountLabel }}</strong></div>
        <div><span>网格单元</span><strong>{{ gridCellsLabel }}</strong></div>
        <div><span>最浅</span><strong>{{ gridMaxLabel }}</strong></div>
        <div><span>最深</span><strong>{{ gridMinLabel }}</strong></div>
      </div>

      <button class="apply-button" @click="runAnalysis">重新分析</button>
      <div v-if="resultMessage" class="result-hint">{{ resultMessage }}</div>
    </div>

    <div v-if="busy" class="analysis-mask">
      <div class="loader-ring"></div>
      <strong>正在执行三维插值分析</strong>
      <span>正在重建水深网格与三维结果</span>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.bathy-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #061421; color: #e8fbff; font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif; }
.cesium-container { width: 100%; height: 100%; }
.bathy-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 7px; width: 258px; max-height: calc(100% - 24px); overflow-y: auto; padding: 11px; border: 1px solid rgba(91, 255, 226, 0.28); border-radius: 9px; background: rgba(8, 28, 43, 0.9); backdrop-filter: blur(6px); }
.panel-title { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
.panel-subtitle { font-size: 11px; color: #7da9b8; }
.section-title { margin-top: 4px; padding: 2px 0 1px; border-bottom: 1px solid rgba(91, 255, 226, 0.18); font-size: 11px; font-weight: 700; color: #5fffe0; }
.param-row { display: flex; align-items: center; gap: 8px; }.param-label { flex: 0 0 58px; font-size: 11px; color: #bdd9e4; }.param-slider { flex: 1; min-width: 0; height: 4px; accent-color: #5fffe0; }.param-value { flex: 0 0 46px; color: #9cc9d8; font-size: 10px; text-align: right; }
.mode-select { flex: 1; width: 100%; height: 24px; border: 1px solid rgba(91, 255, 226, 0.24); border-radius: 5px; background: rgba(13, 42, 58, 0.78); color: #d9eff6; font-size: 11px; }
.legend-select { flex: 1; }
.toggle-row { display: flex; align-items: center; gap: 8px; }
.toggle-label { font-size: 11px; color: #bdd9e4; }
.toggle { position: relative; width: 32px; height: 16px; padding: 0; border: 0; border-radius: 999px; background: rgba(125, 169, 184, 0.3); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #e8f8fb; transition: transform 0.2s; }
.toggle.on { background: #5fffe0; }.toggle.on i { transform: translateX(16px); }
.mini-toggle { height: 22px; padding: 0 10px; border: 1px solid rgba(91, 255, 226, 0.24); border-radius: 5px; background: rgba(13, 42, 58, 0.78); color: #7da9b8; font-size: 11px; cursor: pointer; }
.mini-toggle.on { color: #e8fbff; border-color: #5fffe0; }
.comparison-info { padding: 5px 7px; border-radius: 5px; background: rgba(13, 42, 58, 0.6); color: #7da9b8; font-size: 11px; line-height: 1.4; }
.legend-tools { display: flex; gap: 6px; align-items: center; }
.legend-bar { height: 10px; border-radius: 5px; border: 1px solid rgba(91, 255, 226, 0.25); }
.legend-labels { display: flex; justify-content: space-between; color: #7da9b8; font-size: 10px; }
.metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.metric-grid > div { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border: 1px solid rgba(54, 141, 255, 0.18); border-radius: 6px; background: rgba(13, 42, 58, 0.6); }
.metric-grid span { font-size: 10px; color: #7da9b8; }
.metric-grid strong { font-size: 12px; color: #e8fbff; }
.apply-button { height: 26px; border: 0; border-radius: 5px; background: #257f9e; color: #edfaff; cursor: pointer; font-size: 11px; }
.result-hint { padding: 6px 8px; border-radius: 5px; background: rgba(47, 157, 110, 0.16); color: #9fe6c4; font-size: 11px; line-height: 1.45; }
.analysis-mask { position: absolute; inset: 0; z-index: 20; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: rgba(4, 12, 20, 0.55); color: #e8fbff; }
.analysis-mask strong { font-size: 14px; }
.analysis-mask span { font-size: 12px; color: #7da9b8; }
.loader-ring { width: 44px; height: 44px; border: 3px solid rgba(95, 255, 224, 0.2); border-top-color: #5fffe0; border-radius: 50%; animation: bathy-spin 0.8s linear infinite; }
@keyframes bathy-spin { to { transform: rotate(360deg); } }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
