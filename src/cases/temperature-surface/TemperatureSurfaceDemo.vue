<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as Cesium from 'cesium'
import {
  Cartesian3,
  Cartographic,
  Color,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'

type Sample = { lon: number; lat: number; temp: number }

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('')
const hoverText = ref('鼠标悬停查看温度值')

const centerLon = ref(116.4)
const centerLat = ref(39.9)
const regionSpan = ref(0.08)
const pointCount = ref(150)
const gridSize = ref(80)
const tempMin = ref(-10)
const tempMax = ref(35)
const heightBase = ref(500)
const heightScale = ref(4000)
const surfaceOpacity = ref(0.85)
const showPoints = ref(true)

const metricPoints = ref('0')
const metricVertices = ref('0')
const metricRange = ref('-10 ~ 35 °C')

const legendCss = computed(
  () => 'linear-gradient(to right, rgb(255,0,0), rgb(255,255,0), rgb(0,255,0), rgb(0,255,255), rgb(0,0,255))'
)

let viewer: Viewer | undefined
let samples: Sample[] = []
let surfacePrimitive: Cesium.Primitive | undefined
let pointCollection: Cesium.PointPrimitiveCollection | undefined
let handler: ScreenSpaceEventHandler | undefined

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function tempColor(t: number): [number, number, number] {
  const minT = tempMin.value
  const maxT = Math.max(minT + 0.01, tempMax.value)
  const r = clamp01((t - minT) / (maxT - minT))
  if (r < 0.25) return [0, r * 4, 1]
  if (r < 0.5) return [0, 1, 1 - (r - 0.25) * 4]
  if (r < 0.75) return [(r - 0.5) * 4, 1, 0]
  return [1, 1 - (r - 0.75) * 4, 0]
}

function heightForTemp(t: number): number {
  const minT = tempMin.value
  const maxT = Math.max(minT + 0.01, tempMax.value)
  return heightBase.value + clamp01((t - minT) / (maxT - minT)) * heightScale.value
}

function idw(lon: number, lat: number): number {
  let sum = 0
  let weightSum = 0
  for (let i = 0; i < samples.length; i += 1) {
    const dx = lon - samples[i].lon
    const dy = lat - samples[i].lat
    const d2 = dx * dx + dy * dy
    if (d2 < 1e-14) return samples[i].temp
    const w = 1 / d2
    sum += w * samples[i].temp
    weightSum += w
  }
  return weightSum > 0 ? sum / weightSum : (tempMin.value + tempMax.value) / 2
}

function generatePoints(): void {
  const next: Sample[] = []
  const n = Math.max(8, Math.round(pointCount.value))
  const region = Math.max(0.01, regionSpan.value)
  const lon0 = centerLon.value
  const lat0 = centerLat.value
  const minT = tempMin.value
  const maxT = Math.max(minT + 0.01, tempMax.value)
  for (let i = 0; i < n; i += 1) {
    const ang = Math.random() * Math.PI * 2
    const r = Math.sqrt(Math.random()) * region
    next.push({
      lon: lon0 + Math.cos(ang) * r,
      lat: lat0 + Math.sin(ang) * r,
      temp: minT + Math.random() * (maxT - minT)
    })
  }
  samples = next
}

function removeSurface(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (surfacePrimitive) {
    viewer.scene.primitives.remove(surfacePrimitive)
    surfacePrimitive = undefined
  }
  if (pointCollection) {
    viewer.scene.primitives.remove(pointCollection)
    pointCollection = undefined
  }
}

function surfaceAppearance(): Cesium.Appearance {
  return new Cesium.Appearance({
    translucent: true,
    closed: false,
    renderState: {
      depthTest: { enabled: true },
      cull: { enabled: false },
      blending: Cesium.BlendingState.ALPHA_BLEND
    },
    vertexShaderSource: `
      in vec3 position3DHigh;
      in vec3 position3DLow;
      in float batchId;
      in vec4 color;
      out vec4 v_color;
      void main()
      {
        vec4 position = czm_translateRelativeToEye(position3DHigh, position3DLow);
        v_color = color;
        gl_Position = czm_modelViewProjectionRelativeToEye * position;
      }
    `,
    fragmentShaderSource: `
      in vec4 v_color;
      void main()
      {
        out_FragColor = v_color;
      }
    `
  })
}

function rebuildSurface(): void {
  if (!viewer || viewer.isDestroyed() || !samples.length) return
  const grid = Math.max(16, Math.min(120, Math.round(gridSize.value)))
  const verts = grid + 1
  const lon0 = centerLon.value - regionSpan.value
  const lat0 = centerLat.value - regionSpan.value
  const dLon = (regionSpan.value * 2) / grid
  const dLat = (regionSpan.value * 2) / grid
  const alpha = Math.round(clamp01(surfaceOpacity.value) * 255)
  const vertexCount = verts * verts
  const positions = new Float64Array(vertexCount * 3)
  const colors = new Uint8Array(vertexCount * 4)
  let po = 0
  let co = 0
  for (let j = 0; j < verts; j += 1) {
    const lat = lat0 + j * dLat
    for (let i = 0; i < verts; i += 1) {
      const lon = lon0 + i * dLon
      const t = idw(lon, lat)
      const p = Cartesian3.fromDegrees(lon, lat, heightForTemp(t))
      positions[po] = p.x
      positions[po + 1] = p.y
      positions[po + 2] = p.z
      const [r, g, b] = tempColor(t)
      colors[co] = Math.round(r * 255)
      colors[co + 1] = Math.round(g * 255)
      colors[co + 2] = Math.round(b * 255)
      colors[co + 3] = alpha
      po += 3
      co += 4
    }
  }
  const indices: number[] = []
  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const tl = j * verts + i
      const tr = tl + 1
      const bl = (j + 1) * verts + i
      const br = bl + 1
      indices.push(tl, bl, br)
      indices.push(tl, br, tr)
    }
  }
  const attributes = new Cesium.GeometryAttributes()
  attributes.position = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positions
  })
  attributes.color = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
    componentsPerAttribute: 4,
    normalize: true,
    values: colors
  })
  const boundingSphere = Cesium.BoundingSphere.fromVertices(positions)
  if (!Number.isFinite(boundingSphere.radius) || boundingSphere.radius <= 0) boundingSphere.radius = 1
  const geometry = new Cesium.Geometry({
    attributes,
    indices: vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere
  })
  if (surfacePrimitive) {
    viewer.scene.primitives.remove(surfacePrimitive)
    surfacePrimitive = undefined
  }
  surfacePrimitive = viewer.scene.primitives.add(
    new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry }),
      appearance: surfaceAppearance(),
      asynchronous: false,
      allowPicking: true
    })
  )
  metricPoints.value = String(samples.length)
  metricVertices.value = String(vertexCount)
  metricRange.value = `${tempMin.value} ~ ${tempMax.value} °C`
  viewer.scene.requestRender()
}

