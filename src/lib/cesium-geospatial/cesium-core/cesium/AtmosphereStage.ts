// AtmosphereStage 组装——把 B 路径 shader 接到 Cesium 运行时（完全参考 cesium-clouds-atmosphere）。
//
// 职责：
// 1. createAtmosphereStage(scene, luts, options) 创建 PostProcessStage 并加入 scene.postProcessStages；
//    uniforms 覆盖 AERIAL_PERSPECTIVE_UNIFORM_NAMES 全部。
// 2. preRender 每帧更新 sunDirection（Simon1994 + ICRF→Fixed）、altitudeCorrection（密切球再中心化）、
//    exposure（动态：按相机当地太阳高度角在 day/night 间插值，对齐源库 _getEffectiveAtmosphereExposure）。
// 3. depthTestAgainstTerrain=true（Cesium 地形 depth 硬前提，见 createAtmosphereStage 注释）。
//
// 与原 A 路径 AtmosphereStage 的差异：去 geometricErrorCorrectionAmount（B 路径不用法线/几何误差校正）、
// albedoScale/ellipsoidRadii（A 路径 lighting 用）、cameraNear/cameraFar（改用 czm_readDepth +
// czm_windowToEyeCoordinates，Cesium 内置 log depth 处理）；exposure 固定→动态。

import {
  PostProcessStage,
  PostProcessStageComposite,
  PostProcessStageSampleMode,
  Cartesian3,
  Matrix3,
  Matrix4,
  Simon1994PlanetaryPositions,
  Transforms,
  JulianDate,
  Math as CesiumMath,
  PixelDatatype,
  PixelFormat,
  Texture,
  Sampler,
  TextureWrap,
  DeveloperError,
  type Context,
  type Scene,
  type Camera,
  type Ellipsoid
} from 'cesium'
import {
  buildAerialPerspectiveFragmentShader,
  type AerialPerspectiveFragOptions
} from './aerialPerspective.frag'
import { buildTonemapFragmentShader } from './tonemap.frag'
import { createLensFlareStage, type LensFlareLiveParams } from './lensFlare/createLensFlareStage'
import {
  INTENSITY_DEFAULT,
  THRESHOLD_LEVEL_DEFAULT,
  THRESHOLD_RANGE_DEFAULT,
  GHOST_AMOUNT_DEFAULT,
  HALO_AMOUNT_DEFAULT,
  CHROMATIC_ABERRATION
} from './lensFlare/lensFlareConstants'
import { getAltitudeCorrectionOffset } from '../math/altitudeCorrection'
import {
  ATMOSPHERE_BOTTOM_RADIUS_M,
  SUN_ANGULAR_RADIUS
} from '../math/atmosphereParameters'
import {
  computeMoonDirectionECEF,
  computeMoonFixedToECEFMatrix,
  computeMoonIlluminatedFractionFromDirections
} from '../celestial/celestialDirections'
import type { AtmosphereLUTs } from './lutLoader'
import { buildDepthTemporalFragmentShader } from './depthTemporal/depthTemporal.frag'
import {
  createHistoryState,
  getHistoryBridge,
  sanityCheckOutputTexture,
  getWriteTexture,
  swapHistory,
  buildBlitCommand,
  buildHistoryFBO,
  type HistoryState
} from './depthTemporal/historyBlit'
import { computeTemporalAlpha, computeMaxDelta } from './depthTemporal/temporalAlpha'
import { DEPTH_THRESHOLD_DEFAULT, HIGH_ALPHA, LOW_ALPHA } from './depthTemporal/depthTemporalConstants'

// B 路径 options：天空/日盘宏开关 + 动态曝光参数。
export interface AtmosphereStageOptions extends AerialPerspectiveFragOptions {
  // 动态曝光（对齐源库 _getEffectiveAtmosphereExposure）：按相机当地太阳高度角在 day/night 插值。
  exposureFollowTimeline?: boolean // 默认 true；false 时用手动 exposure
  exposureDay?: number // 太阳高于晨昏带时的曝光（默认 1.5，源库默认值）
  exposureNight?: number // 太阳低于晨昏带时的曝光（默认 0.1）
  exposureTwilightAngleDegrees?: number // 晨昏过渡半角（默认 6°）：地平下 -angle 到地平上 +angle 间线性插值
  exposure?: number // 手动曝光（仅 exposureFollowTimeline=false 时生效）
  groundDim?: number // 地面反射衰减（finalColor=originalColor·trans·groundDim+inscatter，分离 exposure 压地面过曝）
  // 地面光色乘子（2026-09-01 影像×大气颜色同步，三专家评审定稿变体 1）：影像=正午白光快照，
  // 乘子=(sunIrr+skyIrr)/ATMOSPHERE.solar_irradiance 让影像随太阳高度/大气状态染色（日落橙红/夜近黑）。
  // groundLighting=1 启用（默认）；0=旧合成逐位等价（A/B 对照兼 CI 逃生门）。
  // groundNightAmbient：夜间环境底色 vec3（sun/sky 双归零后乘子→0，max() 地板接住；色调可折入，
  //   同 u_nightTint/u_moonTint 先例；默认 (0.55,0.62,0.78)——冷蓝夜面，量级按曝光链联算
  //   （exposure 0.1 预放大，工程评审 G3），视觉拍板后定稿）。
  // 注意：乘子开启时建议 demo 配 lighting=0——enableLighting 夜侧 N·L 置黑像素，乘法地板不可见，
  //   且硬晨昏线与乘子软过渡带（±0.27°）叠加出双重过渡（工程评审 G2/对抗审查 A 节）。
  groundLighting?: number
  groundNightAmbient?: Cartesian3
  debugMode?: number // u_debugMode
  disableHalfFloat?: boolean // URL ?hdr=0 强制 UNSIGNED_BYTE 兜底调试（跳过 HalfFloat 能力检测）
  // phase2b LensFlare（spec §5.9）：lensflare 作为第三 stage 插在 atmosphere 与 tonomap 之间。
  // lensFlare=false → 不创建 lensflare composite（phase2a 两 stage 行为，防回归）。
  // ?lensflare=0 运行时切换走 lensFlareStage.enabled=false（M1：非 setMode rebuild 15 子 stage）。
  lensFlare?: boolean // 默认 true
  lensFlareIntensity?: number // 总强度（默认 INTENSITY_DEFAULT）
  lensFlareThreshold?: number // 阈值电平（默认 THRESHOLD_LEVEL_DEFAULT）
  lensFlareGhost?: number // ghost 总强度（默认 GHOST_AMOUNT_DEFAULT）
  lensFlareHalo?: number // halo 总强度（默认 HALO_AMOUNT_DEFAULT）
  lensFlarePreBlur?: number // preBlur 软化核偏移倍数（ghost/halo 模糊半径，默认 1.0；>1 更糊，?lfPreBlur=N 调）
  distanceScale?: number // 散射距离缩放（方案 A，1.0=phase1 物理，>1 中近距散射强，建议 1.0-3.0，超 3 需评估 half-float 灾消）
  inscatterScale?: number // inscatter 放大（方案 B 远处白雾浓，1.0=phase1 物理，>1 远处雾浓，直接 ×inscatter 可超物理饱和）
  ditherScale?: number // input+display dithering 强度倍率（1.0=phase1 默认；>1 更强打散 inscatterScale 放大 ACES 输入暴露的 banding，但噪声增）
  // limb outer glow（太空视角大气边缘向外扩散辉光）：消除 Bruneton GetSkyRadiance 在 topR 硬切的 limb 圆弧。
  // limbGlowIntensity 默认 0.3（?limbGlow=N 调强度，0=关）；limbGlowDecayKm 默认 30（?limbDecay=N 调扩散范围 km）。
  limbGlowIntensity?: number
  limbGlowDecayKm?: number
  // depthTemporal EMA 参数化（Task 12 URL ?temporalQuality=/?depthThreshold=/?temporalEma=）：
  // temporalEma 默认 true（HDR 设备 EMA 消抖）；?temporalEma=0 → false（depthTemporal 走 enabled=false
  //   透传 vec4(sceneColor, curLogDepth)，不 EMA；atmosphere 读 .a=raw log-depth 仍有效，回退 Task 9 前
  //   czm_readDepth 等效行为）。HDR 时 stage 仍创建（透传），仅 UNSIGNED_BYTE 完全跳过 stage。
  temporalEma?: boolean
  temporalLowAlpha?: number // 静止强平滑 alpha（默认 LOW_ALPHA=0.05；?temporalQuality=high → 0.1 弱平滑减拖影）
  temporalHighAlpha?: number // 移动偏 current alpha（默认 HIGH_ALPHA=0.5；?temporalQuality=high → 0.8）
  temporalDepthThreshold?: number // log-depth 相对阈值（默认 DEPTH_THRESHOLD_DEFAULT=0.1，距离无关容差 ≈ 7% 距离变化）
  // depthTemporal stage 创建开关（Phase 1.1，URL ?depthTemporal=1）：默认 false（Phase 1.1 升级，
  // 不创建 stage 省 1 全屏 HalfFloat pass + 1 全屏 copy + 3 张全分辨率 HF RT；atmosphere 不消费 .a
  // （hdrDepthTemporal:false）、occlusion 回退 scene globe depth（temporalEmaEnabled=false）跳过安全。
  // 真实 GPU profile 实测 depthTemporal+blit ≈ 2-6ms/帧，移除收益确定）。true → HDR 设备创建 stage，
  // lensflare occlusion 用 smoothDepth（?depthTemporal=1 恢复旧行为）。评审 M1/M7。
  depthTemporal?: boolean
  /**
   * M5 云 god rays atmosphere 路径（2026-08-17 spec r1 修订）：clouds march 视线 shadowLength
   * 纹理的 bridge 闭包（{_texture,_target}——Primitive MRT 纹理喂 PostProcessStage 必须 bridge，
   * spec 附录 F4）。返回 undefined（云未开/lightShafts 关）时天空 shadow_length=0（零回归）；
   * 桥存在 → shader define CLOUDS_SHADOW_LENGTH + u_cloudsShadowLength 绑定 → 天空 inscatter
   * 被云影调制 = 太阳周围放射状光柱（云内 applyAerialPerspective 路径只产生 subtle 调制）。
   */
  cloudsShadowLengthBridge?: () => { _texture: unknown; _target: number } | undefined
  /**
   * lf×云交互 #1（2026-08-30）：云覆盖率 bridge 透传 createLensFlareStage——lf occlusion 36 点
   * 采样叠加云遮挡（太阳被云挡时 halo/ghost 按覆盖率衰减，不再穿透云层）。云 march att0
   * premultiplied 输出（.a=覆盖率）。不传（云未开）→ occlusion 不编译云采样（零回归）。
   */
  cloudsOcclusionBridge?: () => { _texture: unknown; _target: number } | undefined
  // ── 月盘（2026-08-30 夜间光照 spec r2 §5）──
  // moon?: boolean 继承自 AerialPerspectiveFragOptions（默认 true；创建期语义：切换=重建 stage，
  // 同 sun/sky 惯例，运行时切换不在范围）。
  /** 月盘亮度倍率（默认 1546=774×(0.014/0.0099)²——ω 拍板 0.014 后同式保显示亮度；URL ?moonRadiance=。
   *  亮度语系沿革：60=inscatterScale 补偿×diffuse 基准 → 1440=×12「与现实月面亮度一致」（2026-08-30
   *  用户拍板，带 lf 光晕）→ 7111（ω=0.03 联动）→ 3160（2026-08-31 ω=0.02 联动「65px 偏大」）→
   *  160（2026-09-01 ω=0.0045 物理值联动「恢复正常大小」）→ 774（同日 ω×2.2「过小放大」联动）→
   *  1546（同日 ω 定稿 0.014 联动）。副作用：白天浅月同比变化（待观感)）。 */
  moonRadianceScale?: number
  /** 月盘角半径 rad（默认 0.014=物理值×3.1，2026-09-01 用户验收档位后定稿（0.0099 的 12px 仍
   *  偏小→0.014，~17px 盘径,月海纹理可辨）。沿革 0.0135(×3)→0.03(×6.7)→0.02(×4.4)→
   *  0.0045(物理)→0.0099(×2.2)→0.014(×3.1)。URL ?moonAngularRadius= 再调）。 */
  moonAngularRadius?: number
  /** 月盘色调乘子（线性 RGB，2026-08-31 用户反馈月盘偏暖——solar_irradiance 光谱基色+NASA
   *  纹理偏棕，实测 R/G=1.119 B/G=0.905。默认冷蓝 (0.72,1,1.32)（2026-08-31 用户三档拍板：
   *  中性白 0.78,1,1.25 与轻冷 0.88,1,1.12 备选，冷蓝胜出——清冷月光/夜空氛围）；(1,1,1)=中性
   *  零回归路径。URL ?moonTint=r,g,b 再调）。 */
  moonTint?: Cartesian3
  /**
   * 月面纹理（2026-08-30 月面纹理任务）：equirect 月面图（上游 NASA Moon Kit color_large 2048×1024），
   * demo 加载后传入。采样 albedo 乘进 Oren-Nayar（月海暗/高地亮）；**纹理均值须由调用方折入
   * moonRadianceScale**（保总亮度只加图案）。不传 → 内部绑 1×1 白 dummy（albedo=1 数值等价
   * 无纹理版，零回归路径）。纹理翻转轴若与真实月海镜像，调 GLSL moonUv（验收视觉核对）。
   */
  moonSurfaceTexture?: Texture
  /**
   * 月晕（月光天空散射，2026-09-01 用户反馈「月亮周围缺少光晕」）：月亮把月盘周围天空
   * 照亮的柔光增亮（物理：朝月向大气散射 ×2.5e-6×月相，Mie 前向峰使月盘邻近更亮、低仰角
   * 偏红、月落渐熄）。默认 200000（2026-09-01 用户定稿：沿革 75000 微光/125000 柔光清晰/
   * 150000「再稍微强烈」/200000✓饱满——接受夜空微灰代价）；0=关（夜间像素零变化）。
   * URL demo ?moonGlow=。白天由 shader 内 nightFactor 门归零（像素级零回归）。
   */
  moonSkyGlowScale?: number
}

