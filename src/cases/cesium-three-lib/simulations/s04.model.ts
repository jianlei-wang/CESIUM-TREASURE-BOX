import { calibrationRow, clamp, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export interface S04Config {
  inflow: number
  maxDepth: number
  duration: number
  roughness: number
  buildings: number
}

export interface S04State {
  time: number
  volume: number
  level: number
  inflow: number
  outflow: number
  peakFlow: number
  peakLevel: number
  cumulativeInflow: number
  cumulativeOutflow: number
  ended: boolean
}

const DOMAIN_AREA = 120 * 120
const STORAGE_FRACTION = 0.14
const OUTLET_WIDTH = 26
const WEIR_COEFFICIENT = 1.7

export function s04Hydrograph(time: number, duration: number): number {
  if (duration <= 0 || time < 0 || time > duration) return 0
  const x = time / duration
  return Math.sin(Math.PI * x) ** 1.35
}

export function createS04Model(config: S04Config): ScenarioSimulation & {
  state: S04State
  configure(next: Partial<S04Config>): void
  reflow(): void
  getConfig(): S04Config
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  const state: S04State = { time: 0, volume: 0, level: 0, inflow: 0, outflow: 0, peakFlow: 0, peakLevel: 0, cumulativeInflow: 0, cumulativeOutflow: 0, ended: false }

  const storageArea = (): number => DOMAIN_AREA * STORAGE_FRACTION * (1 - Math.min(0.28, cfg.buildings * 0.011))

  const reflow = (): void => {
    state.time = 0
    state.volume = 0
    state.level = 0
    state.inflow = 0
    state.outflow = 0
    state.peakFlow = 0
    state.peakLevel = 0
    state.cumulativeInflow = 0
    state.cumulativeOutflow = 0
    state.ended = false
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 120, 1 / 30)
    state.time += step
    const hydro = s04Hydrograph(state.time, cfg.duration)
    state.inflow = cfg.inflow * hydro
    const head = Math.max(0, state.level)
    const weir = head > 0.05 ? WEIR_COEFFICIENT * OUTLET_WIDTH * head ** 1.5 : 0
    const drain = cfg.roughness * 2.2 * head
    state.outflow = weir + drain
    const area = storageArea()
    const delta = (state.inflow - state.outflow) * step
    state.volume = Math.max(0, state.volume + delta)
    state.cumulativeInflow += state.inflow * step
    state.cumulativeOutflow += state.outflow * step
    state.level = state.volume / area
    state.peakFlow = Math.max(state.peakFlow, state.inflow)
    state.peakLevel = Math.max(state.peakLevel, state.level)
    state.ended = state.time > cfg.duration + 40
    if (state.level > cfg.maxDepth * 1.25) {
      const overflow = (state.level - cfg.maxDepth * 1.25) * area
      state.volume -= overflow
      state.level = cfg.maxDepth * 1.25
      state.cumulativeOutflow += overflow
    }
  }

  const calibration = (): CalibrationRow[] => {
    const balance = state.cumulativeInflow - state.cumulativeOutflow - state.volume
    const relative = state.cumulativeInflow > 1 ? Math.abs(balance) / state.cumulativeInflow : 0
    return [
      calibrationRow('质量守恒残差', Math.max(0, relative), 0, '', 0.05),
      calibrationRow('峰值水位', state.peakLevel, cfg.maxDepth, 'm', cfg.maxDepth * 1.3),
      calibrationRow('峰值入流', state.peakFlow, cfg.inflow, 'm³/s', cfg.inflow * 1.05),
      calibrationRow('蓄水面积', storageArea(), storageArea(), 'm²', 0.001)
    ]
  }

  const configure = (next: Partial<S04Config>): void => {
    cfg = { ...cfg, ...next }
  }

  return {
    state,
    get mode() {
      return mode
    },
    setMode(next) {
      mode = next
    },
    configure,
    getConfig: () => ({ ...cfg }),
    reflow,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(1)),
      当前水位m: Number(state.level.toFixed(2)),
      入流m3s: Number(state.inflow.toFixed(1)),
      出流m3s: Number(state.outflow.toFixed(1)),
      蓄量万m3: Number((state.volume / 10000).toFixed(2)),
      风险等级: state.level > cfg.maxDepth * 0.8 ? '橙色预警' : state.level > cfg.maxDepth * 0.45 ? '黄色关注' : '蓝色常态'
    }),
    calibration,
    serialize: () => ({ ...state }),
    reset: reflow
  }
}
