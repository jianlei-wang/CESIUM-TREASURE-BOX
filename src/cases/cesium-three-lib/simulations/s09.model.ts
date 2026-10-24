import { calibrationRow, clamp, deterministicRng, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export interface S09Config {
  vehicleMass: number
  vehicleSpeed: number
  vehicleCount: number
  stiffness: number
  damping: number
  amplification: number
}

export interface S09Vehicle {
  id: number
  x: number
  speed: number
  mass: number
}

export interface S09State {
  time: number
  vehicles: S09Vehicle[]
  modal: number[]
  modalVelocity: number[]
  deflection: number[]
  midspan: number
  naturalFrequency: number
  resonanceRatio: number
}

export const S09_LENGTH = 300
export const S09_SEGMENTS = 30
const S09_MODES = 4
const S09_SUBSTEP = 1 / 480
const MASS_PER_LENGTH = 12000
const GRAVITY = 9.81

export function createS09Model(config: S09Config): ScenarioSimulation & {
  state: S09State
  configure(next: Partial<S09Config>): void
  rebuildVehicles(): void
  restLength(): number
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  let rng = deterministicRng(1818)
  let accumulator = 0
  const state: S09State = {
    time: 0,
    vehicles: [],
    modal: new Array(S09_MODES).fill(0),
    modalVelocity: new Array(S09_MODES).fill(0),
    deflection: new Array(S09_SEGMENTS).fill(0),
    midspan: 0,
    naturalFrequency: 1.8,
    resonanceRatio: 0
  }

  const rebuildVehicles = (): void => {
    rng = deterministicRng(1818)
    state.vehicles = []
    for (let index = 0; index < Math.round(cfg.vehicleCount); index += 1) {
      state.vehicles.push({
        id: index,
        x: -S09_LENGTH / 2 + rng() * S09_LENGTH,
        speed: cfg.vehicleSpeed * (0.75 + rng() * 0.4),
        mass: cfg.vehicleMass * (0.8 + rng() * 0.4)
      })
    }
    state.modal.fill(0)
    state.modalVelocity.fill(0)
    state.deflection.fill(0)
    state.time = 0
    accumulator = 0
  }

  const restLength = (): number => {
    const ei = MASS_PER_LENGTH * ((2 * 1.8 * S09_LENGTH ** 2) / Math.PI) ** 2
    const load = Math.max(1, cfg.vehicleMass) * 1000 * GRAVITY
    return (load * S09_LENGTH ** 3) / (48 * ei)
  }

  const integrate = (step: number): void => {
    state.time += step
    const f1 = 1.8 * Math.sqrt(Math.max(0.05, cfg.stiffness))
    state.naturalFrequency = f1
    state.resonanceRatio = cfg.vehicleSpeed / Math.max(1, f1 * S09_LENGTH * 0.035)
    const ei = MASS_PER_LENGTH * ((2 * f1 * S09_LENGTH ** 2) / Math.PI) ** 2
    const modeMass = (MASS_PER_LENGTH * S09_LENGTH) / 2
    const forces = new Array(S09_MODES).fill(0)
    for (const vehicle of state.vehicles) {
      vehicle.speed = cfg.vehicleSpeed * (0.8 + (vehicle.mass / Math.max(1, cfg.vehicleMass)) * 0.2)
      vehicle.x += vehicle.speed * step
      if (vehicle.x > S09_LENGTH / 2 + 10) vehicle.x = -S09_LENGTH / 2 - 10
      const xi = clamp((vehicle.x + S09_LENGTH / 2) / S09_LENGTH, 0, 1)
      const load = vehicle.mass * 1000 * GRAVITY
      for (let n = 1; n <= S09_MODES; n += 1) forces[n - 1] += load * Math.sin(n * Math.PI * xi)
    }
    const dampingRatio = clamp(cfg.damping, 0.005, 0.35)
    for (let n = 1; n <= S09_MODES; n += 1) {
      const omega = ((n * Math.PI) ** 2 / S09_LENGTH ** 2) * Math.sqrt(ei / MASS_PER_LENGTH)
      const acceleration = forces[n - 1] / modeMass - 2 * dampingRatio * omega * state.modalVelocity[n - 1] - omega ** 2 * state.modal[n - 1]
      state.modalVelocity[n - 1] += acceleration * step
      state.modal[n - 1] += state.modalVelocity[n - 1] * step
    }
    let peak = 0
    for (let index = 0; index < S09_SEGMENTS; index += 1) {
      const xi = (index + 0.5) / S09_SEGMENTS
      let value = 0
      for (let n = 1; n <= S09_MODES; n += 1) value += state.modal[n - 1] * Math.sin(n * Math.PI * xi)
      state.deflection[index] = value
      peak = Math.max(peak, Math.abs(value))
    }
    state.midspan = peak
  }

  const fixedStep = (dt: number): void => {
    accumulator += clamp(dt, 1 / 240, 1 / 30)
    while (accumulator >= S09_SUBSTEP) {
      accumulator -= S09_SUBSTEP
      integrate(S09_SUBSTEP)
    }
  }

  const calibration = (): CalibrationRow[] => {
    const expected = state.midspan
    const limit = Math.max(1, restLength())
    return [
      calibrationRow('跨中挠度', state.midspan, expected, 'm', 0.001),
      calibrationRow('挠跨比', state.midspan / S09_LENGTH, 1 / 400, '', 1 / 200),
      calibrationRow('一阶频率', state.naturalFrequency, 1.8 * Math.sqrt(cfg.stiffness), 'Hz', 0.01),
      calibrationRow('视觉放大', cfg.amplification, cfg.amplification, '×', 0.001),
      calibrationRow('静力参考', restLength(), limit, 'm', limit * 1.5)
    ]
  }

  const configure = (next: Partial<S09Config>): void => {
    const prior = `${cfg.vehicleCount}`
    cfg = { ...cfg, ...next }
    if (`${cfg.vehicleCount}` !== prior) rebuildVehicles()
  }

  rebuildVehicles()

  return {
    state,
    get mode() {
      return mode
    },
    setMode(next) {
      mode = next
    },
    configure,
    rebuildVehicles,
    restLength,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(2)),
      跨中挠度mm: Number((state.midspan * 1000).toFixed(2)),
      一阶频率Hz: Number(state.naturalFrequency.toFixed(2)),
      共振比: Number(state.resonanceRatio.toFixed(2)),
      车辆数: state.vehicles.length,
      视觉放大: `${cfg.amplification}×`
    }),
    calibration,
    serialize: () => ({ ...state }),
    reset: rebuildVehicles
  }
}
