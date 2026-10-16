/**
 * 网格采样与分析访问器
 *
 * 把静态体 + 单月数据块封装为可查询对象：水平双线性、垂向按真实深度插值、
 * 剖面 / 断面 / 统计 / T-S 均基于此实现。所有查询对越界、掩膜外、缺测一律返回 NaN，
 * 由上层决定缺测语义，绝不把缺测当 0。
 */

import { sigmaT } from './ocean-eos'
import type { OceanDatasetStatic, OceanFrameData } from './OceanDatasetLoader'
import type {
  OceanColumn,
  OceanSection,
  OceanStoredVariable,
  OceanTSPoint,
  OceanVariable
} from '../ocean-tsd.types'

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export interface OceanStatisticsOptions {
  depthRangeM?: [number, number]
  box?: { west: number; south: number; east: number; north: number }
}

export interface OceanHistogram {
  edges: number[]
  counts: number[]
}

export class OceanGridSampler {
  readonly nx: number
  readonly ny: number
  readonly nz: number
  readonly maxLevelDepthM: number
  readonly seabedMinM: number
  readonly seabedMaxM: number

  constructor(
    readonly staticData: OceanDatasetStatic,
    public frame: OceanFrameData
  ) {
    this.nx = staticData.manifest.grid.nx
    this.ny = staticData.manifest.grid.ny
    this.nz = staticData.manifest.grid.nz
    this.maxLevelDepthM = staticData.depths[this.nz - 1]
    let min = Infinity
    let max = -Infinity
    for (const d of staticData.bathymetry) {
      if (d < min) min = d
      if (d > max) max = d
    }
    this.seabedMinM = min
    this.seabedMaxM = max
  }

  lonToFrac(lon: number): number {
    const { lons } = this.staticData
    return ((lon - lons[0]) / (lons[this.nx - 1] - lons[0])) * (this.nx - 1)
  }

  latToFrac(lat: number): number {
    const { lats } = this.staticData
    return ((lat - lats[0]) / (lats[this.ny - 1] - lats[0])) * (this.ny - 1)
  }

  /** 由真实深度求垂向分数索引（非均匀层，线性查表） */
  depthToFrac(depthM: number): number {
    const { depths } = this.staticData
    if (depthM <= depths[0]) return 0
    if (depthM >= depths[this.nz - 1]) return this.nz - 1
    for (let z = 0; z < this.nz - 1; z += 1) {
      const d0 = depths[z]
      const d1 = depths[z + 1]
      if (depthM >= d0 && depthM <= d1) {
        return z + (d1 === d0 ? 0 : (depthM - d0) / (d1 - d0))
      }
    }
    return this.nz - 1
  }

