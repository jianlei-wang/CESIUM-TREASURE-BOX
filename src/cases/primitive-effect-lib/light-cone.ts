import {
  BoxGeometry,
  Cartesian3,
  Cartographic,
  Color,
  EllipsoidSurfaceAppearance,
  GeometryInstance,
  GroundPrimitive,
  Material,
  Math as CesiumMath,
  Matrix4,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  PrimitiveCollection,
  Transforms
} from 'cesium'
import {
  CIRCLE_RING_TYPE,
  CIRCLE_ROTATE_TYPE,
  CYLINDER_FADE_TYPE,
  CYLINDER_PARTICLES_TYPE,
  makeCircleImage,
  makeParticlesImage
} from './materials'

export type LightConeOptions = {
  id: string
  position: [number, number, number]
  length?: number
  topRadius?: number
  bottomRadius?: number
  color?: Color
}

class LightConePrimitive extends PrimitiveCollection {
  private _opts: LightConeOptions
  private _particlesImage: HTMLCanvasElement | undefined

  constructor(opts: LightConeOptions) {
    super()
    this._opts = { ...opts }
    this._rebuild()
  }

  setOptions(patch: Partial<LightConeOptions>): void {
    this._opts = { ...this._opts, ...patch }
    this._rebuild()
  }

  private _centerCartesian(): Cartesian3 {
    return Cartesian3.fromDegrees(this._opts.position[0], this._opts.position[1], this._opts.position[2])
  }

  private _computeEllipsePositions(radius: number): Cartesian3[] {
    const center = this._centerCartesian()
    const modelMatrix = Transforms.eastNorthUpToFixedFrame(center)
    const slices = 128
    const pnts: Cartesian3[] = []
    for (let i = 0; i < slices; i++) {
      const angle = (i / slices) * CesiumMath.TWO_PI
      const local = new Cartesian3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
      pnts.push(Matrix4.multiplyByPoint(modelMatrix, local, new Cartesian3()))
    }
    pnts.push(pnts[0])
    return pnts
  }

  private _createCylinderInstance(
    topPts: Cartesian3[],
    bottomPts: Cartesian3[],
    height: number
  ): GeometryInstance {
    const new_pts = bottomPts.slice()
    const length = bottomPts.length
    const len_2 = 2 * length
    const sts: number[] = []
    const st_interval = 1.0 / (length - 1)
    const define_indices: number[] = []
    const ep: Cartesian3[] = []
    const addHeight = (p: Cartesian3, alt = 0): Cartesian3 => {
      const c = Cartographic.fromCartesian(p)
      c.height += alt
      return Cartographic.toCartesian(c)
    }
    for (let i = 0; i < length; i++) {
      ep.push(addHeight(topPts[i], height))
      sts.push(i * st_interval, 0)
      const i_1 = i + 1
      const i_11 = (i + 1) % length
      const len_2_i_1 = len_2 - i_1
      define_indices.push(len_2_i_1 - 1, len_2_i_1, i)
      define_indices.push(i, i_11, len_2_i_1 - 1)
    }
    for (let i = 0; i < ep.length; i++) {
      new_pts.push(ep[length - i - 1])
      sts.push(1 - i * st_interval, 1)
    }
    const polygon = PolygonGeometry.createGeometry(
      new PolygonGeometry({
        polygonHierarchy: new PolygonHierarchy(new_pts),
        perPositionHeight: true
      })
    )
    if (!polygon) {
      const fallback = BoxGeometry.createGeometry(
        new BoxGeometry({ minimum: new Cartesian3(-0.5, -0.5, -0.5), maximum: new Cartesian3(0.5, 0.5, 0.5) })
      )
      return new GeometryInstance({
        geometry: fallback as NonNullable<typeof fallback>
      })
    }
    polygon.indices = define_indices
    const attributes = polygon.attributes as unknown as Record<string, { values?: number[]; setComponentDatatype?: unknown }>
    if (attributes.st) {
      attributes.st.values = sts
    }
    return new GeometryInstance({
      geometry: polygon
    })
  }

  private _rebuild(): void {
    this.removeAll()
    const color = this._opts.color ?? new Color(0.3, 0.7, 1.0, 0.8)
    const length = this._opts.length ?? 400
    const topRadius = this._opts.topRadius ?? 5
    const bottomRadius = this._opts.bottomRadius ?? 150
    const isGround = this._opts.position[2] === 0

    const topPositions = this._computeEllipsePositions(topRadius)
    const innerBottomPositions = this._computeEllipsePositions(bottomRadius * 0.7)
    const bottomPositions = this._computeEllipsePositions(bottomRadius)

    const circleOpt = {
      geometryInstances: new GeometryInstance({
        geometry: new PolygonGeometry({
          polygonHierarchy: new PolygonHierarchy(this._computeEllipsePositions(bottomRadius * 2)),
          perPositionHeight: !isGround
        })
      }),
      asynchronous: false
    }

    const ring = isGround ? new GroundPrimitive(circleOpt) : new Primitive(circleOpt)
    ring.appearance = new EllipsoidSurfaceAppearance({
      material: Material.fromType(CIRCLE_RING_TYPE, { color })
    })

    const circle = isGround ? new GroundPrimitive(circleOpt) : new Primitive(circleOpt)
    circle.appearance = new EllipsoidSurfaceAppearance({
      material: Material.fromType(CIRCLE_ROTATE_TYPE, {
        color,
        image: makeCircleImage()
      })
    })

    const cylinder = new Primitive({
      geometryInstances: this._createCylinderInstance(topPositions, innerBottomPositions, length),
      appearance: new EllipsoidSurfaceAppearance({
        material: Material.fromType(CYLINDER_FADE_TYPE, { color })
      }),
      asynchronous: false
    })

    const addChain = (): void => {
      this.add(ring)
      this.add(circle)
      this.add(cylinder)
    }

    if (isGround) {
      GroundPrimitive.initializeTerrainHeights().then(addChain)
    } else {
      addChain()
    }

    if (!this._particlesImage) this._particlesImage = makeParticlesImage()
    const particles = new Primitive({
      geometryInstances: this._createCylinderInstance(topPositions, bottomPositions, length),
      appearance: new EllipsoidSurfaceAppearance({
        material: Material.fromType(CYLINDER_PARTICLES_TYPE, {
          color,
          image: this._particlesImage
        })
      }),
      asynchronous: false
    })
    this.add(particles)
  }
}

const instances = new Map<string, LightConePrimitive>()

export function createLightCone(viewer: { scene: { primitives: PrimitiveCollection } }, options: LightConeOptions): void {
  removeLightCone(viewer, options.id)
  const primitive = new LightConePrimitive(options)
  viewer.scene.primitives.add(primitive)
  instances.set(options.id, primitive)
}

export function updateLightCone(
  viewer: { scene: { primitives: PrimitiveCollection } },
  id: string,
  patch: Partial<LightConeOptions>
): void {
  const instance = instances.get(id)
  if (!instance) return
  instance.setOptions(patch)
}

export function removeLightCone(
  viewer: { scene: { primitives: PrimitiveCollection } } | undefined,
  id: string
): void {
  const instance = instances.get(id)
  if (!instance) return
  instances.delete(id)
  if (viewer && !viewer.scene.primitives.isDestroyed()) {
    viewer.scene.primitives.remove(instance)
  }
}
