/**
 * 实时 CFD 可视化：彩虹体渲染、切片、等值面、流线粒子、米色城市白模。
 */

import * as Cesium from 'cesium'
import type { CityModel } from '../sunshine-lib/city'
import { localToLonLat } from '../sunshine-lib/city'
import type { LbmD3Q19 } from './cfd-lbm'

const SPEED_STOPS: [number, number, number][] = [
  [1, 0, 140],
  [0, 50, 255],
  [0, 210, 255],
  [40, 230, 70],
  [255, 255, 0],
  [255, 90, 0],
  [180, 0, 0]
]

export function speedColor(t: number): [number, number, number] {
  const c = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0
  const scaled = c * (SPEED_STOPS.length - 1)
  const i = Math.min(SPEED_STOPS.length - 2, Math.max(0, Math.floor(scaled)))
  const local = scaled - i
  const a = SPEED_STOPS[i] ?? SPEED_STOPS[0]
  const b = SPEED_STOPS[i + 1] ?? a
  return [
    Math.round(a[0] + (b[0] - a[0]) * local),
    Math.round(a[1] + (b[1] - a[1]) * local),
    Math.round(a[2] + (b[2] - a[2]) * local)
  ]
}

export function speedGradientCss(): string {
  return `linear-gradient(90deg, ${SPEED_STOPS.map((rgb) => `rgb(${rgb.join(',')})`).join(', ')})`
}

function toPosition(city: CityModel, x: number, y: number, z: number): Cesium.Cartesian3 {
  const { lon, lat } = localToLonLat(city, x, y)
  return Cesium.Cartesian3.fromDegrees(lon, lat, z)
}

function blitToMaterial(material: Cesium.Material, canvas: HTMLCanvasElement): void {
  const bag = material as unknown as {
    uniforms: { image: HTMLCanvasElement }
    _textures?: Record<string, { width?: number; height?: number; copyFrom?: (options: { source: HTMLCanvasElement }) => void }>
  }
  const texture = bag._textures?.image
  const ready =
    texture &&
    typeof texture.copyFrom === 'function' &&
    texture.width === canvas.width &&
    texture.height === canvas.height
  if (ready && texture?.copyFrom) texture.copyFrom({ source: canvas })
  else bag.uniforms.image = canvas
}

export function renderRegionBox(
  viewer: Cesium.Viewer,
  city: CityModel,
  width: number,
  depth: number,
  height: number
): Cesium.Entity {
  const pos = Cesium.Cartesian3.fromDegrees(city.center.lon, city.center.lat, height / 2)
  return viewer.entities.add({
    position: pos,
    orientation: Cesium.Transforms.headingPitchRollQuaternion(pos, new Cesium.HeadingPitchRoll(0, 0, 0)),
    box: {
      dimensions: new Cesium.Cartesian3(width, depth, height),
      fill: false,
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString('#7fd0e6').withAlpha(0.85)
    }
  })
}

export function renderCfdBuildings(viewer: Cesium.Viewer, city: CityModel): Cesium.Entity[] {
  const entities: Cesium.Entity[] = []
  for (const building of city.buildings) {
    const t = Math.max(0, Math.min(1, building.topHeight / 180))
    const r = Math.round(210 - t * 62)
    const g = Math.round(196 - t * 58)
    const b = Math.round(168 - t * 52)
    const positions = Cesium.Cartesian3.fromDegreesArray([
      building.west, building.south,
      building.east, building.south,
      building.east, building.north,
      building.west, building.north
    ])
    entities.push(
      viewer.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          height: building.baseHeight,
          extrudedHeight: building.topHeight,
          material: Cesium.Color.fromBytes(r, g, b, 255),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#3a3328').withAlpha(0.72),
          closeTop: true,
          closeBottom: false
        }
      })
    )
  }
  return entities
}

export class SliceOverlay {
  private viewer: Cesium.Viewer
  private city: CityModel
  private primitive: Cesium.Primitive | undefined
  private appearance: Cesium.EllipsoidSurfaceAppearance
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D | null
  private currentHeight = Number.NaN
  private width: number
  private depth: number

