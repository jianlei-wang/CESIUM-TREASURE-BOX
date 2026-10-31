import { getCameraPosition } from "../internal/CesiumAdapter.js";
import { Cartesian2, Cartesian3, Cartesian4, Matrix4 } from "../internal/MathTypes.js";
import cloudsMaterialVertexShaderSource from "../shaders/geospatial/cloudsMaterial.vert.glsl?raw";
import cloudLayerDensityShaderSource from "../shaders/geospatial/cloudLayerDensity.glsl?raw";
import cloudsMaterialFragmentShaderSource from "../shaders/geospatial/cloudsMaterial.frag.glsl?raw";
import cloudsResolveMaterialVertexShaderSource from "../shaders/geospatial/cloudsResolveMaterial.vert.glsl?raw";
import cloudsResolveMaterialFragmentShaderSource from "../shaders/geospatial/cloudsResolveMaterial.frag.glsl?raw";
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
    ShaderSource,
    Math as CesiumMath,
 } from "cesium";
const defaultValue = (a, b) => a ?? b;
defaultValue.EMPTY_OBJECT = Object.freeze({});
import RenderPass from "../PostProcessStage.js";
import { installFramebufferCallbacks } from "../viewportQuadCommand.js";
import CascadedShadowMaps, { defaultsPass } from "./CascadedShadowMaps.js";
import { METER_TO_LENGTH_UNIT } from "./AtmosphereConstants.js";
export const cloudsMaterialVS = cloudsMaterialVertexShaderSource;
export const cloudLayerDensityGLSL = cloudLayerDensityShaderSource;
// Inject the same density implementation into cloud rendering and shadow tracing.
export const cloudsMaterialFS = cloudsMaterialFragmentShaderSource.replace("/*__CLOUD_LAYER_DENSITY__*/", cloudLayerDensityGLSL);
export const cloudsResolveMaterialVS = cloudsResolveMaterialVertexShaderSource;
export const cloudsResolveMaterialFS = cloudsResolveMaterialFragmentShaderSource;
let vector3Scratch = new Cartesian3;
let resolutionScratch = new Cartesian2;
const vectorScratch = ["x", "y", "z", "w"];
const entriesScratch = Array.from(
    { length: 8 },
    () => ({ value: 0, flag: 0 })
)
const intervalsScratch = Array.from(
    { length: 3 },
    () => ({ min: 0, max: 0 })
)
export default class CloudMaterialPass {

