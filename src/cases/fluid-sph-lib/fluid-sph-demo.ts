import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  defined,
  EllipsoidGeodesic,
  PixelDatatype,
  PixelFormat,
  PrimitiveType,
  Rectangle,
  Sampler,
  ShaderSource,
  Texture,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  TextureWrap,
  Math as CesiumMath,
  type Entity,
  type Viewer
} from 'cesium'
import { CustomPrimitive } from '../flood-sim-lib/fluid-demo'
import {
  FLUID_VOLUME_GLSL,
  PARTICLE_INTEGRATION_GLSL,
  PARTICLE_SIMULATION_GLSL,
  SPH_COMMON_GLSL,
  SPH_PRELUDE_GLSL,
  SPH_VOLUME_VERTEX_GLSL,
  SURFACE_SMOOTHING_GLSL,
  generateModelMatrix,
  getBoxGeometry,
  getFullscreenQuad,
  type Extent
} from './sph-shaders'

export type FluidSphParams = {
  waterAddRate: number
  waterSourceRadius: number
  gravity: number
  initialWaterLevel: number
  depth: number
  shallow: Color
  deep: Color
  waterAlpha: number
  waterSource: Cartesian2
}

export type FluidSphStats = {
  frame: number
  running: boolean
  textureSize: number
}

type SimulationSettings = {
  minElevation: number
  maxElevation: number
}

export class FluidSphDemo {
  viewer: Viewer
  settings: SimulationSettings
  extent: Extent
  params: FluidSphParams
  textureSize = 1024
  volumeCenterElevation: number
  volumeThickness: number
  image: HTMLImageElement | HTMLCanvasElement
  waterSource: Cartesian2
  flowVisible = false
  frame = 0
  running = true
  outlineOnly: Entity | undefined
  textures: Texture[] = []
  integrationStage: CustomPrimitive | undefined
  simulationStage: CustomPrimitive | undefined
  smoothingStage: CustomPrimitive | undefined
  historyStage: CustomPrimitive | undefined
  volumeStage: CustomPrimitive | undefined

  constructor(
    viewer: Viewer,
    params: FluidSphParams,
    settings: SimulationSettings,
    image: HTMLImageElement | HTMLCanvasElement,
    extent: Extent
  ) {
    this.viewer = viewer
    this.params = params
    this.settings = settings
    this.extent = extent
    this.waterSource = params.waterSource
    this.volumeCenterElevation =
      (settings.maxElevation - settings.minElevation) / 2 + settings.minElevation
    this.volumeThickness = settings.maxElevation - settings.minElevation
    this.image = image
    this.buildPipeline()
  }

  getStats(): FluidSphStats {
    return {
      frame: this.frame,
      running: this.running,
      textureSize: this.textureSize
    }
  }

  setRunning(running: boolean): void {
    this.running = running
    if (this.integrationStage) this.integrationStage.show = running
    if (this.simulationStage) this.simulationStage.show = running
    if (this.historyStage) this.historyStage.show = running
  }

  setWaterSource(position: Cartesian2): void {
    this.waterSource = position
  }

  setWaterParams(partial: Partial<FluidSphParams>): void {
    Object.assign(this.params, partial)
  }

  setFlowVisible(visible: boolean): void {
    this.flowVisible = visible
  }

