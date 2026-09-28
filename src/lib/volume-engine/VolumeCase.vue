<script setup lang="ts">
/**
 * Volume Engine —— 通用案例组件
 *
 * 以 SceneSpec 驱动一个完整的体渲染案例：统一渲染公共控制（变量 / 分辨率 / 传递函数 /
 * 剖切 / 时间轴 / 向量粒子）与左下剖切预览、图例、拾取浮层。
 * 具体案例只需传入 spec，并通过 extra-controls / extra-legend 槽补充领域特有交互。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { Color } from 'cesium'
import InfoTip from '../../components/InfoTip.vue'
import VolumeShell from './VolumeShell.vue'
import { VolumeEngine, type PickedInfo, type SliceResult, type StationsResult } from './VolumeEngine'
import { buildTransferLut, categoryColor, gradientCss, PALETTES } from './palette'
import { channelOf, type SceneSpec } from './scenes'
import type { PickedView, StatItem } from './types'

const props = defineProps<{ spec: SceneSpec }>()

const emit = defineEmits<{
  (e: 'ready', engine: VolumeEngine): void
  (e: 'stations', stations: StationsResult, engine: VolumeEngine): void
}>()

const PRESETS: { label: string; tileSize: number; levels: number }[] = [
  { label: '128³', tileSize: 16, levels: 4 },
  { label: '192³', tileSize: 24, levels: 4 },
  { label: '256³', tileSize: 32, levels: 4 }
]

const container = ref<HTMLElement | null>(null)
const previewCanvas = ref<HTMLCanvasElement | null>(null)
const status = ref('')
const panelOpen = ref(true)
const shellWidth = ref(Number.POSITIVE_INFINITY)
const engine = shallowRef<VolumeEngine>()
const hasSlice = ref(false)
const picked = ref<PickedInfo | null>(null)

const initial = channelOf(props.spec, props.spec.defaultChannel)
const ui = reactive({
  channel: props.spec.defaultChannel,
  palette: initial.palette,
  opacity: props.spec.defaults.opacity,
  coverage: props.spec.defaults.alphaFloor,
  valueMin: initial.min,
  valueMax: initial.max,
  threshold: undefined as number | undefined,
  sse: props.spec.defaults.sse,
  stepSize: props.spec.defaults.stepSize,
  nearest: props.spec.defaults.nearest,
  volumeVisible: true,
  clipEnabled: false,
  azimuth: 45,
  tilt: 0,
  offset: 0,
  flip: false,
  timeStep: 0,
  playing: false,
  particleVisible: !!props.spec.vector,
  particleCount: props.spec.vector?.defaultCount ?? 3000,
  particleSize: props.spec.vector?.defaultSize ?? 3
})

const stats = reactive({ tilesReady: 0, pending: 0, buildTime: 0 })

let lastSlice: SliceResult | undefined
let playTimer: ReturnType<typeof setInterval> | undefined
let observer: ResizeObserver | undefined

const active = computed(() => channelOf(props.spec, ui.channel))
const isScalar = computed(() => active.value.mode === 'scalar')
const showClipPanel = computed(() => true)
const categories = computed(() => props.spec.categories ?? [])

const presetsActive = computed(() => {
  const e = engine.value
  if (!e) return 0
  return PRESETS.findIndex((p) => p.tileSize === e.tileSize && p.levels === e.levels)
})

const legendCss = computed(() => {
  if (active.value.mode === 'categorical') {
    const cats = categories.value
    return cats.length
      ? `linear-gradient(90deg, ${cats.map((c) => `rgb(${c.color[0]}, ${c.color[1]}, ${c.color[2]})`).join(', ')})`
      : ''
  }
  return gradientCss(ui.palette)
})

const legendMin = computed(() => (active.value.mode === 'categorical' ? (categories.value[0]?.label ?? '') : `${active.value.min}`))
const legendMax = computed(() =>
  active.value.mode === 'categorical'
    ? (categories.value[categories.value.length - 1]?.label ?? '')
    : `${active.value.max} ${active.value.unit}`
)

const statItems = computed<StatItem[]>(() => {
  const e = engine.value
  const items: StatItem[] = [
    { label: '等效分辨率', value: e ? `${e.fullDims}³` : '—' },
    { label: '瓦片 / LOD', value: `${props.spec.defaults.tileSize}³ · ${props.spec.defaults.levels} 级` },
    { label: '已加载瓦片', value: stats.tilesReady.toLocaleString() },
    { label: '待处理请求', value: String(stats.pending) },
    { label: '生成耗时', value: `${stats.buildTime} ms` }
  ]
  if (props.spec.timeSteps > 1) {
    items.push({ label: '时间步', value: `${ui.timeStep + 1} / ${props.spec.timeSteps}` })
  }
  return items
})

const clipRows = computed<StatItem[]>(() => {
  const e = engine.value
  return [
    { label: '方位角', value: `${ui.azimuth}°` },
    { label: '倾角', value: `${ui.tilt}°` },
    { label: '偏移', value: `${ui.offset}%` },
    { label: '保留侧', value: ui.flip ? '反向' : '正向' },
    { label: '法线', value: e ? e.clipInfo().normal : '—' }
  ]
})

const pickedView = computed<PickedView | null>(() => {
  const p = picked.value
  if (!p) return null
  if (!p.valid) return { title: '体元素信息', rows: [], empty: '该处为空体元素 / 无数据' }
  const ch = active.value
  const rows: StatItem[] = []
  if (ch.mode === 'categorical') {
    const cat = props.spec.categories?.find((c) => c.code === Math.round(p.value))
    rows.push({ label: '分类', value: cat ? cat.label : String(Math.round(p.value)) })
  } else {
    rows.push({ label: ch.label, value: `${p.value.toFixed(ch.decimals ?? 2)} ${ch.unit}` })
  }
  rows.push({ label: '瓦片索引', value: String(p.tileIndex) })
  rows.push({ label: '样本索引', value: String(p.sampleIndex) })
  return { title: '体元素信息', rows }
})

function togglePanel(): void {
  panelOpen.value = !panelOpen.value
}

watch(shellWidth, (width, previous) => {
  const narrow = width < 620
  const wasNarrow = previous < 620
  if (narrow !== wasNarrow) panelOpen.value = !narrow
})

/* ------------------------------- Engine ------------------------------- */

