import {
  Cartesian2,
  Cartesian3,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  DirectionalLight,
  DistanceDisplayCondition,
  Entity,
  HorizontalOrigin,
  LabelStyle,
  NearFarScalar,
  PerspectiveFrustum,
  PolygonHierarchy,
  PolylineGlowMaterialProperty,
  SceneTransforms,
  ShadowMode,
  SunLight,
  VerticalOrigin,
  type Viewer
} from 'cesium'
import {
  LAYER_DEFINITIONS,
  SITE_CENTER,
  type CameraPose,
  type LayerDefinition,
  type RouteSample,
  type SceneEffectState
} from './presentation'

type PoiAnchor = {
  id: string
  name: string
  longitude: number
  latitude: number
  height: number
  entity: Entity
}

type BuildingItem = {
  entity: Entity
  longitude: number
  latitude: number
  height: number
  width: number
  depth: number
}

const POIS = [
  { id: 'poi', name: '中央广场', longitude: SITE_CENTER.longitude + 0.00055, latitude: SITE_CENTER.latitude + 0.00035, height: 24 },
  { id: 'poi-tech', name: '科创中心', longitude: SITE_CENTER.longitude + 0.00125, latitude: SITE_CENTER.latitude - 0.00055, height: 96 },
  { id: 'poi-lake', name: '生态湖', longitude: SITE_CENTER.longitude - 0.00105, latitude: SITE_CENTER.latitude + 0.0011, height: 8 },
  { id: 'poi-power', name: '能源站', longitude: SITE_CENTER.longitude - 0.00135, latitude: SITE_CENTER.latitude - 0.00085, height: 36 }
]

const ZONES = [
  {
    name: '中央商务区',
    color: '#ffb45e',
    points: [
      [SITE_CENTER.longitude - 0.0002, SITE_CENTER.latitude - 0.0004],
      [SITE_CENTER.longitude + 0.0016, SITE_CENTER.latitude - 0.0003],
      [SITE_CENTER.longitude + 0.0014, SITE_CENTER.latitude + 0.0012],
      [SITE_CENTER.longitude - 0.0001, SITE_CENTER.latitude + 0.0010]
    ]
  },
  {
    name: '科创研发区',
    color: '#5ec8ff',
    points: [
      [SITE_CENTER.longitude + 0.0018, SITE_CENTER.latitude - 0.0014],
      [SITE_CENTER.longitude + 0.0034, SITE_CENTER.latitude - 0.0010],
      [SITE_CENTER.longitude + 0.0030, SITE_CENTER.latitude + 0.0007],
      [SITE_CENTER.longitude + 0.0017, SITE_CENTER.latitude + 0.0006]
    ]
  },
  {
    name: '生态休闲区',
    color: '#7fe2a8',
    points: [
      [SITE_CENTER.longitude - 0.0027, SITE_CENTER.latitude + 0.0004],
      [SITE_CENTER.longitude - 0.0013, SITE_CENTER.latitude + 0.0005],
      [SITE_CENTER.longitude - 0.0012, SITE_CENTER.latitude + 0.0022],
      [SITE_CENTER.longitude - 0.0029, SITE_CENTER.latitude + 0.0020]
    ]
  }
]

function ringPositions(longitude: number, latitude: number, radiusMeters: number, height: number, segments = 96): Cartesian3[] {
  const metersPerDegLat = 111_320
  const metersPerDegLon = 111_320 * Math.cos((latitude * Math.PI) / 180)
  const positions: Cartesian3[] = []
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    positions.push(
      Cartesian3.fromDegrees(
        longitude + (Math.cos(angle) * radiusMeters) / metersPerDegLon,
        latitude + (Math.sin(angle) * radiusMeters) / metersPerDegLat,
        height
      )
    )
  }
  return positions
}

function offsetMeters(longitude: number, latitude: number, east: number, north: number): [number, number] {
  const metersPerDegLat = 111_320
  const metersPerDegLon = 111_320 * Math.cos((latitude * Math.PI) / 180)
  return [longitude + east / metersPerDegLon, latitude + north / metersPerDegLat]
}

