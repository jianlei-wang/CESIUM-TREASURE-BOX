<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import * as Cesium from 'cesium'
import { createMapScene, destroyScene, loadBingImagery } from '../../lib/cesium-scene'
import { pickCartographic } from '../measure-lib/pick'
import { LbmD3Q19, windMsToLattice } from './cfd-lbm'
import { createCfdScene, createCfdSceneFromRectangle, type CfdSceneModel } from './cfd-scene'
import {
  FlowParticles,
  SliceOverlay,
  SpeedPointCloud,
  VolumeStack,
  renderCfdBuildings,
  renderRegionBox,
  renderWindArrow,
  speedGradientCss,
  updateWindArrow
} from './cfd-render'
import { CFD_REALTIME_HELP } from './help'

const RES_OPTIONS = [24, 32, 40]
const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']

function dirLabel(deg: number): string {
  return `${DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]}风`
}

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const isLoaded = ref(false)
const helpOpen = ref(false)
const helpKey = ref('')

const form = reactive({
  nx: 32,
  windDirection: 45,
  windSpeedMs: 4,
  tau: 0.8,
  subIterations: 3,
  playing: true,
  showSlice: false,
  showVolume: true,
  showIso: false,
  showFlow: false,
  sliceOffset: 0.28,
  sliceOpacity: 0.85,
  volumeOpacity: 0.88,
  isoOpacity: 0.9,
  isoValue: 0.35,
  particleOpacity: 0.85,
  particleCount: 700
})

const stats = reactive({
  step: 0,
  maxSpeed: 0,
  avgSpeed: 0,
  fps: 0
})

const sceneModel = shallowRef<CfdSceneModel | undefined>()
const drawing = ref(false)
const gridLabel = computed(() => {
  const size = gridSize(sceneModel.value)
  return `${size.nx} × ${size.ny} × ${size.nz}`
})
const windText = computed(() => `${form.windSpeedMs.toFixed(1)} m/s · ${dirLabel(form.windDirection)}`)
const regionText = computed(() => {
  const model = sceneModel.value
  if (!model) return '400 × 400 m'
  return `${model.width.toFixed(0)} × ${model.depth.toFixed(0)} m`
})

const TIPS: Record<string, string> = {
  nx: '水平网格分辨率。数值越大绕流越精细，每帧计算量近似按格点数线性增长。',
  subIterations: '每渲染帧推进的 LBM 子步数。越大流场演化越快，帧率越低。',
  tau: 'BGK 松弛时间，运动粘度 ν = (τ − 0.5)/3。τ 越小粘性越小、越容易失稳。',
  windDirection: '风的来向（气象方位角，0° 为北风）。入口速度与体积力沿下风向驱动。',
  windSpeedMs: '物理风速 0~10 m/s，内部映射到稳定格子速度。过大接近格子声速会失稳。',
  region: '在地图上用两次左键画对角矩形，作为仿真计算范围；右键取消。',
  showSlice: '在指定高度绘制水平速度/示踪切片，颜色越暖浓度或风速越高。',
  sliceOffset: '水平切片相对仿真高度的位置，100% 靠近顶面。',
  sliceOpacity: '水平切片整体不透明度。调到 100% 时整张切面应清晰可见。',
  showVolume: '多层半透明切片堆叠的三维示踪烟羽，低浓度透明、核心偏红。',
  volumeOpacity: '三维体渲染的整体不透明度。',
  showIso: '按示踪浓度阈值提取等值面点云，用于观察烟羽外轮廓。',
  isoValue: '等值面浓度阈值，相对入口射流峰值。',
  showFlow: '从入口射流附近释放粒子，沿速度场漂散，辅助观察绕流。',
  particleOpacity: '流线粒子的整体不透明度。',
  particleCount: '粒子数量，越多流场越密、开销越大。'
}

const tip = reactive({ visible: false, text: '', x: 0, y: 0, below: false })

