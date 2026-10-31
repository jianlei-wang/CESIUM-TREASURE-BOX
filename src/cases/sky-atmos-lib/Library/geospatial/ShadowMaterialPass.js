import { Cartesian2, Cartesian3, Cartesian4, Matrix4 } from "../internal/MathTypes.js";
import shadowMaterialVertexShaderSource from "../shaders/geospatial/shadowMaterial.vert.glsl?raw";
import shadowMaterialFragmentShaderSource from "../shaders/geospatial/shadowMaterial.frag.glsl?raw";
import shadowResolveMaterialVertexShaderSource from "../shaders/geospatial/shadowResolveMaterial.vert.glsl?raw";
import shadowResolveMaterialFragmentShaderSource from "../shaders/geospatial/shadowResolveMaterial.frag.glsl?raw";
/**
 * @description HDR后场景效果合并
 */
import { 
    PixelDatatype,
    defined,
    PostProcessStageSampleMode,
    PostProcessStageComposite,
    ClearCommand,
    Color,
    Pass,
    Framebuffer,
    VertexArray,
    BufferUsage,
    ShaderProgram,
    RenderState,
    DrawCommand,
    ComputeCommand,
    Geometry,
    GeometryAttributes,
    ComponentDatatype,
    GeometryAttribute,
    Texture,
    Appearance,
    Sampler,
    WebGLConstants,
    PixelFormat,
    TextureMinificationFilter,
    TextureMagnificationFilter,
    Cartographic,
    Ellipsoid,
    SceneTransforms,
    createGuid,
    PassState,
    PrimitiveType,
    Transforms,
    Simon1994PlanetaryPositions,
    Matrix3,
    Resource,
    buildModuleUrl,
    destroyObject,
    BoundingRectangle,
    CullFace,
    JulianDate,
    Math as CesiumMath
 } from "cesium";
const defaultValue = (a, b) => a ?? b;
defaultValue.EMPTY_OBJECT = Object.freeze({});
import Texture3D from "../Texture3D.js";
import { installFramebufferCallbacks } from "../viewportQuadCommand.js";
import CascadedShadowMaps, { defaultsPass } from "./CascadedShadowMaps.js";
import { bayerOffsets, cloudLayerDensityGLSL, cloudsMaterialFS, cloudsMaterialVS } from "./CloudsMaterialPass.js";
import { getAltitudeCorrectionOffset } from "../GeospatialPipelinePass.js";
const shadowMaterialVS = shadowMaterialVertexShaderSource;
// Inject the same density implementation into cloud rendering and shadow tracing.
const shadowMaterialFS = shadowMaterialFragmentShaderSource.replace("/*__CLOUD_LAYER_DENSITY__*/", cloudLayerDensityGLSL);
const shadowResolveMaterialVS = shadowResolveMaterialVertexShaderSource;
const shadowResolveMaterialFS = shadowResolveMaterialFragmentShaderSource;

let lastRoll, lastPitch, lastHeading;
let lastTime = new JulianDate(), lastPosition = new Cartesian3();
let vector3Scratch = new Cartesian3;
let resolutionScratch = new Cartesian2;
export default class ShadowMaterialPass {