function rebuildPoints(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (pointCollection) {
    viewer.scene.primitives.remove(pointCollection)
    pointCollection = undefined
  }
  if (!showPoints.value || !samples.length) {
    viewer.scene.requestRender()
    return
  }
  const collection = new Cesium.PointPrimitiveCollection()
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i]
    const [r, g, b] = tempColor(s.temp)
    collection.add({
      position: Cartesian3.fromDegrees(s.lon, s.lat, heightForTemp(s.temp) + 40),
      color: new Color(r, g, b, 1),
      outlineColor: Color.WHITE,
      outlineWidth: 1,
      pixelSize: 8
    })
  }
  pointCollection = viewer.scene.primitives.add(collection)
  viewer.scene.requestRender()
}

function rebuildAll(): void {
  rebuildSurface()
  rebuildPoints()
}

function onRegenerate(): void {
  generatePoints()
  rebuildAll()
}

function flyToSurface(): void {
  if (!viewer || viewer.isDestroyed()) return
  const span = Math.max(0.02, regionSpan.value)
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(centerLon.value, centerLat.value - span * 0.3, Math.max(8000, span * 275000)),
    orientation: {
      heading: 0,
      pitch: CesiumMath.toRadians(-50),
      roll: 0
    },
    duration: 1.1
  })
}

function onCenterChange(): void {
  generatePoints()
  rebuildAll()
  flyToSurface()
}

