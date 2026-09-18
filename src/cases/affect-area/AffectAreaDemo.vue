<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  Color,
  ConstantProperty,
  Math as CesiumMath,
  PolygonHierarchy,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import {
  FlowRingMaterialProperty,
  PulseDiffuseMaterialProperty,
  registerFlowMaterials
} from '../flow-lines-lib/materials'
import arrowUrl from './arrow.png'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')

const centerLon = ref(110)
const centerLat = ref(40)
const coverRadius = ref(1200)
const ringCount = ref(3)
const ringFlowSpeed = ref(40)
const ringWidth = ref(5)
const repeatFactor = ref(30)
const clockwise = ref(false)
const pulseOn = ref(true)
const pulseSpeed = ref(18)
const themeId = ref<'warm' | 'cool' | 'amber'>('warm')

const THEMES: Record<string, string[]> = {
  warm: ['#ff6b6b', '#ffa94d', '#8ce99a'],
  cool: ['#4dabf7', '#748ffc', '#b197fc'],
  amber: ['#ff4500', '#ffa500', '#ffd700']
}

let viewer: Viewer | undefined
let rings: Array<FlowRingMaterialProperty> = []
let pulseMaterial: PulseDiffuseMaterialProperty | undefined

const RING_FRACTIONS: Record<number, number[]> = {
  1: [1],
  2: [0.55, 1],
  3: [0.36, 0.68, 1]
}

function destinationPoint(
  lng: number,
  lat: number,
  angleDeg: number,
  distance: number
): { lng: number; lat: number } {
  const a = 6378137
  const b = 6356752.3142
  const f = 1 / 298.257223563
  const alpha1 = (angleDeg * Math.PI) / 180
  const sinAlpha1 = Math.sin(alpha1)
  const cosAlpha1 = Math.cos(alpha1)
  const tanU1 = (1 - f) * Math.tan((lat * Math.PI) / 180)
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1)
  const sinU1 = tanU1 * cosU1
  const sigma1 = Math.atan2(tanU1, cosAlpha1)
  const sinAlpha = cosU1 * sinAlpha1
  const cosSqAlpha = 1 - sinAlpha * sinAlpha
  const uSq = (cosSqAlpha * (a * a - b * b)) / (b * b)
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)))
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)))
  let sigma = distance / (b * A)
  let sigmaP = 2 * Math.PI
  let cos2SigmaM = 0
  let sinSigma = 0
  let cosSigma = 0
  while (Math.abs(sigma - sigmaP) > 1e-12) {
    cos2SigmaM = Math.cos(2 * sigma1 + sigma)
    sinSigma = Math.sin(sigma)
    cosSigma = Math.cos(sigma)
    const deltaSigma =
      B * sinSigma * (cos2SigmaM + (B / 4) * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) - (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)))
    sigmaP = sigma
    sigma = distance / (b * A) + deltaSigma
  }
  const tmp = sinU1 * sinSigma - cosU1 * cosSigma * cosAlpha1
  const lat2 = Math.atan2(
    sinU1 * cosSigma + cosU1 * sinSigma * cosAlpha1,
    (1 - f) * Math.sqrt(sinAlpha * sinAlpha + tmp * tmp)
  )
  const lambda = Math.atan2(
    sinSigma * sinAlpha1,
    cosU1 * cosSigma - sinU1 * sinSigma * cosAlpha1
  )
  const C = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha))
  const L =
    lambda -
    (1 - C) *
      f *
      sinAlpha *
      (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)))
  return { lng: lng + (L * 180) / Math.PI, lat: (lat2 * 180) / Math.PI }
}

function circlePositions(
  lng: number,
  lat: number,
  radius: number,
  reverse: boolean
): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  const steps = Math.max(120, Math.min(360, Math.ceil(radius / 6)))
  for (let i = 0; i <= steps; i++) {
    const p = destinationPoint(lng, lat, (i * 360) / steps, radius)
    reverse ? pts.unshift([p.lng, p.lat]) : pts.push([p.lng, p.lat])
  }
  return pts
}

