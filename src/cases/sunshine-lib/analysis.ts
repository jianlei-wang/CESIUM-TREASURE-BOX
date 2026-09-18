/**
 * 定量日照分析：逐采样点、逐时刻进行光线投射遮挡检测，累计有效日照时长。
 */

import type { CityModel } from './city'
import { isOccludedByBuildings } from './city'
import type { SunContext } from './sun'
import { computeSunPosition, formatMinutes } from './sun'

export type AnalysisParams = {
  date: Date
  timezoneOffset: number
  /** 有效日照时间带起止（当地标准时间，分钟，自 0 点起） */
  startMinutes: number
  endMinutes: number
  stepMinutes: number
  /** 最大遮挡检测距离（米） */
  maxDistance: number
  /** 采样点离地高度（米） */
  sampleHeight: number
}

export type SunTimeStep = {
  minutes: number
  altitude: number
  azimuth: number
  direction: { east: number; north: number; up: number }
}

export type SunshineSegment = { start: number; end: number; hours: number }

export type SunshineSample = {
  minutes: number
  label: string
  altitude: number
  azimuth: number
  /** 该时刻是否被建筑遮挡（true=处于阴影） */
  occluded: boolean
  /** 太阳在地平线以下 */
  belowHorizon: boolean
}

export type PointSunshine = {
  hours: number
  first: number | null
  last: number | null
  segments: SunshineSegment[]
  samples: SunshineSample[]
}

/** 生成有效时间带内、太阳位于地平线以上的时刻序列 */
export function buildTimeSteps(ctx: SunContext, params: AnalysisParams): SunTimeStep[] {
  const steps: SunTimeStep[] = []
  const step = Math.max(1, params.stepMinutes)
  for (let minutes = params.startMinutes; minutes <= params.endMinutes; minutes += step) {
    const hour = Math.floor(minutes / 60)
    const minute = minutes % 60
    const date = new Date(
      params.date.getFullYear(),
      params.date.getMonth(),
      params.date.getDate(),
      hour,
      minute,
      0
    )
    const sun = computeSunPosition(date, ctx)
    if (sun.altitude <= 0) continue
    steps.push({ minutes, altitude: sun.altitude, azimuth: sun.azimuth, direction: sun.direction })
  }
  return steps
}

/** 单点全天日照分析 */
export function analyzePointSunshine(
  city: CityModel,
  x: number,
  y: number,
  steps: SunTimeStep[],
  params: AnalysisParams
): PointSunshine {
  const samples: SunshineSample[] = []
  const segments: SunshineSegment[] = []
  let totalMinutes = 0
  let first: number | null = null
  let last: number | null = null
  let segmentStart: number | null = null
  let segmentMinutes = 0

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    const occluded = isOccludedByBuildings(
      city,
      x,
      y,
      params.sampleHeight,
      step.direction,
      params.maxDistance
    )
    const sunny = !occluded
    if (sunny) {
      totalMinutes += params.stepMinutes
      if (first === null) first = step.minutes
      last = step.minutes
      if (segmentStart === null) segmentStart = step.minutes
      segmentMinutes += params.stepMinutes
    } else if (segmentStart !== null) {
      segments.push({
        start: segmentStart,
        end: segmentStart + segmentMinutes,
        hours: segmentMinutes / 60
      })
      segmentStart = null
      segmentMinutes = 0
    }
    samples.push({
      minutes: step.minutes,
      label: formatMinutes(step.minutes),
      altitude: step.altitude,
      azimuth: step.azimuth,
      occluded,
      belowHorizon: false
    })
  }

  if (segmentStart !== null) {
    segments.push({
      start: segmentStart,
      end: segmentStart + segmentMinutes,
      hours: segmentMinutes / 60
    })
  }

  return {
    hours: totalMinutes / 60,
    first,
    last,
    segments,
    samples
  }
}

export type SunGrid = {
  nx: number
  ny: number
  /** 网格西边界经度、北边界纬度（供等值线算法使用） */
  west: number
  north: number
  cellLon: number
  cellLat: number
  /** 局部 ENU 米范围 */
  minX: number
  maxX: number
  minY: number
  maxY: number
  /** 每个节点的日照时数（小时），位于场景外为 NaN */
  heights: Float32Array
  minValue: number
  maxValue: number
  insideCount: number
  spacing: number
}

