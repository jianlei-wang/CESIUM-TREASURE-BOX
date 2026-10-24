import { calibrationRow, clamp, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export interface S15Config {
  boomAngle: number
  stickAngle: number
  bucketAngle: number
  swingSpeed: number
  soilDensity: number
  cycleTime: number
}

export type S15Phase = 'dig' | 'swing' | 'dump' | 'return'

export interface S15State {
  time: number
  phase: S15Phase
  phaseProgress: number
  cycle: number
  swing: number
  boom: number
  stick: number
  bucket: number
  bucketLoad: number
  payload: number
  production: number
  dumped: number
  dumpEvent: number
}

const BUCKET_CAPACITY = 2.6
const DUMP_FRACTION = 0.22

export function createS15Model(config: S15Config): ScenarioSimulation & {
  state: S15State
  configure(next: Partial<S15Config>): void
  reset(): void
  getConfig(): S15Config
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  const state: S15State = {
    time: 0,
    phase: 'dig',
    phaseProgress: 0,
    cycle: 0,
    swing: 0,
    boom: cfg.boomAngle,
    stick: cfg.stickAngle,
    bucket: cfg.bucketAngle,
    bucketLoad: 0,
    payload: 0,
    production: 0,
    dumped: 0,
    dumpEvent: 0
  }
  const reset = (): void => {
    state.time = 0
    state.phase = 'dig'
    state.phaseProgress = 0
    state.cycle = 0
    state.swing = 0
    state.bucketLoad = 0
    state.payload = 0
    state.production = 0
    state.dumped = 0
    state.dumpEvent = 0
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 120, 1 / 30)
    state.time += step
    const cycleTime = Math.max(2, cfg.cycleTime)
    state.phaseProgress += step / cycleTime
    const phase = state.phase
    const progress = clamp(state.phaseProgress, 0, 1)
    if (phase === 'dig') {
      state.boom = cfg.boomAngle - 10 * Math.sin(progress * Math.PI)
      state.stick = cfg.stickAngle - 18 * progress
      state.bucket = cfg.bucketAngle + 28 * progress
      const fillRate = (cfg.soilDensity * BUCKET_CAPACITY) / (cycleTime * 0.18)
      state.bucketLoad = Math.min(cfg.soilDensity * BUCKET_CAPACITY, state.bucketLoad + fillRate * step)
      state.payload = state.bucketLoad
      state.swing += (0 - state.swing) * Math.min(1, step * 2)
    } else if (phase === 'swing') {
      state.boom = cfg.boomAngle + 8
      state.stick = cfg.stickAngle - 6
      state.bucket = cfg.bucketAngle + 10
      state.swing += ((Math.PI / 2) * cfg.swingSpeed - state.swing) * Math.min(1, step * 3)
    } else if (phase === 'dump') {
      state.swing += ((Math.PI / 2) * cfg.swingSpeed - state.swing) * Math.min(1, step * 3)
      const dumpRate = state.bucketLoad / (cycleTime * DUMP_FRACTION)
      const dumped = Math.min(state.bucketLoad, dumpRate * step)
      state.bucketLoad -= dumped
      state.dumped += dumped
      state.production += dumped
      state.payload = state.bucketLoad
      if (state.bucketLoad > 0.05) state.dumpEvent += step
      state.bucket = cfg.bucketAngle + 60 + progress * 36
    } else {
      state.boom = cfg.boomAngle + 4
      state.stick = cfg.stickAngle
      state.bucket = cfg.bucketAngle + 18
      state.swing += (0 - state.swing) * Math.min(1, step * 2.5)
    }
    if (state.phaseProgress >= 1) {
      state.phaseProgress = 0
      if (state.phase === 'dig') state.phase = 'swing'
      else if (state.phase === 'swing') state.phase = 'dump'
      else if (state.phase === 'dump') state.phase = 'return'
      else {
        state.phase = 'dig'
        state.cycle += 1
        if (state.bucketLoad < cfg.soilDensity * BUCKET_CAPACITY * 0.25) state.bucketLoad = 0
      }
    }
  }

  const expectedProduction = (): number => {
    const payload = cfg.soilDensity * BUCKET_CAPACITY
    return (3600 / Math.max(2, cfg.cycleTime)) * payload
  }

  const calibration = (): CalibrationRow[] => {
    const capacity = cfg.soilDensity * BUCKET_CAPACITY
    return [
      calibrationRow('铲斗容量', capacity, cfg.soilDensity * BUCKET_CAPACITY, 't', 0.001),
      calibrationRow('当前载荷', state.bucketLoad, capacity, 't', capacity),
      calibrationRow('小时产量', state.production * 3600 / Math.max(1, state.time), expectedProduction(), 't/h', expectedProduction() * 1.15),
      calibrationRow('累计卸料', state.dumped, state.production, 't', 0.1)
    ]
  }

  const configure = (next: Partial<S15Config>): void => {
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
    reset,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(1)),
      作业阶段: state.phase,
      循环次数: state.cycle,
      铲斗载荷t: Number(state.bucketLoad.toFixed(2)),
      累计卸料t: Number(state.dumped.toFixed(1)),
      小时产量th: Number((state.production * 3600 / Math.max(1, state.time)).toFixed(0)),
      回转角deg: Number(((state.swing * 180) / Math.PI).toFixed(0))
    }),
    calibration,
    serialize: () => ({ ...state })
  }
}
