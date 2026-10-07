<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  CustomDataSource,
  Math as CesiumMath,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery } from '../cesium-scene'
import { createD3Context, type D3ContextHost } from './context'
import { GeoProfiler } from './performance/profiler'
import { rampCss } from './palettes'
import type { D3CaseContext, D3CaseSpec, D3Control, D3LegendItem, D3SettingValue, D3Settings } from './types'

const props = defineProps<{ spec: D3CaseSpec }>()

const mapEl = ref<HTMLElement | null>(null)
const settings = reactive<D3Settings>({ ...props.spec.defaults })
const status = ref('')
const legend = shallowRef<D3LegendItem[]>([])
const error = ref('')
const cursor = ref<{ lon: number; lat: number } | null>(null)
const profiler = new GeoProfiler()
const perfView = ref<{ fps: number; frameMs: number; memoryMB: number; stats: Array<[string, string | number]> }>({
  fps: 0,
  frameMs: 0,
  memoryMB: 0,
  stats: []
})
let lastPerfUpdate = 0

let viewer: Viewer | undefined
let host: D3ContextHost | undefined
let dataSource: CustomDataSource | undefined
let handler: ScreenSpaceEventHandler | undefined
let rafId: number | undefined
let lastFrame = 0

function formatValue(control: D3Control, value: D3SettingValue): string {
  if (control.kind === 'range' && control.format) return control.format(Number(value))
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2)
  return String(value)
}

function defaultsCamera(): void {
  if (!viewer) return
  const camera = props.spec.camera
  if (camera) {
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(camera.lon, camera.lat, camera.height),
      orientation: {
        heading: CesiumMath.toRadians(camera.heading ?? 0),
        pitch: CesiumMath.toRadians(camera.pitch ?? -90),
        roll: CesiumMath.toRadians(camera.roll ?? 0)
      }
    })
  } else {
    viewer.camera.setView({ destination: Rectangle.fromDegrees(70, 0, 140, 60) })
  }
}

function render(): void {
  if (!host) return
  try {
    error.value = ''
    host.reset()
    props.spec.setup(host.ctx)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
}

function refresh(): void {
  if (!host) return
  try {
    error.value = ''
    if (props.spec.update) props.spec.update(host.ctx)
    else render()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
}

function onSettingChange(): void {
  refresh()
}

function runButton(control: D3Control, ctx: D3CaseContext): void {
  if (control.kind === 'button') control.onClick(ctx)
}

function resetView(): void {
  defaultsCamera()
}

function frameLoop(time: number): void {
  const delta = lastFrame ? time - lastFrame : 16
  lastFrame = time
  host?.runFrame(time, delta)
  profiler.tick(time)
  if (time - lastPerfUpdate >= 400) {
    lastPerfUpdate = time
    perfView.value = {
      fps: profiler.fps,
      frameMs: profiler.frameMs,
      memoryMB: profiler.memoryMB,
      stats: Object.entries(profiler.snapshot())
    }
  }
  rafId = requestAnimationFrame(frameLoop)
}

onMounted(() => {
  const el = mapEl.value
  if (!el) return
  viewer = createMapScene(el)
  loadBingImagery(viewer)
  defaultsCamera()

  dataSource = new CustomDataSource('d3-case')
  viewer.dataSources.add(dataSource)
  host = createD3Context({
    viewer,
    dataSource,
    settings,
    profiler,
    setStatus: (text) => {
      status.value = text
    },
    setLegend: (items) => {
      legend.value = items
    }
  })

  handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
    if (!viewer) return
    const cartesian = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid)
    if (!cartesian) return
    const carto = viewer.scene.globe.ellipsoid.cartesianToCartographic(cartesian)
    cursor.value = { lon: CesiumMath.toDegrees(carto.longitude), lat: CesiumMath.toDegrees(carto.latitude) }
  }, ScreenSpaceEventType.MOUSE_MOVE)

  render()
  rafId = requestAnimationFrame(frameLoop)
})

onBeforeUnmount(() => {
  if (rafId !== undefined) cancelAnimationFrame(rafId)
  handler?.destroy()
  host?.dispose()
  if (viewer) destroyScene(viewer)
  viewer = undefined
  host = undefined
  dataSource = undefined
})
</script>