  constructor(viewer: Cesium.Viewer, city: CityModel, solver: LbmD3Q19, height: number) {
    this.viewer = viewer
    this.city = city
    this.width = solver.width
    this.depth = solver.depth
    this.canvas = document.createElement('canvas')
    this.canvas.width = solver.nx * 4
    this.canvas.height = solver.ny * 4
    this.ctx = this.canvas.getContext('2d')
    this.appearance = new Cesium.EllipsoidSurfaceAppearance({
      material: Cesium.Material.fromType('Image', {
        image: this.canvas,
        repeat: new Cesium.Cartesian2(1, 1),
        color: Cesium.Color.WHITE
      }),
      aboveGround: true,
      flat: true,
      translucent: true
    })
    this.appearance.material.translucent = true
    this.currentHeight = height
    this.rebuild()
  }

  private rectangle(): Cesium.Rectangle {
    const sw = localToLonLat(this.city, -this.width / 2, -this.depth / 2)
    const ne = localToLonLat(this.city, this.width / 2, this.depth / 2)
    return Cesium.Rectangle.fromDegrees(sw.lon, sw.lat, ne.lon, ne.lat)
  }

  private rebuild(): void {
    if (this.primitive) {
      this.viewer.scene.primitives.remove(this.primitive)
      this.primitive = undefined
    }
    const rect = this.rectangle()
    this.primitive = this.viewer.scene.primitives.add(
      new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(
              Cesium.Cartesian3.fromDegreesArray([
                Cesium.Math.toDegrees(rect.west),
                Cesium.Math.toDegrees(rect.south),
                Cesium.Math.toDegrees(rect.east),
                Cesium.Math.toDegrees(rect.south),
                Cesium.Math.toDegrees(rect.east),
                Cesium.Math.toDegrees(rect.north),
                Cesium.Math.toDegrees(rect.west),
                Cesium.Math.toDegrees(rect.north)
              ])
            ),
            height: this.currentHeight,
            vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT
          })
        }),
        appearance: this.appearance,
        asynchronous: false,
        allowPicking: false
      })
    )
  }

  update(solver: LbmD3Q19, layer: number, maxSpeed: number, opacity: number, height: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const scale = 4
    const cw = solver.nx * scale
    const ch = solver.ny * scale
    if (this.width !== solver.width || this.depth !== solver.depth) {
      this.width = solver.width
      this.depth = solver.depth
      this.rebuild()
    }
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw
      this.canvas.height = ch
    }
    const image = ctx.createImageData(cw, ch)
    const data = image.data
    const denom = Math.max(1e-6, Number.isFinite(solver.maxPhi) ? solver.maxPhi : 0, Number.isFinite(maxSpeed) ? maxSpeed : 0)
    const alphaScale = Math.max(0, Math.min(1, opacity))
    const z = Math.max(0, Math.min(solver.nz - 1, layer))
    const speedDenom = Math.max(1e-6, Number.isFinite(maxSpeed) ? maxSpeed : solver.maxSpeed)
    for (let row = 0; row < ch; row += 1) {
      const gy = (ch - 1 - row) / scale
      const y0 = Math.min(solver.ny - 1, Math.max(0, gy | 0))
      const y1 = Math.min(solver.ny - 1, y0 + 1)
      const ty = gy - y0
      for (let col = 0; col < cw; col += 1) {
        const gx = col / scale
        const x0 = Math.min(solver.nx - 1, Math.max(0, gx | 0))
        const x1 = Math.min(solver.nx - 1, x0 + 1)
        const tx = gx - x0
        const i00 = solver.cellIndex(x0, y0, z)
        const i10 = solver.cellIndex(x1, y0, z)
        const i01 = solver.cellIndex(x0, y1, z)
        const i11 = solver.cellIndex(x1, y1, z)
        const sample = (field: Float32Array, cell: number): number => (solver.solid[cell] ? 0 : field[cell])
        const phi =
          (sample(solver.phi, i00) * (1 - tx) + sample(solver.phi, i10) * tx) * (1 - ty) +
          (sample(solver.phi, i01) * (1 - tx) + sample(solver.phi, i11) * tx) * ty
        const spd =
          (sample(solver.speed, i00) * (1 - tx) + sample(solver.speed, i10) * tx) * (1 - ty) +
          (sample(solver.speed, i01) * (1 - tx) + sample(solver.speed, i11) * tx) * ty
        const tPhi = Number.isFinite(phi) ? Math.min(1, phi / denom) : 0
        const tSpd = Number.isFinite(spd) ? Math.min(1, spd / speedDenom) : 0
        const t = Math.max(tPhi, tSpd * 0.72)
        const [r, g, b] = speedColor(t)
        const idx = (row * cw + col) * 4
        data[idx] = r
        data[idx + 1] = g
        data[idx + 2] = b
        data[idx + 3] = Math.round((t < 0.02 ? 0.28 : 0.55 + t * 0.45) * alphaScale * 255)
      }
    }
    ctx.putImageData(image, 0, 0)
    blitToMaterial(this.appearance.material, this.canvas)
    if (Math.abs(height - this.currentHeight) > 0.2) {
      this.currentHeight = height
      this.rebuild()
    }
  }

  setVisible(visible: boolean): void {
    if (this.primitive) this.primitive.show = visible
  }

  destroy(): void {
    if (this.primitive) {
      this.viewer.scene.primitives.remove(this.primitive)
      this.primitive = undefined
    }
  }
}

