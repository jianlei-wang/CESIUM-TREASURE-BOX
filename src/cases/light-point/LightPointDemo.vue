<script setup lang="ts">
import InfoTip from '../../components/InfoTip.vue'
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useLocalLightDemo } from '../../lib/lighting-demo'
import '../../lib/lighting-panel.css'

const { base, ui, showGizmo, apply, mount, teardown } = useLocalLightDemo('point')

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
      <div class="lgt-title">局部光源 · 点光源</div>

      <div class="lgt-section">光源位置<InfoTip title="光源位置" text="点光源在地图上的经度、纬度与离地高度，位置变化会带动光斑与局部高光一起移动。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">经度<InfoTip title="经度" text="点光源在地图上的经度位置，拖动时光源点与局部光斑一起移动。" /></span>
        <input v-model.number="ui.lon" class="lgt-range" type="range" min="4.6" max="5.2" step="0.001" />
        <span class="lgt-value">{{ ui.lon.toFixed(3) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">纬度<InfoTip title="纬度" text="点光源在地图上的纬度位置。" /></span>
        <input v-model.number="ui.lat" class="lgt-range" type="range" min="52.2" max="52.6" step="0.001" />
        <span class="lgt-value">{{ ui.lat.toFixed(3) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">高度<InfoTip title="高度" text="光源离地高度。降低会缩小光斑、增强近处亮度；抬高则光斑变大、衰减更平缓。" /></span>
        <input v-model.number="ui.height" class="lgt-range" type="range" min="60" max="900" step="10" />
        <span class="lgt-value">{{ ui.height }}m</span>
      </div>

      <div class="lgt-section">点光源参数<InfoTip title="点光源参数" text="点光源按距离衰减的漫反射与 Blinn-Phong 高光参数，直接决定光斑的亮度、范围与锐度。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">颜色<InfoTip title="颜色" text="点光源颜色，直接乘到漫反射与高光贡献上。" /></span>
        <input v-model="ui.colorHex" class="lgt-color" type="color" />
        <span class="lgt-value">{{ ui.colorHex }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">强度<InfoTip title="强度" text="点光源强度（intensity）。0 等于关闭该光源，数值越大受照区域越亮。" /></span>
        <input v-model.number="ui.intensity" class="lgt-range" type="range" min="0" max="10" step="0.1" />
        <span class="lgt-value">{{ ui.intensity.toFixed(1) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">影响范围<InfoTip title="影响范围" text="光照的最大作用距离。距离片元超过该半径即被剔除，不做光照计算，用于限制性能开销。" /></span>
        <input v-model.number="ui.range" class="lgt-range" type="range" min="200" max="4000" step="50" />
        <span class="lgt-value">{{ ui.range }}m</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">衰减指数<InfoTip title="衰减指数" text="距离衰减曲线指数，atten = pow(1 - d/range, decay)。指数越大衰减越快、光斑越集中，越小越平缓。" /></span>
        <input v-model.number="ui.decay" class="lgt-range" type="range" min="0.5" max="4" step="0.1" />
        <span class="lgt-value">{{ ui.decay.toFixed(1) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">高光强度<InfoTip title="高光强度" text="镜面反射（高光）系数。0 无高光，数值越大反射越亮；仅对法线朝向合适的面可见。" /></span>
        <input v-model.number="ui.specular" class="lgt-range" type="range" min="0" max="2" step="0.05" />
        <span class="lgt-value">{{ ui.specular.toFixed(2) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">高光指数<InfoTip title="高光指数" text="高光锐度 shininess：值越大高光越集中、越像金属；越小越漫射。" /></span>
        <select v-model.number="ui.shininess" class="lgt-select">
          <option :value="8">8</option>
          <option :value="16">16</option>
          <option :value="32">32</option>
          <option :value="64">64</option>
          <option :value="128">128</option>
        </select>
      </div>

      <div class="lgt-section">半球环境光<InfoTip title="半球环境光" text="点光源之外的半球环境项，为背光面提供基础照明，避免暗部纯黑。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">天空色<InfoTip title="天空色" text="半球光中来自上半球（天空方向）的环境色，通常偏冷。" /></span>
        <input v-model="ui.hemiSkyHex" class="lgt-color" type="color" />
        <span class="lgt-value">{{ ui.hemiSkyHex }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">地面色<InfoTip title="地面色" text="半球光中来自下半球（地面反射）的环境色，通常偏暖、偏暗。" /></span>
        <input v-model="ui.hemiGroundHex" class="lgt-color" type="color" />
        <span class="lgt-value">{{ ui.hemiGroundHex }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">环境强度<InfoTip title="环境强度" text="半球环境光强度，为背光面提供基础照明，避免背光处纯黑。" /></span>
        <input v-model.number="ui.hemiIntensity" class="lgt-range" type="range" min="0" max="1.5" step="0.05" />
        <span class="lgt-value">{{ ui.hemiIntensity.toFixed(2) }}</span>
      </div>

      <div class="lgt-row">
        <span class="lgt-label">显示光源标记<InfoTip title="显示光源标记" text="是否在地图上显示光源位置的圆点标记，便于对照光源位置与光斑移动。" /></span>
        <button class="lgt-toggle" :class="{ on: showGizmo }" @click="showGizmo = !showGizmo"><i></i></button>
      </div>
      <p class="lgt-hint">点光源在 CustomShader 片元阶段累加，距离超过影响范围即剔除；衰减采用 pow(clamp(1-d/range), decay) 平滑窗口。</p>
    </div>

    <div v-if="base.statusMessage.value" class="lgt-status">{{ base.statusMessage.value }}</div>
  </div>
</template>