function onTipOver(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  const icon = target?.closest('.info-tip') as HTMLElement | null
  const text = icon?.dataset.tip
  if (!icon || !text) return
  const rect = icon.getBoundingClientRect()
  const half = 106
  tip.text = text
  tip.x = Math.min(Math.max(rect.left + rect.width / 2, half), window.innerWidth - half)
  tip.below = rect.top < 150
  tip.y = tip.below ? rect.bottom + 9 : rect.top - 9
  tip.visible = true
}

function onTipOut(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (target?.closest('.info-tip')) tip.visible = false
}

function hideTip(): void {
  tip.visible = false
}

let viewer: Cesium.Viewer | undefined
let solver: LbmD3Q19 | undefined
let slice: SliceOverlay | undefined
let volumeField: VolumeStack | undefined
let isoCloud: SpeedPointCloud | undefined
let flow: FlowParticles | undefined
let windEntities: Cesium.Entity[] = []
let buildingEntities: Cesium.Entity[] = []
let removePreUpdate: (() => void) | undefined
let frameStamp = 0
let frameCount = 0
let fpsStamp = 0
let regionEntity: Cesium.Entity | undefined
let previewEntity: Cesium.Entity | undefined
let drawHandler: Cesium.ScreenSpaceEventHandler | undefined
let rectAnchor: { lon: number; lat: number } | null = null

function gridSize(model: CfdSceneModel | undefined): { nx: number; ny: number; nz: number } {
  const nxRef = form.nx
  if (!model) {
    return { nx: nxRef, ny: nxRef, nz: Math.max(16, Math.round(nxRef * 0.62)) }
  }
  const cell = Math.max(model.width, model.depth) / nxRef
  return {
    nx: Math.max(16, Math.round(model.width / cell)),
    ny: Math.max(16, Math.round(model.depth / cell)),
    nz: Math.max(16, Math.round(nxRef * 0.62))
  }
}

function latticeWind(): number {
  return windMsToLattice(form.windSpeedMs)
}

function makeSolver(model: CfdSceneModel): LbmD3Q19 {
  const { nx, ny, nz } = gridSize(model)
  const next = new LbmD3Q19({
    nx,
    ny,
    nz,
    width: model.width,
    depth: model.depth,
    height: model.height,
    tau: form.tau,
    windDirection: form.windDirection,
    windSpeed: latticeWind()
  })
  next.reset(model.buildings)
  return next
}

function applyWind(): void {
  solver?.setWind(form.windDirection, latticeWind())
  solver?.setTau(form.tau)
  if (viewer && sceneModel.value) updateWindArrow(windEntities, sceneModel.value.city, form.windDirection, sceneModel.value.width)
}

function rebuildGrid(): void {
  const model = sceneModel.value
  if (!viewer || !model) return
  solver = makeSolver(model)
  slice?.destroy()
  slice = new SliceOverlay(viewer, model.city, solver, sliceHeight())
  volumeField?.rebuild(solver)
  flow?.setSolver(solver)
  stats.step = 0
}

function sliceHeight(): number {
  if (!solver) return 12
  return Math.max(solver.dz, form.sliceOffset * solver.height)
}

function sliceLayer(): number {
  if (!solver) return 1
  return Math.max(1, Math.min(solver.nz - 1, Math.round(form.sliceOffset * (solver.nz - 1))))
}

function updateViz(): void {
  if (!solver) return
  const maxSpeed = Math.max(0.02, solver.maxSpeed)
  if (form.showSlice) slice?.update(solver, sliceLayer(), maxSpeed, form.sliceOpacity, sliceHeight())
  slice?.setVisible(form.showSlice)
  if (form.showVolume) volumeField?.update(solver, form.volumeOpacity)
  volumeField?.setVisible(form.showVolume)
  if (form.showIso) isoCloud?.update(solver, 'iso', form.isoValue, maxSpeed, form.isoOpacity, 1)
  isoCloud?.setVisible(form.showIso)
  flow?.setVisible(form.showFlow)
  flow?.setOpacity(form.particleOpacity)
  if (flow) flow.playing = form.playing && form.showFlow
  stats.step = solver.stepCount
  stats.maxSpeed = solver.maxSpeed
  stats.avgSpeed = solver.avgSpeed
}

