<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { createDefaultValues } from './mount-sky-atmos'
import { buildSchema } from './schemas.js'

type SchemaControl = {
  key: string
  label: string
  type: 'range' | 'toggle' | 'select' | 'datetime'
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: Array<{ value: string; label: string }>
  visible?: (values: Record<string, unknown>) => boolean
  disabled?: (values: Record<string, unknown>) => boolean
}

type SchemaSection = { title: string; controls: SchemaControl[] }

const props = defineProps<{
  preset: 'clouds' | 'godray' | 'quality'
  title: string
  statusText: string
}>()

const container = ref<HTMLElement | null>(null)
const values = reactive<Record<string, unknown>>({})
const loading = ref(true)
const statusMessage = ref(props.statusText)
const errorMessage = ref('')
const activeSection = ref(0)
const sections = ref<SchemaSection[]>([])
const abortController = new AbortController()

let schema: ReturnType<typeof buildSchema> | null = null
let handle: { instance: { loadAssets: () => Promise<void> }; apply: (patch: unknown) => void; destroy: () => void } | undefined
let disposed = false

const visibleControls = computed(() =>
  sections.value
    .map((section) => ({
      ...section,
      controls: section.controls.filter((control) => !control.visible || control.visible(values)),
    }))
    .filter((section) => section.controls.length > 0),
)

function isDisabled(control: SchemaControl): boolean {
  return control.disabled ? control.disabled(values) : false
}

function formatValue(control: SchemaControl, value: unknown): string {
  const numeric = Number(value)
  const text = Number.isFinite(numeric)
    ? numeric.toFixed(Math.max(0, String(control.step ?? 0).split('.')[1]?.length ?? 0))
    : String(value)
  return control.unit ? `${text}${control.unit}` : text
}

function commit(): void {
  if (!schema || !handle) return
  handle.apply(schema.applyPatch(values) as Record<string, unknown>)
  if (activeSection.value >= visibleControls.value.length) {
    activeSection.value = 0
  }
}

function toggleControlValue(control: SchemaControl): void {
  values[control.key] = !values[control.key]
  commit()
}

