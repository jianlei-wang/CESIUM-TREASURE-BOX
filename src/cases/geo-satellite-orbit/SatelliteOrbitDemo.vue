<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArcType,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Color,
  ConstantPositionProperty,
  Entity,
  PolygonHierarchy,
  PolylineGlowMaterialProperty,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import {
  eciToGeodetic,
  groundTrack,
  normalizeLon,
  orbitPathEci,
  orbitPathGeodeticAt,
  orbitalPeriodSec,
  propagateEci,
  type EciPoint,
  type OrbitElements
} from '../geo-intel-lib/orbit'
import { circleRing } from '../geo-intel-lib/geometry'
import '../geo-intel-lib/panel.css'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载底图…')

const semiMajorKm = ref(7000)
const eccentricity = ref(0.0008)
const inclinationDeg = ref(53)
const raanDeg = ref(120)
const argPerigeeDeg = ref(0)
const meanAnomalyDeg = ref(0)
const timeScale = ref(60)
const showCoverage = ref(true)
const showGroundTrack = ref(true)

const periodText = ref('')
const altText = ref('')
const subPointText = ref('')

const EARTH_R = 6371
const RING_SAMPLES = 240
const TRACK_SAMPLES = 220
const TEXT_INTERVAL_MS = 200
const REFRESH_MS = 80

let viewer: Viewer | undefined
let raf = 0
let epochMs = Date.now()
let simMs = epochMs
let lastFrame = 0
let lastTextMs = 0
let ringPath: EciPoint[] = []
let ringCache: { at: number; positions: Cartesian3[] } | null = null
let trackCache: { at: number; positions: Cartesian3[] } | null = null
let ringEntity: Entity | undefined
let trackEntity: Entity | undefined
let coverageEntity: Entity | undefined
let satelliteEntity: Entity | undefined

function elements(): OrbitElements {
  return {
    semiMajorAxisKm: semiMajorKm.value,
    eccentricity: eccentricity.value,
    inclinationDeg: inclinationDeg.value,
    raanDeg: raanDeg.value,
    argPerigeeDeg: argPerigeeDeg.value,
    meanAnomalyDeg: meanAnomalyDeg.value,
    epochMs
  }
}

function heightOf(heightKm: number): number {
  return Math.max(0, heightKm * 1000)
}

function ringPositions(): Cartesian3[] {
  if (ringCache && Math.abs(simMs - ringCache.at) < REFRESH_MS) return ringCache.positions
  const geo = orbitPathGeodeticAt(ringPath, simMs)
  const out: Cartesian3[] = []
  for (const p of geo) out.push(Cartesian3.fromDegrees(p.lon, p.lat, heightOf(p.heightKm)))
  ringCache = { at: simMs, positions: out }
  return out
}

function trackPositions(): Cartesian3[] {
  if (trackCache && Math.abs(simMs - trackCache.at) < REFRESH_MS) return trackCache.positions
  const el = elements()
  const period = orbitalPeriodSec(el.semiMajorAxisKm)
  const track = groundTrack(el, simMs, period, TRACK_SAMPLES)
  const out: Cartesian3[] = []
  for (const p of track) out.push(Cartesian3.fromDegrees(p.lon, p.lat, 1200))
  trackCache = { at: simMs, positions: out }
  return out
}

function satelliteGeodetic(): { lat: number; lon: number; heightKm: number; radiusKm: number } {
  const el = elements()
  const eci = propagateEci(el, simMs)
  const g = eciToGeodetic(eci, simMs)
  return { ...g, radiusKm: Math.hypot(eci.x, eci.y, eci.z) }
}

function coverageHierarchy(): PolygonHierarchy {
  const g = satelliteGeodetic()
  const centralAngle = Math.acos(Math.min(1, EARTH_R / Math.max(EARTH_R, g.radiusKm)))
  const radiusKm = EARTH_R * centralAngle
  const ring = circleRing(g.lat, g.lon, radiusKm * 1000, 96)
  return new PolygonHierarchy(ring.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, 500)))
}

function refreshPath(): void {
  ringPath = orbitPathEci(elements(), RING_SAMPLES)
  ringCache = null
  trackCache = null
}

function buildEntities(): void {
  if (!viewer || viewer.isDestroyed()) return
  refreshPath()

  if (!ringEntity) {
    ringEntity = viewer.entities.add({
      polyline: {
        positions: new CallbackProperty(ringPositions, false),
        width: 2,
        material: new PolylineGlowMaterialProperty({
          color: Color.fromCssColorString('#8bdcff'),
          glowPower: 0.2
        }),
        arcType: ArcType.NONE
      }
    })
  }

  if (!trackEntity) {
    trackEntity = viewer.entities.add({
      show: showGroundTrack.value,
      polyline: {
        positions: new CallbackProperty(trackPositions, false),
        width: 2,
        material: new PolylineGlowMaterialProperty({
          color: Color.fromCssColorString('#ffd479'),
          glowPower: 0.16
        }),
        arcType: ArcType.GEODESIC
      }
    })
  }

  if (!coverageEntity) {
    coverageEntity = viewer.entities.add({
      show: showCoverage.value,
      polygon: {
        hierarchy: new CallbackProperty(coverageHierarchy, false),
        material: Color.fromCssColorString('rgba(90,190,255,0.16)'),
        outline: true,
        outlineColor: Color.fromCssColorString('rgba(140,220,255,0.7)'),
        outlineWidth: 1,
        height: 500
      }
    })
  }
}