function resetSim(): void {
  const model = sceneModel.value
  if (!solver || !model) return
  solver.setWind(form.windDirection, latticeWind())
  solver.setTau(form.tau)
  solver.reset(model.buildings)
  updateViz()
}

function stepOnce(): void {
  if (!solver) return
  solver.setWind(form.windDirection, latticeWind())
  solver.setTau(form.tau)
  solver.step()
  updateViz()
}

function exportField(): void {
  if (!solver) return
  const data = solver.exportMacro()
  const blob = new Blob([JSON.stringify({
    nx: data.nx,
    ny: data.ny,
    nz: data.nz,
    step: solver.stepCount,
    maxSpeed: solver.maxSpeed,
    avgSpeed: solver.avgSpeed,
    windDirection: form.windDirection,
    windSpeedMs: form.windSpeedMs,
    windSpeedLattice: latticeWind(),
    tau: form.tau
  })], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `cfd-macro-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function flyToModel(model: CfdSceneModel): void {
  if (!viewer) return
  const dest = Cesium.Cartesian3.fromDegrees(model.center.lon, model.center.lat, 0)
  const sphere = new Cesium.BoundingSphere(dest, Math.max(model.width, model.depth) * 0.9)
  viewer.camera.flyToBoundingSphere(sphere, {
    duration: 1.2,
    offset: new Cesium.HeadingPitchRange(0.95, -0.5, Math.max(model.width, model.depth) * 2.15)
  })
}

function bindScene(model: CfdSceneModel): void {
  if (!viewer) return
  slice?.destroy()
  volumeField?.destroy()
  if (isoCloud) isoCloud.destroy(viewer)
  if (flow) flow.destroy(viewer)
  for (const entity of [...buildingEntities, ...windEntities]) viewer.entities.remove(entity)
  if (regionEntity) viewer.entities.remove(regionEntity)
  buildingEntities = []
  windEntities = []
  regionEntity = undefined
  sceneModel.value = model
  buildingEntities = renderCfdBuildings(viewer, model.city)
  windEntities = renderWindArrow(viewer, model.city, form.windDirection, model.width)
  regionEntity = renderRegionBox(viewer, model.city, model.width, model.depth, model.height)
  solver = makeSolver(model)
  slice = new SliceOverlay(viewer, model.city, solver, sliceHeight())
  volumeField = new VolumeStack(viewer, model.city, solver)
  isoCloud = new SpeedPointCloud(viewer, model.city)
  flow = new FlowParticles(viewer, model.city, form.particleCount)
  flow.setSolver(solver)
  updateViz()
}

type LonLatPoint = { lon: number; lat: number }

function pickLonLat(position: Cesium.Cartesian2): LonLatPoint | undefined {
  if (!viewer) return undefined
  const carto = pickCartographic(viewer.scene, position)
  if (!carto) return undefined
  return { lon: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) }
}

function rectangleRing(a: LonLatPoint, b: LonLatPoint): number[] {
  return [a.lon, a.lat, b.lon, a.lat, b.lon, b.lat, a.lon, b.lat]
}

function clearPreview(): void {
  if (viewer && previewEntity) {
    viewer.entities.remove(previewEntity)
    previewEntity = undefined
  }
}

function showPreview(a: LonLatPoint, b: LonLatPoint): void {
  if (!viewer) return
  const positions = Cesium.Cartesian3.fromDegreesArray(rectangleRing(a, b))
  if (previewEntity?.polygon) {
    previewEntity.polygon.hierarchy = new Cesium.ConstantProperty(new Cesium.PolygonHierarchy(positions))
    return
  }
  previewEntity = viewer.entities.add({
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(positions),
      height: 2,
      material: Cesium.Color.fromCssColorString('#7fd0e6').withAlpha(0.22),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString('#7fd0e6')
    }
  })
}

function stopDraw(): void {
  drawing.value = false
  rectAnchor = null
  drawHandler?.destroy()
  drawHandler = undefined
  clearPreview()
}

function applyDrawnRect(a: LonLatPoint, b: LonLatPoint): void {
  const west = Math.min(a.lon, b.lon)
  const east = Math.max(a.lon, b.lon)
  const south = Math.min(a.lat, b.lat)
  const north = Math.max(a.lat, b.lat)
  const model = createCfdSceneFromRectangle(west, south, east, north)
  if (!model) {
    statusMessage.value = '范围过小，请绘制边长至少 80 m 的矩形'
    return
  }
  stopDraw()
  bindScene(model)
  flyToModel(model)
  statusMessage.value = `已应用仿真范围 ${model.width.toFixed(0)} × ${model.depth.toFixed(0)} m`
}

function startDrawRect(): void {
  if (!viewer) return
  stopDraw()
  drawing.value = true
  statusMessage.value = '左键点击两个对角点绘制仿真范围，右键取消'
  drawHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  drawHandler.setInputAction((event: { position: Cesium.Cartesian2 }) => {
    const point = pickLonLat(event.position)
    if (!point) return
    if (!rectAnchor) {
      rectAnchor = point
      showPreview(point, point)
      return
    }
    applyDrawnRect(rectAnchor, point)
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
  drawHandler.setInputAction((event: { endPosition: Cesium.Cartesian2 }) => {
    if (!rectAnchor) return
    const point = pickLonLat(event.endPosition)
    if (point) showPreview(rectAnchor, point)
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
  drawHandler.setInputAction(() => {
    stopDraw()
    statusMessage.value = ''
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)
}

function restoreDefaultRegion(): void {
  stopDraw()
  const model = createCfdScene()
  bindScene(model)
  flyToModel(model)
  statusMessage.value = '已恢复默认 400 × 400 m 仿真范围'
}

onMounted(async () => {
  if (!container.value) return
  viewer = createMapScene(container.value, { onStatus: (msg) => (statusMessage.value = msg) })
  loadBingImagery(viewer, { onStatus: (msg) => (statusMessage.value = msg) })
  const model = createCfdScene()
  bindScene(model)
  flyToModel(model)
  frameStamp = performance.now()
  fpsStamp = frameStamp
  removePreUpdate = viewer.scene.preUpdate.addEventListener(() => {
    if (!solver) return
    if (form.playing) {
      solver.setWind(form.windDirection, latticeWind())
      solver.setTau(form.tau)
      const iters = Math.max(1, Math.min(4, Math.round(form.subIterations)))
      for (let i = 0; i < iters; i += 1) solver.step()
    }
    frameCount += 1
    const now = performance.now()
    if (now - fpsStamp > 500) {
      stats.fps = Math.round((frameCount * 1000) / (now - fpsStamp))
      frameCount = 0
      fpsStamp = now
    }
    if (!form.playing || now - frameStamp > 80) {
      updateViz()
      frameStamp = now
    }
  })
  isLoaded.value = true
  statusMessage.value = ''
  updateViz()
})

onBeforeUnmount(() => {
  removePreUpdate?.()
  stopDraw()
  if (viewer) {
    slice?.destroy()
    volumeField?.destroy()
    isoCloud?.destroy(viewer)
    flow?.destroy(viewer)
    for (const entity of [...buildingEntities, ...windEntities]) viewer.entities.remove(entity)
    if (regionEntity) viewer.entities.remove(regionEntity)
    destroyScene(viewer)
  }
  viewer = undefined
  solver = undefined
})

function onResChange(): void {
  rebuildGrid()
  updateViz()
}

function onParticleCount(): void {
  flow?.resize(form.particleCount)
}
</script>

<template>
  <div class="cfd-shell">
    <div ref="container" class="cesium-container" />
    <div class="control-panel" @mouseover="onTipOver" @mouseout="onTipOut" @scroll="hideTip">
      <div class="panel-title">实时三维 CFD 仿真</div>
      <div class="section-title">求解控制</div>
      <div class="button-row">
        <button class="action-button primary" @click="form.playing = !form.playing">{{ form.playing ? '暂停' : '继续' }}</button>
        <button class="action-button" @click="stepOnce">单步</button>
        <button class="action-button accent" @click="resetSim">重置</button>
      </div>
      <div class="control-row">
        <span class="row-label">网格<span class="info-tip" :data-tip="TIPS.nx">?</span></span>
        <select v-model.number="form.nx" @change="onResChange">
          <option v-for="n in RES_OPTIONS" :key="n" :value="n">{{ n }}³ 级</option>
        </select>
        <span class="row-value">{{ gridLabel }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">子迭代<span class="info-tip" :data-tip="TIPS.subIterations">?</span></span>
        <input v-model.number="form.subIterations" type="range" min="1" max="4" step="1" />
        <span class="row-value">{{ form.subIterations }} /帧</span>
      </div>
      <div class="control-row">
        <span class="row-label">松弛时间 τ<span class="info-tip" :data-tip="TIPS.tau">?</span></span>
        <input v-model.number="form.tau" type="range" min="0.56" max="1.6" step="0.02" @input="applyWind" />
        <span class="row-value">{{ form.tau.toFixed(2) }}</span>
      </div>

      <div class="section-title">仿真范围</div>
      <div class="button-row">
        <button class="action-button" :class="{ primary: drawing }" @click="startDrawRect">{{ drawing ? '绘制中…' : '绘制矩形' }}</button>
        <button class="action-button" @click="restoreDefaultRegion">默认范围</button>
      </div>
      <div class="control-row">
        <span class="row-label">当前范围<span class="info-tip" :data-tip="TIPS.region">?</span></span>
        <span class="row-value">{{ regionText }}</span>
      </div>

      <div class="section-title">风场</div>
      <div class="control-row">
        <span class="row-label">风向<span class="info-tip" :data-tip="TIPS.windDirection">?</span></span>
        <input v-model.number="form.windDirection" type="range" min="0" max="359" step="5" @input="applyWind" />
        <span class="row-value">{{ form.windDirection }}° {{ dirLabel(form.windDirection) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">风速<span class="info-tip" :data-tip="TIPS.windSpeedMs">?</span></span>
        <input v-model.number="form.windSpeedMs" type="range" min="0" max="10" step="0.1" @input="applyWind" />
        <span class="row-value">{{ form.windSpeedMs.toFixed(1) }} m/s</span>
      </div>

      <div class="section-title">可视化</div>
      <label class="switch-row"><span>水平切片<span class="info-tip" :data-tip="TIPS.showSlice">?</span></span><input v-model="form.showSlice" type="checkbox" /></label>
      <div v-if="form.showSlice" class="control-row">
        <span class="row-label">切片高度<span class="info-tip" :data-tip="TIPS.sliceOffset">?</span></span>
        <input v-model.number="form.sliceOffset" type="range" min="0.08" max="0.9" step="0.02" />
        <span class="row-value">{{ (form.sliceOffset * 100).toFixed(0) }}%</span>
      </div>
      <div v-if="form.showSlice" class="control-row">
        <span class="row-label">切片透明度<span class="info-tip" :data-tip="TIPS.sliceOpacity">?</span></span>
        <input v-model.number="form.sliceOpacity" type="range" min="0.15" max="1" step="0.05" />
        <span class="row-value">{{ (form.sliceOpacity * 100).toFixed(0) }}%</span>
      </div>
      <label class="switch-row"><span>三维体渲染<span class="info-tip" :data-tip="TIPS.showVolume">?</span></span><input v-model="form.showVolume" type="checkbox" /></label>
      <div v-if="form.showVolume" class="control-row">
        <span class="row-label">体透明度<span class="info-tip" :data-tip="TIPS.volumeOpacity">?</span></span>
        <input v-model.number="form.volumeOpacity" type="range" min="0.15" max="1" step="0.05" />
        <span class="row-value">{{ (form.volumeOpacity * 100).toFixed(0) }}%</span>
      </div>
      <label class="switch-row"><span>等值面<span class="info-tip" :data-tip="TIPS.showIso">?</span></span><input v-model="form.showIso" type="checkbox" /></label>
      <div v-if="form.showIso" class="control-row">
        <span class="row-label">等值阈值<span class="info-tip" :data-tip="TIPS.isoValue">?</span></span>
        <input v-model.number="form.isoValue" type="range" min="0.01" max="0.12" step="0.005" />
        <span class="row-value">{{ form.isoValue.toFixed(3) }}</span>
      </div>
      <label class="switch-row"><span>流线粒子<span class="info-tip" :data-tip="TIPS.showFlow">?</span></span><input v-model="form.showFlow" type="checkbox" /></label>
      <div v-if="form.showFlow" class="control-row">
        <span class="row-label">粒子透明度<span class="info-tip" :data-tip="TIPS.particleOpacity">?</span></span>
        <input v-model.number="form.particleOpacity" type="range" min="0.2" max="1" step="0.05" />
        <span class="row-value">{{ (form.particleOpacity * 100).toFixed(0) }}%</span>
      </div>
      <div v-if="form.showFlow" class="control-row">
        <span class="row-label">粒子数量<span class="info-tip" :data-tip="TIPS.particleCount">?</span></span>
        <input v-model.number="form.particleCount" type="range" min="200" max="1800" step="100" @change="onParticleCount" />
        <span class="row-value">{{ form.particleCount }}</span>
      </div>

      <div class="stat-grid">
        <div class="stat-cell"><span>步数</span><b>{{ stats.step }}</b></div>
        <div class="stat-cell"><span>FPS</span><b>{{ stats.fps }}</b></div>
        <div class="stat-cell"><span>最大 |u|</span><b>{{ stats.maxSpeed.toFixed(3) }}</b></div>
      </div>
      <div class="legend">
        <div class="legend-bar" :style="{ background: speedGradientCss() }" />
        <div class="legend-labels"><span>低浓度</span><span>{{ windText }}</span><span>高浓度</span></div>
      </div>
      <div class="button-row">
        <button class="action-button" @click="exportField">导出宏观量</button>
      </div>
      <button class="help-toggle" @click="helpOpen = !helpOpen">功能实现说明</button>
      <div v-if="helpOpen" class="help-panel">
        <div class="help-head">
          <span>LBM-D3Q19 实时 CFD</span>
          <button class="help-close" @click="helpOpen = false">×</button>
        </div>
        <div v-for="item in CFD_REALTIME_HELP" :key="item.key" class="help-item">
          <button class="help-item-head" :class="{ active: helpKey === item.key }" @click="helpKey = helpKey === item.key ? '' : item.key">
            <span>{{ item.title }}</span><i>{{ helpKey === item.key ? '−' : '+' }}</i>
          </button>
          <template v-if="helpKey === item.key">
            <p class="help-summary">{{ item.summary }}</p>
            <ul class="help-detail">
              <li v-for="line in item.detail" :key="line">{{ line }}</li>
            </ul>
          </template>
        </div>
      </div>
      <p class="hint">入口注入彩虹示踪射流，LBM-D3Q19 在米色城市白模中实时绕流。默认开启三维体渲染；切片、等值面与粒子可叠加。观感对标 GPU 全三维 CFD 烟羽可视化。</p>
    </div>
    <div v-if="!isLoaded || statusMessage" class="status-mask">{{ statusMessage || '场景加载中…' }}</div>
    <Teleport to="body">
      <div
        v-if="tip.visible"
        class="tip-bubble"
        :class="{ below: tip.below }"
        :style="{ left: `${tip.x}px`, top: `${tip.y}px` }"
      >{{ tip.text }}</div>
    </Teleport>
  </div>
</template>

<style scoped>
.cfd-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #0f2438; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 5px; width: 292px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; box-sizing: border-box; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 26, 44, 0.92); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.panel-title { font-size: 13px; font-weight: 700; margin-bottom: 2px; }
.section-title { margin-top: 8px; margin-bottom: 2px; padding-bottom: 2px; border-bottom: 1px solid rgba(137, 210, 233, 0.16); font-size: 11px; font-weight: 700; color: #7fd0e6; }
.button-row { display: flex; gap: 6px; margin-top: 4px; }
.action-button { flex: 1; min-height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; color: #edfaff; background: #1b4c66; }
.action-button.primary { background: #257f9e; }
.action-button.accent { background: #8a6d1a; color: #fff3d6; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 2px 0; color: #c3d8e6; }
.row-label { flex: 0 0 auto; display: inline-flex; align-items: center; }
.info-tip { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 13px; height: 13px; margin-left: 4px; border-radius: 50%; background: rgba(127, 208, 230, 0.2); color: #7fd0e6; font-size: 9px; font-weight: 700; cursor: help; vertical-align: middle; }
.tip-bubble { position: fixed; z-index: 9999; width: 200px; padding: 6px 9px; border: 1px solid rgba(127, 208, 230, 0.42); border-radius: 6px; background: rgba(4, 18, 32, 0.97); color: #ddf2f8; font-size: 10px; font-weight: 400; line-height: 1.5; text-align: left; transform: translate(-50%, -100%); pointer-events: none; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45); }
.tip-bubble.below { transform: translate(-50%, 0); }
.tip-bubble::after { content: ''; position: absolute; left: 50%; top: 100%; transform: translateX(-50%); border: 6px solid transparent; border-top-color: rgba(127, 208, 230, 0.42); }
.tip-bubble.below::after { top: auto; bottom: 100%; border-top-color: transparent; border-bottom-color: rgba(127, 208, 230, 0.42); }
.row-value { flex: 0 0 86px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row select { width: 92px; height: 22px; padding: 0 5px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.switch-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; color: #c3d8e6; }
.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 5px; }
.stat-cell { display: flex; flex-direction: column; gap: 2px; padding: 5px 4px; border: 1px solid rgba(137, 210, 233, 0.2); border-radius: 5px; background: rgba(16, 43, 64, 0.55); text-align: center; }
.stat-cell span { font-size: 9px; color: #8fb0c8; }
.stat-cell b { font-size: 12px; color: #d9eff6; }
.legend { margin-top: 5px; }
.legend-bar { height: 10px; border-radius: 3px; border: 1px solid rgba(137, 210, 233, 0.25); }
.legend-labels { display: flex; justify-content: space-between; margin-top: 2px; font-size: 9px; color: #8fb0c8; }
.hint { margin: 6px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.5; }
.help-toggle { margin-top: 7px; min-height: 26px; border: 1px solid rgba(255, 199, 92, 0.5); border-radius: 5px; background: rgba(74, 58, 12, 0.4); color: #ffd666; cursor: pointer; font-size: 11px; }
.help-panel { margin-top: 6px; padding: 8px; border: 1px solid rgba(255, 199, 92, 0.45); border-radius: 6px; background: rgba(30, 24, 8, 0.55); }
.help-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; color: #ffd666; font-weight: 700; }
.help-close { border: 0; background: transparent; color: #cbb98a; cursor: pointer; font-size: 14px; line-height: 1; }
.help-item { border-top: 1px solid rgba(255, 199, 92, 0.16); }
.help-item-head { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 5px 0; border: 0; background: transparent; color: #e9d9ae; cursor: pointer; font-size: 11px; text-align: left; }
.help-item-head.active { color: #ffe9a8; }
.help-item-head i { font-style: normal; font-size: 13px; }
.help-summary { margin: 0 0 3px; font-size: 10px; color: #d9cdab; line-height: 1.5; }
.help-detail { margin: 0; padding-left: 15px; }
.help-detail li { font-size: 10px; color: #cbbd97; line-height: 1.55; margin-bottom: 2px; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 11; width: max-content; max-width: 440px; padding: 8px 14px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); font-size: 12px; pointer-events: none; text-align: center; }
</style>
