import { computeSpeedFromComponents } from './utils'
import type { WindData3D } from './types'

export type GenerateWindDataOptions = {
  west: number
  south: number
  east: number
  north: number
  nx: number
  ny: number
  nz: number
  levels: number[]
}

const DEFAULT_LEVELS = [500, 1500, 3000, 5500, 8000, 12000]

function generateSyntheticField(options: GenerateWindDataOptions): WindData3D {
  const { west, south, east, north, nx, ny, nz } = options
  const total = nx * ny * nz

  const u = new Float32Array(total)
  const v = new Float32Array(total)
  const w = new Float32Array(total)

  const lonSpan = east - west
  const latSpan = north - south

  const uOffset = Math.random() * Math.PI * 2
  const vOffset = Math.random() * Math.PI * 2

  for (let z = 0; z < nz; z++) {
    const zNorm = z / (nz - 1 || 1)
    for (let y = 0; y < ny; y++) {
      const latNorm = y / (ny - 1 || 1)
      const lat = south + latNorm * latSpan
      for (let x = 0; x < nx; x++) {
        const lonNorm = x / (nx - 1 || 1)
        const lon = west + lonNorm * lonSpan
        const index = (z * ny + y) * nx + x

        const gx = lonNorm * 6.0 + uOffset
        const gy = latNorm * 5.0 + vOffset

        const windU = 6.0 + 4.0 * Math.sin(gx * 1.1) * Math.cos(gy * 0.8)
        const windV = 2.0 * Math.cos(gx * 0.9) * Math.sin(gy * 1.2)
        const windW = 0.35 * Math.sin(gx * 2.3 + gy * 1.7) + 0.15 * (zNorm - 0.5)

        const zFactor = 0.75 + 0.35 * zNorm

        u[index] = windU * zFactor
        v[index] = windV * zFactor
        w[index] = windW * (1.0 + zNorm * 0.8)
      }
    }
  }

  return {
    u: { array: u },
    v: { array: v },
    w: { array: w },
    nx,
    ny,
    nz,
    bounds: { west, south, east, north },
    levels: options.levels
  }
}

export function generateWindData3D(options: GenerateWindDataOptions): WindData3D {
  const { west, south, east, north, nx, ny, nz } = options
  if (!(nx > 0 && ny > 0 && nz > 0)) throw new Error('网格尺寸必须大于 0')
  if (!(east > west && north > south)) throw new Error('四至范围非法：东应大于西，北应大于南')
  if (options.levels.length !== nz) {
    throw new Error(`层级数需与 nz 一致，期望 ${nz} 层`)
  }

  const data = generateSyntheticField(options)
  const speed = computeSpeedFromComponents(data.u.array, data.v.array, data.w.array)
  data.speed = speed
  return data
}

export function serializeWindData3D(data: WindData3D): string {
  return JSON.stringify({
    u: { array: Array.from(data.u.array) },
    v: { array: Array.from(data.v.array) },
    w: { array: Array.from(data.w.array) },
    nx: data.nx,
    ny: data.ny,
    nz: data.nz,
    bounds: data.bounds,
    levels: data.levels
  })
}

export function downloadWindData3D(data: WindData3D, filename = 'wind_3d.json'): void {
  const json = serializeWindData3D(data)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function normalizeWindData(raw: {
  u: { array: number[] }
  v: { array: number[] }
  w: { array: number[] }
  nx: number
  ny: number
  nz: number
  bounds: { west: number; south: number; east: number; north: number }
  levels: number[]
}): WindData3D {
  return {
    u: { array: new Float32Array(raw.u.array) },
    v: { array: new Float32Array(raw.v.array) },
    w: { array: new Float32Array(raw.w.array) },
    nx: raw.nx,
    ny: raw.ny,
    nz: raw.nz,
    bounds: raw.bounds,
    levels: raw.levels
  }
}

export { DEFAULT_LEVELS }
