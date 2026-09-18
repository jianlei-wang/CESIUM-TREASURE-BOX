<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import {
  GeoJsonDataSource,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, loadWorldTerrain } from '../../lib/cesium-scene'
import { CRS_LIST } from '../vector-converter-lib/crs'
import { VECTOR_CONVERTER_HELP } from '../vector-converter-lib/help'
import { detectFormat, parseFile } from '../vector-converter-lib/parse'
import { downloadBlob, serializeModel, serializePointTable } from '../vector-converter-lib/serialize'
import type { CRSId, FormatId, VectorModel } from '../vector-converter-lib/types'

type ExportFormat = Exclude<FormatId, 'ovobj'>

const FORMAT_LABELS: Record<FormatId, string> = {
  geojson: 'GeoJSON',
  kml: 'KML',
  kmz: 'KMZ',
  ovkml: '奥维 OVKML',
  ovkmz: '奥维 OVKMZ',
  ovjsn: '奥维 OVJSN',
  ovobj: '奥维 OVOBJ',
  gpx: 'GPX',
  wkt: 'WKT',
  csv: 'CSV 表格',
  shp: 'Shapefile'
}

const EXPORT_FORMATS: ExportFormat[] = ['geojson', 'kml', 'kmz', 'ovkml', 'ovkmz', 'ovjsn', 'gpx', 'wkt', 'csv', 'shp']

const container = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const viewer = shallowRef<Viewer | undefined>()
const isLoaded = ref(false)
const isParsing = ref(false)
const helpOpen = ref(false)
const activeHelpKey = ref<string | undefined>(VECTOR_CONVERTER_HELP[0]?.key)

const fileName = ref('')
const detectedFormat = ref<FormatId>('geojson')
const sourceCrs = ref<CRSId>('wgs84')
const targetFormat = ref<ExportFormat>('geojson')
const targetCrs = ref<CRSId>('wgs84')
const baseName = ref('')

const model = shallowRef<VectorModel | undefined>()
const warnings = ref<string[]>([])
const errorMessage = ref('')
const statusMessage = ref('正在加载地图…')

let dataSource: GeoJsonDataSource | undefined
let renderSeq = 0
let selectedFile: File | undefined

const featureStats = computed(() => {
  const features = model.value?.features ?? []
  let point = 0
  let line = 0
  let polygon = 0
  for (const f of features) {
    const t = f.geometry.type
    if (t === 'Point' || t === 'MultiPoint') point += 1
    else if (t === 'LineString' || t === 'MultiLineString') line += 1
    else polygon += 1
  }
  return { total: features.length, point, line, polygon }
})

const groupCount = computed(() => model.value?.metadata.groupTree.length ?? 0)
const hasPoints = computed(() => featureStats.value.point > 0)
const sourceCrsLabel = computed(() => CRS_LIST.find((c) => c.id === sourceCrs.value)?.label ?? '')
const targetCrsLabel = computed(() => CRS_LIST.find((c) => c.id === targetCrs.value)?.label ?? '')

function suggestBaseName(name: string): string {
  const dot = name.lastIndexOf('.')
  return (dot > 0 ? name.slice(0, dot) : name) || 'vector-output'
}

function defaultSourceCrs(format: FormatId): CRSId {
  if (format === 'ovkml' || format === 'ovkmz' || format === 'ovjsn' || format === 'ovobj') return 'gcj02'
  return 'wgs84'
}

function modelToGeoJson(source: VectorModel): object {
  return {
    type: 'FeatureCollection',
    features: source.features.map((f) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        ...f.properties,
        ...(f.groupPath && f.groupPath.length > 0 ? { groupPath: f.groupPath.join('/') } : {})
      }
    }))
  }
}

