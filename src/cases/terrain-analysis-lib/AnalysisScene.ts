/**
 * 通用地形分析场景：底图、真实地形、分析区域、结果栅格贴地与矢量要素渲染。
 */
import {
  Cartesian3,
  ClassificationType,
  Color,
  ConstantProperty,
  HeightReference,
  ImageMaterialProperty,
  Rectangle,
  Viewer,
  type Entity
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, loadWorldTerrain, type SceneCallbacks } from '../../lib/cesium-scene'
import type { DemData, LonLat } from './types'
import type { VectorLayer } from './workbench-types'

export type AnalysisSceneCallbacks = SceneCallbacks

export class AnalysisScene {
  private viewer: Viewer
  private callbacks: AnalysisSceneCallbacks
  private dem: DemData | null = null
  private rasterEntity: Entity | null = null
  private rasterMaterial: ImageMaterialProperty | null = null
  private regionEntity: Entity | null = null
  private regionVertexEntities: Entity[] = []
  private vectorEntities: Record<string, Entity[]> = {}
  private disposed = false

  constructor(container: HTMLElement, callbacks: AnalysisSceneCallbacks = {}) {
    this.callbacks = callbacks
    this.viewer = createMapScene(container, callbacks)
    this.viewer.scene.globe.depthTestAgainstTerrain = true
    loadBingImagery(this.viewer, callbacks)
  }

  getViewer(): Viewer {
    return this.viewer
  }

  async enableTerrain(): Promise<void> {
    await loadWorldTerrain(this.viewer)
  }

  setDem(dem: DemData): void {
    this.dem = dem
  }

  getDem(): DemData | null {
    return this.dem
  }

  showRaster(canvas: HTMLCanvasElement, dem?: DemData): void {
    const target = dem ?? this.dem
    if (!target || this.disposed) return
    if (!this.rasterMaterial) {
      this.rasterMaterial = new ImageMaterialProperty({ image: new ConstantProperty(canvas) })
      this.rasterEntity = this.viewer.entities.add({
        rectangle: {
          coordinates: Rectangle.fromDegrees(target.west, target.south, target.east, target.north),
          material: this.rasterMaterial,
          classificationType: ClassificationType.TERRAIN,
          zIndex: 120
        }
      })
    } else {
      this.rasterMaterial.image = new ConstantProperty(canvas)
      if (this.rasterEntity) {
        const rect = this.rasterEntity.rectangle
        if (rect) rect.coordinates = new ConstantProperty(Rectangle.fromDegrees(target.west, target.south, target.east, target.north))
      }
    }
  }

  setRasterVisible(visible: boolean): void {
    if (this.rasterEntity) this.rasterEntity.show = visible
  }

  clearRaster(): void {
    if (this.rasterEntity && !this.viewer.isDestroyed()) this.viewer.entities.remove(this.rasterEntity)
    this.rasterEntity = null
    this.rasterMaterial = null
  }

  setRegion(points: LonLat[], closed = false, cursor: LonLat | null = null): void {
    if (this.disposed) return
    this.clearRegion()
    if (points.length === 0) return
    const positions = points.map((p) => Cartesian3.fromDegrees(p.lon, p.lat))
    if (closed && points.length >= 3) {
      this.regionEntity = this.viewer.entities.add({
        polygon: {
          hierarchy: Cartesian3.fromDegreesArray(points.flatMap((p) => [p.lon, p.lat])),
          material: Color.fromCssColorString('#49b6ff').withAlpha(0.16),
          classificationType: ClassificationType.TERRAIN,
          outline: true,
          outlineColor: Color.fromCssColorString('#8fe3ff').withAlpha(0.9),
          outlineWidth: 2
        }
      })
      return
    }
    const edge = cursor ? positions.concat([Cartesian3.fromDegrees(cursor.lon, cursor.lat)]) : positions
    if (edge.length >= 2) {
      this.regionEntity = this.viewer.entities.add({
        polyline: {
          positions: edge,
          width: 2.5,
          clampToGround: true,
          material: Color.fromCssColorString('#ffd166')
        }
      })
    }
    for (const position of positions) {
      this.regionVertexEntities.push(
        this.viewer.entities.add({
          position,
          point: {
            pixelSize: 7,
            color: Color.fromCssColorString('#ffd166'),
            outlineColor: Color.fromCssColorString('#1b2a44'),
            outlineWidth: 2,
            heightReference: HeightReference.CLAMP_TO_GROUND
          }
        })
      )
    }
  }

