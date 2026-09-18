import { reactive, ref, type Ref } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Color,
  ConstantPositionProperty,
  Entity,
  Math as CesiumMath,
  Matrix4,
  SunLight,
  Transforms,
  type Cesium3DTileset,
  type CustomShader,
  type Viewer
} from 'cesium'
import {
  applyLocalLightUniforms,
  createLocalLightShader,
  hexToCartesian,
  type LocalLightConfig,
  type LocalLightType
} from './lighting'
import { useWhiteModelTileset } from './use-white-model-tileset'
import type { OnTilesetReady } from './use-white-model-tileset'

export interface LocalLightUi {
  lon: number
  lat: number
  height: number
  colorHex: string
  intensity: number
  range: number
  decay: number
  azimuth: number
  elevation: number
  innerDeg: number
  outerDeg: number
  rectWidth: number
  rectHeight: number
  ambient: number
  specular: number
  shininess: number
  hemiSkyHex: string
  hemiGroundHex: string
  hemiIntensity: number
}

export const AMSTERDAM_LIGHT = { lon: 4.9041, lat: 52.3676 }

export function defaultLightUi(): LocalLightUi {
  return {
    lon: AMSTERDAM_LIGHT.lon,
    lat: AMSTERDAM_LIGHT.lat,
    height: 320,
    colorHex: '#ffe6b0',
    intensity: 4,
    range: 1600,
    decay: 2,
    azimuth: 180,
    elevation: -90,
    innerDeg: 18,
    outerDeg: 36,
    rectWidth: 220,
    rectHeight: 130,
    ambient: 0.16,
    specular: 0.5,
    shininess: 32,
    hemiSkyHex: '#8fb0e8',
    hemiGroundHex: '#2a2118',
    hemiIntensity: 0.35
  }
}

function localFrame(lon: number, lat: number): Matrix4 {
  return Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lon, lat, 0))
}

export function enuVector(lon: number, lat: number, azDeg: number, elDeg: number): Cartesian3 {
  const az = CesiumMath.toRadians(azDeg)
  const el = CesiumMath.toRadians(elDeg)
  const local = new Cartesian3(
    Math.sin(az) * Math.cos(el),
    Math.cos(az) * Math.cos(el),
    Math.sin(el)
  )
  return Cartesian3.normalize(
    Matrix4.multiplyByPointAsVector(localFrame(lon, lat), local, new Cartesian3()),
    new Cartesian3()
  )
}

export function enuEast(lon: number, lat: number): Cartesian3 {
  return Cartesian3.normalize(
    Matrix4.multiplyByPointAsVector(localFrame(lon, lat), new Cartesian3(1, 0, 0), new Cartesian3()),
    new Cartesian3()
  )
}

export function useLocalLightDemo(type: LocalLightType): {
  base: ReturnType<typeof useWhiteModelTileset>
  ui: LocalLightUi
  showGizmo: Ref<boolean>
  apply: () => void
  onTilesetReady: OnTilesetReady
  mount: () => Promise<void>
  teardown: () => void
} {
  const base = useWhiteModelTileset()
  const ui = reactive(defaultLightUi())
  const showGizmo = ref(true)

  let shader: CustomShader | undefined
  let gizmo: Entity | undefined
  let tilesetRef: Cesium3DTileset | undefined

  function lightPosition(): Cartesian3 {
    return Cartesian3.fromDegrees(ui.lon, ui.lat, ui.height)
  }

  function toConfig(): LocalLightConfig {
    return {
      type,
      position: lightPosition(),
      color: hexToCartesian(ui.colorHex),
      intensity: ui.intensity,
      range: ui.range,
      decay: ui.decay,
      direction: enuVector(ui.lon, ui.lat, ui.azimuth, ui.elevation),
      innerAngle: CesiumMath.toRadians(ui.innerDeg),
      outerAngle: CesiumMath.toRadians(ui.outerDeg),
      width: ui.rectWidth,
      height: ui.rectHeight,
      up: enuEast(ui.lon, ui.lat),
      ambient: ui.ambient,
      specular: ui.specular,
      shininess: ui.shininess,
      hemiSky: hexToCartesian(ui.hemiSkyHex),
      hemiGround: hexToCartesian(ui.hemiGroundHex),
      hemiIntensity: ui.hemiIntensity
    }
  }

  function ensureGizmo(viewer: Viewer): void {
    const position = lightPosition()
    if (gizmo) {
      gizmo.position = new ConstantPositionProperty(position)
      gizmo.show = showGizmo.value
      return
    }
    gizmo = viewer.entities.add({
      position: new ConstantPositionProperty(position),
      point: {
        pixelSize: 16,
        color: (Color.fromCssColorString(ui.colorHex) ?? Color.WHITE).withAlpha(0.5),
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: '光源',
        font: '11px sans-serif',
        pixelOffset: new Cartesian2(0, -22),
        fillColor: Color.WHITE,
        outlineColor: Color.fromCssColorString('#0a1a34'),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
  }

  function apply(): void {
    const viewer = base.viewer.value
    if (!viewer || viewer.isDestroyed()) return
    if (!shader) return
    applyLocalLightUniforms(shader, toConfig())
    if (gizmo) {
      gizmo.position = new ConstantPositionProperty(lightPosition())
      gizmo.show = showGizmo.value
    }
    viewer.scene.requestRender()
  }

  const onTilesetReady: OnTilesetReady = (viewer, tileset) => {
    tilesetRef = tileset
    viewer.scene.light = new SunLight({ intensity: 0 })
    viewer.scene.highDynamicRange = true
    shader = createLocalLightShader()
    tileset.customShader = shader
    ensureGizmo(viewer)
    apply()
  }

  async function mount(): Promise<void> {
    await base.mount(onTilesetReady)
  }

  function teardown(): void {
    const viewer = base.viewer.value
    if (viewer && !viewer.isDestroyed() && gizmo) viewer.entities.remove(gizmo)
    gizmo = undefined
    if (tilesetRef) tilesetRef.customShader = undefined
    tilesetRef = undefined
    base.teardown()
    shader = undefined
  }

  return { base, ui, showGizmo, apply, onTilesetReady, mount, teardown }
}
