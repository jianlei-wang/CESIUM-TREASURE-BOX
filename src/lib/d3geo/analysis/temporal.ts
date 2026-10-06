import { GeoPointBufferBuilder, type GeoPointBuffer } from '../core/buffer'

export type TemporalBin = {
  t0: number
  t1: number
  count: number
  sum: number
  mean: number
  min: number
  max: number
}

/** 时间分箱统计：count / sum / mean / min / max。 */
export function temporalBins(buffer: GeoPointBuffer, binCount: number, domain?: [number, number]): TemporalBin[] {
  if (buffer.length === 0) return []
  let min = domain?.[0] ?? Number.POSITIVE_INFINITY
  let max = domain?.[1] ?? Number.NEGATIVE_INFINITY
  if (!domain) {
    for (let i = 0; i < buffer.length; i += 1) {
      const t = buffer.timestamps[i]
      if (t < min) min = t
      if (t > max) max = t
    }
  }
  if (min === max) max = min + 1
  const width = (max - min) / binCount
  const bins: TemporalBin[] = Array.from({ length: binCount }, (_, i) => ({
    t0: min + i * width,
    t1: min + (i + 1) * width,
    count: 0,
    sum: 0,
    mean: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY
  }))
  for (let i = 0; i < buffer.length; i += 1) {
    const t = buffer.timestamps[i]
    const index = Math.min(binCount - 1, Math.max(0, Math.floor((t - min) / width)))
    const bin = bins[index]
    const value = buffer.values[i]
    bin.count += 1
    bin.sum += value
    if (value < bin.min) bin.min = value
    if (value > bin.max) bin.max = value
  }
  for (const bin of bins) {
    bin.mean = bin.count > 0 ? bin.sum / bin.count : 0
    if (!Number.isFinite(bin.min)) bin.min = 0
    if (!Number.isFinite(bin.max)) bin.max = 0
  }
  return bins
}

/** 时间窗口过滤，返回新缓冲。 */
export function filterByTimeWindow(buffer: GeoPointBuffer, t0: number, t1: number): GeoPointBuffer {
  const low = Math.min(t0, t1)
  const high = Math.max(t0, t1)
  let count = 0
  for (let i = 0; i < buffer.length; i += 1) if (buffer.timestamps[i] >= low && buffer.timestamps[i] <= high) count += 1
  const builder = new GeoPointBufferBuilder(count)
  for (let i = 0; i < buffer.length; i += 1) {
    const t = buffer.timestamps[i]
    if (t < low || t > high) continue
    builder.push(buffer.positions[i * 2], buffer.positions[i * 2 + 1], buffer.values[i], buffer.categories[i], t)
  }
  return builder.build()
}

/** 时间格式化 HH:MM。 */
export function formatClock(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
