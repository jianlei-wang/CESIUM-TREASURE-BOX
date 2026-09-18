/** 可播种伪随机数与统计工具，保证同一 seed 的仿真结果可复现。 */

export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return function next(): number {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box-Muller 高斯随机数。 */
export function gaussian(rng: Rng): number {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function randRange(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng()
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function sum(values: number[]): number {
  let total = 0
  for (const value of values) total += value
  return total
}

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length
}

/** 普通最小二乘线性回归，返回斜率。 */
export function olsSlope(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return 0
  let sx = 0
  let sy = 0
  for (let i = 0; i < n; i += 1) {
    sx += xs[i]
    sy += ys[i]
  }
  const mx = sx / n
  const my = sy / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx
    num += dx * (ys[i] - my)
    den += dx * dx
  }
  return den === 0 ? 0 : num / den
}

/** 中位数绝对偏差（MAD）稳健标准差估计。 */
export function madSigma(values: number[]): number {
  if (values.length < 2) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const deviations = values.map((value) => Math.abs(value - median))
  deviations.sort((a, b) => a - b)
  const mad = deviations[Math.floor(deviations.length / 2)]
  return 1.4826 * mad
}