    constructor(scene, options = {}) {
        this._destroyed = false;

        this.id = createGuid();
        this._show = options.show ?? true;
        this._scene = scene;
        this.pipeline = options.pipeline;
        this._showTAA = false;
        this.minHeight = 750;
        this.maxHeight = 8000;
        this.albedo = new Cartesian3();
        this.altitudes = new Cartesian4(750, 1000, 7500, 0);
        this.heights = new Cartesian4(650, 1200, 500, 0);
        this.minLayerHeights = new Cartesian4(750, 1000, 7500, 0);
        this.maxLayerHeights = new Cartesian4(1400, 2200, 8000, 0);
        this.minIntervalHeights = new Cartesian3(0, 2200, 0);
        this.maxIntervalHeights = new Cartesian3(750, 7500, 0);
        this.densityScales = new Cartesian4(0.2000, 0.2000, 0.0030, 0.2000);
        this.shapeAmounts = new Cartesian4(1, 1, 0.4000, 1);
        this.shapeDetailAmounts = new Cartesian4(0.35, 0.35, 0, 1);
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
        this.temporalUpscale = true;
        this.inverseProjectionMatrix = new Matrix4();
        this.reprojectionMatrix = new Matrix4();
        this.temporalJitter = new Cartesian2();
        this.mipLevelScale = 1
        this.shapeTexelsPerMeterPerPixel = 0;
        this.layerTypes = new Cartesian4(0, 0, 0, 0);
        this.lodRange = new Cartesian2(200000, 500000);
        this.targetUvScale = new Cartesian2(1, 1);
        this.previousProjectionMatrix = new Matrix4();
        this.previousViewMatrix = new Matrix4();
        this._varianceGamma = 1.5;
        this._jitterOffset = new Cartesian2();
        this._temporalAlpha = 0.12;
        this._currentFrameAlpha = 0.35;
        this._motionAlpha = 0.9;
        this._activeTemporalAlpha = this._temporalAlpha;
        this._activeCurrentFrameAlpha = this._currentFrameAlpha;
        this._spatialFilterStrength = 0.35;
        this._historyValid = false;
        this._historyFrames = 0;
        this._previousCameraPosition = new Cartesian3();
        this._previousCameraDirection = new Cartesian3();
        this._previousCameraUp = new Cartesian3();
        this._previousSunDirection = new Cartesian3();
        this._previousFrustumProjection = new Matrix4();
        this._historyTextures = [];
        this._texelSize = new Cartesian2();
        // clouds
        this.inverseShadowMatrices = Array.from({ length: 4 }, () => new Matrix4())
        this.reprojectionMatrices = Array.from({ length: 4 }, () => new Matrix4())
        // Primary raymarch
        this.maxIterationCount = defaultsPass.clouds.maxIterationCount;
        this.minStepSize = defaultsPass.clouds.minStepSize;
        this.maxStepSize = defaultsPass.clouds.maxStepSize;
        this.minDensity = defaultsPass.clouds.minDensity;
        this.minExtinction = defaultsPass.clouds.minExtinction;
        this.minTransmittance = defaultsPass.clouds.minTransmittance;
        this.opticalDepthTailScale = 2;
        this.shadowCascadeCount = defaultsPass.shadow.cascadeCount;
        this.shadowMapSize = defaultsPass.shadow.mapSize;
        // 6.2
        this.hazeDensityScale = 0.0;
        this.hazeCloudAttached = false;
        this.hazeGroundDensityScale = 1;
        this.hazeViewDistance = 20000;
        this.hazeVolumeLength = 3000;
        this.hazeDirectLightScale = 1;
        this.hazeSunColor = new Cartesian3(1, 1, 1);
        this.hazeExponent = 0.001;
        this.hazeAnisotropy = 0.6;
        this.hazeSampleCount = 24;
        this.hazeShadowSampleCount = 2;
        this.hazeScatteringCoefficient = 0.9;
        this.hazeAbsorptionCoefficient = 0.5;
        // 5.30
        // this.skyIrradianceScale = 2.5;
        // this.groundIrradianceScale = 3;
        this.skyIrradianceScale = 1;
        this.groundIrradianceScale = 1;
        this.powderScale = 0.8;
        this.powderExponent = 150;
        this.maxRayDistance = defaultsPass.clouds.maxRayDistance;
        this.perspectiveStepScale = defaultsPass.clouds.perspectiveStepScale;

        this.maxIterationCountToSun = defaultsPass.clouds.maxIterationCountToSun;
        this.maxIterationCountToGround = defaultsPass.clouds.maxIterationCountToGround;
        this.minSecondaryStepSize = defaultsPass.clouds.minSecondaryStepSize;
        this.secondaryStepScale = defaultsPass.clouds.secondaryStepScale;

        this.shadowTexelSize = new Cartesian2();
        this.shadowIntervals = Array.from({ length: 4 }, () => new Cartesian2())
        this.shadowMatrices = Array.from({ length: 4 }, () => new Matrix4())
        this.shadowFar = 100000.;
        this.maxShadowFilterRadius = 6;
        this.maxShadowLengthIterationCount = defaultsPass.clouds.maxShadowLengthIterationCount;
        this.minShadowLengthStepSize = defaultsPass.clouds.minShadowLengthStepSize;
        this.maxShadowLengthRayDistance = defaultsPass.clouds.maxShadowLengthRayDistance;
        this._cloudsUniform = {

            shadowBuffer: () => { return this.shadowBuffer },
            shadowTexelSize: () => { return this.shadowTexelSize.set(1 / this.shadowMapSize.x, 1 / this.shadowMapSize.y) },
            shadowIntervals: () => { return this.shadowIntervals },
            shadowMatrices: () => { return this.shadowMatrices },
            shadowFar: () => { return this.shadowFar },
            maxShadowFilterRadius: () => { return this.maxShadowFilterRadius },

            maxShadowLengthIterationCount: () => { return this.maxShadowLengthIterationCount },
            minShadowLengthStepSize: () => { return this.minShadowLengthStepSize },
            maxShadowLengthRayDistance: () => { return this.maxShadowLengthRayDistance },

            maxIterationCountToSun: () => { return this.maxIterationCountToSun },
            maxIterationCountToGround: () => { return this.maxIterationCountToGround },
            minSecondaryStepSize: () => { return this.minSecondaryStepSize },
            secondaryStepScale: () => { return this.secondaryStepScale },

            albedo: () => { return this.albedo },
            hazeDensityScale: () => this.pipeline.volumetricLightOptions?.mode === "volumetric" ||
                this.pipeline.volumetricLightOptions?.mode === "off" ? 0.0 : this.hazeDensityScale,
            hazeCloudAttached: () => this.hazeCloudAttached,
            hazeGroundDensityScale: () => this.hazeGroundDensityScale,
            hazeViewDistance: () => this.hazeViewDistance,
            hazeVolumeLength: () => this.hazeVolumeLength,
            hazeDirectLightScale: () => this.hazeDirectLightScale,
            hazeSunColor: () => this.hazeSunColor,
            hazeExponent: () => { return this.hazeExponent },
            hazeAnisotropy: () => this.hazeAnisotropy,
            hazeSampleCount: () => this.hazeSampleCount,
            hazeShadowSampleCount: () => this.hazeShadowSampleCount,
            hazeScatteringCoefficient: () => { return this.hazeScatteringCoefficient },
            hazeAbsorptionCoefficient: () => { return this.hazeAbsorptionCoefficient },
            reprojectionMatrix: () => { return this.reprojectionMatrix },
            previousCameraPosition: () => this._previousCameraPosition,
            inverseProjectionMatrix: () => { return this.inverseProjectionMatrix },
            skyIrradianceScale: () => { return this.skyIrradianceScale },
            groundIrradianceScale: () => { return this.groundIrradianceScale },
            powderScale: () => { return this.powderScale },
            powderExponent: () => { return this.powderExponent },
            maxRayDistance: () => { return this.maxRayDistance },
            perspectiveStepScale: () => { return this.perspectiveStepScale },

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
            cloudLayerTypes: () => this.layerTypes,
            cloudLodRange: () => this.lodRange,
            turbulenceTexture: () => { return this.pipeline.turbulenceTexture },
            turbulenceRepeat: () => { return this.pipeline.turbulenceRepeat },
            turbulenceDisplacement: () => { return this.pipeline.turbulenceDisplacement },

            minLayerHeights: () => { return this.minLayerHeights },
            maxLayerHeights: () => { return this.maxLayerHeights },
            minIntervalHeights: () => { return this.minIntervalHeights },
            maxIntervalHeights: () => { return this.maxIntervalHeights },
            densityScales: () => { return this.densityScales },
            shapeAmounts: () => { return this.shapeAmounts },
            shapeDetailAmounts: () => { return this.shapeDetailAmounts },
            weatherExponents: () => { return this.weatherExponents },
            shapeAlteringBiases: () => { return this.shapeAlteringBiases },
            coverageFilterWidths: () => { return this.coverageFilterWidths },
            minHeight: () => { return this.minHeight },
            maxHeight: () => { return this.maxHeight },
            shadowTopHeight: () => { return this.shadowTopHeight },
            shadowBottomHeight: () => { return this.shadowBottomHeight },
            shadowLayerMask: () => { return this.shadowLayerMask },
            bottomRadius: () => { return this.pipeline.atmosphere.bottomRadius },
            topRadius: () => { return this.pipeline.atmosphere.topRadius },
            ellipsoidCenter: () => { return this.pipeline._ellipsoidCenter },
            ellipsoidMatrix: () => { return this.pipeline.ellipsoidMatrix },
            inverseEllipsoidMatrix: () => { return this.pipeline._inverseEllipsoidMatrix },
            altitudeCorrection: () => { return this.pipeline.shadowMaterialPass._altitudeCorrection },
            sunDirection: () => { return this._scene.context.uniformState.sunDirectionWC },
            "densityProfile.expTerms": () => { return this.expTerms; },
            "densityProfile.exponents": () => { return this.exponents; },
            "densityProfile.linearTerms": () => { return this.linearTerms; },
            "densityProfile.constantTerms": () => { return this.constantTerms; },


            // shadow
            inverseShadowMatrices: () => { return this.inverseShadowMatrices },
            reprojectionMatrices: () => { return this.reprojectionMatrices },
            resolution: () => { return this.pipeline._resolution },
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

            projectionMatrix: () => { return this._scene.context.uniformState.projection },
            viewMatrix: () => { return this._scene.context.uniformState.view },
            // projectionMatrix: () => { return this.pipeline.shadowMaterialPass.camera2.projectionMatrix },
            // viewMatrix: () => { return this.pipeline.shadowMaterialPass.camera2.viewMatrix },
            // inverseProjectionMatrix: () => { return this._scene.context.uniformState.inverseProjection },
            inverseViewMatrix: () => { return this._scene.context.uniformState.inverseView },
            cameraPosition: () => { return getCameraPosition(this._scene) },
            ellipsoidRadii: () => { return this.pipeline._ellipsoidRadii },
            u_solar_irradiance: () => { return this.pipeline.atmosphere.solarIrradiance },
            u_sun_angular_radius: () => { return this.pipeline.atmosphere.sunAngularRadius },
            u_bottom_radius: () => { return this.pipeline.atmosphere.bottomRadius * METER_TO_LENGTH_UNIT },
            u_top_radius: () => { return this.pipeline.atmosphere.topRadius * METER_TO_LENGTH_UNIT },
            u_rayleigh_scattering: () => { return this.pipeline.atmosphere.rayleighScattering },
            u_mie_scattering: () => { return this.pipeline.atmosphere.mieScattering },
            u_mie_phase_function_g: () => { return this.pipeline.atmosphere.miePhaseFunctionG },
            u_mu_s_min: () => { return this.pipeline.atmosphere.muSMin },
            u_irradiance_texture: () => { return this.pipeline._u_irradiance_texture },
            u_scattering_texture: () => { return this.pipeline._u_scattering_texture },
            u_single_mie_scattering_texture: () => { return this.pipeline._u_single_mie_scattering_texture },
            u_transmittance_texture: () => { return this.pipeline._u_transmittance_texture },
            depthBuffer: () => { return this.depthBuffer },
            cameraNear: () => { return this.pipeline.shadowMaterialPass.shadowNear },
            // cameraNear: () => { return this._scene.context.uniformState.currentFrustum.x },
            // cameraFar: () => { return this._scene.context.uniformState.currentFrustum.y },
            cameraHeight: () => { return this.pipeline.cameraHeight },
            temporalJitter: () => { return this.temporalJitter },
            targetUvScale: () => { return this.targetUvScale },
            mipLevelScale: () => { return this.mipLevelScale },
            shapeTexelsPerMeterPerPixel: () => this.shapeTexelsPerMeterPerPixel,
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

            this._defaultTexture = this._scene.defaultTexture;
            this._lowResWidth = Math.ceil(this._width / 4);
            this._lowResHeight = Math.ceil(this._height / 4);
            this._outputColor = new Texture({
                context: this._scene.context,
                width: this._lowResWidth,
                height: this._lowResHeight,
                pixelFormat: PixelFormat.RGBA,
                pixelDatatype: PixelDatatype.HALF_FLOAT,
                flipY: false,
            });
            this._depthVelocityBuffer = new Texture({
                context: this._scene.context,
                width: this._lowResWidth,
                height: this._lowResHeight,
                pixelFormat: PixelFormat.RGBA,
                // Cloud distances exceed the 65,504 m range of half-float storage.
                pixelDatatype: PixelDatatype.FLOAT,
                flipY: false,
            });
            this._shadowLengthBuffer = new Texture({
                context: this._scene.context,
                width: this._lowResWidth,
                height: this._lowResHeight,
                pixelFormat: PixelFormat.RED,
                pixelDatatype: PixelDatatype.HALF_FLOAT,
                flipY: false,
            });

            // Resolve
            this._cloudResolveBuffer = new Texture({
                context: this._scene.context,
                width: this._width,
                height: this._height,
                pixelFormat: PixelFormat.RGBA,
                pixelDatatype: PixelDatatype.HALF_FLOAT,
                flipY: false,
            });
            this._colorResolveHistoryBuffer = new Texture({
                context: this._scene.context,
                width: this._width,
                height: this._height,
                pixelFormat: PixelFormat.RGBA,
                pixelDatatype: PixelDatatype.HALF_FLOAT,
                flipY: false,
            });
            // Keep cloud depth aligned with the full-resolution color history.
            const cloudDepthSampler = new Sampler({
                minificationFilter: TextureMinificationFilter.NEAREST,
                magnificationFilter: TextureMagnificationFilter.NEAREST,
            });
            this._cloudResolveDepthBuffer = new Texture({
                context,
                width: this._width,
                height: this._height,
                pixelFormat: PixelFormat.RED,
                pixelDatatype: PixelDatatype.FLOAT,
                sampler: cloudDepthSampler,
                flipY: false,
            });
            this._cloudResolveDepthHistoryBuffer = new Texture({
                context,
                width: this._width,
                height: this._height,
                pixelFormat: PixelFormat.RED,
                pixelDatatype: PixelDatatype.FLOAT,
                sampler: cloudDepthSampler,
                flipY: false,
            });
            this._shadowResolveLengthBuffer = new Texture({
                context: this._scene.context,
                width: this._width,
                height: this._height,
                pixelFormat: PixelFormat.RED,
                pixelDatatype: PixelDatatype.HALF_FLOAT,
                flipY: false,
            });

            this._shadowResolveLengthHistoryBuffer = new Texture({
                context: this._scene.context,
                width: this._width,
                height: this._height,
                pixelFormat: PixelFormat.RED,
                pixelDatatype: PixelDatatype.HALF_FLOAT,
                flipY: false,
            });
            this.targetUvScale.set(this._lowResWidth * 4 / this._width, this._lowResHeight * 4 / this._height)
            this._texelSize.set(1 / this._width, 1 / this._height)
        }

        if (!this._cloudDrawComomand) {
            const cloudsMaterialShader = new ShaderSource({
                defines: ["LOG_DEPTH"],
                sources: [cloudsMaterialFS]
            });
            this._passState = new PassState(this._scene.context);
            this._cloudDrawComomand = this._scene.context.createViewportQuadCommand(cloudsMaterialShader, {
                uniformMap: this._cloudsUniform,
                primitiveType: PrimitiveType.TRIANGLES
            }, cloudsMaterialVS);
            const cloudsResolveMaterialShader = new ShaderSource({
                defines: ["LOG_DEPTH"],
                sources: [cloudsResolveMaterialFS]
            });
            this._passState2 = new PassState(this._scene.context);
            this._cloudResolveDrawComomand = this._scene.context.createViewportQuadCommand(cloudsResolveMaterialShader, {
                uniformMap: {
                    frame: () => { return this.pipeline._frame },
                    varianceGamma: () => { return this._varianceGamma },
                    jitterOffset: () => { return this._jitterOffset },
                    temporalAlpha: () => this._activeTemporalAlpha,
                    currentFrameAlpha: () => this._activeCurrentFrameAlpha,
                    spatialFilterStrength: () => this._spatialFilterStrength,
                    historyValid: () => this._historyValid,
                    cameraMoving: () => this._cameraMoving ?? false,
                    historyFrames: () => this._historyFrames,
                    depthHistoryBuffer: () => this._cloudResolveDepthHistoryBuffer,
                    sceneDepthBuffer: () => this.depthBuffer,
                    targetUvScale: () => this.targetUvScale,
                    texelSize: () => { return this._texelSize },
                    colorBuffer: () => {
                        return this._outputColor;
                    },
                    depthVelocityBuffer: () => {
                        return this._depthVelocityBuffer;
                    },
                    shadowLengthBuffer: () => {
                        return this._shadowLengthBuffer;
                    },
                    colorHistoryBuffer: () => {
                        return this._colorResolveHistoryBuffer;
                    },
                    shadowLengthHistoryBuffer: () => {
                        return this._shadowResolveLengthHistoryBuffer;
                    },
                },
                primitiveType: PrimitiveType.TRIANGLES
            }, cloudsResolveMaterialVS);
        }
        if (!this._passState.framebuffer) {
            this._passState.viewport = new BoundingRectangle(0, 0, this._lowResWidth, this._lowResHeight);
            this._passState.framebuffer = new Framebuffer({
                context,
                colorTextures: [this._outputColor, this._depthVelocityBuffer, this._shadowLengthBuffer],
                destroyAttachments: false,
            });
            this._passState2.viewport = new BoundingRectangle(0, 0, this._width, this._height);
            this._passState2.framebuffer = new Framebuffer({
                context: this._scene.context,
                colorTextures: [this._cloudResolveBuffer, this._shadowResolveLengthBuffer, this._cloudResolveDepthBuffer],
                destroyAttachments: false,
            })
        }
    }

