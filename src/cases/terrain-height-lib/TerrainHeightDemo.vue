<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Color,
  Math as CesiumMath,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  SingleTileImageryProvider,
  type ImageryLayer,
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
import { terrainExtractors } from './extractors'
import { terrainMethodInfo } from './methodInfo'
import type { TerrainExtractResult, TerrainMethodId } from './types'
import {
  downloadBlob,
  downloadF32,
  downloadImageData,
  formatNumber,
  heightsToImageData,
  polygonToRectangle,
  rectangleToDegreesBounds
} from './grid'
import { encodeTerrainGeoTiff } from './geotiff'

const props = defineProps<{ methodId: TerrainMethodId }>()

const DEFAULT_RECT = Rectangle.fromDegrees(-119.64, 37.73, -119.59, 37.78)

const container = ref<HTMLElement | null>(null)
const previewCanvas = ref<HTMLCanvasElement | null>(null)
const statusMessage = ref('正在加载地图与地形…')
const extracting = ref(false)
const drawing = ref(false)
const polygonPoints = ref<Array<[number, number]>>([])
const regionHint = ref('默认使用 Yosemite 预设区域，绘制多边形后可选择掩膜或外接矩形提取。')
const regionMode = ref<'mask' | 'bbox'>('mask')

const gridSize = ref(128)
const tileLevel = ref(0)
const renderFrames = ref(2)
const cameraMargin = ref(2000)
const maxObjectHeight = ref(0)
const showOnGlobe = ref(false)
const overlayOpacity = ref(70)

const result = shallowRef<TerrainExtractResult | null>(null)
const info = terrainMethodInfo[props.methodId]
const needsRenderFrames = props.methodId === 'derived-shader' || props.methodId === 'pick-depth'
const needsMargin = props.methodId === 'derived-shader' || props.methodId === 'pick-depth'

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let outlineEntity: { id?: string } | undefined
let fillEntity: { id?: string } | undefined
let defaultEntity: { id?: string } | undefined
let onGlobeLayer: ImageryLayer | undefined

function removeEntity(entity: { id?: string } | undefined, fallbackId?: string): void {
  if (!viewer || viewer.isDestroyed()) return
  const id = entity?.id ?? fallbackId
  if (id) viewer.entities.removeById(id)
}

function activeRectangle(): Rectangle {
  return polygonToRectangle(polygonPoints.value) ?? DEFAULT_RECT
}

