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
import { applyFxaa } from '../../lib/lighting'
import '../../lib/lighting-panel.css'

const base = useWhiteModelTileset()

const ui = reactive({
  fxaa: true,
  resolutionScale: 1
})

const guides = shallowRef<Entity[]>([])
let viewerRef: Viewer | undefined

function addGuides(viewer: Viewer): void {
  const center = { lon: 4.9041, lat: 52.3676 }
  const entities: Entity[] = []
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2
    const end = Cartesian3.fromDegrees(
      center.lon + Math.cos(angle) * 0.02,
      center.lat + Math.sin(angle) * 0.015,
      40 + (i % 4) * 30
    )
    entities.push(
      viewer.entities.add({
        polyline: {
          positions: [Cartesian3.fromDegrees(center.lon, center.lat, 20), end],
          width: 1,
          material: Color.fromCssColorString(i % 2 === 0 ? '#ffffff' : '#7fd8ff')
        }
      })
    )
  }
  guides.value = entities
}

function apply(): void {
  const viewer = base.viewer.value
  if (!viewer || viewer.isDestroyed()) return
  viewer.resolutionScale = ui.resolutionScale
  applyFxaa(viewer.scene, ui.fxaa)
  viewer.scene.requestRender()
}

function onTilesetReady(viewer: Viewer): void {
  viewerRef = viewer
  addGuides(viewer)
  apply()
}

onMounted(async () => {
  await base.mount(onTilesetReady)
})

onBeforeUnmount(() => {
  if (viewerRef && !viewerRef.isDestroyed()) {
    for (const entity of guides.value) viewerRef.entities.remove(entity)
  }
  guides.value = []
  viewerRef = undefined
  base.teardown()
})
</script>

<template>
  <div class="lgt-shell">
    <div :ref="base.container" class="lgt-canvas"></div>

    <div class="lgt-panel">
      <div class="lgt-title">光照效果 · 抗锯齿</div>

      <div class="lgt-row">
        <span class="lgt-label">FXAA 开关<InfoTip title="FXAA 开关" text="快速近似抗锯齿后处理开关（scene.postProcessStages.fxaa）。关闭后几何边缘出现台阶状锯齿。" /></span>
        <button class="lgt-toggle" :class="{ on: ui.fxaa }" @click="ui.fxaa = !ui.fxaa; apply()"><i></i></button>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">分辨率缩放<InfoTip title="分辨率缩放" text="viewer.resolutionScale，渲染分辨率相对画布的倍率。小于 1 先降采样再放大，锯齿明显，用于对比 FXAA 的效果。" /></span>
        <input v-model.number="ui.resolutionScale" class="lgt-range" type="range" min="0.5" max="1.5" step="0.05" @input="apply" />
        <span class="lgt-value">{{ ui.resolutionScale.toFixed(2) }}×</span>
      </div>

      <div class="lgt-section">方案说明<InfoTip title="方案说明" text="FXAA 在屏幕空间沿边缘方向做单次近似滤波，开销远低于 MSAA；降低分辨率缩放可放大锯齿，便于观察开关差异。" /></div>
      <p class="lgt-hint">
        MSAA 在 CesiumWidget / Viewer 创建时通过 contextOptions.webgl.msaa 指定（默认 4x），运行时不可切换，主要用于几何边缘；
        FXAA 为全屏后处理，开销低，适合移动端。当前演示可通过降低分辨率缩放开大锯齿，再切换 FXAA 对比边缘改善。
      </p>
    </div>

    <div v-if="base.statusMessage.value" class="lgt-status">{{ base.statusMessage.value }}</div>
  </div>
</template>
