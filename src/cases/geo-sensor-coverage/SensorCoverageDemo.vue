<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Color,
  Entity,
  ImageMaterialProperty,
  PolygonHierarchy,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import { pickLonLat } from '../geo-intel-lib/pick'
import { coverageAreaKm2, coverageCanvas, coverageFootprint, coverageRangeBand, evaluateCoverage, type SensorSpec } from '../geo-intel-lib/coverage'
import { destinationPoint } from '../geo-intel-lib/geometry'
import '../geo-intel-lib/panel.css'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载底图…')
const probeText = ref('单击地图查询覆盖情况')
const activeIndex = ref(0)
const gridResolution = ref(220)

const sensors = ref<SensorSpec[]>([
  {
    lat: 31.2345,
    lon: 121.4755,
    heightM: 42,
    azimuthDeg: 35,
    fovDeg: 72,
    rangeM: 1800,
    minRangeM: 40,
    pitchDeg: 18
  },
  {
    lat: 31.2285,
    lon: 121.4935,
    heightM: 56,
    azimuthDeg: 205,
    fovDeg: 64,
    rangeM: 2100,
    minRangeM: 50,
    pitchDeg: 22
  },
  {
    lat: 31.2455,
    lon: 121.4895,
    heightM: 33,
    azimuthDeg: 300,
    fovDeg: 88,
    rangeM: 1500,
    minRangeM: 30,
    pitchDeg: 14
  }
])

const active = computed(() => sensors.value[activeIndex.value])
const activeBand = computed(() => coverageRangeBand(active.value))
const activeArea = computed(() => {
  const area = coverageAreaKm2(active.value, activeBand.value)
  return area < 0.01 ? area.toFixed(4) : area.toFixed(2)
})

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
const heatEntities: Entity[] = []
const footprintEntities: Entity[] = []
const sensorEntities: Entity[] = []
const probeEntities: Entity[] = []

const OVERLAY_HEIGHT = 30

function coverageColor(t: number): { r: number; g: number; b: number; a: number } {
  const stops = [
    { s: 0, c: [40, 90, 200] },
    { s: 0.4, c: [40, 190, 180] },
    { s: 0.7, c: [240, 200, 60] },
    { s: 1, c: [230, 70, 60] }
  ]
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]
    const b = stops[i + 1]
    if (t >= a.s && t <= b.s) {
      const k = (t - a.s) / (b.s - a.s || 1)
      return {
        r: Math.round(a.c[0] + (b.c[0] - a.c[0]) * k),
        g: Math.round(a.c[1] + (b.c[1] - a.c[1]) * k),
        b: Math.round(a.c[2] + (b.c[2] - a.c[2]) * k),
        a: Math.round(60 + 150 * t)
      }
    }
  }
  return { r: 230, g: 70, b: 60, a: 180 }
}

function fanBbox(spec: SensorSpec, band: { nearM: number; farM: number }) {
  const ring = coverageFootprint(spec, 32, band)
  let latMin = Number.POSITIVE_INFINITY
  let latMax = Number.NEGATIVE_INFINITY
  let lonMin = Number.POSITIVE_INFINITY
  let lonMax = Number.NEGATIVE_INFINITY
  for (const [lon, lat] of ring) {
    latMin = Math.min(latMin, lat)
    latMax = Math.max(latMax, lat)
    lonMin = Math.min(lonMin, lon)
    lonMax = Math.max(lonMax, lon)
  }
  const padLat = 0.0002
  const padLon = padLat / Math.max(Math.cos((((latMin + latMax) / 2) * Math.PI) / 180), 0.2)
  return {
    latMin: latMin - padLat,
    latMax: latMax + padLat,
    lonMin: lonMin - padLon,
    lonMax: lonMax + padLon
  }
}