async function renderModel(): Promise<void> {
  const current = viewer.value
  const source = model.value
  if (!current || current.isDestroyed() || !source) return
  const seq = ++renderSeq
  if (dataSource) {
    current.dataSources.remove(dataSource, true)
    dataSource = undefined
  }
  const loaded = await GeoJsonDataSource.load(modelToGeoJson(source) as object, {
    clampToGround: true,
    strokeWidth: 2
  })
  if (seq !== renderSeq || current.isDestroyed()) return
  dataSource = loaded
  await current.dataSources.add(loaded)
  await current.zoomTo(loaded)
}

async function parseBuffer(file: File): Promise<void> {
  if (!viewer.value || viewer.value.isDestroyed()) return
  isParsing.value = true
  errorMessage.value = ''
  warnings.value = []
  statusMessage.value = '正在解析文件…'
  try {
    const result = await parseFile(file, { sourceCrs: sourceCrs.value }, detectedFormat.value)
    if (result.model.features.length === 0) throw new Error('未解析出任何要素，请检查文件内容与源坐标系')
    model.value = result.model
    warnings.value = result.warnings
    await renderModel()
    statusMessage.value = ''
  } catch (error) {
    model.value = undefined
    errorMessage.value = error instanceof Error ? error.message : String(error)
    statusMessage.value = ''
  } finally {
    isParsing.value = false
  }
}

function openFilePicker(): void {
  fileInput.value?.click()
}

async function onFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  selectedFile = file
  const buffer = await file.arrayBuffer()
  fileName.value = file.name
  detectedFormat.value = detectFormat(file.name, buffer)
  sourceCrs.value = defaultSourceCrs(detectedFormat.value)
  baseName.value = suggestBaseName(file.name)
  await parseBuffer(file)
}

async function reparse(): Promise<void> {
  if (!selectedFile) {
    errorMessage.value = '请先选择要转换的矢量文件'
    return
  }
  await parseBuffer(selectedFile)
}

async function exportFile(): Promise<void> {
  if (!model.value) return
  errorMessage.value = ''
  statusMessage.value = '正在生成导出文件…'
  try {
    const result = await serializeModel(model.value, targetFormat.value, {
      targetCrs: targetCrs.value,
      baseName: baseName.value || 'vector-output'
    })
    warnings.value = result.warnings
    downloadBlob(result.blob, result.filename)
    statusMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
    statusMessage.value = ''
  }
}

async function exportTable(): Promise<void> {
  if (!model.value) return
  errorMessage.value = ''
  statusMessage.value = '正在生成点位表格…'
  try {
    const result = await serializePointTable(model.value, baseName.value || 'point-table')
    warnings.value = result.warnings
    downloadBlob(result.blob, result.filename)
    statusMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
    statusMessage.value = ''
  }
}

function clearData(): void {
  renderSeq += 1
  if (dataSource && viewer.value && !viewer.value.isDestroyed()) {
    viewer.value.dataSources.remove(dataSource, true)
  }
  dataSource = undefined
  model.value = undefined
  warnings.value = []
  errorMessage.value = ''
  fileName.value = ''
  selectedFile = undefined
}

function toggleHelp(key: string): void {
  activeHelpKey.value = activeHelpKey.value === key ? undefined : key
}

onMounted(async () => {
  if (!container.value) return
  viewer.value = createMapScene(container.value, { onStatus: (message) => (statusMessage.value = message) })
  loadBingImagery(viewer.value, { onStatus: (message) => (statusMessage.value = message) })
  loadWorldTerrain(viewer.value).catch(() => undefined)
  isLoaded.value = true
  statusMessage.value = ''
})

onBeforeUnmount(() => {
  renderSeq += 1
  destroyScene(viewer.value)
  viewer.value = undefined
})
</script>

