<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  Cartographic,
  Cesium3DTileset,
  ClippingPlane,
  ClippingPlaneCollection,
  Color,
  HeadingPitchRange,
  Material,
  Plane,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery } from '../../lib/cesium-scene'
import { buildLocalTilesetSample, guessContentType, type SampleFile } from './sample-tileset'

type LocalEntry = { file: File; path: string }
type LogItem = { time: string; message: string; cls: 'info' | 'warn' | 'err' }

const DEFAULT_MAX_SSE = 16

const container = ref<HTMLElement | null>(null)
const panelOpen = ref(true)
const busy = ref(false)
const busyText = ref('正在加载 3DTiles…')
const urlInput = ref('')
const modelName = ref('-')
const modelTiles = ref('-')
const modelGeometry = ref('-')
const modelTexture = ref('-')
const modelPosition = ref('-')
const hasModel = ref(false)
const maxSSE = ref(DEFAULT_MAX_SSE)
const showBounding = ref(false)
const showWireframe = ref(false)
const clipEnabled = ref(false)
const clipOffsetPct = ref(0)
const logs = ref<LogItem[]>([])
const folderInput = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const dragActive = ref(false)
const statusMessage = ref('')

let viewer: Viewer | undefined
let currentTileset: Cesium3DTileset | undefined
let tilesetClipCollection: ClippingPlaneCollection | undefined
let globeClipCollection: ClippingPlaneCollection | undefined
let disposed = false
let statsListenerTileset: Cesium3DTileset | undefined
let statsListenerFn: (() => void) | undefined

const blobUrls: string[] = []
const localFileStore = new Map<string, { buffer: ArrayBuffer; contentType: string }>()
let fileMap = new Map<string, File>()
let tilesetBaseDir = ''

let originalFetch: typeof window.fetch | undefined
let originalXhrOpen: XMLHttpRequest['open'] | undefined
let originalXhrSend: XMLHttpRequest['send'] | undefined
let interceptorsInstalled = false
const localXhrUrls = new WeakMap<XMLHttpRequest, string>()

