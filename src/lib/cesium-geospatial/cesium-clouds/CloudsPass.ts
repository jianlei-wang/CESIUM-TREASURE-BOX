// CloudsPass.ts
//
// M2 T2：云主 march 渲染 Pass——用 M1 基建 createVolumetricPrimitive + FramebufferManager 组装
// 「custom Primitive pass=VOXELS + 3-attachment MRT FBO + 全 business uniform 注入」。
//
// 职责（plan T2）：
//   1. 创建 3 MRT texture（color/depthVelocity/shadowLength，HalfFloat 优先，UNSIGNED_BYTE 兜底）
//   2. 创建 dummy texture（shadowBuffer 3D 1×1×3 全 0（M3 真值经 state.shadow 注入）/ depthBuffer
//      1×1 val=1.0 / weatherAtlas 3D 1×1×1 全白（T6，state.atlasTexture 缺省兜底）/
//      turbulenceTexture 1×1 / stbnTexture 1×1×1）
//      ——M3/M4/M5/M6 未就绪项 fallback
//   3. uniformMap 注入 clouds.frag + parameters.glsl 全部 business uniform（atmosphere LUT 共享
//      AtmosphereStage 的 luts / weather shape+shapeDetail / 每帧闭包 camera/sun / 静态 scatter 参数）
//   4. createVolumetricPrimitive 装配（globeDepthTexture 闭包隔离私有 API scene._view.globeDepth）
//   5. 持 primitive + MRT textures + uniformMap + cloudsBuffer(att0) bridge getter + destroy
//
// czm 桥接（spec §4.2 + M4）：reprojectionMatrix/viewReprojectionMatrix = preRender 组装的
// jittered 上帧矩阵（T7 createCloudsStage 经 temporalMath 写入 params，M2 期是 identity dummy）；
// cameraNear/cameraFar/viewMatrix 经 CloudsMaterial.ts #define 重定向到 czm_*（无需 uniformMap）；
// cameraPosition 经桥接 = czm_viewerPositionWC。temporalJitter = Bayer 偏移（T7 写入 params；
// 非 temporal 恒 (0,0)）。M4 T6：temporalUpscale=true 时 march 低分（ceil(w/4)）——MRT 尺寸/
// resolution（lowRes*4）/targetUvScale/mipLevelScale=0.25/FBO viewport 全部切低分语义，
// depthVelocity 写 att1 供 CloudsResolvePass。
//
// dummy 决策（M2 vs M3/M4/M5/M6 hook 标注）：
//   - shadowBuffer（M3 BSM 已接通，T4）：state.shadow.bsm = ShadowPass.bsmTexture（sampler3D，
//     z 归一化 (i+0.5)/SHADOW_CASCADE_COUNT 层中心采样）；未就绪（首帧/降级）fallback
//     1×1×3 全 0 dummy → sampleShadowOpticalDepth 返 0 → Beer-Lambert exp(-0)=1（无自阴影）。
//     cascade 选择 near/far 同步换 u_shadowCameraNear/state.shadow.far（BSM split 完整视锥域）
//   - reprojectionMatrix/viewReprojectionMatrix（M4 temporal）：identity → velocity 非 0 但
//     outputDepthVelocity 在 M2 未被消费
//   - SHADOW_LENGTH（M5 god rays 已接通，默认开）：MRT att2 shadowLengthTex + 三参数绑定；
//     applyAerialPerspective 以 marchShadowLength 产物调 GetSkyRadianceToPoint（云间光柱）
//   - depthBuffer（M6 提前接通，2026-08-14）：globeDepth.depthStencilTexture（log-depth 编码，
//     CloudsMaterial surgery 把 three reverseLogDepth 版 getRayDistanceToScene 换 czm_reverseLogDepthWindow
//     反演）→ 云被地形截断/遮挡；未就绪时 fallback 1×1 val=1.0 dummy（远截断降级）
//   - weatherAtlasTexture（T6）：state.atlasTexture（WeatherAtlas 3D，buildImpl 注入）——
//     缺省 fallback 1×1×1 全白 dummy（满 coverage 连续云墙）；旧 2D localWeather 绑定退役
//   - turbulenceTexture（M2 dummy）：1×1 RGBA（128,128,128,255）→ 中性位移
//   - stbnTexture：weather.stbn 真 3D 资产（128×128×64 R8 蓝噪声；白噪声 dummy 会显形全屏雪花纹）

import {
  Texture,
  Texture3D,
  PixelFormat,
  PixelDatatype,
  Sampler,
  TextureMinificationFilter,
  TextureMagnificationFilter,
  TextureWrap,
  Cartesian2,
  Cartesian3,
  BoundingRectangle,
  type Scene,
  type Context
} from 'cesium'
import {
  createVolumetricPrimitive,

  type VolumetricPrimitive,
  type AtmosphereLUTs
} from '../cesium-core'
import { buildCloudsMainFragmentShader, type CloudsMainOptions } from './CloudsMaterial'
import {
  defaultCloudsParameters,
  CLIMATE_BANDS_FLOOR_DEFAULT,
  type CloudsParameters,
  type CloudsShadowFrameState
} from './cloudsDefaultParameters'
import type { WeatherTextures } from './weatherTextures'

