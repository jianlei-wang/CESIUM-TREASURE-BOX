import { calibrationRow, clamp, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export type S18Rock = 'III' | 'IV' | 'V'

export interface S18Config {
  advance: number
  rpm: number
  thrust: number
  diameter: number
  spacing: number
  support: number
  water: boolean
  rock?: S18Rock
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
  advanceVelocity: number
  acceleration: number
  netForce: number
  resistance: number
  mass: number
  muckMass: number
  muckBalance: number
  rock: S18Rock
}

const ROCK_DENSITY = 2400
const GRAVITY = 9.81
const ROCK_STRENGTH: Record<S18Rock, number> = { III: 12, IV: 6, V: 2.2 }
const BULKING_FACTOR = 1.15

export function createS18Model(config: S18Config): ScenarioSimulation & {
  state: S18State
  configure(next: Partial<S18Config>): void
  reset(): void
  getConfig(): S18Config
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  const state: S18State = { time: 0, distance: 0, rings: 0, facePressure: 0, supportPressure: 0, torque: 0, power: 0, penetration: 0, specificEnergy: 0, muckVolume: 0, risk: 0, cutterAngle: 0, ringProgress: 0, advanceVelocity: 0, acceleration: 0, netForce: 0, resistance: 0, mass: 0, muckMass: 0, muckBalance: 0, rock: config.rock ?? 'IV' }

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
    state.advanceVelocity = 0
    state.acceleration = 0
    state.netForce = 0
    state.resistance = 0
    state.muckMass = 0
    state.muckBalance = 0
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 120, 1 / 30)
    state.time += step
    const diameter = Math.max(1, cfg.diameter)
    const area = (Math.PI * diameter * diameter) / 4
    const rock = cfg.rock ?? 'IV'
    state.rock = rock
    state.mass = 320000 + diameter * diameter * 9000
    const commanded = Math.max(0.01, cfg.advance) / 60
    const thrust = Math.max(0, cfg.thrust) * 1000
    const strength = ROCK_STRENGTH[rock] * 1e6
    const friction = state.mass * GRAVITY * 0.025
    state.resistance = strength * area * 0.022 + friction + Math.max(0, state.advanceVelocity) * 4.2e6
    state.netForce = thrust - state.resistance
    state.acceleration = state.netForce / Math.max(1, state.mass)
    const target = state.netForce > 0 ? commanded : 0
    const lag = state.netForce > 0 ? 0.9 : 0.25
    const priorVelocity = state.advanceVelocity
    state.advanceVelocity += (target - state.advanceVelocity) * Math.min(1, step / lag)
    state.acceleration = (state.advanceVelocity - priorVelocity) / step
    const priorRings = state.rings
    const advanceRate = state.advanceVelocity
    state.distance += advanceRate * step
    state.cutterAngle += (cfg.rpm / 60) * Math.PI * 2 * step
    const revolutions = Math.max(1e-6, cfg.rpm / 60)
    state.penetration = advanceRate / revolutions
    state.torque = strength * area * diameter * 0.0025 + thrust * diameter * 0.004
    state.power = state.torque * revolutions * Math.PI * 2 / 1000
    const muckRate = area * advanceRate
    state.muckVolume += muckRate * step
    state.muckMass = state.distance * area * ROCK_DENSITY * BULKING_FACTOR
    state.muckBalance = state.muckVolume * ROCK_DENSITY * BULKING_FACTOR - state.muckMass
    state.specificEnergy = state.power > 0 && muckRate > 0 ? state.power / muckRate / 3600 : 0
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
    const commandedDistance = (Math.max(0, cfg.advance) / 60) * state.time
    const expectedRings = Math.min(40, Math.floor(commandedDistance / Math.max(1, cfg.spacing)))
    const theoreticalMuck = area * commandedDistance
    return [
      calibrationRow('掘进里程', state.distance, commandedDistance, 'm', Math.max(0.1, commandedDistance * 0.2)),
      calibrationRow('管片环数', state.rings, expectedRings, '环', 1),
      calibrationRow('开挖体积', state.muckVolume, theoreticalMuck, 'm³', Math.max(0.1, theoreticalMuck * 0.1)),
      calibrationRow('出渣质量闭合', Math.abs(state.muckBalance), 0, 'kg', Math.max(1, state.muckMass * 0.01)),
      calibrationRow('掌子面水压', state.facePressure, Math.max(0.02, state.facePressure), 'MPa', 0.5),
      calibrationRow('支护压力差', Math.max(0, state.facePressure - state.supportPressure), 0, 'MPa', 0.5),
      calibrationRow('比能', state.specificEnergy, 2.5, 'kWh/m³', 2)
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
      围岩级别: state.rock,
      推进速度mms: Number((state.advanceVelocity * 1000).toFixed(1)),
      净推力kN: Number((state.netForce / 1000).toFixed(0)),
      出渣闭合kg: Number(state.muckBalance.toFixed(1)),
      刀盘转速rpm: cfg.rpm,
      掌子面水压MPa: Number(state.facePressure.toFixed(2)),
      支护压力MPa: Number(state.supportPressure.toFixed(2)),
      扭矩kNm: Number((state.torque / 1000).toFixed(0)),
      风险指数: Number(state.risk.toFixed(2))
    }),
    calibration,
    serialize: () => ({ ...state })
  }
}
