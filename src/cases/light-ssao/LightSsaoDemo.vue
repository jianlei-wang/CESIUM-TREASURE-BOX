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
import { applySsao, DEFAULT_SSAO, type SsaoConfig } from '../../lib/lighting'
import '../../lib/lighting-panel.css'

const base = useWhiteModelTileset()

const ui = reactive({
  enabled: true,
  ...DEFAULT_SSAO
})

const ssaoCfg: SsaoConfig = { ...DEFAULT_SSAO }

function apply(): void {
  const viewer = base.viewer.value
  if (!viewer || viewer.isDestroyed()) return
  Object.assign(ssaoCfg, {
    intensity: ui.intensity,
    lengthCap: ui.lengthCap,
    bias: ui.bias,
    stepCount: Math.round(ui.stepCount),
    directionCount: Math.round(ui.directionCount),
    ambientOcclusionOnly: ui.ambientOcclusionOnly
  })
  applySsao(viewer.scene, ui.enabled, ssaoCfg)
  viewer.scene.requestRender()
}

function onTilesetReady(viewer: Viewer): void {
  viewer.scene.light = new DirectionalLight({
    direction: Cartesian3.normalize(new Cartesian3(-0.5, -0.6, 0.7), new Cartesian3()),
    color: new Color(1, 0.97, 0.92, 1),
    intensity: 3
  })
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
      <div class="lgt-title">光照效果 · SSAO 环境光遮蔽</div>

      <div class="lgt-row">
        <span class="lgt-label">SSAO 开关<InfoTip title="SSAO 开关" text="屏幕空间环境光遮蔽后处理开关（scene.postProcessStages.ambientOcclusion）。关闭后不再计算接触阴影。" /></span>
        <button class="lgt-toggle" :class="{ on: ui.enabled }" @click="ui.enabled = !ui.enabled; apply()"><i></i></button>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">仅显示 AO<InfoTip title="仅显示 AO" text="只输出遮蔽因子本身（白为无遮蔽，黑为强遮蔽），用于检查采样半径与噪点质量。" /></span>
        <button class="lgt-toggle" :class="{ on: ui.ambientOcclusionOnly }" @click="ui.ambientOcclusionOnly = !ui.ambientOcclusionOnly; apply()"><i></i></button>
      </div>

      <div class="lgt-section">SSAO 参数<InfoTip title="SSAO 参数" text="Cesium 内置 SSAO 阶段参数，基于深度缓冲在屏幕空间估计接触阴影。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">遮蔽强度<InfoTip title="遮蔽强度" text="AO 作用强度（intensity）。越大墙角与缝隙越暗，过大易出现脏黑。" /></span>
        <input v-model.number="ui.intensity" class="lgt-range" type="range" min="0" max="10" step="0.1" @input="apply" />
        <span class="lgt-value">{{ ui.intensity.toFixed(1) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">距离上限<InfoTip title="距离上限" text="采样半径的屏幕比例上限（lengthCap）。越大能捕捉更大范围的遮蔽，也更容易产生噪点。" /></span>
        <input v-model.number="ui.lengthCap" class="lgt-range" type="range" min="0.01" max="1" step="0.01" @input="apply" />
        <span class="lgt-value">{{ ui.lengthCap.toFixed(2) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">深度偏差<InfoTip title="深度偏差" text="深度比较偏移（bias），用于抑制自遮蔽产生的噪点。" /></span>
        <input v-model.number="ui.bias" class="lgt-range" type="range" min="0" max="0.5" step="0.01" @input="apply" />
        <span class="lgt-value">{{ ui.bias.toFixed(2) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">采样步数<InfoTip title="采样步数" text="每个采样方向上的步进次数（stepCount，Cesium 默认 32）。越大遮蔽计算越精细、噪点越少，性能开销同步上升。" /></span>
        <input v-model.number="ui.stepCount" class="lgt-range" type="range" min="4" max="64" step="1" @input="apply" />
        <span class="lgt-value">{{ Math.round(ui.stepCount) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">采样方向数<InfoTip title="采样方向数" text="屏幕空间内绕像素一周的采样方向数量（directionCount，Cesium 默认 8）。越大方向越密、旋转噪点越少，性能开销同步上升。" /></span>
        <input v-model.number="ui.directionCount" class="lgt-range" type="range" min="2" max="16" step="1" @input="apply" />
        <span class="lgt-value">{{ Math.round(ui.directionCount) }}</span>
      </div>

      <p class="lgt-hint">SSAO 基于深度缓冲计算接触阴影，对建筑缝隙、墙面与地面交界处效果明显；移动端建议关闭以提升帧率。</p>
    </div>

    <div v-if="base.statusMessage.value" class="lgt-status">{{ base.statusMessage.value }}</div>
  </div>
</template>
