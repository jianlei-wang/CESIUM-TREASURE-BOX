<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Color,
  ConstantProperty,
  Entity,
  ImageMaterialProperty,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import { pickLonLat } from '../geo-intel-lib/pick'
import {
  GRID_PALETTES,
  interpolateIDW,
  legendGradientCSS,
  paletteStops,
  probeGridValue,
  renderGridToCanvas,
  renderVarianceToCanvas,
  type InterpGrid,
  type InterpPoint
} from '../geo-intel-lib/idw'
import { haversineM, seededRandom } from '../geo-intel-lib/geometry'
import '../geo-intel-lib/panel.css'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载底图…')
const resultMessage = ref('')
const probeText = ref('尚未在地图上取点')

const power = ref(2)
const neighbors = ref(12)
const gridSize = ref(96)
const reachKm = ref(18)
const limitReach = ref(true)
const paletteId = ref('thermal')
const showVariance = ref(false)
const stations = ref<InterpPoint[]>([])

const palettes = GRID_PALETTES
const gridInfo = ref('')
const legendStyle = computed(() => legendGradientCSS(paletteStops(paletteId.value), 'to top'))
const rangeLabel = computed(() => gridInfo.value.split('/')[1]?.trim() ?? '')

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let surfaceEntity: Entity | undefined
let varianceEntity: Entity | undefined
let currentGrid: InterpGrid | undefined
const stationEntities: Entity[] = []
const probeEntities: Entity[] = []

const REGION = { latMin: 39.62, latMax: 40.18, lonMin: 116.05, lonMax: 116.75 }

function buildStations(): InterpPoint[] {
  const rand = seededRandom(20261112)
  const points: InterpPoint[] = []
  for (let i = 0; i < 30; i += 1) {
    const lat = REGION.latMin + rand() * (REGION.latMax - REGION.latMin)
    const lon = REGION.lonMin + rand() * (REGION.lonMax - REGION.lonMin)
    const gradient = (lat - REGION.latMin) / (REGION.latMax - REGION.latMin)
    const ridge = Math.sin(((lon - REGION.lonMin) / (REGION.lonMax - REGION.lonMin)) * Math.PI * 2)
    points.push({ lat, lon, value: 12 + gradient * 14 + ridge * 3.5 + (rand() - 0.5) * 4 })
  }
  return points
}

function buildSurface(): void {
  if (!viewer || viewer.isDestroyed() || !stations.value.length) return
  const width = gridSize.value
  const height = Math.max(
    24,
    Math.round((gridSize.value * (REGION.latMax - REGION.latMin)) / (REGION.lonMax - REGION.lonMin))
  )
  const grid = interpolateIDW(
    stations.value,
    REGION,
    width,
    height,
    power.value,
    Math.min(neighbors.value, stations.value.length),
    limitReach.value ? reachKm.value * 1000 : Infinity
  )
  currentGrid = grid

  const rectangle = Rectangle.fromDegrees(REGION.lonMin, REGION.latMin, REGION.lonMax, REGION.latMax)
  const material = new ImageMaterialProperty({
    image: renderGridToCanvas(grid, paletteStops(paletteId.value)).toDataURL(),
    transparent: true
  })
  const varianceMaterial = new ImageMaterialProperty({
    image: renderVarianceToCanvas(grid).toDataURL(),
    transparent: true
  })

  if (!surfaceEntity) {
    surfaceEntity = viewer.entities.add({ rectangle: { coordinates: rectangle, material, height: 60 } })
  } else {
    surfaceEntity.rectangle!.coordinates = new ConstantProperty(rectangle)
    surfaceEntity.rectangle!.material = material
  }
  if (!varianceEntity) {
    varianceEntity = viewer.entities.add({ rectangle: { coordinates: rectangle, material: varianceMaterial, height: 120 } })
  } else {
    varianceEntity.rectangle!.coordinates = new ConstantProperty(rectangle)
    varianceEntity.rectangle!.material = varianceMaterial
  }
  varianceEntity.show = showVariance.value

  gridInfo.value = `${width} × ${height} 网格 / ${grid.valueMin.toFixed(1)} ~ ${grid.valueMax.toFixed(1)}`
}

function addStationMarkers(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const s of stations.value) {
    stationEntities.push(
      viewer.entities.add({
        position: Cartesian3.fromDegrees(s.lon, s.lat, 90),
        point: {
          pixelSize: 7,
          color: Color.fromCssColorString('#d8ecff'),
          outlineColor: Color.fromCssColorString('#1c3f6e'),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: s.value.toFixed(1),
          font: '10px ui-monospace, monospace',
          fillColor: Color.fromCssColorString('#cfe4ff'),
          showBackground: true,
          backgroundColor: Color.fromCssColorString('rgba(10,26,52,0.72)'),
          pixelOffset: new Cartesian2(0, -14),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      })
    )
  }
}

