<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Cartesian2, Cartesian3, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium'
import InfoTip from '../../components/InfoTip.vue'
import { pickCartographic } from '../measure-lib/pick'
import { AnalysisScene } from './AnalysisScene'
import { areaKm2, cellSizeMeters, countMask, polygonMask } from './hydrology'
import { importDemFile } from './io'
import { boundsFromPolygon, gridFromBoundsMeters, sampleTerrainDem, RECOMMENDED_MAX_POINTS } from './terrain-sample'
import { renderRasterCanvas, legendFromStyle, formatNumber } from './raster'
import { exportPng, exportRasterGeoTiff, exportVectorShp, downloadText, buildGeoJson, type HydFeature } from './export'
import { createReportPdfUrl, exportReportPdf, type AnalysisReportModel, type ReportSection } from './report'
import type { DemData, LonLat } from './types'
import type { AnalysisLayer, AnalysisOutput, CaseProfile, ParamValue, RasterLayer, VectorLayer } from './workbench-types'

const props = defineProps<{ profile: CaseProfile }>()

const SAMPLE_VIEW = { lon: 101.85, lat: 29.55, altitude: 130000 }

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在初始化 Cesium 场景…')
const ready = ref(false)
const terrainReady = ref(false)
const busy = ref(false)
const busyLabel = ref('')
const sampleProgress = ref(0)

const dataSource = ref<'sample' | 'import'>('sample')
const sampleCellMeters = ref(90)
const heightScaleMin = ref(0)
const heightScaleMax = ref(2000)

const dem = ref<DemData | null>(null)
const regionPoints = ref<LonLat[]>([])
const drawing = ref(false)
const cursorPoint = ref<LonLat | null>(null)
const hasRegion = computed(() => regionPoints.value.length >= 3)

const params = reactive<Record<string, ParamValue>>({})
const renderStyle = reactive({ hillshade: 0.45, sunAzimuth: 315, sunAltitude: 45 })

const result = ref<AnalysisOutput | null>(null)
const selectedLayerId = ref('')
const rasterVisible = ref(true)
const layerVisibility = reactive<Record<string, boolean>>({})

const routeOpen = ref(false)
const confirmOpen = ref(false)
const confirmMessage = ref('')
let confirmResolve: ((ok: boolean) => void) | null = null
const reportOpen = ref(false)
const reportMode = ref<'paper' | 'pdf'>('paper')
const reportPdfUrl = ref('')
const pdfLoading = ref(false)
const reportPaper = ref<HTMLElement | null>(null)

let scene: AnalysisScene | null = null
let handler: ScreenSpaceEventHandler | null = null
let providersReady = false

function resetParams(): void {
  for (const def of props.profile.params) params[def.key] = def.default
}

function askConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    confirmMessage.value = message
    confirmResolve = resolve
    confirmOpen.value = true
  })
}

function answerConfirm(ok: boolean): void {
  confirmOpen.value = false
  const resolve = confirmResolve
  confirmResolve = null
  resolve?.(ok)
}

const paramGroups = computed(() => [{ label: '分析参数', items: props.profile.params }])

const outputLayers = computed<AnalysisLayer[]>(() => result.value?.layers ?? [])
const selectedLayer = computed<AnalysisLayer | null>(
  () => outputLayers.value.find((layer) => layer.id === selectedLayerId.value) ?? outputLayers.value[0] ?? null
)

function buildBaseCanvas(): HTMLCanvasElement | null {
  const current = dem.value
  if (!current) return null
  return renderRasterCanvas(current, current.values, {
    ramp: 'terrain',
    vmin: current.minHeight,
    vmax: current.maxHeight,
    hillshade: renderStyle.hillshade,
    sunAzimuth: renderStyle.sunAzimuth,
    sunAltitude: renderStyle.sunAltitude
  })
}

function buildLayerCanvas(layer: RasterLayer): HTMLCanvasElement | null {
  const current = dem.value
  if (!current) return null
  if (layer.values.length !== current.width * current.height) return null
  return renderRasterCanvas(current, layer.values, {
    ...layer.style,
    hillshade: layer.style.hillshade === undefined ? renderStyle.hillshade : layer.style.hillshade,
    sunAzimuth: renderStyle.sunAzimuth,
    sunAltitude: renderStyle.sunAltitude
  })
}

const baseCanvas = computed<HTMLCanvasElement | null>(() => buildBaseCanvas())
const selectedRasterCanvas = computed<HTMLCanvasElement | null>(() => {
  const layer = selectedLayer.value
  if (layer && layer.type === 'raster') return buildLayerCanvas(layer)
  return null
})
const activeCanvas = computed<HTMLCanvasElement | null>(() => selectedRasterCanvas.value ?? baseCanvas.value)

const legendView = computed(() => {
  const layer = selectedLayer.value
  if (!layer) return null
  return legendFromStyle(layer.type === 'raster' ? layer.style : {}, layer.type === 'raster' ? layer.legendLabels : [])
})

const legendItems = computed(() => {
  const layer = selectedLayer.value
  return layer && layer.type === 'vector' ? layer.legend : null
})

const vectorLayers = computed<VectorLayer[]>(
  () => outputLayers.value.filter((layer): layer is VectorLayer => layer.type === 'vector')
)

