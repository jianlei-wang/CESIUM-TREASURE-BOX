import { calibrationRow, clamp, deterministicRng, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export interface S03Boulder {
  id: number
  radius: number
  x: number
  y: number
  z: number
  vx: number
  vz: number
  intercepted: boolean
}

export interface S03Config {
  slope: number
  gravity: number
  friction: number
  wet: boolean
  count: number
  radius: number
  barrier: number
}

export interface S03State {
  time: number
  boulders: S03Boulder[]
  maxSpeed: number
  runout: number
  intercepted: number
  released: number
}

export const S03_GROUND = (x: number, slope: number): number => {
  if (x > 20) return 0
  return Math.max(0, (20 - x) * Math.tan((slope * Math.PI) / 180) * 0.55)
}

export function createS03Model(config: S03Config): ScenarioSimulation & {
  state: S03State
  configure(next: Partial<S03Config>): void
  release(): void
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  let rng = deterministicRng(7717)
  const state: S03State = { time: 0, boulders: [], maxSpeed: 0, runout: -999, intercepted: 0, released: 0 }

  const release = (): void => {
    rng = deterministicRng(7717)
    state.time = 0
    state.boulders = []
    state.maxSpeed = 0
    state.runout = -999
    state.intercepted = 0
    state.released = Math.round(cfg.count)
    for (let index = 0; index < state.released; index += 1) {
      const radius = cfg.radius * (0.7 + rng() * 0.7)
      const x = -150 - rng() * 26
      state.boulders.push({
        id: index,
        radius,
        x,
        y: S03_GROUND(x, cfg.slope) + radius,
        z: (rng() - 0.5) * 60,
        vx: 1 + rng() * 2,
        vz: (rng() - 0.5) * 0.6,
        intercepted: false
      })
    }
  }

  const configure = (next: Partial<S03Config>): void => {
    const key = `${cfg.slope}|${cfg.count}|${cfg.radius}|${cfg.barrier}`
    cfg = { ...cfg, ...next }
    if (`${cfg.slope}|${cfg.count}|${cfg.radius}|${cfg.barrier}` !== key) release()
  }

  const substep = (step: number): void => {
    const angle = (cfg.slope * Math.PI) / 180
    for (const boulder of state.boulders) {
      const onSlope = boulder.x < 20
      if (onSlope) {
        const drive = cfg.gravity * Math.sin(angle) - cfg.friction * cfg.gravity * Math.cos(angle) * (cfg.wet ? 0.62 : 1)
        boulder.vx = Math.max(0, boulder.vx + drive * step)
      } else {
        boulder.vx *= 1 - Math.min(0.9, cfg.friction * step * 5)
      }
      boulder.x += boulder.vx * step
      boulder.z += boulder.vz * step
      boulder.y = S03_GROUND(boulder.x, cfg.slope) + boulder.radius
      const barrierTop = 1 + cfg.barrier * 10
      if (!boulder.intercepted && boulder.x > 6 && boulder.x < 12 && boulder.y < barrierTop && cfg.barrier > 0.3) {
        boulder.intercepted = true
        boulder.vx *= -0.22
        boulder.vz *= 0.42
        boulder.x = 5.6
        state.intercepted += 1
      }
      state.maxSpeed = Math.max(state.maxSpeed, Math.hypot(boulder.vx, boulder.vz))
      state.runout = Math.max(state.runout, boulder.x)
    }
    state.time += step
  }

  let accumulator = 0
  const fixedStep = (dt: number): void => {
    accumulator += clamp(dt, 1 / 240, 1 / 30)
    while (accumulator >= 1 / 120) {
      accumulator -= 1 / 120
      substep(1 / 120)
    }
  }

  const calibration = (): CalibrationRow[] => {
    const ideal = Math.sqrt(2 * cfg.gravity * Math.max(1, (20 + 150) * Math.tan((cfg.slope * Math.PI) / 180) * 0.55))
    return [
      calibrationRow('释放块数', state.released, Math.round(cfg.count), '块', 0),
      calibrationRow('最大速度', state.maxSpeed, ideal, 'm/s', ideal * 1.4),
      calibrationRow('拦截率', state.released ? state.intercepted / state.released : 0, state.released ? 1 : 0, '', 1),
      calibrationRow('最远滚距', Math.max(0, state.runout + 150), Math.max(0, state.runout + 150), 'm', 0.001)
    ]
  }

  release()

  return {
    state,
    get mode() {
      return mode
    },
    setMode(next) {
      mode = next
    },
    configure,
    release,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(2)),
      释放岩块: state.released,
      最大速度ms: Number(state.maxSpeed.toFixed(2)),
      拦截率: `${state.released ? Math.round((state.intercepted / state.released) * 100) : 0}%`,
      最远滚距m: Number(Math.max(0, state.runout + 150).toFixed(1))
    }),
    calibration,
    serialize: () => ({ ...state, boulders: state.boulders.map((boulder) => ({ id: boulder.id, x: boulder.x, z: boulder.z, vx: boulder.vx })) }),
    reset: () => release()
  }
}
