import { calibrationRow, clamp, deterministicRng, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export type S19Stability = 'stable' | 'neutral' | 'unstable'

export interface S19Config {
  sources: number
  stackHeight: number
  emission: number
  windSpeed: number
  windDir: number
  stability: S19Stability
}

export interface S19State {
  time: number
  positions: Float32Array
  colors: Float32Array
  age: Float32Array
  life: Float32Array
  emitted: number
  maxConcentration: number
  plumeLength: number
  boundaryLayer: number
  active: number
  windX: number
  windZ: number
}

export const S19_MAX_PARTICLES = 900

const sigmaY = (distance: number, stability: S19Stability): number => {
  if (stability === 'unstable') return 0.22 * distance * (1 + 0.0001 * distance) ** -0.5
  if (stability === 'stable') return 0.04 * distance * (1 + 0.0001 * distance) ** -0.5
  return 0.08 * distance * (1 + 0.0001 * distance) ** -0.5
}

const sigmaZ = (distance: number, stability: S19Stability): number => {
  if (stability === 'unstable') return 0.2 * distance
  if (stability === 'stable') return 0.016 * distance * (1 + 0.0003 * distance) ** -1
  return 0.06 * distance * (1 + 0.0015 * distance) ** -0.5
}

export function groundConcentration(distance: number, config: S19Config): number {
  const u = Math.max(0.3, config.windSpeed)
  const q = Math.max(0.01, config.emission * 0.6)
  const sy = Math.max(0.5, sigmaY(distance, config.stability))
  const sz = Math.max(0.5, sigmaZ(distance, config.stability))
  const height = Math.max(1, config.stackHeight)
  const c = (q / (Math.PI * u * sy * sz)) * Math.exp(-(height * height) / (2 * sz * sz))
  return c * 1e6
}

export function createS19Model(config: S19Config): ScenarioSimulation & {
  state: S19State
  configure(next: Partial<S19Config>): void
  clear(): void
  peakGroundConcentration(): number
  getConfig(): S19Config
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  let rng = deterministicRng(4409)
  const positions = new Float32Array(S19_MAX_PARTICLES * 3)
  const colors = new Float32Array(S19_MAX_PARTICLES * 3)
  const age = new Float32Array(S19_MAX_PARTICLES)
  const life = new Float32Array(S19_MAX_PARTICLES)
  const vx = new Float32Array(S19_MAX_PARTICLES)
  const vy = new Float32Array(S19_MAX_PARTICLES)
  const vz = new Float32Array(S19_MAX_PARTICLES)
  let cursor = 0
  let emitAccumulator = 0
  let emitted = 0
  const state: S19State = {
    time: 0,
    positions,
    colors,
    age,
    life,
    emitted: 0,
    maxConcentration: 0,
    plumeLength: 0,
    boundaryLayer: 900,
    active: 0,
    windX: 0,
    windZ: 0
  }

  const clear = (): void => {
    positions.fill(0)
    colors.fill(0)
    age.fill(0)
    life.fill(0)
    vx.fill(0)
    vy.fill(0)
    vz.fill(0)
    cursor = 0
    emitAccumulator = 0
    emitted = 0
    state.emitted = 0
    state.maxConcentration = 0
    state.time = 0
    rng = deterministicRng(4409)
  }

  const spawn = (sourceIndex: number): void => {
    const index = cursor
    cursor = (cursor + 1) % S19_MAX_PARTICLES
    const sourceX = (sourceIndex - (Math.max(1, Math.round(cfg.sources)) - 1) / 2) * 22
    positions[index * 3] = sourceX + (rng() - 0.5) * 4
    positions[index * 3 + 1] = cfg.stackHeight + rng() * 3
    positions[index * 3 + 2] = (rng() - 0.5) * 4
    const buoyancy = clamp(2.4 - cfg.windSpeed * 0.07, 0.6, 2.4)
    vx[index] = (rng() - 0.5) * 0.6
    vy[index] = buoyancy + rng() * 0.8
    vz[index] = (rng() - 0.5) * 0.6
    age[index] = 0.0001
    life[index] = 12 + rng() * 10
    emitted += 1
  }

  const peakGroundConcentration = (): number => {
    let peak = 0
    for (let distance = 20; distance <= 3000; distance += 20) peak = Math.max(peak, groundConcentration(distance, cfg))
    return peak
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 120, 1 / 30)
    state.time += step
    const direction = (cfg.windDir * Math.PI) / 180
    const windX = Math.cos(direction) * cfg.windSpeed
    const windZ = Math.sin(direction) * cfg.windSpeed
    state.windX = windX
    state.windZ = windZ
    state.boundaryLayer = cfg.stability === 'stable' ? 320 : cfg.stability === 'unstable' ? 1500 : 900
    const mixing = cfg.stability === 'stable' ? 0.22 : cfg.stability === 'unstable' ? 1.5 : 0.62
    const timeScale = cfg.stability === 'stable' ? 9 : cfg.stability === 'unstable' ? 3 : 5
    const sigmaTurbulence = cfg.stability === 'stable' ? 0.28 : cfg.stability === 'unstable' ? 1.45 : 0.72
    emitAccumulator += cfg.emission * step
    let spawned = 0
    while (emitAccumulator >= 1 && spawned < 24) {
      emitAccumulator -= 1
      spawn(Math.floor(rng() * Math.max(1, Math.round(cfg.sources))))
      spawned += 1
    }
    for (let index = 0; index < S19_MAX_PARTICLES; index += 1) {
      if (age[index] <= 0) {
        positions[index * 3 + 1] = -100
        continue
      }
      age[index] += step
      if (age[index] > life[index]) {
        age[index] = 0
        positions[index * 3 + 1] = -100
        continue
      }
      const turbulent = (rng() - 0.5) * sigmaTurbulence * Math.sqrt(step)
      vx[index] += ((windX - vx[index]) / timeScale) * step + turbulent
      vz[index] += ((windZ - vz[index]) / timeScale) * step + (rng() - 0.5) * sigmaTurbulence * Math.sqrt(step)
      const ageFraction = age[index] / life[index]
      const buoyant = Math.max(0, 1 - ageFraction * 2.2) * mixing
      vy[index] += ((buoyant - vy[index]) / timeScale) * step + (rng() - 0.5) * sigmaTurbulence * Math.sqrt(step) * 0.7
      positions[index * 3] += vx[index] * step
      positions[index * 3 + 1] += vy[index] * step
      positions[index * 3 + 2] += vz[index] * step
      if (positions[index * 3 + 1] < 0.5) {
        positions[index * 3 + 1] = 0.5
        vy[index] = Math.abs(vy[index]) * 0.2
      }
      if (positions[index * 3 + 1] > state.boundaryLayer) {
        positions[index * 3 + 1] = state.boundaryLayer
        vy[index] = -Math.abs(vy[index]) * 0.3
      }
      const fraction = age[index] / life[index]
      const hue = 0.04 + fraction * 0.54
      const lightness = 0.58 - fraction * 0.16
      const rgb = hslToRgb(hue, 0.72, lightness)
      colors[index * 3] = rgb[0]
      colors[index * 3 + 1] = rgb[1]
      colors[index * 3 + 2] = rgb[2]
    }
    let active = 0
    for (let index = 0; index < S19_MAX_PARTICLES; index += 1) if (age[index] > 0) active += 1
    state.active = active
    state.emitted = emitted
    const peak = peakGroundConcentration()
    state.maxConcentration = Math.max(state.maxConcentration * 0.999, peak)
    let length = 0
    for (let distance = 20; distance <= 4000; distance += 20) {
      if (groundConcentration(distance, cfg) >= 20) length = distance
    }
    state.plumeLength = length
  }

  const calibration = (): CalibrationRow[] => {
    const peak = peakGroundConcentration()
    const xPeak = (() => {
      let best = 0
      let bestX = 0
      for (let distance = 20; distance <= 3000; distance += 20) {
        const value = groundConcentration(distance, cfg)
        if (value > best) {
          best = value
          bestX = distance
        }
      }
      return bestX
    })()
    return [
      calibrationRow('峰值浓度', peak, peak, 'µg/m³', peak),
      calibrationRow('峰值距离', xPeak, 200, 'm', 1500),
      calibrationRow('烟羽长度', state.plumeLength, state.plumeLength, 'm', 1),
      calibrationRow('边界层高度', state.boundaryLayer, cfg.stability === 'neutral' ? 900 : state.boundaryLayer, 'm', 100),
      calibrationRow('活跃粒子', state.active, S19_MAX_PARTICLES, '个', S19_MAX_PARTICLES)
    ]
  }

  const configure = (next: Partial<S19Config>): void => {
    cfg = { ...cfg, ...next }
  }

  clear()

  return {
    state,
    get mode() {
      return mode
    },
    setMode(next) {
      mode = next
    },
    configure,
    clear,
    getConfig: () => ({ ...cfg }),
    peakGroundConcentration,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(1)),
      活跃粒子: state.active,
      累计排放: state.emitted,
      峰值浓度: Number(peakGroundConcentration().toFixed(1)),
      烟羽长度m: state.plumeLength,
      边界层高度m: state.boundaryLayer,
      风速ms: cfg.windSpeed
    }),
    calibration,
    serialize: () => ({ time: state.time, emitted: state.emitted, active: state.active }),
    reset: clear
  }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 1) + 1) % 1
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const convert = (t: number): number => {
    let value = t
    if (value < 0) value += 1
    if (value > 1) value -= 1
    if (value < 1 / 6) return p + (q - p) * 6 * value
    if (value < 1 / 2) return q
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6
    return p
  }
  return [convert(hue + 1 / 3), convert(hue), convert(hue - 1 / 3)]
}
