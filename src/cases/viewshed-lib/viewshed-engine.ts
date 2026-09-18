// @ts-nocheck
// This file is a direct port of Cesium's internal ShadowMap and
// RectangularSensorPrimitive implementations. Cesium 1.144 does not export
// the internal helpers (defaultValue, defineProperties, CesiumMath), so they
// are reimplemented here for runtime use.
import * as Cesium from 'cesium'

const defined = (value: unknown): boolean => value !== undefined && value !== null

function defaultValue(value: unknown, fallback: unknown): unknown {
  return defined(value) ? value : fallback
}
defaultValue.EMPTY_OBJECT = Object.freeze({})

export class ViewshedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ViewshedError'
  }
}

class LonLat {
  lon: number
  lat: number
  alt: number

  constructor(lon: number, lat: number, alt?: number) {
    this.lon = lon
    this.lat = lat
    this.alt = defaultValue(alt, 0)
  }

  static toCartesian(point: unknown, viewer?: Cesium.Viewer): Cesium.Cartesian3 | undefined {
    if (!defined(point)) {
      return undefined
    }
    if (point instanceof Cesium.Cartesian3) {
      return point
    }
    if (point instanceof Cesium.Cartographic) {
      return Cesium.Cartographic.toCartesian(point)
    }
    if (point instanceof LonLat) {
      return Cesium.Cartesian3.fromDegrees(point.lon, point.lat, point.alt)
    }
    if (point instanceof Cesium.Cartesian2 && viewer) {
      const ray = viewer.scene.camera.getPickRay(point)
      return viewer.scene.globe.pick(ray!, viewer.scene)
    }
    if (Array.isArray(point)) {
      return Cesium.Cartesian3.fromDegrees(point[0] as number, point[1] as number, defaultValue(point[2] as number, 0))
    }
    const typed = point as { lon: number; lat: number; alt?: number }
    if (typeof typed.lon === 'number' && typeof typed.lat === 'number') {
      return Cesium.Cartesian3.fromDegrees(typed.lon, typed.lat, defaultValue(typed.alt, 0))
    }
    return undefined
  }
}

class ViewShadowPrimitive {
  _shadowMap: Cesium.ShadowMap
  _show: boolean

  constructor(shadowMap: Cesium.ShadowMap) {
    if (!defined(shadowMap)) {
      throw new ViewshedError('parameter shadowMap is required.')
    }
    this._shadowMap = shadowMap
    this._show = true
  }

  get show() {
    return this._show
  }

  set show(val: boolean) {
    this._show = val
  }

  update(frameState: unknown) {
    ;(frameState as { shadowMaps: Cesium.ShadowMap[] }).shadowMaps.push(this._shadowMap)
  }

  destroy() {
    if (this._shadowMap && !this._shadowMap.isDestroyed()) {
      this._shadowMap.destroy()
    }
    return Cesium.destroyObject(this)
  }

  isDestroyed() {
    return false
  }
}