// T6 平流偏移缺省（state.windOffset 未注入——standalone CloudsPass / 首帧前——的 fallback；
// 只读共享实例，uniform 上传只读不写）
const ZERO_WIND_OFFSET = new Cartesian2(0, 0)
// P1 云内纹理平流缺省（同上语义）
const ZERO_SHAPE_WIND_OFFSET = new Cartesian3(0, 0, 0)

/**
 * 检测 PostProcessStage/RT 可用的最高 HDR 像素数据类型（对齐 core AtmosphereStage.resolvePostHdrDatatype，
 * 但 core 未从 index 导出——本函数内联以遵守「不碰 core」约束）。
 *
 * HALF_FLOAT 优先（精度够 + 性能好），FLOAT 次选，UNSIGNED_BYTE 兜底（线性 >1 段被 clip）。
 * 云 MRT colorTex 需 HDR 承载 applyAerialPerspective 线性输出（>1 段供 overlay ACES 压缩）。
 * M3 T5 起也供 createCloudsStage 组 ShadowPass 的 BSM pixelDatatype（RGBA16F 作 FBO color
 * attachment 需 colorBufferHalfFloat——本检测恰好覆盖；生成端/消费端同类型保量化一致）。
 */
export function resolveCloudsHdrDatatype(scene: Scene): number {
  const ctx = (scene as unknown as {
    context: {
      halfFloatingPointTexture: boolean
      colorBufferHalfFloat: boolean
      floatingPointTexture: boolean
      colorBufferFloat: boolean
    }
  }).context
  if (ctx.halfFloatingPointTexture && ctx.colorBufferHalfFloat) {
    return PixelDatatype.HALF_FLOAT
  }
  if (ctx.colorBufferFloat && ctx.floatingPointTexture) {
    return PixelDatatype.FLOAT
  }
  return PixelDatatype.UNSIGNED_BYTE
}

// 相对亮度常量（逐字对齐 core AtmosphereStage.ts:147-157；SUN/SKY_SPECTRAL_RADIANCE_TO_LUMINANCE
// = sunRadianceToLuminance / sunLuminance，sunLuminance ≈ 75722.23）。clouds.frag 声明此二 uniform
// 用于 ACCURATE_SUN_SKY_LIGHT 路径的 GetSunAndSkyScalarIrradiance 量纲换算。
const SUN_LUMINANCE = 75722.23
const SUN_SPECTRAL_RADIANCE_TO_LUMINANCE = new Cartesian3(
  98242.786222 / SUN_LUMINANCE,
  69954.398112 / SUN_LUMINANCE,
  66475.012354 / SUN_LUMINANCE
)
const SKY_SPECTRAL_RADIANCE_TO_LUMINANCE = new Cartesian3(
  114974.916437 / SUN_LUMINANCE,
  71305.954816 / SUN_LUMINANCE,
  65310.548555 / SUN_LUMINANCE
)

/**
 * 每帧可变状态（createCloudsStage 持有并 preRender 更新；CloudsPass uniformMap 闭包读引用）。
 * 仿 core AtmosphereFrameState。sunDirection 为 ECEF 单位向量；altitudeCorrection 为密切球偏移（米）。
 */
export interface CloudsFrameState {
  sunDirection: Cartesian3
  /** 观察者月方向（ECEF 单位向量，视差修正后）——月光照明用（方向 C）。 */
  moonDirection: Cartesian3
  /** Lambert 球积分月相因子（朔 0/弦 0.318/望 1，preRender 由 sun/moon 两方向 dot 算）。 */
  moonIlluminatedFraction: number
  altitudeCorrection: Cartesian3
  /**
   * M3 BSM 状态（T5 createCloudsStage preRender 填：CascadedShadowMaps.update + ShadowPass.render）。
   * 未就绪（首帧 / 未填）时 uniformMap fallback 全 0 dummy → Beer=1（无自阴影降级）。
   */
  shadow?: CloudsShadowFrameState
  /**
   * T6 WeatherAtlas 3D 纹理（buildImpl 创建后注入——烘焙或 pngFallback 同型；atlasDisabled
   * 无 raw 时为 1×1×1 全白 dummy）。缺省（standalone CloudsPass 未注入）→ CloudsPass 内部
   * 1×1×1 全白 dummy（满 coverage 连续云墙，同旧 2D localWeather decode 失败语义）。
   */
  atlasTexture?: Texture3D
  /** T6 平流偏移（tile 单位 mod 1，preRender 每帧按 scene.time 覆写——computeWindOffsetTiles）。
   *  缺省 (0,0)（无平流；float64 mod 已在 CPU 完成，spec §4.1 精度陷阱）。 */
  windOffset?: Cartesian2
  /**
   * P1 云内纹理风平流（纹理域 mod 1，preRender 每帧覆写——computeShapeWindOffsets）。
   * shape/detail 各自 repeat 域独立 fract。缺省 (0,0,0)（无平流——standalone CloudsPass）。
   */
  shapeWindOffset?: Cartesian3
  /** 同上，shapeDetail 域（高频 20×——detail 纹理周期 167m vs shape 3.3km）。 */
  detailWindOffset?: Cartesian3
  /** T6 演化相位 tNorm ∈[0,1)（preRender 每帧覆写——computeEvolutionTNorm，3D atlas z 坐标）。缺省 0。 */
  atlasT?: number
  /** T6 ITCZ 中心纬度正弦（preRender 每帧覆写——computeItczCenterLatDeg(doy) 取 sin）。缺省 0。 */
  itczCenterSin?: number
  /**
   * T6 气候带 band 下限（u_climateBandsFloor，shader clamp(band, floor, 1.3)）：天气预设激活
   * 时 0.6（spec §5.4 组合语义）、清除后回缺省 0.2（= 原 shader 字面量，零回归）。
   */
  climateBandsFloor?: number
}