function createEngine(): void {
  const instance = new VolumeEngine(container.value as HTMLElement, props.spec, {
    onStatus: (message) => {
      status.value = message
    },
    onReady: (buildTime) => {
      stats.buildTime = buildTime
      if (props.spec.vector && ui.particleVisible) instance.setParticlesVisible(true)
      emit('ready', instance)
    },
    onStats: (next) => {
      stats.tilesReady = next.tilesReady
      stats.pending = next.pending
    },
    onSlice: (result) => {
      lastSlice = result
      drawSlice()
    },
    onPicked: (info) => {
      picked.value = info
    },
    onStations: (stations) => {
      emit('stations', stations, instance)
    }
  })
  engine.value = instance
  void instance.start()
}

/* ------------------------------- Slice -------------------------------- */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function drawSlice(): void {
  const canvas = previewCanvas.value
  const slice = lastSlice
  const e = engine.value
  if (!canvas || !slice || !e) return
  const context = canvas.getContext('2d')
  if (!context) return
  if (canvas.width !== slice.size) {
    canvas.width = slice.size
    canvas.height = slice.size
  }
  const image = context.createImageData(slice.size, slice.size)
  const data = image.data
  const ch = active.value
  if (ch.mode === 'categorical') {
    for (let i = 0; i < slice.size * slice.size; i += 1) {
      if (!slice.valid[i]) continue
      const color = categoryColor(Math.round(slice.values[i]))
      data[i * 4] = color[0]
      data[i * 4 + 1] = color[1]
      data[i * 4 + 2] = color[2]
      data[i * 4 + 3] = Math.round(ui.opacity * 255)
    }
  } else {
    const lut = e.scalarLut()
    const span = ui.valueMax - ui.valueMin || 1
    for (let i = 0; i < slice.size * slice.size; i += 1) {
      if (!slice.valid[i]) continue
      const t = clamp01((slice.values[i] - ui.valueMin) / span)
      const idx = Math.round(t * 255)
      data[i * 4] = lut[idx * 4]
      data[i * 4 + 1] = lut[idx * 4 + 1]
      data[i * 4 + 2] = lut[idx * 4 + 2]
      data[i * 4 + 3] = Math.round(ui.opacity * lut[idx * 4 + 3])
    }
  }
  context.putImageData(image, 0, 0)
  hasSlice.value = true
}

