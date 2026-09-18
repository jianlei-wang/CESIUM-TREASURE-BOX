const G = 9.81
export const DRY_EPS = 1e-3
const CFL = 0.42

export type SweGrid = {
  nx: number
  ny: number
  dx: number
  dy: number
  west: number
  south: number
  east: number
  north: number
}

export type LonLat = { lon: number; lat: number }

export function makeGrid(west: number, south: number, east: number, north: number, nx: number, ny: number): SweGrid {
  const lat0 = ((south + north) / 2) * (Math.PI / 180)
  const R = 6371000
  const dy = (R * ((north - south) * Math.PI)) / 180 / ny
  const dx = (R * Math.cos(lat0) * ((east - west) * Math.PI)) / 180 / nx
  return { nx, ny, dx, dy, west, south, east, north }
}

export function cellCenter(grid: SweGrid, i: number, j: number): LonLat {
  return {
    lon: grid.west + ((i + 0.5) / grid.nx) * (grid.east - grid.west),
    lat: grid.south + ((j + 0.5) / grid.ny) * (grid.north - grid.south)
  }
}

export class SweSolver {
  readonly grid: SweGrid
  readonly zb: Float32Array
  h: Float32Array
  hu: Float32Array
  hv: Float32Array
  time = 0
  frictionAngleDeg = 12
  voellmyXi = 400
  maxSpeed = 0
  maxThickness = 0
  settledFrames = 0

  private readonly hStar: Float32Array
  private readonly huStar: Float32Array
  private readonly hvStar: Float32Array

  constructor(grid: SweGrid, zb: Float32Array) {
    this.grid = grid
    this.zb = zb
    const n = grid.nx * grid.ny
    this.h = new Float32Array(n)
    this.hu = new Float32Array(n)
    this.hv = new Float32Array(n)
    this.hStar = new Float32Array(n)
    this.huStar = new Float32Array(n)
    this.hvStar = new Float32Array(n)
  }

  setInitialHeight(h: Float32Array): void {
    this.h.set(h)
    this.hu.fill(0)
    this.hv.fill(0)
    this.time = 0
    this.settledFrames = 0
    this.refreshExtrema()
  }

  volume(): number {
    const { dx, dy } = this.grid
    let sum = 0
    for (let i = 0; i < this.h.length; i += 1) if (this.h[i] > DRY_EPS) sum += this.h[i]
    return sum * dx * dy
  }

  isSettled(): boolean {
    return this.settledFrames > 40
  }

  advance(duration: number, maxSubsteps = 10): void {
    let remain = Math.max(0, duration)
    let guard = 0
    while (remain > 1e-6 && guard < maxSubsteps) {
      const dt = this.step(remain)
      remain -= dt
      guard += 1
    }
  }

  step(maxDt: number): number {
    const { nx, ny, dx, dy } = this.grid
    const dt = Math.min(maxDt, this.computeDt())
    if (dt <= 0) return maxDt
    this.rkStage(this.h, this.hu, this.hv, this.hStar, this.huStar, this.hvStar, dt)
    this.h.set(this.hStar)
    this.hu.set(this.huStar)
    this.hv.set(this.hvStar)
    this.sanitize()
    this.applyFriction(dt)
    this.enforceDry()
    this.time += dt
    this.refreshExtrema()
    if (this.maxSpeed < 0.12) this.settledFrames += 1
    else this.settledFrames = 0
    return dt
  }

  private computeDt(): number {
    const { dx, dy } = this.grid
    let maxC = 1e-3
    for (let k = 0; k < this.h.length; k += 1) {
      const h = this.h[k]
      if (!Number.isFinite(h) || h <= DRY_EPS) continue
      const u = this.hu[k] / h
      const v = this.hv[k] / h
      if (!Number.isFinite(u) || !Number.isFinite(v)) continue
      const c = Math.sqrt(G * h)
      maxC = Math.max(maxC, Math.abs(u) + c, Math.abs(v) + c)
    }
    if (!Number.isFinite(maxC) || maxC <= 0) maxC = 1e-3
    return CFL * Math.min(dx, dy) / maxC
  }

