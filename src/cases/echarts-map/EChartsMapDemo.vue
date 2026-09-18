<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import * as echarts from 'echarts'
import {
  Cartesian3,
  Cartographic,
  CustomDataSource,
  HorizontalOrigin,
  Math as CesiumMath,
  NearFarScalar,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Property,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'

const container = ref<HTMLElement | null>(null)
const chartContainer = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const isLoaded = ref(false)
const isRendering = ref(false)
const isPicking = ref(false)
const optionText = ref('')
const templateIndex = ref(0)
const lonInput = ref<number | null>(118)
const latInput = ref<number | null>(26)
const chartCount = ref(0)

const TEMPLATES: { name: string; option: string }[] = [
  {
    name: '柱状图',
    option: JSON.stringify(
      {
        xAxis: [
          {
            type: 'category',
            data: ['样例A', '样例B'],
            axisLabel: { show: true, color: '#ff6b6b', fontSize: 12, fontWeight: 'bolder' }
          }
        ],
        yAxis: [{ show: false, type: 'value' }],
        series: [
          { name: '数据1', type: 'bar', barGap: 0, data: [120, 332] },
          { name: '数据2', type: 'bar', data: [78, 232] },
          { name: '数据3', type: 'bar', data: [220, 382] },
          { name: '数据4', type: 'bar', data: [150, 232] },
          { name: '数据5', type: 'bar', data: [162, 118] }
        ]
      },
      null,
      2
    )
  },
  {
    name: '玫瑰饼图',
    option: JSON.stringify(
      {
        series: [
          {
            name: 'Area Mode',
            type: 'pie',
            radius: [10, 80],
            roseType: 'area',
            itemStyle: { borderRadius: 5 },
            label: { show: false },
            data: [
              { value: 30, name: '数据 1' },
              { value: 28, name: '数据 2' },
              { value: 26, name: '数据 3' },
              { value: 24, name: '数据 4' },
              { value: 22, name: '数据 5' }
            ]
          }
        ]
      },
      null,
      2
    )
  },
  {
    name: '折线图',
    option: JSON.stringify(
      {
        xAxis: {
          type: 'category',
          data: ['数据1', '数据2', '数据3', '数据4', '数据5'],
          axisLabel: { show: true, color: '#ff6b6b', fontSize: 12, fontWeight: 'bolder' }
        },
        yAxis: { show: false },
        series: [
          { data: [420, 232, 401, 434, 290], type: 'line', smooth: true },
          { data: [520, 332, 551, 334, 190], type: 'line', smooth: true },
          { data: [220, 92, 801, 434, 290], type: 'line', smooth: true }
        ]
      },
      null,
      2
    )
  }
]

const SCALE_DEFAULTS = {
  near: 1000,
  far: 100000,
  nearScale: 1.3,
  farScale: 0.08
}
const scaleParams = reactive({ ...SCALE_DEFAULTS })

const params = reactive({
  width: 200,
  height: 350
})

type ChartItem = {
  coord: [number, number]
  size: [number, number]
  option: Record<string, unknown>
}

let viewer: Viewer | undefined
let chartDataSource: CustomDataSource | undefined
let pickHandler: ScreenSpaceEventHandler | undefined
let activeChart: echarts.ECharts | undefined

const chartItems: ChartItem[] = []

function buildScale(): NearFarScalar {
  return new NearFarScalar(scaleParams.near, scaleParams.nearScale, scaleParams.far, scaleParams.farScale)
}

function applyScaleParams(): void {
  if (!viewer || viewer.isDestroyed() || !chartDataSource) return
  const scalar = buildScale()
  chartDataSource.entities.values.forEach((entity) => {
    if (entity.billboard) {
      entity.billboard.scaleByDistance = scalar as unknown as Property
    }
  })
}

function clearBillboards(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (chartDataSource) {
    chartDataSource.entities.removeAll()
  }
  chartItems.length = 0
  chartCount.value = 0
}

function deleteLastChart(): void {
  if (!viewer || viewer.isDestroyed() || !chartDataSource) return
  const entities = chartDataSource.entities.values
  if (entities.length > 0) {
    chartDataSource.entities.remove(entities[entities.length - 1])
    chartItems.pop()
    chartCount.value = chartItems.length
  }
}

async function renderChartToImage(option: Record<string, unknown>, size: [number, number]): Promise<string> {
  if (!chartContainer.value) throw new Error('离屏渲染容器不可用')
  chartContainer.value.style.width = `${size[0]}px`
  chartContainer.value.style.height = `${size[1]}px`
  const myChart = echarts.init(chartContainer.value)
  activeChart = myChart
  await new Promise<void>((resolve) => {
    let settled = false
    const done = () => {
      if (!settled) {
        settled = true
        resolve()
      }
    }
    myChart.on('finished', done)
    myChart.setOption({ ...option, animation: false })
    setTimeout(done, 600)
  })
  const canvas = chartContainer.value.querySelector('canvas')
  if (!canvas) throw new Error('图表渲染未生成画布')
  const img = canvas.toDataURL('image/png')
  myChart.dispose()
  activeChart = undefined
  return img
}

function addChartEntity(item: ChartItem, image: string): void {
  if (!viewer || viewer.isDestroyed() || !chartDataSource) return
  chartDataSource.entities.add({
    position: Cartesian3.fromDegrees(item.coord[0], item.coord[1]),
    billboard: {
      image,
      horizontalOrigin: HorizontalOrigin.CENTER,
      verticalOrigin: VerticalOrigin.BOTTOM,
      alignedAxis: Cartesian3.ZERO,
      width: item.size[0],
      height: item.size[1],
      scaleByDistance: buildScale() as unknown as Property
    }
  })
  chartItems.push(item)
  chartCount.value = chartItems.length
}

async function addChart(coord: [number, number], option: Record<string, unknown>, size: [number, number]): Promise<void> {
  if (!viewer || viewer.isDestroyed() || isRendering.value) return
  if (!chartDataSource) {
    chartDataSource = await viewer.dataSources.add(new CustomDataSource('echarts-charts'))
  }
  isRendering.value = true
  try {
    const img = await renderChartToImage(option, size)
    addChartEntity({ coord, size, option }, img)
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    isRendering.value = false
  }
}

function onTemplateChange(): void {
  optionText.value = TEMPLATES[templateIndex.value]?.option ?? ''
}

async function handleAddClick(): Promise<void> {
  if (isPicking.value) {
    statusMessage.value = '拾取模式已开启，请在地图上点击目标位置添加图表'
    return
  }
  let option: Record<string, unknown>
  try {
    option = JSON.parse(optionText.value)
  } catch (error) {
    statusMessage.value = 'Options JSON 解析失败，请检查格式'
    return
  }
  if (lonInput.value == null || latInput.value == null) {
    statusMessage.value = '请输入经度/纬度，或开启拾取模式点击地图'
    return
  }
  await addChart([lonInput.value, latInput.value], option, [params.width, params.height])
}

async function rerenderAll(): Promise<void> {
  if (!viewer || viewer.isDestroyed() || isRendering.value) return
  if (!chartDataSource) return
  isRendering.value = true
  try {
    const items = [...chartItems]
    chartDataSource.entities.removeAll()
    chartItems.length = 0
    for (const item of items) {
      const img = await renderChartToImage(item.option, item.size)
      addChartEntity(item, img)
    }
    chartCount.value = chartItems.length
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    isRendering.value = false
  }
}

function togglePicking(): void {
  if (!viewer || viewer.isDestroyed()) return
  isPicking.value = !isPicking.value
  if (isPicking.value) {
    if (!pickHandler) {
      pickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas)
      pickHandler.setInputAction((movement: ScreenSpaceEventHandler.PositionedEvent) => {
        if (!isPicking.value || !viewer || viewer.isDestroyed()) return
        const ray = viewer.camera.getPickRay(movement.position)
        if (!ray) return
        const picked = viewer.scene.globe.pick(ray, viewer.scene)
        if (!picked) return
        const carto = Cartographic.fromCartesian(picked)
        const lon = CesiumMath.toDegrees(carto.longitude)
        const lat = CesiumMath.toDegrees(carto.latitude)
        lonInput.value = Number(lon.toFixed(6))
        latInput.value = Number(lat.toFixed(6))
        let option: Record<string, unknown>
        try {
          option = JSON.parse(optionText.value)
        } catch (error) {
          return
        }
        addChart([lon, lat], option, [params.width, params.height])
      }, ScreenSpaceEventType.LEFT_CLICK)
    }
    statusMessage.value = '拾取模式已开启，点击地图即可在对应位置添加图表（再次点击按钮关闭）'
  } else {
    statusMessage.value = ''
  }
}

