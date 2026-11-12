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
import { renderGridToCanvas, type ColorStop } from '../geo-intel-lib/idw'
import {
  HAZARD_LAYERS,
  classifyRisk,
  fuseHazards,
  hazardValue,
  type HazardLayer,
  type HazardLayerId
} from '../geo-intel-lib/fusion'
import '../geo-intel-lib/panel.css'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载底图…')
const probeText = ref('单击地图读取风险等级')

const layers = ref<HazardLayer[]>(HAZARD_LAYERS.map((l) => ({ ...l, stops: [...l.stops] })))
const gridSize = ref(180)
const phase = ref(0.35)
const showFused = ref(true)
const activeLayer = ref<HazardLayerId | 'fused'>('fused')

const levelCounts = ref<Record<string, number>>({})

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let fusedEntity: Entity | undefined
const probeEntities: Entity[] = []

const REGION = { latMin: 30.52, latMax: 30.78, lonMin: 114.18, lonMax: 114.52 }

const RISK_STOPS: ColorStop[] = [
  { stop: 0, r: 63, g: 143, b: 209 },
  { stop: 0.22, r: 87, g: 185, b: 138 },
  { stop: 0.38, r: 217, g: 193, b: 69 },
  { stop: 0.55, r: 232, g: 139, b: 58 },
  { stop: 0.72, r: 214, g: 59, b: 85 },
  { stop: 1, r: 150, g: 24, b: 56 }
]

const layerStops = computed<ColorStop[]>(() => {
  if (activeLayer.value === 'fused') return RISK_STOPS
  const layer = layers.value.find((l) => l.id === activeLayer.value)
  return layer ? layer.stops : RISK_STOPS
})

const levelRows = computed(() =>
  Object.entries(levelCounts.value).map(([level, pct]) => ({
    level,
    pct,
    color: levelColor(level)
  }))
)

function levelColor(level: string): string {
  const map: Record<string, number> = { 极高: 0.9, 高: 0.6, 中: 0.45, 低: 0.3, 极低: 0.1 }
  return classifyRisk(map[level] ?? 0.1).color
}

const legendGradient = computed(
  () => `linear-gradient(90deg, ${layerStops.value.map((s) => `rgb(${s.r},${s.g},${s.b}) ${Math.round(s.stop * 100)}%`).join(', ')})`
)

