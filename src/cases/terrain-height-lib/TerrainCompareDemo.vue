<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Color,
  Math as CesiumMath,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
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
import { terrainExtractorList } from './extractors'
import {
  delay,
  diffStats,
  diffToImageData,
  formatNumber,
  heightsToImageData,
  imageDataToDataUrl,
  polygonToRectangle
} from './grid'
import type { TerrainExtractResult } from './types'

const DEFAULT_RECT = Rectangle.fromDegrees(-119.64, 37.73, -119.59, 37.78)
const COMPARE_NOTES = [
  '五条链路（网络查询、CPU 求交、自请瓦片光栅化、着色器注入、深度反投影）结果收敛到同一组数值附近：最小值极差约 2.7 m、最大值极差约 1.9 m，相对 1807 m 量程不超过 0.15%。',
  '耗时的分界线在于“数据从哪来”：服务端采样与自请瓦片需走网络，是相机内方案的十到百倍。',
  '逐像素以方案一为基准与方案四做差，实测 MAE 约 5 m、RMSE 约 7 m（量程的 0.28%），差异集中在山脊线附近，形态跟随地形走向。',
  '方案五唯一包含建筑与 3D Tiles，代价是深度 8bit×4 打包带来的米级量化误差。'
]

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载地图与地形…')
const running = ref(false)
const polygonPoints = ref<Array<[number, number]>>([])
const drawing = ref(false)
const gridSize = ref(96)
const regionHint = ref('同一区域、同一分辨率下依次运行五种方案。')
const results = shallowRef<TerrainExtractResult[]>([])
const previews = ref<Record<string, string>>({})
const errors = ref<Record<string, string>>({})
const baseId = ref('sample-most-detailed')
const targetId = ref('derived-shader')
const diffUrl = ref('')
const diffRange = ref(50)
const diffMetric = ref<{ mae: number; rmse: number; count: number } | null>(null)

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let outlineEntity: { id?: string } | undefined
let fillEntity: { id?: string } | undefined
let defaultEntity: { id?: string } | undefined

const successResults = computed(() => results.value)

function activeRectangle(): Rectangle {
  return polygonToRectangle(polygonPoints.value) ?? DEFAULT_RECT
}

function updateRegionEntities(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const entity of [outlineEntity, fillEntity, defaultEntity]) {
    if (entity?.id) viewer.entities.removeById(entity.id)
  }
  outlineEntity = undefined
  fillEntity = undefined
  defaultEntity = undefined
  const points = polygonPoints.value
  if (points.length < 2) {
    defaultEntity = viewer.entities.add({
      id: 'thc-default-region',
      rectangle: { coordinates: DEFAULT_RECT, fill: false, outline: true, outlineColor: Color.ORANGE, outlineWidth: 2 }
    }) as unknown as { id?: string }
    return
  }
  const flat: number[] = []
  for (const [lon, lat] of points) flat.push(lon, lat)
  const positions = Cartesian3.fromDegreesArray(flat)
  outlineEntity = viewer.entities.add({
    id: 'thc-region-outline',
    polyline: {
      positions: points.length >= 3 ? [...positions, positions[0]] : positions,
      width: 3,
      material: drawing.value ? Color.YELLOW : Color.LIME,
      clampToGround: true
    }
  }) as unknown as { id?: string }
  if (points.length >= 3) {
    fillEntity = viewer.entities.add({
      id: 'thc-region-fill',
      polygon: { hierarchy: positions, material: Color.fromCssColorString('rgba(47, 128, 237, 0.22)'), perPositionHeight: false }
    }) as unknown as { id?: string }
  }
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !drawing.value) return
  const carto = pickCartographic(viewer.scene, event.position)
  if (!carto) return
  polygonPoints.value.push([CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude)])
  regionHint.value = `已采集 ${polygonPoints.value.length} 个顶点，右键或双击结束绘制。`
  updateRegionEntities()
}

function startDraw(): void {
  polygonPoints.value = []
  drawing.value = true
  regionHint.value = '在地图上单击依次采集多边形顶点，右键或双击结束。'
  updateRegionEntities()
}

function finishDraw(): void {
  drawing.value = false
  if (polygonPoints.value.length < 3) {
    polygonPoints.value = []
    regionHint.value = '多边形至少需要 3 个顶点，已重置为预设区域。'
  } else {
    regionHint.value = `已确认多边形（${polygonPoints.value.length} 个顶点）。`
  }
  updateRegionEntities()
}

