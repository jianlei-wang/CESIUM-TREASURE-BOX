<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  Color,
  DirectionalLight,
  HeadingPitchRoll,
  Matrix4,
  Model,
  ShadowMode,
  SunLight,
  Transforms,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  setTerrainEnabled,
  type SceneCallbacks
} from '../../lib/cesium-scene'

type EntryFile = { file: File; path: string }

const ACCEPT_EXT = '.gltf,.glb,.bin,.png,.jpg,.jpeg,.ktx2,.basis'

const container = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)
const panelOpen = ref(true)
const busy = ref(false)
const statusText = ref('正在加载 Bing 地图…')
const modelUrlText = ref('')

const hasModel = ref(false)
const infoFilename = ref('')
const infoType = ref('')
const infoPosition = ref('')
const infoScale = ref('')
const dragActive = ref(false)

const lon = ref(116.3912)
const lat = ref(39.906)
const height = ref(0)
const heading = ref(0)
const pitch = ref(0)
const roll = ref(0)

const scaleUniform = ref(1)
const scaleX = ref(1)
const scaleY = ref(1)
const scaleZ = ref(1)
const lockScale = ref(true)

const showBounding = ref(false)
const showWireframe = ref(false)
const enableShadows = ref(false)
const enableSilhouette = ref(false)
const opacity = ref(1)
const tintColor = ref('#ffffff')
const autoRotate = ref(false)
const rotSpeed = ref(10)
const showTerrain = ref(true)
const terrainBusy = ref(false)
const enableLighting = ref(false)

let viewer: Viewer | undefined
let model: Model | undefined
let disposed = false
let autoRotateId: number | undefined
let lastRotateTs = 0
const blobUrls: string[] = []

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function normalizeDeg(deg: number): number {
  let value = deg
  while (value > 180) value -= 360
  while (value < -180) value += 360
  return value
}

function toast(message: string): void {
  statusText.value = message
  if (window.__gltfViewerState) window.__gltfViewerState.statusLast = message
  window.setTimeout(() => {
    if (!disposed && statusText.value === message) statusText.value = ''
  }, 4000)
}

function buildModelMatrix(): Matrix4 {
  const position = Cartesian3.fromDegrees(lon.value, lat.value, height.value)
  const hpr = new HeadingPitchRoll(toRad(heading.value), toRad(pitch.value), toRad(roll.value))
  return Transforms.headingPitchRollToFixedFrame(position, hpr)
}

function isModelAlive(): boolean {
  return !!viewer && !viewer.isDestroyed() && !!model
}

function applyPosition(): void {
  if (!model || !viewer || viewer.isDestroyed()) return
  const base = buildModelMatrix()
  if (lockScale.value) {
    model.scale = Math.max(scaleUniform.value, 0.001)
    model.modelMatrix = base
  } else {
    model.scale = 1
    const sx = Math.max(scaleX.value, 0.001)
    const sy = Math.max(scaleY.value, 0.001)
    const sz = Math.max(scaleZ.value, 0.001)
    const scaleMatrix = Matrix4.fromScale(new Cartesian3(sx, sy, sz))
    model.modelMatrix = Matrix4.multiply(base, scaleMatrix, new Matrix4())
  }
  refreshInfoScale()
  refreshInfoPosition()
}

function buildTint(): Color {
  const base = Color.fromCssColorString(tintColor.value) ?? Color.WHITE
  base.alpha = Math.min(Math.max(opacity.value, 0), 1)
  return base
}

function toggleSceneLight(): void {
  const scene = viewer?.scene
  if (!scene || viewer?.isDestroyed()) return
  if (enableShadows.value && model) {
    if (!(scene.light instanceof DirectionalLight)) {
      scene.light = new DirectionalLight({
        direction: new Cartesian3(-0.5, -0.6, 0.7),
        intensity: 3.0
      })
    }
  } else if (scene.light instanceof DirectionalLight) {
    scene.light = new SunLight()
  }
}

