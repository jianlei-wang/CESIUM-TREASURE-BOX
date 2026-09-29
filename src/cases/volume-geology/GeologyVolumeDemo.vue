<script setup lang="ts">
/**
 * 三维地层属性体 —— 场景化 UI
 *
 * 岩性分类与工程属性（孔隙率 / 渗透率 / 饱和度）双通道的地质体工作台：
 * 顶底裁剪、属性统计直方图、等值面提取与钻孔拾取，围绕储层评价流程组织界面。
 */
import { computed, reactive, ref, watch } from 'vue'
import VolumeShell from '../../lib/volume-engine/VolumeShell.vue'
import { useVolumeScene } from '../../lib/volume-engine/useVolumeScene'
import { SCENES } from '../../lib/volume-engine/scenes'
import { buildTransferLut, gradientCss } from '../../lib/volume-engine/palette'
import type { PickedView, StatItem } from '../../lib/volume-engine/types'

type StatsResult = {
  count: number
  min: number
  max: number
  mean: number
  p50: number
  p95: number
  histogram: Float32Array
  bins: number
}
type IsoResult = { positions: Float32Array; normals: Float32Array; count: number; res: number }

const spec = SCENES.geology
const panelOpen = ref(true)
const categories = spec.categories ?? []

const form = reactive({ undulation: spec.params.undulation as number, intrusion: spec.params.intrusion as number })
const band = reactive({ enabled: false, min: 10, max: 90 })
const stats = ref<StatsResult | null>(null)
const iso = reactive({ enabled: false, threshold: 18 })
const busy = ref(false)

const scene = useVolumeScene(spec, {
  onReady: (engine) => {
    void runStats(engine)
  }
})
const { container, sliceCanvas } = scene

const isScalar = computed(() => scene.active().mode === 'scalar')

async function runStats(engine = scene.engine.value): Promise<void> {
  if (!engine || scene.active().mode !== 'scalar') {
    stats.value = null
    return
  }
  busy.value = true
  try {
    const result = await engine.analyze<StatsResult>({ mode: 'stats', res: 40 })
    stats.value = result ?? null
  } finally {
    busy.value = false
  }
}

async function runIso(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  if (!iso.enabled || !isScalar.value) {
    engine.clearIsosurface()
    return
  }
  busy.value = true
  try {
    const result = await engine.analyze<IsoResult>({ mode: 'isosurface', iso: iso.threshold, res: 34 })
    if (!result || !result.count) {
      engine.clearIsosurface()
      return
    }
    const lut = buildTransferLut(scene.ui.palette)
    const t = Math.max(0, Math.min(1, (iso.threshold - scene.ui.valueMin) / (scene.ui.valueMax - scene.ui.valueMin || 1)))
    const idx = Math.round(t * 255)
    engine.setIsosurface(result.positions, result.normals, [lut[idx * 4] / 255, lut[idx * 4 + 1] / 255, lut[idx * 4 + 2] / 255], 0.62)
  } finally {
    busy.value = false
  }
}

function onChannel(key: string): void {
  scene.setChannel(key)
  iso.enabled = false
  scene.engine.value?.clearIsosurface()
  void runStats()
}

function applyForm(): void {
  scene.engine.value?.setParams({ undulation: form.undulation, intrusion: form.intrusion })
}

function onBand(): void {
  scene.engine.value?.setHeightClip(band.min / 100, band.max / 100, band.enabled)
}

function toggleBand(): void {
  band.enabled = !band.enabled
  onBand()
}

function toggleIso(): void {
  iso.enabled = !iso.enabled
  void runIso()
}

watch(
  () => scene.ui.channel,
  () => {
    void runStats()
  }
)

const legendCss = computed(() =>
  isScalar.value ? gradientCss(scene.ui.palette) : ''
)

const histogram = computed(() => {
  const s = stats.value
  if (!s) return []
  let max = 0
  for (let i = 0; i < s.bins; i += 1) if (s.histogram[i] > max) max = s.histogram[i]
  const ch = scene.active()
  return Array.from({ length: s.bins }, (_, i) => {
    const value = s.min + ((s.max - s.min) * (i + 0.5)) / s.bins
    return {
      ratio: max ? s.histogram[i] / max : 0,
      highlight: Math.abs(value - iso.threshold) < (s.max - s.min) / s.bins,
      color: ch.palette === 'gray' ? '#65d3eb' : `rgb(${buildTransferLut(ch.palette)[Math.min(255, Math.round((i / (s.bins - 1)) * 255)) * 4]}, ${buildTransferLut(ch.palette)[Math.min(255, Math.round((i / (s.bins - 1)) * 255)) * 4 + 1]}, ${buildTransferLut(ch.palette)[Math.min(255, Math.round((i / (s.bins - 1)) * 255)) * 4 + 2]})`
    }
  })
})