function clearEntities(): void {
  if (!viewer) return
  for (let i = 0; i < 6; i++) {
    const ring = viewer.entities.getById(`affect-ring-${i}`)
    if (ring) viewer.entities.remove(ring)
    const fill = viewer.entities.getById(`affect-fill-${i}`)
    if (fill) viewer.entities.remove(fill)
  }
  rings = []
  pulseMaterial = undefined
}

function rebuild(): void {
  if (!viewer || viewer.isDestroyed()) return
  clearEntities()
  const lng = centerLon.value
  const lat = centerLat.value
  const palette = THEMES[themeId.value]
  const fractions = RING_FRACTIONS[ringCount.value]
  for (let i = 0; i < fractions.length; i++) {
    const radius = coverRadius.value * fractions[i]
    const color = Color.fromCssColorString(palette[i % palette.length]).withAlpha(0.9)
    const repeatX = Math.max(6, Math.round((radius / 30) * (repeatFactor.value / 20)))
    const material = new FlowRingMaterialProperty(color, ringFlowSpeed.value, repeatX, arrowUrl)
    const positions = circlePositions(lng, lat, radius, clockwise.value).map(([x, y]) =>
      Cartesian3.fromDegrees(x, y, 3)
    )
    viewer.entities.add({
      id: `affect-ring-${i}`,
      polyline: {
        positions: new ConstantProperty(positions),
        width: ringWidth.value,
        material
      }
    })
    rings.push(material)
    if (pulseOn.value && i === 0) {
      const pulseColor = Color.fromCssColorString(palette[0]).withAlpha(0.55)
      pulseMaterial = new PulseDiffuseMaterialProperty(pulseColor, pulseSpeed.value)
      viewer.entities.add({
        id: 'affect-fill-0',
        polygon: {
          hierarchy: new PolygonHierarchy(positions),
          material: pulseMaterial
        }
      })
    }
  }
}

function restyleExisting(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const mat of rings) {
    mat.speed = ringFlowSpeed.value
    const index = rings.indexOf(mat)
    const palette = THEMES[themeId.value]
    mat.color = Color.fromCssColorString(palette[index % palette.length]).withAlpha(0.9)
  }
  if (pulseMaterial) {
    pulseMaterial.speed = pulseSpeed.value
    const palette = THEMES[themeId.value]
    pulseMaterial.color = Color.fromCssColorString(palette[0]).withAlpha(0.55)
  }
}

function onCenterBlur(): void {
  rebuild()
}

function onSpeedColor(): void {
  restyleExisting()
}

function onRebuild(): void {
  rebuild()
}

onMounted(async () => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    registerFlowMaterials()
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.scene.globe.depthTestAgainstTerrain = false
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(centerLon.value, centerLat.value, 42000),
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 }
    })
    rebuild()
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  destroyScene(viewer)
  viewer = undefined
  rings = []
  pulseMaterial = undefined
})
</script>

