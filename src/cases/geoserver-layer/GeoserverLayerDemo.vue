<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { Entity, ImageryLayer, Viewer } from 'cesium'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  GeoJsonDataSource,
  JulianDate,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  WebMapServiceImageryProvider
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { capabilitiesUrlFor, parseCapabilities, type BBox } from '../../lib/geoserver-capabilities'
import { createWmtsImageryProvider } from '../../lib/wmts'

type ServiceKind = 'WMS' | 'WFS' | 'WMTS'

type LoadedLayer = {
  id: number
  name: string
  kind: ServiceKind
  visible: boolean
  bbox?: BBox
  imageryLayer?: ImageryLayer
  dataSource?: GeoJsonDataSource
}

const container = ref<HTMLElement | null>(null)
const serviceKind = ref<ServiceKind>('WMS')
const serviceUrl = ref('')
const layerName = ref('')
const tileMatrixSet = ref('EPSG:900913')
const bboxInput = ref('')
const loadedLayers = shallowRef<LoadedLayer[]>([])
const selectedInfo = ref<{ name: string; properties: Array<[string, string]> } | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const errorMessage = ref('')
const loading = ref(false)
const showHelp = ref(false)
const layerNamePlaceholder = computed(() => {
  if (serviceKind.value === 'WFS') return '要素类型 typeName，如 ws:layer'
  if (serviceKind.value === 'WMTS') return '图层名 layer，如 ws:layer'
  return '图层名 layer，如 layername'
})
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

function addLoadedLayer(layer: Omit<LoadedLayer, 'id' | 'visible'>): void {
  loadedLayers.value = [...loadedLayers.value, { ...layer, id: (layerSequence += 1), visible: true }]
}

function toggleLayer(layer: LoadedLayer): void {
  loadedLayers.value = loadedLayers.value.map((item) => {
    if (item !== layer) return item
    const visible = !item.visible
    if (item.imageryLayer) item.imageryLayer.show = visible
    if (item.dataSource) item.dataSource.show = visible
    return { ...item, visible }
  })
}

async function removeLayer(layer: LoadedLayer): Promise<void> {
  if (!viewer) return
  if (layer.imageryLayer) viewer.imageryLayers.remove(layer.imageryLayer, true)
  if (layer.dataSource) await viewer.dataSources.remove(layer.dataSource, true)
  loadedLayers.value = loadedLayers.value.filter((item) => item !== layer)
  if (selectedInfo.value) selectedInfo.value = null
}

function switchKind(kind: ServiceKind): void {
  if (serviceKind.value === kind) return
  serviceKind.value = kind
  if (selectedInfo.value) selectedInfo.value = null
}

function parseBbox(text: string): BBox | undefined {
  const parts = text.split(',').map((part) => Number(part.trim()))
  if (parts.length !== 4 || parts.some((num) => !Number.isFinite(num))) return undefined
  const [west, south, east, north] = parts
  if (east <= west || north <= south) return undefined
  return [west, south, east, north]
}

function flyToBounds(bounds: BBox, padding = 0.08): void {
  if (!viewer || disposed || viewer.isDestroyed()) return
  const [west, south, east, north] = bounds
  if (east - west <= 0 || north - south <= 0) {
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees((west + east) / 2, (south + north) / 2, 1200000)
    })
    return
  }
  const padLon = (east - west) * padding
  const padLat = (north - south) * padding
  viewer.camera.flyTo({
    destination: Rectangle.fromDegrees(west - padLon, south - padLat, east + padLon, north + padLat)
  })
}

function locateLayer(layer: LoadedLayer): void {
  if (!layer.bbox) return
  flyToBounds(layer.bbox)
}

async function loadWfs(name: string): Promise<GeoJsonDataSource> {
  if (!viewer || viewer.isDestroyed()) throw new Error('场景未就绪')
  const params = new URLSearchParams({
    service: 'WFS',
    version: '1.0.0',
    request: 'GetFeature',
    typeName: name,
    srsName: 'EPSG:4326',
    outputFormat: 'application/json'
  })
  const response = await fetch(`${serviceUrl.value.trim()}?${params.toString()}`)
  if (!response.ok) throw new Error(`WFS GetFeature 失败：HTTP ${response.status}`)
  const geojson = await response.json()
  const dataSource = await GeoJsonDataSource.load(geojson, { clampToGround: true })
  await viewer.dataSources.add(dataSource)
  return dataSource
}

