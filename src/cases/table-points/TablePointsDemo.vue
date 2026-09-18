<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { Cartesian2, Cartesian3, Color, ConstantProperty, CustomDataSource, JulianDate, PropertyBag, ScreenSpaceEventHandler, ScreenSpaceEventType, type Entity, type Viewer } from 'cesium'
import * as XLSX from 'xlsx'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'

type CellValue = string | number | boolean | null
type TableRow = Record<string, CellValue>
type ParsedSheet = {
  name: string
  rows: TableRow[]
  headers: string[]
  longitudeField: string
  latitudeField: string
  labelField: string
}
type PointLayer = {
  id: number
  name: string
  format: string
  featureCount: number
  visible: boolean
  labelsVisible: boolean
  dataSource: CustomDataSource
}

const container = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const layers = shallowRef<PointLayer[]>([])
const pendingSheets = ref<ParsedSheet[]>([])
const selectedSheetNames = ref<string[]>([])
const pendingFileName = ref('')
const statusMessage = ref('正在加载 Bing 地图…')
const errorMessage = ref('')
const loading = ref(false)
const selectedInfo = ref<{ name: string; properties: Array<[string, string]> } | null>(null)
let viewer: Viewer | undefined
let clickHandler: ScreenSpaceEventHandler | undefined
let layerSequence = 0
let disposed = false

const sceneCallbacks: SceneCallbacks = {
  onStatus: (message) => { statusMessage.value = message },
  onBasemapReady: () => { statusMessage.value = '' }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatCell(value: CellValue): string {
  return value === null || value === undefined ? '' : String(value)
}

function normalizeRows(sheet: XLSX.WorkSheet): TableRow[] {
  return XLSX.utils.sheet_to_json<TableRow>(sheet, { defval: null, raw: false })
}

async function parseTable(file: File): Promise<{ sheets: ParsedSheet[]; format: string }> {
  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true })
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    const parsedRows = normalizeRows(sheet)
    const parsedHeaders = XLSX.utils.sheet_to_json<CellValue[]>(sheet, { header: 1, defval: null })[0] ?? []
    const headers = parsedHeaders.map((value) => formatCell(value)).filter(Boolean)
    return {
      name,
      rows: parsedRows,
      headers,
      longitudeField: guessField(headers, [/经度/i, /longitude/i, /^lon$/i, /^lng$/i, /x坐标/i]),
      latitudeField: guessField(headers, [/纬度/i, /latitude/i, /^lat$/i, /y坐标/i]),
      labelField: guessField(headers, [/名称/i, /name/i, /标题/i, /label/i, /标注/i])
    }
  }).filter((sheet) => sheet.rows.length > 0 && sheet.headers.length > 0)
  if (sheets.length === 0) throw new Error('表格中没有可用的工作表或数据')
  return { sheets, format: file.name.split('.').pop()?.toUpperCase() ?? 'TABLE' }
}

function guessField(names: string[], patterns: RegExp[]): string {
  return names.find((name) => patterns.some((pattern) => pattern.test(name))) ?? names[0] ?? ''
}

async function onFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  errorMessage.value = ''
  loading.value = true
  try {
    const parsed = await parseTable(file)
    pendingSheets.value = parsed.sheets
    selectedSheetNames.value = parsed.sheets.map((sheet) => sheet.name)
    pendingFileName.value = `${file.name} · ${parsed.sheets.length} 个工作表`
  } catch (error) {
    pendingSheets.value = []
    selectedSheetNames.value = []
    pendingFileName.value = ''
    errorMessage.value = toErrorMessage(error)
  } finally {
    loading.value = false
    input.value = ''
  }
}

function addLayer(layer: Omit<PointLayer, 'id' | 'visible' | 'labelsVisible'>): void {
  layers.value = [...layers.value, { ...layer, id: ++layerSequence, visible: true, labelsVisible: true }]
}

