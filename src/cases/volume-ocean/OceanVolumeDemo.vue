<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Cartesian2, ScreenSpaceEventHandler, ScreenSpaceEventType, type Viewer } from 'cesium'
import JSZip from 'jszip'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import { OCEAN_CAMERA_PRESETS, OCEAN_QUALITY_PRESETS, OCEAN_REGIONS, OCEAN_VARIABLES } from './ocean-tsd.config'
import type { OceanAnalysisMode, OceanVariable, OceanVisibleLayers } from './ocean-tsd.types'
import { useOceanTsdState } from './useOceanTsdState'
import OceanLegend from './ui/OceanLegend.vue'
import OceanProfileChart from './ui/OceanProfileChart.vue'
import OceanSectionChart from './ui/OceanSectionChart.vue'
import OceanTsChart from './ui/OceanTsChart.vue'
import OceanHistogramChart from './ui/OceanHistogramChart.vue'

const container = ref<HTMLElement | null>(null)
let viewer: Viewer | undefined
const getViewer = () => viewer

const state = useOceanTsdState(getViewer)
const {
  ui,
  status,
  error,
  progress,
  manifest,
  timeLabels,
  maxDepthM,
  webglSupported,
  profilePoint,
  sectionA,
  sectionB,
  profile,
  stratification,
  stratificationLabel,
  statistics,
  section,
  tsPoints,
  histogram,
  domainRanges,
  variableView,
  colorRange
} = state

const regionSelection = ref(ui.datasetId)
const qualitySelection = ref(ui.renderQuality)
const readout = ref<{ lon: number; lat: number; depthM: number; value: number; valid: boolean } | null>(null)
const playing = ref(false)
let playTimer: ReturnType<typeof setInterval> | undefined
const downloading = ref(false)
const downloadMessage = ref('')

const clip = reactive({ enabled: false, azimuth: 45, tilt: 0, offsetPct: 0 })

const LAYERS: Array<{ key: keyof OceanVisibleLayers; label: string }> = [
  { key: 'volume', label: '水体渲染' },
  { key: 'bathymetry', label: '海底地形' },
  { key: 'horizontalSlice', label: '水平切片' },
  { key: 'verticalSection', label: '垂直断面' },
  { key: 'isosurface', label: '等值面（体素壳）' },
  { key: 'currents', label: '流场箭头' }
]

const ANALYSIS_TABS: Array<{ key: OceanAnalysisMode; label: string }> = [
  { key: 'profile', label: '垂向剖面' },
  { key: 'section', label: 'A–B 断面' },
  { key: 'ts', label: 'T–S 散点' },
  { key: 'statistics', label: '统计分布' }
]

const timeKindLabel: Record<string, string> = {
  demo: '程序化示例数据',
  observation: '实测观测',
  reanalysis: '再分析产品',
  'monthly-climatology': '月气候态'
}

const currentTimeLabel = computed(() => timeLabels.value[ui.timeIndex] ?? '—')
const statusText = computed(() => {
  if (error.value) return error.value
  if (status.value === 'loading') return progress.value || '正在加载…'
  if (status.value === 'ready' && manifest.value) {
    const g = manifest.value.grid
    return `${manifest.value.regionName} · ${g.nx}×${g.ny}×${g.nz} · ${currentTimeLabel.value}`
  }
  return '等待加载'
})
const dataNote = computed(() => {
  const m = manifest.value
  if (!m) return ''
  return `数据来源：${m.source} · 类型：${timeKindLabel[m.timeKind] ?? m.timeKind} · ${m.timeNote} · 许可：${m.license}`
})
const depthStep = computed(() => (maxDepthM.value > 1500 ? 10 : 5))
const isoRange = computed(() => colorRange.value)
const profileSeabed = computed(() => (profile.value ? profile.value.seabedM : NaN))

function formatValue(value: number, decimals = 2): string {
  return Number.isFinite(value) ? value.toFixed(decimals) : '缺测'
}

function onRegionChange(event: Event): void {
  const id = (event.target as HTMLSelectElement).value
  regionSelection.value = id
  void state.load(id)
}

function onQualityChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  qualitySelection.value = value as typeof ui.renderQuality
  state.setQuality(value)
}

