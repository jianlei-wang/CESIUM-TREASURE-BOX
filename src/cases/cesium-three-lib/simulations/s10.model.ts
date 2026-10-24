import { calibrationRow, clamp, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export interface S10Config {
  wind: number
  direction: number
  gust: number
  clothStiffness: number
  treeSway: number
}

export interface S10State {
  time: number
  effectiveWind: number
  direction: number
  amplitude: number
  canopyOffset: number
  windX: number
  windZ: number
  cloth: Float32Array
}

export const S10_COLS = 25
export const S10_ROWS = 15
export const S10_WIDTH = 30
export const S10_HEIGHT = 18
const SUBSTEP = 1 / 120
const ITERATIONS = 5

export function createS10Model(config: S10Config): ScenarioSimulation & {
  state: S10State
  configure(next: Partial<S10Config>): void
  resetCloth(): void
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  const count = S10_COLS * S10_ROWS
  const x0 = new Float32Array(count)
  const y0 = new Float32Array(count)
  const pos = new Float32Array(count * 3)
  const prev = new Float32Array(count * 3)
  const pinned = new Uint8Array(count)
  const constraints: Array<[number, number, number]> = []
  const state: S10State = { time: 0, effectiveWind: 0, direction: cfg.direction, amplitude: 0, canopyOffset: 0, windX: 0, windZ: -1, cloth: new Float32Array(count * 3) }

  for (let row = 0; row < S10_ROWS; row += 1) {
    for (let col = 0; col < S10_COLS; col += 1) {
      const index = row * S10_COLS + col
      x0[index] = (col / (S10_COLS - 1)) * S10_WIDTH
      y0[index] = ((row / (S10_ROWS - 1)) - 0.5) * S10_HEIGHT
      pinned[index] = col === 0 ? 1 : 0
    }
  }
  const addConstraint = (a: number, b: number): void => {
    const dx = x0[a] - x0[b]
    const dy = y0[a] - y0[b]
    constraints.push([a, b, Math.hypot(dx, dy)])
  }
  for (let row = 0; row < S10_ROWS; row += 1) {
    for (let col = 0; col < S10_COLS; col += 1) {
      const index = row * S10_COLS + col
      if (col < S10_COLS - 1) addConstraint(index, index + 1)
      if (row < S10_ROWS - 1) addConstraint(index, index + S10_COLS)
      if (col < S10_COLS - 1 && row < S10_ROWS - 1) {
        addConstraint(index, index + S10_COLS + 1)
        addConstraint(index + 1, index + S10_COLS)
      }
      if (col < S10_COLS - 2) addConstraint(index, index + 2)
      if (row < S10_ROWS - 2) addConstraint(index, index + 2 * S10_COLS)
    }
  }

  const resetCloth = (): void => {
    for (let index = 0; index < count; index += 1) {
      const z = 0
      pos[index * 3] = x0[index]
      pos[index * 3 + 1] = y0[index]
      pos[index * 3 + 2] = z
      prev[index * 3] = x0[index]
      prev[index * 3 + 1] = y0[index]
      prev[index * 3 + 2] = z
    }
    state.time = 0
    state.amplitude = 0
    state.cloth.set(pos)
  }

  const solve = (): void => {
    const stiffness = clamp(1 - cfg.clothStiffness * 0.55, 0.35, 0.98)
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      for (const [a, b, rest] of constraints) {
        const ax = pos[a * 3]
        const ay = pos[a * 3 + 1]
        const az = pos[a * 3 + 2]
        const bx = pos[b * 3]
        const by = pos[b * 3 + 1]
        const bz = pos[b * 3 + 2]
        const dx = bx - ax
        const dy = by - ay
        const dz = bz - az
        const distance = Math.hypot(dx, dy, dz) || 1e-6
        const correction = ((distance - rest) / distance) * stiffness * 0.5
        if (!pinned[a]) {
          pos[a * 3] += dx * correction
          pos[a * 3 + 1] += dy * correction
          pos[a * 3 + 2] += dz * correction
        }
        if (!pinned[b]) {
          pos[b * 3] -= dx * correction
          pos[b * 3 + 1] -= dy * correction
          pos[b * 3 + 2] -= dz * correction
        }
      }
      for (let index = 0; index < count; index += 1) {
        if (pinned[index]) {
          pos[index * 3] = x0[index]
          pos[index * 3 + 1] = y0[index]
          pos[index * 3 + 2] = 0
        }
      }
    }
  }

  const integrate = (dt: number): void => {
    const dir = (cfg.direction * Math.PI) / 180
    const windX = Math.sin(dir)
    const windZ = -Math.cos(dir)
    state.windX = windX
    state.windZ = windZ
    state.direction = cfg.direction
    const gust = 1 + Math.sin(state.time * 1.7) * cfg.gust * 0.55 + Math.sin(state.time * 3.3 + 0.8) * cfg.gust * 0.22
    state.effectiveWind = Math.max(0, cfg.wind * gust)
    const drag = 0.00055 * state.effectiveWind * state.effectiveWind
    for (let index = 0; index < count; index += 1) {
      if (pinned[index]) continue
      const px = pos[index * 3]
      const py = pos[index * 3 + 1]
      const turbulence = 0.7 + 0.3 * Math.sin(px * 0.4 + state.time * 1.6) * Math.cos(py * 0.3 - state.time)
      const ax = windX * drag * turbulence * 0.22
      const az = windZ * drag * turbulence
      const vx = (px - prev[index * 3]) * 0.985
      const vy = (py - prev[index * 3 + 1]) * 0.985
      const vz = (pos[index * 3 + 2] - prev[index * 3 + 2]) * 0.985
      prev[index * 3] = px
      prev[index * 3 + 1] = py
      prev[index * 3 + 2] = pos[index * 3 + 2]
      pos[index * 3] = px + vx + ax * dt * dt
      pos[index * 3 + 1] = py + vy - 9.81 * dt * dt
      pos[index * 3 + 2] = clamp(pos[index * 3 + 2] + vz + az * dt * dt, -14, 14)
    }
    state.time += dt
    solve()
    let amplitude = 0
    for (let index = 0; index < count; index += 1) amplitude = Math.max(amplitude, Math.abs(pos[index * 3 + 2]))
    state.amplitude = amplitude
    state.canopyOffset = Math.min(3.4, (state.effectiveWind / 18) * cfg.treeSway * 1.8)
    state.cloth.set(pos)
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
    const tensionMax = Math.max(0, state.amplitude)
    return [
      calibrationRow('布料振幅', state.amplitude, tensionMax, 'm', 0.01),
      calibrationRow('风速范围', state.effectiveWind, cfg.wind * (1 + cfg.gust), 'm/s', cfg.wind * 1.4 + 0.01),
      calibrationRow('约束数量', constraints.length, constraints.length, '条', 0),
      calibrationRow('树冠位移', state.canopyOffset, cfg.treeSway * 2, 'm', cfg.treeSway * 2 + 0.01)
    ]
  }

  const configure = (next: Partial<S10Config>): void => {
    cfg = { ...cfg, ...next }
  }

  resetCloth()

  return {
    state,
    get mode() {
      return mode
    },
    setMode(next) {
      mode = next
    },
    configure,
    resetCloth,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(2)),
      有效风速ms: Number(state.effectiveWind.toFixed(1)),
      风向deg: cfg.direction,
      布料振幅m: Number(state.amplitude.toFixed(2)),
      树冠位移m: Number(state.canopyOffset.toFixed(2)),
      约束数: constraints.length
    }),
    calibration,
    serialize: () => ({ time: state.time, amplitude: state.amplitude, cloth: Array.from(state.cloth) }),
    reset: resetCloth
  }
}