/** CloudsPass 构造选项。 */
export interface CloudsPassOptions extends CloudsMainOptions {
  /** 业务参数覆盖（缺省取 defaultCloudsParameters）。M6 qualityPresets 用。 */
  parameters?: CloudsParameters
  /**
   * M4 temporal upscale 开关（默认 false = M3 全分零回归）。true 时 march 降到
   * ceil(w/4)×ceil(h/4)（plan D3）：MRT 尺寸/resolution（=lowRes*4）/targetUvScale/
   * mipLevelScale=0.25/viewport 全部切低分语义，velocity 写 att1 供 CloudsResolvePass。
   */
  temporalUpscale?: boolean
  /**
   * temporal upscale 的降采样分母（涂抹修复 T1，2026-09-02）：2 = march 半分（RT 面积 ×4，
   * 细节上限 4px→2px 周期，涂抹感约减半）；缺省/非法值 = 4（three 原文 1/4 行为零回归）。
   * 1 = march 全分（公式自然退化 ceil(w/1)=w、mipLevelScale=1）——resolve 侧随之走
   * TAA 分支（temporalAntialiasing）= 全分辨率 + 时域降噪（用户 2026-09-02 追加档）。
   * resolve 侧 shader 宏（UPSCALE_DIVISOR）与直通 Bayer 映射同源——须与 CloudsResolvePass
   * options.upscaleDivisor 传同值。
   */
  upscaleDivisor?: 1 | 2 | 4
}

/**
 * 主 march（CloudsPass）与 BSM 生成端（ShadowPass，M3 T5）共享的 business uniform 段
 * （T5 从 createCloudsPass uniformMap 逐项搬移，纯重构不改语义）。
 *
 * 覆盖：大气 LUT / SUN-SKY 光度 / 大气（bottomRadius/worldToECEF/ecefToWorld/
 * altitudeCorrection/sunDirection/月光三键 moonDirection·moonIlluminatedFraction·moonLightScale）/
 * 参与 medium / scatter 视觉 / weather+shape / 云层 packed / frame / stbnTexture。**不含**：主
 * march/次 march 档参数（shadow.frag 声明
 * 同名 maxIterationCount 等、值取 params.shadowMarch 不同档——必须各端自绑）、BSM 消费段
 * （shadowBuffer 等）、reprojection/depth/cameraHeight/resolution/targetUvScale（clouds.frag
 * 专有，生成端无此 uniform）。
 *
 * @param turbulenceTexture 中性灰 1×1 dummy（sampleMedia TURBULENCE 分支采样；两端各自
 *   创建持有便于独立 destroy——传参而非内部创建，所有权留在调用方）。
 */