function log(message: string, cls: LogItem['cls'] = 'info'): void {
  const time = new Date().toLocaleTimeString()
  logs.value.push({ time, message, cls })
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const sizes = ['B', 'KB', 'MB', 'GB']
  const index = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${parseFloat((bytes / Math.pow(1024, index)).toFixed(2))} ${sizes[index]}`
}

function normalizePath(value: string): string {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/')
}

function dirname(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf('/')
  return index === -1 ? '' : normalized.slice(0, index)
}

function joinPath(dir: string, rel: string): string {
  const left = normalizePath(dir)
  const right = normalizePath(rel)
  if (!left) return right
  if (!right) return left
  return `${left}/${right}`
}

// ============ 本地文件内存注册表 + 全局 fetch/XHR 拦截 ============
async function registerLocalFile(blobUrl: string, file: File): Promise<void> {
  if (localFileStore.has(blobUrl)) return
  const buffer = await file.arrayBuffer()
  localFileStore.set(blobUrl, { buffer, contentType: file.type || guessContentType(file.name) })
}

async function registerBlobBytes(blobUrl: string, buffer: ArrayBuffer, contentType: string): Promise<void> {
  localFileStore.set(blobUrl, { buffer, contentType })
}

function installInterceptors(): void {
  if (interceptorsInstalled) return
  originalFetch = window.fetch.bind(window)
  originalXhrOpen = XMLHttpRequest.prototype.open
  originalXhrSend = XMLHttpRequest.prototype.send

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const entry = url ? localFileStore.get(url) : undefined
    if (entry) {
      return new Response(entry.buffer, {
        status: 200,
        headers: { 'Content-Type': entry.contentType }
      })
    }
    if (!originalFetch) return fetch(input, init)
    return originalFetch(input, init)
  }

  XMLHttpRequest.prototype.open = function open(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ): void {
    const urlText = typeof url === 'string' ? url : url.href
    const isLocal = Boolean(urlText && localFileStore.has(urlText))
    originalXhrOpen!.call(this, method, url, async ?? true, username ?? null, password ?? null)
    if (isLocal) {
      localXhrUrls.set(this, urlText)
    } else {
      localXhrUrls.delete(this)
    }
  }

  XMLHttpRequest.prototype.send = function send(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
    const localUrl = localXhrUrls.get(this)
    if (!localUrl) {
      return originalXhrSend!.call(this, body)
    }
    const entry = localFileStore.get(localUrl)
    if (!entry) {
      localXhrUrls.delete(this)
      return originalXhrSend!.call(this, body)
    }
    const request = this
    const responseType = request.responseType || ''
    queueMicrotask(() => {
      Object.defineProperty(request, 'readyState', { value: 4, configurable: true })
      Object.defineProperty(request, 'status', { value: 200, configurable: true })
      if (responseType === 'arraybuffer') {
        Object.defineProperty(request, 'response', { value: entry.buffer.slice(0), configurable: true })
      } else if (responseType === 'blob') {
        Object.defineProperty(request, 'response', {
          value: new Blob([entry.buffer], { type: entry.contentType }),
          configurable: true
        })
      } else if (responseType === 'json') {
        const text = new TextDecoder().decode(entry.buffer)
        Object.defineProperty(request, 'response', { value: JSON.parse(text), configurable: true })
      } else {
        const text = new TextDecoder().decode(entry.buffer)
        Object.defineProperty(request, 'response', { value: text, configurable: true })
        Object.defineProperty(request, 'responseText', { value: text, configurable: true })
      }
      request.dispatchEvent(new Event('readystatechange'))
      request.dispatchEvent(new ProgressEvent('progress', { loaded: entry.buffer.byteLength, total: entry.buffer.byteLength }))
      request.dispatchEvent(new ProgressEvent('load'))
      request.dispatchEvent(new ProgressEvent('loadend'))
    })
  }

  interceptorsInstalled = true
}

function restoreInterceptors(): void {
  if (!interceptorsInstalled) return
  if (originalFetch) window.fetch = originalFetch
  if (originalXhrOpen) XMLHttpRequest.prototype.open = originalXhrOpen
  if (originalXhrSend) XMLHttpRequest.prototype.send = originalXhrSend
  originalFetch = undefined
  originalXhrOpen = undefined
  originalXhrSend = undefined
  interceptorsInstalled = false
}

// ============ 文件收集与 URI 重写 ============
function buildFileMap(entries: LocalEntry[]): Map<string, File> {
  const map = new Map<string, File>()
  for (const { file, path } of entries) {
    const normalized = normalizePath(path)
    if (!map.has(normalized)) map.set(normalized, file)
  }
  return map
}

function findFileInMap(uri: string): File | null {
  if (!uri) return null
  const rel = normalizePath(uri)
  const resolved = joinPath(tilesetBaseDir, rel)
  if (fileMap.has(resolved)) return fileMap.get(resolved) ?? null
  if (fileMap.has(rel)) return fileMap.get(rel) ?? null
  const suffixHits: File[] = []
  const suffixSeen = new Set<File>()
  for (const key of fileMap.keys()) {
    const normalized = normalizePath(key)
    if (
      normalized === resolved ||
      normalized === rel ||
      normalized.endsWith(`/${resolved}`) ||
      normalized.endsWith(`/${rel}`)
    ) {
      const file = fileMap.get(key)
      if (file && !suffixSeen.has(file)) {
        suffixSeen.add(file)
        suffixHits.push(file)
      }
    }
  }
  if (suffixHits.length === 1) return suffixHits[0]
  const baseName = rel.split('/').pop() ?? rel
  const named: File[] = []
  const seen = new Set<File>()
  for (const [key, file] of fileMap) {
    if (key === baseName || key.endsWith(`/${baseName}`)) {
      if (!seen.has(file)) {
        seen.add(file)
        named.push(file)
      }
    }
  }
  if (named.length === 1) return named[0]
  return null
}

async function rewriteUrisAndRegister(node: unknown, cache: Map<string, string>): Promise<void> {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) await rewriteUrisAndRegister(item, cache)
    return
  }
  const record = node as Record<string, unknown>
  for (const key of Object.keys(record)) {
    const value = record[key]
    const isUri =
      (key === 'uri' || key === 'url') &&
      typeof value === 'string' &&
      !value.startsWith('data:') &&
      !value.startsWith('blob:')
    if (isUri) {
      const original = value as string
      let blobUrl = cache.get(original)
      if (!blobUrl) {
        const file = findFileInMap(original)
        if (file) {
          blobUrl = URL.createObjectURL(file)
          blobUrls.push(blobUrl)
          await registerLocalFile(blobUrl, file)
          cache.set(original, blobUrl)
        } else {
          log(`未找到资源文件: ${original}`, 'warn')
        }
      }
      if (blobUrl) record[key] = blobUrl
    }
    if (typeof value === 'object') await rewriteUrisAndRegister(value, cache)
  }
}

function revokeBlobUrls(): void {
  for (const url of blobUrls) URL.revokeObjectURL(url)
  blobUrls.length = 0
  localFileStore.clear()
}

// ============ 模型加载 / 移除 ============
function clearClipCollections(): void {
  const tilesetCast = currentTileset as unknown as { clippingPlanes?: ClippingPlaneCollection | undefined } | undefined
  if (tilesetCast) tilesetCast.clippingPlanes = undefined
  if (viewer && !viewer.isDestroyed()) {
    const globeCast = viewer.scene.globe as unknown as { clippingPlanes?: ClippingPlaneCollection | undefined }
    globeCast.clippingPlanes = undefined
  }
  if (tilesetClipCollection) {
    if (typeof (tilesetClipCollection as unknown as { destroy?: () => void }).destroy === 'function') {
      ;(tilesetClipCollection as unknown as { destroy: () => void }).destroy()
    }
    tilesetClipCollection = undefined
  }
  if (globeClipCollection) {
    if (typeof (globeClipCollection as unknown as { destroy?: () => void }).destroy === 'function') {
      ;(globeClipCollection as unknown as { destroy: () => void }).destroy()
    }
    globeClipCollection = undefined
  }
  if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender()
}

function teardownModel(): void {
  if (statsListenerTileset && statsListenerFn) {
    try {
      statsListenerTileset.tileLoad.removeEventListener(statsListenerFn)
      statsListenerTileset.allTilesLoaded.removeEventListener(statsListenerFn)
    } catch {
      /* noop */
    }
  }
  statsListenerTileset = undefined
  statsListenerFn = undefined
  if (viewer && currentTileset) {
    viewer.scene.primitives.remove(currentTileset)
  }
  currentTileset = undefined
  hasModel.value = false
  modelName.value = '-'
  modelTiles.value = '-'
  modelGeometry.value = '-'
  modelTexture.value = '-'
  modelPosition.value = '-'
  fileMap = new Map()
  tilesetBaseDir = ''
  revokeBlobUrls()
  clearClipCollections()
  if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender()
}

function updateModelInfo(name: string, tileset: Cesium3DTileset): void {
  modelName.value = name
  const stats = tileset.statistics as unknown as {
    numberOfTilesTotal?: number
    geometryByteLength?: number
    texturesByteLength?: number
  }
  if (stats) {
    modelTiles.value = String(stats.numberOfTilesTotal ?? 0)
    modelGeometry.value = formatBytes(stats.geometryByteLength ?? 0)
    modelTexture.value = formatBytes(stats.texturesByteLength ?? 0)
  }
  if (tileset.boundingSphere) {
    const carto = Cartographic.fromCartesian(tileset.boundingSphere.center)
    const toDegrees = (rad: number): number => (rad * 180) / Math.PI
    modelPosition.value = `${toDegrees(carto.longitude).toFixed(6)}, ${toDegrees(carto.latitude).toFixed(6)}, ${carto.height.toFixed(1)}m`
  }
}

async function addTileset(url: string, name: string, skipCleanup = false): Promise<void> {
  if (!viewer || viewer.isDestroyed() || disposed) return
  if (!skipCleanup) teardownModel()
  busy.value = true
  busyText.value = '正在加载 3DTiles…'
  log(`加载 URL: ${url}`)
  try {
    const tileset = await Cesium3DTileset.fromUrl(url, {
      maximumScreenSpaceError: maxSSE.value
    })
    if (!viewer || viewer.isDestroyed() || disposed) return
    currentTileset = tileset
    viewer.scene.primitives.add(tileset)
    hasModel.value = true
    log('3DTiles 加载成功')
    updateModelInfo(name, tileset)
    const refreshStats = (): void => {
      if (viewer && !viewer.isDestroyed() && !disposed && currentTileset === tileset) {
        updateModelInfo(name, tileset)
      }
    }
    tileset.tileLoad.addEventListener(refreshStats)
    tileset.allTilesLoaded.addEventListener(refreshStats)
    statsListenerTileset = tileset
    statsListenerFn = refreshStats
    applyViewSettings()
    if (tileset.boundingSphere) {
      viewer.camera.flyToBoundingSphere(tileset.boundingSphere, {
        duration: 1.5,
        offset: new HeadingPitchRange(0, -0.7, 0)
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`3DTiles 加载失败: ${message}`, 'err')
    statusMessage.value = `加载失败：${message}`
    setTimeout(() => {
      statusMessage.value = ''
    }, 5000)
  } finally {
    busy.value = false
  }
}

async function loadLocalEntries(entries: LocalEntry[]): Promise<void> {
  if (entries.length === 0) return
  const main = entries.find((item) => normalizePath(item.path).toLowerCase().endsWith('tileset.json'))
  if (!main) {
    statusMessage.value = '未找到 tileset.json，请选择包含 3DTiles 数据的文件夹'
    log('未找到 tileset.json', 'err')
    return
  }
  busy.value = true
  busyText.value = '正在加载本地 3DTiles…'
  teardownModel()
  log(`已收集 ${entries.length} 个本地文件`)
  try {
    const text = await main.file.text()
    const tilesetJson = JSON.parse(text)
    fileMap = buildFileMap(entries)
    tilesetBaseDir = dirname(normalizePath(main.path))
    const cache = new Map<string, string>()
    await rewriteUrisAndRegister(tilesetJson, cache)
    log(`已映射 ${cache.size} 个瓦片资源（基准目录: ${tilesetBaseDir || '.'}）`)
    const rewritten = JSON.stringify(tilesetJson)
    const blobUrl = URL.createObjectURL(new Blob([rewritten], { type: 'application/json' }))
    blobUrls.push(blobUrl)
    await registerBlobBytes(blobUrl, new TextEncoder().encode(rewritten).buffer, 'application/json')
    const name = main.path.split('/').pop() ?? main.file.name
    await addTileset(blobUrl, name, true)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`本地 3DTiles 解析失败: ${message}`, 'err')
    statusMessage.value = `解析失败：${message}`
  } finally {
    busy.value = false
  }
}

async function handleFileList(fileList: FileList | File[]): Promise<void> {
  const entries: LocalEntry[] = Array.from(fileList).map((file) => ({
    file,
    path: file.webkitRelativePath || file.name
  }))
  await loadLocalEntries(entries)
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  if (input.files && input.files.length > 0) {
    void handleFileList(input.files)
  }
  input.value = ''
}

function openFolderPicker(): void {
  folderInput.value?.click()
}

function openFilePicker(): void {
  fileInput.value?.click()
}

type DragEntry = { entry: FileSystemEntry; basePath: string }

async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<LocalEntry[]> {
  const items = Array.from(dataTransfer.items)
  const dragEntries: DragEntry[] = []
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.()
    if (entry) dragEntries.push({ entry, basePath: '' })
  }
  if (dragEntries.length === 0) {
    return handleDropFiles(dataTransfer.files)
  }
  const collected = await Promise.all(dragEntries.map((item) => traverseEntry(item)))
  return collected.flat()
}

async function handleDropFiles(fileList: FileList): Promise<LocalEntry[]> {
  const entries: LocalEntry[] = Array.from(fileList).map((file) => ({
    file,
    path: file.webkitRelativePath || file.name
  }))
  return entries
}

function traverseEntry(item: DragEntry): Promise<LocalEntry[]> {
  return new Promise((resolve) => {
    if (item.entry.isFile) {
      const fileEntry = item.entry as FileSystemFileEntry
      fileEntry.file((file) => {
        const path = item.basePath ? `${item.basePath}/${file.name}` : file.name
        resolve([{ file, path }])
      })
    } else if (item.entry.isDirectory) {
      const dirEntry = item.entry as FileSystemDirectoryEntry
      const reader = dirEntry.createReader()
      const allEntries: LocalEntry[] = []
      const readBatch = (): void => {
        reader.readEntries((batch) => {
          if (batch.length === 0) {
            resolve(allEntries)
            return
          }
          const subItems: DragEntry[] = batch.map((entry) => ({
            entry,
            basePath: item.basePath ? `${item.basePath}/${item.entry.name}` : item.entry.name
          }))
          Promise.all(subItems.map((sub) => traverseEntry(sub))).then((results) => {
            for (const result of results) allEntries.push(...result)
            readBatch()
          })
        })
      }
      readBatch()
    } else {
      resolve([])
    }
  })
}

async function onDrop(event: DragEvent): Promise<void> {
  event.preventDefault()
  dragActive.value = false
  if (!event.dataTransfer) return
  const entries = await collectDroppedFiles(event.dataTransfer)
  if (entries.length > 0) await loadLocalEntries(entries)
}

function onDragOver(event: DragEvent): void {
  event.preventDefault()
  dragActive.value = true
}

function onDragLeave(event: DragEvent): void {
  event.preventDefault()
  dragActive.value = false
}

// ============ 显示设置 ============
function geodeticUp(lon: number, lat: number): Cartesian3 {
  const low = Cartesian3.fromRadians(lon, lat, 0)
  const high = Cartesian3.fromRadians(lon, lat, 1000)
  return Cartesian3.normalize(Cartesian3.subtract(high, low, new Cartesian3()), new Cartesian3())
}

function applyClipping(): void {
  if (!viewer || viewer.isDestroyed()) return
  clearClipCollections()
  if (!clipEnabled.value) return
  if (!currentTileset || !currentTileset.boundingSphere) {
    statusMessage.value = '请先加载 3DTiles 模型再启用裁剪平面'
    clipEnabled.value = false
    return
  }
  const carto = Cartographic.fromCartesian(currentTileset.boundingSphere.center)
  const radius = currentTileset.boundingSphere.radius
  const offset = (radius * clipOffsetPct.value) / 100
  const up = geodeticUp(carto.longitude, carto.latitude)
  const down = Cartesian3.negate(up, new Cartesian3())
  const cutPoint = Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height + offset)
  const clipPlane = ClippingPlane.fromPlane(Plane.fromPointNormal(cutPoint, down))
  const makeCollection = (): ClippingPlaneCollection =>
    new ClippingPlaneCollection({
      planes: [clipPlane],
      edgeWidth: 2,
      edgeColor: Color.WHITE
    })
  const tilesetCollection = makeCollection()
  currentTileset.clippingPlanes = tilesetCollection
  tilesetClipCollection = tilesetCollection
  const globeCollection = makeCollection()
  viewer.scene.globe.clippingPlanes = globeCollection
  globeClipCollection = globeCollection
  viewer.scene.requestRender()
}

function applyWireframe(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.scene.globe.material = showWireframe.value ? Material.fromType('Wireframe') : undefined
  viewer.scene.requestRender()
}

function applyViewSettings(): void {
  if (!currentTileset) return
  currentTileset.maximumScreenSpaceError = maxSSE.value
  try {
    currentTileset.debugShowBoundingVolume = showBounding.value
  } catch {
    /* 忽略部分瓦片集不支持的情况 */
  }
  applyWireframe()
  applyClipping()
}

function onMaxSSEChange(): void {
  if (currentTileset) currentTileset.maximumScreenSpaceError = maxSSE.value
}

function onBoundingChange(value: boolean): void {
  showBounding.value = value
  if (currentTileset) {
    try {
      currentTileset.debugShowBoundingVolume = value
    } catch {
      /* noop */
    }
  }
}

function onWireframeChange(value: boolean): void {
  showWireframe.value = value
  applyWireframe()
}

function onClipEnabledChange(value: boolean): void {
  clipEnabled.value = value
  if (value) {
    applyClipping()
  } else {
    clearClipCollections()
  }
}

function onClipOffsetChange(): void {
  if (clipEnabled.value) applyClipping()
}

function locateModel(): void {
  if (!viewer || !currentTileset) return
  if (currentTileset.boundingSphere) {
    viewer.camera.flyToBoundingSphere(currentTileset.boundingSphere, {
      duration: 1.5,
      offset: new HeadingPitchRange(0, -0.7, 0)
    })
  }
}

async function loadSampleModel(): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  statusMessage.value = '正在生成内置示例点云数据…'
  const sampleFiles: SampleFile[] = await buildLocalTilesetSample()
  const entries: LocalEntry[] = sampleFiles.map((item) => ({ file: item.file, path: item.path }))
  statusMessage.value = ''
  await loadLocalEntries(entries)
}

async function loadOnlineModel(): Promise<void> {
  const url = urlInput.value.trim()
  if (!url) {
    statusMessage.value = '请输入 3DTiles 的 tileset.json 地址'
    return
  }
  const name = url.split('/').filter(Boolean).pop() ?? '远程模型'
  await addTileset(url, name)
}

function resetView(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.flyHome(1)
}

onMounted(async () => {
  if (!container.value) return
  installInterceptors()
  const sceneCallbacks = {
    onStatus: (message: string) => {
      statusMessage.value = message
    },
    onBasemapReady: () => {
      statusMessage.value = ''
    }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    log('查看器就绪，请选择本地 3DTiles 文件夹或输入 URL')
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  teardownModel()
  destroyScene(viewer)
  viewer = undefined
  restoreInterceptors()
})
</script>

<template>
  <div class="viewer-shell" :class="{ 'panel-collapsed': !panelOpen }">
    <div ref="container" class="cesium-container"></div>

    <button
      v-if="!panelOpen"
      class="panel-restore"
      title="展开控制面板"
      @click="panelOpen = true"
    >
      ☰
    </button>

    <aside class="side-panel">
      <div class="panel-header">
        <h2>本地 3DTiles 查看器</h2>
        <button class="panel-collapse-btn" title="收起控制面板" @click="panelOpen = false">»</button>
      </div>

      <div class="panel-scroll">
        <section class="section">
          <div class="section-title">模型加载</div>
          <div
            class="upload-area"
            :class="{ 'drag-over': dragActive }"
            @click="openFolderPicker"
            @dragover.prevent="onDragOver"
            @dragleave="onDragLeave"
            @drop.prevent="onDrop"
          >
            <div class="upload-text">
              点击选择包含 <strong>tileset.json</strong> 的文件夹<br />
              或拖拽整个 3DTiles 文件夹到此处
            </div>
          </div>
          <input ref="folderInput" class="hidden-input" type="file" webkitdirectory @change="onFileChange" />
          <input ref="fileInput" class="hidden-input" type="file" multiple @change="onFileChange" />
          <div class="btn-row">
            <button class="btn btn-info btn-block" @click="loadSampleModel">加载内置示例点云</button>
          </div>

          <div class="divider">── 或通过 URL 加载 ──</div>

          <div class="form-group">
            <label>3DTiles URL (指向 tileset.json)</label>
            <input
              v-model="urlInput"
              class="text-input"
              type="text"
              placeholder="http://localhost:8080/tileset.json"
              @keydown.enter="loadOnlineModel"
            />
          </div>
          <button class="btn btn-primary btn-block" @click="loadOnlineModel">加载在线模型</button>

          <div class="tip">
            本地数据支持 b3dm / i3dm / pnts / cmpt / gltf 瓦片。<br />
            也可先使用 <code>python -m http.server</code> 再填入 URL。
          </div>
        </section>

        <section class="section">
          <div class="section-title">模型信息</div>
          <div class="model-info" :class="{ empty: !hasModel }">
            <template v-if="hasModel">
              <div>名称：<b>{{ modelName }}</b></div>
              <div>瓦片数：<b>{{ modelTiles }}</b></div>
              <div>几何字节：<b>{{ modelGeometry }}</b></div>
              <div>纹理字节：<b>{{ modelTexture }}</b></div>
              <div>中心位置：<b>{{ modelPosition }}</b></div>
            </template>
            <template v-else>尚未加载模型</template>
          </div>
        </section>

        <section class="section">
          <div class="section-title">显示设置</div>
          <div class="slider-group">
            <label>最大屏幕空间误差 <span>{{ maxSSE }}</span></label>
            <input type="range" min="1" max="128" step="1" :value="maxSSE" @input="maxSSE = Number(($event.target as HTMLInputElement).value); onMaxSSEChange()" />
          </div>
          <label class="check-row">
            <input type="checkbox" :checked="showBounding" @change="onBoundingChange(($event.target as HTMLInputElement).checked)" />
            显示包围盒
          </label>
          <label class="check-row">
            <input type="checkbox" :checked="showWireframe" @change="onWireframeChange(($event.target as HTMLInputElement).checked)" />
            线框模式（地表）
          </label>
          <label class="check-row">
            <input type="checkbox" :checked="clipEnabled" @change="onClipEnabledChange(($event.target as HTMLInputElement).checked)" />
            启用裁剪平面
          </label>
          <div v-if="clipEnabled" class="slider-group">
            <label>裁剪高度偏移 <span>{{ clipOffsetPct }}%</span></label>
            <input type="range" min="-100" max="100" step="1" :value="clipOffsetPct" @input="clipOffsetPct = Number(($event.target as HTMLInputElement).value); onClipOffsetChange()" />
          </div>
        </section>

        <section class="section">
          <div class="section-title">操作</div>
          <div class="btn-row">
            <button class="btn btn-primary" :disabled="!hasModel" @click="locateModel">定位到模型</button>
            <button class="btn btn-danger" :disabled="!hasModel" @click="teardownModel">移除模型</button>
          </div>
          <div class="btn-row">
            <button class="btn btn-info" @click="resetView">返回默认视角</button>
          </div>
        </section>

        <section class="section last">
          <div class="section-title">加载日志</div>
          <div class="log-area">
            <div v-for="(item, index) in logs" :key="index" :class="item.cls">[{{ item.time }}] {{ item.message }}</div>
            <div v-if="logs.length === 0" class="log-empty">暂无日志</div>
          </div>
        </section>
      </div>
    </aside>

    <div v-if="busy" class="busy-overlay">
      <div class="spinner"></div>
      <span>{{ busyText }}</span>
    </div>
    <div v-if="statusMessage" class="status-toast">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.viewer-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 420px;
  overflow: hidden;
  border-radius: 10px;
  background: #152b4c;
}
.cesium-container {
  position: absolute;
  inset: 0;
}
.hidden-input {
  display: none;
}
.side-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  width: 300px;
  max-height: calc(100% - 24px);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  border: 1px solid rgba(157, 188, 224, 0.28);
  border-radius: 9px;
  background: rgba(10, 26, 52, 0.9);
  backdrop-filter: blur(6px);
  color: #dce8f5;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.28);
  transition: transform 0.28s ease, opacity 0.2s ease;
}
.viewer-shell.panel-collapsed .side-panel {
  transform: translateX(calc(100% + 22px));
  opacity: 0;
  pointer-events: none;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  padding: 10px 12px 9px;
  border-bottom: 1px solid rgba(157, 188, 224, 0.2);
}
.panel-header h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #eaf3ff;
}
.panel-collapse-btn {
  flex: 0 0 auto;
  width: 22px;
  height: 20px;
  margin-left: 8px;
  padding: 0;
  border: 1px solid rgba(157, 188, 224, 0.45);
  border-radius: 4px;
  background: rgba(23, 48, 88, 0.6);
  color: #cfe5ff;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.panel-collapse-btn:hover {
  background: rgba(47, 128, 237, 0.3);
  color: #fff;
}
.panel-restore {
  position: absolute;
  top: 12px;
  right: 14px;
  z-index: 10;
  padding: 8px 12px;
  border: 1px solid rgba(157, 188, 224, 0.45);
  border-radius: 7px;
  background: rgba(10, 26, 52, 0.92);
  color: #cfe5ff;
  font-size: 16px;
  cursor: pointer;
}
.panel-restore:hover {
  background: rgba(47, 128, 237, 0.3);
}
.panel-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.panel-scroll::-webkit-scrollbar {
  width: 5px;
}
.panel-scroll::-webkit-scrollbar-thumb {
  background: rgba(157, 188, 224, 0.35);
  border-radius: 3px;
}
.section {
  padding: 11px 14px;
  border-bottom: 1px solid rgba(157, 188, 224, 0.12);
}
.section.last {
  padding-bottom: 18px;
}
.section-title {
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: #8ea5c2;
}
.form-group {
  margin-bottom: 9px;
}
.form-group label {
  display: block;
  margin-bottom: 4px;
  font-size: 11px;
  font-weight: 500;
  color: #c3d5e8;
}
.text-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  border: 1px solid rgba(157, 188, 224, 0.3);
  border-radius: 4px;
  background: rgba(20, 43, 80, 0.75);
  color: #dce8f5;
  font-size: 12px;
  outline: none;
}
.text-input:focus {
  border-color: rgba(47, 128, 237, 0.7);
}
.slider-group {
  margin-bottom: 9px;
}
.slider-group label {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 11px;
  font-weight: 500;
  color: #c3d5e8;
}
.slider-group label span {
  font-weight: 600;
  color: #bfe3ff;
}
.slider-group input[type='range'] {
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  border-radius: 2px;
  background: rgba(157, 188, 224, 0.3);
  outline: none;
}
.slider-group input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(10, 26, 52, 0.9);
  border-radius: 50%;
  background: #5b9cf5;
  cursor: pointer;
}
.check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  color: #d6e6f8;
  cursor: pointer;
}
.check-row input[type='checkbox'] {
  width: 14px;
  height: 14px;
  accent-color: #2f80ed;
  cursor: pointer;
}
.btn-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.btn {
  padding: 7px 14px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-block {
  width: 100%;
  margin-bottom: 8px;
}
.btn-primary {
  background: #2f80ed;
  color: #eef4ff;
}
.btn-primary:hover {
  background: #3f96ff;
}
.btn-danger {
  flex: 1;
  background: #b2453e;
  color: #ffe9e7;
}
.btn-danger:hover {
  background: #cf554f;
}
.btn-info {
  background: rgba(47, 128, 237, 0.16);
  border: 1px solid rgba(157, 188, 224, 0.4);
  color: #cfe5ff;
}
.btn-info:hover {
  background: rgba(47, 128, 237, 0.3);
  color: #fff;
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.upload-area {
  padding: 18px 10px;
  margin-bottom: 10px;
  text-align: center;
  cursor: pointer;
  border: 2px dashed rgba(157, 188, 224, 0.45);
  border-radius: 8px;
  transition: all 0.3s;
}
.upload-area:hover {
  border-color: rgba(157, 188, 224, 0.65);
  background: rgba(23, 48, 88, 0.35);
}
.upload-area.drag-over {
  border-color: rgba(157, 188, 224, 0.95);
  background: rgba(47, 128, 237, 0.25);
}
.upload-text {
  font-size: 11px;
  color: #c3d5e8;
  line-height: 1.6;
}
.divider {
  margin: 10px 0;
  text-align: center;
  font-size: 11px;
  color: #7f96b3;
}
.tip {
  margin-top: 6px;
  padding: 7px 9px;
  font-size: 10px;
  line-height: 1.6;
  color: #9bb4cc;
  background: rgba(23, 48, 88, 0.45);
  border-radius: 4px;
}
.tip code {
  padding: 1px 4px;
  background: rgba(0, 0, 0, 0.28);
  border-radius: 2px;
  color: #bfe3ff;
  font-family: Consolas, monospace;
}
.model-info {
  padding: 8px 10px;
  border: 1px solid rgba(157, 188, 224, 0.18);
  border-radius: 6px;
  background: rgba(23, 48, 88, 0.45);
  font-size: 11px;
  line-height: 1.8;
  color: #c3d5e8;
}
.model-info b {
  font-weight: 600;
  color: #eaf3ff;
  word-break: break-all;
}
.model-info.empty {
  color: #7f96b3;
}
.log-area {
  max-height: 118px;
  padding: 6px;
  overflow-y: auto;
  font-family: Consolas, monospace;
  font-size: 10px;
  line-height: 1.6;
  color: #9ec49e;
  background: rgba(8, 16, 32, 0.72);
  border-radius: 4px;
}
.log-area .warn {
  color: #e0b45a;
}
.log-area .err {
  color: #e07070;
}
.log-empty {
  color: #6a7e94;
}
.busy-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(6, 16, 32, 0.62);
  color: #bfe3ff;
  font-size: 12px;
}
.spinner {
  width: 40px;
  height: 40px;
  margin-bottom: 12px;
  border: 3px solid rgba(157, 188, 224, 0.25);
  border-top-color: #5b9cf5;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.status-toast {
  position: absolute;
  top: 14px;
  left: 50%;
  z-index: 30;
  transform: translateX(-50%);
  width: max-content;
  max-width: 440px;
  padding: 8px 14px;
  border: 1px solid rgba(137, 210, 233, 0.4);
  border-radius: 7px;
  background: rgba(8, 21, 40, 0.9);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35);
  color: #e8f4fa;
  font-size: 12px;
  line-height: 1.5;
  pointer-events: none;
  text-align: center;
}
</style>