const statItems = computed<StatItem[]>(() => {
  const items: StatItem[] = [
    { label: '等效分辨率', value: scene.engine.value ? `${scene.engine.value.fullDims}³` : '—' },
    { label: '已加载瓦片', value: scene.stats.tilesReady.toLocaleString() }
  ]
  const s = stats.value
  if (s) {
    const unit = scene.active().unit
    items.push({ label: '属性最小值', value: `${s.min.toFixed(1)} ${unit}` })
    items.push({ label: '属性均值', value: `${s.mean.toFixed(1)} ${unit}` })
    items.push({ label: '属性 P95', value: `${s.p95.toFixed(1)} ${unit}` })
  }
  return items
})

const clipRows = computed<StatItem[]>(() => [
  { label: '顶底裁剪', value: band.enabled ? `${band.min}% ~ ${band.max}%` : '关闭' },
  { label: '剖切方位', value: `${scene.ui.azimuth}°` },
  { label: '剖切倾角', value: `${scene.ui.tilt}°` },
  { label: '剖切偏移', value: `${scene.ui.offset}%` }
])

const pickedView = computed<PickedView | null>(() => {
  const p = scene.picked.value
  if (!p) return null
  const rows: StatItem[] = []
  if (!p.valid) return { title: '钻孔拾取', rows: [], empty: '该处无有效体元素' }
  if (scene.active().mode === 'categorical') {
    const cat = categories.find((c) => c.code === Math.round(p.value))
    rows.push({ label: '岩性', value: cat ? cat.label : `#${Math.round(p.value)}` })
  } else {
    const ch = scene.active()
    rows.push({ label: ch.label, value: `${p.value.toFixed(ch.decimals ?? 1)} ${ch.unit}` })
  }
  if (p.lon !== undefined && p.lat !== undefined) {
    rows.push({ label: '经度 / 纬度', value: `${p.lon.toFixed(3)}, ${p.lat.toFixed(3)}` })
    rows.push({ label: '埋深', value: `${(-(p.height ?? 0)).toFixed(0)} m` })
  }
  return { title: '钻孔拾取', rows }
})
</script>

