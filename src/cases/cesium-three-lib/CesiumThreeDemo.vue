<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { Viewer } from 'cesium'
import { createMapScene, destroyScene, loadBingImagery } from '../../lib/cesium-scene'
import { GeoThreeStage } from './stage'
import type { CalibrationRow, ParamValue, ParamValues, ScenarioRuntime, SimulationMode } from './types'
import { defaultValues } from './types'
import { SCENARIO_MAP } from './scenarios'
import { SimulationClock } from './core/SimulationClock'
import { SIMULATION_MODES } from './simulations/contract'
import type { PerformanceSnapshot } from './core/PerformanceMonitor'
import { QUALITY_PRESETS, type QualityPreset } from './core/QualityGovernor'
import { getProvenance } from './data/provenance'

const props = defineProps<{ scenario: string }>()

const meta = SCENARIO_MAP[props.scenario]
const host = ref<HTMLElement | null>(null)
const values = reactive<ParamValues>(meta ? defaultValues(meta) : {})
const smoothedValues: ParamValues = meta ? { ...defaultValues(meta) } : {}
const readouts = ref<Record<string, number | string>>({})
const paused = ref(false)
const status = ref('初始化中…')
const infoOpen = ref(false)
const mode = ref<SimulationMode>('interactive')
const qualityPreset = ref<QualityPreset>('auto')
const provenance = meta ? getProvenance(meta.id) : null
const diagnostics = ref<Record<string, number | string>>({})
const calibration = ref<CalibrationRow[]>([])
const performanceStats = ref<PerformanceSnapshot | null>(null)
const clock = new SimulationClock({ fixedDt: 1 / 60, maxSubSteps: 8 })
let statsTimer = 0

let viewer: Viewer | null = null
let stage: GeoThreeStage | null = null
let runtime: ScenarioRuntime | null = null
let syncTimer: number | null = null
let sceneReady = false

function asNumber(value: ParamValue | undefined): number {
  return typeof value === 'number' ? value : 0
}

function asText(value: ParamValue | undefined): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

function readout(key: string): string {
  const value = readouts.value[key]
  if (value === undefined) return '—'
  return String(value)
}

function onInput(key: string, type: string, event: Event): void {
  const target = event.target as HTMLInputElement | HTMLSelectElement
  if (type === 'range') values[key] = Number(target.value)
  else if (type === 'toggle') values[key] = (target as HTMLInputElement).checked
  else values[key] = target.value
}

function togglePause(): void {
  paused.value = !paused.value
  clock.paused = paused.value
  status.value = paused.value ? '已暂停' : '运行中'
}

function stepOnce(): void {
  if (!runtime) return
  clock.stepOnce()
  if (runtime.fixedUpdate) runtime.fixedUpdate(clock.fixedDt, smoothedValues)
  else runtime.update(clock.fixedDt, smoothedValues)
  runtime.renderSync?.(1, smoothedValues)
  readouts.value = runtime.readouts()
}

function applyMode(next: SimulationMode): void {
  mode.value = next
  stage?.setAutoOrbit(next === 'cinema')
  runtime?.setMode?.(next)
  status.value = SIMULATION_MODES.find((item) => item.value === next)?.hint ?? status.value
  diagnostics.value = runtime?.diagnostics?.() ?? {}
  calibration.value = runtime?.calibration?.() ?? []
}

function runAction(key: string): void {
  runtime?.action?.(key, { ...values })
}

function resetParams(): void {
  Object.assign(values, defaultValues(meta))
}

function resetCamera(): void {
  stage?.setView(meta.camera, 1.1)
  stage?.setAutoOrbit(mode.value === 'cinema')
}

function applyQuality(next: string): void {
  qualityPreset.value = next as QualityPreset
  stage?.setQualityPreset(qualityPreset.value)
}

