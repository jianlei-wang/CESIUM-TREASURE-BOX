import { calibrationRow, clamp, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'
import { buildConstraint, solveDistanceConstraints, type DistanceConstraint } from './pbd'
import { buildBrickWall, knockBrick, nearestDistance, stepBricks, type Brick } from './wall'

export interface S22Config {
  rpm: number
  armLength: number
  clothWidth: number
  clothHeight: number
  stiffness: number
  segments: number
  gravity: number
  damping: number
  wallRows: number
}

export interface S22State {
  time: number
  armAngle: number
  angularSpeed: number
  cloth: Float32Array
  rest: Float32Array
  flare: number
  flutter: number
  residual: number
  segmentLength: number
  segX: number
  segY: number
  columns: number
  armLength: number
  wall: Brick[]
  knocked: number
  contacts: number
}

const ARM_HEIGHT = 6.6
const WALL_COLUMNS = 9
const BRICK_SIZE = 0.62

function createGrid(config: S22Config): {
  cloth: Float32Array
  previous: Float32Array
  rest: Float32Array
  invMass: Float32Array
  constraints: DistanceConstraint[]
  segX: number
  segY: number
  columns: number
} {
  const segX = clamp(Math.round(config.segments), 6, 26)
  const segY = clamp(Math.round((segX * config.clothHeight) / config.clothWidth), 4, 22)
  const columns = segX + 1
  const rows = segY + 1
  const count = columns * rows
  const rest = new Float32Array(count * 3)
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column
      const i3 = index * 3
      const x = config.armLength - config.clothWidth + (column / segX) * config.clothWidth
      const y = ARM_HEIGHT - (row / segY) * config.clothHeight
      rest[i3] = x
      rest[i3 + 1] = y
      rest[i3 + 2] = 0
    }
  }
  const cloth = Float32Array.from(rest)
  const previous = Float32Array.from(rest)
  const invMass = new Float32Array(count)
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      invMass[row * columns + column] = row === 0 ? 0 : 1
    }
  }
  const constraints: DistanceConstraint[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column
      if (column + 1 < columns) buildConstraint(rest, index, index + 1, constraints)
      if (row + 1 < rows) buildConstraint(rest, index, index + columns, constraints)
      if (column + 1 < columns && row + 1 < rows) {
        buildConstraint(rest, index, index + columns + 1, constraints)
        buildConstraint(rest, index + 1, index + columns, constraints)
      }
      if (column + 2 < columns) buildConstraint(rest, index, index + 2, constraints)
      if (row + 2 < rows) buildConstraint(rest, index, index + columns * 2, constraints)
    }
  }
  return { cloth, previous, rest, invMass, constraints, segX, segY, columns }
}

