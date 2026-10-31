<script setup lang="ts">
import { ref } from 'vue'
import { ScreenSpaceEventType } from 'cesium'
import CesiumFlyTo from '../cesium-helpers-lib/packages/cesium-flyto/src/cesium-flyto.js'
import { useHelperViewer } from '../cesium-helpers-lib/use-helper-viewer'
import HelperToggle from '../cesium-helpers-lib/HelperToggle.vue'
import '../cesium-helpers-lib/helper-ui.css'

type FlyToMode = { active: boolean; range: number }

const container = ref<HTMLElement | null>(null)
const enabled = ref(true)
const flight = ref('')
let mode: FlyToMode | null = null

const { viewer, status } = useHelperViewer(container, {}, (instance) => {
  const flyTo = new CesiumFlyTo(instance)
  mode = flyTo
  flyTo.active = enabled.value
  const onDoubleClick = () => {
    flight.value = '正在飞向目标…'
    window.setTimeout(() => {
      if (flight.value) flight.value = ''
    }, 2500)
  }
  instance.screenSpaceEventHandler.setInputAction(onDoubleClick, ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
  return () => {
    flyTo.active = false
    mode = null
  }
})

function toggle(value: boolean): void {
  enabled.value = value
  if (mode) mode.active = value
}
</script>

<template>
  <div class="helper-shell">
    <div ref="container" class="helper-canvas"></div>

    <div class="helper-panel">
      <div class="helper-title">双击飞行</div>
      <p class="helper-hint">
        双击地面，相机便沿视线飞向落点，终点距地面约 300 米，飞行中带运动模糊与景深。
      </p>
      <HelperToggle :model-value="enabled" label="双击飞行" @update:model-value="toggle" />
      <p class="helper-hint">{{ flight }}</p>
    </div>

    <div v-if="status" class="helper-status">{{ status }}</div>
  </div>
</template>
