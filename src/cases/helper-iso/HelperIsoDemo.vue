<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { Cartesian3, Cesium3DTileset, Color, Math as CesiumMath } from 'cesium'
import CesiumIso from '../cesium-helpers-lib/packages/cesium-iso/src/cesium-iso.js'
import {
  LensDistortion,
  TiltShift,
  Toy,
  WhiteModel
} from '../cesium-helpers-lib/packages/cesium-post-process/src/cesium-post-process.js'
import { useHelperViewer } from '../cesium-helpers-lib/use-helper-viewer'
import HelperToggle from '../cesium-helpers-lib/HelperToggle.vue'
import '../cesium-helpers-lib/helper-ui.css'

type Iso = {
  active: boolean
  size: number
  target: Cartesian3
  turn(sign: number): void
  zoom(factor: number): void
}
type Effect = { active: boolean }

const BUILDINGS = 'https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json'

const container = ref<HTMLElement | null>(null)
const enabled = ref(true)
const style = ref<'toy' | 'white'>('toy')
const tiltShiftOn = ref(true)

let iso: Iso | null = null
let toy: Effect | null = null
let white: Effect | null = null
let tiltShift: Effect | null = null
let vignette: Effect | null = null
let applyEffects: (() => void) | null = null

const { viewer, status } = useHelperViewer(container, { smooth: true }, async (instance) => {
  const buildings = await Cesium3DTileset.fromUrl(BUILDINGS, { maximumScreenSpaceError: 8 })
  instance.scene.primitives.add(buildings)
  instance.camera.setView({
    destination: Cartesian3.fromDegrees(7.4442, 46.9466, 2500),
    orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO }
  })

  const isometric = new CesiumIso(instance, { size: 300, maxSize: 600 }) as Iso
  iso = isometric
  isometric.active = enabled.value

  toy = new Toy(instance, {
    sky: [Color.fromCssColorString('#fbf1e4'), Color.fromCssColorString('#e9d3bc')]
  }) as Effect
  tiltShift = new TiltShift(instance, { focus: () => isometric.target, range: 0.2, blur: 2.5, saturation: 0 }) as Effect
  vignette = new LensDistortion(instance, { distortion: 0, vignette: 0.15 }) as Effect
  white = new WhiteModel(instance, {
    sky: [Color.fromCssColorString('#dcdedd'), Color.fromCssColorString('#f3f3f1')]
  }) as Effect

  applyEffects = () => {
    const isToy = style.value === 'toy'
    const shown: [Effect | null, boolean][] = [
      [toy, isToy],
      [white, style.value === 'white'],
      [tiltShift, tiltShiftOn.value],
      [vignette, isToy]
    ]
    // 先全部关闭再按顺序打开，保证阶段添加顺序稳定
    shown.forEach(([effect]) => effect && (effect.active = false))
    shown.forEach(([effect, active]) => active && effect && (effect.active = true))
  }
  applyEffects()

  return () => {
    ;[toy, white, tiltShift, vignette].forEach((effect) => {
      if (effect) effect.active = false
    })
    if (isometric) isometric.active = false
    iso = null
    applyEffects = null
  }
})

function toggleIso(value: boolean): void {
  enabled.value = value
  if (iso) iso.active = value
}

function setStyle(value: 'toy' | 'white'): void {
  style.value = value
  applyEffects?.()
}

function toggleTilt(value: boolean): void {
  tiltShiftOn.value = value
  applyEffects?.()
}

function turn(sign: number): void {
  iso?.turn(sign)
}

function zoom(factor: number): void {
  iso?.zoom(factor)
}

onBeforeUnmount(() => {
  if (iso) iso.active = false
})
</script>

<template>
  <div class="helper-shell">
    <div ref="container" class="helper-canvas"></div>

    <div class="helper-panel">
      <div class="helper-title">等轴测视图</div>
      <p class="helper-hint">
        游戏式正交视角，固定俯角从四个方向观察伯尔尼老城。拖动可旋转与平移，滚轮缩放，Q/E 四分之一转。
      </p>
      <HelperToggle :model-value="enabled" label="等轴测" @update:model-value="toggleIso" />
      <div class="helper-actions">
        <button class="helper-button" type="button" @click="turn(-1)">左转</button>
        <button class="helper-button" type="button" @click="turn(1)">右转</button>
        <button class="helper-button" type="button" @click="zoom(1 / 1.25)">放大</button>
        <button class="helper-button" type="button" @click="zoom(1.25)">缩小</button>
      </div>
      <div class="helper-field">
        <span class="helper-row-label">风格</span>
        <select class="helper-select" :value="style" @change="setStyle(($event.target as HTMLSelectElement).value as 'toy' | 'white')">
          <option value="toy">玩具模型</option>
          <option value="white">白色建筑模型</option>
        </select>
      </div>
      <HelperToggle :model-value="tiltShiftOn" label="移轴模糊" @update:model-value="toggleTilt" />
    </div>

    <div v-if="status" class="helper-status">{{ status }}</div>
  </div>
</template>
