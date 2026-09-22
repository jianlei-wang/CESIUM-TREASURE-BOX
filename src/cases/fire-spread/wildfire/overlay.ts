import { FUEL_PROFILES } from './fuel'
import type { WildfireSimulation } from './model'

export type FireOverlayStyle = {
  innerColor: string
  borderColor: string
  glowColor: string
  innerAlpha: number
  glowAlpha: number
}

export type FireOverlayModeValue = 'theme' | 'arrival' | 'intensity' | 'fuel'

export const OVERLAY_MODES: Array<{ value: FireOverlayModeValue; label: string }> = [
  { value: 'theme', label: '专题配色' },
  { value: 'arrival', label: '到达时间场' },
  { value: 'intensity', label: '蔓延强度场' },
  { value: 'fuel', label: '可燃物类型' }
]

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const value =
    clean.length === 3
      ? clean
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6)
  const int = Number.parseInt(value, 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}

function ramp(stops: Array<[number, number, number]>, t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t))
  const scaled = clamped * (stops.length - 1)
  const index = Math.min(Math.floor(scaled), stops.length - 2)
  const f = scaled - index
  const a = stops[index]
  const b = stops[index + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

export const ARRIVAL_RAMP: Array<[number, number, number]> = [
  [43, 108, 163],
  [86, 190, 200],
  [244, 211, 94],
  [242, 141, 46],
  [179, 38, 30]
]

export const INTENSITY_RAMP: Array<[number, number, number]> = [
  [60, 40, 24],
  [166, 92, 30],
  [242, 141, 46],
  [255, 209, 102],
  [255, 246, 214]
]

const FUEL_COLORS: Array<[number, number, number]> = Object.keys(FUEL_PROFILES).map((key) =>
  parseHex(FUEL_PROFILES[Number(key)].color)
)

export const MAX_ROS_REFERENCE = 30

type CanvasBundle = {
  data: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  glow: HTMLCanvasElement
  glowCtx: CanvasRenderingContext2D
}

const bundles = new WeakMap<HTMLCanvasElement, CanvasBundle>()

function getBundle(canvas: HTMLCanvasElement, cols: number, rows: number): CanvasBundle {
  let bundle = bundles.get(canvas)
  if (!bundle || bundle.data.width !== cols || bundle.data.height !== rows) {
    const data = document.createElement('canvas')
    data.width = cols
    data.height = rows
    const glow = document.createElement('canvas')
    glow.width = cols
    glow.height = rows
    bundle = {
      data,
      ctx: data.getContext('2d') as CanvasRenderingContext2D,
      glow,
      glowCtx: glow.getContext('2d') as CanvasRenderingContext2D
    }
    bundles.set(canvas, bundle)
  }
  return bundle
}

/**
 * 将火场栅格绘制到覆盖层画布：烧毁区填充 + 火线像素 + 外发光 + 专题场着色。
 * 支持四种专题：专题配色 / 到达时间场 / 蔓延强度场 / 可燃物类型。
 */
export function paintFireOverlay(
  canvas: HTMLCanvasElement,
  sim: WildfireSimulation,
  style: FireOverlayStyle,
  mode: FireOverlayModeValue
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { cols, rows } = sim.terrain
  const bundle = getBundle(canvas, cols, rows)
  const image = bundle.ctx.createImageData(cols, rows)
  const pixels = image.data
  const glowImage = bundle.glowCtx.createImageData(cols, rows)
  const glowPixels = glowImage.data

  const inner = parseHex(style.innerColor)
  const border = parseHex(style.borderColor)
  const glow = parseHex(style.glowColor)
  const innerAlpha = Math.round(style.innerAlpha * 255)
  const now = sim.time
  const maxMinutes = Math.max(sim.params.maxMinutes, 1)
  let burningCells = 0

  for (let i = 0; i < cols * rows; i += 1) {
    const phase = sim.phaseAt(i)
    const offset = i * 4

    if (phase === 0) {
      if (mode === 'arrival') {
        const arrival = sim.arrivalAt(i)
        const reachable = Number.isFinite(arrival)
        const rgb = reachable ? ramp(ARRIVAL_RAMP, arrival / maxMinutes) : [26, 36, 32]
        pixels[offset] = rgb[0]
        pixels[offset + 1] = rgb[1]
        pixels[offset + 2] = rgb[2]
        pixels[offset + 3] = reachable ? 46 : 18
      } else if (mode === 'intensity') {
        const ros = sim.rosAt(i)
        const reachable = ros > 0
        const rgb = reachable ? ramp(INTENSITY_RAMP, Math.min(ros / MAX_ROS_REFERENCE, 1)) : [26, 36, 32]
        pixels[offset] = rgb[0]
        pixels[offset + 1] = rgb[1]
        pixels[offset + 2] = rgb[2]
        pixels[offset + 3] = reachable ? 52 : 18
      } else if (mode === 'fuel') {
        const rgb = FUEL_COLORS[sim.fuel.kind[i]] ?? FUEL_COLORS[0]
        pixels[offset] = rgb[0]
        pixels[offset + 1] = rgb[1]
        pixels[offset + 2] = rgb[2]
        pixels[offset + 3] = 118
      }
      continue
    }

    const burning = phase === 1
    if (mode === 'theme' || mode === 'fuel') {
      if (burning) {
        pixels[offset] = border[0]
        pixels[offset + 1] = border[1]
        pixels[offset + 2] = border[2]
        pixels[offset + 3] = 255
      } else if (mode === 'theme') {
        const flicker = 0.82 + 0.18 * Math.sin(i * 12.9898 + now * 0.6)
        pixels[offset] = Math.min(inner[0] * flicker, 255)
        pixels[offset + 1] = Math.min(inner[1] * flicker, 255)
        pixels[offset + 2] = Math.min(inner[2] * flicker, 255)
        pixels[offset + 3] = innerAlpha
      } else {
        const rgb = FUEL_COLORS[sim.fuel.kind[i]] ?? FUEL_COLORS[0]
        pixels[offset] = rgb[0] * 0.42
        pixels[offset + 1] = rgb[1] * 0.42
        pixels[offset + 2] = rgb[2] * 0.42
        pixels[offset + 3] = 168
      }
    } else if (mode === 'arrival') {
      const rgb = burning ? border : ramp(ARRIVAL_RAMP, sim.arrivalAt(i) / maxMinutes)
      pixels[offset] = rgb[0]
      pixels[offset + 1] = rgb[1]
      pixels[offset + 2] = rgb[2]
      pixels[offset + 3] = burning ? 255 : Math.max(innerAlpha, 96)
    } else {
      const rgb = burning ? border : ramp(INTENSITY_RAMP, Math.min(sim.rosAt(i) / MAX_ROS_REFERENCE, 1))
      pixels[offset] = rgb[0]
      pixels[offset + 1] = rgb[1]
      pixels[offset + 2] = rgb[2]
      pixels[offset + 3] = burning ? 255 : Math.max(innerAlpha, 96)
    }

    if (burning) {
      burningCells += 1
      glowPixels[offset] = glow[0]
      glowPixels[offset + 1] = glow[1]
      glowPixels[offset + 2] = glow[2]
      glowPixels[offset + 3] = 255
    }
  }

  bundle.ctx.putImageData(image, 0, 0)
  bundle.glowCtx.putImageData(glowImage, 0, 0)

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(bundle.data, 0, 0, canvas.width, canvas.height)

  if (style.glowAlpha > 0 && burningCells > 0) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = Math.min(style.glowAlpha, 1)
    const blur = Math.max((canvas.width / cols) * 2.6, 2)
    if ('filter' in ctx) ctx.filter = `blur(${blur.toFixed(1)}px)`
    ctx.drawImage(bundle.glow, 0, 0, canvas.width, canvas.height)
    ctx.restore()
  }
}