const ViewshedMap = (() => {
  const {
    BoundingRectangle,
    BoundingSphere,
    Cartesian2,
    Cartesian3,
    Cartesian4,
    Cartographic,
    Color,
    combine,
    CullingVolume,
    defined,
    destroyObject,
    DeveloperError,
    FeatureDetection,
    Intersect,
    Matrix4,
    OrthographicOffCenterFrustum,
    PerspectiveFrustum,
    PixelFormat,
    WebGLConstants,
    ClearCommand,
    ContextLimits,
    CubeMap,
    DrawCommand,
    Framebuffer,
    Pass,
    PassState,
    PixelDatatype,
    Renderbuffer,
    RenderbufferFormat,
    RenderState,
    Sampler,
    Texture,
    TextureMagnificationFilter,
    TextureMinificationFilter,
    TextureWrap,
    Camera,
    CullFace,
    ShadowMapShader,
    ShaderSource
  } = Cesium as any

  const CesiumMath = Cesium.Math
  const defineProperties = Object.defineProperties

  function ViewshedMap(options: any) {
    options = defaultValue(options, defaultValue.EMPTY_OBJECT)
    const context = options.context

    if (!defined(context)) {
      throw new DeveloperError('context is required.')
    }
    if (!defined(options.lightCamera)) {
      throw new DeveloperError('lightCamera is required.')
    }
    if (defined(options.numberOfCascades) && options.numberOfCascades !== 1 && options.numberOfCascades !== 4) {
      throw new DeveloperError('Only one or four cascades are supported.')
    }

    this._enabled = defaultValue(options.enabled, true)
    this._softShadows = defaultValue(options.softShadows, false)
    this._normalOffset = defaultValue(options.normalOffset, true)
    this.dirty = true

    this.fromLightSource = defaultValue(options.fromLightSource, true)

    this.darkness = 0.0
    this._darkness = this.darkness

    this.maximumDistance = defaultValue(options.maximumDistance, 5000.0)

    this._outOfView = false
    this._outOfViewPrevious = false
    this._needsUpdate = true

    let polygonOffsetSupported = true
    if (
      FeatureDetection.isEdge() ||
      ((FeatureDetection.isChrome() || FeatureDetection.isFirefox()) &&
        FeatureDetection.isWindows() &&
        !context.depthTexture)
    ) {
      polygonOffsetSupported = false
    }
    this._polygonOffsetSupported = polygonOffsetSupported

    this._terrainBias = {
      polygonOffset: polygonOffsetSupported,
      polygonOffsetFactor: 1.1,
      polygonOffsetUnits: 4.0,
      normalOffset: this._normalOffset,
      normalOffsetScale: 0.5,
      normalShading: true,
      normalShadingSmooth: 0.3,
      depthBias: 0.0001
    }

    this._primitiveBias = {
      polygonOffset: polygonOffsetSupported,
      polygonOffsetFactor: 1.1,
      polygonOffsetUnits: 4.0,
      normalOffset: this._normalOffset,
      normalOffsetScale: 0.1,
      normalShading: true,
      normalShadingSmooth: 0.05,
      depthBias: 0.00002
    }

    this._pointBias = {
      polygonOffset: false,
      polygonOffsetFactor: 1.1,
      polygonOffsetUnits: 4.0,
      normalOffset: this._normalOffset,
      normalOffsetScale: 0.0,
      normalShading: true,
      normalShadingSmooth: 0.1,
      depthBias: 0.0005
    }

    this._depthAttachment = undefined
    this._colorAttachment = undefined

    this._shadowMapMatrix = new Matrix4()
    this._shadowMapTexture = undefined
    this._lightDirectionEC = new Cartesian3()
    this._lightPositionEC = new Cartesian4()
    this._distance = 0.0

    this._lightCamera = options.lightCamera
    this._shadowMapCamera = new ShadowMapCamera()
    this._shadowMapCullingVolume = undefined
    this._sceneCamera = undefined
    this._boundingSphere = defaultValue(options.boundingSphere, new BoundingSphere())

    this._isPointLight = defaultValue(options.isPointLight, false)
    this._pointLightRadius = defaultValue(options.pointLightRadius, 100.0)

    this._cascadesEnabled = false
    this._numberOfCascades = !this._cascadesEnabled ? 0 : defaultValue(options.numberOfCascades, 4)
    this._fitNearFar = true
    this._maximumCascadeDistances = [25.0, 150.0, 700.0, Number.MAX_VALUE]

    this._textureSize = new Cartesian2()

    this._isSpotLight = false
    if (this._cascadesEnabled) {
      this._shadowMapCamera.frustum = new OrthographicOffCenterFrustum()
    } else if (defined(this._lightCamera.frustum.fov)) {
      this._isSpotLight = true
    }

    this._cascadeSplits = [new Cartesian4(), new Cartesian4()]
    this._cascadeMatrices = [new Matrix4(), new Matrix4(), new Matrix4(), new Matrix4()]
    this._cascadeDistances = new Cartesian4()

    let numberOfPasses
    if (this._isPointLight) {
      numberOfPasses = 6
    } else if (!this._cascadesEnabled) {
      numberOfPasses = 1
    } else {
      numberOfPasses = this._numberOfCascades
    }

    this._passes = new Array(numberOfPasses)
    for (let i = 0; i < numberOfPasses; ++i) {
      this._passes[i] = new ShadowPass(context)
    }

    this._debugCascadeColors = false

    this._usesDepthTexture = context.depthTexture

    if (this._isPointLight) {
      this._usesDepthTexture = false
    }

    this._primitiveRenderState = undefined
    this._terrainRenderState = undefined
    this._pointRenderState = undefined
    createRenderStates(this)

    this._clearCommand = new ClearCommand({
      depth: 1.0,
      color: new Color()
    })

    this._clearPassState = new PassState(context)

    this._size = defaultValue(options.size, 2048)
    this.size = this._size
  }

  ViewshedMap.MAXIMUM_DISTANCE = 20000.0

  function ShadowPass(context: any) {
    this.camera = new ShadowMapCamera()
    this.passState = new PassState(context)
    this.framebuffer = undefined
    this.textureOffsets = undefined
    this.commandList = []
    this.cullingVolume = undefined
  }

  function createRenderState(colorMask: any, bias: any) {
    return RenderState.fromCache({
      cull: {
        enabled: true,
        face: CullFace.BACK
      },
      depthTest: {
        enabled: true
      },
      colorMask: {
        red: colorMask,
        green: colorMask,
        blue: colorMask,
        alpha: colorMask
      },
      depthMask: true,
      polygonOffset: {
        enabled: bias.polygonOffset,
        factor: bias.polygonOffsetFactor,
        units: bias.polygonOffsetUnits
      }
    })
  }

  function createRenderStates(shadowMap: any) {
    const colorMask = !shadowMap._usesDepthTexture
    shadowMap._primitiveRenderState = createRenderState(colorMask, shadowMap._primitiveBias)
    shadowMap._terrainRenderState = createRenderState(colorMask, shadowMap._terrainBias)
    shadowMap._pointRenderState = createRenderState(colorMask, shadowMap._pointBias)
  }

  defineProperties(ViewshedMap.prototype, {
    enabled: {
      get: function () {
        return this._enabled
      },
      set: function (value: boolean) {
        this.dirty = this._enabled !== value
        this._enabled = value
      }
    },
    isViewShed: {
      get: function () {
        return true
      }
    },
    normalOffset: {
      get: function () {
        return this._normalOffset
      },
      set: function (value: boolean) {
        this.dirty = this._normalOffset !== value
        this._normalOffset = value
        this._terrainBias.normalOffset = value
        this._primitiveBias.normalOffset = value
        this._pointBias.normalOffset = value
      }
    },
    softShadows: {
      get: function () {
        return this._softShadows
      },
      set: function (value: boolean) {
        this.dirty = this._softShadows !== value
        this._softShadows = value
      }
    },
    size: {
      get: function () {
        return this._size
      },
      set: function (value: number) {
        resize(this, value)
      }
    },
    outOfView: {
      get: function () {
        return this._outOfView
      }
    },
    shadowMapCullingVolume: {
      get: function () {
        return this._shadowMapCullingVolume
      }
    },
    passes: {
      get: function () {
        return this._passes
      }
    },
    isPointLight: {
      get: function () {
        return this._isPointLight
      }
    },
    debugCascadeColors: {
      get: function () {
        return this._debugCascadeColors
      },
      set: function (value: boolean) {
        this.dirty = this._debugCascadeColors !== value
        this._debugCascadeColors = value
      }
    }
  })

  function destroyFramebuffer(shadowMap: any) {
    const length = shadowMap._passes.length
    for (let i = 0; i < length; ++i) {
      const pass = shadowMap._passes[i]
      const framebuffer = pass.framebuffer
      if (defined(framebuffer) && !framebuffer.isDestroyed()) {
        framebuffer.destroy()
      }
      pass.framebuffer = undefined
    }

    shadowMap._depthAttachment = shadowMap._depthAttachment && shadowMap._depthAttachment.destroy()
    shadowMap._colorAttachment = shadowMap._colorAttachment && shadowMap._colorAttachment.destroy()
  }

  function createSampler() {
    return new Sampler({
      wrapS: TextureWrap.CLAMP_TO_EDGE,
      wrapT: TextureWrap.CLAMP_TO_EDGE,
      minificationFilter: TextureMinificationFilter.NEAREST,
      magnificationFilter: TextureMagnificationFilter.NEAREST
    })
  }

  function createFramebufferColor(shadowMap: any, context: any) {
    const depthRenderbuffer = new Renderbuffer({
      context: context,
      width: shadowMap._textureSize.x,
      height: shadowMap._textureSize.y,
      format: RenderbufferFormat.DEPTH_COMPONENT16
    })

    const colorTexture = new Texture({
      context: context,
      width: shadowMap._textureSize.x,
      height: shadowMap._textureSize.y,
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
      sampler: createSampler()
    })

    const framebuffer = new Framebuffer({
      context: context,
      depthRenderbuffer: depthRenderbuffer,
      colorTextures: [colorTexture],
      destroyAttachments: false
    })

    const length = shadowMap._passes.length
    for (let i = 0; i < length; ++i) {
      const pass = shadowMap._passes[i]
      pass.framebuffer = framebuffer
      pass.passState.framebuffer = framebuffer
    }

    shadowMap._shadowMapTexture = colorTexture
    shadowMap._depthAttachment = depthRenderbuffer
    shadowMap._colorAttachment = colorTexture
  }

  function createFramebufferDepth(shadowMap: any, context: any) {
    const depthStencilTexture = new Texture({
      context: context,
      width: shadowMap._textureSize.x,
      height: shadowMap._textureSize.y,
      pixelFormat: PixelFormat.DEPTH_STENCIL,
      pixelDatatype: PixelDatatype.UNSIGNED_INT_24_8,
      sampler: createSampler()
    })

    const framebuffer = new Framebuffer({
      context: context,
      depthStencilTexture: depthStencilTexture,
      destroyAttachments: false
    })

    const length = shadowMap._passes.length
    for (let i = 0; i < length; ++i) {
      const pass = shadowMap._passes[i]
      pass.framebuffer = framebuffer
      pass.passState.framebuffer = framebuffer
    }

    shadowMap._shadowMapTexture = depthStencilTexture
    shadowMap._depthAttachment = depthStencilTexture
  }

  function createFramebufferCube(shadowMap: any, context: any) {
    const depthRenderbuffer = new Renderbuffer({
      context: context,
      width: shadowMap._textureSize.x,
      height: shadowMap._textureSize.y,
      format: RenderbufferFormat.DEPTH_COMPONENT16
    })

    const cubeMap = new CubeMap({
      context: context,
      width: shadowMap._textureSize.x,
      height: shadowMap._textureSize.y,
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
      sampler: createSampler()
    })

    const faces = [
      cubeMap.negativeX,
      cubeMap.negativeY,
      cubeMap.negativeZ,
      cubeMap.positiveX,
      cubeMap.positiveY,
      cubeMap.positiveZ
    ]

    for (let i = 0; i < 6; ++i) {
      const framebuffer = new Framebuffer({
        context: context,
        depthRenderbuffer: depthRenderbuffer,
        colorTextures: [faces[i]],
        destroyAttachments: false
      })
      const pass = shadowMap._passes[i]
      pass.framebuffer = framebuffer
      pass.passState.framebuffer = framebuffer
    }

    shadowMap._shadowMapTexture = cubeMap
    shadowMap._depthAttachment = depthRenderbuffer
    shadowMap._colorAttachment = cubeMap
  }

  function createFramebuffer(shadowMap: any, context: any) {
    if (shadowMap._isPointLight) {
      createFramebufferCube(shadowMap, context)
    } else if (shadowMap._usesDepthTexture) {
      createFramebufferDepth(shadowMap, context)
    } else {
      createFramebufferColor(shadowMap, context)
    }
  }

  function checkFramebuffer(shadowMap: any, context: any) {
    if (
      shadowMap._usesDepthTexture &&
      shadowMap._passes[0].framebuffer.status !== WebGLConstants.FRAMEBUFFER_COMPLETE
    ) {
      shadowMap._usesDepthTexture = false
      createRenderStates(shadowMap)
      destroyFramebuffer(shadowMap)
      createFramebuffer(shadowMap, context)
    }
  }

  function updateFramebuffer(shadowMap: any, context: any) {
    if (!defined(shadowMap._passes[0].framebuffer) || shadowMap._shadowMapTexture.width !== shadowMap._textureSize.x) {
      destroyFramebuffer(shadowMap)
      createFramebuffer(shadowMap, context)
      checkFramebuffer(shadowMap, context)
      clearFramebuffer(shadowMap, context)
    }
  }

  function clearFramebuffer(shadowMap: any, context: any, shadowPass?: number) {
    shadowPass = defaultValue(shadowPass, 0)
    if (shadowMap._isPointLight || shadowPass === 0) {
      shadowMap._clearCommand.framebuffer = shadowMap._passes[shadowPass].framebuffer
      shadowMap._clearCommand.execute(context, shadowMap._clearPassState)
    }
  }

  function resize(shadowMap: any, size: number) {
    shadowMap._size = size
    const passes = shadowMap._passes
    const numberOfPasses = passes.length
    const textureSize = shadowMap._textureSize

    if (shadowMap._isPointLight) {
      size = ContextLimits.maximumCubeMapSize >= size ? size : ContextLimits.maximumCubeMapSize
      textureSize.x = size
      textureSize.y = size
      const faceViewport = new BoundingRectangle(0, 0, size, size)
      passes[0].passState.viewport = faceViewport
      passes[1].passState.viewport = faceViewport
      passes[2].passState.viewport = faceViewport
      passes[3].passState.viewport = faceViewport
      passes[4].passState.viewport = faceViewport
      passes[5].passState.viewport = faceViewport
    } else if (numberOfPasses === 1) {
      size = ContextLimits.maximumTextureSize >= size ? size : ContextLimits.maximumTextureSize
      textureSize.x = size
      textureSize.y = size
      passes[0].passState.viewport = new BoundingRectangle(0, 0, size, size)
    } else if (numberOfPasses === 4) {
      size = ContextLimits.maximumTextureSize >= size * 2 ? size : ContextLimits.maximumTextureSize / 2
      textureSize.x = size * 2
      textureSize.y = size * 2
      passes[0].passState.viewport = new BoundingRectangle(0, 0, size, size)
      passes[1].passState.viewport = new BoundingRectangle(size, 0, size, size)
      passes[2].passState.viewport = new BoundingRectangle(0, size, size, size)
      passes[3].passState.viewport = new BoundingRectangle(size, size, size, size)
    }

    shadowMap._clearPassState.viewport = new BoundingRectangle(0, 0, textureSize.x, textureSize.y)

    for (let i = 0; i < numberOfPasses; ++i) {
      const pass = passes[i]
      const viewport = pass.passState.viewport
      const biasX = viewport.x / textureSize.x
      const biasY = viewport.y / textureSize.y
      const scaleX = viewport.width / textureSize.x
      const scaleY = viewport.height / textureSize.y
      pass.textureOffsets = new Matrix4(
        scaleX,
        0.0,
        0.0,
        biasX,
        0.0,
        scaleY,
        0.0,
        biasY,
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0
      )
    }
  }

  const frustumCornersNDC = new Array(8)
  frustumCornersNDC[0] = new Cartesian4(-1.0, -1.0, -1.0, 1.0)
  frustumCornersNDC[1] = new Cartesian4(1.0, -1.0, -1.0, 1.0)
  frustumCornersNDC[2] = new Cartesian4(1.0, 1.0, -1.0, 1.0)
  frustumCornersNDC[3] = new Cartesian4(-1.0, 1.0, -1.0, 1.0)
  frustumCornersNDC[4] = new Cartesian4(-1.0, -1.0, 1.0, 1.0)
  frustumCornersNDC[5] = new Cartesian4(1.0, -1.0, 1.0, 1.0)
  frustumCornersNDC[6] = new Cartesian4(1.0, 1.0, 1.0, 1.0)
  frustumCornersNDC[7] = new Cartesian4(-1.0, 1.0, 1.0, 1.0)

  const scratchMatrix = new Matrix4()
  const scratchFrustumCorners = new Array(8)
  for (let i = 0; i < 8; ++i) {
    scratchFrustumCorners[i] = new Cartesian4()
  }

  function ShadowMapCamera() {
    this.viewMatrix = new Matrix4()
    this.inverseViewMatrix = new Matrix4()
    this.frustum = undefined
    this.positionCartographic = new Cartographic()
    this.positionWC = new Cartesian3()
    this.directionWC = Cartesian3.clone(Cartesian3.UNIT_Z)
    this.upWC = Cartesian3.clone(Cartesian3.UNIT_Y)
    this.rightWC = Cartesian3.clone(Cartesian3.UNIT_X)
    this.viewProjectionMatrix = new Matrix4()
  }

  ShadowMapCamera.prototype.clone = function (camera: any) {
    Matrix4.clone(camera.viewMatrix, this.viewMatrix)
    Matrix4.clone(camera.inverseViewMatrix, this.inverseViewMatrix)
    this.frustum = camera.frustum.clone(this.frustum)
    Cartographic.clone(camera.positionCartographic, this.positionCartographic)
    Cartesian3.clone(camera.positionWC, this.positionWC)
    Cartesian3.clone(camera.directionWC, this.directionWC)
    Cartesian3.clone(camera.upWC, this.upWC)
    Cartesian3.clone(camera.rightWC, this.rightWC)
  }

  const scaleBiasMatrix = new Matrix4(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 1.0)

  ShadowMapCamera.prototype.getViewProjection = function () {
    const view = this.viewMatrix
    const projection = this.frustum.projectionMatrix
    Matrix4.multiply(projection, view, this.viewProjectionMatrix)
    Matrix4.multiply(scaleBiasMatrix, this.viewProjectionMatrix, this.viewProjectionMatrix)
    return this.viewProjectionMatrix
  }

  function updateCameras(shadowMap: any, frameState: any) {
    const camera = frameState.camera
    const lightCamera = shadowMap._lightCamera
    const sceneCamera = shadowMap._sceneCamera
    const shadowMapCamera = shadowMap._shadowMapCamera

    if (shadowMap._cascadesEnabled) {
      Cartesian3.clone(lightCamera.directionWC, shadowMapCamera.directionWC)
    } else if (shadowMap._isPointLight) {
      Cartesian3.clone(lightCamera.positionWC, shadowMapCamera.positionWC)
    } else {
      shadowMapCamera.clone(lightCamera)
    }

    const lightDirection = shadowMap._lightDirectionEC
    Matrix4.multiplyByPointAsVector(camera.viewMatrix, shadowMapCamera.directionWC, lightDirection)
    Cartesian3.normalize(lightDirection, lightDirection)
    Cartesian3.negate(lightDirection, lightDirection)

    Matrix4.multiplyByPoint(camera.viewMatrix, shadowMapCamera.positionWC, shadowMap._lightPositionEC)
    shadowMap._lightPositionEC.w = shadowMap._pointLightRadius

    let near
    let far
    if (shadowMap.isViewShed) {
      near = lightCamera.frustum.near
      far = lightCamera.frustum.far
    } else if (shadowMap._fitNearFar) {
      near = Math.min(frameState.shadowState.nearPlane, shadowMap.maximumDistance)
      far = Math.min(frameState.shadowState.farPlane, shadowMap.maximumDistance + 1.0)
    } else {
      near = camera.frustum.near
      far = shadowMap.maximumDistance
    }

    shadowMap._sceneCamera = Camera.clone(camera, sceneCamera)
    camera.frustum.clone(shadowMap._sceneCamera.frustum)
    shadowMap._sceneCamera.frustum.near = near
    shadowMap._sceneCamera.frustum.far = far
    shadowMap._distance = far - near

    checkVisibility(shadowMap, frameState)

    if (!shadowMap._outOfViewPrevious && shadowMap._outOfView) {
      shadowMap._needsUpdate = true
    }
    shadowMap._outOfViewPrevious = shadowMap._outOfView
  }

  ViewshedMap.prototype.update = function (frameState: any) {
    updateCameras(this, frameState)

    if (this._needsUpdate) {
      updateFramebuffer(this, frameState.context)

      if (this._isPointLight) {
        computeOmnidirectional(this, frameState)
      }

      if (this._cascadesEnabled) {
        fitShadowMapToScene(this, frameState)

        if (this._numberOfCascades > 1) {
          computeCascades(this, frameState)
        }
      }

      if (!this._isPointLight) {
        const shadowMapCamera = this._shadowMapCamera
        const position = shadowMapCamera.positionWC
        const direction = shadowMapCamera.directionWC
        const up = shadowMapCamera.upWC
        this._shadowMapCullingVolume = shadowMapCamera.frustum.computeCullingVolume(position, direction, up)

        if (this._passes.length === 1) {
          this._passes[0].camera.clone(shadowMapCamera)
        }
      } else {
        this._shadowMapCullingVolume = CullingVolume.fromBoundingSphere(this._boundingSphere)
      }
    }

    if (this._passes.length === 1) {
      const inverseView = this._sceneCamera.inverseViewMatrix
      Matrix4.multiply(this._shadowMapCamera.getViewProjection(), inverseView, this._shadowMapMatrix)
    }
  }

  ViewshedMap.prototype.updatePass = function (context: any, shadowPass: any) {
    clearFramebuffer(this, context, shadowPass)
  }

  const scratchTexelStepSize = new Cartesian2()

  function combineUniforms(shadowMap: any, uniforms: any, isTerrain: any) {
    const bias = shadowMap._isPointLight
      ? shadowMap._pointBias
      : isTerrain
        ? shadowMap._terrainBias
        : shadowMap._primitiveBias

    const mapUniforms = {
      shadowMap_texture: function () {
        return shadowMap._shadowMapTexture
      },
      shadowMap_textureCube: function () {
        return shadowMap._shadowMapTexture
      },
      shadowMap_matrix: function () {
        return shadowMap._shadowMapMatrix
      },
      shadowMap_cascadeSplits: function () {
        return shadowMap._cascadeSplits
      },
      shadowMap_cascadeMatrices: function () {
        return shadowMap._cascadeMatrices
      },
      shadowMap_lightDirectionEC: function () {
        return shadowMap._lightDirectionEC
      },
      shadowMap_lightPositionEC: function () {
        return shadowMap._lightPositionEC
      },
      shadowMap_cascadeDistances: function () {
        return shadowMap._cascadeDistances
      },
      shadowMap_texelSizeDepthBiasAndNormalShadingSmooth: function () {
        const texelStepSize = scratchTexelStepSize
        texelStepSize.x = 1.0 / shadowMap._textureSize.x
        texelStepSize.y = 1.0 / shadowMap._textureSize.y

        return Cartesian4.fromElements(
          texelStepSize.x,
          texelStepSize.y,
          bias.depthBias,
          bias.normalShadingSmooth,
          this.combinedUniforms1
        )
      },
      shadowMap_normalOffsetScaleDistanceMaxDistanceAndDarkness: function () {
        return Cartesian4.fromElements(
          bias.normalOffsetScale,
          shadowMap._distance,
          shadowMap.maximumDistance,
          shadowMap._darkness,
          this.combinedUniforms2
        )
      },

      combinedUniforms1: new Cartesian4(),
      combinedUniforms2: new Cartesian4()
    }

    return combine(uniforms, mapUniforms, false)
  }

  function getShadowReceiveShaderKeyword(shadowMap: any, castShadows: any, isTerrain: any, hasTerrainNormal: any) {
    const usesDepthTexture = shadowMap._usesDepthTexture
    const polygonOffsetSupported = shadowMap._polygonOffsetSupported
    const isPointLight = shadowMap._isPointLight
    const isSpotLight = shadowMap._isSpotLight
    const hasCascades = shadowMap._numberOfCascades > 1
    const debugCascadeColors = shadowMap.debugCascadeColors
    const softShadows = shadowMap.softShadows

    return (
      'view receiveShadow ' +
      usesDepthTexture +
      polygonOffsetSupported +
      isPointLight +
      isSpotLight +
      hasCascades +
      debugCascadeColors +
      softShadows +
      castShadows +
      isTerrain +
      hasTerrainNormal
    )
  }

  function createShadowReceiveFragmentShader(fs: any, shadowMap: any, castShadows: any, isTerrain: any, hasTerrainNormal: any) {
    const normalVaryingName = ShaderSource.findNormalVarying(fs)
    const hasNormalVarying = (!isTerrain && defined(normalVaryingName)) || (isTerrain && hasTerrainNormal)

    const positionVaryingName = ShaderSource.findPositionVarying(fs)
    const hasPositionVarying = defined(positionVaryingName)

    const usesDepthTexture = shadowMap._usesDepthTexture
    const polygonOffsetSupported = shadowMap._polygonOffsetSupported
    const isPointLight = shadowMap._isPointLight
    const isSpotLight = shadowMap._isSpotLight
    const hasCascades = shadowMap._numberOfCascades > 1
    const debugCascadeColors = shadowMap.debugCascadeColors
    const softShadows = shadowMap.softShadows
    const bias = isPointLight ? shadowMap._pointBias : isTerrain ? shadowMap._terrainBias : shadowMap._primitiveBias

    const defines = fs.defines.slice(0)
    const sources = fs.sources.slice(0)

    const length = sources.length
    for (let i = 0; i < length; ++i) {
      sources[i] = ShaderSource.replaceMain(sources[i], 'czm_shadow_receive_main')
    }

    if (isPointLight) {
      defines.push('USE_CUBE_MAP_SHADOW')
    } else if (usesDepthTexture) {
      defines.push('USE_SHADOW_DEPTH_TEXTURE')
    }

    if (softShadows && !isPointLight) {
      defines.push('USE_SOFT_SHADOWS')
    }

    if (hasCascades && castShadows && isTerrain) {
      if (hasNormalVarying) {
        defines.push('ENABLE_VERTEX_LIGHTING')
      } else {
        defines.push('ENABLE_DAYNIGHT_SHADING')
      }
    }

    if (castShadows && bias.normalShading && hasNormalVarying) {
      defines.push('USE_NORMAL_SHADING')
      if (bias.normalShadingSmooth > 0.0) {
        defines.push('USE_NORMAL_SHADING_SMOOTH')
      }
    }

    let fsSource = ''

    if (isPointLight) {
      fsSource += 'uniform samplerCube shadowMap_textureCube; \n'
    } else {
      fsSource += 'uniform sampler2D shadowMap_texture; \n'
    }

    let returnPositionEC
    if (hasPositionVarying) {
      returnPositionEC = '    return vec4(' + positionVaryingName + ', 1.0); \n'
    } else {
      returnPositionEC =
        '#ifndef LOG_DEPTH \n' +
        '    return czm_windowToEyeCoordinates(gl_FragCoord); \n' +
        '#else \n' +
        '    return vec4(v_logPositionEC, 1.0); \n' +
        '#endif \n'
    }

    fsSource +=
      'uniform mat4 shadowMap_matrix; \n' +
      'uniform vec3 shadowMap_lightDirectionEC; \n' +
      'uniform vec4 shadowMap_lightPositionEC; \n' +
      'uniform vec4 shadowMap_normalOffsetScaleDistanceMaxDistanceAndDarkness; \n' +
      'uniform vec4 shadowMap_texelSizeDepthBiasAndNormalShadingSmooth; \n' +
      '#ifdef LOG_DEPTH \n' +
      'in vec3 v_logPositionEC; \n' +
      '#endif \n' +
      'vec4 getPositionEC() \n' +
      '{ \n' +
      returnPositionEC +
      '} \n' +
      'vec3 getNormalEC() \n' +
      '{ \n' +
      (hasNormalVarying ? '    return normalize(' + normalVaryingName + '); \n' : '    return vec3(1.0); \n') +
      '} \n' +
      'void applyNormalOffset(inout vec4 positionEC, vec3 normalEC, float nDotL) \n' +
      '{ \n' +
      (bias.normalOffset && hasNormalVarying
        ? '    float normalOffset = shadowMap_normalOffsetScaleDistanceMaxDistanceAndDarkness.x; \n' +
          '    float normalOffsetScale = 1.0 - nDotL; \n' +
          '    vec3 offset = normalOffset * normalOffsetScale * normalEC; \n' +
          '    positionEC.xyz += offset; \n'
        : '') +
      '} \n'

    fsSource +=
      'void main() \n' +
      '{ \n' +
      '    czm_shadow_receive_main(); \n' +
      '    vec4 positionEC = getPositionEC(); \n' +
      '    vec3 normalEC = getNormalEC(); \n' +
      '    float depth = -positionEC.z; \n'

    fsSource +=
      '    czm_shadowParameters shadowParameters; \n' +
      '    shadowParameters.texelStepSize = shadowMap_texelSizeDepthBiasAndNormalShadingSmooth.xy; \n' +
      '    shadowParameters.depthBias = shadowMap_texelSizeDepthBiasAndNormalShadingSmooth.z; \n' +
      '    shadowParameters.normalShadingSmooth = shadowMap_texelSizeDepthBiasAndNormalShadingSmooth.w; \n' +
      '    shadowParameters.darkness = shadowMap_normalOffsetScaleDistanceMaxDistanceAndDarkness.w; \n'

    if (isTerrain) {
      fsSource += '    shadowParameters.depthBias *= max(depth * 0.01, 1.0); \n'
    } else if (!polygonOffsetSupported) {
      fsSource += '    shadowParameters.depthBias *= mix(1.0, 100.0, depth * 0.0015); \n'
    }

    if (isPointLight) {
      fsSource +=
        '    vec3 directionEC = positionEC.xyz - shadowMap_lightPositionEC.xyz; \n' +
        '    float distance = length(directionEC); \n' +
        '    directionEC = normalize(directionEC); \n' +
        '    float radius = shadowMap_lightPositionEC.w; \n' +
        '    // Stop early if the fragment is beyond the point light radius \n' +
        '    if (distance > radius) \n' +
        '    { \n' +
        '        return; \n' +
        '    } \n' +
        '    vec3 directionWC  = czm_inverseViewRotation * directionEC; \n' +
        '    shadowParameters.depth = distance / radius; \n' +
        '    shadowParameters.nDotL = clamp(dot(normalEC, -directionEC), 0.0, 1.0); \n' +
        '    shadowParameters.texCoords = directionWC; \n' +
        '    float visibility = czm_shadowVisibility(shadowMap_textureCube, shadowParameters); \n'
    } else if (isSpotLight) {
      fsSource +=
        '    vec3 directionEC1 = positionEC.xyz - shadowMap_lightPositionEC.xyz; \n' +
        '    float distance = length(directionEC1); \n' +
        '    if (distance > shadowMap_normalOffsetScaleDistanceMaxDistanceAndDarkness.y) \n' +
        '    { \n' +
        '        return; \n' +
        '    } \n' +
        '    vec3 directionEC = normalize(positionEC.xyz - shadowMap_lightPositionEC.xyz); \n' +
        '    float nDotL = clamp(dot(normalEC, -directionEC), 0.0, 1.0); \n' +
        '    applyNormalOffset(positionEC, normalEC, nDotL); \n' +
        '    vec4 shadowPosition = shadowMap_matrix * positionEC; \n' +
        '    // Spot light uses a perspective projection, so perform the perspective divide \n' +
        '    shadowPosition /= shadowPosition.w; \n' +
        '    // Stop early if the fragment is not in the shadow bounds \n' +
        '    if (any(lessThan(shadowPosition.xyz, vec3(0.0))) || any(greaterThan(shadowPosition.xyz, vec3(1.0)))) \n' +
        '    { \n' +
        '        return; \n' +
        '    } \n' +
        '    shadowParameters.texCoords = shadowPosition.xy; \n' +
        '    shadowParameters.depth = shadowPosition.z; \n' +
        '    shadowParameters.nDotL = nDotL; \n' +
        '    float visibility = czm_shadowVisibility(shadowMap_texture, shadowParameters); \n'
    } else if (hasCascades) {
      fsSource +=
        '    float maxDepth = shadowMap_cascadeSplits[1].w; \n' +
        '    // Stop early if the eye depth exceeds the last cascade \n' +
        '    if (depth > maxDepth) \n' +
        '    { \n' +
        '        return; \n' +
        '    } \n' +
        '    // Get the cascade based on the eye-space depth \n' +
        '    vec4 weights = czm_cascadeWeights(depth); \n' +
        '    // Apply normal offset \n' +
        '    float nDotL = clamp(dot(normalEC, shadowMap_lightDirectionEC), 0.0, 1.0); \n' +
        '    applyNormalOffset(positionEC, normalEC, nDotL); \n' +
        '    // Transform position into the cascade \n' +
        '    vec4 shadowPosition = czm_cascadeMatrix(weights) * positionEC; \n' +
        '    // Get visibility \n' +
        '    shadowParameters.texCoords = shadowPosition.xy; \n' +
        '    shadowParameters.depth = shadowPosition.z; \n' +
        '    shadowParameters.nDotL = nDotL; \n' +
        '    float visibility = czm_shadowVisibility(shadowMap_texture, shadowParameters); \n' +
        '    // Fade out shadows that are far away \n' +
        '    float shadowMapMaximumDistance = shadowMap_normalOffsetScaleDistanceMaxDistanceAndDarkness.z; \n' +
        '    float fade = max((depth - shadowMapMaximumDistance * 0.8) / (shadowMapMaximumDistance * 0.2), 0.0); \n' +
        '    visibility = mix(visibility, 1.0, fade); \n' +
        (debugCascadeColors
          ? '    // Draw cascade colors for debugging \n' + '    out_FragColor *= czm_cascadeColor(weights); \n'
          : '')
    } else {
      fsSource +=
        '    float nDotL = clamp(dot(normalEC, shadowMap_lightDirectionEC), 0.0, 1.0); \n' +
        '    applyNormalOffset(positionEC, normalEC, nDotL); \n' +
        '    vec4 shadowPosition = shadowMap_matrix * positionEC; \n' +
        '    // Stop early if the fragment is not in the shadow bounds \n' +
        '    if (any(lessThan(shadowPosition.xyz, vec3(0.0))) || any(greaterThan(shadowPosition.xyz, vec3(1.0)))) \n' +
        '    { \n' +
        '        return; \n' +
        '    } \n' +
        '    shadowParameters.texCoords = shadowPosition.xy; \n' +
        '    shadowParameters.depth = shadowPosition.z; \n' +
        '    shadowParameters.nDotL = nDotL; \n' +
        '    float visibility = czm_shadowVisibility(shadowMap_texture, shadowParameters); \n'
    }

    fsSource +=
      '   if(visibility==0.0) \n' +
      '   {\n' +
      '        out_FragColor.rgb *= vec3(0.8,0.0,0.0);\n' +
      '   }else{\n' +
      '        out_FragColor.rgb *= vec3(0.0,0.8,0.0) * visibility;\n' +
      '   } \n ' +
      '} \n '

    sources.push(fsSource)

    return new ShaderSource({
      defines: defines,
      sources: sources
    })
  }

  Cesium.ShadowMap.createReceiveDerivedCommand = function (lightShadowMaps: any, command: any, shadowsDirty: any, context: any, result: any) {
    if (!defined(result)) {
      result = {}
    }

    const lightShadowMapsEnabled = lightShadowMaps.length > 0
    const shaderProgram = command.shaderProgram
    const vertexShaderSource = shaderProgram.vertexShaderSource
    const fragmentShaderSource = shaderProgram.fragmentShaderSource
    const isTerrain = command.pass === Pass.GLOBE

    let hasTerrainNormal = false
    if (isTerrain) {
      hasTerrainNormal = command.owner.data.renderedMesh.encoding.hasVertexNormals
    }

    if (command.receiveShadows && lightShadowMapsEnabled) {
      let receiveShader
      let receiveUniformMap
      if (defined(result.receiveCommand)) {
        receiveShader = result.receiveCommand.shaderProgram
        receiveUniformMap = result.receiveCommand.uniformMap
      }

      result.receiveCommand = DrawCommand.shallowClone(command, result.receiveCommand)
      result.castShadows = false
      result.receiveShadows = true

      const castShadowsDirty = result.receiveShaderCastShadows !== command.castShadows
      const shaderDirty = result.receiveShaderProgramId !== command.shaderProgram.id

      if (!defined(receiveShader) || shaderDirty || shadowsDirty || castShadowsDirty) {
        let keyword
        if (lightShadowMaps[0].isViewShed) {
          keyword = getShadowReceiveShaderKeyword(lightShadowMaps[0], command.castShadows, isTerrain, hasTerrainNormal)
        } else {
          keyword = ShadowMapShader.getShadowReceiveShaderKeyword(
            lightShadowMaps[0],
            command.castShadows,
            isTerrain,
            hasTerrainNormal
          )
        }
        receiveShader = context.shaderCache.getDerivedShaderProgram(shaderProgram, keyword)
        if (!defined(receiveShader)) {
          const receiveVS = ShadowMapShader.createShadowReceiveVertexShader(vertexShaderSource, isTerrain, hasTerrainNormal)
          let receiveFS
          if (lightShadowMaps[0].isViewShed) {
            receiveFS = createShadowReceiveFragmentShader(
              fragmentShaderSource,
              lightShadowMaps[0],
              command.castShadows,
              isTerrain,
              hasTerrainNormal
            )
          } else {
            receiveFS = ShadowMapShader.createShadowReceiveFragmentShader(
              fragmentShaderSource,
              lightShadowMaps[0],
              command.castShadows,
              isTerrain,
              hasTerrainNormal
            )
          }

          receiveShader = context.shaderCache.createDerivedShaderProgram(shaderProgram, keyword, {
            vertexShaderSource: receiveVS,
            fragmentShaderSource: receiveFS,
            attributeLocations: shaderProgram._attributeLocations
          })
        }

        receiveUniformMap = combineUniforms(lightShadowMaps[0], command.uniformMap, isTerrain)
      }

      result.receiveCommand.shaderProgram = receiveShader
      result.receiveCommand.uniformMap = receiveUniformMap
      result.receiveShaderProgramId = command.shaderProgram.id
      result.receiveShaderCastShadows = command.castShadows
    }

    return result
  }

  ViewshedMap.prototype.isDestroyed = function () {
    return false
  }

  ViewshedMap.prototype.destroy = function () {
    destroyFramebuffer(this)
    return destroyObject(this)
  }

  const scratchSplits = new Array(5)
  const scratchFrustum = new PerspectiveFrustum()
  const scratchCascadeDistances = new Array(4)
  const scratchMin = new Cartesian3()
  const scratchMax = new Cartesian3()

  function computeCascades(shadowMap: any, frameState: any) {
    const shadowMapCamera = shadowMap._shadowMapCamera
    const sceneCamera = shadowMap._sceneCamera
    const cameraNear = sceneCamera.frustum.near
    const cameraFar = sceneCamera.frustum.far
    const numberOfCascades = shadowMap._numberOfCascades

    let i
    const range = cameraFar - cameraNear
    const ratio = cameraFar / cameraNear

    let lambda = 0.9
    let clampCascadeDistances = false

    if (frameState.shadowState.closestObjectSize < 200.0) {
      clampCascadeDistances = true
      lambda = 0.9
    }

    const cascadeDistances = scratchCascadeDistances
    const splits = scratchSplits
    splits[0] = cameraNear
    splits[numberOfCascades] = cameraFar

    for (i = 0; i < numberOfCascades; ++i) {
      const p = (i + 1) / numberOfCascades
      const logScale = cameraNear * Math.pow(ratio, p)
      const uniformScale = cameraNear + range * p
      const split = CesiumMath.lerp(uniformScale, logScale, lambda)
      splits[i + 1] = split
      cascadeDistances[i] = split - splits[i]
    }

    if (clampCascadeDistances) {
      for (i = 0; i < numberOfCascades; ++i) {
        cascadeDistances[i] = Math.min(cascadeDistances[i], shadowMap._maximumCascadeDistances[i])
      }

      let distance = splits[0]
      for (i = 0; i < numberOfCascades - 1; ++i) {
        distance += cascadeDistances[i]
        splits[i + 1] = distance
      }
    }

    Cartesian4.unpack(splits, 0, shadowMap._cascadeSplits[0])
    Cartesian4.unpack(splits, 1, shadowMap._cascadeSplits[1])
    Cartesian4.unpack(cascadeDistances, 0, shadowMap._cascadeDistances)

    const shadowFrustum = shadowMapCamera.frustum
    const left = shadowFrustum.left
    const right = shadowFrustum.right
    const bottom = shadowFrustum.bottom
    const top = shadowFrustum.top
    const near = shadowFrustum.near
    const far = shadowFrustum.far

    const position = shadowMapCamera.positionWC
    const direction = shadowMapCamera.directionWC
    const up = shadowMapCamera.upWC

    const cascadeSubFrustum = sceneCamera.frustum.clone(scratchFrustum)
    const shadowViewProjection = shadowMapCamera.getViewProjection()

    for (i = 0; i < numberOfCascades; ++i) {
      cascadeSubFrustum.near = splits[i]
      cascadeSubFrustum.far = splits[i + 1]
      const viewProjection = Matrix4.multiply(cascadeSubFrustum.projectionMatrix, sceneCamera.viewMatrix, scratchMatrix)
      const inverseViewProjection = Matrix4.inverse(viewProjection, scratchMatrix)
      const shadowMapMatrix = Matrix4.multiply(shadowViewProjection, inverseViewProjection, scratchMatrix)

      const min = Cartesian3.fromElements(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, scratchMin)
      const max = Cartesian3.fromElements(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE, scratchMax)

      for (let k = 0; k < 8; ++k) {
        const corner = Cartesian4.clone(frustumCornersNDC[k], scratchFrustumCorners[k])
        Matrix4.multiplyByVector(shadowMapMatrix, corner, corner)
        Cartesian3.divideByScalar(corner, corner.w, corner)
        Cartesian3.minimumByComponent(corner, min, min)
        Cartesian3.maximumByComponent(corner, max, max)
      }

      min.x = Math.max(min.x, 0.0)
      min.y = Math.max(min.y, 0.0)
      min.z = 0.0
      max.x = Math.min(max.x, 1.0)
      max.y = Math.min(max.y, 1.0)
      max.z = Math.min(max.z, 1.0)

      const pass = shadowMap._passes[i]
      const cascadeCamera = pass.camera
      cascadeCamera.clone(shadowMapCamera)

      const frustum = cascadeCamera.frustum
      frustum.left = left + min.x * (right - left)
      frustum.right = left + max.x * (right - left)
      frustum.bottom = bottom + min.y * (top - bottom)
      frustum.top = bottom + max.y * (top - bottom)
      frustum.near = near + min.z * (far - near)
      frustum.far = near + max.z * (far - near)

      pass.cullingVolume = cascadeCamera.frustum.computeCullingVolume(position, direction, up)

      const cascadeMatrix = shadowMap._cascadeMatrices[i]
      Matrix4.multiply(cascadeCamera.getViewProjection(), sceneCamera.inverseViewMatrix, cascadeMatrix)
      Matrix4.multiply(pass.textureOffsets, cascadeMatrix, cascadeMatrix)
    }
  }

  const scratchLightView = new Matrix4()
  const scratchRight = new Cartesian3()
  const scratchUp = new Cartesian3()
  const scratchTranslation = new Cartesian3()

  function fitShadowMapToScene(shadowMap: any, frameState: any) {
    const shadowMapCamera = shadowMap._shadowMapCamera
    const sceneCamera = shadowMap._sceneCamera

    const viewProjection = Matrix4.multiply(sceneCamera.frustum.projectionMatrix, sceneCamera.viewMatrix, scratchMatrix)
    const inverseViewProjection = Matrix4.inverse(viewProjection, scratchMatrix)

    const lightDir = shadowMapCamera.directionWC
    let lightUp = sceneCamera.directionWC
    const lightRight = Cartesian3.cross(lightDir, lightUp, scratchRight)
    lightUp = Cartesian3.cross(lightRight, lightDir, scratchUp)
    Cartesian3.normalize(lightUp, lightUp)
    Cartesian3.normalize(lightRight, lightRight)
    const lightPosition = Cartesian3.fromElements(0.0, 0.0, 0.0, scratchTranslation)

    let lightView = Matrix4.computeView(lightPosition, lightDir, lightUp, lightRight, scratchLightView)
    const cameraToLight = Matrix4.multiply(lightView, inverseViewProjection, scratchMatrix)

    const min = Cartesian3.fromElements(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, scratchMin)
    const max = Cartesian3.fromElements(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE, scratchMax)

    for (let i = 0; i < 8; ++i) {
      const corner = Cartesian4.clone(frustumCornersNDC[i], scratchFrustumCorners[i])
      Matrix4.multiplyByVector(cameraToLight, corner, corner)
      Cartesian3.divideByScalar(corner, corner.w, corner)
      Cartesian3.minimumByComponent(corner, min, min)
      Cartesian3.maximumByComponent(corner, max, max)
    }

    max.z += 1000.0
    min.z -= 10.0

    const translation = scratchTranslation
    translation.x = -(0.5 * (min.x + max.x))
    translation.y = -(0.5 * (min.y + max.y))
    translation.z = -max.z

    const translationMatrix = Matrix4.fromTranslation(translation, scratchMatrix)
    lightView = Matrix4.multiply(translationMatrix, lightView, lightView)

    const halfWidth = 0.5 * (max.x - min.x)
    const halfHeight = 0.5 * (max.y - min.y)
    const depth = max.z - min.z

    const frustum = shadowMapCamera.frustum
    frustum.left = -halfWidth
    frustum.right = halfWidth
    frustum.bottom = -halfHeight
    frustum.top = halfHeight
    frustum.near = 0.01
    frustum.far = depth

    Matrix4.clone(lightView, shadowMapCamera.viewMatrix)
    Matrix4.inverse(lightView, shadowMapCamera.inverseViewMatrix)
    Matrix4.getTranslation(shadowMapCamera.inverseViewMatrix, shadowMapCamera.positionWC)
    frameState.mapProjection.ellipsoid.cartesianToCartographic(shadowMapCamera.positionWC, shadowMapCamera.positionCartographic)
    Cartesian3.clone(lightDir, shadowMapCamera.directionWC)
    Cartesian3.clone(lightUp, shadowMapCamera.upWC)
    Cartesian3.clone(lightRight, shadowMapCamera.rightWC)
  }

  const directions = [
    new Cartesian3(-1.0, 0.0, 0.0),
    new Cartesian3(0.0, -1.0, 0.0),
    new Cartesian3(0.0, 0.0, -1.0),
    new Cartesian3(1.0, 0.0, 0.0),
    new Cartesian3(0.0, 1.0, 0.0),
    new Cartesian3(0.0, 0.0, 1.0)
  ]

  const ups = [
    new Cartesian3(0.0, -1.0, 0.0),
    new Cartesian3(0.0, 0.0, -1.0),
    new Cartesian3(0.0, -1.0, 0.0),
    new Cartesian3(0.0, -1.0, 0.0),
    new Cartesian3(0.0, 0.0, 1.0),
    new Cartesian3(0.0, -1.0, 0.0)
  ]

  const rights = [
    new Cartesian3(0.0, 0.0, 1.0),
    new Cartesian3(1.0, 0.0, 0.0),
    new Cartesian3(-1.0, 0.0, 0.0),
    new Cartesian3(0.0, 0.0, -1.0),
    new Cartesian3(1.0, 0.0, 0.0),
    new Cartesian3(1.0, 0.0, 0.0)
  ]

  function computeOmnidirectional(shadowMap: any, frameState: any) {
    const frustum = new PerspectiveFrustum()
    frustum.fov = CesiumMath.PI_OVER_TWO
    frustum.near = 1.0
    frustum.far = shadowMap._pointLightRadius
    frustum.aspectRatio = 1.0

    for (let i = 0; i < 6; ++i) {
      const camera = shadowMap._passes[i].camera
      camera.positionWC = shadowMap._shadowMapCamera.positionWC
      camera.positionCartographic = frameState.mapProjection.ellipsoid.cartesianToCartographic(camera.positionWC, camera.positionCartographic)
      camera.directionWC = directions[i]
      camera.upWC = ups[i]
      camera.rightWC = rights[i]

      Matrix4.computeView(camera.positionWC, camera.directionWC, camera.upWC, camera.rightWC, camera.viewMatrix)
      Matrix4.inverse(camera.viewMatrix, camera.inverseViewMatrix)

      camera.frustum = frustum
    }
  }

  const scratchCartesian1 = new Cartesian3()
  const scratchCartesian2 = new Cartesian3()
  const scratchBoundingSphere = new BoundingSphere()
  const scratchCenter = scratchBoundingSphere.center

  function checkVisibility(shadowMap: any, frameState: any) {
    const sceneCamera = shadowMap._sceneCamera
    const shadowMapCamera = shadowMap._shadowMapCamera

    const boundingSphere = scratchBoundingSphere

    if (shadowMap._cascadesEnabled) {
      if (sceneCamera.frustum.near >= shadowMap.maximumDistance) {
        shadowMap._outOfView = true
        shadowMap._needsUpdate = false
        return
      }

      const surfaceNormal = frameState.mapProjection.ellipsoid.geodeticSurfaceNormal(sceneCamera.positionWC, scratchCartesian1)
      const lightDirection = Cartesian3.negate(shadowMapCamera.directionWC, scratchCartesian2)
      const dot = Cartesian3.dot(surfaceNormal, lightDirection)

      const darknessAmount = CesiumMath.clamp(dot / 0.1, 0.0, 1.0)
      shadowMap._darkness = CesiumMath.lerp(1.0, shadowMap.darkness, darknessAmount)

      if (dot < 0.0) {
        shadowMap._outOfView = true
        shadowMap._needsUpdate = false
        return
      }

      shadowMap._needsUpdate = true
      shadowMap._outOfView = false
    } else if (shadowMap._isPointLight) {
      boundingSphere.center = shadowMapCamera.positionWC
      boundingSphere.radius = shadowMap._pointLightRadius
      shadowMap._outOfView = frameState.cullingVolume.computeVisibility(boundingSphere) === Intersect.OUTSIDE
      shadowMap._needsUpdate = !shadowMap._outOfView && !shadowMap._boundingSphere.equals(boundingSphere)
      BoundingSphere.clone(boundingSphere, shadowMap._boundingSphere)
    } else {
      const frustumRadius = shadowMapCamera.frustum.far / 2.0
      const frustumCenter = Cartesian3.add(
        shadowMapCamera.positionWC,
        Cartesian3.multiplyByScalar(shadowMapCamera.directionWC, frustumRadius, scratchCenter),
        scratchCenter
      )
      boundingSphere.center = frustumCenter
      boundingSphere.radius = frustumRadius
      shadowMap._outOfView = frameState.cullingVolume.computeVisibility(boundingSphere) === Intersect.OUTSIDE
      shadowMap._needsUpdate = !shadowMap._outOfView && !shadowMap._boundingSphere.equals(boundingSphere)
      BoundingSphere.clone(boundingSphere, shadowMap._boundingSphere)
    }
  }

  return ViewshedMap
})()

