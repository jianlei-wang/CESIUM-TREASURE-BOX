<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Color,
  Entity,
  PolygonHierarchy,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import { pickLonLat } from '../geo-intel-lib/pick'
import {
  analyzeStudyArea,
  nearestFeatureDistanceM,
  signedDistanceToRing,
  type LonLat,
  type StudyFeature
} from '../geo-intel-lib/study-area'
import { seededRandom } from '../geo-intel-lib/geometry'
import '../geo-intel-lib/panel.css'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载底图…')
const probeText = ref('单击地图查询要素与研究区关系')

const drawing = ref(false)
const clipEnabled = ref(true)
const bufferKm = ref(0)
const categoryFilter = ref('all')
const draft = ref<LonLat[]>([])

const CATEGORIES = [
  { id: 'all', label: '全部类别' },
  { id: 'school', label: '学校' },
  { id: 'hospital', label: '医院' },
  { id: 'market', label: '商场' },
  { id: 'station', label: '站点' }
]
const CATEGORY_COLORS: Record<string, string> = {
  school: '#8fd3ff',
  hospital: '#ff9f9f',
  market: '#ffd479',
  station: '#a6f0c6'
}

const features = ref<StudyFeature[]>([])
const baseRing = ref<LonLat[]>([])
const stats = ref(analyzeStudyArea([], [], false))

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
const featureEntities = new Map<number, Entity>()
const areaEntities: Entity[] = []
let probeEntity: Entity | undefined

const CENTER = { lat: 39.9042, lon: 116.4074 }

function buildFeatures(): StudyFeature[] {
  const rand = seededRandom(20261112)
  const cats = ['school', 'hospital', 'market', 'station']
  const list: StudyFeature[] = []
  for (let i = 0; i < 140; i += 1) {
    list.push({
      id: i + 1,
      lat: CENTER.lat + (rand() - 0.5) * 0.1,
      lon: CENTER.lon + (rand() - 0.5) * 0.13,
      category: cats[Math.floor(rand() * cats.length)],
      weight: 0.4 + rand() * 1.6
    })
  }
  return list
}

function circleRing(lat: number, lon: number, radiusKm: number, segments = 48): LonLat[] {
  const ring: LonLat[] = []
  const dLat = radiusKm / 111.32
  const dLon = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180))
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2
    ring.push([lon + Math.cos(a) * dLon, lat + Math.sin(a) * dLat])
  }
  return ring
}

const effectiveRing = computed<LonLat[]>(() => {
  const ring = baseRing.value
  if (!ring.length) return []
  if (bufferKm.value <= 0) return ring
  const clat = ring.reduce((s, p) => s + p[1], 0) / ring.length
  const clon = ring.reduce((s, p) => s + p[0], 0) / ring.length
  const dLat = bufferKm.value / 111.32
  const dLon = bufferKm.value / (111.32 * Math.cos((clat * Math.PI) / 180))
  return ring.map(([lon, lat]) => [lon + Math.sign(lon - clon) * dLon, lat + Math.sign(lat - clat) * dLat])
})

function passesCategory(f: StudyFeature): boolean {
  return categoryFilter.value === 'all' || f.category === categoryFilter.value
}

function refreshFeatures(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const [, e] of featureEntities) viewer.entities.remove(e)
  featureEntities.clear()
  const ring = effectiveRing.value.length >= 3 ? effectiveRing.value : null
  for (const f of features.value) {
    if (!passesCategory(f)) continue
    const inside = !clipEnabled.value || !ring || signedDistanceToRing(f.lon, f.lat, ring) > 0
    const color = CATEGORY_COLORS[f.category] ?? '#9fc4e8'
    const entity = viewer.entities.add({
      position: Cartesian3.fromDegrees(f.lon, f.lat, 30),
      point: {
        pixelSize: inside ? 6 + f.weight * 3 : 4,
        color: Color.fromCssColorString(color).withAlpha(inside ? 0.95 : 0.22),
        outlineColor: Color.fromCssColorString('rgba(4,12,26,0.8)'),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
    featureEntities.set(f.id, entity)
  }
}

function refreshArea(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const e of areaEntities) viewer.entities.remove(e)
  areaEntities.length = 0
  const ring = effectiveRing.value
  if (ring.length >= 3) {
    areaEntities.push(
      viewer.entities.add({
        polygon: {
          hierarchy: new PolygonHierarchy(ring.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, 12))),
          material: Color.fromCssColorString('rgba(70,150,255,0.16)'),
          outline: true,
          outlineColor: Color.fromCssColorString('#69b4ff'),
          outlineWidth: 2,
          height: 12
        }
      })
    )
  }
  if (draft.value.length) {
    areaEntities.push(
      viewer.entities.add({
        polyline: {
          positions: draft.value.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, 30)),
          width: 2,
          material: Color.fromCssColorString('#ffd479'),
          clampToGround: false
        }
      })
    )
    for (const [lon, lat] of draft.value) {
      areaEntities.push(
        viewer.entities.add({
          position: Cartesian3.fromDegrees(lon, lat, 30),
          point: {
            pixelSize: 8,
            color: Color.fromCssColorString('#ffd479'),
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        })
      )
    }
  }
}

