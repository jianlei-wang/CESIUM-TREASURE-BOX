import { calibrationRow, clamp, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export interface S20Config {
  severity: number
  teams: number
  speed: number
  altitude: number
  coordination: boolean
}

export interface S20Truck {
  progress: number
  arrived: boolean
  arrival: number
  distance: number
  eta: number
  route: string[]
  routeDistance: number
}

export interface S20Event {
  time: number
  type: 'dispatch' | 'arrive' | 'drone-arrive'
  target: string
}

export interface S20State {
  time: number
  trucks: S20Truck[]
  dispatched: number
  firstArrival: number
  droneProgress: number
  droneEta: number
  coverage: number
  effectiveSpeed: number
  arrivedCount: number
  events: S20Event[]
  networkDistance: number
  congestionFactor: number
}

export const S20_STATIONS: Array<[number, number]> = [
  [-110, 70],
  [110, 60],
  [-100, -70],
  [100, -80]
]
const DRONE_DISTANCE = 200
const PACE_AVG = 2 / Math.PI

interface RoadEdge {
  to: string
  weight: number
}

const stationNode = (index: number): string => `station-${index}`
const cornerNode = (index: number): string => `corner-${index}`
const INCIDENT_NODE = 'incident'

function roadNetwork(): Map<string, RoadEdge[]> {
  const nodes = new Map<string, RoadEdge[]>()
  for (let index = 0; index < S20_STATIONS.length; index += 1) {
    const [x, z] = S20_STATIONS[index]
    const station = stationNode(index)
    const corner = cornerNode(index)
    nodes.set(station, [{ to: corner, weight: Math.hypot(x, 0) }])
    nodes.set(corner, [{ to: INCIDENT_NODE, weight: Math.abs(z) }])
  }
  return nodes
}

function shortestPath(graph: Map<string, RoadEdge[]>, start: string, goal: string): { distance: number; route: string[] } {
  const distance = new Map<string, number>()
  const previous = new Map<string, string>()
  const visited = new Set<string>()
  for (const key of graph.keys()) distance.set(key, Number.POSITIVE_INFINITY)
  distance.set(start, 0)
  while (visited.size < graph.size) {
    let current: string | null = null
    let best = Number.POSITIVE_INFINITY
    for (const [key, value] of distance) {
      if (!visited.has(key) && value < best) {
        best = value
        current = key
      }
    }
    if (!current || best === Number.POSITIVE_INFINITY) break
    if (current === goal) break
    visited.add(current)
    for (const edge of graph.get(current) ?? []) {
      const next = best + edge.weight
      if (next < (distance.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        distance.set(edge.to, next)
        previous.set(edge.to, current)
      }
    }
  }
  const route: string[] = []
  let cursor: string | undefined = goal
  while (cursor) {
    route.unshift(cursor)
    cursor = previous.get(cursor)
  }
  return { distance: distance.get(goal) ?? Number.POSITIVE_INFINITY, route }
}

export function createS20Model(config: S20Config): ScenarioSimulation & {
  state: S20State
  configure(next: Partial<S20Config>): void
  reset(): void
  getConfig(): S20Config
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  const state: S20State = { time: 0, trucks: [], dispatched: 0, firstArrival: -1, droneProgress: 0, droneEta: 0, coverage: 0, effectiveSpeed: 0, arrivedCount: 0, events: [], networkDistance: 0, congestionFactor: 1 }

  const reset = (): void => {
    state.time = 0
    state.firstArrival = -1
    state.droneProgress = 0
    state.droneEta = 0
    state.coverage = 0
    state.arrivedCount = 0
    state.events = []
    const graph = roadNetwork()
    state.trucks = S20_STATIONS.map(() => ({
      progress: 0,
      arrived: false,
      arrival: -1,
      distance: 0,
      eta: 0,
      route: [],
      routeDistance: 0
    }))
    state.dispatched = clamp(Math.round(cfg.teams), 1, S20_STATIONS.length)
    for (let index = 0; index < state.dispatched; index += 1) {
      const path = shortestPath(graph, stationNode(index), INCIDENT_NODE)
      const truck = state.trucks[index]
      truck.route = path.route
      truck.routeDistance = path.distance
      truck.distance = path.distance * 1.15
      truck.eta = truck.distance / Math.max(1, cfg.speed * PACE_AVG)
      state.events.push({ time: 0, type: 'dispatch', target: `救援车 ${index + 1}` })
    }
    state.networkDistance = state.trucks.slice(0, state.dispatched).reduce((sum, truck) => sum + truck.distance, 0)
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 120, 1 / 30)
    state.time += step
    const coordinationBonus = cfg.coordination ? 1.12 : 0.86
    const congestion = 1 - clamp(cfg.severity * 0.22, 0, 0.22) * Math.min(1, state.time / 20)
    state.congestionFactor = congestion
    state.effectiveSpeed = Math.max(2, cfg.speed * coordinationBonus * congestion)
    let arrived = 0
    for (let index = 0; index < state.trucks.length; index += 1) {
      const truck = state.trucks[index]
      if (index >= state.dispatched) continue
      if (!truck.arrived) {
        const pace = 0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, truck.progress))
        truck.progress = Math.min(1, truck.progress + (state.effectiveSpeed * pace * step) / Math.max(1, truck.distance))
        truck.eta = (1 - truck.progress) * truck.distance / Math.max(1, state.effectiveSpeed * PACE_AVG)
        if (truck.progress >= 1) {
          truck.arrived = true
          truck.arrival = state.time
          truck.eta = 0
          state.events.push({ time: state.time, type: 'arrive', target: `救援车 ${index + 1}` })
          if (state.firstArrival < 0) state.firstArrival = state.time
        }
      }
      if (truck.arrived) arrived += 1
    }
    state.arrivedCount = arrived
    const priorDrone = state.droneProgress
    state.droneProgress = Math.min(1, state.droneProgress + (state.effectiveSpeed * 1.8 * step) / DRONE_DISTANCE)
    if (priorDrone < 1 && state.droneProgress >= 1) state.events.push({ time: state.time, type: 'drone-arrive', target: '无人机' })
    state.droneEta = Math.max(0, DRONE_DISTANCE * (1 - state.droneProgress) / (state.effectiveSpeed * 1.8))
    const unitCoverage = 2600 + cfg.severity * 3200
    state.coverage = Math.sqrt((arrived * unitCoverage) / Math.PI) * (cfg.coordination ? 1.15 : 1) + (state.droneProgress >= 1 ? 25 : 0)
  }

  const calibration = (): CalibrationRow[] => {
    const fastest = Math.min(...state.trucks.slice(0, state.dispatched).map((truck) => truck.distance)) / Math.max(1, cfg.speed * (cfg.coordination ? 1.12 : 0.86) * PACE_AVG)
    return [
      calibrationRow('首批到场', state.firstArrival < 0 ? -1 : state.firstArrival, fastest, 's', fastest * 0.5),
      calibrationRow('到场车辆', state.arrivedCount, state.dispatched, '辆', 0),
      calibrationRow('无人机ETA', state.droneEta, Math.max(0, DRONE_DISTANCE / Math.max(1, state.effectiveSpeed * 1.8)), 's', 5),
      calibrationRow('覆盖半径', state.coverage, 80, 'm', 30),
      calibrationRow('有效速度', state.effectiveSpeed, cfg.speed, 'm/s', 4),
      calibrationRow('路网里程', state.networkDistance, 900, 'm', 500)
    ]
  }

  const configure = (next: Partial<S20Config>): void => {
    const prior = `${cfg.teams}`
    cfg = { ...cfg, ...next }
    if (`${cfg.teams}` !== prior) {
      state.dispatched = clamp(Math.round(cfg.teams), 1, S20_STATIONS.length)
      reset()
    }
  }

  reset()

  return {
    state,
    get mode() {
      return mode
    },
    setMode(next) {
      mode = next
    },
    configure,
    reset,
    getConfig: () => ({ ...cfg }),
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(1)),
      出动车辆: state.dispatched,
      到场车辆: state.arrivedCount,
      首批到场s: state.firstArrival < 0 ? '待抵达' : Number(state.firstArrival.toFixed(1)),
      无人机ETA: Number(state.droneEta.toFixed(0)),
      覆盖半径m: Number(state.coverage.toFixed(0)),
      有效速度ms: Number(state.effectiveSpeed.toFixed(1)),
      路网里程m: Number(state.networkDistance.toFixed(0)),
      拥堵系数: Number(state.congestionFactor.toFixed(2)),
      调度事件: state.events.length
    }),
    calibration,
    serialize: () => ({ ...state })
  }
}
