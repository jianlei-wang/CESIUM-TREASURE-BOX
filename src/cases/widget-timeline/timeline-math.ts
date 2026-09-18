import { JulianDate } from 'cesium'

const STEPS = [
  1, 2, 5, 10, 15, 30,
  60, 120, 300, 600, 900, 1800,
  3600, 7200, 10800, 21600, 43200,
  86400, 172800, 604800, 1209600, 2592000, 7776000, 31536000
]

export const SPEED_OPTIONS = [
  { value: 1, label: '1x' },
  { value: 60, label: '1分/秒' },
  { value: 600, label: '10分/秒' },
  { value: 3600, label: '1时/秒' },
  { value: 86400, label: '1天/秒' }
]

export type TickMark = {
  pct: number
  label: string
  major: boolean
}

export function clamp(n: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, n))
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function toUnix(j: JulianDate): number {
  return JulianDate.toDate(j).getTime() / 1000
}

export function fromUnix(sec: number, result?: JulianDate): JulianDate {
  return JulianDate.fromDate(new Date(sec * 1000), result)
}

export function niceStep(spanSec: number, maxTicks: number): number {
  const raw = spanSec / Math.max(maxTicks, 2)
  for (const step of STEPS) {
    if (step >= raw) return step
  }
  return STEPS[STEPS.length - 1]
}

export function formatTick(date: Date, stepSec: number): string {
  const y = date.getFullYear()
  const m = pad2(date.getMonth() + 1)
  const d = pad2(date.getDate())
  const hh = pad2(date.getHours())
  const mm = pad2(date.getMinutes())
  const ss = pad2(date.getSeconds())
  if (stepSec < 60) return `${hh}:${mm}:${ss}`
  if (stepSec < 3600) return `${hh}:${mm}`
  if (stepSec < 86400) return `${m}-${d} ${hh}:${mm}`
  if (stepSec < 604800) return `${m}-${d}`
  return `${y}-${m}-${d}`
}

export function formatClock(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export function buildTicks(viewStartSec: number, viewEndSec: number, maxTicks = 12): TickMark[] {
  const span = viewEndSec - viewStartSec
  if (span <= 0) return []
  const step = niceStep(span, maxTicks)
  const minor = step >= 86400 ? step / 2 : step / 5
  const first = Math.ceil(viewStartSec / minor) * minor
  const ticks: TickMark[] = []
  for (let s = first; s <= viewEndSec + 1e-6; s += minor) {
    const pct = ((s - viewStartSec) / span) * 100
    if (pct < -1 || pct > 101) continue
    const major = Math.abs(s / step - Math.round(s / step)) < 1e-6
    ticks.push({
      pct,
      label: major ? formatTick(new Date(s * 1000), step) : '',
      major
    })
  }
  return ticks
}

export function sunFactor(date: Date): number {
  const h = date.getHours() + date.getMinutes() / 60
  return (Math.cos(((h - 12) / 12) * Math.PI) + 1) / 2
}

export function daylightStops(viewStartSec: number, viewEndSec: number, samples = 14): string {
  const span = viewEndSec - viewStartSec
  if (span <= 0) return 'transparent'
  const parts: string[] = []
  for (let i = 0; i <= samples; i += 1) {
    const t = viewStartSec + (span * i) / samples
    const f = sunFactor(new Date(t * 1000))
    const night = [18, 24, 48]
    const day = [255, 196, 92]
    const r = Math.round(night[0] + (day[0] - night[0]) * f)
    const g = Math.round(night[1] + (day[1] - night[1]) * f)
    const b = Math.round(night[2] + (day[2] - night[2]) * f)
    parts.push(`rgb(${r},${g},${b}) ${(i / samples) * 100}%`)
  }
  return parts.join(', ')
}

export function polarDeg(deg: number, r: number, cx = 180, cy = 188): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) }
}

export function pointerToDeg(x: number, y: number, cx = 180, cy = 188): number {
  return clamp((Math.atan2(x - cx, cy - y) * 180) / Math.PI, -120, 120)
}

export function pctToDeg(pct: number): number {
  return -120 + (clamp(pct, 0, 100) / 100) * 240
}

export function degToPct(deg: number): number {
  return ((clamp(deg, -120, 120) + 120) / 240) * 100
}