function recompute(): void {
  const ring = effectiveRing.value
  stats.value = analyzeStudyArea(features.value.filter(passesCategory), ring.length >= 3 ? ring : [], clipEnabled.value && ring.length >= 3)
  refreshFeatures()
  refreshArea()
}

function finishDrawing(): void {
  if (draft.value.length < 3) {
    probeText.value = '至少需要 3 个顶点才能形成研究区'
    return
  }
  baseRing.value = [...draft.value]
  draft.value = []
  drawing.value = false
  recompute()
  probeText.value = `研究区已建立，${baseRing.value.length} 个顶点`
}

function resetArea(): void {
  baseRing.value = circleRing(CENTER.lat, CENTER.lon, 3.6)
  bufferKm.value = 0
  recompute()
}

function onLeftClick(position: Cartesian2): void {
  if (!viewer) return
  const p = pickLonLat(viewer.scene, position)
  if (!p) return
  if (drawing.value) {
    draft.value.push([p.lon, p.lat])
    refreshArea()
    return
  }
  const ring = effectiveRing.value
  const dist = nearestFeatureDistanceM(features.value, p.lon, p.lat)
  if (ring.length >= 3) {
    const signed = signedDistanceToRing(p.lon, p.lat, ring)
    probeText.value = `距最近要素 ${(dist / 1000).toFixed(2)} km，该点位于研究区${signed > 0 ? '内' : '外'}`
  } else {
    probeText.value = `距最近要素 ${(dist / 1000).toFixed(2)} km`
  }
  if (probeEntity) viewer.entities.remove(probeEntity)
  probeEntity = viewer.entities.add({
    position: Cartesian3.fromDegrees(p.lon, p.lat, 40),
    point: {
      pixelSize: 10,
      color: Color.WHITE,
      outlineColor: Color.fromCssColorString('#2f80ed'),
      outlineWidth: 3,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })
}

watch([clipEnabled, bufferKm, categoryFilter], () => recompute())
watch(drawing, (on) => {
  if (on) {
    draft.value = []
    probeText.value = '绘制中：依次单击地图添加顶点，再点击完成绘制'
    refreshArea()
  }
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
      destination: Cartesian3.fromDegrees(CENTER.lon, CENTER.lat, 16000),
      orientation: { heading: 0, pitch: (-70 * Math.PI) / 180, roll: 0 }
    })
    features.value = buildFeatures()
    resetArea()

    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event.position), ScreenSpaceEventType.LEFT_CLICK)
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

const densityText = computed(() => stats.value.density.toFixed(2))
const areaText = computed(() => stats.value.areaKm2.toFixed(2))
const ratioText = computed(() =>
  stats.value.totalWeight > 0 ? ((stats.value.coveredWeight / stats.value.totalWeight) * 100).toFixed(1) : '0.0'
)
</script>

<template>
  <div class="gi-shell">
    <div ref="container" class="gi-canvas"></div>

    <div class="gi-panel">
      <div class="gi-title">研究区裁剪</div>

      <button class="gi-button primary" :class="{ active: drawing }" @click="drawing = !drawing">
        {{ drawing ? '绘制中…单击添加顶点' : '绘制自定义研究区' }}
      </button>
      <button v-if="drawing" class="gi-button neutral" @click="finishDrawing">完成绘制</button>
      <button class="gi-button neutral" @click="resetArea">恢复默认圆形研究区</button>

      <div class="gi-section">裁剪设置</div>
      <div class="gi-row">
        <span class="gi-label">启用裁剪</span>
        <input v-model="clipEnabled" type="checkbox" />
      </div>
      <div class="gi-row">
        <span class="gi-label">外扩缓冲</span>
        <input v-model.number="bufferKm" type="range" min="0" max="4" step="0.1" />
        <span class="gi-value">{{ bufferKm.toFixed(1) }}km</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">类别</span>
        <select v-model="categoryFilter">
          <option v-for="c in CATEGORIES" :key="c.id" :value="c.id">{{ c.label }}</option>
        </select>
      </div>

      <div class="gi-section">统计结果</div>
      <div class="stat-grid">
        <div class="stat-cell"><span class="stat-num">{{ stats.insideCount }}</span><span class="stat-label">区内要素</span></div>
        <div class="stat-cell"><span class="stat-num">{{ stats.totalCount }}</span><span class="stat-label">筛选总数</span></div>
        <div class="stat-cell"><span class="stat-num">{{ areaText }}</span><span class="stat-label">面积 km²</span></div>
        <div class="stat-cell"><span class="stat-num">{{ densityText }}</span><span class="stat-label">密度 /km²</span></div>
      </div>

      <p class="gi-hint">要素权重覆盖率 {{ ratioText }}%；裁剪关闭时统计全部筛选要素。</p>
      <div class="gi-hint">{{ probeText }}</div>
    </div>

    <div v-if="statusMessage" class="gi-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.stat-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border: 1px solid rgba(157, 188, 224, 0.18);
  border-radius: 6px;
  background: rgba(22, 40, 68, 0.6);
}

.stat-num {
  color: #d7ecff;
  font-size: 14px;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.stat-label {
  color: #8ea5c2;
  font-size: 10px;
}
</style>