function rebuildHeat(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const e of heatEntities) viewer.entities.remove(e)
  heatEntities.length = 0
  const divisions = Math.max(24, Math.round(gridResolution.value / 2))
  sensors.value.forEach((spec, index) => {
    const band = coverageRangeBand(spec)
    const bbox = fanBbox(spec, band)
    const midLat = (((bbox.latMin + bbox.latMax) / 2) * Math.PI) / 180
    const latSpanM = (bbox.latMax - bbox.latMin) * 111320
    const lonSpanM = (bbox.lonMax - bbox.lonMin) * 111320 * Math.cos(midLat)
    const cellM = Math.max(2, Math.min(160, (band.farM - band.nearM) / divisions))
    let width = Math.max(8, Math.ceil(lonSpanM / cellM))
    let height = Math.max(8, Math.ceil(latSpanM / cellM))
    const maxDim = 480
    if (Math.max(width, height) > maxDim) {
      const scale = maxDim / Math.max(width, height)
      width = Math.max(8, Math.floor(width * scale))
      height = Math.max(8, Math.floor(height * scale))
    }
    const canvas = coverageCanvas([spec], bbox, width, height, coverageColor)
    const rectangle = Rectangle.fromDegrees(bbox.lonMin, bbox.latMin, bbox.lonMax, bbox.latMax)
    const material = new ImageMaterialProperty({ image: canvas.toDataURL(), transparent: true })
    heatEntities.push(
      viewer!.entities.add({
        rectangle: { coordinates: rectangle, material, height: OVERLAY_HEIGHT + 0.5 + index * 0.5 }
      })
    )
  })
}

function rebuildFootprints(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const e of footprintEntities) viewer.entities.remove(e)
  footprintEntities.length = 0
  sensors.value.forEach((spec, index) => {
    const band = coverageRangeBand(spec)
    const ring = coverageFootprint(spec, 32, band)
    footprintEntities.push(
      viewer!.entities.add({
        polygon: {
          hierarchy: new PolygonHierarchy(ring.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, OVERLAY_HEIGHT))),
          material: Color.fromCssColorString(index === activeIndex.value ? 'rgba(120,220,255,0.16)' : 'rgba(140,170,210,0.08)'),
          outline: true,
          outlineColor: Color.fromCssColorString(index === activeIndex.value ? '#7ddcff' : 'rgba(150,190,230,0.7)'),
          outlineWidth: 2,
          height: OVERLAY_HEIGHT
        }
      })
    )
    if (index === activeIndex.value) {
      const axis = [0, band.nearM, band.farM].map((d) => {
        const p = destinationPoint(spec.lat, spec.lon, spec.azimuthDeg, d)
        return Cartesian3.fromDegrees(p.lon, p.lat, OVERLAY_HEIGHT)
      })
      footprintEntities.push(
        viewer!.entities.add({
          polyline: {
            positions: axis,
            width: 1.5,
            material: Color.fromCssColorString('rgba(125,220,255,0.55)')
          }
        })
      )
    }
  })
}

function rebuildSensors(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const e of sensorEntities) viewer.entities.remove(e)
  sensorEntities.length = 0
  sensors.value.forEach((spec, index) => {
    sensorEntities.push(
      viewer!.entities.add({
        position: Cartesian3.fromDegrees(spec.lon, spec.lat, OVERLAY_HEIGHT),
        point: {
          pixelSize: index === activeIndex.value ? 12 : 8,
          color: Color.fromCssColorString(index === activeIndex.value ? '#ffffff' : '#8dd8ff'),
          outlineColor: Color.fromCssColorString('#12304f'),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: `设备 ${index + 1}`,
          font: '11px sans-serif',
          fillColor: Color.fromCssColorString('#e6f2ff'),
          showBackground: true,
          backgroundColor: Color.fromCssColorString('rgba(8,22,42,0.78)'),
          pixelOffset: new Cartesian2(0, -22),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      })
    )
  })
}

let heatRaf = 0
function scheduleHeat(): void {
  if (heatRaf) return
  heatRaf = requestAnimationFrame(() => {
    heatRaf = 0
    rebuildHeat()
  })
}

function refreshAll(): void {
  rebuildSensors()
  rebuildFootprints()
  scheduleHeat()
}

