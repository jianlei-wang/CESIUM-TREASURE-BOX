<script setup lang="ts">
import InfoTip from '../../components/InfoTip.vue'
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useLocalLightDemo } from '../../lib/lighting-demo'
import '../../lib/lighting-panel.css'

const { base, ui, showGizmo, apply, mount, teardown } = useLocalLightDemo('spot')

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
      <div class="lgt-title">局部光源 · 聚光灯</div>

      <div class="lgt-section">光源位置<InfoTip title="光源位置" text="聚光灯在地图上的经纬度与离地高度。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">经度<InfoTip title="经度" text="聚光灯在地图上的经度位置。" /></span>
        <input v-model.number="ui.lon" class="lgt-range" type="range" min="4.6" max="5.2" step="0.001" />
        <span class="lgt-value">{{ ui.lon.toFixed(3) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">纬度<InfoTip title="纬度" text="聚光灯在地图上的纬度位置。" /></span>
        <input v-model.number="ui.lat" class="lgt-range" type="range" min="52.2" max="52.6" step="0.001" />
        <span class="lgt-value">{{ ui.lat.toFixed(3) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">高度<InfoTip title="高度" text="聚光灯离地高度，影响光斑大小与照度。" /></span>
        <input v-model.number="ui.height" class="lgt-range" type="range" min="60" max="900" step="10" />
        <span class="lgt-value">{{ ui.height }}m</span>
      </div>

      <div class="lgt-section">照射方向<InfoTip title="照射方向" text="聚光灯的照射方位与锥角，锥内为完整亮度、锥外衰减到零。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">方位角<InfoTip title="方位角" text="聚光灯照射方向在本地 ENU 中的水平方位。" /></span>
        <input v-model.number="ui.azimuth" class="lgt-range" type="range" min="0" max="360" step="1" />
        <span class="lgt-value">{{ ui.azimuth.toFixed(0) }}°</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">高度角<InfoTip title="高度角" text="聚光灯照射方向的仰角，范围限制在 -90°~-5°（朝下照射）。" /></span>
        <input v-model.number="ui.elevation" class="lgt-range" type="range" min="-90" max="-5" step="1" />
        <span class="lgt-value">{{ ui.elevation.toFixed(0) }}°</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">内锥角<InfoTip title="内锥角" text="光强不衰减的内锥半角。锥内为完整亮度，需小于外锥角。" /></span>
        <input v-model.number="ui.innerDeg" class="lgt-range" type="range" min="2" max="60" step="1" />
        <span class="lgt-value">{{ ui.innerDeg }}°</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">外锥角<InfoTip title="外锥角" text="光照衰减到 0 的外锥半角。内外锥之间用 smoothstep 平滑过渡，形成柔和光斑边缘。" /></span>
        <input v-model.number="ui.outerDeg" class="lgt-range" type="range" min="4" max="80" step="1" />
        <span class="lgt-value">{{ ui.outerDeg }}°</span>
      </div>

      <div class="lgt-section">聚光参数<InfoTip title="聚光参数" text="聚光灯的亮度、作用距离、衰减曲线与高光参数。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">颜色<InfoTip title="颜色" text="聚光灯颜色。" /></span>
        <input v-model="ui.colorHex" class="lgt-color" type="color" />
        <span class="lgt-value">{{ ui.colorHex }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">强度<InfoTip title="强度" text="聚光灯强度，0 等于关闭光源。" /></span>
        <input v-model.number="ui.intensity" class="lgt-range" type="range" min="0" max="14" step="0.1" />
        <span class="lgt-value">{{ ui.intensity.toFixed(1) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">影响范围<InfoTip title="影响范围" text="光照最大作用距离，超出即剔除该片元的光照计算。" /></span>
        <input v-model.number="ui.range" class="lgt-range" type="range" min="200" max="4000" step="50" />
        <span class="lgt-value">{{ ui.range }}m</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">衰减指数<InfoTip title="衰减指数" text="距离衰减指数 pow(1 - d/range, decay)，越大光斑越集中。" /></span>
        <input v-model.number="ui.decay" class="lgt-range" type="range" min="0.5" max="4" step="0.1" />
        <span class="lgt-value">{{ ui.decay.toFixed(1) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">高光强度<InfoTip title="高光强度" text="镜面高光系数，0 无高光，越大反射越亮。" /></span>
        <input v-model.number="ui.specular" class="lgt-range" type="range" min="0" max="2" step="0.05" />
        <span class="lgt-value">{{ ui.specular.toFixed(2) }}</span>
      </div>

      <div class="lgt-section">半球环境光<InfoTip title="半球环境光" text="聚光灯之外的半球环境项，为背光面提供基础照明。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">天空色<InfoTip title="天空色" text="半球光中来自上半球的环境色。" /></span>
        <input v-model="ui.hemiSkyHex" class="lgt-color" type="color" />
        <span class="lgt-value">{{ ui.hemiSkyHex }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">地面色<InfoTip title="地面色" text="半球光中来自下半球的环境色。" /></span>
        <input v-model="ui.hemiGroundHex" class="lgt-color" type="color" />
        <span class="lgt-value">{{ ui.hemiGroundHex }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">环境强度<InfoTip title="环境强度" text="半球环境光强度，为背光面提供基础照明。" /></span>
        <input v-model.number="ui.hemiIntensity" class="lgt-range" type="range" min="0" max="1.5" step="0.05" />
        <span class="lgt-value">{{ ui.hemiIntensity.toFixed(2) }}</span>
      </div>

      <div class="lgt-row">
        <span class="lgt-label">显示光源标记<InfoTip title="显示光源标记" text="是否显示光源位置标记。" /></span>
        <button class="lgt-toggle" :class="{ on: showGizmo }" @click="showGizmo = !showGizmo"><i></i></button>
      </div>
      <p class="lgt-hint">锥形衰减使用 smoothstep(cos(外锥), cos(内锥), cosθ) 在内外锥之间平滑过渡，内锥角须小于外锥角。</p>
    </div>

    <div v-if="base.statusMessage.value" class="lgt-status">{{ base.statusMessage.value }}</div>
  </div>
</template>
