import { Event, JulianDate, type MaterialProperty } from 'cesium'

export type WaterUniforms = {
  time: number
  waveSpeed: number
  waveScale: number
  waveHeight: number
  clarity: number
}

export class DynamicWaterMaterialProperty implements MaterialProperty {
  readonly isConstant = false
  readonly definitionChanged = new Event()

  constructor(private readonly uniforms: WaterUniforms) {}

  getType(_time: JulianDate): string {
    return 'DynamicPolygonWater'
  }

  getValue(_time: JulianDate, result: Record<string, number> = {}): Record<string, number> {
    result.time = this.uniforms.time
    result.waveSpeed = this.uniforms.waveSpeed
    result.waveScale = this.uniforms.waveScale
    result.waveHeight = this.uniforms.waveHeight
    result.clarity = this.uniforms.clarity
    return result
  }

  equals(other?: MaterialProperty): boolean {
    return other === this
  }
}
