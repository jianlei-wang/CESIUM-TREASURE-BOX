<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { Cartesian2, Entity, Viewer } from 'cesium'
import {
  GeoJsonDataSource,
  JulianDate,
  KmlDataSource,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType
} from 'cesium'
import shp from 'shpjs'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'

type VectorLayer = {
  id: number
  name: string
  format: string
  featureCount: number
  visible: boolean
  dataSource: GeoJsonDataSource | KmlDataSource
}

const container = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const errorMessage = ref('')
const statusMessage = ref('正在加载 Bing 地图…')
const loading = ref(false)
const layers = shallowRef<VectorLayer[]>([])
const selectedInfo = ref<{ name: string; properties: Array<[string, string]> } | null>(null)
let layerSequence = 0
let viewer: Viewer | undefined
let disposed = false
let clickHandler: ScreenSpaceEventHandler | undefined
let handleUnhandledRejection: ((event: PromiseRejectionEvent) => void) | undefined

const sceneCallbacks: SceneCallbacks = {
  onStatus: (message) => {
    statusMessage.value = message
  },
  onBasemapReady: () => {
    statusMessage.value = ''
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function addLayer(layer: Omit<VectorLayer, 'id' | 'visible'>): void {
  layers.value = [...layers.value, { ...layer, id: (layerSequence += 1), visible: true }]
}

function toggleLayer(layer: VectorLayer): void {
  layers.value = layers.value.map((item) => {
    if (item !== layer) return item
    const visible = !item.visible
    item.dataSource.show = visible
    return { ...item, visible }
  })
}

async function removeLayer(layer: VectorLayer): Promise<void> {
  if (!viewer) return
  await viewer.dataSources.remove(layer.dataSource, true)
  layers.value = layers.value.filter((item) => item !== layer)
  if (selectedInfo.value) selectedInfo.value = null
}

function handleEntityPick(position: Cartesian2): void {
  if (!viewer || disposed || viewer.isDestroyed()) return
  const picked = viewer.scene.pick(position)
  const entity = picked?.id as Entity | undefined
  if (!entity || !entity.properties) {
    selectedInfo.value = null
    return
  }
  const values = entity.properties.getValue(JulianDate.now()) as Record<string, unknown> | undefined
  const entries = Object.entries(values ?? {}).filter(([, value]) => value !== null && value !== undefined)
  selectedInfo.value = {
    name: entity.name || (entries.length > 0 ? String(entries[0][1]) : '未命名要素'),
    properties: entries.map(([key, value]) => [
      key,
      typeof value === 'object' ? JSON.stringify(value) : String(value)
    ])
  }
}

async function loadGeoJson(data: object | string, name: string, format: string): Promise<GeoJsonDataSource | null> {
  if (!viewer || disposed || viewer.isDestroyed()) return null
  const dataSource = await GeoJsonDataSource.load(data, { clampToGround: true })
  await viewer.dataSources.add(dataSource)
  addLayer({ name, format, featureCount: dataSource.entities.values.length, dataSource })
  return dataSource
}

async function loadKml(text: string, name: string): Promise<KmlDataSource | null> {
  if (!viewer || disposed || viewer.isDestroyed()) return null
  const dataSource = await KmlDataSource.load(text, {
    camera: viewer.camera,
    canvas: viewer.scene.canvas
  })
  await viewer.dataSources.add(dataSource)
  addLayer({ name, format: 'KML', featureCount: dataSource.entities.values.length, dataSource })
  return dataSource
}

async function loadShp(
  shpBuffer: ArrayBuffer,
  dbfBuffer: ArrayBuffer | undefined,
  name: string
): Promise<GeoJsonDataSource | null> {
  const featureCollection = dbfBuffer
    ? await shp({ shp: shpBuffer, dbf: dbfBuffer })
    : await shp(shpBuffer)
  const data = Array.isArray(featureCollection) ? featureCollection[0] : featureCollection
  return loadGeoJson(data, name, 'SHP')
}

async function onFilesSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return

  const list = Array.from(files)
  const dbfByName = new Map<string, File>()
  for (const file of list) {
    if (file.name.toLowerCase().endsWith('.dbf')) {
      dbfByName.set(file.name.toLowerCase().replace(/\.dbf$/, ''), file)
    }
  }

  errorMessage.value = ''
  loading.value = true
  const failures: string[] = []
  let lastDataSource: GeoJsonDataSource | KmlDataSource | null = null

  for (const file of list) {
    const lower = file.name.toLowerCase()
    try {
      if (lower.endsWith('.shp')) {
        const shpBuffer = await file.arrayBuffer()
        const dbfFile = dbfByName.get(lower.replace(/\.shp$/, ''))
        const dbfBuffer = dbfFile ? await dbfFile.arrayBuffer() : undefined
        lastDataSource = (await loadShp(shpBuffer, dbfBuffer, file.name)) ?? lastDataSource
      } else if (lower.endsWith('.zip')) {
        const featureCollection = await shp(await file.arrayBuffer())
        const data = Array.isArray(featureCollection) ? featureCollection[0] : featureCollection
        lastDataSource = (await loadGeoJson(data, file.name, 'SHP')) ?? lastDataSource
      } else if (lower.endsWith('.kml')) {
        lastDataSource = (await loadKml(await file.text(), file.name)) ?? lastDataSource
      } else if (/\.(geojson|json)$/.test(lower)) {
        const text = await file.text()
        let data: string | object = text
        try {
          data = JSON.parse(text)
        } catch {
          data = text
        }
        lastDataSource = (await loadGeoJson(data, file.name, 'GeoJSON')) ?? lastDataSource
      } else if (!lower.endsWith('.dbf')) {
        failures.push(`${file.name}：未识别类型`)
      }
    } catch (error) {
      failures.push(`${file.name}：${toErrorMessage(error)}`)
    }
  }

  loading.value = false
  if (failures.length > 0) errorMessage.value = failures.join('；')
  if (lastDataSource && viewer) await viewer.flyTo(lastDataSource)
  input.value = ''
}

onMounted(() => {
  if (!container.value) return

  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
  } catch (error) {
    errorMessage.value = toErrorMessage(error)
    statusMessage.value = ''
  }

  if (viewer) {
    clickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    clickHandler.setInputAction((movement: ScreenSpaceEventHandler.PositionedEvent) => {
      handleEntityPick(movement.position)
    }, ScreenSpaceEventType.LEFT_CLICK)
  }

  handleUnhandledRejection = (event) => {
    if (disposed || !viewer || viewer.isDestroyed()) return
    event.preventDefault()
    const reason = event.reason
    statusMessage.value = `影像服务响应异常：${toErrorMessage(reason)}`
  }
  window.addEventListener('unhandledrejection', handleUnhandledRejection)
})