function clearEntities(list: Entity[]): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const e of list) viewer.entities.remove(e)
  list.length = 0
}

function probe(lon: number, lat: number): void {
  if (!currentGrid) return
  const hit = probeGridValue(currentGrid, lat, lon)
  clearEntities(probeEntities)
  if (!hit) {
    probeText.value = `该点无插值结果（超出影响半径） ${lat.toFixed(4)}, ${lon.toFixed(4)}`
    return
  }
  let nearest = Infinity
  for (const s of stations.value) {
    const d = haversineM(lat, lon, s.lat, s.lon)
    if (d < nearest) nearest = d
  }
  probeText.value = `插值 ${hit.value.toFixed(2)} / 最近站点 ${(nearest / 1000).toFixed(1)} km`
  if (viewer && !viewer.isDestroyed()) {
    probeEntities.push(
      viewer.entities.add({
        position: Cartesian3.fromDegrees(lon, lat, 200),
        ellipse: {
          semiMinorAxis: 420,
          semiMajorAxis: 420,
          material: Color.fromCssColorString('rgba(255,255,255,0.34)'),
          outline: true,
          outlineColor: Color.fromCssColorString('#ffffff'),
          height: 200
        }
      })
    )
  }
}

function regenerate(): void {
  clearEntities(stationEntities)
  clearEntities(probeEntities)
  stations.value = buildStations()
  addStationMarkers()
  buildSurface()
  probeText.value = '尚未在地图上取点'
  resultMessage.value = `已生成 ${stations.value.length} 个站点并完成插值`
}

watch([power, neighbors, gridSize, reachKm, limitReach, paletteId], () => buildSurface())
watch(showVariance, (visible) => {
  if (varianceEntity) varianceEntity.show = visible
})

onMounted(() => {
  if (!container.value) return
  const callbacks: SceneCallbacks = {
    onStatus: (m) => {
      statusMessage.value = m
    },
    onBasemapReady: () => {
      statusMessage.value = ''
    }
  }
  try {
    viewer = createMapScene(container.value, callbacks)
    loadBingImagery(viewer, callbacks)
    viewer.camera.setView({
      destination: Rectangle.fromDegrees(
        REGION.lonMin - 0.15,
        REGION.latMin - 0.15,
        REGION.lonMax + 0.15,
        REGION.latMax + 0.15
      )
    })

    regenerate()

    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => {
      if (!viewer) return
      const p = pickLonLat(viewer.scene, event.position)
      if (p) probe(p.lon, p.lat)
    }, ScreenSpaceEventType.LEFT_CLICK)

    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  handler?.destroy()
  handler = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="gi-shell">
    <div ref="container" class="gi-canvas"></div>

    <div class="gi-panel">
      <div class="gi-title">站点插值曲面</div>

      <button class="gi-button primary" @click="regenerate">重新生成站点</button>

      <div class="gi-section">插值参数</div>
      <div class="gi-row">
        <span class="gi-label">幂指数</span>
        <input v-model.number="power" type="range" min="1" max="4" step="0.1" />
        <span class="gi-value">{{ power.toFixed(1) }}</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">邻域数</span>
        <input v-model.number="neighbors" type="range" min="3" max="24" step="1" />
        <span class="gi-value">{{ neighbors }}</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">网格数</span>
        <input v-model.number="gridSize" type="range" min="32" max="192" step="8" />
        <span class="gi-value">{{ gridSize }}</span>
      </div>

      <div class="gi-section">影响范围</div>
      <div class="gi-row">
        <span class="gi-label">限制半径</span>
        <input v-model="limitReach" type="checkbox" />
      </div>
      <div class="gi-row">
        <span class="gi-label">半径(km)</span>
        <input v-model.number="reachKm" type="range" min="4" max="40" step="1" :disabled="!limitReach" />
        <span class="gi-value">{{ reachKm }}</span>
      </div>

      <div class="gi-section">显示</div>
      <div class="gi-row">
        <span class="gi-label">色带</span>
        <select v-model="paletteId">
          <option v-for="p in palettes" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </div>
      <div class="gi-row">
        <span class="gi-label">叠加方差</span>
        <input v-model="showVariance" type="checkbox" />
      </div>

      <p class="gi-hint">单击地图读取插值结果；站点标注显示原始观测值。</p>
      <div v-if="resultMessage" class="gi-result">{{ resultMessage }}</div>
      <div class="gi-result">{{ gridInfo }}</div>
      <div class="gi-hint">{{ probeText }}</div>
    </div>

    <div class="gi-legend">
      <div class="gi-legend-bar" :style="{ background: legendStyle }"></div>
      <div class="gi-legend-ticks">
        <span>低</span>
        <span>{{ rangeLabel }}</span>
        <span>高</span>
      </div>
    </div>

    <div v-if="statusMessage" class="gi-status">{{ statusMessage }}</div>
  </div>
</template>
