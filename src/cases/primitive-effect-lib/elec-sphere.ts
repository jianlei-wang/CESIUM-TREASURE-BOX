import {
  Cartesian3,
  Color,
  EllipsoidGeometry,
  GeometryInstance,
  Math as CesiumMath,
  Material,
  MaterialAppearance,
  Primitive,
  PrimitiveCollection,
  Transforms
} from 'cesium'
import { ELLIPSOID_ELECTRIC_TYPE } from './materials'

export type ElecSphereOptions = {
  id: string
  position: [number, number, number]
  radiusX?: number
  radiusY?: number
  radiusZ?: number
  color?: Color
  speed?: number
}

class ElecSpherePrimitive extends PrimitiveCollection {
  private _opts: ElecSphereOptions
  private _primitive: Primitive | undefined

  constructor(opts: ElecSphereOptions) {
    super()
    this._opts = { ...opts }
    this._rebuild()
  }

  setOptions(patch: Partial<ElecSphereOptions>): void {
    this._opts = { ...this._opts, ...patch }
    this._rebuild()
  }

  private _rebuild(): void {
    this.removeAll()
    const position = Cartesian3.fromDegrees(
      this._opts.position[0],
      this._opts.position[1],
      this._opts.position[2]
    )
    const geometry = new EllipsoidGeometry({
      radii: new Cartesian3(this._opts.radiusX ?? 80, this._opts.radiusY ?? 80, this._opts.radiusZ ?? 80),
      maximumCone: CesiumMath.PI_OVER_TWO
    })
    const appearance = new MaterialAppearance({
      material: Material.fromType(ELLIPSOID_ELECTRIC_TYPE, {
        color: this._opts.color ?? new Color(0.2, 1.0, 0.4, 0.8),
        speed: this._opts.speed ?? 5
      })
    })
    this._primitive = new Primitive({
      geometryInstances: new GeometryInstance({
        geometry,
        modelMatrix: Transforms.eastNorthUpToFixedFrame(position)
      }),
      appearance,
      asynchronous: false
    })
    this.add(this._primitive)
  }
}

const instances = new Map<string, ElecSpherePrimitive>()

export function createElecSphere(viewer: { scene: { primitives: PrimitiveCollection } }, options: ElecSphereOptions): void {
  removeElecSphere(viewer, options.id)
  const primitive = new ElecSpherePrimitive(options)
  viewer.scene.primitives.add(primitive)
  instances.set(options.id, primitive)
}

export function updateElecSphere(
  viewer: { scene: { primitives: PrimitiveCollection } },
  id: string,
  patch: Partial<ElecSphereOptions>
): void {
  const instance = instances.get(id)
  if (!instance) return
  instance.setOptions(patch)
}

export function removeElecSphere(
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
