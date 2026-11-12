<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { Cartesian3, Color, Entity, SceneTransforms, type Viewer } from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import {
  DETECTION_STYLES,
  advanceDetection,
  confidenceBucket,
  type Detection,
  type DetectionClass
} from '../geo-intel-lib/detection'
import { seededRandom } from '../geo-intel-lib/geometry'
import '../geo-intel-lib/panel.css'

type Box = {
  id: number
  left: number
  top: number
  width: number
  height: number
  confidence: number
  cls: DetectionClass
  headingDeg: number
  visible: boolean
  bucket: string
}

const container = ref<HTMLElement | null>(null)
const overlay = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载底图…')

const threshold = ref(0.5)
const showLabels = ref(true)
const showHeading = ref(true)
const boxThickness = ref(2)
const onlyVehicles = ref(false)

const detections = shallowRef<Detection[]>([])
const boxes = ref<Box[]>([])

let viewer: Viewer | undefined
let raf = 0
let lastTime = 0
const markerEntities: Entity[] = []

const CENTER_LAT = 22.5431
const CENTER_LON = 114.0579

function buildDetections(): Detection[] {
  const rand = seededRandom(20261112)
  const classes: DetectionClass[] = ['vehicle', 'vehicle', 'vehicle', 'person', 'person', 'vessel', 'aircraft']
  const list: Detection[] = []
  for (let i = 0; i < 26; i += 1) {
    const cls = classes[Math.floor(rand() * classes.length)]
    list.push({
      id: 1000 + i,
      cls,
      lat: CENTER_LAT + (rand() - 0.5) * 0.018,
      lon: CENTER_LON + (rand() - 0.5) * 0.022,
      heightM: 6 + rand() * 10,
      widthM: cls === 'vehicle' ? 4.6 : cls === 'person' ? 0.7 : cls === 'vessel' ? 18 : 12,
      heightSizeM: cls === 'vehicle' ? 1.8 : cls === 'person' ? 1.7 : cls === 'vessel' ? 6 : 4,
      confidence: 0.4 + rand() * 0.58,
      headingDeg: rand() * 360,
      speedMps: cls === 'vessel' ? 6 : cls === 'aircraft' ? 30 : cls === 'person' ? 1.2 : 9,
      lastSeenMs: Date.now()
    })
  }
  return list
}

function refreshMarkers(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const e of markerEntities) viewer.entities.remove(e)
  markerEntities.length = 0
  for (const det of detections.value) {
    const style = DETECTION_STYLES[det.cls]
    markerEntities.push(
      viewer.entities.add({
        position: Cartesian3.fromDegrees(det.lon, det.lat, det.heightM),
        point: {
          pixelSize: det.cls === 'person' ? 4 : 6,
          color: Color.fromCssColorString(style.color).withAlpha(0.85),
          outlineColor: Color.fromCssColorString('rgba(6,16,32,0.9)'),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      })
    )
  }
}

function updateBoxes(): void {
  if (!viewer || viewer.isDestroyed() || !overlay.value) return
  const scene = viewer.scene
  const canvas = scene.canvas
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const next: Box[] = []

  const cameraPos = scene.camera.positionWC
  const cameraDir = scene.camera.directionWC

  for (const det of detections.value) {
    if (onlyVehicles.value && det.cls !== 'vehicle') continue
    if (det.confidence < threshold.value) continue
    const world = Cartesian3.fromDegrees(det.lon, det.lat, det.heightM)
    const toTarget = Cartesian3.normalize(Cartesian3.subtract(world, cameraPos, new Cartesian3()), new Cartesian3())
    if (Cartesian3.dot(toTarget, cameraDir) <= 0.05) continue
    const surfaceNormal = scene.globe.ellipsoid.geodeticSurfaceNormal(world)
    const cameraNormal = scene.globe.ellipsoid.geodeticSurfaceNormal(cameraPos)
    if (Cartesian3.dot(surfaceNormal, cameraNormal) < 0.08) continue
    const screen = SceneTransforms.worldToWindowCoordinates(scene, world)
    if (!screen) continue
    if (screen.x < -80 || screen.y < -80 || screen.x > width + 80 || screen.y > height + 80) continue

    const dist = Cartesian3.distance(scene.camera.positionWC, world)
    const size = Math.max(18, Math.min(90, (det.widthM * 340) / Math.max(dist, 40)))
    const boxHeight = size * (det.heightSizeM / Math.max(det.widthM, 0.1))
    const bucket = confidenceBucket(det.confidence)
    next.push({
      id: det.id,
      left: screen.x - size / 2,
      top: screen.y - boxHeight,
      width: size,
      height: Math.max(14, Math.min(120, boxHeight)),
      confidence: det.confidence,
      cls: det.cls,
      headingDeg: det.headingDeg,
      visible: true,
      bucket
    })
  }
  boxes.value = next
}