const demInfo = computed(() => {
  const current = dem.value
  if (!current) return null
  const { cellX, cellY } = cellSizeMeters(current.west, current.east, current.south, current.north, current.width, current.height)
  const cells = current.width * current.height
  return {
    source: current.source,
    grid: `${current.width} × ${current.height}`,
    cell: `约 ${Math.round(cellX)} m × ${Math.round(cellY)} m`,
    area: `${formatNumber(areaKm2(cells, cellX, cellY), 2)} km²`,
    relief: `${Math.round(current.minHeight)} ~ ${Math.round(current.maxHeight)} m`
  }
})

const regionArea = computed(() => {
  const current = dem.value
  if (!current || !hasRegion.value) return null
  const { cellX, cellY } = cellSizeMeters(current.west, current.east, current.south, current.north, current.width, current.height)
  const mask = buildMask()
  return `${formatNumber(areaKm2(countMask(mask), cellX, cellY), 2)} km²`
})

function buildMask(): Uint8Array {
  const current = dem.value
  if (!current) return new Uint8Array(0)
  if (!hasRegion.value) {
    const all = new Uint8Array(current.width * current.height)
    all.fill(1)
    return all
  }
  return polygonMask(current.width, current.height, current.west, current.east, current.south, current.north, regionPoints.value)
}

function setStatus(message: string): void {
  statusMessage.value = message
}

onMounted(async () => {
  if (!container.value) return
  resetParams()
  scene = new AnalysisScene(container.value, {
    onStatus: (message) => setStatus(message),
    onBasemapReady: () => setStatus('正在加载 Cesium World Terrain…')
  })
  scene.getViewer().camera.flyTo({
    destination: Cartesian3.fromDegrees(SAMPLE_VIEW.lon, SAMPLE_VIEW.lat, SAMPLE_VIEW.altitude),
    duration: 0
  })
  ready.value = true
  attachHandler()
  try {
    await scene.enableTerrain()
    providersReady = true
    terrainReady.value = true
    setStatus('真实地形已就绪，请绘制分析区域后采集真实地形，或直接导入 DEM 文件')
  } catch {
    setStatus('地形加载失败，已降级为全球椭球体，请改用“导入 DEM”方式加载高程数据')
  }
})

onBeforeUnmount(() => {
  handler?.destroy()
  handler = null
  scene?.dispose()
  scene = null
  if (reportPdfUrl.value) URL.revokeObjectURL(reportPdfUrl.value)
})

function attachHandler(): void {
  const viewer = scene?.getViewer()
  if (!viewer) return
  handler = new ScreenSpaceEventHandler(viewer.canvas)
  handler.setInputAction((movement: { position: Cartesian2 }) => {
    if (!drawing.value) return
    const carto = pickCartographic(viewer.scene, movement.position)
    if (!carto) return
    regionPoints.value = [...regionPoints.value, { lon: (carto.longitude * 180) / Math.PI, lat: (carto.latitude * 180) / Math.PI }]
    scene?.setRegion(regionPoints.value, false, cursorPoint.value)
  }, ScreenSpaceEventType.LEFT_CLICK)
  handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
    if (!drawing.value) return
    const carto = pickCartographic(viewer.scene, movement.endPosition)
    cursorPoint.value = carto
      ? { lon: (carto.longitude * 180) / Math.PI, lat: (carto.latitude * 180) / Math.PI }
      : null
    scene?.setRegion(regionPoints.value, false, cursorPoint.value)
  }, ScreenSpaceEventType.MOUSE_MOVE)
  handler.setInputAction(() => {
    if (!drawing.value) return
    finishDraw()
  }, ScreenSpaceEventType.RIGHT_CLICK)
  handler.setInputAction(() => {
    if (!drawing.value) return
    if (regionPoints.value.length > 1) regionPoints.value = regionPoints.value.slice(0, -1)
    finishDraw()
  }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
}

async function flyToDem(current: DemData): Promise<void> {
  scene?.setDem(current)
  scene?.flyToBounds(
    { west: current.west, east: current.east, south: current.south, north: current.north },
    current.maxHeight === current.minHeight ? current.maxHeight + 500 : current.maxHeight
  )
}

function clearResult(): void {
  result.value = null
  selectedLayerId.value = ''
  scene?.clearRaster()
  scene?.setVectors([])
}

async function runSample(): Promise<void> {
  if (!scene || !terrainReady.value || !providersReady) {
    setStatus('世界地形尚未就绪')
    return
  }
  if (!hasRegion.value) {
    setStatus('请先绘制至少 3 个顶点的分析区域')
    return
  }
  const bounds = boundsFromPolygon(regionPoints.value)
  if (!bounds) return
  const spec = gridFromBoundsMeters(bounds, sampleCellMeters.value)
  if (spec.points > RECOMMENDED_MAX_POINTS) {
    const proceed = await askConfirm(
      `采样点数量 ${spec.points} 超过建议值 ${RECOMMENDED_MAX_POINTS}，是否继续执行？`
    )
    if (!proceed) {
      setStatus(`已取消采样（采样点数量 ${spec.points}）`)
      return
    }
  }
  busy.value = true
  busyLabel.value = '正在采集真实地形…'
  sampleProgress.value = 0
  await nextTick()
  try {
    const provider = scene.getViewer().terrainProvider
    const current = await sampleTerrainDem(provider, bounds, { cellMeters: sampleCellMeters.value }, (done, total) => {
      sampleProgress.value = Math.round((done / total) * 100)
    })
    dem.value = current
    heightScaleMin.value = Math.round(current.minHeight)
    heightScaleMax.value = Math.round(current.maxHeight)
    clearResult()
    scene.setDem(current)
    scene.showRaster(buildBaseCanvas() as HTMLCanvasElement, current)
    scene.setRegion(regionPoints.value, true)
    setStatus(`已采集 ${current.source}`)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '真实地形采集失败，请缩小范围或改用导入 DEM')
  } finally {
    busy.value = false
    busyLabel.value = ''
    sampleProgress.value = 0
  }
}

function onImportChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !scene) return
  busy.value = true
  busyLabel.value = '正在解析 DEM 文件…'
  const center = { lon: 101.85, lat: 29.55 }
  importDemFile(file, {
    fallbackBounds: {
      west: center.lon - 0.16,
      east: center.lon + 0.16,
      south: center.lat - 0.16,
      north: center.lat + 0.16
    },
    minHeight: heightScaleMin.value,
    maxHeight: heightScaleMax.value
  })
    .then(async (current) => {
      dem.value = current
      heightScaleMin.value = Math.round(current.minHeight)
      heightScaleMax.value = Math.round(current.maxHeight)
      clearResult()
      regionPoints.value = []
      scene?.clearRegion()
      await flyToDem(current)
      scene?.showRaster(buildBaseCanvas() as HTMLCanvasElement, current)
      setStatus(`已导入 ${current.source}，范围按文件地理参考定位`)
    })
    .catch(() => setStatus('DEM 文件解析失败，请确认是 GeoTIFF 或灰度高度图'))
    .finally(() => {
      busy.value = false
      busyLabel.value = ''
    })
}

function startDraw(): void {
  drawing.value = true
  regionPoints.value = []
  cursorPoint.value = null
  scene?.clearRegion()
  const viewer = scene?.getViewer()
  if (viewer && !viewer.isDestroyed()) viewer.canvas.style.cursor = 'crosshair'
  setStatus('绘制中：左键添加顶点，右键结束绘制（双击也可）')
}

function finishDraw(): void {
  drawing.value = false
  cursorPoint.value = null
  const viewer = scene?.getViewer()
  if (viewer && !viewer.isDestroyed()) viewer.canvas.style.cursor = 'default'
  if (regionPoints.value.length >= 3) {
    scene?.setRegion(regionPoints.value, true)
    setStatus(`分析区域已确定（${regionPoints.value.length} 个顶点）`)
  } else {
    scene?.clearRegion()
    setStatus('顶点不足，已取消绘制')
  }
}

function clearDraw(): void {
  drawing.value = false
  cursorPoint.value = null
  regionPoints.value = []
  const viewer = scene?.getViewer()
  if (viewer && !viewer.isDestroyed()) viewer.canvas.style.cursor = 'default'
  scene?.clearRegion()
  setStatus('已清除分析区域')
}

function runAnalysis(): void {
  const current = dem.value
  if (!current) {
    setStatus('请先采集真实地形或导入 DEM')
    return
  }
  if (!hasRegion.value) {
    setStatus('请先绘制分析区域（多边形）')
    return
  }
  busy.value = true
  busyLabel.value = '正在执行空间分析…'
  try {
    const mask = buildMask()
    const output = props.profile.analyze({
      dem: current,
      mask,
      params: { ...params },
      renderStyle: { ...renderStyle }
    })
    result.value = output
    selectedLayerId.value = output.defaultLayerId || output.layers[0]?.id || ''
    rasterVisible.value = true
    for (const layer of output.layers) layerVisibility[layer.id] = true
    updateDisplay()
    setStatus(`分析完成，用时 ${formatNumber(output.timing.reduce((sum, item) => sum + item.value, 0), 0)} ms`)
  } finally {
    busy.value = false
    busyLabel.value = ''
  }
}

function updateDisplay(): void {
  if (!scene || !dem.value) return
  const canvas = activeCanvas.value
  if (canvas) scene.showRaster(canvas)
  scene.setRasterVisible(rasterVisible.value)
  const visibility: Record<string, boolean> = {}
  for (const layer of vectorLayers.value) visibility[layer.id] = layerVisibility[layer.id] !== false
  scene.setVectors(vectorLayers.value, visibility)
}

watch([() => dem.value, () => renderStyle.hillshade, () => renderStyle.sunAzimuth, () => renderStyle.sunAltitude], () => {
  updateDisplay()
})
watch([() => selectedLayerId.value, () => result.value], () => {
  updateDisplay()
})
watch(rasterVisible, () => scene?.setRasterVisible(rasterVisible.value))
watch(
  () => ({ ...layerVisibility }),
  () => updateDisplay()
)

function onLayerVisibilityChange(id: string, event: Event): void {
  layerVisibility[id] = (event.target as HTMLInputElement).checked
}

function setNumberParam(key: string, event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value)) params[key] = value
}

function setStringParam(key: string, event: Event): void {
  params[key] = (event.target as HTMLSelectElement).value
}

function setBooleanParam(key: string, event: Event): void {
  params[key] = (event.target as HTMLInputElement).checked
}

function setRenderNumber(key: 'hillshade' | 'sunAzimuth' | 'sunAltitude', event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  if (key === 'hillshade') renderStyle.hillshade = value
  else if (key === 'sunAzimuth') renderStyle.sunAzimuth = value
  else renderStyle.sunAltitude = value
}

function setSampleCell(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value)) sampleCellMeters.value = value
}

function setHeightScale(key: 'min' | 'max', event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  if (key === 'min') heightScaleMin.value = value
  else heightScaleMax.value = value
}

