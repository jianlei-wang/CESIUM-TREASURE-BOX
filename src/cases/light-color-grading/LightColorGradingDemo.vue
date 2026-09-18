<script setup lang="ts">
import InfoTip from '../../components/InfoTip.vue'
import { onBeforeUnmount, onMounted, reactive, shallowRef } from 'vue'
import {
  Cartesian3,
  Color,
  DirectionalLight,
  PostProcessStage,
  type Viewer
} from 'cesium'
import { useWhiteModelTileset } from '../../lib/use-white-model-tileset'
import {
  createColorGradingStage,
  updateColorGradingStage,
  DEFAULT_COLOR_GRADING,
  type ColorGradingConfig
} from '../../lib/lighting'
import '../../lib/lighting-panel.css'

const base = useWhiteModelTileset()

const ui = reactive({
  enabled: true,
  slope: [...DEFAULT_COLOR_GRADING.slope] as [number, number, number],
  offset: [...DEFAULT_COLOR_GRADING.offset] as [number, number, number],
  power: [...DEFAULT_COLOR_GRADING.power] as [number, number, number],
  saturation: DEFAULT_COLOR_GRADING.saturation,
  contrast: DEFAULT_COLOR_GRADING.contrast,
  brightness: DEFAULT_COLOR_GRADING.brightness
})

const stage = shallowRef<PostProcessStage | undefined>(undefined)

function currentConfig(): ColorGradingConfig {
  return {
    slope: [...ui.slope] as [number, number, number],
    offset: [...ui.offset] as [number, number, number],
    power: [...ui.power] as [number, number, number],
    saturation: ui.saturation,
    contrast: ui.contrast,
    brightness: ui.brightness
  }
}

function apply(): void {
  const viewer = base.viewer.value
  if (!viewer || viewer.isDestroyed() || !stage.value) return
  stage.value.enabled = ui.enabled
  updateColorGradingStage(stage.value, currentConfig())
  viewer.scene.requestRender()
}

function applyPreset(kind: 'neutral' | 'warm' | 'cool' | 'cinematic'): void {
  if (kind === 'neutral') {
    ui.slope = [1, 1, 1]; ui.offset = [0, 0, 0]; ui.power = [1, 1, 1]; ui.saturation = 1; ui.contrast = 1; ui.brightness = 0
  } else if (kind === 'warm') {
    ui.slope = [1.12, 1.0, 0.85]; ui.offset = [0.02, 0, -0.01]; ui.power = [1, 1, 1]; ui.saturation = 1.15; ui.contrast = 1.05; ui.brightness = 0.02
  } else if (kind === 'cool') {
    ui.slope = [0.85, 0.98, 1.15]; ui.offset = [-0.01, 0, 0.02]; ui.power = [1, 1, 1]; ui.saturation = 1.05; ui.contrast = 1.02; ui.brightness = 0.01
  } else {
    ui.slope = [1.1, 0.98, 0.9]; ui.offset = [-0.02, -0.02, 0]; ui.power = [1.1, 1.05, 1.0]; ui.saturation = 1.2; ui.contrast = 1.2; ui.brightness = -0.03
  }
  apply()
}

function onTilesetReady(viewer: Viewer): void {
  viewer.scene.light = new DirectionalLight({
    direction: Cartesian3.normalize(new Cartesian3(-0.5, -0.55, 0.72), new Cartesian3()),
    color: new Color(1, 0.97, 0.92, 1),
    intensity: 3
  })
  viewer.scene.globe.enableLighting = true
  viewer.scene.highDynamicRange = true
  stage.value = createColorGradingStage(currentConfig())
  viewer.scene.postProcessStages.add(stage.value)
  apply()
}

onMounted(async () => {
  await base.mount(onTilesetReady)
})

onBeforeUnmount(() => {
  const viewer = base.viewer.value
  const current = stage.value
  if (viewer && !viewer.isDestroyed() && current) {
    viewer.scene.postProcessStages.remove(current)
  }
  stage.value = undefined
  base.teardown()
})
</script>