function applyAppearance(): void {
  if (!viewer || viewer.isDestroyed()) return
  const scene = viewer.scene
  if (model) {
    try {
      model.debugShowBoundingVolume = showBounding.value
    } catch {
      /* 运行时不支持时忽略 */
    }
    try {
      model.debugWireframe = showWireframe.value
    } catch {
      /* 运行时不支持时忽略 */
    }
    try {
      model.silhouetteSize = enableSilhouette.value ? 2 : 0
      model.silhouetteColor = Color.WHITE
    } catch {
      /* 运行时不支持时忽略 */
    }
    try {
      model.shadows = enableShadows.value ? ShadowMode.ENABLED : ShadowMode.DISABLED
    } catch {
      /* 运行时不支持时忽略 */
    }
    try {
      model.color = buildTint()
    } catch {
      /* 运行时不支持时忽略 */
    }
  }
  scene.globe.enableLighting = enableLighting.value
  scene.shadowMap.enabled = enableShadows.value && !!model
  toggleSceneLight()
}

function stopAutoRotate(): void {
  if (autoRotateId !== undefined) {
    cancelAnimationFrame(autoRotateId)
    autoRotateId = undefined
  }
}

function autoRotateFrame(timestamp: number): void {
  if (!autoRotate.value || !isModelAlive()) {
    autoRotateId = undefined
    return
  }
  if (lastRotateTs === 0) lastRotateTs = timestamp
  const delta = Math.min(0.1, Math.max(0, (timestamp - lastRotateTs) / 1000))
  lastRotateTs = timestamp
  if (delta > 0) {
    heading.value = normalizeDeg(heading.value + rotSpeed.value * delta)
    applyPosition()
  }
  autoRotateId = window.requestAnimationFrame(autoRotateFrame)
}

function applyAutoRotate(): void {
  stopAutoRotate()
  if (autoRotate.value && isModelAlive()) {
    lastRotateTs = 0
    autoRotateId = window.requestAnimationFrame(autoRotateFrame)
  }
}

function removeModel(): void {
  stopAutoRotate()
  if (model && viewer && !viewer.isDestroyed()) {
    viewer.scene.primitives.remove(model)
  }
  model = undefined
  window.__gltfModel = undefined
  hasModel.value = false
  window.__gltfViewerState = { ok: false, filename: '', type: 'gltf', primitives: viewer && !viewer.isDestroyed() ? viewer.scene.primitives.length : 0, lon: lon.value, lat: lat.value, height: height.value }
  for (const url of blobUrls) URL.revokeObjectURL(url)
  blobUrls.length = 0
}

function refreshInfoScale(): void {
  infoScale.value = lockScale.value ? scaleUniform.value.toFixed(2) : `X${scaleX.value.toFixed(2)}·Y${scaleY.value.toFixed(2)}·Z${scaleZ.value.toFixed(2)}`
}

function refreshInfoPosition(): void {
  infoPosition.value = `${lon.value.toFixed(4)}, ${lat.value.toFixed(4)}, ${height.value.toFixed(1)}m`
}

function updateModelInfo(name: string, kind: 'glb' | 'gltf'): void {
  hasModel.value = true
  infoFilename.value = name
  infoType.value = kind === 'glb' ? 'Binary glTF' : 'glTF'
  refreshInfoScale()
  refreshInfoPosition()
  const primitives = viewer && !viewer.isDestroyed() ? viewer.scene.primitives.length : 0
  window.__gltfViewerState = {
    ok: true,
    filename: name,
    type: kind,
    primitives,
    lon: lon.value,
    lat: lat.value,
    height: height.value
  }
}

function locateModel(): void {
  if (!isModelAlive()) {
    toast('请先加载一个模型')
    return
  }
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(lon.value, lat.value, height.value + 200),
    orientation: {
      heading: toRad(heading.value),
      pitch: toRad(-30),
      roll: 0
    },
    duration: 1.5
  })
}

