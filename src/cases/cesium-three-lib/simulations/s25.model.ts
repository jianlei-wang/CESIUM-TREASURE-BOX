import { calibrationRow, clamp, deterministicRng, type CalibrationRow, type ScenarioSimulation, type SimulationMode } from './contract'

export type S25Preset = 'tower' | 'bridge' | 'stone' | 'mountain'

export interface S25Config {
  preset: S25Preset
  speed: number
  projectileMass: number
  projectileRadius: number
  fractureRadius: number
  gravity: number
  restitution: number
  damping: number
}

export interface S25Chunk {
  id: number
  home: [number, number, number]
  size: [number, number, number]
  mass: number
  position: [number, number, number]
  velocity: [number, number, number]
  rotation: [number, number, number]
  spin: [number, number, number]
  active: boolean
  settled: boolean
}

export interface S25State {
  time: number
  preset: S25Preset
  chunks: S25Chunk[]
  projectile: {
    position: [number, number, number]
    velocity: [number, number, number]
    radius: number
    active: boolean
  }
  impactSpeed: number
  destroyed: number
  settled: number
  scatter: number
  hits: number
}

const START_X = -36
const EXPECTED_COUNTS: Record<S25Preset, number> = {
  tower: 32,
  bridge: 20,
  stone: 18,
  mountain: 55
}
const IMPACT_HEIGHT: Record<S25Preset, number> = {
  tower: 3.6,
  bridge: 4.05,
  stone: 1.8,
  mountain: 2.4
}

function pushChunk(
  chunks: S25Chunk[],
  position: [number, number, number],
  size: [number, number, number],
  density = 1
): void {
  const volume = size[0] * size[1] * size[2]
  chunks.push({
    id: chunks.length,
    home: [position[0], position[1], position[2]],
    size,
    mass: Math.max(0.5, volume * density),
    position: [position[0], position[1], position[2]],
    velocity: [0, 0, 0],
    rotation: [0, 0, 0],
    spin: [0, 0, 0],
    active: false,
    settled: false
  })
}

function buildPreset(preset: S25Preset): S25Chunk[] {
  const chunks: S25Chunk[] = []
  if (preset === 'tower') {
    const size: [number, number, number] = [1.35, 0.74, 1.35]
    const levels = 8
    for (let level = 0; level < levels; level += 1) {
      const y = size[1] * 0.5 + level * size[1]
      for (let ix = 0; ix < 2; ix += 1) {
        for (let iz = 0; iz < 2; iz += 1) {
          pushChunk(chunks, [(ix - 0.5) * size[0], y, (iz - 0.5) * size[2]], size, 1.1)
        }
      }
    }
  } else if (preset === 'bridge') {
    const deckSize: [number, number, number] = [1.6, 0.52, 1.56]
    const count = 12
    for (let index = 0; index < count; index += 1) {
      const z = (index - (count - 1) / 2) * deckSize[2]
      pushChunk(chunks, [0, 4.05, z], deckSize, 0.9)
    }
    const pierSize: [number, number, number] = [1.5, 0.95, 1.5]
    for (const z of [-9.36, 9.36]) {
      for (let level = 0; level < 4; level += 1) {
        pushChunk(chunks, [0, pierSize[1] * 0.5 + level * pierSize[1], z], pierSize, 1.2)
      }
    }
  } else if (preset === 'stone') {
    const size: [number, number, number] = [1.55, 1.55, 1.55]
    for (let ix = -1; ix <= 1; ix += 1) {
      for (let iz = -1; iz <= 1; iz += 1) {
        for (let iy = 0; iy < 2; iy += 1) {
          pushChunk(chunks, [ix * size[0], size[1] * 0.5 + iy * size[1], iz * size[2]], size, 1.4)
        }
      }
    }
  } else {
    const size: [number, number, number] = [1.5, 1.5, 1.5]
    const layers = 5
    for (let layer = 0; layer < layers; layer += 1) {
      const span = layers - layer
      const y = size[1] * 0.5 + layer * size[1]
      for (let ix = 0; ix < span; ix += 1) {
        for (let iz = 0; iz < span; iz += 1) {
          pushChunk(
            chunks,
            [(ix - (span - 1) / 2) * size[0], y, (iz - (span - 1) / 2) * size[2]],
            size,
            1.25
          )
        }
      }
    }
  }
  return chunks
}

