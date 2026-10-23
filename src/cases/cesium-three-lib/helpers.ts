import * as THREE from 'three'

export interface SurfaceOptions {
  transparent?: boolean
  opacity?: number
  roughness?: number
  metalness?: number
  emissive?: string
  emissiveIntensity?: number
  side?: THREE.Side
  flatShading?: boolean
  depthWrite?: boolean
}

export function surface(color: string, options: SurfaceOptions = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    transparent: options.transparent,
    opacity: options.opacity ?? 1,
    roughness: options.roughness ?? 0.72,
    metalness: options.metalness ?? 0.08,
    emissive: options.emissive ? new THREE.Color(options.emissive) : undefined,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    side: options.side,
    flatShading: options.flatShading,
    depthWrite: options.depthWrite
  })
}

export function basic(color: string, opacity = 1, side: THREE.Side = THREE.FrontSide): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side })
}

export function addBox(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
  rotation?: [number, number, number]
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material)
  mesh.position.set(position[0], position[1], position[2])
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2])
  parent.add(mesh)
  return mesh
}

export function addSphere(
  parent: THREE.Object3D,
  radius: number,
  position: [number, number, number],
  material: THREE.Material,
  segments = 20
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, Math.max(8, segments / 2)), material)
  mesh.position.set(position[0], position[1], position[2])
  parent.add(mesh)
  return mesh
}

export function addCylinder(
  parent: THREE.Object3D,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  position: [number, number, number],
  material: THREE.Material,
  segments = 20
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material)
  mesh.position.set(position[0], position[1], position[2])
  parent.add(mesh)
  return mesh
}

export function addLine(
  parent: THREE.Object3D,
  points: THREE.Vector3[],
  color: string,
  opacity = 0.8,
  width = 1
): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  const material = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, linewidth: width })
  const line = new THREE.Line(geometry, material)
  parent.add(line)
  return line
}

export function addStageGround(
  parent: THREE.Object3D,
  radius: number,
  colors: { disc?: string; grid?: string; ring?: string; accent?: string } = {}
): THREE.Group {
  const group = new THREE.Group()
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 72),
    surface(colors.disc ?? '#15222c', { roughness: 0.95 })
  )
  disc.rotation.x = -Math.PI / 2
  disc.position.y = -0.02
  group.add(disc)

  const grid = new THREE.GridHelper(radius * 2, Math.max(12, Math.round(radius / 10)), colors.grid ?? '#2a4354', colors.grid ?? '#233947')
  const gridMaterial = grid.material as THREE.Material
  gridMaterial.transparent = true
  gridMaterial.opacity = 0.32
  grid.position.y = 0.01
  group.add(grid)

  for (const scale of [1, 0.72, 0.48]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * scale - 0.6, radius * scale, 96),
      basic(colors.ring ?? colors.accent ?? '#4fb3d9', 0.24, THREE.DoubleSide)
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.02
    group.add(ring)
  }

  parent.add(group)
  return group
}

export function addPillar(
  parent: THREE.Object3D,
  position: [number, number, number],
  width: number,
  height: number,
  depth: number,
  color: string,
  windows = true
): THREE.Group {
  const group = new THREE.Group()
  group.position.set(position[0], position[1], position[2])
  const body = addBox(group, [width, height, depth], [0, height / 2, 0], surface(color, { roughness: 0.86 }))
  body.name = 'body'
  if (windows) {
    const stripeCount = Math.max(1, Math.floor(height / 7))
    for (let i = 1; i <= stripeCount; i += 1) {
      const stripe = addBox(
        group,
        [width * 0.86, Math.max(0.3, height * 0.018), depth * 0.86],
        [0, (height / (stripeCount + 1)) * i, 0],
        surface('#7fd0e6', { emissive: '#2e9dc0', emissiveIntensity: 0.9, transparent: true, opacity: 0.55 })
      )
      stripe.renderOrder = 2
    }
  }
  parent.add(group)
  return group
}

export function addRoute(
  parent: THREE.Object3D,
  points: THREE.Vector3[],
  color: string,
  radius = 0.9,
  dashed = false
): THREE.Group {
  const group = new THREE.Group()
  const curve = new THREE.CatmullRomCurve3(points)
  const divisions = Math.max(24, points.length * 16)
  const samples = curve.getPoints(divisions)
  const geometry = new THREE.BufferGeometry().setFromPoints(samples)
  const material = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 3, gapSize: 2.4, transparent: true, opacity: 0.9 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })
  const line = new THREE.Line(geometry, material)
  if (dashed) line.computeLineDistances()
  group.add(line)
  for (let i = 0; i < samples.length; i += 2) {
    const marker = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.8, 8, 6), basic(color, 0.7))
    marker.position.copy(samples[i])
    group.add(marker)
  }
  parent.add(group)
  return group
}

export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(material)) {
      for (const item of material) item.dispose()
    } else if (material) {
      material.dispose()
    }
  })
  object.removeFromParent()
}

export function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function addGlowPoints(
  parent: THREE.Object3D,
  count: number,
  color: string,
  size: number,
  opacity = 0.85
): THREE.Points {
  const positions = new Float32Array(count * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color,
    size,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const points = new THREE.Points(geometry, material)
  parent.add(points)
  return points
}
