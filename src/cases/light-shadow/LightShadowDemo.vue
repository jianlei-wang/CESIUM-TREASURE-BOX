<script setup lang="ts">
import InfoTip from '../../components/InfoTip.vue'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  Cartesian3,
  Color,
  DirectionalLight,
  Math as CesiumMath,
  Matrix4,
  Scene,
  ShadowMode,
  Transforms
} from 'cesium'
import { useWhiteModelTileset } from '../../lib/use-white-model-tileset'
import '../../lib/lighting-panel.css'

const REFERENCE = { lon: 4.9041, lat: 52.3676 }

const base = useWhiteModelTileset()

const ui = reactive({
  enabled: true,
  darkness: 0.35,
  softShadows: true,
  maximumDistance: 4000,
  size: 2048,
  normalOffset: true,
  fadingEnabled: true,
  azimuth: 225,
  elevation: 45,
  intensity: 3
})

const softShadowsUsable = ref(true)
let appliedSize = ui.size

function lightDirection(): Cartesian3 {
  const az = CesiumMath.toRadians(ui.azimuth)
  const el = CesiumMath.toRadians(ui.elevation)
  const local = new Cartesian3(
    Math.sin(az) * Math.cos(el),
    Math.cos(az) * Math.cos(el),
    Math.sin(el)
  )
  const enu = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(REFERENCE.lon, REFERENCE.lat, 0))
  const from = Matrix4.multiplyByPointAsVector(enu, local, new Cartesian3())
  return Cartesian3.negate(Cartesian3.normalize(from, from), from)
}

type ShadowBias = { normalOffsetScale: number }
type ShadowMapInternals = {
  dirty: boolean
  _usesDepthTexture?: boolean
  _terrainBias?: ShadowBias
  _primitiveBias?: ShadowBias
}

function markShadowMapDirty(scene: Scene): void {
  ;(scene.shadowMap as unknown as ShadowMapInternals).dirty = true
}

let normalOffsetBase: { terrain: number; primitive: number } | undefined

function applyNormalOffset(shadowMap: Scene['shadowMap']): void {
  const internals = shadowMap as unknown as ShadowMapInternals
  const terrain = internals._terrainBias
  const primitive = internals._primitiveBias
  if (terrain && primitive && !normalOffsetBase) {
    normalOffsetBase = { terrain: terrain.normalOffsetScale, primitive: primitive.normalOffsetScale }
  }
  if (terrain) terrain.normalOffsetScale = ui.normalOffset ? normalOffsetBase?.terrain ?? 0.5 : 0
  if (primitive) primitive.normalOffsetScale = ui.normalOffset ? normalOffsetBase?.primitive ?? 0.1 : 0
  shadowMap.normalOffset = true
}

function apply(): void {
  const viewer = base.viewer.value
  if (!viewer || viewer.isDestroyed()) return
  const scene = viewer.scene
  scene.light = new DirectionalLight({
    direction: lightDirection(),
    color: new Color(1, 0.97, 0.9, 1),
    intensity: ui.intensity
  })
  scene.globe.enableLighting = true
  scene.globe.shadows = ShadowMode.RECEIVE_ONLY
  const shadowMap = scene.shadowMap
  shadowMap.enabled = ui.enabled
  shadowMap.darkness = ui.darkness
  shadowMap.softShadows = ui.softShadows
  shadowMap.maximumDistance = ui.maximumDistance
  shadowMap.fadingEnabled = ui.fadingEnabled
  if (ui.size !== appliedSize) {
    appliedSize = ui.size
    shadowMap.size = ui.size
    markShadowMapDirty(scene)
  }
  applyNormalOffset(shadowMap)
  softShadowsUsable.value = !(shadowMap as unknown as { _usesDepthTexture?: boolean })._usesDepthTexture
  viewer.scene.requestRender()
}

const softShadowsTip = computed(() =>
  softShadowsUsable.value
    ? '开启后对阴影边缘做 PCF 过滤（softShadows），边缘柔和；关闭则为硬边阴影。'
    : '当前设备走深度纹理阴影路径，Cesium 的 PCF 软阴影仅在不支持深度纹理时实现，因此该开关在本设备上不会产生可见差异。'
)

const grazingNote = computed(() => {
  if (!ui.fadingEnabled) return '已关闭'
  if (ui.elevation > 6) return '高度角 > 6° 无差异'
  const ratio = Math.min(1, Math.max(0, Math.sin(CesiumMath.toRadians(ui.elevation)) / 0.1))
  const effective = 1 + ratio * (ui.darkness - 1)
  return `实际浓度 ≈ ${effective.toFixed(2)}`
})

function onTilesetReady(): void {
  apply()
}

onMounted(async () => {
  await base.mount(onTilesetReady)
  const viewer = base.viewer.value
  if (viewer && !viewer.isDestroyed()) {
    viewer.scene.globe.shadows = ShadowMode.RECEIVE_ONLY
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(REFERENCE.lon, REFERENCE.lat - 0.008, 900),
      orientation: {
        heading: CesiumMath.toRadians(20),
        pitch: CesiumMath.toRadians(-30),
        roll: 0
      }
    })
  }
})

