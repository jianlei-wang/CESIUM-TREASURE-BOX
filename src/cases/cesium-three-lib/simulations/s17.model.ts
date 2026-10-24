import { calibrationRow, clamp, deterministicRng, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export interface S17Agent {
  x: number
  z: number
  vx: number
  vz: number
  speed: number
  radius: number
  active: boolean
  evacuated: boolean
}

export interface S17Obstacle {
  x: number
  z: number
  halfX: number
  halfZ: number
}

export interface S17Config {
  crowdSize: number
  agentSpeed: number
  panic: number
  exitWidth: number
  wallCount: number
}

export interface S17State {
  time: number
  agents: S17Agent[]
  evacuated: number
  flowRate: number
  maxDensity: number
  activeCount: number
  obstacles: S17Obstacle[]
}

export const S17_MAX_AGENTS = 400
const HALL_HALF_X = 52
const EXIT_Z = -52
const GRID_SIZE = 6

export function s17Obstacles(wallCount: number): S17Obstacle[] {
  const obstacles: S17Obstacle[] = []
  for (let index = 0; index < Math.max(0, Math.round(wallCount)); index += 1) {
    obstacles.push({ x: index % 2 === 0 ? -22 : 24, z: -20 + (index % 3) * 22, halfX: 1.4, halfZ: 9 })
  }
  return obstacles
}

export function createS17Model(config: S17Config): ScenarioSimulation & {
  state: S17State
  configure(next: Partial<S17Config>): void
  resetCrowd(): void
  getConfig(): S17Config
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  let rng = deterministicRng(2277)
  const state: S17State = { time: 0, agents: [], evacuated: 0, flowRate: 0, maxDensity: 0, activeCount: 0, obstacles: [] }

  const resetCrowd = (): void => {
    rng = deterministicRng(2277)
    state.time = 0
    state.evacuated = 0
    state.flowRate = 0
    state.maxDensity = 0
    state.agents = []
    state.obstacles = s17Obstacles(cfg.wallCount)
    for (let index = 0; index < S17_MAX_AGENTS; index += 1) {
      const active = index < Math.round(cfg.crowdSize)
      const position = active
        ? { x: (rng() - 0.5) * 96, z: (rng() - 0.5) * 88 }
        : { x: 999, z: 999 }
      state.agents.push({
        x: position.x,
        z: position.z,
        vx: 0,
        vz: 0,
        speed: cfg.agentSpeed * (0.85 + rng() * 0.3),
        radius: 0.32 + rng() * 0.08,
        active,
        evacuated: false
      })
    }
    state.activeCount = state.agents.filter((agent) => agent.active).length
  }

  const repelFromObstacles = (agent: S17Agent): [number, number] => {
    let fx = 0
    let fz = 0
    for (const obstacle of state.obstacles) {
      const dx = agent.x - obstacle.x
      const dz = agent.z - obstacle.z
      const overlapX = obstacle.halfX + agent.radius - Math.abs(dx)
      const overlapZ = obstacle.halfZ + agent.radius - Math.abs(dz)
      if (overlapX <= 0 || overlapZ <= 0) continue
      if (overlapX < overlapZ) fx += Math.sign(dx || 1) * overlapX * 14
      else fz += Math.sign(dz || 1) * overlapZ * 14
    }
    return [fx, fz]
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 120, 1 / 30)
    state.time += step
    const gap = Math.max(1, cfg.exitWidth) * 0.8
    const cells = new Map<string, number[]>()
    for (let index = 0; index < state.agents.length; index += 1) {
      const agent = state.agents[index]
      if (!agent.active || agent.evacuated) continue
      const key = `${Math.floor(agent.x / GRID_SIZE)},${Math.floor(agent.z / GRID_SIZE)}`
      const bucket = cells.get(key)
      if (bucket) bucket.push(index)
      else cells.set(key, [index])
    }
    const panic = clamp(cfg.panic, 0, 1)
    for (let index = 0; index < state.agents.length; index += 1) {
      const agent = state.agents[index]
      if (!agent.active || agent.evacuated) continue
      const distX = 0 - agent.x
      const distZ = EXIT_Z - 10 - agent.z
      const distance = Math.max(0.01, Math.hypot(distX, distZ))
      const desiredSpeed = agent.speed * (1 + panic * 0.65)
      let fx = (distX / distance) * desiredSpeed * 2.2
      let fz = (distZ / distance) * desiredSpeed * 2.2
      fx += Math.cos(state.time * 1.7 + index) * panic * 1.4
      fz += Math.sin(state.time * 1.3 + index) * panic * 1.1
      let pressure = 0
      const gx = Math.floor(agent.x / GRID_SIZE)
      const gz = Math.floor(agent.z / GRID_SIZE)
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oz = -1; oz <= 1; oz += 1) {
          const bucket = cells.get(`${gx + ox},${gz + oz}`)
          if (!bucket) continue
          for (const otherIndex of bucket) {
            if (otherIndex === index) continue
            const other = state.agents[otherIndex]
            const dx = agent.x - other.x
            const dz = agent.z - other.z
            const distanceSq = dx * dx + dz * dz
            if (distanceSq > 9 || distanceSq < 1e-8) continue
            const d = Math.sqrt(distanceSq)
            const radiusSum = agent.radius + other.radius
            const repulsion = 1.8 * Math.exp((radiusSum - d) / 0.28)
            fx += (dx / d) * repulsion
            fz += (dz / d) * repulsion
            if (d < radiusSum) {
              pressure += (radiusSum - d) * 8
              fx += (dx / d) * (radiusSum - d) * 9
              fz += (dz / d) * (radiusSum - d) * 9
            }
          }
        }
      }
      const [ox, oz] = repelFromObstacles(agent)
      fx += ox
      fz += oz
      if (agent.x < -HALL_HALF_X + 1) fx += (-HALL_HALF_X + 1 - agent.x) * 18
      if (agent.x > HALL_HALF_X - 1) fx -= (agent.x - (HALL_HALF_X - 1)) * 18
      if (agent.z > 50) fz -= (agent.z - 50) * 18
      const nextX = agent.x + agent.vx * step
      const nextZ = agent.z + agent.vz * step
      if (nextZ < -48 && Math.abs(nextX) > gap) {
        agent.z = -48
        fz += 8
      }
      const crowding = 1 + Math.min(3, pressure * 0.3)
      agent.vx += ((fx / crowding) - agent.vx) * Math.min(1, step * 5)
      agent.vz += ((fz / crowding) - agent.vz) * Math.min(1, step * 5)
      const speedNow = Math.hypot(agent.vx, agent.vz)
      const maxSpeed = agent.speed * (1 + panic * 1.1)
      if (speedNow > maxSpeed) {
        agent.vx = (agent.vx / speedNow) * maxSpeed
        agent.vz = (agent.vz / speedNow) * maxSpeed
      }
      agent.x += agent.vx * step
      agent.z += agent.vz * step
      agent.x = clamp(agent.x, -HALL_HALF_X + agent.radius, HALL_HALF_X - agent.radius)
      if (agent.z < -53 && Math.abs(agent.x) < gap) {
        agent.evacuated = true
        state.evacuated += 1
        continue
      }
      if (agent.z < -48 && Math.abs(agent.x) <= gap) agent.z = Math.max(agent.z, -53.5)
    }
    state.activeCount = state.agents.filter((agent) => agent.active && !agent.evacuated).length
    const remaining = state.activeCount
    const area = 110 * 104
    state.maxDensity = Math.max(state.maxDensity, (remaining / area) * 100)
    state.flowRate = state.time > 0.5 ? (state.evacuated / state.time) * 60 : 0
  }

  const calibration = (): CalibrationRow[] => {
    const width = Math.max(1, cfg.exitWidth)
    const specificFlow = 1.3 * width * 60
    return [
      calibrationRow('出口流率', state.flowRate, specificFlow, '人/min', specificFlow * 1.4),
      calibrationRow('已疏散', state.evacuated, Math.round(cfg.crowdSize), '人', Math.round(cfg.crowdSize)),
      calibrationRow('峰值密度', state.maxDensity, 4, '人/100m²', 8),
      calibrationRow('活动人数', state.activeCount, Math.round(cfg.crowdSize), '人', 1),
      calibrationRow('比流量', width > 0 ? state.flowRate / 60 / width : 0, 1.3, '人/m/s', 2)
    ]
  }

  const configure = (next: Partial<S17Config>): void => {
    const prior = `${cfg.crowdSize}|${cfg.exitWidth}|${cfg.wallCount}`
    cfg = { ...cfg, ...next }
    if (`${cfg.crowdSize}|${cfg.exitWidth}|${cfg.wallCount}` !== prior) resetCrowd()
  }

  resetCrowd()

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
    resetCrowd,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(1)),
      已疏散: state.evacuated,
      活动人数: state.activeCount,
      出口流率pm: Number(state.flowRate.toFixed(1)),
      峰值密度: Number(state.maxDensity.toFixed(1)),
      出口宽度m: cfg.exitWidth
    }),
    calibration,
    serialize: () => ({ time: state.time, evacuated: state.evacuated, active: state.activeCount }),
    reset: resetCrowd
  }
}
