<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { EffectId, ParamValue, ParamValues } from './effects'
import { defaultParamValues, EFFECT_META } from './effects'
import { QUARKS_DEFAULT_ORIGIN, QuarksEffectRunner, type QuarksEffectConfig } from './runner'

const props = defineProps<{
  effect: EffectId
  cameraDistance?: number
  cameraPitch?: number
  cameraHeading?: number
  targetHeight?: number
}>()

const host = ref<HTMLElement | null>(null)
const meta = EFFECT_META[props.effect]
const values = reactive<ParamValues>(defaultParamValues(props.effect))
const paused = ref(false)
const status = ref('初始化中…')
const infoOpen = ref(false)

let runner: QuarksEffectRunner | null = null
let previous: ParamValues = { ...values }

function config(): QuarksEffectConfig {
  return {
    effect: props.effect,
    lon: QUARKS_DEFAULT_ORIGIN.lon,
    lat: QUARKS_DEFAULT_ORIGIN.lat,
    cameraDistance: props.cameraDistance ?? 120,
    cameraPitch: props.cameraPitch ?? -20,
    cameraHeading: props.cameraHeading ?? 0,
    targetHeight: props.targetHeight ?? 6
  }
}

function onInput(param: { key: string; kind: string }, event: Event): void {
  const target = event.target as HTMLInputElement | HTMLSelectElement
  if (param.kind === 'number') {
    values[param.key] = Number(target.value)
  } else if (param.kind === 'select' || param.kind === 'color') {
    values[param.key] = target.value
  }
}

function asNumber(value: ParamValue): number {
  return typeof value === 'number' ? value : 0
}

function asText(value: ParamValue): string {
  return typeof value === 'string' ? value : String(value)
}

function togglePause(): void {
  paused.value = !paused.value
  runner?.setPaused(paused.value)
  status.value = paused.value ? '已暂停' : '运行中'
}

function resetParams(): void {
  Object.assign(values, defaultParamValues(props.effect))
}

function resetCamera(): void {
  runner?.resetCamera()
}

onMounted(() => {
  if (!host.value) return
  runner = new QuarksEffectRunner(host.value, config())
  runner.rebuild({ ...values })
  status.value = '运行中'
})

onBeforeUnmount(() => {
  runner?.dispose()
  runner = null
})

watch(
  values,
  () => {
    if (!runner) return
    const changed: string[] = []
    for (const key of Object.keys(values)) {
      if (values[key] !== previous[key]) changed.push(key)
    }
    previous = { ...values }
    runner.setValues({ ...values }, changed)
  },
  { deep: true }
)
</script>

<template>
  <div class="qx-shell">
    <div ref="host" class="scene-canvas"></div>

    <div class="control-panel">
      <div class="panel-title-row">
        <div>
          <div class="panel-title">{{ meta.title }}</div>
          <div class="panel-sub">{{ meta.subtitle }}</div>
        </div>
        <button class="info-btn" title="查看说明" @click="infoOpen = true">说明</button>
      </div>

      <div class="section-title">参数调整</div>
      <div v-for="param in meta.params" :key="param.key" class="param-row">
        <div class="param-head">
          <span class="param-label">{{ param.label }}</span>
          <span v-if="param.kind === 'number'" class="param-value">
            {{ asNumber(values[param.key]).toFixed(param.step && param.step < 1 ? 2 : 0) }}{{ param.unit ?? '' }}
          </span>
        </div>

        <input
          v-if="param.kind === 'number'"
          class="qx-range"
          type="range"
          :min="param.min ?? 0"
          :max="param.max ?? 100"
          :step="param.step ?? 1"
          :value="asNumber(values[param.key])"
          @input="onInput(param, $event)"
        />

        <select
          v-else-if="param.kind === 'select'"
          class="qx-select"
          :value="asText(values[param.key])"
          @change="onInput(param, $event)"
        >
          <option v-for="opt in param.options ?? []" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>

        <input
          v-else-if="param.kind === 'color'"
          class="qx-color"
          type="color"
          :value="asText(values[param.key])"
          @input="onInput(param, $event)"
        />
      </div>

      <div class="section-title">播放控制</div>
      <div class="button-row">
        <button class="action-button primary" @click="togglePause">{{ paused ? '继续' : '暂停' }}</button>
        <button class="action-button danger" @click="resetParams">重置参数</button>
      </div>
      <div class="button-row">
        <button class="action-button accent" @click="resetCamera">重置视角</button>
      </div>

      <div class="status-line">状态：{{ status }} · 粒子系统 {{ meta.params.length }} 项参数</div>
      <div class="hint">左键拖动旋转 · 滚轮缩放 · 右键平移 · 参数拖动停止后自动重建粒子系统</div>
    </div>

    <div v-if="infoOpen" class="route-overlay" @click.self="infoOpen = false">
      <div class="route-modal">
        <div class="route-head">
          <span class="route-title">{{ meta.title }}</span>
          <button class="help-close" title="关闭" @click="infoOpen = false">×</button>
        </div>
        <div class="route-body">
          <p class="route-text">{{ meta.description }}</p>
          <p class="route-text">
            本案例基于 three.quarks 粒子引擎，通过 CesiumQuarksLayer 将 three.js 渲染图层叠加在 Cesium
            地球上，逐帧同步相机视图矩阵，实现粒子与地球视角的严格对齐。
          </p>
          <p class="route-text">
            技术要点：BatchedRenderer 批量渲染 · ConeEmitter / SphereEmitter 发射器 · GravityForce /
            ApplyForce / TurbulenceField 力场 · SizeOverLife / ColorOverLife 生命周期曲线 · StretchedBillBoard
            拖尾。
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qx-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #0a1422; }
.scene-canvas { position: relative; display: block; width: 100%; height: 100%; }