export { ViewshedMap }

const RectangularSensorPrimitive = (() => {
  const {
    Matrix4,
    Material,
    Color,
    JulianDate,
    BoundingSphere,
    DrawCommand,
    PrimitiveType,
    SceneMode,
    Matrix3,
    Buffer,
    BufferUsage,
    VertexArray,
    VertexFormat,
    ComponentDatatype,
    RenderState,
    BlendingState,
    Pass,
    combine,
    CullFace,
    Cartesian3,
    EllipsoidGeometry,
    EllipsoidOutlineGeometry,
    ShaderSource,
    ShaderProgram
  } = Cesium as any
  const { cos, sin, tan, atan } = Math
  const CesiumMath = Cesium.Math

  const attributeLocations = {
    position: 0,
    normal: 1
  }

  class RectangularSensorPrimitive {
    _show: boolean
    _modelMatrix: any
    _computedModelMatrix: any
    _computedScanPlaneModelMatrix: any
    _radius: any
    _xHalfAngle: any
    _yHalfAngle: any
    _color: any
    _material: any
    _lateralSurfaceMaterial: any
    _domeSurfaceMaterial: any
    _showThroughEllipsoid: any
    _scanePlaneXHalfAngle: any
    _scanePlaneYHalfAngle: any
    _time: any
    _boundingSphere: any
    _boundingSphereWC: any
    _sectorFrontCommand: any
    _sectorBackCommand: any
    _sectorVA: any
    _sectorLineCommand: any
    _sectorLineVA: any
    _sectorSegmentLineCommand: any
    _sectorSegmentLineVA: any
    _domeFrontCommand: any
    _domeBackCommand: any
    _domeVA: any
    _domeLineCommand: any
    _domeLineVA: any
    _scanPlaneFrontCommand: any
    _scanPlaneBackCommand: any
    _scanRadialCommand: any
    _colorCommands: any
    _frontFaceRS: any
    _backFaceRS: any
    _pickRS: any
    _pickSP: any
    _sp: any
    _scanePlaneSP: any
    _uniforms: any
    _scanUniforms: any
    _scanPlaneVA: any
    _translucent: any
    _lateralSurfaceTranslucent: any

    slice: any
    showSectorLines: any
    showSectorSegmentLines: any
    showLateralSurfaces: any
    lateralSurfaceMaterial: any
    showDomeSurfaces: any
    showDomeLines: any
    showIntersection: any
    intersectionColor: any
    intersectionWidth: any
    showScanPlane: any
    scanPlaneColor: any
    scanPlaneMode: any
    speed: any

    constructor(options: any) {
      options = defaultValue(options, defaultValue.EMPTY_OBJECT)
      const self = this
      this._createVS = true
      this._createRS = true
      this._createSP = true

      this.show = defaultValue(options.show, true)

      this.slice = defaultValue(options.slice, 32)

      if (!options.modelMatrix) {
        if (!options.position) {
          throw new ViewshedError('parameter position or modelMatrix must be provided.')
        }
        this._modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(LonLat.toCartesian(options.position))
      } else {
        this._modelMatrix = Matrix4.clone(options.modelMatrix, new Matrix4())
      }

      this._computedModelMatrix = new Matrix4()
      this._computedScanPlaneModelMatrix = new Matrix4()

      this._radius = defaultValue(options.radius, Number.POSITIVE_INFINITY)

      this._xHalfAngle = CesiumMath.toRadians(defaultValue(options.xHalfAngle, 0))

      this._yHalfAngle = CesiumMath.toRadians(defaultValue(options.yHalfAngle, 0))

      this._color = defaultValue(options._color, Color.AQUA.withAlpha(0.4))

      this.lineColor = defaultValue(options.lineColor, Color.WHITE)

      this.showSectorLines = defaultValue(options.showSectorLines, true)

      this.showSectorSegmentLines = defaultValue(options.showSectorSegmentLines, true)

      this.showLateralSurfaces = defaultValue(options.showLateralSurfaces, true)

      this._material = defined(options.material) ? options.material : Material.fromType(Material.ColorType)
      this._material.uniforms.color = this._color
      this._translucent = undefined

      this.lateralSurfaceMaterial = defined(options.lateralSurfaceMaterial)
        ? options.lateralSurfaceMaterial
        : Material.fromType(Material.ColorType)
      this._lateralSurfaceMaterial = undefined
      this._lateralSurfaceTranslucent = undefined

      this.showDomeSurfaces = defaultValue(options.showDomeSurfaces, true)

      this.domeSurfaceMaterial = defined(options.domeSurfaceMaterial)
        ? options.domeSurfaceMaterial
        : Material.fromType(Material.ColorType)

      this.showDomeLines = defaultValue(options.showDomeLines, true)

      this.showIntersection = defaultValue(options.showIntersection, false)

      this.intersectionColor = defaultValue(options.intersectionColor, Color.WHITE)

      this.intersectionWidth = defaultValue(options.intersectionWidth, 5.0)

      this._showThroughEllipsoid = defaultValue(options.showThroughEllipsoid, false)

      this.showScanPlane = defaultValue(options.showScanPlane, true)

      this.scanPlaneColor = defaultValue(options.scanPlaneColor, Color.AQUA)

      this.scanPlaneMode = defaultValue(options.scanPlaneMode, 'H')

      this.speed = defaultValue(options.speed, 10)

      this._scanePlaneXHalfAngle = 0
      this._scanePlaneYHalfAngle = 0

      this._time = JulianDate.now()

      this._boundingSphere = new BoundingSphere()
      this._boundingSphereWC = new BoundingSphere()
      this._boundingSphere = new BoundingSphere(Cartesian3.ZERO, this._radius)
      Matrix4.multiplyByUniformScale(this._modelMatrix, this._radius, this._computedModelMatrix)
      BoundingSphere.transform(this._boundingSphere, this._modelMatrix, this._boundingSphereWC)

      this._sectorFrontCommand = new DrawCommand({
        owner: this,
        primitiveType: PrimitiveType.TRIANGLES,
        boundingVolume: this._boundingSphereWC
      })
      this._sectorBackCommand = new DrawCommand({
        owner: this,
        primitiveType: PrimitiveType.TRIANGLES,
        boundingVolume: this._boundingSphereWC
      })
      this._sectorVA = undefined

      this._sectorLineCommand = new DrawCommand({
        owner: this,
        primitiveType: PrimitiveType.LINES,
        boundingVolume: this._boundingSphereWC
      })
      this._sectorLineVA = undefined

      this._sectorSegmentLineCommand = new DrawCommand({
        owner: this,
        primitiveType: PrimitiveType.LINES,
        boundingVolume: this._boundingSphereWC
      })
      this._sectorSegmentLineVA = undefined

      this._domeFrontCommand = new DrawCommand({
        owner: this,
        primitiveType: PrimitiveType.TRIANGLES,
        boundingVolume: this._boundingSphereWC
      })
      this._domeBackCommand = new DrawCommand({
        owner: this,
        primitiveType: PrimitiveType.TRIANGLES,
        boundingVolume: this._boundingSphereWC
      })
      this._domeVA = undefined

      this._domeLineCommand = new DrawCommand({
        owner: this,
        primitiveType: PrimitiveType.LINES,
        boundingVolume: this._boundingSphereWC
      })
      this._domeLineVA = undefined

      this._scanPlaneFrontCommand = new DrawCommand({
        owner: this,
        primitiveType: PrimitiveType.TRIANGLES,
        boundingVolume: this._boundingSphereWC
      })
      this._scanPlaneBackCommand = new DrawCommand({
        owner: this,
        primitiveType: PrimitiveType.TRIANGLES,
        boundingVolume: this._boundingSphereWC
      })

      this._scanRadialCommand = undefined

      this._colorCommands = []

      this._frontFaceRS = undefined
      this._backFaceRS = undefined
      this._sp = undefined

      this._uniforms = {
        u_type: function () {
          return 0
        },
        u_xHalfAngle: function () {
          return self._xHalfAngle
        },
        u_yHalfAngle: function () {
          return self._yHalfAngle
        },
        u_radius: function () {
          return self.radius
        },
        u_showThroughEllipsoid: function () {
          return self.showThroughEllipsoid
        },
        u_showIntersection: function () {
          return self.showIntersection
        },
        u_intersectionColor: function () {
          return self.intersectionColor
        },
        u_intersectionWidth: function () {
          return self.intersectionWidth
        },
        u_normalDirection: function () {
          return 1.0
        },
        u_lineColor: function () {
          return self.lineColor
        }
      }

      this._scanUniforms = {
        u_xHalfAngle: function () {
          return self._scanePlaneXHalfAngle
        },
        u_yHalfAngle: function () {
          return self._scanePlaneYHalfAngle
        },
        u_radius: function () {
          return self.radius
        },
        u_color: function () {
          return self.scanPlaneColor
        },
        u_showThroughEllipsoid: function () {
          return self.showThroughEllipsoid
        },
        u_showIntersection: function () {
          return self.showIntersection
        },
        u_intersectionColor: function () {
          return self.intersectionColor
        },
        u_intersectionWidth: function () {
          return self.intersectionWidth
        },
        u_normalDirection: function () {
          return 1.0
        },
        u_lineColor: function () {
          return self.lineColor
        }
      }
    }

    get color() {
      return this._color
    }
    set color(val) {
      this._color = val
      this._material.uniforms.color = val
    }
    get boundingSphere() {
      return this._boundingSphere
    }

    get xHalfAngle() {
      return CesiumMath.toDegrees(this._xHalfAngle)
    }
    set xHalfAngle(val: any) {
      if (this._xHalfAngle !== val) {
        this._xHalfAngle = CesiumMath.toRadians(val)
        this._createVS = true
      }
    }

    get yHalfAngle() {
      return CesiumMath.toDegrees(this._yHalfAngle)
    }
    set yHalfAngle(val: any) {
      if (this._yHalfAngle !== val) {
        this._yHalfAngle = CesiumMath.toRadians(val)
        this._createVS = true
      }
    }

    get radius() {
      return this._radius
    }
    set radius(val: any) {
      if (this._radius !== val) {
        this._radius = val
        this._boundingSphere = new BoundingSphere(Cartesian3.ZERO, val)
        Matrix4.multiplyByUniformScale(this._modelMatrix, this._radius, this._computedModelMatrix)
        BoundingSphere.transform(this._boundingSphere, this._modelMatrix, this._boundingSphereWC)
      }
    }

    get modelMatrix() {
      return this._modelMatrix
    }
    set modelMatrix(val: any) {
      const modelMatrixChanged = !Matrix4.equals(val, this._modelMatrix)
      if (modelMatrixChanged) {
        Matrix4.clone(val, this._modelMatrix)
        Matrix4.multiplyByUniformScale(this._modelMatrix, this._radius, this._computedModelMatrix)
        BoundingSphere.transform(this._boundingSphere, this._modelMatrix, this._boundingSphereWC)
      }
    }

    get showThroughEllipsoid() {
      return this._showThroughEllipsoid
    }
    set showThroughEllipsoid(val: any) {
      if (this._showThroughEllipsoid !== val) {
        this._showThroughEllipsoid = val
        this._createRS = true
      }
    }

    get material() {
      return this._material
    }
    set material(val: any) {
      this._material = val
      this._createRS = true
      this._createSP = true
    }

    update(frameState: any) {
      const mode = frameState.mode
      if (!this.show || mode !== SceneMode.SCENE3D) {
        return
      }
      const xHalfAngle = this._xHalfAngle
      const yHalfAngle = this._yHalfAngle

      if (xHalfAngle < 0.0 || yHalfAngle < 0.0) {
        throw new ViewshedError('halfAngle must be greater than or equal to zero.')
      }
      if (xHalfAngle == 0.0 || yHalfAngle == 0.0) {
        return
      }

      const radius = this.radius
      if (radius < 0.0) {
        throw new ViewshedError('this.radius must be greater than or equal to zero.')
      }
      const showThroughEllipsoid = this.showThroughEllipsoid
      const material = this.material
      const translucent = material.isTranslucent()
      if (this._translucent !== translucent) {
        this._translucent = translucent
        this._createRS = true
      }
      if (this.showScanPlane) {
        const time = frameState.time
        let timeDiff = JulianDate.secondsDifference(time, this._time)
        if (timeDiff < 0) {
          this._time = JulianDate.clone(time, this._time)
        }
        let percentage
        if (this.speed <= 0) {
          percentage = 0
        } else {
          const speet = 10 / this.speed
          percentage = Math.max((timeDiff % speet) / speet, 0)
        }
        let angle
        const matrix3Scratch = new Matrix3()

        if (this.scanPlaneMode == 'H') {
          angle = 2 * yHalfAngle * percentage - yHalfAngle
          const cosYHalfAngle = cos(angle)
          const tanXHalfAngle = tan(xHalfAngle)

          const maxX = atan(cosYHalfAngle * tanXHalfAngle)
          this._scanePlaneXHalfAngle = maxX
          this._scanePlaneYHalfAngle = angle
          Matrix3.fromRotationX(this._scanePlaneYHalfAngle, matrix3Scratch)
        } else {
          angle = 2 * xHalfAngle * percentage - xHalfAngle
          const tanYHalfAngle = tan(yHalfAngle)
          const cosXHalfAngle = cos(angle)

          const maxY = atan(cosXHalfAngle * tanYHalfAngle)
          this._scanePlaneXHalfAngle = angle
          this._scanePlaneYHalfAngle = maxY
          Matrix3.fromRotationY(this._scanePlaneXHalfAngle, matrix3Scratch)
        }

        Matrix4.multiplyByMatrix3(this.modelMatrix, matrix3Scratch, this._computedScanPlaneModelMatrix)
        Matrix4.multiplyByUniformScale(this._computedScanPlaneModelMatrix, this.radius, this._computedScanPlaneModelMatrix)
      }

      if (this._createVS) {
        createVertexArray(this, frameState)
      }
      if (this._createRS) {
        createRenderState(this, showThroughEllipsoid, translucent)
      }
      if (this._createSP) {
        createShaderProgram(this, frameState, material)
      }
      if (this._createRS || this._createSP) {
        createCommands(this, translucent)
      }

      const commandList = frameState.commandList
      const passes = frameState.passes
      const colorCommands = this._colorCommands
      if (passes.render) {
        for (let i = 0, len = colorCommands.length; i < len; i++) {
          const colorCommand = colorCommands[i]
          commandList.push(colorCommand)
        }
      }
    }

    destroy() {
      this._pickSP.destroy()
      this._sp = this._sp.destroy()
      this._scanePlaneSP && (this._scanePlaneSP = this._scanePlaneSP.destroy())
      return Cesium.destroyObject(this)
    }
  }

  function createCommand(
    primitive: any,
    frontCommand: any,
    backCommand: any,
    frontFaceRS: any,
    backFaceRS: any,
    sp: any,
    va: any,
    uniforms: any,
    modelMatrix: any,
    translucent: any,
    pass: any,
    isLine?: any
  ) {
    if (translucent && backCommand) {
      backCommand.vertexArray = va
      backCommand.renderState = backFaceRS
      backCommand.shaderProgram = sp
      backCommand.uniformMap = combine(uniforms, primitive._material._uniforms)
      backCommand.uniformMap.u_normalDirection = function () {
        return -1.0
      }
      backCommand.pass = pass
      backCommand.modelMatrix = modelMatrix
      primitive._colorCommands.push(backCommand)
    }

    frontCommand.vertexArray = va
    frontCommand.renderState = frontFaceRS
    frontCommand.shaderProgram = sp
    frontCommand.uniformMap = combine(uniforms, primitive._material._uniforms)
    if (isLine) {
      frontCommand.uniformMap.u_type = function () {
        return 1
      }
    }
    frontCommand.pass = pass
    frontCommand.modelMatrix = modelMatrix
    primitive._colorCommands.push(frontCommand)
  }

  function createCommands(primitive: any, translucent: any) {
    primitive._colorCommands.length = 0

    const pass = translucent ? Pass.TRANSLUCENT : Pass.OPAQUE

    if (primitive.showLateralSurfaces) {
      createCommand(
        primitive,
        primitive._sectorFrontCommand,
        primitive._sectorBackCommand,
        primitive._frontFaceRS,
        primitive._backFaceRS,
        primitive._sp,
        primitive._sectorVA,
        primitive._uniforms,
        primitive._computedModelMatrix,
        translucent,
        pass
      )
    }
    if (primitive.showSectorLines) {
      createCommand(
        primitive,
        primitive._sectorLineCommand,
        undefined,
        primitive._frontFaceRS,
        primitive._backFaceRS,
        primitive._sp,
        primitive._sectorLineVA,
        primitive._uniforms,
        primitive._computedModelMatrix,
        translucent,
        pass,
        true
      )
    }

    if (primitive.showSectorSegmentLines) {
      createCommand(
        primitive,
        primitive._sectorSegmentLineCommand,
        undefined,
        primitive._frontFaceRS,
        primitive._backFaceRS,
        primitive._sp,
        primitive._sectorSegmentLineVA,
        primitive._uniforms,
        primitive._computedModelMatrix,
        translucent,
        pass,
        true
      )
    }

    if (primitive.showDomeSurfaces) {
      createCommand(
        primitive,
        primitive._domeFrontCommand,
        primitive._domeBackCommand,
        primitive._frontFaceRS,
        primitive._backFaceRS,
        primitive._sp,
        primitive._domeVA,
        primitive._uniforms,
        primitive._computedModelMatrix,
        translucent,
        pass
      )
    }

    if (primitive.showDomeLines) {
      createCommand(
        primitive,
        primitive._domeLineCommand,
        undefined,
        primitive._frontFaceRS,
        primitive._backFaceRS,
        primitive._sp,
        primitive._domeLineVA,
        primitive._uniforms,
        primitive._computedModelMatrix,
        translucent,
        pass,
        true
      )
    }
    if (primitive.showScanPlane) {
      createCommand(
        primitive,
        primitive._scanPlaneFrontCommand,
        primitive._scanPlaneBackCommand,
        primitive._frontFaceRS,
        primitive._backFaceRS,
        primitive._scanePlaneSP,
        primitive._scanPlaneVA,
        primitive._scanUniforms,
        primitive._computedScanPlaneModelMatrix,
        translucent,
        pass
      )
    }
  }

  function createCommonShaderProgram(primitive: any, frameState: any, material: any) {
    const context = frameState.context

    const vs = sensorVS
    const fs = new ShaderSource({
      sources: [sensorComm, material.shaderSource, sensorFS]
    })

    primitive._sp = ShaderProgram.replaceCache({
      context: context,
      shaderProgram: primitive._sp,
      vertexShaderSource: vs,
      fragmentShaderSource: fs,
      attributeLocations: attributeLocations
    })

    const pickFS = new ShaderSource({
      sources: [sensorComm, material.shaderSource, sensorFS],
      pickColorQualifier: 'uniform'
    })

    primitive._pickSP = ShaderProgram.replaceCache({
      context: context,
      shaderProgram: primitive._pickSP,
      vertexShaderSource: vs,
      fragmentShaderSource: pickFS,
      attributeLocations: attributeLocations
    })
  }

  function createScanPlaneShaderProgram(primitive: any, frameState: any, material: any) {
    const context = frameState.context

    const vs = sensorVS
    const fs = new ShaderSource({
      sources: [sensorComm, material.shaderSource, scanPlaneFS]
    })

    primitive._scanePlaneSP = ShaderProgram.replaceCache({
      context: context,
      shaderProgram: primitive._scanePlaneSP,
      vertexShaderSource: vs,
      fragmentShaderSource: fs,
      attributeLocations: attributeLocations
    })
  }

  function createShaderProgram(primitive: any, frameState: any, material: any) {
    createCommonShaderProgram(primitive, frameState, material)

    if (primitive.showScanPlane) {
      createScanPlaneShaderProgram(primitive, frameState, material)
    }
  }

  function createRenderState(primitive: any, showThroughEllipsoid: any, translucent: any) {
    if (translucent) {
      primitive._frontFaceRS = RenderState.fromCache({
        depthTest: {
          enabled: !showThroughEllipsoid
        },
        depthMask: false,
        blending: BlendingState.ALPHA_BLEND,
        cull: {
          enabled: true,
          face: CullFace.BACK
        }
      })

      primitive._backFaceRS = RenderState.fromCache({
        depthTest: {
          enabled: !showThroughEllipsoid
        },
        depthMask: false,
        blending: BlendingState.ALPHA_BLEND,
        cull: {
          enabled: true,
          face: CullFace.FRONT
        }
      })

      primitive._pickRS = RenderState.fromCache({
        depthTest: {
          enabled: !showThroughEllipsoid
        },
        depthMask: false,
        blending: BlendingState.ALPHA_BLEND
      })
    } else {
      primitive._frontFaceRS = RenderState.fromCache({
        depthTest: {
          enabled: !showThroughEllipsoid
        },
        depthMask: true
      })

      primitive._pickRS = RenderState.fromCache({
        depthTest: {
          enabled: true
        },
        depthMask: true
      })
    }
  }

  function computeUnitPosiiton(primitive: any, xHalfAngle: any, yHalfAngle: any) {
    const slice = primitive.slice
    const cosYHalfAngle = cos(yHalfAngle)
    const tanYHalfAngle = tan(yHalfAngle)
    const cosXHalfAngle = cos(xHalfAngle)
    const tanXHalfAngle = tan(xHalfAngle)

    const maxY = atan(cosXHalfAngle * tanYHalfAngle)
    const maxX = atan(cosYHalfAngle * tanXHalfAngle)

    const zoy: any[] = []
    for (let i = 0; i < slice; i++) {
      const phi = (2 * maxY * i) / (slice - 1) - maxY
      zoy.push(new Cartesian3(0, sin(phi), cos(phi)))
    }
    const zox: any[] = []
    for (let i = 0; i < slice; i++) {
      const phi = (2 * maxX * i) / (slice - 1) - maxX
      zox.push(new Cartesian3(sin(phi), 0, cos(phi)))
    }

    return {
      zoy: zoy,
      zox: zox
    }
  }

  function computeSectorPositions(primitive: any, unitPosition: any) {
    const xHalfAngle = primitive._xHalfAngle
    const yHalfAngle = primitive._yHalfAngle
    const zoy = unitPosition.zoy
    const zox = unitPosition.zox
    const positions: any[] = []

    const matrix3Scratch = new Matrix3()
    let matrix3 = Matrix3.fromRotationY(xHalfAngle, matrix3Scratch)
    positions.push(
      zoy.map(function (p: any) {
        return Matrix3.multiplyByVector(matrix3, p, new Cartesian3())
      })
    )
    matrix3 = Matrix3.fromRotationX(-yHalfAngle, matrix3Scratch)
    positions.push(
      zox.map(function (p: any) {
        return Matrix3.multiplyByVector(matrix3, p, new Cartesian3())
      }).reverse()
    )
    matrix3 = Matrix3.fromRotationY(-xHalfAngle, matrix3Scratch)
    positions.push(
      zoy.map(function (p: any) {
        return Matrix3.multiplyByVector(matrix3, p, new Cartesian3())
      }).reverse()
    )
    matrix3 = Matrix3.fromRotationX(yHalfAngle, matrix3Scratch)
    positions.push(
      zox.map(function (p: any) {
        return Matrix3.multiplyByVector(matrix3, p, new Cartesian3())
      })
    )
    return positions
  }

  function createSectorVertexArray(context: any, positions: any) {
    const planeLength = Array.prototype.concat.apply([], positions).length - positions.length
    const vertices = new Float32Array(2 * 3 * 3 * planeLength)

    let k = 0
    for (let i = 0, len = positions.length; i < len; i++) {
      const planePositions = positions[i]
      const nScratch = new Cartesian3()
      const n = Cartesian3.normalize(
        Cartesian3.cross(planePositions[0], planePositions[planePositions.length - 1], nScratch),
        nScratch
      )
      for (let j = 0, planeLength = planePositions.length - 1; j < planeLength; j++) {
        vertices[k++] = 0.0
        vertices[k++] = 0.0
        vertices[k++] = 0.0
        vertices[k++] = -n.x
        vertices[k++] = -n.y
        vertices[k++] = -n.z

        vertices[k++] = planePositions[j].x
        vertices[k++] = planePositions[j].y
        vertices[k++] = planePositions[j].z
        vertices[k++] = -n.x
        vertices[k++] = -n.y
        vertices[k++] = -n.z

        vertices[k++] = planePositions[j + 1].x
        vertices[k++] = planePositions[j + 1].y
        vertices[k++] = planePositions[j + 1].z
        vertices[k++] = -n.x
        vertices[k++] = -n.y
        vertices[k++] = -n.z
      }
    }

    const vertexBuffer = Buffer.createVertexBuffer({
      context: context,
      typedArray: vertices,
      usage: BufferUsage.STATIC_DRAW
    })

    const stride = 2 * 3 * Float32Array.BYTES_PER_ELEMENT

    const attributes = [
      {
        index: attributeLocations.position,
        vertexBuffer: vertexBuffer,
        componentsPerAttribute: 3,
        componentDatatype: ComponentDatatype.FLOAT,
        offsetInBytes: 0,
        strideInBytes: stride
      },
      {
        index: attributeLocations.normal,
        vertexBuffer: vertexBuffer,
        componentsPerAttribute: 3,
        componentDatatype: ComponentDatatype.FLOAT,
        offsetInBytes: 3 * Float32Array.BYTES_PER_ELEMENT,
        strideInBytes: stride
      }
    ]

    return new VertexArray({
      context: context,
      attributes: attributes
    })
  }

  function createSectorLineVertexArray(context: any, positions: any) {
    const planeLength = positions.length
    const vertices = new Float32Array(3 * 3 * planeLength)

    let k = 0
    for (let i = 0, len = positions.length; i < len; i++) {
      const planePositions = positions[i]
      vertices[k++] = 0.0
      vertices[k++] = 0.0
      vertices[k++] = 0.0

      vertices[k++] = planePositions[0].x
      vertices[k++] = planePositions[0].y
      vertices[k++] = planePositions[0].z
    }

    const vertexBuffer = Buffer.createVertexBuffer({
      context: context,
      typedArray: vertices,
      usage: BufferUsage.STATIC_DRAW
    })

    const stride = 3 * Float32Array.BYTES_PER_ELEMENT

    const attributes = [
      {
        index: attributeLocations.position,
        vertexBuffer: vertexBuffer,
        componentsPerAttribute: 3,
        componentDatatype: ComponentDatatype.FLOAT,
        offsetInBytes: 0,
        strideInBytes: stride
      }
    ]

    return new VertexArray({
      context: context,
      attributes: attributes
    })
  }

  function createSectorSegmentLineVertexArray(context: any, positions: any) {
    const planeLength = Array.prototype.concat.apply([], positions).length - positions.length
    const vertices = new Float32Array(3 * 3 * planeLength)

    let k = 0
    for (let i = 0, len = positions.length; i < len; i++) {
      const planePositions = positions[i]

      for (let j = 0, planeLength = planePositions.length - 1; j < planeLength; j++) {
        vertices[k++] = planePositions[j].x
        vertices[k++] = planePositions[j].y
        vertices[k++] = planePositions[j].z

        vertices[k++] = planePositions[j + 1].x
        vertices[k++] = planePositions[j + 1].y
        vertices[k++] = planePositions[j + 1].z
      }
    }

    const vertexBuffer = Buffer.createVertexBuffer({
      context: context,
      typedArray: vertices,
      usage: BufferUsage.STATIC_DRAW
    })

    const stride = 3 * Float32Array.BYTES_PER_ELEMENT

    const attributes = [
      {
        index: attributeLocations.position,
        vertexBuffer: vertexBuffer,
        componentsPerAttribute: 3,
        componentDatatype: ComponentDatatype.FLOAT,
        offsetInBytes: 0,
        strideInBytes: stride
      }
    ]

    return new VertexArray({
      context: context,
      attributes: attributes
    })
  }

  function createDomeVertexArray(context: any) {
    const geometry = EllipsoidGeometry.createGeometry(
      new EllipsoidGeometry({
        vertexFormat: VertexFormat.POSITION_ONLY,
        stackPartitions: 32,
        slicePartitions: 32
      })
    )

    return VertexArray.fromGeometry({
      context: context,
      geometry: geometry,
      attributeLocations: attributeLocations,
      bufferUsage: BufferUsage.STATIC_DRAW,
      interleave: false
    })
  }

  function createDomeLineVertexArray(context: any) {
    const geometry = EllipsoidOutlineGeometry.createGeometry(
      new EllipsoidOutlineGeometry({
        vertexFormat: VertexFormat.POSITION_ONLY,
        stackPartitions: 32,
        slicePartitions: 32
      })
    )

    return VertexArray.fromGeometry({
      context: context,
      geometry: geometry,
      attributeLocations: attributeLocations,
      bufferUsage: BufferUsage.STATIC_DRAW,
      interleave: false
    })
  }

  function createScanPlaneVertexArray(context: any, positions: any) {
    const planeLength = positions.length - 1
    const vertices = new Float32Array(3 * 3 * planeLength)

    let k = 0
    for (let i = 0; i < planeLength; i++) {
      vertices[k++] = 0.0
      vertices[k++] = 0.0
      vertices[k++] = 0.0

      vertices[k++] = positions[i].x
      vertices[k++] = positions[i].y
      vertices[k++] = positions[i].z

      vertices[k++] = positions[i + 1].x
      vertices[k++] = positions[i + 1].y
      vertices[k++] = positions[i + 1].z
    }

    const vertexBuffer = Buffer.createVertexBuffer({
      context: context,
      typedArray: vertices,
      usage: BufferUsage.STATIC_DRAW
    })

    const stride = 3 * Float32Array.BYTES_PER_ELEMENT

    const attributes = [
      {
        index: attributeLocations.position,
        vertexBuffer: vertexBuffer,
        componentsPerAttribute: 3,
        componentDatatype: ComponentDatatype.FLOAT,
        offsetInBytes: 0,
        strideInBytes: stride
      }
    ]

    return new VertexArray({
      context: context,
      attributes: attributes
    })
  }

  function createVertexArray(primitive: any, frameState: any) {
    const context = frameState.context

    const unitSectorPositions = computeUnitPosiiton(primitive, primitive._xHalfAngle, primitive._yHalfAngle)
    const positions = computeSectorPositions(primitive, unitSectorPositions)

    if (primitive.showLateralSurfaces) {
      primitive._sectorVA = createSectorVertexArray(context, positions)
    }

    if (primitive.showSectorLines) {
      primitive._sectorLineVA = createSectorLineVertexArray(context, positions)
    }

    if (primitive.showSectorSegmentLines) {
      primitive._sectorSegmentLineVA = createSectorSegmentLineVertexArray(context, positions)
    }

    if (primitive.showDomeSurfaces) {
      primitive._domeVA = createDomeVertexArray(context)
    }

    if (primitive.showDomeLines) {
      primitive._domeLineVA = createDomeLineVertexArray(context)
    }

    if (primitive.showScanPlane) {
      if (primitive.scanPlaneMode == 'H') {
        const unitScanPlanePositions = computeUnitPosiiton(primitive, CesiumMath.PI_OVER_TWO, 0)
        primitive._scanPlaneVA = createScanPlaneVertexArray(context, unitScanPlanePositions.zox)
      } else {
        const unitScanPlanePositions = computeUnitPosiiton(primitive, 0, CesiumMath.PI_OVER_TWO)
        primitive._scanPlaneVA = createScanPlaneVertexArray(context, unitScanPlanePositions.zoy)
      }
    }
  }

  RectangularSensorPrimitive.prototype.isDestroyed = function () {
    return false
  }

  return RectangularSensorPrimitive
})()