function onVariable(key: OceanVariable): void {
  state.setVariable(key)
}

function onDepth(event: Event): void {
  state.setDepth(Number((event.target as HTMLInputElement).value))
}

function onCurrentDepth(event: Event): void {
  state.setCurrentDepth(Number((event.target as HTMLInputElement).value))
}

function onOpacity(event: Event): void {
  state.setOpacity(Number((event.target as HTMLInputElement).value))
}

function onExaggeration(event: Event): void {
  state.setVerticalExaggeration(Number((event.target as HTMLInputElement).value))
}

function onLift(event: Event): void {
  state.setLiftFactor(Number((event.target as HTMLInputElement).value))
}

function onIso(event: Event): void {
  state.setIsoValue(Number((event.target as HTMLInputElement).value))
}

function onAutoRange(event: Event): void {
  state.setColorRangeMode((event.target as HTMLInputElement).checked)
}

function onFixedMin(event: Event): void {
  state.setFixedColorRange(Number((event.target as HTMLInputElement).value), ui.fixedColorRange[1])
}

function onFixedMax(event: Event): void {
  state.setFixedColorRange(ui.fixedColorRange[0], Number((event.target as HTMLInputElement).value))
}

function onClip(): void {
  state.setClip({ ...clip })
}

function onToggleLayer(key: keyof OceanVisibleLayers): void {
  state.toggleLayer(key)
}

function onCamera(key: string): void {
  state.flyTo(key)
}

function onTime(event: Event): void {
  void state.setTime(Number((event.target as HTMLInputElement).value))
}

function togglePlay(): void {
  playing.value = !playing.value
  if (playing.value) {
    playTimer = setInterval(() => {
      const count = timeLabels.value.length
      if (count === 0) return
      const next = (ui.timeIndex + 1) % count
      void state.setTime(next)
    }, 1600)
  } else if (playTimer) {
    clearInterval(playTimer)
    playTimer = undefined
  }
}

function onAnalysisMode(mode: OceanAnalysisMode): void {
  state.setAnalysisMode(mode)
}

function onProfilePoint(): void {
  state.moveProfilePointTo(profilePoint.lon, profilePoint.lat)
}

function onSectionChange(): void {
  state.updateSection()
}

let pickQueued = false
function onMouseMove(position: Cartesian2): void {
  if (pickQueued) return
  pickQueued = true
  requestAnimationFrame(() => {
    pickQueued = false
    readout.value = state.pickAt(position.x, position.y)
  })
}

function onClick(position: Cartesian2): void {
  const hit = state.pickAt(position.x, position.y)
  if (hit) {
    profilePoint.lon = hit.lon
    profilePoint.lat = hit.lat
    state.moveProfilePointTo(hit.lon, hit.lat)
  }
}

function currentRegionPreset() {
  return OCEAN_REGIONS.find((r) => r.id === ui.datasetId) ?? OCEAN_REGIONS[0]
}