export class PresentationScene {
  private viewer: Viewer
  private layerEntities = new Map<string, Entity[]>()
  private poiAnchors: PoiAnchor[] = []
  private buildings: BuildingItem[] = []
  private routeEntity: Entity | null = null
  private routeGlowEntity: Entity | null = null
  private progressLabel: Entity | null = null
  private fixedLight: DirectionalLight | null = null

  constructor(viewer: Viewer) {
    this.viewer = viewer
    for (const layer of LAYER_DEFINITIONS) this.layerEntities.set(layer.id, [])
    this.buildZones()
    this.buildRings()
    this.buildRouteBase()
    this.buildBuildings()
    this.buildPoi()
  }

  private addEntity(layerId: string, entity: Entity): Entity {
    this.layerEntities.get(layerId)?.push(entity)
    return entity
  }

  private layerColor(layerId: string, fallback: string): string {
    return LAYER_DEFINITIONS.find((layer) => layer.id === layerId)?.color ?? fallback
  }

  private buildZones(): void {
    for (const zone of ZONES) {
      const positions = zone.points.map(([longitude, latitude]) => Cartesian3.fromDegrees(longitude, latitude, 2))
      const polygon = this.addEntity(
        'zones',
        this.viewer.entities.add({
          name: zone.name,
          polygon: {
            hierarchy: new PolygonHierarchy(positions),
            height: 2,
            material: Color.fromCssColorString(zone.color).withAlpha(0.18),
            outline: true,
            outlineColor: Color.fromCssColorString(zone.color).withAlpha(0.9),
            shadows: ShadowMode.RECEIVE_ONLY
          }
        })
      )
      polygon.show = true
      const closed = [...positions, positions[0]]
      this.addEntity(
        'zones',
        this.viewer.entities.add({
          polyline: {
            positions: closed,
            width: 2,
            material: Color.fromCssColorString(zone.color).withAlpha(0.85),
            clampToGround: false
          }
        })
      )
      const [labelLon, labelLat] = zone.points[0]
      this.addEntity(
        'zones',
        this.viewer.entities.add({
          position: Cartesian3.fromDegrees(labelLon, labelLat, 6),
          label: {
            text: zone.name,
            font: '600 15px "Microsoft YaHei", "PingFang SC", sans-serif',
            fillColor: Color.fromCssColorString(zone.color),
            outlineColor: Color.fromCssColorString('#04101f'),
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            horizontalOrigin: HorizontalOrigin.LEFT,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(10, -8),
            scaleByDistance: new NearFarScalar(400, 1, 2600, 0.66),
            distanceDisplayCondition: new DistanceDisplayCondition(0, 2600)
          }
        })
      )
    }
  }

  private buildRings(): void {
    const color = Color.fromCssColorString(this.layerColor('rings', '#ff9d7a'))
    const radii = [160, 300, 460]
    radii.forEach((radius, index) => {
      this.addEntity(
        'rings',
        this.viewer.entities.add({
          polyline: {
            positions: ringPositions(SITE_CENTER.longitude, SITE_CENTER.latitude, radius, 6 + index * 3),
            width: index === 0 ? 2.4 : 1.6,
            material: color.withAlpha(0.82 - index * 0.18),
            clampToGround: false
          }
        })
      )
    })
    this.addEntity(
      'rings',
      this.viewer.entities.add({
        position: Cartesian3.fromDegrees(SITE_CENTER.longitude, SITE_CENTER.latitude, 18),
        ellipse: {
          semiMajorAxis: 26,
          semiMinorAxis: 26,
          material: color.withAlpha(0.3),
          height: 4
        }
      })
    )
  }

  private buildRouteBase(): void {
    const color = Color.fromCssColorString(this.layerColor('route', '#6da8ff'))
    const placeholder = [
      Cartesian3.fromDegrees(SITE_CENTER.longitude, SITE_CENTER.latitude, 700),
      Cartesian3.fromDegrees(SITE_CENTER.longitude, SITE_CENTER.latitude, 700)
    ]
    this.routeGlowEntity = this.addEntity(
      'route',
      this.viewer.entities.add({
        polyline: {
          positions: placeholder,
          width: 9,
          material: new PolylineGlowMaterialProperty({ color: color.withAlpha(0.35), glowPower: 0.18 }),
          clampToGround: false
        }
      })
    )
    this.routeEntity = this.addEntity(
      'route',
      this.viewer.entities.add({
        polyline: {
          positions: placeholder,
          width: 2.6,
          material: color.withAlpha(0.95),
          clampToGround: false
        }
      })
    )
  }

