<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Cartesian3, Rectangle, type Viewer } from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import { ChartLayer } from '../../lib/cesium-chart'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const enabled = ref(true)

let viewer: Viewer | undefined
let chartLayer: ChartLayer | undefined

const chinaGeoCoordMap: Record<string, [number, number]> = {
  黑龙江: [127.9688, 45.368],
  内蒙古: [110.3467, 41.4899],
  吉林: [125.8154, 44.2584],
  北京市: [116.4551, 40.2539],
  辽宁: [123.1238, 42.1216],
  河北: [114.4995, 38.1006],
  天津: [117.4219, 39.4189],
  山西: [112.3352, 37.9413],
  陕西: [109.1162, 34.2004],
  甘肃: [103.5901, 36.3043],
  宁夏: [106.3586, 38.1775],
  青海: [101.4038, 36.8207],
  新疆: [87.9236, 43.5883],
  西藏: [91.11, 29.97],
  四川: [103.9526, 30.7617],
  重庆: [108.384366, 30.439702],
  山东: [117.1582, 36.8701],
  河南: [113.4668, 34.6234],
  江苏: [118.8062, 31.9208],
  安徽: [117.29, 32.0581],
  湖北: [114.3896, 30.6628],
  浙江: [119.5313, 29.8773],
  福建: [119.4543, 25.9222],
  江西: [116.0046, 28.6633],
  湖南: [113.0823, 28.2568],
  贵州: [106.6992, 26.7682],
  云南: [102.9199, 25.4663],
  广东: [113.12244, 23.009505],
  广西: [108.479, 23.1152],
  海南: [110.3893, 19.8516],
  上海: [121.4648, 31.2891]
}

const TARGET = '北京市'
const TARGET_COORD = chinaGeoCoordMap[TARGET]

const provinces = Object.keys(chinaGeoCoordMap).filter((name) => name !== TARGET)
const chinaDatas = provinces.map((name) => [{ name, value: Math.floor(Math.random() * 6) + 1 }])

function convertData(data: { name: string; value: number }[][]): { coord: [number, number]; value: number }[][] {
  return data
    .map((item) => {
      const fromCoord = chinaGeoCoordMap[item[0].name]
      if (fromCoord && TARGET_COORD) {
        return [
          { coord: fromCoord, value: item[0].value },
          { coord: TARGET_COORD, value: 0 }
        ]
      }
      return null
    })
    .filter((v): v is { coord: [number, number]; value: number }[] => v !== null)
}

function buildOption(): Record<string, unknown> {
  const series: unknown[] = [
    {
      type: 'lines',
      zlevel: 2,
      coordinateSystem: 'GLMap',
      effect: {
        show: true,
        period: 4,
        trailLength: 0.02,
        symbol: 'arrow',
        symbolSize: 5
      },
      lineStyle: {
        normal: {
          width: 1,
          opacity: 1,
          curveness: 0.3
        }
      },
      data: convertData(chinaDatas)
    },
    {
      type: 'effectScatter',
      coordinateSystem: 'GLMap',
      zlevel: 2,
      rippleEffect: {
        period: 4,
        brushType: 'stroke',
        scale: 4
      },
      label: {
        normal: {
          show: true,
          position: 'right',
          offset: [5, 0],
          formatter: (params: { data: { name: string } }) => params.data.name,
          fontSize: 13
        },
        emphasis: { show: true }
      },
      symbol: 'circle',
      symbolSize: (val: number[]) => 5 + val[2] * 5,
      itemStyle: {
        normal: { show: false, color: '#f00' }
      },
      data: chinaDatas.map((item) => ({
        name: item[0].name,
        value: chinaGeoCoordMap[item[0].name].concat([item[0].value])
      }))
    },
    {
      type: 'scatter',
      coordinateSystem: 'GLMap',
      zlevel: 2,
      rippleEffect: {
        period: 4,
        brushType: 'stroke',
        scale: 4
      },
      label: {
        normal: {
          show: true,
          position: 'right',
          color: '#0f0',
          formatter: '{b}',
          textStyle: { color: '#0f0' }
        },
        emphasis: { show: true, color: '#f60' }
      },
      symbol: 'pin',
      symbolSize: 50,
      data: [{ name: TARGET, value: TARGET_COORD.concat([10]) }]
    }
  ]
  return { series }
}

function onEnableChange(value: boolean): void {
  if (chartLayer) chartLayer.show = value
}

onMounted(async () => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    if (!viewer || viewer.isDestroyed()) return
    viewer.camera.setView({
      destination: Rectangle.fromDegrees(73, 18, 135, 54)
    })
    viewer.camera.percentageChanged = 0.02
    chartLayer = new ChartLayer('chart-message', viewer)
    chartLayer.setOption(buildOption())
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  chartLayer?.destroy()
  chartLayer = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="cm-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">信息发送效果</div>
      <div class="row">
        <span class="row-label">显示图层</span>
        <button class="toggle" :class="{ on: enabled }" :aria-label="enabled ? '隐藏图层' : '显示图层'" @click="enabled = !enabled; onEnableChange(enabled)"><i></i></button>
      </div>
      <p class="hint">
        各省份以流动箭头线向北京市发送信息，各省级站点叠加涟漪特效散点，目标城市以大头针标注。图层为 ECharts 叠加层，随相机移动实时投影到地图位置。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.cm-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; left: 12px; z-index: 10; width: 260px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.row-label { color: #c3d5e8; font-size: 11px; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(157, 188, 224, 0.35); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform 0.2s; }
.toggle.on { background: #2f80ed; }
.toggle.on i { transform: translateX(18px); }
.hint { margin: 10px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