.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 5px; width: 300px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; box-sizing: border-box; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 26, 44, 0.92); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.panel-title { font-size: 12px; font-weight: 700; }
.panel-sub { margin-top: 2px; font-size: 10px; color: #7fd0e6; }
.panel-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.info-btn { flex: 0 0 auto; min-height: 22px; padding: 0 9px; border: 1px solid rgba(255, 199, 92, 0.55); border-radius: 11px; background: rgba(255, 199, 92, 0.16); color: #ffd666; cursor: pointer; font-size: 10px; line-height: 1; }
.info-btn:hover { background: rgba(255, 199, 92, 0.32); }

.section-title { margin-top: 7px; margin-bottom: 2px; padding-bottom: 2px; border-bottom: 1px solid rgba(137, 210, 233, 0.16); font-size: 11px; font-weight: 700; color: #7fd0e6; }

.param-row { display: flex; flex-direction: column; gap: 2px; }
.param-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.param-label { color: #c7dce8; }
.param-value { color: #9fd6ef; font-variant-numeric: tabular-nums; }

.qx-range { width: 100%; height: 4px; margin: 3px 0 5px; -webkit-appearance: none; appearance: none; border-radius: 3px; background: #1e2d3a; outline: none; cursor: pointer; }
.qx-range::-webkit-slider-thumb { -webkit-appearance: none; width: 13px; height: 13px; border: 2px solid #0d2233; border-radius: 50%; background: #4fb3d9; cursor: pointer; }
.qx-range::-moz-range-thumb { width: 11px; height: 11px; border: 2px solid #0d2233; border-radius: 50%; background: #4fb3d9; cursor: pointer; }

.qx-select { margin: 3px 0 5px; padding: 4px 6px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 5px; background: rgba(21, 48, 78, 0.7); color: #ddf2f8; font-family: inherit; font-size: 11px; }
.qx-color { width: 100%; height: 26px; margin: 3px 0 5px; padding: 0; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 5px; background: rgba(21, 48, 78, 0.7); cursor: pointer; }

.button-row { display: flex; gap: 6px; }
.action-button { flex: 1; min-height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; color: #edfaff; }
.action-button.primary { background: #257f9e; }
.action-button.accent { background: #8a6d1a; color: #fff3d6; }
.action-button.danger { background: #4a5a72; color: #ffd6d6; }

.status-line { margin-top: 6px; font-size: 10px; color: #9fb8d4; }
.hint { margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(137, 210, 233, 0.16); font-size: 10px; line-height: 1.7; color: #7f97ad; }

.route-overlay { position: absolute; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 26px; box-sizing: border-box; background: rgba(4, 13, 26, 0.6); backdrop-filter: blur(2px); }
.route-modal { display: flex; flex-direction: column; width: min(560px, 92%); max-height: 88%; padding: 14px 16px; box-sizing: border-box; border: 1px solid rgba(255, 199, 92, 0.5); border-radius: 10px; background: rgba(10, 28, 48, 0.97); box-shadow: 0 10px 36px rgba(0, 0, 0, 0.45); color: #e3f2f8; }
.route-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid rgba(255, 199, 92, 0.28); }
.route-title { font-size: 13px; font-weight: 700; color: #ffd666; }
.help-close { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 1px solid rgba(255, 199, 92, 0.5); border-radius: 50%; background: rgba(255, 199, 92, 0.14); color: #ffd666; cursor: pointer; font-size: 15px; line-height: 1; }
.help-close:hover { background: rgba(255, 199, 92, 0.3); color: #fff7e0; }
.route-body { display: flex; flex-direction: column; gap: 9px; overflow-y: auto; padding: 10px 2px 2px; }
.route-text { margin: 0; font-size: 11px; line-height: 1.75; color: #c7dce8; }

@media (max-width: 1100px) {
  .control-panel { width: 262px; }
}
</style>