export function buildSharedCloudsUniforms(
  scene: Scene,
  luts: AtmosphereLUTs,
  weather: WeatherTextures,
  state: CloudsFrameState,
  params: CloudsParameters,
  turbulenceTexture: Texture
): { [name: string]: () => unknown } {
  return {
    // 大气 LUT（与 AtmosphereStage buildAtmosphereUniforms 同源）
    transmittance_texture: () => luts.transmittance,
    scattering_texture: () => luts.scattering,
    single_mie_scattering_texture: () => luts.scattering, // COMBINED 模式不采样，传同值占位
    irradiance_texture: () => luts.irradiance,
    higher_order_scattering_texture: () => luts.higherOrderScattering, // C9：云 god rays 防过暗

    // SUN/SKY 光度换算（const，ACCURATE_SUN_SKY_LIGHT 路径用；生成端无此 uniform，绑了不消费）
    SUN_SPECTRAL_RADIANCE_TO_LUMINANCE: () => SUN_SPECTRAL_RADIANCE_TO_LUMINANCE,
    SKY_SPECTRAL_RADIANCE_TO_LUMINANCE: () => SKY_SPECTRAL_RADIANCE_TO_LUMINANCE,

    // 大气（bottomRadius 静态；altitudeCorrection/sunDirection/worldToECEFMatrix 每帧闭包）
    bottomRadius: () => params.bottomRadius,
    worldToECEFMatrix: () => params.worldToECEFMatrix,
    ecefToWorldMatrix: () => params.ecefToWorldMatrix,
    altitudeCorrection: () => state.altitudeCorrection,
    sunDirection: () => state.sunDirection,
    // 月光三键（方向 C，clouds.frag 声明同名 uniform；ShadowPass 生成端 shadow.frag 无声明——
    // Cesium 静默忽略未消费 uniform，同 skyLightScale 先例，无害）
    moonDirection: () => state.moonDirection,
    moonIlluminatedFraction: () => state.moonIlluminatedFraction,
    moonLightScale: () => params.moonLightScale,

    // 参与 medium
    scatteringCoefficient: () => params.scatteringCoefficient,
    absorptionCoefficient: () => params.absorptionCoefficient,

    // scatter 视觉（生成端不消费，主 march 专有；同段抽出避免两端值漂移）
    skyLightScale: () => params.skyLightScale,
    groundBounceScale: () => params.groundBounceScale,
    powderScale: () => params.powderScale,
    powderExponent: () => params.powderExponent,

    // weather/shape（T6：2D localWeatherTexture → 3D atlas（T4 sampleWeather 改造）。atlas 由
    // buildImpl 创建注入 state；缺省 undefined 由各端 fallback（CloudsPass 内部 dummy /
    // buildImpl skip-path dummy）——standalone CloudsPass 未注入时也不炸。时间轴四键（T1 纯
    // 函数 CPU float64 mod 产物）preRender 每帧覆写，此处闭包逐帧读。
    weatherAtlasTexture: () => state.atlasTexture,
    u_windOffset: () => state.windOffset ?? ZERO_WIND_OFFSET,
    u_shapeWindOffset: () => state.shapeWindOffset ?? ZERO_SHAPE_WIND_OFFSET,
    u_detailWindOffset: () => state.detailWindOffset ?? ZERO_SHAPE_WIND_OFFSET,
    u_atlasT: () => state.atlasT ?? 0,
    u_itczCenterSin: () => state.itczCenterSin ?? 0,
    u_climateBands: () => params.climateBands,
    u_climateBandsFloor: () => state.climateBandsFloor ?? CLIMATE_BANDS_FLOOR_DEFAULT,
    localWeatherRepeat: () => params.localWeatherRepeat,
    localWeatherOffset: () => params.localWeatherOffset,
    coverage: () => params.coverage,
    shapeTexture: () => weather.shape,
    shapeRepeat: () => params.shapeRepeat,
    shapeOffset: () => params.shapeOffset,
    shapeDetailTexture: () => weather.shapeDetail,
    shapeDetailRepeat: () => params.shapeDetailRepeat,
    shapeDetailOffset: () => params.shapeDetailOffset,
    turbulenceTexture: () => turbulenceTexture,
    turbulenceRepeat: () => params.turbulenceRepeat,
    turbulenceDisplacement: () => params.turbulenceDisplacement,

    // 云层 packed（CloudLayers.DEFAULT 展开）
    minLayerHeights: () => params.minLayerHeights,
    maxLayerHeights: () => params.maxLayerHeights,
    minIntervalHeights: () => params.minIntervalHeights,
    maxIntervalHeights: () => params.maxIntervalHeights,
    densityScales: () => params.densityScales,
    shapeAmounts: () => params.shapeAmounts,
    shapeDetailAmounts: () => params.shapeDetailAmounts,
    weatherExponents: () => params.weatherExponents,
    shapeAlteringBiases: () => params.shapeAlteringBiases,
    coverageFilterWidths: () => params.coverageFilterWidths,
    minHeight: () => params.minHeight,
    maxHeight: () => params.maxHeight,
    shadowTopHeight: () => params.shadowTopHeight,
    shadowBottomHeight: () => params.shadowBottomHeight,
    shadowLayerMask: () => params.shadowLayerMask,

    // STBN（weather.stbn 真 3D 资产；frame=0 静态采样 layer 0，M4 temporal 递增轮换层）
    frame: () => params.frame,
    stbnTexture: () => weather.stbn
  }
}

