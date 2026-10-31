<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useHelperViewer } from '../cesium-helpers-lib/use-helper-viewer'
import '../cesium-helpers-lib/helper-ui.css'
import '../cesium-helpers-lib/packages/cesium-compass-bar/src/cesium-compass-bar.js'

type CompassBarElement = HTMLElement & { scene?: unknown }

const container = ref<HTMLElement | null>(null)
const bar = ref<CompassBarElement | null>(null)
const showTicks = ref(true)

const { viewer, status, ready } = useHelperViewer(container)

watch([ready, bar], async ([isReady]) => {
  if (!isReady || !viewer.value || !bar.value) return
  await nextTick()
  bar.value.scene = viewer.value.scene
}, { flush: 'post' })
</script>

<template>
  <div class="helper-shell">
    <div ref="container" class="helper-canvas"></div>

    <cesium-compass-bar ref="bar" class="bar-host" :class="{ 'is-plain': !showTicks }"></cesium-compass-bar>

    <div class="helper-panel is-left">
      <div class="helper-title">罗盘刻度条</div>
      <p class="helper-hint">
        水平刻度带随相机朝向滚动。拖动刻度带左右平移即可改变航向，松手后停在新的方向。
      </p>
      <div class="helper-row">
        <span class="helper-row-label">显示刻度</span>
        <button
          class="helper-toggle"
          :class="{ 'is-on': showTicks }"
          type="button"
          role="switch"
          :aria-checked="showTicks"
          @click="showTicks = !showTicks"
        >
          <i></i>
        </button>
      </div>
    </div>

    <div v-if="status" class="helper-status">{{ status }}</div>
  </div>
</template>

<style scoped>
.bar-host {
  position: absolute;
  top: 30px;
  left: 50%;
  z-index: 8;
  width: min(280px, calc(100% - 32px));
  transform: translateX(-50%);
  border-radius: 6px;
  background-color: rgba(0, 0, 0, 0.72);
}

.is-plain {
  --cesium-compass-bar-tick-color: rgba(224, 225, 226, 0.35);
}

.bar-host::part(label) {
  font-family: ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  color: rgba(224, 225, 226, 0.5);
}

.bar-host::part(label major) {
  font-size: 14px;
  color: rgb(224, 225, 226);
}

.bar-host::part(tick) {
  height: 6px;
}

.bar-host::part(tick major) {
  background-color: rgb(224, 225, 226);
}

.bar-host::part(tick minor) {
  background-color: rgba(224, 225, 226, 0.5);
}

.bar-host::part(center-tick) {
  background-color: rgb(224, 225, 226);
}
</style>
