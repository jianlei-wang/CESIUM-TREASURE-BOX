import {
  Cartesian3,
  Color,
  GeometryInstance,
  Material,
  MaterialAppearance,
  Math as CesiumMath,
  Matrix4,
  Primitive,
  PrimitiveCollection,
  Transforms,
  WallGeometry
} from 'cesium'
import { registerWallMaterials } from '../wall-effects-lib'

type FrameState = unknown

type UpdatablePrimitive = {
  update(frameState: FrameState): void
  destroy(): void
}

type ScenePrimitiveLike = UpdatablePrimitive & {
  isDestroyed(): boolean
}

export type DiffuseWallOptions = {
  id: string
  position: [number, number, number]
  radius?: number
  height?: number
  minRadius?: number
  minHeight?: number
  color?: Color
  slices?: number
  speed?: number
}

class DiffuseWallPrimitive {
  private _opts: DiffuseWallOptions
  private _delegate: UpdatablePrimitive | undefined
  private _currentRadius: number
  private _currentHeight: number

  constructor(opts: DiffuseWallOptions) {
    this._opts = { ...opts }
    this._currentRadius = opts.minRadius ?? 10
    this._currentHeight = opts.height ?? 300
  }

  isDestroyed(): boolean {
    return false
  }

  destroy(): void {
    if (this._delegate) {
      this._delegate.destroy()
      this._delegate = undefined
    }
  }

  setOptions(patch: Partial<DiffuseWallOptions>): void {
    this._opts = { ...this._opts, ...patch }
  }

  private _getPositions(): Cartesian3[] {
    const position = Cartesian3.fromDegrees(
      this._opts.position[0],
      this._opts.position[1],
      this._opts.position[2]
    )
    const modelMatrix = Transforms.eastNorthUpToFixedFrame(position)
    const slices = this._opts.slices ?? 128
    const pnts: Cartesian3[] = []
    for (let i = 0; i < slices; i++) {
      const angle = (i / slices) * CesiumMath.TWO_PI
      const x = Math.cos(angle)
      const y = Math.sin(angle)
      const point = new Cartesian3(x * this._currentRadius, y * this._currentRadius, 0.0)
      pnts.push(Matrix4.multiplyByPoint(modelMatrix, point, new Cartesian3()))
    }
    pnts.push(pnts[0])
    return pnts
  }

  private _getHeights(length: number, height: number): number[] {
    const heights: number[] = []
    for (let i = 0; i < length; i++) heights.push(height)
    return heights
  }

  update(frameState: FrameState): void {
    if (this._delegate) {
      this._delegate.destroy()
    }
    const radius = this._opts.radius ?? 300
    const height = this._opts.height ?? 300
    const speed = this._opts.speed ?? 10
    const minRadius = this._opts.minRadius ?? 10
    const minHeight = this._opts.minHeight ?? 30
    const slices = this._opts.slices ?? 128

    this._currentRadius += radius / speed / 20
    this._currentHeight -= height / speed / 20
    if (this._currentRadius > radius || this._currentHeight < minHeight) {
      this._currentRadius = minRadius
      this._currentHeight = height
    }
    if (!slices || slices < 3) return

    const positions = this._getPositions()
    if (!positions || !positions.length) return

    const geometry = new WallGeometry({
      positions,
      minimumHeights: this._getHeights(positions.length, 0),
      maximumHeights: this._getHeights(positions.length, this._currentHeight)
    })

    this._delegate = new Primitive({
      geometryInstances: new GeometryInstance({ geometry }),
      appearance: new MaterialAppearance({
        material: Material.fromType('WallDiffuse', {
          color: this._opts.color ?? new Color(1.0, 0.3, 0.3, 0.8)
        }),
        flat: true
      }),
      asynchronous: false
    }) as unknown as UpdatablePrimitive
    this._delegate.update(frameState)
  }
}

const instances = new Map<string, DiffuseWallPrimitive>()

export function createDiffuseWall(
  viewer: { scene: { primitives: PrimitiveCollection } },
  options: DiffuseWallOptions
): void {
  removeDiffuseWall(viewer, options.id)
  registerWallMaterials()
  const primitive = new DiffuseWallPrimitive(options)
  viewer.scene.primitives.add(primitive as unknown as Primitive)
  instances.set(options.id, primitive)
}

export function updateDiffuseWall(
  viewer: { scene: { primitives: PrimitiveCollection } },
  id: string,
  patch: Partial<DiffuseWallOptions>
): void {
  const instance = instances.get(id)
  if (!instance) return
  instance.setOptions(patch)
}

export function removeDiffuseWall(
  viewer: { scene: { primitives: PrimitiveCollection } } | undefined,
  id: string
): void {
  const instance = instances.get(id)
  if (!instance) return
  instances.delete(id)
  if (viewer && !viewer.scene.primitives.isDestroyed()) {
    viewer.scene.primitives.remove(instance as unknown as Primitive)
  }
}