function resetParams(): void {
  lon.value = 116.3912
  lat.value = 39.906
  height.value = 0
  heading.value = 0
  pitch.value = 0
  roll.value = 0
  scaleUniform.value = 1
  scaleX.value = 1
  scaleY.value = 1
  scaleZ.value = 1
  lockScale.value = true
  showBounding.value = false
  showWireframe.value = false
  enableShadows.value = false
  enableSilhouette.value = false
  opacity.value = 1
  tintColor.value = '#ffffff'
  autoRotate.value = false
  rotSpeed.value = 10
  enableLighting.value = false
  applyPosition()
  applyAppearance()
  applyAutoRotate()
}

function loadModelFromUrl(url: string, name?: string): void {
  const clean = url.trim()
  if (!clean) {
    toast('请输入模型 URL')
    return
  }
  const ext = clean.split('?')[0].split('.').pop()?.toLowerCase()
  const kind = ext === 'glb' ? ('glb' as const) : ('gltf' as const)
  removeModel()
  loadByUrl(clean, name || clean.split('/').pop() || '在线模型', kind)
}

async function loadByUrl(url: string, name: string, kind: 'glb' | 'gltf'): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  busy.value = true
  const base = buildModelMatrix()
  try {
    const created = await Model.fromGltfAsync({
      url,
      modelMatrix: base,
      scale: 1,
      minimumPixelSize: 0,
      asynchronous: true,
      silhouetteColor: Color.WHITE,
      silhouetteSize: 0,
      shadows: ShadowMode.DISABLED
    })
    if (disposed || !viewer || viewer.isDestroyed()) {
      created.destroy()
      return
    }
    model = viewer.scene.primitives.add(created) as Model
    window.__gltfModel = model
    updateModelInfo(name, kind)
    applyAppearance()
    applyPosition()
    applyAutoRotate()
    created.readyEvent.addEventListener(() => {
      if (!disposed) {
        applyAppearance()
        applyPosition()
      }
    })
    created.errorEvent.addEventListener(() => {
      toast('模型渲染过程中出现错误')
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    toast(`模型加载失败：${message}`)
  } finally {
    busy.value = false
  }
}

function normalizePath(value: string): string {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/')
}

function buildFileMap(files: EntryFile[]): Map<string, File> {
  const map = new Map<string, File>()
  for (const { file, path } of files) {
    const normalized = normalizePath(path)
    if (!map.has(normalized)) map.set(normalized, file)
    if (!map.has(file.name)) map.set(file.name, file)
  }
  return map
}

function findFileInMap(uri: string, fileMap: Map<string, File>): File | null {
  if (!uri) return null
  const rel = normalizePath(uri)
  const baseName = rel.split('/').pop() ?? rel
  if (fileMap.has(rel)) return fileMap.get(rel) ?? null
  if (fileMap.has(baseName)) return fileMap.get(baseName) ?? null
  for (const key of fileMap.keys()) {
    const normalized = normalizePath(key)
    if (
      normalized === rel ||
      normalized.endsWith('/' + rel) ||
      normalized.endsWith(rel) ||
      rel.endsWith('/' + normalized) ||
      rel === normalized
    ) {
      return fileMap.get(key) ?? null
    }
  }
  return null
}

function rewriteUris(node: unknown, fileMap: Map<string, File>, cache: Map<string, string>): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) rewriteUris(item, fileMap, cache)
    return
  }
  for (const key of Object.keys(node as Record<string, unknown>)) {
    const value = (node as Record<string, unknown>)[key]
    const isUri =
      (key === 'uri' || key === 'url') &&
      typeof value === 'string' &&
      !value.startsWith('data:') &&
      !value.startsWith('blob:')
    if (isUri) {
      const target = value as string
      if (!cache.has(target)) {
        const file = findFileInMap(target, fileMap)
        if (file) {
          const blobUrl = URL.createObjectURL(file)
          blobUrls.push(blobUrl)
          cache.set(target, blobUrl)
        }
      }
      const rewritten = cache.get(target)
      if (rewritten) (node as Record<string, unknown>)[key] = rewritten
    }
    if (typeof value === 'object') rewriteUris(value, fileMap, cache)
  }
}

