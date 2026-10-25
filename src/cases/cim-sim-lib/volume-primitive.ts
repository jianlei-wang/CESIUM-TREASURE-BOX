import {
  BlendingState,
  BoundingSphere,
  BoxGeometry,
  Cartesian3,
  CullFace,
  DrawCommand,
  GeometryPipeline,
  Matrix4,
  Pass,
  PixelDatatype,
  PixelFormat,
  RenderState,
  Sampler,
  ShaderProgram,
  ShaderSource,
  Texture3D,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  VertexArray,
  VertexFormat
} from 'cesium'

type UniformMap = Record<string, () => unknown>

export type VolumePrimitiveOptions = {
  modelMatrix: Matrix4
  dimensions: Cartesian3
  size: number
  data?: Uint8Array
  fragmentShaderSource: string
  uniforms?: UniformMap
  translucent?: boolean
  useTexture?: boolean
}

const VERTEX_SHADER = `
in vec3 position;
in vec2 st;
out vec3 vOrigin;
out vec3 vDirection;
out vec2 vst;

void main()
{
  vOrigin = czm_encodedCameraPositionMCHigh + czm_encodedCameraPositionMCLow;
  vDirection = position - vOrigin;
  vst = st;
  gl_Position = czm_modelViewProjection * vec4(position, 1.0);
}
`

export class VolumePrimitive {
  private options: VolumePrimitiveOptions
  private drawCommand?: DrawCommand
  private texture?: Texture3D
  private show = true
  private destroyed = false

  constructor(options: VolumePrimitiveOptions) {
    this.options = options
  }

  setShow(value: boolean): void {
    this.show = value
  }

  update(frameState: { context: { webgl2: boolean }; commandList: unknown[] }): void {
    if (this.destroyed || !this.show) return
    if (!frameState.context.webgl2) return
    if (!this.drawCommand) {
      this.drawCommand = this.createCommand(frameState.context)
    }
    ;(frameState.commandList as DrawCommand[]).push(this.drawCommand)
  }

  private createCommand(context: object): DrawCommand {
    const halfDim = Cartesian3.divideByScalar(this.options.dimensions, 2, new Cartesian3())
    const radius = Cartesian3.magnitude(halfDim)
    const geometry = BoxGeometry.createGeometry(
      BoxGeometry.fromDimensions({
        vertexFormat: VertexFormat.POSITION_AND_ST,
        dimensions: this.options.dimensions
      })
    )!
    const attributeLocations = GeometryPipeline.createAttributeLocations(geometry)
    const vertexArray = VertexArray.fromGeometry({ context, geometry, attributeLocations })
    const shaderProgram = ShaderProgram.fromCache({
      context,
      vertexShaderSource: new ShaderSource({ sources: [VERTEX_SHADER] }),
      fragmentShaderSource: new ShaderSource({ sources: [this.options.fragmentShaderSource] }),
      attributeLocations
    })
    const renderState = RenderState.fromCache({
      depthTest: { enabled: true },
      depthMask: !this.options.translucent,
      cull: { enabled: true, face: CullFace.BACK },
      blending: this.options.translucent ? BlendingState.ALPHA_BLEND : undefined
    })

    const uniformMap: UniformMap = {
      halfdim: () => halfDim,
      ...(this.options.uniforms ?? {})
    }
    if (this.options.useTexture !== false && this.options.data) {
      uniformMap.volumeTexture = () => this.getTexture(context)
    }

    const localSphere = new BoundingSphere(Cartesian3.ZERO, radius)
    const boundingVolume = BoundingSphere.transform(localSphere, this.options.modelMatrix, new BoundingSphere())

    return new DrawCommand({
      owner: this,
      vertexArray,
      shaderProgram,
      renderState,
      uniformMap,
      pass: this.options.translucent ? Pass.TRANSLUCENT : Pass.OPAQUE,
      modelMatrix: this.options.modelMatrix,
      boundingVolume,
      cull: true
    })
  }

  private getTexture(context: object): Texture3D {
    if (!this.texture) {
      this.texture = new Texture3D({
        context: context as never,
        width: this.options.size,
        height: this.options.size,
        depth: this.options.size,
        pixelFormat: PixelFormat.RED,
        pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
        flipY: false,
        sampler: new Sampler({
          minificationFilter: TextureMinificationFilter.LINEAR,
          magnificationFilter: TextureMagnificationFilter.LINEAR
        }),
        source: {
          width: this.options.size,
          height: this.options.size,
          depth: this.options.size,
          arrayBufferView: this.options.data as Uint8Array
        }
      })
    }
    return this.texture
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.drawCommand) {
      const command = this.drawCommand
      const vertexArray = command.vertexArray as { destroy?: () => void } | undefined
      const shaderProgram = command.shaderProgram as { destroy?: () => void } | undefined
      vertexArray?.destroy?.()
      shaderProgram?.destroy?.()
      command.vertexArray = undefined
      command.shaderProgram = undefined
      this.drawCommand = undefined
    }
    const texture = this.texture as { destroy?: () => void } | undefined
    texture?.destroy?.()
    this.texture = undefined
  }
}
