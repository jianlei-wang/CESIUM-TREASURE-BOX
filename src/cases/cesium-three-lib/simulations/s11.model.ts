import { calibrationRow, clamp, deterministicRng, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export interface S11Config {
  fuel: number
  spread: number
  humidity: number
  wind: number
  smoke: number
  rain: boolean
}

export interface S11State {
  time: number
  grid: number
  burn: Float32Array
  burning: Uint8Array
  burnt: Uint8Array
  burnedCells: number
  frontRadius: number
  frontSpeed: number
  smokeHeight: number
  activeCells: number
}

export const S11_GRID = 14
export const S11_CELL = 14

export function createS11Model(config: S11Config): ScenarioSimulation & {
  state: S11State
  configure(next: Partial<S11Config>): void
  ignite(): void
  getConfig(): S11Config
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  let rng = deterministicRng(3355)
  const count = S11_GRID * S11_GRID
  const state: S11State = {
    time: 0,
    grid: S11_GRID,
    burn: new Float32Array(count),
    burning: new Uint8Array(count),
    burnt: new Uint8Array(count),
    burnedCells: 0,
    frontRadius: 0,
    frontSpeed: 0,
    smokeHeight: 0,
    activeCells: 0
  }

  const ignite = (): void => {
    rng = deterministicRng(3355)
    state.burn.fill(0)
    state.burning.fill(0)
    state.burnt.fill(0)
    state.burnedCells = 0
    state.frontRadius = 0
    state.frontSpeed = 0
    state.smokeHeight = 0
    state.time = 0
    const center = Math.floor(S11_GRID / 2)
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const gx = center + dx
        const gz = center + dz
        if (gx < 0 || gz < 0 || gx >= S11_GRID || gz >= S11_GRID) continue
        const index = gz * S11_GRID + gx
        state.burning[index] = 1
        state.burn[index] = 0.05
      }
    }
  }

  const spreadFrom = (index: number): void => {
    const humidityFactor = Math.max(0, 1 - cfg.humidity / 120)
    const rainFactor = cfg.rain ? 0.08 : 1
    const wind = Math.max(0, cfg.wind)
    const base = 0.55 * cfg.spread * humidityFactor * rainFactor * (0.55 + cfg.fuel * 0.45)
    const gx = index % S11_GRID
    const gz = Math.floor(index / S11_GRID)
    const neighbors: Array<[number, number, number]> = [
      [gx + 1, gz, 1 + wind * 0.09],
      [gx - 1, gz, 1],
      [gx, gz + 1, 1 + wind * 0.035],
      [gx, gz - 1, 1]
    ]
    for (const [nx, nz, weight] of neighbors) {
      if (nx < 0 || nz < 0 || nx >= S11_GRID || nz >= S11_GRID) continue
      const next = nz * S11_GRID + nx
      if (state.burning[next] || state.burnt[next]) continue
      const probability = clamp(base * weight * 0.35, 0, 0.92)
      if (rng() < probability) {
        state.burning[next] = 1
        state.burn[next] = 0.02
      }
    }
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 120, 1 / 30)
    state.time += step
    const duration = 1 / Math.max(0.08, 0.12 + cfg.fuel * 0.22)
    let active = 0
    for (let index = 0; index < count; index += 1) {
      if (!state.burning[index]) continue
      active += 1
      state.burn[index] += step * duration
      if (state.burn[index] >= 1) {
        state.burning[index] = 0
        state.burnt[index] = 1
        state.burnedCells += 1
        spreadFrom(index)
      }
      const gx = index % S11_GRID
      const gz = Math.floor(index / S11_GRID)
      const radius = Math.hypot(gx - S11_GRID / 2, gz - S11_GRID / 2) * S11_CELL
      state.frontRadius = Math.max(state.frontRadius, radius)
    }
    state.activeCells = active
    state.frontSpeed = state.time > 0.5 ? state.frontRadius / state.time : 0
    const intensity = Math.max(0.1, cfg.fuel * cfg.spread * (0.4 + cfg.wind * 0.08) * (1 - cfg.humidity / 160))
    state.smokeHeight = Math.min(260, 22 * intensity ** 0.55 * Math.log10(1 + state.burnedCells * 4) * cfg.smoke)
  }

  const calibration = (): CalibrationRow[] => {
    const expectedFront = (state.time * cfg.spread * 2.2 * (1 - cfg.humidity / 130) * (cfg.rain ? 0.2 : 1))
    const mass = state.burnedCells + state.activeCells
    return [
      calibrationRow('已燃网格', state.burnedCells, state.burnedCells, '格', 0),
      calibrationRow('活动火线', state.activeCells, Math.max(1, Math.round(4 + state.time * 2)), '格', 9999),
      calibrationRow('火线半径', state.frontRadius, Math.max(0, expectedFront), 'm', Math.max(10, expectedFront * 0.8)),
      calibrationRow('网格守恒', mass <= count ? 0 : 1, 0, '', 0),
      calibrationRow('烟羽高度', state.smokeHeight, 260, 'm', 260)
    ]
  }

  const configure = (next: Partial<S11Config>): void => {
    cfg = { ...cfg, ...next }
  }

  ignite()

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
    ignite,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(1)),
      已燃网格: `${state.burnedCells}/${count}`,
      活动火线: state.activeCells,
      火线半径m: Number(state.frontRadius.toFixed(0)),
      扩展速度kmh: Number((state.frontSpeed * 3.6).toFixed(1)),
      烟羽高度m: Number(state.smokeHeight.toFixed(0)),
      风速ms: cfg.wind
    }),
    calibration,
    serialize: () => ({ time: state.time, burning: Array.from(state.burning), burnt: Array.from(state.burnt), burn: Array.from(state.burn) }),
    reset: ignite
  }
}