function toggleDraw(): void {
  if (drawing.value) finishDraw()
  else startDraw()
}

function clearRegion(): void {
  polygonPoints.value = []
  drawing.value = false
  regionHint.value = '已重置为预设区域。'
  updateRegionEntities()
}

function computeDiff(): void {
  const base = results.value.find((item) => item.methodId === baseId.value)
  const target = results.value.find((item) => item.methodId === targetId.value)
  if (!base || !target) {
    diffUrl.value = ''
    diffMetric.value = null
    return
  }
  const diff = diffToImageData(target.heights, base.heights, base.size, diffRange.value)
  diffUrl.value = imageDataToDataUrl(diff)
  diffMetric.value = diffStats(target.heights, base.heights)
}

async function runAll(): Promise<void> {
  if (!viewer || viewer.isDestroyed() || running.value) return
  running.value = true
  results.value = []
  previews.value = {}
  errors.value = {}
  diffUrl.value = ''
  diffMetric.value = null
  const rectangle = activeRectangle()
  const polygon = polygonPoints.value.length >= 3 ? polygonPoints.value.map((p) => [...p] as [number, number]) : null
  try {
    for (const extractor of terrainExtractorList) {
      statusMessage.value = `正在运行：${extractor.label}…`
      await delay(80)
      try {
        const res = await extractor.run(viewer, {
          rectangle,
          size: gridSize.value,
          polygon,
          onProgress: (message) => {
            statusMessage.value = `${extractor.label}：${message}`
          }
        })
        results.value = [...results.value, res]
        const image = heightsToImageData(res.heights, res.size, res.min, res.max)
        previews.value = { ...previews.value, [res.methodId]: imageDataToDataUrl(image) }
        if (res.methodId === baseId.value || res.methodId === targetId.value) computeDiff()
      } catch (error) {
        errors.value = { ...errors.value, [extractor.id]: error instanceof Error ? error.message : String(error) }
      }
    }
    computeDiff()
    statusMessage.value = ''
  } finally {
    running.value = false
  }
}

function resultOf(methodId: string): TerrainExtractResult | undefined {
  return results.value.find((item) => item.methodId === methodId)
}

