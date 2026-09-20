import * as THREE from 'three'
import {
  Bezier,
  ColorRange,
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

/**
 * 就地改写 Gradient 的颜色关键帧，保持 alpha 与对象引用不变，
 * 以便在 update 中实时换色而无需重建粒子系统。
 */
export function setGradientColors(gradient: Gradient, hexes: string[]): void {
  const keys = gradient.color.keys
  const count = Math.min(keys.length, hexes.length)
  for (let i = 0; i < count; i += 1) {
    const color = new THREE.Color(hexes[i])
    keys[i][0].set(color.r, color.g, color.b)
  }
}

/** 就地改写 ColorRange 的起止颜色（保留各自 alpha）。 */
export function setColorRangeStops(range: ColorRange, startHex: string, endHex: string): void {
  const start = new THREE.Color(startHex)
  const end = new THREE.Color(endHex)
  range.a.set(start.r, start.g, start.b, range.a.w)
  range.b.set(end.r, end.g, end.b, range.b.w)
}

const alphaBaseCache = new WeakMap<object, number[]>()

function scaleAlphaKeys(keys: Array<[number, number]>, value: number): void {
  let base = alphaBaseCache.get(keys)
  if (!base) {
    base = keys.map(([alpha]) => alpha)
    alphaBaseCache.set(keys, base)
  }
  for (let i = 0; i < keys.length; i += 1) keys[i][0] = base[i] * value
}

/**
 * 让“不透明度/浓度”类参数真正生效。
 *
 * three.quarks 的 billboard 粒子渲染只读取逐粒子颜色 vColor，会忽略
 * material.opacity；且 ColorOverLife.update 会把渐变颜色乘以粒子生成时的
 * startColor。因此正确做法是把系数写进 alpha 通道：
 * 优先缩放 ColorOverLife 渐变的关键帧 alpha，没有渐变时退回缩放 startColor。
 * 首次调用会快照基础 alpha，可反复设置而不会逐次衰减。
 */
export function setParticleOpacity(system: ParticleSystem, value: number): void {
  const v = Math.max(0, value)
  let scaled = false
  const behaviors = system.behaviors as unknown as Array<{
    color?: { alpha?: { keys?: Array<[number, number]> } }
  }>
  for (const behavior of behaviors) {
    const keys = behavior?.color?.alpha?.keys
    if (Array.isArray(keys)) {
      scaleAlphaKeys(keys, v)
      scaled = true
    }
  }
  if (scaled) return
  const range = system.startColor as unknown as {
    a?: { w: number }
    b?: { w: number }
  }
  if (range?.a && range?.b) {
    let base = alphaBaseCache.get(range as object)
    if (!base) {
      base = [range.a.w, range.b.w]
      alphaBaseCache.set(range as object, base)
    }
    range.a.w = base[0] * v
    range.b.w = base[1] * v
  }
}
