<script setup lang="ts">
import { computed } from 'vue'
import { useRedTideStore } from '@rt/stores/red-tide'

const store = useRedTideStore()
const thresholdText = computed(() => `${Math.round(store.thresholdLow * 100)}% / ${Math.round(store.thresholdHigh * 100)}%`)
</script>

<template>
  <section class="layer-panel panel-card">
    <div class="panel-header">
      <span>图层面板</span>
      <span class="panel-code">LAYERS / 06</span>
    </div>

    <div class="layer-row">
      <span class="layer-swatch swatch-volume"></span>
      <span class="layer-name">三维赤潮体</span>
      <input v-model="store.showVolume" type="checkbox" aria-label="三维赤潮体" />
    </div>
    <label class="layer-sub">
      <span>体密度</span>
      <input v-model.number="store.density" type="range" min="0.4" max="2.5" step="0.05" />
    </label>
    <label class="layer-sub">
      <span>纵向夸张 ×{{ store.verticalExaggeration.toFixed(1) }}</span>
      <input v-model.number="store.verticalExaggeration" type="range" min="0" max="20" step="0.1" />
    </label>

    <div class="layer-row">
      <span class="layer-swatch swatch-surface"></span>
      <span class="layer-name">表层浓度场</span>
      <input v-model="store.showSurface" type="checkbox" aria-label="表层浓度场" />
    </div>
    <label class="layer-sub">
      <span>表层透明度</span>
      <input v-model.number="store.surfaceOpacity" type="range" min="0" max="0.9" step="0.02" />
    </label>

    <div class="layer-row">
      <span class="layer-swatch swatch-flow"></span>
      <span class="layer-name">海流粒子</span>
      <input v-model="store.showFlow" type="checkbox" aria-label="海流粒子" />
    </div>
    <label class="layer-sub">
      <span>粒子不透明度</span>
      <input v-model.number="store.flowOpacity" type="range" min="0" max="1" step="0.02" />
    </label>
    <div class="layer-sub stacked">
      <span>粒子样式</span>
      <div class="particle-style-grid">
        <button :class="{ active: store.particleStyle === 'star' }" @click="store.particleStyle = 'star'">✦ 星点</button>
        <button :class="{ active: store.particleStyle === 'arrow' }" @click="store.particleStyle = 'arrow'">➤ 箭头</button>
        <button :class="{ active: store.particleStyle === 'diamond' }" @click="store.particleStyle = 'diamond'">◇ 菱形</button>
        <button :class="{ active: store.particleStyle === 'ring' }" @click="store.particleStyle = 'ring'">◌ 环形</button>
      </div>
    </div>

    <div class="layer-row">
      <span class="layer-swatch swatch-section"></span>
      <span class="layer-name">垂向分析剖面</span>
      <input v-model="store.showSection" type="checkbox" aria-label="垂向分析剖面" />
    </div>

    <div class="layer-row">
      <span class="layer-swatch swatch-clip"></span>
      <span class="layer-name">水体垂向剖切</span>
      <input v-model="store.clipEnabled" type="checkbox" aria-label="水体垂向剖切" />
    </div>
    <label class="layer-sub">
      <span>剖切深度</span>
      <input v-model.number="store.clipDepth" type="range" min="0" max="1800" step="25" />
    </label>

    <div class="layer-row static">
      <span class="layer-swatch swatch-globe"></span>
      <span class="layer-name">地表底图</span>
      <span class="layer-tag">{{ Math.round(store.globeOpacity * 100) }}%</span>
    </div>
    <label class="layer-sub">
      <span>地表透明度</span>
      <input v-model.number="store.globeOpacity" type="range" min="0" max="1" step="0.02" />
    </label>

    <div class="layer-row static">
      <span class="layer-swatch swatch-station"></span>
      <span class="layer-name">监测浮标</span>
      <span class="layer-tag">常显</span>
    </div>

    <div class="layer-foot">
      <span>显示阈值</span>
      <strong>{{ thresholdText }}</strong>
    </div>
  </section>
</template>