function regionFileUrl(dataDir: string, file: string): string {
  const base = import.meta.env.BASE_URL ?? '/'
  const prefix = base.endsWith('/') ? base : `${base}/`
  return `${prefix}${dataDir}/${file}`
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function sampleReadme(regionName: string, dataDir: string): string {
  const m = manifest.value
  return [
    '海洋分析-温盐深三维体 · 样本数据',
    `区域: ${regionName}`,
    `数据目录: ${dataDir}`,
    `时间性质: ${m?.timeKind ?? ''}`,
    `数据说明: ${m?.timeNote ?? ''}`,
    `来源: ${m?.source ?? ''}`,
    `许可: ${m?.license ?? ''}`,
    '',
    '文件说明:',
    '  manifest.json    数据清单（来源/单位/分辨率/量化参数/文件列表）',
    '  coords.bin       经纬度与深度坐标',
    '  bathymetry.bin   海底地形',
    '  mask.bin         有效海水掩膜',
    '  frames/MM.bin    12 个月数据帧（uint16，解码 = raw*scale + offset，65535 缺测）',
    '',
    '二进制布局见 scripts/ocean-tsd/README.md。'
  ].join('\n')
}

async function downloadSampleZip(): Promise<void> {
  const m = manifest.value
  if (!m || downloading.value) return
  downloading.value = true
  downloadMessage.value = '正在打包样本数据…'
  try {
    const region = currentRegionPreset()
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify(m, null, 2))
    const files = [m.files.coords, m.files.bathymetry, m.files.mask, ...m.files.frames]
    let done = 0
    for (const file of files) {
      const response = await fetch(regionFileUrl(region.dataDir, file))
      if (!response.ok) throw new Error(`${file} 请求失败（${response.status}）`)
      zip.file(file, await response.arrayBuffer())
      done += 1
      downloadMessage.value = `正在打包样本数据…（${done}/${files.length}）`
    }
    zip.file('README.txt', sampleReadme(m.regionName, region.dataDir))
    const blob = await zip.generateAsync({ type: 'blob' })
    triggerDownload(blob, `ocean-tsd-${region.id}-sample.zip`)
    downloadMessage.value = '样本数据已下载。'
  } catch (err) {
    downloadMessage.value = `样本数据下载失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    downloading.value = false
  }
}

function csvMetadataHeader(): string[] {
  const m = manifest.value
  const region = currentRegionPreset()
  const view = variableView.value
  return [
    '# 案例 = 海洋分析-温盐深三维体',
    `# 区域 = ${m?.regionName ?? region.shortName} (${region.id})`,
    `# 变量 = ${view.label} (${view.key})`,
    `# 单位 = ${view.unit}`,
    `# 时间 = ${currentTimeLabel.value}`,
    `# 数据性质 = ${timeKindLabel[m?.timeKind ?? ''] ?? m?.timeKind ?? ''}`,
    `# 数据说明 = ${m?.timeNote ?? ''}`,
    `# 来源 = ${m?.source ?? ''}`,
    `# 许可 = ${m?.license ?? ''}`,
    `# 生成时间 = ${new Date().toISOString()}`
  ]
}

function downloadExampleCsv(): void {
  const m = manifest.value
  if (!m) return
  const view = variableView.value
  const region = currentRegionPreset()
  const rows: string[] = []
  let modeName = ''
  if (ui.analysisMode === 'section') {
    const s = section.value
    if (!s) {
      downloadMessage.value = '断面数据尚未就绪，无法导出。'
      return
    }
    modeName = 'section'
    rows.push(['distanceKm', 'lon', 'lat', 'depthM', view.key].join(','))
    for (let i = 0; i < s.distanceKm.length; i += 1) {
      for (let j = 0; j < s.depthM.length; j += 1) {
        const value = s.values[i]?.[j] ?? NaN
        if (!Number.isFinite(value)) continue
        rows.push([s.distanceKm[i].toFixed(3), s.lons[i].toFixed(5), s.lats[i].toFixed(5), s.depthM[j].toFixed(1), value].join(','))
      }
    }
  } else if (ui.analysisMode === 'ts') {
    modeName = 'ts'
    rows.push(['salinityPSU', 'temperatureC', 'densityKgM3', 'depthM'].join(','))
    for (const point of tsPoints.value ?? []) {
      if (!point.valid) continue
      rows.push([point.salinity, point.temperatureC, point.densityKgM3, point.depthM].join(','))
    }
  } else if (ui.analysisMode === 'statistics') {
    const st = statistics.value
    if (!st) {
      downloadMessage.value = '统计数据尚未就绪，无法导出。'
      return
    }
    modeName = 'statistics'
    rows.push(['metric', 'value'].join(','))
    rows.push(['variable', st.variable].join(','))
    rows.push(['unit', st.unit].join(','))
    rows.push(['min', st.min].join(','))
    rows.push(['max', st.max].join(','))
    rows.push(['mean', st.mean].join(','))
    rows.push(['median', st.median].join(','))
    rows.push(['p10', st.p10].join(','))
    rows.push(['p90', st.p90].join(','))
    rows.push(['count', st.count].join(','))
    rows.push(['invalidCount', st.invalidCount].join(','))
  } else {
    const p = profile.value
    if (!p) {
      downloadMessage.value = '剖面数据尚未就绪，无法导出。'
      return
    }
    modeName = 'profile'
    rows.push(['depthM', view.key].join(','))
    for (let i = 0; i < p.depthM.length; i += 1) {
      if (!p.valid[i]) continue
      rows.push([p.depthM[i].toFixed(1), p.values[i]].join(','))
    }
  }
  const csv = [...csvMetadataHeader(), ...rows].join('\n')
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `ocean-tsd-${region.id}-${modeName}-${view.key}.csv`)
  downloadMessage.value = '示例数据已下载。'
}