function pickHover(endPosition: Cesium.Cartesian2): void {
  if (!viewer || viewer.isDestroyed()) return
  let cartesian: Cartesian3 | undefined
  const picked = viewer.scene.pick(endPosition)
  if (picked && (picked.primitive === surfacePrimitive || picked.primitive === pointCollection)) {
    cartesian = viewer.scene.pickPosition(endPosition)
  }
  if (!cartesian) {
    const ray = viewer.camera.getPickRay(endPosition)
    cartesian = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined
  }
  if (!cartesian) {
    hoverText.value = '鼠标悬停查看温度值'
    return
  }
  const carto = Cartographic.fromCartesian(cartesian)
  const lon = CesiumMath.toDegrees(carto.longitude)
  const lat = CesiumMath.toDegrees(carto.latitude)
  const dx = lon - centerLon.value
  const dy = lat - centerLat.value
  if (Math.hypot(dx, dy) > regionSpan.value * 1.35) {
    hoverText.value = '鼠标悬停查看温度值'
    return
  }
  const temp = idw(lon, lat)
  hoverText.value = `经度 ${lon.toFixed(4)}°  纬度 ${lat.toFixed(4)}°  温度 ${temp.toFixed(1)} °C`
}

onMounted(() => {
  if (!container.value) return
  const callbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  viewer = createMapScene(container.value, callbacks)
  loadBingImagery(viewer, callbacks)
  generatePoints()
  rebuildAll()
  flyToSurface()
  handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  handler.setInputAction((event: ScreenSpaceEventHandler.MotionEvent) => {
    pickHover(event.endPosition)
  }, ScreenSpaceEventType.MOUSE_MOVE)
})

