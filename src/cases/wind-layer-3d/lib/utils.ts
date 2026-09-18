export function deepMerge<T extends Record<string, unknown>>(from: Partial<T> | undefined | null, to: T): T {
  if (!from) return to
  if (!to) return from as T

  const result: Record<string, unknown> = { ...to }

  for (const key in from) {
    if (Object.prototype.hasOwnProperty.call(from, key)) {
      const fromValue = from[key]
      const toValue = to[key]

      if (Array.isArray(fromValue)) {
        result[key] = fromValue.slice()
        continue
      }

      if (fromValue && typeof fromValue === 'object') {
        result[key] = deepMerge(
          fromValue as Record<string, unknown>,
          (toValue as Record<string, unknown> | undefined) ?? {}
        )
        continue
      }

      if (fromValue !== undefined) {
        result[key] = fromValue
      }
    }
  }

  return result as T
}

export function computeSpeedFromComponents(
  u: Float32Array,
  v: Float32Array,
  w: Float32Array
): { array: Float32Array; min: number; max: number } {
  const array = new Float32Array(u.length)
  let min = Number.MAX_VALUE
  let max = Number.MIN_VALUE
  for (let i = 0; i < u.length; i++) {
    const s = Math.sqrt(u[i] * u[i] + v[i] * v[i] + w[i] * w[i])
    array[i] = s
    if (s !== 0) {
      min = Math.min(min, s)
      max = Math.max(max, s)
    }
  }
  return { array, min, max }
}
