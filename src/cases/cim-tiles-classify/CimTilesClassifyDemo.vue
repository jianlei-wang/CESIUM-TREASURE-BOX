<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as Cesium from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'

type Region = {
  id: string
  name: string
  color: Cesium.Color
  west: number
  east: number
  south: number
  north: number
  instance: Cesium.GeometryInstance
  primitive: Cesium.ClassificationPrimitive
  label: Cesium.Entity
}

const TILESET_URL = '/dayanta/tileset.json'
const TILE_CENTER = { lon: 108.9606, lat: 34.2199, height: 445 }

const container = ref<HTMLElement>()
const statusMessage = ref('正在准备场景...')
const fillOpacity = ref(0.5)
const showRegions = ref(true)
const showLabels = ref(true)
const selectedId = ref('')
const hoveredId = ref('')
const regionSummary = ref('未选择片区')
const modelState = ref('等待加载')
const regionCount = ref(0)
const coverage = ref('-')

const REGION_COLORS = ['#38bdf8', '#fbbf24', '#f472b6', '#34d399']

let viewer: ReturnType<typeof createMapScene> | undefined
let tileset: Cesium.Cesium3DTileset | undefined
let handler: Cesium.ScreenSpaceEventHandler | undefined
let regions: Region[] = []
let centerLon = TILE_CENTER.lon
let centerLat = TILE_CENTER.lat
let baseHeight = TILE_CENTER.height - 80
let topHeight = TILE_CENTER.height + 140
let disposed = false
let styleListener: (() => void) | undefined

function colorBytes(color: Cesium.Color, alpha: number): number[] {
  return [
    Math.round(color.red * 255),
    Math.round(color.green * 255),
    Math.round(color.blue * 255),
    Math.round(Math.max(0, Math.min(1, alpha)) * 255)
  ]
}

function applyStyles(): void {
  const baseAlpha = fillOpacity.value
  const activeAlpha = Math.min(1, fillOpacity.value + 0.32)
  for (const region of regions) {
    if (!region.primitive.ready) continue
    const attributes = region.primitive.getGeometryInstanceAttributes(region.id)
    if (!attributes) continue
    const active = region.id === selectedId.value || region.id === hoveredId.value
    attributes.color = colorBytes(region.color, active ? activeAlpha : baseAlpha)
  }
}

function regionAt(lon: number, lat: number): Region | undefined {
  return regions.find(
    (region) => lon >= region.west && lon <= region.east && lat >= region.south && lat <= region.north
  )
}

function cartographicAt(position: Cesium.Cartesian2): Cesium.Cartographic | undefined {
  if (!viewer || viewer.isDestroyed()) return undefined
  if (viewer.scene.pickPositionSupported) {
    const picked = viewer.scene.pickPosition(position)
    if (picked) return Cesium.Cartographic.fromCartesian(picked)
  }
  const ray = viewer.camera.getPickRay(position)
  if (ray) {
    const ground = viewer.scene.globe.pick(ray, viewer.scene)
    if (ground) return Cesium.Cartographic.fromCartesian(ground)
  }
  const ellipsoid = viewer.camera.pickEllipsoid(position, Cesium.Ellipsoid.WGS84)
  return ellipsoid ? Cesium.Cartographic.fromCartesian(ellipsoid) : undefined
}

function updateSummary(): void {
  const activeId = selectedId.value || hoveredId.value
  const region = regions.find((item) => item.id === activeId)
  if (!region) {
    regionSummary.value = '未选择片区'
    return
  }
  const width = Math.round(
    (region.east - region.west) * 111320 * Math.cos(Cesium.Math.toRadians((region.south + region.north) / 2))
  )
  const depth = Math.round((region.north - region.south) * 110540)
  regionSummary.value = `${region.name} · 约 ${width} × ${depth} m`
}

function setHover(region: Region | undefined): void {
  const nextId = region?.id ?? ''
  if (hoveredId.value === nextId) return
  hoveredId.value = nextId
  if (viewer && !viewer.isDestroyed()) {
    viewer.scene.canvas.style.cursor = region ? 'pointer' : 'default'
  }
  applyStyles()
  updateSummary()
}