function advanceSmoothing(dt: number): void {
  const blend = 1 - Math.exp(-7 * dt)
  for (const key of Object.keys(values)) {
    const target = values[key]
    const current = smoothedValues[key]
    if (typeof target === 'number' && typeof current === 'number') {
      const next = current + (target - current) * blend
      smoothedValues[key] = Math.abs(target - next) < 0.0005 ? target : next
    } else {
      smoothedValues[key] = target
    }
  }
}

onMounted(() => {
  if (!host.value || !meta) return
  viewer = createMapScene(host.value)
  loadBingImagery(viewer, {}, (layer) => {
    layer.brightness = 0.58
    layer.saturation = 0.45
    layer.contrast = 1.1
  })
  stage = new GeoThreeStage(viewer, host.value, meta.anchor)
  stage.setQualityPreset(qualityPreset.value)
  stage.setView(meta.camera)
  runtime = meta.create({
    root: stage.root,
    accent: meta.accent,
    focus: (target, camera) => stage?.focus(target, camera),
    setOcclusionProxies: (proxies) => stage?.setOcclusionProxies(proxies)
  })
  if (runtime.object !== stage.root) stage.root.add(runtime.object)
  runtime.sync?.({ ...values })
  let accumulator = 0
  stage.onFrame = (dt) => {
    const started = performance.now()
    if (!paused.value && sceneReady) {
      advanceSmoothing(dt)
      const advance = clock.advance(dt)
      for (let index = 0; index < advance.steps; index += 1) {
        if (runtime?.fixedUpdate) runtime.fixedUpdate(clock.fixedDt, smoothedValues)
        else runtime?.update(clock.fixedDt, smoothedValues)
      }
      runtime?.renderSync?.(advance.alpha, smoothedValues)
      stage?.setBacklog(advance.backlog * 1000, clock.dropped)
    }
    stage?.recordPhysics(performance.now() - started)
    accumulator += dt
    statsTimer += dt
    if (accumulator >= 0.2) {
      accumulator = 0
      readouts.value = runtime?.readouts() ?? {}
      diagnostics.value = runtime?.diagnostics?.() ?? {}
      calibration.value = runtime?.calibration?.() ?? []
    }
    if (statsTimer >= 0.5) {
      statsTimer = 0
      performanceStats.value = stage?.getPerformance() ?? null
    }
  }
  const begin = (): void => {
    if (!runtime) return
    readouts.value = runtime.readouts()
    runtime.setMode?.(mode.value)
    diagnostics.value = runtime.diagnostics?.() ?? {}
    calibration.value = runtime.calibration?.() ?? []
    sceneReady = true
    status.value = '运行中'
  }
  if (runtime.load) {
    status.value = '加载数据…'
    runtime.load().then(begin).catch((error: unknown) => {
      status.value = `数据加载失败：${String(error)}`
      begin()
    })
  } else {
    begin()
  }
})

onBeforeUnmount(() => {
  sceneReady = false
  if (syncTimer !== null) window.clearTimeout(syncTimer)
  runtime?.dispose()
  runtime = null
  clock.reset()
  stage?.dispose()
  stage = null
  if (viewer) destroyScene(viewer)
  viewer = null
})

watch(
  values,
  () => {
    if (syncTimer !== null) window.clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => {
      runtime?.sync?.({ ...values })
    }, 140)
  },
  { deep: true }
)
</script>

