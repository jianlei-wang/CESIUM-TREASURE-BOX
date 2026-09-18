/**
 * LBM-D3Q19 实时三维流体求解器（CPU）。
 *
 * 碰撞：BGK 单松弛 + Guo 体积力；迁移：pull + 固体 bounce-back；
 * 入口为平衡态速度入口，出口为零梯度，底面为壁面，顶部开放。
 */

export const D3Q19_EX = new Int8Array([0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0])
export const D3Q19_EY = new Int8Array([0, 0, 0, 1, -1, 0, 0, 1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1])
export const D3Q19_EZ = new Int8Array([0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1])
export const D3Q19_W = new Float32Array([
  1 / 3,
  1 / 18, 1 / 18, 1 / 18, 1 / 18, 1 / 18, 1 / 18,
  1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36
])
export const D3Q19_OPP = new Int8Array([0, 2, 1, 4, 3, 6, 5, 10, 9, 8, 7, 14, 13, 12, 11, 18, 17, 16, 15])

/** 物理风速 0~10 m/s 映射到稳定格子速度（上限 0.08，远离格子声速）。 */
export const LATTICE_SPEED_MAX = 0.08

export function windMsToLattice(ms: number): number {
  const value = Number.isFinite(ms) ? ms : 0
  return Math.max(0, Math.min(LATTICE_SPEED_MAX, (value / 10) * LATTICE_SPEED_MAX))
}

export type ObstacleBox = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  height: number
}

export type LbmOptions = {
  nx: number
  ny: number
  nz: number
  width: number
  depth: number
  height: number
  tau: number
  windDirection: number
  windSpeed: number
}

export class LbmD3Q19 {
  nx: number
  ny: number
  nz: number
  width: number
  depth: number
  height: number
  dx: number
  dy: number
  dz: number
  originX: number
  originY: number
  originZ = 0
  tau: number
  windDirection: number
  windSpeed: number
  stepCount = 0
  maxSpeed = 0
  avgSpeed = 0
  maxPhi = 0

  solid: Uint8Array
  rho: Float32Array
  ux: Float32Array
  uy: Float32Array
  uz: Float32Array
  speed: Float32Array
  phi: Float32Array

  private fIn: Float32Array
  private fOut: Float32Array
  private phiOut: Float32Array
  private ncell: number

  constructor(options: LbmOptions) {
    this.nx = options.nx
    this.ny = options.ny
    this.nz = options.nz
    this.width = options.width
    this.depth = options.depth
    this.height = options.height
    this.dx = options.width / options.nx
    this.dy = options.depth / options.ny
    this.dz = options.height / options.nz
    this.originX = -options.width / 2
    this.originY = -options.depth / 2
    this.tau = options.tau
    this.windDirection = options.windDirection
    this.windSpeed = options.windSpeed
    this.ncell = options.nx * options.ny * options.nz
    this.solid = new Uint8Array(this.ncell)
    this.rho = new Float32Array(this.ncell)
    this.ux = new Float32Array(this.ncell)
    this.uy = new Float32Array(this.ncell)
    this.uz = new Float32Array(this.ncell)
    this.speed = new Float32Array(this.ncell)
    this.phi = new Float32Array(this.ncell)
    this.phiOut = new Float32Array(this.ncell)
    this.fIn = new Float32Array(this.ncell * 19)
    this.fOut = new Float32Array(this.ncell * 19)
    this.resetDistributions()
  }

  cellIndex(x: number, y: number, z: number): number {
    return x + this.nx * (y + this.ny * z)
  }

  /** 气象风向：0=北，顺时针；返回下风向单位向量（东、北） */
  windVector(): { x: number; y: number } {
    const toward = ((this.windDirection + 180) % 360) * (Math.PI / 180)
    return { x: Math.sin(toward), y: Math.cos(toward) }
  }

  setWind(direction: number, speed: number): void {
    this.windDirection = direction
    this.windSpeed = speed
  }

  setTau(tau: number): void {
    this.tau = Math.max(0.55, Math.min(2, tau))
  }

