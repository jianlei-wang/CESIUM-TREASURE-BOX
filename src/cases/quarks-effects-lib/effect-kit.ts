import * as THREE from 'three'
import {
  Bezier,
  Gradient,
  PiecewiseBezier,
  SizeOverLife,
  Vector3 as QVector3,
  Vector4 as QVector4
} from 'three.quarks'
import type { ParticleSystem } from 'three.quarks'
import type { EffectTextures } from './textures'

export type ParamKind = 'number' | 'color' | 'boolean' | 'select'

export interface ParamDef {
  key: string
  label: string
  kind: ParamKind
  min?: number
  max?: number
  step?: number
  unit?: string
  default: number | string | boolean
  options?: Array<{ label: string; value: string }>
}

export interface EffectMeta {
  id: string
  title: string
  subtitle: string
  description: string
  params: ParamDef[]
  /** 这些参数变化会导致粒子系统结构变化，需要整体重建；其余参数支持实时更新 */
  rebuildKeys?: string[]
}

export type ParamValue = number | string | boolean
export type ParamValues = Record<string, ParamValue>

export interface EffectBuildContext {
  textures: EffectTextures
}

export interface BuiltEffect {
  systems: ParticleSystem[]
  /** 非粒子自定义对象（闪电折线、极光帘幕、积雪面等），随效果一起挂载/卸载 */
  objects?: THREE.Object3D[]
  tick?: (delta: number) => void
  update?: (values: ParamValues) => void
}

export interface EffectModule<Id extends string> {
  meta: Record<Id, EffectMeta>
  builders: Record<Id, (values: ParamValues, ctx: EffectBuildContext) => BuiltEffect>
}

export const DEG = Math.PI / 180

export function q3(x: number, y: number, z: number): QVector3 {
  return new QVector3(x, y, z)
}

export function hexToQ3(hex: string): QVector3 {
  const color = new THREE.Color(hex)
  return new QVector3(color.r, color.g, color.b)
}

export function hexToQ4(hex: string, alpha = 1): QVector4 {
  const color = new THREE.Color(hex)
  return new QVector4(color.r, color.g, color.b, alpha)
}

export function num(values: ParamValues, key: string, fallback: number): number {
  const value = values[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function str(values: ParamValues, key: string, fallback: string): string {
  const value = values[key]
  return typeof value === 'string' ? value : fallback
}

export function bool(values: ParamValues, key: string, fallback: boolean): boolean {
  const value = values[key]
  return typeof value === 'boolean' ? value : fallback
}

export function additive(map: THREE.Texture, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  })
}

export function normalBlend(map: THREE.Texture, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  })
}

export function whiteAlpha(alphaStops: Array<[number, number]>, opacity: number): Gradient {
  const rgb = hexToQ3('#ffffff')
  return new Gradient(
    [
      [rgb, 0],
      [rgb, 1]
    ],
    alphaStops.map(([a, t]) => [a * opacity, t] as [number, number])
  )
}

export function gradientFromHex(
  stops: Array<[string, number]>,
  alpha: Array<[number, number]>,
  opacity: number
): Gradient {
  return new Gradient(
    stops.map(([hex, t]) => [hexToQ3(hex), t] as [QVector3, number]),
    alpha.map(([a, t]) => [a * opacity, t] as [number, number])
  )
}

export function sizeCurve(p1: number, p2: number, p3: number, p4: number): SizeOverLife {
  return new SizeOverLife(new PiecewiseBezier([[new Bezier(p1, p2, p3, p4), 0]]))
}

export function mixHex(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a)
  const cb = new THREE.Color(b)
  ca.lerp(cb, t)
  return `#${ca.getHexString()}`
}
