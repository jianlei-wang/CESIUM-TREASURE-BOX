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
    TextureWrap,
    BoundingRectangle,
    ShaderSource,
    JulianDate
 } from "cesium";
const defaultValue = (a, b) => a ?? b; // 官方 Cesium 不导出 defaultValue
defaultValue.EMPTY_OBJECT = Object.freeze({});
import { Cartesian2, Cartesian3, Cartesian4, Matrix4 } from "./internal/MathTypes.js";
import AssetManager from "./internal/AssetManager.js";
import { invalidateAssetBuffer, loadAssetBuffer } from "./internal/AssetCache.js";
import SceneStateLease from "./internal/SceneStateLease.js";
import { getWebGLContext, getCameraPosition, getStageIndex, restoreStageOrder } from "./internal/CesiumAdapter.js";
import { runCleanup } from "./internal/cleanup.js";
import Texture3D from "./Texture3D.js";
import { AerialPerspectiveEffectFS, AerialPerspectiveEffectVS } from "./geospatial/AerialPerspectiveEffect.js";
import { parseInt8Array, parseUint8Array } from "./geospatial/typedArrayParsers.js";
import { createData3DTextureLoaderClass } from "./geospatial/PrecomputedDataLoader.js";
import ShadowMaterialPass from "./geospatial/ShadowMaterialPass.js";
import CloudMaterialPass from "./geospatial/CloudsMaterialPass.js";
import FocusedCloudShadowPass from "./geospatial/FocusedCloudShadowPass.js";
import VolumetricLightPass, { volumetricLightCompositeGLSL } from "./geospatial/VolumetricLightPass.js";
import { downsampleThresholdMaterial, downsampleThresholdMaterialFS, downsampleThresholdMaterialVS } from "./geospatial/downsampleThresholdMaterial.js";
import { downsamplingMaterial } from "./geospatial/downsamplingMaterial.js";
import { upsamplingMaterial } from "./geospatial/upsamplingMaterial.js";
import { kawaseBlurMaterial } from "./geospatial/kawaseBlurMaterial.js";
import { copysamplingMaterial } from "./geospatial/copysamplingMaterial.js";
import { lensFlareFeaturesMaterial } from "./geospatial/lensFlareFeaturesMaterial.js";
import { applyBloomMaterial } from "./geospatial/applyBloomMaterial.js";
import AtmosphereParameters from "./geospatial/AtmosphereParameters.js";
import PrecomputedTexturesLoader from "./geospatial/PrecomputedTexturesLoader.js";
import RenderPass from "./PostProcessStage.js";
import geospatialPipelineDefaultDefines from "./shaders/postprocess/geospatialPipelineDefaults.glsl?raw";
import geospatialPipelineFragmentShader from "./shaders/postprocess/geospatialPipeline.frag.glsl?raw";

import {
    CLOUD_SHAPE_DETAIL_TEXTURE_SIZE,
    CLOUD_SHAPE_TEXTURE_SIZE,
    IRRADIANCE_TEXTURE_HEIGHT,
    IRRADIANCE_TEXTURE_WIDTH,
    METER_TO_LENGTH_UNIT,
    SCATTERING_TEXTURE_MU_S_SIZE,
    SCATTERING_TEXTURE_MU_SIZE,
    SCATTERING_TEXTURE_NU_SIZE,
    SCATTERING_TEXTURE_R_SIZE,
    STBN_TEXTURE_DEPTH,
    STBN_TEXTURE_HEIGHT,
    STBN_TEXTURE_WIDTH,
    TRANSMITTANCE_TEXTURE_HEIGHT,
    TRANSMITTANCE_TEXTURE_WIDTH
} from './geospatial/AtmosphereConstants.js';
import { 
    LinearFilter,
    NoColorSpace,
    NearestFilter,
    RedFormat,
    RepeatWrapping,
 } from "three";
// 缓存向量，避免频繁创建对象
const vectorScratch = new Cartesian3();
const vectorScratch2 = new Cartesian3();
const vector2Scratch = new Cartesian2();
const vector3Scratch = new Cartesian3();
function saturate(x) {
    return Math.min(Math.max(x, 0), 1)
}
function remap(value, inMin, inMax, outMin, outMax) {
    return outMin + ((value - inMin) * (outMax - outMin)) / (inMax - inMin);
}

// 复用临时变量
const normalScratch = new Cartesian3();
const scaledNormalScratch = new Cartesian3();
/**
 * 计算密贴球的球心位置
 * @param {Cartesian3} surfacePosition - 椭球表面上的某个位置
 * @param {number} radius - 沿地表法线方向向内偏移的距离
 * @param {Cartesian3} [result] - 用于接收输出的对象（可选）
 * @returns {Cartesian3} 球心位置
 */
export function getOsculatingSphereCenter(
    surfacePosition,
    radius,
    result = new Cartesian3()
) {
    const ellipsoid = Ellipsoid.WGS84;

    // 获取表面法线（单位向量）
    const normal = ellipsoid.geodeticSurfaceNormal(surfacePosition, normalScratch);

    // 法线方向乘以 -radius，表示向地心方向偏移
    const scaledNormal = Cartesian3.multiplyByScalar(normal, -radius, scaledNormalScratch);

    // 球心 = 表面点 + 偏移量
    return Cartesian3.add(surfacePosition, scaledNormal, result);
}

/**
 * 计算海拔修正偏移
 * @param {Cartesian3} cameraPosition - 相机位置
 * @param {number} bottomRadius - 球体半径（例如大气层内球）
 * @param {Ellipsoid} ellipsoid - 使用的椭球体，默认 WGS84
 * @param {Cartesian3} result - 用于接收输出的对象
 * @param {boolean} clipToSurface - 是否限制只能在地表上修正（默认 true）
 * @returns {Cartesian3} 偏移后的位置
 */
export function getAltitudeCorrectionOffset(
    cameraPosition,
    bottomRadius,
    ellipsoid = Ellipsoid.WGS84,
    result = new Cartesian3(),
    clipToSurface = true
) {
    // 将相机投影到地表
    const surfacePosition = ellipsoid.scaleToGeodeticSurface(cameraPosition, vectorScratch);

    if (!surfacePosition) {
        // 如果相机在地心或椭球内不合法位置，返回零向量
        return Cartesian3.clone(Cartesian3.ZERO, result);
    }

    // 判断使用哪个点计算球心（如果不 clip 或 相机低于地表，就用 surface）
    const useSurface =
        !clipToSurface ||
            Cartesian3.magnitudeSquared(surfacePosition) < Cartesian3.magnitudeSquared(cameraPosition)
            ? surfacePosition
            : cameraPosition;
    return getOsculatingSphereCenter(useSurface, bottomRadius, result);
}