function createPointLayers(): void {
  if (!viewer || pendingSheets.value.length === 0) return
  const selectedSheets = pendingSheets.value.filter((sheet) => selectedSheetNames.value.includes(sheet.name))
  if (selectedSheets.length === 0) {
    errorMessage.value = '请至少选择一个工作表'
    return
  }
  const invalidSheet = selectedSheets.find((sheet) => !sheet.longitudeField || !sheet.latitudeField)
  if (invalidSheet) {
    errorMessage.value = `请为工作表“${invalidSheet.name}”选择经度和纬度字段`
    return
  }
  let firstDataSource: CustomDataSource | undefined
  selectedSheets.forEach((sheet, sheetIndex) => {
    const source = new CustomDataSource(`${pendingFileName.value.split(' · ')[0] || '表格点位'} - ${sheet.name}`)
    const layerName = `${pendingFileName.value.split(' · ')[0] || '表格点位'} - ${sheet.name}`
    const layerColor = Color.fromHsl((Math.random() + sheetIndex * 0.61803398875) % 1, 0.68, 0.58, 1)
    sheet.rows.forEach((row, index) => {
      const longitude = Number(row[sheet.longitudeField])
      const latitude = Number(row[sheet.latitudeField])
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return
      const values = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, new ConstantProperty(formatCell(value))]))
      const label = sheet.labelField ? formatCell(row[sheet.labelField]) : ''
      source.entities.add({
        name: label || `${layerName} #${index + 1}`,
        position: Cartesian3.fromDegrees(longitude, latitude),
        point: { pixelSize: 10, color: layerColor, outlineColor: Color.WHITE, outlineWidth: 1 },
        label: label ? { text: label, font: '12px sans-serif', fillColor: Color.WHITE, show: new ConstantProperty(true), pixelOffset: new Cartesian2(0, -18) } : undefined,
        properties: new PropertyBag(values)
      })
    })
    if (source.entities.values.length > 0) {
      viewer?.dataSources.add(source)
      addLayer({ name: layerName, format: pendingFileName.value.split(' · ')[0]?.split('.').pop()?.toUpperCase() ?? 'TABLE', featureCount: source.entities.values.length, dataSource: source })
      firstDataSource ??= source
    }
  })
  if (!firstDataSource) {
    errorMessage.value = '所选工作表没有找到有效的经纬度记录'
    return
  }
  void viewer.flyTo(firstDataSource)
  pendingSheets.value = []
  selectedSheetNames.value = []
  pendingFileName.value = ''
  errorMessage.value = ''
}

function toggleLayer(layer: PointLayer): void {
  layer.dataSource.show = !layer.visible
  layers.value = layers.value.map((item) => item === layer ? { ...item, visible: !item.visible } : item)
}

function toggleLabels(layer: PointLayer): void {
  const labelsVisible = !layer.labelsVisible
  layer.dataSource.entities.values.forEach((entity) => { if (entity.label) entity.label.show = new ConstantProperty(labelsVisible) })
  layers.value = layers.value.map((item) => item === layer ? { ...item, labelsVisible } : item)
}

function flyToLayer(layer: PointLayer): void {
  void viewer?.flyTo(layer.dataSource)
}

function removeLayer(layer: PointLayer): void {
  viewer?.dataSources.remove(layer.dataSource, true)
  layers.value = layers.value.filter((item) => item !== layer)
  selectedInfo.value = null
}

function handleEntityPick(position: Cartesian2): void {
  if (!viewer || disposed || viewer.isDestroyed()) return
  const entity = viewer.scene.pick(position)?.id as Entity | undefined
  if (!entity?.properties) { selectedInfo.value = null; return }
  const values = entity.properties.getValue(JulianDate.now()) as Record<string, unknown> | undefined
  selectedInfo.value = {
    name: entity.name || '表格记录',
    properties: Object.entries(values ?? {}).map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)])
  }
}

onMounted(() => {
  if (!container.value) return
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    clickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    clickHandler.setInputAction((movement: ScreenSpaceEventHandler.PositionedEvent) => handleEntityPick(movement.position), ScreenSpaceEventType.LEFT_CLICK)
  } catch (error) {
    errorMessage.value = toErrorMessage(error)
    statusMessage.value = ''
  }
})

