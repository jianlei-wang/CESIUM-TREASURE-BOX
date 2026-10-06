export type RampStop = { offset: number; color: string }

/** 常用连续色带。 */
export const RAMPS: Record<string, string[]> = {
  viridis: ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725'],
  inferno: ['#000004', '#420a68', '#932667', '#dd513a', '#fca50a', '#fcffa4'],
  turbo: ['#30123b', '#4145ab', '#4675ed', '#39a2fc', '#1bcfd4', '#62fc6b', '#d1e834', '#fe9b2d', '#f75f15', '#b80e04'],
  plasma: ['#0d0887', '#6a00a8', '#b12a90', '#e16462', '#fca636', '#f0f921'],
  blues: ['#08306b', '#2171b5', '#4292c6', '#6baed6', '#9ecae1', '#deebf7'],
  greens: ['#00441b', '#238b45', '#41ab5d', '#74c476', '#a1d99b', '#e5f5e0'],
  reds: ['#67000d', '#a50f15', '#cb181d', '#ef3b2c', '#fb6a4a', '#fcae91'],
  spectral: ['#9e0142', '#d53e4f', '#f46d43', '#fdae61', '#fee08b', '#e6f598', '#abdda4', '#66c2a5', '#3288bd', '#5e4fa2'],
  coolwarm: ['#3b4cc0', '#6788ee', '#9abbff', '#c9d7f0', '#edd1c2', '#f7a889', '#e26952', '#b40426'],
  sunset: ['#0b3d91', '#2d6bd6', '#6ea8fe', '#ffd166', '#ff8c42', '#ef476f']
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  const full = normalized.length === 3 ? normalized.split('').map((c) => c + c).join('') : normalized
  const num = Number.parseInt(full, 16)
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${((Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).padStart(6, '0')}`
}

/** 在命名色带上按 t∈[0,1] 取色。 */
export function ramp(name: string, t: number): string {
  const colors = RAMPS[name] ?? RAMPS.viridis
  const clamped = Math.min(1, Math.max(0, t))
  const scaled = clamped * (colors.length - 1)
  const index = Math.min(colors.length - 2, Math.floor(scaled))
  const local = scaled - index
  const [r1, g1, b1] = hexToRgb(colors[index])
  const [r2, g2, b2] = hexToRgb(colors[index + 1])
  return rgbToHex(r1 + (r2 - r1) * local, g1 + (g2 - g1) * local, b1 + (b2 - b1) * local)
}

/** 离散分类调色板。 */
export const CATEGORICAL = [
  '#38bdf8',
  '#f472b6',
  '#facc15',
  '#4ade80',
  '#a78bfa',
  '#fb923c',
  '#22d3ee',
  '#f87171',
  '#34d399',
  '#c084fc',
  '#fbbf24',
  '#60a5fa'
]

export function categorical(index: number): string {
  return CATEGORICAL[((index % CATEGORICAL.length) + CATEGORICAL.length) % CATEGORICAL.length]
}

/** 生成 CSS 渐变字符串（供图例使用）。 */
export function rampCss(name: string): string {
  const colors = RAMPS[name] ?? RAMPS.viridis
  const step = 100 / (colors.length - 1)
  const stops = colors.map((color, index) => `${color} ${(index * step).toFixed(1)}%`).join(', ')
  return `linear-gradient(90deg, ${stops})`
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}