<template>
  <div class="d3-shell" :class="{ 'has-legend': legend.length > 0 }">
    <div ref="mapEl" class="d3-map"></div>

    <div class="d3-perf">
      <div class="perf-head">D3 GEO PERFORMANCE</div>
      <div class="perf-vitals">
        <span :class="perfView.fps >= 45 ? 'good' : perfView.fps >= 30 ? 'ok' : 'bad'">
          <b>FPS</b>{{ perfView.fps }}
        </span>
        <span><b>Frame</b>{{ perfView.frameMs.toFixed(1) }}<i>ms</i></span>
        <span><b>MEM</b>{{ Math.round(perfView.memoryMB) }}<i>MB</i></span>
      </div>
      <div v-if="perfView.stats.length" class="perf-stats">
        <div v-for="[key, value] in perfView.stats" :key="key" class="perf-row">
          <span class="perf-key">{{ key }}</span>
          <span class="perf-value">{{ value }}</span>
        </div>
      </div>
    </div>

    <aside class="d3-panel">
      <div class="panel-title">{{ spec.meta.title }}</div>
      <div class="panel-subtitle">{{ spec.meta.subtitle }}</div>

      <div v-if="error" class="d3-error">{{ error }}</div>

      <template v-if="spec.controls?.length">
        <div class="section-title">参数配置</div>
        <template v-for="control in spec.controls" :key="control.label">
          <label v-if="control.kind === 'range'" class="control-row">
            <span class="row-label">{{ control.label }}</span>
            <input
              class="range-input"
              type="range"
              :min="control.min"
              :max="control.max"
              :step="control.step ?? 1"
              :value="Number(settings[control.key])"
              @input="
                settings[control.key] = Number(($event.target as HTMLInputElement).value);
                onSettingChange()
              "
            />
            <span class="row-value">{{ formatValue(control, settings[control.key]) }}</span>
          </label>

          <label v-else-if="control.kind === 'select'" class="control-row">
            <span class="row-label">{{ control.label }}</span>
            <select
              class="select-input"
              :value="String(settings[control.key])"
              @change="
                settings[control.key] = ($event.target as HTMLSelectElement).value;
                onSettingChange()
              "
            >
              <option v-for="option in control.options" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>

          <label v-else-if="control.kind === 'checkbox'" class="switch-row">
            <span>{{ control.label }}</span>
            <input
              type="checkbox"
              :checked="Boolean(settings[control.key])"
              @change="
                settings[control.key] = ($event.target as HTMLInputElement).checked;
                onSettingChange()
              "
            />
          </label>

          <label v-else-if="control.kind === 'color'" class="control-row">
            <span class="row-label">{{ control.label }}</span>
            <input
              class="color-input"
              type="color"
              :value="String(settings[control.key])"
              @change="
                settings[control.key] = ($event.target as HTMLInputElement).value;
                onSettingChange()
              "
            />
          </label>

          <button v-else type="button" class="action-button" @click="host && runButton(control, host.ctx)">
            {{ control.label }}
          </button>
        </template>
      </template>

      <template v-if="spec.meta.tips?.length">
        <div class="section-title">实现要点</div>
        <ul class="tip-list">
          <li v-for="tip in spec.meta.tips" :key="tip">{{ tip }}</li>
        </ul>
      </template>

      <div class="panel-actions">
        <button type="button" class="action-button ghost" @click="resetView">重置视角</button>
      </div>
    </aside>

    <div v-if="legend.length" class="d3-legend" :class="{ 'd3-legend-multi': legend.length > 5 }">
      <div class="section-title">图例</div>
      <div class="legend-list" :class="{ 'legend-list-multi': legend.length > 5 }">
        <div v-for="item in legend" :key="item.label" class="legend-item">
          <span v-if="item.ramp" class="legend-ramp" :style="{ background: rampCss(item.ramp) }"></span>
          <span v-else class="legend-swatch" :style="{ background: item.color }"></span>
          <span class="legend-label">{{ item.label }}</span>
        </div>
      </div>
    </div>

    <div class="d3-status">
      <span class="status-title">{{ spec.meta.tag }}</span>
      <span v-if="status">{{ status }}</span>
      <span v-if="cursor">光标 {{ cursor.lat.toFixed(3) }}, {{ cursor.lon.toFixed(3) }}</span>
    </div>
  </div>
</template>

<style scoped>
.d3-shell {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 8px;
  background: #152b4c;
  color: #dce8f5;
  font: 12px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif;
}

