export type SimulationMode = 'cinema' | 'interactive' | 'analysis' | 'calibration'

export interface ModeOption {
  value: SimulationMode
  label: string
  hint: string
}

export const SIMULATION_MODES: ModeOption[] = [
  { value: 'cinema', label: '影院演示', hint: '隐藏面板干扰，强调稳定镜头与结果叙事' },
  { value: 'interactive', label: '交互控制', hint: '参数实时作用于求解器，可暂停、单步与重置' },
  { value: 'analysis', label: '数据分析', hint: '显示求解器诊断、守恒账本与性能指标' },
  { value: 'calibration', label: '校核对照', hint: '显示模型结果与参考解的误差与容差' }
]

export interface CalibrationRow {
  metric: string
  simulated: number
  reference: number
  unit: string
  error: number
  tolerance: number
  pass: boolean
}

export interface ScenarioSimulation {
  readonly mode: SimulationMode
  setMode(mode: SimulationMode): void
  fixedStep(dt: number): void
  diagnostics(): Record<string, number | string>
  calibration(): CalibrationRow[]
  serialize(): Record<string, unknown>
  reset(seed?: number): void
}

export function calibrationRow(
  metric: string,
  simulated: number,
  reference: number,
  unit: string,
  tolerance: number
): CalibrationRow {
  const error = Math.abs(simulated - reference)
  return { metric, simulated, reference, unit, error, tolerance, pass: error <= tolerance }
}

export function deterministicRng(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 4294967296
  }
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

export function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