function setSelected(region: Region | undefined): void {
  const nextId = region?.id ?? ''
  selectedId.value = selectedId.value === nextId ? '' : nextId
  applyStyles()
  updateSummary()
}

function buildRegions(model: Cesium.Cesium3DTileset): void {
  if (!viewer || viewer.isDestroyed()) return
  if (!Cesium.ClassificationPrimitive.isSupported(viewer.scene)) {
    statusMessage.value = '当前环境不支持三维瓦片分类渲染，仅展示模型。'
    return
  }
  const sphere = model.boundingSphere
  const center = Cesium.Cartographic.fromCartesian(sphere.center)
  centerLon = center.longitude * (180 / Math.PI)
  centerLat = center.latitude * (180 / Math.PI)
  const centerHeight = Number.isFinite(center.height) ? center.height : TILE_CENTER.height
  const radius = Math.min(240, Math.max(110, sphere.radius * 0.78))
  baseHeight = Math.max(0, centerHeight - 90)
  topHeight = centerHeight + 160
  coverage.value = `${baseHeight.toFixed(0)} ~ ${topHeight.toFixed(0)} m`

  const halfLat = radius / 110540
  const halfLon = radius / (111320 * Math.cos(Cesium.Math.toRadians(centerLat)))

  const definitions = [
    {
      id: 'nw',
      name: '西北片区',
      west: centerLon - halfLon,
      east: centerLon,
      south: centerLat,
      north: centerLat + halfLat
    },
    {
      id: 'ne',
      name: '东北片区',
      west: centerLon,
      east: centerLon + halfLon,
      south: centerLat,
      north: centerLat + halfLat
    },
    {
      id: 'sw',
      name: '西南片区',
      west: centerLon - halfLon,
      east: centerLon,
      south: centerLat - halfLat,
      north: centerLat
    },
    {
      id: 'se',
      name: '东南片区',
      west: centerLon,
      east: centerLon + halfLon,
      south: centerLat - halfLat,
      north: centerLat
    }
  ]

  regions = definitions.map((definition, index) => {
    const positions = Cesium.Cartesian3.fromDegreesArray([
      definition.west,
      definition.south,
      definition.east,
      definition.south,
      definition.east,
      definition.north,
      definition.west,
      definition.north
    ])
    const color = Cesium.Color.fromCssColorString(REGION_COLORS[index])
    const instance = new Cesium.GeometryInstance({
      id: definition.id,
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(positions),
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        height: baseHeight,
        extrudedHeight: topHeight
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(color.withAlpha(fillOpacity.value))
      }
    })
    const primitive = viewer!.scene.primitives.add(
      new Cesium.ClassificationPrimitive({
        geometryInstances: instance,
        classificationType: Cesium.ClassificationType.CESIUM_3D_TILE,
        appearance: new Cesium.PerInstanceColorAppearance({
          flat: true,
          translucent: true,
          closed: false
        })
      })
    ) as Cesium.ClassificationPrimitive
    primitive.show = showRegions.value

    const label = viewer!.entities.add({
      position: Cesium.Cartesian3.fromDegrees(
        (definition.west + definition.east) / 2,
        (definition.south + definition.north) / 2,
        topHeight + 24
      ),
      label: {
        text: definition.name,
        font: '600 13px "Microsoft YaHei", sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#0b2239'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#0b2239').withAlpha(0.74),
        backgroundPadding: new Cesium.Cartesian2(8, 5),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scale: 0.92,
        show: showLabels.value
      }
    })

    return {
      ...definition,
      color,
      instance,
      primitive,
      label
    }
  })

  regionCount.value = regions.length

  const applyWhenReady = () => {
    if (regions.length > 0 && regions.every((region) => region.primitive.ready)) {
      applyStyles()
      if (styleListener && viewer && !viewer.isDestroyed()) {
        viewer.scene.postRender.removeEventListener(styleListener)
      }
      styleListener = undefined
    }
  }
  styleListener = applyWhenReady
  viewer.scene.postRender.addEventListener(applyWhenReady)
}

