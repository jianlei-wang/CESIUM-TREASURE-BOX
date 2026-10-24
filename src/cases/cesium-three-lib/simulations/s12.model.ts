import { calibrationRow, clamp, deterministicRng, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export type S12Kind = 'rain' | 'snow' | 'hail'

export interface S12Config {
  kind: S12Kind
  intensity: number
  wind: number
  gravity: number
  growth: number
  temperature: number
}

export interface S12Particle {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  terminal: number
  phase: number
}

export interface S12State {
  time: number
  particles: S12Particle[]
  activeCount: number
  accumulatedMm: number
  pondingDepth: number
  visibility: number
  kind: S12Kind
  temperature: number
}

export const S12_MAX_PARTICLES = 1500
const AREA_WIDTH = 260
const AREA_DEPTH = 260

const terminalVelocity = (kind: S12Kind, gravity: number): number => {
  if (kind === 'snow') return clamp(1.1 + gravity * 0.03, 0.8, 2.6)
  if (kind === 'hail') return clamp(9 + gravity * 0.9, 5, 30)
  return clamp(6 + gravity * 0.8, 4, 14)
}

export function createS12Model(config: S12Config): ScenarioSimulation & {
  state: S12State
  configure(next: Partial<S12Config>): void
  resetParticles(): void
  getConfig(): S12Config
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  let rng = deterministicRng(5107)
  const state: S12State = {
    time: 0,
    particles: [],
    activeCount: 0,
    accumulatedMm: 0,
    pondingDepth: 0,
    visibility: 30,
    kind: cfg.kind,
    temperature: cfg.temperature
  }

  const resetParticles = (): void => {
    rng = deterministicRng(5107)
    state.particles = []
    state.time = 0
    state.accumulatedMm = 0
    state.pondingDepth = 0
    const terminal = terminalVelocity(cfg.kind, cfg.gravity)
    for (let index = 0; index < S12_MAX_PARTICLES; index += 1) {
      state.particles.push({
        x: (rng() - 0.5) * AREA_WIDTH,
        y: rng() * 170,
        z: (rng() - 0.5) * AREA_DEPTH,
        vx: 0,
        vy: -terminal * (0.75 + rng() * 0.5),
        vz: 0,
        terminal,
        phase: rng() * Math.PI * 2
      })
    }
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 120, 1 / 30)
    state.time += step
    state.kind = cfg.kind
    state.temperature = cfg.temperature
    state.activeCount = Math.max(80, Math.min(S12_MAX_PARTICLES, Math.floor((S12_MAX_PARTICLES * cfg.intensity) / 100)))
    const terminal = terminalVelocity(cfg.kind, cfg.gravity)
    const tailWind = cfg.wind * (cfg.kind === 'hail' ? 0.55 : 1)
    const dragTime = cfg.kind === 'snow' ? 1.6 : cfg.kind === 'hail' ? 0.32 : 0.55
    for (let index = 0; index < state.activeCount; index += 1) {
      const particle = state.particles[index]
      particle.terminal = terminal
      const targetVx = tailWind + (cfg.kind === 'snow' ? Math.sin(state.time * 0.8 + particle.phase) * 1.4 : 0)
      const targetVz = cfg.kind === 'snow' ? Math.cos(state.time * 0.6 + particle.phase) * 1.1 : 0.6
      const tracking = Math.min(1, step / dragTime)
      particle.vx += (targetVx - particle.vx) * tracking
      particle.vz += (targetVz - particle.vz) * tracking
      particle.vy += (-terminal - particle.vy) * Math.min(1, step / dragTime)
      particle.x += particle.vx * step
      particle.y += particle.vy * step
      particle.z += particle.vz * step
      if (particle.y < 0.3) {
        particle.y = 150 + rng() * 30
        particle.x = (rng() - 0.5) * AREA_WIDTH
        particle.z = (rng() - 0.5) * AREA_DEPTH
        particle.vy = -terminal * (0.8 + rng() * 0.3)
      }
      if (particle.x > AREA_WIDTH / 2) particle.x -= AREA_WIDTH
      if (particle.x < -AREA_WIDTH / 2) particle.x += AREA_WIDTH
      if (particle.z > AREA_DEPTH / 2) particle.z -= AREA_DEPTH
      if (particle.z < -AREA_DEPTH / 2) particle.z += AREA_DEPTH
    }
    const meltFactor = cfg.kind === 'snow' ? (cfg.temperature > 2 ? 0.35 : 1) : cfg.kind === 'hail' ? (cfg.temperature > 5 ? 0.6 : 1) : 1
    state.accumulatedMm += (cfg.intensity / 3600) * step * meltFactor
    const runoff = cfg.kind === 'rain' ? 0.72 : 0.45
    state.pondingDepth = (state.accumulatedMm / 1000) * runoff * cfg.growth * 6
    const extinction = cfg.kind === 'snow' ? 0.055 : cfg.kind === 'hail' ? 0.035 : 0.025
    state.visibility = clamp(1000 * Math.exp(-extinction * cfg.intensity), 40, 2000)
  }

  const calibration = (): CalibrationRow[] => {
    const expected = (cfg.intensity / 3600) * state.time
    return [
      calibrationRow('累计降水', state.accumulatedMm, expected, 'mm', 0.05),
      calibrationRow('积雪/积水', state.pondingDepth, state.accumulatedMm / 1000, 'm', 0.02),
      calibrationRow('粒子数', state.activeCount, Math.round((S12_MAX_PARTICLES * cfg.intensity) / 100), '个', 1),
      calibrationRow('能见度', state.visibility, 10000, 'm', 10000)
    ]
  }

  const configure = (next: Partial<S12Config>): void => {
    const priorKind = cfg.kind
    cfg = { ...cfg, ...next }
    if (cfg.kind !== priorKind) resetParticles()
  }

  resetParticles()

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
    resetParticles,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(1)),
      降水类型: state.kind,
      降水强度mmh: cfg.intensity,
      累计降水mm: Number(state.accumulatedMm.toFixed(2)),
      积水深度m: Number(state.pondingDepth.toFixed(3)),
      能见度m: Number(state.visibility.toFixed(0)),
      气温C: state.temperature
    }),
    calibration,
    serialize: () => ({ time: state.time, accum: state.accumulatedMm, ponding: state.pondingDepth }),
    reset: resetParticles
  }
}
