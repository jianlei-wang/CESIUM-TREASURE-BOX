import { createEffectTextures, disposeEffectTextures, type EffectTextures } from './textures'
import {
  buildEffect,
  defaultParamValues,
  EFFECT_META,
  type EffectId,
  type ParamValues,
  type BuiltEffect
} from './effects'
import { CesiumQuarksLayer } from './cesium-quarks-layer'
import { createMapScene, destroyScene, loadBingImagery } from '../../lib/cesium-scene'
import { Cartesian3, HeadingPitchRange, Matrix4, Math as CesiumMath, type Viewer } from 'cesium'

export interface QuarksEffectConfig {
  effect: EffectId
  lon: number
  lat: number
  cameraDistance: number
  cameraPitch: number
  cameraHeading: number
  targetHeight: number
}

export const QUARKS_DEFAULT_ORIGIN = { lon: 116.3912, lat: 39.9075, height: 0 }

export class QuarksEffectRunner {
  private readonly viewer: Viewer
  private readonly layer: CesiumQuarksLayer
  private readonly textures: EffectTextures
  private readonly config: QuarksEffectConfig
  private built: BuiltEffect | null = null
  private rebuildTimer: number | null = null

  constructor(container: HTMLElement, config: QuarksEffectConfig) {
    this.config = config
    this.viewer = createMapScene(container)
    loadBingImagery(this.viewer)
    this.orient()

    this.textures = createEffectTextures()
    this.layer = new CesiumQuarksLayer(this.viewer, container, {
      lon: config.lon,
      lat: config.lat,
      height: QUARKS_DEFAULT_ORIGIN.height
    })
  }

  private orient(): void {
    const { lon, lat, cameraDistance, cameraPitch, cameraHeading, targetHeight } = this.config
    this.viewer.camera.lookAt(
      Cartesian3.fromDegrees(lon, lat, targetHeight),
      new HeadingPitchRange(
        CesiumMath.toRadians(cameraHeading),
        CesiumMath.toRadians(cameraPitch),
        cameraDistance
      )
    )
    this.viewer.camera.lookAtTransform(Matrix4.IDENTITY)
  }

  rebuild(values: ParamValues): void {
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer)
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null
      this.apply(values)
    }, 120)
  }

  private apply(values: ParamValues): void {
    this.layer.onFrame = null
    if (this.built) {
      for (const system of this.built.systems) this.layer.removeSystem(system)
      this.built = null
    }
    this.built = buildEffect(this.config.effect, values, { textures: this.textures })
    for (const system of this.built.systems) this.layer.addSystem(system)
    this.layer.onFrame = this.built.tick ?? null
  }

  setPaused(paused: boolean): void {
    if (!this.built) return
    for (const system of this.built.systems) {
      if (paused) system.pause()
      else system.play()
    }
  }

  resetCamera(): void {
    this.orient()
  }

  dispose(): void {
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer)
    this.layer.dispose()
    disposeEffectTextures(this.textures)
    destroyScene(this.viewer)
  }
}

export { EFFECT_META, defaultParamValues }