  private buildBuildings(): void {
    const columns = 4
    const rows = 3
    const spacing = 74
    const site = { east: 150, north: -60 }
    let index = 0
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const east = site.east + (column - (columns - 1) / 2) * spacing
        const north = site.north + (row - (rows - 1) / 2) * spacing
        const [longitude, latitude] = offsetMeters(SITE_CENTER.longitude, SITE_CENTER.latitude, east, north)
        const height = 46 + ((index * 37) % 130)
        const width = 34 + (index % 3) * 8
        const depth = 30 + (index % 4) * 6
        const tint = ['#9fdcc0', '#89d5e8', '#d9cf9f', '#b9c6ea'][index % 4]
        const entity = this.addEntity(
          'buildings',
          this.viewer.entities.add({
            position: Cartesian3.fromDegrees(longitude, latitude, 1),
            box: {
              dimensions: new Cartesian3(width, depth, 2),
              material: Color.fromCssColorString(tint).withAlpha(0.92),
              outline: true,
              outlineColor: Color.fromCssColorString('#0b2a35').withAlpha(0.9),
              shadows: ShadowMode.ENABLED
            }
          })
        )
        this.buildings.push({ entity, longitude, latitude, height, width, depth })
        index += 1
      }
    }
    this.addEntity(
      'buildings',
      this.viewer.entities.add({
        position: Cartesian3.fromDegrees(SITE_CENTER.longitude, SITE_CENTER.latitude, 3),
        polygon: {
          hierarchy: new PolygonHierarchy(ringPositions(SITE_CENTER.longitude, SITE_CENTER.latitude, 250, 3).slice(0, -1)),
          height: 3,
          material: Color.fromCssColorString('#4fd6b0').withAlpha(0.1),
          outline: true,
          outlineColor: Color.fromCssColorString('#4fd6b0').withAlpha(0.8)
        }
      })
    )
    this.progressLabel = this.addEntity(
      'buildings',
      this.viewer.entities.add({
        position: Cartesian3.fromDegrees(SITE_CENTER.longitude, SITE_CENTER.latitude, 6),
        label: {
          text: '建设进度 0%',
          font: '700 17px "Microsoft YaHei", "PingFang SC", sans-serif',
          fillColor: Color.fromCssColorString('#b6ffe2'),
          outlineColor: Color.fromCssColorString('#062018'),
          outlineWidth: 3,
          showBackground: true,
          backgroundColor: Color.fromCssColorString('#0a2b22').withAlpha(0.72),
          backgroundPadding: new Cartesian2(12, 7),
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -18),
          scaleByDistance: new NearFarScalar(300, 1, 1600, 0.7),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 1400)
        }
      })
    )
    this.setBuildProgress(0)
  }

  private buildPoi(): void {
    for (const poi of POIS) {
      const color = Color.fromCssColorString(this.layerColor('poi', '#6fd6ff'))
      const entity = this.addEntity(
        'poi',
        this.viewer.entities.add({
          name: poi.name,
          position: Cartesian3.fromDegrees(poi.longitude, poi.latitude, poi.height),
          point: {
            pixelSize: 11,
            color,
            outlineColor: Color.WHITE.withAlpha(0.9),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new DistanceDisplayCondition(0, 12000)
          },
          label: {
            text: poi.name,
            font: '600 15px "Microsoft YaHei", "PingFang SC", sans-serif',
            fillColor: Color.WHITE,
            outlineColor: Color.fromCssColorString('#04101f'),
            outlineWidth: 3,
            showBackground: true,
            backgroundColor: Color.fromCssColorString('#0a1b30').withAlpha(0.68),
            backgroundPadding: new Cartesian2(9, 5),
            horizontalOrigin: HorizontalOrigin.CENTER,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(0, -20),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new NearFarScalar(300, 1, 1600, 0.72),
            distanceDisplayCondition: new DistanceDisplayCondition(0, 1400)
          }
        })
      )
      this.poiAnchors.push({ ...poi, entity })
    }
  }

  setLayerVisibility(states: Record<string, boolean>): void {
    for (const [layerId, entities] of this.layerEntities) {
      const visible = states[layerId] !== false
      for (const entity of entities) entity.show = visible
    }
  }

  setRoute(samples: RouteSample[]): void {
    const positions = samples.map((sample) => Cartesian3.fromDegrees(sample.longitude, sample.latitude, sample.height))
    const safe =
      positions.length >= 2
        ? positions
        : [
            Cartesian3.fromDegrees(SITE_CENTER.longitude, SITE_CENTER.latitude, 700),
            Cartesian3.fromDegrees(SITE_CENTER.longitude, SITE_CENTER.latitude, 700)
          ]
    if (this.routeEntity?.polyline) this.routeEntity.polyline.positions = new ConstantProperty(safe)
    if (this.routeGlowEntity?.polyline) this.routeGlowEntity.polyline.positions = new ConstantProperty(safe)
  }

  setBuildProgress(value: number): void {
    const progress = Math.min(1, Math.max(0, value))
    for (const item of this.buildings) {
      const height = 2 + item.height * progress
      item.entity.position = new ConstantPositionProperty(Cartesian3.fromDegrees(item.longitude, item.latitude, height / 2 + 1))
      if (item.entity.box) {
        item.entity.box.dimensions = new ConstantProperty(new Cartesian3(item.width, item.depth, height))
      }
    }
    if (this.progressLabel?.label) {
      this.progressLabel.label.text = new ConstantProperty(`建设进度 ${Math.round(progress * 100)}%`)
    }
  }

  applySceneEffects(state: SceneEffectState): void {
    const scene = this.viewer.scene
    const needsDirectional = state.lighting || state.shadows
    if (needsDirectional && !this.fixedLight) {
      this.fixedLight = new DirectionalLight({
        direction: new Cartesian3(-0.42, -0.55, -0.72),
        intensity: 3.2
      })
      scene.light = this.fixedLight
    } else if (!needsDirectional && this.fixedLight) {
      scene.light = new SunLight()
      this.fixedLight = null
    }
    scene.shadowMap.enabled = state.shadows
    scene.globe.enableLighting = state.lighting
    scene.fog.enabled = state.fog
    scene.fog.density = state.fogDensity
    scene.globe.showGroundAtmosphere = state.atmosphere
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = state.atmosphere
  }

  setCamera(pose: CameraPose): void {
    if (pose.fov && this.viewer.camera.frustum instanceof PerspectiveFrustum) {
      this.viewer.camera.frustum.fov = (pose.fov * Math.PI) / 180
    }
    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(pose.longitude, pose.latitude, pose.height),
      orientation: {
        heading: (pose.heading * Math.PI) / 180,
        pitch: (pose.pitch * Math.PI) / 180,
        roll: (pose.roll * Math.PI) / 180
      }
    })
  }

  captureCamera(): CameraPose {
    const camera = this.viewer.camera
    const carto = camera.positionCartographic
    return {
      longitude: (carto.longitude * 180) / Math.PI,
      latitude: (carto.latitude * 180) / Math.PI,
      height: carto.height,
      heading: (camera.heading * 180) / Math.PI,
      pitch: (camera.pitch * 180) / Math.PI,
      roll: (camera.roll * 180) / Math.PI,
      fov:
        camera.frustum instanceof PerspectiveFrustum
          ? ((camera.frustum.fov ?? 60) * 180) / Math.PI
          : 60
    }
  }

  getPoiList(): Array<{ id: string; name: string; longitude: number; latitude: number; height: number }> {
    return POIS.map(({ id, name, longitude, latitude, height }) => ({ id, name, longitude, latitude, height }))
  }

  projectPoi(poiId: string): { x: number; y: number } | null {
    const poi = this.poiAnchors.find((item) => item.id === poiId)
    if (!poi) return null
    const position = Cartesian3.fromDegrees(poi.longitude, poi.latitude, poi.height)
    const screen = SceneTransforms.worldToWindowCoordinates(this.viewer.scene, position)
    if (!screen) return null
    return { x: screen.x, y: screen.y }
  }

  getLayerDefinitions(): LayerDefinition[] {
    return LAYER_DEFINITIONS
  }
}
