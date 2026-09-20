import * as THREE from 'three'

export interface EffectTextures {
  soft: THREE.Texture
  glow: THREE.Texture
  spark: THREE.Texture
  smoke: THREE.Texture
  snowflake: THREE.Texture
}

function createCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  return { canvas, ctx }
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

function radial(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  stops: Array<[number, string]>
): void {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
  for (const [offset, color] of stops) gradient.addColorStop(offset, color)
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fill()
}

function drawSoft(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2
  radial(ctx, c, c, c, [
    [0, 'rgba(255,255,255,1)'],
    [0.18, 'rgba(255,255,255,0.82)'],
    [0.45, 'rgba(255,255,255,0.32)'],
    [0.75, 'rgba(255,255,255,0.08)'],
    [1, 'rgba(255,255,255,0)']
  ])
}

function drawGlow(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2
  radial(ctx, c, c, c, [
    [0, 'rgba(255,255,255,1)'],
    [0.06, 'rgba(255,255,255,1)'],
    [0.18, 'rgba(255,255,255,0.62)'],
    [0.42, 'rgba(255,255,255,0.2)'],
    [0.72, 'rgba(255,255,255,0.05)'],
    [1, 'rgba(255,255,255,0)']
  ])
}

function drawSpark(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2
  radial(ctx, c, c, c, [
    [0, 'rgba(255,255,255,1)'],
    [0.08, 'rgba(255,255,255,1)'],
    [0.2, 'rgba(255,255,255,0.55)'],
    [0.5, 'rgba(255,255,255,0.12)'],
    [1, 'rgba(255,255,255,0)']
  ])
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const flare = ctx.createLinearGradient(0, c, size, c)
  flare.addColorStop(0, 'rgba(255,255,255,0)')
  flare.addColorStop(0.5, 'rgba(255,255,255,0.9)')
  flare.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = flare
  ctx.fillRect(0, c - 0.6, size, 1.2)
  const flareV = ctx.createLinearGradient(c, 0, c, size)
  flareV.addColorStop(0, 'rgba(255,255,255,0)')
  flareV.addColorStop(0.5, 'rgba(255,255,255,0.9)')
  flareV.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = flareV
  ctx.fillRect(c - 0.6, 0, 1.2, size)
  ctx.restore()
}

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function drawSnowflake(ctx: CanvasRenderingContext2D, size: number): void {
  const rand = seeded(773451)
  const center = size / 2
  const radius = size * 0.44
  const arms = 6

  ctx.save()
  ctx.translate(center, center)
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(255,255,255,0.92)'
  ctx.shadowColor = 'rgba(255,255,255,0.85)'
  ctx.shadowBlur = size * 0.035

  for (let a = 0; a < arms; a += 1) {
    ctx.save()
    ctx.rotate((a / arms) * Math.PI * 2 + (rand() - 0.5) * 0.05)
    ctx.lineWidth = size * 0.03
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(0, -radius)
    ctx.stroke()

    const branches = 4
    for (let b = 1; b <= branches; b += 1) {
      const t = b / (branches + 1)
      const y = -radius * t
      const len = radius * 0.3 * (1 - t * 0.55)
      ctx.lineWidth = size * 0.02 * (1 - t * 0.4)
      for (const side of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(side * len, y - len * 0.85)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  ctx.beginPath()
  const hex = radius * 0.16
  for (let i = 0; i <= 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2
    const x = Math.cos(angle) * hex
    const y = Math.sin(angle) * hex
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.globalCompositeOperation = 'destination-in'
  radial(ctx, center, center, center * 0.98, [
    [0, 'rgba(255,255,255,1)'],
    [0.72, 'rgba(255,255,255,1)'],
    [0.92, 'rgba(255,255,255,0.35)'],
    [1, 'rgba(255,255,255,0)']
  ])
  ctx.restore()
}

function drawSmoke(ctx: CanvasRenderingContext2D, size: number): void {
  const rand = seeded(20260919)
  ctx.save()
  ctx.filter = `blur(${Math.round(size * 0.03)}px)`
  const blobs = 7
  for (let i = 0; i < blobs; i += 1) {
    const angle = rand() * Math.PI * 2
    const dist = rand() * size * 0.16
    const cx = size / 2 + Math.cos(angle) * dist
    const cy = size / 2 + Math.sin(angle) * dist
    const radius = size * (0.2 + rand() * 0.16)
    radial(ctx, cx, cy, radius, [
      [0, 'rgba(255,255,255,0.5)'],
      [0.45, 'rgba(255,255,255,0.28)'],
      [0.75, 'rgba(255,255,255,0.08)'],
      [1, 'rgba(255,255,255,0)']
    ])
  }
  ctx.restore()
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 4; i += 1) {
    const angle = rand() * Math.PI * 2
    const dist = size * (0.18 + rand() * 0.2)
    const cx = size / 2 + Math.cos(angle) * dist
    const cy = size / 2 + Math.sin(angle) * dist
    radial(ctx, cx, cy, size * (0.08 + rand() * 0.08), [
      [0, 'rgba(0,0,0,0.5)'],
      [1, 'rgba(0,0,0,0)']
    ])
  }
  ctx.restore()
}

export function createEffectTextures(): EffectTextures {
  const size = 256

  const soft = createCanvas(size)
  drawSoft(soft.ctx, size)

  const glow = createCanvas(size)
  drawGlow(glow.ctx, size)

  const spark = createCanvas(size)
  drawSpark(spark.ctx, size)

  const smoke = createCanvas(size)
  drawSmoke(smoke.ctx, size)

  const snowflake = createCanvas(size)
  drawSnowflake(snowflake.ctx, size)

  return {
    soft: toTexture(soft.canvas),
    glow: toTexture(glow.canvas),
    spark: toTexture(spark.canvas),
    smoke: toTexture(smoke.canvas),
    snowflake: toTexture(snowflake.canvas)
  }
}

export function disposeEffectTextures(textures: EffectTextures): void {
  textures.soft.dispose()
  textures.glow.dispose()
  textures.spark.dispose()
  textures.smoke.dispose()
  textures.snowflake.dispose()
}