// 校验后的完整 options（hdrDepthTemporal 排除：runtime 基于 stageCreated 决定，非用户 option；buildAtmosphereStage 时注入）。
// cloudsShadowLength 排除同 hdrDepthTemporal：runtime 由 cloudsShadowLengthBridge 存在决定（buildAtmosphereStage 注入）。
export interface ResolvedAtmosphereStageOptions
  extends Required<Omit<AerialPerspectiveFragOptions, 'hdrDepthTemporal' | 'cloudsShadowLength'>> {
  exposureFollowTimeline: boolean
  exposureDay: number
  exposureNight: number
  exposureTwilightAngleDegrees: number
  exposure: number
  groundDim: number
  groundLighting: number
  groundNightAmbient: Cartesian3
  debugMode: number
  // phase2b LensFlare resolved 字段（spec §5.9）
  lensFlare: boolean
  lensFlareIntensity: number
  lensFlareThreshold: number
  lensFlareGhost: number
  lensFlareHalo: number
  lensFlarePreBlur: number
  distanceScale: number
  inscatterScale: number
  ditherScale: number
  // limb outer glow resolved（太空视角大气边缘扩散辉光）
  limbGlowIntensity: number
  limbGlowDecayKm: number
  // depthTemporal temporal* resolved（Task 12）
  temporalEma: boolean
  temporalLowAlpha: number
  temporalHighAlpha: number
  temporalDepthThreshold: number
  // depthTemporal stage 创建开关 resolved（Phase 1.1）
  depthTemporal: boolean
  // 月面纹理 resolved（undefined=未传，运行时绑白 dummy）
  moonSurfaceTexture: Texture | undefined
  // 月盘 resolved（moon 经 Required<AerialPerspectiveFragOptions> 传入本类型）
  moonRadianceScale: number
  moonAngularRadius: number
  moonTint: Cartesian3
  // 月晕 resolved（月光天空散射倍率；0=关）
  moonSkyGlowScale: number
}

// 每帧可变状态：preRender 原地更新，uniform 闭包持引用读取。
export interface AtmosphereFrameState {
  sunDirection: Cartesian3
  /** 月方向（ECEF 单位向量，spec r2 §4：含视差修正，preRender 每帧更新）。 */
  moonDirection: Cartesian3
  /** 月固系→ECEF 旋转（月面纹理投影，preRender 每帧更新；uniform 侧传其转置）。 */
  moonFixedToECEF: Matrix3
  /** 月相照明分数 f（朔 0/弦 0.318/望 1；月晕调制用，preRender 由两方向 dot 即得）。 */
  moonIlluminatedFraction: number
  altitudeCorrection: Cartesian3
  exposure: number
}

// 相对亮度（relative luminance）常量，照搬 Phase 0 SkyStage：
// 源 sky.frag 输出 GetSkyLuminance 不做曝光，uniform 必须传 relative 版本
// = sunRadianceToLuminance / sunLuminance，sunLuminance ≈ 75722.23。
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
 * 动态曝光：按相机当地太阳高度角在 exposureNight/exposureDay 之间线性插值（移植源库
 * _getEffectiveAtmosphereExposure）。太阳在地平下 twilightAngle 到地平上 twilightAngle 之间
 * 从 night 线性升到 day，解决日夜固定曝光的过曝/欠曝。
 *
 * 太阳高度角 = asin(dot(sunDirection, up))，up 为相机处 WGS84 测地法向（ECEF）。
 * 纯函数：node 单测可直接断言（正午≈day、午夜≈night、晨昏介于之间）。
 */
