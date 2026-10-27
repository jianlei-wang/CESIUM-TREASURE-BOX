import { calibrationRow, clamp, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'
import { buildConstraint, solveDistanceConstraints, type DistanceConstraint } from './pbd'
import { buildBrickWall, knockBrick, stepBricks, type Brick } from './wall'

export interface S23Config {
  rpm: number
  armLength: number
  ropeLength: number
  segments: number
  ballMass: number
  ballRadius: number
  gravity: number
  damping: number
  wallRows: number
}

export interface S23State {
  time: number
  armAngle: number
  angularSpeed: number
  rope: Float32Array
  anchor: [number, number, number]
  ballPosition: [number, number, number]
  ballVelocity: [number, number, number]
  swing: number
  maxSwing: number
  tension: number
  residual: number
  wall: Brick[]
  knocked: number
  contacts: number
}

const ARM_HEIGHT = 7.5
const BRICK_SIZE = 0.62
const WALL_COLUMNS = 9
const START_ANGLE = Math.PI

export function createS23Model(config: S23Config): ScenarioSimulation & {
  state: S23State
  configure(next: Partial<S23Config>): void
  restart(): void
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  const state: S23State = {
    time: 0,
    armAngle: START_ANGLE,
    angularSpeed: 0,
    rope: new Float32Array(0),
    anchor: [0, ARM_HEIGHT, 0],
    ballPosition: [0, ARM_HEIGHT, 0],
    ballVelocity: [0, 0, 0],
    swing: 0,
    maxSwing: 0,
    tension: 0,
    residual: 0,
    wall: [],
    knocked: 0,
    contacts: 0
  }
  let previous = new Float32Array(0)
  let constraints: DistanceConstraint[] = []
  let invMass = new Float32Array(0)
  let segmentLength = 0
  let stepLength = 1 / 60

  const armTip = (angle: number, length: number): [number, number, number] => [
    Math.cos(angle) * length,
    ARM_HEIGHT,
    -Math.sin(angle) * length
  ]

  const buildRope = (): void => {
    const segments = clamp(Math.round(cfg.segments), 4, 24)
    const length = Math.max(1, cfg.ropeLength)
    segmentLength = length / segments
    const count = segments + 1
    const rope = new Float32Array(count * 3)
    const tip = armTip(START_ANGLE, cfg.armLength)
    for (let index = 0; index < count; index += 1) {
      const i3 = index * 3
      rope[i3] = tip[0]
      rope[i3 + 1] = tip[1] - index * segmentLength
      rope[i3 + 2] = tip[2]
    }
    previous = Float32Array.from(rope)
    invMass = new Float32Array(count)
    const ropeMass = Math.max(0.4, cfg.ballMass * 0.35)
    for (let index = 0; index < count; index += 1) {
      invMass[index] = index === 0 ? 0 : index === count - 1 ? 1 / Math.max(0.1, cfg.ballMass) : segments / ropeMass
    }
    constraints = []
    for (let index = 0; index < segments; index += 1) {
      buildConstraint(rope, index, index + 1, constraints)
    }
    state.rope = rope
    state.armAngle = START_ANGLE
    state.ballPosition = [tip[0], tip[1] - length, tip[2]]
    state.ballVelocity = [0, 0, 0]
    state.swing = 0
    state.maxSwing = 0
    state.time = 0
    state.knocked = 0
    state.contacts = 0
    state.residual = 0
  }

  const buildWall = (): void => {
    state.wall = buildBrickWall({
      rows: Math.max(1, Math.round(cfg.wallRows)),
      columns: WALL_COLUMNS,
      size: BRICK_SIZE,
      center: [cfg.armLength + 3, 0, 0],
      stagger: true,
      axis: 'x'
    })
  }

  const rebuild = (): void => {
    buildRope()
    buildWall()
  }

  const integrate = (step: number): void => {
    stepLength = step
    const omega = state.angularSpeed
    const tip = armTip(state.armAngle, cfg.armLength)
    state.anchor = tip
    const anchor3 = 0
    state.rope[anchor3] = tip[0]
    state.rope[anchor3 + 1] = tip[1]
    state.rope[anchor3 + 2] = tip[2]
    previous[anchor3] = tip[0]
    previous[anchor3 + 1] = tip[1]
    previous[anchor3 + 2] = tip[2]

    const lastIndex = state.rope.length / 3 - 1
    const drag = clamp(cfg.damping * step * 2.4, 0, 0.5)
    for (let index = 1; index <= lastIndex; index += 1) {
      const i3 = index * 3
      const x = state.rope[i3]
      const y = state.rope[i3 + 1]
      const z = state.rope[i3 + 2]
      const vx = (x - previous[i3]) / step
      const vy = (y - previous[i3 + 1]) / step
      const vz = (z - previous[i3 + 2]) / step
      let ax = 0
      let az = 0
      if (index === lastIndex) {
        ax = 0.55 * (omega * z - vx)
        az = 0.55 * (-omega * x - vz)
      }
      previous[i3] = x
      previous[i3 + 1] = y
      previous[i3 + 2] = z
      state.rope[i3] = x + vx * step * (1 - drag) + ax * step * step
      state.rope[i3 + 1] = y + vy * step * (1 - drag) - cfg.gravity * step * step
      state.rope[i3 + 2] = z + vz * step * (1 - drag) + az * step * step
    }

    const result = solveDistanceConstraints(state.rope, constraints, invMass, 0.96, 8)
    state.residual = result.residual
  }

  const ballGroundCollision = (): void => {
    const ballIndex = state.rope.length / 3 - 1
    const i3 = ballIndex * 3
    const radius = Math.max(0.1, cfg.ballRadius)
    if (state.rope[i3 + 1] < radius) {
      state.rope[i3 + 1] = radius
      previous[i3 + 1] = radius
      previous[i3] += (state.rope[i3] - previous[i3]) * 0.7
      previous[i3 + 2] += (state.rope[i3 + 2] - previous[i3 + 2]) * 0.7
    }
  }

  const strikeWall = (): void => {
    const ballIndex = state.rope.length / 3 - 1
    const i3 = ballIndex * 3
    const radius = Math.max(0.1, cfg.ballRadius)
    const threshold = radius + BRICK_SIZE * 0.62
    const vx = (state.rope[i3] - previous[i3]) / stepLength
    const vy = (state.rope[i3 + 1] - previous[i3 + 1]) / stepLength
    const vz = (state.rope[i3 + 2] - previous[i3 + 2]) / stepLength
    for (const brick of state.wall) {
      if (brick.active || brick.settled) continue
      const dx = brick.position[0] - state.rope[i3]
      const dy = brick.position[1] - state.rope[i3 + 1]
      const dz = brick.position[2] - state.rope[i3 + 2]
      if (Math.abs(dx) > threshold || Math.abs(dy) > threshold || Math.abs(dz) > threshold) continue
      if (Math.hypot(dx, dy, dz) > threshold) continue
      const speed = clamp(Math.hypot(vx, vy, vz), 0.8, 18)
      knockBrick(
        brick,
        [vx * 0.6 + dx * 0.8, clamp(1.2 + speed * 0.18, 0.6, 4.2), vz * 0.6 + dz * 0.8],
        23023,
        1.15
      )
      state.knocked += 1
      state.contacts += 1
      state.rope[i3] += Math.sign(dx || 1) * 0.22
      previous[i3] = state.rope[i3] - vx * stepLength * 0.35
      previous[i3 + 1] = state.rope[i3 + 1] - vy * stepLength * 0.35
      previous[i3 + 2] = state.rope[i3 + 2] - vz * stepLength * 0.35
    }
  }

  const measure = (): void => {
    const ballIndex = state.rope.length / 3 - 1
    const i3 = ballIndex * 3
    const x = state.rope[i3]
    const y = state.rope[i3 + 1]
    const z = state.rope[i3 + 2]
    const dx = x - state.anchor[0]
    const dy = y - state.anchor[1]
    const dz = z - state.anchor[2]
    const horizontal = Math.hypot(dx, dz)
    state.swing = Math.atan2(horizontal, Math.max(0.001, -dy))
    const inverseStep = stepLength > 0 ? 1 / stepLength : 0
    const vx = (x - previous[i3]) * inverseStep
    const vy = (y - previous[i3 + 1]) * inverseStep
    const vz = (z - previous[i3 + 2]) * inverseStep
    const speed = Math.hypot(vx, vy, vz)
    const length = Math.max(0.4, cfg.ropeLength)
    state.tension = Math.max(0, cfg.ballMass * (cfg.gravity * Math.cos(state.swing) + (speed * speed) / length))
    if (state.swing > state.maxSwing) state.maxSwing = state.swing
    state.ballPosition = [x, y, z]
    state.ballVelocity = [vx, vy, vz]
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 240, 1 / 30)
    state.time += step
    state.angularSpeed = (cfg.rpm * Math.PI * 2) / 60
    state.armAngle = (state.armAngle + state.angularSpeed * step) % (Math.PI * 2)
    integrate(step)
    ballGroundCollision()
    strikeWall()
    stepBricks(state.wall, step, BRICK_SIZE, cfg.damping, cfg.gravity)
    measure()
  }

  const configure = (next: Partial<S23Config>): void => {
    const previousKey = `${cfg.armLength.toFixed(2)}|${cfg.ropeLength.toFixed(2)}|${Math.round(cfg.segments)}|${cfg.ballMass.toFixed(2)}|${Math.round(cfg.wallRows)}`
    cfg = { ...cfg, ...next }
    const key = `${cfg.armLength.toFixed(2)}|${cfg.ropeLength.toFixed(2)}|${Math.round(cfg.segments)}|${cfg.ballMass.toFixed(2)}|${Math.round(cfg.wallRows)}`
    if (key !== previousKey) rebuild()
  }

  const calibration = (): CalibrationRow[] => {
    const ballIndex = state.rope.length / 3 - 1
    const i3 = ballIndex * 3
    const anchor3 = 0
    const dx = state.rope[i3] - state.rope[anchor3]
    const dy = state.rope[i3 + 1] - state.rope[anchor3 + 1]
    const dz = state.rope[i3 + 2] - state.rope[anchor3 + 2]
    const span = Math.sqrt(dx * dx + dy * dy + dz * dz)
    return [
      calibrationRow('绳长', span, cfg.ropeLength, 'm', Math.max(0.3, cfg.ropeLength * 0.08)),
      calibrationRow('绳段长度', segmentLength, cfg.ropeLength / Math.max(4, Math.round(cfg.segments)), 'm', 0.02),
      calibrationRow('墙体构件数量', state.wall.length, Math.max(1, Math.round(cfg.wallRows)) * WALL_COLUMNS, '块', 0),
      calibrationRow('速度有限性', Number.isFinite(state.tension) ? 1 : 0, 1, '', 0)
    ]
  }

  rebuild()

  return {
    state,
    get mode() {
      return mode
    },
    setMode(next) {
      mode = next
    },
    configure,
    restart: rebuild,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(2)),
      转速rmin: Number(cfg.rpm.toFixed(1)),
      摆角deg: Number(((state.swing * 180) / Math.PI).toFixed(1)),
      最大摆角deg: Number(((state.maxSwing * 180) / Math.PI).toFixed(1)),
      绳张力N: Number(state.tension.toFixed(1)),
      撞落砖块: state.knocked
    }),
    calibration,
    serialize: () => ({
      time: state.time,
      armAngle: state.armAngle,
      rope: Array.from(state.rope),
      wall: state.wall.map((brick) => ({ id: brick.id, p: brick.position, v: brick.velocity })),
      knocked: state.knocked
    }),
    reset: rebuild
  }
}