  voxelize(buildings: ObstacleBox[]): void {
    this.solid.fill(0)
    const { nx, ny, nz, dx, dy, dz, originX, originY } = this
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        this.solid[this.cellIndex(x, y, 0)] = 1
      }
    }
    for (const building of buildings) {
      const x0 = Math.max(0, Math.floor((building.minX - originX) / dx))
      const x1 = Math.min(nx - 1, Math.ceil((building.maxX - originX) / dx))
      const y0 = Math.max(0, Math.floor((building.minY - originY) / dy))
      const y1 = Math.min(ny - 1, Math.ceil((building.maxY - originY) / dy))
      const z1 = Math.min(nz - 1, Math.max(1, Math.ceil(building.height / dz)))
      if (x1 < 0 || y1 < 0 || x0 >= nx || y0 >= ny) continue
      for (let z = 0; z <= z1; z += 1) {
        for (let y = y0; y <= y1; y += 1) {
          for (let x = x0; x <= x1; x += 1) {
            this.solid[this.cellIndex(x, y, z)] = 1
          }
        }
      }
    }
  }

  resetDistributions(): void {
    const { ncell, windSpeed } = this
    const wind = this.windVector()
    const ux = wind.x * windSpeed
    const uy = wind.y * windSpeed
    const u2 = ux * ux + uy * uy
    for (let cell = 0; cell < ncell; cell += 1) {
      const base = cell * 19
      this.rho[cell] = 1
      this.ux[cell] = this.solid[cell] ? 0 : ux
      this.uy[cell] = this.solid[cell] ? 0 : uy
      this.uz[cell] = 0
      this.speed[cell] = this.solid[cell] ? 0 : Math.hypot(ux, uy)
      for (let i = 0; i < 19; i += 1) {
        const eu = D3Q19_EX[i] * ux + D3Q19_EY[i] * uy
        this.fIn[base + i] = this.solid[cell] ? D3Q19_W[i] : D3Q19_W[i] * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * u2)
      }
    }
    this.fOut.set(this.fIn)
    this.stepCount = 0
    this.maxSpeed = Math.hypot(ux, uy)
    this.avgSpeed = this.maxSpeed
    this.phi.fill(0)
    this.phiOut.fill(0)
    this.injectJet(this.phi)
    this.maxPhi = 1
  }

  reset(buildings: ObstacleBox[]): void {
    this.voxelize(buildings)
    this.resetDistributions()
  }

  step(): void {
    const { nx, ny, nz, ncell, tau, windSpeed, solid } = this
    const omega = 1 / tau
    const wind = this.windVector()
    const uxIn = wind.x * windSpeed
    const uyIn = wind.y * windSpeed
    const fx = uxIn * 0.012
    const fy = uyIn * 0.012
    const fIn = this.fIn
    const fOut = this.fOut
    const oneMinusHalfOmega = 1 - 0.5 * omega

    for (let cell = 0; cell < ncell; cell += 1) {
      if (solid[cell]) continue
      const base = cell * 19
      let rho = 0
      let mx = 0
      let my = 0
      let mz = 0
      for (let i = 0; i < 19; i += 1) {
        const fi = fIn[base + i]
        rho += fi
        mx += fi * D3Q19_EX[i]
        my += fi * D3Q19_EY[i]
        mz += fi * D3Q19_EZ[i]
      }
      if (rho < 1e-6) rho = 1
      const ux = (mx + 0.5 * fx) / rho
      const uy = (my + 0.5 * fy) / rho
      const uz = mz / rho
      let vx = ux
      let vy = uy
      let vz = uz
      let density = rho
      if (!Number.isFinite(density) || density < 0.2 || density > 4) density = 1
      if (!Number.isFinite(vx + vy + vz)) {
        vx = uxIn
        vy = uyIn
        vz = 0
      }
      const mag2 = vx * vx + vy * vy + vz * vz
      if (mag2 > 0.0144) {
        const scale = 0.12 / Math.sqrt(mag2)
        vx *= scale
        vy *= scale
        vz *= scale
      }
      const u2 = vx * vx + vy * vy + vz * vz
      const uF = vx * fx + vy * fy
      for (let i = 0; i < 19; i += 1) {
        const eu = D3Q19_EX[i] * vx + D3Q19_EY[i] * vy + D3Q19_EZ[i] * vz
        const feq = D3Q19_W[i] * density * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * u2)
        const eF = D3Q19_EX[i] * fx + D3Q19_EY[i] * fy
        const force = oneMinusHalfOmega * D3Q19_W[i] * (3 * eF + 9 * eu * eF - 3 * uF)
        const next = fIn[base + i] - omega * (fIn[base + i] - feq) + force
        fIn[base + i] = Number.isFinite(next) ? next : D3Q19_W[i] * density
      }
      this.rho[cell] = density
      this.ux[cell] = vx
      this.uy[cell] = vy
      this.uz[cell] = vz
    }

    for (let z = 0; z < nz; z += 1) {
      for (let y = 0; y < ny; y += 1) {
        for (let x = 0; x < nx; x += 1) {
          const cell = this.cellIndex(x, y, z)
          if (solid[cell]) continue
          const dest = cell * 19
          for (let i = 0; i < 19; i += 1) {
            const sx = x - D3Q19_EX[i]
            const sy = y - D3Q19_EY[i]
            const sz = z - D3Q19_EZ[i]
            if (sx < 0 || sx >= nx || sy < 0 || sy >= ny || sz < 0 || sz >= nz || solid[this.cellIndex(sx, sy, sz)]) {
              fOut[dest + i] = fIn[dest + D3Q19_OPP[i]]
            } else {
              fOut[dest + i] = fIn[this.cellIndex(sx, sy, sz) * 19 + i]
            }
          }
        }
      }
    }

    this.applyBoundaries(fOut, uxIn, uyIn)

    let maxSpeed = 0
    let sum = 0
    let count = 0
    for (let cell = 0; cell < ncell; cell += 1) {
      if (solid[cell]) {
        this.speed[cell] = 0
        continue
      }
      const mag = Math.hypot(this.ux[cell], this.uy[cell], this.uz[cell])
      if (!Number.isFinite(mag)) {
        this.ux[cell] = 0
        this.uy[cell] = 0
        this.uz[cell] = 0
        this.speed[cell] = 0
        continue
      }
      this.speed[cell] = mag
      if (mag > maxSpeed) maxSpeed = mag
      sum += mag
      count += 1
    }
    this.maxSpeed = Number.isFinite(maxSpeed) ? maxSpeed : 0
    this.avgSpeed = count && Number.isFinite(sum) ? sum / count : 0
    this.advectTracer()
    this.stepCount += 1

    const tmp = this.fIn
    this.fIn = this.fOut
    this.fOut = tmp
  }

  private applyBoundaries(f: Float32Array, uxIn: number, uyIn: number): void {
    const { nx, ny, nz, solid } = this
    const ax = Math.abs(uxIn)
    const ay = Math.abs(uyIn)
    const inletX = ax >= ay
    const low = inletX ? uxIn > 0 : uyIn > 0

    const writeEq = (x: number, y: number, z: number, ux: number, uy: number): void => {
      const cell = this.cellIndex(x, y, z)
      if (solid[cell]) return
      const u2 = ux * ux + uy * uy
      const base = cell * 19
      for (let i = 0; i < 19; i += 1) {
        const eu = D3Q19_EX[i] * ux + D3Q19_EY[i] * uy
        f[base + i] = D3Q19_W[i] * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * u2)
      }
      this.rho[cell] = 1
      this.ux[cell] = ux
      this.uy[cell] = uy
      this.uz[cell] = 0
    }

    const copyFrom = (x: number, y: number, z: number, sx: number, sy: number, sz: number): void => {
      const cell = this.cellIndex(x, y, z)
      const src = this.cellIndex(sx, sy, sz)
      if (solid[cell] || solid[src]) return
      f.copyWithin(cell * 19, src * 19, src * 19 + 19)
      this.rho[cell] = this.rho[src]
      this.ux[cell] = this.ux[src]
      this.uy[cell] = this.uy[src]
      this.uz[cell] = this.uz[src]
    }

    for (let z = 1; z < nz; z += 1) {
      for (let y = 0; y < ny; y += 1) {
        for (let x = 0; x < nx; x += 1) {
          if (inletX) {
            if (low && x === 0) writeEq(x, y, z, uxIn, uyIn)
            else if (low && x === nx - 1) copyFrom(x, y, z, nx - 2, y, z)
            else if (!low && x === nx - 1) writeEq(x, y, z, uxIn, uyIn)
            else if (!low && x === 0) copyFrom(x, y, z, 1, y, z)
          } else {
            if (low && y === 0) writeEq(x, y, z, uxIn, uyIn)
            else if (low && y === ny - 1) copyFrom(x, y, z, x, ny - 2, z)
            else if (!low && y === ny - 1) writeEq(x, y, z, uxIn, uyIn)
            else if (!low && y === 0) copyFrom(x, y, z, x, 1, z)
          }
        }
      }
    }
  }

  private jetWeight(cross: number, z: number, nCross: number): number {
    const cy = (cross + 0.5) / nCross - 0.5
    const cz = (z + 0.5) / this.nz - 0.42
    const r2 = (cy * cy) / (0.26 * 0.26) + (cz * cz) / (0.2 * 0.2)
    return Math.exp(-r2)
  }

  private injectJet(field: Float32Array): void {
    const { nx, ny, nz, solid } = this
    const wind = this.windVector()
    const inletX = Math.abs(wind.x) >= Math.abs(wind.y)
    const low = inletX ? wind.x > 0 : wind.y > 0
    const apply = (x: number, y: number, z: number, weight: number): void => {
      if (weight < 0.03) return
      const cell = this.cellIndex(x, y, z)
      if (solid[cell]) return
      if (weight > field[cell]) field[cell] = weight
    }
    for (let z = 1; z < nz; z += 1) {
      if (inletX) {
        const x0 = low ? 0 : nx - 1
        const x1 = low ? 1 : nx - 2
        for (let y = 0; y < ny; y += 1) {
          const w = this.jetWeight(y, z, ny)
          apply(x0, y, z, w)
          apply(x1, y, z, w * 0.92)
        }
      } else {
        const y0 = low ? 0 : ny - 1
        const y1 = low ? 1 : ny - 2
        for (let x = 0; x < nx; x += 1) {
          const w = this.jetWeight(x, z, nx)
          apply(x, y0, z, w)
          apply(x, y1, z, w * 0.92)
        }
      }
    }
  }

  private advectTracer(): void {
    const { nx, ny, nz, solid, ux, uy, uz, phi } = this
    const dst = this.phiOut
    const maxX = nx - 1.001
    const maxY = ny - 1.001
    const maxZ = nz - 1.001
    let maxPhi = 0
    for (let z = 0; z < nz; z += 1) {
      for (let y = 0; y < ny; y += 1) {
        for (let x = 0; x < nx; x += 1) {
          const cell = x + nx * (y + ny * z)
          if (solid[cell]) {
            dst[cell] = 0
            continue
          }
          const gx = x - ux[cell]
          const gy = y - uy[cell]
          const gz = z - uz[cell]
          if (!Number.isFinite(gx + gy + gz) || gx < 0 || gy < 0 || gz < 0 || gx > maxX || gy > maxY || gz > maxZ) {
            dst[cell] = 0
            continue
          }
          const x0 = gx | 0
          const y0 = gy | 0
          const z0 = gz | 0
          const tx = gx - x0
          const ty = gy - y0
          const tz = gz - z0
          const nxy = nx * ny
          const i000 = x0 + nx * y0 + nxy * z0
          const i100 = i000 + 1
          const i010 = i000 + nx
          const i110 = i000 + nx + 1
          const i001 = i000 + nxy
          const i101 = i100 + nxy
          const i011 = i010 + nxy
          const i111 = i110 + nxy
          const c00 = phi[i000] * (1 - tx) + phi[i100] * tx
          const c10 = phi[i010] * (1 - tx) + phi[i110] * tx
          const c01 = phi[i001] * (1 - tx) + phi[i101] * tx
          const c11 = phi[i011] * (1 - tx) + phi[i111] * tx
          const c0 = c00 * (1 - ty) + c10 * ty
          const c1 = c01 * (1 - ty) + c11 * ty
          const next = (c0 * (1 - tz) + c1 * tz) * 0.996
          const value = Number.isFinite(next) && next > 0 ? next : 0
          dst[cell] = value
          if (value > maxPhi) maxPhi = value
        }
      }
    }
    this.injectJet(dst)
    this.phiOut = phi
    this.phi = dst
    this.maxPhi = Number.isFinite(maxPhi) ? Math.max(maxPhi, 1) : 1
  }

  sliceSpeed(k: number): Float32Array {
    const z = Math.max(0, Math.min(this.nz - 1, k))
    const out = new Float32Array(this.nx * this.ny)
    for (let y = 0; y < this.ny; y += 1) {
      for (let x = 0; x < this.nx; x += 1) {
        out[y * this.nx + x] = this.speed[this.cellIndex(x, y, z)]
      }
    }
    return out
  }

  sample(px: number, py: number, pz: number): { ux: number; uy: number; uz: number; solid: boolean } {
    const gx = (px - this.originX) / this.dx - 0.5
    const gy = (py - this.originY) / this.dy - 0.5
    const gz = (pz - this.originZ) / this.dz - 0.5
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const z0 = Math.floor(gz)
    if (x0 < 0 || y0 < 0 || z0 < 0 || x0 >= this.nx - 1 || y0 >= this.ny - 1 || z0 >= this.nz - 1) {
      return { ux: 0, uy: 0, uz: 0, solid: true }
    }
    const i000 = this.cellIndex(x0, y0, z0)
    if (this.solid[i000]) return { ux: 0, uy: 0, uz: 0, solid: true }
    const tx = gx - x0
    const ty = gy - y0
    const tz = gz - z0
    const lerp = (field: Float32Array): number => {
      const c000 = field[this.cellIndex(x0, y0, z0)]
      const c100 = field[this.cellIndex(x0 + 1, y0, z0)]
      const c010 = field[this.cellIndex(x0, y0 + 1, z0)]
      const c110 = field[this.cellIndex(x0 + 1, y0 + 1, z0)]
      const c001 = field[this.cellIndex(x0, y0, z0 + 1)]
      const c101 = field[this.cellIndex(x0 + 1, y0, z0 + 1)]
      const c011 = field[this.cellIndex(x0, y0 + 1, z0 + 1)]
      const c111 = field[this.cellIndex(x0 + 1, y0 + 1, z0 + 1)]
      const c00 = c000 * (1 - tx) + c100 * tx
      const c10 = c010 * (1 - tx) + c110 * tx
      const c01 = c001 * (1 - tx) + c101 * tx
      const c11 = c011 * (1 - tx) + c111 * tx
      const c0 = c00 * (1 - ty) + c10 * ty
      const c1 = c01 * (1 - ty) + c11 * ty
      return c0 * (1 - tz) + c1 * tz
    }
    return { ux: lerp(this.ux), uy: lerp(this.uy), uz: lerp(this.uz), solid: false }
  }

  exportMacro(): { nx: number; ny: number; nz: number; rho: Float32Array; ux: Float32Array; uy: Float32Array; uz: Float32Array } {
    return {
      nx: this.nx,
      ny: this.ny,
      nz: this.nz,
      rho: this.rho.slice(),
      ux: this.ux.slice(),
      uy: this.uy.slice(),
      uz: this.uz.slice()
    }
  }
}
