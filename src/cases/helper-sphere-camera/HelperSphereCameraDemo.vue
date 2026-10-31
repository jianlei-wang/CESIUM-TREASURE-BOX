<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import type { Viewer } from 'cesium'
import CesiumSphereCamera from '../cesium-helpers-lib/packages/cesium-sphere-camera/src/cesium-sphere-camera.js'
import { useHelperViewer } from '../cesium-helpers-lib/use-helper-viewer'
import HelperToggle from '../cesium-helpers-lib/HelperToggle.vue'
import '../cesium-helpers-lib/helper-ui.css'

const container = ref<HTMLElement | null>(null)
const enabled = ref(false)
const camera = shallowRef<{ active: boolean } | null>(null)

const { viewer, status } = useHelperViewer(container, {}, (instance: Viewer) => {
  camera.value = new CesiumSphereCamera(instance)
  return () => {
    if (camera.value) camera.value.active = false
  }
})

function toggle(value: boolean): void {
  enabled.value = value
  if (camera.value) camera.value.active = value
}

onBeforeUnmount(() => {
  if (camera.value) camera.value.active = false
})
</script>

<template>
  <div class="helper-shell">
    <div ref="container" class="helper-canvas"></div>

    <div class="helper-panel">
      <div class="helper-title">球面环绕相机</div>
      <p class="helper-hint">
        开启后在地图上拖动，相机位置保持不动，只改变朝向：像站在球心环顾四周。
      </p>
      <HelperToggle :model-value="enabled" label="球面相机" @update:model-value="toggle" />
      <p class="helper-hint">{{ viewer ? '拖动画面环顾地形。' : '' }}</p>
    </div>

    <div v-if="status" class="helper-status">{{ status }}</div>
  </div>
</template>
