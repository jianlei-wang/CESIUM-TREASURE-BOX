/**
 * Volume Engine —— 场景组合式函数
 *
 * 把「引擎生命周期 + 剖切预览绘制 + 公共渲染状态」封装成可复用逻辑，
 * 让每个体渲染案例只专注自身的领域 UI 与交互：案例组件自行编排版式与参数面板，
 * 通过本函数拿到 engine / ui / 通用控制方法，不再共用一份通用模板。
 */

import { onBeforeUnmount, onMounted, reactive, ref, shallowRef, type Ref } from 'vue'
import { Color } from 'cesium'
import {
  VolumeEngine,
  type AnalyzeRequest,
  type PickedInfo,
  type SliceResult,
  type StationsResult
} from './VolumeEngine'
import { buildTransferLut, categoryColor } from './palette'
import { channelOf, type SceneSpec } from './scenes'

export type VolumeSceneOptions = {
  /** 覆盖 SceneSpec.params */
  params?: Record<string, number>
  /** 工程几何包围盒（归一化体域坐标，每 5 个数一组 x0,x1,y0,y1,z1） */
  geometry?: number[]
  tileSize?: number
  levels?: number
  particleFlow?: number
  /** 引擎就绪回调（此时可发起 analyze / 叠加等操作） */
  onReady?: (engine: VolumeEngine) => void
  onPicked?: (info: PickedInfo | null) => void
  onStations?: (stations: StationsResult, engine: VolumeEngine) => void
  onSlice?: (result: SliceResult, engine: VolumeEngine) => void
}