onMounted(async () => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => {
      statusMessage.value = message
    },
    onBasemapReady: () => {
      statusMessage.value = '底图已就绪，正在渲染示例图表…'
    }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    if (!viewer || viewer.isDestroyed()) return
    viewer.camera.flyTo({
      destination: new Cartesian3(-2744676.6256837887, 5118433.105031765, 2843129.6830630316)
    })
    isLoaded.value = true
    onTemplateChange()
    await addChart([118, 26], JSON.parse(TEMPLATES[0].option) as Record<string, unknown>, [200, 350])
    await addChart([118.3, 26.3], JSON.parse(TEMPLATES[1].option) as Record<string, unknown>, [200, 350])
    await addChart([118.15, 26.12], JSON.parse(TEMPLATES[2].option) as Record<string, unknown>, [200, 250])
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (pickHandler && !pickHandler.isDestroyed()) {
    pickHandler.destroy()
    pickHandler = undefined
  }
  if (activeChart && !activeChart.isDisposed()) {
    activeChart.dispose()
    activeChart = undefined
  }
  if (viewer && !viewer.isDestroyed()) {
    if (chartDataSource) {
      viewer.dataSources.remove(chartDataSource, true)
      chartDataSource = undefined
    }
  }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="echarts-map-shell">
    <div ref="container" class="cesium-container"></div>
    <div ref="chartContainer" class="chart-renderer"></div>

    <div class="control-panel">
      <div class="panel-title">ECharts 图表叠加</div>

      <div class="form-row">
        <span class="form-label">模板</span>
        <select v-model="templateIndex" class="form-input" @change="onTemplateChange">
          <option v-for="(t, i) in TEMPLATES" :key="i" :value="i">{{ t.name }}</option>
        </select>
      </div>

      <textarea v-model="optionText" class="option-editor" spellcheck="false" placeholder="输入 ECharts Options JSON"></textarea>

      <div class="form-row">
        <span class="form-label">经度</span>
        <input v-model.number="lonInput" class="form-input" type="number" step="0.000001" placeholder="118.0" />
      </div>
      <div class="form-row">
        <span class="form-label">纬度</span>
        <input v-model.number="latInput" class="form-input" type="number" step="0.000001" placeholder="26.0" />
      </div>
      <div class="form-row">
        <span class="form-label">图宽</span>
        <input v-model.number="params.width" class="form-input" type="number" step="10" min="50" />
      </div>
      <div class="form-row">
        <span class="form-label">图高</span>
        <input v-model.number="params.height" class="form-input" type="number" step="10" min="50" />
      </div>

      <details class="scale-params">
        <summary>缩放参数（相机距离联动）</summary>
        <div class="form-row">
          <span class="form-label">近距</span>
          <input v-model.number="scaleParams.near" class="form-input" type="number" step="500" min="0" />
        </div>
        <div class="form-row">
          <span class="form-label">远距</span>
          <input v-model.number="scaleParams.far" class="form-input" type="number" step="5000" min="1000" />
        </div>
        <div class="form-row">
          <span class="form-label">近端缩放</span>
          <input v-model.number="scaleParams.nearScale" class="form-input" type="number" step="0.1" min="0.1" />
        </div>
        <div class="form-row">
          <span class="form-label">远端缩放</span>
          <input v-model.number="scaleParams.farScale" class="form-input" type="number" step="0.01" min="0.01" />
        </div>
      </details>

      <button class="action-button primary" :disabled="!isLoaded || isRendering" @click="handleAddClick">
        {{ isRendering ? '渲染中…' : '添加图表' }}
      </button>
      <button class="action-button accent" :disabled="!isLoaded || isRendering" @click="rerenderAll">按参数重新渲染全部</button>
      <button
        class="action-button pick"
        :class="{ active: isPicking }"
        :disabled="!isLoaded"
        @click="togglePicking"
      >
        {{ isPicking ? '拾取模式开启中…' : '点击地图拾取坐标添加' }}
      </button>
      <div class="button-row">
        <button class="action-button" :disabled="!isLoaded || chartCount === 0" @click="deleteLastChart">
          删除最近
        </button>
        <button class="action-button danger" :disabled="!isLoaded || chartCount === 0" @click="clearBillboards">
          清除全部
        </button>
      </div>

      <p class="hint">
        已添加 {{ chartCount }} 个图表。图表尺寸随相机距离动态缩放（近大远小），可在「缩放参数」中调整联动范围。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.echarts-map-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.chart-renderer { position: absolute; left: -9999px; top: 0; z-index: -1; width: 200px; height: 350px; pointer-events: none; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 272px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.9); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.form-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.form-label { flex: 0 0 56px; font-size: 10px; color: #9fb8d4; text-align: right; }
.form-input { flex: 1; min-width: 0; height: 24px; padding: 0 6px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 4px; background: rgba(18, 36, 66, 0.8); color: #e8f1fc; font-size: 11px; box-sizing: border-box; }
.option-editor { width: 100%; height: 96px; margin-top: 8px; padding: 6px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 4px; background: rgba(18, 36, 66, 0.8); color: #e8f1fc; font-size: 10px; font-family: monospace; line-height: 1.4; resize: vertical; box-sizing: border-box; }
.scale-params { margin-top: 8px; }
.scale-params summary { font-size: 10px; color: #9fb8d4; cursor: pointer; }
.action-button { width: 100%; height: 26px; margin-top: 8px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.action-button.primary { background: #2f80ed; }
.action-button.accent { background: #3a5a8a; }
.action-button.pick { background: #5a6a8a; }
.action-button.pick.active { background: #e8791e; color: #fff; }
.action-button.danger { background: #8a3a3a; color: #ffd6d6; }
.button-row { display: flex; gap: 6px; }
.button-row .action-button { flex: 1; margin-top: 8px; }
.action-button:disabled { opacity: 0.45; cursor: not-allowed; }
.hint { margin: 8px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
