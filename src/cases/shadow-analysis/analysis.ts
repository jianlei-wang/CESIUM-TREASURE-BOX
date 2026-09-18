/**
 * 阴影率分析：在设定的采样分析高度区间内，对各高度层的空间网格做建筑遮挡判定，
 * 统计每个空间点处于阴影的时间占比（阴影率）。
 *
 * 输入的时间步序列 steps 与城市模型 city 来自 sunshine-lib，遮挡判定复用其 slab 射线求交。
 * 输出统一为“阴影率”（0—1，越大表示被遮挡时间越长），便于地面色斑图与三维点云共用同一套配色。
 */

import type { CityModel } from '../sunshine-lib/city'
import {
  analyzeGridSunshineAsync,
  type AnalysisParams,
  type SunGrid,
  type SunTimeStep
} from '../sunshine-lib/analysis'

/** 空间体分析结果：网格几何 + 各高度层阴影率（按 (level, row, col) 排列） */
export type ShadowVolume = {
  grid: SunGrid
  levels: number[]
  /** 长度 = nx * ny * levels.length */
  rates: Float32Array
}

function totalMinutesOf(steps: SunTimeStep[], params: AnalysisParams): number {
  return steps.length * params.stepMinutes
}

function rateFromSunnyMinutes(sunnyMinutes: number, totalMinutes: number): number {
  if (totalMinutes <= 0) return 0
  return Math.max(0, Math.min(1, (totalMinutes - sunnyMinutes) / totalMinutes))
}

/** 将网格内的“日照时数”就地换算为该高度层的阴影率 */
export function gridToShadowRate(grid: SunGrid, totalMinutes: number): void {
  for (let index = 0; index < grid.heights.length; index += 1) {
    grid.heights[index] = rateFromSunnyMinutes(grid.heights[index] * 60, totalMinutes)
  }
  grid.minValue = 0
  grid.maxValue = 1
}

/**
 * 单高度层阴影率分析（对应高度结果图）。
 * 结果写入 grid.heights（0—1 阴影率），并可直接用于 buildGridSurface 渲染。
 */
export async function analyzeShadowSliceAsync(
  city: CityModel,
  grid: SunGrid,
  height: number,
  steps: SunTimeStep[],
  params: AnalysisParams,
  onProgress?: (ratio: number) => void
): Promise<void> {
  await analyzeGridSunshineAsync(city, grid, steps, { ...params, sampleHeight: height }, onProgress)
  gridToShadowRate(grid, totalMinutesOf(steps, params))
}

/**
 * 高度区间空间网格 / 点集分析。
 * 对区间内每个高度层复用同一套网格几何逐层计算，返回各层阴影率数组。
 */
export async function analyzeShadowVolumeAsync(
  city: CityModel,
  grid: SunGrid,
  levels: number[],
  steps: SunTimeStep[],
  params: AnalysisParams,
  onProgress?: (ratio: number) => void
): Promise<Float32Array> {
  const cellCount = grid.nx * grid.ny
  const rates = new Float32Array(cellCount * levels.length)
  const totalMinutes = totalMinutesOf(steps, params)
  for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
    await analyzeGridSunshineAsync(
      city,
      grid,
      steps,
      { ...params, sampleHeight: levels[levelIndex] },
      (ratio) => onProgress?.((levelIndex + ratio) / levels.length)
    )
    const offset = levelIndex * cellCount
    for (let index = 0; index < cellCount; index += 1) {
      rates[offset + index] = rateFromSunnyMinutes(grid.heights[index] * 60, totalMinutes)
    }
  }
  return rates
}
