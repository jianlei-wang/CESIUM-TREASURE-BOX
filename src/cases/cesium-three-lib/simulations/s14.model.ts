import { calibrationRow, clamp, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export interface S14Config {
  pga: number
  frequency: number
  duration: number
  damping: number
  floors: number
  mode: number
}

export interface S14State {
  time: number
  displacement: number[]
  velocity: number[]
  acceleration: number[]
  roofDisplacement: number
  driftRatio: number
  peakAcceleration: number
  fundamentalFrequency: number
  excitationFrequency: number
  envelope: number
  groundAcceleration: number
}

const FLOOR_MASS = 120000
const GRAVITY = 9.81
const SUBSTEP = 1 / 480

export function createS14Model(config: S14Config): ScenarioSimulation & {
  state: S14State
  configure(next: Partial<S14Config>): void
  rebuild(): void
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  const state: S14State = { time: 0, displacement: [], velocity: [], acceleration: [], roofDisplacement: 0, driftRatio: 0, peakAcceleration: 0, fundamentalFrequency: 2.4, excitationFrequency: 2.4, envelope: 0, groundAcceleration: 0 }

  const fundamental = (): number => 1.8 * Math.sqrt(8 / Math.max(1, cfg.floors))

  const rebuild = (): void => {
    const floors = Math.max(1, Math.round(cfg.floors))
    state.displacement = new Array(floors).fill(0)
    state.velocity = new Array(floors).fill(0)
    state.acceleration = new Array(floors).fill(0)
    state.time = 0
    state.roofDisplacement = 0
    state.driftRatio = 0
    state.peakAcceleration = 0
    state.fundamentalFrequency = fundamental()
    state.excitationFrequency = cfg.frequency
    const selected = clamp(cfg.mode, 1, 3)
    const amplitude = cfg.pga * 0.045
    for (let floor = 0; floor < floors; floor += 1) {
      const shape = Math.sin((selected * Math.PI * (floor + 1)) / (floors + 1))
      state.displacement[floor] = shape * amplitude
    }
  }

  const stiffness = (): { k: number; omega: number[] } => {
    const floors = state.displacement.length
    const omega1 = 2 * Math.PI * state.fundamentalFrequency
    const k = FLOOR_MASS * (omega1 / (2 * Math.sin(Math.PI / (2 * (floors + 1))))) ** 2
    const omega: number[] = []
    for (let order = 1; order <= floors; order += 1) omega.push(2 * Math.sqrt(k / FLOOR_MASS) * Math.sin((order * Math.PI) / (2 * (floors + 1))))
    return { k, omega }
  }

  const integrate = (step: number): void => {
    const floors = state.displacement.length
    const { k } = stiffness()
    const omega1 = 2 * Math.PI * state.fundamentalFrequency
    const dampingRatio = clamp(cfg.damping, 0.005, 0.4)
    const time = state.time
    const strong = Math.max(4, cfg.duration)
    const envelope = time < 1 ? time : time <= strong ? 1 : Math.max(0, 1 - (time - strong) / 7)
    state.envelope = envelope
    const excitation = 2 * Math.PI * Math.max(0.2, cfg.frequency)
    const ground = cfg.pga * GRAVITY * envelope * (Math.sin(excitation * time) + 0.38 * Math.sin(excitation * 2.13 * time + 0.7))
    state.groundAcceleration = ground
    const forces = new Array(floors).fill(0)
    for (let floor = 0; floor < floors; floor += 1) {
      const u = state.displacement[floor]
      const up = floor < floors - 1 ? state.displacement[floor + 1] : 0
      const down = floor > 0 ? state.displacement[floor - 1] : 0
      const ku = k * (2 * u - up - down)
      const cv = (2 * dampingRatio / omega1) * k * (2 * state.velocity[floor] - (floor < floors - 1 ? state.velocity[floor + 1] : 0) - (floor > 0 ? state.velocity[floor - 1] : 0))
      forces[floor] = -FLOOR_MASS * ground - ku - cv
    }
    for (let floor = 0; floor < floors; floor += 1) {
      state.acceleration[floor] = forces[floor] / FLOOR_MASS
      state.velocity[floor] += state.acceleration[floor] * step
      state.displacement[floor] += state.velocity[floor] * step
    }
    state.time += step
    let roof = 0
    let drift = 0
    let peak = 0
    for (let floor = 0; floor < floors; floor += 1) {
      roof = Math.max(roof, Math.abs(state.displacement[floor]))
      const below = floor > 0 ? state.displacement[floor - 1] : 0
      drift = Math.max(drift, Math.abs(state.displacement[floor] - below) / 4.2)
      peak = Math.max(peak, Math.abs(state.acceleration[floor] + ground) / GRAVITY)
    }
    state.roofDisplacement = roof
    state.driftRatio = drift
    state.peakAcceleration = Math.max(state.peakAcceleration, peak)
  }

  let accumulator = 0
  const fixedStep = (dt: number): void => {
    accumulator += clamp(dt, 1 / 240, 1 / 30)
    while (accumulator >= SUBSTEP) {
      accumulator -= SUBSTEP
      integrate(SUBSTEP)
    }
  }

  const calibration = (): CalibrationRow[] => {
    const floors = state.displacement.length
    const selected = clamp(cfg.mode, 1, 3)
    let shapeMax = 0
    for (let floor = 0; floor < floors; floor += 1) shapeMax = Math.max(shapeMax, Math.sin((selected * Math.PI * (floor + 1)) / (floors + 1)))
    return [
      calibrationRow('基本频率', state.fundamentalFrequency, fundamental(), 'Hz', 0.01),
      calibrationRow('顶层位移', state.roofDisplacement, state.roofDisplacement, 'm', 0.01),
      calibrationRow('最大层间角', state.driftRatio, 1 / 550, '', 1 / 550),
      calibrationRow('峰值加速度', state.peakAcceleration, cfg.pga, 'g', cfg.pga * 2.5),
      calibrationRow('振型峰值', shapeMax, 1, '', 0.5)
    ]
  }

  const configure = (next: Partial<S14Config>): void => {
    const priorFloors = state.displacement.length || Math.round(cfg.floors)
    const priorMode = cfg.mode
    cfg = { ...cfg, ...next }
    if (Math.round(cfg.floors) !== priorFloors || clamp(cfg.mode, 1, 3) !== clamp(priorMode, 1, 3)) rebuild()
  }

  rebuild()

  return {
    state,
    get mode() {
      return mode
    },
    setMode(next) {
      mode = next
    },
    configure,
    rebuild,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(2)),
      楼层数: state.displacement.length,
      基本频率Hz: Number(state.fundamentalFrequency.toFixed(2)),
      激励频率Hz: Number(cfg.frequency.toFixed(2)),
      顶层位移cm: Number((state.roofDisplacement * 100).toFixed(1)),
      层间位移角: state.driftRatio > 0 ? `1/${Math.max(1, Math.round(1 / state.driftRatio))}` : '0',
      峰值加速度g: Number(state.peakAcceleration.toFixed(2)),
      包络: Number(state.envelope.toFixed(2))
    }),
    calibration,
    serialize: () => ({ ...state }),
    reset: rebuild
  }
}
