import type * as THREE from 'three'
import type { CalibrationRow, SimulationMode } from './simulations/contract'

export type ParamValue = number | string | boolean
export type ParamValues = Record<string, ParamValue>
export type { CalibrationRow, SimulationMode }

export interface RangeParam {
  key: string
  label: string
  type: 'range'
  min: number
  max: number
  step: number
  value: number
  unit?: string
  tip?: string
}

export interface SelectOption {
  value: string
  label: string
}

export interface SelectParam {
  key: string
  label: string
  type: 'select'
  value: string
  options: SelectOption[]
  tip?: string
}

export interface ToggleParam {
  key: string
  label: string
  type: 'toggle'
  value: boolean
  tip?: string
}

export interface ColorParam {
  key: string
  label: string
  type: 'color'
  value: string
  tip?: string
}

export type ParamSpec = RangeParam | SelectParam | ToggleParam | ColorParam

export interface PanelAction {
  key: string
  label: string
  style?: 'primary' | 'accent' | 'danger'
}

export interface PanelSection {
  title: string
  params?: ParamSpec[]
  actions?: PanelAction[]
}

export interface MetricSpec {
  key: string
  label: string
  unit?: string
}

export interface LegendItem {
  color: string
  label: string
}

export interface CameraSpec {
  range: number
  pitch: number
  heading: number
  targetY?: number
}

export interface GeoAnchor {
  lon: number
  lat: number
  height: number
}

export interface SceneKit {
  root: THREE.Group
  accent: string
  focus: (target: THREE.Vector3, camera: Partial<CameraSpec>) => void
}

export interface ScenarioRuntime {
  object: THREE.Object3D
  update: (dt: number, params: ParamValues) => void
  fixedUpdate?: (dt: number, params: ParamValues) => void
  renderSync?: (alpha: number, params: ParamValues) => void
  setMode?: (mode: SimulationMode) => void
  diagnostics?: () => Record<string, number | string>
  calibration?: () => CalibrationRow[]
  sync?: (params: ParamValues) => void
  action?: (key: string, params: ParamValues) => void
  preset?: (key: string) => void
  readouts: () => Record<string, number | string>
  dispose: () => void
}

export interface ScenarioMeta {
  id: string
  title: string
  subtitle: string
  description: string
  tag: string
  updatedAt: string
  accent: string
  anchor: GeoAnchor
  camera: CameraSpec
  sections: PanelSection[]
  presets?: { key: string; label: string }[]
  metrics: MetricSpec[]
  legend?: LegendItem[]
  hint: string
  info: string[]
  create: (kit: SceneKit) => ScenarioRuntime
}

export function defaultValues(meta: ScenarioMeta): ParamValues {
  const values: ParamValues = {}
  for (const section of meta.sections) {
    for (const param of section.params ?? []) values[param.key] = param.value
  }
  return values
}

export function num(params: ParamValues, key: string, fallback = 0): number {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function text(params: ParamValues, key: string, fallback = ''): string {
  const value = params[key]
  return typeof value === 'string' ? value : fallback
}

export function flag(params: ParamValues, key: string, fallback = false): boolean {
  const value = params[key]
  return typeof value === 'boolean' ? value : fallback
}