function refreshReadouts(): void {
  const el = elements()
  const period = orbitalPeriodSec(el.semiMajorAxisKm)
  const perigee = el.semiMajorAxisKm * (1 - el.eccentricity) - EARTH_R
  const apogee = el.semiMajorAxisKm * (1 + el.eccentricity) - EARTH_R
  periodText.value = `轨道周期 ${(period / 60).toFixed(1)} 分钟`
  altText.value = `近地点 ${perigee.toFixed(0)} km / 远地点 ${apogee.toFixed(0)} km`
}

function updateSatellite(): void {
  if (!viewer || viewer.isDestroyed()) return
  const g = satelliteGeodetic()
  const pos = Cartesian3.fromDegrees(g.lon, g.lat, heightOf(g.heightKm))

  if (satelliteEntity) {
    satelliteEntity.position = new ConstantPositionProperty(pos)
  } else {
    satelliteEntity = viewer.entities.add({
      id: 'orbit-satellite',
      position: pos,
      point: {
        pixelSize: 12,
        color: Color.fromCssColorString('#ffffff'),
        outlineColor: Color.fromCssColorString('#38a9ff'),
        outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: 'SAT-01',
        font: '11px ui-monospace, monospace',
        fillColor: Color.fromCssColorString('#e8f6ff'),
        showBackground: true,
        backgroundColor: Color.fromCssColorString('rgba(8,28,52,0.82)'),
        pixelOffset: new Cartesian2(0, -22),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
  }

  if (coverageEntity) coverageEntity.show = showCoverage.value
  if (trackEntity) trackEntity.show = showGroundTrack.value

  if (simMs - lastTextMs >= TEXT_INTERVAL_MS) {
    lastTextMs = simMs
    subPointText.value = `星下点 ${g.lat.toFixed(2)}°, ${normalizeLon(g.lon).toFixed(2)}° · 高度 ${g.heightKm.toFixed(0)} km`
  }
}

function loop(now: number): void {
  raf = requestAnimationFrame(loop)
  const dt = lastFrame ? (now - lastFrame) / 1000 : 0
  lastFrame = now
  if (!viewer || viewer.isDestroyed()) return
  simMs += dt * 1000 * timeScale.value
  updateSatellite()
  viewer.scene.requestRender()
}

function rebase(): void {
  epochMs = Date.now()
  simMs = epochMs
  lastTextMs = 0
  refreshPath()
  refreshReadouts()
  updateSatellite()
}

watch(
  [semiMajorKm, eccentricity, inclinationDeg, raanDeg, argPerigeeDeg, meanAnomalyDeg],
  () => {
    refreshPath()
    refreshReadouts()
    updateSatellite()
  }
)
watch([showCoverage, showGroundTrack], () => {
  if (coverageEntity) coverageEntity.show = showCoverage.value
  if (trackEntity) trackEntity.show = showGroundTrack.value
  updateSatellite()
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
    viewer.camera.setView({ destination: Cartesian3.fromDegrees(0, 20, 26000000) })
    rebase()
    buildEntities()
    raf = requestAnimationFrame(loop)
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  destroyScene(viewer)
  viewer = undefined
  ringEntity = undefined
  trackEntity = undefined
  coverageEntity = undefined
  satelliteEntity = undefined
})
</script>


<template>
  <div class="gi-shell">
    <div ref="container" class="gi-canvas"></div>

    <div class="gi-panel">
      <div class="gi-title">轨道推演</div>

      <div class="gi-section">轨道根数</div>
      <div class="gi-row">
        <span class="gi-label">半长轴</span>
        <input v-model.number="semiMajorKm" type="range" min="6500" max="42000" step="50" />
        <span class="gi-value">{{ semiMajorKm }}km</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">偏心率</span>
        <input v-model.number="eccentricity" type="range" min="0" max="0.35" step="0.001" />
        <span class="gi-value">{{ eccentricity.toFixed(3) }}</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">倾角</span>
        <input v-model.number="inclinationDeg" type="range" min="0" max="180" step="1" />
        <span class="gi-value">{{ inclinationDeg }}°</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">升交点</span>
        <input v-model.number="raanDeg" type="range" min="0" max="359" step="1" />
        <span class="gi-value">{{ raanDeg }}°</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">近地点幅角</span>
        <input v-model.number="argPerigeeDeg" type="range" min="0" max="359" step="1" />
        <span class="gi-value">{{ argPerigeeDeg }}°</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">平近点角</span>
        <input v-model.number="meanAnomalyDeg" type="range" min="0" max="359" step="1" />
        <span class="gi-value">{{ meanAnomalyDeg }}°</span>
      </div>

      <div class="gi-section">推演控制</div>
      <div class="gi-row">
        <span class="gi-label">时间倍速</span>
        <input v-model.number="timeScale" type="range" min="1" max="600" step="1" />
        <span class="gi-value">{{ timeScale }}×</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">地面覆盖</span>
        <input v-model="showCoverage" type="checkbox" />
      </div>
      <div class="gi-row">
        <span class="gi-label">星下点轨迹</span>
        <input v-model="showGroundTrack" type="checkbox" />
      </div>

      <button class="gi-button neutral" @click="rebase">以当前时刻重置历元</button>

      <div class="gi-result">{{ periodText }}</div>
      <div class="gi-result">{{ altText }}</div>
      <div class="gi-hint">{{ subPointText }}</div>
    </div>

    <div class="gi-legend">
      <div class="gi-legend-ticks">
        <span style="color: #8bdcff">轨道环</span>
        <span style="color: #ffd479">星下点</span>
      </div>
    </div>

    <div v-if="statusMessage" class="gi-status">{{ statusMessage }}</div>
  </div>
</template>
