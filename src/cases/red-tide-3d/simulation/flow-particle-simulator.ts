import type { GridSpec } from '@rt/types/model'
import { velocityAt } from './vector-field'

interface ParticleState {
  x: number
  y: number
  z: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6D2B79F5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class FlowParticleSimulator {
  readonly count: number
  readonly positions: Float32Array
  readonly intensities: Float32Array
  private readonly state: ParticleState[]
  private random: () => number
  private readonly seed: number

  constructor(private readonly grid: GridSpec, count = 5200, seed = 20260930) {
    this.count = count
    this.seed = seed
    this.random = mulberry32(seed)
    this.positions = new Float32Array(count * 3)
    this.intensities = new Float32Array(count)
    this.state = new Array<ParticleState>(count)

    for (let i = 0; i < count; i += 1) {
      const particle = {
        x: this.random() * (grid.nx - 1),
        y: this.random() * (grid.ny - 1),
        z: this.random() * (grid.nz - 1),
      }
      this.state[i] = particle
    }
  }

  reset(): void {
    this.random = mulberry32(this.seed)
    for (let i = 0; i < this.count; i += 1) {
      this.state[i].x = this.random() * (this.grid.nx - 1)
      this.state[i].y = this.random() * (this.grid.ny - 1)
      this.state[i].z = this.random() * (this.grid.nz - 1)
    }
  }

  update(elapsedSeconds: number, field: Float32Array | Uint8Array, dtSeconds = 0): void {
    const { nx, ny, nz } = this.grid
    const stepSeconds = Math.min(1800, Math.max(0, dtSeconds))

    for (let i = 0; i < this.count; i += 1) {
      const particle = this.state[i]
      const velocity = velocityAt(particle.x, particle.y, particle.z, this.grid, elapsedSeconds)
      particle.x += (velocity.u / this.grid.cellX) * stepSeconds
      particle.y += (velocity.v / this.grid.cellY) * stepSeconds
      particle.z += (velocity.w / this.grid.cellZ) * stepSeconds

      if (
        particle.x < 0 || particle.x > nx - 1 ||
        particle.y < 0 || particle.y > ny - 1 ||
        particle.z < 0 || particle.z > nz - 1
      ) {
        particle.x = this.random() * (nx - 1)
        particle.y = this.random() * (ny - 1)
        particle.z = this.random() * (nz - 1)
      }

      const index = this.gridIndex(
        Math.round(particle.x),
        Math.round(particle.y),
        Math.round(particle.z),
      )
      const raw = field[index]
      const normalized = field instanceof Uint8Array ? raw / 255 : raw

      this.intensities[i] = clamp(0.08 + normalized * 1.28, 0.05, 1)
      this.positions[i * 3] = (particle.x / Math.max(nx - 1, 1) - 0.5) * this.grid.sizeX
      this.positions[i * 3 + 1] = (particle.y / Math.max(ny - 1, 1) - 0.5) * this.grid.sizeY
      this.positions[i * 3 + 2] = -(1 - particle.z / Math.max(nz - 1, 1)) * this.grid.depth
    }
  }

  writeTo(targetPositions: Float32Array, targetIntensities: Float32Array): void {
    targetPositions.set(this.positions)
    targetIntensities.set(this.intensities)
  }

  private gridIndex(x: number, y: number, z: number): number {
    return x + this.grid.nx * (y + this.grid.ny * z)
  }
}