<template>
  <div class="vc-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">数据转换-矢量数据转换</div>

      <div class="section-title">导入</div>
      <input
        ref="fileInput"
        type="file"
        accept=".geojson,.json,.kml,.ovkml,.kmz,.ovkmz,.ovjsn,.ovobj,.gpx,.wkt,.txt,.csv,.shp,.zip"
        hidden
        @change="onFileSelected"
      />
      <div class="button-row">
        <button class="action-button" :disabled="!isLoaded || isParsing" @click="openFilePicker">
          {{ isParsing ? '解析中…' : '选择矢量文件' }}
        </button>
        <button class="action-button ghost" :disabled="!fileName || isParsing" @click="reparse">重新解析</button>
      </div>
      <div class="row-note">支持 GeoJSON/TopoJSON、KML/KMZ、奥维 OVKML/OVKMZ/OVJSN/OVOBJ、GPX、WKT、CSV、SHP(ZIP)</div>
      <div v-if="fileName" class="row-note">当前文件：{{ fileName }}</div>

      <div class="control-row">
        <span class="row-label">识别格式</span>
        <select v-model="detectedFormat">
          <option v-for="(label, id) in FORMAT_LABELS" :key="id" :value="id">{{ label }}</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">源坐标系</span>
        <select v-model="sourceCrs">
          <option v-for="item in CRS_LIST" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
      </div>
      <div class="row-note">{{ sourceCrsLabel }}</div>

      <div class="section-title">数据概览</div>
      <div class="stat-grid">
        <div class="stat-cell"><span>要素总数</span><b>{{ featureStats.total }}</b></div>
        <div class="stat-cell"><span>点位</span><b>{{ featureStats.point }}</b></div>
        <div class="stat-cell"><span>线</span><b>{{ featureStats.line }}</b></div>
        <div class="stat-cell"><span>面</span><b>{{ featureStats.polygon }}</b></div>
        <div class="stat-cell"><span>分组</span><b>{{ groupCount }}</b></div>
      </div>
      <div class="button-row">
        <button class="action-button ghost" :disabled="!model" @click="clearData">清空预览</button>
      </div>

      <div class="section-title">导出</div>
      <div class="control-row">
        <span class="row-label">目标格式</span>
        <select v-model="targetFormat">
          <option v-for="id in EXPORT_FORMATS" :key="id" :value="id">{{ FORMAT_LABELS[id] }}</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">目标坐标系</span>
        <select v-model="targetCrs">
          <option v-for="item in CRS_LIST" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">文件名称</span>
        <input v-model="baseName" type="text" placeholder="vector-output" />
      </div>
      <div class="row-note">{{ targetCrsLabel }}</div>
      <div class="button-row">
        <button class="action-button" :disabled="!model" @click="exportFile">转换并导出</button>
      </div>
      <div class="button-row">
        <button class="action-button table" :disabled="!model || !hasPoints" @click="exportTable">导出为表格(.xlsx)</button>
      </div>
      <div v-if="model && !hasPoints" class="row-note">当前数据无点位要素，表格导出不可用</div>

      <p v-if="warnings.length > 0" class="warning-text">
        <span v-for="(warn, index) in warnings" :key="index">{{ warn }}<br /></span>
      </p>
      <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

      <button class="help-toggle" @click="helpOpen = !helpOpen">功能实现说明</button>
      <div v-if="helpOpen" class="help-panel">
        <div class="help-head">
          <span>功能实现说明</span>
          <button class="help-close" @click="helpOpen = false">×</button>
        </div>
        <div v-for="item in VECTOR_CONVERTER_HELP" :key="item.key" class="help-item">
          <button class="help-item-head" :class="{ active: activeHelpKey === item.key }" @click="toggleHelp(item.key)">
            <span>{{ item.title }}</span><i>{{ activeHelpKey === item.key ? '−' : '+' }}</i>
          </button>
          <p v-if="activeHelpKey === item.key" class="help-summary">{{ item.summary }}</p>
          <ul v-if="activeHelpKey === item.key" class="help-detail">
            <li v-for="(line, index) in item.detail" :key="index">{{ line }}</li>
          </ul>
        </div>
      </div>

      <p class="hint">
        导入矢量文件后自动解析为统一中间模型并在三维场景中预览，选择目标格式与坐标系即可转换导出；当数据包含点位矢量时，可额外导出为 Excel 表格。
      </p>
    </div>

    <div v-if="statusMessage && (!isLoaded || isParsing)" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.vc-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #0f2438; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 5px; width: 292px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; box-sizing: border-box; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 26, 44, 0.9); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.panel-title { font-size: 12px; font-weight: 700; margin-bottom: 2px; }