  /** 水平双线性（某一固定层），任一角缺测则返回 NaN */
  private bilinearAtLevel(values: Float32Array, fx: number, fy: number, z: number): number {
    const { nx, ny } = this
    const x0 = clamp(Math.floor(fx), 0, nx - 1)
    const x1 = Math.min(x0 + 1, nx - 1)
    const y0 = clamp(Math.floor(fy), 0, ny - 1)
    const y1 = Math.min(y0 + 1, ny - 1)
    const tx = fx - x0
    const ty = fy - y0
    const v00 = values[x0 + nx * (y0 + ny * z)]
    const v10 = values[x1 + nx * (y0 + ny * z)]
    const v01 = values[x0 + nx * (y1 + ny * z)]
    const v11 = values[x1 + nx * (y1 + ny * z)]
    if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v01) || !Number.isFinite(v11)) {
      return NaN
    }
    const bottom = v00 + (v10 - v00) * tx
    const top = v01 + (v11 - v01) * tx
    return bottom + (top - bottom) * ty
  }

  /** 取某一存储变量在任意 (lon,lat,depth) 的值 */
  storedAt(variable: OceanStoredVariable, lon: number, lat: number, depthM: number): number {
    const fx = this.lonToFrac(lon)
    const fy = this.latToFrac(lat)
    if (fx < 0 || fx > this.nx - 1 || fy < 0 || fy > this.ny - 1) return NaN
    const fz = this.depthToFrac(depthM)
    const z0 = clamp(Math.floor(fz), 0, this.nz - 1)
    const z1 = Math.min(z0 + 1, this.nz - 1)
    const tz = fz - z0
    const values = this.frame.values[variable]
    const a = this.bilinearAtLevel(values, fx, fy, z0)
    const b = this.bilinearAtLevel(values, fx, fy, z1)
    if (Number.isFinite(a) && Number.isFinite(b)) return a + (b - a) * tz
    if (Number.isFinite(a)) return a
    if (Number.isFinite(b)) return b
    return NaN
  }

  /** 海底深度（正值向下），任一角缺测返回 NaN */
  seabedAt(lon: number, lat: number): number {
    const fx = this.lonToFrac(lon)
    const fy = this.latToFrac(lat)
    if (fx < 0 || fx > this.nx - 1 || fy < 0 || fy > this.ny - 1) return NaN
    const { nx, ny } = this
    const x0 = clamp(Math.floor(fx), 0, nx - 1)
    const x1 = Math.min(x0 + 1, nx - 1)
    const y0 = clamp(Math.floor(fy), 0, ny - 1)
    const y1 = Math.min(y0 + 1, ny - 1)
    const tx = fx - x0
    const ty = fy - y0
    const g = this.staticData.bathymetry
    const v00 = g[x0 + nx * y0]
    const v10 = g[x1 + nx * y0]
    const v01 = g[x0 + nx * y1]
    const v11 = g[x1 + nx * y1]
    const bottom = v00 + (v10 - v00) * tx
    const top = v01 + (v11 - v01) * tx
    return bottom + (top - bottom) * ty
  }

  /** 单点垂向剖面 */
  columnAt(lon: number, lat: number): OceanColumn {
    const { depths } = this.staticData
    const fx = this.lonToFrac(lon)
    const fy = this.latToFrac(lat)
    const seabedM = this.seabedAt(lon, lat)
    const n = this.nz
    const depthM = Array.from(depths)
    const temperature = new Array<number>(n)
    const salinity = new Array<number>(n)
    const density = new Array<number>(n)
    const u = new Array<number>(n)
    const v = new Array<number>(n)
    const valid = new Array<boolean>(n)
    const inside = fx >= 0 && fx <= this.nx - 1 && fy >= 0 && fy <= this.ny - 1

    for (let z = 0; z < n; z += 1) {
      let t = NaN
      let s = NaN
      let uu = NaN
      let vv = NaN
      if (inside) {
        t = this.bilinearAtLevel(this.frame.values.temperature, fx, fy, z)
        s = this.bilinearAtLevel(this.frame.values.salinity, fx, fy, z)
        uu = this.bilinearAtLevel(this.frame.values.u, fx, fy, z)
        vv = this.bilinearAtLevel(this.frame.values.v, fx, fy, z)
      }
      temperature[z] = t
      salinity[z] = s
      u[z] = uu
      v[z] = vv
      const ok = Number.isFinite(t) && Number.isFinite(s)
      density[z] = ok ? sigmaT(t, s) : NaN
      valid[z] = ok
    }

    return {
      lon,
      lat,
      seabedM,
      maxLevelDepthM: this.maxLevelDepthM,
      depthM,
      temperature,
      salinity,
      density,
      u,
      v,
      valid
    }
  }

  /** 由剖面取出目标变量的数组（含派生变量） */
  columnValues(column: OceanColumn, variable: OceanVariable): number[] {
    switch (variable) {
      case 'temperature':
        return column.temperature
      case 'salinity':
        return column.salinity
      case 'density':
        return column.density
      case 'currentSpeed':
        return column.u.map((uu, i) => {
          const vv = column.v[i]
          return Number.isFinite(uu) && Number.isFinite(vv) ? Math.hypot(uu, vv) : NaN
        })
    }
  }

  /** 派生物理量在任意点的取值 */
  variableAt(variable: OceanVariable, lon: number, lat: number, depthM: number): number {
    switch (variable) {
      case 'temperature':
        return this.storedAt('temperature', lon, lat, depthM)
      case 'salinity':
        return this.storedAt('salinity', lon, lat, depthM)
      case 'density': {
        const t = this.storedAt('temperature', lon, lat, depthM)
        const s = this.storedAt('salinity', lon, lat, depthM)
        return Number.isFinite(t) && Number.isFinite(s) ? sigmaT(t, s) : NaN
      }
      case 'currentSpeed': {
        const u = this.storedAt('u', lon, lat, depthM)
        const v = this.storedAt('v', lon, lat, depthM)
        return Number.isFinite(u) && Number.isFinite(v) ? Math.hypot(u, v) : NaN
      }
    }
  }

  /** 构建可供渲染的完整三维场（派生变量已展开为逐体素） */
  buildField(variable: OceanVariable): Float32Array {
    const planar = this.nx * this.ny * this.nz
    const out = new Float32Array(planar)
    if (variable === 'density') {
      const t = this.frame.values.temperature
      const s = this.frame.values.salinity
      for (let i = 0; i < planar; i += 1) {
        out[i] = Number.isFinite(t[i]) && Number.isFinite(s[i]) ? sigmaT(t[i], s[i]) : NaN
      }
      return out
    }
    if (variable === 'currentSpeed') {
      const u = this.frame.values.u
      const v = this.frame.values.v
      for (let i = 0; i < planar; i += 1) {
        out[i] = Number.isFinite(u[i]) && Number.isFinite(v[i]) ? Math.hypot(u[i], v[i]) : NaN
      }
      return out
    }
    out.set(this.frame.values[variable])
    return out
  }

  /** 在 [最浅, 最深] 之间生成等间距深度层，使渲染层索引与真实深度线性对应 */
  uniformDepths(count: number): number[] {
    const { depths } = this.staticData
    const min = depths[0]
    const max = depths[this.nz - 1]
    if (count <= 1) return [min]
    return Array.from({ length: count }, (_, i) => min + ((max - min) * i) / (count - 1))
  }

  /**
   * 把原生（非均匀）深度层场垂向重采样到等间距深度层。
   * 目标深度落在两个原生层之间时线性插值；任一端缺测则返回缺测。
   */
  resampleVertical(nativeField: Float32Array, targetDepths: number[]): Float32Array {
    const { nx, ny, nz } = this
    const stride = nx * ny
    const nzU = targetDepths.length
    const frac = targetDepths.map((d) => this.depthToFrac(d))
    const out = new Float32Array(stride * nzU)
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const colBase = x + nx * y
        for (let k = 0; k < nzU; k += 1) {
          const fz = frac[k]
          const z0 = Math.min(nz - 1, Math.floor(fz))
          const z1 = Math.min(z0 + 1, nz - 1)
          const tz = fz - z0
          const a = nativeField[colBase + stride * z0]
          const b = nativeField[colBase + stride * z1]
          let value: number
          if (Number.isFinite(a) && Number.isFinite(b)) value = a + (b - a) * tz
          else if (Number.isFinite(a)) value = a
          else if (Number.isFinite(b)) value = b
          else value = NaN
          out[colBase + stride * k] = value
        }
      }
    }
    return out
  }

  /** 构建等深度层的渲染场（派生变量已展开） */
  buildUniformField(variable: OceanVariable, targetDepths: number[]): Float32Array {
    return this.resampleVertical(this.buildField(variable), targetDepths)
  }

  /** 区域 / 深度层统计（仅有效海水体素） */
  statistics(variable: OceanVariable, options: OceanStatisticsOptions = {}): {
    min: number
    max: number
    mean: number
    median: number
    p10: number
    p90: number
    count: number
    invalidCount: number
    depthRangeM: [number, number]
  } {
    const field = this.buildField(variable)
    const { nx, ny, nz } = this
    const { lons, lats, depths } = this.staticData
    const depthRange = options.depthRangeM ?? [depths[0], depths[nz - 1]]
    const box = options.box
    const samples: number[] = []
    let invalidCount = 0
    for (let z = 0; z < nz; z += 1) {
      if (depths[z] < depthRange[0] || depths[z] > depthRange[1]) continue
      for (let y = 0; y < ny; y += 1) {
        if (box && (lats[y] < box.south || lats[y] > box.north)) continue
        for (let x = 0; x < nx; x += 1) {
          if (box && (lons[x] < box.west || lons[x] > box.east)) continue
          const value = field[x + nx * (y + ny * z)]
          if (Number.isFinite(value)) samples.push(value)
          else invalidCount += 1
        }
      }
    }
    samples.sort((a, b) => a - b)
    const count = samples.length
    if (count === 0) {
      return {
        min: NaN,
        max: NaN,
        mean: NaN,
        median: NaN,
        p10: NaN,
        p90: NaN,
        count: 0,
        invalidCount,
        depthRangeM: [depthRange[0], depthRange[1]]
      }
    }
    let sum = 0
    for (const value of samples) sum += value
    const percentile = (p: number): number => {
      const idx = (p / 100) * (count - 1)
      const lo = Math.floor(idx)
      const hi = Math.min(lo + 1, count - 1)
      return samples[lo] + (samples[hi] - samples[lo]) * (idx - lo)
    }
    return {
      min: samples[0],
      max: samples[count - 1],
      mean: sum / count,
      median: percentile(50),
      p10: percentile(10),
      p90: percentile(90),
      count,
      invalidCount,
      depthRangeM: [depthRange[0], depthRange[1]]
    }
  }

  /** 直方图（用于分布展示） */
  histogram(variable: OceanVariable, bins: number, options: OceanStatisticsOptions = {}): OceanHistogram {
    const stats = this.statistics(variable, options)
    if (!Number.isFinite(stats.min)) return { edges: [], counts: [] }
    const min = stats.min
    const max = stats.max
    const span = max - min || 1
    const edges = Array.from({ length: bins + 1 }, (_, i) => min + (span * i) / bins)
    const counts = new Array<number>(bins).fill(0)
    const field = this.buildField(variable)
    const { nx, ny, nz } = this
    const { lons, lats, depths } = this.staticData
    const depthRange = options.depthRangeM ?? [depths[0], depths[nz - 1]]
    const box = options.box
    for (let z = 0; z < nz; z += 1) {
      if (depths[z] < depthRange[0] || depths[z] > depthRange[1]) continue
      for (let y = 0; y < ny; y += 1) {
        if (box && (lats[y] < box.south || lats[y] > box.north)) continue
        for (let x = 0; x < nx; x += 1) {
          if (box && (lons[x] < box.west || lons[x] > box.east)) continue
          const value = field[x + nx * (y + ny * z)]
          if (!Number.isFinite(value)) continue
          const idx = clamp(Math.floor(((value - min) / span) * bins), 0, bins - 1)
          counts[idx] += 1
        }
      }
    }
    return { edges, counts }
  }

  /** A–B 断面（距离 × 深度） */
  section(
    a: { lon: number; lat: number },
    b: { lon: number; lat: number },
    variable: OceanVariable,
    samples: number
  ): OceanSection {
    const n = Math.max(2, samples)
    const { depths } = this.staticData
    const lons: number[] = []
    const lats: number[] = []
    const distanceKm: number[] = []
    const seabedM: number[] = []
    const values: number[][] = []
    let cumulative = 0
    let prevLon = a.lon
    let prevLat = a.lat
    for (let i = 0; i < n; i += 1) {
      const t = i / (n - 1)
      const lon = a.lon + (b.lon - a.lon) * t
      const lat = a.lat + (b.lat - a.lat) * t
      if (i > 0) cumulative += haversineKm(prevLon, prevLat, lon, lat)
      prevLon = lon
      prevLat = lat
      lons.push(lon)
      lats.push(lat)
      distanceKm.push(cumulative)
      seabedM.push(this.seabedAt(lon, lat))
      const column = this.columnAt(lon, lat)
      const col = this.columnValues(column, variable)
      values.push(col.map((value, z) => (this.staticData.depths[z] <= seabedM[i] ? value : NaN)))
    }
    return {
      a: { ...a },
      b: { ...b },
      variable,
      lons,
      lats,
      distanceKm,
      seabedM,
      depthM: Array.from(depths),
      values
    }
  }

  /** T–S 散点（单点全剖面） */
  tsPoints(lon: number, lat: number): OceanTSPoint[] {
    const column = this.columnAt(lon, lat)
    const points: OceanTSPoint[] = []
    for (let z = 0; z < this.nz; z += 1) {
      const ok = column.valid[z]
      points.push({
        temperatureC: column.temperature[z],
        salinity: column.salinity[z],
        densityKgM3: column.density[z],
        depthM: column.depthM[z],
        valid: ok
      })
    }
    return points
  }

  /** 在多条站位上聚合 T–S 点云 */
  tsCloud(stations: Array<{ lon: number; lat: number }>): OceanTSPoint[] {
    const points: OceanTSPoint[] = []
    for (const station of stations) {
      points.push(...this.tsPoints(station.lon, station.lat))
    }
    return points
  }
}
