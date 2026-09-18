import {
  Cartesian3,
  Cartesian4,
  Color,
  ColorGeometryInstanceAttribute,
  Ellipsoid,
  GeometryInstance,
  GroundPrimitive,
  IntersectionTests,
  Matrix4,
  PerInstanceColorAppearance,
  PolygonGeometry,
  Ray,
  type Scene
} from 'cesium'

const FAR_NDC: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1]
]

/**
 * 投影裁切面边界可视化：从摄像头位置向远平面四角发射射线，
 * 与地形（无地形时退回 WGS84 椭球面）求交，得到地表投影区域多边形。
 */
export class ProjectionBoundary {
  private readonly _scene: Scene
  private readonly _color: Color
  private _primitive: GroundPrimitive | undefined
  private _visible = true

  constructor(scene: Scene, color = Color.fromCssColorString('#00d4ff').withAlpha(0.18)) {
    this._scene = scene
    this._color = color
  }

  private static _farCorners(inverseViewProjection: Matrix4): Cartesian3[] {
    const scratch = new Cartesian4()
    return FAR_NDC.map(([x, y, z]) => {
      Cartesian4.fromElements(x, y, z, 1, scratch)
      const world = Matrix4.multiplyByVector(inverseViewProjection, scratch, new Cartesian4())
      return Cartesian3.divideByScalar(world, world.w, new Cartesian3())
    })
  }

  private _intersectGround(origin: Cartesian3, target: Cartesian3): Cartesian3 | undefined {
    const direction = Cartesian3.subtract(target, origin, new Cartesian3())
    Cartesian3.normalize(direction, direction)
    const ray = new Ray(origin, direction)
    const terrainHit = this._scene.globe.pick(ray, this._scene)
    if (terrainHit) return terrainHit
    const interval = IntersectionTests.rayEllipsoid(ray, Ellipsoid.WGS84)
    if (!interval) return undefined
    const point = Ray.getPoint(ray, interval.start, new Cartesian3())
    return Ellipsoid.WGS84.scaleToGeodeticSurface(point, point) ?? point
  }

  update(inverseViewProjection: Matrix4, origin: Cartesian3): void {
    const corners = ProjectionBoundary._farCorners(inverseViewProjection)
    const intersections: Cartesian3[] = []
    for (const corner of corners) {
      const hit = this._intersectGround(origin, corner)
      if (hit) intersections.push(hit)
    }

    if (this._primitive) {
      this._scene.primitives.remove(this._primitive)
      this._primitive = undefined
    }
    if (intersections.length < 3) return

    const geometry = PolygonGeometry.fromPositions({
      positions: intersections,
      vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT
    })
    this._primitive = new GroundPrimitive({
      geometryInstances: new GeometryInstance({
        geometry,
        attributes: {
          color: ColorGeometryInstanceAttribute.fromColor(this._color)
        }
      }),
      appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
      asynchronous: true,
      show: this._visible
    })
    this._scene.primitives.add(this._primitive)
  }

  setVisible(visible: boolean): void {
    this._visible = visible
    if (this._primitive) this._primitive.show = visible
  }

  destroy(): void {
    if (this._primitive) {
      this._scene.primitives.remove(this._primitive)
      this._primitive = undefined
    }
  }
}