<template>
  <div v-if="meta" class="ct-shell" :class="{ cinema: mode === 'cinema' }" :style="{ '--ct-accent': meta.accent }">
    <div ref="host" class="scene-canvas"></div>

    <div class="scene-head">
      <div class="head-title">{{ meta.title }}</div>
      <div class="head-sub">{{ meta.subtitle }}</div>
      <div class="head-tag">{{ meta.tag }}</div>
    </div>

    <div class="metric-strip">
      <div v-for="metric in meta.metrics" :key="metric.key" class="metric-card">
        <span class="metric-label">{{ metric.label }}</span>
        <span class="metric-value">{{ readout(metric.key) }}</span>
      </div>
    </div>

    <div class="control-panel">
      <div class="panel-title-row">
        <div>
          <div class="panel-title">{{ meta.title }}</div>
          <div class="panel-sub">参数面板 · {{ meta.sections.reduce((sum, section) => sum + (section.params?.length ?? 0), 0) }} 项</div>
        </div>
        <button class="info-btn" title="查看说明" @click="infoOpen = true">说明</button>
      </div>

      <div v-for="section in meta.sections" :key="section.title" class="panel-section">
        <div class="section-title">{{ section.title }}</div>
        <div v-for="param in section.params ?? []" :key="param.key" class="param-row">
          <div class="param-head">
            <span class="param-label">{{ param.label }}</span>
            <span v-if="param.type === 'range'" class="param-value">{{ asNumber(values[param.key]).toFixed(param.step < 1 ? 2 : 0) }}{{ param.unit ?? '' }}</span>
          </div>

          <input
            v-if="param.type === 'range'"
            class="ct-range"
            type="range"
            :min="param.min"
            :max="param.max"
            :step="param.step"
            :value="asNumber(values[param.key])"
            @input="onInput(param.key, param.type, $event)"
          />

          <select
            v-else-if="param.type === 'select'"
            class="ct-select"
            :value="asText(values[param.key])"
            @change="onInput(param.key, param.type, $event)"
          >
            <option v-for="option in param.options" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>

          <label v-else-if="param.type === 'toggle'" class="ct-toggle">
            <input
              type="checkbox"
              :checked="Boolean(values[param.key])"
              @change="onInput(param.key, param.type, $event)"
            />
            <span class="toggle-track"><span class="toggle-dot"></span></span>
            <span class="toggle-text">{{ Boolean(values[param.key]) ? '开启' : '关闭' }}</span>
          </label>

          <input
            v-else-if="param.type === 'color'"
            class="ct-color"
            type="color"
            :value="asText(values[param.key])"
            @input="onInput(param.key, param.type, $event)"
          />
        </div>

        <div v-if="section.actions?.length" class="button-row">
          <button
            v-for="action in section.actions"
            :key="action.key"
            class="action-button"
            :class="action.style ?? 'primary'"
            @click="runAction(action.key)"
          >
            {{ action.label }}
          </button>
        </div>
      </div>

      <div class="section-title">演示模式</div>
      <div class="mode-grid">
        <button
          v-for="item in SIMULATION_MODES"
          :key="item.value"
          class="mode-button"
          :class="{ active: mode === item.value }"
          :title="item.hint"
          @click="applyMode(item.value)"
        >
          {{ item.label }}
        </button>
      </div>
      <div class="mode-hint">{{ SIMULATION_MODES.find((item) => item.value === mode)?.hint }}</div>

      <div class="section-title">画质与性能</div>
      <div class="param-row">
        <div class="param-head"><span class="param-label">画质档位</span></div>
        <select class="ct-select" :value="qualityPreset" @change="applyQuality(($event.target as HTMLSelectElement).value)">
          <option v-for="item in QUALITY_PRESETS" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>

      <div class="section-title">播放与视角</div>
      <div class="button-row">
        <button class="action-button primary" @click="togglePause">{{ paused ? '继续' : '暂停' }}</button>
        <button class="action-button accent" :disabled="!paused" @click="stepOnce">单步</button>
        <button class="action-button accent" @click="resetCamera">重置视角</button>
      </div>
      <div class="button-row">
        <button class="action-button danger" @click="resetParams">重置参数</button>
      </div>

      <div class="status-line">状态：{{ status }} · 相机与三维层逐帧同步</div>
      <div class="hint">{{ meta.hint }}</div>
    </div>

    <div v-if="mode === 'analysis'" class="analysis-panel">
      <div class="analysis-title">求解器诊断</div>
      <div v-for="(value, key) in diagnostics" :key="key" class="analysis-row">
        <span>{{ key }}</span><span>{{ value }}</span>
      </div>
    </div>

    <div v-if="mode === 'calibration'" class="analysis-panel calibration-panel">
      <div class="analysis-title">校核对照</div>
      <div v-for="row in calibration" :key="row.metric" class="cal-row" :class="{ fail: !row.pass }">
        <span class="cal-metric">{{ row.metric }}</span>
        <span>{{ row.simulated.toFixed(2) }}</span>
        <span>{{ row.reference.toFixed(2) }}</span>
        <span>{{ row.error.toFixed(2) }}{{ row.unit }}</span>
      </div>
    </div>

    <div v-if="performanceStats" class="perf-hud">
      <span>FPS {{ performanceStats.fps.toFixed(0) }}</span>
      <span>P95 {{ performanceStats.frameP95.toFixed(1) }}ms</span>
      <span>物理 {{ performanceStats.physicsP95.toFixed(1) }}ms</span>
      <span>DC {{ performanceStats.drawCalls }}</span>
      <span>三角 {{ (performanceStats.triangles / 1000).toFixed(0) }}k</span>
      <span>画质 {{ (performanceStats.qualityScale * 100).toFixed(0) }}%</span>
      <span>积压 {{ performanceStats.backlogMs.toFixed(0) }}ms</span>
    </div>

    <div v-if="meta.legend?.length" class="legend">
      <div v-for="item in meta.legend" :key="item.label" class="legend-row">
        <span class="legend-dot" :style="{ background: item.color }"></span>
        <span class="legend-text">{{ item.label }}</span>
      </div>
    </div>

    <div v-if="infoOpen" class="info-overlay" @click.self="infoOpen = false">
      <div class="info-modal">
        <div class="info-head">
          <span class="info-title">{{ meta.title }}</span>
          <button class="info-close" title="关闭" @click="infoOpen = false">×</button>
        </div>
        <div class="info-body">
          <p class="info-text">{{ meta.description }}</p>
          <p class="info-label">实现说明</p>
          <ul class="info-list">
            <li v-for="(line, index) in meta.info" :key="index" class="info-text">{{ line }}</li>
          </ul>
          <p class="info-label">交互提示</p>
          <p class="info-text">{{ meta.hint }}</p>
          <template v-if="provenance">
            <p class="info-label">数据与尺度</p>
            <p class="info-text">数据类型：{{ provenance.mode }} · {{ provenance.source }}</p>
            <p class="info-text">坐标：{{ provenance.crs }}；垂直基准：{{ provenance.verticalDatum }}</p>
            <p class="info-text">单位：{{ provenance.units }}。{{ provenance.note }}</p>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ct-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 360px;
  overflow: hidden;
  border-radius: 8px;
  background: #08111c;
}

