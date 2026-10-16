/**
 * 温盐深三维体 —— 状态与编排 composable
 *
 * 集中管理：数据仓库、UI 状态、渲染图层（体/地形/切片/断面/等值面/流场）与分析结果。
 * 组件只负责把这里的状态绑定到界面并转发交互。
 */

import { computed, reactive, ref, shallowRef, type Ref } from 'vue'
import { Cartesian2, type Viewer } from 'cesium'
import {
  DEFAULT_REGION_ID,
  OCEAN_CAMERA_PRESETS,
  OCEAN_REGIONS,
  OCEAN_STRATIFICATION_LABEL,
  oceanQuality,
  oceanVariableView
} from './ocean-tsd.config'
import type {
  OceanAnalysisMode,
  OceanColumn,
  OceanDatasetManifest,
  OceanRegionPreset,
  OceanSection,
  OceanStatistics,
  OceanStratification,
  OceanTSPoint,
  OceanTsdUiState,
  OceanVariable,
  OceanVisibleLayers
} from './ocean-tsd.types'
import { OceanDatasetStore } from './data/OceanDatasetStore'
import type { OceanGridSampler, OceanHistogram } from './data/OceanGridSampler'
import { OceanSceneFrame } from './render/OceanSceneFrame'
import { OceanVolumeRenderer, type OceanVolumeField } from './render/OceanVolumeRenderer'
import { OceanBathymetryLayer } from './render/OceanBathymetryLayer'
import { OceanSliceLayer } from './render/OceanSliceLayer'
import { OceanSectionLayer } from './render/OceanSectionLayer'
import { OceanIsosurfaceLayer } from './render/OceanIsosurfaceLayer'
import { OceanCurrentLayer } from './render/OceanCurrentLayer'
import { computeProfile, computeSection, computeStratification, computeStatistics, computeTsPoints, type OceanProfile } from './analysis/ocean-analysis'

export type OceanStatus = 'idle' | 'loading' | 'ready' | 'error'

function cloneLayerDefaults(): OceanVisibleLayers {
  return {
    volume: true,
    bathymetry: true,
    horizontalSlice: false,
    verticalSection: false,
    isosurface: false,
    currents: false,
    samplePoints: false
  }
}