async function loadLocalFiles(files: EntryFile[]): Promise<void> {
  if (files.length === 0) return
  const main = files.find((item) => /\.(glb|gltf)$/i.test(item.path))
  if (!main) {
    toast('请选择 .glb 或 .gltf 文件')
    return
  }
  busy.value = true
  removeModel()
  const file = main.file
  const name = main.path.split('/').pop() ?? file.name
  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'gltf'
  try {
    if (extension === 'glb') {
      const buffer = await file.arrayBuffer()
      const blobUrl = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }))
      blobUrls.push(blobUrl)
      await loadByUrl(blobUrl, name, 'glb')
    } else {
      const text = await file.text()
      const gltf = JSON.parse(text) as Record<string, unknown>
      const fileMap = buildFileMap(files)
      const cache = new Map<string, string>()
      rewriteUris(gltf, fileMap, cache)
      const jsonBlob = new Blob([JSON.stringify(gltf)], { type: 'application/json' })
      const blobUrl = URL.createObjectURL(jsonBlob)
      blobUrls.push(blobUrl)
      await loadByUrl(blobUrl, name, 'gltf')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    toast(`glTF 文件解析失败：${message}`)
  } finally {
    busy.value = false
  }
}

function handleFileList(fileList: FileList | File[]): void {
  const entries: EntryFile[] = Array.from(fileList).map((file) => ({
    file,
    path: file.webkitRelativePath || file.name
  }))
  void loadLocalFiles(entries)
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  if (input.files && input.files.length > 0) {
    handleFileList(input.files)
  }
  input.value = ''
}

function openFolderPicker(): void {
  folderInput.value?.click()
}

function onDrop(event: DragEvent): void {
  event.preventDefault()
  dragActive.value = false
  if (!event.dataTransfer) return
  void collectDroppedFiles(event.dataTransfer).then((entries) => {
    if (entries.length > 0) void loadLocalFiles(entries)
  })
}

function onDragOver(event: DragEvent): void {
  event.preventDefault()
  dragActive.value = true
}

function onDragLeave(event: DragEvent): void {
  event.preventDefault()
  dragActive.value = false
}

type DragEntry = { entry: FileSystemEntry; basePath: string }

async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<EntryFile[]> {
  const items = Array.from(dataTransfer.items)
  const dragEntries: DragEntry[] = []
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.()
    if (entry) dragEntries.push({ entry, basePath: '' })
  }
  const collected = await Promise.all(dragEntries.map((item) => traverseEntry(item)))
  return collected.flat()
}

function traverseEntry(item: DragEntry): Promise<EntryFile[]> {
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
      const allEntries: EntryFile[] = []
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

function loadRemoteModel(): void {
  loadModelFromUrl(modelUrlText.value)
}

async function toggleTerrain(enabled: boolean): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  terrainBusy.value = true
  try {
    await setTerrainEnabled(viewer, enabled)
    if (disposed || viewer.isDestroyed()) return
    toast(enabled ? '已切换为 Cesium World Terrain 地形' : '已切换为椭球表面（无地形）')
  } catch {
    if (!disposed && !viewer.isDestroyed()) {
      toast('地形服务加载失败，请重试或关闭地形')
      showTerrain.value = !enabled
    }
  } finally {
    terrainBusy.value = false
  }
}

function updateHeading(value: number): void {
  heading.value = value
  if (isModelAlive()) applyPosition()
}

function updatePitch(value: number): void {
  pitch.value = value
  if (isModelAlive()) applyPosition()
}

function updateRoll(value: number): void {
  roll.value = value
  if (isModelAlive()) applyPosition()
}

