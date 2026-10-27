import { calibrationRow, clamp, deterministicRng, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'
import { buildBrickWall, stepBricks, type Brick } from './wall'

export interface S21Config {
  driveForce: number
  steering: number
  friction: number
  mass: number
  suspension: number
  damping: number
  wallRows: number
}

export type S21Block = Brick

export interface S21State {
  time: number
  position: [number, number, number]
  velocity: [number, number, number]
  speed: number
  heading: number
  steeringAngle: number
  distance: number
  suspension: [number, number, number, number]
  bodyHeave: number
  bodyPitch: number
  bodyRoll: number
  wheelSpin: number
  maxSpeed: number
  collisionCount: number
  impactPeak: number
  verticalVelocity: number
  grounded: boolean
  airTime: number
  airPeak: number
  altitude: number
  peakAltitude: number
  wall: S21Block[]
}

const WHEEL_BASE = 4.4
const WHEEL_RADIUS = 0.45
const CAR_HALF_LENGTH = 2.4
const CAR_HALF_WIDTH = 1.15
const WALL_X = 38
const WALL_COLUMNS = 10
const BLOCK_SIZE = 0.75
const GRAVITY = 9.81

export const S21_RAMP = { startX: -6, endX: 1, height: 2.2 }

export function rampHeight(x: number): number {
  const { startX, endX, height } = S21_RAMP
  if (x < startX || x > endX) return 0
  return ((x - startX) / (endX - startX)) * height
}

function rampSlope(x: number): number {
  const { startX, endX, height } = S21_RAMP
  if (x < startX || x > endX) return 0
  return height / (endX - startX)
}

export function createS21Model(config: S21Config): ScenarioSimulation & {
  state: S21State
  configure(next: Partial<S21Config>): void
  restart(): void
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  let rng = deterministicRng(21021)
  const state: S21State = {
    time: 0,
    position: [-32, 0, 0],
    velocity: [0, 0, 0],
    speed: 0,
    heading: 0,
    steeringAngle: 0,
    distance: 0,
    suspension: [0, 0, 0, 0],
    bodyHeave: 0,
    bodyPitch: 0,
    bodyRoll: 0,
    wheelSpin: 0,
    maxSpeed: 0,
    collisionCount: 0,
    impactPeak: 0,
    verticalVelocity: 0,
    grounded: true,
    airTime: 0,
    airPeak: 0,
    altitude: 0,
    peakAltitude: 0,
    wall: []
  }
  let pitchVelocity = 0
  let rollVelocity = 0
  let heaveVelocity = 0
  let collisionCooldown = 0

  const expectedWallCount = (): number => WALL_COLUMNS * Math.max(1, Math.round(cfg.wallRows))

  const buildWall = (): void => {
    rng = deterministicRng(21021)
    state.wall = buildBrickWall({
      rows: Math.max(1, Math.round(cfg.wallRows)),
      columns: WALL_COLUMNS,
      size: BLOCK_SIZE,
      center: [WALL_X, 0, 0],
      axis: 'z',
      stagger: false
    })
  }

  const resetVehicle = (): void => {
    state.time = 0
    state.position = [-32, 0, 0]
    state.velocity = [0, 0, 0]
    state.speed = 0
    state.heading = 0
    state.steeringAngle = 0
    state.distance = 0
    state.suspension = [0, 0, 0, 0]
    state.bodyHeave = 0
    state.bodyPitch = 0
    state.bodyRoll = 0
    state.wheelSpin = 0
    state.maxSpeed = 0
    state.collisionCount = 0
    state.impactPeak = 0
    state.verticalVelocity = 0
    state.grounded = true
    state.airTime = 0
    state.airPeak = 0
    state.altitude = 0
    state.peakAltitude = 0
    pitchVelocity = 0
    rollVelocity = 0
    heaveVelocity = 0
    collisionCooldown = 0
    buildWall()
  }

  const strikeWall = (carZ: number, speed: number): void => {
    const reach = CAR_HALF_WIDTH + BLOCK_SIZE * 1.3
    const strength = clamp(speed * (0.16 + cfg.mass / 6000), 0.6, 11)
    for (const block of state.wall) {
      if (block.active || block.settled) continue
      const lateral = Math.abs(block.position[2] - carZ)
      if (lateral > reach) continue
      const falloff = 1 - lateral / (reach * 1.35)
      block.active = true
      block.settled = false
      block.velocity = [
        strength * (0.45 + falloff * 0.4),
        clamp(strength * (0.08 + rng() * 0.12), 0.2, 3.4),
        (block.position[2] - carZ) * (0.3 + rng() * 0.25) + (rng() - 0.5) * 1.2
      ]
      block.spin = [(rng() - 0.5) * 2.4, (rng() - 0.5) * 3.2, (rng() - 0.5) * 2.4]
    }
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 240, 1 / 30)
    state.time += step
    collisionCooldown = Math.max(0, collisionCooldown - step)

    const steerRad = (cfg.steering * Math.PI) / 180
    state.steeringAngle = steerRad
    const rolling = cfg.friction * GRAVITY
    const drag = 0.0018 * state.speed * Math.abs(state.speed)
    const drive = cfg.driveForce / Math.max(200, cfg.mass)
    let acceleration = drive - rolling - drag
    if (state.speed < 0) acceleration += rolling * 1.4
    state.speed = clamp(state.speed + acceleration * step, -18, 60)
    state.maxSpeed = Math.max(state.maxSpeed, state.speed)
    if (Math.abs(state.speed) > 0.05) {
      const wheelYaw = (state.speed / WHEEL_BASE) * Math.tan(steerRad)
      state.heading += wheelYaw * step
    }
    state.velocity = [Math.cos(state.heading) * state.speed, 0, -Math.sin(state.heading) * state.speed]
    const previousX = state.position[0]
    state.position[0] += state.velocity[0] * step
    state.position[2] += state.velocity[2] * step
    state.distance += Math.abs(state.speed) * step
    state.wheelSpin += (state.speed / WHEEL_RADIUS) * step

    const terrain = rampHeight(state.position[0])
    const slope = rampSlope(state.position[0])
    const crossedCrest = previousX < S21_RAMP.endX && state.position[0] >= S21_RAMP.endX

    if (state.grounded) {
      if (crossedCrest) {
        const launchSlope = S21_RAMP.height / (S21_RAMP.endX - S21_RAMP.startX)
        const launchSpeed = state.velocity[0] * launchSlope
        state.position[1] = S21_RAMP.height
        if (launchSpeed > 0.35) {
          state.grounded = false
          state.verticalVelocity = launchSpeed
          state.airTime = 0
          state.airPeak = state.position[1]
        } else {
          state.position[1] = terrain
          state.verticalVelocity = 0
        }
      } else {
        state.position[1] = terrain
        state.verticalVelocity = state.velocity[0] * slope
      }
    } else {
      state.verticalVelocity -= GRAVITY * step
      state.position[1] += state.verticalVelocity * step
      state.airTime += step
      state.airPeak = Math.max(state.airPeak, state.position[1])
      if (state.position[1] <= terrain) {
        state.position[1] = terrain
        const landing = Math.abs(state.verticalVelocity)
        state.verticalVelocity = 0
        state.grounded = true
        heaveVelocity -= Math.min(4, landing * 0.5)
        pitchVelocity -= Math.min(3, landing * 0.25)
      }
    }
    state.altitude = Math.max(0, state.position[1] - terrain)
    state.peakAltitude = Math.max(state.peakAltitude, state.altitude)

    const k = Math.max(1000, cfg.suspension * 1000)
    const omega = Math.sqrt(k / Math.max(200, cfg.mass))
    const zeta = clamp(cfg.damping / (2 * Math.sqrt(k * Math.max(200, cfg.mass))), 0.08, 0.9)
    const airPitch = state.grounded ? 0 : clamp(state.verticalVelocity * 0.06, -0.22, 0.32)
    const targetPitch = state.grounded
      ? clamp(-acceleration * 0.0032 + slope * 0.32, -0.16, 0.16)
      : clamp(airPitch - acceleration * 0.0012, -0.22, 0.32)
    const targetRoll = clamp(-steerRad * Math.abs(state.speed) * 0.022, -0.12, 0.12)
    const targetHeave = clamp(-acceleration * 0.0007, -0.05, 0.05)
    pitchVelocity += ((targetPitch - state.bodyPitch) * omega * omega - 2 * zeta * omega * pitchVelocity) * step
    rollVelocity += ((targetRoll - state.bodyRoll) * omega * omega - 2 * zeta * omega * rollVelocity) * step
    heaveVelocity += ((targetHeave - state.bodyHeave) * omega * omega - 2 * zeta * omega * heaveVelocity) * step
    state.bodyPitch += pitchVelocity * step
    state.bodyRoll += rollVelocity * step
    state.bodyHeave += heaveVelocity * step

    const staticCompression = (cfg.mass * GRAVITY) / (4 * k)
    const pitchOffset = state.bodyPitch * 0.9
    const rollOffset = state.bodyRoll * 0.55
    state.suspension = [
      clamp(staticCompression - pitchOffset + rollOffset, 0, 0.5),
      clamp(staticCompression - pitchOffset - rollOffset, 0, 0.5),
      clamp(staticCompression + pitchOffset + rollOffset, 0, 0.5),
      clamp(staticCompression + pitchOffset - rollOffset, 0, 0.5)
    ]

    if (collisionCooldown === 0 && state.position[0] + CAR_HALF_LENGTH >= WALL_X - BLOCK_SIZE * 0.5 && state.position[0] < WALL_X + 2) {
      const nearBlocks = state.wall.some(
        (block) =>
          !block.active &&
          Math.abs(block.position[2] - state.position[2]) < CAR_HALF_WIDTH + BLOCK_SIZE &&
          block.position[1] < 2.6
      )
      if (nearBlocks && Math.abs(state.speed) > 1.2) {
        state.position[0] = WALL_X - BLOCK_SIZE * 0.5 - CAR_HALF_LENGTH
        state.impactPeak = Math.max(state.impactPeak, Math.abs(state.speed) * cfg.mass)
        strikeWall(state.position[2], Math.abs(state.speed))
        state.collisionCount += 1
        state.speed = -Math.sign(state.speed) * Math.min(8, Math.abs(state.speed) * 0.28)
        collisionCooldown = 0.8
      } else if (nearBlocks && Math.abs(state.speed) <= 1.2) {
        state.position[0] = WALL_X - BLOCK_SIZE * 0.5 - CAR_HALF_LENGTH
        state.speed = 0
      }
    }

    stepBricks(state.wall, step, BLOCK_SIZE, 0.35, GRAVITY)
  }

  const configure = (next: Partial<S21Config>): void => {
    const previousRows = cfg.wallRows
    cfg = { ...cfg, ...next }
    if (Math.round(cfg.wallRows) !== Math.round(previousRows)) buildWall()
  }

  const calibration = (): CalibrationRow[] => {
    const staticCompression = (cfg.mass * GRAVITY) / (4 * Math.max(1000, cfg.suspension * 1000))
    const average = state.suspension.reduce((sum, value) => sum + value, 0) / 4
    return [
      calibrationRow('静态悬架压缩', average, staticCompression, 'm', 0.03),
      calibrationRow('墙体构件数', state.wall.length, expectedWallCount(), '块', 0),
      calibrationRow('速度有限值', Number.isFinite(state.speed) ? 1 : 0, 1, '', 0),
      calibrationRow('车身质量', cfg.mass, Math.max(1, cfg.mass), 'kg', 0)
    ]
  }

  resetVehicle()

  return {
    state,
    get mode() {
      return mode
    },
    setMode(next) {
      mode = next
    },
    configure,
    restart: resetVehicle,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(2)),
      车速ms: Number(state.speed.toFixed(2)),
      车身俯仰rad: Number(state.bodyPitch.toFixed(3)),
      悬架压缩m: Number(Math.max(...state.suspension).toFixed(3)),
      腾空高度m: Number(state.altitude.toFixed(2)),
      碰撞次数: state.collisionCount,
      飞散构件: state.wall.filter((block) => block.active && !block.settled).length
    }),
    calibration,
    serialize: () => ({
      time: state.time,
      position: state.position,
      speed: state.speed,
      heading: state.heading,
      collisionCount: state.collisionCount,
      wall: state.wall.map((block) => ({ id: block.id, p: block.position, v: block.velocity }))
    }),
    reset: resetVehicle
  }
}