type VolumeLayer = {
  primitive: Cesium.Primitive
  appearance: Cesium.EllipsoidSurfaceAppearance
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  z: number
}

/** 多层半透明切片堆叠，形成视频中的彩虹三维烟羽。 */
export class VolumeStack {
  private viewer: Cesium.Viewer
  private city: CityModel
  private layers: VolumeLayer[] = []
  private nx = 0
  private ny = 0
  private nz = 0
  private visible = true
  private readonly scale = 3

  constructor(viewer: Cesium.Viewer, city: CityModel, solver: LbmD3Q19) {
    this.viewer = viewer
    this.city = city
    this.rebuild(solver)
  }

  private corners(solver: LbmD3Q19): Cesium.Cartesian3[] {
    const sw = localToLonLat(this.city, -solver.width / 2, -solver.depth / 2)
    const se = localToLonLat(this.city, solver.width / 2, -solver.depth / 2)
    const ne = localToLonLat(this.city, solver.width / 2, solver.depth / 2)
    const nw = localToLonLat(this.city, -solver.width / 2, solver.depth / 2)
    return Cesium.Cartesian3.fromDegreesArray([sw.lon, sw.lat, se.lon, se.lat, ne.lon, ne.lat, nw.lon, nw.lat])
  }

  rebuild(solver: LbmD3Q19): void {
    this.destroy()
    this.nx = solver.nx
    this.ny = solver.ny
    this.nz = solver.nz
    const positions = this.corners(solver)
    const cw = solver.nx * this.scale
    const ch = solver.ny * this.scale
    for (let z = 1; z < solver.nz; z += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = cw
      canvas.height = ch
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      const appearance = new Cesium.EllipsoidSurfaceAppearance({
        material: Cesium.Material.fromType('Image', {
          image: canvas,
          repeat: new Cesium.Cartesian2(1, 1),
          color: Cesium.Color.WHITE
        }),
        aboveGround: true,
        flat: true,
        translucent: true
      })
      appearance.material.translucent = true
      const height = solver.originZ + (z + 0.5) * solver.dz
      const primitive = this.viewer.scene.primitives.add(
        new Cesium.Primitive({
          geometryInstances: new Cesium.GeometryInstance({
            geometry: new Cesium.PolygonGeometry({
              polygonHierarchy: new Cesium.PolygonHierarchy(positions),
              height,
              vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT
            })
          }),
          appearance,
          asynchronous: false,
          allowPicking: false
        })
      )
      primitive.show = this.visible
      this.layers.push({ primitive, appearance, canvas, ctx, z })
    }
  }

