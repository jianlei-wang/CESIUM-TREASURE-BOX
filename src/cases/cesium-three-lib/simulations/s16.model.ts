import { calibrationRow, clamp, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export interface S16Obstacle {
  x: number
  z: number
  width: number
  depth: number
}

export interface S16Config {
  speed: number
  waypoints: number
  robotType: 'wheeled' | 'quadruped'
  scanRange: number
  avoidance: boolean
  obstacles: S16Obstacle[]
}

export interface S16Point {
  x: number
  z: number
}

export interface S16State {
  time: number
  progress: number
  position: S16Point
  heading: number
  lateral: number
  battery: number
  nearest: number
  scanned: string
  path: S16Point[]
  pathLength: number
  waypointIndex: number
  completedLaps: number
}

const GRID_MIN = -140
const GRID_MAX = 140
const GRID_STEP = 10
const GRID_SIZE = Math.round((GRID_MAX - GRID_MIN) / GRID_STEP) + 1

export function createS16Model(config: S16Config): ScenarioSimulation & {
  state: S16State
  configure(next: Partial<S16Config>): void
  plannedPath(): S16Point[]
} {
  let cfg: S16Config = { ...config, obstacles: [...config.obstacles] }
  let mode: SimulationMode = 'interactive'
  const state: S16State = {
    time: 0,
    progress: 0,
    position: { x: 0, z: 0 },
    heading: 0,
    lateral: 0,
    battery: 100,
    nearest: Infinity,
    scanned: '未发现目标',
    path: [],
    pathLength: 1,
    waypointIndex: 0,
    completedLaps: 0
  }

  const waypointList = (count: number): S16Point[] => {
    const result: S16Point[] = []
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2
      result.push({ x: Math.cos(angle) * 100, z: Math.sin(angle) * 100 })
    }
    return result
  }

  const blocked = (x: number, z: number): boolean => {
    for (const obstacle of cfg.obstacles) {
      const halfW = obstacle.width / 2 + 3
      const halfD = obstacle.depth / 2 + 3
      if (Math.abs(x - obstacle.x) < halfW && Math.abs(z - obstacle.z) < halfD) return true
    }
    return false
  }

  const nearestIndex = (value: number): number => clamp(Math.round((value - GRID_MIN) / GRID_STEP), 0, GRID_SIZE - 1)

  const astar = (start: S16Point, goal: S16Point): S16Point[] => {
    if (!cfg.avoidance) return [start, goal]
    const sx = nearestIndex(start.x)
    const sz = nearestIndex(start.z)
    const gx = nearestIndex(goal.x)
    const gz = nearestIndex(goal.z)
    const key = (x: number, z: number): number => z * GRID_SIZE + x
    const open = new Map<number, { x: number; z: number; g: number; f: number }>()
    const closed = new Set<number>()
    const cameFrom = new Map<number, number>()
    const gScore = new Map<number, number>()
    const startKey = key(sx, sz)
    gScore.set(startKey, 0)
    open.set(startKey, { x: sx, z: sz, g: 0, f: Math.hypot(gx - sx, gz - sz) })
    const directions = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1]
    ]
    let found = false
    for (let iteration = 0; iteration < GRID_SIZE * GRID_SIZE * 2 && open.size; iteration += 1) {
      let currentKey = -1
      let current: { x: number; z: number; g: number; f: number } | null = null
      for (const [candidateKey, candidate] of open) {
        if (!current || candidate.f < current.f) {
          current = candidate
          currentKey = candidateKey
        }
      }
      if (!current || currentKey < 0) break
      open.delete(currentKey)
      closed.add(currentKey)
      if (current.x === gx && current.z === gz) {
        found = true
        break
      }
      for (const [dx, dz] of directions) {
        const nx = current.x + dx
        const nz = current.z + dz
        if (nx < 0 || nz < 0 || nx >= GRID_SIZE || nz >= GRID_SIZE) continue
        const worldX = GRID_MIN + nx * GRID_STEP
        const worldZ = GRID_MIN + nz * GRID_STEP
        if (blocked(worldX, worldZ)) continue
        const nk = key(nx, nz)
        if (closed.has(nk)) continue
        const cost = current.g + Math.hypot(dx, dz) * GRID_STEP
        if (cost >= (gScore.get(nk) ?? Infinity)) continue
        gScore.set(nk, cost)
        cameFrom.set(nk, currentKey)
        open.set(nk, { x: nx, z: nz, g: cost, f: cost + Math.hypot(gx - nx, gz - nz) * GRID_STEP })
      }
    }
    if (!found) return [start, goal]
    const points: S16Point[] = [goal]
    let cursor = key(gx, gz)
    while (cursor !== startKey) {
      const previous = cameFrom.get(cursor)
      if (previous === undefined) break
      points.push({ x: GRID_MIN + (previous % GRID_SIZE) * GRID_STEP, z: GRID_MIN + Math.floor(previous / GRID_SIZE) * GRID_STEP })
      cursor = previous
    }
    points.reverse()
    points.push(goal)
    return points
  }

  const plan = (): void => {
    const waypoints = waypointList(Math.round(cfg.waypoints))
    if (!waypoints.length) return
    const target = waypoints[state.waypointIndex % waypoints.length]
    state.path = astar(state.position, target)
    state.pathLength = 0
    for (let index = 1; index < state.path.length; index += 1) {
      state.pathLength += Math.hypot(state.path[index].x - state.path[index - 1].x, state.path[index].z - state.path[index - 1].z)
    }
  }

  const configure = (next: Partial<S16Config>): void => {
    const previous = `${cfg.waypoints}|${cfg.avoidance}|${cfg.obstacles.length}`
    cfg = { ...cfg, ...next, obstacles: next.obstacles ? [...next.obstacles] : cfg.obstacles }
    if (`${cfg.waypoints}|${cfg.avoidance}|${cfg.obstacles.length}` !== previous) {
      state.waypointIndex = 0
      plan()
    }
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 240, 1 / 30)
    state.time += step
    const speed = cfg.speed * (cfg.robotType === 'quadruped' ? 0.8 : 1)
    if (!state.path.length) plan()
    let remaining = speed * step
    while (remaining > 0 && state.path.length > 1) {
      const next = state.path[1]
      const dx = next.x - state.position.x
      const dz = next.z - state.position.z
      const distance = Math.hypot(dx, dz)
      if (distance <= remaining || distance < 0.2) {
        state.position = { ...next }
        state.path.shift()
        remaining -= distance
      } else {
        state.position = { x: state.position.x + (dx / distance) * remaining, z: state.position.z + (dz / distance) * remaining }
        remaining = 0
      }
    }
    if (state.path.length <= 1) {
      state.waypointIndex += 1
      if (state.waypointIndex % Math.round(cfg.waypoints) === 0) state.completedLaps += 1
      plan()
    }
    const lookahead = state.path[Math.min(2, state.path.length - 1)] ?? state.position
    const desiredHeading = Math.atan2(lookahead.x - state.position.x, lookahead.z - state.position.z)
    let turn = desiredHeading - state.heading
    turn = ((turn + Math.PI * 3) % (Math.PI * 2)) - Math.PI
    state.heading += turn * Math.min(1, step * 4.5)
    const targetLateral = cfg.avoidance ? Math.sin(state.time * 1.2) * 1.2 : 0
    state.lateral += (targetLateral - state.lateral) * Math.min(1, step * 3)
    state.progress = state.waypointIndex / Math.max(1, Math.round(cfg.waypoints))
    state.nearest = Infinity
    state.scanned = '未发现目标'
    for (const obstacle of cfg.obstacles) {
      const distance = Math.hypot(obstacle.x - state.position.x, obstacle.z - state.position.z)
      state.nearest = Math.min(state.nearest, distance)
      if (distance < cfg.scanRange + 12 && state.scanned === '未发现目标') {
        state.scanned = `建筑 (${obstacle.x.toFixed(0)}, ${obstacle.z.toFixed(0)})`
      }
    }
    state.battery = Math.max(0, state.battery - step * (0.03 + speed * 0.008))
  }

  const calibration = (): CalibrationRow[] => {
    const straight = Math.hypot(100, 0)
    const energy = (100 - state.battery) * 100
    return [
      calibrationRow('路径长度', state.pathLength, straight, 'm', straight * 1.5),
      calibrationRow('最近障碍', Number.isFinite(state.nearest) ? state.nearest : 0, 0, 'm', 200),
      calibrationRow('剩余电量', state.battery, 0, '%', 100),
      calibrationRow('能耗账本', energy, state.time * 1.2, 'J', Math.max(1, state.time))
    ]
  }

  plan()

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
    plannedPath: () => state.path.map((point) => ({ ...point })),
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(2)),
      巡检进度: `${Math.min(100, state.progress * 100).toFixed(0)}%`,
      剩余电量: `${state.battery.toFixed(0)}%`,
      最近障碍m: Number.isFinite(state.nearest) ? Number(state.nearest.toFixed(1)) : '—',
      扫描目标: state.scanned,
      路径节点: state.path.length,
      路径长度m: Number(state.pathLength.toFixed(1))
    }),
    calibration,
    serialize: () => ({ ...state, path: state.path }),
    reset: () => {
      state.time = 0
      state.progress = 0
      state.position = { x: 0, z: 0 }
      state.heading = 0
      state.lateral = 0
      state.battery = 100
      state.waypointIndex = 0
      state.completedLaps = 0
      plan()
    }
  }
}
