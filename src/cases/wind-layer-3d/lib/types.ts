import type { Cartesian2 } from 'cesium'

export type ComponentArray = {
  array: Float32Array
  min?: number
  max?: number
}

export type WindData3D = {
  u: ComponentArray
  v: ComponentArray
  w: ComponentArray
  speed?: ComponentArray
  nx: number
  ny: number
  nz: number
  bounds: { west: number; south: number; east: number; north: number }
  levels: number[]
}

export type WindLayerOptions = {
  particlesTextureSize: number
  dropRate: number
  dropRateBump: number
  speedFactor: number
  lineWidth: { min: number; max: number }
  lineLength: { min: number; max: number }
  heightScale: number
  colors: string[]
  flipY: boolean
  useViewerBounds: boolean
  domain?: { min: number; max: number }
  displayRange?: { min: number; max: number }
  dynamic: boolean
}

export type ViewerParameters = {
  lonRange: Cartesian2
  latRange: Cartesian2
  pixelSize: number
  sceneMode: number
}