// 默认配置（注意：JS 中没有 satisfies 检查，这里仅保留默认值对象）
export const aerialPerspectiveEffectOptionsDefaults = {
    // blendFunction: BlendFunction.NORMAL,
    octEncodedNormal: false,
    reconstructNormal: false,
    ellipsoid: Ellipsoid.WGS84,
    correctAltitude: true,
    correctGeometricError: true,
    photometric: true,
    sunIrradiance: false,
    skyIrradiance: false,
    transmittance: true,
    inscatter: true,
    irradianceScale: 1,
    sky: false,
    sun: true,
    moon: true,
    moonAngularRadius: 0.0045, // ≈ 15.5 arcminutes
    lunarRadianceScale: 1
}

let scratchIcrfToFixed = new Matrix3();
let scratchPoint3 = new Cartesian3();
const transformMatrix = new Matrix3();
const scratchJulianDate = new JulianDate();
const scratchFieldColor = new Cartesian4(0, 0, 0, 0);
export default class GeospatialPipelinePass {

    constructor(scene, options, atmosphere = AtmosphereParameters.DEFAULT) {
        // 合并默认参数与传入的参数
        const {
            blendFunction,
            normalBuffer = null,
            octEncodedNormal,
            reconstructNormal,
            irradianceTexture = null,
            scatteringTexture = null,
            transmittanceTexture = null,
            ellipsoid = Ellipsoid.WGS84,
            correctAltitude,
            correctGeometricError,
            photometric,
            sunDirection,
            sunIrradiance,
            skyIrradiance,
            transmittance,
            inscatter,
            irradianceScale,
            sky,
            sun,
            moon,
            moonDirection,
            moonAngularRadius,
            lunarRadianceScale
        } = {
            ...aerialPerspectiveEffectOptionsDefaults,
            ...options
        }
        this._scene = scene;
        this._destroyed = false;
        // Track only textures allocated by this pass; uniforms may also reference host textures.
        this._ownedTextures = new Set();
        this._assets = new AssetManager({ onError: ({ error }) => console.error(error) });
        try {
        this.id = createGuid();
        this._showTAA = false;
        this._show = options.show ?? true;
        this._showSSR = options.showSSR ?? true;
        this._showFields = options.showFields ?? false;
        this._showTranslucent = options.showTranslucent ?? true;
        this._showGSMask = options.showGSMask ?? false;
        this._sunCull = options.sunCull ?? false;
        this._showDrakLight = options.showDrakLight ?? true;
        this._showRain = options.showRain ?? false;
        this._showSnow = options.showSnow ?? false;

        this._resolution = new Cartesian3(0, 0, 1);
        this._sunPosPC = new Cartesian2(0, 0);
        this._moonPosPC = new Cartesian2(0, 0);
        this._globeNormal = new Cartesian3(0, 0, 0);
        this._moonPositionWC = new Cartesian3(0, 0, 0)
        this._time = 0;
        this._dynamicPlanet = true;
        this._planetRadius = 6360000.0;
        this._defaultTexture3D = new Texture3D({
            context: this._scene.context,
            width: 1,
            height: 1,
            depth: 1,
            source: {
                width: 1,
                height: 1,
                depth: 1,
                arrayBufferView: new Uint8Array([255, 255, 255, 255])
            },
            flipY: false
        });
        this._ownedTextures.add(this._defaultTexture3D);
        this._u_irradiance_texture = this._scene.context.defaultTexture;
        this._u_scattering_texture = this._defaultTexture3D;
        this._u_single_mie_scattering_texture = this._defaultTexture3D;
        this._u_transmittance_texture = this._scene.context.defaultTexture;
        this.localWeatherTexture = this._scene.context.defaultTexture;
        this.cameraHeight = 0.;
        this.toneMappingExposure = 10;
        this.whitePoint = 1.;
        this.middleGrey = 0.6
        this.averageLuminance = 0.01;
        this._toneMappingMode = 7;
        // cloud and shadow
        this.coverage = 0.3;
        this.cloudAltitudeFadeRange = null;
        this.cloudVisibility = 1;
        this.effectiveCloudCoverage = this.coverage;
        this.turbulenceTexture = this._scene.context.defaultTexture;
        this.shapeTexture = this._defaultTexture3D;
        this.shapeDetailTexture = this._defaultTexture3D;
        this.stbnTexture = this._defaultTexture3D;
        this.localWeatherRepeat = new Cartesian2(100, 100);
        this.localWeatherOffset = new Cartesian2(0.0, 0.0);
        this.shapeRepeat = new Cartesian3(0.0003, 0.0003, 0.0003);
        this.shapeOffset = new Cartesian3(0.0, 0.0, 0.0);
        this.shapeDetailRepeat = new Cartesian3(0.006, 0.006, 0.006);
        this.shapeDetailOffset = new Cartesian3(0.0, 0.0, 0.0);
        this.turbulenceRepeat = new Cartesian2(20, 20);
        this.localWeatherVelocity = new Cartesian2(0.001, 0.0)
        this.shapeVelocity = new Cartesian3()
        this.shapeDetailVelocity = new Cartesian3()
        this.turbulenceDisplacement = 350;
        this.scatteringCoefficient = 1;
        this.absorptionCoefficient = 0;
        this._snowCoverParam = new Cartesian4(0.5, 100., 10, -999.); // 范围 厚度 密度
        this._weatherParam = new Cartesian4(10.0, 0.0, 0.01, 60.0); // 雨水流 下雨 雨量 雨速
        this._weatherParam2 = new Cartesian4(1.0, 0.02, 0, 0); // 屏幕雨 涟漪强度
        this._bottomRadius = atmosphere.bottomRadius;
        this._ellipsoidRadii = new Cartesian3();
        this._ellipsoidCenter = new Cartesian3();
        this._inverseEllipsoidMatrix = new Matrix4();
        this._altitudeCorrection = new Cartesian3();
        this._sunDirection = sunDirection?.clone() ?? new Cartesian3();
        this._irradianceScale = irradianceScale;
        this.aerialPerspectiveStrength = 1;
        this._idealSphereAlpha = 0;
        this._moonPositionWC = new Cartesian3();
        this._moonDirection = moonDirection?.clone() ?? new Cartesian3();
        this._moonAngularRadius = moonAngularRadius;
        this._lunarRadianceScale = lunarRadianceScale;
        this._ghostAmount = 0.002;
        this._haloAmount = 0.005;
        this._chromaticAberration = 10;
        this._thresholdLevel = 10;
        this._thresholdRange = 1;
        this._bloomBlendOpacity = 1;
        this._bloomIntensity = 0.008;
        // Composition and shadow
        this._overlayBuffer = null;
        this._shadowBuffer = null;
        this._shadowMapSize = new Cartesian3();
        this._shadowIntervals = [];
        this._shadowMatrices = [];
        this._inverseShadowMatrices = [];
        this._shadowFar = 0;
        this._shadowTopHeight = 0;
        this._shadowRadius = 3;
        this._frame = 0;
        this._shadowLengthBuffer = null;
        // Uniforms for atmosphere functions
        this._u_solar_irradiance = atmosphere.solarIrradiance;
        this._u_sun_angular_radius = atmosphere.sunAngularRadius;
        this._u_bottom_radius = atmosphere.bottomRadius * METER_TO_LENGTH_UNIT;
        this._u_top_radius = atmosphere.topRadius * METER_TO_LENGTH_UNIT;
        this._u_rayleigh_scattering = atmosphere.rayleighScattering;
        this._u_mie_scattering = atmosphere.mieScattering;
        this._u_mie_phase_function_g = atmosphere.miePhaseFunctionG;
        this._u_mu_s_min = atmosphere.muSMin;
        this._u_max_rayleigh_shadow_length = 10000 * METER_TO_LENGTH_UNIT;

        this._systemLight = defaultValue(options.systemLight, true);
        this._scene.context.uniformState.sunPositionWC2 = new Cartesian3(57848520396.59603, 134403446914.8757, -22823453895.737892);
        this._scene.context.uniformState.sunDirectionWC2 = new Cartesian3(0.39062193129550293, 0.9075588043864757, -0.15411529246496697);
        this._ellipsoidRadii = ellipsoid.radii;
        this._ellipsoidCenter = new Cartesian3();
        this._altitudeCorrection = new Cartesian3();
        this._inverseEllipsoidMatrix = new Matrix4();
        // strength roughnessFactor reflectionSpecularFalloffExponent
        this._ssrParam = new Cartesian4(1, 0.01, 2, 0.);
        this._customDarkParam = new Cartesian4(10, 0.1, 0, 0.);
        let shadowResolutionScratch = new Cartesian2();
        this.aerialPerspectiveUniforms = {
            // 官方 Cesium 无 GBuffer 法线/位置贴图：法线退化为默认贴图（地表光照近似），
            // 位置在着色器中由深度重建（czm_windowToEyeCoordinates），这里仅占位避免空引用。
            normalBuffer: () => {
                return this._scene.context.defaultTexture;
            },
            positionTexture: () => {
                return this._scene.context.defaultTexture;
            },
            projectionMatrix: () => { return this._scene.context.uniformState.projection },
            viewMatrix: () => { return this._scene.context.uniformState.view },
            inverseProjectionMatrix: () => { return this._scene.context.uniformState.inverseProjection },
            inverseViewMatrix: () => { return this._scene.context.uniformState.inverseView },
            cameraPosition: () => { return getCameraPosition(this._scene) },
            bottomRadius: () => { return atmosphere.bottomRadius },
            ellipsoidRadii: () => { return this._ellipsoidRadii },
            ellipsoidCenter: () => { return this._ellipsoidCenter },
            inverseEllipsoidMatrix: () => { return this._inverseEllipsoidMatrix },
            altitudeCorrection: () => { return this._altitudeCorrection },
            sunDirection: () => {
                if (this._systemLight) {
                    return this._scene.context.uniformState.sunDirectionWC;
                }
                return this._scene.context.uniformState.sunDirectionWC2;
            },
            irradianceScale: () => { return this._irradianceScale },
            aerialPerspectiveStrength: () => this.aerialPerspectiveStrength,
            cloudVisibility: () => this.cloudVisibility,
            idealSphereAlpha: () => { return this._idealSphereAlpha },
            moonDirection: () => { return this._scene.context.uniformState.moonDirectionEC },
            moonAngularRadius: () => { return this._moonAngularRadius },
            lunarRadianceScale: () => { return this._lunarRadianceScale },
            // Composition and shadow
            shadowLengthBuffer: () => { return this.cloudMaterialPass._shadowResolveLengthHistoryBuffer },
            shadowBuffer: () => { return this.shadowMaterialPass._historyBuffer },
            shadowMapSize: () => { return shadowResolutionScratch.set(this.shadowMaterialPass.shadowMapSize.x, this.shadowMaterialPass.shadowMapSize.y) },
            shadowIntervals: () => { return this.cloudMaterialPass.shadowIntervals },
            shadowMatrices: () => { return this.cloudMaterialPass.shadowMatrices },
            inverseShadowMatrices: () => { return this.shadowMaterialPass.inverseShadowMatrices },
            reprojectionMatrices: () => { return this.shadowMaterialPass.reprojectionMatrices },
            shadowFar: () => { return this.cloudMaterialPass.shadowFar },
            maxShadowFilterRadius: () => { return this.cloudMaterialPass.maxShadowFilterRadius },
            shadowTopHeight: () => { return this.shadowMaterialPass.shadowTopHeight },
            shadowRadius: () => { return this._shadowRadius },
            stbnTexture: () => { return this.stbnTexture },
            frame: () => { return this._frame },
            // Uniforms for atmosphere functions
            u_solar_irradiance: () => { return atmosphere.solarIrradiance },
            u_sun_angular_radius: () => { return atmosphere.sunAngularRadius },
            u_bottom_radius: () => { return atmosphere.bottomRadius * METER_TO_LENGTH_UNIT },
            u_top_radius: () => { return atmosphere.topRadius * METER_TO_LENGTH_UNIT },
            u_rayleigh_scattering: () => { return atmosphere.rayleighScattering },
            u_mie_scattering: () => { return atmosphere.mieScattering },
            u_mie_phase_function_g: () => { return atmosphere.miePhaseFunctionG },
            u_mu_s_min: () => { return atmosphere.muSMin },
            u_max_rayleigh_shadow_length: () => { return this._u_max_rayleigh_shadow_length },
            u_irradiance_texture: () => { return this._u_irradiance_texture },
            u_scattering_texture: () => { return this._u_scattering_texture },
            u_single_mie_scattering_texture: () => { return this._u_single_mie_scattering_texture },
            u_transmittance_texture: () => { return this._u_transmittance_texture },
            u_customDarkParam: () => { return this._customDarkParam; },
            cameraNear: () => { return this.shadowMaterialPass.shadowNear },
            overlayBuffer: () => { return this.cloudMaterialPass._colorResolveHistoryBuffer },
            resolution: () => { return shadowResolutionScratch.set(this._resolution.x, this._resolution.y) },
            globeNormal: () => { return this._globeNormal },
            cameraHeight: () => { return this.cameraHeight },
            depthTexture: () => { return this._depthTexture },
            colorTexture: () => { return this._colorTexture },
            snowCoverParam: () => { return this._snowCoverParam },
            snowCoverMaskMap: () => { return this._snowCoverMaskMap; },
            weatherParam: () => { return this._weatherParam },
            weatherParam2: () => { return this._weatherParam2 },
        }
        // 直接赋值、删除装饰器语法
        this.octEncodedNormal = octEncodedNormal
        this.reconstructNormal = reconstructNormal
        this.ellipsoid = ellipsoid
        this.correctAltitude = correctAltitude
        this.correctGeometricError = correctGeometricError
        this.photometric = photometric
        this.sunIrradiance = sunIrradiance
        this.skyIrradiance = skyIrradiance
        this.transmittance = transmittance
        this.inscatter = inscatter
        this.sky = sky
        this.sun = sun
        this.moon = moon

        this.camera = this._scene.camera;
        this.atmosphere = atmosphere;

        // 内部属性
        this.ellipsoidMatrix = Matrix4.clone(Matrix4.IDENTITY)
        this.overlay = null
        this.shadow = null
        this.shadowLength = null
        this._isPrecomputed = false;
        this.time = Date.now();
        this.lastFrameTime = this.time;
        this.frameTime = 0;
        this.shadowMaterialPass = new ShadowMaterialPass(scene, {
            show: true,
            pipeline: this
        })
        this.cloudMaterialPass = new CloudMaterialPass(scene, {
            show: true,
            pipeline: this
        })
        // Standalone callers keep legacy haze until the public pipeline selects a mode.
        this.volumetricLightOptions = { mode: "legacy" };
        this.focusedCloudShadowPass = new FocusedCloudShadowPass(scene, { pipeline: this });
        this.volumetricLightPass = new VolumetricLightPass(scene, {
            pipeline: this,
            shadowPass: this.focusedCloudShadowPass,
        });
        Object.assign(this.aerialPerspectiveUniforms, this.volumetricLightPass.uniformMap);
        this.aerialPerspectiveUniforms.u_volumetricLightEnabled = () =>
            this.volumetricLightOptions.mode === "volumetric" && this.cloudVisibility > 0 &&
            this.volumetricLightPass.ready;
        this.init();
        } catch (error) {
            // A throwing constructor never reaches the public wrapper assignment.
            // Release its partial allocations here so the wrapper can retry safely.
            try { this.destroy(); } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], "Pipeline initialization and cleanup failed");
            }
            throw error;
        }
    }

    setVolumetricLightOptions(options) {
        const previousMode = this.volumetricLightOptions.mode;
        this.volumetricLightOptions = { ...this.volumetricLightOptions, ...options };
        this.volumetricLightPass.setOptions(this.volumetricLightOptions);
        if (this.volumetricLightOptions.mode !== "volumetric") {
            this.focusedCloudShadowPass.releaseResources();
        }
        if (previousMode !== this.volumetricLightOptions.mode) {
            this.cloudMaterialPass.invalidateHistory();
        }
    }

    set toneMappingMode(mode) {
        if (mode === this._toneMappingMode) return;
        this._toneMappingMode = mode;
        this.init(true);
    }
    set showSSR(mode) {
        this._showSSR = mode;
        this.init(true);
    }
    set showDrakLight(mode) {
        this._showDrakLight = mode;
        this.init(true);
        // 更新云
        this.cloudMaterialPass && this.cloudMaterialPass.init(true)
    }
    set showSnow(mode) {
        if (mode === this._showSnow) return;
        this._showSnow = mode;
        this.init(true);
    }
    set showRain(mode) {
        if (mode === this._showRain) return;
        this._showRain = mode;
        this.init(true);
        // 更新云
        this.cloudMaterialPass && this.cloudMaterialPass.init(true)
    }

    set sunCull(mode) {
        this._sunCull = mode;
        this.init(true);
        // 更新云
        this.cloudMaterialPass && this.cloudMaterialPass.init(true)
    }

    init(isUpdate = false) {
        if (this._destroyed) return;

        let stageIndex;
        if (isUpdate && defined(this._stage)) {
            const pps = this._scene.postProcessStages;
            if (typeof pps.contains === "function" && pps.contains(this._stage)) {
                stageIndex = getStageIndex(this._stage);
                pps.remove(this._stage); // remove() 内部会销毁该 stage
            } else if (!this._stage.isDestroyed()) {
                this._stage.destroy();
            }
            this._stage = undefined;
        }

        // 创建渲染程序
        if (defined(this._stage)) {
            return false;
        }
        // These resources are outside the composite and must be released on every rebuild.
        this._releaseThresholdResources();
        const context = this._scene.context;
        let defines = geospatialPipelineDefaultDefines.replace("__GS_MASK_DEFINE__", this._showGSMask ? "#define HAS_GS_MASK" : "");
        this._showSSR && (defines += `#define ENABLE_SSR\n`);
        this._showFields && (defines += `#define ENABLE_FIELDS\n`);
        this._sunCull && (defines += `#define SUNLIGHT_CULL\n`);
        this._showDrakLight && (defines += `#define DARKLIGHT\n`);
        this._showSnow && (defines += `#define ENABLE_SNOWEFFECT\n`);
        this._showRain && (defines += `#define ENABLE_THUNDERCLOUDS\n`);

        defines += '#define TRANSMITTANCE_TEXTURE_WIDTH ' + TRANSMITTANCE_TEXTURE_WIDTH.toFixed(0) + '\n';
        defines += '#define TRANSMITTANCE_TEXTURE_HEIGHT ' + TRANSMITTANCE_TEXTURE_HEIGHT.toFixed(0) + '\n';
        defines += '#define SCATTERING_TEXTURE_R_SIZE ' + SCATTERING_TEXTURE_R_SIZE.toFixed(0) + '\n';
        defines += '#define SCATTERING_TEXTURE_MU_SIZE ' + SCATTERING_TEXTURE_MU_SIZE.toFixed(0) + '\n';
        defines += '#define SCATTERING_TEXTURE_MU_S_SIZE ' + SCATTERING_TEXTURE_MU_S_SIZE.toFixed(0) + '\n';
        defines += '#define SCATTERING_TEXTURE_NU_SIZE ' + SCATTERING_TEXTURE_NU_SIZE.toFixed(0) + '\n';
        defines += '#define IRRADIANCE_TEXTURE_WIDTH ' + IRRADIANCE_TEXTURE_WIDTH.toFixed(0) + '\n';
        defines += '#define IRRADIANCE_TEXTURE_HEIGHT ' + IRRADIANCE_TEXTURE_HEIGHT.toFixed(0) + '\n';
        defines += '#define METER_TO_LENGTH_UNIT ' + METER_TO_LENGTH_UNIT.toFixed(7) + '\n';
        defines += '#define SUN_SPECTRAL_RADIANCE_TO_LUMINANCE ' + `vec3(${this.atmosphere.sunRadianceToRelativeLuminance.toArray().map(v => v.toFixed(12)).join(',')})` + '\n';
        defines += '#define SKY_SPECTRAL_RADIANCE_TO_LUMINANCE ' + `vec3(${this.atmosphere.skyRadianceToRelativeLuminance.toArray().map(v => v.toFixed(12)).join(',')})` + '\n';

        // 预处理gbuffer定义
        if (context.renderGBuffer) {
            if (context.renderGBufferTexture) {
                defines += `#define HAS_M3D_GUFFER_TEXTURE\n`;
            }
            if (context.renderGBufferTexture2) {
                defines += `#define HAS_M3D_GUFFER_TEXTURE2\n`;
            }
        }


        if (this._width !== this._scene.drawingBufferWidth ||
            this._height !== this._scene.drawingBufferHeight
        ) {
            this._width = this._scene.drawingBufferWidth;
            this._height = this._scene.drawingBufferHeight;

            this._releaseAerialRenderTarget();
            if (!this._passState) {
                this._passState = new PassState(this._scene.context);
            }
            this._aerialPerspectiveOutputColor = new Texture({
                context: this._scene.context,
                width: this._width,
                height: this._height,
                pixelFormat: PixelFormat.RGBA,
                pixelDatatype: PixelDatatype.HALF_FLOAT,
                flipY: false,
            });
            this._passState.viewport = new BoundingRectangle(0, 0, this._width, this._height);
            this._passState.framebuffer = new Framebuffer({
                context: this._scene.context,
                colorTextures: [this._aerialPerspectiveOutputColor],
                destroyAttachments: false,
            })
        }
        if (!this._snowCoverMaskMap && this._showSnow) {
            this._registerSnowAsset();
            this._assets.start(["snow"]);
        }
        const gl = getWebGLContext(this._scene.context);
        if (this._aerialPerspectiveComoman) {
            this._aerialPerspectiveComoman.shaderProgram = this._aerialPerspectiveComoman.shaderProgram?.destroy();
        }
        const AerialPerspectiveEffectShader = new ShaderSource({
            defines: ["LOG_DEPTH"],
            sources: [defines + "\n" + AerialPerspectiveEffectFS.replace("/*__VOLUMETRIC_LIGHT_COMPOSITE__*/", volumetricLightCompositeGLSL)]
        });
        this._aerialPerspectiveComoman = this._scene.context.createViewportQuadCommand(AerialPerspectiveEffectShader, {
            uniformMap: this.aerialPerspectiveUniforms,
            primitiveType: PrimitiveType.TRIANGLES
        }, defines + "\n" + AerialPerspectiveEffectVS);

        // 降采样
        let textureScale = 1;
        let width = this._width;
        let height = this._height;
        let preDownSamples;
        this._iterations = 8;
        this._downSamplesMap = [];
        for (let i = 0; i <= this._iterations; i++) {
            textureScale /= 2;
            let downSamples;
            let resolution = new Cartesian2(1 / width, 1 / height);
            if (i == 0) {
                const downsampleThresholdMaterialShader = new ShaderSource({
                    defines: ["LOG_DEPTH"],
                    sources: [downsampleThresholdMaterialFS]
                });
                this._downsampleThresholdPassState = new PassState(this._scene.context);
                this._downsampleThresholdBuffer = new Texture({
                    context: this._scene.context,
                    width: width * textureScale,
                    height: height * textureScale,
                    pixelFormat: PixelFormat.RGBA,
                    pixelDatatype: PixelDatatype.HALF_FLOAT,
                    flipY: false,
                });
                this._downsampleThresholdPassState.viewport = new BoundingRectangle(0, 0, width * textureScale, height * textureScale);
                this._downsampleThresholdPassState.framebuffer = new Framebuffer({
                    context: this._scene.context,
                    colorTextures: [this._downsampleThresholdBuffer],
                    destroyAttachments: false,
                })
                this.downsampleThresholdDrawComomand = this._scene.context.createViewportQuadCommand(downsampleThresholdMaterialShader, {
                    uniformMap: {
                        inputBuffer: () => {
                            return that._aerialPerspectiveOutputColor;
                        },
                        texelSize: () => {
                            return resolution
                        },
                        thresholdLevel: () => {
                            return that._thresholdLevel;
                        },
                        thresholdRange: () => {
                            return that._thresholdRange;
                        },
                    },
                    primitiveType: PrimitiveType.TRIANGLES
                }, downsampleThresholdMaterialVS);
            } else {
                if (i == 1) {
                    downSamples = downsamplingMaterial(i, this._downsampleThresholdBuffer, textureScale, resolution, false);
                    preDownSamples = downSamples;
                } else {
                    downSamples = downsamplingMaterial(i, this._downSamplesMap[this._downSamplesMap.length - 1], textureScale, resolution, true);
                }
            }
            if (downSamples)
                this._downSamplesMap.push(downSamples);
            width = Math.max(width / 2, 1);
            height = Math.max(height / 2, 1);
        }

        // 升采样
        this._upSamplesMap = [];
        let _Samples = this._downSamplesMap[this._iterations - 1];
        for (let n = this._iterations - 2; n >= 0; n--) {
            textureScale *= 2;
            const downSamples = this._downSamplesMap[n];
            let resolution = new Cartesian2(1 / width, 1 / height);
            const upSamples = upsamplingMaterial(n, _Samples, downSamples, textureScale, resolution);
            this._upSamplesMap.push(upSamples);
            _Samples = upSamples;
            width = Math.max(width * 2, 1);
            height = Math.max(height * 2, 1);
        }
        // hdr镜头光
        const wx = 1 / this._width * .5;
        const hy = 1 / this._height * .5;
        const texSize = new Cartesian4(wx, hy, wx * .5, hy * .5);
        const kawaseBlur = kawaseBlurMaterial(0, this._downsampleThresholdBuffer, 1 / 4, texSize, 0, 1, false);
        const kawaseBlur2 = kawaseBlurMaterial(1, kawaseBlur, 1 / 4, texSize, 1, 1, true);
        const kawaseBlur3 = kawaseBlurMaterial(2, kawaseBlur2, 1 / 4, texSize, 1, 1, true);
        const copysampling = copysamplingMaterial(0, kawaseBlur3, 0.5, 1);
        const lensFlareFeatures = lensFlareFeaturesMaterial(0, copysampling, 0.5, new Cartesian2(wx, hy), this);
        const applyBloomStage = applyBloomMaterial(
            this._upSamplesMap[this._upSamplesMap.length - 1], lensFlareFeatures, this);
        this._renderAtmospherePass = new RenderPass({
            name: "czm_geospatialPipelinePass",
            fragmentShader: defines + geospatialPipelineFragmentShader.replace("__TONE_MAPPING_MODE__", () => this._toneMappingMode),
            uniforms: {
                inputBuffer: applyBloomStage.name,
                cameraHeight: () => { return this.cameraHeight },
                toneMappingExposure: () => { return this.toneMappingExposure },
                WhitePoint: () => { return this.whitePoint },
                MiddleGrey: () => { return this.middleGrey },
                AverageLuminance: () => { return this.averageLuminance },
                sunPositionWC: () => {
                    if (this._systemLight) {
                        return this._scene.context.uniformState.sunPositionWC;
                    }
                    return this._scene.context.uniformState.sunPositionWC2;
                },
                u_accumulation: () => {
                    return this._scene.context.defaultTexture;
                },
                u_revealage: () => {
                    return this._scene.context.defaultTexture;
                },
                ssrParam: () => {
                    return this._ssrParam;
                },
                czm_positionTexture: () => {
                    return this._scene.context.defaultTexture;
                },
                czm_normalTexture: () => {
                    return this._scene.context.defaultTexture;
                },
                czm_reflectivityTexture: () => {
                    return this._scene.context.defaultTexture;
                },
                u_color1: () => {
                    return scratchFieldColor;
                },
                u_color2: () => {
                    return scratchFieldColor;
                },
                u_transparency: () => {
                    return 0.0;
                },
                viewsheSpotsTexture: () => {
                    return this._scene.context.defaultTexture;
                },
            },
            // pixelDatatype: PixelDatatype.HALF_FLOAT,
            sampleMode: PostProcessStageSampleMode.LINEAR
        });

        this._stage = new PostProcessStageComposite({
            name: "czm_geospatialPipelinePass_composite",
            inputPreviousStageTexture: false,
            stages: [
                applyBloomStage,
                this._renderAtmospherePass
            ]
        });
        this._stage.enabled = this._show;

        if (isUpdate) {
            // 重建后重新加入官方后处理集合
            const pps = this._scene.postProcessStages;
            if (typeof pps.contains === "function" && !pps.contains(this._stage)) {
                pps.add(this._stage);
                // 官方集合没有插入 API；重建后保留原位置，SMAA 必须仍在天空合成之后。
                restoreStageOrder(pps, this._stage, stageIndex);
            }
        }
        // 重写执行渲染函数
        const that = this;
        const renderEffect = preDownSamples;
        const originalExecute = renderEffect.execute;
        renderEffect.execute = function (context, colorTexture, depthTexture, idTexture) {

            that._depthTexture = depthTexture;
            that._colorTexture = colorTexture;
            // Fully faded clouds contribute neither color nor shadows; avoid their ray-marching cost.
            if (that.cloudVisibility > 0) {
                that.shadowMaterialPass.execute(context, colorTexture, depthTexture, idTexture);
                that.cloudMaterialPass.execute(context, colorTexture, depthTexture, idTexture);
                if (that.volumetricLightOptions.mode === "volumetric") {
                    that.focusedCloudShadowPass.execute(context, that.volumetricLightOptions);
                    that.volumetricLightPass.execute(context, colorTexture, depthTexture, idTexture);
                }
            }
            that._aerialPerspectiveComoman.execute(context, that._passState);
            that.downsampleThresholdDrawComomand.execute(context, that._downsampleThresholdPassState);
            return originalExecute.call(renderEffect, context, colorTexture, depthTexture, idTexture);
        }
    }

    update(context, useLogDepth) {

        if (this._stage && this._stage.enabled) {
            if (this._width !== this._scene.drawingBufferWidth ||
                this._height !== this._scene.drawingBufferHeight
            ) {
                this.init(true);
            }

            // 接管 Cesium 内置天空/大气，避免与自定义管线叠加
            if (!this._sceneLease) {
                const scene = this._scene;
                // Explicit legacy policy: disabling/disposal restores the captured host values.
                this._sceneLease = new SceneStateLease({ restore: "always" });
                for (const [target, key, value] of [
                    [scene.skyAtmosphere, "show", false], [scene.skyBox, "show", false],
                    [scene.sun, "show", false], [scene.fog, "enabled", false],
                    [scene.globe, "showGroundAtmosphere", false], [scene.globe, "enableLighting", true],
                    [scene.globe, "tileCacheSize", 2E3], [scene.globe, "maximumScreenSpaceError", 2],
                ]) this._sceneLease.write(target, key, value);
            }

            if (!this._isPrecomputed) {
                this.precomputed();
                this._isPrecomputed = true;
            }

            const now = performance.now();
            this._time = now / 1000.;
            this._resolution.x = this._scene.drawingBufferWidth;
            this._resolution.y = this._scene.drawingBufferHeight;
            ++this._frame;

            // planetRadius
            if (this._dynamicPlanet) {
                const cartographic =
                    Ellipsoid.WGS84.cartesianToCartographic(this._scene.camera.position);
                let position = this._scene.globe.ellipsoid.cartographicToCartesian(
                    new Cartographic(cartographic.latitude, cartographic.longitude, 0));
                position = Cartesian3.magnitude(position);
                this._planetRadius = position;
            }

            // console.log(this._scene.context.uniformState.sunPositionWC)
            // console.log(this._scene.context.uniformState.sunDirectionWC)
            // sunPosPC
            // SceneTransforms.worldToDrawingBufferCoordinates(
            //     this._scene,
            //     this._scene.context.uniformState.sunPositionWC,
            //     this._sunPosPC);

            // globeNormal
            const surfacePosition = Ellipsoid.WGS84.scaleToGeodeticSurface(this._scene.camera.position);
            if (surfacePosition) {
                Cartesian3.normalize(surfacePosition, this._globeNormal);
            }

            // moonPosition
            let icrfToFixed = scratchIcrfToFixed;
            let date = (this._scene.frameState && this._scene.frameState.time)
                ? this._scene.frameState.time
                : JulianDate.now(scratchJulianDate);
            if (!defined(Transforms.computeIcrfToFixedMatrix(date, icrfToFixed))) {
                Transforms.computeTemeToPseudoFixedMatrix(date, icrfToFixed);
            }
            const moonPosition = Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(
                date,
                scratchPoint3
            );
            Matrix3.multiplyByVector(
                icrfToFixed,
                moonPosition,
                this._moonPositionWC
            );
            // moonPosPC
            // SceneTransforms.worldToDrawingBufferCoordinates(
            //     this._scene,
            //     this._moonPositionWC,
            //     this._moonPosPC);


            // copySettings
            // preRender 早于官方 Cesium 的 UniformState 更新，首帧必须直接读取相机。
            const projectionMatrix = this._scene.camera.frustum.projectionMatrix;
            const cameraPosition = this._scene.camera.positionWC;
            Matrix4.inverse(this.ellipsoidMatrix, this._inverseEllipsoidMatrix);

            // 将相机位置从世界坐标转换为 ellipsoid local 坐标系
            const cameraPositionTransformed = Matrix4.multiplyByPoint(
                this._inverseEllipsoidMatrix,
                cameraPosition,
                vectorScratch
            );

            // 相减以获得相对于地球中心的向量
            const cameraPositionECEF = Cartesian3.subtract(
                cameraPositionTransformed,
                this._ellipsoidCenter,
                vectorScratch2
            );
            this.cameraPositionECEF = cameraPositionECEF;
            try {
                // 计算摄像机高度与理想球面差值，用于在实际法线与理想法线间插值以避免光照伪影
                const cartographic = Ellipsoid.WGS84.cartesianToCartographic(cameraPosition);
                const cameraHeight = cartographic.height;
                this.cameraHeight = cameraHeight;
                const fadeRange = this.cloudAltitudeFadeRange;
                const fade = fadeRange ? Math.min(1, Math.max(0,
                    (cameraHeight - fadeRange[0]) / (fadeRange[1] - fadeRange[0]))) : 0;
                const visibility = 1 - fade * fade * (3 - 2 * fade);
                // Reset only when crossing the fully hidden boundary, not on every zoom frame.
                if ((visibility === 0) !== (this.cloudVisibility === 0)) {
                    this.cloudMaterialPass.invalidateHistory();
                }
                this.cloudVisibility = visibility;
                this.effectiveCloudCoverage = this.coverage * visibility;
                const projectedScale = new Cartesian3(
                    0,
                    this.ellipsoid.maximumRadius,
                    -cameraHeight
                ).applyMatrix4(projectionMatrix);
                // 计算插值因子，确保过渡平滑
                this._idealSphereAlpha = saturate(
                    remap(projectedScale.y, 41.5, 13.8, 0, 1)
                )
            } catch (error) {
                console.log(error);
                return // 当无法投影到椭球表面时直接中断
            }

            const altitudeCorrection = this._altitudeCorrection;
            if (this.correctAltitude) {
                getAltitudeCorrectionOffset(
                    cameraPositionECEF,
                    this.atmosphere.bottomRadius,
                    this.ellipsoid,
                    altitudeCorrection
                )
            } else {
                Cartesian3.clone(Cartesian3.ZERO, altitudeCorrection);
            }

            this.time = Date.now();
            this.frameTime = this.time - this.lastFrameTime;
            if (this.frameTime > 100) this.frameTime = 100;
            this.lastFrameTime = this.time;
            const deltaTime = this.frameTime / 1000.;
            // 修改后的代码逻辑
            Cartesian2.add(
                this.localWeatherOffset,
                Cartesian2.multiplyByScalar(
                    Cartesian2.clone(this.localWeatherVelocity, vector2Scratch),
                    deltaTime,
                    vector2Scratch
                ),
                this.localWeatherOffset
            );

            Cartesian3.add(
                this.shapeOffset,
                Cartesian3.multiplyByScalar(
                    Cartesian3.clone(this.shapeVelocity, vector3Scratch),
                    deltaTime,
                    vector3Scratch
                ),
                this.shapeOffset
            );

            Cartesian3.add(
                this.shapeDetailOffset,
                Cartesian3.multiplyByScalar(
                    Cartesian3.clone(this.shapeDetailVelocity, vector3Scratch),
                    deltaTime,
                    vector3Scratch
                ),
                this.shapeDetailOffset
            );

            this.shadowMaterialPass.update(context, useLogDepth);

            this._stage.update(context, useLogDepth);
        }
    }

    _publishTexture(key, create, mipmaps = false) {
        let texture;
        try {
            texture = create();
            this._ownedTextures.add(texture);
            if (mipmaps) texture.generateMipmap();
        } catch (error) {
            if (texture) {
                try {
                    if (!texture.isDestroyed()) texture.destroy();
                    this._ownedTextures.delete(texture);
                } catch (cleanupError) {
                    throw new AggregateError([error, cleanupError], "Texture upload and cleanup failed");
                }
            }
            throw error;
        }
        this[key] = texture;
    }

    _registerImageAsset(id, assetPath, key, required = true, mipmaps = false) {
        const url = buildModuleUrl(assetPath);
        this._assets.add({ id, url, required, load: async () => {
            const buffer = await loadAssetBuffer(url);
            if (this._destroyed) return;
            let image;
            try {
                const blob = new Blob([buffer], { type: "image/png" });
                if (typeof globalThis.createImageBitmap === "function") {
                    // Decode bytes directly so hosts do not need img-src blob:.
                    // WebGL ignores UNPACK_FLIP_Y_WEBGL for ImageBitmap sources;
                    // flip here to match Texture's default HTML image upload.
                    image = await createImageBitmap(blob, {
                        imageOrientation: "flipY",
                        premultiplyAlpha: "none",
                        colorSpaceConversion: "default",
                    });
                } else {
                    const objectUrl = URL.createObjectURL(blob);
                    try { image = await Resource.createIfNeeded(objectUrl).fetchImage(); }
                    finally { URL.revokeObjectURL(objectUrl); }
                }
            } catch (error) {
                invalidateAssetBuffer(url, buffer);
                throw error;
            }
            try {
                if (this._destroyed) return;
                this._publishTexture(key, () => new Texture({
                    context: this._scene.context,
                    source: image,
                    width: image.width,
                    height: image.height,
                    sampler: new Sampler({
                        wrapS: WebGLConstants.REPEAT,
                        wrapT: WebGLConstants.REPEAT,
                        minificationFilter: mipmaps ? WebGLConstants.LINEAR_MIPMAP_LINEAR : WebGLConstants.LINEAR,
                        magnificationFilter: WebGLConstants.LINEAR,
                    }),
                }), mipmaps);
            } finally {
                image.close?.();
            }
        } });
    }

    _registerVolumeAsset(id, file, key, width, height, depth, { levels, nearest = false } = {}) {
        const url = buildModuleUrl("sky-atmos-assets/GeospatialAssets/" + file);
        this._assets.add({ id, url, load: async () => {
            const buffer = await loadAssetBuffer(url);
            if (this._destroyed) return;
            // A successful HTTP response can still contain an HTML fallback or
            // a truncated BIN; do not retain such data across explicit retries.
            if (buffer.byteLength !== width * height * depth) {
                invalidateAssetBuffer(url, buffer);
                throw new Error(`[SkyAtmos] Invalid volume asset size: ${url}`);
            }
            const Loader = createData3DTextureLoaderClass(parseUint8Array, {
                width, height, depth,
                format: RedFormat,
                minFilter: nearest ? NearestFilter : LinearFilter,
                magFilter: nearest ? NearestFilter : LinearFilter,
                wrapS: RepeatWrapping,
                wrapT: RepeatWrapping,
                wrapR: RepeatWrapping,
                ...(!nearest ? { colorSpace: NoColorSpace } : {}),
            });
            const texture = await new Loader().loadAsync(url);
            if (this._destroyed) return;
            this._publishTexture(key, () => new Texture3D({
                context: this._scene.context,
                width, height, depth,
                pixelFormat: PixelFormat.RED,
                pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
                useTexStorage: true,
                ...(levels === undefined ? {} : { levels }),
                flipY: false,
                sampler: new Sampler({
                    wrapS: TextureWrap.REPEAT,
                    wrapT: TextureWrap.REPEAT,
                    wrapR: TextureWrap.REPEAT,
                    minificationFilter: nearest ? TextureMinificationFilter.NEAREST : TextureMinificationFilter.LINEAR_MIPMAP_LINEAR,
                    magnificationFilter: nearest ? TextureMagnificationFilter.NEAREST : TextureMagnificationFilter.LINEAR,
                }),
                source: { arrayBufferView: texture.image.data },
            }), !nearest);
        } });
    }

    _registerSnowAsset() {
        if (this._destroyed || this._snowCoverMaskMap) return;
        this._snowCoverMaskMap = this._scene.context.defaultTexture;
        this._registerImageAsset("snow", "sky-atmos-assets/snowCoverMask.png", "_snowCoverMaskMap", false);
    }

    _assetIds(includeSnow = false) {
        const ids = ["weather", "turbulence", "shape", "shape-detail", "stbn", "atmosphere"];
        if (includeSnow) ids.push("snow");
        return ids;
    }

    getAssetState({ includeSnow = false } = {}) {
        return this._assets.getState(this._assetIds(includeSnow));
    }

    captureAssets({ start = false, retry = false, includeSnow = false } = {}) {
        if (start) {
            this.precomputed();
            if (includeSnow) this._registerSnowAsset();
        }
        if (retry) this.precomputed();
        if (retry && includeSnow) this._registerSnowAsset();
        return this._assets.capture(this._assetIds(includeSnow), { start, retry });
    }

    precomputed() {
        if (this._destroyed || this._isPrecomputed) return;
        this._isPrecomputed = true;
        this._registerImageAsset("weather", "sky-atmos-assets/GeospatialAssets/local_weather.png", "localWeatherTexture", true, true);
        this._registerImageAsset("turbulence", "sky-atmos-assets/GeospatialAssets/turbulence.png", "turbulenceTexture", true, true);
        this._registerVolumeAsset("shape", "shape.bin", "shapeTexture", CLOUD_SHAPE_TEXTURE_SIZE, CLOUD_SHAPE_TEXTURE_SIZE, CLOUD_SHAPE_TEXTURE_SIZE, { levels: 8 });
        this._registerVolumeAsset("shape-detail", "shape_detail.bin", "shapeDetailTexture", CLOUD_SHAPE_DETAIL_TEXTURE_SIZE, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE, { levels: 1 + Math.floor(Math.log2(CLOUD_SHAPE_DETAIL_TEXTURE_SIZE)) });
        this._registerVolumeAsset("stbn", "stbn.bin", "stbnTexture", STBN_TEXTURE_WIDTH, STBN_TEXTURE_HEIGHT, STBN_TEXTURE_DEPTH, { nearest: true });
        const url = buildModuleUrl("sky-atmos-assets/GeospatialAssets/");
        this._assets.add({ id: "atmosphere", url, load: () => new Promise((resolve, reject) => {
            new PrecomputedTexturesLoader().load(url, result => {
                if (this._destroyed) { resolve(); return; }
                const textures = [];
                try {
                    // Publish the LUT set atomically: an upload failure keeps every fallback valid.
                    for (const [name, Type] of [["scatteringTexture", Texture3D], ["irradianceTexture", Texture], ["transmittanceTexture", Texture]]) {
                        const image = result[name].image;
                        const texture = new Type({
                            context: this._scene.context,
                            width: image.width,
                            height: image.height,
                            ...(name === "scatteringTexture" ? { depth: image.depth } : {}),
                            pixelFormat: PixelFormat.RGBA,
                            pixelDatatype: PixelDatatype.FLOAT,
                            useTexStorage: true,
                            flipY: false,
                            source: { arrayBufferView: image.data },
                        });
                        textures.push(texture);
                        this._ownedTextures.add(texture);
                    }
                    [this._u_scattering_texture, this._u_irradiance_texture, this._u_transmittance_texture] = textures;
                    this._u_single_mie_scattering_texture = this._u_scattering_texture;
                    resolve();
                } catch (error) {
                    const errors = [error];
                    for (const texture of textures) {
                        try {
                            if (!texture.isDestroyed()) texture.destroy();
                            this._ownedTextures.delete(texture);
                        }
                        catch (cleanupError) { errors.push(cleanupError); }
                    }
                    reject(errors.length === 1 ? error : new AggregateError(errors, "Atmosphere upload and cleanup failed"));
                }
            }, undefined, reject);
        }) });
        this._assets.start(this._assetIds());
    }

    get assetStatus() { return this._assets.status; }
    get assetErrors() { return this._assets.errors; }
    get assetsReady() {
        // An explicit readiness request starts required assets even before the first enabled frame.
        this.precomputed();
        return this._assets.success;
    }
    retryAssets() { return this._assets.retry(); }
    subscribeAssets(listener) { return this._assets.subscribe(listener); }

    get stage() {

        return this._stage;
    }

    get ready() {

        return this._stage.ready;
    }

    get name() {

        return this._stage.name;
    }

    get enabled() {

        return this._show;
    }

    set enabled(val) {
        if (val && !this._show && this.cloudMaterialPass) {
            this.cloudMaterialPass.invalidateHistory();
        }
        this._show = val;
        if (this._stage) { this._stage.enabled = this._show; }
        if (!val) this.restoreScene();
    }

    restoreScene() {
        const lease = this._sceneLease;
        this._sceneLease = undefined;
        lease?.restore();
    }

    _isSupported(context) {

        return this._stage._isSupported(context);
    }

    _releaseAerialRenderTarget() {
        const framebuffer = this._passState?.framebuffer;
        const texture = this._aerialPerspectiveOutputColor;
        if (this._passState) this._passState.framebuffer = undefined;
        this._aerialPerspectiveOutputColor = undefined;
        runCleanup([
            () => framebuffer?.destroy(),
            () => texture?.destroy(),
        ], "Aerial render target cleanup failed");
    }

    _releaseThresholdResources() {
        const framebuffer = this._downsampleThresholdPassState?.framebuffer;
        const texture = this._downsampleThresholdBuffer;
        const command = this.downsampleThresholdDrawComomand;
        if (this._downsampleThresholdPassState) this._downsampleThresholdPassState.framebuffer = undefined;
        this._downsampleThresholdBuffer = undefined;
        this.downsampleThresholdDrawComomand = undefined;
        runCleanup([
            () => framebuffer?.destroy(),
            () => texture?.destroy(),
            () => command?.shaderProgram?.destroy(),
        ], "Threshold resource cleanup failed");
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._assets.dispose();
        const stage = this._stage;
        const command = this._aerialPerspectiveComoman;
        this._stage = undefined;
        this._aerialPerspectiveComoman = undefined;
        const actions = [() => this.restoreScene(), () => {
            if (!stage) return;
            const stages = this._scene.postProcessStages;
            if (typeof stages.contains === "function" && stages.contains(stage)) {
                stages.remove(stage);
            }
        }, () => { if (stage && !stage.isDestroyed()) stage.destroy(); }];
        for (const pass of [this.volumetricLightPass, this.focusedCloudShadowPass, this.cloudMaterialPass, this.shadowMaterialPass]) {
            actions.push(() => { if (pass && !pass.isDestroyed()) pass.destroy(); });
        }
        actions.push(() => this._releaseAerialRenderTarget(), () => this._releaseThresholdResources(),
            // Commands own a shader-cache reference; viewport vertex arrays belong to the context.
            () => command?.shaderProgram?.destroy());
        for (const texture of this._ownedTextures) {
            actions.push(() => { if (!texture.isDestroyed()) texture.destroy(); });
        }
        this._ownedTextures.clear();
        this._downSamplesMap = undefined;
        this._upSamplesMap = undefined;
        runCleanup(actions, "Pipeline cleanup failed");
    }

    isDestroyed() {

        return this._destroyed;
    }

}