onBeforeUnmount(() => {
  disposed = true
  clickHandler?.destroy()
  clickHandler = undefined
  if (handleUnhandledRejection) {
    window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    handleUnhandledRejection = undefined
  }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="vector-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="vector-panel">
      <div class="panel-title">矢量图层</div>
      <button class="file-btn" :disabled="loading" @click="fileInput?.click()">选择本地文件</button>
      <input
        ref="fileInput"
        type="file"
        multiple
        accept=".shp,.dbf,.geojson,.json,.kml,.zip"
        hidden
        @change="onFilesSelected"
      />
      <p class="file-hint">支持 .shp(+.dbf) / .zip / .geojson / .json / .kml，可多选连续加载</p>

      <div class="layer-list">
        <div v-if="layers.length === 0" class="layer-empty">暂无图层</div>
        <div v-for="layer in layers" :key="layer.id" class="layer-item">
          <button
            class="layer-vis"
            :class="{ on: layer.visible }"
            :aria-label="layer.visible ? '隐藏图层' : '显示图层'"
            @click="toggleLayer(layer)"
          >
            <i></i>
          </button>
          <div class="layer-meta">
            <span class="layer-name">{{ layer.name }}</span>
            <span class="layer-sub">{{ layer.format }} · {{ layer.featureCount }} 要素</span>
          </div>
          <button class="layer-remove" :aria-label="`移除 ${layer.name}`" @click="removeLayer(layer)">✕</button>
        </div>
      </div>

      <div v-if="loading" class="loading-tip">加载中…</div>
      <div v-if="errorMessage" class="vector-error">{{ errorMessage }}</div>
    </div>

    <div v-if="selectedInfo" class="prop-panel">
      <div class="prop-head">
        <span class="prop-title">{{ selectedInfo.name }}</span>
        <button class="prop-close" aria-label="关闭属性" @click="selectedInfo = null">✕</button>
      </div>
      <div v-if="selectedInfo.properties.length > 0" class="prop-body">
        <div v-for="[key, value] in selectedInfo.properties" :key="key" class="prop-row">
          <span class="prop-key">{{ key }}</span>
          <span class="prop-value">{{ value }}</span>
        </div>
      </div>
      <div v-else class="prop-empty">该要素无属性</div>
    </div>

    <div v-if="statusMessage" class="vector-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.vector-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
  border-radius: 8px;
  background: #152b4c;
}
.cesium-container {
  width: 100%;
  height: 100%;
}
.vector-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 218px;
  padding: 11px;
  border-radius: 9px;
  background: rgba(10, 26, 52, 0.8);
  border: 1px solid rgba(157, 188, 224, 0.22);
  backdrop-filter: blur(6px);
  color: #dce8f5;
}
.panel-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.file-btn {
  width: 100%;
  padding: 7px 4px;
  border-radius: 6px;
  border: 1px solid rgba(157, 188, 224, 0.28);
  background: transparent;
  color: #c4d3e8;
  font-size: 11px;
  cursor: pointer;
}
.file-btn:hover {
  color: #fff;
  border-color: #5eacf5;
  background: rgba(75, 145, 220, 0.14);
}
.file-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.file-hint {
  margin: 0;
  font-size: 10px;
  color: #8ea5c2;
  line-height: 1.5;
}
.layer-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 220px;
  overflow-y: auto;
}
.layer-empty {
  padding: 12px 0;
  text-align: center;
  font-size: 10px;
  color: #6d84a3;
}
.layer-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 7px;
  border-radius: 6px;
  background: rgba(75, 145, 220, 0.1);
  border: 1px solid rgba(157, 188, 224, 0.16);
}
.layer-meta {
  flex: 1;
  min-width: 0;
}
.layer-name {
  display: block;
  overflow: hidden;
  font-size: 11px;
  color: #e6eef9;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.layer-sub {
  display: block;
  margin-top: 2px;
  font-size: 9px;
  color: #8ea5c2;
}
.layer-vis {
  flex: 0 0 auto;
  width: 24px;
  height: 14px;
  padding: 0;
  border-radius: 999px;
  border: 0;
  background: rgba(157, 188, 224, 0.35);
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
}
.layer-vis i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #dce8f5;
  transition: transform 0.2s;
}
.layer-vis.on {
  background: #2f80ed;
}
.layer-vis.on i {
  transform: translateX(10px);
}
.layer-remove {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 0;
  background: transparent;
  color: #8ea5c2;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}
.layer-remove:hover {
  color: #ff9d9d;
  background: rgba(255, 157, 157, 0.12);
}
.loading-tip {
  font-size: 10px;
  color: #8ea5c2;
}
.vector-error {
  font-size: 10px;
  color: #ff9d9d;
  line-height: 1.5;
}
.prop-panel {
  position: absolute;
  left: 12px;
  top: 12px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  width: 250px;
  max-height: 45%;
  overflow: hidden;
  border-radius: 8px;
  background: rgba(10, 26, 52, 0.82);
  border: 1px solid rgba(157, 188, 224, 0.22);
  backdrop-filter: blur(6px);
  color: #dce8f5;
}
.prop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(157, 188, 224, 0.16);
}
.prop-title {
  overflow: hidden;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.prop-close {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 0;
  background: transparent;
  color: #8ea5c2;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}
.prop-close:hover {
  color: #ff9d9d;
  background: rgba(255, 157, 157, 0.12);
}
.prop-body {
  overflow-y: auto;
  padding: 4px 10px 8px;
}
.prop-row {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px dashed rgba(157, 188, 224, 0.12);
  font-size: 11px;
}
.prop-key {
  flex: 0 0 34%;
  overflow: hidden;
  color: #8ea5c2;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.prop-value {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}
.prop-empty {
  padding: 10px;
  font-size: 10px;
  color: #6d84a3;
}
.vector-status {
  position: absolute;
  inset: 0;
  z-index: 9;
  display: grid;
  place-items: center;
  padding: 24px;
  color: #dce8f5;
  background: rgba(8, 21, 40, 0.72);
  font-size: 12px;
}
</style>
