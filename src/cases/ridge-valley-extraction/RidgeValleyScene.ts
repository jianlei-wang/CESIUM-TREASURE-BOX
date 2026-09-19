import {
  BoundingSphere,
  Cartesian3,
  ClassificationType,
  Color,
  ComponentDatatype,
  ConstantProperty,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  GeometryInstance,
  ImageMaterialProperty,
  Material,
  MaterialAppearance,
  Matrix4,
  Primitive,
  PrimitiveType,
  Rectangle,
  Viewer,
  type Entity
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import type { AnalysisResult, DemData, Point } from '../ridge-valley-lib/hydrology'

export type RidgeValleyCallbacks = SceneCallbacks

export type RenderMode = 'mesh' | 'drape'

export type LineStyle = {
  ridgeColor: string
  valleyColor: string
  ridgeWidth: number
  valleyWidth: number
}

function pixelToLon(dem: DemData, c: number): number {
  return dem.west + (c / Math.max(1, dem.width - 1)) * (dem.east - dem.west)
}

function pixelToLat(dem: DemData, r: number): number {
  return dem.north - (r / Math.max(1, dem.height - 1)) * (dem.north - dem.south)
}

export class RidgeValleyScene {
  private viewer: Viewer
  private callbacks: RidgeValleyCallbacks
  private dem: DemData | null = null
  private result: AnalysisResult | null = null
  private texture: HTMLCanvasElement | null = null
  private surface: Primitive | null = null
  private ridgeEntities: Entity[] = []
  private valleyEntities: Entity[] = []
  private material: Material | null = null
  private appearance: MaterialAppearance | null = null
  private drapeEntity: Entity | null = null
  private drapeMaterial: ImageMaterialProperty | null = null
  private renderMode: RenderMode = 'mesh'
  private verticalScale = 1
  private lineStyle: LineStyle = {
    ridgeColor: '#ff5a4d',
    valleyColor: '#49b6ff',
    ridgeWidth: 3,
    valleyWidth: 3
  }
  private showRidge = true
  private showValley = true
  private disposed = false

  constructor(container: HTMLElement, callbacks: RidgeValleyCallbacks = {}) {
    this.callbacks = callbacks
    this.viewer = createMapScene(container, callbacks)
    this.viewer.scene.globe.depthTestAgainstTerrain = true
    loadBingImagery(this.viewer, callbacks)
  }

  getViewer(): Viewer {
    return this.viewer
  }

  setAnalysis(dem: DemData, result: AnalysisResult): void {
    this.dem = dem
    this.result = result
    this.rebuildSurface()
    this.rebuildLines()
  }

  updateTexture(canvas: HTMLCanvasElement): void {
    this.texture = canvas
    if (this.renderMode === 'drape') {
      if (this.drapeMaterial) this.drapeMaterial.image = new ConstantProperty(canvas)
      this.rebuildDrapedSurface()
      return
    }
    if (this.material) {
      const uniforms = this.material.uniforms as Record<string, unknown>
      uniforms.image = canvas
    } else {
      this.rebuildSurface()
    }
  }

  setRenderMode(mode: RenderMode): void {
    if (this.renderMode === mode) return
    this.renderMode = mode
    this.rebuildSurface()
    this.rebuildLines()
  }

  getRenderMode(): RenderMode {
    return this.renderMode
  }

  setVerticalScale(scale: number): void {
    const next = Math.max(1, Math.min(8, scale))
    if (Math.abs(next - this.verticalScale) < 1e-6) return
    this.verticalScale = next
    if (this.renderMode === 'mesh') this.rebuildSurface()
    this.rebuildLines()
  }

  getVerticalScale(): number {
    return this.verticalScale
  }

  setLineStyle(style: LineStyle): void {
    this.lineStyle = { ...style }
    this.rebuildLines()
  }

  setLineVisibility(showRidge: boolean, showValley: boolean): void {
    this.showRidge = showRidge
    this.showValley = showValley
    this.applyLineVisibility()
  }

  private applyLineVisibility(): void {
    for (const entity of this.ridgeEntities) entity.show = this.showRidge
    for (const entity of this.valleyEntities) entity.show = this.showValley
  }

  flyTo(mode: 'top' | 'oblique' = 'oblique'): void {
    const dem = this.dem
    if (!dem) return
    const lon = (dem.west + dem.east) / 2
    const lat = (dem.south + dem.north) / 2
    const spanLat = dem.north - dem.south
    const spanLon = dem.east - dem.west
    const spanMeters = Math.max(spanLat, spanLon) * 111000
    if (mode === 'top') {
      this.viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(lon, lat - spanLat * 0.06, dem.maxHeight + spanMeters * 1.05),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
        duration: 1.2
      })
    } else {
      this.viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(
          dem.west - spanLon * 0.35,
          dem.south - spanLat * 0.7,
          dem.maxHeight + spanMeters * 0.72
        ),
        orientation: { heading: 0.35, pitch: -0.62, roll: 0 },
        duration: 1.2
      })
    }
  }

  private disposeSurface(): void {
    if (this.surface && !this.viewer.isDestroyed()) this.viewer.scene.primitives.remove(this.surface)
    this.surface = null
    this.material = null
    this.appearance = null
    this.disposeDrapedSurface()
  }

  private disposeDrapedSurface(): void {
    if (this.drapeEntity && !this.viewer.isDestroyed()) this.viewer.entities.remove(this.drapeEntity)
    this.drapeEntity = null
    this.drapeMaterial = null
  }

  private rebuildDrapedSurface(): void {
    const dem = this.dem
    if (!dem || this.disposed) return
    this.disposeDrapedSurface()
    this.viewer.scene.globe.depthTestAgainstTerrain = true
    this.drapeMaterial = new ImageMaterialProperty()
    if (this.texture) this.drapeMaterial.image = new ConstantProperty(this.texture)
    this.drapeEntity = this.viewer.entities.add({
      rectangle: {
        coordinates: Rectangle.fromDegrees(dem.west, dem.south, dem.east, dem.north),
        material: this.drapeMaterial,
        classificationType: ClassificationType.TERRAIN,
        zIndex: 100
      }
    })
  }

  private rebuildSurface(): void {
    const dem = this.dem
    if (!dem || this.disposed) return
    this.disposeSurface()

    if (this.renderMode === 'drape') {
      this.rebuildDrapedSurface()
      return
    }

    const w = dem.width
    const h = dem.height
    const scale = this.verticalScale
    const positions = new Float64Array(w * h * 3)
    const st = new Float32Array(w * h * 2)
    for (let r = 0; r < h; r += 1) {
      const lat = pixelToLat(dem, r)
      for (let c = 0; c < w; c += 1) {
        const i = r * w + c
        const lon = pixelToLon(dem, c)
        const height = dem.values[i] * scale
        const p = Cartesian3.fromDegrees(lon, lat, height)
        positions[i * 3] = p.x
        positions[i * 3 + 1] = p.y
        positions[i * 3 + 2] = p.z
        st[i * 2] = c / Math.max(1, w - 1)
        st[i * 2 + 1] = 1 - r / Math.max(1, h - 1)
      }
    }

    const indices = new Uint32Array((w - 1) * (h - 1) * 6)
    let k = 0
    for (let r = 0; r < h - 1; r += 1) {
      for (let c = 0; c < w - 1; c += 1) {
        const a = r * w + c
        const b = a + 1
        const d = a + w
        const e = d + 1
        indices[k] = a
        indices[k + 1] = d
        indices[k + 2] = b
        indices[k + 3] = b
        indices[k + 4] = d
        indices[k + 5] = e
        k += 6
      }
    }

    const attributes = new GeometryAttributes()
    attributes.position = new GeometryAttribute({
      componentDatatype: ComponentDatatype.DOUBLE,
      componentsPerAttribute: 3,
      values: positions
    })
    attributes.st = new GeometryAttribute({
      componentDatatype: ComponentDatatype.FLOAT,
      componentsPerAttribute: 2,
      values: st
    })

    const geometry = new Geometry({
      attributes,
      indices,
      primitiveType: PrimitiveType.TRIANGLES,
      boundingSphere: BoundingSphere.fromVertices(Array.from(positions))
    })

    const fabric = this.texture
      ? { type: 'Image', uniforms: { image: this.texture } }
      : { type: 'Color', uniforms: { color: Color.fromCssColorString('#2f6b3a') } }
    this.material = new Material({ fabric, translucent: false })
    this.appearance = new MaterialAppearance({
      material: this.material,
      flat: true,
      faceForward: true,
      translucent: false,
      closed: false,
      materialSupport: MaterialAppearance.MaterialSupport.TEXTURED
    })

    this.surface = this.viewer.scene.primitives.add(
      new Primitive({
        geometryInstances: new GeometryInstance({ geometry }),
        appearance: this.appearance,
        asynchronous: false,
        modelMatrix: Matrix4.IDENTITY
      })
    ) as unknown as Primitive
  }

  private clearLineEntities(): void {
    if (!this.viewer.isDestroyed()) {
      for (const entity of this.ridgeEntities) this.viewer.entities.remove(entity)
      for (const entity of this.valleyEntities) this.viewer.entities.remove(entity)
    }
    this.ridgeEntities = []
    this.valleyEntities = []
  }

  private rebuildLines(): void {
    const dem = this.dem
    const result = this.result
    if (!dem || !result || this.disposed) return
    this.clearLineEntities()
    const draped = this.renderMode === 'drape'
    const relief = dem.maxHeight - dem.minHeight
    const offset = draped ? Math.max(15, relief * 0.012) : Math.max(20, relief * 0.01)
    const verticalScale = draped ? 1 : this.verticalScale

    const build = (lines: Point[][], store: Entity[], color: string, width: number): void => {
      for (let l = 0; l < lines.length; l += 1) {
        const line = lines[l]
        if (line.length < 2) continue
        const positions: Cartesian3[] = []
        for (let i = 0; i < line.length; i += 1) {
          const c = line[i][0]
          const r = line[i][1]
          const ri = Math.max(0, Math.min(dem.height - 1, Math.round(r)))
          const ci = Math.max(0, Math.min(dem.width - 1, Math.round(c)))
          const height = dem.values[ri * dem.width + ci] * verticalScale + offset
          positions.push(Cartesian3.fromDegrees(pixelToLon(dem, c), pixelToLat(dem, r), height))
        }
        const entity = this.viewer.entities.add({
          polyline: {
            positions,
            width,
            material: Color.fromCssColorString(color)
          }
        })
        store.push(entity)
      }
    }

    build(result.ridgeLines, this.ridgeEntities, this.lineStyle.ridgeColor, this.lineStyle.ridgeWidth)
    build(result.valleyLines, this.valleyEntities, this.lineStyle.valleyColor, this.lineStyle.valleyWidth)
    this.applyLineVisibility()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (!this.viewer.isDestroyed()) {
      this.disposeSurface()
      this.clearLineEntities()
    }
    destroyScene(this.viewer)
  }
}