export { RectangularSensorPrimitive }

const sensorVS =
  `in vec4 position;
in vec3 normal;

out vec3 v_position;
out vec3 v_positionWC;
out vec3 v_positionEC;
out vec3 v_normalEC;

void main()
{
  gl_Position = czm_modelViewProjection * position;
  v_position = vec3(position);
  v_positionWC = (czm_model * position).xyz;
  v_positionEC = (czm_modelView * position).xyz;
  v_normalEC = czm_normal * normal;
}`

const sensorComm =
  `struct czm_ellipsoid
{
    vec3 center;
    vec3 radii;
    vec3 inverseRadii;
    vec3 inverseRadiiSquared;
};

czm_ellipsoid czm_getWgs84EllipsoidEC()
{
    vec3 radii = vec3(6378137.0, 6378137.0, 6356752.314245);
    vec3 inverseRadii = vec3(1.0 / radii.x, 1.0 / radii.y, 1.0 / radii.z);
    vec3 inverseRadiiSquared = inverseRadii * inverseRadii;
    czm_ellipsoid temp = czm_ellipsoid(czm_view[3].xyz, radii, inverseRadii, inverseRadiiSquared);
    return temp;
}


uniform vec4 u_intersectionColor;
uniform float u_intersectionWidth;
uniform vec4 u_lineColor;
bool inSensorShadow(vec3 coneVertexWC, czm_ellipsoid ellipsoidEC, vec3 pointWC)
{
  // Diagonal matrix from the unscaled ellipsoid space to the scaled space.
  vec3 D = ellipsoidEC.inverseRadii;

  // Sensor vertex in the scaled ellipsoid space
  vec3 q = D * coneVertexWC;
  float qMagnitudeSquared = dot(q, q);
  float test = qMagnitudeSquared - 1.0;

  // Sensor vertex to fragment vector in the ellipsoid's scaled space
  vec3 temp = D * pointWC - q;
  float d = dot(temp, q);

  // Behind silhouette plane and inside silhouette cone
  return (d < -test) && (d / length(temp) < -sqrt(test));
}

///////////////////////////////////////////////////////////////////////////////

vec4 getLineColor()
{
  return u_lineColor;
}

vec4 getIntersectionColor()
{
  return u_intersectionColor;
}

float getIntersectionWidth()
{
  return u_intersectionWidth;
}

vec2 sensor2dTextureCoordinates(float sensorRadius, vec3 pointMC)
{
  // (s, t) both in the range [0, 1]
  float t = pointMC.z / sensorRadius;
  float s = 1.0 + (atan(pointMC.y, pointMC.x) / czm_twoPi);
  s = s - floor(s);

  return vec2(s, t);
}`

