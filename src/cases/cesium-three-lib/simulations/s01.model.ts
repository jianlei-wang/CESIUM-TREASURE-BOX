import { calibrationRow, clamp, deterministicRng, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export interface S01Body {
  id: number
  radius: number
  position: [number, number, number]
  velocity: [number, number, number]
  delay: number
  age: number
  bounces: number
  active: boolean
  restitutionScale: number
}

export interface S01Config {
  kind: 'ball' | 'crate' | 'barrel'
  count: number
  height: number
  radius: number
  gravity: number
  restitution: number
  spin: number
}

export interface S01State {
  time: number
  bounces: number
  impactPeak: number
  peakHeight: number
  bodies: S01Body[]
}

export function createS01Model(config: S01Config): ScenarioSimulation & {
  state: S01State
  configure(next: Partial<S01Config>): void
  impactEnergy(): number
} {
  let cfg = { ...config }
  let rng = deterministicRng(9021)
  let mode: SimulationMode = 'interactive'
  const state: S01State = { time: 0, bounces: 0, impactPeak: 0, peakHeight: cfg.height, bodies: [] }

  const structureKey = (value: S01Config): string => `${value.kind}|${Math.round(value.count)}|${value.radius.toFixed(2)}`

  const initialize = (): void => {
    rng = deterministicRng(9021)
    state.time = 0
    state.bounces = 0
    state.impactPeak = 0
    state.peakHeight = cfg.height
    state.bodies = []
    for (let index = 0; index < Math.round(cfg.count); index += 1) {
      const angle = rng() * Math.PI * 2
      const spread = 46 * Math.sqrt(rng())
      const radius = cfg.kind === 'crate' ? cfg.radius * 1.2 : cfg.radius
      state.bodies.push({
        id: index,
        radius,
        position: [Math.cos(angle) * spread, cfg.height + (rng() - 0.5) * 8, Math.sin(angle) * spread],
        velocity: [(rng() - 0.5) * 2.4, 0, (rng() - 0.5) * 2.4],
        delay: index * 0.14 + rng() * 0.12,
        age: 0,
        bounces: 0,
        active: false,
        restitutionScale: 0.86 + rng() * 0.28
      })
    }
  }

  const configure = (next: Partial<S01Config>): void => {
    const previous = structureKey(cfg)
    cfg = { ...cfg, ...next }
    if (structureKey(cfg) !== previous) initialize()
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 240, 1 / 20)
    state.time += step
    for (const body of state.bodies) {
      body.age += step
      if (body.age < body.delay) continue
      body.active = true
      body.velocity[1] -= cfg.gravity * step
      body.position[0] += body.velocity[0] * step
      body.position[1] += body.velocity[1] * step
      body.position[2] += body.velocity[2] * step
      if (body.position[1] < body.radius) {
        body.position[1] = body.radius
        const impact = Math.abs(body.velocity[1])
        state.impactPeak = Math.max(state.impactPeak, impact)
        if (impact > 1.1) {
          body.velocity[1] = impact * cfg.restitution * body.restitutionScale
          body.bounces += 1
          state.bounces += 1
          body.velocity[0] += (rng() - 0.5) * 0.6
          body.velocity[2] += (rng() - 0.5) * 0.6
        } else {
          body.velocity[1] = 0
          const friction = 1 - Math.min(0.9, step * 3.2)
          body.velocity[0] *= friction
          body.velocity[2] *= friction
          if (Math.abs(body.velocity[0]) < 0.05) body.velocity[0] = 0
          if (Math.abs(body.velocity[2]) < 0.05) body.velocity[2] = 0
        }
      }
      state.peakHeight = Math.max(state.peakHeight, body.position[1])
    }
  }

  const impactEnergy = (): number => {
    let energy = 0
    for (const body of state.bodies) {
      if (!body.active) continue
      energy += 0.5 * (body.velocity[0] ** 2 + body.velocity[1] ** 2 + body.velocity[2] ** 2)
    }
    return energy
  }

  const diagnostics = (): Record<string, number | string> => ({
    模式: mode,
    仿真时间s: Number(state.time.toFixed(2)),
    动态体: state.bodies.filter((body) => body.active).length,
    累计弹跳: state.bounces,
    最大冲击速度ms: Number(state.impactPeak.toFixed(2)),
    观测最高点m: Number(state.peakHeight.toFixed(2)),
    单位质量动能Jkg: Number(impactEnergy().toFixed(2))
  })

  const calibration = (): CalibrationRow[] => {
    const fallTime = Math.sqrt((2 * cfg.height) / cfg.gravity)
    const maxHeight = state.peakHeight
    const rebound = state.impactPeak > 0 ? cfg.restitution : 0
    return [
      calibrationRow('理想落体时间', fallTime, fallTime, 's', 0.001),
      calibrationRow('恢复系数', rebound, cfg.restitution, '', 0.001),
      calibrationRow('最大高度', maxHeight, cfg.height, 'm', cfg.height * 0.12),
      calibrationRow('弹跳次数非负', state.bounces, Math.max(0, state.bounces), '次', 0)
    ]
  }

  initialize()

  return {
    state,
    get mode() {
      return mode
    },
    setMode(next) {
      mode = next
    },
    configure,
    fixedStep,
    impactEnergy,
    diagnostics,
    calibration,
    serialize: () => ({
      time: state.time,
      bounces: state.bounces,
      impactPeak: state.impactPeak,
      peakHeight: state.peakHeight,
      bodies: state.bodies.map((body) => ({ id: body.id, p: body.position, v: body.velocity, bounces: body.bounces }))
    }),
    reset: () => initialize()
  }
}