<template>
  <div class="lgt-shell">
    <div :ref="base.container" class="lgt-canvas"></div>

    <div class="lgt-panel">
      <div class="lgt-title">光照效果 · 颜色分级</div>

      <div class="lgt-row">
        <span class="lgt-label">分级开关<InfoTip title="分级开关" text="颜色分级后处理阶段开关。关闭后场景颜色不做 ASC CDL 与基础调整，用于对比分级前后的差别。" /></span>
        <button class="lgt-toggle" :class="{ on: ui.enabled }" @click="ui.enabled = !ui.enabled; apply()"><i></i></button>
      </div>

      <div class="lgt-section">一键预设<InfoTip title="一键预设" text="预设会一次性改写斜率、幂次与基础调整参数，用于快速对比中性/暖调/冷调/电影四种色调风格。" /></div>
      <div class="lgt-btn-row">
        <button class="lgt-btn ghost" @click="applyPreset('neutral')">中性</button>
        <button class="lgt-btn ghost" @click="applyPreset('warm')">暖调</button>
        <button class="lgt-btn ghost" @click="applyPreset('cool')">冷调</button>
        <button class="lgt-btn ghost" @click="applyPreset('cinematic')">电影</button>
      </div>

      <div class="lgt-section">ASC CDL · 斜率<InfoTip title="ASC CDL 斜率" text="斜率（slope）是逐通道乘性增益，用于白平衡与三通道配平；1.0 为不变，大于 1 提亮该通道。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">R<InfoTip title="斜率 R" text="红色通道的斜率增益：升高画面偏红，降低偏青，是主要的红色配平参数。" /></span>
        <input v-model.number="ui.slope[0]" class="lgt-range" type="range" min="0.5" max="1.5" step="0.01" @input="apply" />
        <span class="lgt-value">{{ ui.slope[0].toFixed(2) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">G<InfoTip title="斜率 G" text="绿色通道的斜率增益：升高画面偏绿，降低偏品红。" /></span>
        <input v-model.number="ui.slope[1]" class="lgt-range" type="range" min="0.5" max="1.5" step="0.01" @input="apply" />
        <span class="lgt-value">{{ ui.slope[1].toFixed(2) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">B<InfoTip title="斜率 B" text="蓝色通道的斜率增益：升高画面偏蓝，降低偏黄，常用于冷暖调色。" /></span>
        <input v-model.number="ui.slope[2]" class="lgt-range" type="range" min="0.5" max="1.5" step="0.01" @input="apply" />
        <span class="lgt-value">{{ ui.slope[2].toFixed(2) }}</span>
      </div>

      <div class="lgt-section">ASC CDL · 幂次<InfoTip title="ASC CDL 幂次" text="幂次（power）是逐通道 gamma 指数，主要影响该通道的中间调与暗部；1.0 为不变。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">R<InfoTip title="幂次 R" text="红色通道的幂次：大于 1 压暗红色暗部使画面偏青，小于 1 提亮红色。" /></span>
        <input v-model.number="ui.power[0]" class="lgt-range" type="range" min="0.5" max="1.5" step="0.01" @input="apply" />
        <span class="lgt-value">{{ ui.power[0].toFixed(2) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">G<InfoTip title="幂次 G" text="绿色通道的幂次：大于 1 压暗绿色暗部使画面偏品红，小于 1 提亮绿色。" /></span>
        <input v-model.number="ui.power[1]" class="lgt-range" type="range" min="0.5" max="1.5" step="0.01" @input="apply" />
        <span class="lgt-value">{{ ui.power[1].toFixed(2) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">B<InfoTip title="幂次 B" text="蓝色通道的幂次：大于 1 压暗蓝色暗部使画面偏黄，小于 1 提亮蓝色。" /></span>
        <input v-model.number="ui.power[2]" class="lgt-range" type="range" min="0.5" max="1.5" step="0.01" @input="apply" />
        <span class="lgt-value">{{ ui.power[2].toFixed(2) }}</span>
      </div>

      <div class="lgt-section">基础调整<InfoTip title="基础调整" text="在 ASC CDL 之外对全图做饱和度、对比度与亮度调整，属于色相无关的整体调色。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">饱和度<InfoTip title="饱和度" text="以亮度为基准缩放色度：0 为灰度，1 为原始饱和度，大于 1 色彩更浓。" /></span>
        <input v-model.number="ui.saturation" class="lgt-range" type="range" min="0" max="2" step="0.01" @input="apply" />
        <span class="lgt-value">{{ ui.saturation.toFixed(2) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">对比度<InfoTip title="对比度" text="以 0.5 中灰为轴缩放颜色：大于 1 增强明暗反差，小于 1 画面更平淡。" /></span>
        <input v-model.number="ui.contrast" class="lgt-range" type="range" min="0" max="2" step="0.01" @input="apply" />
        <span class="lgt-value">{{ ui.contrast.toFixed(2) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">亮度<InfoTip title="亮度" text="对所有通道整体加减的偏移量，用于整体提亮或压暗。" /></span>
        <input v-model.number="ui.brightness" class="lgt-range" type="range" min="-0.5" max="0.5" step="0.005" @input="apply" />
        <span class="lgt-value">{{ ui.brightness.toFixed(3) }}</span>
      </div>

      <p class="lgt-hint">分级公式：rgb = pow(slope * rgb + offset, power)，再依次调整对比度、亮度与饱和度；自定义 Stage 在 Bloom 之后、FXAA 之前注入。</p>
    </div>

    <div v-if="base.statusMessage.value" class="lgt-status">{{ base.statusMessage.value }}</div>
  </div>
</template>
