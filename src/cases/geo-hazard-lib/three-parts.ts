import * as THREE from 'three'
import {
  BASE_Y,
  SLIDE_HALFW,
  ZAP,
  ZB,
  slideBump,
  slideSurf,
  slideThick,
  type RGB
} from './model'

/** 山地灾害演示常用材质集合 */
export interface HazardMaterials {
  terrain: THREE.MeshStandardMaterial
  slide: THREE.MeshStandardMaterial
  slideSurf: THREE.MeshStandardMaterial
  wall: THREE.MeshStandardMaterial
  rock: THREE.MeshStandardMaterial
  fluid: THREE.MeshStandardMaterial
  head: THREE.MeshStandardMaterial
  fan: THREE.MeshStandardMaterial
  eng: THREE.MeshStandardMaterial
  eng2: THREE.MeshStandardMaterial
  house: THREE.MeshStandardMaterial
  roof: THREE.MeshStandardMaterial
  trunk: THREE.MeshStandardMaterial
  leaf: THREE.MeshStandardMaterial
  road: THREE.MeshStandardMaterial
  line: THREE.LineBasicMaterial
}

export function createHazardMaterials(): HazardMaterials {
  const std = (color: number, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra })
  return {
    terrain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }),
    slide: std(0x8a6a42, 0.98),
    slideSurf: std(0xe0b64a, 0.7, {
      metalness: 0.05,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false
    }),
    wall: std(0x8c8579, 1.0, { side: THREE.DoubleSide }),
    rock: std(0x6f6555, 1.0),
    fluid: std(0x5e4326, 0.85, { metalness: 0.02 }),
    head: std(0x3b2a19, 0.9, { metalness: 0.02 }),
    fan: std(0xb3a07e, 1.0, { transparent: true, opacity: 0 }),
    eng: std(0x9aa3ab, 0.8, { metalness: 0.05 }),
    eng2: std(0x7d8892, 0.85, { metalness: 0.05 }),
    house: std(0xd8d2c4, 0.9),
    roof: std(0xa85c46, 0.9),
    trunk: std(0x6b4f34, 1),
    leaf: std(0x3f6b34, 1),
    road: std(0x4a4f55, 0.9),
    line: new THREE.LineBasicMaterial({ color: 0x2b1d10, transparent: true, opacity: 0.9 })
  }
}

type HeightFn = (x: number, z: number) => number
type ColorFn = (x: number, z: number, y: number, out: RGB) => RGB

/**
 * 构建带裙边与底面的地形地块（顶面 + 四周裙边 + 底面，带顶点色）。
 * 与参考实现一致，使用局部坐标 (x,z) 直接写入世界坐标。
 */