function probe(lon: number, lat: number): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const e of probeEntities) viewer.entities.remove(e)
  probeEntities.length = 0
  let bestValue = 0
  let bestDist = Infinity
  let bestIndex = -1
  sensors.value.forEach((spec, index) => {
    const cell = evaluateCoverage(spec, lat, lon)
    if (cell.visibility > bestValue) {
      bestValue = cell.visibility
      bestDist = cell.rangeM
      bestIndex = index
    }
  })
  probeEntities.push(
    viewer.entities.add({
      position: Cartesian3.fromDegrees(lon, lat, OVERLAY_HEIGHT + 8),
      point: {
        pixelSize: 9,
        color: bestValue > 0 ? Color.fromCssColorString('#7dffb0') : Color.fromCssColorString('#ff6b6b'),
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
  )
  probeText.value =
    bestValue > 0
      ? `设备 ${bestIndex + 1} 覆盖，强度 ${(bestValue * 100).toFixed(0)}%，距离 ${(bestDist / 1000).toFixed(2)} km`
      : `盲区：任何设备均无法覆盖 ${lat.toFixed(4)}, ${lon.toFixed(4)}`
}

watch(
  () => sensors.value.map((s) => `${s.azimuthDeg}|${s.fovDeg}|${s.rangeM}|${s.pitchDeg}|${s.heightM}`).join(','),
  () => refreshAll()
)
watch(activeIndex, () => {
  rebuildSensors()
  rebuildFootprints()
})
watch(gridResolution, () => scheduleHeat())

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
      destination: Cartesian3.fromDegrees(121.4835, 31.2365, 3800),
      orientation: { heading: 0, pitch: (-52 * Math.PI) / 180, roll: 0 }
    })

    refreshAll()

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
  if (heatRaf) cancelAnimationFrame(heatRaf)
  heatRaf = 0
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
      <div class="gi-title">摄像机覆盖分析</div>

      <div class="gi-row">
        <span class="gi-label">当前设备</span>
        <select v-model.number="activeIndex">
          <option v-for="(s, i) in sensors" :key="i" :value="i">设备 {{ i + 1 }}</option>
        </select>
      </div>

      <div class="gi-section">朝向与视场</div>
      <div class="gi-row">
        <span class="gi-label">方位角</span>
        <input v-model.number="active.azimuthDeg" type="range" min="0" max="360" step="1" />
        <span class="gi-value">{{ active.azimuthDeg }}°</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">视场角</span>
        <input v-model.number="active.fovDeg" type="range" min="20" max="120" step="1" />
        <span class="gi-value">{{ active.fovDeg }}°</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">俯仰角</span>
        <input v-model.number="active.pitchDeg" type="range" min="2" max="45" step="1" />
        <span class="gi-value">{{ active.pitchDeg }}°</span>
      </div>

      <div class="gi-section">设备参数</div>
      <div class="gi-row">
        <span class="gi-label">安装高度</span>
        <input v-model.number="active.heightM" type="range" min="10" max="120" step="2" />
        <span class="gi-value">{{ active.heightM }}m</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">有效距离</span>
        <input v-model.number="active.rangeM" type="range" min="400" max="3000" step="50" />
        <span class="gi-value">{{ (active.rangeM / 1000).toFixed(1) }}km</span>
      </div>

      <div class="gi-section">栅格精度</div>
      <div class="gi-row">
        <span class="gi-label">分辨率</span>
        <input v-model.number="gridResolution" type="range" min="80" max="360" step="20" />
        <span class="gi-value">{{ gridResolution }}</span>
      </div>

      <p class="gi-hint">近界由安装高度与俯仰角推导，远界受有效距离约束；视场扇形与热度图共用同一覆盖范围，强度综合方位偏差与距离衰减。</p>
      <div class="gi-result">设备 {{ activeIndex + 1 }} 覆盖 {{ Math.round(activeBand.nearM) }} m – {{ (activeBand.farM / 1000).toFixed(2) }} km，面积 {{ activeArea }} km²</div>
      <div class="gi-hint">{{ probeText }}</div>
    </div>

    <div class="gi-legend">
      <div class="gi-legend-bar" style="background: linear-gradient(90deg, rgb(40,90,200), rgb(40,190,180), rgb(240,200,60), rgb(230,70,60))"></div>
      <div class="gi-legend-ticks">
        <span>弱</span>
        <span>覆盖强度</span>
        <span>强</span>
      </div>
    </div>

    <div v-if="statusMessage" class="gi-status">{{ statusMessage }}</div>
  </div>
</template>