onBeforeUnmount(() => {
  disposed = true
  clickHandler?.destroy()
  layers.value.forEach((layer) => viewer?.dataSources.remove(layer.dataSource, true))
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="table-points-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="table-points-panel">
      <div class="panel-title">本地表格点图层</div>
      <button class="file-btn" :disabled="loading" @click="fileInput?.click()">选择表格文件</button>
      <input ref="fileInput" type="file" accept=".csv,.tsv,.txt,.xls,.xlsx,.xlsm,.xlsb,.ods" hidden @change="onFileSelected" />
      <p class="file-hint">支持 CSV、TSV、TXT、XLS、XLSX、XLSM、XLSB、ODS</p>
      <div v-if="pendingFileName" class="table-config">
        <div class="pending-file">{{ pendingFileName }}</div>
        <div class="sheet-heading"><span>选择工作表</span><small>{{ selectedSheetNames.length }}/{{ pendingSheets.length }}</small></div>
        <div class="sheet-list">
          <div v-for="sheet in pendingSheets" :key="sheet.name" class="sheet-config">
            <label class="sheet-option"><input v-model="selectedSheetNames" type="checkbox" :value="sheet.name"><span>{{ sheet.name }}</span><small>{{ sheet.rows.length }} 条</small></label>
            <label>经度字段<select v-model="sheet.longitudeField"><option v-for="field in sheet.headers" :key="`${sheet.name}-lon-${field}`" :value="field">{{ field }}</option></select></label>
            <label>纬度字段<select v-model="sheet.latitudeField"><option v-for="field in sheet.headers" :key="`${sheet.name}-lat-${field}`" :value="field">{{ field }}</option></select></label>
            <label>标注字段<select v-model="sheet.labelField"><option value="">不显示标注</option><option v-for="field in sheet.headers" :key="`${sheet.name}-label-${field}`" :value="field">{{ field }}</option></select></label>
          </div>
        </div>
        <button class="apply-button" @click="createPointLayers">加载选中图层</button>
      </div>
      <div class="layer-list">
        <div v-if="layers.length === 0" class="layer-empty">暂无图层</div>
        <div v-for="layer in layers" :key="layer.id" class="layer-item">
          <button class="layer-vis" :class="{ on: layer.visible }" :aria-label="layer.visible ? '隐藏图层' : '显示图层'" @click="toggleLayer(layer)"><i></i></button>
          <div class="layer-meta"><span class="layer-name">{{ layer.name }}</span><span class="layer-sub">{{ layer.format }} · {{ layer.featureCount }} 点</span></div>
          <button class="layer-action" :class="{ active: layer.labelsVisible }" :aria-label="layer.labelsVisible ? '隐藏标注' : '显示标注'" @click="toggleLabels(layer)">标</button>
          <button class="layer-action" aria-label="跳转图层" @click="flyToLayer(layer)">跳</button>
          <button class="layer-remove" :aria-label="`移除 ${layer.name}`" @click="removeLayer(layer)">✕</button>
        </div>
      </div>
      <div v-if="loading" class="loading-tip">读取中…</div>
      <div v-if="errorMessage" class="table-error">{{ errorMessage }}</div>
    </div>
    <div v-if="selectedInfo" class="table-prop-panel"><div class="prop-head"><strong>{{ selectedInfo.name }}</strong><button @click="selectedInfo = null">×</button></div><div v-for="([key, value]) in selectedInfo.properties" :key="key" class="prop-row"><span>{{ key }}</span><b>{{ value }}</b></div></div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.table-points-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.table-points-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 8px; width: 290px; max-height: calc(100% - 24px); overflow: auto; padding: 11px; border: 1px solid rgba(137,210,233,.28); border-radius: 9px; background: rgba(8,32,49,.88); backdrop-filter: blur(6px); color: #ddf2f8; }
.panel-title { font-size: 12px; font-weight: 700; }
.file-btn, .apply-button { min-height: 27px; border: 0; border-radius: 5px; background: #257f9e; color: #edfaff; cursor: pointer; font-size: 11px; }
.file-btn:disabled { opacity: .55; cursor: wait; }
.file-hint, .pending-file { margin: 0; color: #9ec6d4; font-size: 10px; line-height: 1.45; }
.table-config { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 6px; background: rgba(3,19,31,.5); }
.table-config label { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #bdd9e4; font-size: 10px; }
.table-config select { width: 145px; min-width: 0; border: 1px solid rgba(137,210,233,.24); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.sheet-heading { display: flex; justify-content: space-between; color: #bdd9e4; font-size: 10px; }
.sheet-heading small, .sheet-option small { color: #83a7b5; }
.sheet-list { display: flex; flex-direction: column; gap: 3px; max-height: 90px; overflow: auto; }
.sheet-config { display: flex; flex-direction: column; gap: 4px; padding: 5px; border: 1px solid rgba(137,210,233,.12); border-radius: 5px; }
.sheet-config label:not(.sheet-option) { padding-left: 20px; font-size: 9px; }
.sheet-config select { width: 122px; font-size: 9px; }
.sheet-option { display: flex; align-items: center; justify-content: flex-start !important; gap: 5px !important; }
.sheet-option input { accent-color: #52c4e8; }
.sheet-option span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.layer-list { display: flex; flex-direction: column; gap: 5px; }
.layer-empty { padding: 12px 0; color: #7895a4; text-align: center; font-size: 10px; }
.layer-item { display: flex; align-items: center; gap: 5px; min-width: 0; padding: 5px; border: 1px solid rgba(137,210,233,.15); border-radius: 5px; }
.layer-vis { position: relative; flex: 0 0 27px; width: 27px; height: 15px; border-radius: 999px; background: rgba(137,210,233,.3); }
.layer-vis i { position: absolute; top: 2px; left: 2px; width: 11px; height: 11px; border-radius: 50%; background: #e8f8fb; transition: transform .2s; }
.layer-vis.on { background: #36a8cc; }
.layer-vis.on i { transform: translateX(12px); }
.layer-meta { flex: 1; min-width: 0; }
.layer-name, .layer-sub { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.layer-name { color: #d9eff6; font-size: 10px; }
.layer-sub { margin-top: 2px; color: #83a7b5; font-size: 9px; }
.layer-action, .layer-remove { flex: 0 0 auto; padding: 2px 4px; border-radius: 3px; background: transparent; color: #6e9bab; font-size: 10px; }
.layer-action.active { color: #65d3eb; }
.layer-action:hover, .layer-remove:hover { color: #fff; background: rgba(137,210,233,.18); }
.loading-tip, .table-error { font-size: 10px; line-height: 1.4; }
.loading-tip { color: #9ec6d4; }
.table-error { color: #ffaaa5; }
.table-prop-panel { position: absolute; top: 12px; left: 12px; z-index: 11; width: min(320px, calc(100% - 24px)); max-height: 42%; overflow: auto; padding: 10px; border: 1px solid rgba(137,210,233,.28); border-radius: 8px; background: rgba(8,32,49,.9); color: #d9eff6; }
.prop-head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 7px; font-size: 11px; }
.prop-head button { color: #9ec6d4; background: transparent; font-size: 16px; }
.prop-row { display: flex; gap: 8px; padding: 4px 0; border-top: 1px solid rgba(137,210,233,.1); font-size: 10px; }
.prop-row span { flex: 0 0 34%; color: #83a7b5; }
.prop-row b { overflow-wrap: anywhere; font-weight: 400; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }

@media (max-width: 680px) {
  .table-points-panel { top: 8px; right: 8px; width: min(290px, calc(100% - 16px)); max-height: 58%; }
  .table-prop-panel { top: 8px; left: 8px; width: min(280px, calc(100% - 16px)); max-height: 35%; }
}
</style>