function loop(now: number): void {
  raf = requestAnimationFrame(loop)
  const dt = lastTime ? Math.min(0.1, (now - lastTime) / 1000) : 0.016
  lastTime = now
  if (!viewer || viewer.isDestroyed()) return
  detections.value = detections.value.map((det) => advanceDetection(det, dt * 6))
  updateBoxes()
}

function boxColor(bucket: string): string {
  if (bucket === 'high') return '#54e39a'
  if (bucket === 'medium') return '#ffd166'
  return '#ff7a7a'
}

const visibleCount = computed(() => boxes.value.length)

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
      destination: Cartesian3.fromDegrees(CENTER_LON, CENTER_LAT, 2600),
      orientation: { heading: (18 * Math.PI) / 180, pitch: (-58 * Math.PI) / 180, roll: 0 }
    })
    detections.value = buildDetections()
    refreshMarkers()
    lastTime = 0
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

    <div ref="overlay" class="box-overlay">
      <div
        v-for="box in boxes"
        :key="box.id"
        class="det-box"
        :style="{
          left: `${box.left}px`,
          top: `${box.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          borderColor: boxColor(box.bucket),
          borderWidth: `${boxThickness}px`
        }"
      >
        <div v-if="showLabels" class="det-label" :style="{ background: boxColor(box.bucket) }">
          #{{ box.id }} {{ DETECTION_STYLES[box.cls].label }} {{ (box.confidence * 100).toFixed(0) }}%
        </div>
        <div
          v-if="showHeading"
          class="det-heading"
          :style="{ transform: `rotate(${box.headingDeg}deg)`, color: boxColor(box.bucket) }"
        >
          ▲
        </div>
      </div>
    </div>

    <div class="gi-panel">
      <div class="gi-title">检测框叠层</div>

      <div class="gi-row">
        <span class="gi-label">置信阈值</span>
        <input v-model.number="threshold" type="range" min="0.3" max="0.95" step="0.01" />
        <span class="gi-value">{{ (threshold * 100).toFixed(0) }}%</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">框线宽</span>
        <input v-model.number="boxThickness" type="range" min="1" max="4" step="1" />
        <span class="gi-value">{{ boxThickness }}px</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">显示标签</span>
        <input v-model="showLabels" type="checkbox" />
      </div>
      <div class="gi-row">
        <span class="gi-label">方向箭头</span>
        <input v-model="showHeading" type="checkbox" />
      </div>
      <div class="gi-row">
        <span class="gi-label">仅车辆</span>
        <input v-model="onlyVehicles" type="checkbox" />
      </div>

      <div class="gi-section">类别图例</div>
      <div>
        <span v-for="(style, key) in DETECTION_STYLES" :key="key" class="gi-chip" :style="{ color: style.color, borderColor: style.color }">
          {{ style.label }}
        </span>
      </div>

      <p class="gi-hint">包围框按目标尺寸与相机距离换算，随视角旋转实时贴合目标；绿色表示高置信度。</p>
      <div class="gi-result">当前显示 {{ visibleCount }} 个目标 / 总数 {{ detections.length }}</div>
    </div>

    <div v-if="statusMessage" class="gi-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.box-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.det-box {
  position: absolute;
  border-style: solid;
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35) inset;
}

.det-label {
  position: absolute;
  left: -2px;
  top: -16px;
  padding: 1px 4px;
  border-radius: 3px 3px 0 0;
  color: #08111f;
  font-size: 9px;
  font-weight: 700;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.det-heading {
  position: absolute;
  left: 50%;
  bottom: -15px;
  transform-origin: center;
  margin-left: -5px;
  font-size: 11px;
  line-height: 1;
}
</style>