function updateScaleUniform(value: number): void {
  scaleUniform.value = value
  if (lockScale.value) {
    scaleX.value = value
    scaleY.value = value
    scaleZ.value = value
  }
  if (isModelAlive()) applyPosition()
}

function updateScaleAxis(axis: 'x' | 'y' | 'z', value: number): void {
  if (axis === 'x') scaleX.value = value
  if (axis === 'y') scaleY.value = value
  if (axis === 'z') scaleZ.value = value
  if (lockScale.value) {
    scaleUniform.value = value
    scaleX.value = value
    scaleY.value = value
    scaleZ.value = value
  }
  if (isModelAlive()) applyPosition()
}

function updateLockScale(): void {
  if (lockScale.value) {
    scaleX.value = scaleUniform.value
    scaleY.value = scaleUniform.value
    scaleZ.value = scaleUniform.value
  }
  if (isModelAlive()) applyPosition()
}

function updateAppearance(): void {
  if (isModelAlive()) applyAppearance()
}

function updateOpacity(value: number): void {
  opacity.value = value
  updateAppearance()
}

function updateTint(value: string): void {
  tintColor.value = value
  updateAppearance()
}

function toggleAutoRotate(): void {
  applyAutoRotate()
}

function updateRotSpeed(value: number): void {
  rotSpeed.value = value
  if (autoRotate.value) applyAutoRotate()
}

onMounted(() => {
  if (!container.value) return
  const callbacks: SceneCallbacks = {
    onStatus: (message) => {
      statusText.value = message
    },
    onBasemapReady: () => {
      statusText.value = ''
    }
  }
  try {
    viewer = createMapScene(container.value, callbacks)
    loadBingImagery(viewer, callbacks)
    if (showTerrain.value) {
      void toggleTerrain(true)
    }
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(116.3912, 39.906, 1200),
      orientation: {
        heading: 0,
        pitch: toRad(-55),
        roll: 0
      },
      duration: 0
    })
  } catch (error) {
    statusText.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  stopAutoRotate()
  if (model && viewer && !viewer.isDestroyed()) {
    viewer.scene.primitives.remove(model)
  }
  model = undefined
  window.__gltfModel = undefined
  for (const url of blobUrls) URL.revokeObjectURL(url)
  blobUrls.length = 0
  destroyScene(viewer)
  viewer = undefined
})

declare global {
  interface Window {
    __gltfViewerState?: {
      ok: boolean
      filename: string
      type: 'glb' | 'gltf'
      primitives: number
      lon: number
      lat: number
      height: number
      statusLast?: string
    }
    __gltfModel?: unknown
  }
}
</script>

