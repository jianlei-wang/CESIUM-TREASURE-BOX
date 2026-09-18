<script setup lang="ts">
import InfoTip from '../../components/InfoTip.vue'
import { onBeforeUnmount, onMounted, reactive, shallowRef } from 'vue'
import {
  Cartesian3,
  Color,
  DirectionalLight,
  Entity,
  PostProcessStage,
  type Viewer
} from 'cesium'
import { useWhiteModelTileset } from '../../lib/use-white-model-tileset'
import {
  createVolumetricStage,
  updateVolumetricStage,
  projectWorldToScreen,
  DEFAULT_VOLUMETRIC,
  type VolumetricConfig
} from '../../lib/lighting'
import '../../lib/lighting-panel.css'

const base = useWhiteModelTileset()

const ui = reactive({
  enabled: true,
  ...DEFAULT_VOLUMETRIC
})

const volumetricCfg: VolumetricConfig = { ...DEFAULT_VOLUMETRIC }

const stage = shallowRef<PostProcessStage | undefined>(undefined)
const lightMarker = shallowRef<Entity | undefined>(undefined)

const LIGHT_WORLD = Cartesian3.fromDegrees(4.98, 52.3, 9000)

let preRenderOff: (() => void) | undefined

function apply(): void {
  const viewer = base.viewer.value
  if (!viewer || viewer.isDestroyed() || !stage.value) return
  Object.assign(volumetricCfg, {
    density: ui.density,
    decay: ui.decay,
    weight: ui.weight,
    exposure: ui.exposure
  })
  stage.value.enabled = ui.enabled
  const screenPos = projectWorldToScreen(viewer.scene, LIGHT_WORLD)
  updateVolumetricStage(stage.value, screenPos, volumetricCfg)
  if (lightMarker.value) lightMarker.value.show = ui.enabled
  viewer.scene.requestRender()
}

function onTilesetReady(viewer: Viewer): void {
  viewer.scene.light = new DirectionalLight({
    direction: Cartesian3.normalize(new Cartesian3(-0.6, -0.4, 0.55), new Cartesian3()),
    color: new Color(1, 0.95, 0.85, 1),
    intensity: 2.6
  })
  viewer.scene.globe.enableLighting = true
  viewer.scene.highDynamicRange = true
  lightMarker.value = viewer.entities.add({
    position: LIGHT_WORLD,
    point: {
      pixelSize: 26,
      color: Color.WHITE,
      outlineColor: new Color(1, 0.9, 0.6, 0.6),
      outlineWidth: 3,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })
  stage.value = createVolumetricStage(projectWorldToScreen(viewer.scene, LIGHT_WORLD), volumetricCfg)
  viewer.scene.postProcessStages.add(stage.value)
  const handler = () => {
    const current = stage.value
    if (!current) return
    updateVolumetricStage(current, projectWorldToScreen(viewer.scene, LIGHT_WORLD), volumetricCfg)
  }
  viewer.scene.preRender.addEventListener(handler)
  preRenderOff = () => viewer.scene.preRender.removeEventListener(handler)
  apply()
}

onMounted(async () => {
  await base.mount(onTilesetReady)
})

onBeforeUnmount(() => {
  preRenderOff?.()
  preRenderOff = undefined
  const viewer = base.viewer.value
  const current = stage.value
  if (viewer && !viewer.isDestroyed()) {
    if (current) {
      viewer.scene.postProcessStages.remove(current)
    }
    if (lightMarker.value) viewer.entities.remove(lightMarker.value)
  }
  stage.value = undefined
  lightMarker.value = undefined
  base.teardown()
})
</script>

<template>
  <div class="lgt-shell">
    <div :ref="base.container" class="lgt-canvas"></div>

    <div class="lgt-panel">
      <div class="lgt-title">光照效果 · 体积光</div>

      <div class="lgt-row">
        <span class="lgt-label">体积光开关<InfoTip title="体积光开关" text="径向采样体积光后处理开关，同时控制光源标记的显示。" /></span>
        <button class="lgt-toggle" :class="{ on: ui.enabled }" @click="ui.enabled = !ui.enabled; apply()"><i></i></button>
      </div>

      <div class="lgt-section">体积光参数<InfoTip title="体积光参数" text="以光源屏幕坐标为中心做 16 次径向采样并累加，形成光的散射光轴。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">光线密度<InfoTip title="光线密度" text="径向采样步进密度。值越大每次向光源推进越短、光轴越细密，值越小光轴越长。" /></span>
        <input v-model.number="ui.density" class="lgt-range" type="range" min="0" max="1.5" step="0.01" @input="apply" />
        <span class="lgt-value">{{ ui.density.toFixed(2) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">光线衰减<InfoTip title="光线衰减" text="每次采样后的亮度衰减系数（illum *= decay）。越接近 1 光轴拖尾越长。" /></span>
        <input v-model.number="ui.decay" class="lgt-range" type="range" min="0.8" max="1" step="0.005" @input="apply" />
        <span class="lgt-value">{{ ui.decay.toFixed(3) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">采样权重<InfoTip title="采样权重" text="每个采样点叠加到画面的亮度权重，越大整体光轴越亮。" /></span>
        <input v-model.number="ui.weight" class="lgt-range" type="range" min="0" max="1" step="0.01" @input="apply" />
        <span class="lgt-value">{{ ui.weight.toFixed(2) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">曝光<InfoTip title="曝光" text="最终画面整体亮度增益（乘性）。过大整体过曝泛白。" /></span>
        <input v-model.number="ui.exposure" class="lgt-range" type="range" min="0" max="1" step="0.01" @input="apply" />
        <span class="lgt-value">{{ ui.exposure.toFixed(2) }}</span>
      </div>

      <p class="lgt-hint">体积光以光源屏幕坐标为中心做 16 次径向采样，光源标记的世界坐标每帧投影为屏幕坐标并写入 uniform；平行光/太阳光需将无穷远方向反投影为屏幕位置。</p>
    </div>

    <div v-if="base.statusMessage.value" class="lgt-status">{{ base.statusMessage.value }}</div>
  </div>
</template>
