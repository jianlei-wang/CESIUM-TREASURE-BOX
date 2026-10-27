import { calibrationRow, clamp, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'
import { solveDistanceConstraints, type DistanceConstraint } from './pbd'

export type S24Shape = 'sphere' | 'box' | 'beam'

export interface S24Config {
  shape: S24Shape
  dropHeight: number
  softness: number
  mass: number
  gravity: number
  damping: number
  resolution: number
  restitution: number
}

export interface S24State {
  time: number
  positions: Float32Array
  rest: Float32Array
  edges: [number, number][]
  count: number
  particleRadius: number
  squash: number
  maxSquash: number
  residual: number
  contacts: number
  landed: boolean
  dropHeight: number
}

const SPHERE_RADIUS = 2.2
const BOX_EXTENTS: [number, number, number] = [1.9, 1.9, 1.9]
const BEAM_EXTENTS: [number, number, number] = [1.15, 1.15, 3.3]

function extentsOf(shape: S24Shape): [number, number, number] {
  return shape === 'sphere' ? [SPHERE_RADIUS, SPHERE_RADIUS, SPHERE_RADIUS] : shape === 'beam' ? BEAM_EXTENTS : BOX_EXTENTS
}

interface Lattice {
  rest: Float32Array
  edges: [number, number][]
  count: number
  minSpacing: number
  restHeight: number
}

function createLattice(shape: S24Shape, resolution: number): Lattice {
  const n = clamp(Math.round(resolution), shape === 'sphere' ? 5 : 3, 6)
  const extents = extentsOf(shape)
  const spacing: [number, number, number] = [
    (extents[0] * 2) / (n - 1),
    (extents[1] * 2) / (n - 1),
    (extents[2] * 2) / (n - 1)
  ]
  const indices: number[] = []
  const points: number[] = []
  let id = 0
  const grid: number[] = new Array(n * n * n).fill(-1)
  for (let ix = 0; ix < n; ix += 1) {
    for (let iy = 0; iy < n; iy += 1) {
      for (let iz = 0; iz < n; iz += 1) {
        const x = -extents[0] + ix * spacing[0]
        const y = -extents[1] + iy * spacing[1]
        const z = -extents[2] + iz * spacing[2]
        if (shape === 'sphere' && (x / SPHERE_RADIUS) ** 2 + (y / SPHERE_RADIUS) ** 2 + (z / SPHERE_RADIUS) ** 2 > 1.02) continue
        grid[(ix * n + iy) * n + iz] = id
        points.push(x, y, z)
        indices.push(ix, iy, iz)
        id += 1
      }
    }
  }
  const rest = Float32Array.from(points)
  const edges: [number, number][] = []
  for (let index = 0; index < id; index += 1) {
    const ax = indices[index * 3]
    const ay = indices[index * 3 + 1]
    const az = indices[index * 3 + 2]
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          if (dx === 0 && dy === 0 && dz === 0) continue
          const nx = ax + dx
          const ny = ay + dy
          const nz = az + dz
          if (nx < 0 || ny < 0 || nz < 0 || nx >= n || ny >= n || nz >= n) continue
          const other = grid[(nx * n + ny) * n + nz]
          if (other < 0 || other <= index) continue
          edges.push([index, other])
        }
      }
    }
  }
  let minY = Infinity
  let maxY = -Infinity
  for (let index = 0; index < id; index += 1) {
    const y = rest[index * 3 + 1]
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return {
    rest,
    edges,
    count: id,
    minSpacing: Math.min(spacing[0], spacing[1], spacing[2]),
    restHeight: maxY - minY
  }
}

