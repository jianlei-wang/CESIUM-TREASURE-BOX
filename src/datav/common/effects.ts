import * as THREE from 'three'

/**
 * 星空粒子（对应参考工程 drei Stars 的简化版）。
 */
export function createStars(count = 800, radius = 150): THREE.Points {
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(Math.random()) // 上半球为主
    const r = radius * (0.75 + Math.random() * 0.5)
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * (Math.random() > 0.2 ? 1 : -0.15)
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const dotCanvas = document.createElement('canvas')
  dotCanvas.width = 16
  dotCanvas.height = 16
  const ctx = dotCanvas.getContext('2d')!
  const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.8)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 16, 16)
  const dotTexture = new THREE.CanvasTexture(dotCanvas)

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.9,
    map: dotTexture,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geometry, material)
  return points
}

export interface GridGroundOptions {
  cellSize?: number
  sectionSize?: number
  cellColor?: string
  sectionColor?: string
  opacity?: number
  planeSize?: number
  y?: number
}

/**
 * 无限感地面网格（近似参考工程 drei Grid）：程序化 canvas 网格纹理铺到地面。
 * 纹理四周径向淡出，视觉上向远处自然衰减，避免出现几何边界。
 */
export function createGridGround(opts: GridGroundOptions = {}): THREE.Mesh {
  const {
    cellSize = 0.3,
    sectionSize = 1.5,
    cellColor = '#6f6f6f',
    sectionColor = '#7fe5a8',
    opacity = 0.55,
    planeSize = 480,
    y = 0,
  } = opts

  const texRes = 1024
  const canvas = document.createElement('canvas')
  canvas.width = texRes
  canvas.height = texRes
  const ctx = canvas.getContext('2d')!

  // 每个 repeat 对应 sectionSize（画布内一个 section 大格 8x8 cell）
  const cellsPerSection = Math.round(sectionSize / cellSize)
  const cellPx = texRes / (cellsPerSection * 6) // 每 repeat 覆盖 6 个 section
  const sectionPx = cellPx * cellsPerSection

  const drawGrid = (stepPx: number, color: string, width: number) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.beginPath()
    for (let x = 0; x <= texRes; x += stepPx) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, texRes)
    }
    for (let yLine = 0; yLine <= texRes; yLine += stepPx) {
      ctx.moveTo(0, yLine)
      ctx.lineTo(texRes, yLine)
    }
    ctx.stroke()
  }

  drawGrid(sectionPx, sectionColor, 3)
  drawGrid(cellPx, cellColor, 1)

  // 径向淡出（中心不透明 → 边缘透明）
  const fade = ctx.createRadialGradient(texRes / 2, texRes / 2, texRes * 0.35, texRes / 2, texRes / 2, texRes * 0.72)
  fade.addColorStop(0, 'rgba(0,0,0,0)')
  fade.addColorStop(1, 'rgba(0,0,0,1)')
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = fade
  ctx.fillRect(0, 0, texRes, texRes)
  ctx.globalCompositeOperation = 'source-over'

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping

  // 让一个 repeat 在世界上对应 sectionSize*cellsPerSection*? 直接按 cellSize 推算：
  // 纹理内每 cellPx 像素是一条 cell 线，cell 线在 world 上间距 cellSize，
  // 所以整个纹理平铺的 world 边长 = texRes / cellPx * cellSize
  const repeatWorld = (texRes / cellPx) * cellSize
  const repeat = Math.max(1, Math.floor(planeSize / repeatWorld))
  texture.repeat.set(repeat, repeat)

  const geometry = new THREE.PlaneGeometry(planeSize, planeSize)
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = y
  return mesh
}