function downloadSlice(): void {
  const canvas = previewCanvas.value
  if (!canvas) return
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${props.spec.kind}-slice-az${ui.azimuth}-tilt${ui.tilt}-off${ui.offset}.png`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, 'image/png')
}

/* ------------------------------ Controls ------------------------------ */

function onChannel(key: string): void {
  if (key === ui.channel) return
  ui.channel = key
  const ch = channelOf(props.spec, key)
  ui.palette = ch.palette
  ui.valueMin = ch.min
  ui.valueMax = ch.max
  ui.threshold = undefined
  ui.timeStep = 0
  lastSlice = undefined
  hasSlice.value = false
  engine.value?.setChannel(key)
}

function onPalette(key: string): void {
  ui.palette = key
  engine.value?.setPalette(key)
  drawSlice()
}

function onOpacity(): void {
  engine.value?.setOpacity(ui.opacity)
  drawSlice()
}

function onCoverage(): void {
  engine.value?.setAlphaFloor(ui.coverage)
  drawSlice()
}

function onRange(): void {
  if (ui.valueMin >= ui.valueMax) ui.valueMax = ui.valueMin + 1
  engine.value?.setValueRange(ui.valueMin, ui.valueMax)
  drawSlice()
}

function onThreshold(value: number | undefined): void {
  ui.threshold = ui.threshold === value ? undefined : value
  engine.value?.setThreshold(ui.threshold)
  drawSlice()
}

function onSse(): void {
  engine.value?.setSse(ui.sse)
}

function onStepSize(): void {
  engine.value?.setStepSize(ui.stepSize)
}

function onNearest(): void {
  ui.nearest = !ui.nearest
  engine.value?.setNearest(ui.nearest)
}

function onVolumeVisible(): void {
  ui.volumeVisible = !ui.volumeVisible
  engine.value?.setVolumeVisible(ui.volumeVisible)
}

function onClipInput(): void {
  engine.value?.setClip({ enabled: ui.clipEnabled, azimuth: ui.azimuth, tilt: ui.tilt, offset: ui.offset, flip: ui.flip })
}

function onTimeStep(index: number): void {
  ui.timeStep = index
  engine.value?.setTimeStep(index)
}

function togglePlay(): void {
  ui.playing = !ui.playing
  if (playTimer) {
    clearInterval(playTimer)
    playTimer = undefined
  }
  if (ui.playing) {
    playTimer = setInterval(() => {
      const next = (ui.timeStep + 1) % props.spec.timeSteps
      onTimeStep(next)
    }, 1000)
  }
}

function onPreset(index: number): void {
  const preset = PRESETS[index]
  engine.value?.setPreset(preset.tileSize, preset.levels)
}

function onParticleVisible(): void {
  ui.particleVisible = !ui.particleVisible
  engine.value?.setParticlesVisible(ui.particleVisible)
}

function onParticleCount(count: number): void {
  ui.particleCount = count
  engine.value?.setParticleCount(count)
}

function onParticleSize(): void {
  engine.value?.setParticleSize(ui.particleSize)
}

function onResetView(): void {
  engine.value?.resetCamera(1)
}

function onRebuild(): void {
  engine.value?.rebuild()
}

function accentColor(value: number, min: number, max: number): Color {
  const t = clamp01((value - min) / (max - min || 1))
  const lut = buildTransferLut(ui.palette, { alphaFloor: 0.2, alphaGamma: 0.7 })
  const idx = Math.round(t * 255)
  return new Color(lut[idx * 4] / 255, lut[idx * 4 + 1] / 255, lut[idx * 4 + 2] / 255, 0.95)
}

onMounted(() => {
  if (!container.value) return
  shellWidth.value = container.value.clientWidth
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) shellWidth.value = entry.contentRect.width
    })
    observer.observe(container.value)
  }
  createEngine()
})

onBeforeUnmount(() => {
  if (playTimer) clearInterval(playTimer)
  observer?.disconnect()
  observer = undefined
  engine.value?.destroy()
  engine.value = undefined
})

defineExpose({ engine, ui, accentColor, drawSlice })
</script>

<template>
  <VolumeShell
    :title="spec.title"
    :status="status"
    :panel-open="panelOpen"
    :legend-css="legendCss"
    :legend-min="legendMin"
    :legend-max="legendMax"
    :stats="statItems"
    :clip-rows="clipRows"
    :show-clip-panel="showClipPanel"
    :has-slice="hasSlice"
    :picked="pickedView"
    @toggle-panel="togglePanel"
    @download-slice="downloadSlice"
  >
    <template #scene>
      <div ref="container" class="vol-cesium"></div>
      <slot name="overlay" :engine="engine" />
    </template>

    <template #slice>
      <canvas ref="previewCanvas" :class="{ hidden: !hasSlice }"></canvas>
    </template>

    <template #legend>
      <slot name="extra-legend" :engine="engine" />
    </template>

    <template #controls>
      <div class="vol-section">
        变量
        <InfoTip title="变量" text="切换当前体数据通道。标量通道经传递函数映射颜色与透明度；分类通道直接使用分类色板。" />
      </div>
      <div class="vol-chips">
        <button
          v-for="ch in spec.channels"
          :key="ch.key"
          type="button"
          class="vol-chip"
          :class="{ active: ui.channel === ch.key }"
          @click="onChannel(ch.key)"
        >
          {{ ch.label }}
        </button>
      </div>

      <div class="vol-section">
        体数据 LOD
        <InfoTip title="体数据 LOD" text="体数据按八叉树组织为多级瓦片，Cesium 依据屏幕误差与视距自动流式加载合适层级。预设决定等效分辨率。" />
      </div>
      <div class="vol-chips">
        <button
          v-for="(preset, i) in PRESETS"
          :key="preset.label"
          type="button"
          class="vol-chip"
          :class="{ active: presetsActive === i }"
          @click="onPreset(i)"
        >
          {{ preset.label }}
        </button>
      </div>

      <template v-if="isScalar">
        <div class="vol-section">
          传递函数
          <InfoTip title="传递函数" text="色带以 256×1 传递函数纹理实现，片元着色器统一采样颜色与透明度。" />
        </div>
        <div class="vol-chips">
          <button
            v-for="(item, key) in PALETTES"
            :key="key"
            type="button"
            class="vol-chip"
            :class="{ active: ui.palette === key }"
            @click="onPalette(key as string)"
          >
            {{ item.label }}
          </button>
        </div>
        <div class="vol-row">
          <span class="vol-label">
            不透明度
            <InfoTip title="不透明度" text="体渲染整体透明度，越低越能透过前方结构看到后方数值分布。" />
          </span>
          <input type="range" min="0.1" max="1" step="0.02" v-model.number="ui.opacity" @input="onOpacity" />
          <span class="vol-value">{{ ui.opacity.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">
            覆盖基底
            <InfoTip title="覆盖基底" text="低值体元素保留的最低不透明度，越大越完整覆盖数据域；为 0 时低值完全透明。" />
          </span>
          <input type="range" min="0" max="0.9" step="0.02" v-model.number="ui.coverage" @input="onCoverage" />
          <span class="vol-value">{{ ui.coverage.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">
            值域下限
            <InfoTip title="值域下限" text="数值映射下限，低于该值的体元素不再显示，用于突出目标区间。" />
          </span>
          <input type="range" :min="active.min" :max="active.max" :step="(active.max - active.min) / 100" v-model.number="ui.valueMin" @input="onRange" />
          <span class="vol-value">{{ ui.valueMin.toFixed(active.decimals ?? 1) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">
            值域上限
            <InfoTip title="值域上限" text="数值映射上限，与下限共同拉伸对比度。" />
          </span>
          <input type="range" :min="active.min" :max="active.max" :step="(active.max - active.min) / 100" v-model.number="ui.valueMax" @input="onRange" />
          <span class="vol-value">{{ ui.valueMax.toFixed(active.decimals ?? 1) }}</span>
        </div>
        <template v-if="active.thresholds && active.thresholds.length">
          <div class="vol-row">
            <span class="vol-label">
              阈值
              <InfoTip title="阈值" text="低于阈值的体元素不显示，用于快速聚焦强信号区域。再次点击可取消。" />
            </span>
            <div class="vol-mini">
              <button
                v-for="t in active.thresholds"
                :key="t"
                type="button"
                :class="{ active: ui.threshold === t }"
                @click="onThreshold(t)"
              >
                ≥{{ t }}
              </button>
            </div>
          </div>
        </template>
      </template>

      <div class="vol-section">渲染参数</div>
      <div class="vol-row">
        <span class="vol-label">
          光线步长
          <InfoTip title="光线步长" text="GPU 光线步进的采样步长，越小越精细、开销越大。" />
        </span>
        <input type="range" min="0.3" max="3" step="0.1" v-model.number="ui.stepSize" @input="onStepSize" />
        <span class="vol-value">{{ ui.stepSize }}</span>
      </div>
      <div class="vol-row">
        <span class="vol-label">
          屏幕误差
          <InfoTip title="屏幕误差" text="LOD 细分阈值，越小越倾向高分辨率，显存与请求量越大。" />
        </span>
        <input type="range" min="4" max="64" step="2" v-model.number="ui.sse" @input="onSse" />
        <span class="vol-value">{{ ui.sse }}</span>
      </div>
      <div class="vol-row">
        <span class="vol-label">
          最近邻采样
          <InfoTip title="最近邻采样" text="体元素采样方式，开启后呈清晰方块状，关闭则平滑过渡。" />
        </span>
        <button class="vol-switch" :class="{ 'is-on': ui.nearest }" @click="onNearest"><span></span></button>
      </div>
      <div class="vol-row">
        <span class="vol-label">
          显示体元素
          <InfoTip title="显示体元素" text="是否显示体渲染结果。" />
        </span>
        <button class="vol-switch" :class="{ 'is-on': ui.volumeVisible }" @click="onVolumeVisible"><span></span></button>
      </div>

      <template v-if="spec.timeSteps > 1">
        <div class="vol-section">
          时间轴
          <InfoTip title="时间轴" :text="`体数据按${spec.timeStepUnit}时间步组织，可逐帧查看或自动播放。`" />
        </div>
        <div class="vol-row">
          <span class="vol-label">时间步</span>
          <input type="range" min="0" :max="spec.timeSteps - 1" step="1" :value="ui.timeStep" @input="onTimeStep(Number(($event.target as HTMLInputElement).value))" />
          <span class="vol-value">{{ ui.timeStep + 1 }}/{{ spec.timeSteps }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">自动播放</span>
          <button class="vol-switch" :class="{ 'is-on': ui.playing }" @click="togglePlay"><span></span></button>
        </div>
      </template>

      <div v-if="showClipPanel" class="vol-section">
        任意方向剖切
        <InfoTip title="任意方向剖切" text="沿任意方位角与倾角剖切体数据，切面采样在 Worker 中完成，可与图例预览联动。" />
      </div>
      <template v-if="showClipPanel">
        <div class="vol-row">
          <span class="vol-label">启用剖切</span>
          <button class="vol-switch" :class="{ 'is-on': ui.clipEnabled }" @click="ui.clipEnabled = !ui.clipEnabled; onClipInput()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">方位角</span>
          <input type="range" min="0" max="360" step="1" v-model.number="ui.azimuth" @input="onClipInput" />
          <span class="vol-value">{{ ui.azimuth }}°</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">倾角</span>
          <input type="range" min="0" max="90" step="1" v-model.number="ui.tilt" @input="onClipInput" />
          <span class="vol-value">{{ ui.tilt }}°</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">偏移</span>
          <input type="range" min="-100" max="100" step="1" v-model.number="ui.offset" @input="onClipInput" />
          <span class="vol-value">{{ ui.offset }}%</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">反转保留侧</span>
          <button class="vol-switch" :class="{ 'is-on': ui.flip }" @click="ui.flip = !ui.flip; onClipInput()"><span></span></button>
        </div>
      </template>

      <template v-if="spec.vector">
        <div class="vol-section">
          {{ spec.vector.label }}
          <InfoTip :title="spec.vector.label" text="基于三维向量场的 GPU/Worker 粒子平流，颜色表示速度大小。" />
        </div>
        <div class="vol-row">
          <span class="vol-label">显示粒子</span>
          <button class="vol-switch" :class="{ 'is-on': ui.particleVisible }" @click="onParticleVisible"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">粒子数</span>
          <div class="vol-mini">
            <button
              v-for="c in [2000, 4000, 8000]"
              :key="c"
              type="button"
              :class="{ active: ui.particleCount === c }"
              @click="onParticleCount(c)"
            >
              {{ c / 1000 }}k
            </button>
          </div>
        </div>
        <div class="vol-row">
          <span class="vol-label">粒子尺寸</span>
          <input type="range" min="1" max="6" step="1" v-model.number="ui.particleSize" @input="onParticleSize" />
          <span class="vol-value">{{ ui.particleSize }}px</span>
        </div>
      </template>

      <slot name="extra-controls" :engine="engine" :ui="ui" :accent-color="accentColor" />
    </template>

    <template #actions>
      <button class="vol-action" @click="onRebuild">重新生成</button>
      <button class="vol-action ghost" @click="onResetView">恢复视图</button>
      <slot name="extra-actions" :engine="engine" />
    </template>
  </VolumeShell>
</template>