export function createS24Model(config: S24Config): ScenarioSimulation & {
  state: S24State
  configure(next: Partial<S24Config>): void
  restart(): void
  drop(): void
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  const state: S24State = {
    time: 0,
    positions: new Float32Array(0),
    rest: new Float32Array(0),
    edges: [],
    count: 0,
    particleRadius: 0.2,
    squash: 0,
    maxSquash: 0,
    residual: 0,
    contacts: 0,
    landed: false,
    dropHeight: 0
  }
  let previous = new Float32Array(0)
  let constraints: DistanceConstraint[] = []
  let invMass = new Float32Array(0)
  let particleMass = 1
  let restHeight = 1
  let particleRadius = 0.2

  const build = (): void => {
    const lattice = createLattice(cfg.shape, cfg.resolution)
    restHeight = Math.max(0.4, lattice.restHeight)
    particleRadius = Math.max(0.05, lattice.minSpacing * 0.34)
    const offsetY = Math.max(0.2, cfg.dropHeight) + lattice.restHeight / 2
    const positions = new Float32Array(lattice.count * 3)
    for (let index = 0; index < lattice.count; index += 1) {
      const i3 = index * 3
      positions[i3] = lattice.rest[i3]
      positions[i3 + 1] = lattice.rest[i3 + 1] + offsetY
      positions[i3 + 2] = lattice.rest[i3 + 2]
    }
    particleMass = Math.max(0.01, cfg.mass / lattice.count)
    invMass = new Float32Array(lattice.count).fill(1 / particleMass)
    constraints = lattice.edges.map(([a, b]) => {
      const a3 = a * 3
      const b3 = b * 3
      const dx = lattice.rest[b3] - lattice.rest[a3]
      const dy = lattice.rest[b3 + 1] - lattice.rest[a3 + 1]
      const dz = lattice.rest[b3 + 2] - lattice.rest[a3 + 2]
      return { a, b, rest: Math.sqrt(dx * dx + dy * dy + dz * dz) }
    })
    state.positions = positions
    state.rest = lattice.rest
    state.edges = lattice.edges
    state.count = lattice.count
    state.particleRadius = particleRadius
    state.time = 0
    state.squash = 0
    state.maxSquash = 0
    state.residual = 0
    state.contacts = 0
    state.landed = false
    state.dropHeight = Math.max(0.2, cfg.dropHeight)
    previous = Float32Array.from(positions)
  }

  const integrate = (step: number): void => {
    const drag = clamp(cfg.damping * step * 2.4, 0, 0.5)
    for (let index = 0; index < state.count; index += 1) {
      const i3 = index * 3
      const x = state.positions[i3]
      const y = state.positions[i3 + 1]
      const z = state.positions[i3 + 2]
      const vx = (x - previous[i3]) / step
      const vy = (y - previous[i3 + 1]) / step
      const vz = (z - previous[i3 + 2]) / step
      previous[i3] = x
      previous[i3 + 1] = y
      previous[i3 + 2] = z
      state.positions[i3] = x + vx * step * (1 - drag)
      state.positions[i3 + 1] = y + vy * step * (1 - drag) - cfg.gravity * step * step
      state.positions[i3 + 2] = z + vz * step * (1 - drag)
    }
  }

  const collideGround = (): void => {
    const r = particleRadius
    const restitution = clamp(cfg.restitution, 0, 0.6)
    let contacts = 0
    for (let index = 0; index < state.count; index += 1) {
      const i3 = index * 3
      if (state.positions[i3 + 1] >= r) continue
      const y = state.positions[i3 + 1]
      const v = y - previous[i3 + 1]
      state.positions[i3 + 1] = r
      previous[i3 + 1] = r + restitution * v
      previous[i3] += (state.positions[i3] - previous[i3]) * 0.34
      previous[i3 + 2] += (state.positions[i3 + 2] - previous[i3 + 2]) * 0.34
      contacts += 1
    }
    state.contacts = contacts
    if (!state.landed && contacts > state.count * 0.15) state.landed = true
  }

  const measure = (): void => {
    let minY = Infinity
    let maxY = -Infinity
    for (let index = 0; index < state.count; index += 1) {
      const y = state.positions[index * 3 + 1]
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const height = maxY - minY
    state.squash = (restHeight - height) / restHeight
    if (state.squash > state.maxSquash) state.maxSquash = state.squash
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 240, 1 / 30)
    state.time += step
    integrate(step)
    const stiffness = clamp(0.12 + cfg.softness * 0.88, 0.08, 1)
    const result = solveDistanceConstraints(state.positions, constraints, invMass, stiffness, 7)
    state.residual = result.residual
    collideGround()
    measure()
  }

  const configure = (next: Partial<S24Config>): void => {
    const previousKey = `${cfg.shape}|${Math.round(cfg.resolution)}|${cfg.dropHeight.toFixed(2)}|${cfg.mass.toFixed(2)}`
    cfg = { ...cfg, ...next }
    const key = `${cfg.shape}|${Math.round(cfg.resolution)}|${cfg.dropHeight.toFixed(2)}|${cfg.mass.toFixed(2)}`
    if (key !== previousKey) build()
  }

  const calibration = (): CalibrationRow[] => {
    let finiteFlag = 1
    for (let index = 0; index < state.positions.length; index += 1) {
      if (!Number.isFinite(state.positions[index])) {
        finiteFlag = 0
        break
      }
    }
    const referenceHeight = (cfg.shape === 'sphere' ? SPHERE_RADIUS : extentsOf(cfg.shape)[1]) * 2
    let minY = Infinity
    for (let index = 0; index < state.count; index += 1) {
      const y = state.positions[index * 3 + 1]
      if (y < minY) minY = y
    }
    return [
      calibrationRow('静止高度', restHeight, referenceHeight, 'm', 0.8),
      calibrationRow('最低质点高度', minY, particleRadius, 'm', 0.5),
      calibrationRow('约束残差', state.residual, 0, 'm', 0.08),
      calibrationRow('数值有限性', finiteFlag, 1, '', 0)
    ]
  }

  build()

  return {
    state,
    get mode() {
      return mode
    },
    setMode(next) {
      mode = next
    },
    configure,
    restart: build,
    drop: build,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(2)),
      形变压缩率: Number(state.squash.toFixed(3)),
      峰值压缩率: Number(state.maxSquash.toFixed(3)),
      接触质点: state.contacts,
      约束残差m: Number(state.residual.toFixed(4)),
      落地状态: state.landed ? '已接触' : '下落中'
    }),
    calibration,
    serialize: () => ({
      time: state.time,
      positions: Array.from(state.positions),
      squash: state.squash,
      landed: state.landed
    }),
    reset: build
  }
}
