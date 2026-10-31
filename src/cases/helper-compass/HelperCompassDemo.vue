<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useHelperViewer } from '../cesium-helpers-lib/use-helper-viewer'
import '../cesium-helpers-lib/helper-ui.css'
import '../cesium-helpers-lib/packages/cesium-compass/src/cesium-compass.js'

type CompassElement = HTMLElement & { scene?: unknown; clock?: unknown }

const container = ref<HTMLElement | null>(null)
const compass = ref<CompassElement | null>(null)

const { viewer, status, ready } = useHelperViewer(container)

watch([ready, compass], async ([isReady]) => {
  if (!isReady || !viewer.value || !compass.value) return
  await nextTick()
  compass.value.scene = viewer.value.scene
  compass.value.clock = viewer.value.clock
}, { flush: 'post' })
</script>

<template>
  <div class="helper-shell">
    <div ref="container" class="helper-canvas"></div>

    <cesium-compass ref="compass" class="compass-host"></cesium-compass>

    <div class="helper-panel is-left">
      <div class="helper-title">指南针控件</div>
      <p class="helper-hint">
        罗盘绑定到场景后跟随相机朝向转动，拖动外环旋转视角，点击中心区域把相机指北。
      </p>
      <p v-if="ready" class="helper-hint">拖动罗盘外环旋转视角，点击中心指北。</p>
    </div>

    <div v-if="status" class="helper-status">{{ status }}</div>
  </div>
</template>

<style scoped>
.compass-host {
  position: absolute;
  top: 30px;
  right: 30px;
  z-index: 8;
}
</style>
