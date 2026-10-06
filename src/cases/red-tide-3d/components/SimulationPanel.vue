<script setup lang="ts">
import { computed } from 'vue'
import { useRedTideStore } from '@rt/stores/red-tide'
import InfoTip from '../../../components/InfoTip.vue'

const store = useRedTideStore()
const displayHours = computed(() => store.elapsedSeconds / 3600)
const computeMode = computed(() => store.simulationComputeMode === 'gpu-gpgpu' ? 'GPU GPGPU' : (store.simulationComputeMode === 'shared-array-buffer' ? 'Worker + SAB' : 'Worker + Transfer'))

interface Preset {
  name: string
  diffusion: number
  growthRate: number
  decayRate: number
  nutrient: number
  light: number
  temperature: number
}

const PRESETS: Preset[] = [
  { name: '基准情景', diffusion: 0.012, growthRate: 0.000012, decayRate: 0.000004, nutrient: 0.78, light: 0.88, temperature: 24.2 },
  { name: '富营养化', diffusion: 0.016, growthRate: 0.000028, decayRate: 0.000003, nutrient: 0.95, light: 0.86, temperature: 25.4 },
  { name: '低光抑制', diffusion: 0.01, growthRate: 0.000009, decayRate: 0.000005, nutrient: 0.62, light: 0.42, temperature: 23.6 },
  { name: '升温爆发', diffusion: 0.02, growthRate: 0.000038, decayRate: 0.000002, nutrient: 0.9, light: 0.94, temperature: 29.5 },
]

const near = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps

const activePreset = computed<string | null>(() => {
  const match = PRESETS.find((preset) =>
    near(store.diffusion, preset.diffusion, 1e-6) &&
    near(store.growthRate, preset.growthRate, 1e-9) &&
    near(store.decayRate, preset.decayRate, 1e-9) &&
    near(store.nutrient, preset.nutrient, 1e-6) &&
    near(store.light, preset.light, 1e-6) &&
    near(store.temperature, preset.temperature, 1e-6),
  )
  return match ? match.name : null
})

function applyPreset(preset: Preset): void {
  store.diffusion = preset.diffusion
  store.growthRate = preset.growthRate
  store.decayRate = preset.decayRate
  store.nutrient = preset.nutrient
  store.light = preset.light
  store.temperature = preset.temperature
}
</script>

<template>
  <section class="simulation-panel panel-card">
    <div class="panel-header">
      <span>仿真推演</span>
      <span class="panel-code">SIMULATION / 02</span>
    </div>

    <section class="control-section">
      <div class="section-title">参数预设</div>
      <div class="preset-grid">
        <button v-for="preset in PRESETS" :key="preset.name" :class="{ active: activePreset === preset.name }" @click="applyPreset(preset)">{{ preset.name }}</button>
      </div>
    </section>

    <section class="control-section">
      <div class="section-title">数值仿真参数 <span>LIVE</span></div>
      <label class="range-row">
        <span class="param-label">水平扩散<InfoTip title="水平扩散" text="赤潮藻细胞在水平方向的湍流扩散系数。值越大斑块越易向四周铺开、边缘越模糊；过大则浓度峰值偏低、核心不集中。" /></span>
        <input v-model.number="store.diffusion" type="range" min="0.002" max="0.05" step="0.001" />
      </label>
      <label class="range-row">
        <span class="param-label">生长速率<InfoTip title="生长速率" text="藻类单位时间的比生长速率，决定种群指数增长的快慢，是赤潮爆发的核心驱动。值越大越早进入高浓度。" /></span>
        <input v-model.number="store.growthRate" type="range" min="0" max="0.00004" step="0.000001" />
      </label>
      <label class="range-row">
        <span class="param-label">衰减速率<InfoTip title="衰减速率" text="由死亡、沉降、摄食等造成的损失速率，与生长速率共同决定最终平衡浓度。值越大越难维持高值。" /></span>
        <input v-model.number="store.decayRate" type="range" min="0" max="0.00002" step="0.000001" />
      </label>
      <label class="range-row">
        <span class="param-label">营养盐<InfoTip title="营养盐" text="氮磷等营养盐的可用水平（0–1 归一化），作为生长限制因子参与生长项。值越高越利于爆发。" /></span>
        <input v-model.number="store.nutrient" type="range" min="0" max="1" step="0.01" />
      </label>
      <label class="range-row">
        <span class="param-label">光照<InfoTip title="光照" text="海面光照强度（0–1 归一化），经垂向衰减后限制光合作用。值越低生长越受抑制。" /></span>
        <input v-model.number="store.light" type="range" min="0" max="1" step="0.01" />
      </label>
      <label class="range-row">
        <span class="param-label">水温 °C<InfoTip title="水温" text="水体温度，影响藻类代谢与生长速率，存在最适温区。温度偏高常触发爆发。" /></span>
        <input v-model.number="store.temperature" type="range" min="10" max="32" step="0.1" />
      </label>
    </section>

    <section class="control-section">
      <div class="section-title">推演状态 <span>{{ displayHours.toFixed(1) }} h</span></div>
      <div class="metric-grid">
        <div><span>最大浓度</span><strong>{{ (store.stats.max * 100).toFixed(1) }}</strong></div>
        <div><span>影响面积</span><strong>{{ store.stats.affectedAreaKm2.toFixed(1) }} km²</strong></div>
      </div>
      <div class="compute-status">
        <span>计算线程</span>
        <strong>{{ computeMode }}</strong>
        <em>{{ store.simulationComputeMs.toFixed(1) }} ms / step · 渲染 {{ store.renderGpuMs.toFixed(1) }} ms</em>
      </div>
    </section>
  </section>
</template>
