function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683) + Math.imul(seed, 144665)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967295
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const xf = smooth(x - xi)
  const yf = smooth(y - yi)
  const zf = smooth(z - zi)

  const c000 = hash3(xi, yi, zi, seed)
  const c100 = hash3(xi + 1, yi, zi, seed)
  const c010 = hash3(xi, yi + 1, zi, seed)
  const c110 = hash3(xi + 1, yi + 1, zi, seed)
  const c001 = hash3(xi, yi, zi + 1, seed)
  const c101 = hash3(xi + 1, yi, zi + 1, seed)
  const c011 = hash3(xi, yi + 1, zi + 1, seed)
  const c111 = hash3(xi + 1, yi + 1, zi + 1, seed)

  const x00 = lerp(c000, c100, xf)
  const x10 = lerp(c010, c110, xf)
  const x01 = lerp(c001, c101, xf)
  const x11 = lerp(c011, c111, xf)
  return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf)
}

export function fbm3(x: number, y: number, z: number, seed: number, octaves = 4): number {
  let value = 0
  let amplitude = 0.5
  let frequency = 1
  let total = 0
  for (let i = 0; i < octaves; i += 1) {
    value += amplitude * valueNoise3(x * frequency, y * frequency, z * frequency, seed + i * 17)
    total += amplitude
    amplitude *= 0.5
    frequency *= 2.03
  }
  return value / total
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

export function buildVolume(size: number, seed: number, mode: 'cloud' | 'shell'): Uint8Array {
  const data = new Uint8Array(size * size * size)
  const denom = Math.max(1, size - 1)
  let index = 0
  for (let z = 0; z < size; z += 1) {
    const nz = (z / denom) * 2 - 1
    for (let y = 0; y < size; y += 1) {
      const ny = (y / denom) * 2 - 1
      for (let x = 0; x < size; x += 1) {
        const nx = (x / denom) * 2 - 1
        const radius = Math.sqrt(nx * nx + ny * ny + nz * nz)
        const falloff = clamp01(1 - radius)
        const noise = fbm3(nx * 3.1 + seed * 0.001, ny * 3.1 + seed * 0.002, nz * 3.1, seed, 4)
        let density: number
        if (mode === 'cloud') {
          density = falloff * 0.9 + (noise - 0.48) * 0.9
          density = clamp01((density - 0.08) * 1.65)
        } else {
          const shell = 1 - Math.abs(radius - 0.55) * 2.6
          density = clamp01(shell * 0.75 + (noise - 0.5) * 0.85)
        }
        data[index] = Math.round(clamp01(density) * 255)
        index += 1
      }
    }
  }
  return data
}
