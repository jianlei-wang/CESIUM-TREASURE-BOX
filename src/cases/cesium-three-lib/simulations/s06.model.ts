import { calibrationRow, clamp, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export interface S06Obstacle {
  x: number
  z: number
  halfWidth: number
  height: number
}

export interface S06Config {
  altitude: number
  speed: number
  sensor: number
  wind: number
  avoidance: boolean
  obstacles: S06Obstacle[]
}

export interface S06State {
  time: number
  angle: number
  position: [number, number, number]
  velocity: [number, number, number]
  battery: number
  nearest: number
  clearance: number
  avoidanceActive: boolean
  distance: number
}

const ORBIT_RADIUS = 105

export function createS06Model(config: S06Config): ScenarioSimulation & {
  state: S06State
  configure(next: Partial<S06Config>): void
  recharge(): void
} {
  let cfg = { ...config, obstacles: [...config.obstacles] }
  let mode: SimulationMode = 'interactive'
  const state: S06State = {
    time: 0,
    angle: 0,
    position: [ORBIT_RADIUS, cfg.altitude, 0],
    velocity: [0, 0, 0],
    battery: 100,
    nearest: 999,
    clearance: cfg.altitude,
    avoidanceActive: false,
    distance: 0
  }

  const recharge = (): void => {
    state.battery = 100
    state.angle = 0
    state.position = [ORBIT_RADIUS, cfg.altitude, 0]
    state.velocity = [0, 0, 0]
    state.time = 0
    state.distance = 0
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 120, 1 / 30)
    state.time += step
    const safeSpeed = Math.max(0.2, cfg.speed)
    const omega = safeSpeed / ORBIT_RADIUS
    state.angle += omega * step
    const targetX = Math.cos(state.angle) * ORBIT_RADIUS
    const targetZ = Math.sin(state.angle) * ORBIT_RADIUS
    const tangentX = -Math.sin(state.angle)
    const tangentZ = Math.cos(state.angle)
    let desiredX = tangentX * safeSpeed
    let desiredZ = tangentZ * safeSpeed
    let lift = 0
    let nearest = 999
    let clearance = 999
    let active = false
    for (const obstacle of cfg.obstacles) {
      const dx = state.position[0] - obstacle.x
      const dz = state.position[2] - obstacle.z
      const distance = Math.hypot(dx, dz)
      nearest = Math.min(nearest, Math.max(0, distance - obstacle.halfWidth))
      if (!cfg.avoidance) continue
      const influence = obstacle.halfWidth + cfg.sensor
      if (distance > influence) continue
      const verticalGap = state.position[1] - obstacle.height
      if (verticalGap > 14) continue
      const nx = distance > 0.001 ? dx / distance : 1
      const nz = distance > 0.001 ? dz / distance : 0
      const strength = (influence - distance) / Math.max(1, cfg.sensor)
      const side = nx * tangentX + nz * tangentZ
      desiredX += nx * strength * safeSpeed * 1.35 + tangentX * (side < 0 ? 1 : -1) * strength * safeSpeed * 0.65
      desiredZ += nz * strength * safeSpeed * 1.35 + tangentZ * (side < 0 ? 1 : -1) * strength * safeSpeed * 0.65
      lift = Math.max(lift, obstacle.height + 12 - state.position[1])
      active = true
      clearance = Math.min(clearance, Math.max(0, obstacle.height + 12 - state.position[1]))
    }
    const desiredSpeed = Math.hypot(desiredX, desiredZ)
    if (desiredSpeed > safeSpeed) {
      desiredX = (desiredX / desiredSpeed) * safeSpeed
      desiredZ = (desiredZ / desiredSpeed) * safeSpeed
    }
    const windX = Math.sin(state.time * 1.3 + state.angle) * cfg.wind * 0.18
    const windZ = Math.cos(state.time * 1.1) * cfg.wind * 0.12
    const tracking = Math.min(1, step * 2.6)
    state.velocity[0] += (desiredX + windX - state.velocity[0]) * tracking
    state.velocity[2] += (desiredZ + windZ - state.velocity[2]) * tracking
    const targetAltitude = cfg.altitude + lift + Math.sin(state.time * 0.8) * 0.8
    state.velocity[1] += (clamp((targetAltitude - state.position[1]) * 1.6, -8, 8) - state.velocity[1]) * Math.min(1, step * 2)
    state.position[0] += state.velocity[0] * step
    state.position[1] = clamp(state.position[1] + state.velocity[1] * step, 6, 240)
    state.position[2] += state.velocity[2] * step
    state.distance += Math.hypot(state.velocity[0], state.velocity[2]) * step
    state.nearest = nearest
    state.clearance = Math.min(clearance, state.position[1])
    state.avoidanceActive = active
    state.battery = Math.max(0, state.battery - step * (0.07 + Math.hypot(state.velocity[0], state.velocity[2]) * 0.0035 + (active ? 0.02 : 0)))
    if (Math.hypot(state.position[0] - targetX, state.position[2] - targetZ) > 20) {
      state.nearest = Math.min(state.nearest, Math.hypot(state.position[0] - targetX, state.position[2] - targetZ))
    }
  }

  const calibration = (): CalibrationRow[] => {
    const collisionFree = cfg.obstacles.every((obstacle) => {
      const horizontal = Math.hypot(state.position[0] - obstacle.x, state.position[2] - obstacle.z) - obstacle.halfWidth
      const vertical = state.position[1] - obstacle.height
      return horizontal > 0 || vertical > 0
    })
    return [
      calibrationRow('碰撞检测', collisionFree ? 0 : 1, 0, '次', 0),
      calibrationRow('最小净距', Math.max(0, state.nearest), 0, 'm', 9999),
      calibrationRow('最低离地', state.position[1], 6, 'm', 6),
      calibrationRow('剩余电量', state.battery, 0, '%', 100)
    ]
  }

  const configure = (next: Partial<S06Config>): void => {
    cfg = { ...cfg, ...next, obstacles: next.obstacles ? [...next.obstacles] : cfg.obstacles }
  }

  return {
    state,
    get mode() {
      return mode
    },
    setMode(next) {
      mode = next
    },
    configure,
    recharge,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      飞行时间s: Number(state.time.toFixed(1)),
      离地高度m: Number(state.position[1].toFixed(1)),
      水平速度ms: Number(Math.hypot(state.velocity[0], state.velocity[2]).toFixed(1)),
      最近障碍m: Number(state.nearest.toFixed(1)),
      避障介入: state.avoidanceActive ? '是' : '否',
      电量pct: Number(state.battery.toFixed(1)),
      航程m: Number(state.distance.toFixed(0))
    }),
    calibration,
    serialize: () => ({ ...state }),
    reset: recharge
  }
}