<template>
  <div class="model-shell" :class="{ 'panel-collapsed': !panelOpen }">
    <div ref="container" class="cesium-wrap"></div>

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
        <h2>glTF / GLB 模型查看器</h2>
        <button class="panel-collapse-btn" title="收起控制面板" @click="panelOpen = false">
          »
        </button>
      </div>

      <div class="panel-scroll">
        <section class="section">
        <div class="section-title">模型加载</div>
        <div
          class="upload-area"
          :class="{ 'drag-over': dragActive }"
          @click="fileInput?.click()"
          @dragover.prevent="onDragOver"
          @dragleave="onDragLeave"
          @drop.prevent="onDrop"
        >
          <div class="upload-icon">📂</div>
          <div class="upload-text">点击或拖拽 glTF/GLB 文件到此处<br />支持文件与整个文件夹</div>
        </div>
        <input
          ref="fileInput"
          class="hidden-input"
          type="file"
          :accept="ACCEPT_EXT"
          multiple
          @change="onFileChange"
        />
        <input
          ref="folderInput"
          class="hidden-input"
          type="file"
          webkitdirectory
          @change="onFileChange"
        />
        <button class="btn btn-primary btn-block" @click="openFolderPicker">选择模型文件夹</button>

        <div class="divider">或</div>

        <label class="field-label">在线模型 URL</label>
        <input
          v-model="modelUrlText"
          class="text-input"
          type="text"
          placeholder="https://example.com/model.glb"
          @keydown.enter="loadRemoteModel"
        />
        <button class="btn btn-primary btn-block" @click="loadRemoteModel">加载在线模型</button>
      </section>

      <section class="section">
        <div class="section-title">模型信息</div>
        <div v-if="hasModel" class="model-info">
          <div>文件名：<b>{{ infoFilename }}</b></div>
          <div>类型：<b>{{ infoType }}</b></div>
          <div>位置：<b>{{ infoPosition }}</b></div>
          <div>比例：<b>{{ infoScale }}</b></div>
        </div>
        <div v-else class="model-info empty">尚未加载模型</div>
      </section>

      <section class="section">
        <div class="section-title">操作</div>
        <button class="btn btn-info btn-block" @click="locateModel">📍 定位到模型</button>
      </section>

      <section class="section">
        <div class="section-title">位置</div>
        <div class="form-row">
          <div class="form-group">
            <label>经度 (°)</label>
            <input
              v-model.number="lon"
              class="num-input"
              type="number"
              step="0.0001"
              @change="isModelAlive() && applyPosition()"
            />
          </div>
          <div class="form-group">
            <label>纬度 (°)</label>
            <input
              v-model.number="lat"
              class="num-input"
              type="number"
              step="0.0001"
              @change="isModelAlive() && applyPosition()"
            />
          </div>
        </div>
        <div class="form-group">
          <label>高度 (m)</label>
          <input
            v-model.number="height"
            class="num-input"
            type="number"
            step="1"
            @change="isModelAlive() && applyPosition()"
          />
        </div>
      </section>

      <section class="section">
        <div class="section-title">旋转</div>
        <div class="slider-group">
          <label>航向角 <span>{{ heading.toFixed(1) }}°</span></label>
          <input
            type="range"
            min="-180"
            max="180"
            step="0.5"
            :value="heading"
            @input="updateHeading(Number(($event.target as HTMLInputElement).value))"
          />
        </div>
        <div class="slider-group">
          <label>俯仰角 <span>{{ pitch.toFixed(1) }}°</span></label>
          <input
            type="range"
            min="-180"
            max="180"
            step="0.5"
            :value="pitch"
            @input="updatePitch(Number(($event.target as HTMLInputElement).value))"
          />
        </div>
        <div class="slider-group">
          <label>翻滚角 <span>{{ roll.toFixed(1) }}°</span></label>
          <input
            type="range"
            min="-180"
            max="180"
            step="0.5"
            :value="roll"
            @input="updateRoll(Number(($event.target as HTMLInputElement).value))"
          />
        </div>
      </section>

      <section class="section">
        <div class="section-title">缩放</div>
        <div class="slider-group">
          <label>统一缩放 <span>{{ scaleUniform.toFixed(2) }}</span></label>
          <input
            type="range"
            min="0.001"
            max="1000"
            step="0.01"
            :value="scaleUniform"
            @input="updateScaleUniform(Number(($event.target as HTMLInputElement).value))"
          />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>X</label>
            <input
              v-model.number="scaleX"
              class="num-input"
              type="number"
              min="0.001"
              step="0.01"
              @change="updateScaleAxis('x', scaleX)"
            />
          </div>
          <div class="form-group">
            <label>Y</label>
            <input
              v-model.number="scaleY"
              class="num-input"
              type="number"
              min="0.001"
              step="0.01"
              @change="updateScaleAxis('y', scaleY)"
            />
          </div>
          <div class="form-group">
            <label>Z</label>
            <input
              v-model.number="scaleZ"
              class="num-input"
              type="number"
              min="0.001"
              step="0.01"
              @change="updateScaleAxis('z', scaleZ)"
            />
          </div>
        </div>
        <label class="check-row">
          <input v-model="lockScale" type="checkbox" @change="updateLockScale" />
          锁定统一缩放
        </label>
      </section>

      <section class="section">
        <div class="section-title">外观</div>
        <label class="check-row">
          <input v-model="showBounding" type="checkbox" @change="updateAppearance" />
          显示包围盒
        </label>
        <label class="check-row">
          <input v-model="showWireframe" type="checkbox" @change="updateAppearance" />
          线框模式
        </label>
        <div class="slider-group">
          <label>透明度 <span>{{ opacity.toFixed(2) }}</span></label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="opacity"
            @input="updateOpacity(Number(($event.target as HTMLInputElement).value))"
          />
        </div>
        <div class="form-group">
          <label>模型色调</label>
          <input
            class="color-input"
            type="color"
            :value="tintColor"
            @input="updateTint(($event.target as HTMLInputElement).value)"
          />
        </div>
        <label class="check-row">
          <input v-model="enableShadows" type="checkbox" @change="updateAppearance" />
          阴影
        </label>
        <label class="check-row">
          <input v-model="enableSilhouette" type="checkbox" @change="updateAppearance" />
          轮廓高亮
        </label>
      </section>

      <section class="section">
        <div class="section-title">动画</div>
        <label class="check-row">
          <input v-model="autoRotate" type="checkbox" @change="toggleAutoRotate" />
          自动旋转模型
        </label>
        <div class="slider-group">
          <label>旋转速度 <span>{{ rotSpeed }}°/s</span></label>
          <input
            type="range"
            min="1"
            max="100"
            step="1"
            :value="rotSpeed"
            @input="updateRotSpeed(Number(($event.target as HTMLInputElement).value))"
          />
        </div>
      </section>

      <section class="section">
        <div class="section-title">场景</div>
        <label class="check-row">
          <input
            :checked="showTerrain"
            :disabled="terrainBusy"
            type="checkbox"
            @change="showTerrain = ($event.target as HTMLInputElement).checked; void toggleTerrain(showTerrain)"
          />
          地形
        </label>
        <label class="check-row">
          <input v-model="enableLighting" type="checkbox" @change="updateAppearance" />
          日照光照
        </label>
      </section>

      <section class="section last">
        <div class="form-row">
          <button class="btn btn-success" @click="resetParams">重置参数</button>
          <button class="btn btn-danger" @click="removeModel">移除模型</button>
        </div>
      </section>
      </div>
    </aside>

    <div v-if="busy" class="busy-overlay">
      <div class="spinner"></div>
      <span>正在加载模型…</span>
    </div>
    <div v-if="statusText" class="toast-message">{{ statusText }}</div>
  </div>
