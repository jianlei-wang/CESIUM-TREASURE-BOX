import type * as Cesium from 'cesium'

export interface StudyArea {
  id: string
  name: string
  center: {
    longitude: number
    latitude: number
    height: number
  }
  sizeX: number
  sizeY: number
  minDepth: number
  maxHeight: number
}

export interface GridSpec {
  nx: number
  ny: number
  nz: number
  sizeX: number
  sizeY: number
  depth: number
  surfaceHeight: number
  cellX: number
  cellY: number
  cellZ: number
}

export interface SimulationParameters {
  dtSeconds: number
  diffusion: number
  growthRate: number
  decayRate: number
  nutrient: number
  light: number
  temperature: number
  /** GPU 模式下的最大单次推进步数。 */
  maxStepsPerFrame?: number
}

export interface MonitoringStation {
  id: string
  name: string
  longitude: number
  latitude: number
  depth: number
  chlA: number
  temperature: number
  salinity: number
  dissolvedOxygen: number
  concentration: number
}

export interface StationViewModel extends MonitoringStation {
  entity?: Cesium.Entity
}

export type VolumeRenderMode = 'volume' | 'iso' | 'hybrid'
export type SectionAxis = 'x' | 'y'

export interface FieldStats {
  min: number
  max: number
  mean: number
  affectedAreaKm2: number
  affectedVolumeKm3: number
  affectedDepthM: number
  surfaceMax: number
}

export type SimulationComputeMode = 'gpu-gpgpu' | 'shared-array-buffer' | 'transferable'

export interface SimulationFrame {
  elapsedSeconds: number
  field8: Uint8Array
  surface8: Uint8Array
  particles: Float32Array
  particleIntensities: Float32Array
  stats: FieldStats
  computeMs: number
  steps: number
  version: number
}
