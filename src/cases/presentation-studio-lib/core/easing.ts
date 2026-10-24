import type { EasingCurve, EasingType } from './types'

export interface CurvePreset {
  id: string
  name: string
  curve: EasingCurve
}

export const DEFAULT_CURVES: Record<EasingType, EasingCurve> = {
  linear: { x1: 0, y1: 0, x2: 1, y2: 1 },
  smooth: { x1: 0.4, y1: 0, x2: 0.2, y2: 1 },
  cinematic: { x1: 0.72, y1: 0.02, x2: 0.18, y2: 1 }
}

export const CURVE_PRESETS: CurvePreset[] = [
  { id: 'linear', name: '线性', curve: DEFAULT_CURVES.linear },
  { id: 'smooth', name: '平滑', curve: DEFAULT_CURVES.smooth },
  { id: 'cinematic', name: '电影', curve: DEFAULT_CURVES.cinematic },
  { id: 'ease-in', name: '缓入', curve: { x1: 0.42, y1: 0, x2: 1, y2: 1 } },
  { id: 'ease-out', name: '缓出', curve: { x1: 0, y1: 0, x2: 0.58, y2: 1 } }
]

export function clampCurve(curve: EasingCurve): EasingCurve {
  const value = (input: number, fallback: number): number =>
    Number.isFinite(input) ? Math.min(1, Math.max(0, input)) : fallback
  return {
    x1: value(curve.x1, 0),
    y1: value(curve.y1, 0),
    x2: value(curve.x2, 1),
    y2: value(curve.y2, 1)
  }
}

export function curveForAction(action: { easing?: EasingType; curve?: EasingCurve }): EasingCurve {
  if (action.curve) return clampCurve(action.curve)
  return DEFAULT_CURVES[action.easing ?? 'smooth'] ?? DEFAULT_CURVES.smooth
}

function bezierValue(p1: number, p2: number, t: number): number {
  const inverse = 1 - t
  return 3 * inverse * inverse * t * p1 + 3 * inverse * t * t * p2 + t * t * t
}

/** 使用二分法求解 x(t)=x，再取 y(t)，保证任意输入都得到稳定结果。 */
export function sampleCurve(curve: EasingCurve, x: number): number {
  const safe = clampCurve(curve)
  const target = Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0))
  if (target <= 0) return 0
  if (target >= 1) return 1
  let low = 0
  let high = 1
  let t = target
  for (let index = 0; index < 24; index += 1) {
    const currentX = bezierValue(safe.x1, safe.x2, t)
    if (Math.abs(currentX - target) < 0.000001) break
    if (currentX < target) low = t
    else high = t
    t = (low + high) / 2
  }
  return Math.min(1, Math.max(0, bezierValue(safe.y1, safe.y2, t)))
}

export function curvePath(curve: EasingCurve): string {
  const safe = clampCurve(curve)
  const px = (value: number): number => Math.round(value * 1000) / 10
  const py = (value: number): number => Math.round((1 - value) * 1000) / 10
  return `M 0 100 C ${px(safe.x1)} ${py(safe.y1)}, ${px(safe.x2)} ${py(safe.y2)}, 100 0`
}