function setSelectedLayer(event: Event): void {
  selectedLayerId.value = (event.target as HTMLSelectElement).value
}

function setRasterVisible(event: Event): void {
  rasterVisible.value = (event.target as HTMLInputElement).checked
}

function rasterLayerOfSelected(): RasterLayer | null {
  const layer = selectedLayer.value
  return layer && layer.type === 'raster' ? layer : null
}

function vectorLayerOfSelected(): VectorLayer | null {
  const layer = selectedLayer.value
  return layer && layer.type === 'vector' ? layer : null
}

function geometryToKind(geometry: VectorLayer['geometry']): HydFeature['kind'] {
  if (geometry === 'polygon') return 'Polygon'
  if (geometry === 'point') return 'Point'
  return 'Line'
}

function exportSelectedRaster(): void {
  const layer = rasterLayerOfSelected()
  if (!layer || !dem.value) return
  exportRasterGeoTiff(dem.value, layer.values, `${props.profile.fileNamePrefix}-${layer.id}.tif`, `${props.profile.title} - ${layer.name}`)
}

function exportSelectedPng(): void {
  const canvas = activeCanvas.value
  if (!canvas) return
  exportPng(canvas, `${props.profile.fileNamePrefix}-${selectedLayer.value?.id ?? 'layer'}.png`)
}

function exportSelectedVector(): void {
  const layer = vectorLayerOfSelected()
  if (!layer) return
  const features: HydFeature[] = layer.features.map((feature) => ({
    kind: geometryToKind(layer.geometry),
    path: feature.path,
    attrs: feature.attrs
  }))
  if (features.length === 0) return
  exportVectorShp(`${props.profile.fileNamePrefix}-${layer.id}`, features)
}

function exportSelectedGeoJson(): void {
  const layer = vectorLayerOfSelected()
  if (!layer) return
  const features = layer.features.map((feature) => ({
    type: 'Feature' as const,
    properties: feature.attrs as Record<string, unknown>,
    geometry: {
      type: (layer.geometry === 'polygon' ? 'Polygon' : layer.geometry === 'point' ? 'Point' : 'LineString') as
        | 'Polygon'
        | 'Point'
        | 'LineString',
      coordinates: layer.geometry === 'polygon' ? [feature.path.map((p) => [p.lon, p.lat])] : feature.path.map((p) => [p.lon, p.lat])
    }
  }))
  downloadText(buildGeoJson(features, props.profile.fileNamePrefix), `${props.profile.fileNamePrefix}-${layer.id}.geojson`)
}

function buildReportModel(): AnalysisReportModel {
  const current = dem.value
  const output = result.value
  const layer = selectedLayer.value
  const sections: ReportSection[] = []
  if (!current || !output) {
    return { title: props.profile.reportTitle, generatedAt: new Date().toLocaleString(), intro: props.profile.intro, sections }
  }
  sections.push({
    title: '一、数据与范围',
    kv: [
      { label: 'DEM 来源', value: current.source },
      { label: '栅格规模', value: `${current.width} × ${current.height}` },
      { label: '地理范围', value: `${current.west.toFixed(4)}°E ~ ${current.east.toFixed(4)}°E，${current.south.toFixed(4)}°N ~ ${current.north.toFixed(4)}°N` },
      { label: '高程区间', value: `${Math.round(current.minHeight)} ~ ${Math.round(current.maxHeight)} m` },
      { label: '分析区域', value: hasRegion.value ? `${regionPoints.value.length} 个顶点，面积 ${regionArea.value ?? '—'}` : '全图范围' }
    ]
  })
  sections.push({
    title: '二、参数设置',
    kv: props.profile.params.map((def) => ({
      label: def.label,
      value: `${String(params[def.key])}${def.unit ?? ''}`
    }))
  })
  sections.push({
    title: '三、结果统计',
    kv: output.stats.map((item) => ({ label: item.label, value: item.value }))
  })
  sections.push({
    title: '四、结果说明',
    lines: [output.summary, ...output.conclusions]
  })
  const image = activeCanvas.value?.toDataURL('image/png')
  if (image) {
    sections.push({
      title: '五、结果图件',
      image: { src: image, caption: layer ? `${layer.name}：${layer.description}` : props.profile.title }
    })
  }
  sections.push({
    title: '六、技术路线',
    lines: props.profile.route.steps.map((step) => `${step.title}：${step.text}`)
  })
  sections.push({
    title: '七、计算耗时',
    kv: output.timing.map((item) => ({ label: item.label, value: `${formatNumber(item.value, 0)} ms` }))
  })
  return {
    title: props.profile.reportTitle,
    generatedAt: new Date().toLocaleString(),
    intro: props.profile.intro,
    sections
  }
}

const reportModel = ref<AnalysisReportModel | null>(null)

async function openReport(): Promise<void> {
  reportModel.value = buildReportModel()
  reportMode.value = 'paper'
  reportOpen.value = true
}

async function showPdf(): Promise<void> {
  if (!reportPaper.value) return
  pdfLoading.value = true
  try {
    if (reportPdfUrl.value) URL.revokeObjectURL(reportPdfUrl.value)
    reportPdfUrl.value = await createReportPdfUrl(reportPaper.value)
    reportMode.value = 'pdf'
  } finally {
    pdfLoading.value = false
  }
}

async function downloadPdf(): Promise<void> {
  if (!reportPaper.value) return
  pdfLoading.value = true
  try {
    await exportReportPdf(reportPaper.value, props.profile.fileNamePrefix)
  } finally {
    pdfLoading.value = false
  }
}
</script>

