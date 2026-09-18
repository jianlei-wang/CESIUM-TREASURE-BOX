import {
  BoundingSphere,
  Cartesian3,
  Cartesian4,
  Color,
  ColorGeometryInstanceAttribute,
  ComponentDatatype,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  GeometryInstance,
  Matrix4,
  PerInstanceColorAppearance,
  Primitive,
  PrimitiveType,
  type Scene
} from 'cesium'

const NDC_CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1]
]

const EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7]
]

/**
 * 视锥体线框可视化：通过 NDC 立方体角点乘视图投影逆矩阵得到世界坐标，
 * 连接 12 条棱边渲染为不写深度的线框。
 */
export class FrustumVisualizer {
  private readonly _scene: Scene
  private readonly _color: Color
  private _primitive: Primitive | undefined
  private _visible = true

  constructor(scene: Scene, color = Color.fromCssColorString('#00ff88').withAlpha(0.9)) {
    this._scene = scene
    this._color = color
  }

  private static _computeCorners(inverseViewProjection: Matrix4): Cartesian3[] {
    const scratch = new Cartesian4()
    return NDC_CORNERS.map(([x, y, z]) => {
      Cartesian4.fromElements(x, y, z, 1, scratch)
      const world = Matrix4.multiplyByVector(inverseViewProjection, scratch, new Cartesian4())
      return Cartesian3.divideByScalar(world, world.w, new Cartesian3())
    })
  }

  update(inverseViewProjection: Matrix4): void {
    const corners = FrustumVisualizer._computeCorners(inverseViewProjection)
    const values = new Float64Array(EDGES.length * 2 * 3)
    let index = 0
    for (const [a, b] of EDGES) {
      const start = corners[a]
      const end = corners[b]
      values[index++] = start.x
      values[index++] = start.y
      values[index++] = start.z
      values[index++] = end.x
      values[index++] = end.y
      values[index++] = end.z
    }

    if (this._primitive) {
      this._scene.primitives.remove(this._primitive)
      this._primitive = undefined
    }

    const attributes = new GeometryAttributes()
    attributes.position = new GeometryAttribute({
      componentDatatype: ComponentDatatype.DOUBLE,
      componentsPerAttribute: 3,
      values
    })

    const geometry = new Geometry({
      attributes,
      primitiveType: PrimitiveType.LINES,
      boundingSphere: BoundingSphere.fromVertices(values)
    })

    this._primitive = new Primitive({
      geometryInstances: new GeometryInstance({
        geometry,
        attributes: {
          color: ColorGeometryInstanceAttribute.fromColor(this._color)
        }
      }),
      appearance: new PerInstanceColorAppearance({
        flat: true,
        translucent: true,
        renderState: {
          depthTest: { enabled: true },
          depthMask: false
        }
      }),
      asynchronous: false,
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