async function mountScene(): Promise<void> {
  if (!container.value) return
  try {
    const { mountSkyAtmos } = await import('./mount-sky-atmos')
    const defaults = createDefaultValues(props.preset)
    schema = buildSchema(props.preset, defaults.options)
    sections.value = schema.sections as SchemaSection[]
    Object.assign(values, schema.values)
    if (disposed) return

    handle = await mountSkyAtmos({
      container: container.value,
      signal: abortController.signal,
    })
    if (disposed) {
      handle.destroy()
      handle = undefined
      return
    }
    await handle.instance.loadAssets()
    if (disposed) return
    handle.apply(schema.applyPatch(values) as Record<string, unknown>)
    ;(window as unknown as Record<string, unknown>).__skyAtmos = handle.instance
    loading.value = false
    statusMessage.value = ''
  } catch (error) {
    if (disposed || (error as Error)?.name === 'AbortError') return
    loading.value = false
    statusMessage.value = ''
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

onMounted(() => {
  void mountScene()
})

onBeforeUnmount(() => {
  disposed = true
  abortController.abort()
  handle?.destroy()
  handle = undefined
  if ((window as unknown as Record<string, unknown>).__skyAtmos) {
    delete (window as unknown as Record<string, unknown>).__skyAtmos
  }
})
</script>

<template>
  <div class="sky-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="sky-panel">
      <div class="panel-title">{{ title }}</div>

      <div class="section-tabs">
        <button
          v-for="(section, index) in visibleControls"
          :key="section.title"
          type="button"
          class="section-tab"
          :class="{ active: activeSection === index }"
          @click="activeSection = index"
        >
          {{ section.title }}
        </button>
      </div>

      <div v-for="(section, index) in visibleControls" :key="section.title" v-show="activeSection === index" class="section-body">
        <template v-for="control in section.controls" :key="control.key">
          <div v-if="control.type === 'toggle'" class="toggle-row">
            <span class="toggle-label">{{ control.label }}</span>
            <button
              type="button"
              class="toggle"
              :class="{ on: Boolean(values[control.key]), disabled: isDisabled(control) }"
              :disabled="isDisabled(control)"
              :aria-label="`${control.label}：${values[control.key] ? '开启' : '关闭'}`"
              @click="toggleControlValue(control)"
            >
              <i></i>
            </button>
          </div>
          <div v-else-if="control.type === 'select'" class="param-block">
            <span class="param-label">{{ control.label }}</span>
            <select
              v-model="values[control.key]"
              class="param-select"
              :disabled="isDisabled(control)"
              @change="commit"
            >
              <option v-for="option in control.options" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </div>
          <div v-else-if="control.type === 'datetime'" class="param-block">
            <span class="param-label">{{ control.label }}</span>
            <input v-model="values[control.key]" class="param-datetime" type="datetime-local" step="60" @change="commit" />
          </div>
          <div v-else class="param-row">
            <span class="param-label">{{ control.label }}</span>
            <input
              v-model.number="values[control.key]"
              class="param-slider"
              type="range"
              :min="control.min"
              :max="control.max"
              :step="control.step"
              :disabled="isDisabled(control)"
              @input="commit"
            />
            <span class="param-value">{{ formatValue(control, values[control.key]) }}</span>
          </div>
        </template>
      </div>

      <p class="hint">拖动视角或调整参数，云层、光束与后期效果实时生效。</p>
    </div>

    <div v-if="loading" class="status-mask">{{ statusMessage }}</div>
    <div v-else-if="errorMessage" class="status-mask is-error">{{ errorMessage }}</div>
  </div>
</template>

<style scoped>
.sky-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #0b1424; }
.cesium-container { width: 100%; height: 100%; }
.sky-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 8px; width: 260px; max-height: calc(100% - 24px); padding: 12px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 9px; background: rgba(8, 32, 49, 0.88); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; overflow: hidden; }
.panel-title { font-size: 12px; font-weight: 700; color: #eaf7fb; }
.section-tabs { display: flex; flex-wrap: wrap; gap: 4px; }
.section-tab { padding: 3px 7px; border: 1px solid rgba(137, 210, 233, 0.25); border-radius: 5px; background: transparent; color: #a8c8d6; font-size: 10px; cursor: pointer; }
.section-tab.active { border-color: rgba(54, 197, 232, 0.75); background: rgba(54, 197, 232, 0.16); color: #9fe6fa; }
.section-body { display: flex; flex-direction: column; gap: 7px; min-height: 0; overflow-y: auto; padding-right: 2px; }
.section-body::-webkit-scrollbar { width: 4px; }
.section-body::-webkit-scrollbar-thumb { background: rgba(137, 210, 233, 0.35); border-radius: 2px; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; }
.toggle-label, .param-label { font-size: 11px; color: #bdd9e4; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(173, 200, 215, 0.35); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e2f0f4; transition: transform 0.2s; }
.toggle.on { background: #36c5e8; }
.toggle.on i { transform: translateX(18px); }
.toggle.disabled { opacity: 0.45; cursor: not-allowed; }
.param-row { display: flex; align-items: center; gap: 8px; }
.param-label { flex: 0 0 76px; }
.param-slider { flex: 1; min-width: 0; height: 4px; accent-color: #36c5e8; }
.param-value { flex: 0 0 52px; color: #9bb5c1; font-size: 10px; text-align: right; font-variant-numeric: tabular-nums; }
.param-block { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.param-select, .param-datetime { flex: 1; min-width: 0; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; padding: 3px 4px; }
.hint { margin: 0; color: #a4c6d2; font-size: 10px; line-height: 1.45; }
.status-mask { position: absolute; top: 12px; left: 50%; z-index: 9; transform: translateX(-50%); width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
.status-mask.is-error { border-color: rgba(233, 120, 120, 0.6); color: #ffbdbd; }
</style>