export function buildTerrainBlock(
  w: number,
  d: number,
  hfn: HeightFn,
  cfn: ColorFn,
  nx: number,
  nz: number,
  material: THREE.Material
): THREE.Mesh {
  const P: number[] = []
  const C: number[] = []
  const I: number[] = []
  const vid = (a: number, b: number): number => b * (nx + 1) + a
  const rgb: RGB = [0, 0, 0]

  for (let j = 0; j <= nz; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      const lx = -w / 2 + (i / nx) * w
      const lz = -d / 2 + (j / nz) * d
      const y = Math.max(hfn(lx, lz), 0.06)
      P.push(lx, y, lz)
      cfn(lx, lz, y, rgb)
      C.push(rgb[0], rgb[1], rgb[2])
    }
  }
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      I.push(vid(i, j), vid(i, j + 1), vid(i + 1, j + 1))
      I.push(vid(i, j), vid(i + 1, j + 1), vid(i + 1, j))
    }
  }

  const base = BASE_Y
  const botC: RGB = [0.3, 0.22, 0.15]
  const addSkirt = (pts: number[][]): void => {
    const startIdx = P.length / 3
    for (let k = 0; k < pts.length; k += 1) {
      P.push(pts[k][0], pts[k][1], pts[k][2])
      C.push(pts[k][3], pts[k][4], pts[k][5])
      P.push(pts[k][0], base, pts[k][2])
      C.push(botC[0], botC[1], botC[2])
    }
    for (let k = 0; k < pts.length - 1; k += 1) {
      const a0 = startIdx + k * 2
      const b0 = a0 + 1
      const c0 = a0 + 2
      const d0 = a0 + 3
      I.push(a0, d0, b0)
      I.push(a0, c0, d0)
    }
  }
  const top: number[][] = []
  const right: number[][] = []
  const bottom: number[][] = []
  const left: number[][] = []
  for (let i = 0; i <= nx; i += 1) {
    const id = vid(i, 0) * 3
    top.push([P[id], P[id + 1], P[id + 2], C[id], C[id + 1], C[id + 2]])
  }
  for (let j = 0; j <= nz; j += 1) {
    const id = vid(nx, j) * 3
    right.push([P[id], P[id + 1], P[id + 2], C[id], C[id + 1], C[id + 2]])
  }
  for (let i = nx; i >= 0; i -= 1) {
    const id = vid(i, nz) * 3
    bottom.push([P[id], P[id + 1], P[id + 2], C[id], C[id + 1], C[id + 2]])
  }
  for (let j = nz; j >= 0; j -= 1) {
    const id = vid(0, j) * 3
    left.push([P[id], P[id + 1], P[id + 2], C[id], C[id + 1], C[id + 2]])
  }
  addSkirt(top)
  addSkirt(right)
  addSkirt(bottom)
  addSkirt(left)

  // 底面
  const bIdx = P.length / 3
  P.push(-w / 2, base, -d / 2)
  C.push(botC[0], botC[1], botC[2])
  P.push(w / 2, base, -d / 2)
  C.push(botC[0], botC[1], botC[2])
  P.push(w / 2, base, d / 2)
  C.push(botC[0], botC[1], botC[2])
  P.push(-w / 2, base, d / 2)
  C.push(botC[0], botC[1], botC[2])
  I.push(bIdx, bIdx + 1, bIdx + 2)
  I.push(bIdx, bIdx + 2, bIdx + 3)

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3))
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3))
  g.setIndex(I)
  g.computeVertexNormals()
  const m = new THREE.Mesh(g, material)
  m.receiveShadow = true
  m.castShadow = true
  return m
}

/** 简易房屋（墙体 + 四坡屋顶） */
export function makeHouse(w: number, h: number, dp: number, mats: HazardMaterials): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, dp), mats.house)
  body.position.y = h / 2
  body.castShadow = true
  body.receiveShadow = true
  const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.86, h * 0.6, 4), mats.roof)
  roof.position.y = h + h * 0.3
  roof.rotation.y = Math.PI / 4
  roof.castShadow = true
  g.add(body, roof)
  return g
}

/** 简易树木（树干 + 锥形树冠） */
export function makeTree(s: number, mats: HazardMaterials): THREE.Group {
  const g = new THREE.Group()
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.22 * s, 1.3 * s, 6), mats.trunk)
  tr.position.y = 0.65 * s
  const lf = new THREE.Mesh(new THREE.ConeGeometry(0.95 * s, 2.4 * s, 6), mats.leaf)
  lf.position.y = 2.2 * s
  lf.castShadow = true
  g.add(tr, lf)
  return g
}

/* ==================================================================
   滑体几何（顶面 = 原始坡面，底面 = 滑动面，边界收薄）
   ================================================================== */
export interface SlideBodyData {
  geo: THREE.BufferGeometry
  meta: Float32Array
  last: number
}

