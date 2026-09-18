<script setup lang="ts">
import InfoTip from '../../components/InfoTip.vue'
import { onBeforeUnmount, onMounted, reactive } from 'vue'
import {
  Cartesian3,
  Color,
  DirectionalLight,
  type Viewer
} from 'cesium'
import { useWhiteModelTileset } from '../../lib/use-white-model-tileset'
import { applyHdr } from '../../lib/lighting'
import '../../lib/lighting-panel.css'

const base = useWhiteModelTileset()

const TONEMAPPER_OPTIONS = [
  { value: 'PBR_NEUTRAL', label: 'PBR Neutral（默认）' },
  { value: 'ACES', label: 'ACES Filmic' },
  { value: 'FILMIC', label: 'Filmic' },
  { value: 'REINHARD', label: 'Reinhard' },
  { value: 'MODIFIED_REINHARD', label: 'Modified Reinhard' }
]

const ui = reactive({
  hdr: true,
  tonemapper: 'PBR_NEUTRAL',
  intensity: 3.5
})

function apply(): void {
  const viewer = base.viewer.value
  if (!viewer || viewer.isDestroyed()) return
  const scene = viewer.scene
  scene.light = new DirectionalLight({
    direction: Cartesian3.normalize(new Cartesian3(-0.55, -0.5, 0.8), new Cartesian3()),
    color: new Color(1, 0.96, 0.9, 1),
    intensity: ui.intensity
  })
  applyHdr(scene, ui.hdr, ui.tonemapper)
  scene.globe.enableLighting = true
  viewer.scene.requestRender()
}

function onTilesetReady(viewer: Viewer): void {
  viewer.scene.globe.enableLighting = true
  apply()
}

onMounted(async () => {
  await base.mount(onTilesetReady)
})

onBeforeUnmount(() => {
  base.teardown()
})
</script>

<template>
  <div class="lgt-shell">
    <div :ref="base.container" class="lgt-canvas"></div>

    <div class="lgt-panel">
      <div class="lgt-title">光照效果 · HDR 色调映射</div>

      <div class="lgt-row">
        <span class="lgt-label">HDR 开关<InfoTip title="HDR 开关" text="高动态范围渲染开关（scene.highDynamicRange）。关闭时色调映射器不参与运算。" /></span>
        <button class="lgt-toggle" :class="{ on: ui.hdr }" @click="ui.hdr = !ui.hdr; apply()"><i></i></button>
      </div>

      <div class="lgt-section">色调映射器<InfoTip title="色调映射器" text="把 HDR 亮度压缩到显示范围所用的映射曲线（scene.postProcessStages.tonemapper），不同曲线的高光滚降与暗部冷暖和反差不同。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">映射曲线<InfoTip title="映射曲线" text="可选 ACES / PBR Neutral / 无映射等曲线：ACES 对比强、高光滚降明显；PBR Neutral 保持中性色相，适合还原真实材质。" /></span>
        <select v-model="ui.tonemapper" class="lgt-select" @change="apply">
          <option v-for="item in TONEMAPPER_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>

      <div class="lgt-section">光照强度<InfoTip title="光照强度" text="提高平行光强度以产生高亮区域，便于观察各映射曲线在高光处的压缩差异。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">平行光强度<InfoTip title="平行光强度" text="平行光强度。用于观察不同映射曲线在高亮区域的压缩差异，强度越高差异越明显。" /></span>
        <input v-model.number="ui.intensity" class="lgt-range" type="range" min="0" max="12" step="0.1" @input="apply" />
        <span class="lgt-value">{{ ui.intensity.toFixed(1) }}</span>
      </div>

      <p class="lgt-hint">色调映射器通过 scene.postProcessStages.tonemapper 设置；关闭 HDR 时映射器不生效。PBR Neutral 色彩还原准确，ACES 对比度高、暗部偏冷，适合夜景与科幻风格。</p>
    </div>

    <div v-if="base.statusMessage.value" class="lgt-status">{{ base.statusMessage.value }}</div>
  </div>
</template>