  update(solver: LbmD3Q19, opacity: number): void {
    if (solver.nx !== this.nx || solver.ny !== this.ny || solver.nz !== this.nz) {
      this.rebuild(solver)
    }
    const denom = Math.max(1e-6, Number.isFinite(solver.maxPhi) ? solver.maxPhi : 1)
    const alphaScale = Math.max(0, Math.min(1, opacity))
    const scale = this.scale
    for (const layer of this.layers) {
      const { canvas, ctx, z } = layer
      const w = canvas.width
      const h = canvas.height
      const image = ctx.createImageData(w, h)
      const data = image.data
      for (let row = 0; row < h; row += 1) {
        const gy = (h - 1 - row) / scale
        const y0 = Math.min(solver.ny - 1, Math.max(0, gy | 0))
        const y1 = Math.min(solver.ny - 1, y0 + 1)
        const ty = gy - y0
        for (let col = 0; col < w; col += 1) {
          const gx = col / scale
          const x0 = Math.min(solver.nx - 1, Math.max(0, gx | 0))
          const x1 = Math.min(solver.nx - 1, x0 + 1)
          const tx = gx - x0
          const i00 = solver.cellIndex(x0, y0, z)
          const i10 = solver.cellIndex(x1, y0, z)
          const i01 = solver.cellIndex(x0, y1, z)
          const i11 = solver.cellIndex(x1, y1, z)
          const v00 = solver.solid[i00] ? 0 : solver.phi[i00]
          const v10 = solver.solid[i10] ? 0 : solver.phi[i10]
          const v01 = solver.solid[i01] ? 0 : solver.phi[i01]
          const v11 = solver.solid[i11] ? 0 : solver.phi[i11]
          const value = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty
          const idx = (row * w + col) * 4
          if (!Number.isFinite(value) || value <= 0.045) {
            data[idx + 3] = 0
            continue
          }
          const t = Math.min(1, value / denom)
          const [r, g, b] = speedColor(t)
          data[idx] = r
          data[idx + 1] = g
          data[idx + 2] = b
          data[idx + 3] = Math.round((0.07 + Math.pow(t, 0.65) * 0.7) * alphaScale * 255)
        }
      }
      ctx.putImageData(image, 0, 0)
      blitToMaterial(layer.appearance.material, canvas)
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    for (const layer of this.layers) layer.primitive.show = visible
  }

  destroy(): void {
    for (const layer of this.layers) this.viewer.scene.primitives.remove(layer.primitive)
    this.layers = []
  }
}

export class SpeedPointCloud {
  private collection: Cesium.PointPrimitiveCollection
  private points: Cesium.PointPrimitive[] = []
  private city: CityModel

  constructor(viewer: Cesium.Viewer, city: CityModel) {
    this.city = city
    this.collection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection())
  }

  update(solver: LbmD3Q19, mode: 'volume' | 'iso', isoValue: number, maxSpeed: number, opacity: number, stride: number): void {
    const denom = Math.max(1e-6, solver.maxPhi || maxSpeed)
    const alpha = Math.max(0, Math.min(1, opacity))
    let cursor = 0
    const band = Math.max(0.008, isoValue * 0.28)
    for (let z = 1; z < solver.nz; z += stride) {
      for (let y = 0; y < solver.ny; y += stride) {
        for (let x = 0; x < solver.nx; x += stride) {
          const cell = solver.cellIndex(x, y, z)
          if (solver.solid[cell]) continue
          const mag = solver.phi[cell]
          if (mode === 'volume' && mag < 0.08) continue
          if (mode === 'iso' && Math.abs(mag - isoValue) > band) continue
          const px = solver.originX + (x + 0.5) * solver.dx
          const py = solver.originY + (y + 0.5) * solver.dy
          const pz = solver.originZ + (z + 0.5) * solver.dz
          const t = Math.min(1, mag / denom)
          const [r, g, b] = speedColor(t)
          const color = Cesium.Color.fromBytes(r, g, b, Math.round((mode === 'iso' ? 0.9 : 0.18 + t * 0.7) * alpha * 255))
          const pixelSize = mode === 'iso' ? 5 : 3.2 + t * 2.4
          if (cursor < this.points.length) {
            const point = this.points[cursor]
            point.position = toPosition(this.city, px, py, pz)
            point.color = color
            point.pixelSize = pixelSize
            point.show = true
          } else {
            this.points.push(
              this.collection.add({
                position: toPosition(this.city, px, py, pz),
                color,
                pixelSize,
                disableDepthTestDistance: 0
              })
            )
          }
          cursor += 1
          if (cursor >= 4200) {
            for (let i = cursor; i < this.points.length; i += 1) this.points[i].show = false
            return
          }
        }
      }
    }
    for (let i = cursor; i < this.points.length; i += 1) this.points[i].show = false
  }

