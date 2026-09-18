/**
 * 简易热力 canvas：径向累积强度后按 palette 上色。
 * 替代参考工程 keli-heatmap.js，供 demo1 热力平面贴图。
 */
export interface HeatPoint {
  x: number
  y: number
  value: number
}

const DEFAULT_GRADIENT: [number, string][] = [
  [0.5, '#1fc2e1'],
  [0.6, '#24d560'],
  [0.7, '#9cd522'],
  [0.8, '#f1e12a'],
  [0.9, '#ffbf3a'],
  [1.0, '#ff0000'],
]

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function buildPalette(stops: [number, string][]): Uint8ClampedArray {
  const palette = new Uint8ClampedArray(256 * 4)
  const parsed = stops.map(([t, c]) => ({ t, rgb: hexToRgb(c) }))
  for (let i = 0; i < 256; i++) {
    const p = i / 255
    let a = parsed[0]
    let b = parsed[parsed.length - 1]
    for (let k = 0; k < parsed.length - 1; k++) {
      if (p >= parsed[k].t && p <= parsed[k + 1].t) {
        a = parsed[k]
        b = parsed[k + 1]
        break
      }
    }
    const span = b.t - a.t || 1
    const u = Math.min(1, Math.max(0, (p - a.t) / span))
    palette[i * 4] = a.rgb[0] + (b.rgb[0] - a.rgb[0]) * u
    palette[i * 4 + 1] = a.rgb[1] + (b.rgb[1] - a.rgb[1]) * u
    palette[i * 4 + 2] = a.rgb[2] + (b.rgb[2] - a.rgb[2]) * u
    palette[i * 4 + 3] = 255
  }
  return palette
}

export function renderHeatmap(opts: {
  size: number
  points: HeatPoint[]
  radius?: number
  min?: number
  max?: number
  gradient?: [number, string][]
}): { color: HTMLCanvasElement; grey: HTMLCanvasElement } {
  const { size, points, radius = 14, min = 0, max = 2000, gradient = DEFAULT_GRADIENT } = opts
  const shadow = document.createElement('canvas')
  shadow.width = size
  shadow.height = size
  const sctx = shadow.getContext('2d')!
  for (const p of points) {
    const t = Math.min(1, Math.max(0, (p.value - min) / (max - min || 1)))
    const g = sctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius)
    g.addColorStop(0, `rgba(0,0,0,${t})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    sctx.fillStyle = g
    sctx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2)
  }
  const grey = document.createElement('canvas')
  grey.width = size
  grey.height = size
  grey.getContext('2d')!.drawImage(shadow, 0, 0)

  const img = sctx.getImageData(0, 0, size, size)
  const palette = buildPalette(gradient)
  const data = img.data
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    const idx = a
    data[i] = palette[idx * 4]
    data[i + 1] = palette[idx * 4 + 1]
    data[i + 2] = palette[idx * 4 + 2]
    data[i + 3] = a
  }
  const color = document.createElement('canvas')
  color.width = size
  color.height = size
  const cctx = color.getContext('2d')!
  cctx.putImageData(img, 0, 0)
  return { color, grey }
}
