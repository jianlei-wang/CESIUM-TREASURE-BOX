import { calibrationRow, clamp, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export interface S18Config {
  advance: number
  rpm: number
  thrust: number
  diameter: number
  spacing: number
  support: number
  water: boolean
}

export interface S18State {
  time: number
  distance: number
  rings: number
  facePressure: number
  supportPressure: number
  torque: number
  power: number
  penetration: number
  specificEnergy: number
  muckVolume: number
  risk: number
  cutterAngle: number
  ringProgress: number
}

const ROCK_DENSITY = 2400
const GRAVITY = 9.81

export function createS18Model(config: S18Config): ScenarioSimulation & {
  state: S18State
  configure(next: Partial<S18Config>): void
  reset(): void
  getConfig(): S18Config
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  const state: S18State = { time: 0, distance: 0, rings: 0, facePressure: 0, supportPressure: 0, torque: 0, power: 0, penetration: 0, specificEnergy: 0, muckVolume: 0, risk: 0, cutterAngle: 0, ringProgress: 0 }

  const reset = (): void => {
    state.time = 0
    state.distance = 0
    state.rings = 0
    state.facePressure = 0
    state.supportPressure = 0
    state.torque = 0
    state.power = 0
    state.penetration = 0
    state.specificEnergy = 0
    state.muckVolume = 0
    state.risk = 0
    state.cutterAngle = 0
    state.ringProgress = 0
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 120, 1 / 30)
    state.time += step
    const advanceRate = Math.max(0, cfg.advance) / 60
    const priorRings = state.rings
    state.distance += advanceRate * step
    state.cutterAngle += (cfg.rpm / 60) * Math.PI * 2 * step
    const revolutions = Math.max(1e-6, cfg.rpm / 60)
    state.penetration = advanceRate / revolutions
    const diameter = Math.max(1, cfg.diameter)
    const area = (Math.PI * diameter * diameter) / 4
    const thrust = Math.max(0, cfg.thrust) * 1000
    state.torque = 0.42 * thrust * diameter * 0.12 * (1 + clamp(cfg.support / 260, 0, 0.3))
    state.power = state.torque * revolutions * Math.PI * 2 / 1000
    const muckRate = area * advanceRate
    state.muckVolume += muckRate * step
    state.specificEnergy = state.power > 0 && muckRate > 0 ? state.power / muckRate : 0
    const cover = 18 + state.distance * 0.06
    state.facePressure = cfg.water ? (ROCK_DENSITY * GRAVITY * cover) / 1e6 : 0.02
    state.supportPressure = state.facePressure * clamp(cfg.support / 100, 0, 1) * 1.08
    state.risk = clamp((state.facePressure - state.supportPressure) / Math.max(0.01, state.facePressure), 0, 1)
    const expectedRings = Math.floor((state.distance + 0.001) / Math.max(1, cfg.spacing))
    state.ringProgress = clamp(state.distance / Math.max(1, cfg.spacing) - state.rings, 0, 1)
    state.rings = Math.min(40, expectedRings)
    if (state.rings > priorRings) state.ringProgress = 0
  }

  const calibration = (): CalibrationRow[] => {
    const area = (Math.PI * cfg.diameter * cfg.diameter) / 4
    const expectedRings = Math.min(40, Math.floor(state.distance / Math.max(1, cfg.spacing)))
    const theoreticalMuck = area * state.distance
    return [
      calibrationRow('掘进里程', state.distance, state.distance, 'm', 0.1),
      calibrationRow('管片环数', state.rings, expectedRings, '环', 0),
      calibrationRow('开挖体积', state.muckVolume, theoreticalMuck, 'm³', Math.max(0.1, theoreticalMuck * 0.05)),
      calibrationRow('掌子面水压', state.facePressure, Math.max(0.02, state.facePressure), 'MPa', 0.5),
      calibrationRow('支护压力差', Math.max(0, state.facePressure - state.supportPressure), 0, 'MPa', 0.5),
      calibrationRow('比能', state.specificEnergy, 12, 'kWh/m³', 60)
    ]
  }

  const configure = (next: Partial<S18Config>): void => {
    cfg = { ...cfg, ...next }
  }

  reset()

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
      掘进里程m: Number(state.distance.toFixed(1)),
      管片环数: state.rings,
      刀盘转速rpm: cfg.rpm,
      掌子面水压MPa: Number(state.facePressure.toFixed(2)),
      支护压力MPa: Number(state.supportPressure.toFixed(2)),
      扭矩kNm: Number(state.torque.toFixed(0)),
      风险指数: Number(state.risk.toFixed(2))
    }),
    calibration,
    serialize: () => ({ ...state })
  }
}
