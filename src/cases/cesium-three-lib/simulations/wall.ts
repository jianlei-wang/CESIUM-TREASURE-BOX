import { clamp, deterministicRng } from './contract'

export interface Brick {
  id: number
  home: [number, number, number]
  position: [number, number, number]
  velocity: [number, number, number]
  rotation: [number, number, number]
  spin: [number, number, number]
  active: boolean
  settled: boolean
}

export interface BrickWallOptions {
  rows: number
  columns: number
  size: number
  center: [number, number, number]
  stagger?: boolean
  axis?: 'x' | 'z'
}

const GRAVITY = 9.81

export function buildBrickWall(options: BrickWallOptions): Brick[] {
  const rows = Math.max(1, Math.round(options.rows))
  const columns = Math.max(1, Math.round(options.columns))
  const size = options.size
  const stagger = options.stagger ?? true
  const spacing = size * 1.045
  const alongX = (options.axis ?? 'x') === 'x'
  const bricks: Brick[] = []
  let id = 0
  for (let row = 0; row < rows; row += 1) {
    const offset = stagger && row % 2 === 1 ? spacing * 0.5 : 0
    for (let column = 0; column < columns; column += 1) {
      const lateral = (column - (columns - 1) / 2) * spacing + offset
      const x = options.center[0] + (alongX ? lateral : 0)
      const y = options.center[1] + size * 0.5 + row * spacing
      const z = options.center[2] + (alongX ? 0 : lateral)
      bricks.push({
        id: id++,
        home: [x, y, z],
        position: [x, y, z],
        velocity: [0, 0, 0],
        rotation: [0, 0, 0],
        spin: [0, 0, 0],
        active: false,
        settled: false
      })
    }
  }
  return bricks
}

export function knockBrick(
  brick: Brick,
  velocity: [number, number, number],
  seed: number,
  spinScale = 1
): void {
  const rng = deterministicRng(seed + brick.id * 7919)
  brick.active = true
  brick.settled = false
  brick.velocity = [velocity[0], velocity[1], velocity[2]]
  brick.spin = [
    (rng() - 0.5) * 3.4 * spinScale,
    (rng() - 0.5) * 4.2 * spinScale,
    (rng() - 0.5) * 3.4 * spinScale
  ]
}

export function stepBricks(
  bricks: readonly Brick[],
  step: number,
  size: number,
  damping: number,
  gravity = GRAVITY
): void {
  const half = size * 0.5
  for (const brick of bricks) {
    if (!brick.active && !brick.settled) {
      let supported = brick.position[1] <= half + 0.01
      if (!supported) {
        for (const other of bricks) {
          if (other === brick) continue
          if (other.active && !other.settled) continue
          const dy = brick.position[1] - other.position[1]
          if (dy <= size * 0.5 || dy > size * 1.3) continue
          if (Math.abs(other.position[0] - brick.position[0]) > size * 0.75) continue
          if (Math.abs(other.position[2] - brick.position[2]) > size * 0.75) continue
          supported = true
          break
        }
      }
      if (!supported) {
        brick.active = true
        brick.settled = false
        brick.velocity = [0, 0, 0]
        brick.spin = [0, 0, 0]
      }
    }
    if (!brick.active || brick.settled) continue
    brick.velocity[1] -= gravity * step
    brick.position[0] += brick.velocity[0] * step
    brick.position[1] += brick.velocity[1] * step
    brick.position[2] += brick.velocity[2] * step
    brick.rotation[0] += brick.spin[0] * step
    brick.rotation[1] += brick.spin[1] * step
    brick.rotation[2] += brick.spin[2] * step
    if (brick.position[1] < half) {
      brick.position[1] = half
      if (Math.abs(brick.velocity[1]) > 1.2) {
        brick.velocity[1] = Math.abs(brick.velocity[1]) * 0.24
      } else {
        brick.velocity[1] = 0
      }
      const friction = clamp((0.6 + damping * 0.5) * step * 6, 0, 0.9)
      brick.velocity[0] *= 1 - friction
      brick.velocity[2] *= 1 - friction
      const spinDrag = Math.max(0, 1 - step * 5)
      brick.spin = [brick.spin[0] * spinDrag, brick.spin[1] * spinDrag, brick.spin[2] * spinDrag]
      if (Math.hypot(brick.velocity[0], brick.velocity[1], brick.velocity[2]) < 0.22) {
        brick.velocity = [0, 0, 0]
        brick.spin = [0, 0, 0]
        brick.settled = true
      }
    }
  }
}

export function nearestDistance(
  position: readonly [number, number, number] | number[],
  points: Float32Array,
  indices: readonly number[]
): number {
  let best = Infinity
  for (const index of indices) {
    const i3 = index * 3
    const dx = points[i3] - position[0]
    const dy = points[i3 + 1] - position[1]
    const dz = points[i3 + 2] - position[2]
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (distance < best) best = distance
  }
  return best
}
