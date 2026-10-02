import {
  BufferUsage,
  ClearCommand,
  Color,
  ComputeCommand,
  defined,
  destroyObject,
  DrawCommand,
  Geometry,
  Matrix4,
  Pass,
  PrimitiveType,
  RenderState,
  ShaderProgram,
  ShaderSource,
  VertexArray,
  type ClearCommand as ClearCommandType
} from 'cesium'

export type CommandType = 'Draw' | 'Compute'

type UniformMap = Record<string, () => unknown>

export type CustomPrimitiveOptions = {
  commandType: CommandType
  geometry?: Geometry
  attributeLocations?: Record<string, number>
  primitiveType?: PrimitiveType
  uniformMap?: UniformMap
  vertexShaderSource?: ShaderSource
  fragmentShaderSource?: ShaderSource
  rawRenderState?: unknown
  framebuffer?: object
  outputTexture?: object
  autoClear?: boolean
  preExecute?: () => void
  isDynamic?: () => boolean
}

type RenderCommand = DrawCommand | ComputeCommand

export default class CustomPrimitive {
  commandType: CommandType
  geometry?: Geometry
  attributeLocations?: Record<string, number>
  primitiveType?: PrimitiveType
  uniformMap: UniformMap
  vertexShaderSource?: ShaderSource
  fragmentShaderSource?: ShaderSource
  rawRenderState?: unknown
  framebuffer?: object
  outputTexture?: object
  autoClear: boolean
  preExecute?: () => void
  isDynamic: () => boolean
  show: boolean
  commandToExecute?: RenderCommand
  clearCommand?: ClearCommandType

  constructor(options: CustomPrimitiveOptions) {
    this.commandType = options.commandType
    this.geometry = options.geometry
    this.attributeLocations = options.attributeLocations
    this.primitiveType = options.primitiveType
    this.uniformMap = options.uniformMap || {}
    this.vertexShaderSource = options.vertexShaderSource
    this.fragmentShaderSource = options.fragmentShaderSource
    this.rawRenderState = options.rawRenderState
    this.framebuffer = options.framebuffer
    this.outputTexture = options.outputTexture
    this.autoClear = options.autoClear ?? false
    this.preExecute = options.preExecute

    this.show = true
    this.commandToExecute = undefined
    this.clearCommand = undefined
    this.isDynamic = options.isDynamic ?? (() => true)

    if (this.autoClear) {
      this.clearCommand = new ClearCommand({
        color: new Color(0.0, 0.0, 0.0, 0.0),
        depth: 1.0,
        framebuffer: this.framebuffer as never,
        pass: Pass.OPAQUE
      })
    }
  }

  createCommand(context: object): RenderCommand {
    if (this.commandType === 'Draw') {
      const vertexArray = VertexArray.fromGeometry({
        context,
        geometry: this.geometry,
        attributeLocations: this.attributeLocations,
        bufferUsage: BufferUsage.STATIC_DRAW
      })

      const shaderProgram = ShaderProgram.fromCache({
        context,
        vertexShaderSource: this.vertexShaderSource,
        fragmentShaderSource: this.fragmentShaderSource,
        attributeLocations: this.attributeLocations
      })

      const renderState = RenderState.fromCache(this.rawRenderState)
      return new DrawCommand({
        owner: this,
        vertexArray,
        primitiveType: this.primitiveType,
        modelMatrix: Matrix4.IDENTITY,
        renderState,
        shaderProgram,
        framebuffer: this.framebuffer as never,
        uniformMap: this.uniformMap,
        pass: Pass.OPAQUE
      })
    }

    if (this.commandType === 'Compute') {
      return new ComputeCommand({
        owner: this,
        fragmentShaderSource: this.fragmentShaderSource,
        uniformMap: this.uniformMap,
        outputTexture: this.outputTexture as never,
        persists: true
      })
    }
    throw new Error('Unknown command type')
  }

  setGeometry(context: object, geometry: Geometry): void {
    this.geometry = geometry
    if (defined(this.commandToExecute)) {
      const command = this.commandToExecute as DrawCommand
      command.vertexArray = VertexArray.fromGeometry({
        context,
        geometry: this.geometry,
        attributeLocations: this.attributeLocations,
        bufferUsage: BufferUsage.STATIC_DRAW
      })
    }
  }

  update(frameState: { context: object; commandList: unknown[] }): void {
    if (!this.isDynamic()) return
    if (!this.show || !defined(frameState)) return

    if (!defined(this.commandToExecute)) {
      this.commandToExecute = this.createCommand(frameState.context)
    }

    if (defined(this.preExecute)) {
      this.preExecute()
    }

    if (!frameState.commandList) {
      console.warn('frameState.commandList is undefined')
      return
    }

    if (defined(this.clearCommand)) {
      frameState.commandList.push(this.clearCommand)
    }

    if (defined(this.commandToExecute)) {
      frameState.commandList.push(this.commandToExecute)
    }
  }

  isDestroyed(): boolean {
    return false
  }

  destroy(): void {
    if (defined(this.commandToExecute)) {
      const shaderProgram = (this.commandToExecute as DrawCommand).shaderProgram
      shaderProgram?.destroy()
      ;(this.commandToExecute as DrawCommand).shaderProgram = undefined
    }
    destroyObject(this)
  }
}