async function autoFillBbox(): Promise<void> {
  const url = serviceUrl.value.trim()
  const name = layerName.value.trim()
  if (!url) {
    errorMessage.value = '请先填写服务地址'
    return
  }
  if (!name) {
    errorMessage.value = '请先填写图层名'
    return
  }
  errorMessage.value = ''
  loading.value = true
  try {
    const response = await fetch(capabilitiesUrlFor(serviceKind.value, url))
    if (!response.ok) throw new Error(`获取 Capabilities 失败：HTTP ${response.status}`)
    const xml = await response.text()
    const layers = parseCapabilities(xml, serviceKind.value)
    const matched = layers.find((layer) => layer.name === name)
    if (!matched?.bbox) {
      errorMessage.value = '未找到该图层的范围信息'
      return
    }
    const [west, south, east, north] = matched.bbox
    const round = (value: number) => Number(value.toFixed(6))
    bboxInput.value = `${round(west)},${round(south)},${round(east)},${round(north)}`
  } catch (error) {
    errorMessage.value = `获取范围失败：${toErrorMessage(error)}`
  } finally {
    loading.value = false
  }
}

async function loadSpecified(): Promise<void> {
  if (!viewer) return
  const url = serviceUrl.value.trim()
  const name = layerName.value.trim()
  if (!url) {
    errorMessage.value = '请输入服务地址'
    return
  }
  if (!name) {
    errorMessage.value = '请输入图层名'
    return
  }
  const bbox = parseBbox(bboxInput.value)
  errorMessage.value = ''
  loading.value = true
  try {
    if (serviceKind.value === 'WMS') {
      const provider = new WebMapServiceImageryProvider({
        url,
        layers: name,
        parameters: { transparent: true, format: 'image/png', version: '1.1.1' }
      })
      const imageryLayer = viewer.imageryLayers.addImageryProvider(provider)
      addLoadedLayer({ name, kind: 'WMS', bbox, imageryLayer })
    } else if (serviceKind.value === 'WMTS') {
      const provider = createWmtsImageryProvider(url, name, tileMatrixSet.value.trim())
      const imageryLayer = viewer.imageryLayers.addImageryProvider(provider)
      addLoadedLayer({ name, kind: 'WMTS', bbox, imageryLayer })
    } else {
      const dataSource = await loadWfs(name)
      addLoadedLayer({ name, kind: 'WFS', bbox, dataSource })
      if (!bbox) await viewer.flyTo(dataSource)
    }
    if (bbox) flyToBounds(bbox)
  } catch (error) {
    errorMessage.value = `加载失败：${toErrorMessage(error)}`
  } finally {
    loading.value = false
  }
}

