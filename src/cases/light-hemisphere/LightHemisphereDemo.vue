<script setup lang="ts">
import InfoTip from '../../components/InfoTip.vue'
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useLocalLightDemo } from '../../lib/lighting-demo'
import '../../lib/lighting-panel.css'

const { base, ui, apply, mount, teardown } = useLocalLightDemo('point')

ui.intensity = 0
ui.ambient = 0.05
ui.hemiIntensity = 0.9

watch(ui, apply, { deep: true })

onMounted(async () => {
  await mount()
})

onBeforeUnmount(() => {
  teardown()
})
</script>

<template>
  <div class="lgt-shell">
    <div :ref="base.container" class="lgt-canvas"></div>

    <div class="lgt-panel">
      <div class="lgt-title">环境光 · 半球光</div>

      <div class="lgt-section">半球光参数<InfoTip title="半球光参数" text="半球光按片元法线朝向在天空色与地面色之间插值，模拟上方天光与下方地面反射的环境照明。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">天空色<InfoTip title="天空色" text="半球光中来自上半球（天空方向）的环境色，模拟天光散射，通常偏冷。" /></span>
        <input v-model="ui.hemiSkyHex" class="lgt-color" type="color" />
        <span class="lgt-value">{{ ui.hemiSkyHex }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">地面色<InfoTip title="地面色" text="半球光中来自下半球（地面反射）的环境色，通常偏暖、偏暗。" /></span>
        <input v-model="ui.hemiGroundHex" class="lgt-color" type="color" />
        <span class="lgt-value">{{ ui.hemiGroundHex }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">强度<InfoTip title="强度" text="半球环境光强度。按法线朝向在天空色与地面色之间插值后叠加，是背光面的主要照明来源。" /></span>
        <input v-model.number="ui.hemiIntensity" class="lgt-range" type="range" min="0" max="2" step="0.05" />
        <span class="lgt-value">{{ ui.hemiIntensity.toFixed(2) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">基础环境<InfoTip title="基础环境" text="与方向无关的常量环境项（ambient），用于抬高整体底噪亮度，避免暗部纯黑。" /></span>
        <input v-model.number="ui.ambient" class="lgt-range" type="range" min="0" max="0.5" step="0.01" />
        <span class="lgt-value">{{ ui.ambient.toFixed(2) }}</span>
      </div>

      <div class="lgt-btn-row">
        <button class="lgt-btn ghost" @click="ui.hemiSkyHex = '#8fb0e8'; ui.hemiGroundHex = '#2a2118'; ui.hemiIntensity = 0.9">晴空</button>
        <button class="lgt-btn ghost" @click="ui.hemiSkyHex = '#ffb27a'; ui.hemiGroundHex = '#3a2418'; ui.hemiIntensity = 1.1">暮色</button>
        <button class="lgt-btn ghost" @click="ui.hemiSkyHex = '#4fb0ff'; ui.hemiGroundHex = '#0c1a26'; ui.hemiIntensity = 0.5">阴天</button>
      </div>
      <p class="lgt-hint">Cesium 世界坐标为 ECEF，当地向上方向近似取片元世界坐标的归一化向量，法线需从眼坐标经 czm_inverseViewRotation 变换到世界坐标后再计算夹角。</p>
    </div>

    <div v-if="base.statusMessage.value" class="lgt-status">{{ base.statusMessage.value }}</div>
  </div>
</template>
