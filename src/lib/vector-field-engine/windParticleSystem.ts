import { ClearCommand, Color, Pass, type Scene } from 'cesium'
import { WindParticlesComputing } from './windParticlesComputing'
import { WindParticlesRendering } from './windParticlesRendering'
import CustomPrimitive from './customPrimitive'
import { deepMerge } from './utils'
import type { ViewerParameters, WindData3D, WindLayerOptions } from './types'

export class WindParticleSystem {
  context: object
  options: WindLayerOptions
  viewerParameters: ViewerParameters
  computing: WindParticlesComputing
  rendering: WindParticlesRendering

  constructor(
    context: object,
    windData: WindData3D,
    options: WindLayerOptions,
    viewerParameters: ViewerParameters,
    scene: Scene
  ) {
    this.context = context
    this.options = options
    this.viewerParameters = viewerParameters
    this.computing = new WindParticlesComputing(context, windData, options, viewerParameters, scene)
    this.rendering = new WindParticlesRendering(context, options, viewerParameters, this.computing)
    this.clearFramebuffers()
  }

  getPrimitives(): CustomPrimitive[] {
    return [
      this.computing.primitives.calculateSpeed,
      this.computing.primitives.updatePosition,
      this.computing.primitives.postProcessingPosition,
      this.rendering.primitives.segments
    ]
  }

  clearFramebuffers(): void {
    const clearCommand = new ClearCommand({
      color: new Color(0.0, 0.0, 0.0, 0.0),
      depth: 1.0,
      framebuffer: undefined,
      pass: Pass.OPAQUE
    })

    Object.keys(this.rendering.framebuffers).forEach((key) => {
      clearCommand.framebuffer = this.rendering.framebuffers[key as keyof typeof this.rendering.framebuffers]
      clearCommand.execute(this.context)
    })
  }

  changeOptions(options: Partial<WindLayerOptions>): void {
    let maxParticlesChanged = false
    if (
      options.particlesTextureSize &&
      this.options.particlesTextureSize !== options.particlesTextureSize
    ) {
      maxParticlesChanged = true
    }

    const newOptions = deepMerge(options, this.options)
    if (newOptions.particlesTextureSize < 1) {
      throw new Error('particlesTextureSize must be greater than 0')
    }
    this.options = newOptions

    this.rendering.updateOptions(options)
    this.computing.updateOptions(options)
    if (maxParticlesChanged) {
      this.computing.destroyParticlesTextures()
      this.computing.createParticlesTextures()
      this.rendering.onParticlesTextureSizeChange()
    }
  }

  applyViewerParameters(viewerParameters: ViewerParameters): void {
    this.viewerParameters = viewerParameters
    this.computing.viewerParameters = viewerParameters
    this.rendering.viewerParameters = viewerParameters
  }

  destroy(): void {
    this.computing.destroy()
    this.rendering.destroy()
  }
}