export type GridOptions = {
  /** 网格间距（米） */
  spacing: number
  /** 分析范围（局部米）；缺省使用城市范围外扩边距 */
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** 生成规则采样网格（仅记录节点坐标与容器，数值稍后填充） */
export function createSunGrid(city: CityModel, options: GridOptions): SunGrid {
  const spacing = Math.max(2, options.spacing)
  const minX = options.minX
  const maxX = options.maxX
  const minY = options.minY
  const maxY = options.maxY
  const spanX = Math.max(spacing, maxX - minX)
  const spanY = Math.max(spacing, maxY - minY)
  const nx = Math.min(200, Math.max(2, Math.round(spanX / spacing) + 1))
  const ny = Math.min(200, Math.max(2, Math.round(spanY / spacing) + 1))
  const cellLon = (spanX / (nx - 1)) / city.metersPerDegLon
  const cellLat = -(spanY / (ny - 1)) / city.metersPerDegLat
  const west = city.center.lon + minX / city.metersPerDegLon
  const north = city.center.lat + maxY / city.metersPerDegLat
  return {
    nx,
    ny,
    west,
    north,
    cellLon,
    cellLat,
    minX,
    maxX,
    minY,
    maxY,
    heights: new Float32Array(nx * ny),
    minValue: 0,
    maxValue: 0,
    insideCount: 0,
    spacing
  }
}

/** 节点 (row, col) 的局部米坐标 */
export function gridNodeLocal(grid: SunGrid, row: number, col: number): { x: number; y: number } {
  const x = grid.minX + (col * (grid.maxX - grid.minX)) / (grid.nx - 1)
  const y = grid.maxY - (row * (grid.maxY - grid.minY)) / (grid.ny - 1)
  return { x, y }
}

/**
 * 对整个网格执行日照分析。为保持界面响应，按行分批计算并在批次间让出主线程。
 */
export async function analyzeGridSunshineAsync(
  city: CityModel,
  grid: SunGrid,
  steps: SunTimeStep[],
  params: AnalysisParams,
  onProgress?: (ratio: number) => void
): Promise<void> {
  let minValue = Number.POSITIVE_INFINITY
  let maxValue = Number.NEGATIVE_INFINITY
  let insideCount = 0
  const total = grid.ny

  for (let row = 0; row < grid.ny; row += 1) {
    for (let col = 0; col < grid.nx; col += 1) {
      const { x, y } = gridNodeLocal(grid, row, col)
      let minutes = 0
      for (const step of steps) {
        const occluded = isOccludedByBuildings(
          city,
          x,
          y,
          params.sampleHeight,
          step.direction,
          params.maxDistance
        )
        if (!occluded) minutes += params.stepMinutes
      }
      const hours = minutes / 60
      grid.heights[row * grid.nx + col] = hours
      if (hours < minValue) minValue = hours
      if (hours > maxValue) maxValue = hours
      insideCount += 1
    }
    onProgress?.((row + 1) / total)
    if (row % 4 === 0) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }

  grid.minValue = Number.isFinite(minValue) ? minValue : 0
  grid.maxValue = Number.isFinite(maxValue) ? maxValue : 0
  grid.insideCount = insideCount
}

/** 按需生成用于等值线算法的矩形环 */
export function rectRing(west: number, south: number, east: number, north: number): { lon: number; lat: number }[] {
  return [
    { lon: west, lat: south },
    { lon: east, lat: south },
    { lon: east, lat: north },
    { lon: west, lat: north }
  ]
}

/**
 * 不同建筑气候区的日照标准（《城市居住区规划设计标准》GB 50180-2018）。
 */
export type StandardDay = 'dahan' | 'dongzhi' | 'custom'

export type ClimateStandard = {
  id: string
  label: string
  standardHours: number
  standardDay: StandardDay
  /** 有效日照时间带（当地标准时间，分钟） */
  startMinutes: number
  endMinutes: number
}

export const CLIMATE_STANDARDS: ClimateStandard[] = [
  { id: 'I', label: 'Ⅰ区（哈尔滨等）', standardHours: 2, standardDay: 'dahan', startMinutes: 8 * 60, endMinutes: 16 * 60 },
  { id: 'II', label: 'Ⅱ区（北京等）', standardHours: 2, standardDay: 'dahan', startMinutes: 8 * 60, endMinutes: 16 * 60 },
  { id: 'III', label: 'Ⅲ区（上海等）', standardHours: 2, standardDay: 'dahan', startMinutes: 8 * 60, endMinutes: 16 * 60 },
  { id: 'IV', label: 'Ⅳ区（广州等）', standardHours: 1, standardDay: 'dongzhi', startMinutes: 9 * 60, endMinutes: 15 * 60 },
  { id: 'V', label: 'Ⅴ区（重庆等）', standardHours: 1, standardDay: 'dongzhi', startMinutes: 9 * 60, endMinutes: 15 * 60 },
  { id: 'VI', label: 'Ⅵ区（昆明等）', standardHours: 1, standardDay: 'dongzhi', startMinutes: 9 * 60, endMinutes: 15 * 60 },
  { id: 'VII', label: 'Ⅶ区（乌鲁木齐等）', standardHours: 2, standardDay: 'dahan', startMinutes: 8 * 60, endMinutes: 16 * 60 }
]

/** 返回给定年份的大寒日 / 冬至日（近似固定日期） */
export function standardDate(year: number, day: StandardDay): Date {
  if (day === 'dongzhi') return new Date(year, 11, 22)
  return new Date(year, 0, 20)
}