function chunkDistance(chunk: S25Chunk, point: readonly number[]): number {
  const dx = Math.max(Math.abs(point[0] - chunk.position[0]) - chunk.size[0] * 0.5, 0)
  const dy = Math.max(Math.abs(point[1] - chunk.position[1]) - chunk.size[1] * 0.5, 0)
  const dz = Math.max(Math.abs(point[2] - chunk.position[2]) - chunk.size[2] * 0.5, 0)
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

export function createS25Model(config: S25Config): ScenarioSimulation & {
  state: S25State
  configure(next: Partial<S25Config>): void
  restart(): void
  fire(): void
} {
  let cfg = { ...config }
  let mode: SimulationMode = 'interactive'
  let rng = deterministicRng(25025)
  const state: S25State = {
    time: 0,
    preset: cfg.preset,
    chunks: [],
    projectile: {
      position: [START_X, IMPACT_HEIGHT[cfg.preset], 0],
      velocity: [cfg.speed, 0, 0],
      radius: cfg.projectileRadius,
      active: true
    },
    impactSpeed: 0,
    destroyed: 0,
    settled: 0,
    scatter: 0,
    hits: 0
  }

  const build = (): void => {
    rng = deterministicRng(25025)
    state.chunks = buildPreset(cfg.preset)
    state.preset = cfg.preset
    state.time = 0
    state.impactSpeed = 0
    state.destroyed = 0
    state.settled = 0
    state.scatter = 0
    state.hits = 0
    state.projectile = {
      position: [START_X, IMPACT_HEIGHT[cfg.preset], 0],
      velocity: [Math.max(1, cfg.speed), 0, 0],
      radius: Math.max(0.15, cfg.projectileRadius),
      active: true
    }
  }

  const activateNear = (point: [number, number, number], speed: number): void => {
    const radius = Math.max(0.4, cfg.fractureRadius)
    const projectileMass = Math.max(1, cfg.projectileMass)
    for (const chunk of state.chunks) {
      if (chunk.active || chunk.settled) continue
      const dx = chunk.position[0] - point[0]
      const dy = chunk.position[1] - point[1]
      const dz = chunk.position[2] - point[2]
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (distance > radius) continue
      const falloff = 1 - distance / (radius * 1.05)
      const ratio = projectileMass / (projectileMass + chunk.mass)
      const burst = clamp(speed * ratio * (0.14 + falloff * 0.4), 0.4, 9)
      const horizontal = Math.sqrt(dx * dx + dz * dz) || 1
      chunk.active = true
      chunk.settled = false
      chunk.velocity = [
        speed * ratio * 0.3 + (dx / horizontal) * burst,
        clamp(burst * (0.22 + rng() * 0.28), 0.4, 5),
        (dz / horizontal) * burst + (rng() - 0.5) * 1.6
      ]
      chunk.spin = [(rng() - 0.5) * 3.6, (rng() - 0.5) * 4.4, (rng() - 0.5) * 3.6]
      state.destroyed += 1
    }
  }

  const stepProjectile = (step: number): void => {
    const projectile = state.projectile
    if (!projectile.active) return
    projectile.position[0] += projectile.velocity[0] * step
    projectile.position[1] += projectile.velocity[1] * step
    projectile.position[2] += projectile.velocity[2] * step
    const speed = Math.hypot(projectile.velocity[0], projectile.velocity[1], projectile.velocity[2])
    if (projectile.position[0] > 70 || projectile.position[1] < -5) {
      projectile.active = false
      return
    }
    let struck = false
    for (const chunk of state.chunks) {
      if (chunk.active || chunk.settled) continue
      if (chunkDistance(chunk, projectile.position) > projectile.radius) continue
      struck = true
      state.impactSpeed = Math.max(state.impactSpeed, speed)
      state.hits += 1
      activateNear(projectile.position, speed)
      const ratio = Math.max(1, cfg.projectileMass) / (Math.max(1, cfg.projectileMass) + 8)
      projectile.velocity = [projectile.velocity[0] * (0.5 + ratio * 0.2), speed * 0.08, (rng() - 0.5) * speed * 0.08]
      if (speed < 3.5) projectile.active = false
      break
    }
    if (!struck && projectile.position[1] < projectile.radius) {
      projectile.velocity = [projectile.velocity[0] * 0.7, Math.abs(projectile.velocity[1]) * 0.2, 0]
      projectile.position[1] = projectile.radius
    }
  }

  const releaseUnsupported = (): void => {
    if (state.hits === 0) return
    const intact = state.chunks.filter((chunk) => !chunk.active)
    if (intact.length === 0) return
    const maxCantilever = 1.7
    const supported = new Set<number>()
    const reach = new Map<number, number>()
    const queue: number[] = []
    for (const chunk of intact) {
      if (chunk.position[1] <= chunk.size[1] * 0.5 + 0.08) {
        supported.add(chunk.id)
        reach.set(chunk.id, 0)
        queue.push(chunk.id)
      }
    }
    const byId = new Map(intact.map((chunk) => [chunk.id, chunk]))
    while (queue.length > 0) {
      const source = byId.get(queue.pop() as number)
      if (!source) continue
      const sourceReach = reach.get(source.id) ?? 0
      for (const target of intact) {
        if (supported.has(target.id)) continue
        const rise = target.position[1] - source.position[1]
        if (rise < -0.02) continue
        const gapX = Math.abs(source.position[0] - target.position[0]) - (source.size[0] + target.size[0]) * 0.5
        const gapY = Math.abs(rise) - (source.size[1] + target.size[1]) * 0.5
        const gapZ = Math.abs(source.position[2] - target.position[2]) - (source.size[2] + target.size[2]) * 0.5
        if (gapX > 0.14 || gapY > 0.14 || gapZ > 0.14) continue
        const span = Math.hypot(
          target.position[0] - source.position[0],
          target.position[2] - source.position[2]
        )
        const nextReach = rise > 0.02 ? 0 : sourceReach + span
        if (nextReach > maxCantilever) continue
        supported.add(target.id)
        reach.set(target.id, nextReach)
        queue.push(target.id)
      }
    }
    for (const chunk of intact) {
      if (supported.has(chunk.id)) continue
      chunk.active = true
      chunk.settled = false
      chunk.velocity = [0, -0.4, 0]
      chunk.spin = [(rng() - 0.5) * 0.6, (rng() - 0.5) * 0.8, (rng() - 0.5) * 0.6]
      state.destroyed += 1
    }
  }

  const stepChunks = (step: number): void => {
    const restitution = clamp(cfg.restitution, 0, 0.55)
    let settled = 0
    let scatter = 0
    for (const chunk of state.chunks) {
      if (!chunk.active) continue
      if (!chunk.settled) {
        chunk.velocity[1] -= cfg.gravity * step
        chunk.position[0] += chunk.velocity[0] * step
        chunk.position[1] += chunk.velocity[1] * step
        chunk.position[2] += chunk.velocity[2] * step
        chunk.rotation[0] += chunk.spin[0] * step
        chunk.rotation[1] += chunk.spin[1] * step
        chunk.rotation[2] += chunk.spin[2] * step
        const half = chunk.size[1] * 0.5
        if (chunk.position[1] < half) {
          chunk.position[1] = half
          if (Math.abs(chunk.velocity[1]) > 1.1) {
            chunk.velocity[1] = Math.abs(chunk.velocity[1]) * restitution
          } else {
            chunk.velocity[1] = 0
          }
          const friction = clamp((0.7 + cfg.damping) * step * 5, 0, 0.9)
          chunk.velocity[0] *= 1 - friction
          chunk.velocity[2] *= 1 - friction
          const spinDrag = Math.max(0, 1 - step * 4)
          chunk.spin = [chunk.spin[0] * spinDrag, chunk.spin[1] * spinDrag, chunk.spin[2] * spinDrag]
          if (Math.hypot(chunk.velocity[0], chunk.velocity[1], chunk.velocity[2]) < 0.22) {
            chunk.velocity = [0, 0, 0]
            chunk.spin = [0, 0, 0]
            chunk.settled = true
          }
        }
      }
      if (chunk.settled) settled += 1
      const distance = Math.hypot(
        chunk.position[0] - chunk.home[0],
        chunk.position[1] - chunk.home[1],
        chunk.position[2] - chunk.home[2]
      )
      if (distance > scatter) scatter = distance
    }
    state.settled = settled
    state.scatter = Math.max(state.scatter, scatter)
  }

  const fixedStep = (dt: number): void => {
    const step = clamp(dt, 1 / 240, 1 / 30)
    state.time += step
    stepProjectile(step)
    releaseUnsupported()
    stepChunks(step)
  }

  const configure = (next: Partial<S25Config>): void => {
    const previousPreset = cfg.preset
    cfg = { ...cfg, ...next }
    if (cfg.preset !== previousPreset) {
      build()
      return
    }
    state.projectile.radius = Math.max(0.15, cfg.projectileRadius)
    if (state.hits === 0 && state.projectile.active) {
      state.projectile.velocity = [Math.max(1, cfg.speed), 0, 0]
    }
  }

  const calibration = (): CalibrationRow[] => {
    return [
      calibrationRow('构件总数', state.chunks.length, EXPECTED_COUNTS[cfg.preset], '块', 0),
      calibrationRow('断裂构件', state.destroyed, state.chunks.filter((chunk) => chunk.active).length, '块', 0),
      calibrationRow('冲击速度', state.impactSpeed, Math.max(1, cfg.speed), 'm/s', Math.max(2, cfg.speed * 0.4)),
      calibrationRow('数值有限性', state.projectile.position.every(Number.isFinite) ? 1 : 0, 1, '', 0)
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
    fire: build,
    fixedStep,
    diagnostics: () => ({
      模式: mode,
      仿真时间s: Number(state.time.toFixed(2)),
      冲击速度ms: Number(state.impactSpeed.toFixed(1)),
      撞击次数: state.hits,
      断裂构件: state.destroyed,
      静止构件: state.settled,
      最大抛撒m: Number(state.scatter.toFixed(1))
    }),
    calibration,
    serialize: () => ({
      time: state.time,
      projectile: state.projectile,
      chunkCount: state.chunks.length,
      destroyed: state.destroyed,
      chunks: state.chunks.filter((chunk) => chunk.active).map((chunk) => ({ id: chunk.id, p: chunk.position, v: chunk.velocity }))
    }),
    reset: build
  }
}