export function useOceanTsdState(getViewer: () => Viewer | undefined) {
  const ui = reactive<OceanTsdUiState>({
    datasetId: DEFAULT_REGION_ID,
    timeIndex: 0,
    variable: 'temperature',
    depthM: 0,
    depthRangeM: [0, 0],
    visibleLayers: cloneLayerDefaults(),
    analysisMode: 'profile',
    renderQuality: 'balanced',
    opacity: 0.5,
    autoColorRange: true,
    fixedColorRange: [0, 1],
    verticalExaggeration: OCEAN_REGIONS[0].defaultVerticalExaggeration,
    liftFactor: 1,
    isosurfaceValue: 0,
    currentDepthM: 0
  })

  const status = ref<OceanStatus>('idle')
  const error = ref<string | null>(null)
  const progress = ref('')
  const manifest = shallowRef<OceanDatasetManifest | null>(null)
  const timeLabels = ref<string[]>([])
  const regionId = ref(DEFAULT_REGION_ID)
  const maxDepthM = ref(0)
  const depthLevels = ref<number[]>([])
  const seabedRangeM = ref<[number, number]>([0, 0])
  const webglSupported = ref(true)

  const profilePoint = reactive({ lon: 0, lat: 0 })
  const sectionA = reactive({ lon: 0, lat: 0 })
  const sectionB = reactive({ lon: 0, lat: 0 })

  const profile = shallowRef<OceanProfile | null>(null)
  const stratification = shallowRef<OceanStratification | null>(null)
  const statistics = shallowRef<OceanStatistics | null>(null)
  const section = shallowRef<OceanSection | null>(null)
  const tsPoints = shallowRef<OceanTSPoint[] | null>(null)
  const histogram = shallowRef<OceanHistogram | null>(null)
  const analyzing = ref(false)

  const domainRanges = reactive<Record<OceanVariable, [number, number]>>({
    temperature: [0, 1],
    salinity: [0, 1],
    density: [0, 1],
    currentSpeed: [0, 1]
  })

  const variableView = computed(() => oceanVariableView(ui.variable))
  const colorRange = computed<[number, number]>(() =>
    ui.autoColorRange ? domainRanges[ui.variable] : [ui.fixedColorRange[0], ui.fixedColorRange[1]]
  )
  const stratificationLabel = computed(() => OCEAN_STRATIFICATION_LABEL[ui.variable])

  let store: OceanDatasetStore | null = null
  /** 当前区域是否已完成首次加载（用于区分区域切换与时间帧切换） */
  let sceneLoaded = false
  let frame: OceanSceneFrame | null = null
  let volumeRenderer: OceanVolumeRenderer | null = null
  let bathymetryLayer: OceanBathymetryLayer | null = null
  let sliceLayer: OceanSliceLayer | null = null
  let sectionLayer: OceanSectionLayer | null = null
  let isosurfaceLayer: OceanIsosurfaceLayer | null = null
  let currentLayer: OceanCurrentLayer | null = null

  /** 剖切参数持久化：垂向夸张等场景重建后仍保留 */
  const clipState = { enabled: false, azimuth: 45, tilt: 0, offsetPct: 0 }

  const renderNz = () => Math.min(128, Math.max(48, (manifest.value?.grid.nz ?? 24) * 4))

  function sampler(): OceanGridSampler | null {
    return store?.sampler() ?? null
  }

  function requestRender(): void {
    const viewer = getViewer()
    if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender()
  }

  const storeListener = (snapshot: {
    status: OceanStatus
    error: string | null
    timeIndex: number
    progress: string
  }): void => {
    // 场景已就绪后切换时间帧时，避免 status 回落 loading 导致相机重复跳转；
    // 仅保留进度提示，状态维持 ready。
    status.value = snapshot.status === 'loading' && sceneLoaded ? 'ready' : snapshot.status
    error.value = snapshot.error
    progress.value = snapshot.progress
    if (snapshot.status === 'ready') {
      ui.timeIndex = snapshot.timeIndex
      sceneLoaded = true
    }
  }

  /** 展开区域数据并初始化默认分析站位 */
  function bootstrapRegion(region: OceanRegionPreset): void {
    const current = manifest.value
    if (!current) return
    timeLabels.value = current.timeLabels
    const [shallow, deep] = current.depthRangeM
    maxDepthM.value = deep
    depthLevels.value = current.nativeResolution.depthsM
    seabedRangeM.value = current.bathymetryRangeM
    ui.depthRangeM = [shallow, deep]
    ui.depthM = shallow
    ui.currentDepthM = Math.min(50, deep)
    ui.verticalExaggeration = region.defaultVerticalExaggeration
    const { extent } = current
    const insetLon = (extent.east - extent.west) * 0.18
    const insetLat = (extent.north - extent.south) * 0.18
    profilePoint.lon = (extent.west + extent.east) / 2
    profilePoint.lat = (extent.south + extent.north) / 2
    sectionA.lon = extent.west + insetLon
    sectionA.lat = extent.south + insetLat
    sectionB.lon = extent.east - insetLon
    sectionB.lat = extent.north - insetLat
  }

  /** 用各变量的全域统计初始化自动色域 */
  function computeDomainRanges(): void {
    const s = sampler()
    if (!s) return
    for (const key of ['temperature', 'salinity', 'density', 'currentSpeed'] as OceanVariable[]) {
      const stats = s.statistics(key)
      if (Number.isFinite(stats.min)) {
        const lo = stats.min
        const hi = stats.max === stats.min ? stats.min + 1 : stats.max
        domainRanges[key] = [lo, hi]
        if (key === ui.variable) ui.fixedColorRange = [lo, hi]
      }
    }
  }

  /** 构建场景坐标系与全部渲染图层 */
  function buildScene(): void {
    const viewer = getViewer()
    const current = manifest.value
    const s = sampler()
    if (!viewer || viewer.isDestroyed() || !current || !s) return
    frame = new OceanSceneFrame(current, s.maxLevelDepthM, ui.verticalExaggeration, ui.liftFactor)
    volumeRenderer = new OceanVolumeRenderer(viewer, frame)
    webglSupported.value = volumeRenderer.supported
    if (!volumeRenderer.supported) {
      status.value = 'error'
      error.value = '当前浏览器/显卡没有可用的 WebGL2，无法进行体渲染'
      return
    }
    bathymetryLayer = new OceanBathymetryLayer(viewer, frame, s.staticData)
    sliceLayer = new OceanSliceLayer(viewer, frame, s, sliceOptions())
    sectionLayer = new OceanSectionLayer(viewer, frame, s, sectionOptions())
    isosurfaceLayer = new OceanIsosurfaceLayer(viewer, frame, s, isoOptions())
    currentLayer = new OceanCurrentLayer(viewer, frame, s, currentOptions())
    bathymetryLayer.setVisible(ui.visibleLayers.bathymetry)
    sliceLayer.setVisible(ui.visibleLayers.horizontalSlice)
    sectionLayer.setVisible(ui.visibleLayers.verticalSection)
    isosurfaceLayer.setVisible(ui.visibleLayers.isosurface)
    currentLayer.setVisible(ui.visibleLayers.currents)
    volumeRenderer.setVisible(ui.visibleLayers.volume)
    volumeRenderer.setOpacity(ui.opacity)
    rebuildVolume()
    volumeRenderer.setQuality(oceanQuality(ui.renderQuality))
    volumeRenderer.setClip(clipState)
  }

  function sliceOptions() {
    return {
      depthM: ui.depthM,
      variable: ui.variable,
      colorRange: colorRange.value,
      opacity: Math.max(0.35, ui.opacity)
    }
  }
  function sectionOptions() {
    return {
      a: { lon: sectionA.lon, lat: sectionA.lat },
      b: { lon: sectionB.lon, lat: sectionB.lat },
      variable: ui.variable,
      colorRange: colorRange.value,
      opacity: Math.max(0.5, ui.opacity)
    }
  }
  function isoOptions() {
    return {
      variable: ui.variable,
      isoValue: ui.isosurfaceValue,
      colorRange: colorRange.value,
      opacity: 0.9,
      toleranceRatio: 0.02
    }
  }
  function currentOptions() {
    return {
      depthM: ui.currentDepthM,
      stride: oceanQuality(ui.renderQuality).currentStride,
      colorRange: domainRanges.currentSpeed,
      opacity: 0.9
    }
  }

  /** 重建体渲染场 */
  function rebuildVolume(): void {
    const s = sampler()
    if (!s || !volumeRenderer) return
    const depths = s.uniformDepths(renderNz())
    const values = s.buildUniformField(ui.variable, depths)
    const field: OceanVolumeField = {
      values,
      nx: s.nx,
      ny: s.ny,
      nz: depths.length,
      depths,
      valueMin: colorRange.value[0],
      valueMax: colorRange.value[1]
    }
    volumeRenderer.setPalette(variableView.value.palette)
    volumeRenderer.setField(field)
    volumeRenderer.setColorRange(field.valueMin, field.valueMax)
    volumeRenderer.setOpacity(ui.opacity)
  }

  async function load(regionKey: string): Promise<void> {
    const region = OCEAN_REGIONS.find((r) => r.id === regionKey) ?? OCEAN_REGIONS[0]
    regionId.value = region.id
    ui.datasetId = region.id
    status.value = 'loading'
    error.value = null
    sceneLoaded = false
    teardownScene()
    store?.dispose()
    store = new OceanDatasetStore(region, storeListener)
    manifest.value = null
    try {
      await store.loadRegion(region)
      if (store.status !== 'ready') return
      manifest.value = store.manifest
      bootstrapRegion(region)
      computeDomainRanges()
      buildScene()
      refreshAnalysis()
    } catch (err) {
      status.value = 'error'
      error.value = err instanceof Error ? err.message : String(err)
    }
  }

  async function setTime(index: number): Promise<void> {
    if (!store) return
    await store.setTime(index)
    if (status.value !== 'ready') return
    rebuildVolume()
    refreshAnalysis()
  }

  function setVariable(variable: OceanVariable): void {
    ui.variable = variable
    ui.isosurfaceValue = domainRanges[variable][0]
    const s = sampler()
    volumeRenderer?.setPalette(oceanVariableView(variable).palette)
    rebuildVolume()
    sliceLayer?.setOptions(sliceOptions())
    sectionLayer?.setOptions(sectionOptions())
    isosurfaceLayer?.setOptions(isoOptions())
    refreshAnalysis()
    void s
  }

  function setDepth(depthM: number): void {
    ui.depthM = depthM
    sliceLayer?.setOptions(sliceOptions())
  }

  function setCurrentDepth(depthM: number): void {
    ui.currentDepthM = depthM
    currentLayer?.setOptions(currentOptions())
  }

  function setIsoValue(value: number): void {
    ui.isosurfaceValue = value
    isosurfaceLayer?.setOptions(isoOptions())
  }

  function setOpacity(value: number): void {
    ui.opacity = value
    volumeRenderer?.setOpacity(value)
    sliceLayer?.setOptions(sliceOptions())
    sectionLayer?.setOptions(sectionOptions())
  }

  function setQuality(key: string): void {
    ui.renderQuality = key as OceanUiQuality
    volumeRenderer?.setQuality(oceanQuality(key))
    currentLayer?.setOptions(currentOptions())
  }

  function setColorRangeMode(auto: boolean): void {
    ui.autoColorRange = auto
    if (!auto) {
      const [lo, hi] = domainRanges[ui.variable]
      ui.fixedColorRange = [lo, hi]
    }
    rebuildVolume()
    sliceLayer?.setOptions(sliceOptions())
    sectionLayer?.setOptions(sectionOptions())
    isosurfaceLayer?.setOptions(isoOptions())
  }

  function setFixedColorRange(min: number, max: number): void {
    ui.fixedColorRange = [min, max]
    if (!ui.autoColorRange) {
      rebuildVolume()
      sliceLayer?.setOptions(sliceOptions())
      sectionLayer?.setOptions(sectionOptions())
      isosurfaceLayer?.setOptions(isoOptions())
    }
  }

  function setVerticalExaggeration(value: number): void {
    ui.verticalExaggeration = value
    rebuildSceneGeometry()
  }

  function setLiftFactor(value: number): void {
    ui.liftFactor = value
    rebuildSceneGeometry()
  }

  function rebuildSceneGeometry(): void {
    const viewer = getViewer()
    const current = manifest.value
    const s = sampler()
    if (!viewer || !current || !s || !frame) return
    frame.setVerticalExaggeration(ui.verticalExaggeration)
    volumeRenderer?.dispose()
    bathymetryLayer?.dispose()
    sliceLayer?.dispose()
    sectionLayer?.dispose()
    isosurfaceLayer?.dispose()
    currentLayer?.dispose()
    volumeRenderer = null
    bathymetryLayer = null
    sliceLayer = null
    sectionLayer = null
    isosurfaceLayer = null
    currentLayer = null
    buildScene()
  }

  function toggleLayer(name: keyof OceanVisibleLayers): void {
    const layers = ui.visibleLayers
    layers[name] = !layers[name]
    switch (name) {
      case 'volume':
        volumeRenderer?.setVisible(layers.volume)
        break
      case 'bathymetry':
        bathymetryLayer?.setVisible(layers.bathymetry)
        break
      case 'horizontalSlice':
        sliceLayer?.setVisible(layers.horizontalSlice)
        break
      case 'verticalSection':
        sectionLayer?.setVisible(layers.verticalSection)
        break
      case 'isosurface':
        isosurfaceLayer?.setVisible(layers.isosurface)
        break
      case 'currents':
        currentLayer?.setVisible(layers.currents)
        break
      default:
        break
    }
  }

  function setClip(options: { enabled: boolean; azimuth: number; tilt: number; offsetPct: number }): void {
    Object.assign(clipState, options)
    volumeRenderer?.setClip(clipState)
  }

  function flyTo(presetKey: string): void {
    const viewer = getViewer()
    const preset = OCEAN_CAMERA_PRESETS.find((p) => p.key === presetKey) ?? OCEAN_CAMERA_PRESETS[0]
    if (viewer && frame) frame.flyTo(viewer, preset)
  }

  function setAnalysisMode(mode: OceanAnalysisMode): void {
    ui.analysisMode = mode
    refreshAnalysis()
  }

  function refreshAnalysis(): void {
    const s = sampler()
    if (!s || status.value !== 'ready') return
    analyzing.value = true
    try {
      const column: OceanColumn = s.columnAt(profilePoint.lon, profilePoint.lat)
      profile.value = computeProfile(s, profilePoint.lon, profilePoint.lat, ui.variable)
      stratification.value = computeStratification(column, ui.variable, s)
      statistics.value = computeStatistics(s, ui.variable)
      histogram.value = s.histogram(ui.variable, 24)
      section.value = computeSection(s, sectionA, sectionB, ui.variable)
      tsPoints.value = computeTsPoints(s, profilePoint.lon, profilePoint.lat)
    } finally {
      analyzing.value = false
    }
  }

  function pickAt(windowX: number, windowY: number): {
    lon: number
    lat: number
    depthM: number
    value: number
    valid: boolean
  } | null {
    const viewer = getViewer()
    if (!viewer || viewer.isDestroyed() || !volumeRenderer) return null
    const position = new Cartesian2(windowX, windowY)
    const depthHit = volumeRenderer.pickDepth(viewer.scene, position)
    const voxel = volumeRenderer.pickVoxel(viewer.scene, position)
    if (!depthHit && !voxel) return null
    const lon = depthHit?.lon ?? profilePoint.lon
    const lat = depthHit?.lat ?? profilePoint.lat
    const depthM = depthHit?.depthM ?? ui.depthM
    return { lon, lat, depthM, value: voxel?.value ?? NaN, valid: voxel?.valid ?? false }
  }

  function moveProfilePointTo(lon: number, lat: number): void {
    profilePoint.lon = lon
    profilePoint.lat = lat
    refreshAnalysis()
  }

  /** 断面测线端点变化后刷新断面图层与分析结果 */
  function updateSection(): void {
    sectionLayer?.setOptions(sectionOptions())
    refreshAnalysis()
  }

  /** 深度切片开关打开但图层尚未构建时，确保其可见性同步 */
  function syncLayerVisibility(): void {
    bathymetryLayer?.setVisible(ui.visibleLayers.bathymetry)
    sliceLayer?.setVisible(ui.visibleLayers.horizontalSlice)
    sectionLayer?.setVisible(ui.visibleLayers.verticalSection)
    isosurfaceLayer?.setVisible(ui.visibleLayers.isosurface)
    currentLayer?.setVisible(ui.visibleLayers.currents)
    volumeRenderer?.setVisible(ui.visibleLayers.volume)
  }

  function teardownScene(): void {
    volumeRenderer?.dispose()
    bathymetryLayer?.dispose()
    sliceLayer?.dispose()
    sectionLayer?.dispose()
    isosurfaceLayer?.dispose()
    currentLayer?.dispose()
    volumeRenderer = null
    bathymetryLayer = null
    sliceLayer = null
    sectionLayer = null
    isosurfaceLayer = null
    currentLayer = null
    frame = null
  }

  function dispose(): void {
    teardownScene()
    store?.dispose()
    store = null
  }

  return {
    ui,
    status,
    error,
    progress,
    manifest,
    timeLabels,
    regionId,
    maxDepthM,
    depthLevels,
    seabedRangeM,
    webglSupported,
    profilePoint,
    sectionA,
    sectionB,
    profile,
    stratification,
    statistics,
    section,
    tsPoints,
    histogram,
    analyzing,
    domainRanges,
    variableView,
    colorRange,
    stratificationLabel,
    sampler,
    load,
    setTime,
    setVariable,
    setDepth,
    setCurrentDepth,
    setIsoValue,
    setOpacity,
    setQuality,
    setColorRangeMode,
    setFixedColorRange,
    setVerticalExaggeration,
    setLiftFactor,
    toggleLayer,
    setClip,
    flyTo,
    setAnalysisMode,
    refreshAnalysis,
    pickAt,
    moveProfilePointTo,
    updateSection,
    syncLayerVisibility,
    dispose,
    requestRender
  }
}

type OceanUiQuality = 'performance' | 'balanced' | 'quality'

export type OceanTsdController = ReturnType<typeof useOceanTsdState>
export type { Ref }