export function getEffectiveAtmosphereExposure(
  cameraPositionWC: Cartesian3,
  ellipsoid: Ellipsoid,
  sunDirection: Cartesian3,
  exposureDay: number,
  exposureNight: number,
  twilightAngleDegrees: number
): number {
  const surface = ellipsoid.scaleToGeodeticSurface(cameraPositionWC, exposureSurfaceScratch)
  if (surface == null) return exposureDay
  // 测地法向（ECEF）：∇F/|∇F|，F=(x/a)²+(y/b)²+(z/c)²-1 → ∇F ∝ (x/a²,y/b²,z/c²)
  const up = Cartesian3.divideComponents(
    surface,
    ellipsoid.radiiSquared,
    exposureNormalScratch
  )
  // 防御：cameraPositionWC 极端（NaN/原点，如相机 morph/underground 瞬态）时 up 退化，
  // Cesium normalize 对 0/NaN 抛 DeveloperError 并中断渲染。检查 magnitude 兜底返回默认曝光。
  const upMag = Cartesian3.magnitude(up)
  if (!Number.isFinite(upMag) || upMag < 1e-15) return exposureDay
  Cartesian3.normalize(up, up)
  const sinEl = CesiumMath.clamp(Cartesian3.dot(sunDirection, up), -1.0, 1.0)
  const elevDeg = CesiumMath.toDegrees(Math.asin(sinEl))
  const half = twilightAngleDegrees
  const t = CesiumMath.clamp((elevDeg - -half) / (2.0 * half), 0.0, 1.0)
  return exposureNight + t * (exposureDay - exposureNight)
}

const exposureSurfaceScratch = new Cartesian3()
const exposureNormalScratch = new Cartesian3()
// 月方向视差修正 origin scratch（preRender 每帧：camera.positionWC + altitudeCorrection）
const moonOriginScratch = new Cartesian3()
const moonFixedInvScratch = new Matrix3()

/**
 * 校验并补全 options。
 */
export function validateAtmosphereOptions(
  options: AtmosphereStageOptions = {}
): ResolvedAtmosphereStageOptions {
  return {
    sun: options.sun ?? true,
    sky: options.sky ?? true,
    exposureFollowTimeline: options.exposureFollowTimeline ?? true,
    exposureDay: options.exposureDay ?? 1.2,
    exposureNight: options.exposureNight ?? 0.1,
    exposureTwilightAngleDegrees: options.exposureTwilightAngleDegrees ?? 6,
    exposure: options.exposure ?? 1.5,
    groundDim: options.groundDim ?? 0.43,
    // 地面光色乘子默认（2026-09-01 影像×大气同步）：1=启用；groundDim 默认 0.5→0.43 重标——
    // 正午乘子≈1.0-1.15（直射透射+天光占比），须压回与旧合成同量级（工程评审 E 节；?groundDim=
    // 显式传值不受默认影响）。
    groundLighting: options.groundLighting ?? 1.0,
    // 夜间环境底色冷蓝（太阳沉没 >5° 后乘子精确归零，max() 地板接住；量级 0.55-0.78 按曝光链
    // 预放大——夜间 exposure≈0.1，实际显示亮度≈0.06-0.08×ACES，工程评审 G3；三视角验收拍板后定稿）
    groundNightAmbient: options.groundNightAmbient ?? new Cartesian3(0.55, 0.62, 0.78),
    debugMode: options.debugMode ?? 0,
    // phase2b LensFlare 默认（spec §5.9）：透传 lensFlareConstants 标定值。
    lensFlare: options.lensFlare ?? true,
    lensFlareIntensity: options.lensFlareIntensity ?? INTENSITY_DEFAULT,
    lensFlareThreshold: options.lensFlareThreshold ?? THRESHOLD_LEVEL_DEFAULT,
    lensFlareGhost: options.lensFlareGhost ?? GHOST_AMOUNT_DEFAULT,
    lensFlareHalo: options.lensFlareHalo ?? HALO_AMOUNT_DEFAULT,
    lensFlarePreBlur: options.lensFlarePreBlur ?? 3.0, // 默认 3.0（用户验收：ghost 模糊效果与半径加大）
    distanceScale: options.distanceScale ?? 1.0, // 默认 1.0 = phase1 行为零回归
    inscatterScale: options.inscatterScale ?? 8.0, // 2026-09-02 用户定稿 25→8（近景海景视角实测）；URL ?inscatterScale=1 回退 phase1 物理量级、=25 回退旧默认
    ditherScale: options.ditherScale ?? 1.0, // 默认 1.0 = phase1 dithering ±1.5/255 零回归
    // limb outer glow 默认（太空视角大气边缘扩散辉光）：intensity 1.0 线性域（独立加 finalColor，不 ×inscatterScale）、decay 30km 扩散范围，URL ?limbGlow/?limbDecay 调
    limbGlowIntensity: options.limbGlowIntensity ?? 1.0,
    limbGlowDecayKm: options.limbGlowDecayKm ?? 30.0,
    // M5 云 god rays 增益默认 1（物理精确 subtle 对齐 three；demo ?cloudsGodRays= 艺术放大出可见光柱）
    cloudsGodRaysGain: options.cloudsGodRaysGain ?? 1.0,
    // 月盘默认 true（2026-08-30 夜间光照 spec r2 §5；moon?: boolean 经 Required 传入本 resolved 类型，
    // 缺行会 tsc 报 TS2741——T3 接线在此之上追加 moonDirection/moonAngularRadius/u_moonRadiance uniforms）
    moon: options.moon ?? true,
    // 月盘亮度/角半径默认（2026-08-30/09-01 用户视觉拍板沿革）：radiance 1440=「与现实月面亮度一致」（×12，
    // 带 lf 光晕）；ω 0.0135→0.03（环形山可见需 ≥65px）→0.02（「65px 有点大」二次拍板，~45px 月海仍清晰）
    // →0.0045（2026-09-01「恢复正常大小」物理值，~5-6px）→0.0099（同日「过小放大 2.2 倍」，~12px）
    // →0.014（同日验收档位后定稿，~17px 月海可辨）。
    // radiance ∝ 1/ω²（shader 2.5e-6/(π·ω²)），ω 改默认时 radiance 默认同步 ×(ω_new/ω_old)² 保显示亮度：
    // 1440×(0.03/0.0135)²≈7111→×(0.02/0.03)²≈3160→×(0.0045/0.02)²≈160→×2.2²≈774→×(0.014/0.0099)²≈1546。
    moonRadianceScale: options.moonRadianceScale ?? 1546,
    moonAngularRadius: options.moonAngularRadius ?? 0.014,
    // 月盘色调默认冷蓝（2026-08-31 用户反馈偏暖——solar_irradiance 光谱+NASA 纹理偏棕，实测
    // R/G=1.119 B/G=0.905；三档拍板冷蓝胜出：清冷月光/夜空氛围。中性白=0.78,1,1.25、轻冷=0.88,1,1.12）
    moonTint: options.moonTint ?? new Cartesian3(0.72, 1.0, 1.32),
    moonSurfaceTexture: options.moonSurfaceTexture,
    // 月晕默认 200000（2026-09-01 用户定稿：75000 微光克制/125000 柔光清晰/150000「再稍微强烈」
    // /200000✓饱满（接受夜空微灰）；满月深夜实测 200000 紧邻盘缘峰值≈33/255）
    moonSkyGlowScale: options.moonSkyGlowScale ?? 200000,
    // depthTemporal temporal* 默认（Task 12）：透传 depthTemporalConstants 标定值。
    temporalEma: options.temporalEma !== false, // 默认 true（!== false 让 undefined 也 true；仅显式 false 关闭 EMA）
    temporalLowAlpha: options.temporalLowAlpha ?? LOW_ALPHA,
    temporalHighAlpha: options.temporalHighAlpha ?? HIGH_ALPHA,
    temporalDepthThreshold: options.temporalDepthThreshold ?? DEPTH_THRESHOLD_DEFAULT,
    depthTemporal: options.depthTemporal === true // 默认 false（Phase 1.1 升级：不创建 stage 省 1 全屏 pass+blit+3 HF RT；?depthTemporal=1 显式开。atmosphere 不消费 .a，occlusion 回退 scene globe depth）
  }
}

/**
 * PostProcessStage RT 所需的 WebGL 浮点能力子集（Cesium Context 运行时持有，但 Scene.context 及这些
 * capability 字段不在公开类型里——这里声明用到的最小集合做受控访问）。
 */
interface PostProcessGpuContextCaps {
  halfFloatingPointTexture: boolean
  colorBufferHalfFloat: boolean
  floatingPointTexture: boolean
  colorBufferFloat: boolean
}

/**
 * 检测 PostProcessStage 可用的最高 HDR 像素数据类型（对齐 cesium-clouds-atmosphere AtmospherePostProcess）。
 *
 * atmosphere stage 需 HDR 中间 RT 承载 finalColor·exposure 的线性 >1 段（供链尾 tonemap 做 ACES 压缩）。
 * HALF_FLOAT 优先（精度够 + 性能好 + 32-bit color buffer 罕见）；FLOAT 次选；UNSIGNED_BYTE 兜底（>1 被 clip，
 * tonemap debug=7 false-color 会显示暗区，可证伪 HDR 链是否生效）。
 *
 * WebGL2 下 halfFloatingPointTexture 恒 true（管 RGBA16F 采样），colorBufferHalfFloat 实测
 * EXT_color_buffer_float（覆盖 RGBA16F renderable）。两者配合覆盖采样 + 渲染两端：缺任一则不能作 RT。
 *
 * 纯函数：node 单测 mock context 即可断言三分支。
 */