/** CloudsPass 句柄：持 primitive + MRT textures + uniformMap + bridge getter + destroy。 */
export interface CloudsPass {
  /**
   * M5 att2 shadowLength Tex bridge（{_texture,_target}）——喂 core atmosphere stage 的
   * cloudsShadowLengthBridge（天空 inscatter 云影调制 = 太阳周围光柱）。lightShafts 关时 undefined。
   */
  getShadowLengthBridge(): { _texture: unknown; _target: number } | undefined
  /** att0 color Tex bridge（{_texture,_target}，注入 overlay PostProcessStage uniform）。 */
  getColorBridge(): { _texture: unknown; _target: number }
  /** att0 color Tex（直接引用，调试/probe 用；temporal 时为低分）。 */
  readonly colorTexture: Texture
  /**
   * att1 depthVelocity Tex（M4 temporal：低分，velocity reprojection 数据——CloudsResolvePass
   * 构造消费；非 temporal 时同尺寸写 0 不消费，M2 行为）。
   */
  readonly depthVelocityTexture: Texture
  /**
   * MRT att2 shadowLength Tex（M5 god rays，lightShafts 开时存在；temporal 关时无消费者——
   * three 喂 atmosphereShadowLength 的路径 spec 不做，预留 M6/后续）。
   */
  readonly shadowLengthTexture: Texture | undefined
  /** march FBO 宽（temporal 时 = ceil(drawingBuffer/4)，T7 算 jitter 的 lowRes）。 */
  readonly marchWidth: number
  /** march FBO 高（同上）。 */
  readonly marchHeight: number
  /** VolumetricPrimitive（已 add 到 scene.primitives；destroy 时摘除）。 */
  readonly primitive: VolumetricPrimitive
  /** 释放：摘 primitive + destroy MRT 3 texture + dummy texture（FBO 由 primitive.destroy 释放）。幂等。 */
  destroy(): void
}

// Cesium 公开 .d.ts 缺 drawingBufferWidth/Height（Context augment 为空 interface）。局部补最小形状。
interface CesiumContext extends Context {
  drawingBufferWidth: number
  drawingBufferHeight: number
}

// scene._view.globeDepth.depthStencilTexture 私有路径（spec 附录 F5）。局部类型隔离私有 API。
interface GlobeDepthView {
  _view?: { globeDepth?: { depthStencilTexture?: Texture } }
}

/**
 * 创建云主 march Pass（custom Primitive pass=VOXELS + 3-attachment MRT FBO + 全 business uniform）。
 *
 * @param scene Cesium scene（取 context + camera + globe ellipsoid；primitive add 到 scene.primitives）。
 * @param luts 大气 LUT（transmittance/scattering/irradiance/single_mie/higher_order；与 AtmosphereStage 共享）。
 * @param weather weather 噪声纹理（shape + shapeDetail 3D Texture；M2 dummy localWeather）。
 * @param state 每帧可变状态（sunDirection/altitudeCorrection；createCloudsStage 持有更新）。
 * @param options 桥接选项 + 业务参数覆盖。
 */
