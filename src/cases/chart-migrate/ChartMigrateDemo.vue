<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Rectangle, type Viewer } from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import { ChartLayer } from '../../lib/cesium-chart'
import { BJData, GZData, geoCoordMap, PLANE_PATH, SHData } from './data'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const enabled = ref(true)

let viewer: Viewer | undefined
let chartLayer: ChartLayer | undefined

type MigratePair = { from: string; to: { name: string; value: number } }

function convertData(data: MigratePair[]): { fromName: string; toName: string; coords: [number, number][]; value: number }[] {
  const res: { fromName: string; toName: string; coords: [number, number][]; value: number }[] = []
  for (const item of data) {
    const fromCoord = geoCoordMap[item.from]
    const toCoord = geoCoordMap[item.to.name]
    if (fromCoord && toCoord) {
      res.push({
        fromName: item.from,
        toName: item.to.name,
        coords: [fromCoord, toCoord],
        value: item.to.value
      })
    }
  }
  return res
}

function buildOption(): Record<string, unknown> {
  const color = ['#a6c84c', '#ffa022', '#46bee9']
  const groups: [string, MigratePair[]][] = [
    ['北京', BJData],
    ['上海', SHData],
    ['广州', GZData]
  ]
  const series: unknown[] = []
  groups.forEach((item, i) => {
    const data = convertData(item[1])
    series.push(
      {
        name: `${item[0]} Top10`,
        type: 'lines',
        coordinateSystem: 'GLMap',
        zlevel: 1,
        effect: {
          show: true,
          period: 6,
          trailLength: 0.7,
          color: '#fff',
          symbolSize: 3
        },
        lineStyle: {
          normal: {
            color: color[i],
            width: 0,
            curveness: 0.2
          }
        },
        data
      },
      {
        name: `${item[0]} Top10`,
        type: 'lines',
        coordinateSystem: 'GLMap',
        zlevel: 2,
        symbol: ['none', 'arrow'],
        symbolSize: 10,
        effect: {
          show: true,
          period: 6,
          trailLength: 0,
          symbol: PLANE_PATH,
          symbolSize: 15
        },
        lineStyle: {
          normal: {
            color: color[i],
            width: 1,
            opacity: 0.6,
            curveness: 0.2
          }
        },
        data
      },
      {
        name: `${item[0]} Top10`,
        type: 'effectScatter',
        coordinateSystem: 'GLMap',
        zlevel: 2,
        rippleEffect: {
          brushType: 'stroke'
        },
        label: {
          normal: {
            show: true,
            position: 'right',
            formatter: '{b}'
          }
        },
        symbolSize: (val: number[]) => val[2] / 8,
        itemStyle: {
          normal: {
            color: color[i]
          }
        },
        data: item[1].map((pair) => ({
          name: pair.to.name,
          value: geoCoordMap[pair.to.name].concat([pair.to.value])
        }))
      }
    )
  })
  return {
    title: {
      text: '模拟迁徙',
      subtext: '数据纯属虚构',
      left: 'center',
      textStyle: { color: '#fff' }
    },
    legend: {
      orient: 'vertical',
      top: 'bottom',
      left: 'right',
      data: ['北京 Top10', '上海 Top10', '广州 Top10'],
      textStyle: { color: '#fff' },
      selectedMode: 'multiple'
    },
    series
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
    chartLayer = new ChartLayer('chart-migrate', viewer)
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
      <div class="panel-title">模拟迁徙效果</div>
      <div class="row">
        <span class="row-label">显示图层</span>
        <button class="toggle" :class="{ on: enabled }" :aria-label="enabled ? '隐藏图层' : '显示图层'" @click="enabled = !enabled; onEnableChange(enabled)"><i></i></button>
      </div>
      <p class="hint">
        北京、上海、广州三大枢纽各向 10 个城市迁徙，双层流动线（白点尾迹 + 飞机符号），目的地叠加涟漪散点，右下角图例可开关各枢纽线路。
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