export function resolvePostHdrDatatype(scene: Scene): PixelDatatype {
  // Scene.context 运行时存在但不在公开类型——同 demo/main.ts 的访问方式，受控 cast。
  const ctx = (scene as unknown as { context: PostProcessGpuContextCaps }).context
  // HALF_FLOAT：采样（halfFloatingPointTexture）+ 渲染目标（colorBufferHalfFloat）须同时支持。
  if (ctx.halfFloatingPointTexture && ctx.colorBufferHalfFloat) {
    return PixelDatatype.HALF_FLOAT
  }
  // FLOAT：32-bit color buffer + 32-bit 采样（更罕见，但某些桌面 GPU 支持全精度浮点链）。
  if (ctx.colorBufferFloat && ctx.floatingPointTexture) {
    return PixelDatatype.FLOAT
  }
  return PixelDatatype.UNSIGNED_BYTE
}

/**
 * 构建 PostProcessStage 的 uniforms（覆盖 AERIAL_PERSPECTIVE_UNIFORM_NAMES 全部）。
 * 每帧量（sunDirection/altitudeCorrection/exposure）走闭包；静态量传值。
 * 纯函数：不实例化 PostProcessStage，node 单测可直接断言。
 */
export function buildAtmosphereUniforms(
  luts: AtmosphereLUTs,
  options: ResolvedAtmosphereStageOptions,
  state: AtmosphereFrameState
): Record<string, unknown> {
  return {
    SUN_SPECTRAL_RADIANCE_TO_LUMINANCE: SUN_SPECTRAL_RADIANCE_TO_LUMINANCE,
    SKY_SPECTRAL_RADIANCE_TO_LUMINANCE: SKY_SPECTRAL_RADIANCE_TO_LUMINANCE,
    transmittance_texture: () => luts.transmittance,
    scattering_texture: () => luts.scattering,
    single_mie_scattering_texture: () => luts.scattering, // COMBINED 模式不采样，传同值占位
    irradiance_texture: () => luts.irradiance,
    higher_order_scattering_texture: () => luts.higherOrderScattering, // C9：云 god rays 防过暗（HAS_HIGHER_ORDER_SCATTERING_TEXTURE 分支）
    sunDirection: () => state.sunDirection,
    // 月方向闭包（preRender 每帧更新）；ω/radiance 静态值。moon=false 时 shader 无这三件声明，
    // Cesium 静默忽略（同 u_cloudsGodRaysGain 先例，无条件绑定零分支）
    moonDirection: () => state.moonDirection,
    moonAngularRadius: options.moonAngularRadius,
    u_moonRadiance: options.moonRadianceScale,
    u_moonTint: options.moonTint,
    // 月面纹理（月固系矩阵每帧转置到 scratch；纹理/白 dummy 由 createAtmosphereStage 内 append）
    u_moonFixedToECEFInv: () => Matrix3.transpose(state.moonFixedToECEF, moonFixedInvScratch),
    u_moonSurface: options.moonSurfaceTexture,
    // 月晕（月光天空散射）：倍率静态（0=关——shader if 分支全屏一致零成本）；月相分数闭包
    //（preRender 由 state 两方向 dot 即得）。moon=false 时 shader 无声明，Cesium 静默忽略。
    u_moonSkyScale: options.moonSkyGlowScale,
    u_moonIlluminatedFraction: () => state.moonIlluminatedFraction,
    altitudeCorrection: () => state.altitudeCorrection,
    exposure: () => state.exposure, // 动态（preRender 更新）
    u_debugMode: options.debugMode,
    u_groundDim: options.groundDim,
    // 地面光色乘子（2026-09-01 影像×大气同步）：u_groundLighting 开关 + u_groundNightAmbient
    // 夜间环境底（FRAME_UNIFORMS 无条件声明；Cesium uniformMap 传 Cartesian3 → vec3）
    u_groundLighting: options.groundLighting,
    u_groundNightAmbient: options.groundNightAmbient,
    u_distanceScale: options.distanceScale,
    u_inscatterScale: options.inscatterScale,
    u_limbGlowIntensity: options.limbGlowIntensity,
    u_limbGlowDecayKm: options.limbGlowDecayKm,
    // M5 云 god rays 增益：CLOUDS_SHADOW_LENGTH 未 define 时 shader 无此 uniform，Cesium 静默忽略（同 clouds 三参数先例）
    u_cloudsGodRaysGain: options.cloudsGodRaysGain,
    // u_ditherScale 不传：aerialPerspective.frag 回退到 363e441（input dithering 用固定 1.5/255，无 uniform）。
    // display dithering 的 u_ditherScale 仍在 tonomapStage 消费（?ditherScale= 仍有效）。
    cosSunAngularRadius: Math.cos(SUN_ANGULAR_RADIUS)
  }
}

// M5 atmosphere 路径：clouds shadowLength bridge → atmosphere uniform 表增量。
// ⚠️ Cesium UniformSampler.set 读 value._target——闭包返回 undefined 会炸（实测：atmosphere
// 先建、clouds 后异步就绪的首帧窗口）。故包装为「桥 undefined 时回退 1×1 黑 dummy」——采样
// 得 0 = 无云影，与不 define 的零回归语义一致。
function appendCloudsShadowLengthUniform(
  uniforms: Record<string, unknown>,
  bridge: (() => { _texture: unknown; _target: number } | undefined) | undefined,
  dummyBridge: () => { _texture: unknown; _target: number }
): void {
  if (bridge != null) {
    uniforms.u_cloudsShadowLength = () => bridge() ?? dummyBridge()
  }
}

/**
 * 运行时 LensFlare 增量更新（2026-09-05 live 参数迭代）：setLensFlare 入参，全部可选。
 * 只更新传入字段对应 stage uniform + resolved 快照，**不**销毁重建 15 子 stage 树——
 * 重建会命中 Cesium PostProcessStage stage-name textureCache 陈旧条目，重建后 flare 输出丢失。
 */
export interface AtmosphereLensFlareUpdate {
  /** 整体开关（切 lensflare composite.enabled，非 rebuild）。 */
  enabled?: boolean
  /** 总强度（spec §5.6）。 */
  intensity?: number
  /** 阈值电平（spec §5.1）。 */
  thresholdLevel?: number
  /** ghost 总强度（spec §5.4）。 */
  ghostAmount?: number
  /** halo 总强度（spec §5.4）。 */
  haloAmount?: number
  /** preBlur 软化核偏移倍数（spec §5.4）。 */
  preBlurRadius?: number
}

export interface AtmosphereStageHandle {
  readonly atmosphereStage: PostProcessStage
  /**
   * depthTemporal EMA stage（activeStages[0]，atmosphere 前）。HDR 设备（postHdrDatatype !== UNSIGNED_BYTE）
   * 时创建；UNSIGNED_BYTE / disableHalfFloat 时 undefined（无 float history RT，整个 stage 跳过）。
   * temporalEma=false（?temporalEma=0）时 stage 仍创建走 enabled=false 透传（不 EMA，atmosphere 读
   * .a=raw log-depth 仍有效）。Task 7 装配；Task 8 lifecycle；Task 12 参数化（temporalEma/alpha/threshold）。
   */
  readonly depthTemporalStage?: PostProcessStage
  /** EMA 是否真正运行（= HDR 且 temporalEma option=true）。false 时 stage 可能仍存在（透传模式）。 */
  readonly temporalEmaEnabled: boolean
  /** phase2b LensFlare 外层 non-series composite（lensFlare=false 时 undefined）。 */
  readonly lensFlareStage?: PostProcessStageComposite
  readonly tonemapStage: PostProcessStage
  readonly postHdrDatatype: PixelDatatype
  /**
   * 把外部 stage 插入 atmosphere 与 lensFlare 之间（云 overlay 线性域合成用，v2.1 spec §5.1）。
   * 语义：入口拒已销毁/已 add 的 stage（抛错）；同实例未销毁幂等 no-op；不同实例替换；
   * 尽力回滚（失败撤插入物 + 重建 lf/tm，回滚自身失败保原始异常）；destroy 后 no-op+warn；
   * lensFlare 不存在时只重排 tonemap；rebuild 的 lf 继承旧 enabled。
   * 摘除由 stage 拥有者自行 removeAndDestroy——摘除后链自动闭合（lf 紧贴 atmosphere）。
   * 限制：setMode（dead code）在插入后行为未定义（其已有顺序 TODO）。
   */
  insertStageBeforeLensFlare(stage: PostProcessStage | PostProcessStageComposite): void
  /**
   * 运行时更新 LensFlare 参数（2026-09-05 live 迭代）：改 stage uniform + resolved/live 快照，
   * 不销毁重建（重建命中 stage-name textureCache 陈旧条目 → flare 丢失）。demo 滑块直接调本方法。
   * 语义：
   * - stage 已存在：参数原地更新（uniform 读 live 快照每帧最新值）；enabled 切 composite.enabled。
   * - stage 未存在但 enabled 显式 true：按需重挂创建（摘 tonemap → create+add lf → rebuild tonemap）。
   * - stage 未存在且无 enabled true：仅更新 resolved/live 快照（下次 rebuild 生效），no-op 安全。
   */
  setLensFlare(update: AtmosphereLensFlareUpdate): void
  setMode(newOptions: AtmosphereStageOptions): void
  /** 注入 depthTemporal postRender blit 的计时 hook（Phase 0 profiling，demo ?profile=1 用）。 */
  setBlitTimerHook(hook: ((fn: () => void) => void) | undefined): void
  destroy(): void
}