  private rkStage(
    hIn: Float32Array,
    huIn: Float32Array,
    hvIn: Float32Array,
    hOut: Float32Array,
    huOut: Float32Array,
    hvOut: Float32Array,
    dt: number
  ): void {
    const { nx, ny, dx, dy } = this.grid
    const zb = this.zb
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const k = j * nx + i
        const h = hIn[k]
        if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) {
          hOut[k] = 0
          huOut[k] = 0
          hvOut[k] = 0
          continue
        }
        const fluxX = this.interfaceFlux(
          hIn[k],
          huIn[k],
          hvIn[k],
          zb[k],
          hIn[k + 1],
          huIn[k + 1],
          hvIn[k + 1],
          zb[k + 1],
          0
        )
        const fluxXm = this.interfaceFlux(
          hIn[k - 1],
          huIn[k - 1],
          hvIn[k - 1],
          zb[k - 1],
          h,
          huIn[k],
          hvIn[k],
          zb[k],
          0
        )
        const fluxY = this.interfaceFlux(
          h,
          hvIn[k],
          huIn[k],
          zb[k],
          hIn[k + nx],
          hvIn[k + nx],
          huIn[k + nx],
          zb[k + nx],
          1
        )
        const fluxYm = this.interfaceFlux(
          hIn[k - nx],
          hvIn[k - nx],
          huIn[k - nx],
          zb[k - nx],
          h,
          hvIn[k],
          huIn[k],
          zb[k],
          1
        )
        let hn = h - (dt / dx) * (fluxX.h - fluxXm.h) - (dt / dy) * (fluxY.h - fluxYm.h)
        let hun = huIn[k] - (dt / dx) * (fluxX.hu - fluxXm.hu) - (dt / dy) * (fluxY.hv - fluxYm.hv)
        let hvn = hvIn[k] - (dt / dy) * (fluxY.hu - fluxYm.hu) - (dt / dx) * (fluxX.hv - fluxXm.hv)
        if (hn < 0 || !Number.isFinite(hn) || !Number.isFinite(hun) || !Number.isFinite(hvn)) {
          hn = 0
          hun = 0
          hvn = 0
        }
        hOut[k] = hn
        huOut[k] = hun
        hvOut[k] = hvn
      }
    }
  }

  private interfaceFlux(
    hL: number,
    huL: number,
    hvL: number,
    zbL: number,
    hR: number,
    huR: number,
    hvR: number,
    zbR: number,
    axis: 0 | 1
  ): { h: number; hu: number; hv: number } {
    const zbMax = Math.max(zbL, zbR)
    const hsL = Math.max(hL + zbL - zbMax, 0)
    const hsR = Math.max(hR + zbR - zbMax, 0)
    const uL = hL > DRY_EPS ? huL / hL : 0
    const vL = hL > DRY_EPS ? hvL / hL : 0
    const uR = hR > DRY_EPS ? huR / hR : 0
    const vR = hR > DRY_EPS ? hvR / hR : 0
    const unL = axis === 0 ? uL : vL
    const unR = axis === 0 ? uR : vR
    const utL = axis === 0 ? vL : uL
    const utR = axis === 0 ? vR : uR
    const hunL = hsL * unL
    const hunR = hsR * unR
    const pL = 0.5 * G * hsL * hsL
    const pR = 0.5 * G * hsR * hsR
    const FL_h = hunL
    const FR_h = hunR
    const FL_hu = hunL * unL + pL
    const FR_hu = hunR * unR + pR
    const FL_hv = hunL * utL
    const FR_hv = hunR * utR
    const cL = Math.sqrt(G * hsL)
    const cR = Math.sqrt(G * hsR)
    const smax = Math.max(Math.abs(unL) + cL, Math.abs(unR) + cR, 1e-6)
    return {
      h: 0.5 * (FL_h + FR_h) - 0.5 * smax * (hsR - hsL),
      hu: 0.5 * (FL_hu + FR_hu) - 0.5 * smax * (hunR - hunL),
      hv: 0.5 * (FL_hv + FR_hv) - 0.5 * smax * (hsR * utR - hsL * utL)
    }
  }

  private applyFriction(dt: number): void {
    const tanD = Math.tan((this.frictionAngleDeg * Math.PI) / 180)
    const xi = Math.max(this.voellmyXi, 20)
    for (let k = 0; k < this.h.length; k += 1) {
      const h = this.h[k]
      if (h <= DRY_EPS) {
        this.hu[k] = 0
        this.hv[k] = 0
        continue
      }
      const u = this.hu[k] / h
      const v = this.hv[k] / h
      const speed = Math.hypot(u, v)
      if (!Number.isFinite(speed) || speed < 1e-6) {
        if (!Number.isFinite(speed)) {
          this.hu[k] = 0
          this.hv[k] = 0
        }
        continue
      }
      const coeff = G * tanD + (speed * speed) / (xi * h)
      const factor = 1 / (1 + (dt * coeff) / speed)
      this.hu[k] *= factor
      this.hv[k] *= factor
    }
  }

  private sanitize(): void {
    for (let k = 0; k < this.h.length; k += 1) {
      const h = this.h[k]
      if (!Number.isFinite(h) || h <= 0) {
        this.h[k] = 0
        this.hu[k] = 0
        this.hv[k] = 0
        continue
      }
      if (!Number.isFinite(this.hu[k])) this.hu[k] = 0
      if (!Number.isFinite(this.hv[k])) this.hv[k] = 0
    }
  }

  private enforceDry(): void {
    for (let k = 0; k < this.h.length; k += 1) {
      if (this.h[k] <= DRY_EPS) {
        this.h[k] = 0
        this.hu[k] = 0
        this.hv[k] = 0
      }
    }
  }

  private refreshExtrema(): void {
    let maxH = 0
    let maxV = 0
    for (let k = 0; k < this.h.length; k += 1) {
      const h = this.h[k]
      if (!Number.isFinite(h)) continue
      if (h > maxH) maxH = h
      if (h > DRY_EPS) {
        const speed = Math.hypot(this.hu[k], this.hv[k]) / h
        if (Number.isFinite(speed) && speed > maxV) maxV = speed
      }
    }
    this.maxThickness = maxH
    this.maxSpeed = maxV
  }
}
