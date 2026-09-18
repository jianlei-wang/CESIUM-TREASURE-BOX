<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  HeightReference,
  Math as CesiumMath,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  loadWorldTerrain,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { pickCartographic } from '../measure-lib/pick'

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

type ProfilePoint = [number, number, number, number]

type SamplePoint = { lon: number; lat: number; cumDistM: number }

const container = ref<HTMLElement | null>(null)
const chartContainer = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const stepCount = ref(100)
const intervalM = ref(500)
const totalPoints = ref(200)
const samplingType = ref<'steps' | 'distance' | 'total'>('steps')
const analyzing = ref(false)
const maxHeight = ref(0)
const totalLength = ref(0)
const showChart = ref(false)
const drawing = ref(false)
const pathCount = ref(0)
const drawHint = ref('')

const DENSE_PER_SEGMENT = 500

const DEFAULT_PATH = [
  [90.5, 30.5],
  [91, 31],
  [91.5, 31.5],
  [90.5, 31.5]
] as [number, number][]

let viewer: Viewer | undefined
let chart: echarts.ECharts | undefined
let pathEntity: { id?: string } | undefined
let handler: ScreenSpaceEventHandler | undefined
let manualPath: [number, number][] = []
let previewEntity: { id?: string } | undefined

function haversineMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371008.8
  const dLat = CesiumMath.toRadians(lat2 - lat1)
  const dLon = CesiumMath.toRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(CesiumMath.toRadians(lat1)) * Math.cos(CesiumMath.toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return 2 * R * Math.asin(Math.sqrt(a))
}

function buildDenseSamples(path: [number, number][]): SamplePoint[] {
  const dense: SamplePoint[] = []
  let cum = 0
  dense.push({ lon: path[0][0], lat: path[0][1], cumDistM: 0 })
  for (let index = 0; index < path.length - 1; index++) {
    const sx = path[index][0]
    const sy = path[index][1]
    const ex = path[index + 1][0]
    const ey = path[index + 1][1]
    const segLen = haversineMeters(sx, sy, ex, ey)
    for (let i = 1; i <= DENSE_PER_SEGMENT; i++) {
      const t = i / DENSE_PER_SEGMENT
      dense.push({
        lon: CesiumMath.lerp(sx, ex, t),
        lat: CesiumMath.lerp(sy, ey, t),
        cumDistM: cum + segLen * t
      })
    }
    cum += segLen
  }
  return dense
}

function sampleAtTargets(dense: SamplePoint[], targets: number[]): SamplePoint[] {
  const result: SamplePoint[] = []
  let idx = 0
  for (const tgt of targets) {
    while (idx < dense.length - 1 && dense[idx + 1].cumDistM < tgt) idx++
    const a = dense[idx]
    const b = dense[idx + 1]
    const span = Math.max(b.cumDistM - a.cumDistM, 1e-9)
    const f = Math.min(Math.max((tgt - a.cumDistM) / span, 0), 1)
    result.push({
      lon: CesiumMath.lerp(a.lon, b.lon, f),
      lat: CesiumMath.lerp(a.lat, b.lat, f),
      cumDistM: tgt
    })
  }
  return result
}

function computeSamplePoints(path: [number, number][]): SamplePoint[] {
  const dense = buildDenseSamples(path)
  const totalLen = dense[dense.length - 1].cumDistM
  let targets: number[] = []

  if (samplingType.value === 'distance') {
    const n = Math.max(2, Math.floor(totalLen / intervalM.value))
    for (let k = 0; k <= n; k++) targets.push(k * intervalM.value)
  } else if (samplingType.value === 'total') {
    const n = Math.max(2, totalPoints.value)
    for (let k = 0; k < n; k++) targets.push((k * totalLen) / (n - 1))
  } else {
    let cum = 0
    for (let index = 0; index < path.length - 1; index++) {
      const sx = path[index][0]
      const sy = path[index][1]
      const ex = path[index + 1][0]
      const ey = path[index + 1][1]
      const segLen = haversineMeters(sx, sy, ex, ey)
      for (let i = 0; i <= stepCount.value; i++) {
        targets.push(cum + (segLen * i) / stepCount.value)
      }
      cum += segLen
    }
    targets = targets.filter((v, i) => i === 0 || v !== targets[i - 1])
  }

  return sampleAtTargets(dense, targets)
}

function initChart(points: ProfilePoint[]): void {
  if (!chartContainer.value) return
  if (!chart) {
    chart = echarts.init(chartContainer.value)
  }
  const distances: string[] = []
  const heights: number[] = []
  points.forEach((k) => {
    distances.push((k[3] / 1000).toFixed(2))
    heights.push(k[2])
  })
  chart.setOption({
    grid: { left: 40, right: 16, top: 24, bottom: 28 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      name: '距离 (km)',
      data: distances,
      axisLabel: { showMinLabel: true, showMaxLabel: true, interval: Math.max(1, Math.floor(distances.length / 6)) }
    },
    yAxis: {
      type: 'value',
      name: '高程 (m)',
      scale: true
    },
    series: [
      {
        data: heights,
        type: 'line',
        smooth: true,
        showSymbol: false,
        lineStyle: { color: '#2f80ed', width: 2 },
        areaStyle: { color: 'rgba(47, 128, 237, 0.35)' }
      }
    ]
  })
  chart.resize()
}