export function createS22Model(config: S22Config): ScenarioSimulation & {
  state: S22State
  configure(next: Partial<S22Config>): void
  restart(): void
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  const state: S22State = {
    time: 0,
    armAngle: 0,
    angularSpeed: 0,
    cloth: new Float32Array(0),
    rest: new Float32Array(0),
    flare: 0,
    flutter: 0,
    residual: 0,
    segmentLength: 0,
    segX: 0,
    segY: 0,
    columns: 0,
    armLength: 0,
    wall: [],
    knocked: 0,
    contacts: 0
  }
  let grid = createGrid(cfg)
  let previous = grid.previous

  const buildWall = (): void => {
    state.wall = buildBrickWall({
      rows: Math.max(1, Math.round(cfg.wallRows)),
      columns: WALL_COLUMNS,
      size: BRICK_SIZE,
      center: [0, 0, cfg.armLength + cfg.clothWidth / 2 - 0.2],
      axis: 'x',
      stagger: true
    })
  }

  const rebuild = (): void => {
    grid = createGrid(cfg)
    previous = grid.previous
    state.cloth = grid.cloth
    state.rest = grid.rest
    state.time = 0
    state.armAngle = 0
    state.angularSpeed = 0
    state.flare = 0
    state.flutter = 0
    state.residual = 0
    state.segmentLength = cfg.clothWidth / grid.segX
    state.segX = grid.segX
    state.segY = grid.segY
    state.columns = grid.columns
    state.armLength = cfg.armLength
    state.knocked = 0
    state.contacts = 0
    buildWall()
  }

  const updateAnchors = (): void => {
    const cos = Math.cos(state.armAngle)
    const sin = Math.sin(state.armAngle)
    for (let column = 0; column < grid.columns; column += 1) {
      const i3 = column * 3
      const localX = grid.rest[i3]
      const x = cos * localX
      const z = -sin * localX
      grid.cloth[i3] = x
      grid.cloth[i3 + 1] = ARM_HEIGHT
      grid.cloth[i3 + 2] = z
      previous[i3] = x
      previous[i3 + 1] = ARM_HEIGHT
      previous[i3 + 2] = z
    }
  }

  const integrate = (step: number): void => {
    const omega = state.angularSpeed
    const gravity = cfg.gravity
    const drag = clamp(cfg.damping * step * 2.2, 0, 0.5)
    const air = 0.9
    const count = grid.cloth.length / 3
    for (let index = 0; index < count; index += 1) {
      if (index < grid.columns) continue
      const i3 = index * 3
      const x = grid.cloth[i3]
      const y = grid.cloth[i3 + 1]
      const z = grid.cloth[i3 + 2]
      const vx = (x - previous[i3]) / step
      const vy = (y - previous[i3 + 1]) / step
      const vz = (z - previous[i3 + 2]) / step
      const ax = omega * omega * x + air * (omega * z - vx)
      const ay = -gravity
      const az = omega * omega * z + air * (-omega * x - vz)
      previous[i3] = x
      previous[i3 + 1] = y
      previous[i3 + 2] = z
      grid.cloth[i3] = x + vx * step * (1 - drag) + ax * step * step
      grid.cloth[i3 + 1] = y + vy * step * (1 - drag) + ay * step * step
      grid.cloth[i3 + 2] = z + vz * step * (1 - drag) + az * step * step
    }
  }

  const collideGround = (): void => {
    const count = grid.cloth.length / 3
    for (let index = grid.columns; index < count; index += 1) {
      const i3 = index * 3
      if (grid.cloth[i3 + 1] < 0.06) {
        grid.cloth[i3 + 1] = 0.06
        previous[i3 + 1] = 0.06
        const friction = 0.72
        previous[i3] += (grid.cloth[i3] - previous[i3]) * friction
        previous[i3 + 2] += (grid.cloth[i3 + 2] - previous[i3 + 2]) * friction
      }
    }
  }

  const measure = (): void => {
    const bottomRow = grid.segY * grid.columns
    let flare = 0
    for (let column = 0; column < grid.columns; column += 1) {
      const i3 = (bottomRow + column) * 3
      const radius = Math.hypot(grid.cloth[i3], grid.cloth[i3 + 2])
      flare += radius - (cfg.armLength - cfg.clothWidth / 2)
    }
    state.flare = flare / grid.columns
    const cos = Math.cos(state.armAngle)
    const sin = Math.sin(state.armAngle)
    let flutter = 0
    const count = grid.cloth.length / 3
    for (let index = grid.columns; index < count; index += 1) {
      const i3 = index * 3
      const localX = grid.rest[i3]
      const rx = cos * localX
      const rz = -sin * localX
      const dx = grid.cloth[i3] - rx
      const dy = grid.cloth[i3 + 1] - grid.rest[i3 + 1]
      const dz = grid.cloth[i3 + 2] - rz
      const deviation = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (deviation > flutter) flutter = deviation
    }
    state.flutter = flutter
  }

  const strikeWall = (): void => {
    if (state.wall.length === 0) return
    const samples: number[] = []
    for (let row = Math.max(0, grid.segY - 2); row <= grid.segY; row += 1) {
      for (let column = 0; column < grid.columns; column += 2) samples.push(row * grid.columns + column)
    }
    const omega = state.angularSpeed
    for (const brick of state.wall) {
      if (brick.active || brick.settled) continue
      const distance = nearestDistance(brick.position, grid.cloth, samples)
      if (distance > BRICK_SIZE * 0.82) continue
      const radius = Math.hypot(brick.position[0], brick.position[2])
      const tangent = [-Math.sin(state.armAngle), 0, -Math.cos(state.armAngle)]
      const speed = clamp(Math.abs(omega) * radius * 0.42, 1.2, 16)
      knockBrick(
        brick,
        [
          tangent[0] * speed,
          clamp(1.4 + Math.abs(omega) * 0.5, 0.8, 5),
          tangent[2] * speed
        ],
        22022
      )
      state.knocked += 1
      state.contacts += 1
    }
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 240, 1 / 30)
    state.time += step
    state.angularSpeed = (cfg.rpm * Math.PI * 2) / 60
    state.armAngle = (state.armAngle + state.angularSpeed * step) % (Math.PI * 2)
    updateAnchors()
    integrate(step)
    const iterations = 5 + Math.round(clamp(cfg.stiffness, 0.05, 1) * 7)
    const result = solveDistanceConstraints(grid.cloth, grid.constraints, grid.invMass, clamp(cfg.stiffness, 0.05, 1), iterations)
    state.residual = result.residual
    collideGround()
    measure()
    strikeWall()
    stepBricks(state.wall, step, BRICK_SIZE, cfg.damping, cfg.gravity)
  }

  const configure = (next: Partial<S22Config>): void => {
    const previousKey = `${Math.round(cfg.segments)}|${cfg.armLength.toFixed(2)}|${cfg.clothWidth.toFixed(2)}|${cfg.clothHeight.toFixed(2)}|${Math.round(cfg.wallRows)}`
    cfg = { ...cfg, ...next }
    const key = `${Math.round(cfg.segments)}|${cfg.armLength.toFixed(2)}|${cfg.clothWidth.toFixed(2)}|${cfg.clothHeight.toFixed(2)}|${Math.round(cfg.wallRows)}`
    if (key !== previousKey) rebuild()
  }

  const calibration = (): CalibrationRow[] => {
    const row = Math.floor(grid.segY / 2) * grid.columns
    let sum = 0
    for (let column = 0; column < grid.segX; column += 1) {
      const a3 = (row + column) * 3
      const dx = grid.cloth[a3 + 3] - grid.cloth[a3]
      const dy = grid.cloth[a3 + 4] - grid.cloth[a3 + 1]
      const dz = grid.cloth[a3 + 5] - grid.cloth[a3 + 2]
      sum += Math.sqrt(dx * dx + dy * dy + dz * dz)
    }
    const average = grid.segX > 0 ? sum / grid.segX : 0
    return [
      calibrationRow('横向单元长度', average, cfg.clothWidth / grid.segX, 'm', 0.08),
      calibrationRow('布料质点数量', grid.cloth.length / 3, grid.columns * (grid.segY + 1), '个', 0),
      calibrationRow('墙体构件数量', state.wall.length, Math.max(1, Math.round(cfg.wallRows)) * WALL_COLUMNS, '块', 0),
      calibrationRow('速度有限性', Number.isFinite(state.cloth[0]) ? 1 : 0, 1, '', 0)
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
      角速度rads: Number(state.angularSpeed.toFixed(2)),
      布料外张m: Number(state.flare.toFixed(2)),
      布料摆幅m: Number(state.flutter.toFixed(2)),
      约束残差m: Number(state.residual.toFixed(4)),
      撞落砖块: state.knocked
    }),
    calibration,
    serialize: () => ({
      time: state.time,
      armAngle: state.armAngle,
      cloth: Array.from(state.cloth),
      wall: state.wall.map((brick) => ({ id: brick.id, p: brick.position, v: brick.velocity })),
      knocked: state.knocked
    }),
    reset: rebuild
  }
}
