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
import { rampCss } from './palettes'
import type { D3CaseContext, D3CaseSpec, D3Control, D3LegendItem, D3SettingValue, D3Settings } from './types'

const props = defineProps<{ spec: D3CaseSpec }>()

const mapEl = ref<HTMLElement | null>(null)
const settings = reactive<D3Settings>({ ...props.spec.defaults })
const status = ref('')
const legend = shallowRef<D3LegendItem[]>([])
const error = ref('')
const cursor = ref<{ lon: number; lat: number } | null>(null)
const rampPreview = ref<Record<string, string>>({})

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
    setStatus: (text) => {
      status.value = text
    },
    setLegend: (items) => {
      legend.value = items
      const preview: Record<string, string> = {}
      for (const item of items) {
        if (/^(viridis|inferno|turbo|plasma|blues|greens|reds|spectral|coolwarm|sunset)$/.test(item.label)) {
          preview[item.label] = rampCss(item.label)
        }
      }
      rampPreview.value = preview
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
  <div class="d3-shell">
    <div ref="mapEl" class="d3-map"></div>

    <aside class="d3-panel">
      <div class="panel-head">
        <p class="panel-eyebrow">D3 × CESIUM</p>
        <h2>{{ spec.meta.title }}</h2>
        <p class="panel-subtitle">{{ spec.meta.subtitle }}</p>
      </div>

      <div v-if="error" class="d3-error">{{ error }}</div>

      <div class="panel-section" v-if="spec.controls?.length">
        <div class="section-title">参数配置</div>
        <template v-for="control in spec.controls" :key="control.label">
          <label v-if="control.kind === 'range'" class="control-row">
            <span class="row-label">{{ control.label }}</span>
            <span class="row-value">{{ formatValue(control, settings[control.key]) }}</span>
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
      </div>

      <div class="panel-section" v-if="spec.meta.tips?.length">
        <div class="section-title">实现要点</div>
        <ul class="tip-list">
          <li v-for="tip in spec.meta.tips" :key="tip">{{ tip }}</li>
        </ul>
      </div>

      <div class="panel-section" v-if="legend.length">
        <div class="section-title">图例</div>
        <div class="legend-list">
          <div v-for="item in legend" :key="item.label" class="legend-item">
            <span v-if="rampPreview[item.label]" class="legend-ramp" :style="{ background: rampPreview[item.label] }"></span>
            <span v-else class="legend-swatch" :style="{ background: item.color }"></span>
            <span class="legend-label">{{ item.label }}</span>
          </div>
        </div>
      </div>

      <div class="panel-actions">
        <button type="button" class="action-button ghost" @click="resetView">重置视角</button>
      </div>
    </aside>

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
  background: #060b18;
}

.d3-map {
  position: absolute;
  inset: 0;
}

.d3-panel {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 300px;
  max-height: calc(100% - 32px);
  overflow-y: auto;
  padding: 18px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.82);
  border: 1px solid rgba(148, 163, 184, 0.24);
  backdrop-filter: blur(10px);
  color: #e2e8f0;
  font-size: 13px;
  box-shadow: 0 18px 46px rgba(2, 6, 23, 0.5);
}

.panel-eyebrow {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.18em;
  color: #38bdf8;
}

.panel-head h2 {
  margin: 6px 0 4px;
  font-size: 17px;
}

.panel-subtitle {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: #94a3b8;
}

.d3-error {
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(248, 113, 113, 0.16);
  border: 1px solid rgba(248, 113, 113, 0.4);
  color: #fecaca;
  font-size: 12px;
}

.panel-section {
  margin-top: 16px;
}

.section-title {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #7dd3fc;
  letter-spacing: 0.06em;
}

.control-row {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 4px 8px;
  align-items: center;
  margin-bottom: 10px;
}

.row-label {
  color: #cbd5e1;
}

.row-value {
  color: #7dd3fc;
  font-variant-numeric: tabular-nums;
}

.range-input {
  grid-column: 1 / -1;
  width: 100%;
}

.select-input,
.color-input {
  width: 100%;
  background: rgba(30, 41, 59, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 6px;
  color: #e2e8f0;
  padding: 4px 6px;
}

.select-input {
  grid-column: 1 / -1;
}

.color-input {
  grid-column: 1 / -1;
  height: 28px;
  padding: 0;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  color: #cbd5e1;
}

.tip-list {
  margin: 0;
  padding-left: 16px;
  color: #cbd5e1;
  line-height: 1.6;
}

.legend-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.legend-swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.legend-ramp {
  width: 64px;
  height: 12px;
  border-radius: 3px;
}

.legend-label {
  color: #cbd5e1;
}

.panel-actions {
  margin-top: 16px;
  display: flex;
  gap: 8px;
}

.action-button {
  flex: 1;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid rgba(56, 189, 248, 0.5);
  background: rgba(56, 189, 248, 0.16);
  color: #bae6fd;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s ease;
}

.action-button:hover {
  background: rgba(56, 189, 248, 0.3);
}

.action-button.ghost {
  border-color: rgba(148, 163, 184, 0.4);
  background: transparent;
  color: #cbd5e1;
}

.d3-status {
  position: absolute;
  left: 16px;
  bottom: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  padding: 8px 14px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.78);
  border: 1px solid rgba(148, 163, 184, 0.24);
  color: #cbd5e1;
  font-size: 12px;
  backdrop-filter: blur(8px);
}

.status-title {
  color: #7dd3fc;
  font-weight: 600;
}
</style>