<template>
  <div class="workbench">
    <div ref="container" class="map" />

    <div class="panel left">
      <div class="section-title">1. DEM 数据</div>
      <div class="seg">
        <button :class="['seg-item', { active: dataSource === 'sample' }]" @click="dataSource = 'sample'">采集真实地形</button>
        <button :class="['seg-item', { active: dataSource === 'import' }]" @click="dataSource = 'import'">导入 DEM</button>
      </div>

      <template v-if="dataSource === 'sample'">
        <label class="field">
          <span class="field-label">
            采样间距（米）
            <InfoTip text="以米为单位的地面采样间距，决定 DEM 栅格分辨率。间距越小越精细，采样点与耗时越多；采样点数量超过建议值时将弹出确认提示，确认后可继续采样。" />
          </span>
          <input class="input" type="number" min="10" max="300" step="10" :value="sampleCellMeters" @input="setSampleCell" />
        </label>
        <p class="hint-text">先在地图上绘制分析区域，再点击“采集真实地形”。</p>
        <button class="btn primary block" :disabled="busy || !terrainReady" @click="runSample">采集真实地形</button>
      </template>

      <template v-else>
        <label class="field">
          <span class="field-label">高度映射下限（m）</span>
          <input class="input" type="number" :value="heightScaleMin" @input="setHeightScale('min', $event)" />
        </label>
        <label class="field">
          <span class="field-label">高度映射上限（m）</span>
          <input class="input" type="number" :value="heightScaleMax" @input="setHeightScale('max', $event)" />
        </label>
        <label class="field">
          <span class="field-label">选择 GeoTIFF / 高度图文件</span>
          <input class="input file" type="file" accept=".tif,.tiff,.png,.jpg,.jpeg" @change="onImportChange" />
        </label>
      </template>

      <div class="section-title">2. 分析区域</div>
      <div class="row gap">
        <button class="btn" :class="{ active: drawing }" @click="drawing ? finishDraw() : startDraw()">
          {{ drawing ? '完成绘制' : '绘制多边形' }}
        </button>
        <button class="btn" :disabled="regionPoints.length === 0" @click="clearDraw">清除</button>
      </div>
      <p class="hint-text">
        左键添加顶点，右键结束绘制。顶点：{{ regionPoints.length }}
        <template v-if="regionArea"> · 面积 {{ regionArea }}</template>
      </p>

      <div class="section-title">3. 参数设置</div>
      <template v-for="group in paramGroups" :key="group.label">
        <div v-for="def in group.items" :key="def.key" class="field">
          <span class="field-label">
            {{ def.label }}
            <InfoTip :title="def.label" :text="def.hint" />
          </span>

          <template v-if="def.kind === 'boolean'">
            <label class="switch">
              <input type="checkbox" :checked="params[def.key] === true" @change="setBooleanParam(def.key, $event)" />
              <span>{{ params[def.key] === true ? '开启' : '关闭' }}</span>
            </label>
          </template>

          <template v-else-if="def.kind === 'select'">
            <select class="input" :value="params[def.key]" @change="setStringParam(def.key, $event)">
              <option v-for="option in def.options" :key="String(option.value)" :value="option.value">{{ option.label }}</option>
            </select>
          </template>

          <template v-else-if="def.kind === 'slider'">
            <div class="slider-row">
              <input
                type="range"
                :min="def.min ?? 0"
                :max="def.max ?? 100"
                :step="def.step ?? 1"
                :value="params[def.key]"
                @input="setNumberParam(def.key, $event)"
              />
              <span class="slider-value">{{ params[def.key] }}{{ def.unit ?? '' }}</span>
            </div>
          </template>

          <template v-else>
            <input
              class="input"
              type="number"
              :min="def.min"
              :max="def.max"
              :step="def.step ?? 1"
              :value="params[def.key]"
              @input="setNumberParam(def.key, $event)"
            />
          </template>
        </div>
      </template>

      <button class="btn primary block run" :disabled="busy || !dem" @click="runAnalysis">运行分析</button>
    </div>

    <div class="panel right">
      <h1 class="title">{{ profile.title }}</h1>
      <p class="subtitle">{{ profile.intro }}</p>
      <div class="status">{{ busy ? busyLabel : statusMessage }}</div>
      <div v-if="busy && sampleProgress > 0" class="progress">
        <div class="progress-bar" :style="{ width: `${sampleProgress}%` }" />
      </div>
      <button class="btn block" :disabled="!result" @click="openReport">分析报告</button>

      <div class="panel-title-row">
        <span class="panel-title">显示与输出</span>
        <button class="route-info-btn" title="查看技术路线说明" @click="routeOpen = true">技术路线</button>
      </div>
      <label class="field">
        <span class="field-label">
          结果图层
          <InfoTip text="选择要查看的结果图层，底部图例与说明会同步更新。" />
        </span>
        <select class="input" :value="selectedLayerId" @change="setSelectedLayer">
          <option v-for="layer in outputLayers" :key="layer.id" :value="layer.id">{{ layer.name }}</option>
        </select>
      </label>

      <div v-for="layer in outputLayers" :key="layer.id" class="layer-toggle">
        <label class="switch">
          <input
            v-if="layer.type === 'vector'"
            type="checkbox"
            :checked="layerVisibility[layer.id] !== false"
            @change="onLayerVisibilityChange(layer.id, $event)"
          />
          <input v-else type="checkbox" :checked="rasterVisible" @change="setRasterVisible" />
          <span>{{ layer.type === 'vector' ? layer.name : '栅格底图' }}</span>
        </label>
      </div>

      <label class="field">
        <span class="field-label">
          晕渲强度
          <InfoTip text="结果栅格叠加地形明暗的强度，用于增强立体感，0 表示不叠加。" />
        </span>
        <div class="slider-row">
          <input type="range" min="0" max="1" step="0.05" :value="renderStyle.hillshade" @input="setRenderNumber('hillshade', $event)" />
          <span class="slider-value">{{ renderStyle.hillshade.toFixed(2) }}</span>
        </div>
      </label>
      <label class="field">
        <span class="field-label">
          太阳方位角
          <InfoTip text="晕渲光照方向，0° 为正北，顺时针增大。" />
        </span>
        <div class="slider-row">
          <input type="range" min="0" max="360" step="1" :value="renderStyle.sunAzimuth" @input="setRenderNumber('sunAzimuth', $event)" />
          <span class="slider-value">{{ renderStyle.sunAzimuth }}°</span>
        </div>
      </label>
      <label class="field">
        <span class="field-label">
          太阳高度角
          <InfoTip text="光照高度角，角度越低阴影越长、立体感越强。" />
        </span>
        <div class="slider-row">
          <input type="range" min="5" max="90" step="1" :value="renderStyle.sunAltitude" @input="setRenderNumber('sunAltitude', $event)" />
          <span class="slider-value">{{ renderStyle.sunAltitude }}°</span>
        </div>
      </label>

      <div class="section-title">结果导出</div>
      <template v-if="selectedLayer && selectedLayer.type === 'raster'">
        <button class="btn block" :disabled="!result" @click="exportSelectedRaster">导出 GeoTIFF</button>
        <button class="btn block" :disabled="!result" @click="exportSelectedPng">导出 PNG</button>
      </template>
      <template v-else-if="selectedLayer">
        <button class="btn block" :disabled="!result" @click="exportSelectedVector">导出 SHP（ZIP）</button>
        <button class="btn block" :disabled="!result" @click="exportSelectedGeoJson">导出 GeoJSON</button>
      </template>
      <p v-else class="hint-text">运行分析后可导出栅格或矢量结果</p>

      <div v-if="demInfo" class="dem-info">
        <div class="section-title">DEM 信息</div>
        <div class="kv"><span>来源</span><b>{{ demInfo.source }}</b></div>
        <div class="kv"><span>规模</span><b>{{ demInfo.grid }}</b></div>
        <div class="kv"><span>分辨率</span><b>{{ demInfo.cell }}</b></div>
        <div class="kv"><span>面积</span><b>{{ demInfo.area }}</b></div>
        <div class="kv"><span>高程</span><b>{{ demInfo.relief }}</b></div>
      </div>
    </div>

    <div v-if="result" class="result-panel">
      <div class="result-head">
        <b>{{ profile.summaryTitle }}</b>
        <span class="result-layer">{{ selectedLayer?.name }}</span>
      </div>
      <div class="legend">
        <div v-if="legendView?.ramp" class="legend-ramp">
          <div class="ramp-bar" :style="{ background: legendView.ramp }" />
          <div class="ramp-labels">
            <span v-for="(label, index) in legendView.rampLabels" :key="index">{{ label }}</span>
          </div>
        </div>
        <div v-else-if="legendView?.items" class="legend-items">
          <span v-for="(item, index) in legendView.items" :key="index" class="legend-item">
            <i :style="{ background: item.color }" />{{ item.label }}
          </span>
        </div>
        <div v-if="legendItems" class="legend-items">
          <span v-for="(item, index) in legendItems" :key="index" class="legend-item">
            <i :style="{ background: item.color }" />{{ item.label }}
          </span>
        </div>
      </div>
      <p class="result-summary">{{ selectedLayer?.description }}</p>
      <p class="result-summary">{{ result.summary }}</p>
      <ul class="result-conclusions">
        <li v-for="(line, index) in result.conclusions" :key="index">{{ line }}</li>
      </ul>
      <div class="result-stats">
        <span v-for="item in result.stats" :key="item.label" class="stat"><em>{{ item.label }}</em>{{ item.value }}</span>
      </div>
    </div>

    <div v-if="routeOpen" class="route-overlay" @click.self="routeOpen = false">
      <div class="route-modal">
        <div class="route-head">
          <span class="route-title">{{ profile.route.title }}</span>
          <button class="route-close" title="关闭" @click="routeOpen = false">×</button>
        </div>
        <div class="route-body">
          <p class="route-intro">{{ profile.route.intro }}</p>
          <div v-for="(step, index) in profile.route.steps" :key="index" class="route-step">
            <div class="route-step-title">{{ step.title }}</div>
            <p class="route-text">{{ step.text }}</p>
          </div>
        </div>
      </div>
    </div>

    <div v-if="confirmOpen" class="modal-mask" @click.self="answerConfirm(false)">
      <div class="modal confirm-modal">
        <div class="modal-head">
          <b>采样点数提示</b>
        </div>
        <p class="confirm-message">{{ confirmMessage }}</p>
        <div class="confirm-actions">
          <button class="btn small" @click="answerConfirm(false)">取消</button>
          <button class="btn small primary" @click="answerConfirm(true)">继续执行</button>
        </div>
      </div>
    </div>

    <div v-if="reportOpen" class="modal-mask" @click.self="reportOpen = false">
      <div class="modal report-modal">
        <div class="modal-head">
          <b>分析报告</b>
          <div class="row gap">
            <button class="btn small" :class="{ active: reportMode === 'paper' }" @click="reportMode = 'paper'">网页预览</button>
            <button class="btn small" :class="{ active: reportMode === 'pdf' }" :disabled="pdfLoading" @click="showPdf">PDF 预览</button>
            <button class="btn small primary" :disabled="pdfLoading" @click="downloadPdf">导出 PDF</button>
            <button class="btn small" @click="reportOpen = false">关闭</button>
          </div>
        </div>
        <div v-if="reportMode === 'paper'" ref="reportPaper" class="report-paper">
          <h2 class="report-title">{{ reportModel?.title }}</h2>
          <p class="report-meta">生成时间：{{ reportModel?.generatedAt }}</p>
          <p class="report-intro">{{ reportModel?.intro }}</p>
          <section v-for="(section, index) in reportModel?.sections ?? []" :key="index" class="report-section">
            <h3>{{ section.title }}</h3>
            <div v-if="section.kv" class="report-kv">
              <div v-for="item in section.kv" :key="item.label"><span>{{ item.label }}</span><b>{{ item.value }}</b></div>
            </div>
            <ul v-if="section.lines"><li v-for="(line, i) in section.lines" :key="i">{{ line }}</li></ul>
            <figure v-if="section.image">
              <img :src="section.image.src" :alt="section.image.caption" />
              <figcaption>{{ section.image.caption }}</figcaption>
            </figure>
          </section>
        </div>
        <iframe v-else :src="reportPdfUrl" class="report-frame" title="PDF 预览" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.workbench {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
  border-radius: 8px;
  background: #152b4c;
  color: #dcecf5;
  font-size: 12px;
}