function activePath(): [number, number][] {
  return manualPath.length >= 2 ? manualPath : DEFAULT_PATH
}

function updatePathLine(path: [number, number][]): void {
  if (!viewer || viewer.isDestroyed()) return
  if (pathEntity?.id) viewer.entities.removeById(pathEntity.id)
  pathEntity = undefined
  const points = path.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat))
  pathEntity = viewer.entities.add({
    polyline: {
      positions: points,
      width: 3,
      material: Color.RED,
      clampToGround: true
    }
  }) as unknown as { id?: string }
}

function runProfile(): void {
  if (!viewer || viewer.isDestroyed() || analyzing.value) return
  analyzing.value = true
  showChart.value = false
  chart?.dispose()
  chart = undefined
  statusMessage.value = '正在采样地形高度并计算剖面…'

  setTimeout(async () => {
    if (!viewer || viewer.isDestroyed()) return
    const path = activePath()
    const samples = computeSamplePoints(path)
    const profile: ProfilePoint[] = []

    for (const sample of samples) {
      let height = 0
      try {
        const heightValue = viewer.scene.globe.getHeight(Cartographic.fromDegrees(sample.lon, sample.lat))
        height = heightValue ?? 0
      } catch {
        height = 0
      }
      profile.push([sample.lon, sample.lat, height, sample.cumDistM])
    }

    const heights = profile.map((k) => k[2])
    maxHeight.value = Math.round(Math.max(...heights))
    totalLength.value = profile.length > 0 ? Math.round(profile[profile.length - 1][3]) : 0

    showChart.value = true
    await nextTick()
    initChart(profile)
    analyzing.value = false
    statusMessage.value = ''
  }, 50)
}

function updateMarkers(path: [number, number][]): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.entities.removeById('profile-start')
  viewer.entities.removeById('profile-end')
  if (path.length < 2) return
  viewer.entities.add({
    id: 'profile-start',
    position: Cartesian3.fromDegrees(path[0][0], path[0][1]),
    point: {
      pixelSize: 8,
      color: Color.RED,
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: '起点',
      font: '12pt monospace',
      outlineWidth: 2,
      verticalOrigin: VerticalOrigin.TOP,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })
  viewer.entities.add({
    id: 'profile-end',
    position: Cartesian3.fromDegrees(path[path.length - 1][0], path[path.length - 1][1]),
    point: {
      pixelSize: 8,
      color: Color.RED,
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: '终点',
      font: '12pt monospace',
      outlineWidth: 2,
      verticalOrigin: VerticalOrigin.TOP,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })
}

function removePreview(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (previewEntity?.id) viewer.entities.removeById(previewEntity.id)
  previewEntity = undefined
}

function updatePreview(cursorPosition?: Cartesian3): void {
  if (!viewer || viewer.isDestroyed()) return
  removePreview()
  if (manualPath.length === 0) return
  const positions = manualPath.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat))
  if (cursorPosition) positions.push(cursorPosition)
  previewEntity = viewer.entities.add({
    polyline: {
      positions,
      width: 3,
      material: Color.YELLOW,
      clampToGround: true
    }
  }) as unknown as { id?: string }
}

function finishDrawing(): void {
  if (!drawing.value || !viewer || viewer.isDestroyed()) return
  drawing.value = false
  if (manualPath.length < 2) {
    manualPath = []
    pathCount.value = 0
    removePreview()
    drawHint.value = '剖面路径至少需要 2 个点'
    return
  }
  removePreview()
  updateMarkers(manualPath)
  updatePathLine(manualPath)
  drawHint.value = `剖面路径已确认（${manualPath.length} 个折点），可开始分析`
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !drawing.value) return
  const carto = pickCartographic(viewer.scene, event.position)
  if (!carto) return
  const lon = CesiumMath.toDegrees(carto.longitude)
  const lat = CesiumMath.toDegrees(carto.latitude)
  manualPath.push([lon, lat])
  pathCount.value = manualPath.length
  drawHint.value = `已采集 ${manualPath.length} 个折点，右键或双击结束`
  updatePreview()
  updateMarkers(manualPath)
}

function onMouseMove(event: { endPosition: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !drawing.value || manualPath.length === 0) return
  const carto = pickCartographic(viewer.scene, event.endPosition)
  if (!carto) return
  updatePreview(Cartesian3.fromDegrees(CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude)))
}

function startDrawing(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (drawing.value) {
    finishDrawing()
    return
  }
  manualPath = []
  pathCount.value = 0
  showChart.value = false
  drawing.value = true
  drawHint.value = '在地图上单击依次采集折点，右键或双击结束'
  updateMarkers([])
  if (pathEntity?.id) viewer.entities.removeById(pathEntity.id)
  pathEntity = undefined
}