.section-title { margin-top: 7px; margin-bottom: 2px; padding-bottom: 2px; border-bottom: 1px solid rgba(137, 210, 233, 0.16); font-size: 11px; font-weight: 700; color: #7fd0e6; }
.button-row { display: flex; gap: 6px; }
.action-button { flex: 1; min-height: 26px; border: 1px solid rgba(137, 210, 233, 0.35); border-radius: 5px; background: #143450; color: #d9eff6; cursor: pointer; font-size: 11px; }
.action-button.active { background: #257f9e; border-color: #45b4d6; }
.action-button.ghost { background: rgba(20, 52, 80, 0.6); }
.action-button.table { background: rgba(20, 74, 60, 0.7); border-color: rgba(89, 214, 173, 0.5); color: #b9f4de; }
.action-button:disabled { cursor: default; opacity: 0.5; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 2px 0; color: #c3d8e6; }
.row-label { flex: 0 0 auto; }
.row-value { flex: 0 0 56px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.row-note { font-size: 10px; color: #7fd0e6; line-height: 1.5; }
.control-row input[type="text"] { flex: 1; min-width: 0; height: 22px; padding: 0 5px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.control-row select { width: 168px; height: 22px; padding: 0 5px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 2px; }
.stat-cell { display: flex; flex-direction: column; gap: 2px; padding: 5px 4px; border: 1px solid rgba(137, 210, 233, 0.2); border-radius: 5px; background: rgba(16, 43, 64, 0.55); text-align: center; }
.stat-cell span { font-size: 9px; color: #8fb0c8; }
.stat-cell b { font-size: 11px; color: #d9eff6; }
.warning-text { margin: 5px 0 0; padding: 5px 7px; border: 1px solid rgba(255, 199, 92, 0.45); border-radius: 5px; background: rgba(74, 58, 12, 0.4); color: #ffd666; font-size: 10px; line-height: 1.5; }
.error-text { margin: 5px 0 0; padding: 5px 7px; border: 1px solid rgba(255, 120, 117, 0.5); border-radius: 5px; background: rgba(74, 20, 18, 0.45); color: #ff7875; font-size: 10px; line-height: 1.5; }
.hint { margin: 6px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.5; }
.help-toggle { margin-top: 7px; min-height: 26px; border: 1px solid rgba(255, 199, 92, 0.5); border-radius: 5px; background: rgba(74, 58, 12, 0.4); color: #ffd666; cursor: pointer; font-size: 11px; }
.help-panel { margin-top: 6px; padding: 8px; border: 1px solid rgba(255, 199, 92, 0.45); border-radius: 6px; background: rgba(30, 24, 8, 0.55); }
.help-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; color: #ffd666; font-weight: 700; }
.help-close { border: 0; background: transparent; color: #cbb98a; cursor: pointer; font-size: 14px; line-height: 1; }
.help-item { border-top: 1px solid rgba(255, 199, 92, 0.16); }
.help-item-head { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 5px 0; border: 0; background: transparent; color: #e9d9ae; cursor: pointer; font-size: 11px; text-align: left; }
.help-item-head.active { color: #ffe9a8; }
.help-item-head i { font-style: normal; font-size: 13px; }
.help-summary { margin: 0 0 3px; font-size: 10px; color: #d9cdab; line-height: 1.5; }
.help-detail { margin: 0; padding-left: 15px; }
.help-detail li { font-size: 10px; color: #cbbd97; line-height: 1.55; margin-bottom: 2px; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 11; width: max-content; max-width: 460px; padding: 8px 14px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