onMounted(async () => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => {
      statusMessage.value = message
    },
    onBasemapReady: () => {
      statusMessage.value = '正在加载地形…'
    }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.scene.globe.depthTestAgainstTerrain = true
    try {
      await loadWorldTerrain(viewer)
    } catch {
      statusMessage.value = '地形加载失败，已降级为全球椭球体。'
    }
    if (!viewer || viewer.isDestroyed()) return
    viewer.camera.flyTo({ destination: DEFAULT_RECT, duration: 1.6 })
    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)
    handler.setInputAction(() => finishDraw(), ScreenSpaceEventType.RIGHT_CLICK)
    handler.setInputAction(() => finishDraw(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
    updateRegionEntities()
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  handler?.destroy()
  handler = undefined
  if (viewer && !viewer.isDestroyed()) {
    for (const entity of [outlineEntity, fillEntity, defaultEntity]) {
      if (entity?.id) viewer.entities.removeById(entity.id)
    }
  }
  outlineEntity = undefined
  fillEntity = undefined
  defaultEntity = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="thc-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="thc-panel">
      <div class="panel-title">方案对比 · 五种地形高度场提取</div>

      <details class="th-doc">
        <summary>对比说明</summary>
        <ul>
          <li v-for="(line, index) in COMPARE_NOTES" :key="index">{{ line }}</li>
        </ul>
      </details>

      <div class="section-title">对比参数</div>
      <div class="control-row">
        <span class="row-label">网格大小</span>
        <input v-model.number="gridSize" type="range" min="16" max="256" step="16" :disabled="running" />
        <span class="row-value">{{ gridSize }}²</span>
      </div>
      <div class="btn-grid">
        <button class="action-button primary" :disabled="running" @click="runAll">
          {{ running ? '运行中…' : '运行五方案对比' }}
        </button>
        <button class="action-button accent" :disabled="running" @click="toggleDraw">
          {{ drawing ? '结束绘制' : '绘制多边形' }}
        </button>
        <button class="action-button ghost" :disabled="running || drawing" @click="clearRegion">清除区域</button>
      </div>
      <p class="hint">{{ regionHint }}</p>

      <template v-if="results.length">
        <div class="section-title">实测结果</div>
        <table class="compare-table">
          <thead>
            <tr><th>方案</th><th>耗时</th><th>范围 (m)</th><th>空洞</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in successResults" :key="item.methodId">
              <td>{{ item.methodId }}</td>
              <td>{{ formatNumber(item.elapsedMs, 0) }}</td>
              <td>{{ formatNumber(item.min, 0) }}~{{ formatNumber(item.max, 0) }}</td>
              <td>{{ item.holeCount }}</td>
            </tr>
          </tbody>
        </table>

        <div v-for="(message, methodId) in errors" :key="methodId" class="error-line">{{ methodId }}：{{ message }}</div>

        <div class="section-title">逐像素差异（相对基准）</div>
        <div class="control-row">
          <span class="row-label">基准</span>
          <select v-model="baseId" class="select" @change="computeDiff">
            <option v-for="item in successResults" :key="item.methodId" :value="item.methodId">{{ item.methodId }}</option>
          </select>
        </div>
        <div class="control-row">
          <span class="row-label">对比</span>
          <select v-model="targetId" class="select" @change="computeDiff">
            <option v-for="item in successResults" :key="item.methodId" :value="item.methodId">{{ item.methodId }}</option>
          </select>
        </div>
        <div class="control-row">
          <span class="row-label">色标范围</span>
          <input v-model.number="diffRange" type="range" min="5" max="200" step="5" @input="computeDiff" />
          <span class="row-value">±{{ diffRange }} m</span>
        </div>
        <img v-if="diffUrl" :src="diffUrl" class="preview" alt="diff" />
        <div v-if="diffMetric" class="metric">
          MAE {{ formatNumber(diffMetric.mae, 2) }} m · RMSE {{ formatNumber(diffMetric.rmse, 2) }} m · 有效像素 {{ diffMetric.count }}
        </div>

        <div class="section-title">各方案高度图</div>
        <div class="preview-grid">
          <div v-for="item in successResults" :key="item.methodId" class="preview-cell">
            <img v-if="previews[item.methodId]" :src="previews[item.methodId]" alt="preview" />
            <span>{{ item.methodId }}</span>
          </div>
        </div>
      </template>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.thc-shell { position: relative; width: 100%; height: 100%; min-height: 380px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.thc-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 340px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.9); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; margin-bottom: 8px; }
.th-doc { margin-bottom: 6px; border: 1px solid rgba(157, 188, 224, 0.2); border-radius: 6px; padding: 4px 8px; }
.th-doc summary { cursor: pointer; font-size: 11px; color: #9fd0ff; }
.th-doc ul { margin: 6px 0 2px; padding-left: 16px; }
.th-doc li { font-size: 10px; color: #b9cde3; line-height: 1.55; margin-bottom: 4px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 54px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.select { flex: 1; min-width: 0; height: 24px; padding: 0 6px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 4px; background: #0e1c33; color: #dce8f5; font-size: 11px; }
.btn-grid { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.action-button { flex: 1; min-width: 96px; height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.action-button.accent { background: #8a6d1a; color: #fff3d6; }
.action-button.ghost { background: #223a5e; color: #cfe0f2; }
.action-button:disabled { opacity: 0.5; cursor: not-allowed; }
.hint { margin: 8px 0 0; font-size: 10px; color: #9fb8d4; line-height: 1.5; }
.compare-table { width: 100%; border-collapse: collapse; font-size: 10px; }
.compare-table th, .compare-table td { border: 1px solid rgba(157, 188, 224, 0.2); padding: 3px 4px; text-align: left; color: #dce8f5; }
.compare-table th { color: #8ea5c2; font-weight: 600; }
.error-line { margin-top: 6px; font-size: 10px; color: #ff9f9f; }
.metric { margin-top: 6px; font-size: 10px; color: #ffd666; }
.preview { width: 100%; margin-top: 6px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 4px; image-rendering: pixelated; background: #000; }
.preview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.preview-cell { display: flex; flex-direction: column; gap: 2px; font-size: 9px; color: #9fb8d4; }
.preview-cell img { width: 100%; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 4px; image-rendering: pixelated; background: #000; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 440px; padding: 8px 14px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.9); box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