.scene-canvas {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
}

.scene-head {
  position: absolute;
  top: 14px;
  left: 16px;
  z-index: 8;
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: 46%;
  padding: 9px 12px;
  border: 1px solid color-mix(in srgb, var(--ct-accent) 40%, transparent);
  border-left: 3px solid var(--ct-accent);
  border-radius: 7px;
  background: rgba(6, 15, 26, 0.78);
  backdrop-filter: blur(5px);
  pointer-events: none;
}

.head-title {
  font-size: 14px;
  font-weight: 700;
  color: #eaf7ff;
}

.head-sub {
  font-size: 10px;
  color: #9dbbcb;
}

.head-tag {
  margin-top: 2px;
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--ct-accent);
}

.metric-strip {
  position: absolute;
  top: 100px;
  left: 16px;
  z-index: 8;
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 176px;
  pointer-events: none;
}

.metric-card {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 9px;
  border: 1px solid rgba(137, 210, 233, 0.2);
  border-radius: 6px;
  background: rgba(6, 18, 31, 0.72);
  backdrop-filter: blur(4px);
}

.metric-label {
  font-size: 10px;
  color: #8fa9bc;
}

.metric-value {
  font-size: 12px;
  font-weight: 700;
  color: var(--ct-accent);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.control-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 296px;
  max-height: calc(100% - 24px);
  overflow-y: auto;
  padding: 12px;
  box-sizing: border-box;
  border: 1px solid rgba(137, 210, 233, 0.28);
  border-radius: 9px;
  background: rgba(8, 24, 40, 0.93);
  backdrop-filter: blur(6px);
  color: #ddf2f8;
  font-size: 11px;
}