.d3-map {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.d3-perf {
  position: absolute;
  z-index: 10;
  top: 12px;
  left: 12px;
  min-width: 220px;
  max-width: 300px;
  padding: 10px 12px;
  border: 1px solid rgba(157, 188, 224, 0.28);
  border-radius: 9px;
  background: rgba(10, 26, 52, 0.86);
  backdrop-filter: blur(6px);
  color: #dce8f5;
  font-size: 11px;
  pointer-events: none;
}

.perf-head {
  font-size: 10px;
  letter-spacing: 0.2em;
  color: #7cb3ff;
  margin-bottom: 6px;
}

.perf-vitals {
  display: flex;
  gap: 12px;
  margin-bottom: 6px;
  font-variant-numeric: tabular-nums;
}

.perf-vitals b {
  display: block;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: #8ea5c2;
}

.perf-vitals i {
  font-style: normal;
  font-size: 9px;
  color: #8ea5c2;
  margin-left: 1px;
}

.perf-vitals .good {
  color: #4ade80;
}

.perf-vitals .ok {
  color: #facc15;
}

.perf-vitals .bad {
  color: #f87171;
}

.perf-stats {
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-top: 1px solid rgba(157, 188, 224, 0.16);
  padding-top: 6px;
  max-height: 42vh;
  overflow: hidden;
}

.perf-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.perf-key {
  color: #8ea5c2;
}

.perf-value {
  color: #9fc3ff;
  font-variant-numeric: tabular-nums;
}

.d3-panel {
  position: absolute;
  z-index: 10;
  top: 12px;
  right: 12px;
  width: 280px;
  max-height: calc(100% - 24px);
  overflow-y: auto;
  padding: 12px;
  box-sizing: border-box;
  border: 1px solid rgba(157, 188, 224, 0.28);
  border-radius: 9px;
  background: rgba(10, 26, 52, 0.86);
  backdrop-filter: blur(6px);
  color: #dce8f5;
}

.has-legend .d3-panel {
  max-height: calc(100% - 208px);
}

.panel-title {
  font-size: 12px;
  font-weight: 700;
  color: #eaf2ff;
}

.panel-subtitle {
  margin-top: 2px;
  margin-bottom: 6px;
  font-size: 10px;
  color: #8ea5c2;
}

.d3-error {
  margin: 8px 0;
  padding: 7px 9px;
  border: 1px solid rgba(248, 113, 113, 0.4);
  border-radius: 6px;
  background: rgba(127, 29, 29, 0.35);
  color: #fecaca;
  font-size: 11px;
}

.section-title {
  margin-top: 8px;
  margin-bottom: 4px;
  padding-bottom: 2px;
  border-bottom: 1px solid rgba(157, 188, 224, 0.16);
  font-size: 11px;
  color: #8ea5c2;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 11px;
  color: #c3d5e8;
}

.row-label {
  flex: 0 0 auto;
}

.row-value {
  min-width: 30px;
  margin-left: auto;
  text-align: right;
  color: #eaf2ff;
  font-variant-numeric: tabular-nums;
}

.range-input {
  flex: 1;
  min-width: 0;
  accent-color: #2f80ed;
}

.select-input {
  min-width: 96px;
  max-width: 150px;
  height: 22px;
  margin-left: auto;
  padding: 0 5px;
  border: 1px solid rgba(157, 188, 224, 0.28);
  border-radius: 4px;
  background: rgba(8, 21, 40, 0.55);
  color: #e6eef9;
  font-size: 10px;
  box-sizing: border-box;
}

.color-input {
  width: 36px;
  height: 22px;
  margin-left: auto;
  padding: 0;
  border: 1px solid rgba(157, 188, 224, 0.28);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 0;
  font-size: 11px;
  color: #c3d5e8;
  cursor: pointer;
}

.switch-row input {
  accent-color: #2f80ed;
}

.tip-list {
  margin: 2px 0 0;
  padding-left: 16px;
  color: #c3d5e8;
  line-height: 1.6;
  font-size: 11px;
}

.d3-legend {
  position: absolute;
  z-index: 11;
  right: 12px;
  bottom: 12px;
  width: 210px;
  max-height: 40%;
  overflow-y: auto;
  padding: 10px 12px;
  box-sizing: border-box;
  border: 1px solid rgba(157, 188, 224, 0.28);
  border-radius: 9px;
  background: rgba(10, 26, 52, 0.86);
  backdrop-filter: blur(6px);
  color: #dce8f5;
}

.d3-legend .section-title {
  margin-top: 0;
}

.legend-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.d3-legend-multi {
  width: 250px;
}

.legend-list-multi {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(5, auto);
  grid-auto-flow: column;
  column-gap: 10px;
  row-gap: 5px;
}

.legend-list-multi .legend-item {
  gap: 6px;
  min-width: 0;
}

.legend-list-multi .legend-swatch {
  width: 12px;
  height: 12px;
}

.legend-list-multi .legend-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.legend-swatch {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.legend-ramp {
  flex: 1;
  min-width: 60px;
  height: 10px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.legend-label {
  flex: 0 0 auto;
  color: #c3d5e8;
}

.panel-actions {
  display: grid;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(157, 188, 224, 0.16);
}

.action-button {
  flex: 1;
  min-height: 26px;
  padding: 5px 8px;
  border: 1px solid rgba(157, 188, 224, 0.32);
  border-radius: 5px;
  background: rgba(47, 128, 237, 0.18);
  color: #dce8f5;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.18s;
}

.action-button:hover {
  background: rgba(47, 128, 237, 0.32);
}

.action-button.ghost {
  background: rgba(8, 21, 40, 0.4);
}

.d3-status {
  position: absolute;
  z-index: 5;
  left: 5px;
  bottom: 21px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  max-width: calc(100% - 300px);
  padding: 6px 10px;
  border: 1px solid rgba(157, 188, 224, 0.22);
  border-radius: 8px;
  background: rgba(8, 21, 40, 0.88);
  color: #9fb8d4;
  font-size: 11px;
  pointer-events: none;
}

.status-title {
  color: #7cb3ff;
  font-weight: 600;
}
</style>
