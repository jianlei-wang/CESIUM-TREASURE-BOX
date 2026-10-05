import type { FieldStats, GridSpec, SimulationParameters } from '@rt/types/model'
import { velocityAt, velocityNormalized } from './vector-field'

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value))
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(edge1 - edge0, 1e-6))
  return t * t * (3 - 2 * t)
}

function idx(x: number, y: number, z: number, grid: GridSpec): number {
  return x + grid.nx * (y + grid.ny * z)
}

function clampIndex(value: number, maxExclusive: number): number {
  return Math.max(0, Math.min(maxExclusive - 1, value))
}

export class RedTideSimulator {
  readonly grid: GridSpec
  readonly params: SimulationParameters
  readonly data: Float32Array
  private buffer: Float32Array
  private elapsedSeconds = 0
  private seedSnapshot: Float32Array
  private snapshots = new Map<number, Float32Array>()

  constructor(
    grid: GridSpec,
    params: SimulationParameters,
    data = new Float32Array(grid.nx * grid.ny * grid.nz),
    buffer = new Float32Array(grid.nx * grid.ny * grid.nz),
  ) {
    this.grid = grid
    this.params = params
    const size = grid.nx * grid.ny * grid.nz
    if (data.length !== size || buffer.length !== size) {
      throw new Error('Simulation buffers do not match the configured grid size.')
    }
    this.data = data
    this.buffer = buffer
    this.seedSnapshot = new Float32Array(size)
    this.seedInitialField()
  }

  get elapsed(): number {
    return this.elapsedSeconds
  }

  reset(): void {
    this.data.set(this.seedSnapshot)
    this.buffer.fill(0)
    this.elapsedSeconds = 0
  }

  restoreNearestSnapshot(targetSeconds: number): number {
    const keys = [...this.snapshots.keys()].filter((key) => key <= targetSeconds)
    const nearest = keys.length ? Math.max(...keys) : 0
    const snapshot = this.snapshots.get(nearest) ?? this.seedSnapshot
    this.data.set(snapshot)
    this.elapsedSeconds = nearest
    return nearest
  }

  sampleNormalized(x: number, y: number, z: number): number {
    const fx = clamp(x, 0, this.grid.nx - 1)
    const fy = clamp(y, 0, this.grid.ny - 1)
    const fz = clamp(z, 0, this.grid.nz - 1)
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const z0 = Math.floor(fz)
    const x1 = clampIndex(x0 + 1, this.grid.nx)
    const y1 = clampIndex(y0 + 1, this.grid.ny)
    const z1 = clampIndex(z0 + 1, this.grid.nz)
    const tx = fx - x0
    const ty = fy - y0
    const tz = fz - z0

    const c000 = this.data[idx(x0, y0, z0, this.grid)]
    const c100 = this.data[idx(x1, y0, z0, this.grid)]
    const c010 = this.data[idx(x0, y1, z0, this.grid)]
    const c110 = this.data[idx(x1, y1, z0, this.grid)]
    const c001 = this.data[idx(x0, y0, z1, this.grid)]
    const c101 = this.data[idx(x1, y0, z1, this.grid)]
    const c011 = this.data[idx(x0, y1, z1, this.grid)]
    const c111 = this.data[idx(x1, y1, z1, this.grid)]

    const c00 = c000 * (1 - tx) + c100 * tx
    const c10 = c010 * (1 - tx) + c110 * tx
    const c01 = c001 * (1 - tx) + c101 * tx
    const c11 = c011 * (1 - tx) + c111 * tx
    const c0 = c00 * (1 - ty) + c10 * ty
    const c1 = c01 * (1 - ty) + c11 * ty
    return c0 * (1 - tz) + c1 * tz
  }

