<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Rectangle, type Viewer } from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import { ChartLayer } from '../../lib/cesium-chart'
import { pm25Data, pm25GeoCoordMap, type Pm25Item } from './data'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const enabled = ref(true)

let viewer: Viewer | undefined
let chartLayer: ChartLayer | undefined

function convertData(data: Pm25Item[]): { name: string; value: number[] }[] {
  const res: { name: string; value: number[] }[] = []
  for (const item of data) {
    const geoCoord = pm25GeoCoordMap[item.name]
    if (geoCoord) {
      res.push({
        name: item.name,
        value: geoCoord.concat(item.value)
      })
    }
  }
  return res
}

function buildOption(): Record<string, unknown> {
  const all = convertData(pm25Data)
  const top6 = [...all].sort((a, b) => b.value[2] - a.value[2]).slice(0, 6)
  return {
    series: [
      {
        name: 'pm2.5',
        type: 'scatter',
        coordinateSystem: 'GLMap',
        data: all,
        symbolSize: (val: number[]) => val[2] / 10,
        label: {
          normal: {
            formatter: '{b}',
            position: 'right',
            show: false
          },
          emphasis: { show: true }
        },
        itemStyle: {
          normal: { color: '#ddb926' }
        }
      },
      {
        name: 'Top 5',
        type: 'effectScatter',
        coordinateSystem: 'GLMap',
        data: top6,
        symbolSize: (val: number[]) => val[2] / 10,
        showEffectOn: 'render',
        rippleEffect: {
          brushType: 'stroke'
        },
        hoverAnimation: true,
        label: {
          normal: {
            formatter: '{b}',
            position: 'right',
            show: true
          }
        },
        itemStyle: {
          normal: {
            color: '#f4e925',
            shadowBlur: 10,
            shadowColor: '#333'
          }
        },
        zlevel: 1
      }
    ]
  }
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
    chartLayer = new ChartLayer('chart-pm25', viewer)
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
      <div class="panel-title">PM2.5 浓度分布</div>
      <div class="row">
        <span class="row-label">显示图层</span>
        <button class="toggle" :class="{ on: enabled }" :aria-label="enabled ? '隐藏图层' : '显示图层'" @click="enabled = !enabled; onEnableChange(enabled)"><i></i></button>
      </div>
      <p class="hint">
        全国 190 个城市 PM2.5 浓度以散点呈现，圆点大小与浓度成正比；浓度 Top6 城市以黄色涟漪散点高亮并标注城市名。
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
