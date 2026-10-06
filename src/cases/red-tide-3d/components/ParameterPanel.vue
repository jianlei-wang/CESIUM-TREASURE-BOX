<script setup lang="ts">
import { computed } from 'vue'
import { useRedTideStore } from '@rt/stores/red-tide'
import InfoTip from '../../../components/InfoTip.vue'

const store = useRedTideStore()
const thresholdText = computed(() => `${Math.round(store.thresholdLow * 100)}% / ${Math.round(store.thresholdHigh * 100)}%`)
const sectionHalf = computed(() => (store.sectionAxis === 'y' ? store.grid.sizeY : store.grid.sizeX) / 2)
</script>

<template>
  <section class="parameter-panel panel-card">
    <div class="panel-header">
      <span>模型参数</span>
      <span class="panel-code">PARAMETERS / 03</span>
    </div>

    <section class="control-section">
      <div class="section-title">
        <span class="section-heading">体渲染阈值<InfoTip title="体渲染阈值" text="控制体数据中哪些浓度区间被绘制为可见体块，以及颜色如何随浓度递进，直接决定赤潮体的显露范围。" /></span>
        <span>{{ thresholdText }}</span>
      </div>
      <label class="range-row">
        <span class="param-label">显示阈值<InfoTip title="显示阈值" text="体块显现的最低浓度门限，低于该值的体素保持透明。调高可只保留核心高浓度区。" /></span>
        <input v-model.number="store.thresholdLow" type="range" min="0.01" max="0.35" step="0.01" />
      </label>
      <label class="range-row">
        <span class="param-label">高值阈值<InfoTip title="高值阈值" text="传递函数映射到最高浓度色（深红）的浓度值，与显示阈值共同拉伸色阶对比。" /></span>
        <input v-model.number="store.thresholdHigh" type="range" min="0.2" max="0.95" step="0.01" />
      </label>
      <div class="particle-note">按粒子局地指标分 5 级阶梯赋色，阈值决定体块显露范围。</div>
    </section>

    <section class="control-section">
      <div class="section-title">科研表达 <span>{{ store.renderMode.toUpperCase() }}</span></div>
      <div class="mode-buttons">
        <button :class="{ active: store.renderMode === 'volume' }" @click="store.renderMode = 'volume'">体积分布</button>
        <button :class="{ active: store.renderMode === 'hybrid' }" @click="store.renderMode = 'hybrid'">体 + 等值面</button>
        <button :class="{ active: store.renderMode === 'iso' }" @click="store.renderMode = 'iso'">等值面</button>
      </div>
      <label class="range-row">
        <span>等值面阈值</span>
        <input v-model.number="store.isoValue" type="range" min="0.15" max="0.95" step="0.01" />
      </label>
      <label class="range-row">
        <span>等值面厚度</span>
        <input v-model.number="store.isoThickness" type="range" min="0.005" max="0.08" step="0.001" />
      </label>
    </section>

    <section class="control-section compact">
      <div class="section-title">垂向分析剖面</div>
      <div class="axis-buttons">
        <button :class="{ active: store.sectionAxis === 'x' }" @click="store.sectionAxis = 'x'">X 截面（纵向）</button>
        <button :class="{ active: store.sectionAxis === 'y' }" @click="store.sectionAxis = 'y'">Y 截面（横向）</button>
      </div>
      <label class="range-row">
        <span>剖面位置 {{ store.sectionAxis === 'y' ? 'Y' : 'X' }}</span>
        <input v-model.number="store.sectionX" type="range" :min="-sectionHalf" :max="sectionHalf" step="1000" />
      </label>
      <div class="particle-note">剖面显隐与剖切深度请在图层面板中控制。</div>
    </section>
  </section>
</template>
