function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1013904223) | 0
  h = (h ^ (h >>> 13)) * 1274126177 | 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

/** 二维值噪声，输入为格点坐标（可为小数），输出 [0,1]。 */
export function valueNoise2(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = smooth(x - x0)
  const fy = smooth(y - y0)
  const v00 = hash2(x0, y0, seed)
  const v10 = hash2(x0 + 1, y0, seed)
  const v01 = hash2(x0, y0 + 1, seed)
  const v11 = hash2(x0 + 1, y0 + 1, seed)
  const top = v00 + (v10 - v00) * fx
  const bottom = v01 + (v11 - v01) * fx
  return top + (bottom - top) * fy
}

/** 分形布朗运动，返回 [0,1]。 */
export function fbm2(x: number, y: number, seed: number, octaves = 5): number {
  let amplitude = 0.5
  let frequency = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise2(x * frequency, y * frequency, seed + i * 17) * amplitude
    norm += amplitude
    amplitude *= 0.5
    frequency *= 2
  }
  return sum / norm
}

/** 脊状分形，地貌感更强，返回 [0,1]。 */
export function ridged2(x: number, y: number, seed: number, octaves = 6): number {
  let amplitude = 0.5
  let frequency = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i += 1) {
    const n = 1 - Math.abs(valueNoise2(x * frequency, y * frequency, seed + i * 31) * 2 - 1)
    sum += n * n * amplitude
    norm += amplitude
    amplitude *= 0.5
    frequency *= 2
  }
  return sum / norm
}
