<script setup lang="ts">
import InfoTip from '../../components/InfoTip.vue'
import { onBeforeUnmount, onMounted, reactive } from 'vue'
import {
  Cartesian3,
  Color,
  DirectionalLight,
  Math as CesiumMath,
  Matrix4,
  Transforms,
  type Viewer
} from 'cesium'
import { useWhiteModelTileset } from '../../lib/use-white-model-tileset'
import '../../lib/lighting-panel.css'

const REFERENCE = { lon: 4.9041, lat: 52.3676 }

const base = useWhiteModelTileset()

const ui = reactive({
  azimuth: 225,
  elevation: 45,
  color: '#fff4e0',
  intensity: 3,
  globeLighting: true,
  hdr: true
})

function lightDirection(): Cartesian3 {
  const az = CesiumMath.toRadians(ui.azimuth)
  const el = CesiumMath.toRadians(ui.elevation)
  const local = new Cartesian3(
    Math.sin(az) * Math.cos(el),
    Math.cos(az) * Math.cos(el),
    Math.sin(el)
  )
  const enu = Transforms.eastNorthUpToFixedFrame(
    Cartesian3.fromDegrees(REFERENCE.lon, REFERENCE.lat, 0)
  )
  const from = Matrix4.multiplyByPointAsVector(enu, local, new Cartesian3())
  return Cartesian3.negate(Cartesian3.normalize(from, from), from)
}

function applyLight(): void {
  const viewer = base.viewer.value
  if (!viewer || viewer.isDestroyed()) return
  const scene = viewer.scene
  scene.light = new DirectionalLight({
    direction: lightDirection(),
    color: Color.fromCssColorString(ui.color) ?? Color.WHITE,
    intensity: ui.intensity
  })
  scene.globe.enableLighting = ui.globeLighting
  scene.highDynamicRange = ui.hdr
  viewer.scene.requestRender()
}

function onTilesetReady(viewer: Viewer): void {
  viewer.scene.globe.enableLighting = true
  applyLight()
}

onMounted(async () => {
  await base.mount(onTilesetReady)
})

onBeforeUnmount(() => {
  base.teardown()
})
</script>

<template>
  <div class="lgt-shell">
    <div :ref="base.container" class="lgt-canvas"></div>

    <div class="lgt-panel">
      <div class="lgt-title">全局主光源 · 平行光</div>

      <div class="lgt-section">光照方向（本地 ENU）<InfoTip title="光照方向" text="方向基于参考点（阿姆斯特丹）的本地 ENU 坐标系换算为 ECEF，再取反得到光线的传播方向。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">方位角<InfoTip title="方位角" text="光源在本地地平坐标系中的水平方位，0° 正北、90° 正东、180° 正南、270° 正西。" /></span>
        <input v-model.number="ui.azimuth" class="lgt-range" type="range" min="0" max="360" step="1" @input="applyLight" />
        <span class="lgt-value">{{ ui.azimuth.toFixed(0) }}°</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">高度角<InfoTip title="高度角" text="光源相对地平线的仰角：0° 贴近地平线、90° 为天顶直射。角度越低侧面受光越强、阴影越长。" /></span>
        <input v-model.number="ui.elevation" class="lgt-range" type="range" min="1" max="89" step="1" @input="applyLight" />
        <span class="lgt-value">{{ ui.elevation.toFixed(0) }}°</span>
      </div>

      <div class="lgt-section">光源参数<InfoTip title="光源参数" text="平行光自身的光学属性与渲染开关，直接决定受光面的亮度与明暗过渡。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">颜色<InfoTip title="颜色" text="平行光颜色，暖色模拟黄昏、冷色模拟阴天，直接乘到受光面辐照度上。" /></span>
        <input v-model="ui.color" class="lgt-color" type="color" @input="applyLight" />
        <span class="lgt-value">{{ ui.color }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">强度<InfoTip title="强度" text="平行光强度（DirectionalLight.intensity）。0 为无直射光只剩环境光，数值越大受光面越亮。" /></span>
        <input v-model.number="ui.intensity" class="lgt-range" type="range" min="0" max="8" step="0.1" @input="applyLight" />
        <span class="lgt-value">{{ ui.intensity.toFixed(1) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">地形光照<InfoTip title="地形光照" text="是否让地表参与光照计算（globe.enableLighting）。关闭后地形与影像保持全亮，不随光源方向明暗变化。" /></span>
        <button class="lgt-toggle" :class="{ on: ui.globeLighting }" @click="ui.globeLighting = !ui.globeLighting; applyLight()"><i></i></button>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">HDR<InfoTip title="HDR" text="高动态范围渲染开关。开启后光照在高动态范围下计算，高亮区域过渡更自然。" /></span>
        <button class="lgt-toggle" :class="{ on: ui.hdr }" @click="ui.hdr = !ui.hdr; applyLight()"><i></i></button>
      </div>

      <div class="lgt-btn-row">
        <button class="lgt-btn ghost" @click="ui.azimuth = 225; ui.elevation = 55; applyLight()">正午顶光</button>
        <button class="lgt-btn ghost" @click="ui.azimuth = 90; ui.elevation = 8; applyLight()">低角度侧光</button>
      </div>
      <p class="lgt-hint">DirectionalLight 直接替换 scene.light 引用即可高频切换，不会触发着色器重编译；方向基于阿姆斯特丹本地 ENU 坐标换算为 ECEF。</p>
    </div>

    <div v-if="base.statusMessage.value" class="lgt-status">{{ base.statusMessage.value }}</div>
  </div>
</template>
