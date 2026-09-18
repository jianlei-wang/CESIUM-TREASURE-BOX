import * as THREE from 'three'

export interface LabelOptions {
  color?: string
  fontFamily?: string
  fontSize?: number
  worldHeight?: number
  transparent?: boolean
}

/**
 * Canvas 生成文字 Sprite（对应参考工程 drei Billboard + Text，规避远程字体依赖）。
 * Sprite 自动面向相机。
 */
export function createLabelSprite(text: string, opts: LabelOptions = {}): THREE.Sprite {
  const {
    color = '#ffffff',
    fontFamily = '"Microsoft YaHei", "PingFang SC", sans-serif',
    fontSize = 40,
    worldHeight = 0.8,
    transparent = true,
  } = opts

  const paddingX = fontSize
  const paddingY = fontSize * 0.6
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  ctx.font = `600 ${fontSize}px ${fontFamily}`
  const width = Math.ceil(ctx.measureText(text).width) + paddingX * 2
  canvas.width = width
  canvas.height = Math.ceil(fontSize * 1.6) + paddingY * 2
  ctx.font = `600 ${fontSize}px ${fontFamily}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.85)'
  ctx.shadowBlur = fontSize * 0.4
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  ctx.fillStyle = color
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: true,
  })
  const sprite = new THREE.Sprite(material)
  const aspect = canvas.width / canvas.height
  sprite.scale.set(worldHeight * aspect, worldHeight, 1)
  sprite.center.set(0.5, 0.5)
  return sprite
}

export function disposeSprite(sprite: THREE.Sprite): void {
  sprite.material.map?.dispose()
  sprite.material.dispose()
}