    constructor(scene, options = {}) {
        this._destroyed = false;

        this.id = createGuid();
        this._show = options.show ?? true;
        this._scene = scene;
        this.pipeline = options.pipeline;
        this._showTAA = false;
        this.minHeight = 0;
        this.maxHeight = 0;
        this.minLayerHeights = new Cartesian4(750, 1000, 7500, 0);
        this.maxLayerHeights = new Cartesian4(1400, 2200, 8000, 0);
        this.minIntervalHeights = new Cartesian3(0, 2200, 0);
        this.maxIntervalHeights = new Cartesian3(750, 7500, 0);
        this.densityScales = new Cartesian4(0.2000, 0.2000, 0.0030, 0.2000);
        this.shapeAmounts = new Cartesian4(1, 1, 0.4000, 1);
        this.shapeDetailAmounts = new Cartesian4(1, 1, 0, 1);
        this.weatherExponents = new Cartesian4(1, 1, 1, 1);
        this.shapeAlteringBiases = new Cartesian4(0.3500, 0.3500, 0.3500, 0.3500);
        this.coverageFilterWidths = new Cartesian4(0.6000, 0.6000, 0.5000, 0.6000);
        this.shadowTopHeight = 2200;
        this.shadowBottomHeight = 750;
        this.shadowLayerMask = new Cartesian4(1, 1, 0, 0);
        this.expTerms = new Cartesian4(0, 0, 0, 0);
        this.exponents = new Cartesian4(0, 0, 0, 0);
        this.linearTerms = new Cartesian4(0.7500, 0.7500, 0.7500, 0.7500);
        this.constantTerms = new Cartesian4(0.2500, 0.2500, 0.2500, 0.2500);
        this._varianceGamma = 1;
        this._jitterOffset = new Cartesian2();
        this._temporalAlpha = 0.01;
        this._historyValid = false;
        this._texelSize = new Cartesian2();
        this._altitudeCorrection = new Cartesian3();
        this.shadowNear = 1;
        // shadow
        this.inverseShadowMatrices = Array.from({ length: 4 }, () => new Matrix4())
        this.reprojectionMatrices = Array.from({ length: 4 }, () => new Matrix4())
        // Primary raymarch
        this.maxIterationCount = defaultsPass.shadow.maxIterationCount;
        this.minStepSize = defaultsPass.shadow.minStepSize;
        this.maxStepSize = defaultsPass.shadow.maxStepSize;
        this.minDensity = defaultsPass.shadow.minDensity;
        this.minExtinction = defaultsPass.shadow.minExtinction;
        this.minTransmittance = defaultsPass.shadow.minTransmittance;
        this.opticalDepthTailScale = 2;
        this.shadowCascadeCount = defaultsPass.shadow.cascadeCount;
        this.shadowMapSize = defaultsPass.shadow.mapSize;
        this.shadowMaps = new CascadedShadowMaps({
            cascadeCount: this.shadowCascadeCount,
            mapSize: this.shadowMapSize,
            splitLambda: 0.6
        })
        this._shadowUniform = {
            // Participating medium
            scatteringCoefficient: () => { return this.pipeline.scatteringCoefficient },
            absorptionCoefficient: () => { return this.pipeline.absorptionCoefficient },

            // Weather and shape
            coverage: () => { return this.pipeline.effectiveCloudCoverage },
            localWeatherTexture: () => { return this.pipeline.localWeatherTexture },
            localWeatherRepeat: () => { return this.pipeline.localWeatherRepeat },
            localWeatherOffset: () => { return this.pipeline.localWeatherOffset },
            shapeTexture: () => { return this.pipeline.shapeTexture },
            shapeRepeat: () => { return this.pipeline.shapeRepeat },
            shapeOffset: () => { return this.pipeline.shapeOffset },
            shapeDetailTexture: () => { return this.pipeline.shapeDetailTexture },
            shapeDetailRepeat: () => { return this.pipeline.shapeDetailRepeat },
            shapeDetailOffset: () => { return this.pipeline.shapeDetailOffset },
            cloudLayerTypes: () => this.pipeline.cloudMaterialPass.layerTypes,
            cloudLodRange: () => this.pipeline.cloudMaterialPass.lodRange,
            turbulenceTexture: () => { return this.pipeline.turbulenceTexture },
            turbulenceRepeat: () => { return this.pipeline.turbulenceRepeat },
            turbulenceDisplacement: () => { return this.pipeline.turbulenceDisplacement },

            minLayerHeights: () => { return this.pipeline.cloudMaterialPass.minLayerHeights },
            maxLayerHeights: () => { return this.pipeline.cloudMaterialPass.maxLayerHeights },
            minIntervalHeights: () => { return this.pipeline.cloudMaterialPass.minIntervalHeights },
            maxIntervalHeights: () => { return this.pipeline.cloudMaterialPass.maxIntervalHeights },
            densityScales: () => { return this.pipeline.cloudMaterialPass.densityScales },
            shapeAmounts: () => { return this.pipeline.cloudMaterialPass.shapeAmounts },
            shapeDetailAmounts: () => { return this.pipeline.cloudMaterialPass.shapeDetailAmounts },
            weatherExponents: () => { return this.pipeline.cloudMaterialPass.weatherExponents },
            shapeAlteringBiases: () => { return this.pipeline.cloudMaterialPass.shapeAlteringBiases },
            coverageFilterWidths: () => { return this.pipeline.cloudMaterialPass.coverageFilterWidths },
            minHeight: () => { return this.pipeline.cloudMaterialPass.minHeight },
            maxHeight: () => { return this.pipeline.cloudMaterialPass.maxHeight },
            shadowTopHeight: () => { return this.pipeline.cloudMaterialPass.shadowTopHeight },
            shadowBottomHeight: () => { return this.pipeline.cloudMaterialPass.shadowBottomHeight },
            shadowLayerMask: () => { return this.pipeline.cloudMaterialPass.shadowLayerMask },
            bottomRadius: () => { return this.pipeline.atmosphere.bottomRadius },
            topRadius: () => { return this.pipeline.atmosphere.topRadius },
            ellipsoidCenter: () => { return this.pipeline._ellipsoidCenter },
            ellipsoidMatrix: () => { return this.pipeline.ellipsoidMatrix },
            inverseEllipsoidMatrix: () => { return this.pipeline._inverseEllipsoidMatrix },
            altitudeCorrection: () => { return this._altitudeCorrection },
            sunDirection: () => { return this._scene.context.uniformState.sunDirectionWC },
            "densityProfile.expTerms": () => { return this.pipeline.cloudMaterialPass.expTerms; },
            "densityProfile.exponents": () => { return this.pipeline.cloudMaterialPass.exponents; },
            "densityProfile.linearTerms": () => { return this.pipeline.cloudMaterialPass.linearTerms; },
            "densityProfile.constantTerms": () => { return this.pipeline.cloudMaterialPass.constantTerms; },


            // shadow
            inverseShadowMatrices: () => { return this.inverseShadowMatrices },
            reprojectionMatrices: () => { return this.reprojectionMatrices },
            resolution: () => { return resolutionScratch.set(this.shadowMapSize.x, this.shadowMapSize.y) },
            frame: () => { return this.pipeline._frame },
            stbnTexture: () => { return this.pipeline.stbnTexture },

            // Primary raymarch
            maxIterationCount: () => { return this.maxIterationCount },
            minStepSize: () => { return this.minStepSize },
            maxStepSize: () => { return this.maxStepSize },
            minDensity: () => { return this.minDensity },
            minExtinction: () => { return this.minExtinction },
            minTransmittance: () => { return this.minTransmittance },
            opticalDepthTailScale: () => { return this.opticalDepthTailScale },
        }
        try {
            this.init();
        } catch (error) {
            try { this.destroy(); } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], "Pipeline initialization and cleanup failed");
            }
            throw error;
        }
    }

    init(isUpdate = false) {
        if (this._destroyed) return;
        const context = this._scene.context;
        let defines = ``

        // 预处理gbuffer定义
        if (context.renderGBuffer) {
            if (context.renderGBufferTexture) {
                defines += `#define HAS_M3D_GUFFER_TEXTURE\n`;
            }
            if (context.renderGBufferTexture2) {
                defines += `#define HAS_M3D_GUFFER_TEXTURE2\n`;
            }
        }

        const gl = this._scene.context._gl;
        if (this._width !== this._scene.drawingBufferWidth ||
            this._height !== this._scene.drawingBufferHeight
        ) {
            this._releaseRenderTargets();
            this.invalidateHistory();
            this._width = this._scene.drawingBufferWidth;
            this._height = this._scene.drawingBufferHeight;

            this._shadowLevel = new Texture({
                context: this._scene.context,
                width: this.shadowMapSize.x,
                height: this.shadowMapSize.y,
                pixelFormat: PixelFormat.RGBA,
                pixelDatatype: PixelDatatype.HALF_FLOAT,
                flipY: false,
            });
            this._shadowLevel2 = new Texture({
                context: this._scene.context,
                width: this.shadowMapSize.x,
                height: this.shadowMapSize.y,
                pixelFormat: PixelFormat.RGBA,
                pixelDatatype: PixelDatatype.HALF_FLOAT,
                flipY: false,
            });
            this._shadowLevel3 = new Texture({
                context: this._scene.context,
                width: this.shadowMapSize.x,
                height: this.shadowMapSize.y,
                pixelFormat: PixelFormat.RGBA,
                pixelDatatype: PixelDatatype.HALF_FLOAT,
                flipY: false,
            });
            this._shadowVecLevel1 = new Texture({
                context: this._scene.context,
                width: this.shadowMapSize.x,
                height: this.shadowMapSize.y,
                pixelFormat: PixelFormat.RGBA,
                pixelDatatype: PixelDatatype.HALF_FLOAT,
                flipY: false,
            });
            this._shadowVecLevel2 = new Texture({
                context: this._scene.context,
                width: this.shadowMapSize.x,
                height: this.shadowMapSize.y,
                pixelFormat: PixelFormat.RGBA,
                pixelDatatype: PixelDatatype.HALF_FLOAT,
                flipY: false,
            });
            this._shadowVecLevel3 = new Texture({
                context: this._scene.context,
                width: this.shadowMapSize.x,
                height: this.shadowMapSize.y,
                pixelFormat: PixelFormat.RGBA,
                pixelDatatype: PixelDatatype.HALF_FLOAT,
                flipY: false,
            });
            this._shadowBuffer = new Texture3D({
                context: this._scene.context,
                textureType: gl.TEXTURE_2D_ARRAY,
                width: this.shadowMapSize.x,
                height: this.shadowMapSize.y,
                depth: 6,
                pixelFormat: PixelFormat.RGBA,
                pixelDatatype: PixelDatatype.HALF_FLOAT,
                useTexStorage: true,
                flipY: false,
            });
            this._currentBuffer = new Texture3D({
                context: this._scene.context,
                textureType: gl.TEXTURE_2D_ARRAY,
                width: this.shadowMapSize.x,
                height: this.shadowMapSize.y,
                depth: 3,
                pixelFormat: PixelFormat.RGBA,
                pixelDatatype: PixelDatatype.HALF_FLOAT,
                useTexStorage: true,
                flipY: false,
            });
            this._historyBuffer = new Texture3D({
                context: this._scene.context,
                textureType: gl.TEXTURE_2D_ARRAY,
                width: this.shadowMapSize.x,
                height: this.shadowMapSize.y,
                depth: 3,
                pixelFormat: PixelFormat.RGBA,
                pixelDatatype: PixelDatatype.HALF_FLOAT,
                useTexStorage: true,
                flipY: false,
            });
            this._texelSize.set(1 / this.shadowMapSize.x, 1 / this.shadowMapSize.y)
        }

        if (!this._shadowDrawComomand) {
            const renderState = new RenderState({
                cull: {
                    enabled: true,
                    face: CullFace.BACK,
                },
                colorMask: {
                    red: true,
                    green: true,
                    blue: true,
                    alpha: true
                },
            })
            this._passState = new PassState(this._scene.context);
            this._shadowDrawComomand = this._scene.context.createViewportQuadCommand(shadowMaterialFS, {
                renderState: renderState,
                uniformMap: this._shadowUniform,
                primitiveType: PrimitiveType.TRIANGLES
            }, shadowMaterialVS);
            // 2
            this._passState2 = new PassState(this._scene.context);

            this._shadowResolveDrawComomand = this._scene.context.createViewportQuadCommand(shadowResolveMaterialFS, {
                renderState: renderState,
                uniformMap: {
                    frame: () => { return this.pipeline._frame },
                    varianceGamma: () => { return this._varianceGamma },
                    jitterOffset: () => { return this._jitterOffset },
                    temporalAlpha: () => { return this._temporalAlpha },
                    historyValid: () => this._historyValid,
                    texelSize: () => { return this._texelSize },
                    inputBuffer: () => { return this._shadowBuffer },
                    historyBuffer: () => { return this._historyBuffer },
                },
                primitiveType: PrimitiveType.TRIANGLES
            }, shadowResolveMaterialVS);
        }
        if (!this._passState.framebuffer) {
            this._passState.viewport = new BoundingRectangle(0, 0, this.shadowMapSize.x, this.shadowMapSize.y);
            this._passState.framebuffer = new Framebuffer({
                context,
                colorTextures: [this._shadowLevel, this._shadowLevel2, this._shadowLevel3,
                    this._shadowVecLevel1, this._shadowVecLevel2, this._shadowVecLevel3],
                // Both framebuffers share attachments and rebind array layers during drawing.
                destroyAttachments: false,
            });
            this._passState2.viewport = new BoundingRectangle(0, 0, this.shadowMapSize.x, this.shadowMapSize.y);
            this._passState2.framebuffer = new Framebuffer({
                context,
                colorTextures: [this._shadowLevel, this._shadowLevel2, this._shadowLevel3],
                destroyAttachments: false,
            });
        }
    }


    invalidateHistory() {
        this._historyValid = false;
    }

    execute(context, colorTexture, depthTexture, idTexture) {

        const shadowMaps = this.shadowMaps;
        if (!this.csmCamera) {
            this.csmCamera = {};
            this.csmCamera.near = this.shadowNear;
            this.csmCamera.viewMatrix = new Matrix4();
            this.csmCamera.projectionMatrix = new Matrix4();
            this.csmCamera.inverseViewMatrix = new Matrix4();
            this.csmCamera.inverseProjectionMatrix = new Matrix4();
        }
        this.csmCamera.far = CesiumMath.clamp(this._scene.context.uniformState.currentFrustum.y, 100000, 200000);
        if (this._scene.camera.positionCartographic.height > 100000)
            this.csmCamera.far = 10;
        Matrix4.computeView(
            this._scene.camera.position,
            this._scene.camera.direction,
            this._scene.camera.up,
            this._scene.camera.right,
            this.csmCamera.viewMatrix);
        Matrix4.computePerspectiveFieldOfView(
            this._scene.camera.frustum.fov,
            this._scene.camera.frustum._aspectRatio,
            this.csmCamera.near, this.csmCamera.far,
            this.csmCamera.projectionMatrix);
        this.csmCamera.matrixWorld = { elements: Matrix4.inverse(this.csmCamera.viewMatrix, this.csmCamera.inverseViewMatrix) };
        this.csmCamera.projectionMatrixInverse = { elements: Matrix4.inverse(this.csmCamera.projectionMatrix, this.csmCamera.inverseProjectionMatrix) };


        const sunDirection = this._scene.context.uniformState.sunDirectionWC;
        // TODO: Position the sun on the top atmosphere sphere.
        // Increase light's distance to the target when the sun is at the horizon.
        const ellipsoid = Ellipsoid.WGS84;
        // 获取表面法线（单位向量）
        const surfaceNormal = ellipsoid.geodeticSurfaceNormal(this.pipeline.cameraPositionECEF, vector3Scratch);
        const zenithAngle = Cartesian3.dot(sunDirection, surfaceNormal)
        const distance = CesiumMath.lerp(1e6, 1e3, zenithAngle)
        shadowMaps.update(
            this.csmCamera,
            vector3Scratch.copy(sunDirection).applyMatrix4(this.pipeline.ellipsoidMatrix),
            distance
        )
        if (
            shadowMaps.cascadeCount !== this.shadowCascadeCount ||
            !shadowMaps.mapSize.equals(this.shadowMapSize)
        ) {
            const { width, height } = shadowMaps.mapSize
            const depth = shadowMaps.cascadeCount
            this.shadowMapSize.set(width, height)
            this.shadowCascadeCount = depth
        }

        for (let i = 0; i < this.shadowCascadeCount; ++i) {
            const cascade = this.shadowMaps.cascades[i]
            this.inverseShadowMatrices[i].copy(cascade.inverseMatrix.elements)
        }

        const frame = this.pipeline._frame % 16;
        const offset = bayerOffsets[frame]
        const dx2 = (offset.x - 0.5) * 4
        const dy2 = (offset.y - 0.5) * 4
        this._jitterOffset.set(dx2, dy2);

        const altitudeCorrection = this._altitudeCorrection;
        if (this.pipeline.correctAltitude) {
            getAltitudeCorrectionOffset(
                this.pipeline.cameraPositionECEF,
                this.pipeline.atmosphere.bottomRadius,
                this.pipeline.ellipsoid,
                altitudeCorrection,
                false
            )
        } else {
            Cartesian3.clone(Cartesian3.ZERO, altitudeCorrection);
        }
        const gl = this._scene.context._gl;
        if (this._passState.framebuffer && !this._passState.framebuffer.onBindEvent) {
            this._passState.framebuffer.onBindEvent = (buffers) => {
                for (let layer = 0; layer < 6; ++layer) {
                    gl.framebufferTextureLayer(
                        gl.FRAMEBUFFER,
                        buffers[layer],
                        this._shadowBuffer._texture,
                        0,
                        layer
                    )
                }
            }
            this._passState.framebuffer.onDrawEvent = (buffers) => {
                gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            }
        }

        installFramebufferCallbacks(this._passState.framebuffer);
        if (this._shadowDrawComomand)
            this._shadowDrawComomand.execute(this._scene.context, this._passState);

        // resolve
        if (this._passState2.framebuffer && !this._passState2.framebuffer.onBindEvent) {
            this._passState2.framebuffer.onBindEvent = (buffers) => {
                for (let layer = 0; layer < 3; ++layer) {
                    gl.framebufferTextureLayer(
                        gl.FRAMEBUFFER,
                        buffers[layer],
                        this._currentBuffer._texture,
                        0,
                        layer
                    )
                }
            }
            this._passState2.framebuffer.onDrawEvent = (buffers) => {
                gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            }
        }

        installFramebufferCallbacks(this._passState2.framebuffer);
        if (this._shadowResolveDrawComomand)
            this._shadowResolveDrawComomand.execute(this._scene.context, this._passState2);


        for (let i = 0; i < this.shadowCascadeCount; ++i) {
            const cascade = shadowMaps.cascades[i]
            this.reprojectionMatrices[i].copy(cascade.matrix.elements)
        }
        swapTextures(this._currentBuffer, this._historyBuffer);
        this._historyValid = true;
    }

    update(context, useLogDepth) {
        if (this._width !== this._scene.drawingBufferWidth ||
            this._height !== this._scene.drawingBufferHeight) this.init(true);
    }

    _releaseRenderTargets() {
        for (const passState of [this._passState, this._passState2]) {
            if (passState?.framebuffer) {
                passState.framebuffer.destroy();
                passState.framebuffer = undefined;
            }
        }
        for (const key of [
            "_shadowLevel", "_shadowLevel2", "_shadowLevel3",
            "_shadowVecLevel1", "_shadowVecLevel2", "_shadowVecLevel3",
            "_shadowBuffer", "_currentBuffer", "_historyBuffer",
        ]) {
            if (this[key]) {
                this[key].destroy();
                this[key] = undefined;
            }
        }
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._releaseRenderTargets();
        for (const command of [this._shadowDrawComomand, this._shadowResolveDrawComomand]) {
            if (command) command.shaderProgram = command.shaderProgram?.destroy();
        }
        this._shadowDrawComomand = undefined;
        this._shadowResolveDrawComomand = undefined;
        return destroyObject(this)
    }

    isDestroyed() {

        return this._destroyed;
    }
}

/**
 * 交换缓冲区 - 纹理
 * @param {*} texA 
 * @param {*} texB 
 */
function swapTextures(texA, texB) {
    const texAux = texA._texture;
    texA._texture = texB._texture;
    texB._texture = texAux;
};
