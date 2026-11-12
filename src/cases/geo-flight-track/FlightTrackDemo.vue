<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Color,
  Entity,
  PolygonHierarchy,
  PolylineGlowMaterialProperty,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import {
  DEFAULT_PREDICT,
  confidenceConePolygon,
  generateHistory,
  predictTrack,
  summarizeTrack,
  type PredictOptions,
  type TrackSample
} from '../geo-intel-lib/trajectory'
import { haversineM } from '../geo-intel-lib/geometry'
import '../geo-intel-lib/panel.css'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载底图…')

const speedKts = ref(430)
const headingDeg = ref(72)
const turnRate = ref(0.02)
const horizonMin = ref(10)
const speedBiasPct = ref(0)
const climbMps = ref(0.6)
const historyMinutes = ref(14)

const summaryText = ref('')
const predictedDistance = ref('')

let viewer: Viewer | undefined
let historyEntities: Entity[] = []
let predictionEntities: Entity[] = []

const KTS_TO_MPS = 0.514444
const ORIGIN = { lat: 31.1443, lon: 121.8083, heightM: 9200 }

const options = computed<PredictOptions>(() => ({
  ...DEFAULT_PREDICT,
  horizonSec: horizonMin.value * 60,
  turnRateDegPerSec: turnRate.value,
  speedBiasPct: speedBiasPct.value,
  climbMps: climbMps.value
}))

const history = computed<TrackSample[]>(() =>
  generateHistory(
    ORIGIN.lat,
    ORIGIN.lon,
    ORIGIN.heightM,
    headingDeg.value - 22,
    speedKts.value * KTS_TO_MPS,
    1 + Math.round(historyMinutes.value * 2),
    30,
    turnRate.value,
    climbMps.value
  )
)

const predicted = computed(() => predictTrack(history.value, options.value))

function clear(list: Entity[]): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const e of list) viewer.entities.remove(e)
  list.length = 0
}

