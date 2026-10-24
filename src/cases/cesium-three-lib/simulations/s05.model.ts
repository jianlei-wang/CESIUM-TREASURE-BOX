import { calibrationRow, clamp, deterministicRng, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export interface S05Vehicle {
  id: number
  s: number
  speed: number
  lane: number
  desired: number
}

export interface S05Config {
  targetSpeed: number
  friction: number
  slope: number
  traffic: number
  mode: 'auto' | 'manual'
}

export interface S05State {
  time: number
  speed: number
  distance: number
  vehicles: S05Vehicle[]
  minGap: number
  collisions: number
  completed: number
}

const TRACK_LENGTH = 640
const VEHICLE_LENGTH = 5.4

export function createS05Model(config: S05Config): ScenarioSimulation & {
  state: S05State
  configure(next: Partial<S05Config>): void
  trackProgress(): number
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  let rng = deterministicRng(10991)
  const state: S05State = { time: 0, speed: 0, distance: 0, vehicles: [], minGap: Infinity, collisions: 0, completed: 0 }

  const buildTraffic = (): void => {
    rng = deterministicRng(10991)
    state.vehicles = []
    for (let index = 0; index < Math.round(cfg.traffic); index += 1) {
      state.vehicles.push({
        id: index,
        s: (index + 1) * (TRACK_LENGTH / (cfg.traffic + 2)) + rng() * 12,
        speed: 10 + rng() * 8,
        lane: rng() > 0.5 ? 3.2 : -3.2,
        desired: 12 + rng() * 10
      })
    }
  }

  const configure = (next: Partial<S05Config>): void => {
    const previous = Math.round(cfg.traffic)
    cfg = { ...cfg, ...next }
    if (Math.round(cfg.traffic) !== previous) buildTraffic()
  }

  const idmAccel = (speed: number, desired: number, gap: number, leadSpeed: number, grade: number): number => {
    const maxAccel = 1.6
    const comfort = 1.4
    const timeGap = 1.4
    const minGap = 2.2
    const free = 1 - (speed / Math.max(0.1, desired)) ** 4
    const dynamicGap = minGap + Math.max(0, speed * timeGap + (speed * (speed - leadSpeed)) / (2 * Math.sqrt(maxAccel * comfort)))
    const interaction = gap > 0 ? (dynamicGap / gap) ** 2 : 4
    return maxAccel * (free - interaction) - 9.81 * Math.sin((grade * Math.PI) / 180)
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 240, 1 / 30)
    state.time += step
    const desired = cfg.mode === 'manual' ? Math.max(4, cfg.targetSpeed * 0.72) : cfg.targetSpeed
    const grade = -cfg.slope
    const nearestAhead = state.vehicles.filter((vehicle) => vehicle.s > state.distance).sort((a, b) => a.s - b.s)[0]
    const gap = nearestAhead ? nearestAhead.s - state.distance - VEHICLE_LENGTH : 200
    const leadSpeed = nearestAhead ? nearestAhead.speed : desired
    const acceleration = idmAccel(state.speed, desired, gap, leadSpeed, grade) * (0.55 + cfg.friction * 0.7)
    state.speed = Math.max(0, state.speed + acceleration * step)
    state.distance += state.speed * step
    if (state.distance >= TRACK_LENGTH) {
      state.distance = 0
      state.completed += 1
      state.speed = Math.min(state.speed, desired)
    }
    let previous = state.distance
    let minGap = Infinity
    for (const vehicle of state.vehicles) {
      vehicle.speed = Math.max(0, vehicle.speed + (vehicle.desired - vehicle.speed) * 0.35 * step)
      vehicle.s += vehicle.speed * step
      if (vehicle.s > TRACK_LENGTH) vehicle.s -= TRACK_LENGTH
      let gapToPrevious = vehicle.s - previous
      if (gapToPrevious < -TRACK_LENGTH / 2) gapToPrevious += TRACK_LENGTH
      if (gapToPrevious > 0 && gapToPrevious < minGap) minGap = gapToPrevious
      if (gapToPrevious > 0 && gapToPrevious < VEHICLE_LENGTH * 0.55) state.collisions += 1
      previous = vehicle.s
    }
    state.minGap = Math.min(state.minGap, minGap)
  }

  const diagnostics = (): Record<string, number | string> => ({
    模式: mode,
    当前车速ms: Number(state.speed.toFixed(2)),
    累计里程m: Number(state.distance.toFixed(0)),
    最小车头间距m: Number.isFinite(state.minGap) ? Number(state.minGap.toFixed(1)) : '—',
    跟车数量: state.vehicles.length,
    碰撞计数: state.collisions,
    完成圈数: state.completed
  })

  const calibration = (): CalibrationRow[] => {
    const kinematic = Math.sqrt(2 * 1.6 * TRACK_LENGTH)
    return [
      calibrationRow('目标速度', state.speed, cfg.targetSpeed, 'm/s', Math.max(1, cfg.targetSpeed * 0.25)),
      calibrationRow('动力学可达速度', kinematic, kinematic, 'm/s', 0.001),
      calibrationRow('安全车头间距', Number.isFinite(state.minGap) ? state.minGap : 0, VEHICLE_LENGTH + 2.2, 'm', 30),
      calibrationRow('碰撞计数', state.collisions, 0, '次', 0)
    ]
  }

  buildTraffic()

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
    trackProgress: () => state.distance / TRACK_LENGTH,
    diagnostics,
    calibration,
    serialize: () => ({
      time: state.time,
      speed: state.speed,
      distance: state.distance,
      vehicles: state.vehicles.map((vehicle) => ({ id: vehicle.id, s: vehicle.s, speed: vehicle.speed, lane: vehicle.lane }))
    }),
    reset: () => {
      state.time = 0
      state.speed = 0
      state.distance = 0
      state.completed = 0
      state.collisions = 0
      state.minGap = Infinity
      buildTraffic()
    }
  }
}