const sensorFS =
  `
#ifdef GL_OES_standard_derivatives
  #extension GL_OES_standard_derivatives : enable
#endif

uniform bool u_showIntersection;
uniform bool u_showThroughEllipsoid;

uniform float u_radius;
uniform float u_xHalfAngle;
uniform float u_yHalfAngle;
uniform float u_normalDirection;
uniform float u_type;

in vec3 v_position;
in vec3 v_positionWC;
in vec3 v_positionEC;
in vec3 v_normalEC;

vec4 getColor(float sensorRadius, vec3 pointEC)
{
  czm_materialInput materialInput;

  vec3 pointMC = (czm_inverseModelView * vec4(pointEC, 1.0)).xyz;
  materialInput.st = sensor2dTextureCoordinates(sensorRadius, pointMC);
  materialInput.str = pointMC / sensorRadius;

  vec3 positionToEyeEC = -v_positionEC;
  materialInput.positionToEyeEC = positionToEyeEC;

  vec3 normalEC = normalize(v_normalEC);
  materialInput.normalEC = u_normalDirection * normalEC;

  czm_material material = czm_getMaterial(materialInput);

  return vec4(material.diffuse, material.alpha);

}

bool isOnBoundary(float value, float epsilon)
{
  float width = getIntersectionWidth();
  float tolerance = width * epsilon;

#ifdef GL_OES_standard_derivatives
  float delta = max(abs(dFdx(value)), abs(dFdy(value)));
  float pixels = width * delta;
  float temp = abs(value);
  // There are a couple things going on here.
  // First we test the value at the current fragment to see if it is within the tolerance.
  // We also want to check if the value of an adjacent pixel is within the tolerance,
  // but we don't want to admit points that are obviously not on the surface.
  // For example, if we are looking for "value" to be close to 0, but value is 1 and the adjacent value is 2,
  // then the delta would be 1 and "temp - delta" would be "1 - 1" which is zero even though neither of
  // the points is close to zero.
  return temp < tolerance && temp < pixels || (delta < 10.0 * tolerance && temp - delta < tolerance && temp < pixels);
#else
  return abs(value) < tolerance;
#endif
}

vec4 shade(bool isOnBoundary)
{
  if (u_showIntersection && isOnBoundary)
  {
      return getIntersectionColor();
  }
  if(u_type == 1.0){
      return getLineColor();
  }
  return getColor(u_radius, v_positionEC);
}

float ellipsoidSurfaceFunction(czm_ellipsoid ellipsoid, vec3 point)
{
  vec3 scaled = ellipsoid.inverseRadii * point;
  return dot(scaled, scaled) - 1.0;
}

void main()
{
  vec3 sensorVertexWC = czm_model[3].xyz;      // (0.0, 0.0, 0.0) in model coordinates
  vec3 sensorVertexEC = czm_modelView[3].xyz;  // (0.0, 0.0, 0.0) in model coordinates

  //vec3 pixDir = normalize(v_position);
  float positionX = v_position.x;
  float positionY = v_position.y;
  float positionZ = v_position.z;

  vec3 zDir = vec3(0.0, 0.0, 1.0);
  vec3 lineX = vec3(positionX, 0 ,positionZ);
  vec3 lineY = vec3(0, positionY, positionZ);
  float resX = dot(normalize(lineX), zDir);
  if(resX < cos(u_xHalfAngle)-0.00001){
      discard;
  }
  float resY = dot(normalize(lineY), zDir);
  if(resY < cos(u_yHalfAngle)-0.00001){
      discard;
  }


  czm_ellipsoid ellipsoid = czm_getWgs84EllipsoidEC();
  float ellipsoidValue = ellipsoidSurfaceFunction(ellipsoid, v_positionWC);

  // Occluded by the ellipsoid?
if (!u_showThroughEllipsoid)
{
    // Discard if in the ellipsoid
    // PERFORMANCE_IDEA: A coarse check for ellipsoid intersection could be done on the CPU first.
    if (ellipsoidValue < 0.0)
    {
          discard;
    }

    // Discard if in the sensor's shadow
    if (inSensorShadow(sensorVertexWC, ellipsoid, v_positionWC))
    {
        discard;
    }
  }

  // Notes: Each surface functions should have an associated tolerance based on the floating point error.
  bool isOnEllipsoid = isOnBoundary(ellipsoidValue, czm_epsilon3);
  //isOnEllipsoid = false;
  //if((resX >= 0.8 && resX <= 0.81)||(resY >= 0.8 && resY <= 0.81)){
  /*if(false){
      out_FragColor = vec4(1.0,0.0,0.0,1.0);
  }else{
      out_FragColor = shade(isOnEllipsoid);
  }
*/
  out_FragColor = shade(isOnEllipsoid);

}`