.panel-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.panel-title {
  font-size: 12px;
  font-weight: 700;
}

.panel-sub {
  margin-top: 2px;
  font-size: 10px;
  color: var(--ct-accent);
}

.info-btn {
  flex: 0 0 auto;
  min-height: 22px;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--ct-accent) 60%, transparent);
  border-radius: 11px;
  background: color-mix(in srgb, var(--ct-accent) 18%, transparent);
  color: var(--ct-accent);
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
}

.info-btn:hover {
  background: color-mix(in srgb, var(--ct-accent) 34%, transparent);
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-title {
  margin-top: 7px;
  margin-bottom: 2px;
  padding-bottom: 2px;
  border-bottom: 1px solid rgba(137, 210, 233, 0.16);
  font-size: 11px;
  font-weight: 700;
  color: #7fd0e6;
}

.param-row {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.param-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.param-label {
  color: #c7dce8;
}

.param-value {
  color: #9fd6ef;
  font-variant-numeric: tabular-nums;
}

.ct-range {
  width: 100%;
  height: 4px;
  margin: 4px 0 6px;
  -webkit-appearance: none;
  appearance: none;
  border-radius: 3px;
  background: #1e2d3a;
  outline: none;
  cursor: pointer;
}

.ct-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 13px;
  height: 13px;
  border: 2px solid #0d2233;
  border-radius: 50%;
  background: var(--ct-accent);
  cursor: pointer;
}

.ct-range::-moz-range-thumb {
  width: 11px;
  height: 11px;
  border: 2px solid #0d2233;
  border-radius: 50%;
  background: var(--ct-accent);
  cursor: pointer;
}

.ct-select {
  margin: 3px 0 5px;
  padding: 4px 6px;
  border: 1px solid rgba(137, 210, 233, 0.3);
  border-radius: 5px;
  background: rgba(21, 48, 78, 0.7);
  color: #ddf2f8;
  font-family: inherit;
  font-size: 11px;
}

.ct-color {
  width: 100%;
  height: 26px;
  margin: 3px 0 5px;
  padding: 0;
  border: 1px solid rgba(137, 210, 233, 0.3);
  border-radius: 5px;
  background: rgba(21, 48, 78, 0.7);
  cursor: pointer;
}

.ct-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 3px 0 5px;
  cursor: pointer;
  color: #b9d2e2;
}

.ct-toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.toggle-track {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 30px;
  height: 15px;
  padding: 2px;
  box-sizing: border-box;
  border-radius: 9px;
  background: #223444;
  transition: background 0.18s ease;
}

.toggle-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #7e95a6;
  transition: transform 0.18s ease, background 0.18s ease;
}

.ct-toggle input:checked + .toggle-track {
  background: color-mix(in srgb, var(--ct-accent) 32%, #223444);
}

.ct-toggle input:checked + .toggle-track .toggle-dot {
  transform: translateX(15px);
  background: var(--ct-accent);
}

.toggle-text {
  font-size: 10px;
  color: #8fa9bc;
}

.button-row {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.action-button {
  flex: 1;
  min-height: 27px;
  border: 0;
  border-radius: 5px;
  cursor: pointer;
  font-size: 11px;
  color: #edfaff;
}

.action-button.primary {
  background: #257f9e;
}

.action-button.accent {
  background: #8a6d1a;
  color: #fff3d6;
}

.action-button.danger {
  background: #4a5a72;
  color: #ffd6d6;
}

.status-line {
  margin-top: 6px;
  font-size: 10px;
  color: #9fb8d4;
}

.hint {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(137, 210, 233, 0.16);
  font-size: 10px;
  line-height: 1.7;
  color: #7f97ad;
}

.legend {
  position: absolute;
  left: 16px;
  bottom: 34px;
  z-index: 8;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 7px 10px;
  border: 1px solid rgba(137, 210, 233, 0.2);
  border-radius: 7px;
  background: rgba(6, 18, 31, 0.72);
  backdrop-filter: blur(4px);
  pointer-events: none;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.legend-text {
  font-size: 10px;
  color: #a9c2d2;
}

.info-overlay {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 26px;
  box-sizing: border-box;
  background: rgba(4, 13, 26, 0.6);
  backdrop-filter: blur(2px);
}

.info-modal {
  display: flex;
  flex-direction: column;
  width: min(560px, 92%);
  max-height: 88%;
  padding: 14px 16px;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--ct-accent) 55%, transparent);
  border-radius: 10px;
  background: rgba(10, 28, 48, 0.97);
  box-shadow: 0 10px 36px rgba(0, 0, 0, 0.45);
  color: #e3f2f8;
}

.info-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--ct-accent) 30%, transparent);
}