<template>
  <VolumeShell
    title="三维地层属性体"
    :status="scene.status.value"
    :panel-open="panelOpen"
    :legend-css="legendCss"
    :legend-min="isScalar ? String(scene.active().min) : ''"
    :legend-max="isScalar ? `${scene.active().max} ${scene.active().unit}` : ''"
    :stats="statItems"
    :clip-rows="clipRows"
    :has-slice="scene.hasSlice.value"
    :picked="pickedView"
    @toggle-panel="panelOpen = !panelOpen"
    @download-slice="scene.downloadSlice()"
  >
    <template #scene>
      <div ref="container" class="vol-cesium"></div>
    </template>

    <template #slice>
      <canvas ref="sliceCanvas" :class="{ hidden: !scene.hasSlice.value }"></canvas>
    </template>

    <template #legend>
      <template v-if="!isScalar">
        <div class="gl-tier" v-for="cat in categories" :key="cat.code">
          <i :style="{ background: `rgb(${cat.color[0]}, ${cat.color[1]}, ${cat.color[2]})` }"></i>
          <span>{{ cat.label }}</span>
          <b>#{{ cat.code }}</b>
        </div>
      </template>
      <div v-else-if="histogram.length" class="gl-hist">
        <div class="gl-hist-title">属性分布直方图</div>
        <div class="gl-hist-bars">
          <i
            v-for="(bar, i) in histogram"
            :key="i"
            :style="{ height: `${Math.max(3, bar.ratio * 100)}%`, background: bar.highlight ? '#ffd21e' : bar.color }"
          ></i>
        </div>
        <div class="gl-hist-range">
          <span>{{ stats?.min.toFixed(1) }}</span>
          <span>{{ stats?.max.toFixed(1) }}</span>
        </div>
      </div>
    </template>

    <template #controls>
      <div class="gl-block">
        <div class="vol-section">通道（岩性 / 属性）</div>
        <div class="gl-channels">
          <button
            v-for="ch in spec.channels"
            :key="ch.key"
            type="button"
            class="gl-channel"
            :class="{ active: scene.ui.channel === ch.key, categorical: ch.mode === 'categorical' }"
            @click="onChannel(ch.key)"
          >
            {{ ch.label }}
          </button>
        </div>
      </div>

      <div class="gl-block">
        <div class="vol-section">顶底裁剪</div>
        <div class="vol-row">
          <span class="vol-label">启用</span>
          <button class="vol-switch" :class="{ 'is-on': band.enabled }" @click="toggleBand"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">顶界深度</span>
          <input type="range" min="0" max="100" step="1" v-model.number="band.min" @input="onBand" />
          <span class="vol-value">{{ band.min }}%</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">底界深度</span>
          <input type="range" min="0" max="100" step="1" v-model.number="band.max" @input="onBand" />
          <span class="vol-value">{{ band.max }}%</span>
        </div>
      </div>

      <div v-if="isScalar" class="gl-block">
        <div class="vol-section">属性等值面</div>
        <div class="vol-row">
          <span class="vol-label">显示等值面</span>
          <button class="vol-switch" :class="{ 'is-on': iso.enabled }" @click="toggleIso"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">等值阈值</span>
          <input
            type="range"
            :min="scene.active().min"
            :max="scene.active().max"
            :step="(scene.active().max - scene.active().min) / 100"
            v-model.number="iso.threshold"
            @change="runIso()"
          />
          <span class="vol-value">{{ iso.threshold.toFixed(1) }}</span>
        </div>
        <div class="gl-hint">在属性体中提取等值面，用于刻画储层甜点或隔夹层</div>
      </div>

      <div class="gl-block">
        <div class="vol-section">地层构造参数</div>
        <div class="vol-row">
          <span class="vol-label">地层起伏</span>
          <input type="range" min="0" max="0.18" step="0.01" v-model.number="form.undulation" @change="applyForm" />
          <span class="vol-value">{{ form.undulation.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">侵入体规模</span>
          <input type="range" min="0.04" max="0.24" step="0.01" v-model.number="form.intrusion" @change="applyForm" />
          <span class="vol-value">{{ form.intrusion.toFixed(2) }}</span>
        </div>
        <button class="gl-btn" :disabled="busy" @click="runStats()">{{ busy ? '计算中…' : '重算属性统计' }}</button>
      </div>

      <div class="gl-block">
        <div class="vol-section">任意方向剖切</div>
        <div class="vol-row">
          <span class="vol-label">启用剖切</span>
          <button
            class="vol-switch"
            :class="{ 'is-on': scene.ui.clipEnabled }"
            @click="scene.ui.clipEnabled = !scene.ui.clipEnabled; scene.setClip()"
          ><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">方位角</span>
          <input type="range" min="0" max="360" step="1" v-model.number="scene.ui.azimuth" @input="scene.setClip()" />
          <span class="vol-value">{{ scene.ui.azimuth }}°</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">倾角</span>
          <input type="range" min="0" max="90" step="1" v-model.number="scene.ui.tilt" @input="scene.setClip()" />
          <span class="vol-value">{{ scene.ui.tilt }}°</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">偏移</span>
          <input type="range" min="-100" max="100" step="1" v-model.number="scene.ui.offset" @input="scene.setClip()" />
          <span class="vol-value">{{ scene.ui.offset }}%</span>
        </div>
      </div>

      <div v-if="isScalar" class="gl-block">
        <div class="vol-section">传递函数</div>
        <div class="vol-row">
          <span class="vol-label">不透明度</span>
          <input type="range" min="0.1" max="1" step="0.02" v-model.number="scene.ui.opacity" @input="scene.setOpacity()" />
          <span class="vol-value">{{ scene.ui.opacity.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">覆盖基底</span>
          <input type="range" min="0" max="0.9" step="0.02" v-model.number="scene.ui.coverage" @input="scene.setCoverage()" />
          <span class="vol-value">{{ scene.ui.coverage.toFixed(2) }}</span>
        </div>
      </div>
    </template>

    <template #actions>
      <button class="vol-action" @click="scene.engine.value?.rebuild()">重新生成</button>
      <button class="vol-action ghost" @click="scene.engine.value?.resetCamera(1)">恢复视图</button>
    </template>
  </VolumeShell>
</template>

<style scoped>
.gl-block {
  margin-bottom: 10px;
}
.gl-channels {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
}
.gl-channel {
  padding: 6px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.gl-channel.categorical {
  border-style: dashed;
}
.gl-channel.active {
  border-color: #d8b04a;
  background: rgba(216, 176, 74, 0.24);
  color: #fff;
  font-weight: 600;
}
.gl-btn {
  width: 100%;
  height: 26px;
  margin-top: 6px;
  border: 0;
  border-radius: 5px;
  background: #2f80ed;
  color: #eef4ff;
  font-size: 11px;
  cursor: pointer;
}
.gl-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.gl-hint {
  margin-top: 4px;
  font-size: 9px;
  line-height: 1.5;
  color: #7f96b3;
}
.gl-tier {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 10px;
  color: #c3d5e8;
}
.gl-tier i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.gl-tier span {
  flex: 1 1 auto;
}
.gl-tier b {
  color: #65d3eb;
  font-weight: 600;
}
.gl-hist {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed rgba(157, 188, 224, 0.3);
}
.gl-hist-title {
  font-size: 10px;
  font-weight: 700;
  color: #65d3eb;
  margin-bottom: 4px;
}
.gl-hist-bars {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 64px;
  padding: 2px;
  box-sizing: border-box;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
}
.gl-hist-bars i {
  flex: 1 1 0;
  border-radius: 1px 1px 0 0;
  opacity: 0.9;
}
.gl-hist-range {
  display: flex;
  justify-content: space-between;
  margin-top: 3px;
  font-size: 9px;
  color: #9fb8d4;
  font-variant-numeric: tabular-nums;
}
</style>
