import { calibrationRow, clamp, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export interface S08Config {
  loadMass: number
  cableLength: number
  slewSpeed: number
  hoistSpeed: number
  wind: number
  damping: number
}

export interface S08State {
  time: number
  slewAngle: number
  trolleyRadius: number
  cableLength: number
  swingX: number
  swingZ: number
  swingVX: number
  swingVZ: number
  swingPeak: number
  tension: number
}

export function createS08Model(config: S08Config): ScenarioSimulation & {
  state: S08State
  configure(next: Partial<S08Config>): void
  steady(): void
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  const state: S08State = {
    time: 0,
    slewAngle: 0,
    trolleyRadius: 42,
    cableLength: cfg.cableLength,
    swingX: 0,
    swingZ: 0,
    swingVX: 0,
    swingVZ: 0,
    swingPeak: 0,
    tension: cfg.loadMass * 9.81
  }

  const configure = (next: Partial<S08Config>): void => {
    cfg = { ...cfg, ...next }
  }

  const steady = (): void => {
    state.swingX = 0
    state.swingZ = 0
    state.swingVX = 0
    state.swingVZ = 0
    state.swingPeak = 0
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 240, 1 / 30)
    state.time += step
    state.slewAngle += cfg.slewSpeed * step
    state.trolleyRadius = 34 + Math.sin(state.time * 0.18) * 22
    state.cableLength += (cfg.cableLength - state.cableLength) * Math.min(1, step * cfg.hoistSpeed * 0.32)
    const centrifugal = cfg.slewSpeed * cfg.slewSpeed * state.trolleyRadius * 0.018
    const windDrive = cfg.wind * 0.0035
    state.swingVX += (centrifugal + windDrive) * step
    state.swingVZ += Math.cos(state.slewAngle * 2.3) * cfg.wind * 0.002 * step
    const stiffness = 9.81 / Math.max(4, state.cableLength)
    state.swingVX -= state.swingX * stiffness * step
    state.swingVZ -= state.swingZ * stiffness * step
    const drag = Math.max(0, 1 - cfg.damping * step * 2.2)
    state.swingVX *= drag
    state.swingVZ *= drag
    state.swingX += state.swingVX * step
    state.swingZ += state.swingVZ * step
    const angle = Math.hypot(state.swingX, state.swingZ)
    state.swingPeak = Math.max(state.swingPeak, (angle * 180) / Math.PI)
    state.tension = cfg.loadMass * 9.81 + cfg.loadMass * Math.abs(state.swingVX) * 2.4
  }

  const calibration = (): CalibrationRow[] => {
    const pendulumPeriod = 2 * Math.PI * Math.sqrt(Math.max(4, state.cableLength) / 9.81)
    const staticTension = cfg.loadMass * 9.81
    return [
      calibrationRow('单摆周期', pendulumPeriod, 2 * Math.PI * Math.sqrt(state.cableLength / 9.81), 's', 0.05),
      calibrationRow('静态张力', state.tension, staticTension, 'kN', staticTension * 0.35),
      calibrationRow('摆角非负', state.swingPeak, Math.abs(state.swingPeak), '°', 0.001),
      calibrationRow('索长目标', state.cableLength, cfg.cableLength, 'm', cfg.cableLength * 0.1)
    ]
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
    steady,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(2)),
      工作半径m: Number(state.trolleyRadius.toFixed(2)),
      回转角rad: Number(state.slewAngle.toFixed(3)),
      吊物摆角deg: Number(state.swingPeak.toFixed(2)),
      钢缆张力kN: Number(state.tension.toFixed(2)),
      吊索长度m: Number(state.cableLength.toFixed(2)),
      摆动能量J: Number((0.5 * (state.swingVX ** 2 + state.swingVZ ** 2)).toFixed(3))
    }),
    calibration,
    serialize: () => ({ ...state }),
    reset: () => {
      state.time = 0
      state.slewAngle = 0
      state.trolleyRadius = 42
      state.cableLength = cfg.cableLength
      steady()
      state.tension = cfg.loadMass * 9.81
    }
  }
}
