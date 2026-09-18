export type Bounds = {
  west: number
  south: number
  east: number
  north: number
}

export type HeatPoint = {
  x: number
  y: number
  value: number
}

export type GradientStops = Record<string, string>

export type HeatmapRenderOptions = {
  min?: number
  max?: number
  radius?: number
  blur?: number
  maxOpacity?: number
  minOpacity?: number
  gradient?: GradientStops
  canvasWidth?: number
}

export type HeatmapResult = {
  canvas: HTMLCanvasElement
  getValueAt: (x: number, y: number) => number
  shadowData: Uint8ClampedArray | null
  colorData: Uint8ClampedArray | null
  min: number
  max: number
  width: number
  height: number
}

export function buildPalette(gradient: GradientStops, size = 256): Uint8ClampedArray {
  const paletteCanvas = document.createElement('canvas')
  paletteCanvas.width = size
  paletteCanvas.height = 1
  const context = paletteCanvas.getContext('2d')
  if (!context) return new Uint8ClampedArray(size * 4)
  const gradientBrush = context.createLinearGradient(0, 0, size, 1)
  for (const position in gradient) {
    gradientBrush.addColorStop(Number(position), gradient[position])
  }
  context.fillStyle = gradientBrush
  context.fillRect(0, 0, size, 1)
  return context.getImageData(0, 0, size, 1).data
}

function createPointTemplate(radius: number, blurFactor: number): HTMLCanvasElement {
  const template = document.createElement('canvas')
  template.width = template.height = radius * 2
  const context = template.getContext('2d')
  if (!context) return template
  if (blurFactor >= 1) {
    context.beginPath()
    context.arc(radius, radius, radius, 0, 2 * Math.PI, false)
    context.fillStyle = 'rgba(0,0,0,1)'
    context.fill()
  } else {
    const gradient = context.createRadialGradient(
      radius,
      radius,
      radius * blurFactor,
      radius,
      radius,
      radius
    )
    gradient.addColorStop(0, 'rgba(0,0,0,1)')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 2 * radius, 2 * radius)
  }
  return template
}

export function createHeatmapCanvas(
  points: HeatPoint[],
  bounds: Bounds,
  options: HeatmapRenderOptions = {}
): HeatmapResult {
  const width = Math.max(8, Math.round(options.canvasWidth ?? 1000))
  const height = Math.max(
    8,
    Math.round((width / Math.max(bounds.east - bounds.west, 1e-6)) * Math.max(bounds.north - bounds.south, 1e-6))
  )
  const shadowCanvas = document.createElement('canvas')
  const canvas = document.createElement('canvas')
  shadowCanvas.width = width
  shadowCanvas.height = height
  canvas.width = width
  canvas.height = height
  const shadowContext = shadowCanvas.getContext('2d')
  const context = canvas.getContext('2d')
  if (!shadowContext || !context) {
    return { canvas, getValueAt: () => 0, shadowData: null, colorData: null, min: 0, max: 1, width, height }
  }

  const values = points.map((point) => point.value)
  const dataMin = options.min ?? (values.length ? Math.min(...values) : 0)
  const dataMax = options.max ?? (values.length ? Math.max(...values) : 1)
  const min = Math.min(dataMin, dataMax)
  const max = Math.max(dataMin, dataMax)
  const radius = options.radius ?? 40
  const blur = options.blur ?? 0.85
  const maxOpacity = (options.maxOpacity ?? 1) * 255
  const minOpacity = (options.minOpacity ?? 0) * 255
  const gradient = options.gradient ?? { 0.25: 'rgb(0,0,255)', 0.55: 'rgb(0,255,0)', 0.85: 'yellow', 1: 'rgb(255,0,0)' }
  const palette = buildPalette(gradient)
  const blurFactor = blur >= 1 ? 1 : 1 - blur
  const templates = new Map<number, HTMLCanvasElement>()

  const lonRange = bounds.east - bounds.west || 1
  const latRange = bounds.north - bounds.south || 1
  for (const point of points) {
    const x = ((point.x - bounds.west) / lonRange) * width
    const y = ((bounds.north - point.y) / latRange) * height
    const value = Math.min(point.value, max)
    const normalized = max > min ? (value - min) / (max - min) : 0
    if (normalized <= 0) continue
    let template = templates.get(radius)
    if (!template) {
      template = createPointTemplate(radius, blurFactor)
      templates.set(radius, template)
    }
    shadowContext.globalAlpha = normalized
    shadowContext.drawImage(template, x - radius, y - radius)
  }
  shadowContext.globalAlpha = 1

  const image = shadowContext.getImageData(0, 0, width, height)
  const imageData = image.data
  const shadowData = new Uint8ClampedArray(imageData)
  for (let i = 3; i < imageData.length; i += 4) {
    const alpha = imageData[i]
    if (alpha <= 0) continue
    const offset = alpha * 4
    let finalAlpha: number
    if (alpha > maxOpacity) {
      finalAlpha = maxOpacity
    } else if (alpha < minOpacity) {
      finalAlpha = minOpacity
    } else {
      finalAlpha = alpha
    }
    imageData[i - 3] = palette[offset]
    imageData[i - 2] = palette[offset + 1]
    imageData[i - 1] = palette[offset + 2]
    imageData[i] = finalAlpha
  }
  context.putImageData(image, 0, 0)
  const colorData = context.getImageData(0, 0, width, height).data

  return {
    canvas,
    getValueAt: (x: number, y: number) => {
      const px = Math.max(0, Math.min(width - 1, Math.round(x)))
      const py = Math.max(0, Math.min(height - 1, Math.round(y)))
      const pixel = shadowContext.getImageData(px, py, 1, 1).data
      return pixel[3] / 255
    },
    shadowData,
    colorData,
    min,
    max,
    width,
    height
  }
}