async function flyToModel(): Promise<void> {
  if (!viewer || viewer.isDestroyed() || !tileset) return
  await viewer.flyTo(tileset, {
    offset: new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(-28),
      Cesium.Math.toRadians(-32),
      520
    ),
    duration: 1.4
  })
}

async function loadModel(): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  statusMessage.value = '正在加载倾斜摄影模型...'
  modelState.value = '加载中'
  try {
    const model = await Cesium.Cesium3DTileset.fromUrl(TILESET_URL, {
      maximumScreenSpaceError: 10
    })
    if (disposed || !viewer || viewer.isDestroyed()) {
      model.destroy()
      return
    }
    tileset = viewer.scene.primitives.add(model)
    modelState.value = '已加载'
    statusMessage.value = ''
    buildRegions(model)
    await flyToModel()
  } catch (error) {
    modelState.value = '加载失败'
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
}

function onFillOpacity(): void {
  applyStyles()
}

function onToggleRegions(): void {
  for (const region of regions) {
    region.primitive.show = showRegions.value
  }
}

function onToggleLabels(): void {
  for (const region of regions) {
    region.label.show = showLabels.value
  }
}

function bindPicking(): void {
  if (!viewer || viewer.isDestroyed()) return
  handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
    if (!viewer || viewer.isDestroyed()) return
    const picked = viewer.scene.pick(movement.endPosition)
    if (picked?.primitive instanceof Cesium.ClassificationPrimitive) {
      const region = regions.find((item) => item.primitive === picked.primitive)
      setHover(region)
      return
    }
    const cartographic = cartographicAt(movement.endPosition)
    if (!cartographic) {
      setHover(undefined)
      return
    }
    const lon = Cesium.Math.toDegrees(cartographic.longitude)
    const lat = Cesium.Math.toDegrees(cartographic.latitude)
    setHover(regionAt(lon, lat))
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

  handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    if (!viewer || viewer.isDestroyed()) return
    const picked = viewer.scene.pick(movement.position)
    if (picked?.primitive instanceof Cesium.ClassificationPrimitive) {
      const region = regions.find((item) => item.primitive === picked.primitive)
      setSelected(region)
      return
    }
    const cartographic = cartographicAt(movement.position)
    if (!cartographic) {
      setSelected(undefined)
      return
    }
    const lon = Cesium.Math.toDegrees(cartographic.longitude)
    const lat = Cesium.Math.toDegrees(cartographic.latitude)
    setSelected(regionAt(lon, lat))
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
}

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => {
      statusMessage.value = message
    },
    onBasemapReady: () => {
      if (!tileset) statusMessage.value = ''
    }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(TILE_CENTER.lon, TILE_CENTER.lat, 1600),
      orientation: {
        heading: Cesium.Math.toRadians(-20),
        pitch: Cesium.Math.toRadians(-35),
        roll: 0
      }
    })
    bindPicking()
    void loadModel()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  if (handler) {
    handler.destroy()
    handler = undefined
  }
  if (viewer && !viewer.isDestroyed() && styleListener) {
    viewer.scene.postRender.removeEventListener(styleListener)
    styleListener = undefined
  }
  if (viewer && !viewer.isDestroyed()) {
    for (const region of regions) {
      viewer.scene.primitives.remove(region.primitive)
      viewer.entities.remove(region.label)
    }
    regions = []
    if (tileset) {
      viewer.scene.primitives.remove(tileset)
      tileset = undefined
    }
  }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="ctc-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="ctc-panel">
      <div class="panel-title">倾斜模型分区分类</div>
      <div class="panel-subtitle">分类体覆盖 + 象限拾取</div>

      <div class="section-title">模型</div>
      <div class="ctc-metrics">
        <div><span>状态</span><strong>{{ modelState }}</strong></div>
        <div><span>片区</span><strong>{{ regionCount }}</strong></div>
      </div>
      <div class="ctc-hint">覆盖高程：{{ coverage }}</div>

      <div class="section-title">显示</div>
      <div class="ctc-row">
        <button class="ctc-toggle" :class="{ on: showRegions }" @click="showRegions = !showRegions; onToggleRegions()">
          {{ showRegions ? '分类体: 开' : '分类体: 关' }}
        </button>
        <button class="ctc-toggle" :class="{ on: showLabels }" @click="showLabels = !showLabels; onToggleLabels()">
          {{ showLabels ? '标签: 开' : '标签: 关' }}
        </button>
      </div>
      <div class="ctc-param">
        <span>填充强度</span>
        <input v-model.number="fillOpacity" type="range" min="0.12" max="0.9" step="0.02" @input="onFillOpacity" />
        <b>{{ Math.round(fillOpacity * 100) }}%</b>
      </div>

      <div class="section-title">拾取</div>
      <div class="ctc-active">{{ regionSummary }}</div>
      <div class="ctc-legend">
        <span v-for="(color, index) in REGION_COLORS" :key="color" :style="{ background: color }">
          {{ ['西北', '东北', '西南', '东南'][index] }}
        </span>
      </div>
      <div class="ctc-hint">移动鼠标预览片区，单击锁定或取消高亮</div>

      <div class="ctc-row">
        <button class="ctc-btn" @click="flyToModel">重置视角</button>
        <button class="ctc-btn ghost" @click="setSelected(undefined)">清除选择</button>
      </div>
    </div>

    <div v-if="statusMessage" class="ctc-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.ctc-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #061421; color: #e8fbff; font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif; }