export function buildSlideBody(): SlideBodyData {
  const nx = 40
  const nz = 64
  const P: number[] = []
  const I: number[] = []
  const x0 = -SLIDE_HALFW
  const x1 = SLIDE_HALFW
  const z0 = ZAP + 0.15
  const z1 = ZB - 0.15
  const vid = (a: number, b: number): number => b * (nx + 1) + a

  for (let j = 0; j <= nz; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      const x = x0 + ((x1 - x0) * i) / nx
      const z = z0 + ((z1 - z0) * j) / nz
      const th = Math.max(slideThick(x, z), 0.12)
      P.push(x, slideSurf(x, z) + th + slideBump(z), z)
      P.push(x, slideSurf(x, z), z)
    }
  }
  const top: number[] = []
  const bot: number[] = []
  for (let j = 0; j <= nz; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      top.push(vid(i, j) * 2)
      bot.push(vid(i, j) * 2 + 1)
    }
  }
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      I.push(top[vid(i, j)], top[vid(i, j + 1)], top[vid(i + 1, j + 1)])
      I.push(top[vid(i, j)], top[vid(i + 1, j + 1)], top[vid(i + 1, j)])
      I.push(bot[vid(i, j)], bot[vid(i + 1, j + 1)], bot[vid(i, j + 1)])
      I.push(bot[vid(i, j)], bot[vid(i + 1, j)], bot[vid(i + 1, j + 1)])
    }
  }
  const edge: number[][] = []
  for (let i = 0; i <= nx; i += 1) edge.push([i, 0])
  for (let j = 1; j <= nz; j += 1) edge.push([nx, j])
  for (let i = nx - 1; i >= 0; i -= 1) edge.push([i, nz])
  for (let j = nz - 1; j >= 1; j -= 1) edge.push([0, j])
  for (let i = 0; i < edge.length; i += 1) {
    const a = edge[i]
    const b = edge[(i + 1) % edge.length]
    const ta = top[vid(a[0], a[1])]
    const tb = top[vid(b[0], b[1])]
    const ba = bot[vid(a[0], a[1])]
    const bb = bot[vid(b[0], b[1])]
    I.push(ta, bb, ba)
    I.push(ta, tb, bb)
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3))
  g.setIndex(I)
  g.computeVertexNormals()

  // 记录每个顶点随体坐标，供滑动时沿滑面变形使用：[x, zLocal, thickness, isTop]
  const meta = new Float32Array((P.length / 3) * 4)
  for (let j = 0; j <= nz; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      const x = x0 + ((x1 - x0) * i) / nx
      const z = z0 + ((z1 - z0) * j) / nz
      const th = Math.max(slideThick(x, z), 0.12)
      const id = vid(i, j) * 2
      meta[id * 4] = x
      meta[id * 4 + 1] = z
      meta[id * 4 + 2] = th
      meta[id * 4 + 3] = 1
      meta[(id + 1) * 4] = x
      meta[(id + 1) * 4 + 1] = z
      meta[(id + 1) * 4 + 2] = th
      meta[(id + 1) * 4 + 3] = 0
    }
  }
  return { geo: g, meta, last: -999 }
}

/** 滑体沿滑动面变形流动：底面始终贴合滑床，顶面保持随体厚度 */
export function deformSlideBody(data: SlideBodyData, s: number): void {
  if (Math.abs(s - data.last) < 0.004) return
  data.last = s
  const pos = data.geo.attributes.position as THREE.BufferAttribute
  const arr = pos.array as Float32Array
  const m = data.meta
  for (let i = 0, n = arr.length / 3; i < n; i += 1) {
    const x = m[i * 4]
    const zl = m[i * 4 + 1]
    const th = m[i * 4 + 2]
    const isTop = m[i * 4 + 3]
    const z = zl + s
    let y = slideSurf(x, z) + 0.15
    if (isTop === 1) y += th + slideBump(zl)
    arr[i * 3] = x
    arr[i * 3 + 1] = y
    arr[i * 3 + 2] = z
  }
  pos.needsUpdate = true
  data.geo.computeVertexNormals()
  data.geo.computeBoundingSphere()
}

/** 后缘 / 前缘弧形裂缝 */
export function makeArcCrack(
  zc: number,
  halfW: number,
  curve: number,
  hfn: HeightFn,
  material: THREE.LineBasicMaterial
): THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= 26; i += 1) {
    const x = -halfW + (2 * halfW * i) / 26
    const z = zc + curve * (1 - Math.pow(x / halfW, 2))
    pts.push(new THREE.Vector3(x, hfn(x, z) + 0.16, z))
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), material)
}

/** 沿滑体左右边界的纵向剪切裂缝 */
export function makeSideCrack(
  xc: number,
  z0: number,
  z1: number,
  wob: number,
  hfn: HeightFn,
  material: THREE.LineBasicMaterial
): THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= 32; i += 1) {
    const z = z0 + ((z1 - z0) * i) / 32
    const x = xc + wob * Math.sin(z * 0.45)
    pts.push(new THREE.Vector3(x, hfn(x, z) + 0.17, z))
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), material)
}