  setVisible(visible: boolean): void {
    this.collection.show = visible
  }

  destroy(viewer: Cesium.Viewer): void {
    viewer.scene.primitives.remove(this.collection)
    this.points = []
  }
}

type DriftParticle = {
  x: number
  y: number
  z: number
  age: number
  billboard: Cesium.Billboard
}

function particleImage(): string {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,0.95)')
  g.addColorStop(0.45, 'rgba(127,208,230,0.55)')
  g.addColorStop(1, 'rgba(127,208,230,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.fill()
  return canvas.toDataURL('image/png')
}

const FLOW_PARTICLE_IMAGE = particleImage()

export class FlowParticles {
  private collection: Cesium.BillboardCollection
  private particles: DriftParticle[] = []
  private removeListener: (() => void) | undefined
  private city: CityModel
  private solver: LbmD3Q19 | undefined
  private opacity = 0.85
  private dt = 4
  playing = true

  constructor(viewer: Cesium.Viewer, city: CityModel, count: number) {
    this.city = city
    this.collection = viewer.scene.primitives.add(new Cesium.BillboardCollection({ scene: viewer.scene }))
    this.spawn(count)
    this.removeListener = viewer.scene.preRender.addEventListener(() => this.tick())
  }

  private spawnOne(): { x: number; y: number; z: number; age: number } {
    const solver = this.solver
    if (!solver) return { x: 0, y: 0, z: 8, age: 0 }
    const wind = solver.windVector()
    const inletX = Math.abs(wind.x) >= Math.abs(wind.y)
    const low = inletX ? wind.x > 0 : wind.y > 0
    const jitter = () => (Math.random() + Math.random() - 1) * 0.22
    const midZ = solver.height * 0.42 + jitter() * solver.height
    if (inletX) {
      const x = solver.originX + (low ? 2 + Math.random() * solver.dx * 2 : solver.width - 2 - Math.random() * solver.dx * 2)
      const y = solver.originY + solver.depth * (0.5 + jitter())
      return { x, y, z: Math.max(4, midZ), age: Math.random() * 40 }
    }
    const y = solver.originY + (low ? 2 + Math.random() * solver.dy * 2 : solver.depth - 2 - Math.random() * solver.dy * 2)
    const x = solver.originX + solver.width * (0.5 + jitter())
    return { x, y, z: Math.max(4, midZ), age: Math.random() * 40 }
  }

  private spawn(count: number): void {
    for (let i = 0; i < count; i += 1) {
      const seed = this.spawnOne()
      const billboard = this.collection.add({
        position: toPosition(this.city, seed.x, seed.y, seed.z),
        image: FLOW_PARTICLE_IMAGE,
        color: Cesium.Color.fromCssColorString('#7fd0e6').withAlpha(this.opacity),
        scale: 0.42,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      })
      this.particles.push({ ...seed, billboard })
    }
  }

  setSolver(solver: LbmD3Q19): void {
    this.solver = solver
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity
  }

  setVisible(visible: boolean): void {
    this.collection.show = visible
  }

  resize(count: number): void {
    while (this.particles.length > count) {
      const item = this.particles.pop()
      if (item) this.collection.remove(item.billboard)
    }
    if (this.particles.length < count) this.spawn(count - this.particles.length)
  }