onMounted(async () => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '正在加载地形…' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.scene.globe.maximumScreenSpaceError = 2
    statusMessage.value = '正在加载 Cesium World Terrain...'
    try {
      await loadWorldTerrain(viewer)
    } catch {
      statusMessage.value = '地形加载失败，已降级为全球椭球体。'
    }
    if (!viewer || viewer.isDestroyed()) return

    viewer.camera.flyTo({
      destination: new Rectangle(
        CesiumMath.toRadians(90),
        CesiumMath.toRadians(30),
        CesiumMath.toRadians(92),
        CesiumMath.toRadians(32)
      ),
      duration: 3
    })

    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)
    handler.setInputAction((event: { endPosition: Cartesian2 }) => onMouseMove(event), ScreenSpaceEventType.MOUSE_MOVE)
    handler.setInputAction(() => finishDrawing(), ScreenSpaceEventType.RIGHT_CLICK)
    handler.setInputAction(() => finishDrawing(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

    updateMarkers(activePath())
    updatePathLine(activePath())
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  handler?.destroy()
  handler = undefined
  if (viewer && !viewer.isDestroyed()) {
    removePreview()
    if (pathEntity?.id) viewer.entities.removeById(pathEntity.id)
    viewer.entities.removeById('profile-start')
    viewer.entities.removeById('profile-end')
  }
  pathEntity = undefined
  chart?.dispose()
  chart = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="profile-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">剖面分析</div>

      <div class="section-title">采样参数</div>
      <div class="control-row">
        <span class="row-label">采样方式</span>
        <select v-model="samplingType" class="sample-select" :disabled="analyzing">
          <option value="steps">每段步数</option>
          <option value="distance">固定间距</option>
          <option value="total">总采样点数</option>
        </select>
      </div>
      <div v-if="samplingType === 'steps'" class="control-row">
        <span class="row-label">每段步数</span>
        <input v-model.number="stepCount" type="range" min="20" max="300" step="10" :disabled="analyzing" />
        <span class="row-value">{{ stepCount }}</span>
      </div>
      <div v-else-if="samplingType === 'distance'" class="control-row">
        <span class="row-label">采样间距</span>
        <input v-model.number="intervalM" type="range" min="100" max="5000" step="100" :disabled="analyzing" />
        <span class="row-value">{{ intervalM }} m</span>
      </div>
      <div v-else class="control-row">
        <span class="row-label">采样点数</span>
        <input v-model.number="totalPoints" type="range" min="20" max="1000" step="20" :disabled="analyzing" />
        <span class="row-value">{{ totalPoints }}</span>
      </div>

      <button class="action-button primary" :disabled="analyzing || drawing" @click="runProfile">
        {{ analyzing ? '分析中…' : '开始分析' }}
      </button>
      <button class="action-button accent" :disabled="analyzing" @click="startDrawing">
        {{ drawing ? '结束绘制' : '绘制剖面路径' }}
      </button>

      <p v-if="drawing || drawHint" class="result">
        {{ drawing ? (pathCount === 0 ? '在地图上单击依次采集折点，右键或双击结束' : `已采集 ${pathCount} 个折点，右键或双击结束`) : drawHint }}
      </p>

      <p class="hint">
        <template v-if="showChart">
          剖面最高点 {{ maxHeight }} m；路线总长 {{ totalLength }} m
        </template>
        <template v-else>沿路径按所选采样方式插值采样真实地形高程，绘制高程剖面图。</template>
      </p>
      <p class="hint2">默认使用演示路径，也可点击「绘制剖面路径」在地图上绘制任意折线后分析。</p>
    </div>

    <div v-if="showChart" ref="chartContainer" class="chart-container chart-right"></div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.profile-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 268px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.chart-container { position: absolute; bottom: 12px; z-index: 10; width: min(560px, calc(100% - 24px)); height: 200px; padding: 8px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); box-sizing: border-box; }
.chart-right { left: auto; right: 12px; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 42px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.sample-select { flex: 1; min-width: 0; height: 24px; padding: 0 6px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 4px; background: #0e1c33; color: #dce8f5; font-size: 11px; }
.sample-select:disabled { opacity: 0.5; }
.action-button { width: 100%; height: 28px; margin-top: 10px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.action-button.accent { margin-top: 6px; background: #8a6d1a; color: #fff3d6; }
.action-button:disabled { opacity: 0.5; cursor: not-allowed; }
.result { margin: 10px 0 0; padding: 6px 8px; border-radius: 4px; font-size: 12px; font-weight: 700; background: rgba(250, 173, 20, 0.18); color: #ffd666; text-align: center; }
.hint { margin: 8px 0 0; font-size: 10px; color: #9fb8d4; line-height: 1.5; }
.hint2 { margin: 4px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