function singleLayerGrid(id: HazardLayerId) {
  const width = gridSize.value
  const height = Math.round(gridSize.value * 0.62)
  const data = new Float32Array(width * height)
  let min = Infinity
  let max = -Infinity
  for (let row = 0; row < height; row += 1) {
    const lat = REGION.latMin + ((row + 0.5) / height) * (REGION.latMax - REGION.latMin)
    for (let col = 0; col < width; col += 1) {
      const lon = REGION.lonMin + ((col + 0.5) / width) * (REGION.lonMax - REGION.lonMin)
      const v = hazardValue(id, lon, lat, REGION, phase.value)
      data[row * width + col] = v
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  return {
    data,
    variance: new Float32Array(width * height),
    width,
    height,
    latMin: REGION.latMin,
    latMax: REGION.latMax,
    lonMin: REGION.lonMin,
    lonMax: REGION.lonMax,
    valueMin: min,
    valueMax: max
  }
}

function buildSurface(): void {
  if (!viewer || viewer.isDestroyed()) return
  const width = gridSize.value
  const height = Math.round(gridSize.value * 0.62)
  const grid =
    activeLayer.value === 'fused'
      ? fuseHazards(REGION, width, height, layers.value, phase.value)
      : singleLayerGrid(activeLayer.value)

  const canvas = renderGridToCanvas(grid, layerStops.value, undefined, 2)
  const rectangle = Rectangle.fromDegrees(REGION.lonMin, REGION.latMin, REGION.lonMax, REGION.latMax)
  const material = new ImageMaterialProperty({ image: canvas.toDataURL(), transparent: true })

  if (!fusedEntity) {
    fusedEntity = viewer.entities.add({ rectangle: { coordinates: rectangle, material, height: 40 } })
  } else {
    fusedEntity.rectangle!.coordinates = new ConstantProperty(rectangle)
    fusedEntity.rectangle!.material = material
    fusedEntity.show = showFused.value
  }

  const counts: Record<string, number> = {}
  let total = 0
  for (let i = 0; i < grid.data.length; i += 1) {
    const v = grid.data[i]
    if (!Number.isFinite(v)) continue
    total += 1
  }
  if (activeLayer.value === 'fused') {
    for (let i = 0; i < grid.data.length; i += 1) {
      const v = grid.data[i]
      if (!Number.isFinite(v)) continue
      const level = classifyRisk(v).level
      counts[level] = (counts[level] ?? 0) + 1
    }
    for (const key of Object.keys(counts)) counts[key] = Math.round((counts[key] / Math.max(1, total)) * 1000) / 10
  }
  levelCounts.value = counts
}

function probe(lon: number, lat: number): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const e of probeEntities) viewer.entities.remove(e)
  probeEntities.length = 0

  let dominant = layers.value[0]
  let dominantValue = -1
  let fused = 0
  let weightSum = 0
  for (const layer of layers.value) {
    if (!layer.enabled) continue
    const v = hazardValue(layer.id, lon, lat, REGION, phase.value)
    fused += v * layer.weight
    weightSum += layer.weight
    if (v > dominantValue) {
      dominantValue = v
      dominant = layer
    }
  }
  fused = weightSum > 0 ? fused / weightSum : 0
  const risk = classifyRisk(fused)
  probeText.value = `综合 ${fused.toFixed(2)} · ${risk.level}风险 · 主导 ${dominant.label}(${dominantValue.toFixed(2)})`

  probeEntities.push(
    viewer.entities.add({
      position: Cartesian3.fromDegrees(lon, lat, 160),
      point: {
        pixelSize: 10,
        color: Color.fromCssColorString(risk.color),
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: `${risk.level} ${fused.toFixed(2)}`,
        font: '11px sans-serif',
        fillColor: Color.WHITE,
        showBackground: true,
        backgroundColor: Color.fromCssColorString('rgba(10,20,38,0.8)'),
        pixelOffset: new Cartesian2(0, -22),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
  )
}

watch(layers, () => buildSurface(), { deep: true })
watch([gridSize, phase, activeLayer], () => buildSurface())
watch(showFused, (v) => {
  if (fusedEntity) fusedEntity.show = v
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
      destination: Rectangle.fromDegrees(REGION.lonMin - 0.05, REGION.latMin - 0.05, REGION.lonMax + 0.05, REGION.latMax + 0.05)
    })
    buildSurface()

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
      <div class="gi-title">多灾种风险融合</div>

      <div class="gi-row">
        <span class="gi-label">显示图层</span>
        <select v-model="activeLayer">
          <option value="fused">综合风险</option>
          <option v-for="l in layers" :key="l.id" :value="l.id">{{ l.label }}</option>
        </select>
      </div>

      <div class="gi-section">灾种权重</div>
      <div v-for="layer in layers" :key="layer.id" class="gi-row">
        <span class="gi-label">{{ layer.label }}</span>
        <input v-model="layer.enabled" type="checkbox" />
        <input v-model.number="layer.weight" type="range" min="0" max="1" step="0.05" :disabled="!layer.enabled" style="max-width: 96px" />
        <span class="gi-value">{{ layer.weight.toFixed(2) }}</span>
      </div>

      <div class="gi-section">计算设置</div>
      <div class="gi-row">
        <span class="gi-label">网格精度</span>
        <input v-model.number="gridSize" type="range" min="60" max="320" step="20" />
        <span class="gi-value">{{ gridSize }}</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">场偏移</span>
        <input v-model.number="phase" type="range" min="0" max="2" step="0.05" />
        <span class="gi-value">{{ phase.toFixed(2) }}</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">显示结果</span>
        <input v-model="showFused" type="checkbox" />
      </div>

      <div class="gi-section">风险分级占比</div>
      <div v-if="Object.keys(levelCounts).length" class="level-list">
        <div v-for="row in levelRows" :key="row.level" class="level-row">
          <span class="level-name">{{ row.level }}</span>
          <span class="level-bar"><i :style="{ width: `${Math.min(100, row.pct)}%`, background: row.color }"></i></span>
          <span class="level-pct">{{ row.pct }}%</span>
        </div>
      </div>
      <p v-else class="gi-hint">切换到综合风险查看分级统计。</p>

      <p class="gi-hint">权重自动归一化；点击地图查看该点综合风险与主导灾种。</p>
      <div class="gi-hint">{{ probeText }}</div>
    </div>

    <div class="gi-legend">
      <div class="gi-legend-bar" :style="{ background: legendGradient }"></div>
      <div class="gi-legend-ticks">
        <span>低</span>
        <span>{{ activeLayer === 'fused' ? '综合风险' : '单灾种强度' }}</span>
        <span>高</span>
      </div>
    </div>

    <div v-if="statusMessage" class="gi-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.level-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.level-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: #c3d5e8;
}

.level-name {
  flex: 0 0 34px;
}

.level-bar {
  flex: 1;
  height: 7px;
  border-radius: 4px;
  background: rgba(157, 188, 224, 0.16);
  overflow: hidden;
}

.level-bar i {
  display: block;
  height: 100%;
  border-radius: 4px;
}

.level-pct {
  flex: 0 0 40px;
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