const scanPlaneFS =
  `#ifdef GL_OES_standard_derivatives
  #extension GL_OES_standard_derivatives : enable
#endif

uniform bool u_showIntersection;
uniform bool u_showThroughEllipsoid;

uniform float u_radius;
uniform float u_xHalfAngle;
uniform float u_yHalfAngle;
uniform float u_normalDirection;
uniform vec4 u_color;

in vec3 v_position;
in vec3 v_positionWC;
in vec3 v_positionEC;
in vec3 v_normalEC;

vec4 getColor(float sensorRadius, vec3 pointEC)
{
  czm_materialInput materialInput;

  vec3 pointMC = (czm_inverseModelView * vec4(pointEC, 1.0)).xyz;
  materialInput.st = sensor2dTextureCoordinates(sensorRadius, pointMC);
  materialInput.str = pointMC / sensorRadius;

  vec3 positionToEyeEC = -v_positionEC;
  materialInput.positionToEyeEC = positionToEyeEC;

  vec3 normalEC = normalize(v_normalEC);
  materialInput.normalEC = u_normalDirection * normalEC;

  czm_material material = czm_getMaterial(materialInput);

  material.diffuse = u_color.rgb;
  material.alpha = u_color.a;

  return vec4(material.diffuse, material.alpha);

}

bool isOnBoundary(float value, float epsilon)
{
  float width = getIntersectionWidth();
  float tolerance = width * epsilon;

#ifdef GL_OES_standard_derivatives
  float delta = max(abs(dFdx(value)), abs(dFdy(value)));
  float pixels = width * delta;
  float temp = abs(value);
  // There are a couple things going on here.
  // First we test the value at the current fragment to see if it is within the tolerance.
  // We also want to check if the value of an adjacent pixel is within the tolerance,
  // but we don't want to admit points that are obviously not on the surface.
  // For example, if we are looking for "value" to be close to 0, but value is 1 and the adjacent value is 2,
  // then the delta would be 1 and "temp - delta" would be "1 - 1" which is zero even though neither of
  // the points is close to zero.
  return temp < tolerance && temp < pixels || (delta < 10.0 * tolerance && temp - delta < tolerance && temp < pixels);
#else
  return abs(value) < tolerance;
#endif
}

vec4 shade(bool isOnBoundary)
{
  if (u_showIntersection && isOnBoundary)
  {
      return getIntersectionColor();
  }
  return getColor(u_radius, v_positionEC);
}

float ellipsoidSurfaceFunction(czm_ellipsoid ellipsoid, vec3 point)
{
  vec3 scaled = ellipsoid.inverseRadii * point;
  return dot(scaled, scaled) - 1.0;
}

void main()
{
  vec3 sensorVertexWC = czm_model[3].xyz;      // (0.0, 0.0, 0.0) in model coordinates
  vec3 sensorVertexEC = czm_modelView[3].xyz;  // (0.0, 0.0, 0.0) in model coordinates

  //vec3 pixDir = normalize(v_position);
  float positionX = v_position.x;
  float positionY = v_position.y;
  float positionZ = v_position.z;

  vec3 zDir = vec3(0.0, 0.0, 1.0);
  vec3 lineX = vec3(positionX, 0 ,positionZ);
  vec3 lineY = vec3(0, positionY, positionZ);
  float resX = dot(normalize(lineX), zDir);
  if(resX < cos(u_xHalfAngle) - 0.0001){
      discard;
  }
  float resY = dot(normalize(lineY), zDir);
  if(resY < cos(u_yHalfAngle)- 0.0001){
      discard;
  }


  czm_ellipsoid ellipsoid = czm_getWgs84EllipsoidEC();
  float ellipsoidValue = ellipsoidSurfaceFunction(ellipsoid, v_positionWC);

  // Occluded by the ellipsoid?
if (!u_showThroughEllipsoid)
{
    // Discard if in the ellipsoid
    // PERFORMANCE_IDEA: A coarse check for ellipsoid intersection could be done on the CPU first.
    if (ellipsoidValue < 0.0)
    {
          discard;
    }

    // Discard if in the sensor's shadow
    if (inSensorShadow(sensorVertexWC, ellipsoid, v_positionWC))
    {
        discard;
    }
  }

  // Notes: Each surface functions should have an associated tolerance based on the floating point error.
  bool isOnEllipsoid = isOnBoundary(ellipsoidValue, czm_epsilon3);
  out_FragColor = shade(isOnEllipsoid);

}`

