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
}

export const S20_STATIONS: Array<[number, number]> = [
  [-110, 70],
  [110, 60],
  [-100, -70],
  [100, -80]
]
const DRONE_DISTANCE = 200

export function createS20Model(config: S20Config): ScenarioSimulation & {
  state: S20State
  configure(next: Partial<S20Config>): void
  reset(): void
  getConfig(): S20Config
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  const state: S20State = { time: 0, trucks: [], dispatched: 0, firstArrival: -1, droneProgress: 0, droneEta: 0, coverage: 0, effectiveSpeed: 0, arrivedCount: 0 }

  const reset = (): void => {
    state.time = 0
    state.firstArrival = -1
    state.droneProgress = 0
    state.droneEta = 0
    state.coverage = 0
    state.arrivedCount = 0
    state.trucks = S20_STATIONS.map(([x, z]) => ({
      progress: 0,
      arrived: false,
      arrival: -1,
      distance: Math.hypot(x, z) * 1.18,
      eta: 0
    }))
    state.dispatched = clamp(Math.round(cfg.teams), 1, S20_STATIONS.length)
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 120, 1 / 30)
    state.time += step
    const coordinationBonus = cfg.coordination ? 1.12 : 0.86
    const congestion = 1 - clamp(cfg.severity * 0.22, 0, 0.22) * Math.min(1, state.time / 20)
    state.effectiveSpeed = Math.max(2, cfg.speed * coordinationBonus * congestion)
    let arrived = 0
    for (let index = 0; index < state.trucks.length; index += 1) {
      const truck = state.trucks[index]
      if (index >= state.dispatched) continue
      if (!truck.arrived) {
        const pace = 0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, truck.progress))
        truck.progress = Math.min(1, truck.progress + (state.effectiveSpeed * pace * step) / Math.max(1, truck.distance))
        truck.eta = (1 - truck.progress) * truck.distance / Math.max(1, state.effectiveSpeed)
        if (truck.progress >= 1) {
          truck.arrived = true
          truck.arrival = state.time
          truck.eta = 0
          if (state.firstArrival < 0) state.firstArrival = state.time
        }
      }
      if (truck.arrived) arrived += 1
    }
    state.arrivedCount = arrived
    state.droneProgress = Math.min(1, state.droneProgress + (state.effectiveSpeed * 1.8 * step) / DRONE_DISTANCE)
    state.droneEta = Math.max(0, DRONE_DISTANCE * (1 - state.droneProgress) / (state.effectiveSpeed * 1.8))
    const unitCoverage = 2600 + cfg.severity * 3200
    state.coverage = Math.sqrt((arrived * unitCoverage) / Math.PI) * (cfg.coordination ? 1.15 : 1) + (state.droneProgress >= 1 ? 25 : 0)
  }

  const calibration = (): CalibrationRow[] => {
    const fastest = Math.min(...state.trucks.slice(0, state.dispatched).map((truck) => truck.distance)) / Math.max(1, cfg.speed * (cfg.coordination ? 1.12 : 0.86))
    return [
      calibrationRow('首批到场', state.firstArrival < 0 ? -1 : state.firstArrival, fastest, 's', fastest * 0.5),
      calibrationRow('到场车辆', state.arrivedCount, state.dispatched, '辆', 0),
      calibrationRow('无人机ETA', state.droneEta, Math.max(0, DRONE_DISTANCE / Math.max(1, state.effectiveSpeed * 1.8)), 's', 5),
      calibrationRow('覆盖半径', state.coverage, 80, 'm', 30),
      calibrationRow('有效速度', state.effectiveSpeed, cfg.speed, 'm/s', 4)
    ]
  }

  const configure = (next: Partial<S20Config>): void => {
    const prior = `${cfg.teams}`
    cfg = { ...cfg, ...next }
    if (`${cfg.teams}` !== prior) reset()
    state.dispatched = clamp(Math.round(cfg.teams), 1, S20_STATIONS.length)
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
      有效速度ms: Number(state.effectiveSpeed.toFixed(1))
    }),
    calibration,
    serialize: () => ({ ...state })
  }
}
