<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import FirstPersonCameraMode from '../cesium-helpers-lib/packages/FirstPersonCameraMode/src/FirstPersonCameraMode.js'
import { useHelperViewer } from '../cesium-helpers-lib/use-helper-viewer'
import '../cesium-helpers-lib/helper-ui.css'

type FirstPersonMode = {
  active: boolean
  zoom: number
  destroy(): void
}

const container = ref<HTMLElement | null>(null)
const mode = shallowRef<FirstPersonMode | null>(null)
const active = ref(false)
const zoom = ref(0)

const { viewer, status } = useHelperViewer(container, {}, (instance) => {
  const firstPerson = new FirstPersonCameraMode(instance) as FirstPersonMode
  mode.value = firstPerson
  const onLockChange = () => {
    active.value = document.pointerLockElement !== null
    if (!active.value) zoom.value = 0
  }
  document.addEventListener('pointerlockchange', onLockChange)
  const timer = window.setInterval(() => {
    zoom.value = firstPerson.zoom
  }, 200)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('pointerlockchange', onLockChange)
    firstPerson.active = false
    firstPerson.destroy()
    mode.value = null
  }
})

function enter(): void {
  if (mode.value) mode.value.active = true
}

onBeforeUnmount(() => {
  if (mode.value) mode.value.active = false
})
</script>

<template>
  <div class="helper-shell">
    <div ref="container" class="helper-canvas"></div>

    <div class="helper-panel">
      <div class="helper-title">第一人称漫游</div>
      <p class="helper-hint">
        点击按钮进入第一人称：鼠标锁定在画布上，移动鼠标环视，滚轮调节视场，按 Esc 退出。
      </p>
      <div class="helper-actions">
        <button class="helper-button is-active" type="button" :disabled="!viewer" @click="enter">
          进入第一人称
        </button>
      </div>
      <p class="helper-hint">
        {{ active ? '已锁定指针，按 Esc 退出。' : '指针未锁定。' }}
        <span v-if="zoom > 0"> 变焦 {{ (zoom * 100).toFixed(0) }}%</span>
      </p>
    </div>

    <div v-if="status" class="helper-status">{{ status }}</div>
  </div>
</template>