.map {
  position: absolute;
  inset: 0;
}

.panel {
  position: absolute;
  z-index: 20;
  padding: 12px;
  border: 1px solid rgba(120, 190, 220, 0.24);
  border-radius: 10px;
  background: rgba(8, 20, 33, 0.86);
  backdrop-filter: blur(6px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
}

.panel.left {
  top: 12px;
  left: 12px;
  bottom: 12px;
  width: 286px;
  overflow-y: auto;
}

.panel.right {
  top: 12px;
  right: 12px;
  bottom: 12px;
  width: 300px;
  overflow-y: auto;
}

.title {
  margin: 0 0 6px;
  font-size: 15px;
  color: #eaf7ff;
}

.subtitle {
  margin: 0 0 8px;
  color: #9dc3d8;
  line-height: 1.5;
}

.status {
  margin-bottom: 8px;
  color: #7fd8f5;
  line-height: 1.5;
}

.progress {
  height: 5px;
  margin-bottom: 8px;
  border-radius: 3px;
  background: rgba(120, 180, 210, 0.2);
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #49b6ff, #7ff5d8);
  transition: width 0.2s;
}

.section-title {
  margin: 12px 0 6px;
  padding-top: 8px;
  border-top: 1px solid rgba(120, 190, 220, 0.16);
  color: #7fd8f5;
  font-weight: 700;
}

.section-title:first-child {
  margin-top: 0;
  border-top: none;
  padding-top: 0;
}

.field {
  display: block;
  margin-bottom: 8px;
}

.field-label {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
  color: #a9cddd;
}

.input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 7px;
  border: 1px solid rgba(120, 190, 220, 0.3);
  border-radius: 6px;
  background: rgba(4, 14, 24, 0.9);
  color: #e6f6ff;
  font-size: 12px;
}

