/** 统计分析：数值分级、分位数、趋势、移动平均。 */

export type ClassificationMethod = 'quantile' | 'equal' | 'natural'

/** 等间距分级阈值。 */
export function equalIntervalBreaks(values: number[], classes: number, domain?: [number, number]): number[] {
  const [min, max] = domain ?? extent(values)
  const step = (max - min) / classes
  const breaks: number[] = []
  for (let i = 0; i <= classes; i += 1) breaks.push(min + step * i)
  return breaks
}

/** 分位数分级阈值。 */
export function quantileBreaks(values: number[], classes: number): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const breaks: number[] = []
  for (let i = 0; i <= classes; i += 1) breaks.push(quantileSorted(sorted, i / classes))
  return breaks
}

function quantileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = (sorted.length - 1) * p
  const lower = Math.floor(index)
  const upper = Math.min(sorted.length - 1, lower + 1)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

/** 自然间断点（Jenks）分级；大数据集先抽样以保证性能。 */
export function naturalBreaks(values: number[], classes: number, sampleSize = 20000): number[] {
  let sample = values
  if (values.length > sampleSize) {
    const stride = Math.ceil(values.length / sampleSize)
    sample = []
    for (let i = 0; i < values.length; i += stride) sample.push(values[i])
  }
  const sorted = [...sample].sort((a, b) => a - b)
  const n = sorted.length
  if (n <= classes) return equalIntervalBreaks(values, classes)

  const lower: number[][] = Array.from({ length: n + 1 }, () => new Array(classes + 1).fill(0))
  const variance: number[][] = Array.from({ length: n + 1 }, () => new Array(classes + 1).fill(0))
  for (let i = 1; i <= classes; i += 1) {
    lower[1][i] = 1
    variance[1][i] = 0
    for (let j = 2; j <= n; j += 1) variance[j][i] = Number.POSITIVE_INFINITY
  }
  for (let l = 2; l <= n; l += 1) {
    let sum = 0
    let sumSq = 0
    let weight = 0
    for (let m = 1; m <= l; m += 1) {
      const lowerClassLimit = l - m + 1
      const value = sorted[lowerClassLimit - 1]
      weight += 1
      sum += value
      sumSq += value * value
      const currentVariance = sumSq - (sum * sum) / weight
      const previous = lowerClassLimit - 1
      if (previous < 1) continue
      for (let i = 2; i <= classes; i += 1) {
        if (variance[l][i] >= currentVariance + variance[previous][i - 1]) {
          lower[l][i] = lowerClassLimit
          variance[l][i] = currentVariance + variance[previous][i - 1]
        }
      }
    }
    lower[l][1] = 1
    variance[l][1] = sumSq - (sum * sum) / weight
  }

  const breaks: number[] = new Array(classes + 1).fill(sorted[n - 1])
  breaks[0] = sorted[0]
  let k = n
  for (let count = classes; count >= 2; count -= 1) {
    const id = lower[k][count] - 2
    breaks[count - 1] = sorted[id]
    k = lower[k][count] - 1
  }
  return breaks
}

export function breaksFor(method: ClassificationMethod, values: number[], classes: number): number[] {
  if (method === 'quantile') return quantileBreaks(values, classes)
  if (method === 'natural') return naturalBreaks(values, classes)
  return equalIntervalBreaks(values, classes)
}

/** 把值映射到分级序号。 */
export function classifyValue(value: number, breaks: number[]): number {
  for (let i = 1; i < breaks.length; i += 1) if (value < breaks[i]) return i - 1
  return breaks.length - 2
}

/** 数值范围。 */
export function extent(values: ArrayLike<number>): [number, number] {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min)) return [0, 1]
  if (min === max) return [min, min + 1]
  return [min, max]
}

/** 移动平均。 */
export function movingAverage(values: number[], window: number): number[] {
  const half = Math.max(0, Math.floor(window / 2))
  const result = new Array(values.length).fill(0)
  for (let i = 0; i < values.length; i += 1) {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j += 1) {
      sum += values[j]
      count += 1
    }
    result[i] = count > 0 ? sum / count : 0
  }
  return result
}

/** 线性回归趋势（返回斜率与截距）。 */
export function linearTrend(values: number[]): { slope: number; intercept: number } {
  const n = values.length
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 }
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (let i = 0; i < n; i += 1) {
    sumX += i
    sumY += values[i]
    sumXY += i * values[i]
    sumXX += i * i
  }
  const denom = n * sumXX - sumX * sumX || 1
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

export { quantileSorted }
