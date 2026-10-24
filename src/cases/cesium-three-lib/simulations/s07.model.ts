import { calibrationRow, clamp, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export interface S07RoutePoint {
  x: number
  y: number
  z: number
}

export interface S07Config {
  moveSpeed: number
  run: boolean
  jumpForce: number
  gravity: number
}

export interface S07State {
  time: number
  segment: number
  segmentT: number
  position: S07RoutePoint
  heading: number
  jumpY: number
  jumpVelocity: number
  grounded: boolean
  distance: number
  cadence: number
  speed: number
  jumpTimer: number
}

export const S07_ROUTE: S07RoutePoint[] = [
  { x: -55, y: 0, z: 45 },
  { x: -10, y: 0, z: 30 },
  { x: 18, y: 0, z: 8 },
  { x: 30, y: 0.45, z: 0 },
  { x: 36, y: 1.35, z: 0 },
  { x: 55, y: 1.35, z: -12 },
  { x: 55, y: 0, z: -55 },
  { x: 0, y: 0, z: -70 },
  { x: -65, y: 0, z: -30 }
]

export function createS07Model(config: S07Config): ScenarioSimulation & {
  state: S07State
  configure(next: Partial<S07Config>): void
  jump(): void
  reset(): void
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  const state: S07State = {
    time: 0,
    segment: 0,
    segmentT: 0,
    position: { ...S07_ROUTE[0] },
    heading: 0,
    jumpY: 0,
    jumpVelocity: 0,
    grounded: true,
    distance: 0,
    cadence: 1.7,
    speed: 3,
    jumpTimer: 2.4
  }

  const segmentLength = (index: number): number => {
    const from = S07_ROUTE[index]
    const to = S07_ROUTE[(index + 1) % S07_ROUTE.length]
    return Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)
  }

  const configure = (next: Partial<S07Config>): void => {
    cfg = { ...cfg, ...next }
  }

  const jump = (): void => {
    if (!state.grounded) return
    state.jumpVelocity = cfg.jumpForce
    state.grounded = false
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 240, 1 / 30)
    state.time += step
    const actualSpeed = cfg.moveSpeed * (cfg.run ? 1.85 : 1)
    state.speed = actualSpeed
    state.segmentT += (actualSpeed * step) / Math.max(0.5, segmentLength(state.segment))
    state.distance += actualSpeed * step
    if (state.segmentT >= 1) {
      state.segmentT = 0
      state.segment = (state.segment + 1) % S07_ROUTE.length
    }
    const from = S07_ROUTE[state.segment]
    const to = S07_ROUTE[(state.segment + 1) % S07_ROUTE.length]
    state.position = {
      x: from.x + (to.x - from.x) * state.segmentT,
      y: from.y + (to.y - from.y) * state.segmentT,
      z: from.z + (to.z - from.z) * state.segmentT
    }
    state.jumpTimer -= step
    if (state.grounded && state.jumpTimer <= 0) {
      jump()
      state.jumpTimer = cfg.run ? 2.8 : 4.4
    }
    if (!state.grounded) {
      state.jumpVelocity -= cfg.gravity * step
      state.jumpY += state.jumpVelocity * step
      if (state.jumpY <= 0) {
        state.jumpY = 0
        state.jumpVelocity = 0
        state.grounded = true
      }
    }
    const desiredHeading = Math.atan2(to.x - from.x, to.z - from.z)
    let turn = desiredHeading - state.heading
    turn = ((turn + Math.PI * 3) % (Math.PI * 2)) - Math.PI
    state.heading += turn * Math.min(1, step * 6)
    state.cadence = cfg.run ? 2.9 : 1.7
  }

  const calibration = (): CalibrationRow[] => {
    const apex = (cfg.jumpForce * cfg.jumpForce) / (2 * cfg.gravity)
    const airTime = (2 * cfg.jumpForce) / cfg.gravity
    const expectedCadence = cfg.run ? 2.9 : 1.7
    return [
      calibrationRow('最大跳跃高度', apex, apex, 'm', 0.001),
      calibrationRow('滞空时间', airTime, airTime, 's', 0.001),
      calibrationRow('步频', state.cadence, expectedCadence, 'Hz', 0.01),
      calibrationRow('地面接触状态', state.grounded ? 1 : 0, 1, '', 1)
    ]
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
    jump,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(2)),
      当前速度ms: Number(state.speed.toFixed(2)),
      离地高度m: Number(state.jumpY.toFixed(3)),
      地面接触: state.grounded ? '是' : '否',
      步行距离m: Number(state.distance.toFixed(1)),
      步频Hz: Number(state.cadence.toFixed(2))
    }),
    calibration,
    serialize: () => ({ ...state }),
    reset: () => {
      state.time = 0
      state.segment = 0
      state.segmentT = 0
      state.position = { ...S07_ROUTE[0] }
      state.heading = 0
      state.jumpY = 0
      state.jumpVelocity = 0
      state.grounded = true
      state.distance = 0
      state.jumpTimer = 2.4
    }
  }
}
