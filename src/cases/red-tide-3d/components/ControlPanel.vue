<script setup lang="ts">
import { computed } from 'vue'
import { useRedTideStore } from '@rt/stores/red-tide'

const store = useRedTideStore()
const thresholdText = computed(() => `${Math.round(store.thresholdLow * 100)}% / ${Math.round(store.thresholdHigh * 100)}%`)
const displayHours = computed(() => store.elapsedSeconds / 3600)
</script>

<template>
  <aside class="control-panel glass-panel">
    <div class="panel-header">
      <span>仿真控制</span>
      <span class="panel-code">MODEL / 01</span>
    </div>

    <section class="control-section">
      <div class="section-title">可视化图层</div>
      <label class="switch-row"><span>三维赤潮体</span><input v-model="store.showVolume" type="checkbox" /></label>
      <label class="switch-row"><span>表层浓度场</span><input v-model="store.showSurface" type="checkbox" /></label>
      <label class="switch-row"><span>海流粒子</span><input v-model="store.showFlow" type="checkbox" /></label>
      <label class="range-row">
        <span>地表透明度</span>
        <input v-model.number="store.globeOpacity" type="range" min="0" max="1" step="0.02" />
      </label>
    </section>

    <section class="control-section">
      <div class="section-title">体渲染参数 <span>{{ thresholdText }}</span></div>
      <label class="range-row">
        <span>显示阈值</span>
        <input v-model.number="store.thresholdLow" type="range" min="0.01" max="0.35" step="0.01" />
      </label>
      <label class="range-row">
        <span>高值阈值</span>
        <input v-model.number="store.thresholdHigh" type="range" min="0.2" max="0.95" step="0.01" />
      </label>
      <label class="range-row">
        <span>体密度</span>
        <input v-model.number="store.density" type="range" min="0.4" max="2.5" step="0.05" />
      </label>
      <label class="range-row">
        <span>表层透明度</span>
        <input v-model.number="store.surfaceOpacity" type="range" min="0" max="0.9" step="0.02" />
      </label>
      <label class="range-row">
        <span>流场粒子</span>
        <input v-model.number="store.flowOpacity" type="range" min="0" max="1" step="0.02" />
      </label>
      <div class="particle-style-grid">
        <button :class="{ active: store.particleStyle === 'star' }" @click="store.particleStyle = 'star'">✦ 星点</button>
        <button :class="{ active: store.particleStyle === 'arrow' }" @click="store.particleStyle = 'arrow'">➤ 箭头</button>
        <button :class="{ active: store.particleStyle === 'diamond' }" @click="store.particleStyle = 'diamond'">◇ 菱形</button>
        <button :class="{ active: store.particleStyle === 'ring' }" @click="store.particleStyle = 'ring'">◌ 环形</button>
      </div>
      <div class="particle-note">按粒子局地指标分 5 级阶梯赋色</div>
    </section>

    <section class="control-section">
      <div class="section-title">数值仿真参数 <span>LIVE</span></div>
      <label class="range-row">
        <span>水平扩散</span>
        <input v-model.number="store.diffusion" type="range" min="0.002" max="0.05" step="0.001" />
      </label>
      <label class="range-row">
        <span>生长速率</span>
        <input v-model.number="store.growthRate" type="range" min="0" max="0.00004" step="0.000001" />
      </label>
      <label class="range-row">
        <span>衰减速率</span>
        <input v-model.number="store.decayRate" type="range" min="0" max="0.00002" step="0.000001" />
      </label>
      <label class="range-row">
        <span>营养盐</span>
        <input v-model.number="store.nutrient" type="range" min="0" max="1" step="0.01" />
      </label>
      <label class="range-row">
        <span>光照</span>
        <input v-model.number="store.light" type="range" min="0" max="1" step="0.01" />
      </label>
      <label class="range-row">
        <span>水温 °C</span>
        <input v-model.number="store.temperature" type="range" min="10" max="32" step="0.1" />
      </label>
    </section>


    <section class="control-section">
      <div class="section-title">科研表达 <span>{{ store.renderMode.toUpperCase() }}</span></div>
      <label class="range-row">
        <span>等值面阈值</span>
        <input v-model.number="store.isoValue" type="range" min="0.15" max="0.95" step="0.01" />
      </label>
      <label class="range-row">
        <span>等值面厚度</span>
        <input v-model.number="store.isoThickness" type="range" min="0.005" max="0.08" step="0.001" />
      </label>
      <div class="mode-buttons">
        <button :class="{ active: store.renderMode === 'volume' }" @click="store.renderMode = 'volume'">体积分布</button>
        <button :class="{ active: store.renderMode === 'hybrid' }" @click="store.renderMode = 'hybrid'">体 + 等值面</button>
        <button :class="{ active: store.renderMode === 'iso' }" @click="store.renderMode = 'iso'">等值面</button>
      </div>
      <label class="switch-row"><span>水体垂向剖切</span><input v-model="store.clipEnabled" type="checkbox" /></label>
      <label class="range-row">
        <span>剖切深度</span>
        <input v-model.number="store.clipDepth" type="range" min="0" max="1800" step="25" />
      </label>
      <label class="switch-row"><span>垂向分析剖面</span><input v-model="store.showSection" type="checkbox" /></label>
      <div class="axis-buttons">
        <button :class="{ active: store.sectionAxis === 'x' }" @click="store.sectionAxis = 'x'">X 截面（纵向）</button>
        <button :class="{ active: store.sectionAxis === 'y' }" @click="store.sectionAxis = 'y'">Y 截面（横向）</button>
      </div>
      <label class="range-row">
        <span>剖面位置 X</span>
        <input v-model.number="store.sectionX" type="range" min="-60000" max="60000" step="1000" />
      </label>
    </section>

    <section class="control-section compact">
      <div class="section-title">仿真状态</div>
      <div class="metric-grid">
        <div><span>时间</span><strong>{{ displayHours.toFixed(1) }} h</strong></div>
        <div><span>最大值</span><strong>{{ (store.stats.max * 100).toFixed(1) }}</strong></div>
        <div><span>平均值</span><strong>{{ (store.stats.mean * 100).toFixed(1) }}</strong></div>
        <div><span>影响面积</span><strong>{{ store.stats.affectedAreaKm2.toFixed(1) }} km²</strong></div>
      </div>
      <div class="compute-status">
        <span>计算线程</span>
        <strong>{{ store.simulationComputeMode === 'gpu-gpgpu' ? 'GPU GPGPU' : (store.simulationComputeMode === 'shared-array-buffer' ? 'Worker + SAB' : 'Worker + Transfer') }}</strong>
        <em>{{ store.simulationComputeMs.toFixed(1) }} ms / step · 渲染 {{ store.renderGpuMs.toFixed(1) }} ms</em>
      </div>
    </section>
  </aside>
</template>