function updateRegionEntities(): void {
  if (!viewer || viewer.isDestroyed()) return
  removeEntity(outlineEntity, 'th-region-outline')
  removeEntity(fillEntity, 'th-region-fill')
  outlineEntity = undefined
  fillEntity = undefined
  if (defaultEntity?.id) viewer.entities.removeById(defaultEntity.id)
  defaultEntity = undefined
  const points = polygonPoints.value
  if (points.length < 2) {
    defaultEntity = viewer.entities.add({
      id: 'th-default-region',
      rectangle: {
        coordinates: DEFAULT_RECT,
        fill: false,
        outline: true,
        outlineColor: Color.ORANGE,
        outlineWidth: 2
      }
    }) as unknown as { id?: string }
    return
  }
  const flat: number[] = []
  for (const [lon, lat] of points) flat.push(lon, lat)
  const positions = Cartesian3.fromDegreesArray(flat)
  outlineEntity = viewer.entities.add({
    id: 'th-region-outline',
    polyline: {
      positions: points.length >= 3 ? [...positions, positions[0]] : positions,
      width: 3,
      material: drawing.value ? Color.YELLOW : Color.LIME,
      clampToGround: true
    }
  }) as unknown as { id?: string }
  if (points.length >= 3) {
    fillEntity = viewer.entities.add({
      id: 'th-region-fill',
      polygon: {
        hierarchy: positions,
        material: Color.fromCssColorString('rgba(47, 128, 237, 0.22)'),
        perPositionHeight: false
      }
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
  if (!viewer || viewer.isDestroyed()) return
  polygonPoints.value = []
  drawing.value = true
  showOnGlobe.value = false
  removeOnGlobe()
  regionHint.value = '在地图上单击依次采集多边形顶点，右键或双击结束。'
  updateRegionEntities()
}

function finishDraw(): void {
  drawing.value = false
  if (polygonPoints.value.length < 3) {
    polygonPoints.value = []
    regionHint.value = '多边形至少需要 3 个顶点，已重置为预设区域。'
  } else if (regionMode.value === 'mask') {
    regionHint.value = `已确认多边形（${polygonPoints.value.length} 个顶点），掩膜模式下区域外格子填 NaN。`
  } else {
    regionHint.value = `已确认多边形（${polygonPoints.value.length} 个顶点），外接矩形模式下提取整个外接矩形。`
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
  regionHint.value = '已重置为 Yosemite 预设区域。'
  updateRegionEntities()
}

function removeOnGlobe(): void {
  if (!viewer || viewer.isDestroyed() || !onGlobeLayer) return
  viewer.imageryLayers.remove(onGlobeLayer, true)
  onGlobeLayer = undefined
}

function applyOverlayAlpha(): void {
  if (onGlobeLayer) onGlobeLayer.alpha = Math.max(0, Math.min(1, overlayOpacity.value / 100))
}

function buildOverlayDataUrl(current: TerrainExtractResult): string {
  const image = heightsToImageData(current.heights, current.size, current.min, current.max, true)
  const canvas = document.createElement('canvas')
  canvas.width = current.size
  canvas.height = current.size
  canvas.getContext('2d')?.putImageData(image, 0, 0)
  return canvas.toDataURL()
}

function toggleOnGlobe(): void {
  if (!viewer || viewer.isDestroyed()) return
  removeOnGlobe()
  if (!showOnGlobe.value) return
  const current = result.value
  if (!current) return
  const provider = new SingleTileImageryProvider({
    url: buildOverlayDataUrl(current),
    rectangle: current.rectangle,
    tileWidth: current.size,
    tileHeight: current.size
  })
  onGlobeLayer = viewer.imageryLayers.addImageryProvider(provider)
  applyOverlayAlpha()
}

function renderPreview(): void {
  const current = result.value
  const canvas = previewCanvas.value
  if (!current || !canvas) return
  const image = heightsToImageData(current.heights, current.size, current.min, current.max)
  canvas.width = current.size
  canvas.height = current.size
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.putImageData(image, 0, 0)
}

watch(result, () => {
  showOnGlobe.value = false
  removeOnGlobe()
  requestAnimationFrame(renderPreview)
})

watch(overlayOpacity, () => {
  applyOverlayAlpha()
})

watch(regionMode, () => {
  if (polygonPoints.value.length >= 3) {
    regionHint.value = regionMode.value === 'mask'
      ? '已切换为掩膜模式，提取时多边形外填 NaN。'
      : '已切换为外接矩形模式，提取整个外接矩形。'
  }
})

async function extract(): Promise<void> {
  if (!viewer || viewer.isDestroyed() || extracting.value) return
  extracting.value = true
  result.value = null
  statusMessage.value = '准备提取…'
  try {
    const extractor = terrainExtractors[props.methodId]
    const hasPolygon = polygonPoints.value.length >= 3
    const useMask = regionMode.value === 'mask' && hasPolygon
    const res = await extractor.run(viewer, {
      rectangle: activeRectangle(),
      size: gridSize.value,
      polygon: useMask ? polygonPoints.value.map((p) => [...p] as [number, number]) : null,
      tileLevel: tileLevel.value,
      renderFrames: renderFrames.value,
      cameraMargin: cameraMargin.value,
      maxObjectHeight: maxObjectHeight.value,
      onProgress: (message) => {
        statusMessage.value = message
      }
    })
    result.value = res
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    extracting.value = false
  }
}

function exportPng(): void {
  const current = result.value
  if (!current) return
  const image = heightsToImageData(current.heights, current.size, current.min, current.max, true)
  downloadImageData(image, `${props.methodId}-height.png`)
}

function exportGeoTiff(): void {
  const current = result.value
  if (!current) return
  const buffer = encodeTerrainGeoTiff(current.heights, current.size, rectangleToDegreesBounds(current.rectangle))
  downloadBlob(new Blob([buffer], { type: 'image/tiff' }), `${props.methodId}-height.tif`)
}

function exportF32(): void {
  const current = result.value
  if (current) downloadF32(current.heights, `${props.methodId}-height.f32`)
}

function extraRows(current: TerrainExtractResult): Array<{ key: string; value: string }> {
  return Object.entries(current.extra).map(([key, value]) => ({ key, value: String(value) }))
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
    removeEntity(outlineEntity, 'th-region-outline')
    removeEntity(fillEntity, 'th-region-fill')
    if (defaultEntity?.id) viewer.entities.removeById(defaultEntity.id)
    removeOnGlobe()
  }
  outlineEntity = undefined
  fillEntity = undefined
  defaultEntity = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="th-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="th-panel">
      <div class="panel-title">{{ info.title }}</div>

      <details class="th-doc">
        <summary>技术说明</summary>
        <ul>
          <li v-for="(line, index) in info.tech" :key="index">{{ line }}</li>
        </ul>
      </details>

      <details class="th-doc">
        <summary>适用情况说明</summary>
        <ul>
          <li v-for="(line, index) in info.fit" :key="index">{{ line }}</li>
        </ul>
      </details>

      <div class="section-title">提取参数</div>
      <div class="control-row">
        <span class="row-label">区域模式</span>
        <select v-model="regionMode" class="th-select" :disabled="extracting">
          <option value="mask">多边形掩膜</option>
          <option value="bbox">外接矩形</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">网格大小</span>
        <input v-model.number="gridSize" type="range" min="16" max="256" step="16" :disabled="extracting" />
        <span class="row-value">{{ gridSize }}²</span>
      </div>
      <div v-if="methodId === 'terrain-mesh'" class="control-row">
        <span class="row-label">瓦片层级</span>
        <input v-model.number="tileLevel" type="range" min="0" max="16" step="1" :disabled="extracting" />
        <span class="row-value">{{ tileLevel === 0 ? '自动' : 'L' + tileLevel }}</span>
      </div>
      <div v-if="needsRenderFrames" class="control-row">
        <span class="row-label">顶视渲染帧</span>
        <input v-model.number="renderFrames" type="range" min="1" max="8" step="1" :disabled="extracting" />
        <span class="row-value">{{ renderFrames }}</span>
      </div>
      <div v-if="needsMargin" class="control-row">
        <span class="row-label">相机余量</span>
        <input v-model.number="cameraMargin" type="range" min="200" max="6000" step="200" :disabled="extracting" />
        <span class="row-value">{{ cameraMargin }} m</span>
      </div>
      <div v-if="methodId === 'pick-depth'" class="control-row">
        <span class="row-label">对象估计高度</span>
        <input v-model.number="maxObjectHeight" type="range" min="0" max="3000" step="100" :disabled="extracting" />
        <span class="row-value">{{ maxObjectHeight }} m</span>
      </div>

      <div class="btn-grid">
        <button class="action-button primary" :disabled="extracting" @click="extract">
          {{ extracting ? '提取中…' : '开始提取' }}
        </button>
        <button class="action-button accent" :disabled="extracting" @click="toggleDraw">
          {{ drawing ? '结束绘制' : '绘制多边形' }}
        </button>
        <button class="action-button ghost" :disabled="extracting || drawing" @click="clearRegion">清除区域</button>
      </div>

      <p class="hint">{{ regionHint }}</p>

      <template v-if="result">
        <div class="section-title">提取结果</div>
        <div class="stat-grid">
          <div class="stat"><span>耗时</span><b>{{ formatNumber(result.elapsedMs, 0) }} ms</b></div>
          <div class="stat"><span>高度范围</span><b>{{ formatNumber(result.min, 1) }} ~ {{ formatNumber(result.max, 1) }} m</b></div>
          <div class="stat"><span>有效 / 空洞</span><b>{{ result.validCount }} / {{ result.holeCount }}</b></div>
          <div class="stat"><span>掩膜（区域外）</span><b>{{ result.maskedCount }}</b></div>
          <div v-for="row in extraRows(result)" :key="row.key" class="stat">
            <span>{{ row.key }}</span><b>{{ row.value }}</b>
          </div>
        </div>
        <canvas ref="previewCanvas" class="preview"></canvas>
        <div class="scale-row">
          <span>{{ formatNumber(result.min, 0) }} m</span>
          <span class="scale-bar"></span>
          <span>{{ formatNumber(result.max, 0) }} m</span>
        </div>
        <label class="globe-toggle">
          <input v-model="showOnGlobe" type="checkbox" @change="toggleOnGlobe" />
          贴回地球（灰度叠底图）
        </label>
        <div v-if="showOnGlobe" class="control-row">
          <span class="row-label">叠加透明度</span>
          <input v-model.number="overlayOpacity" type="range" min="0" max="100" step="5" />
          <span class="row-value">{{ overlayOpacity }}%</span>
        </div>
        <div class="btn-grid">
          <button class="action-button small" @click="exportPng">导出 PNG</button>
          <button class="action-button small" @click="exportGeoTiff">导出 GeoTIFF</button>
          <button class="action-button small" @click="exportF32">导出 .f32</button>
        </div>
      </template>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.th-shell { position: relative; width: 100%; height: 100%; min-height: 360px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.th-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 296px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.88); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.th-doc { margin-bottom: 6px; border: 1px solid rgba(157, 188, 224, 0.2); border-radius: 6px; padding: 4px 8px; }
.th-doc summary { cursor: pointer; font-size: 11px; color: #9fd0ff; }
.th-doc ul { margin: 6px 0 2px; padding-left: 16px; }
.th-doc li { font-size: 10px; color: #b9cde3; line-height: 1.55; margin-bottom: 4px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 48px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.th-select { flex: 1; min-width: 0; height: 24px; padding: 0 6px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 4px; background: #0e1c33; color: #dce8f5; font-size: 11px; }
.btn-grid { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.action-button { flex: 1; min-width: 84px; height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.action-button.accent { background: #8a6d1a; color: #fff3d6; }
.action-button.ghost { background: #223a5e; color: #cfe0f2; }
.action-button.small { height: 26px; }
.action-button:disabled { opacity: 0.5; cursor: not-allowed; }
.hint { margin: 8px 0 0; font-size: 10px; color: #9fb8d4; line-height: 1.5; }
.stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.stat { display: flex; flex-direction: column; padding: 4px 6px; border-radius: 5px; background: rgba(255, 255, 255, 0.05); }
.stat span { font-size: 9px; color: #8ea5c2; }
.stat b { font-size: 11px; color: #eaf2fb; font-weight: 600; word-break: break-all; }
.preview { width: 100%; margin-top: 8px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 4px; image-rendering: pixelated; background: #000; }
.scale-row { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; font-size: 9px; color: #9fb8d4; }
.scale-bar { flex: 1; height: 6px; margin: 0 6px; border-radius: 3px; background: linear-gradient(90deg, #1c1c1c, #f4f4f4); }
.globe-toggle { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 10px; color: #c3d5e8; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 420px; padding: 8px 14px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.9); box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
