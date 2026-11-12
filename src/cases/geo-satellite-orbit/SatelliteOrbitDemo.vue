<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArcType,
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
  orbitalPeriodSec,
  propagateEci,
  splitGroundTrack,
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

let viewer: Viewer | undefined
let raf = 0
let simMs = Date.now()
let lastFrame = 0
const orbitEntities: Entity[] = []

function elements(): OrbitElements {
  return {
    semiMajorAxisKm: semiMajorKm.value,
    eccentricity: eccentricity.value,
    inclinationDeg: inclinationDeg.value,
    raanDeg: raanDeg.value,
    argPerigeeDeg: argPerigeeDeg.value,
    meanAnomalyDeg: meanAnomalyDeg.value,
    epochMs: simMs
  }
}

const EARTH_R = 6371

function clearOrbit(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const e of orbitEntities) viewer.entities.remove(e)
  orbitEntities.length = 0
}

function orbitRingPoints(el: OrbitElements, samples = 180): Array<{ lat: number; lon: number; heightM: number }> {
  const period = orbitalPeriodSec(el.semiMajorAxisKm) * 1000
  const out: Array<{ lat: number; lon: number; heightM: number }> = []
  for (let i = 0; i <= samples; i += 1) {
    const t = el.epochMs + (period * i) / samples
    const g = eciToGeodetic(propagateEci(el, t), t)
    out.push({ lat: g.lat, lon: g.lon, heightM: Math.max(0, g.heightKm * 1000) })
  }
  return out
}

function buildStatic(): void {
  if (!viewer || viewer.isDestroyed()) return
  clearOrbit()
  const el = elements()

  const ring = orbitRingPoints(el)
  let segment: Array<{ lat: number; lon: number; heightM: number }> = []
  const flush = (): void => {
    if (segment.length > 1) {
      orbitEntities.push(
        viewer!.entities.add({
          polyline: {
            positions: segment.map((p) => Cartesian3.fromDegrees(p.lon, p.lat, p.heightM)),
            width: 2,
            material: new PolylineGlowMaterialProperty({
              color: Color.fromCssColorString('#8bdcff'),
              glowPower: 0.2
            }),
            arcType: ArcType.GEODESIC
          }
        })
      )
    }
    segment = []
  }
  for (let i = 0; i < ring.length; i += 1) {
    if (i > 0 && Math.abs(ring[i].lon - ring[i - 1].lon) > 180) flush()
    segment.push(ring[i])
  }
  flush()

  if (showGroundTrack.value) {
    const track = groundTrack(el, el.epochMs, orbitalPeriodSec(el.semiMajorAxisKm), 240)
    const segments = splitGroundTrack(track)
    for (const seg of segments) {
      if (seg.length < 2) continue
      orbitEntities.push(
        viewer.entities.add({
          polyline: {
            positions: seg.map((p) => Cartesian3.fromDegrees(p.lon, p.lat, 1200)),
            width: 2,
            material: new PolylineGlowMaterialProperty({
              color: Color.fromCssColorString('#ffd479'),
              glowPower: 0.16
            }),
            arcType: ArcType.GEODESIC
          }
        })
      )
    }
  }

  const period = orbitalPeriodSec(el.semiMajorAxisKm)
  periodText.value = `轨道周期 ${(period / 60).toFixed(1)} 分钟`
  altText.value = `近地高度 ${(semiMajorKm.value - EARTH_R).toFixed(0)} km / 偏心率 ${eccentricity.value.toFixed(4)}`
}

function updateSatellite(nowMs: number): void {
  if (!viewer || viewer.isDestroyed()) return
  const el = elements()
  const eci = propagateEci(el, nowMs)
  const g = eciToGeodetic(eci, nowMs)
  const pos = Cartesian3.fromDegrees(g.lon, g.lat, Math.max(0, g.heightKm * 1000))

  const marker = viewer.entities.getById('orbit-satellite')
  if (marker) {
    marker.position = new ConstantPositionProperty(pos)
  } else {
    viewer.entities.add({
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

  const coverage = viewer.entities.getById('orbit-coverage')
  const footprintDeg = Math.acos(EARTH_R / Math.max(EARTH_R, semiMajorKm.value)) * (180 / Math.PI) * 111
  const ring = circleRing(g.lat, g.lon, footprintDeg * 1000 * 0.55, 64)
  if (showCoverage.value) {
    if (coverage) viewer.entities.remove(coverage)
    viewer.entities.add({
      id: 'orbit-coverage',
      polygon: {
        hierarchy: new PolygonHierarchy(ring.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, 500))),
        material: Color.fromCssColorString('rgba(90,190,255,0.16)'),
        outline: true,
        outlineColor: Color.fromCssColorString('rgba(140,220,255,0.7)'),
        outlineWidth: 1,
        height: 500
      }
    })
  } else if (coverage) {
    viewer.entities.remove(coverage)
  }

  subPointText.value = `星下点 ${g.lat.toFixed(2)}°, ${normalizeLon(g.lon).toFixed(2)}° · 高度 ${g.heightKm.toFixed(0)} km`
}

function loop(now: number): void {
  raf = requestAnimationFrame(loop)
  const dt = lastFrame ? (now - lastFrame) / 1000 : 0
  lastFrame = now
  if (!viewer || viewer.isDestroyed()) return
  simMs += dt * 1000 * timeScale.value
  updateSatellite(simMs)
  viewer.scene.requestRender()
}

function rebase(): void {
  simMs = Date.now()
  buildStatic()
  updateSatellite(simMs)
}

watch(
  [semiMajorKm, eccentricity, inclinationDeg, raanDeg, argPerigeeDeg, meanAnomalyDeg],
  () => {
    buildStatic()
    updateSatellite(simMs)
  }
)
watch([showCoverage, showGroundTrack], () => {
  buildStatic()
  updateSatellite(simMs)
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
