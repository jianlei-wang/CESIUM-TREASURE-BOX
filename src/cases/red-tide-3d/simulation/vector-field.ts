import type { GridSpec } from '@rt/types/model'

export interface VelocitySample {
  u: number
  v: number
  w: number
}

export function velocityAt(
  ix: number,
  iy: number,
  iz: number,
  grid: GridSpec,
  timeSeconds = 0,
): VelocitySample {
  const x = ix / Math.max(grid.nx - 1, 1)
  const y = iy / Math.max(grid.ny - 1, 1)
  const z = iz / Math.max(grid.nz - 1, 1)
  const phase = timeSeconds / 3600

  // m/s：形成一个可重复、可控的演示流场；真实项目可直接替换为观测/数值模式场。
  const u = 0.22 + 0.35 * Math.sin(y * Math.PI * 2.0 + phase * 0.55) + 0.10 * Math.cos(z * Math.PI)
  const v = 0.10 + 0.28 * Math.cos(x * Math.PI * 2.0 - phase * 0.4) + 0.08 * Math.sin(z * Math.PI * 1.5)
  const w = 0.025 * Math.sin(x * Math.PI * 3.0 + y * Math.PI * 2.0 + phase)

  return { u, v, w }
}

export function velocityNormalized(
  ix: number,
  iy: number,
  iz: number,
  grid: GridSpec,
  timeSeconds = 0,
): VelocitySample {
  const metersPerCellX = grid.cellX
  const metersPerCellY = grid.cellY
  const metersPerCellZ = grid.cellZ
  const v = velocityAt(ix, iy, iz, grid, timeSeconds)
  return {
    u: v.u / metersPerCellX,
    v: v.v / metersPerCellY,
    w: v.w / metersPerCellZ,
  }
}