/**
 * 创建大气透视 PostProcessStage 并加入 scene.postProcessStages。
 * preRender 每帧更新 sunDirection/altitudeCorrection/exposure（动态）。
 */
export function createAtmosphereStage(
  scene: Scene,
  luts: AtmosphereLUTs,
  options: AtmosphereStageOptions = {}
): AtmosphereStageHandle {
  let resolved = validateAtmosphereOptions(options)

  // lensFlare live 参数快照（2026-09-05 live 迭代）：createLensFlareStage 的 uniform 以闭包读本对象
  // 每帧最新值。demo 滑块 → handle.setLensFlare → 原地改本快照 + resolved，实时生效，不销毁重建
  // （重建命中 stage-name textureCache 陈旧条目 → 重建后 flare 输出丢失）。thresholdRange/
  // chromaticAberration 无 AtmosphereStage option 透传，钉 lensFlareConstants 默认（与未传一致）。
  // setMode rebuild 的 lensFlarePreBlur 默认 3.0（resolved 已归一），此处取 resolved 当前值。
  const lensFlareLive: LensFlareLiveParams = {
    intensity: resolved.lensFlareIntensity,
    thresholdLevel: resolved.lensFlareThreshold,
    thresholdRange: THRESHOLD_RANGE_DEFAULT,
    ghostAmount: resolved.lensFlareGhost,
    haloAmount: resolved.lensFlareHalo,
    chromaticAberration: CHROMATIC_ABERRATION,
    preBlurRadius: resolved.lensFlarePreBlur
  }

  // depthTestAgainstTerrain=true：PostProcessStage depthTexture 拿真实地形 depth（B 路径合成需真实
  // sceneDist）。false 时 depth 走 DepthPlane（椭球面），山体像素 depth 被算到视线与椭球面的远交点
  // （地平线量级），transmittance 过低 + inscatter 主导 → 山体持续透明、能看到背后地平线大气散射
  // （用户实测「山体和大气散射地平线混合渲染在一起」）。true 下 B 路径 sceneDist=真实地形距离，山体
  // 不透明、空气透视正确。代价：瓦片异步加载期间未渲染区域 depth=1（与真天空同色 clearColor，无法用
  // 亮度区分），shader 改用视线方向判定（视线朝地球=未渲染地面透传原色 fallback；仅「未渲染山顶+视线
  // 朝上」无法与真天空区分，会短暂截断，加载完恢复——这是 Cesium globe 异步渲染的固有限制）。
  scene.globe.depthTestAgainstTerrain = true

  const ellipsoid = scene.globe.ellipsoid
  const state: AtmosphereFrameState = {
    sunDirection: new Cartesian3(0, 0, 1),
    moonDirection: new Cartesian3(0, 0, 1),
    moonFixedToECEF: Matrix3.clone(Matrix3.IDENTITY),
    moonIlluminatedFraction: 0,
    altitudeCorrection: new Cartesian3(),
    exposure: resolved.exposureDay
  }
  const sunInertialScratch = new Cartesian3()
  const icrfScratch = new Matrix3()

  // phase2a HDR 管线：一次性检测 atmosphere stage 中间 RT 可用的最高 HDR 像素类型。
  // HALF_FLOAT 优先（精度够 + 性能好），FLOAT 次选，UNSIGNED_BYTE 兜底。
  // options.disableHalfFloat=true 时跳过检测直接 UNSIGNED_BYTE（URL ?hdr=0 调试用：
  // 在 HalfFloat 设备上对比验证兜底路径——线性 >1 段被 clip，tonemap debug=7 false-color 显示暗区）。
  const postHdrDatatype = options.disableHalfFloat
    ? PixelDatatype.UNSIGNED_BYTE
    : resolvePostHdrDatatype(scene)

  // atmosphere stage：aerialPerspective fragment（Task 2 末端线性输出 finalColor·exposure）。
  // pixelDatatype=HalfFloat 带兜底让中间 RT 承载线性 >1 段，供链尾 tonemap ACES 压缩。
  function buildAtmosphereStage(): PostProcessStage {
    return new PostProcessStage({
      // 语义名：demo ?profile=1 逐 stage GPU 计时 JSON 输出键用（否则显示位置名 stageN）。
      name: 'atmosphere',
      // Bug3 暂时禁用（hdrDepthTemporal: false）：EMA reproject 错误（专家3 C3，raw worldPos 抖 → prevUV 抖 →
      // history 采错 → smoothLogDepth 错乱 → debug=5 地球切割 + 水波纹未消）。?temporalEma=0 验证：切割消失，
      // 水波纹仍在（=波纹非时序抖，EMA 整个 temporal 路线无效）。回退 raw depth（UNSIGNED_BYTE 变体 +
      // Bug1 czm_reverseLogDepthWindow 反演）。待查波纹真根因（sceneDist 等值线 inscatter 量化阶梯）。
      fragmentShader: buildAerialPerspectiveFragmentShader({
        ...resolved,
        hdrDepthTemporal: false,
        cloudsShadowLength: options.cloudsShadowLengthBridge != null
      }),
      uniforms: (() => {
        const u = buildAtmosphereUniforms(luts, resolved, state)
        // dummy 1×1 黑（shadowLength=0）——桥未就绪帧的回退。惰性构造：真 GL 环境的 uniform
        // 闭包每帧调（首次构造 dummy），node 测试不调闭包（maximumTextureSize=0 会炸）
        let cloudsShadowDummy: Texture | undefined
        appendCloudsShadowLengthUniform(u, options.cloudsShadowLengthBridge, () => {
          cloudsShadowDummy ??= new Texture({
            context: (scene as unknown as { context: Context }).context,
            source: { width: 1, height: 1, arrayBufferView: new Uint8Array([0, 0, 0, 255]) },
            pixelFormat: PixelFormat.RGBA,
            pixelDatatype: PixelDatatype.UNSIGNED_BYTE
          })
          return cloudsShadowDummy as unknown as { _texture: unknown; _target: number }
        })
        // 月面纹理白 dummy（albedo=1）：moonSurfaceTexture 未传时的零回归路径（均匀月面=数值等价
        // 无纹理版）。惰性构造同上（node 测试不调闭包）。
        if (options.moonSurfaceTexture == null) {
          let moonSurfaceDummy: Texture | undefined
          u.u_moonSurface = () => {
            moonSurfaceDummy ??= new Texture({
              context: (scene as unknown as { context: Context }).context,
              source: { width: 1, height: 1, arrayBufferView: new Uint8Array([255, 255, 255, 255]) },
              pixelFormat: PixelFormat.RGBA,
              pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
              sampler: new Sampler({ wrapS: TextureWrap.CLAMP_TO_EDGE, wrapT: TextureWrap.CLAMP_TO_EDGE })
            })
            return moonSurfaceDummy
          }
        }
        return u
      })(),
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: postHdrDatatype
    })
  }
  // tonemap stage：链尾 ACES + gamma 1/2.2 + display triangular dithering → RGBA8 display。
  // sampleMode 显式 NEAREST——保护 atmosphere 的 input dithering 经 HalfFloat RT 中转逐像素直通；
  // 若上游默认值变更或改 LINEAR，会插值抹掉 dither 噪声 → 水波纹回归。默认 RGBA8 兜底（display ready）。
  function buildTonemapStage(): PostProcessStage {
    return new PostProcessStage({
      name: 'tonemap', // 语义名：demo ?profile=1 计时输出键用
      fragmentShader: buildTonemapFragmentShader(),
      uniforms: { u_debugMode: resolved.debugMode, u_ditherScale: resolved.ditherScale }, // 与 atmosphere 同源；setMode rebuild 同步
      sampleMode: PostProcessStageSampleMode.NEAREST // 显式钉死（防上游默认变更；保护 input dithering 经 RT 中转）
    })
  }

  // depthTemporal EMA（Task 7）：复用 atmosphere 同套 HDR 检测。UNSIGNED_BYTE → 跳过（无 float history RT，
  // EMA 在 8-bit 量化 depth 上无意义且灾消），回退现状（仅 atmosphere → lensflare → tonomap）。
  //
  // Task 12 参数化：拆分两个判定——
  // - stageCreated：HDR 设备才创建 depthTemporal stage（UNSIGNED_BYTE 完全跳过，无 float history RT）。
  // - temporalEmaEnabled：stage 创建且 temporalEma option=true 时 EMA 真正运行。控制 lensFlare occlusion
  //   depth 源（temporalEmaEnabled 时同源 czm_depth_temporal smoothDepth.a；否则 scene globe depth）+ handle 标志。
  // temporalEma=false（HDR）时 stage 仍创建走 enabled=false 透传（vec4(sceneColor, curLogDepth)），atmosphere
  //   读 .a=raw log-depth 仍有效（Task 9 移除 czm_readDepth 依赖 depthTemporal 打包 .a；若 stage 不创建则
  //   atmosphere 读 scene alpha 无意义）。passthrough .r=sceneColor 非 depth，故 lensFlare occlusion 此时
  //   必须回退 scene globe depth（temporalEmaEnabled=false → undefined）。
  const stageCreated = postHdrDatatype !== PixelDatatype.UNSIGNED_BYTE && resolved.depthTemporal
  const temporalEmaEnabled = stageCreated && resolved.temporalEma

  // phase2b LensFlare（spec §5.9）：外层 non-series composite，插在 atmosphere 与 tonomap 之间。
  // lensFlare=false → 不创建（phase2a 两 stage 行为，防回归）。
  // ?lensflare=0 运行时切换走 lensFlareStage.enabled=false（M1：非 setMode rebuild 15 子 stage），
  // 由上层（demo main.ts）持 handle 直接设；stage 仍 add 在集合中，透传 atmosphere 输出。
  // Task 10：temporalEmaEnabled 时 occlusion 同源 depthTemporal smoothDepth（depthTexture 指向
  // 'czm_depth_temporal'，与 atmosphere 同源 EMA 消抖）；UNSIGNED_BYTE 兜底 occlusion 用 scene globe depth。
  let lensFlareStage: PostProcessStageComposite | undefined
  if (resolved.lensFlare) {
    const lfHandle = createLensFlareStage(
      scene,
      state,
      {
        intensity: resolved.lensFlareIntensity,
        thresholdLevel: resolved.lensFlareThreshold,
        ghostAmount: resolved.lensFlareGhost,
        haloAmount: resolved.lensFlareHalo,
        preBlurRadius: resolved.lensFlarePreBlur,
        live: lensFlareLive, // 2026-09-05：uniform 读 live 每帧最新值（滑块实时调参免 rebuild）
        cloudsOcclusionBridge: options.cloudsOcclusionBridge // lf×云 #1 透传（云未开=undefined 零回归）
      },
      temporalEmaEnabled ? 'czm_depth_temporal' : undefined
    )
    lensFlareStage = lfHandle.lensflareComposite
  }

  let depthTemporalStage: PostProcessStage | undefined
  let historyState: HistoryState | undefined
  // prevViewProjection / temporalAlpha 初始值（Task 8 lifecycle 每帧更新：postRender 写本帧 VP、
  // preRender 算 motion→alpha）。Task 7 只接线 uniforms 函数形式，值由 Task 8 更新即生效。
  // !!Task 8 lifecycle 注意：reassign prevViewProjection 时用 new Matrix4() 作 result（如
  // prevViewProjection = Matrix4.multiply(proj, view, new Matrix4())），勿 in-place mutate
  // （如 Matrix4.multiply(proj, view, prevViewProjection)）——Matrix4.multiply(A,B,result)=A·B，
  // VP=proj·view（proj 在前，与下方 L457-460 代码一致）；IDENTITY 是 Object.freeze 的 frozen
  // 共享常量（Core/Matrix4.js:3070），首帧 prevVP===IDENTITY 时 in-place mutate 在 strict mode fail-fast 抛错。
  let prevViewProjection = Matrix4.IDENTITY
  let temporalAlpha = resolved.temporalHighAlpha // 首帧偏 current（避免 history 未就绪时空值累积；Task 12 参数化）
  let removeSanityCheck: (() => void) | undefined
  // Task 8 lifecycle 状态：prev position/dir（运动门控 position+direction 双项）+ lifecycle listener
  // remove 函数。
  let prevPositionWC = Cartesian3.ZERO.clone()
  let prevDir = Cartesian3.ZERO.clone()
  let removeDtPreRender: (() => void) | undefined
  let removeDtPostRender: (() => void) | undefined
  // Phase 0 profiling（demo ?profile=1）：外部注入的 blit 计时 hook。默认 undefined 时 doBlit 直跑，
  // 行为与接线前完全一致；stageCreated=false 时 postRender 提前 return，hook 不会被触达（安全）。
  let blitTimerHook: ((fn: () => void) => void) | undefined

  if (stageCreated) {
    const context = (scene as unknown as { context: unknown }).context
    historyState = createHistoryState(
      context,
      scene.drawingBufferWidth,
      scene.drawingBufferHeight,
      postHdrDatatype
    )
    depthTemporalStage = new PostProcessStage({
      name: 'czm_depth_temporal',
      // enabled=resolved.temporalEma：true=EMA 消抖；false（?temporalEma=0）=透传 vec4(sceneColor, curLogDepth)，
      // 不 EMA 但 atmosphere 仍读 .a=raw log-depth（Task 9 依赖）。HDR 时 stage 始终创建。
      fragmentShader: buildDepthTemporalFragmentShader({ enabled: resolved.temporalEma }),
      pixelDatatype: postHdrDatatype, // float RT 承载 smoothDepth 精度（HALF_FLOAT/FLOAT）
      textureScale: 1.0, // 全分辨率（与 globe depth 1:1 像素对齐）
      sampleMode: PostProcessStageSampleMode.NEAREST, // 显式钉死：smoothDepth 打包进 .a，LINEAR 插值产无意义中间 depth → 污染 atmosphere sceneDist 反演（比 tonomap 只处理 color 更敏感）
      uniforms: {
        // 函数形式（每帧调用取最新值）：Task 8 lifecycle 更新 historyState/prevVP/alpha 后自动反映。
        u_historyTexture: () => (historyState ? getHistoryBridge(historyState) : null),
        u_prevViewProjection: () => prevViewProjection,
        u_temporalAlpha: () => temporalAlpha,
        u_depthThreshold: resolved.temporalDepthThreshold, // Task 12 参数化（默认 DEPTH_THRESHOLD_DEFAULT；?depthThreshold= 覆盖）
        u_debugMode: resolved.debugMode // 与 atmosphere 同源 debugMode（URL ?debug=8 触发 depthTemporal raw depth 输出）
      }
    })
    // depthTemporal 必须在 atmosphereStage add 前 add（activeStages[0]）：
    // atmosphere 的 colorTexture = depthTemporal 输出（含 smoothDepth.a 透传），保证
    // aerialPerspective 读到的 scene color 已经过 EMA 平滑的 depth 通道。
    scene.postProcessStages.add(depthTemporalStage)

    // sanity check（评审：graceful degrade）：outputTexture 首帧/stage 未就绪时可 undefined，不崩。
    // Task 8 lifecycle postRender blit 也判空跳过；此处仅启动期首次 dev console.debug 诊断（不重复 warn）。
    let sanityWarned = false
    removeSanityCheck = scene.preRender.addEventListener(() => {
      if (
        !sanityWarned &&
        depthTemporalStage &&
        !sanityCheckOutputTexture(depthTemporalStage.outputTexture)
      ) {
        sanityWarned = true
        console.debug(
          '[depthTemporal] outputTexture undefined at startup（stage 未就绪；Task 8 blit 判空跳过）'
        )
      }
    })

    // —— Task 8 lifecycle ——

    // preRender resize：drawingBuffer 变化 → 重建 historyState + readIndex=0。
    // 必须在 collection.update 前（preRender 早于 postProcessStages execute），保证同帧 depthTemporal
    // output 与 history 同尺寸（避免 GL framebuffer size mismatch）。
    removeDtPreRender = scene.preRender.addEventListener(() => {
      if (!historyState) return
      const w = scene.drawingBufferWidth
      const h = scene.drawingBufferHeight
      if (w !== historyState.width || h !== historyState.height) {
        // resize：销毁旧 history textures（ping-pong 两张），重建新尺寸。
        historyState.textures.forEach((t) => t.destroy())
        historyState = createHistoryState(context, w, h, postHdrDatatype)
        historyState.readIndex = 0
      }
    })

    // postRender blit/swap/prevVP/alpha：所有 stage 渲染后，把 depthTemporal.outputTexture blit 到 write
    // history Tex（首帧也 blit，作 history 基线，非 loadNull 全 0）+ swap 翻转 + 更新下帧 prevVP/alpha。
    removeDtPostRender = scene.postRender.addEventListener(() => {
      if (!depthTemporalStage || !historyState) return
      const src = depthTemporalStage.outputTexture
      // 判空：首帧/stage disabled 时 outputTexture 可 undefined → 跳过 blit，保持上帧 history（避免崩）。
      if (!sanityCheckOutputTexture(src)) return

      // blit depthTemporal output → write history Tex
      const writeTex = getWriteTexture(historyState)
      const blitCmd = buildBlitCommand(context as Parameters<typeof buildBlitCommand>[0], src)
      blitCmd.framebuffer = buildHistoryFBO(context as Parameters<typeof buildHistoryFBO>[0], writeTex)
      // Phase 0 profiling：blit 在 stage.execute 之外（postRender），评审 M7 要求单独包 query 归入
      // depthTemporal。有 hook 走 hook 包装计时，无 hook 直跑（默认，行为不变）。
      const doBlit = () => blitCmd.execute(context as Parameters<typeof blitCmd.execute>[0])
      if (blitTimerHook) blitTimerHook(doBlit)
      else doBlit()

      // 更新下帧 uniforms（prevVP / temporalAlpha）——camera 是本帧渲染完毕时的位姿。
      const camera = scene.camera
      // !!Matrix4 reassign：用 new Matrix4() 作 result，勿 in-place mutate（IDENTITY 是 Object.freeze
      // 的 frozen 共享常量，见上方注释；首帧 prevVP===IDENTITY 时 in-place mutate 在 strict mode 抛错）。
      prevViewProjection = Matrix4.multiply(
        camera.frustum.projectionMatrix,
        camera.viewMatrix,
        new Matrix4()
      )
      // 运动门控：position 平移量 + direction 旋转量（1-dot，orbit 时 positionDelta 小但 direction 项大）。
      const positionDelta = Cartesian3.distance(camera.positionWC, prevPositionWC)
      const directionDelta = 1 - Math.abs(Cartesian3.dot(camera.directionWC, prevDir))
      const cameraHeight = Cartesian3.magnitude(camera.positionWC)
      // Bug2：maxDelta 归一化用离地高度（computeMaxDelta），非地心距（详见 temporalAlpha.ts computeMaxDelta）。
      // ellipsoid.maximumRadius = 赤道半径（保守下限）；computeMaxDelta 内部 max(alt, MIN) 防地表/极区负值。
      temporalAlpha = computeTemporalAlpha({
        cameraHeight,
        maxDelta: computeMaxDelta(cameraHeight, ellipsoid.maximumRadius),
        positionDelta,
        directionDelta,
        lowAlpha: resolved.temporalLowAlpha, // Task 12 参数化（默认 LOW_ALPHA；?temporalQuality=high → 0.1）
        highAlpha: resolved.temporalHighAlpha // Task 12 参数化（默认 HIGH_ALPHA；?temporalQuality=high → 0.8）
      })
      prevPositionWC = camera.positionWC.clone()
      prevDir = camera.directionWC.clone()
      swapHistory(historyState) // read↔write 翻转，下帧 u_historyTexture 读新 read（本帧 write）
    })
  }

  let atmosphereStage = buildAtmosphereStage()
  let tonemapStage = buildTonemapStage()
  scene.postProcessStages.add(atmosphereStage)
  if (lensFlareStage) scene.postProcessStages.add(lensFlareStage) // atmosphere → lensflare → tonomap
  scene.postProcessStages.add(tonemapStage) // 链尾，读 lensflare（或 atmosphere）线性输出

  // ── v2.1 insertStageBeforeLensFlare（spec §5）：把外部 stage（云 overlay）插入
  //    atmosphere 与 lensFlare 之间。重挂式：摘 lf/tm → 插入 → rebuild lf → re-add tm。──
  let destroyed = false
  let insertedStage: PostProcessStage | PostProcessStageComposite | undefined

  // lf rebuild：参数读闭包 resolved 当前值（与 setMode 重建语义一致，非创建时快照）；
  // depthSource 是创建时常量（temporalEmaEnabled）。lfHandle 无 destroy（三方核实：
  // plain handle 纯引用），composite remove 即级联销毁子 stage，无泄漏。
  function rebuildLensFlare(): PostProcessStageComposite | undefined {
    if (!resolved.lensFlare) return undefined
    const lfHandle = createLensFlareStage(
      scene,
      state,
      {
        intensity: resolved.lensFlareIntensity,
        thresholdLevel: resolved.lensFlareThreshold,
        ghostAmount: resolved.lensFlareGhost,
        haloAmount: resolved.lensFlareHalo,
        ...(resolved.lensFlarePreBlur != null
          ? { preBlurRadius: resolved.lensFlarePreBlur }
          : {}),
        live: lensFlareLive, // 2026-09-05：rebuild 后滑块参数仍经 live 实时读取，不丢
        cloudsOcclusionBridge: options.cloudsOcclusionBridge // lf×云 #1：rebuild（overlay 插入重排）后云桥保持
      },
      temporalEmaEnabled ? 'czm_depth_temporal' : undefined
    )
    return lfHandle.lensflareComposite
  }

  function insertStageBeforeLensFlare(
    stage: PostProcessStage | PostProcessStageComposite
  ): void {
    if (destroyed) {
      console.warn('[atmosphere] insertStageBeforeLensFlare 于 destroy 后调用，no-op')
      return
    }
    // 入口拒绝（v2.1 C1）：已销毁 stage 的 add 不抛错，但下一帧 collection.update 调
    // stage.update 直接崩渲染（destroyObject 遮蔽 prototype 方法）。
    if (stage.isDestroyed()) {
      throw new DeveloperError('insertStageBeforeLensFlare: stage 已销毁，不可插入')
    }
    // 同实例幂等（v2.1 C3 收紧：仅未销毁时 no-op——已销毁的同实例走替换，防静默无云）。
    // 顺序：必须在 contains 前置**之前**——首次 insert 成功后 stage 已在集合中，若 contains
    // 先判会抛错，幂等 no-op 永远不可达（§8.1.5）。幂等路径不重排链、无 add 冲突风险，安全。
    if (insertedStage === stage && !stage.isDestroyed()) return
    // contains 前置（v2）：已在集合中——后续 add 名字冲突抛错会留「lf/tm 已摘、链残缺」半途状态。
    if (scene.postProcessStages.contains(stage)) {
      throw new DeveloperError(
        'insertStageBeforeLensFlare: stage 已在集合中，须传入未 add 的 stage'
      )
    }

    const prevLfEnabled = lensFlareStage?.enabled
    try {
      // 替换场景：摘旧插入物（isDestroyed 防御在 removeAndDestroy 内）
      if (insertedStage != null) removeAndDestroy(insertedStage)
      // 摘序 = spec §8.1.1：先 lf 后 tm（回滚/测试时间线断言与此对齐）
      if (lensFlareStage) removeAndDestroy(lensFlareStage)
      removeAndDestroy(tonemapStage)
      scene.postProcessStages.add(stage)
      const newLf = rebuildLensFlare()
      if (newLf != null) {
        if (prevLfEnabled === false) newLf.enabled = false // enabled 继承（spec §5.2）
        lensFlareStage = newLf
        scene.postProcessStages.add(newLf)
      }
      tonemapStage = buildTonemapStage()
      scene.postProcessStages.add(tonemapStage)
      insertedStage = stage // 成功才记忆（回滚不动它）
    } catch (e) {
      // 尽力回滚（v2.1 C2：撤插入物 + 重建 lf/tm；回滚自身独立 try/catch 保原始异常）
      try {
        removeAndDestroy(stage)
        const rbLf = rebuildLensFlare()
        if (rbLf != null) {
          if (prevLfEnabled === false) rbLf.enabled = false
          lensFlareStage = rbLf
          scene.postProcessStages.add(rbLf)
        }
        tonemapStage = buildTonemapStage()
        scene.postProcessStages.add(tonemapStage)
      } catch (rollbackErr) {
        console.error('[atmosphere] insertStageBeforeLensFlare 回滚失败', rollbackErr)
      }
      throw e // 原始异常
    }
  }

  // 每帧更新：altitudeCorrection + sunDirection（Simon1994）+ 动态曝光
  const removePreRender = scene.preRender.addEventListener((_scene: Scene, time: JulianDate) => {
    const camera = scene.camera

    // 密切球再中心化（相机侧，shader 内 camera/scenePos 都用全量 altitudeCorrection）
    getAltitudeCorrectionOffset(
      camera.positionWC,
      ATMOSPHERE_BOTTOM_RADIUS_M,
      ellipsoid,
      state.altitudeCorrection
    )

    // 太阳方向：inertial 系位置 → central-body-fixed → ECEF，单位化。
    // 【ICRF 竞态修复 2026-08-16】原 computeIcrfToFixedMatrix 依赖 IAU2006 XYS 数据懒加载
    //（页面加载头 ~1s 返回 undefined → sunDirection 暂留初始 (0,0,1)，下载失败则永远错）。
    // computeIcrfToCentralBodyFixedMatrix（Cesium 内部 globe 昼夜同款）：XYS 就绪时同 IAU2006
    // 高精度，未就绪时 TEME→pseudo-fixed（纯 GMST 数值）fallback 恒有值——零网络依赖零竞态，
    // 天空/云太阳与 globe 昼夜自首帧一致（GMST 与完整 IAU2006 的太阳方向差 <0.5°，测试固化）。
    const sunInertial = Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
      time,
      sunInertialScratch
    )
    const icrfToFixed = Transforms.computeIcrfToCentralBodyFixedMatrix(time, icrfScratch)
    if (icrfToFixed != null && sunInertial != null) {
      const sunFixed = Matrix3.multiplyByVector(icrfToFixed, sunInertial, sunInertial)
      const sunMag = Cartesian3.magnitude(sunFixed)
      if (Number.isFinite(sunMag) && sunMag > 1e-15) {
        Cartesian3.normalize(sunFixed, state.sunDirection)
      }

      // 月方向（spec r2 §4）：复用上方 icrfToFixed（同帧共享，省重复旋转矩阵）；
      // 视差修正 origin = viewerPositionWC + altitudeCorrection（米）——与 reconstructRay
      // 射线起点同帧同源（太空相机 offset 可达 1e4 km，裸相机位置月盘方位偏 1-2°）。
      Cartesian3.add(camera.positionWC, state.altitudeCorrection, moonOriginScratch)
      computeMoonDirectionECEF(time, icrfToFixed, moonOriginScratch, state.moonDirection)
      // 月固系（月面纹理投影）：IAU 2009 闭式，与月方向同帧共享 icrfToFixed
      computeMoonFixedToECEFMatrix(time, icrfToFixed, state.moonFixedToECEF)
      // 月相照明分数（月晕调制）：state 两方向 dot 即得（Lambert 球积分），零天文计算
      state.moonIlluminatedFraction = computeMoonIlluminatedFractionFromDirections(
        state.sunDirection,
        state.moonDirection
      )
    }

    // 动态曝光（按相机当地太阳高度角）或手动
    state.exposure = resolved.exposureFollowTimeline
      ? getEffectiveAtmosphereExposure(
          camera.positionWC,
          ellipsoid,
          state.sunDirection,
          resolved.exposureDay,
          resolved.exposureNight,
          resolved.exposureTwilightAngleDegrees
        )
      : resolved.exposure
  })

  /**
   * 从集合移除并销毁；remove 成功时集合内部已 destroy，失败（不在集合中）则自行销毁。
   * 接受 PostProcessStage 或 PostProcessStageComposite（Cesium remove/add 重载都收两者；
   * lensflare 外层是 Composite，destroy 链尾时走本路径）。
   * v2 防御（spec §5.2）：已销毁的 stage 直接跳过——destroyObject 把 destroy 替换成
   * throwOnDestroyed，对已销毁 stage 再 .destroy() 会抛「This object was destroyed」断链。
   */
  function removeAndDestroy(s: PostProcessStage | PostProcessStageComposite): void {
    if (s.isDestroyed()) return
    if (!scene.postProcessStages.remove(s)) {
      s.destroy()
    }
  }

  return {
    get atmosphereStage() {
      return atmosphereStage
    },
    get depthTemporalStage() {
      return depthTemporalStage
    },
    get temporalEmaEnabled() {
      return temporalEmaEnabled
    },
    get lensFlareStage() {
      return lensFlareStage
    },
    get tonemapStage() {
      return tonemapStage
    },
    get postHdrDatatype() {
      return postHdrDatatype
    },
    setBlitTimerHook(hook) {
      blitTimerHook = hook
    },
    insertStageBeforeLensFlare,
    setLensFlare(update: AtmosphereLensFlareUpdate) {
      if (destroyed) {
        console.warn('[atmosphere] setLensFlare 于 destroy 后调用，no-op')
        return
      }
      // 参数 → resolved + live 双写（stage uniform 闭包读 live 每帧最新值；未来 rebuild 读 resolved，
      // 双写保一致）。未显式提供的字段不动（增量语义）。
      if (update.intensity != null) {
        resolved.lensFlareIntensity = update.intensity
        lensFlareLive.intensity = update.intensity
      }
      if (update.thresholdLevel != null) {
        resolved.lensFlareThreshold = update.thresholdLevel
        lensFlareLive.thresholdLevel = update.thresholdLevel
      }
      if (update.ghostAmount != null) {
        resolved.lensFlareGhost = update.ghostAmount
        lensFlareLive.ghostAmount = update.ghostAmount
      }
      if (update.haloAmount != null) {
        resolved.lensFlareHalo = update.haloAmount
        lensFlareLive.haloAmount = update.haloAmount
      }
      if (update.preBlurRadius != null) {
        resolved.lensFlarePreBlur = update.preBlurRadius
        lensFlareLive.preBlurRadius = update.preBlurRadius
      }
      if (update.enabled != null) resolved.lensFlare = update.enabled

      if (!lensFlareStage) {
        // stage 未建（初始 lensFlare=false）但请求开启 → 按需重挂创建。摘 tonemap 保证链序
        // atmosphere → lensflare → tonemap（lensflare 必须 add 在 tonemap 前，否则链尾读不到）。
        // 仅参数更新或显式 false：只落快照（下次 rebuild 生效），安全 no-op。
        if (update.enabled === true) {
          removeAndDestroy(tonemapStage)
          const newLf = rebuildLensFlare()
          if (newLf != null) {
            lensFlareStage = newLf
            scene.postProcessStages.add(newLf)
          }
          tonemapStage = buildTonemapStage()
          scene.postProcessStages.add(tonemapStage)
        }
        return
      }
      // stage 已存在：参数经 live 实时生效（无需额外动作）；enabled 切 composite.enabled（M1 非 rebuild）。
      if (update.enabled != null) lensFlareStage.enabled = update.enabled
    },
    setMode(newOptions: AtmosphereStageOptions) {
      if (destroyed) {
        console.warn('[atmosphere] setMode 于 destroy 后调用，no-op')
        return
      }
      // setMode/destroy 全仓库 0 调用属 dead code（demo 切 mode 靠页面重载）。
      // 既有逻辑：rebuild atmosphere+tonomap（不 removePreRender——preRender 闭包持 state/resolved
      // 引用，resolved 更新后自动生效）。两 stage uniform 同源 u_debugMode 同步重建。
      // TODO(Task 8): depthTemporal 不随 setMode rebuild（enabled 由 HDR caps 决定，非 options），
      // 但 setMode remove+re-add atmosphere/tonomap 会打乱 activeStages 顺序（depthTemporal 应在 atmosphere 前）。
      // setMode 是 dead code，暂不处理；Task 8 lifecycle 接入后若需 rebuild depthTemporal 再补。
      removeAndDestroy(atmosphereStage)
      removeAndDestroy(tonemapStage)
      resolved = validateAtmosphereOptions(newOptions)
      // live 快照同步（2026-09-05）：stage uniform 闭包读 lensFlareLive，setMode 换档后保持参数一致。
      lensFlareLive.intensity = resolved.lensFlareIntensity
      lensFlareLive.thresholdLevel = resolved.lensFlareThreshold
      lensFlareLive.ghostAmount = resolved.lensFlareGhost
      lensFlareLive.haloAmount = resolved.lensFlareHalo
      lensFlareLive.preBlurRadius = resolved.lensFlarePreBlur
      atmosphereStage = buildAtmosphereStage()
      tonemapStage = buildTonemapStage()
      scene.postProcessStages.add(atmosphereStage)
      // lensflare：用 enabled 开关（M1，非 rebuild 15 子 stage）。
      // - 之前未建（lensFlare=false）且新 options.lensFlare=true → 按需 create + add；
      // - 既有 lensflare composite 不 remove/re-add（Cesium remove 会 destroy，违背"enabled 非 rebuild"
      //   原则），仅按 newResolved.lensFlare 切 enabled。dead code 简化：集合内位置不调整。
      if (!lensFlareStage && resolved.lensFlare) {
        const lfHandle = createLensFlareStage(scene, state, {
          intensity: resolved.lensFlareIntensity,
          thresholdLevel: resolved.lensFlareThreshold,
          ghostAmount: resolved.lensFlareGhost,
          haloAmount: resolved.lensFlareHalo,
          live: lensFlareLive // 2026-09-05：setMode 重建后滑块参数仍经 live 读取
        })
        lensFlareStage = lfHandle.lensflareComposite
        scene.postProcessStages.add(lensFlareStage)
      } else if (lensFlareStage) {
        lensFlareStage.enabled = resolved.lensFlare
      }
      scene.postProcessStages.add(tonemapStage)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      removePreRender()
      if (removeDtPreRender) removeDtPreRender()
      if (removeDtPostRender) removeDtPostRender()
      if (removeSanityCheck) removeSanityCheck()
      // historyState ping-pong Texture 销毁（createHistoryState 创建的两张 RT）。
      if (historyState) {
        historyState.textures.forEach((t) => t.destroy())
      }
      if (depthTemporalStage) removeAndDestroy(depthTemporalStage)
      removeAndDestroy(atmosphereStage)
      if (lensFlareStage) removeAndDestroy(lensFlareStage)
      removeAndDestroy(tonemapStage)
    }
  }
}
