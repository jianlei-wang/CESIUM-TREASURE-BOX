/**
 * 分析计算层 —— 剖面、层结、统计、断面、T–S
 *
 * 所有结果都基于 OceanGridSampler 的实时采样，深度一律为真实米制。
 * 缺测点（NaN）在每一步都被显式排除，绝不参与统计或绘图。
 */

import { OCEAN_MIXED_LAYER, oceanVariableView } from '../ocean-tsd.config'
import type {
  OceanColumn,
  OceanSection,
  OceanStatistics,
  OceanStratification,
  OceanTSPoint,
  OceanVariable
} from '../ocean-tsd.types'
import type { OceanGridSampler, OceanStatisticsOptions } from '../data/OceanGridSampler'

export interface OceanProfile {
  lon: number
  lat: number
  seabedM: number
  unit: string
  variable: OceanVariable
  /** 各深度层取值（NaN 缺测） */
  depthM: number[]
  values: number[]
  /** 有效标记 */
  valid: boolean[]
}

/** 单点垂向剖面 */
export function computeProfile(
  sampler: OceanGridSampler,
  lon: number,
  lat: number,
  variable: OceanVariable
): OceanProfile {
  const column = sampler.columnAt(lon, lat)
  const values = sampler.columnValues(column, variable)
  const valid = values.map((v) => Number.isFinite(v))
  return {
    lon,
    lat,
    seabedM: column.seabedM,
    unit: oceanVariableView(variable).unit,
    variable,
    depthM: column.depthM,
    values,
    valid
  }
}

/**
 * 层结分析：按真实深度计算垂向梯度峰值（跃层）与混合层深度。
 * 温度 / 密度使用温差 / 密度差判据确定混合层；盐度与流速仅报告梯度峰值。
 */
export function computeStratification(column: OceanColumn, variable: OceanVariable, sampler: OceanGridSampler): OceanStratification {
  const values = sampler.columnValues(column, variable)
  const depth = column.depthM
  let gradientMax = 0
  let peakDepth: number | null = null
  let intervalSum = 0
  let intervalCount = 0
  for (let z = 0; z < depth.length - 1; z += 1) {
    const v0 = values[z]
    const v1 = values[z + 1]
    const dz = depth[z + 1] - depth[z]
    if (dz > 0) {
      intervalSum += dz
      intervalCount += 1
    }
    if (!Number.isFinite(v0) || !Number.isFinite(v1) || dz <= 0) continue
    const grad = Math.abs((v1 - v0) / dz)
    if (grad > gradientMax) {
      gradientMax = grad
      peakDepth = (depth[z] + depth[z + 1]) / 2
    }
  }

  let mixingLayerDepthM: number | null = null
  if (variable === 'temperature' || variable === 'density') {
    const surface = values.find((v) => Number.isFinite(v))
    const threshold = variable === 'temperature' ? OCEAN_MIXED_LAYER.temperatureDelta : OCEAN_MIXED_LAYER.densityDelta
    if (surface !== undefined) {
      for (let z = 1; z < depth.length; z += 1) {
        const v = values[z]
        if (!Number.isFinite(v)) break
        if (Math.abs(v - surface) > threshold) {
          mixingLayerDepthM = depth[z]
          break
        }
      }
    }
  }

  return {
    variable,
    gradientPeakDepthM: peakDepth,
    gradientMax,
    mixingLayerDepthM,
    meanSampleIntervalM: intervalCount ? intervalSum / intervalCount : 0,
    method:
      variable === 'temperature'
        ? '跃层取 |dT/dz| 峰值；混合层取距表层温差超过 0.2°C 的首层'
        : variable === 'density'
          ? '跃层取 |dσt/dz| 峰值；混合层取距表层密度差超过 0.03 kg/m³ 的首层'
          : '跃层取垂向梯度绝对值峰值，无混合层判据'
  }
}

/** 区域 / 深度层统计 */
export function computeStatistics(
  sampler: OceanGridSampler,
  variable: OceanVariable,
  options: OceanStatisticsOptions = {}
): OceanStatistics {
  const view = oceanVariableView(variable)
  const stats = sampler.statistics(variable, options)
  return {
    variable,
    unit: view.unit,
    ...stats
  }
}

/** A–B 断面 */
export function computeSection(
  sampler: OceanGridSampler,
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
  variable: OceanVariable
): OceanSection {
  return sampler.section(a, b, variable, Math.max(sampler.nx, sampler.ny))
}

/** 单点 T–S 散点 */
export function computeTsPoints(sampler: OceanGridSampler, lon: number, lat: number): OceanTSPoint[] {
  return sampler.tsPoints(lon, lat)
}

export type { OceanStatisticsOptions }