</template>

<style scoped>
.model-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 420px;
  overflow: hidden;
  border-radius: 10px;
  background: #152b4c;
}
.cesium-wrap {
  width: 100%;
  height: 100%;
}
.hidden-input {
  display: none;
}

.side-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  width: 292px;
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
.model-shell.panel-collapsed .side-panel {
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
  transition: all 0.2s;
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
.upload-icon {
  margin-bottom: 6px;
  font-size: 26px;
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
.field-label {
  display: block;
  margin-bottom: 4px;
  font-size: 11px;
  font-weight: 500;
  color: #c3d5e8;
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
.form-row {
  display: flex;
  gap: 8px;
}
.form-row .form-group {
  flex: 1;
}
.text-input,
.num-input {
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
.text-input:focus,
.num-input:focus {
  border-color: rgba(47, 128, 237, 0.7);
}
.color-input {
  width: 100%;
  height: 32px;
  box-sizing: border-box;
  padding: 2px;
  border: 1px solid rgba(157, 188, 224, 0.3);
  border-radius: 4px;
  background: rgba(20, 43, 80, 0.75);
  cursor: pointer;
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
.btn-success {
  flex: 1;
  background: #1f8a5a;
  color: #ecfdf4;
}
.btn-success:hover {
  background: #27a06d;
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
}
.model-info.empty {
  color: #7f96b3;
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
.toast-message {
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