function showEntityInfo(entity: Entity): void {
  if (!entity.properties) return
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

async function queryWmsInfo(position: Cartesian2): Promise<void> {
  if (!viewer || disposed || viewer.isDestroyed()) return
  const currentViewer = viewer
  const wmsLayers = loadedLayers.value.filter(
    (layer) => layer.kind === 'WMS' && layer.visible && layer.imageryLayer
  )
  if (wmsLayers.length === 0) return

  const pickedLocation = currentViewer.camera.pickEllipsoid(
    position,
    currentViewer.scene.globe.ellipsoid
  )
  if (!pickedLocation) return

  const canvas = currentViewer.scene.canvas
  const corners = [
    new Cartesian2(0, 0),
    new Cartesian2(canvas.clientWidth, 0),
    new Cartesian2(canvas.clientWidth, canvas.clientHeight),
    new Cartesian2(0, canvas.clientHeight)
  ]
  const positions = corners
    .map((corner) => currentViewer.camera.pickEllipsoid(corner, currentViewer.scene.globe.ellipsoid))
    .filter((point): point is Cartesian3 => point !== undefined)
  if (positions.length < 4) return

  const cartesians = positions.map((point) => Cartographic.fromCartesian(point))
  const lons = cartesians.map((carto) => (carto.longitude / Math.PI) * 180)
  const lats = cartesians.map((carto) => (carto.latitude / Math.PI) * 180)
  const west = Math.min(...lons)
  const south = Math.min(...lats)
  const east = Math.max(...lons)
  const north = Math.max(...lats)
  const width = canvas.clientWidth
  const height = canvas.clientHeight

  for (const layer of wmsLayers) {
    const params = new URLSearchParams({
      service: 'WMS',
      version: '1.1.1',
      request: 'GetFeatureInfo',
      srs: 'EPSG:4326',
      bbox: `${west},${south},${east},${north}`,
      width: String(width),
      height: String(height),
      x: String(Math.round(position.x)),
      y: String(Math.round(position.y)),
      info_format: 'application/json',
      styles: '',
      layers: layer.name,
      query_layers: layer.name
    })
    try {
      const response = await fetch(`${serviceUrl.value.trim()}?${params.toString()}`)
      if (!response.ok) continue
      const data = await response.json()
      const features = data?.features
      if (Array.isArray(features) && features.length > 0) {
        const properties = features[0]?.properties
        if (properties && typeof properties === 'object') {
          const entries = Object.entries(properties).filter(
            ([, value]) => value !== null && value !== undefined
          )
          selectedInfo.value = {
            name: layer.name,
            properties: entries.map(([key, value]) => [
              key,
              typeof value === 'object' ? JSON.stringify(value) : String(value)
            ])
          }
          return
        }
      }
    } catch {
      continue
    }
  }
  selectedInfo.value = null
}

function handlePick(position: Cartesian2): void {
  if (!viewer || disposed || viewer.isDestroyed()) return
  const picked = viewer.scene.pick(position)
  const entity = picked?.id as Entity | undefined
  if (entity && entity.properties) {
    showEntityInfo(entity)
    return
  }
  selectedInfo.value = null
  void queryWmsInfo(position)
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
      handlePick(movement.position)
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
  <div class="gl-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="gl-panel">
      <div class="panel-title">
        <span>指定图层加载</span>
        <button class="help-btn" aria-label="加载提示" @click="showHelp = true">?</button>
      </div>
      <div class="kind-row">
        <button
          v-for="kind in (['WMS', 'WFS', 'WMTS'] as ServiceKind[])"
          :key="kind"
          class="kind-btn"
          :class="{ active: serviceKind === kind }"
          @click="switchKind(kind)"
        >
          {{ kind }}
        </button>
      </div>
      <input
        v-model="serviceUrl"
        class="url-input"
        placeholder="服务地址，如 .../geoserver/wms"
        @keyup.enter="loadSpecified"
      />
      <input
        v-model="layerName"
        class="url-input"
        :placeholder="layerNamePlaceholder"
        @keyup.enter="loadSpecified"
      />
      <input
        v-if="serviceKind === 'WMTS'"
        v-model="tileMatrixSet"
        class="url-input"
        placeholder="TileMatrixSet，如 EPSG:900913"
        @keyup.enter="loadSpecified"
      />
      <div class="bbox-row">
        <input
          v-model="bboxInput"
          class="url-input"
          placeholder="范围(可选) west,south,east,north"
          @keyup.enter="loadSpecified"
        />
        <button
          class="small-btn"
          :disabled="loading || !serviceUrl.trim() || !layerName.trim()"
          title="自动获取当前图层范围"
          @click="autoFillBbox"
        >
          自动
        </button>
      </div>
      <button
        class="small-btn load-btn"
        :disabled="loading || !serviceUrl.trim() || !layerName.trim()"
        @click="loadSpecified"
      >
        加载指定图层
      </button>

      <div class="layer-list">
        <div v-if="loadedLayers.length === 0" class="layer-empty">暂无已加载图层</div>
        <div v-for="layer in loadedLayers" :key="layer.id" class="layer-item">
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
            <span class="layer-sub">{{ layer.kind }}</span>
          </div>
          <button
            class="layer-locate"
            :class="{ disabled: !layer.bbox }"
            :disabled="!layer.bbox"
            :aria-label="`跳转到 ${layer.name}`"
            :title="layer.bbox ? '跳转到该图层' : '未填写范围，无法定位'"
            @click="locateLayer(layer)"
          >
            ⌖
          </button>
          <button class="layer-remove" :aria-label="`移除 ${layer.name}`" @click="removeLayer(layer)">✕</button>
        </div>
      </div>

      <div v-if="loading" class="loading-tip">加载中…</div>
      <div v-if="errorMessage" class="gl-error">{{ errorMessage }}</div>
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

    <div v-if="showHelp" class="help-mask" @click.self="showHelp = false">
      <div class="help-dialog">
        <div class="help-head">
          <span class="help-title">如何加载指定图层</span>
          <button class="prop-close" aria-label="关闭提示" @click="showHelp = false">✕</button>
        </div>
        <div class="help-body">
          <div class="help-section">
            <div class="help-kind">WMS · 栅格 / 影像</div>
            <div class="help-step"><b>1.</b> 地址填 <code>http://&lt;主机&gt;:&lt;端口&gt;/geoserver/&lt;工作区&gt;/wms</code></div>
            <div class="help-step"><b>2.</b> 图层名填 <code>&lt;图层名&gt;</code></div>
            <div class="help-step"><b>3.</b> 加载后单击地图查询该位置属性</div>
          </div>
          <div class="help-section">
            <div class="help-kind">WFS · 矢量要素</div>
            <div class="help-step"><b>1.</b> 地址填 <code>http://&lt;主机&gt;:&lt;端口&gt;/geoserver/&lt;工作区&gt;/wfs</code></div>
            <div class="help-step"><b>2.</b> 要素类型填 <code>&lt;工作区&gt;:&lt;要素类型名&gt;</code></div>
            <div class="help-step"><b>3.</b> 加载后单击要素查看属性</div>
          </div>
          <div class="help-section">
            <div class="help-kind">WMTS · 全球切片</div>
            <div class="help-step"><b>1.</b> 地址填 <code>http://&lt;主机&gt;:&lt;端口&gt;/geoserver/gwc/service/wmts</code></div>
            <div class="help-step"><b>2.</b> 图层名填 <code>&lt;工作区&gt;:&lt;图层名&gt;</code>，并填写 TileMatrixSet</div>
            <div class="help-step"><b>3.</b> 点击「加载指定图层」</div>
          </div>
          <div class="help-note">提示：范围可填 <code>west,south,east,north</code>（EPSG:4326 十进制），加载后自动跳转并支持定位。</div>
        </div>
      </div>
    </div>

    <div v-if="statusMessage" class="gl-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.gl-shell {
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
.gl-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: 250px;
  padding: 11px;
  border-radius: 9px;
  background: rgba(10, 26, 52, 0.8);
  border: 1px solid rgba(157, 188, 224, 0.22);
  backdrop-filter: blur(6px);
  color: #dce8f5;
}
.panel-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.help-btn {
  flex: 0 0 auto;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  border: 1px solid rgba(157, 188, 224, 0.4);
  background: transparent;
  color: #8ea5c2;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}
.help-btn:hover {
  color: #fff;
  border-color: #5eacf5;
  background: rgba(75, 145, 220, 0.16);
}
.kind-row {
  display: flex;
  gap: 5px;
}
.kind-btn {
  flex: 1;
  padding: 5px 0;
  border-radius: 6px;
  border: 1px solid rgba(157, 188, 224, 0.28);
  background: transparent;
  color: #c4d3e8;
  font-size: 10px;
  cursor: pointer;
}
.kind-btn.active {
  color: #fff;
  border-color: #2f80ed;
  background: rgba(47, 128, 237, 0.24);
}
.url-input {
  width: 100%;
  height: 26px;
  padding: 0 7px;
  border-radius: 6px;
  border: 1px solid rgba(157, 188, 224, 0.24);
  outline: 0;
  background: rgba(8, 21, 40, 0.55);
  color: #e6eef9;
  font-size: 10px;
  box-sizing: border-box;
}
.url-input::placeholder {
  color: #6d84a3;
}
.small-btn {
  padding: 5px 9px;
  border-radius: 6px;
  border: 1px solid rgba(157, 188, 224, 0.28);
  background: transparent;
  color: #c4d3e8;
  font-size: 10px;
  cursor: pointer;
}
.small-btn:hover {
  color: #fff;
  border-color: #5eacf5;
  background: rgba(75, 145, 220, 0.14);
}
.small-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.bbox-row {
  display: flex;
  gap: 5px;
}
.bbox-row .url-input {
  flex: 1;
  min-width: 0;
}
.bbox-row .small-btn {
  flex: 0 0 auto;
}
.load-btn {
  width: 100%;
}
.layer-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 180px;
  overflow-y: auto;
}
.layer-empty {
  padding: 10px 0;
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
.layer-locate {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 0;
  background: transparent;
  color: #8ea5c2;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.layer-locate:hover {
  color: #5eacf5;
  background: rgba(75, 145, 220, 0.14);
}
.layer-locate.disabled {
  opacity: 0.35;
  cursor: default;
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
.gl-error {
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
.help-mask {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(5, 14, 28, 0.55);
}
.help-dialog {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 430px;
  max-height: 80%;
  overflow: hidden;
  border-radius: 10px;
  background: #0d2140;
  border: 1px solid rgba(157, 188, 224, 0.3);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  color: #dce8f5;
}
.help-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(157, 188, 224, 0.16);
}
.help-title {
  font-size: 13px;
  font-weight: 700;
}
.help-body {
  overflow-y: auto;
  padding: 10px 12px 12px;
}
.help-section {
  padding: 8px 0 10px;
  border-bottom: 1px dashed rgba(157, 188, 224, 0.16);
}
.help-section:last-of-type {
  border-bottom: 0;
}
.help-kind {
  font-size: 12px;
  font-weight: 700;
  color: #6db4ff;
}
.help-step {
  font-size: 11px;
  line-height: 1.7;
  color: #c6d5e8;
}
.help-step b {
  color: #6db4ff;
}
.help-step code {
  display: inline-block;
  padding: 1px 5px;
  margin: 1px 0;
  border-radius: 4px;
  background: rgba(75, 145, 220, 0.14);
  color: #8fd0ff;
  font-size: 10px;
  word-break: break-all;
}
.help-note {
  margin-top: 10px;
  padding: 7px 9px;
  border-radius: 6px;
  background: rgba(255, 193, 7, 0.09);
  border: 1px solid rgba(255, 193, 7, 0.24);
  font-size: 10px;
  color: #ffd77a;
  line-height: 1.6;
}
.gl-status {
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