    invalidateHistory() {
        this._historyValid = false;
        this._historyFrames = 0;
        this.pipeline.shadowMaterialPass?.invalidateHistory();
        this.pipeline.volumetricLightPass?.invalidateHistory();
    }

    _releaseRenderTargets() {
        for (const passState of [this._passState, this._passState2]) {
            if (passState && passState.framebuffer) {
                passState.framebuffer.destroy();
                passState.framebuffer = undefined;
            }
        }
        for (const key of [
            "_outputColor", "_depthVelocityBuffer", "_shadowLengthBuffer",
            "_cloudResolveBuffer", "_colorResolveHistoryBuffer",
            "_cloudResolveDepthBuffer", "_cloudResolveDepthHistoryBuffer",
            "_shadowResolveLengthBuffer", "_shadowResolveLengthHistoryBuffer",
        ]) {
            if (this[key]) {
                this[key].destroy();
                this[key] = undefined;
            }
        }
    }

    execute(context, colorTexture, depthTexture, idTexture) {

        const gl = this._scene.context._gl;
        if (this._width !== this._scene.drawingBufferWidth ||
            this._height !== this._scene.drawingBufferHeight
        ) {
            this.init(true);
        }

        // render cloud
        let totalMinHeight = Infinity;
        let totalMaxHeight = 0;
        let shadowBottomHeight = Infinity;
        let shadowTopHeight = 0;
        for (let i = 0; i < 3; ++i) {
            const axis = vectorScratch[i]; // 当前坐标轴

            // 原逻辑保持不变
            const altitude = this.altitudes[axis];
            const height = this.heights[axis];
            const shadow = this.shadowLayerMask[axis];
            const maxHeight = altitude + height;

            // 原有条件判断完全不变
            if (height > 0) {
                if (altitude < totalMinHeight) {
                    totalMinHeight = altitude;
                }
                if (shadow === 1 && altitude < shadowBottomHeight) {
                    shadowBottomHeight = altitude;
                }
                if (maxHeight > totalMaxHeight) {
                    totalMaxHeight = maxHeight;
                }
                if (shadow === 1 && maxHeight > shadowTopHeight) {
                    shadowTopHeight = maxHeight;
                }
            }
            if (this.minLayerHeights[axis] !== altitude || this.maxLayerHeights[axis] !== maxHeight) {
                this.pipeline.shadowMaterialPass.invalidateHistory();
            }
            this.minLayerHeights[axis] = altitude;
            this.maxLayerHeights[axis] = maxHeight;
        }
        if (totalMinHeight !== Infinity) {
            this.minHeight = totalMinHeight
            this.maxHeight = totalMaxHeight
        } else {
            this.minHeight = 0
        }
        if (shadowBottomHeight !== Infinity) {
            this.shadowBottomHeight = shadowBottomHeight
            this.shadowTopHeight = shadowTopHeight
        } else {
            this.shadowBottomHeight = 0
        }
        this.packIntervalHeights();

        const camera = this._scene.camera;
        const projection = camera.frustum.projectionMatrix;
        const cameraMoving = this._historyValid && (
            Cartesian3.distance(camera.positionWC, this._previousCameraPosition) > 0.5 ||
            Cartesian3.dot(camera.directionWC, this._previousCameraDirection) < 0.99999999 ||
            Cartesian3.dot(camera.upWC, this._previousCameraUp) < 0.99999999
        );
        // During motion, use fresh samples for both Bayer classes. Restore the
        // quieter stationary blend as soon as the camera stops.
        this._cameraMoving = cameraMoving;
        this._activeTemporalAlpha = cameraMoving
            ? Math.max(this._temporalAlpha, this._motionAlpha) : this._temporalAlpha;
        this._activeCurrentFrameAlpha = cameraMoving
            ? Math.max(this._currentFrameAlpha, this._motionAlpha) : this._currentFrameAlpha;
        const pixelsPerRadian = Math.max(1, Math.abs(projection[5]) * this._lowResHeight * 0.5);
        this.shapeTexelsPerMeterPerPixel = this.pipeline.shapeRepeat.x *
            this.pipeline.shapeTexture.width / pixelsPerRadian;
        const sunDirection = context.uniformState.sunDirectionWC;
        if (this._historyValid && (
            this._previousSceneMode !== this._scene.mode ||
            !Matrix4.equalsEpsilon(projection, this._previousFrustumProjection, 1e-6) ||
            Cartesian3.distance(camera.positionWC, this._previousCameraPosition) >
                Math.max(1000, Math.abs(this.pipeline.cameraHeight) * 0.5) ||
            Cartesian3.dot(camera.directionWC, this._previousCameraDirection) < 0.94 ||
            Cartesian3.dot(camera.upWC, this._previousCameraUp) < 0.94 ||
            Cartesian3.dot(sunDirection, this._previousSunDirection) < 0.9998
        )) {
            this.invalidateHistory();
        }
        const textures = [this.pipeline.localWeatherTexture, this.pipeline.shapeTexture,
            this.pipeline.shapeDetailTexture, this.pipeline.stbnTexture,
            this.pipeline._u_irradiance_texture, this.pipeline._u_scattering_texture,
            this.pipeline._u_transmittance_texture];
        if (textures.some((texture, index) => texture !== this._historyTextures[index])) {
            this.invalidateHistory();
            this._historyTextures = textures;
        }
        if (!this._historyValid) {
            Cartesian3.clone(camera.positionWC, this._previousCameraPosition);
            Matrix4.clone(context.uniformState.projection, this.previousProjectionMatrix);
            Matrix4.clone(context.uniformState.view, this.previousViewMatrix);
        }

        // copyCameraSettings
        const previousProjectionMatrix =
            this.previousProjectionMatrix ?? this._scene.context.uniformState.projection
        const previousViewMatrix =
            this.previousViewMatrix ?? this._scene.context.uniformState.view

        if (this.temporalUpscale) {
            const frame = this.pipeline._frame % 16
            const resolution = this.pipeline._resolution
            const offset = bayerOffsets[frame]
            const dx = ((offset.x - 0.5) / resolution.x) * 4
            const dy = ((offset.y - 0.5) / resolution.y) * 4
            this.temporalJitter.set(dx, dy)
            this.mipLevelScale = 0.25
            this.inverseProjectionMatrix.copy(this._scene.context.uniformState.projection)
            this.inverseProjectionMatrix[8] += dx * 2
            this.inverseProjectionMatrix[9] += dy * 2
            Matrix4.inverse(this.inverseProjectionMatrix, this.inverseProjectionMatrix);

            // Jitter the previous projection matrix with the current jitter.
            this.reprojectionMatrix.copy(previousProjectionMatrix)
            this.reprojectionMatrix[8] += dx * 2
            this.reprojectionMatrix[9] += dy * 2
            Matrix4.multiply(this.reprojectionMatrix, previousViewMatrix, this.reprojectionMatrix);

            const dx2 = (offset.x - 0.5) * 4
            const dy2 = (offset.y - 0.5) * 4
            this._jitterOffset.set(dx2, dy2);
        } else {
            Cartesian3.clone(Cartesian3.ZERO, this.temporalJitter);
            this.mipLevelScale = 1
            this.inverseProjectionMatrix.copy(this._scene.context.uniformState.projection)
            this.reprojectionMatrix.copy(previousProjectionMatrix);
            Matrix4.multiply(this.reprojectionMatrix, previousViewMatrix, this.reprojectionMatrix);
        }
        const albedo = this.pipeline.scatteringCoefficient / (this.pipeline.absorptionCoefficient + this.pipeline.scatteringCoefficient);
        this.albedo.set(albedo, albedo, albedo);


        this.depthBuffer = depthTexture;
        this.shadowBuffer = this.pipeline.shadowMaterialPass._historyBuffer;

        // copyShadow
        const shadow = this.pipeline.shadowMaterialPass.shadowMaps;
        for (let i = 0; i < shadow.cascadeCount; ++i) {
            const cascade = shadow.cascades[i]
            this.shadowIntervals[i].copy(cascade.interval)
            this.shadowMatrices[i].copy(cascade.matrix.elements)
        }
        this.shadowFar = shadow.far;

        // render
        if (this._passState.framebuffer && !this._passState.framebuffer.onDrawEvent) {
            this._passState.framebuffer.onDrawEvent = (buffers) => {
                gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            }
        }
        installFramebufferCallbacks(this._passState.framebuffer);
        if (this._cloudDrawComomand)
            this._cloudDrawComomand.execute(this._scene.context, this._passState);

        if (this._passState2.framebuffer && !this._passState2.framebuffer.onBindEvent) {
            this._passState2.framebuffer.onBindEvent = (buffers) => {
                gl.framebufferTexture2D(gl.FRAMEBUFFER,
                    buffers[0],
                    this._cloudResolveBuffer._target,
                    this._cloudResolveBuffer._texture, 0);
                gl.framebufferTexture2D(gl.FRAMEBUFFER,
                    buffers[1],
                    this._shadowResolveLengthBuffer._target,
                    this._shadowResolveLengthBuffer._texture, 0);
                gl.framebufferTexture2D(gl.FRAMEBUFFER,
                    buffers[2],
                    this._cloudResolveDepthBuffer._target,
                    this._cloudResolveDepthBuffer._texture, 0);
            }
            this._passState2.framebuffer.onDrawEvent = (buffers) => {
                gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            }
        }
        installFramebufferCallbacks(this._passState2.framebuffer);
        if (this._cloudResolveDrawComomand)
            this._cloudResolveDrawComomand.execute(this._scene.context, this._passState2);


        this.previousProjectionMatrix.copy(this._scene.context.uniformState.projection);
        this.previousViewMatrix.copy(this._scene.context.uniformState.view);

        swapTextures(this._cloudResolveBuffer, this._colorResolveHistoryBuffer);
        swapTextures(this._cloudResolveDepthBuffer, this._cloudResolveDepthHistoryBuffer);
        swapTextures(this._shadowResolveLengthBuffer, this._shadowResolveLengthHistoryBuffer);
        Cartesian3.clone(camera.positionWC, this._previousCameraPosition);
        Cartesian3.clone(camera.directionWC, this._previousCameraDirection);
        Cartesian3.clone(camera.upWC, this._previousCameraUp);
        Cartesian3.clone(sunDirection, this._previousSunDirection);
        Matrix4.clone(projection, this._previousFrustumProjection);
        this._previousSceneMode = this._scene.mode;
        this._historyValid = true;
        this._historyFrames = Math.min(this._historyFrames + 1, 64);
    }

