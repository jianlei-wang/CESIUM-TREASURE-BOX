<script setup lang="ts">
import InfoTip from '../../components/InfoTip.vue'
import { onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import {
  Color,
  JulianDate,
  SunLight,
  type Viewer
} from 'cesium'
import { useWhiteModelTileset } from '../../lib/use-white-model-tileset'
import '../../lib/lighting-panel.css'

const base = useWhiteModelTileset()

const ui = reactive({
  year: 2026,
  month: 6,
  day: 21,
  hour: 9,
  color: '#fff0d6',
  intensity: 2.6,
  globeLighting: true,
  hdr: true,
  animate: false,
  multiplier: 1200
})

const timeText = ref('')
const viewerRef = shallowRef<Viewer | undefined>(undefined)
let preRenderOff: (() => void) | undefined

function applyLight(): void {
  const viewer = base.viewer.value
  if (!viewer || viewer.isDestroyed()) return
  const scene = viewer.scene
  scene.light = new SunLight({
    color: Color.fromCssColorString(ui.color) ?? Color.WHITE,
    intensity: ui.intensity
  })
  scene.globe.enableLighting = ui.globeLighting
  scene.highDynamicRange = ui.hdr
  viewer.scene.requestRender()
}

function applyTime(): void {
  const viewer = base.viewer.value
  if (!viewer || viewer.isDestroyed()) return
  viewer.clock.currentTime = JulianDate.fromDate(
    new Date(Date.UTC(ui.year, ui.month - 1, ui.day, ui.hour, 0, 0))
  )
  viewer.clock.multiplier = ui.multiplier
  viewer.clock.shouldAnimate = ui.animate
  refreshTimeText()
  viewer.scene.requestRender()
}

function refreshTimeText(): void {
  const viewer = base.viewer.value
  if (!viewer || viewer.isDestroyed()) return
  const date = JulianDate.toDate(viewer.clock.currentTime)
  if (!date || Number.isNaN(date.getTime())) return
  timeText.value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} UTC`
}

function onTilesetReady(viewer: Viewer): void {
  viewerRef.value = viewer
  viewer.scene.globe.enableLighting = true
  viewer.clock.canAnimate = true
  applyLight()
  applyTime()
}

onMounted(async () => {
  await base.mount(onTilesetReady)
  const viewer = base.viewer.value
  if (viewer && !viewer.isDestroyed()) {
    const handler = () => refreshTimeText()
    viewer.scene.preRender.addEventListener(handler)
    preRenderOff = () => viewer.scene.preRender.removeEventListener(handler)
  }
})

watch(() => [ui.color, ui.intensity, ui.hdr, ui.globeLighting], applyLight)
watch(() => [ui.year, ui.month, ui.day, ui.hour, ui.multiplier], applyTime)
watch(() => ui.animate, applyTime)

onBeforeUnmount(() => {
  preRenderOff?.()
  preRenderOff = undefined
  base.teardown()
})
</script>

<template>
  <div class="lgt-shell">
    <div :ref="base.container" class="lgt-canvas"></div>

    <div class="lgt-panel">
      <div class="lgt-title">全局主光源 · 太阳光</div>

      <div class="lgt-section">时间<InfoTip title="时间" text="模拟时间决定太阳的天文位置：月份与日期决定赤纬（季节），时刻决定时角（昼夜）。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">年<InfoTip title="年" text="模拟时间中的年份（2024~2030）。年份通过闰年与回归年差异微调太阳赤纬，影响极小但可用于对比。" /></span>
        <input v-model.number="ui.year" class="lgt-range" type="range" min="2024" max="2030" step="1" />
        <span class="lgt-value">{{ ui.year }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">月<InfoTip title="月" text="模拟时间中的月份，决定太阳赤纬（季节），夏季太阳高度角更高。" /></span>
        <input v-model.number="ui.month" class="lgt-range" type="range" min="1" max="12" step="1" />
        <span class="lgt-value">{{ ui.month }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">日<InfoTip title="日" text="模拟时间中的日期，与月份共同决定太阳赤纬。" /></span>
        <input v-model.number="ui.day" class="lgt-range" type="range" min="1" max="28" step="1" />
        <span class="lgt-value">{{ ui.day }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">时刻<InfoTip title="时刻" text="模拟时间中的小时（UTC）。太阳方向由该时间的天文位置自动计算，拖动即可观察受光面与阴影方向变化。" /></span>
        <input v-model.number="ui.hour" class="lgt-range" type="range" min="0" max="23" step="0.25" />
        <span class="lgt-value">{{ ui.hour.toFixed(2) }}h</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">自动播放<InfoTip title="自动播放" text="开启后场景时钟随渲染帧推进（clock.shouldAnimate），昼夜与阴影方向连续变化。" /></span>
        <button
          class="lgt-toggle"
          :class="{ on: ui.animate }"
          :aria-label="ui.animate ? '暂停' : '播放'"
          @click="ui.animate = !ui.animate"
        ><i></i></button>
      </div>
      <div v-if="ui.animate" class="lgt-row">
        <span class="lgt-label">倍速<InfoTip title="倍速" text="时钟倍率（clock.multiplier），每秒推进的模拟秒数；越大昼夜循环越快。" /></span>
        <input v-model.number="ui.multiplier" class="lgt-range" type="range" min="200" max="6000" step="100" />
        <span class="lgt-value">{{ ui.multiplier }}×</span>
      </div>

      <div class="lgt-section">光源参数<InfoTip title="光源参数" text="太阳光使用 SunLight，方向不需要手工指定，由当前场景时间的天文计算得到；此处仅调整颜色、强度与渲染开关。" /></div>
      <div class="lgt-row">
        <span class="lgt-label">颜色<InfoTip title="颜色" text="太阳光颜色，傍晚可调暖色以模拟低空大气散射。" /></span>
        <input v-model="ui.color" class="lgt-color" type="color" />
        <span class="lgt-value">{{ ui.color }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">强度<InfoTip title="强度" text="太阳光强度，0 为无直射光只剩环境光。" /></span>
        <input v-model.number="ui.intensity" class="lgt-range" type="range" min="0" max="6" step="0.1" />
        <span class="lgt-value">{{ ui.intensity.toFixed(1) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">地形光照<InfoTip title="地形光照" text="是否让地表参与光照计算（globe.enableLighting）。" /></span>
        <button class="lgt-toggle" :class="{ on: ui.globeLighting }" @click="ui.globeLighting = !ui.globeLighting"><i></i></button>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">HDR<InfoTip title="HDR" text="高动态范围渲染开关。" /></span>
        <button class="lgt-toggle" :class="{ on: ui.hdr }" @click="ui.hdr = !ui.hdr"><i></i></button>
      </div>

      <div class="lgt-hud">{{ timeText }}<InfoTip title="当前时间" text="当前模拟时间（UTC），由上方时间参数实时推算，用于对照画面中的受光方向与阴影长度。" /></div>
      <p class="lgt-hint">SunLight 无方向参数，方向由当前时间对应的太阳位置自动计算；拖拽时刻滑杆即可观察建筑受光面与阴影方向随日照角变化。</p>
    </div>

    <div v-if="base.statusMessage.value" class="lgt-status">{{ base.statusMessage.value }}</div>
  </div>
</template>