export function useVolumeScene(spec: SceneSpec, options: VolumeSceneOptions = {}) {
  const initial = channelOf(spec, spec.defaultChannel)
  const container = ref<HTMLElement | null>(null)
  const sliceCanvas = ref<HTMLCanvasElement | null>(null)
  const engine = shallowRef<VolumeEngine>()
  const status = ref('')
  const ready = ref(false)
  const hasSlice = ref(false)
  const picked = ref<PickedInfo | null>(null)
  const stats = reactive({ tilesReady: 0, pending: 0, buildTime: 0 })

  const ui = reactive({
    channel: spec.defaultChannel,
    palette: initial.palette,
    opacity: spec.defaults.opacity,
    coverage: spec.defaults.alphaFloor,
    valueMin: initial.min,
    valueMax: initial.max,
    threshold: undefined as number | undefined,
    sse: spec.defaults.sse,
    stepSize: spec.defaults.stepSize,
    nearest: spec.defaults.nearest,
    volumeVisible: true,
    clipEnabled: false,
    azimuth: 45,
    tilt: 0,
    offset: 0,
    flip: false,
    timeStep: 0,
    playing: false,
    particleVisible: !!spec.vector,
    particleCount: spec.vector?.defaultCount ?? 3000,
    particleSize: spec.vector?.defaultSize ?? 3
  })

  let lastSlice: SliceResult | undefined
  let playTimer: ReturnType<typeof setInterval> | undefined
  let observer: ResizeObserver | undefined

  function clamp01(value: number): number {
    return value < 0 ? 0 : value > 1 ? 1 : value
  }

  const active = () => channelOf(spec, ui.channel)

  /* ------------------------------ Slice ------------------------------ */

  function drawSlice(): void {
    const canvas = sliceCanvas.value
    const slice = lastSlice
    const e = engine.value
    const ch = active()
    if (!canvas || !slice || !e) return
    const context = canvas.getContext('2d')
    if (!context) return
    if (canvas.width !== slice.size) {
      canvas.width = slice.size
      canvas.height = slice.size
    }
    const image = context.createImageData(slice.size, slice.size)
    const data = image.data
    if (ch.mode === 'categorical') {
      for (let i = 0; i < slice.size * slice.size; i += 1) {
        if (!slice.valid[i]) continue
        const color = categoryColor(Math.round(slice.values[i]))
        data[i * 4] = color[0]
        data[i * 4 + 1] = color[1]
        data[i * 4 + 2] = color[2]
        data[i * 4 + 3] = Math.round(ui.opacity * 255)
      }
    } else {
      const lut = e.scalarLut()
      const span = ui.valueMax - ui.valueMin || 1
      for (let i = 0; i < slice.size * slice.size; i += 1) {
        if (!slice.valid[i]) continue
        const t = clamp01((slice.values[i] - ui.valueMin) / span)
        const idx = Math.round(t * 255)
        data[i * 4] = lut[idx * 4]
        data[i * 4 + 1] = lut[idx * 4 + 1]
        data[i * 4 + 2] = lut[idx * 4 + 2]
        data[i * 4 + 3] = Math.round(ui.opacity * lut[idx * 4 + 3])
      }
    }
    context.putImageData(image, 0, 0)
    hasSlice.value = true
  }

  function downloadSlice(name?: string): void {
    const canvas = sliceCanvas.value
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name ?? `${spec.kind}-slice-az${ui.azimuth}-tilt${ui.tilt}-off${ui.offset}.png`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, 'image/png')
  }

  /* ---------------------------- Engine ---------------------------- */

  function createEngine(): void {
    if (!container.value) return
    const instance = new VolumeEngine(
      container.value as HTMLElement,
      spec,
      {
        onStatus: (message) => {
          status.value = message
        },
        onReady: (buildTime) => {
          stats.buildTime = buildTime
          ready.value = true
          if (spec.vector && ui.particleVisible) instance.setParticlesVisible(true)
          options.onReady?.(instance)
        },
        onStats: (next) => {
          stats.tilesReady = next.tilesReady
          stats.pending = next.pending
        },
        onSlice: (result) => {
          lastSlice = result
          drawSlice()
          options.onSlice?.(result, instance)
        },
        onPicked: (info) => {
          picked.value = info
          options.onPicked?.(info)
        },
        onStations: (stations) => {
          options.onStations?.(stations, instance)
        }
      },
      { params: options.params, geometry: options.geometry, tileSize: options.tileSize, levels: options.levels, particleFlow: options.particleFlow }
    )
    engine.value = instance
    void instance.start()
  }

  /* ---------------------------- Controls ---------------------------- */

  function setChannel(key: string): void {
    if (key === ui.channel) return
    ui.channel = key
    const ch = channelOf(spec, key)
    ui.palette = ch.palette
    ui.valueMin = ch.min
    ui.valueMax = ch.max
    ui.threshold = undefined
    ui.timeStep = 0
    lastSlice = undefined
    hasSlice.value = false
    engine.value?.setChannel(key)
  }

  function setPalette(key: string): void {
    ui.palette = key
    engine.value?.setPalette(key)
    drawSlice()
  }

  function setOpacity(): void {
    engine.value?.setOpacity(ui.opacity)
    drawSlice()
  }

  function setCoverage(): void {
    engine.value?.setAlphaFloor(ui.coverage)
    drawSlice()
  }

  function setRange(): void {
    if (ui.valueMin >= ui.valueMax) ui.valueMax = ui.valueMin + 1
    engine.value?.setValueRange(ui.valueMin, ui.valueMax)
    drawSlice()
  }

  function toggleThreshold(value: number): void {
    ui.threshold = ui.threshold === value ? undefined : value
    engine.value?.setThreshold(ui.threshold)
    drawSlice()
  }

  function setClip(): void {
    engine.value?.setClip({ enabled: ui.clipEnabled, azimuth: ui.azimuth, tilt: ui.tilt, offset: ui.offset, flip: ui.flip })
  }

  /** 一键水平层：方位角任意，倾角 90°，用于按高度取水平切面 */
  function setHorizontalLayer(heightPercent: number, enabled = true): void {
    ui.tilt = 90
    ui.azimuth = 0
    ui.offset = heightPercent
    ui.clipEnabled = enabled
    setClip()
  }

  function setTimeStep(step: number): void {
    ui.timeStep = step
    engine.value?.setTimeStep(step)
  }

  function togglePlay(): void {
    ui.playing = !ui.playing
    if (playTimer) {
      clearInterval(playTimer)
      playTimer = undefined
    }
    if (ui.playing) {
      playTimer = setInterval(() => {
        setTimeStep((ui.timeStep + 1) % spec.timeSteps)
      }, 1000)
    }
  }

  function setPreset(tileSize: number, levels: number): void {
    engine.value?.setPreset(tileSize, levels)
  }

  function setParticlesVisible(visible: boolean): void {
    ui.particleVisible = visible
    engine.value?.setParticlesVisible(visible)
  }

  function setParticleCount(count: number): void {
    ui.particleCount = count
    engine.value?.setParticleCount(count)
  }

  function setParticleSize(): void {
    engine.value?.setParticleSize(ui.particleSize)
  }

  function setStepSize(): void {
    engine.value?.setStepSize(ui.stepSize)
  }

  function setSse(): void {
    engine.value?.setSse(ui.sse)
  }

  function toggleNearest(): void {
    ui.nearest = !ui.nearest
    engine.value?.setNearest(ui.nearest)
  }

  function toggleVolumeVisible(): void {
    ui.volumeVisible = !ui.volumeVisible
    engine.value?.setVolumeVisible(ui.volumeVisible)
  }

  function analyze<T = unknown>(request: AnalyzeRequest): Promise<T> {
    return engine.value ? engine.value.analyze<T>(request) : Promise.resolve(undefined as unknown as T)
  }

  function accentColor(value: number, min: number, max: number): Color {
    const t = clamp01((value - min) / (max - min || 1))
    const lut = buildTransferLut(ui.palette, { alphaFloor: 0.2, alphaGamma: 0.7 })
    const idx = Math.round(t * 255)
    return new Color(lut[idx * 4] / 255, lut[idx * 4 + 1] / 255, lut[idx * 4 + 2] / 255, 0.95)
  }

  onMounted(() => {
    if (container.value && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => drawSlice())
      observer.observe(container.value)
    }
    createEngine()
  })

  onBeforeUnmount(() => {
    if (playTimer) clearInterval(playTimer)
    observer?.disconnect()
    observer = undefined
    engine.value?.destroy()
    engine.value = undefined
  })

  return {
    container,
    sliceCanvas: sliceCanvas as Ref<HTMLCanvasElement | null>,
    engine,
    status,
    ready,
    hasSlice,
    picked,
    stats,
    ui,
    active,
    drawSlice,
    downloadSlice,
    setChannel,
    setPalette,
    setOpacity,
    setCoverage,
    setRange,
    toggleThreshold,
    setClip,
    setHorizontalLayer,
    setTimeStep,
    togglePlay,
    setPreset,
    setParticlesVisible,
    setParticleCount,
    setParticleSize,
    setStepSize,
    setSse,
    toggleNearest,
    toggleVolumeVisible,
    analyze,
    accentColor
  }
}