    // 修正后的区间计算
    packIntervalHeights() {
        // 步骤 1: 填充 entriesScratch
        for (let i = 0; i < 4; ++i) {
            const axis = vectorScratch[i]; // 当前坐标轴
            const altitude = this.altitudes[axis];
            const height = this.heights[axis];
            let entry = {};
            entry.value = altitude;
            entry.flag = 0; // 起点标记
            entriesScratch[i] = entry;
            entry = {};
            entry.value = altitude + height;
            entry.flag = 1; // 终点标记
            entriesScratch[i + 4] = entry;
        }

        // 步骤 2: 按值排序
        entriesScratch.sort(compareEntries);

        // 步骤 3: 合并区间
        let intervalIndex = 0;
        let balance = 0;
        for (let entryIndex = 0; entryIndex < entriesScratch.length; entryIndex++) {
            const { value, flag } = entriesScratch[entryIndex];

            if (balance === 0 && entryIndex > 0) {
                if (intervalIndex >= 3) break; // 最多记录3个区间
                const interval = intervalsScratch[intervalIndex++];
                interval.min = entriesScratch[entryIndex - 1].value;
                interval.max = value;
            }
            balance += flag === 0 ? 1 : -1;
        }

        // 步骤 4: 绑定结果到 this
        this.minIntervalHeights.set(
            intervalsScratch[0].min,
            intervalsScratch[1].min,
            intervalsScratch[2].min
        );
        this.maxIntervalHeights.set(
            intervalsScratch[0].max,
            intervalsScratch[1].max,
            intervalsScratch[2].max
        );
    }
    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._releaseRenderTargets();
        for (const command of [this._cloudDrawComomand, this._cloudResolveDrawComomand]) {
            if (command) command.shaderProgram = command.shaderProgram?.destroy();
        }
        this._cloudDrawComomand = undefined;
        this._cloudResolveDrawComomand = undefined;
        return destroyObject(this)
    }

    isDestroyed() {

        return this._destroyed;
    }
}

function compareEntries(a, b) {
    return a.value !== b.value ? a.value - b.value : a.flag - b.flag
}
// prettier-ignore
export const bayerIndices = [
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5
];

export const bayerOffsets = /*#__PURE__*/ (() => {
    const offsets = new Array(16);

    // 预创建临时变量减少内存分配
    const tmp = new Cartesian2();

    // 使用反向映射优化查找效率
    const indexMap = new Map();
    bayerIndices.forEach((value, index) => {
        indexMap.set(value, index);
    });

    for (let order = 0; order < 16; order++) {
        const i = indexMap.get(order);
        Cartesian2.fromElements(
            ((i % 4) + 0.5) / 4,
            (Math.floor(i / 4) + 0.5) / 4,
            tmp
        );
        offsets[order] = Cartesian2.clone(tmp);
    }

    return offsets;
})();


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
