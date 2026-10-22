import type { CameraPose, RouteData, RouteSample } from './types'

interface CapturedSample {
  pose: CameraPose
  elapsed: number
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function unwrapSeries(values: number[]): number[] {
  if (!values.length) return []
  const result = [values[0]]
  for (let index = 1; index < values.length; index += 1) {
    let delta = ((values[index] - values[index - 1]) % 360 + 540) % 360 - 180
    if (delta === -180) delta = 180
    result.push(result[index - 1] + delta)
  }
  return result
}

function wrap(value: number): number {
  return ((value % 360) + 360) % 360
}

function movingAverage(values: number[], window: number): number[] {
  if (window <= 1 || values.length < 3) return [...values]
  const radius = Math.floor(window / 2)
  return values.map((_, index) => {
    let sum = 0
    let count = 0
    for (let offset = -radius; offset <= radius; offset += 1) {
      const next = values[index + offset]
      if (next === undefined) continue
      sum += next
      count += 1
    }
    return count ? sum / count : values[index]
  })
}

function angularDistance(a: number, b: number): number {
  return Math.abs(((a - b) % 360 + 540) % 360 - 180)
}

function dedupe(samples: CapturedSample[]): CapturedSample[] {
  const result: CapturedSample[] = []
  for (const sample of samples) {
    const previous = result[result.length - 1]
    if (!previous) {
      result.push(sample)
      continue
    }
    const distance = Math.hypot(
      (sample.pose.longitude - previous.pose.longitude) * 95000,
      (sample.pose.latitude - previous.pose.latitude) * 111000
    )
    const moved =
      distance > 0.35 ||
      Math.abs(sample.pose.height - previous.pose.height) > 0.3 ||
      angularDistance(sample.pose.heading, previous.pose.heading) > 0.25 ||
      Math.abs(sample.pose.pitch - previous.pose.pitch) > 0.25 ||
      sample.elapsed - previous.elapsed > 180
    if (moved) result.push(sample)
  }
  return result
}

export function finalizeRoute(captured: CapturedSample[], smoothing: number): RouteData {
  const cleaned = dedupe(captured.filter((sample) => Number.isFinite(sample.elapsed)))
  if (!cleaned.length) {
    return {
      samples: [],
      recordedDuration: 0,
      smoothing,
      altitudeOffset: 0,
      interpolation: 'catmullrom'
    }
  }
  const duration = clamp((cleaned[cleaned.length - 1].elapsed - cleaned[0].elapsed) / 1000, 1, 120)
  const window = Math.max(1, Math.round(1 + clamp(smoothing, 0, 1) * 8))
  const unwrappedHeading = unwrapSeries(cleaned.map((sample) => sample.pose.heading))
  const unwrappedRoll = unwrapSeries(cleaned.map((sample) => sample.pose.roll))
  const smoothed = {
    longitude: movingAverage(cleaned.map((sample) => sample.pose.longitude), window),
    latitude: movingAverage(cleaned.map((sample) => sample.pose.latitude), window),
    height: movingAverage(cleaned.map((sample) => sample.pose.height), window),
    heading: movingAverage(unwrappedHeading, window),
    pitch: movingAverage(cleaned.map((sample) => sample.pose.pitch), window),
    roll: movingAverage(unwrappedRoll, window),
    fov: movingAverage(cleaned.map((sample) => sample.pose.fov), window)
  }
  const startTime = cleaned[0].elapsed
  const totalElapsed = Math.max(1, cleaned[cleaned.length - 1].elapsed - startTime)
  const maxPoints = 220
  const count = Math.max(2, Math.min(maxPoints, cleaned.length))
  const samples: RouteSample[] = []
  let cursor = 0
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1)
    const targetElapsed = startTime + t * totalElapsed
    while (cursor < cleaned.length - 2 && cleaned[cursor + 1].elapsed < targetElapsed) cursor += 1
    const left = cleaned[cursor]
    const right = cleaned[Math.min(cleaned.length - 1, cursor + 1)]
    const span = Math.max(1, right.elapsed - left.elapsed)
    const local = clamp((targetElapsed - left.elapsed) / span, 0, 1)
    const lerp = (a: number, b: number) => a + (b - a) * local
    samples.push({
      longitude: lerp(smoothed.longitude[cursor], smoothed.longitude[Math.min(cleaned.length - 1, cursor + 1)]),
      latitude: lerp(smoothed.latitude[cursor], smoothed.latitude[Math.min(cleaned.length - 1, cursor + 1)]),
      height: lerp(smoothed.height[cursor], smoothed.height[Math.min(cleaned.length - 1, cursor + 1)]),
      heading: wrap(lerp(smoothed.heading[cursor], smoothed.heading[Math.min(cleaned.length - 1, cursor + 1)])),
      pitch: lerp(smoothed.pitch[cursor], smoothed.pitch[Math.min(cleaned.length - 1, cursor + 1)]),
      roll: lerp(smoothed.roll[cursor], smoothed.roll[Math.min(cleaned.length - 1, cursor + 1)]),
      fov: lerp(smoothed.fov[cursor], smoothed.fov[Math.min(cleaned.length - 1, cursor + 1)]),
      t
    })
  }
  return {
    samples,
    recordedDuration: duration,
    smoothing,
    altitudeOffset: 0,
    interpolation: 'catmullrom'
  }
}

export function removeRouteSample(route: RouteData, index: number): void {
  if (route.samples.length <= 2) return
  route.samples.splice(index, 1)
  route.samples.forEach((sample, sampleIndex) => {
    sample.t = route.samples.length <= 1 ? 0 : sampleIndex / (route.samples.length - 1)
  })
}

export function updateRouteSample(route: RouteData, index: number, patch: Partial<CameraPose>): void {
  const sample = route.samples[index]
  if (!sample) return
  Object.assign(sample, patch)
  if (typeof patch.heading === 'number') {
    sample.heading = ((patch.heading % 360) + 360) % 360
  }
}
