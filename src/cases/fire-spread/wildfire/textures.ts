function createCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  return { canvas, ctx: canvas.getContext('2d') as CanvasRenderingContext2D }
}

/** 程序化火焰精灵：亮心 + 橙红晕 + 上升拖尾。 */
export function createFlameTexture(): HTMLCanvasElement {
  const size = 64
  const { canvas, ctx } = createCanvas(size)
  const gradient = ctx.createRadialGradient(size / 2, size * 0.62, 1, size / 2, size * 0.55, size * 0.52)
  gradient.addColorStop(0, 'rgba(255,255,240,1)')
  gradient.addColorStop(0.24, 'rgba(255,214,120,0.95)')
  gradient.addColorStop(0.52, 'rgba(244,124,32,0.7)')
  gradient.addColorStop(0.8, 'rgba(206,54,18,0.28)')
  gradient.addColorStop(1, 'rgba(120,20,10,0)')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.moveTo(size / 2, 2)
  ctx.bezierCurveTo(size * 0.9, size * 0.36, size * 0.82, size * 0.96, size / 2, size - 1)
  ctx.bezierCurveTo(size * 0.18, size * 0.96, size * 0.1, size * 0.36, size / 2, 2)
  ctx.fill()

  const core = ctx.createRadialGradient(size / 2, size * 0.68, 1, size / 2, size * 0.68, size * 0.3)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(0.6, 'rgba(255,236,170,0.6)')
  core.addColorStop(1, 'rgba(255,200,120,0)')
  ctx.fillStyle = core
  ctx.fillRect(0, 0, size, size)
  return canvas
}

/** 程序化烟雾精灵：低密度灰棕团。 */
export function createSmokeTexture(): HTMLCanvasElement {
  const size = 96
  const { canvas, ctx } = createCanvas(size)
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(196,196,196,0.62)')
  gradient.addColorStop(0.45, 'rgba(150,150,150,0.34)')
  gradient.addColorStop(0.78, 'rgba(110,110,110,0.12)')
  gradient.addColorStop(1, 'rgba(90,90,90,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 26; i += 1) {
    const x = size / 2 + (Math.random() - 0.5) * size * 0.66
    const y = size / 2 + (Math.random() - 0.5) * size * 0.66
    const r = size * (0.05 + Math.random() * 0.12)
    const puff = ctx.createRadialGradient(x, y, 1, x, y, r)
    puff.addColorStop(0, `rgba(214,214,214,${0.08 + Math.random() * 0.12})`)
    puff.addColorStop(1, 'rgba(160,160,160,0)')
    ctx.fillStyle = puff
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  return canvas
}

/** 起火点标记：靶环。 */
export function createIgnitionTexture(): HTMLCanvasElement {
  const size = 64
  const { canvas, ctx } = createCanvas(size)
  ctx.strokeStyle = 'rgba(255,82,32,0.95)'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,214,120,0.95)'
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size * 0.13, 0, Math.PI * 2)
  ctx.fill()
  return canvas
}
