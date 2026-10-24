export type QualityPreset = 'auto' | 'high' | 'balanced' | 'performance'

export const QUALITY_PRESETS: Array<{ value: QualityPreset; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'high', label: '高画质' },
  { value: 'balanced', label: '均衡' },
  { value: 'performance', label: '性能优先' }
]

const FIXED_SCALE: Record<Exclude<QualityPreset, 'auto'>, number> = {
  high: 1,
  balanced: 0.7,
  performance: 0.45
}

export class QualityGovernor {
  private preset: QualityPreset
  private scaleValue: number
  private frameAverage = 1 / 60
  private timer = 0

  constructor(preset: QualityPreset = 'auto') {
    this.preset = preset
    this.scaleValue = preset === 'auto' ? 0.7 : FIXED_SCALE[preset]
  }

  get qualityPreset(): QualityPreset {
    return this.preset
  }

  get scale(): number {
    return this.scaleValue
  }

  setPreset(preset: QualityPreset): number {
    this.preset = preset
    if (preset !== 'auto') this.scaleValue = FIXED_SCALE[preset]
    return this.scaleValue
  }

  sample(realDt: number): number {
    if (this.preset !== 'auto' || realDt <= 0 || realDt > 2) return this.scaleValue
    this.frameAverage = this.frameAverage * 0.9 + realDt * 0.1
    this.timer += realDt
    if (this.timer < 0.9) return this.scaleValue
    this.timer = 0
    let next = this.scaleValue
    if (this.frameAverage > 1 / 15) next -= 0.15
    else if (this.frameAverage > 1 / 30) next -= 0.1
    else if (this.frameAverage < 1 / 58 && next < 1) next += 0.05
    this.scaleValue = Math.min(1, Math.max(0.45, next))
    return this.scaleValue
  }
}