  step(): void {
    const { nx, ny, nz } = this.grid
    const { dtSeconds, diffusion, growthRate, decayRate, nutrient, light, temperature } = this.params
    const dtGrid = dtSeconds
    const temperatureFactor = clamp(1 - Math.abs(temperature - 24) / 16, 0.2, 1)
    const envGrowth = growthRate * (0.55 + 0.45 * nutrient) * (0.55 + 0.45 * light) * temperatureFactor

    for (let z = 0; z < nz; z += 1) {
      for (let y = 0; y < ny; y += 1) {
        for (let x = 0; x < nx; x += 1) {
          const vel = velocityNormalized(x, y, z, this.grid, this.elapsedSeconds)
          const bx = x - vel.u * dtGrid
          const by = y - vel.v * dtGrid
          const bz = z - vel.w * dtGrid
          const advected = this.sampleNormalized(bx, by, bz)

          const left = this.data[idx(clampIndex(x - 1, nx), y, z, this.grid)]
          const right = this.data[idx(clampIndex(x + 1, nx), y, z, this.grid)]
          const down = this.data[idx(x, clampIndex(y - 1, ny), z, this.grid)]
          const up = this.data[idx(x, clampIndex(y + 1, ny), z, this.grid)]
          const below = this.data[idx(x, y, clampIndex(z - 1, nz), this.grid)]
          const above = this.data[idx(x, y, clampIndex(z + 1, nz), this.grid)]
          const center = this.data[idx(x, y, z, this.grid)]

          const laplacian = left + right + down + up + below + above - center * 6
          const depth01 = z / Math.max(nz - 1, 1)
          const lightFactor = 1 - 0.72 * depth01
          const temperatureResponse = smoothstep(0, 1, temperatureFactor * (0.5 + 0.5 * lightFactor))
          const growth = advected * envGrowth * temperatureResponse * dtSeconds
          const decay = advected * decayRate * dtSeconds
          const result = advected + diffusion * laplacian + growth - decay

          this.buffer[idx(x, y, z, this.grid)] = clamp(result)
        }
      }
    }

    this.data.set(this.buffer)
    this.elapsedSeconds += dtSeconds
    if (Math.abs(this.elapsedSeconds % 3600) < 0.001) {
      this.snapshots.set(Math.round(this.elapsedSeconds), this.data.slice())
    }
  }

  advance(seconds: number): number {
    let steps = 0
    const maxSteps = 12
    while (seconds > 0 && steps < maxSteps) {
      if (seconds + 1e-4 >= this.params.dtSeconds) {
        this.step()
        seconds -= this.params.dtSeconds
        steps += 1
      } else {
        break
      }
    }
    return steps
  }