onBeforeUnmount(() => {
  handler?.destroy()
  handler = undefined
  removeSurface()
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="ts-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="hover-box">
      <b>温度曲面可视化</b>
      <span>{{ hoverText }}</span>
    </div>

    <div class="ts-panel">
      <div class="panel-title">温度曲面可视化</div>
      <div class="panel-subtitle">测温点 IDW 插值三维曲面</div>

      <div class="section-title">数据</div>
      <div class="ts-row">
        <button class="ts-btn" @click="onRegenerate">随机生成</button>
        <button class="ts-btn ghost" @click="flyToSurface">定位</button>
      </div>
      <div class="ts-param">
        <span>采样点数</span>
        <input v-model.number="pointCount" type="range" min="30" max="400" step="10" @change="onRegenerate" />
        <b>{{ pointCount }}</b>
      </div>
      <div class="ts-param">
        <span>网格密度</span>
        <input v-model.number="gridSize" type="range" min="20" max="120" step="10" @change="rebuildSurface" />
        <b>{{ gridSize }}</b>
      </div>
      <div class="ts-param">
        <span>区域半径</span>
        <input v-model.number="regionSpan" type="range" min="0.03" max="0.16" step="0.01" @change="onCenterChange" />
        <b>{{ regionSpan.toFixed(2) }}°</b>
      </div>

      <div class="section-title">位置</div>
      <div class="ts-param">
        <span>经度</span>
        <input v-model.number="centerLon" class="ts-number" type="number" step="0.01" @change="onCenterChange" />
      </div>
      <div class="ts-param">
        <span>纬度</span>
        <input v-model.number="centerLat" class="ts-number" type="number" step="0.01" @change="onCenterChange" />
      </div>

      <div class="section-title">温度与形态</div>
      <div class="ts-param">
        <span>最低温</span>
        <input v-model.number="tempMin" type="range" min="-30" max="20" step="1" @change="rebuildAll" />
        <b>{{ tempMin }}°C</b>
      </div>
      <div class="ts-param">
        <span>最高温</span>
        <input v-model.number="tempMax" type="range" min="10" max="50" step="1" @change="rebuildAll" />
        <b>{{ tempMax }}°C</b>
      </div>
      <div class="ts-param">
        <span>基准高度</span>
        <input v-model.number="heightBase" type="range" min="0" max="2000" step="50" @change="rebuildAll" />
        <b>{{ heightBase }}</b>
      </div>
      <div class="ts-param">
        <span>高度拉伸</span>
        <input v-model.number="heightScale" type="range" min="500" max="8000" step="100" @change="rebuildAll" />
        <b>{{ heightScale }}</b>
      </div>
      <div class="ts-param">
        <span>透明度</span>
        <input v-model.number="surfaceOpacity" type="range" min="0.3" max="1" step="0.05" @change="rebuildSurface" />
        <b>{{ surfaceOpacity.toFixed(2) }}</b>
      </div>
      <label class="check-row">
        <input v-model="showPoints" type="checkbox" @change="rebuildPoints" />
        显示测温点
      </label>

      <div class="section-title">色带</div>
      <div class="ts-legend" :style="{ background: legendCss }"></div>
      <div class="ts-legend-labels"><span>{{ tempMax }}°C 高温</span><span>{{ tempMin }}°C 低温</span></div>

      <div class="ts-metrics">
        <div><span>测温点</span><strong>{{ metricPoints }}</strong></div>
        <div><span>网格顶点</span><strong>{{ metricVertices }}</strong></div>
        <div class="wide"><span>温度范围</span><strong>{{ metricRange }}</strong></div>
      </div>
    </div>

    <div v-if="statusMessage" class="ts-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.ts-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #061421; color: #e8fbff; font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif; }
.cesium-container { width: 100%; height: 100%; }
.hover-box { position: absolute; top: 12px; left: 12px; z-index: 10; display: flex; flex-direction: column; gap: 4px; min-width: 210px; padding: 10px 12px; border: 1px solid rgba(91, 255, 226, 0.22); border-radius: 8px; background: rgba(8, 28, 43, 0.88); font-size: 12px; line-height: 1.5; }
.hover-box b { font-size: 13px; }
.hover-box span { color: #9cc9d8; font-size: 11px; }
.ts-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 7px; width: 250px; max-height: calc(100% - 24px); overflow-y: auto; padding: 11px; border: 1px solid rgba(91, 255, 226, 0.28); border-radius: 9px; background: rgba(8, 28, 43, 0.9); backdrop-filter: blur(6px); }
.panel-title { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
.panel-subtitle { font-size: 11px; color: #7da9b8; }
.section-title { margin-top: 4px; padding: 2px 0 1px; border-bottom: 1px solid rgba(91, 255, 226, 0.18); font-size: 11px; font-weight: 700; color: #5fffe0; }
.ts-row { display: flex; align-items: center; gap: 6px; }
.ts-btn { flex: 1; height: 26px; border: 0; border-radius: 5px; background: #257f9e; color: #edfaff; cursor: pointer; font-size: 11px; }
.ts-btn.ghost { background: rgba(13, 42, 58, 0.9); border: 1px solid rgba(91, 255, 226, 0.24); color: #d9eff6; }
.ts-param { display: flex; align-items: center; gap: 8px; }
.ts-param span { flex: 0 0 58px; font-size: 11px; color: #bdd9e4; }
.ts-param input[type="range"] { flex: 1; min-width: 0; height: 4px; accent-color: #5fffe0; }
.ts-param b { flex: 0 0 44px; color: #9cc9d8; font-size: 10px; text-align: right; }
.ts-number { flex: 1; height: 22px; padding: 0 6px; border: 1px solid rgba(91, 255, 226, 0.24); border-radius: 5px; background: rgba(13, 42, 58, 0.78); color: #d9eff6; font-size: 11px; }
.check-row { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #bdd9e4; }
.check-row input { accent-color: #5fffe0; }
.ts-legend { height: 10px; border-radius: 5px; border: 1px solid rgba(91, 255, 226, 0.25); }
.ts-legend-labels { display: flex; justify-content: space-between; color: #7da9b8; font-size: 10px; }
.ts-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.ts-metrics > div { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border: 1px solid rgba(54, 141, 255, 0.18); border-radius: 6px; background: rgba(13, 42, 58, 0.6); }
.ts-metrics .wide { grid-column: 1 / -1; }
.ts-metrics span { font-size: 10px; color: #7da9b8; }
.ts-metrics strong { font-size: 12px; color: #e8fbff; }
.ts-status { position: absolute; inset: 0; z-index: 9; display: grid; place-items: center; padding: 24px; color: #d9eff6; background: rgba(4, 23, 37, 0.72); font-size: 12px; }
</style>
