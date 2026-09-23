/**
 * 北斗网格单元统计：把火场模拟网格（terrain.grid）按北斗层级聚合到每个网格单元，
 * 输出过火面积、过火占比、高程/坡度/坡向、到达时间、蔓延速率与可燃物构成等指标。
 *
 * 聚合采用「单次遍历模拟网格 + 分桶」策略，复杂度 O(网格格点数)，与北斗层级无关，
 * 因此可在推演过程中按较低频率实时刷新（供网格统计着色与单元查询使用）。
 */

import { FUEL_PROFILES, type FuelGrid } from './fuel'
import { beidouLevel, cellAt, enumerateCells, type AreaRect, type BeiDouCell } from './beidou'
import type { WildfireSimulation } from './model'
import type { TerrainGrid } from './terrain'
import { sampleElevation } from './terrain'

const DEG = Math.PI / 180

export type BeiDouCellStats = {
  cell: BeiDouCell
  gridCells: number
  burnedCells: number
  burningCells: number
  burnedAreaM2: number
  burnedRatio: number
  meanElevation: number
  meanSlope: number
  meanAspect: number
  arrivalMin: number
  arrivalMax: number
  meanRos: number
  maxRos: number
  dominantFuel: string
  dominantFuelKind: number
  waterPct: number
  roadPct: number
}

type Bucket = {
  gridCells: number
  burned: number
  burning: number
  elevSum: number
  slopeSum: number
  aspectSin: number
  aspectCos: number
  rosSum: number
  rosMax: number
  arrivalMin: number
  arrivalMax: number
  fuel: Int32Array
  water: number
  road: number
}

function newBucket(): Bucket {
  return {
    gridCells: 0,
    burned: 0,
    burning: 0,
    elevSum: 0,
    slopeSum: 0,
    aspectSin: 0,
    aspectCos: 0,
    rosSum: 0,
    rosMax: 0,
    arrivalMin: Infinity,
    arrivalMax: 0,
    fuel: new Int32Array(6),
    water: 0,
    road: 0
  }
}

function finalize(cell: BeiDouCell, bucket: Bucket, cellArea: number): BeiDouCellStats {
  const n = Math.max(bucket.gridCells, 1)
  let dominant = 5
  let top = -1
  for (let k = 0; k < bucket.fuel.length; k += 1) {
    if (bucket.fuel[k] > top) {
      top = bucket.fuel[k]
      dominant = k
    }
  }
  return {
    cell,
    gridCells: bucket.gridCells,
    burnedCells: bucket.burned,
    burningCells: bucket.burning,
    burnedAreaM2: (bucket.burned + bucket.burning) * cellArea,
    burnedRatio: (bucket.burned + bucket.burning) / n,
    meanElevation: bucket.elevSum / n,
    meanSlope: bucket.slopeSum / n,
    meanAspect: (((Math.atan2(bucket.aspectSin, bucket.aspectCos) / DEG) % 360) + 360) % 360,
    arrivalMin: Number.isFinite(bucket.arrivalMin) ? bucket.arrivalMin : Number.NaN,
    arrivalMax: bucket.arrivalMax,
    meanRos: bucket.rosSum / n,
    maxRos: bucket.rosMax,
    dominantFuel: FUEL_PROFILES[dominant]?.name ?? '—',
    dominantFuelKind: dominant,
    waterPct: (bucket.water / n) * 100,
    roadPct: (bucket.road / n) * 100
  }
}

function accumulate(
  bucket: Bucket,
  index: number,
  terrain: TerrainGrid,
  fuel: FuelGrid,
  phase: number,
  arrival: number,
  ros: number
): void {
  bucket.gridCells += 1
  bucket.elevSum += terrain.elevation[index]
  bucket.slopeSum += terrain.slope[index]
  const aspect = (terrain.upslope[index] + 180) % 360
  bucket.aspectSin += Math.sin(aspect * DEG)
  bucket.aspectCos += Math.cos(aspect * DEG)
  if (phase === 2) bucket.burned += 1
  else if (phase === 1) bucket.burning += 1
  if (phase > 0) {
    bucket.rosSum += ros
    if (ros > bucket.rosMax) bucket.rosMax = ros
    if (arrival < bucket.arrivalMin) bucket.arrivalMin = arrival
    if (arrival > bucket.arrivalMax) bucket.arrivalMax = arrival
  }
  const kind = fuel.kind[index]
  if (kind >= 0 && kind < bucket.fuel.length) bucket.fuel[kind] += 1
  if (fuel.water[index]) bucket.water += 1
  if (fuel.road[index]) bucket.road += 1
}

/** 单次遍历模拟网格，聚合出覆盖给定范围的全部北斗单元统计。 */
export function computeBeiDouStats(sim: WildfireSimulation, level: number, bounds: AreaRect): Map<string, BeiDouCellStats> {
  const terrain = sim.terrain
  const fuel = sim.fuel
  const { cols, rows, west, north, dLon, dLat, cellMeters } = terrain
  const spec = beidouLevel(level)
  const cellArea = cellMeters * cellMeters
  const buckets = new Map<string, Bucket>()

  for (let row = 0; row < rows; row += 1) {
    const lat = north - (row + 0.5) * dLat
    const brow = Math.floor(lat / spec.latDeg)
    for (let col = 0; col < cols; col += 1) {
      const lon = west + (col + 0.5) * dLon
      const bcol = Math.floor(lon / spec.lonDeg)
      const key = `${spec.level}:${brow}:${bcol}`
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = newBucket()
        buckets.set(key, bucket)
      }
      const index = row * cols + col
      accumulate(bucket, index, terrain, fuel, sim.phaseAt(index), sim.arrivalAt(index), sim.rosAt(index))
    }
  }

  const out = new Map<string, BeiDouCellStats>()
  for (const cell of enumerateCells(bounds, spec.level)) {
    const bucket = buckets.get(cell.key)
    out.set(cell.key, finalize(cell, bucket ?? newBucket(), cellArea))
  }
  return out
}

/** 仅统计单个北斗单元（用于点击查询，只扫描该单元覆盖的模拟网格）。 */
export function computeCellStats(sim: WildfireSimulation, lon: number, lat: number, level: number): BeiDouCellStats {
  const cell = cellAt(lon, lat, level)
  const terrain = sim.terrain
  const fuel = sim.fuel
  const { cols, rows, west, north, dLon, dLat, cellMeters } = terrain
  const cellArea = cellMeters * cellMeters
  const bucket = newBucket()

  const colMin = Math.max(0, Math.floor((cell.west - west) / dLon - 0.5))
  const colMax = Math.min(cols - 1, Math.ceil((cell.east - west) / dLon - 0.5))
  const rowMin = Math.max(0, Math.floor((north - cell.north) / dLat - 0.5))
  const rowMax = Math.min(rows - 1, Math.ceil((north - cell.south) / dLat - 0.5))
  for (let row = rowMin; row <= rowMax; row += 1) {
    for (let col = colMin; col <= colMax; col += 1) {
      const index = row * cols + col
      accumulate(bucket, index, terrain, fuel, sim.phaseAt(index), sim.arrivalAt(index), sim.rosAt(index))
    }
  }
  return finalize(cell, bucket, cellArea)
}

/** 单元几何中心的地形高程（用于面板展示）。 */
export function cellGroundElevation(sim: WildfireSimulation, cell: BeiDouCell): number {
  return sampleElevation(sim.terrain, cell.centerLon, cell.centerLat)
}