  stats(): FieldStats {
    const { nx, ny, nz, cellX, cellY, cellZ } = this.grid
    let min = 1
    let max = 0
    let sum = 0
    let affectedVolumeCells = 0
    let affectedSurfaceCells = 0
    let affectedDepthIndex = 0
    let surfaceMax = 0

    for (let z = 0; z < nz; z += 1) {
      for (let y = 0; y < ny; y += 1) {
        for (let x = 0; x < nx; x += 1) {
          const value = this.data[idx(x, y, z, this.grid)]
          min = Math.min(min, value)
          max = Math.max(max, value)
          sum += value
          if (value >= 0.18) {
            affectedVolumeCells += 1
            affectedDepthIndex = Math.max(affectedDepthIndex, z)
          }
          if (z < Math.min(this.grid.nz, 4)) surfaceMax = Math.max(surfaceMax, value)
        }
      }
    }

    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        let anyAffected = false
        for (let z = 0; z < nz; z += 1) {
          if (this.data[idx(x, y, z, this.grid)] >= 0.18) {
            anyAffected = true
            break
          }
        }
        if (anyAffected) affectedSurfaceCells += 1
      }
    }

    const horizontalCellAreaKm2 = (cellX * cellY) / 1e6
    return {
      min,
      max,
      mean: sum / this.data.length,
      affectedAreaKm2: affectedSurfaceCells * horizontalCellAreaKm2,
      affectedVolumeKm3: (affectedVolumeCells * cellX * cellY * cellZ) / 1e9,
      affectedDepthM: (affectedDepthIndex / Math.max(nz - 1, 1)) * this.grid.depth,
      surfaceMax,
    }
  }

  sampleSurface(nx = 128, ny = 128): Uint8Array {
    const out = new Uint8Array(nx * ny)
    this.sampleSurfaceInto(out, nx, ny)
    return out
  }

  sampleSurfaceInto(out: Uint8Array, nx = 128, ny = 128): void {
    if (out.length !== nx * ny) throw new Error('Surface buffer size does not match the requested dimensions.')
    for (let y = 0; y < ny; y += 1) {
      const gy = (y / Math.max(ny - 1, 1)) * (this.grid.ny - 1)
      for (let x = 0; x < nx; x += 1) {
        const gx = (x / Math.max(nx - 1, 1)) * (this.grid.nx - 1)
        let peak = 0
        for (let z = 0; z < Math.min(this.grid.nz, 6); z += 1) {
          peak = Math.max(peak, this.sampleNormalized(gx, gy, z))
        }
        out[x + nx * y] = Math.round(clamp(peak) * 255)
      }
    }
  }

  quantizeFieldInto(out: Uint8Array): void {
    if (out.length !== this.data.length) throw new Error('Quantized field buffer size mismatch.')
    for (let i = 0; i < this.data.length; i += 1) {
      out[i] = Math.round(clamp(this.data[i]) * 255)
    }
  }

  sampleParticles(count: number): Float32Array {
    const points = new Float32Array(count * 4)
    const { nx, ny, nz } = this.grid
    for (let i = 0; i < count; i += 1) {
      const x = (Math.random() * (nx - 1))
      const y = (Math.random() * (ny - 1))
      const z = Math.random() * (nz - 1)
      points[i * 4] = x
      points[i * 4 + 1] = y
      points[i * 4 + 2] = z
      points[i * 4 + 3] = this.sampleNormalized(x, y, z)
    }
    return points
  }

  velocityAtNormalized(x: number, y: number, z: number): { u: number; v: number; w: number } {
    return velocityAt(
      clamp(x, 0, this.grid.nx - 1),
      clamp(y, 0, this.grid.ny - 1),
      clamp(z, 0, this.grid.nz - 1),
      this.grid,
      this.elapsedSeconds,
    )
  }

  private seedInitialField(): void {
    this.data.set(createInitialField(this.grid))
    this.seedSnapshot.set(this.data)
    this.snapshots.set(0, this.data.slice())
  }
}

export function createInitialField(grid: GridSpec): Float32Array {
  const { nx, ny, nz } = grid
  const data = new Float32Array(nx * ny * nz)
  const blooms = [
    { x: 0.53, y: 0.44, z: 0.13, amp: 0.98, sx: 0.11, sy: 0.10, sz: 0.16 },
    { x: 0.66, y: 0.60, z: 0.20, amp: 0.72, sx: 0.085, sy: 0.12, sz: 0.13 },
    { x: 0.37, y: 0.56, z: 0.12, amp: 0.48, sx: 0.09, sy: 0.08, sz: 0.10 },
  ]

  for (let z = 0; z < nz; z += 1) {
    const z01 = z / Math.max(nz - 1, 1)
    for (let y = 0; y < ny; y += 1) {
      const y01 = y / Math.max(ny - 1, 1)
      for (let x = 0; x < nx; x += 1) {
        const x01 = x / Math.max(nx - 1, 1)
        let value = 0
        for (const bloom of blooms) {
          const dx = (x01 - bloom.x) / bloom.sx
          const dy = (y01 - bloom.y) / bloom.sy
          const dz = (z01 - bloom.z) / bloom.sz
          value += bloom.amp * Math.exp(-(dx * dx + dy * dy + dz * dz) * 0.9)
        }
        data[idx(x, y, z, grid)] = clamp(value * Math.exp(-z01 * 2.4))
      }
    }
  }
  return data
}

export function createInitialField8(grid: GridSpec): Uint8Array {
  const field = createInitialField(grid)
  const out = new Uint8Array(field.length)
  for (let i = 0; i < field.length; i += 1) out[i] = Math.round(clamp(field[i]) * 255)
  return out
}