export class ViewShedAnalysis {
  _viewer: Cesium.Viewer
  _options: any
  _observe: any
  _viewPosition: any
  _debug: any
  _far: any
  _near: any
  _aspectRatio: any
  _fov: any
  _direction: any
  _up: any
  _frustum: any
  _shadowMap: any
  _viewCamera: any

  constructor(viewer: Cesium.Viewer, options: any) {
    options = defaultValue(options, {})
    if (!(viewer && viewer instanceof Cesium.Viewer)) {
      throw new ViewshedError('Expected viewer to be typeof Viewer, actual typeof was ' + typeof viewer)
    }
    this._viewer = viewer
    this._options = options

    if (!defined(options.observe)) {
      throw new ViewshedError('parameter options.observe is required.')
    }
    if (!defined(options.viewPosition)) {
      throw new ViewshedError('parameter options.viewPosition is required.')
    }

    this._observe = options.observe
    this._viewPosition = options.viewPosition
    this._debug = defaultValue(options.debug, false)
    this._far = defaultValue(options.far, Cesium.Cartesian3.distance(this._observe, this._viewPosition))
    this._near = defaultValue(options.near, 0.001 * this._far)
    this._aspectRatio = defaultValue(options.aspectRatio, 1.5)
    this._fov = defaultValue(options.fov, 120)

    const direction = Cesium.Cartesian3.subtract(this._viewPosition, this._observe, new Cesium.Cartesian3())
    this._direction = Cesium.Cartesian3.normalize(direction, direction)
    this._up = viewer.scene.mapProjection.ellipsoid.geodeticSurfaceNormal(this._observe, new Cesium.Cartesian3())
  }

