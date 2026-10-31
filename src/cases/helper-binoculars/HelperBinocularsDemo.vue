<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import CesiumBinoculars from '../cesium-helpers-lib/packages/cesium-binoculars/src/cesium-binoculars.js'
import { useHelperViewer } from '../cesium-helpers-lib/use-helper-viewer'
import HelperToggle from '../cesium-helpers-lib/HelperToggle.vue'
import '../cesium-helpers-lib/helper-ui.css'

type Binoculars = {
  active: boolean
  reticle: boolean
  readonly distance: number | undefined
  readonly magnification: number
}

const container = ref<HTMLElement | null>(null)
const enabled = ref(false)
const reticle = ref(true)
const magnification = ref('')
const distance = ref('')
const binoculars = shallowRef<Binoculars | null>(null)

const { viewer, status } = useHelperViewer(container, {}, (instance) => {
  const optics = new CesiumBinoculars(instance)
  binoculars.value = optics
  optics.reticle = reticle.value
  const remove = instance.scene.postRender.addEventListener(() => {
    if (!optics.active) {
      magnification.value = ''
      distance.value = ''
      return
    }
    magnification.value = `${optics.magnification.toFixed(1)}x`
    distance.value = optics.reticle && optics.distance !== undefined ? `${Math.round(optics.distance)} m` : ''
  })
  return () => {
    remove()
    optics.active = false
    binoculars.value = null
  }
})

function toggle(value: boolean): void {
  enabled.value = value
  if (binoculars.value) binoculars.value.active = value
}

function toggleReticle(value: boolean): void {
  reticle.value = value
  if (binoculars.value) binoculars.value.reticle = value
}

onBeforeUnmount(() => {
  if (binoculars.value) binoculars.value.active = false
})
</script>

<template>
  <div class="helper-shell">
    <div ref="container" class="helper-canvas"></div>

    <div class="helper-panel">
      <div class="helper-title">双筒望远镜</div>
      <p class="helper-hint">
        开启后拖动画面环视，滚轮变焦，视场不移动相机位置；分划可显示目标距离。
      </p>
      <HelperToggle :model-value="enabled" label="望远镜" @update:model-value="toggle" />
      <HelperToggle :model-value="reticle" label="十字分划" @update:model-value="toggleReticle" />
      <div class="helper-row">
        <span class="helper-row-label">倍率</span>
        <span class="helper-value">{{ magnification || '—' }}</span>
      </div>
      <div class="helper-row">
        <span class="helper-row-label">测距</span>
        <span class="helper-value">{{ distance || '—' }}</span>
      </div>
    </div>

    <div v-if="status" class="helper-status">{{ status }}</div>
  </div>
</template>
