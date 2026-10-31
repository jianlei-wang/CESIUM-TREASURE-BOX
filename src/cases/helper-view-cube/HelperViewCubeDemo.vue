<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useHelperViewer } from '../cesium-helpers-lib/use-helper-viewer'
import '../cesium-helpers-lib/helper-ui.css'
import '../cesium-helpers-lib/packages/cesium-view-cube/src/cesium-view-cube.js'

type ViewCubeElement = HTMLElement & { scene?: unknown }

const container = ref<HTMLElement | null>(null)
const cube = ref<ViewCubeElement | null>(null)
const triad = ref<ViewCubeElement | null>(null)
const showTriad = ref(false)

const { viewer, status, ready } = useHelperViewer(container)

watch([ready, cube, triad, showTriad], async ([isReady]) => {
  if (!isReady || !viewer.value) return
  await nextTick()
  if (cube.value) cube.value.scene = viewer.value.scene
  if (triad.value) triad.value.scene = viewer.value.scene
}, { flush: 'post' })
</script>

<template>
  <div class="helper-shell">
    <div ref="container" class="helper-canvas"></div>

    <cesium-view-cube ref="cube" class="cube-host"></cesium-view-cube>
    <cesium-view-cube v-show="showTriad" ref="triad" class="cube-host triad-host" id="triad"></cesium-view-cube>

    <div class="helper-panel is-left">
      <div class="helper-title">视角立方体</div>
      <p class="helper-hint">
        右上角的立方体标出当前相机朝向，点击某个面或轴即可转向该方向。左侧面板可切换到 ParaView 风格的三轴指示器。
      </p>
      <div class="helper-row">
        <span class="helper-row-label">三轴模式</span>
        <button
          class="helper-toggle"
          :class="{ 'is-on': showTriad }"
          type="button"
          role="switch"
          :aria-checked="showTriad"
          @click="showTriad = !showTriad"
        >
          <i></i>
        </button>
      </div>
    </div>

    <div v-if="status" class="helper-status">{{ status }}</div>
  </div>
</template>

<style scoped>
.cube-host {
  position: absolute;
  top: 30px;
  right: 30px;
  z-index: 8;
  font-family: sans-serif;
}

.triad-host {
  right: 160px;
}

.triad-host::part(face),
.triad-host::part(face-label) {
  display: none;
}

.triad-host::part(axis),
.triad-host::part(axis-label) {
  display: inline;
}
</style>