onBeforeUnmount(() => {
  base.teardown()
})
</script>

<template>
  <div class="lgt-shell">
    <div :ref="base.container" class="lgt-canvas"></div>

    <div class="lgt-panel">
      <div class="lgt-title">光照效果 · 实时阴影</div>

      <div class="lgt-row">
        <span class="lgt-label">阴影开关<InfoTip title="阴影开关" text="阴影贴图总开关（scene.shadowMap.enabled）。关闭后场景不投射也不接收实时阴影。" /></span>
        <button class="lgt-toggle" :class="{ on: ui.enabled }" @click="ui.enabled = !ui.enabled; apply()"><i></i></button>
      </div>

      <div class="lgt-section">阴影参数<InfoTip title="阴影参数" text="Cesium 内置阴影贴图（ShadowMap）的浓度、范围、分辨率与边缘质量参数。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">阴影浓度<InfoTip title="阴影浓度" text="阴影区域的压暗程度（darkness）。0 阴影不可见，1 为完全黑，通常取 0.3~0.5。" /></span>
        <input v-model.number="ui.darkness" class="lgt-range" type="range" min="0" max="1" step="0.05" @input="apply" />
        <span class="lgt-value">{{ ui.darkness.toFixed(2) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">最大距离<InfoTip title="最大距离" text="相机到地面参与阴影计算的最远距离（maximumDistance）。减小可提高阴影清晰度，但远处阴影会消失。" /></span>
        <input v-model.number="ui.maximumDistance" class="lgt-range" type="range" min="1000" max="10000" step="250" @input="apply" />
        <span class="lgt-value">{{ ui.maximumDistance }}m</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">贴图尺寸<InfoTip title="贴图尺寸" text="阴影贴图分辨率（size）。越高阴影边缘越精细，显存与渲染开销也越大。" /></span>
        <select v-model.number="ui.size" class="lgt-select" @change="apply">
          <option :value="1024">1024</option>
          <option :value="2048">2048</option>
          <option :value="4096">4096</option>
        </select>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">软阴影<InfoTip title="软阴影" :text="softShadowsTip" /></span>
        <button
          class="lgt-toggle"
          :class="{ on: ui.softShadows }"
          :disabled="!softShadowsUsable"
          @click="ui.softShadows = !ui.softShadows; apply()"
        ><i></i></button>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">法线偏移<InfoTip title="法线偏移" text="沿法线方向偏移阴影采样位置，抑制自阴影产生的条纹噪点。Cesium 的 normalOffset 只在着色器编译期决定是否生成偏移代码，运行期无法改变，因此这里保持代码常驻、通过偏移系数（地形 0.5、模型 0.1）控制强度：关闭即系数归零，等效于不偏移。效果在掠射光（低高度角）与近距视角下最易观察。" /></span>
        <button class="lgt-toggle" :class="{ on: ui.normalOffset }" @click="ui.normalOffset = !ui.normalOffset; apply()"><i></i></button>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">边缘淡出<InfoTip title="边缘淡出" text="光线接近地平线时让阴影整体变淡（fadingEnabled）。Cesium 比较相机天顶方向与光照方向的夹角，夹角越小阴影越淡；高度角大于约 6° 时该开关没有任何差异。" /></span>
        <span class="lgt-note">{{ grazingNote }}</span>
        <button class="lgt-toggle" :class="{ on: ui.fadingEnabled }" @click="ui.fadingEnabled = !ui.fadingEnabled; apply()"><i></i></button>
      </div>

      <div class="lgt-section">平行光方向<InfoTip title="平行光方向" text="阴影方向由该平行光决定；方向基于参考点本地 ENU 换算为 ECEF。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">方位角<InfoTip title="方位角" text="平行光的水平方位，决定阴影投射方向。" /></span>
        <input v-model.number="ui.azimuth" class="lgt-range" type="range" min="0" max="360" step="1" @input="apply" />
        <span class="lgt-value">{{ ui.azimuth.toFixed(0) }}°</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">高度角<InfoTip title="高度角" text="平行光的仰角。角度越低阴影越长；降到约 6° 以下并配合「边缘淡出」，可看到阴影整体变淡。" /></span>
        <input v-model.number="ui.elevation" class="lgt-range" type="range" min="1" max="85" step="1" @input="apply" />
        <span class="lgt-value">{{ ui.elevation.toFixed(0) }}°</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">光强<InfoTip title="光强" text="平行光强度，影响受光面亮度与阴影对比度。" /></span>
        <input v-model.number="ui.intensity" class="lgt-range" type="range" min="0" max="8" step="0.1" @input="apply" />
        <span class="lgt-value">{{ ui.intensity.toFixed(1) }}</span>
      </div>

      <p class="lgt-hint">级联阴影数量（cascadesEnabled / numberOfCascades）需在 ShadowMap 创建前指定，运行时修改需重建 shadowMap；本案例暴露其余可运行时调整的参数。法线偏移会改变阴影接收着色器，切换时案例会主动重建该着色器。</p>
    </div>

    <div v-if="base.statusMessage.value" class="lgt-status">{{ base.statusMessage.value }}</div>
  </div>
</template>