.info-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--ct-accent);
}

.info-close {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--ct-accent) 50%, transparent);
  border-radius: 50%;
  background: color-mix(in srgb, var(--ct-accent) 14%, transparent);
  color: var(--ct-accent);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
}

.info-body {
  display: flex;
  flex-direction: column;
  gap: 7px;
  overflow-y: auto;
  padding: 10px 2px 2px;
}

.info-label {
  margin: 4px 0 0;
  font-size: 11px;
  font-weight: 700;
  color: #8fd6ff;
}

.info-text {
  margin: 0;
  font-size: 11px;
  line-height: 1.75;
  color: #c7dce8;
}

.info-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0;
  padding-left: 16px;
}

.mode-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
}

.mode-button {
  min-height: 26px;
  border: 1px solid rgba(137, 210, 233, 0.25);
  border-radius: 5px;
  background: rgba(21, 48, 78, 0.55);
  color: #b9d2e2;
  font-size: 10px;
  cursor: pointer;
}

.mode-button.active {
  border-color: var(--ct-accent);
  background: color-mix(in srgb, var(--ct-accent) 24%, transparent);
  color: #f2fbff;
}

.mode-hint {
  margin-top: 2px;
  font-size: 9px;
  line-height: 1.5;
  color: #7f9bad;
}

.analysis-panel {
  position: absolute;
  left: 16px;
  bottom: 18px;
  z-index: 9;
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 238px;
  max-height: 34%;
  overflow-y: auto;
  padding: 9px 10px;
  border: 1px solid rgba(137, 210, 233, 0.26);
  border-radius: 7px;
  background: rgba(6, 18, 31, 0.82);
  backdrop-filter: blur(4px);
  pointer-events: none;
}

.analysis-title {
  margin-bottom: 3px;
  font-size: 10px;
  font-weight: 700;
  color: var(--ct-accent);
}

.analysis-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  color: #b9d2e2;
  font-variant-numeric: tabular-nums;
}

.calibration-panel {
  width: 294px;
}

.cal-row {
  display: grid;
  grid-template-columns: 1.5fr 0.8fr 0.8fr 1fr;
  gap: 4px;
  font-size: 9px;
  color: #b9d2e2;
  font-variant-numeric: tabular-nums;
}

.cal-row.fail {
  color: #ff9d8a;
}

.cal-metric {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.perf-hud {
  position: absolute;
  bottom: 10px;
  left: 16px;
  z-index: 11;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-width: calc(100% - 340px);
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(4, 12, 20, 0.55);
  color: #87a6b8;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.ct-shell.cinema .control-panel {
  opacity: 0.24;
  transition: opacity 0.3s ease;
}

.ct-shell.cinema .control-panel:hover {
  opacity: 1;
}

.ct-shell.cinema .perf-hud,
.ct-shell.cinema .metric-strip {
  opacity: 0.45;
}

@media (max-width: 1100px) {
  .control-panel {
    width: 258px;
  }

  .scene-head {
    max-width: 40%;
  }

  .metric-strip {
    width: 156px;
    top: 92px;
  }
}
</style>
