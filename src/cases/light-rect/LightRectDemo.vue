<script setup lang="ts">
import InfoTip from '../../components/InfoTip.vue'
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useLocalLightDemo } from '../../lib/lighting-demo'
import '../../lib/lighting-panel.css'

const { base, ui, showGizmo, apply, mount, teardown } = useLocalLightDemo('rect')

watch(showGizmo, apply)
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
      <div class="lgt-title">局部光源 · 矩形面光源</div>

      <div class="lgt-section">光源位置<InfoTip title="光源位置" text="矩形面光源中心在地图上的经纬度与离地高度。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">经度<InfoTip title="经度" text="面光源中心在地图上的经度位置。" /></span>
        <input v-model.number="ui.lon" class="lgt-range" type="range" min="4.6" max="5.2" step="0.001" />
        <span class="lgt-value">{{ ui.lon.toFixed(3) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">纬度<InfoTip title="纬度" text="面光源中心在地图上的纬度位置。" /></span>
        <input v-model.number="ui.lat" class="lgt-range" type="range" min="52.2" max="52.6" step="0.001" />
        <span class="lgt-value">{{ ui.lat.toFixed(3) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">高度<InfoTip title="高度" text="面光源中心离地高度。降低会增强近处照度并缩小覆盖范围。" /></span>
        <input v-model.number="ui.height" class="lgt-range" type="range" min="60" max="900" step="10" />
        <span class="lgt-value">{{ ui.height }}m</span>
      </div>

      <div class="lgt-section">矩形朝向与尺寸<InfoTip title="矩形朝向与尺寸" text="矩形面的法线朝向与物理尺寸，决定照射方向、覆盖区域与边缘柔度。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">方位角<InfoTip title="方位角" text="矩形面法线的水平朝向（本地 ENU 方位），改变后照明方向与投影区域随之变化。" /></span>
        <input v-model.number="ui.azimuth" class="lgt-range" type="range" min="0" max="360" step="1" />
        <span class="lgt-value">{{ ui.azimuth.toFixed(0) }}°</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">高度角<InfoTip title="高度角" text="矩形面法线的高度角，决定矩形面朝下的倾斜程度；-90° 为垂直向下照射。" /></span>
        <input v-model.number="ui.elevation" class="lgt-range" type="range" min="-90" max="-5" step="1" />
        <span class="lgt-value">{{ ui.elevation.toFixed(0) }}°</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">宽度<InfoTip title="宽度" text="矩形面光源的物理宽度（米）。面积越大照射范围与亮度越高，边缘也更柔和。" /></span>
        <input v-model.number="ui.rectWidth" class="lgt-range" type="range" min="20" max="800" step="10" />
        <span class="lgt-value">{{ ui.rectWidth }}m</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">高度<InfoTip title="矩形高度" text="矩形面光源的物理高度（米），影响垂直方向的照射范围。" /></span>
        <input v-model.number="ui.rectHeight" class="lgt-range" type="range" min="20" max="800" step="10" />
        <span class="lgt-value">{{ ui.rectHeight }}m</span>
      </div>

      <div class="lgt-section">面光源参数<InfoTip title="面光源参数" text="面光源按解析立体角积分做纯漫反射计算，强度随距离平方自然衰减。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">颜色<InfoTip title="颜色" text="面光源颜色，乘到矩形对片元张开的立体角积分上。" /></span>
        <input v-model="ui.colorHex" class="lgt-color" type="color" />
        <span class="lgt-value">{{ ui.colorHex }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">强度<InfoTip title="强度" text="面光源强度系数。面光源按解析立体角积分纯漫反射计算，强度随距离平方自然衰减。" /></span>
        <input v-model.number="ui.intensity" class="lgt-range" type="range" min="0" max="12" step="0.1" />
        <span class="lgt-value">{{ ui.intensity.toFixed(1) }}</span>
      </div>

      <div class="lgt-section">半球环境光<InfoTip title="半球环境光" text="面光源之外的半球环境项，为背光面提供基础照明。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">天空色<InfoTip title="天空色" text="半球光中来自上半球的环境色，模拟天光，通常偏冷。" /></span>
        <input v-model="ui.hemiSkyHex" class="lgt-color" type="color" />
        <span class="lgt-value">{{ ui.hemiSkyHex }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">地面色<InfoTip title="地面色" text="半球光中来自下半球（地面反射）的环境色，通常偏暖、偏暗。" /></span>
        <input v-model="ui.hemiGroundHex" class="lgt-color" type="color" />
        <span class="lgt-value">{{ ui.hemiGroundHex }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">环境强度<InfoTip title="环境强度" text="半球环境光强度，为背光面提供基础照明。" /></span>
        <input v-model.number="ui.hemiIntensity" class="lgt-range" type="range" min="0" max="1.5" step="0.05" />
        <span class="lgt-value">{{ ui.hemiIntensity.toFixed(2) }}</span>
      </div>

      <div class="lgt-row">
        <span class="lgt-label">显示光源标记<InfoTip title="显示光源标记" text="是否在地图上显示面光源中心位置的圆点标记。" /></span>
        <button class="lgt-toggle" :class="{ on: showGizmo }" @click="showGizmo = !showGizmo"><i></i></button>
      </div>
      <p class="lgt-hint">面光源计算含 4 次 acos，开销较大，系统默认同时活跃面光源不超过 2 个；本案例简化为纯漫反射面光源。</p>
    </div>

    <div v-if="base.statusMessage.value" class="lgt-status">{{ base.statusMessage.value }}</div>
  </div>
</template>