.cesium-container { width: 100%; height: 100%; }
.ctc-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 7px; width: 252px; max-height: calc(100% - 24px); overflow-y: auto; padding: 11px; border: 1px solid rgba(91, 255, 226, 0.28); border-radius: 9px; background: rgba(8, 28, 43, 0.9); backdrop-filter: blur(6px); }
.panel-title { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
.panel-subtitle { font-size: 11px; color: #7da9b8; }
.section-title { margin-top: 4px; padding: 2px 0 1px; border-bottom: 1px solid rgba(91, 255, 226, 0.18); font-size: 11px; font-weight: 700; color: #5fffe0; }
.ctc-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ctc-toggle { height: 24px; padding: 0 9px; border: 1px solid rgba(91, 255, 226, 0.24); border-radius: 5px; background: rgba(13, 42, 58, 0.78); color: #7da9b8; font-size: 11px; cursor: pointer; }
.ctc-toggle.on { color: #e8fbff; border-color: #5fffe0; }
.ctc-btn { height: 24px; padding: 0 10px; border: 0; border-radius: 5px; background: #257f9e; color: #edfaff; cursor: pointer; font-size: 11px; }
.ctc-btn.ghost { background: rgba(13, 42, 58, 0.78); border: 1px solid rgba(91, 255, 226, 0.24); color: #b9dce7; }
.ctc-param { display: flex; align-items: center; gap: 8px; }
.ctc-param span { flex: 0 0 62px; font-size: 11px; color: #bdd9e4; }
.ctc-param input { flex: 1; min-width: 0; height: 4px; accent-color: #5fffe0; }
.ctc-param b { flex: 0 0 36px; color: #9cc9d8; font-size: 10px; text-align: right; }
.ctc-hint { padding: 4px 7px; border-radius: 5px; background: rgba(13, 42, 58, 0.6); color: #7da9b8; font-size: 11px; line-height: 1.4; }
.ctc-active { padding: 6px 8px; border: 1px solid rgba(54, 141, 255, 0.24); border-radius: 6px; background: rgba(13, 42, 58, 0.7); font-size: 11px; color: #dff6ff; }
.ctc-legend { display: flex; gap: 4px; flex-wrap: wrap; }
.ctc-legend span { padding: 2px 7px; border-radius: 4px; color: #062031; font-size: 10px; font-weight: 700; }
.ctc-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.ctc-metrics > div { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border: 1px solid rgba(54, 141, 255, 0.18); border-radius: 6px; background: rgba(13, 42, 58, 0.6); }
.ctc-metrics span { font-size: 10px; color: #7da9b8; }
.ctc-metrics strong { font-size: 12px; color: #e8fbff; }
.ctc-status { position: absolute; inset: 0; z-index: 9; display: grid; place-items: center; padding: 24px; color: #d9eff6; background: rgba(4, 23, 37, 0.72); font-size: 12px; }
</style>
