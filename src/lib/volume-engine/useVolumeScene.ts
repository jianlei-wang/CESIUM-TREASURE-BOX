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
  type FireDisplayMode,
  type FirePayload,
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
  /** 火灾场景结构化输入（火源事件曲线 + 建筑障碍物） */
  fire?: FirePayload
  tileSize?: number
  levels?: number
  particleFlow?: number
  /** 时间关键帧插值：播放时体数据在相邻时间步之间连续混合，避免逐步重建的跳变 */
  timeInterpolation?: boolean
  /** 引擎就绪回调（此时可发起 analyze / 叠加等操作） */
  onReady?: (engine: VolumeEngine) => void
  /** 引擎销毁前回调：用于释放挂载到 Viewer 的自定义资源（如 GPGPU 粒子层） */
  onDispose?: (engine: VolumeEngine) => void
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
    /** 连续时间位置（0~timeSteps-1，小数），用于关键帧插值播放 */
    timePosition: 0,
    playing: false,
    /** 回放倍速 1 / 2 / 4 */
    playSpeed: 1,
    particleVisible: !!spec.vector,
    particleCount: spec.vector?.defaultCount ?? 3000,
    particleSize: spec.vector?.defaultSize ?? 3
  })

  let lastSlice: SliceResult | undefined
  let playTimer: ReturnType<typeof setInterval> | undefined
  let playRaf: number | undefined
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
      for (let i = 0; i < slice.size * slice.size; i += 1) {
        if (!slice.valid[i]) continue
        const t = e.valueToNormalized(slice.values[i])
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
      { params: options.params, geometry: options.geometry, fire: options.fire, tileSize: options.tileSize, levels: options.levels, particleFlow: options.particleFlow, timeInterpolation: options.timeInterpolation }
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
    const clamped = Math.max(0, Math.min(spec.timeSteps - 1, step))
    ui.timeStep = clamped
    ui.timePosition = clamped
    engine.value?.setTimeStep(clamped)
  }

  function startPlayTimer(): void {
    if (playTimer) clearInterval(playTimer)
    playTimer = setInterval(() => {
      setTimeStep((ui.timeStep + 1) % spec.timeSteps)
    }, Math.max(120, Math.round(1000 / Math.max(0.25, ui.playSpeed))))
  }

  /** 连续播放：以 rAF 推进小数时间位置，引擎在相邻关键帧之间插值，画面平滑 */
  function startSmoothPlay(): void {
    stopPlay()
    const stepMs = Math.max(90, 1000 / Math.max(0.25, ui.playSpeed))
    let last = performance.now()
    const tick = (now: number): void => {
      if (!ui.playing) return
      const maxPos = spec.timeSteps - 1
      const delta = Math.min(200, Math.max(0, now - last))
      last = now
      let pos = ui.timePosition + delta / stepMs
      if (pos >= maxPos) pos = pos % maxPos
      ui.timePosition = pos
      const step = Math.max(0, Math.min(maxPos, Math.floor(pos)))
      if (step !== ui.timeStep) ui.timeStep = step
      engine.value?.setTimePosition(pos)
      playRaf = requestAnimationFrame(tick)
    }
    playRaf = requestAnimationFrame(tick)
  }

  function stopPlay(): void {
    if (playTimer) {
      clearInterval(playTimer)
      playTimer = undefined
    }
    if (playRaf !== undefined) {
      cancelAnimationFrame(playRaf)
      playRaf = undefined
    }
  }

  function togglePlay(): void {
    ui.playing = !ui.playing
    if (ui.playing) {
      if (options.timeInterpolation) startSmoothPlay()
      else startPlayTimer()
    } else {
      stopPlay()
    }
  }

  /** 回放倍速：播放中切换立即生效 */
  function setPlaySpeed(speed: number): void {
    ui.playSpeed = speed
    if (!ui.playing) return
    if (options.timeInterpolation) startSmoothPlay()
    else startPlayTimer()
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

  /** 切换火灾体显示模式（复合/温度/烟气/风险） */
  function setFireMode(mode: FireDisplayMode): void {
    engine.value?.setFireMode(mode)
  }

  /** 更新火灾风险分级阈值 */
  function setFireThresholds(tempThresholds: number[], smokeThresholds: number[]): void {
    engine.value?.setFireThresholds(tempThresholds, smokeThresholds)
  }

  /** 更新火灾火源 / 建筑结构化输入并重建体数据 */
  function setFire(payload: FirePayload | undefined): void {
    engine.value?.setFire(payload)
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
    stopPlay()
    observer?.disconnect()
    observer = undefined
    if (engine.value) options.onDispose?.(engine.value)
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
    setPlaySpeed,
    setPreset,
    setParticlesVisible,
    setParticleCount,
    setParticleSize,
    setStepSize,
    setSse,
    toggleNearest,
    toggleVolumeVisible,
    analyze,
    setFireMode,
    setFireThresholds,
    setFire,
    accentColor
  }
}