.input.file {
  padding: 4px;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.slider-row input[type='range'] {
  flex: 1;
  accent-color: #49b6ff;
}

.slider-value {
  min-width: 44px;
  text-align: right;
  color: #8fe3ff;
}

.switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.layer-toggle {
  margin-bottom: 6px;
}

.seg {
  display: flex;
  margin-bottom: 8px;
  border: 1px solid rgba(120, 190, 220, 0.24);
  border-radius: 7px;
  overflow: hidden;
}

.seg-item {
  flex: 1;
  padding: 6px 4px;
  border: none;
  background: transparent;
  color: #9dc3d8;
  font-size: 11px;
  cursor: pointer;
}

.seg-item.active {
  background: rgba(73, 182, 255, 0.22);
  color: #eaf7ff;
}

.btn {
  padding: 6px 10px;
  border: 1px solid rgba(120, 190, 220, 0.35);
  border-radius: 6px;
  background: rgba(20, 45, 68, 0.8);
  color: #dcecf5;
  font-size: 12px;
  cursor: pointer;
}

.btn:hover:not(:disabled) {
  border-color: #7fd8f5;
  color: #eaf7ff;
}

.btn.active,
.btn.primary {
  background: linear-gradient(90deg, rgba(73, 182, 255, 0.5), rgba(73, 182, 255, 0.24));
  border-color: #49b6ff;
  color: #eaf7ff;
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn.block {
  display: block;
  width: 100%;
  margin-bottom: 6px;
}

.btn.small {
  padding: 4px 8px;
  font-size: 11px;
}

.btn.run {
  margin-top: 10px;
  padding: 8px;
  font-weight: 700;
}

.row {
  display: flex;
}

.row.gap {
  gap: 8px;
}

.hint-text {
  margin: 4px 0;
  color: #7fa6ba;
  line-height: 1.5;
}

.dem-info {
  margin-top: 10px;
}

.kv {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.kv span {
  color: #7fa6ba;
}

.kv b {
  color: #cfe9f5;
  font-weight: 500;
  text-align: right;
  word-break: break-all;
}

.result-panel {
  position: absolute;
  left: 50%;
  bottom: 14px;
  z-index: 25;
  width: min(780px, calc(100% - 660px));
  min-width: 420px;
  transform: translateX(-50%);
  padding: 12px 16px;
  border: 1px solid rgba(120, 190, 220, 0.28);
  border-radius: 10px;
  background: rgba(8, 20, 33, 0.9);
  backdrop-filter: blur(6px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
}

.result-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  color: #eaf7ff;
}

.result-layer {
  color: #7fd8f5;
}

.legend {
  margin: 8px 0;
}

.ramp-bar {
  height: 10px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.ramp-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 3px;
  color: #a9cddd;
}

.legend-items {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #cfe9f5;
}

.legend-item i {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.result-summary {
  margin: 6px 0 0;
  color: #cfe9f5;
  line-height: 1.6;
}

.result-conclusions {
  margin: 6px 0 0;
  padding-left: 18px;
  color: #a9cddd;
  line-height: 1.6;
}

.result-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: 8px;
}

.stat {
  color: #dcecf5;
}

.stat em {
  margin-right: 4px;
  color: #7fa6ba;
  font-style: normal;
}

.modal-mask {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(2, 8, 14, 0.62);
}

.modal {
  width: min(680px, calc(100% - 40px));
  max-height: calc(100% - 40px);
  overflow-y: auto;
  padding: 16px 18px;
  border: 1px solid rgba(120, 190, 220, 0.3);
  border-radius: 12px;
  background: rgba(8, 20, 33, 0.97);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
}

.report-modal {
  width: min(900px, calc(100% - 40px));
  height: calc(100% - 40px);
  display: flex;
  flex-direction: column;
}

.confirm-modal {
  width: min(420px, calc(100% - 40px));
}

.confirm-message {
  margin: 4px 0 16px;
  color: #cfe6f2;
  font-size: 13px;
  line-height: 1.6;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  color: #eaf7ff;
  font-size: 14px;
}

.panel-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.panel-title {
  font-size: 12px;
  font-weight: 700;
  color: #eaf7ff;
  letter-spacing: 0.04em;
}

.route-info-btn {
  flex: 0 0 auto;
  min-height: 22px;
  padding: 0 9px;
  border: 1px solid rgba(255, 199, 92, 0.55);
  border-radius: 11px;
  background: rgba(255, 199, 92, 0.16);
  color: #ffd666;
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
}

.route-info-btn:hover {
  background: rgba(255, 199, 92, 0.32);
}

.route-overlay {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 26px;
  box-sizing: border-box;
  background: rgba(4, 13, 26, 0.6);
  backdrop-filter: blur(2px);
}

.route-modal {
  display: flex;
  flex-direction: column;
  width: min(560px, 92%);
  max-height: 88%;
  padding: 14px 16px;
  box-sizing: border-box;
  border: 1px solid rgba(255, 199, 92, 0.5);
  border-radius: 10px;
  background: rgba(8, 20, 33, 0.97);
  box-shadow: 0 10px 36px rgba(0, 0, 0, 0.45);
  color: #e3f2f8;
}

.route-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 199, 92, 0.28);
}

.route-title {
  font-size: 13px;
  font-weight: 700;
  color: #ffd666;
}

.route-close {
  border: 0;
  background: transparent;
  color: #ffd666;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.route-body {
  display: flex;
  flex-direction: column;
  gap: 9px;
  overflow-y: auto;
  padding: 10px 2px 2px;
}

.route-intro {
  margin: 0;
  font-size: 11px;
  line-height: 1.7;
  color: #bfe0ee;
}

.route-step {
  padding: 8px 10px;
  border: 1px solid rgba(137, 210, 233, 0.16);
  border-radius: 7px;
  background: rgba(21, 48, 78, 0.35);
}

.route-step-title {
  font-size: 11px;
  font-weight: 700;
  color: #7fd0e6;
}

.route-text {
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.75;
  color: #c7dce8;
}

.report-paper {
  flex: 1;
  overflow-y: auto;
  padding: 26px 30px;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2933;
}

.report-title {
  margin: 0 0 4px;
  font-size: 20px;
  text-align: center;
  color: #10222f;
}

.report-meta {
  margin: 0 0 12px;
  text-align: center;
  color: #667;
  font-size: 12px;
}

.report-intro {
  line-height: 1.7;
}

.report-section {
  margin-top: 16px;
}

.report-section h3 {
  margin: 0 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid #d8e2ea;
  font-size: 15px;
  color: #14425e;
}

.report-kv > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 3px 0;
  border-bottom: 1px dashed #e6edf2;
}

.report-kv span {
  color: #5a6b78;
}

.report-kv b {
  color: #1f2933;
  font-weight: 500;
  text-align: right;
}

.report-section ul {
  margin: 6px 0 0;
  padding-left: 20px;
  line-height: 1.75;
}

.report-section figure {
  margin: 10px 0 0;
}

.report-section img {
  width: 100%;
  border: 1px solid #d8e2ea;
  border-radius: 6px;
}

.report-section figcaption {
  margin-top: 5px;
  text-align: center;
  color: #667;
  font-size: 12px;
}

.report-frame {
  flex: 1;
  width: 100%;
  border: none;
  border-radius: 8px;
  background: #fff;
}
</style>
