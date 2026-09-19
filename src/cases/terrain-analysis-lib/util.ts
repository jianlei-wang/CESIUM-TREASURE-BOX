/**
 * 通用小工具。
 */
import type { StatItem } from './types'

export function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function maskToNaN(values: Float32Array, mask: Uint8Array): Float32Array {
  const out = new Float32Array(values.length)
  for (let i = 0; i < values.length; i += 1) out[i] = mask[i] ? values[i] : Number.NaN
  return out
}

export function percent(part: number, whole: number, digits = 2): string {
  if (whole <= 0) return '—'
  return `${((part / whole) * 100).toFixed(digits)}%`
}

export function stat(label: string, value: string): StatItem {
  return { label, value }
}

export function round(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}