<template>
  <div class="affect-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="affect-panel">
      <div class="panel-title">影响区域-扩散光圈</div>
      <div class="row">
        <span class="row-label">中心经度</span>
        <input v-model.number="centerLon" class="num-input" type="number" min="-180" max="180" step="0.1" @change="onCenterBlur" />
      </div>
      <div class="row">
        <span class="row-label">中心纬度</span>
        <input v-model.number="centerLat" class="num-input" type="number" min="-90" max="90" step="0.1" @change="onCenterBlur" />
      </div>
      <div class="row">
        <span class="row-label">覆盖半径</span>
        <input v-model.number="coverRadius" class="slider" type="range" min="200" max="4000" step="50" @change="onRebuild" />
        <b class="value">{{ coverRadius }}m</b>
      </div>
      <div class="row">
        <span class="row-label">箭头圈数</span>
        <div class="seg-group">
          <button v-for="n in 3" :key="n" class="seg" :class="{ on: ringCount === n }" @click="ringCount = n; onRebuild()">{{ n }}</button>
        </div>
      </div>
      <div class="row">
        <span class="row-label">颜色主题</span>
        <select v-model="themeId" class="select" @change="onSpeedColor">
          <option value="warm">红橙绿</option>
          <option value="cool">蓝紫青</option>
          <option value="amber">焰火金</option>
        </select>
      </div>
      <div class="row">
        <span class="row-label">流向</span>
        <div class="seg-group">
          <button class="seg" :class="{ on: !clockwise }" @click="clockwise = false; onRebuild()">逆</button>
          <button class="seg" :class="{ on: clockwise }" @click="clockwise = true; onRebuild()">顺</button>
        </div>
      </div>
      <div class="row">
        <span class="row-label">流动速度</span>
        <input v-model.number="ringFlowSpeed" class="slider" type="range" min="5" max="200" step="1" @change="onSpeedColor" />
        <b class="value">{{ ringFlowSpeed }}</b>
      </div>
      <div class="row">
        <span class="row-label">线宽</span>
        <input v-model.number="ringWidth" class="slider" type="range" min="2" max="12" step="1" @change="onRebuild" />
        <b class="value">{{ ringWidth }}px</b>
      </div>
      <div class="row">
        <span class="row-label">箭头密度</span>
        <input v-model.number="repeatFactor" class="slider" type="range" min="10" max="50" step="1" @change="onRebuild" />
        <b class="value">{{ repeatFactor }}</b>
      </div>
      <div class="row">
        <span class="row-label">扩散脉冲</span>
        <button class="toggle" :class="{ on: pulseOn }" aria-label="切换扩散脉冲" @click="pulseOn = !pulseOn; onRebuild()"><i></i></button>
        <input v-if="pulseOn" v-model.number="pulseSpeed" class="slider" type="range" min="4" max="80" step="1" @change="onSpeedColor" />
        <b v-if="pulseOn" class="value">{{ pulseSpeed }}</b>
      </div>
      <div class="hint">多圈带流向箭头的覆盖光圈 + 最内圈扩散脉冲，用于标注影响/作用范围；参数均实时可调。</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.affect-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
  border-radius: 8px;
  background: #152b4c;
}
.cesium-container {
  width: 100%;
  height: 100%;
}
.affect-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  width: 264px;
  padding: 11px;
  border: 1px solid rgba(157, 188, 224, 0.22);
  border-radius: 9px;
  background: rgba(10, 26, 52, 0.86);
  backdrop-filter: blur(6px);
  color: #dce8f5;
  font-size: 12px;
}
.panel-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #8ec8ff;
  margin-bottom: 6px;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 7px 0;
}
.row-label {
  flex: 0 0 58px;
  color: #c3d5e8;
  font-size: 11px;
}
.num-input {
  width: 70px;
  background: rgba(20, 42, 80, 0.7);
  border: 1px solid rgba(120, 180, 255, 0.35);
  border-radius: 4px;
  color: #eaf3ff;
  padding: 2px 6px;
  font-size: 12px;
}
.slider {
  flex: 1;
  min-width: 0;
  accent-color: #2f80ed;
}
.value {
  flex: 0 0 46px;
  color: #9fc2cf;
  font-size: 10px;
  text-align: right;
}
.seg-group {
  display: flex;
  gap: 4px;
}
.seg {
  padding: 2px 10px;
  border: 1px solid rgba(120, 180, 255, 0.45);
  background: transparent;
  color: #cfe4ff;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}
.seg.on {
  background: rgba(47, 128, 237, 0.55);
  color: #fff;
}
.select {
  background: rgba(20, 42, 80, 0.7);
  border: 1px solid rgba(120, 180, 255, 0.35);
  color: #eaf3ff;
  border-radius: 4px;
  font-size: 12px;
  padding: 2px 4px;
}
.toggle {
  flex: none;
  position: relative;
  width: 36px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(157, 188, 224, 0.35);
  cursor: pointer;
}
.toggle i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #e7f5f8;
  transition: transform 0.2s;
}
.toggle.on {
  background: #2f80ed;
}
.toggle.on i {
  transform: translateX(18px);
}
.hint {
  margin-top: 8px;
  border-top: 1px solid rgba(157, 188, 224, 0.2);
  padding-top: 6px;
  color: #6d84a3;
  font-size: 10px;
  line-height: 1.6;
}
.status-mask {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: 380px;
  padding: 8px 14px;
  border: 1px solid rgba(137, 210, 233, 0.4);
  border-radius: 7px;
  color: #e8f4fa;
  background: rgba(8, 21, 40, 0.88);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35);
  font-size: 12px;
  pointer-events: none;
  text-align: center;
  line-height: 1.5;
}
</style>