let handler: ScreenSpaceEventHandler | undefined
let sceneReady = false

watch(status, (value) => {
  if (value === 'ready' && !sceneReady) {
    sceneReady = true
    requestAnimationFrame(() => state.flyTo('overview'))
  }
  if (value === 'loading') sceneReady = false
})

onMounted(() => {
  if (!container.value) return
  const callbacks: SceneCallbacks = {
    onStatus: () => undefined,
    onBasemapReady: () => undefined
  }
  try {
    viewer = createMapScene(container.value, callbacks)
    loadBingImagery(viewer, callbacks)
    viewer.scene.requestRenderMode = true
    viewer.scene.maximumRenderTimeChange = Infinity
    handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((movement: { endPosition: Cartesian2 }) => onMouseMove(movement.endPosition), ScreenSpaceEventType.MOUSE_MOVE)
    handler.setInputAction((movement: { position: Cartesian2 }) => onClick(movement.position), ScreenSpaceEventType.LEFT_CLICK)
    void state.load(ui.datasetId)
  } catch (err) {
    console.error(err)
  }
})

onBeforeUnmount(() => {
  if (playTimer) clearInterval(playTimer)
  if (handler && !handler.isDestroyed()) handler.destroy()
  handler = undefined
  state.dispose()
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="ocean-shell">
    <div ref="container" class="cesium-container"></div>

    <header class="top-bar">
      <div class="brand">海洋分析 · 温盐深三维体</div>
      <label class="field">
        <span>区域</span>
        <select :value="regionSelection" @change="onRegionChange">
          <option v-for="region in OCEAN_REGIONS" :key="region.id" :value="region.id">{{ region.shortName }}</option>
        </select>
      </label>
      <div class="var-group">
        <button
          v-for="item in OCEAN_VARIABLES"
          :key="item.key"
          type="button"
          class="var-button"
          :class="{ active: ui.variable === item.key }"
          @click="onVariable(item.key)"
        >
          {{ item.label }}
        </button>
      </div>
      <label class="field">
        <span>质量</span>
        <select :value="qualitySelection" @change="onQualityChange">
          <option v-for="q in OCEAN_QUALITY_PRESETS" :key="q.key" :value="q.key">{{ q.label }}</option>
        </select>
      </label>
      <div class="status-text" :class="{ error: !!error }">{{ statusText }}</div>
    </header>

    <aside class="left-panel">
      <div class="panel-block">
        <h4>图层</h4>
        <label v-for="layer in LAYERS" :key="layer.key" class="layer-row">
          <input type="checkbox" :checked="ui.visibleLayers[layer.key]" @change="onToggleLayer(layer.key)" />
          <span>{{ layer.label }}</span>
        </label>
      </div>

      <div class="panel-block">
        <h4>水平切片</h4>
        <div class="slider-row">
          <span>深度</span>
          <input type="range" min="0" :max="maxDepthM" :step="depthStep" :value="ui.depthM" @input="onDepth" />
          <b>{{ ui.depthM.toFixed(0) }} m</b>
        </div>
      </div>

      <div class="panel-block">
        <h4>流场箭头</h4>
        <div class="slider-row">
          <span>深度</span>
          <input type="range" min="0" :max="maxDepthM" :step="depthStep" :value="ui.currentDepthM" @input="onCurrentDepth" />
          <b>{{ ui.currentDepthM.toFixed(0) }} m</b>
        </div>
      </div>

      <div class="panel-block">
        <h4>体渲染</h4>
        <div class="slider-row">
          <span>不透明度</span>
          <input type="range" min="0.05" max="1" step="0.05" :value="ui.opacity" @input="onOpacity" />
          <b>{{ ui.opacity.toFixed(2) }}</b>
        </div>
        <label class="layer-row">
          <input type="checkbox" :checked="ui.autoColorRange" @change="onAutoRange" />
          <span>颜色范围随数据自适应</span>
        </label>
        <div v-if="!ui.autoColorRange" class="range-row">
          <input type="number" step="0.01" :value="ui.fixedColorRange[0]" @change="onFixedMin" />
          <span>~</span>
          <input type="number" step="0.01" :value="ui.fixedColorRange[1]" @change="onFixedMax" />
        </div>
        <div class="slider-row">
          <span>垂向夸张</span>
          <input type="range" min="1" max="80" step="1" :value="ui.verticalExaggeration" @input="onExaggeration" />
          <b>{{ ui.verticalExaggeration }}×</b>
        </div>
        <div class="slider-row">
          <span>整体抬升</span>
          <input type="range" min="0" max="3" step="0.1" :value="ui.liftFactor" @change="onLift" />
          <b>{{ ui.liftFactor.toFixed(1) }}×</b>
        </div>
        <div class="slider-row">
          <span>等值面值</span>
          <input
            type="range"
            :min="isoRange[0]"
            :max="isoRange[1]"
            :step="(isoRange[1] - isoRange[0]) / 200 || 0.01"
            :value="ui.isosurfaceValue"
            @input="onIso"
          />
          <b>{{ ui.isosurfaceValue.toFixed(2) }}</b>
        </div>
      </div>

      <div class="panel-block">
        <h4>相机视角</h4>
        <div class="chip-row">
          <button v-for="preset in OCEAN_CAMERA_PRESETS" :key="preset.key" type="button" class="chip" @click="onCamera(preset.key)">
            {{ preset.label }}
          </button>
        </div>
      </div>

      <div class="panel-block">
        <h4>任意剖切</h4>
        <label class="layer-row">
          <input type="checkbox" v-model="clip.enabled" @change="onClip" />
          <span>启用剖切</span>
        </label>
        <div class="slider-row">
          <span>方位角</span>
          <input type="range" min="0" max="360" step="1" v-model.number="clip.azimuth" @input="onClip" />
          <b>{{ clip.azimuth }}°</b>
        </div>
        <div class="slider-row">
          <span>倾角</span>
          <input type="range" min="0" max="90" step="1" v-model.number="clip.tilt" @input="onClip" />
          <b>{{ clip.tilt }}°</b>
        </div>
        <div class="slider-row">
          <span>偏移</span>
          <input type="range" min="-100" max="100" step="1" v-model.number="clip.offsetPct" @input="onClip" />
          <b>{{ clip.offsetPct }}%</b>
        </div>
      </div>

      <div class="panel-block">
        <OceanLegend :palette-id="variableView.palette" :color-range="colorRange" :unit="variableView.unit" :label="variableView.label" />
        <p class="note">{{ variableView.note }}</p>
      </div>
    </aside>

    <aside class="right-panel">
      <div class="right-panel-scroll">
      <div class="tabs">
        <button
          v-for="tab in ANALYSIS_TABS"
          :key="tab.key"
          type="button"
          class="tab"
          :class="{ active: ui.analysisMode === tab.key }"
          @click="onAnalysisMode(tab.key)"
        >
          {{ tab.label }}
        </button>
      </div>

      <div v-if="ui.analysisMode === 'profile'" class="analysis-body">
        <div class="coords">
          <span>剖面点</span>
          <input type="number" step="0.05" v-model.number="profilePoint.lon" @change="onProfilePoint" />
          <input type="number" step="0.05" v-model.number="profilePoint.lat" @change="onProfilePoint" />
        </div>
        <div class="chart-frame">
          <OceanProfileChart :profile="profile" :palette-id="variableView.palette" :variable-label="variableView.label" />
        </div>
        <div v-if="stratification" class="stat-list">
          <div class="stat"><span>{{ stratificationLabel }}</span><b>{{ formatValue(stratification.gradientPeakDepthM ?? NaN, 0) }} m</b></div>
          <div class="stat"><span>梯度峰值</span><b>{{ stratification.gradientMax.toExponential(2) }} {{ variableView.unit }}/m</b></div>
          <div class="stat"><span>混合层深度</span><b>{{ stratification.mixingLayerDepthM == null ? '—' : stratification.mixingLayerDepthM.toFixed(0) + ' m' }}</b></div>
          <div class="stat"><span>平均采样间距</span><b>{{ stratification.meanSampleIntervalM.toFixed(1) }} m</b></div>
          <p class="note">{{ stratification.method }}</p>
        </div>
      </div>

      <div v-else-if="ui.analysisMode === 'section'" class="analysis-body">
        <div class="coords">
          <span>A</span>
          <input type="number" step="0.05" v-model.number="sectionA.lon" @change="onSectionChange" />
          <input type="number" step="0.05" v-model.number="sectionA.lat" @change="onSectionChange" />
          <span>B</span>
          <input type="number" step="0.05" v-model.number="sectionB.lon" @change="onSectionChange" />
          <input type="number" step="0.05" v-model.number="sectionB.lat" @change="onSectionChange" />
        </div>
        <div class="chart-frame tall">
          <OceanSectionChart :section="section" :palette-id="variableView.palette" :color-range="colorRange" />
        </div>
        <p class="note">横轴为沿测线的真实距离（km），纵轴为真实深度（m）。黑色包络线为海底。</p>
      </div>

      <div v-else-if="ui.analysisMode === 'ts'" class="analysis-body">
        <div class="chart-frame tall">
          <OceanTsChart :points="tsPoints" />
        </div>
        <p class="note">颜色表示位密度 σt。点位覆盖剖面站位的全部有效深度层。</p>
      </div>

      <div v-else class="analysis-body">
        <div class="stat-list two-col">
          <div class="stat"><span>最小值</span><b>{{ formatValue(statistics?.min ?? NaN) }} {{ variableView.unit }}</b></div>
          <div class="stat"><span>最大值</span><b>{{ formatValue(statistics?.max ?? NaN) }} {{ variableView.unit }}</b></div>
          <div class="stat"><span>平均值</span><b>{{ formatValue(statistics?.mean ?? NaN) }}</b></div>
          <div class="stat"><span>中位数</span><b>{{ formatValue(statistics?.median ?? NaN) }}</b></div>
          <div class="stat"><span>P10</span><b>{{ formatValue(statistics?.p10 ?? NaN) }}</b></div>
          <div class="stat"><span>P90</span><b>{{ formatValue(statistics?.p90 ?? NaN) }}</b></div>
          <div class="stat"><span>有效体素</span><b>{{ (statistics?.count ?? 0).toLocaleString() }}</b></div>
          <div class="stat"><span>缺测体素</span><b>{{ (statistics?.invalidCount ?? 0).toLocaleString() }}</b></div>
        </div>
        <div class="chart-frame">
          <OceanHistogramChart :histogram="histogram" :palette-id="variableView.palette" :unit="variableView.unit" />
        </div>
        <p class="note">统计仅计入掩膜内且非缺测的有效海水体素，缺测点不参与计算。</p>
      </div>

      <div class="panel-block data-download">
        <h4>数据下载</h4>
        <div class="download-row">
          <button type="button" class="download-button" :disabled="!manifest || downloading" @click="downloadSampleZip">
            {{ downloading ? '打包中…' : '样本数据 .zip' }}
          </button>
          <button type="button" class="download-button" :disabled="!manifest" @click="downloadExampleCsv">
            示例数据 .csv
          </button>
        </div>
        <p class="note">样本数据：当前区域预处理数据集（清单 + 二进制块 + 12 个月帧）。示例数据：当前分析结果 CSV（含变量、单位、时间、坐标与来源）。</p>
        <p v-if="downloadMessage" class="note download-message">{{ downloadMessage }}</p>
        <p class="note data-source">{{ dataNote }}</p>
        <span v-if="manifest?.timeKind === 'demo'" class="demo-flag">示例数据，非真实观测</span>
      </div>
      </div>

      <div v-if="readout" class="readout">
        <div class="readout-title">光标采样</div>
        <div class="readout-row"><span>经度</span><b>{{ readout.lon.toFixed(3) }}°E</b></div>
        <div class="readout-row"><span>纬度</span><b>{{ readout.lat.toFixed(3) }}°N</b></div>
        <div class="readout-row"><span>深度</span><b>{{ readout.depthM.toFixed(0) }} m</b></div>
        <div class="readout-row">
          <span>取值</span>
          <b>{{ readout.valid ? formatValue(readout.value) : '缺测/无效' }}</b>
        </div>
      </div>
    </aside>

    <div class="bottom-bar">
      <button type="button" class="play-button" @click="togglePlay">{{ playing ? '暂停' : '播放' }}</button>
      <input type="range" min="0" :max="Math.max(0, timeLabels.length - 1)" step="1" :value="ui.timeIndex" @input="onTime" />
      <span class="time-label">{{ currentTimeLabel }}</span>
    </div>

    <div v-if="!webglSupported" class="webgl-warning">
      当前浏览器 / 显卡不支持 WebGL2，无法进行体渲染。可查看断面、统计等二维分析结果。
    </div>
  </div>
</template>

<style scoped>
.ocean-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 360px;
  overflow: hidden;
  background: #06121f;
  color: #dce8f5;
  font-size: 12px;
}
.cesium-container {
  position: absolute;
  inset: 0;
}

.top-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 12;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 12px;
  background: linear-gradient(180deg, rgba(6, 18, 31, 0.92), rgba(6, 18, 31, 0.5));
  border-bottom: 1px solid rgba(90, 140, 190, 0.28);
}
.brand {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #9fd8ff;
}
.field {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #a9c3dd;
}
.field select {
  background: rgba(14, 32, 54, 0.9);
  color: #dce8f5;
  border: 1px solid rgba(90, 140, 190, 0.4);
  border-radius: 5px;
  padding: 2px 6px;
  font-size: 11px;
}
.var-group {
  display: inline-flex;
  gap: 4px;
}
.var-button {
  border: 1px solid rgba(90, 140, 190, 0.4);
  background: rgba(16, 38, 62, 0.7);
  color: #b9d2ea;
  border-radius: 5px;
  padding: 3px 9px;
  font-size: 11px;
  cursor: pointer;
}
.var-button.active {
  background: #2f80ed;
  border-color: #2f80ed;
  color: #fff;
  font-weight: 600;
}
.status-text {
  margin-left: auto;
  font-size: 11px;
  color: #7fd0ea;
  max-width: 42%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-text.error {
  color: #ff8f8f;
}

.left-panel,
.right-panel {
  position: absolute;
  top: 52px;
  bottom: 52px;
  z-index: 10;
  width: min(250px, 30%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding: 10px;
  box-sizing: border-box;
  background: rgba(7, 22, 38, 0.82);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(90, 140, 190, 0.28);
  border-radius: 9px;
  scrollbar-width: thin;
}
.left-panel {
  left: 10px;
}
.right-panel {
  right: 10px;
  width: min(340px, 38%);
  overflow: hidden;
}
.right-panel-scroll {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.download-row {
  display: flex;
  gap: 6px;
}
.download-button {
  flex: 1 1 auto;
  border: 1px solid rgba(90, 140, 190, 0.4);
  background: rgba(47, 128, 237, 0.2);
  color: #9fd8ff;
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 11px;
  cursor: pointer;
}
.download-button:hover:not(:disabled) {
  border-color: #5eacf5;
  color: #fff;
}
.download-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.download-message {
  color: #7fd0ea;
}
.data-source {
  border-top: 1px solid rgba(90, 140, 190, 0.16);
  padding-top: 5px;
}
.panel-block {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(90, 140, 190, 0.16);
}
.panel-block:last-child {
  border-bottom: none;
}
.panel-block h4 {
  margin: 0;
  font-size: 11px;
  color: #6fb8dd;
  letter-spacing: 0.05em;
}
.layer-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #c3d5e8;
  cursor: pointer;
}
.slider-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #c3d5e8;
}
.slider-row span {
  flex: 0 0 56px;
}
.slider-row input[type='range'] {
  flex: 1 1 auto;
  min-width: 0;
  accent-color: #2f80ed;
}
.slider-row b {
  flex: 0 0 58px;
  text-align: right;
  color: #9fd8ff;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.range-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.range-row input {
  width: 100%;
  min-width: 0;
  background: rgba(14, 32, 54, 0.9);
  color: #dce8f5;
  border: 1px solid rgba(90, 140, 190, 0.4);
  border-radius: 4px;
  padding: 2px 4px;
  font-size: 11px;
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chip {
  flex: 1 1 calc(33% - 4px);
  border: 1px solid rgba(90, 140, 190, 0.35);
  background: rgba(16, 38, 62, 0.6);
  color: #b9d2ea;
  border-radius: 5px;
  padding: 4px 0;
  font-size: 10px;
  cursor: pointer;
}
.chip:hover {
  border-color: #5eacf5;
  color: #fff;
}
.note {
  margin: 2px 0 0;
  font-size: 10px;
  line-height: 1.5;
  color: #7f9bb8;
}

.tabs {
  display: flex;
  gap: 4px;
}
.tab {
  flex: 1 1 auto;
  border: 1px solid rgba(90, 140, 190, 0.35);
  background: rgba(16, 38, 62, 0.6);
  color: #b9d2ea;
  border-radius: 5px;
  padding: 5px 2px;
  font-size: 11px;
  cursor: pointer;
}
.tab.active {
  background: #2f80ed;
  border-color: #2f80ed;
  color: #fff;
  font-weight: 600;
}
.analysis-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.coords {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #a9c3dd;
  flex-wrap: wrap;
}
.coords input {
  width: 66px;
  background: rgba(14, 32, 54, 0.9);
  color: #dce8f5;
  border: 1px solid rgba(90, 140, 190, 0.4);
  border-radius: 4px;
  padding: 2px 4px;
  font-size: 11px;
}
.chart-frame {
  position: relative;
  height: 200px;
  border: 1px solid rgba(90, 140, 190, 0.25);
  border-radius: 6px;
  background: rgba(4, 14, 26, 0.6);
}
.chart-frame.tall {
  height: 260px;
}
.stat-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.stat-list.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px 10px;
}
.stat {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  font-size: 11px;
}
.stat span {
  color: #a9c3dd;
}
.stat b {
  color: #9fd8ff;
  font-variant-numeric: tabular-nums;
}

.bottom-bar {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  z-index: 12;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  background: rgba(7, 22, 38, 0.9);
  border: 1px solid rgba(90, 140, 190, 0.3);
  border-radius: 20px;
  backdrop-filter: blur(6px);
}
.play-button {
  border: 1px solid rgba(90, 140, 190, 0.4);
  background: rgba(47, 128, 237, 0.2);
  color: #9fd8ff;
  border-radius: 12px;
  padding: 2px 12px;
  font-size: 11px;
  cursor: pointer;
}
.bottom-bar input[type='range'] {
  width: min(320px, 40vw);
  accent-color: #2f80ed;
}
.time-label {
  font-size: 11px;
  color: #cfe5ff;
  min-width: 44px;
  text-align: center;
}

.readout {
  flex: 0 0 auto;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(90, 140, 190, 0.28);
}
.readout-title {
  font-size: 11px;
  font-weight: 700;
  color: #6fb8dd;
  margin-bottom: 4px;
}
.readout-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  margin-top: 2px;
}
.readout-row span {
  color: #a9c3dd;
}
.readout-row b {
  color: #fff;
  font-variant-numeric: tabular-nums;
}

.webgl-warning {
  position: absolute;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 13;
  padding: 8px 14px;
  background: rgba(120, 40, 40, 0.9);
  border: 1px solid rgba(255, 140, 140, 0.5);
  border-radius: 8px;
  font-size: 11px;
  color: #ffd9d9;
}

.demo-flag {
  color: #ffca7a;
  font-weight: 700;
  font-size: 10px;
}

@media (max-width: 720px) {
  .left-panel,
  .right-panel {
    width: calc(50% - 14px);
    font-size: 10px;
  }
  .status-text {
    max-width: 100%;
  }
  .bottom-bar input[type='range'] {
    width: 40vw;
  }
}
</style>