  clear() {
    if (defined(this._frustum)) {
      this._viewer.scene.primitives.remove(this._frustum)
    }
    if (defined(this._shadowMap)) {
      this._viewer.scene.primitives.remove(this._shadowMap)
    }
  }

  destroy() {
    this.clear()
    if (this._frustum && !this._frustum.isDestroyed()) {
      this._frustum.destroy()
    }
    if (this._shadowMap && !this._shadowMap.isDestroyed()) {
      this._shadowMap.destroy()
    }
    return Cesium.destroyObject(this)
  }

  get frustum() {
    return this._frustum
  }

  setProperty(name: string, value: any) {
    if (this[name as keyof ViewShedAnalysis] === value) {
      return
    }

    ;(this as any)[name] = value
    this.update()
  }

  get debug() {
    return this._debug
  }

  set debug(val: any) {
    if (this._debug !== val) {
      this._debug = val
      if (this._frustum) {
        this._frustum.show = val
      }
    }
  }

  get observe() {
    return this._observe
  }

  set observe(val: any) {
    if (this._observe === val) return
    this._observe = val
    this._up = this._viewer.scene.mapProjection.ellipsoid.geodeticSurfaceNormal(val, new Cesium.Cartesian3())
    this.recomputeDirection()
    this.update()
  }

  get viewPosition() {
    return this._viewPosition
  }

  set viewPosition(val: any) {
    if (this._viewPosition === val) return
    this._viewPosition = val
    this.recomputeDirection()
    this.update()
  }

  recomputeDirection() {
    const direction = Cesium.Cartesian3.subtract(this._viewPosition, this._observe, new Cesium.Cartesian3())
    this._direction = Cesium.Cartesian3.normalize(direction, direction)
  }

  get direction() {
    return this._direction
  }

  get far() {
    return this._far
  }

  set far(val: any) {
    this.setProperty('_far', val)
  }

  get near() {
    return this._near
  }

  set near(val: any) {
    this.setProperty('_near', val)
  }

  get fov() {
    return this._fov
  }

  set fov(val: any) {
    this.setProperty('_fov', val)
  }

  get aspectRatio() {
    return this._aspectRatio
  }

  set aspectRatio(val: any) {
    this.setProperty('_aspectRatio', val)
  }

  update() {
    this.createOrUpdateCamera()
    this.createOrUpdateFrustum()
    this.createOrUpdateShadowMap()
  }

  createOrUpdateCamera() {
    if (!defined(this._viewCamera)) {
      this._viewCamera = new Cesium.Camera(this._viewer.scene)
    }

    this._viewCamera.frustum.near = this._near
    this._viewCamera.frustum.far = this._far
    this._viewCamera.frustum.aspectRatio = this._aspectRatio
    this._viewCamera.frustum.fov = Cesium.Math.toRadians(this.fov)
    this._viewCamera.direction = Cesium.Cartesian3.normalize(this._direction, this._viewCamera.direction)
    this._viewCamera.position = Cesium.Cartesian3.clone(this._observe, this._viewCamera.position)
    this._viewCamera.up = this._up
    this._viewCamera.right = Cesium.Cartesian3.cross(this._viewCamera.up, this._viewCamera.direction, new Cesium.Cartesian3())
  }

  rotateCamera(angle: number, method: 'rotateLeft' | 'rotateDown') {
    const oldTransform = Cesium.Matrix4.clone(this._viewCamera._transform, new Cesium.Matrix4())
    const transform = Cesium.Transforms.eastNorthUpToFixedFrame(
      this._viewCamera.position,
      this._viewCamera._projection.ellipsoid
    )

    this._viewCamera._setTransform(transform)
    this._viewCamera[method](Cesium.Math.toRadians(angle))
    this._viewCamera._setTransform(oldTransform)
    Cesium.Cartesian3.clone(this._viewCamera.directionWC, this._direction)
    this.update()
  }

  rotateLeft(angle: number) {
    this.rotateCamera(angle, 'rotateLeft')
  }

  rotateRight(angle: number) {
    this.rotateLeft(-angle)
  }

  rotateDown(angle: number) {
    this.rotateCamera(angle, 'rotateDown')
  }

  rotateUp(angle: number) {
    this.rotateDown(-angle)
  }

  createOrUpdateFrustum() {
    const position = this._viewCamera.positionWC
    const rotation = new Cesium.Matrix3()
    const up = this._up
    const direction = this.direction
    const right = Cesium.Cartesian3.cross(up, direction, new Cesium.Cartesian3())

    Cesium.Matrix3.setColumn(rotation, 0, right, rotation)
    Cesium.Matrix3.setColumn(rotation, 1, up, rotation)
    Cesium.Matrix3.setColumn(rotation, 2, direction, rotation)

    const orientation = Cesium.Quaternion.fromRotationMatrix(rotation, new Cesium.Quaternion())
    const modelMatrix = Cesium.Matrix4.fromTranslationQuaternionRotationScale(
      position,
      orientation,
      new Cesium.Cartesian3(1, 1, 1),
      new Cesium.Matrix4()
    )

    if (this._frustum) {
      this._frustum.modelMatrix = modelMatrix
      this._frustum.xHalfAngle = this._fov / 2
      this._frustum.yHalfAngle = this._fov / 2 / this._aspectRatio
      this._frustum.radius = this._far
      return this._frustum
    }

    this._frustum = new RectangularSensorPrimitive({
      radius: this._far,
      modelMatrix: modelMatrix,
      xHalfAngle: this._fov / 2,
      yHalfAngle: this._fov / 2 / this._aspectRatio,
      showScanPlane: false,
      showLateralSurfaces: false,
      material: Cesium.Material.fromType(Cesium.Material.ColorType, {
        color: Cesium.Color.AQUA.withAlpha(0.3)
      }),
      show: this.debug
    })
    this._viewer.scene.primitives.add(this._frustum)
    return this._frustum
  }

  createOrUpdateShadowMap() {
    if (defined(this._shadowMap)) {
      this._viewer.scene.primitives.remove(this._shadowMap)
    }

    if (!(this._viewCamera && this._frustum._boundingSphereWC)) {
      return undefined
    }

    const shadowMap = new ViewshedMap({
      ...this._options,
      lightCamera: this._viewCamera,
      context: this._viewer.scene.context
    })
    const primitive = new ViewShadowPrimitive(shadowMap)
    this._shadowMap = this._viewer.scene.primitives.add(primitive)
    return this._shadowMap
  }
}