export function createCloudsPass(
  scene: Scene,
  luts: AtmosphereLUTs,
  weather: WeatherTextures,
  state: CloudsFrameState,
  options: CloudsPassOptions = {}
): CloudsPass {
  const context = (scene as unknown as { context: CesiumContext }).context
  const params = options.parameters ?? defaultCloudsParameters()
  const width = context.drawingBufferWidth || 256
  const height = context.drawingBufferHeight || 256
  // M4 T6（plan D3）：temporal 时 march 降到 ceil(w/divisor)（three CloudsPass.setSize 的
  // temporalUpscale 分支同款，divisor=4 原文语义）；ceil 保证整倍数上取，march 的 resolution =
  // lowRes*divisor（对齐「全分等效」）可能略超 drawingBuffer → targetUvScale < 1 修正 depth 采样域。
  // T1（2026-09-02）：divisor 可选 2（半分 march，涂抹感约减半）——缺省/非法回落 4 零回归。
  const temporalUpscale = options.temporalUpscale === true
  const upscaleDivisor =
    options.upscaleDivisor === 4 || options.upscaleDivisor === 2 ? options.upscaleDivisor : 1
  const marchWidth = temporalUpscale ? Math.ceil(width / upscaleDivisor) : width
  const marchHeight = temporalUpscale ? Math.ceil(height / upscaleDivisor) : height

  // ── HDR pixel datatype 检测（内联，对齐 core resolvePostHdrDatatype）──
  // colorTex 需 HDR 承载线性云 radiance（applyAerialPerspective 输出线性 >1 段）；depthVel/shadowLen
  // 跟随同类型（M2 不消费，但保持 MRT attachment 类型一致避免类型 mismatch）。
  const pixelDatatype = resolveCloudsHdrDatatype(scene)

  // ── 3 MRT color attachment（NEAREST 像素对齐 + CLAMP_TO_EDGE，同 spike SPIKE_SAMPLER）──
  const mrtSampler = new Sampler({
    minificationFilter: TextureMinificationFilter.NEAREST,
    magnificationFilter: TextureMagnificationFilter.NEAREST,
    wrapS: TextureWrap.CLAMP_TO_EDGE,
    wrapT: TextureWrap.CLAMP_TO_EDGE
  })
  const mkMrtTex = (): Texture =>
    new Texture({
      context,
      width: marchWidth,
      height: marchHeight,
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype,
      sampler: mrtSampler
    })
  const colorTex = mkMrtTex() // att0：云 color（RGB linear HDR）+ transmittance（A）
  const depthVelTex = mkMrtTex() // att1：depthVelocity（M4 temporal 接通；temporal 关时写 0 不消费）
  // M5 T2：lightShafts（默认开）时 define SHADOW_LENGTH → shader 有 location 2 out
  //（outputShadowLength），MRT 配第 3 attachment。FBO drawBuffers 数必须匹配 shader out 数
  //（M2 坑：2 out + 3 attachment 触发 GL_INVALID_OPERATION "missing fragment shader outputs"
  // ——反方向 3 out + 2 attachment 同炸）。att2 无消费者（three 喂 atmosphereShadowLength 的
  // 路径 spec 明确不做）——RGBA 同 mkMrtTex（out float 写 R 通道合法，类型统一避 RED+HALF_FLOAT
  // 组合坑）。
  const lightShafts = options.lightShafts !== false
  const shadowLenTex = lightShafts ? mkMrtTex() : undefined
  const mrtTextures = lightShafts ? [colorTex, depthVelTex, shadowLenTex!] : [colorTex, depthVelTex]

  // ── dummy texture（fallback：state.shadow 未就绪项）──
  // shadowBuffer 用 Texture3D（sampler3D）：Cesium createUniform 不认 sampler2DArray（type 36289，
  // bind 炸 "Unrecognized uniform type"）。CloudsMaterial.ts surgery 把 clouds.frag
  // `uniform sampler2DArray shadowBuffer` → `uniform sampler3D shadowBuffer`。depth=shadowCascadeCount
  // 当 cascade 维度，全 0 → Beer-Lambert 1。M3 T4 已接真实 BSM（state.shadow.bsm = ShadowPass.bsmTexture，
  // z 归一化层中心采样）；此 dummy 仅首帧/降级 fallback。
  const dummyShadowBuffer = new Texture3D({
    context,
    source: {
      width: 1,
      height: 1,
      depth: params.shadowCascadeCount,
      arrayBufferView: new Uint8Array(params.shadowCascadeCount * 4) // 全 0
    },
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
    flipY: false
  })

  const dummyDepthBuffer = new Texture({
    context,
    source: {
      width: 1,
      height: 1,
      arrayBufferView: new Uint8Array([255, 255, 255, 255])
    },
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype: PixelDatatype.UNSIGNED_BYTE
  }) // depth=1.0 → getRayDistanceToScene 远截断（M6 接通真实 globe depthTexture + log-depth 转换）

  const dummyTurbulence = new Texture({
    context,
    source: {
      width: 1,
      height: 1,
      arrayBufferView: new Uint8Array([128, 128, 128, 255])
    },
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype: PixelDatatype.UNSIGNED_BYTE
  }) // 中性位移（M2 dummy；procedural turbulence M6 接通）

  // T6 weatherAtlas fallback（standalone CloudsPass / state.atlasTexture 未注入时）：1×1×1
  // 全白 → sampleWeather 满 coverage（连续云墙，同旧 2D localWeather decode 失败降级语义）。
  // 正常链路 buildImpl 注入 state.atlasTexture（WeatherAtlas 烘焙/pngFallback 同型 Texture3D），
  // 此 dummy 仅缺省兜底——采样 sampler3D 未绑定时 GL 行为未定义，必须绑。
  const dummyWeatherAtlas = new Texture3D({
    context,
    source: {
      width: 1,
      height: 1,
      depth: 1,
      arrayBufferView: new Uint8Array([255, 255, 255, 255])
    },
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
    flipY: false
  })

  // STBN 蓝噪声（march per-pixel jitter）：weather.stbn 真 3D 资产（128×128×64 R8，takram 打包）。
  // 白噪声 dummy（CPU Math.random 64×64×4）会让 jitter 显形为全屏雪花纹（实测 2026-08-14）——
  // 蓝噪声误差能量在人眼不敏感高频段，观感平滑。frame=0 静态采样 layer 0（M4 temporal 接通后
  // 递增轮换层 + temporal reprojection 收敛）。

  // ── globe depth 闭包（spec 附录 F5：私有 API scene._view.globeDepth.depthStencilTexture）──
  // M6 提前接通（2026-08-14）：depthBuffer uniform 直连 globe depth（云被地形截断/遮挡）；
  // 未就绪时 uniformMap fallback 1×1 val=1.0 dummy（远截断，无遮挡降级）。
  const globeDepthTexture = (): Texture | undefined => {
    const view = (scene as unknown as GlobeDepthView)._view
    return view?.globeDepth?.depthStencilTexture
  }

  // ── uniformMap：注入 clouds.frag + parameters.glsl 全部 business uniform ──
  // 每帧可变量（sun/altitude/cameraHeight/resolution）走闭包读 state/scene；静态量取 params。
  // 共享段（LUT/光度/大气/medium/scatter 视觉/weather/云层/frame/stbn）经
  // buildSharedCloudsUniforms（M3 T5 抽出，ShadowPass 生成端复用同段）；本段为 CloudsPass 专有
  // （march 档/BSM 消费/reprojection/depth——生成端 shader 无这些 uniform 或取值不同档）。
  // ATMOSPHERE / densityProfile 已由 CloudsMaterial.ts const 注入，不在此声明。
  // viewMatrix/cameraNear/cameraFar 已由 CloudsMaterial.ts #define 重定向到 czm_*，不在此声明。
  // cameraHeight：测地高度（米，ellipsoid 起算）——clouds.frag L745 与 minHeight/maxHeight（米）
  // 比较（云层上下判定）。用 camera.positionCartographic.height（Cesium 内置换算，勿用
  // |positionWC| 地心距——赤道海平面地心距 6.378e6 ≠ 测地高 0，会错走「相机在云上方」分支）。
  const cameraHeight = (): number => scene.camera.positionCartographic.height
  // resolution scratch：闭包持 module-scratch Cartesian2（避免每帧分配，仿 lensflare texelSizeForSourceScale）。
  // M4 T6（plan D3/D10）：temporal 时 resolution = lowRes*divisor（对齐全分等效——three 语义：
  // 噪声种子 gl_FragCoord+jitter*resolution 的量纲基底、ray 重建 jitter 偏移基底；
  // T1 起 divisor 可为 2）；非 temporal = drawingBuffer（M2 语义）。
  const resolutionFullW = temporalUpscale ? marchWidth * upscaleDivisor : width
  const resolutionFullH = temporalUpscale ? marchHeight * upscaleDivisor : height
  const resolutionScratch = new Cartesian2(resolutionFullW, resolutionFullH)
  const resolution = (): Cartesian2 => {
    resolutionScratch.x = resolutionFullW
    resolutionScratch.y = resolutionFullH
    return resolutionScratch
  }

  // M4 T6：temporal 时 targetUvScale = lowRes*divisor/drawingBuffer（低分 UV → 全分 depth 纹理
  // 子区域；ceil 后 *divisor 可能 > 全分故 <1——three CloudsMaterial.setSize 同款修正）、
  // mipLevelScale = 1/divisor（低分 march 采样 weather 提对应 mip 级）。
  const targetUvScaleTemporal = new Cartesian2(
    (marchWidth * upscaleDivisor) / width,
    (marchHeight * upscaleDivisor) / height
  )

  const uniformMap: { [name: string]: () => unknown } = {
    ...buildSharedCloudsUniforms(scene, luts, weather, state, params, dummyTurbulence),

    // T6：atlas 纹理带内部 dummy 兜底（覆盖共享段的无兜底绑定——sampler3D 未绑定时 GL 未定义）；
    // 主 march 专有覆盖，ShadowPass 生成端由 buildImpl 保证 state.atlasTexture 恒已注入
    weatherAtlasTexture: () => state.atlasTexture ?? dummyWeatherAtlas,

    // D7 frame 拆分：march 的 stbn 噪声相位只在 temporal 开时跟随 params.frame 递增
    //（无 resolve 平滑时逐帧换相位 = 回归闪烁；M3 行为 = 恒 0）
    frame: () => (temporalUpscale ? params.frame : 0),

    // 相机/场景（每帧闭包；cameraHeight/resolution/targetUvScale/mipLevelScale 为 clouds.frag 专有）
    cameraHeight,
    resolution,
    targetUvScale: () => (temporalUpscale ? targetUvScaleTemporal : params.targetUvScale),
    mipLevelScale: () => (temporalUpscale ? 1 / upscaleDivisor : params.mipLevelScale),

    // 主 raymarch
    maxIterationCount: () => params.maxIterationCount,
    minStepSize: () => params.minStepSize,
    maxStepSize: () => params.maxStepSize,
    maxRayDistance: () => params.maxRayDistance,
    perspectiveStepScale: () => params.perspectiveStepScale,
    // 【2026-09-04 甲内近水平 march LOD】云内步 mip 调制倍率（缺省 1）
    u_hitStepMipBoost: () => params.hitStepMipBoost ?? 1,
    minDensity: () => params.minDensity,
    minExtinction: () => params.minExtinction,
    minTransmittance: () => params.minTransmittance,

    // 次 raymarch
    maxIterationCountToSun: () => params.maxIterationCountToSun,
    maxIterationCountToGround: () => params.maxIterationCountToGround,
    minSecondaryStepSize: () => params.minSecondaryStepSize,
    secondaryStepScale: () => params.secondaryStepScale,

    // 云 god rays（M5，SHADOW_LENGTH define 时 shader 才声明消费；不 define 时绑了是未声明
    // uniform，Cesium 静默忽略——lightShafts 开关无需分支绑定）
    maxShadowLengthIterationCount: () => params.maxShadowLengthIterationCount,
    minShadowLengthStepSize: () => params.minShadowLengthStepSize,
    maxShadowLengthRayDistance: () => params.maxShadowLengthRayDistance,

    // BSM（M3：state.shadow 由 createCloudsStage preRender 填；未就绪 fallback 全 0 dummy → Beer=1）
    shadowBuffer: () => state.shadow?.bsm ?? dummyShadowBuffer,
    shadowTexelSize: () => state.shadow?.texelSize ?? params.shadowTexelSize,
    shadowIntervals: () => state.shadow?.intervals ?? params.shadowIntervals,
    shadowMatrices: () => state.shadow?.matrices ?? params.shadowMatrices,
    shadowFar: () => state.shadow?.far ?? params.shadowFar,
    // cascade 选择归一化 near（CloudsMaterial BRIDGE_DEFINES 声明；BSM split 完整视锥 near，
    // ≠ czm_currentFrustum.x multi-frustum 分段值——分段执行时错位 cascade 全错）
    u_shadowCameraNear: () => state.shadow?.cameraNear ?? 0,
    maxShadowFilterRadius: () => params.maxShadowFilterRadius,

    // reprojection（M4，M2 dummy identity → velocity 0）
    reprojectionMatrix: () => params.reprojectionMatrix,
    viewReprojectionMatrix: () => params.viewReprojectionMatrix,
    temporalJitter: () => params.temporalJitter,

    // 夜间环境底光（方向 B）：march 专有——shadow.frag 生成端不声明不消费
    //（shared 段不注入，Cesium 对未声明 uniform 静默忽略的同理反向）
    nightAmbient: () => params.nightAmbient,
    // 夜间云色调乘子（乘底光+月光；2026-09-01 uniform 化，?cloudsTint= URL 调）
    u_nightTint: () => params.nightTint,
    // 暮光天光补偿倍率（2026-09-01 黄昏云过黑 A 案；?cloudsTwilightBoost= URL 调，1=关）
    u_twilightSkyBoost: () => params.twilightSkyBoost,

    // depth（M6 提前接通，2026-08-14）：真实 globe depthTexture（log-depth 编码，shader 内
    // czm_reverseLogDepthWindow 反演）→ 云被地形正确截断/遮挡（青藏「云浮地形上」修）。
    // globeDepth 未就绪（首帧/_view 缺失）时 fallback 1×1 val=1.0 dummy（远截断，无遮挡降级）。
    depthBuffer: () => globeDepthTexture() ?? dummyDepthBuffer
  }

  // ── VolumetricPrimitive 装配（M1 基建）──
  // M4 T6：temporal 时 viewport 必须显式 = 低分尺寸（RenderState 不设 viewport 时 GL
  // viewport 保持 drawingBuffer 全分，低分 FBO 下 gl_FragCoord 越界写被裁）
  const fragmentShaderSource = buildCloudsMainFragmentShader(options)
  const primitive = createVolumetricPrimitive({
    context,
    fragmentShaderSource,
    uniformMap,
    mrtColorTextures: mrtTextures,
    globeDepthTexture,
    viewport: temporalUpscale ? new BoundingRectangle(0, 0, marchWidth, marchHeight) : undefined
  })
  const primitives = scene.primitives as unknown as {
    add: (p: VolumetricPrimitive) => void
    remove: (p: VolumetricPrimitive) => boolean
  }
  primitives.add(primitive)

  // ── att0 bridge（注入 overlay PostProcessStage uniform，仿 historyBlit getHistoryBridge）──
  const colorBridge = (): { _texture: unknown; _target: number } => {
    const internal = colorTex as unknown as { _texture: unknown; _target: number }
    return { _texture: internal._texture, _target: internal._target }
  }
  // ── M5 att2 shadowLength bridge（core atmosphere cloudsShadowLengthBridge 消费）──
  const shadowLengthBridge = (): { _texture: unknown; _target: number } | undefined => {
    if (shadowLenTex == null) return undefined
    const internal = shadowLenTex as unknown as { _texture: unknown; _target: number }
    return { _texture: internal._texture, _target: internal._target }
  }

  let destroyed = false
  return {
    primitive,
    colorTexture: colorTex,
    depthVelocityTexture: depthVelTex,
    shadowLengthTexture: shadowLenTex,
    marchWidth,
    marchHeight,
    getColorBridge: colorBridge,
    getShadowLengthBridge: shadowLengthBridge,
    destroy(): void {
      if (destroyed) return
      destroyed = true
      primitives.remove(primitive)
      primitive.destroy() // 释放 MRT FBO（GL framebuffer handle），destroyAttachments=false 不连带 texture
      mrtTextures.forEach((t) => t.destroy())
      shadowLenTex?.destroy()
      dummyDepthBuffer.destroy()
      dummyTurbulence.destroy()
      // dummyWeatherAtlas Texture3D destroy（公开 .d.ts 未声明 destroy，cast 调用——dummyShadowBuffer 同款）
      ;(dummyWeatherAtlas as unknown as { destroy: () => void }).destroy()
      // dummyShadowBuffer Texture3D destroy（公开 .d.ts 未声明 destroy，cast 调用）。
      // M3 T4 已接真实 BSM（state.shadow.bsm），此 dummy 仅首帧/降级 fallback。
      ;(dummyShadowBuffer as unknown as { destroy: () => void }).destroy()
    }
  }
}