  clearRegion(): void {
    if (this.regionEntity && !this.viewer.isDestroyed()) this.viewer.entities.remove(this.regionEntity)
    this.regionEntity = null
    for (const entity of this.regionVertexEntities) {
      if (!this.viewer.isDestroyed()) this.viewer.entities.remove(entity)
    }
    this.regionVertexEntities = []
  }

  setVectors(layers: VectorLayer[], visible: Record<string, boolean> = {}): void {
    if (this.disposed) return
    for (const id of Object.keys(this.vectorEntities)) {
      for (const entity of this.vectorEntities[id]) {
        if (!this.viewer.isDestroyed()) this.viewer.entities.remove(entity)
      }
    }
    this.vectorEntities = {}
    for (const layer of layers) {
      const entities: Entity[] = []
      const color = Color.fromCssColorString(layer.color)
      for (const feature of layer.features) {
        if (feature.path.length === 0) continue
        const positions = feature.path.map((p) => Cartesian3.fromDegrees(p.lon, p.lat))
        if (layer.geometry === 'point') {
          entities.push(
            this.viewer.entities.add({
              position: positions[0],
              point: { pixelSize: layer.width ?? 8, color, outlineColor: Color.WHITE, outlineWidth: 1, heightReference: HeightReference.CLAMP_TO_GROUND }
            })
          )
        } else if (layer.geometry === 'polygon') {
          entities.push(
            this.viewer.entities.add({
              polygon: {
                hierarchy: Cartesian3.fromDegreesArray(feature.path.flatMap((p) => [p.lon, p.lat])),
                material: color.withAlpha(layer.fillOpacity ?? 0.45),
                classificationType: ClassificationType.TERRAIN,
                outline: true,
                outlineColor: color,
                outlineWidth: layer.width ?? 2
              }
            })
          )
        } else {
          entities.push(
            this.viewer.entities.add({
              polyline: {
                positions,
                width: layer.width ?? 3,
                clampToGround: true,
                material: color
              }
            })
          )
        }
      }
      this.vectorEntities[layer.id] = entities
    }
    this.applyVectorVisibility(visible)
  }

  setVectorVisibility(visible: Record<string, boolean>): void {
    this.applyVectorVisibility(visible)
  }

  private applyVectorVisibility(visible: Record<string, boolean>): void {
    for (const id of Object.keys(this.vectorEntities)) {
      const show = visible[id] !== false
      for (const entity of this.vectorEntities[id]) entity.show = show
    }
  }

  flyToBounds(bounds: { west: number; east: number; south: number; north: number }, maxHeight: number, mode: 'top' | 'oblique' = 'oblique'): void {
    const lon = (bounds.west + bounds.east) / 2
    const lat = (bounds.south + bounds.north) / 2
    const spanLat = bounds.north - bounds.south
    const spanLon = bounds.east - bounds.west
    const spanMeters = Math.max(spanLat, spanLon) * 111000
    if (mode === 'top') {
      this.viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(lon, lat - spanLat * 0.06, maxHeight + spanMeters * 1.05),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
        duration: 1.2
      })
    } else {
      this.viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(
          bounds.west - spanLon * 0.35,
          bounds.south - spanLat * 0.7,
          maxHeight + spanMeters * 0.72
        ),
        orientation: { heading: 0.35, pitch: -0.62, roll: 0 },
        duration: 1.2
      })
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.rasterEntity = null
    this.regionEntity = null
    this.vectorEntities = {}
    destroyScene(this.viewer)
  }
}