function render(): void {
  if (!viewer || viewer.isDestroyed()) return
  clear(historyEntities)
  clear(predictionEntities)

  const samples = history.value
  const future = predicted.value
  const cone = confidenceConePolygon(future, samples)

  historyEntities.push(
    viewer.entities.add({
      polyline: {
        positions: samples.map((s) => Cartesian3.fromDegrees(s.lon, s.lat, s.heightM)),
        width: 4,
        material: new PolylineGlowMaterialProperty({
          color: Color.fromCssColorString('#7fd6ff'),
          glowPower: 0.18
        })
      }
    })
  )

  for (let i = 0; i < samples.length; i += 4) {
    const s = samples[i]
    historyEntities.push(
      viewer.entities.add({
        position: Cartesian3.fromDegrees(s.lon, s.lat, s.heightM),
        point: {
          pixelSize: 5,
          color: Color.fromCssColorString('rgba(160,225,255,0.8)'),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      })
    )
  }

  if (cone.length >= 3) {
    predictionEntities.push(
      viewer.entities.add({
        polygon: {
          hierarchy: new PolygonHierarchy(cone.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, ORIGIN.heightM - 500))),
          material: Color.fromCssColorString('rgba(255,190,80,0.16)'),
          outline: false,
          height: ORIGIN.heightM - 500
        }
      })
    )
  }

  predictionEntities.push(
    viewer.entities.add({
      polyline: {
        positions: [samples[samples.length - 1], ...future].map((s) => Cartesian3.fromDegrees(s.lon, s.lat, s.heightM)),
        width: 3,
        material: new PolylineGlowMaterialProperty({
          color: Color.fromCssColorString('#ffc857'),
          glowPower: 0.22
        })
      }
    })
  )

  const last = samples[samples.length - 1]
  predictionEntities.push(
    viewer.entities.add({
      position: Cartesian3.fromDegrees(last.lon, last.lat, last.heightM),
      point: {
        pixelSize: 10,
        color: Color.fromCssColorString('#ffffff'),
        outlineColor: Color.fromCssColorString('#ffb020'),
        outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: '当前位置',
        font: '11px sans-serif',
        fillColor: Color.fromCssColorString('#fff3d6'),
        showBackground: true,
        backgroundColor: Color.fromCssColorString('rgba(30,22,8,0.75)'),
        pixelOffset: new Cartesian2(0, -20),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
  )

  const tip = future[future.length - 1]
  if (tip) {
    predictionEntities.push(
      viewer.entities.add({
        position: Cartesian3.fromDegrees(tip.lon, tip.lat, tip.heightM),
        point: {
          pixelSize: 9,
          color: Color.fromCssColorString('#ffc857'),
          outlineColor: Color.fromCssColorString('#5a3c00'),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: `+${horizonMin.value} 分钟预测点`,
          font: '11px sans-serif',
          fillColor: Color.fromCssColorString('#ffe7b0'),
          showBackground: true,
          backgroundColor: Color.fromCssColorString('rgba(40,28,8,0.78)'),
          pixelOffset: new Cartesian2(0, -20),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      })
    )
  }

  const summary = summarizeTrack(samples)
  summaryText.value = `历史地速 ${(summary.speedMps / KTS_TO_MPS).toFixed(0)} kt · 航向 ${summary.headingDeg.toFixed(0)}° · 垂直速率 ${summary.verticalMps.toFixed(1)} m/s`
  const lastPred = future[future.length - 1]
  if (lastPred) {
    predictedDistance.value = `预测末端直线距离 ${(haversineM(last.lat, last.lon, lastPred.lat, lastPred.lon) / 1000).toFixed(1)} km`
  }
}

watch([speedKts, headingDeg, turnRate, horizonMin, speedBiasPct, climbMps, historyMinutes], () => render())

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
      destination: Cartesian3.fromDegrees(ORIGIN.lon + 0.55, ORIGIN.lat - 0.25, 42000),
      orientation: { heading: (28 * Math.PI) / 180, pitch: (-38 * Math.PI) / 180, roll: 0 }
    })
    render()
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="gi-shell">
    <div ref="container" class="gi-canvas"></div>

    <div class="gi-panel">
      <div class="gi-title">航迹外推</div>

      <div class="gi-section">航迹源参数</div>
      <div class="gi-row">
        <span class="gi-label">巡航速度</span>
        <input v-model.number="speedKts" type="range" min="180" max="900" step="10" />
        <span class="gi-value">{{ speedKts }}kt</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">初始航向</span>
        <input v-model.number="headingDeg" type="range" min="0" max="359" step="1" />
        <span class="gi-value">{{ headingDeg }}°</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">爬升率</span>
        <input v-model.number="climbMps" type="range" min="-4" max="6" step="0.2" />
        <span class="gi-value">{{ climbMps.toFixed(1) }}</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">历史时长</span>
        <input v-model.number="historyMinutes" type="range" min="4" max="30" step="1" />
        <span class="gi-value">{{ historyMinutes }}分</span>
      </div>

      <div class="gi-section">外推设置</div>
      <div class="gi-row">
        <span class="gi-label">外推时长</span>
        <input v-model.number="horizonMin" type="range" min="2" max="30" step="1" />
        <span class="gi-value">{{ horizonMin }}分</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">转弯率</span>
        <input v-model.number="turnRate" type="range" min="-0.15" max="0.15" step="0.005" />
        <span class="gi-value">{{ turnRate.toFixed(3) }}°/s</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">速度偏差</span>
        <input v-model.number="speedBiasPct" type="range" min="-25" max="25" step="1" />
        <span class="gi-value">{{ speedBiasPct }}%</span>
      </div>

      <p class="gi-hint">黄色锥形范围为不确定性带，随时间线性扩张；外推按恒定转弯率与速度偏差积分。</p>
      <div class="gi-result">{{ summaryText }}</div>
      <div class="gi-result">{{ predictedDistance }}</div>
    </div>

    <div class="gi-legend">
      <div class="gi-legend-ticks">
        <span style="color: #7fd6ff">历史航迹</span>
        <span style="color: #ffc857">外推航迹</span>
      </div>
    </div>

    <div v-if="statusMessage" class="gi-status">{{ statusMessage }}</div>
  </div>
</template>