  private buildPipeline(): void {
    const context = (this.viewer.scene as unknown as { context: object }).context
    const createFloatTexture = (): Texture => {
      const tex = new Texture({
        context,
        width: this.textureSize,
        height: this.textureSize,
        pixelFormat: PixelFormat.RGBA,
        pixelDatatype: PixelDatatype.FLOAT,
        source: { arrayBufferView: new Float32Array(this.textureSize * this.textureSize * 4) }
      })
      this.textures.push(tex)
      return tex
    }
    const particleTexture = createFloatTexture()
    const simulationTexture = createFloatTexture()
    const surfaceTexture = createFloatTexture()
    const historyTexture = createFloatTexture()

    const quadGeometry = getFullscreenQuad()

    const heightMapTexture = new Texture({
      context,
      width: this.textureSize,
      height: this.textureSize,
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
      flipY: false,
      sampler: new Sampler({
        minificationFilter: TextureMinificationFilter.LINEAR,
        magnificationFilter: TextureMagnificationFilter.LINEAR,
        wrapS: TextureWrap.REPEAT,
        wrapT: TextureWrap.REPEAT
      }),
      source: this.image as unknown as never
    })
    this.textures.push(heightMapTexture)

    const self = this
    const waterUniforms = {
      waterSource: () => self.waterSource,
      waterAddRate: () => self.params.waterAddRate,
      waterSourceRadius: () => self.params.waterSourceRadius,
      gravity: () => self.params.gravity
    }

    this.integrationStage = new CustomPrimitive({
      commandType: 'Compute',
      uniformMap: {
        iFrame: () => self.frame,
        iChannel0: () => historyTexture,
        initialMass: () => self.params.initialWaterLevel
      },
      fragmentShaderSource: new ShaderSource({
        sources: [SPH_PRELUDE_GLSL, SPH_COMMON_GLSL, PARTICLE_INTEGRATION_GLSL]
      }),
      geometry: quadGeometry,
      outputTexture: particleTexture
    })

    this.simulationStage = new CustomPrimitive({
      commandType: 'Compute',
      uniformMap: {
        iChannel0: () => particleTexture,
        heightMap: () => heightMapTexture,
        ...waterUniforms
      },
      fragmentShaderSource: new ShaderSource({
        sources: [SPH_PRELUDE_GLSL, SPH_COMMON_GLSL, PARTICLE_SIMULATION_GLSL]
      }),
      geometry: quadGeometry,
      outputTexture: simulationTexture
    })

    this.smoothingStage = new CustomPrimitive({
      commandType: 'Compute',
      uniformMap: {
        iChannel0: () => simulationTexture,
        heightMap: () => heightMapTexture
      },
      fragmentShaderSource: new ShaderSource({
        sources: [SPH_PRELUDE_GLSL, SPH_COMMON_GLSL, SURFACE_SMOOTHING_GLSL]
      }),
      geometry: quadGeometry,
      outputTexture: surfaceTexture
    })

    this.historyStage = new CustomPrimitive({
      commandType: 'Compute',
      uniformMap: {
        iChannel0: () => simulationTexture,
        heightMap: () => heightMapTexture,
        ...waterUniforms
      },
      fragmentShaderSource: new ShaderSource({
        sources: [SPH_PRELUDE_GLSL, SPH_COMMON_GLSL, PARTICLE_SIMULATION_GLSL]
      }),
      geometry: quadGeometry,
      outputTexture: historyTexture
    })

    const [west, south, east, north] = this.extent
    const rectangle = Rectangle.fromDegrees(west, south, east, north)
    const center = Rectangle.center(rectangle)

    const verticalGeodesic = new EllipsoidGeodesic(
      new Cartographic(center.longitude, rectangle.south),
      new Cartographic(center.longitude, rectangle.north)
    )
    const boxHeight = verticalGeodesic.surfaceDistance

    const horizontalGeodesic = new EllipsoidGeodesic(
      new Cartographic(rectangle.west, center.latitude),
      new Cartographic(rectangle.east, center.latitude)
    )
    const boxWidth = horizontalGeodesic.surfaceDistance

    const centerLongitude = CesiumMath.toDegrees(center.longitude)
    const centerLatitude = CesiumMath.toDegrees(center.latitude)
    const modelMatrix = generateModelMatrix(
      [centerLongitude, centerLatitude, this.volumeCenterElevation],
      [90, 0, 0],
      [boxWidth, this.volumeThickness, boxHeight]
    )

    this.outlineOnly = this.viewer.entities.add({
      name: 'SPH 流体模拟范围',
      position: Cartesian3.fromDegrees(centerLongitude, centerLatitude, this.volumeCenterElevation),
      box: {
        dimensions: new Cartesian3(boxWidth, boxHeight, this.volumeThickness),
        fill: false,
        outline: true,
        outlineColor: Color.fromCssColorString('#f6ca55')
      }
    })

    const geometry = getBoxGeometry()
    const attributeLocations: Record<string, number> = { position: 0, st: 1 }

    this.volumeStage = new CustomPrimitive({
      commandType: 'Draw',
      uniformMap: {
        iChannel0: () => surfaceTexture,
        depth: () => self.params.depth,
        shallow: () => self.params.shallow,
        deep: () => self.params.deep,
        waterAlpha: () => self.params.waterAlpha,
        flowVisible: () => (self.flowVisible ? 1 : 0),
        arrowRatio: () => boxHeight / Math.max(boxWidth, 1e-6),
        arrowCount: () => 48
      },
      geometry,
      modelMatrix,
      attributeLocations,
      primitiveType: PrimitiveType.TRIANGLES as never,
      vertexShaderSource: new ShaderSource({
        sources: [SPH_VOLUME_VERTEX_GLSL]
      }),
      fragmentShaderSource: new ShaderSource({
        sources: [SPH_PRELUDE_GLSL, SPH_COMMON_GLSL, FLUID_VOLUME_GLSL]
      })
    })

    this.viewer.scene.postRender.addEventListener(this.onPostRender)
    this.viewer.scene.primitives.add(this.integrationStage)
    this.viewer.scene.primitives.add(this.simulationStage)
    this.viewer.scene.primitives.add(this.smoothingStage)
    this.viewer.scene.primitives.add(this.historyStage)
    this.viewer.scene.primitives.add(this.volumeStage)
  }

  onPostRender = (): void => {
    if (this.running) {
      this.frame += 1
    }
  }

  destroy(): void {
    if (!this.viewer.isDestroyed()) {
      this.viewer.scene.postRender.removeEventListener(this.onPostRender)
      if (this.volumeStage) this.viewer.scene.primitives.remove(this.volumeStage)
      if (this.historyStage) this.viewer.scene.primitives.remove(this.historyStage)
      if (this.smoothingStage) this.viewer.scene.primitives.remove(this.smoothingStage)
      if (this.simulationStage) this.viewer.scene.primitives.remove(this.simulationStage)
      if (this.integrationStage) this.viewer.scene.primitives.remove(this.integrationStage)
      if (this.outlineOnly) this.viewer.entities.remove(this.outlineOnly)
    }
    for (const tex of this.textures) {
      if (defined(tex) && !tex.isDestroyed()) tex.destroy()
    }
    this.textures = []
    this.integrationStage = undefined
    this.simulationStage = undefined
    this.smoothingStage = undefined
    this.historyStage = undefined
    this.volumeStage = undefined
    this.outlineOnly = undefined
  }

  isDestroyed(): boolean {
    return false
  }
}
