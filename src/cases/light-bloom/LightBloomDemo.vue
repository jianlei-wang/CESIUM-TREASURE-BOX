<script setup lang="ts">
import InfoTip from '../../components/InfoTip.vue'
import { onBeforeUnmount, onMounted, reactive, shallowRef } from 'vue'
import {
  Cartesian3,
  Color,
  Entity,
  type Viewer
} from 'cesium'
import { useWhiteModelTileset } from '../../lib/use-white-model-tileset'
import { applyBloom, DEFAULT_BLOOM, type BloomConfig } from '../../lib/lighting'
import '../../lib/lighting-panel.css'

const base = useWhiteModelTileset()

const ui = reactive({
  enabled: true,
  ...DEFAULT_BLOOM,
  contrast: 48,
  hdr: true
})

const bloomCfg: BloomConfig = { ...DEFAULT_BLOOM }

const lights = shallowRef<Entity[]>([])

const LAMP_COLORS = ['#ffffff', '#ffe08a', '#7fd8ff', '#ff6fa8', '#b39cff', '#8be0b2']
const LAMP_COORDS: Array<[number, number, number]> = [
  [4.889, 52.371, 120],
  [4.899, 52.37, 90],
  [4.911, 52.369, 130],
  [4.906, 52.363, 100],
  [4.918, 52.367, 150],
  [4.895, 52.358, 110]
]

function addLamps(viewer: Viewer): void {
  const entities = LAMP_COORDS.map((coord, index) =>
    viewer.entities.add({
      position: Cartesian3.fromDegrees(coord[0], coord[1], coord[2]),
      point: {
        pixelSize: 26,
        color: Color.fromCssColorString(LAMP_COLORS[index % LAMP_COLORS.length]),
        outlineColor: Color.WHITE.withAlpha(0.4),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
  )
  lights.value = entities
}

function apply(): void {
  const viewer = base.viewer.value
  if (!viewer || viewer.isDestroyed()) return
  viewer.scene.highDynamicRange = ui.hdr
  Object.assign(bloomCfg, {
    contrast: ui.contrast,
    brightness: ui.brightness,
    delta: ui.delta,
    sigma: ui.sigma,
    stepSize: ui.stepSize,
    glowOnly: ui.glowOnly
  })
  applyBloom(viewer.scene, ui.enabled, bloomCfg)
  viewer.scene.requestRender()
}

function onTilesetReady(viewer: Viewer): void {
  addLamps(viewer)
  apply()
}

onMounted(async () => {
  await base.mount(onTilesetReady)
})

onBeforeUnmount(() => {
  const viewer = base.viewer.value
  if (viewer && !viewer.isDestroyed()) {
    for (const entity of lights.value) viewer.entities.remove(entity)
  }
  lights.value = []
  base.teardown()
})
</script>

<template>
  <div class="lgt-shell">
    <div :ref="base.container" class="lgt-canvas"></div>

    <div class="lgt-panel">
      <div class="lgt-title">光照效果 · Bloom 泛光</div>

      <div class="lgt-row">
        <span class="lgt-label">泛光开关<InfoTip title="泛光开关" text="Bloom 后处理总开关。关闭后场景按原样输出，不再叠加高亮溢光；开启后按下方参数提取并模糊高亮区域。" /></span>
        <button class="lgt-toggle" :class="{ on: ui.enabled }" @click="ui.enabled = !ui.enabled; apply()"><i></i></button>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">HDR<InfoTip title="HDR" text="高动态范围渲染。开启后场景在线性 HDR 空间计算、亮度可超过 1.0，泛光更明亮自然；关闭则按 LDR 截断，高亮区域容易发白。" /></span>
        <button class="lgt-toggle" :class="{ on: ui.hdr }" @click="ui.hdr = !ui.hdr; apply()"><i></i></button>
      </div>

      <div class="lgt-section">Bloom 参数<InfoTip title="Bloom 参数" text="Cesium 内置 Bloom 阶段（scene.postProcessStages.bloom）的高亮提取与高斯模糊参数。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">阈值对比度<InfoTip title="阈值对比度" text="高亮提取的对比度阈值（contrast）。值越小越多像素参与泛光、辉光更弥散；值越大仅最强光源发光。" /></span>
        <input v-model.number="ui.contrast" class="lgt-range" type="range" min="0" max="256" step="1" @input="apply" />
        <span class="lgt-value">{{ ui.contrast.toFixed(0) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">亮度偏移<InfoTip title="亮度偏移" text="提取高亮前的整体亮度偏移（brightness）。负值压低背景只保留强光源，正值让中等亮度区域也产生泛光。" /></span>
        <input v-model.number="ui.brightness" class="lgt-range" type="range" min="-1" max="0.5" step="0.01" @input="apply" />
        <span class="lgt-value">{{ ui.brightness.toFixed(2) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">核间距<InfoTip title="核间距" text="高斯模糊的采样核间距（delta）。越大模糊半径越大、光晕越宽，同时可能出现分块与噪点。" /></span>
        <input v-model.number="ui.delta" class="lgt-range" type="range" min="0.5" max="4" step="0.1" @input="apply" />
        <span class="lgt-value">{{ ui.delta.toFixed(1) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">高斯 sigma<InfoTip title="高斯 sigma" text="高斯模糊的方差（sigma）。越大过渡越柔和，过大会使光晕发散而失去形状。" /></span>
        <input v-model.number="ui.sigma" class="lgt-range" type="range" min="0.5" max="6" step="0.1" @input="apply" />
        <span class="lgt-value">{{ ui.sigma.toFixed(1) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">步长<InfoTip title="步长" text="高斯模糊迭代的采样步长（stepSize）。增大可扩大模糊范围，但采样密度下降、噪点增多。" /></span>
        <input v-model.number="ui.stepSize" class="lgt-range" type="range" min="0.5" max="3" step="0.1" @input="apply" />
        <span class="lgt-value">{{ ui.stepSize.toFixed(1) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">仅显示泛光<InfoTip title="仅显示泛光" text="只输出泛光亮度本身（glowOnly），丢弃原始场景，用于检查高亮提取与模糊核的效果。" /></span>
        <button class="lgt-toggle" :class="{ on: ui.glowOnly }" @click="ui.glowOnly = !ui.glowOnly; apply()"><i></i></button>
      </div>

      <p class="lgt-hint">对比度越低，越多区域参与泛光；场景中以高亮点模拟城市灯光，开启 HDR 后高亮可超过 1.0，泛光效果更明显。</p>
    </div>

    <div v-if="base.statusMessage.value" class="lgt-status">{{ base.statusMessage.value }}</div>
  </div>
</template>