  private tick(): void {
    const solver = this.solver
    if (!solver || !this.collection.show || !this.playing) return
    const denom = Math.max(1e-6, solver.maxSpeed)
    for (const particle of this.particles) {
      const sample = solver.sample(particle.x, particle.y, particle.z)
      if (sample.solid || particle.age > 220) {
        const seed = this.spawnOne()
        particle.x = seed.x
        particle.y = seed.y
        particle.z = seed.z
        particle.age = 0
      } else {
        particle.x += sample.ux * this.dt * solver.dx
        particle.y += sample.uy * this.dt * solver.dy
        particle.z += sample.uz * this.dt * solver.dz
        particle.age += 1
      }
      const mag = Math.hypot(sample.ux, sample.uy, sample.uz)
      const t = Math.min(1, mag / denom)
      const [r, g, b] = speedColor(t)
      particle.billboard.position = toPosition(this.city, particle.x, particle.y, particle.z)
      particle.billboard.color = Cesium.Color.fromBytes(r, g, b, Math.round(this.opacity * 255))
    }
  }

  destroy(viewer: Cesium.Viewer): void {
    if (this.removeListener) this.removeListener()
    viewer.scene.primitives.remove(this.collection)
    this.particles = []
  }
}

export function renderWindArrow(viewer: Cesium.Viewer, city: CityModel, direction: number, width: number): Cesium.Entity[] {
  const toward = ((direction + 180) % 360) * (Math.PI / 180)
  const dir = { x: Math.sin(toward), y: Math.cos(toward) }
  const perp = { x: -dir.y, y: dir.x }
  const length = width * 0.28
  const tipX = dir.x * length
  const tipY = dir.y * length
  const tailX = -dir.x * length
  const tailY = -dir.y * length
  const head = 18
  const wing = 12
  const z = 96
  const shaft = viewer.entities.add({
    polyline: {
      positions: [toPosition(city, tailX, tailY, z), toPosition(city, tipX, tipY, z)],
      width: 4,
      material: Cesium.Color.fromCssColorString('#7fd0e6')
    }
  })
  const left = viewer.entities.add({
    polyline: {
      positions: [
        toPosition(city, tipX, tipY, z),
        toPosition(city, tipX - dir.x * head + perp.x * wing, tipY - dir.y * head + perp.y * wing, z)
      ],
      width: 3,
      material: Cesium.Color.fromCssColorString('#7fd0e6')
    }
  })
  const right = viewer.entities.add({
    polyline: {
      positions: [
        toPosition(city, tipX, tipY, z),
        toPosition(city, tipX - dir.x * head - perp.x * wing, tipY - dir.y * head - perp.y * wing, z)
      ],
      width: 3,
      material: Cesium.Color.fromCssColorString('#7fd0e6')
    }
  })
  return [shaft, left, right]
}

export function updateWindArrow(entities: Cesium.Entity[], city: CityModel, direction: number, width: number): void {
  const toward = ((direction + 180) % 360) * (Math.PI / 180)
  const dir = { x: Math.sin(toward), y: Math.cos(toward) }
  const perp = { x: -dir.y, y: dir.x }
  const length = width * 0.28
  const tipX = dir.x * length
  const tipY = dir.y * length
  const tailX = -dir.x * length
  const tailY = -dir.y * length
  const head = 18
  const wing = 12
  const z = 96
  const parts = [
    [toPosition(city, tailX, tailY, z), toPosition(city, tipX, tipY, z)],
    [toPosition(city, tipX, tipY, z), toPosition(city, tipX - dir.x * head + perp.x * wing, tipY - dir.y * head + perp.y * wing, z)],
    [toPosition(city, tipX, tipY, z), toPosition(city, tipX - dir.x * head - perp.x * wing, tipY - dir.y * head - perp.y * wing, z)]
  ]
  parts.forEach((positions, index) => {
    const entity = entities[index]
    if (entity?.polyline) entity.polyline.positions = new Cesium.ConstantProperty(positions)
  })
}
