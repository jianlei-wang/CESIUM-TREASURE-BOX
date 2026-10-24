import { calibrationRow, clamp, deterministicRng, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export interface S13Config {
  waveHeight: number
  period: number
  direction: number
  wind: number
  draft: number
  buoys: number
}

export interface S13Wave {
  amplitude: number
  frequency: number
  waveNumber: number
  directionX: number
  directionZ: number
  phase: number
}

export interface S13State {
  time: number
  components: S13Wave[]
  waveAmplitude: number
  roll: number
  pitch: number
  heave: number
  buoyancy: number
  rollVelocity: number
  pitchVelocity: number
  heaveVelocity: number
}

const GRAVITY = 9.81
const DEPTH = 40
const COMPONENTS = 32

const dispersion = (omega: number): number => {
  let low = 0.0001
  let high = 4
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const mid = (low + high) / 2
    const value = GRAVITY * mid * Math.tanh(mid * DEPTH) - omega * omega
    if (value > 0) high = mid
    else low = mid
  }
  return (low + high) / 2
}

export function createS13Model(config: S13Config): ScenarioSimulation & {
  state: S13State
  configure(next: Partial<S13Config>): void
  waveAt(x: number, z: number): number
  waveSlope(x: number, z: number): [number, number]
  reset(): void
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  let rng = deterministicRng(8761)
  const state: S13State = {
    time: 0,
    components: [],
    waveAmplitude: 0,
    roll: 0,
    pitch: 0,
    heave: 0,
    buoyancy: 0,
    rollVelocity: 0,
    pitchVelocity: 0,
    heaveVelocity: 0
  }

  const buildSpectrum = (): void => {
    rng = deterministicRng(8761)
    state.components = []
    const peak = Math.max(1.5, cfg.period)
    const omegaPeak = (2 * Math.PI) / peak
    const significant = Math.max(0.05, cfg.waveHeight)
    const baseDirection = (cfg.direction * Math.PI) / 180
    for (let index = 0; index < COMPONENTS; index += 1) {
      const fraction = (index + 0.5) / COMPONENTS
      const omega = omegaPeak * (0.55 + fraction * 1.65)
      const sigma = omega <= omegaPeak ? 0.07 : 0.09
      const r = omega / omegaPeak
      const peakEnhancement = Math.exp(-((r - 1) ** 2) / (2 * sigma ** 2))
      const jonswap = (0.0081 * GRAVITY ** 2 / omega ** 5) * Math.exp(-1.25 * (omegaPeak / omega) ** 4) * (1 + 0.07 * 3.3 * peakEnhancement)
      const bandwidth = (omegaPeak * 1.65) / COMPONENTS
      const amplitude = significant / 4 * Math.sqrt((2 * jonswap * bandwidth) / 1.2)
      const spread = 0.38 + 0.25 * rng()
      const direction = baseDirection + (rng() - 0.5) * spread * Math.PI
      const k = dispersion(omega)
      state.components.push({
        amplitude,
        frequency: omega,
        waveNumber: k,
        directionX: Math.sin(direction),
        directionZ: -Math.cos(direction),
        phase: rng() * Math.PI * 2
      })
    }
    const normalization = Math.sqrt(state.components.reduce((sum, component) => sum + component.amplitude ** 2, 0) * 2) / significant
    if (normalization > 0.01) {
      for (const component of state.components) component.amplitude /= normalization
    }
  }

  const waveAt = (x: number, z: number): number => {
    let height = 0
    for (const component of state.components) {
      const phase = component.waveNumber * (component.directionX * x + component.directionZ * z) - component.frequency * state.time + component.phase
      height += component.amplitude * Math.cos(phase)
    }
    return height
  }

  const waveSlope = (x: number, z: number): [number, number] => {
    let dx = 0
    let dz = 0
    for (const component of state.components) {
      const phase = component.waveNumber * (component.directionX * x + component.directionZ * z) - component.frequency * state.time + component.phase
      const factor = -component.amplitude * component.waveNumber * Math.sin(phase)
      dx += factor * component.directionX
      dz += factor * component.directionZ
    }
    return [dx, dz]
  }

  const reset = (): void => {
    state.time = 0
    state.roll = 0
    state.pitch = 0
    state.heave = 0
    state.rollVelocity = 0
    state.pitchVelocity = 0
    state.heaveVelocity = 0
    buildSpectrum()
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 120, 1 / 30)
    state.time += step
    const center = waveAt(0, 0)
    const bow = waveAt(0, -15)
    const stern = waveAt(0, 15)
    const port = waveAt(-6, 0)
    const starboard = waveAt(6, 0)
    state.waveAmplitude = Math.max(state.waveAmplitude, Math.abs(center))
    const waveFactor = 0.55 + cfg.wind * 0.012
    const targetHeave = center + cfg.draft * 0.25
    const targetRoll = Math.atan2(port - starboard, 12) * waveFactor
    const targetPitch = Math.atan2(stern - bow, 30) * waveFactor
    const heaveOmega = (2 * Math.PI) / Math.max(2, cfg.period)
    const rollOmega = heaveOmega * 1.6
    const pitchOmega = heaveOmega * 1.2
    state.heaveVelocity += (heaveOmega ** 2 * (targetHeave - state.heave) - 2 * 0.22 * heaveOmega * state.heaveVelocity) * step
    state.rollVelocity += (rollOmega ** 2 * (targetRoll - state.roll) - 2 * 0.14 * rollOmega * state.rollVelocity) * step
    state.pitchVelocity += (pitchOmega ** 2 * (targetPitch - state.pitch) - 2 * 0.18 * pitchOmega * state.pitchVelocity) * step
    state.heave += state.heaveVelocity * step
    state.roll += state.rollVelocity * step
    state.pitch += state.pitchVelocity * step
    const freeboard = 3.2 - cfg.draft
    const waterline = Math.max(0.1, cfg.waveHeight * 0.35)
    state.buoyancy = clamp((freeboard + waterline) / 4.2, 0, 1.2)
  }

  const calibration = (): CalibrationRow[] => {
    const hmax = state.components.reduce((sum, component) => sum + component.amplitude, 0)
    return [
      calibrationRow('有效波高', cfg.waveHeight, cfg.waveHeight, 'm', 0.001),
      calibrationRow('波面峰值', state.waveAmplitude, hmax, 'm', Math.max(0.1, hmax)),
      calibrationRow('横摇角', Math.abs(state.roll), 0.6, 'rad', 0.6),
      calibrationRow('浮力储备', state.buoyancy, 1, '', 0.25),
      calibrationRow('谱分量', state.components.length, COMPONENTS, '个', 0)
    ]
  }

  const configure = (next: Partial<S13Config>): void => {
    const prior = `${cfg.waveHeight}|${cfg.period}|${cfg.direction}`
    cfg = { ...cfg, ...next }
    if (`${cfg.waveHeight}|${cfg.period}|${cfg.direction}` !== prior) buildSpectrum()
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
    waveAt,
    waveSlope,
    reset,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(2)),
      有效波高m: cfg.waveHeight,
      波面峰值m: Number(state.waveAmplitude.toFixed(2)),
      横摇角deg: Number(((state.roll * 180) / Math.PI).toFixed(1)),
      纵摇角deg: Number(((state.pitch * 180) / Math.PI).toFixed(1)),
      升沉m: Number(state.heave.toFixed(2)),
      浮力储备: Number(state.buoyancy.toFixed(2))
    }),
    calibration,
    serialize: () => ({ ...state })
  }
}
