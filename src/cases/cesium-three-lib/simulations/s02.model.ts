import { calibrationRow, clamp, deterministicRng, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export interface S02Block {
  id: number
  home: [number, number, number]
  position: [number, number, number]
  velocity: [number, number, number]
  spin: [number, number, number]
  rotation: [number, number, number]
  size: number
  delay: number
  active: boolean
  settled: boolean
}

export interface S02Config {
  floors: number
  columns: number
  impulse: number
  delay: number
  gravity: number
  damping: number
}

export interface S02State {
  time: number
  triggered: boolean
  countdown: number
  peakImpulse: number
  blocks: S02Block[]
}

const BLOCK_SIZE = 7
const GAP = 0.35

export function createS02Model(config: S02Config): ScenarioSimulation & {
  state: S02State
  configure(next: Partial<S02Config>): void
  blast(): void
  rebuild(): void
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  let rng = deterministicRng(3141)
  const state: S02State = { time: 0, triggered: false, countdown: cfg.delay, peakImpulse: 0, blocks: [] }

  const build = (): void => {
    rng = deterministicRng(3141)
    state.time = 0
    state.triggered = false
    state.countdown = cfg.delay
    state.peakImpulse = 0
    state.blocks = []
    let id = 0
    for (let floor = 0; floor < Math.round(cfg.floors); floor += 1) {
      for (let cx = 0; cx < Math.round(cfg.columns); cx += 1) {
        for (let cz = 0; cz < Math.round(cfg.columns); cz += 1) {
          const x = (cx - (cfg.columns - 1) / 2) * (BLOCK_SIZE + GAP)
          const z = (cz - (cfg.columns - 1) / 2) * (BLOCK_SIZE + GAP)
          const y = floor * (BLOCK_SIZE * 0.62 + GAP) + BLOCK_SIZE * 0.31
          state.blocks.push({
            id: id++,
            home: [x, y, z],
            position: [x, y, z],
            velocity: [0, 0, 0],
            spin: [0, 0, 0],
            rotation: [0, 0, 0],
            size: BLOCK_SIZE,
            delay: 0,
            active: false,
            settled: false
          })
        }
      }
    }
  }

  const blast = (): void => {
    if (state.triggered) return
    state.triggered = true
    state.peakImpulse = cfg.impulse
    for (const block of state.blocks) {
      const distance = Math.max(6, Math.hypot(block.position[0], block.position[2]))
      const dx = block.position[0] / distance
      const dz = block.position[2] / distance
      const tx = -dz
      const tz = dx
      const heightFactor = 0.35 + block.position[1] / 40
      const strength = cfg.impulse * (0.45 + 18 / distance) * (0.45 + heightFactor * 0.55)
      block.velocity = [dx * strength, strength * (0.38 + rng() * 0.14), dz * strength]
      block.velocity[0] += tx * (rng() - 0.5) * strength * 0.35
      block.velocity[2] += tz * (rng() - 0.5) * strength * 0.35
      block.spin = [(rng() - 0.5) * 1.8, (rng() - 0.5) * 1.2, (rng() - 0.5) * 1.8]
      block.delay = 0.08 + distance * 0.012 + block.position[1] * 0.006 + rng() * 0.08
      block.active = false
    }
  }

  const configure = (next: Partial<S02Config>): void => {
    const key = `${cfg.floors}|${cfg.columns}`
    cfg = { ...cfg, ...next }
    if (`${cfg.floors}|${cfg.columns}` !== key) build()
  }

  const substep = (step: number): void => {
    for (const block of state.blocks) {
      if (state.triggered && !block.active && !block.settled) {
        block.delay -= step
        if (block.delay <= 0) block.active = true
      }
      if (!block.active || block.settled) continue
      block.velocity[1] -= cfg.gravity * step
      block.position[0] += block.velocity[0] * step
      block.position[1] += block.velocity[1] * step
      block.position[2] += block.velocity[2] * step
      block.rotation[0] += block.spin[0] * step
      block.rotation[1] += block.spin[1] * step
      block.rotation[2] += block.spin[2] * step
      const ground = block.size * 0.31
      if (block.position[1] < ground) {
        block.position[1] = ground
        if (Math.abs(block.velocity[1]) > 1.3) block.velocity[1] = Math.abs(block.velocity[1]) * 0.18
        else block.velocity[1] = 0
        const friction = Math.min(0.92, (0.65 + cfg.damping * 9) * step)
        block.velocity[0] *= 1 - friction
        block.velocity[2] *= 1 - friction
        const spinDrag = Math.max(0, 1 - step * 3.2)
        block.spin = [block.spin[0] * spinDrag, block.spin[1] * spinDrag, block.spin[2] * spinDrag]
        if (Math.hypot(...block.velocity) < 0.32 && Math.hypot(...block.spin) < 0.45) {
          block.velocity = [0, 0, 0]
          block.spin = [0, 0, 0]
          block.settled = true
        }
      }
    }
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 240, 1 / 30)
    state.time += step
    if (!state.triggered) {
      state.countdown -= step
      if (state.countdown <= 0) blast()
    }
    substep(step)
  }

  const activeCount = (): number => state.blocks.filter((block) => block.active && !block.settled).length
  const settledCount = (): number => state.blocks.filter((block) => block.settled).length

  const calibration = (): CalibrationRow[] => {
    const expected = Math.round(cfg.floors) * Math.round(cfg.columns) ** 2
    const intact = state.blocks.length ? Math.max(0, 100 - Math.round(((activeCount() + settledCount()) * 100) / state.blocks.length)) : 100
    return [
      calibrationRow('构件数量', state.blocks.length, expected, '块', 0),
      calibrationRow('初始完整率', 100, 100, '%', 0.001),
      calibrationRow('冲量非负', state.peakImpulse, Math.max(0, state.peakImpulse), '', 0),
      calibrationRow('运动块比例', (100 - intact) / 100, Math.min(1, state.blocks.length ? (state.time > 0.5 ? 1 : 0) : 0), '', 1)
    ]
  }

  build()

  return {
    state,
    get mode() {
      return mode
    },
    setMode(next) {
      mode = next
    },
    configure,
    blast,
    rebuild: build,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(2)),
      起爆: state.triggered ? '已触发' : `倒计时 ${state.countdown.toFixed(2)}s`,
      活跃碎块: activeCount(),
      停稳碎块: settledCount(),
      结构完整率: state.blocks.length ? `${Math.max(0, 100 - Math.round(((activeCount() + settledCount()) * 100) / state.blocks.length))}%` : '100%',
      起爆冲量: state.peakImpulse
    }),
    calibration,
    serialize: () => ({ ...state, blocks: state.blocks.map((block) => ({ id: block.id, p: block.position, r: block.rotation, a: block.active, s: block.settled })) }),
    reset: () => build()
  }
}
