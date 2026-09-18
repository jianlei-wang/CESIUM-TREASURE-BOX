// B 路径大气透视 PostProcessStage fragment（完全参考 cesium-clouds-atmosphere）。
//
// 对照源库（/Users/zhangliyun/Documents/Ayvods/Web3D/cesium-clouds-atmosphere）：
// - src/AtmosphereFromThreeGeospatial/AtmospherePostProcess.js（天空 pass main + 天空判定 L375-437）
// - src/AtmosphereFromThreeGeospatial/Shaders/aerialPerspectiveEffect.frag（地面 pass + ACES + reconstructRay）
//
// 与原 A 路径的根本差异（T9 调试结论）：
// - A 路径（已弃）：getSunSkyIrradiance(albedo, normal) 重算照明 → 依赖屏幕法线重建 → 半球校正
//   临界翻转产生弧线；irradiance 是物理量需 exposure=15 → 放大 half-float LUT 灾消 → 山体透明。
// - B 路径（本文件）：finalColor = originalColor·transmittance + inscatter。不碰法线、不重算照明，
//   originalColor 是 Cesium 光照后的显示量级，exposure≈1.5 即可，灾消被压制 10×。
//   cesium-clouds-atmosphere 用同样 half-float LUT 但工作正常，证明问题在集成方式而非 LUT。
//
// 架构（phase2a HDR 管线）：本 stage 合并天空+地面，末端输出线性 finalColor·exposure（HalfFloat RT）；
// ACES+gamma+dithering 已拆到链尾独立 tonemap stage（tonemap.frag.ts）收尾。源库双 stage（天空 HDR →
// 地面 ACES）是为云预留中间 HDR；我无云，单 atmosphere stage 末端线性 + 链尾 tonemap 逻辑等价，
// 且支持 tonemap debug=7 HDR 归一化验证。
//
// Cesium 地形适配（源库 demo 无地形，不需；我必需，保留）：
// - depthTestAgainstTerrain=true（AtmosphereStage 设）：PostProcess depthTexture 拿真实地形深度。
// - 对数深度：地形 z-fighting 必需。
// - 天空判定不单凭 rawDepth：Cesium 地平线出屏时 depth plane 写假 depth，用 brunetonIntersectsGround
//   + 亮度兜底（移植源库 L375-437）。
//
// 前提：WebGL2（sampler3D/dFdx/GLSL ES 3.00）。PostProcessStage 运行时 Cesium 自动注入
// czm_*/out_FragColor/v_textureCoordinates；独立 glslang 校验走 buildStandaloneShaderForValidation。

import { glslIndex } from '../glslIndex'
import { resolveIncludes } from '../resolveIncludes'
import { buildAtmospherePrefix } from './cesiumCore'
import { LOG_DEPTH_GLSL } from './logDepth'

// B 路径 options：无 lighting/法线/几何误差校正（A 路径残留已弃）。
export interface AerialPerspectiveFragOptions {
  sun?: boolean // SUN：天空分支日盘（默认 true）
  sky?: boolean // SKY：天空分支存在性（默认 true；false 时远平面直通 inputColor）
  hdrDepthTemporal?: boolean // Bug3：depthTemporal stage 装配（HDR）→ 读 colorTexture.a EMA smoothLogDepth（消水波纹）；否则读 raw globe depth
  /**
   * M5 云 god rays atmosphere 路径（2026-08-17 spec r1 修订，用户拍板）：天空分支的
   * GetSkyRadiance shadow_length 从恒 0 改为采样 clouds march 的视线 shadowLength 纹理
   * （MRT att2，米→km 已换算）→ 天空 inscatter 被云影调制 = 太阳周围放射状光柱。
   * 默认 false（shadow_length=0 零回归）；由 AtmosphereStage 依 cloudsShadowLength 桥存在开启。
   * 「云内路径」（clouds.frag applyAerialPerspective）只产生 subtle 的云体大气透视调制——
   * 光柱视觉主体在本路径（three 的 atmosphereShadowLength 喂大气系统同款机制）。
   */
  cloudsShadowLength?: boolean
  /**
   * M5 云 god rays 增益（默认 1）：marchShadowLength 物理值域 0.35-0.5km（光深加权影长，
   * hitClouds 时被 clamp 到云前表面），而 GetSkyRadiance 的 shadow_length 机制需数十 km
   * 影长才有可见调制（它调制 single scattering × 视线透射率 T，短距 T≈1）——gain=1 物理精确
   * 但 subtle（对齐 three 同款量级）；>1 艺术放大出可见放射状光柱（demo ?cloudsGodRays=）。
   */
  cloudsGodRaysGain?: number
  /**
   * 月盘（2026-08-30 夜间光照 spec r2 §5）：sky 分支物理月盘——Oren-Nayar 月面（月相从
   * 几何涌现）× 视星等 2.5e-6 × 视线 transmittance（大气透视），走 getSkyRadiance out
   * 通道独立于 u_inscatterScale（不吃雾旋钮），同受 hasScene 前景雾（山遮月）与 limbFade。
   * 默认 true；false 时产物与现状逐字符一致（golden 守门）。
   */
  moon?: boolean
}

type ResolvedOptions = Required<AerialPerspectiveFragOptions>

// 供 Task 6 接线一致性测试：本 shader 跨全部宏组合可能声明的 uniform 超集（命名对齐源仓库）。
export const AERIAL_PERSPECTIVE_UNIFORM_NAMES: string[] = [
  'SUN_SPECTRAL_RADIANCE_TO_LUMINANCE',
  'SKY_SPECTRAL_RADIANCE_TO_LUMINANCE',
  'transmittance_texture',
  'scattering_texture',
  'single_mie_scattering_texture',
  'irradiance_texture',
  'higher_order_scattering_texture',
  'sunDirection',
  'altitudeCorrection',
  'exposure',
  'u_debugMode',
  'u_groundDim',
  'u_groundLighting', // 地面光色乘子开关（FRAME_UNIFORMS 无条件声明+绑定；0=关——A/B 对照兼 CI 逃生门）
  'u_groundNightAmbient', // 地面夜间环境底色 vec3（FRAME_UNIFORMS 无条件声明；开关 0 时无消费，绑了 Cesium 静默忽略——同 u_cloudsGodRaysGain 先例）
  'cosSunAngularRadius',
  'u_distanceScale',
  'u_inscatterScale',
  'u_limbGlowIntensity',
  'u_limbGlowDecayKm',
  'u_cloudsGodRaysGain', // M5 光柱增益（无条件绑定；CLOUDS_SHADOW_LENGTH 未 define 时 shader 无此 uniform，Cesium 静默忽略）
  'moonDirection', // 月盘（MOON 段声明；moon=false 时 shader 无声明，绑了 Cesium 静默忽略——同 u_cloudsGodRaysGain 先例）
  'moonAngularRadius',
  'u_moonRadiance',
  'u_moonTint', // 月盘色调乘子（MOON 段声明；moon=false 时 shader 无声明，绑了 Cesium 静默忽略）
  'u_moonFixedToECEFInv', // 月面纹理（MOON 段声明；moon=false 时 shader 无声明，绑了 Cesium 静默忽略）
  'u_moonSurface',
  'u_moonSkyScale', // 月晕（MOON 段声明；moon=false 或 0 时无消费，绑了 Cesium 静默忽略）
  'u_moonIlluminatedFraction'
]

// Cesium PostProcessStage 内建纹理 uniform——必须由 shader 显式声明（Cesium 仅提供 uniform 值，
// 不自动注入声明；见 @cesium/engine Scene/PostProcessStage.js）。
const POST_PROCESS_TEXTURES_GLSL = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
`

// LUT sampler + 光谱换算 uniform：bruneton/runtime 末尾 #define 的便捷函数引用这些全局。
const LUT_UNIFORMS_GLSL = `
uniform vec3 SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
uniform vec3 SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;
uniform sampler2D transmittance_texture;
uniform sampler3D scattering_texture;
uniform sampler3D single_mie_scattering_texture;
uniform sampler2D irradiance_texture;
uniform sampler3D higher_order_scattering_texture;
`

// 每帧 uniform（命名对齐源仓库）。altitudeCorrection 单位米（shader 内 *METER_TO_LENGTH_UNIT 转 km）。
// u_debugMode：0=正常 1=log(1+finalColor) 2=太阳方向 3=相机 r 量级 5=depth/r 6=透传 inputColor 7=线性输出（HDR 链验证，由 tonemap 归一化）。
// u_groundDim：地面反射衰减（分离 exposure——exposure 管 inscatter/天空，groundDim 单独压地面过曝）。
// u_groundLighting：地面光色乘子开关（2026-09-01 影像×大气颜色同步；1=启用默认，0=A/B 对照兼 CI 逃生门）。
// u_groundNightAmbient：地面夜间环境底色（vec3，色调可折入——同 u_nightTint/u_moonTint 先例）。
const FRAME_UNIFORMS_GLSL = `
uniform vec3 sunDirection;
uniform vec3 altitudeCorrection;
uniform float exposure;
uniform float u_debugMode;
uniform float u_groundDim;
uniform float u_groundLighting;
uniform vec3 u_groundNightAmbient;
uniform float u_distanceScale;  // 散射距离缩放（方案 A，等效空气密度倍率；1.0=phase1 物理，>1 中近距散射强）
uniform float u_inscatterScale;  // inscatter 放大（方案 B 远处白雾浓；1.0=phase1 物理，>1 远处雾浓，可超物理饱和）
uniform float u_limbGlowIntensity;  // limb outer glow 强度（太空视角大气边缘向外扩散辉光；0=关，~0.3-0.8 标定）
uniform float u_limbGlowDecayKm;  // limb glow 向外指数衰减距离（km；~20-40 控制扩散范围）
`

// [SKY && SUN] cos(SUN_ANGULAR_RADIUS)，SUN 日盘角半径阈值。
const COS_SUN_ANGULAR_RADIUS_UNIFORM_GLSL = `
uniform float cosSunAngularRadius;
`

// 辅助函数（移植源库 aerialPerspectiveEffect.frag + AtmospherePostProcess）。
const HELPERS_GLSL = `
// interleaved gradient noise（屏幕空间低频噪声，input dithering 用，无纹理依赖）。
// ACESFilmic + tonemapDisplay 已迁到链尾 tonemap.frag.ts（atmosphere 末端输出线性 HalfFloat，
// 由独立 tonemap stage 做 ACES+gamma+dithering 收尾；此处仅留 input dithering 用的噪声函数）。
float interleavedGradientNoise(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
// 视线重建：czm_windowToEyeCoordinates 近/远平面差分（源库 reconstructRay）。
// 避免 ndc + inverseProjection 在仰视净空 / log-depth / 多视锥下方向退化。
void reconstructRay(const vec3 cameraPosition, out vec3 rd) {
  vec4 eyeNear = czm_windowToEyeCoordinates(vec4(gl_FragCoord.xy, 0.0, 1.0));
  vec4 eyeFar = czm_windowToEyeCoordinates(vec4(gl_FragCoord.xy, 1.0, 1.0));
  if (abs(eyeNear.w) > 1e-10) eyeNear /= eyeNear.w;
  if (abs(eyeFar.w) > 1e-10) eyeFar /= eyeFar.w;
  vec3 dirEC = eyeFar.xyz - eyeNear.xyz;
  if (dot(dirEC, dirEC) < 1e-20) dirEC = eyeFar.xyz;
  rd = normalize((czm_inverseView * vec4(normalize(dirEC), 0.0)).xyz);
}
// 射线 o+t·d 与半径 R 的球是否存在 t>eps 的前向交点（源库 rayForwardHitsSphere）。
// 【float32 稳定化 ×2】贴地/水下相机（已 clamp 到面，c 被 max 钉 0）时该判定两度被舍入支配：
//   ① c = dot(o,o)-R² 是 4e7 量级减法，ULP 噪声 ±4km²（±16m）——符号噪声偏负（"球内"）时
//     天顶视线也判前向穿球 → GROUND 分支 tHitG≈水下深度 → inscatter≈0 → 天空黑（-12m bug）。
//     已改因式分解 (r-R)(r+R) + max 钉非负。
//   ② c=0 时 disc=b²，sqrt(b²) 的舍入可比 b 大 1 ULP（b~2462km 时 ULP=0.00024km）——
//     -b+s = +0.00024 > 旧阈值 1e-6 → hitBottom 假阳性，sqrt 舍入方向随像素间 b 值伪随机
//     → ~69% 像素翻转 = 天空黑白雪花（-31m bug）。阈值 1e-6（1mm）→ 1e-3（1m）：
//     1m 内的前向交点物理无意义（远小于任何地形尺度），ULP 噪声 0.00024 < 0.001 被稳定排除。
bool rayForwardHitsSphere(vec3 o, vec3 d, float R) {
  float b = dot(o, d);
  float rO = length(o);
  float c = max((rO - R) * (rO + R), 0.0);
  float disc = b * b - c;
  if (disc < 0.0) return false;
  float s = sqrt(disc);
  return (-b - s > 1e-3) || (-b + s > 1e-3);
}
// 相机是否在大气壳层（bottom < r < top），源库 cameraInAtmosphereShell。
bool cameraInAtmosphereShell(vec3 o, float bottomR, float topR) {
  float r = length(o);
  return r > bottomR + 1e-5 && r < topR - 1e-5;
}
// GetSkyRadianceToPointScaled：散射距离缩放 wrapper（方案 A，等效空气密度倍率）。
//
// 本函数是 bruneton/runtime.glsl GetSkyRadianceToPoint（9 参，L253-371）+ GetSkyLuminanceToPoint
// （L427-434，光谱→亮度换算）的合并 5 参 drop-in——main 现有 GetSkyRadianceToPoint(5 参) 因 runtime 末尾
// #define GetSkyRadianceToPoint GetSkyLuminanceToPoint 实际命中 GetSkyLuminanceToPoint，故 wrapper 须同样
// 5 参 + 末端 ×SKY_SPECTRAL_RADIANCE_TO_LUMINANCE 才等效。
//
// **唯一物理改动**：Length d = length(point - camera) * u_distanceScale（散射距离缩放，等效空气密度倍率）。
// u_distanceScale=1.0 时 d×1=d，与原 GetSkyRadianceToPoint→GetSkyLuminanceToPoint 链路 bit 等价（phase1 零回归）。
// 其余 r_p/mu_p/mu_s_p/GetTransmittance/GetCombinedScattering/shadow_transmittance 全部用缩放后的 d 自动跟随。
//
// atmosphere/transmittance_texture/scattering_texture/single_mie_scattering_texture 用 bruneton runtime
// #include 的全局（const ATMOSPHERE + LUT_UNIFORMS_GLSL sampler）；helper（ClipAtBottomAtmosphere/
// GetTransmittance/GetCombinedScattering/GetScattering/RayleighPhaseFunction/MiePhaseFunction/
// GetExtrapolatedSingleMieScattering 等）同在 runtime #include，不重复声明。
vec3 GetSkyRadianceToPointScaled(
    Position camera, Position point, const Length shadow_length,
    const Direction sun_direction, out vec3 transmittance) {
  // @shotamatsuda: Avoid artifacts when the ray does not intersect the top
  // atmosphere boundary.
  if (length(ClosestPointOnRay(camera, point)) > ATMOSPHERE.top_radius) {
    transmittance = vec3(1.0);
    return vec3(0.0);
  }

  Direction view_ray = normalize(point - camera);
  if (ClipAtBottomAtmosphere(ATMOSPHERE, view_ray, camera, point)) {
    transmittance = vec3(1.0);
    return vec3(0.0);
  }

  // Compute the distance to the top atmosphere boundary along the view ray,
  // assuming the viewer is in space (or NaN if the view ray does not intersect
  // the atmosphere).
  Length r = length(camera);
  Length rmu = dot(camera, view_ray);
  // @shotamatsuda: Use SafeSqrt instead.
  // See: https://github.com/takram-design-engineering/three-geospatial/pull/26
  Length distance_to_top_atmosphere_boundary = -rmu -
      SafeSqrt(rmu * rmu - r * r +
          ATMOSPHERE.top_radius * ATMOSPHERE.top_radius);
  // If the viewer is in space and the view ray intersects the atmosphere, move
  // the viewer to the top atmosphere boundary (along the view ray):
  if (distance_to_top_atmosphere_boundary > 0.0 * m) {
    camera = camera + view_ray * distance_to_top_atmosphere_boundary;
    r = ATMOSPHERE.top_radius;
    rmu += distance_to_top_atmosphere_boundary;
  }

  // Compute the r, mu, mu_s and nu parameters for the first texture lookup.
  Number mu = rmu / r;
  Number mu_s = dot(camera, sun_direction) / r;
  Number nu = dot(view_ray, sun_direction);
  // 散射距离缩放（方案 A，等效空气密度倍率）：u_distanceScale=1.0 时与原 GetSkyRadianceToPoint 等价。
  Length d = length(point - camera) * u_distanceScale;
  bool ray_r_mu_intersects_ground = RayIntersectsGround(ATMOSPHERE, r, mu);

  // @shotamatsuda: Hack to avoid rendering artifacts near the horizon, due to
  // finite atmosphere texture resolution and finite floating point precision.
  // See: https://github.com/ebruneton/precomputed_atmospheric_scattering/pull/32
  if (!ray_r_mu_intersects_ground) {
    Number mu_horizon = -SafeSqrt(1.0 -
        (ATMOSPHERE.bottom_radius * ATMOSPHERE.bottom_radius) / (r * r));
    const Number eps = 0.004;
    mu = max(mu, mu_horizon + eps);
  }

  transmittance = GetTransmittance(ATMOSPHERE, transmittance_texture,
      r, mu, d, ray_r_mu_intersects_ground);

  IrradianceSpectrum single_mie_scattering;
  IrradianceSpectrum scattering = GetCombinedScattering(
      ATMOSPHERE, scattering_texture, single_mie_scattering_texture,
      r, mu, mu_s, nu, ray_r_mu_intersects_ground,
      single_mie_scattering);

  // Compute the r, mu, mu_s and nu parameters for the second texture lookup.
  // If shadow_length is not 0 (case of light shafts), we want to ignore the
  // scattering along the last shadow_length meters of the view ray, which we
  // do by subtracting shadow_length from d (this way scattering_p is equal to
  // the S|x_s=x_0-lv term in Eq. (17) of our paper).
  d = max(d - shadow_length, 0.0 * m);
  Length r_p = ClampRadius(ATMOSPHERE, sqrt(d * d + 2.0 * r * mu * d + r * r));
  Number mu_p = (r * mu + d) / r_p;
  Number mu_s_p = (r * mu_s + d * nu) / r_p;

  IrradianceSpectrum single_mie_scattering_p;
  IrradianceSpectrum scattering_p = GetCombinedScattering(
      ATMOSPHERE, scattering_texture, single_mie_scattering_texture,
      r_p, mu_p, mu_s_p, nu, ray_r_mu_intersects_ground,
      single_mie_scattering_p);

  // Combine the lookup results to get the scattering between camera and point.
  DimensionlessSpectrum shadow_transmittance = transmittance;
  if (shadow_length > 0.0 * m) {
    // This is the T(x,x_s) term in Eq. (17) of our paper, for light shafts.
    shadow_transmittance = GetTransmittance(ATMOSPHERE, transmittance_texture,
        r, mu, d, ray_r_mu_intersects_ground);
  }
  // @shotamatsuda: Occlude only single Rayleigh scattering by the shadow.
#ifdef HAS_HIGHER_ORDER_SCATTERING_TEXTURE
  IrradianceSpectrum higher_order_scattering = GetScattering(
      ATMOSPHERE, higher_order_scattering_texture,
      r, mu, mu_s, nu, ray_r_mu_intersects_ground);
  IrradianceSpectrum single_scattering = scattering - higher_order_scattering;
  IrradianceSpectrum higher_order_scattering_p = GetScattering(
      ATMOSPHERE, higher_order_scattering_texture,
      r_p, mu_p, mu_s_p, nu, ray_r_mu_intersects_ground);
  IrradianceSpectrum single_scattering_p =
      scattering_p - higher_order_scattering_p;
  scattering =
      single_scattering - shadow_transmittance * single_scattering_p +
      higher_order_scattering - transmittance * higher_order_scattering_p;
#else // HAS_HIGHER_ORDER_SCATTERING_TEXTURE
  scattering = scattering - shadow_transmittance * scattering_p;
#endif // HAS_HIGHER_ORDER_SCATTERING_TEXTURE

  single_mie_scattering =
      single_mie_scattering - shadow_transmittance * single_mie_scattering_p;
#ifdef COMBINED_SCATTERING_TEXTURES
  single_mie_scattering = GetExtrapolatedSingleMieScattering(
      ATMOSPHERE, vec4(scattering, single_mie_scattering.r));
#endif // COMBINED_SCATTERING_TEXTURES

  // Hack to avoid rendering artifacts when the sun is below the horizon.
  single_mie_scattering = single_mie_scattering *
      smoothstep(Number(0.0), Number(0.01), mu_s);

  // 末端 ×SKY_SPECTRAL_RADIANCE_TO_LUMINANCE：对齐 GetSkyLuminanceToPoint（5 参 drop-in 必需，
  // 否则 inscatter 是辐射度量级 ~1000× 小于亮度量级 → 散射不可见）。
  return (scattering * RayleighPhaseFunction(nu) + single_mie_scattering *
      MiePhaseFunction(ATMOSPHERE.mie_phase_function_g, nu)) *
      SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;
}
`

// SUN 日盘（源 sky.glsl:48-59）：viewDotSun 越过 cosSunAngularRadius 时叠加太阳辐射，
// smoothstep 按 fragmentAngle 做边缘抗锯齿。
const SUN_DISK_GLSL = `
  float viewDotSun = dot(rayDirection, sunDirection);
  if (viewDotSun > cosSunAngularRadius) {
    float angle = acos(clamp(viewDotSun, -1.0, 1.0));
    float antialias = smoothstep(
      ATMOSPHERE.sun_angular_radius,
      ATMOSPHERE.sun_angular_radius - fragmentAngle,
      angle
    );
    radiance += transmittance * GetSolarRadiance() * antialias;
  }
`

// [MOON] 月盘 uniforms（moon=true 时拼入）。
const MOON_UNIFORMS_GLSL = `
uniform vec3 moonDirection;
uniform float moonAngularRadius;
uniform float u_moonRadiance;
// 色调乘子（2026-08-31 用户反馈月盘偏暖：solar_irradiance 光谱基色+NASA 纹理偏棕——实测
// R/G=1.119 B/G=0.905。线性域冷蓝乘子对冲，默认 (0.72,1,1.32)（三档拍板：中性白/轻冷/冷蓝
// 冷蓝胜出）；1,1,1=中性零回归路径）。
uniform vec3 u_moonTint;
// 月面纹理（月海/环形山，2026-08-30 月面纹理任务）：ECEF→月固系旋转（JS 每帧传转置）+ equirect 采样。
// 纹理缺失时 demo 绑 1×1 白 dummy（albedo=1 退化为均匀月面，数值等价于无纹理版）。
uniform mat3 u_moonFixedToECEFInv;
uniform sampler2D u_moonSurface;
// 月晕（月光天空散射，2026-09-01）：月光把月盘周围天空照亮——朝月向二次 GetSkyRadiance。
// 倍率对齐云月光 moonLightScale 量级起步（满月净系数 2.5e-6×25000≈0.06×太阳同几何散射；
// shader 内门与 clouds.frag §6.1 同体系，0=关）。
uniform float u_moonSkyScale;
// 月相照明分数 f（朔 0/弦 0.318/望 1）——JS preRender 由 state 两方向 dot 即得（Lambert 球积分）。
uniform float u_moonIlluminatedFraction;
`

// [MOON] 月盘 GLSL（getSkyRadiance 内、SUN 盘后注入；moonDisc 是 out 参数——通道方案 spec §5.1：
// 不吃 u_inscatterScale / 同受 hasScene mix 与 limbFade / 月盘衰减只走 transmittance）。
const MOON_DISC_GLSL = `
  // 判定+盘缘 AA：acos（非 dot 与弧度直比）+ 边序恒升序（ω<aa 时降序边=GLSL UB——小角半径守卫）
  float moonAngle = acos(clamp(dot(rayDirection, moonDirection), -1.0, 1.0));
  float moonAA = max(fragmentAngle, 1e-4);
  float moonMask = 1.0 - smoothstep(moonAngularRadius - moonAA, moonAngularRadius, moonAngle);
  if (moonMask > 0.0) {
    // 月面法线（上游 MoonNode raySphereIntersectionNormal：投影 + 半弦长）
    float cosRay = dot(moonDirection, rayDirection);
    vec3 P = rayDirection * cosRay - moonDirection;
    float s = sqrt(max(moonAngularRadius * moonAngularRadius - dot(P, P), 0.0));
    vec3 moonNormal = (P - rayDirection * s) / moonAngularRadius;
    // Oren-Nayar（MoonNode 改进版 mimosa-pudica，粗糙度 1 / albedo 1 形状函数）：
    // A=(1/π)(1-0.5/1.33+0.17/1.13)≈0.2466  B=(1/π)(0.45/1.09)≈0.1314
    // 实参序 (L=sunDirection, V=-rayDirection, N)；月相从几何自动涌现（太阳只照亮半个月球）
    float cosLight = dot(moonNormal, sunDirection);
    float cosView = dot(moonNormal, -rayDirection);
    float sOV = dot(sunDirection, -rayDirection) - cosLight * cosView;
    float t = mix(1.0, max(max(cosLight, cosView), 0.1), smoothstep(0.0, 0.1, sOV));
    float onDiffuse = max(cosLight, 0.0) * (sOV / t * 0.1314 + 0.2466);
    // 月面纹理（上游 MoonNode equirectUV(normalMF.xzy) 同构——Y-up 换轴已合并入下式）：
    // 月固系法线 → equirect UV（u=经度 atan2(y,-x)，v=纬度 asin(z)，0.5=月赤道、1=月北极）→ albedo。
    // IAU 2009 月固系（W 线性+固定北极）经 JS computeMoonFixedToECEFMatrix 保证潮汐锁定
    // （正面恒朝地球，天平动级精度）——月海位置与真实天文一致。
    vec3 normalMF = u_moonFixedToECEFInv * moonNormal;
    vec2 moonUv = vec2(
      atan(normalMF.y, -normalMF.x) * 0.15915494 + 0.5,
      asin(clamp(normalMF.z, -1.0, 1.0)) * 0.31830989 + 0.5
    );
    vec3 moonAlbedo = texture(u_moonSurface, moonUv).rgb;
    // 亮度：太阳辐亮度 × 视星等比 2.5e-6（已含月面反照率）÷ (π·ω²)，×亮度换算 ×倍率 ×纹理 albedo
    // （纹理均值由 JS 侧折入 u_moonRadiance——保总亮度只加图案不整体变暗）
    vec3 moonDiscRadiance = ATMOSPHERE.solar_irradiance
      * 2.5e-6 / (PI * moonAngularRadius * moonAngularRadius)
      * SUN_SPECTRAL_RADIANCE_TO_LUMINANCE * u_moonRadiance * u_moonTint * onDiffuse * moonAlbedo;
    moonDisc += transmittance * moonDiscRadiance * moonMask;  // +=（非 =）：叠加月晕段（入口已归零）
  }
`

// [MOON] 月晕（月光天空散射，2026-09-01 用户反馈「月亮周围缺少光晕」）：月亮把周围天空照亮。
// 物理式：朝月方向二次 GetSkyRadiance ×2.5e-6（视星等比）×f（月相）×u_moonSkyScale（艺术放大，
// 与云月光同一物理体系）——Mie 前向峰自动给出「月盘邻近更亮」、低仰角透射红化、月相盈亏调制、
// 月落渐熄。走 moonDisc out 通道而非 radiance/inscatter：main 末端 inscatter *= skySunVisibility
// （六轮修复：太阳可见度门）会把深夜月光散射一并消零——通道绕开，且天然继承 hasScene 前景雾
// 遮月（山后无月晕）+ limbFade（太空视角）+不吃太阳专用 u_inscatterScale。
// 门与 clouds.frag 月光 §6.1 逐字对齐（锚改相机天顶 normalize(cameraPosition)——天空像素无
// 采样表面，相机即观察点；太空夜侧相机 muSun<0 门开=limb 月光散射物理正确）：nightFactor 太阳
// 门白天=0（白天像素级零回归——月光 +6% 被门归零）、moonFactor=月相×月升落门（月落后无地下光）。
const MOON_SKY_GLOW_GLSL = `
  if (u_moonSkyScale > 0.0) {
    // 相机天顶锚（moonCamZenith 局部变量——skySunVisibility 的「防相机锚」断言针对太阳淡出门，
    // 月晕门语义不同：白天关月光（+6% 归零）+太空夜侧 muSun<0 门开=limb 月光散射，相机锚正确）
    vec3 moonCamZenith = normalize(cameraPosition);
    vec3 moonSkyTrans;  // 弃用（月晕透射已含在 GetSkyRadiance 输出内）
    vec3 moonGlow = GetSkyRadiance(cameraPosition, rayDirection, 0.0, moonDirection, moonSkyTrans);
    float moonNightFactor = 1.0 - smoothstep(-0.1045, -0.0175, dot(moonCamZenith, sunDirection));
    float moonFactor = u_moonIlluminatedFraction
      * smoothstep(-0.05, 0.02, dot(moonCamZenith, moonDirection));
    // 角聚集（aureole 形）：3D 散射 LUT 的 nu 维仅 32 texel（段宽 0.0625）——月盘角半径 0.02 rad
    // 的 Mie 前向峰远小于一个 texel，纯 LUT 路径实测给出「全局均匀微亮」无月晕形（2026-09-01
    // 像素差分实证：紧邻环≈远处天空）。此处按解析 exp 前向峰恢复 LUT 分辨率丢失的形状（等效
    // Mie 前向峰放回）：θ=视线与月夹角，θ0=0.06 rad（≈3.4° 柔光尺度），k=15 检回可见聚集
    //（形状超参不外暴露——强度唯一旋钮 u_moonSkyScale）。
    float moonTheta = acos(clamp(dot(rayDirection, moonDirection), -1.0, 1.0));
    float moonAureole = 1.0 + 15.0 * exp(-moonTheta / 0.06);
    moonDisc += moonGlow * (u_moonSkyScale * 2.5e-6 * moonNightFactor * moonFactor * moonAureole);
  }
`

// 天空 inscatter getSkyRadiance（源库裁剪版：SUN 恒可选、MOON 经 moon option 可选、PERSPECTIVE_CAMERA 排除）。
// transmittance 经 out 参数输出，供统一合成（originalColor·trans·groundDim + inscatter）复用——
// 天空像素 originalColor=clearColor 黑，trans 不影响其最终色；山峰（视线判天空）靠 trans 衰减地形色。
function buildSkyRadianceFn(sun: boolean, moon: boolean): string {
  return `
vec3 getSkyRadiance(
  const vec3 cameraPosition,
  const vec3 rayDirection,
  const float shadowLength,
  const vec3 sunDirection,
  const float fragmentAngle,
  out vec3 transmittance${moon ? ',\n  out vec3 moonDisc' : ''}
) {
  vec3 radiance = GetSkyRadiance(
    cameraPosition,
    rayDirection,
    shadowLength,
    sunDirection,
    transmittance
  );
${sun ? SUN_DISK_GLSL : ''}${moon ? `  moonDisc = vec3(0.0); // out 参数函数内读前显式归零（out 语义不保证入口值）
${MOON_SKY_GLOW_GLSL}${MOON_DISC_GLSL}` : ''}
  return radiance;
}
`
}

// 主流程（合并天空+地面单 stage；移植源库天空判定 + B 路径合成 + 末端线性输出）。
function buildMainFn(o: ResolvedOptions): string {
  const skyBranch = o.sky
    ? `
#ifdef CLOUDS_SHADOW_LENGTH
    // M5 atmosphere 路径：视线云影长度调制天空 inscatter（太阳周围放射光柱）。
    // clouds march att2 已 *METER_TO_LENGTH_UNIT（m→km），与本函数 shadow_length 参数域一致。
    float cloudsShadowLength = texture(u_cloudsShadowLength, v_textureCoordinates).r;
    // M5 atmosphere 路径：云影长度增益（march 物理值域 0.35-0.5km，Bruneton shadow_length 机制
    // 需数十 km 才可见调制——gain=1 物理精确但 subtle 对齐 three；艺术放大出可见光柱）
    cloudsShadowLength *= u_cloudsGodRaysGain;
#else
    const float cloudsShadowLength = 0.0;
#endif
    inscatter = getSkyRadiance(cameraPosition, rayDirection, cloudsShadowLength, sunDirection, fragmentAngle, transmittance${o.moon ? ', moonDisc' : ''});
`
    : `
    finalColor = originalColor.rgb;
#ifdef DEPTH_TEMPORAL_EMA
    out_FragColor = vec4(finalColor * exposure, 1.0);  // Bug3：HDR .a=smoothLogDepth 不透传（专家1 M1）
#else
    out_FragColor = vec4(finalColor * exposure, originalColor.a);  // UNSIGNED_BYTE main 行为
#endif
    return;
`

  return `
in vec2 v_textureCoordinates;

void main() {
  vec4 originalColor = texture(colorTexture, v_textureCoordinates);
  // input dithering：8-bit originalColor 是 ACES banding 的源头（ACES 中间调放大 2-3 倍 → 远处渐变
  // 「水波纹」）。在源头加 triangular 噪声 ±0.5 LSB，经 ACES+gamma 映射到 display 自然打散阶梯
  //（比纯 display 空间 dithering 更高效——display dithering 只盖 output 量化，盖不住被 ACES 放大的
  // input 阶梯）。
  float inDither = interleavedGradientNoise(gl_FragCoord.xy)
    + interleavedGradientNoise(gl_FragCoord.xy + vec2(7.11, 5.17)) - 1.0;  // [-1,1] triangular
  originalColor.rgb += inDither * 1.5 / 255.0;

  // —— 视线几何量前移（Phase 1.2）：5-tap 段的 muLook 门控需在 depth 采样前拿到视角量 ——
  // 相机位置：viewerPositionWC（ECEF 米）+ altitudeCorrection（米）→ km。camera 与后续 scenePos
  // 都用全量 altitudeCorrection，保证在同一密切球局部系（Bruneton 模型前提）。
  vec3 cameraPosition = (czm_viewerPositionWC + altitudeCorrection) * METER_TO_LENGTH_UNIT;
  vec3 rayDirection;
  reconstructRay(cameraPosition, rayDirection);
  // 【水下相机防护】Bruneton 参数化定义域 r >= bottom_radius（GetScatteringTextureUvwzFromRMuMuSNu
  // assert r>=bottom，release GLSL 静默越界 → rho=SafeSqrt clamp 0 / transmittance x_r 越界 → 天空黑、
  // 云正常——云层 750m+ 求交对相机入水稳健，仅大气天空/地面分支受害）。Cesium 允许相机入水
  // （里海水面 WGS84 椭球高约 -28m，拖动可停在水下）。沿径向 clamp：水下深度不含大气
  // （光路从水面起算），物理等价。reconstructRay 的 camera 是 const（视线方向由近平面差分），
  // 先重建视线再平移——clamp 的米级平移对视线方向影响 ~1e-8 可忽略；后续 sky/ground 全部
  // 大气计算（含 lookingAtGround 判定）统一消费 clamp 后的 cameraPosition。
  // 【clamp 下限 = 面上 10m（根因 4）】若精确 clamp 到面（h=0），cG=(r-R)(r+R)=0 → 贴地微俯视线的
  // 椭球交点距离 tHitG 全塌 0（-bG-sG = |bG|-sqrt(bG²)=0）→ GROUND 基线 inscatter 距离 0 →
  // 地平线/远水面无大气散射（用户 2026-08-16：54.2517,37.3744,-7,287.2,3.0 远处地平线黑）。
  // 下限 10m：视觉不可分辨的高度，但 cG=0.01×12720≈127km² → 地平线微俯视线交点距离恢复
  // 公里级（θ=0.05° 时 ~11km），地平线散射回归。
  const float CAMERA_MIN_ALT_KM = 0.01;
  float cameraRadius = length(cameraPosition);
  float cameraMinR = ATMOSPHERE.bottom_radius + CAMERA_MIN_ALT_KM;
  if (cameraRadius < cameraMinR) {
    cameraPosition *= cameraMinR / cameraRadius;
  }
  vec3 radialOut = normalize(cameraPosition);
  // 视线与径向（天顶方向）余弦：垂直俯视 |muLook|→1，掠射 |muLook|→0。平滑、不读 depth、无循环依赖
  //（Phase 1.2 5-tap 视角自适应门控用；绝不用 mask/sceneDist 门控——判定信号本身在抖会造边界条纹）。
  float muLook = dot(rayDirection, radialOut);

  // depth 反演（Bug1）：czm_reverseLogDepthWindow 显式反演 log-depth → 线性 window depth（PostProcessStage
  // 无 LOG_DEPTH define，czm_readDepth 返回 raw logDepth → 4-arg 反投影错）。near/far 用 czm_currentFrustum。
  // Bug4：5-tap 邻域平均（log-depth 域 ≈ 几何平均距离）抗 depth 高频抖 → 消波纹（sceneDist 抖放大 inscatter
  //   等高线）。空间平滑替代 temporal EMA（Bug3 EMA reproject 错误，专家3 C3 验证失败已回退）。
  // Bug6：hasScene 判定用中心 tap（tapC）非 5-tap 平均 logDepth——5-tap far-plane 排除（tap<1.0）使地形边缘
  //   像素的平均 logDepth 从 far-plane 邻居混入降到 <0.5 → 错误过 depth<1.0 → 反演 → hasScene 翻转 → 地平线
  //   地形描边（debug=9 B 蓝边确认）。分离：hasScene 用 tapC（中心像素真实地形判定），sceneDist 用 5-tap 平均。
#ifdef DEPTH_TEMPORAL_EMA
  float logDepth = originalColor.a;  // depthTemporal[0] 输出 vec4(sceneColor.rgb, smoothLogDepth)（已平滑）
  float tapC = originalColor.a;  // Bug6：中心 tap 与平均一致（EMA 路径无 5-tap）
#else
  float tapC = texture(depthTexture, v_textureCoordinates).r;  // 中心 tap：hasScene 判定用（Bug6）
  float logDepth = 1.0;  // 默认 far-plane（tapC>=1.0 时跳过 4 邻域，省天空区 80% depth 采样，Phase 1.0）
  if (tapC < 1.0) {  // tapC 早退：仅地面像素才考虑空间平滑（天空/未渲染 4 邻域 fetch 对输出零影响）
    // Phase 1.2：垂直俯视（|muLook|→1）保留 5-tap（Bug4 有效场景，空间高频抖可空间平滑消）；
    // 掠射（|muLook|→0）降 tap 退中心 tap（5-tap 对掠射无效=depth 时序跳非空间高频，results:50）。
    // muLook 门控（平滑、不读 depth、无循环依赖——绝不用 mask/sceneDist 门控，那判定信号本身在抖会造边界条纹）；
    // smoothstep 连续过渡避免 tap 数硬切换分界线；掠射退中心 tap（对称，禁 3-tap 十字防方向性偏置 ×25）。
    // 过渡带 (0.15,0.3)：仅极掠射（|muLook|<0.3，如低空水平视线 bug6≈0.075）降 tap；中高空地球边缘
    // （|muLook|≈0.4-0.5，如 camera-high-graze≈0.36、高空俯视地球边缘≈0.5）保留 5-tap——后者是 inscatter
    // 阶梯敏感区（Bug5 圆圈阶梯），tap 切换会改 sceneDist → 阶梯回归（maxΔ=43 实证）。5-tap 对纯极掠射无效
    // （depth 时序跳非空间高频），但对地球边缘过渡带仍有空间平滑价值，故阈值收窄到极掠射。
    float useSpatial = smoothstep(0.15, 0.3, abs(muLook));
    if (useSpatial > 0.5) {  // 垂直俯视：5-tap 空间平滑（Bug4）
      vec2 depthTexel = 1.0 / vec2(textureSize(depthTexture, 0));
      float tapR = texture(depthTexture, v_textureCoordinates + vec2(depthTexel.x, 0.0)).r;
      float tapL = texture(depthTexture, v_textureCoordinates - vec2(depthTexel.x, 0.0)).r;
      float tapU = texture(depthTexture, v_textureCoordinates + vec2(0.0, depthTexel.y)).r;
      float tapD = texture(depthTexture, v_textureCoordinates - vec2(0.0, depthTexel.y)).r;
      float tapSum = tapC;  // tapC<1.0 必计入
      float tapCount = 1.0;
      if (tapR < 1.0) { tapSum += tapR; tapCount += 1.0; }
      if (tapL < 1.0) { tapSum += tapL; tapCount += 1.0; }
      if (tapU < 1.0) { tapSum += tapU; tapCount += 1.0; }
      if (tapD < 1.0) { tapSum += tapD; tapCount += 1.0; }
      logDepth = tapSum / tapCount;  // 5-tap 平均：sceneDist 距离用（tapCount>=1.0 必 >0.5，三元简化为除法）
    } else {  // 掠射：中心 tap（5-tap 无效，省 4 fetch）
      logDepth = tapC;
    }
  }
#endif
  float depth = czm_reverseLogDepthWindow(logDepth, czm_currentFrustum.x, czm_currentFrustum.y);
  // Bug6：hasSceneDepth 用 tapC（中心像素，真实地形判定）；depth 用 5-tap 平均（sceneDist 距离平滑）。
  float hasSceneDepth = czm_reverseLogDepthWindow(tapC, czm_currentFrustum.x, czm_currentFrustum.y);

  float bottomR = ATMOSPHERE.bottom_radius;
  float topR = ATMOSPHERE.top_radius;
  float camR = length(cameraPosition);

  // —— depth 反演：为近处地形（含地平线上方山峰）提供真实 sceneDist，算前景雾、保持山体不透明。**不参与
  // sky/ground 主分类**——分类用 lookingAtGround（平滑），避免 depthTexture 不抗锯齿在掠射地平线处逐像素
  // 硬翻转的条纹。hasScene/sceneDist 只在 foreInscatter（近处 mask>0）被消费；远处/掠射 sceneDist 大
  // → mask=0 不读它 → 无条纹。
  bool hasScene = false;
  float sceneDist = 0.0;
  if (hasSceneDepth < 1.0) {  // Bug6：中心 tap 判定（防 5-tap far-plane 排除翻转边缘 hasScene）
    vec4 eyePos = czm_windowToEyeCoordinates(vec4(gl_FragCoord.xy, depth, 1.0));  // sceneDist 用 5-tap 平均 depth
    if (abs(eyePos.w) > 1e-6) {
      eyePos /= eyePos.w;
      if (eyePos.z < -1e-4) {
        vec4 worldPos4 = czm_inverseView * eyePos;
        vec3 sceneWorldPosKm = worldPos4.xyz * METER_TO_LENGTH_UNIT
          + altitudeCorrection * METER_TO_LENGTH_UNIT;
        float sceneR = length(sceneWorldPosKm);
        // 反演点在大气层内（容 5km 反演误差）= 真实地形；far plane 反演点 r 巨大被排除。
        if (sceneR < topR + 5.0 && sceneR > bottomR - 5.0) {
          hasScene = true;
          sceneDist = length(sceneWorldPosKm - cameraPosition);
        }
      }
    }
  }

  // —— 几何判定（视线方向，平滑）——
  // radialOut/muLook 已前移到 depth 采样前（Phase 1.2 门控用）；此处直接用前移的 muLook。
  bool hitBottom = rayForwardHitsSphere(cameraPosition, rayDirection, bottomR);
  bool brunetonIntersectsGround = RayIntersectsGround(ATMOSPHERE, camR, muLook);
  // 视线是否指向地球（与地表前向相交）—— sky/ground inscatter 函数选择的主判据（平滑，不读 depth）。
  bool lookingAtGround = brunetonIntersectsGround || hitBottom;

  // SUN 日盘抗锯齿每像素角宽度（dFdx/dFdy 必须在分叉前算，quad 内控制流一致）
  float fragmentAngle = length(dFdx(rayDirection) + dFdy(rayDirection)) / length(rayDirection);

  // 椭球面交点判别（ground inscatter 距离 tHitG 用，所有地面像素统一）。
  // cG 同 rayForwardHitsSphere 的 float32 稳定化（因式分解 + max 钉非负——相机语义不在球内，
  // 水下已 clamp 到面；原 dot(o,o)-R² 的 ±4km² 舍入噪声会让贴地像素的 discG/tHitG 噪声翻转）。
  float bG = dot(cameraPosition, rayDirection);
  float rCamG = length(cameraPosition);
  float cG = max((rCamG - bottomR) * (rCamG + bottomR), 0.0);
  float discG = bG * bG - cG;

  // —— DUAL inscatter：平滑基线 + depth 前景雾，mask 过渡带终点在地平线 → 分界线与地平线重合 ——
  // baseInscatter（平滑、不读 depth → 无掠射条纹）：地面→椭球面 tHitG，天空→getSkyRadiance。
  // foreInscatter（depth 真实距离 sceneDist → 山体不透明、前景雾正确）：hasScene 且 mask>0 时叠加。
  // Bug5：mask 改用正向窄过渡 smoothstep(CLOSE_KM*2, CLOSE_KM, sceneDist)（原 horizonKm 反向已弃，详见 Bug5 注释）。
  const float CLOSE_KM = 20.0;
  // 椭球面交点 tHitG（ground 基线距离用）。
  float tHitG = -1.0;
  if (discG > 0.0) {
    float sG = sqrt(discG);
    tHitG = -bG - sG;
    if (tHitG <= 1e-6) tHitG = -bG + sG;
    // sqrt(b²-c) 的舍入噪声同 rayForwardHitsSphere ②：贴地（c≈0）时 -bG+sG ≈ ±ULP(2462km)=±0.24m
    // 抖动——钉非负防 scenePos 落到相机背后（d=length 反而正确但参数化怪）。
    tHitG = max(tHitG, 0.0);
  }
  vec3 transmittance = vec3(1.0);
  vec3 inscatter = vec3(0.0);
  // 地面光色乘子（2026-09-01 影像×大气颜色同步，三专家评审定稿变体 1）：影像=正午白光快照，
  // 乘子=「当前照明/白光照明」比值 (sunIrr+skyIrr)/ATMOSPHERE.solar_irradiance（π 两侧同消，
  // 无量纲 O(1)；half-float LUT 比值消费是相对误差、无 A 路径 inscatter 式灾消——见 frag 头注释
  // A 路径警告的区别：那边 irradiance 作绝对亮度×15 放大，这边只作归一分母/分子）。
  // normal 必须向外 +normalize（评审 Critical：向内则直射 max(dot(n,sun),0) 恒 0、天光因子
  // (1+dot(n,p)/r)×0.5 恒 0 → 白天全黑）。
  // 夜间地板 max()：sun/sky 双归零后乘子→0，vec3 环境底接住（乘法保地物纹理，非加法自发光）。
  // 开关 mix(u_groundLighting)：1=启用默认 / 0=旧合成（A/B 对照兼 CI 逃生门）——避免 #define 新编译组合。
  // 【2026-09-02 地平线直线分界修复（mul 统一锚点）】乘子此前仅在 ground 分支内计算（锚=椭球
  // 交点），天空分支恒 1.0——切线角（数学地平线，俯角 0.62°@488m）翻转处 mul 1.0↔黄昏小值
  // 跳变 ×original → 地表亮度锐利直线切过山坡（用户定位 groundLighting=0 线消失）。修法=
  // mul 锚点统一、分支前计算：discG>0 用椭球交点、discG<0（打山/天空视线）用径向脚点——
  // 贴地场景两者太阳角差 <0.5°，mul 全屏连续，直线消失。真天空像素 original≈clearColor≈0，
  // 乘 mul 无影响；打山像素乘 mul=暮光暗照山体（物理正确）。
  vec3 groundLightColor;
  {
    vec3 mulAnchorKm = discG > 0.0
      ? cameraPosition + rayDirection * tHitG
      : normalize(cameraPosition) * ATMOSPHERE.bottom_radius;
    vec3 mulNormal = normalize(mulAnchorKm);
    float mulMuS = dot(mulAnchorKm, sunDirection) / length(mulAnchorKm);
    vec3 mulSunIrr = ATMOSPHERE.solar_irradiance
      * GetTransmittanceToSun(ATMOSPHERE, transmittance_texture, length(mulAnchorKm), mulMuS)
      * max(dot(mulNormal, sunDirection), 0.0);
    vec3 mulSkyIrr = GetIrradiance(
      ATMOSPHERE,
      irradiance_texture,
      length(mulAnchorKm),
      mulMuS
    ) * (1.0 + dot(mulNormal, mulAnchorKm) / length(mulAnchorKm)) * 0.5;
    groundLightColor = max(
      (mulSunIrr + mulSkyIrr) / ATMOSPHERE.solar_irradiance,
      u_groundNightAmbient
    );
  }
${o.moon ? '  vec3 moonDisc = vec3(0.0); // ground 分支保持 0（月盘只可能出自 sky 分支）\n' : ''}  vec3 finalColor;
  if (lookingAtGround && discG > 0.0) {
    // 地面基线：椭球面 tHitG（平滑）。（mul 已在分支前按统一锚点计算——2026-09-02 直线修复）
    vec3 scenePosKm = cameraPosition + rayDirection * tHitG;
    inscatter = GetSkyRadianceToPointScaled(
      cameraPosition,
      scenePosKm,
      0.0,
      sunDirection,
      transmittance
    );
  } else {
    // 天空基线（sky:false 在 skyBranch 内透传 return）。
${skyBranch}  }
  // 近处地形按 mask 叠加 depth 前景雾 → 山体不透明。mask>0 才算 foreInscatter（远处省 LUT）。
  // Bug5：mask 改正向窄过渡 smoothstep(CLOSE_KM, CLOSE_KM*2, sceneDist)——原 smoothstep(horizonKm, CLOSE_KM)
  // 在 camera 高（horizonKm=905km > CLOSE_KM=20km）反向 + 过渡带 885km 太宽 → fore/base inscatter 在
  // sceneDist 同心圆缓慢变化 → 圆圈内外大气散射阶梯（等高线）。正向窄过渡（20~40km）让 fore 快速衰减到
  // base 基线，圆圈消失。近处 sceneDist<CLOSE_KM mask=1（山体不透明）；远处 mask→0 走基线。
  // 【2026-09-02 地平线灰膜修复（depth=1 fallback）】Cesium 多 frustum 分段/瓦片流送窗口内，
  // PostProcess depthTexture 可能整块丢失地形深度（depth=1，debug=5 实锤：丢失区边界=屏幕上
  // 锐利水平直线，时有时无随流送时序——用户报「分界线与首次加载视角相关、不随视角更新」）。
  // hasScene=false → fore 关闭 → 打山视线（与海平面椭球无交 discG<0，Bruneton 无地形概念归
  // 天空分支）落回天空近似 final=original×0.5+全路径 skyInscatter×25 → 近山变中性灰膜
  // （实测 84,83,76），与上方 fore 正常渲染的远山形成直线分界。fallback：hasScene=false 且
  // discG>0 时用椭球交点 tHitG 充当 sceneDist 启用 fore——近地形 tHitG≈真实距离（地面≈海
  // 平面），恢复正确透视；真天空 discG<0 不进 fallback、tHitG>40km mask=0，均零影响。
  float foreDist = hasScene ? sceneDist : (discG > 0.0 ? tHitG : -1.0);
  float foreMask = 0.0;
  if (foreDist > 0.0) {
    float mask = smoothstep(CLOSE_KM * 2.0, CLOSE_KM, foreDist);  // 近=1 远=0，过渡带 20km
    foreMask = mask;
    if (mask > 0.0) {
      vec3 scenePosKm = cameraPosition + rayDirection * foreDist;
      vec3 foreTrans;
      vec3 foreInscatter = GetSkyRadianceToPointScaled(
        cameraPosition,
        scenePosKm,
        0.0,
        sunDirection,
        foreTrans
      );
      transmittance = mix(transmittance, foreTrans, mask);
      inscatter = mix(inscatter, foreInscatter, mask);
${o.moon ? '      moonDisc = mix(moonDisc, vec3(0.0), mask); // 前景雾同遮月（山体像素无月盘）\n' : ''}    }
  }

  // —— limb soft fade（用户需求：limb 边缘蓝白 inscatter 缓慢渐隐到黑太空，消除硬切边缘）。
  // 根因：Bruneton GetSkyRadiance 在视线错过大气顶层(topR)时 return 0，但视线与 topR 相切(limb)时
  // inscatter = LUT(topR, 切线) 非零（切线路径穿过大气整层）→ limb 内侧非零硬切到外侧 0，明显边缘。
  // 修复：内侧 inscatter 在 over→0 时 smoothstep fade 到 0（蓝白过渡平滑收尾到黑太空）。
  // 几何：b=|cross(camera,ray)|=视线到地心最近距离(impact parameter, km)；over=b-topR。
  // over<=-decay: inscatter 不变（满）；over∈[-decay,0]: 平滑 fade 到 0；over>0: 本就 0（太空）。
  // 首版用外侧 additive glow 形成独立亮带（双边缘更差），改为内侧 fade 无额外带——本质是让 limb 处
  // 原本硬切到 0 的非零 inscatter 提前平滑渐隐（"缓慢减弱"），代价 limb 处稍暗（物理 limb 辉光由内侧已含）。
  if (u_limbGlowIntensity > 0.0) {
    float limbB = length(cross(cameraPosition, rayDirection));  // impact parameter (km)
    float limbOver = limbB - topR;
    // 1 - smoothstep(-decay, 0, over)：over<=-decay→1（内侧远处 inscatter 不变，保留大气）；
    // over∈[-decay,0]→1..0（limb 附近渐隐）；over>=0→0（与外侧黑太空连续，无硬切边缘）。
    float limbFade = 1.0 - smoothstep(-u_limbGlowDecayKm, 0.0, limbOver);
    inscatter *= limbFade;
${o.moon ? '    moonDisc *= limbFade; // 与太阳盘行为一致（太空视角 limb 渐隐）\n' : ''}  }

  // —— 夜间天空 inscatter 淡出（2026-08-31 地平线泛红二轮修复；三轮改锚点）——
  // 根因：Bruneton 散射 LUT 高阶项在太阳深潜后不精确归零，地平线长路径残余 ×u_inscatterScale(25)
  // 放大成可见橙红（实测真深夜太阳 -69° 云全关仍整圈红，moon/nightAmbient 隔离均排除云侧）。
  // 窗口按标准暮光分级 sin(-12°)→sin(-6°)（首版 [-18°,-4°] 下界太深——太阳 -15.7° 仍保留 92%
  // 天文暮光红，用户实测满月时刻地平线仍泛红被驳回）：民用暮光（>-6°）零回归完整保留日落余晖、
  // 航海暮光（-6°→-12°）渐消、天文暮光（≤-12°）归零（LUT 残余已非物理，观感深夜=无红）。
  // **锚点=视线代表点（三轮修正；五轮再修天空分支）**：首版用相机径向法线——太空夜侧上空相机
  // muSunSky≈-1→fade=0 把整屏 inscatter（含晨昏带地表亮带）全归零，用户实测地表晨昏线消失被
  // 驳回。三轮天空分支改「离地心最近点」仍有塌陷：朝天视线 t*<0 脚点在相机背后、天顶视线脚点
  // ≈地心 normalize=NaN→inscatter=NaN 整屏黑（用户实测白天仰视天空全黑被驳回）。五轮天空分支
  // 改**大气顶层 topR 入口点**（射线-球前向交点，相机在大气内朝天必存在、物理=该视线进入大气
  // 的位置，其太阳角即这片天空的物理太阳角；太空朝外视线 miss 时 max 钉 0→锚=相机，太空黑
  // 本就无 inscatter 不受影响）。地面视线锚=椭球面交点 scenePosKm 不变。每像素按自身位置太阳
  // 角淡出：晨昏带地表点 el≈0 → fade=1 亮带保留；深夜侧地平线远云/天空 el<-12° → 归零不红。
  float rCam = length(cameraPosition);
  float rmuTop = dot(cameraPosition, rayDirection);
  float tTop = -rmuTop + sqrt(max(rmuTop * rmuTop - rCam * rCam + topR * topR, 0.0));
  vec3 fadeAnchor = (lookingAtGround && discG > 0.0)
    ? cameraPosition + rayDirection * tHitG
    : cameraPosition + rayDirection * tTop;
  // **六轮方向修复（2026-08-31 天空黑回归）**：首版 skyNightFade=1-smoothstep 用作乘数方向反
  // ——白天 mu>0 → fade=0 → inscatter 全消 → 天空黑+地形无雾（用户实测全屏黑；f5ab881 起就反，
  // 中间二~四轮验收图因 vite 缓存假绿未揭穿，二分+f5ab881 复测才定位）。正确语义=直接乘
  // smoothstep（太阳可见度：白天/晨昏带=1 保留、深夜≤-12°=0 消）。云侧 clouds.frag 的
  // inscatter *= 1.0 - skyNightFade 嵌套双重否定恰好同义，保持不动。
  float muSunSky = dot(normalize(fadeAnchor), sunDirection);
  float skySunVisibility = smoothstep(-0.2079, -0.1045, muSunSky);
  inscatter *= skySunVisibility;

  // 开关 mix：u_groundLighting=0 时乘子恒 1（旧合成逐位等价），1=启用（默认）
  groundLightColor = mix(vec3(1.0), groundLightColor, u_groundLighting);

  finalColor = originalColor.rgb * groundLightColor * transmittance * u_groundDim + inscatter * u_inscatterScale${o.moon ? ' + moonDisc' : ''};

  // —— 诊断（1=log finalColor 2=太阳方向 3=相机 r 量级 5=depth/r 6=透传 inputColor；
  //    7=线性输出 HDR 链验证，由链尾 tonemap 归一化；
  //    8=ground/sky 分支+foreMask 9=transmittance 10=inscatter(×50 clamp)——2026-09-02 地平线直线定位）——
  // 整个级联被 if (u_debugMode < 6.5) 包裹：debug=7（>6.5）跳过所有可视化分支，直接落到末端线性输出
  //（finalColor*exposure，>1 原样写 HalfFloat），由链尾 tonemap stage 的 >6.5 分支做 clamp(/5,0,1)
  // 归一化验证 HDR 承载 >1（spec §5.2/§6.3）。曾因降序级联无统一上限，debug=7 被 >4.5 分支截断输出
  // depth 可视化 → HDR 验证假阴性，现已用外层包裹修复。8/9/10 同理外置（>7.5）。
  if (u_debugMode < 6.5 || u_debugMode > 7.5) {
    if (u_debugMode > 7.5) {
      if (u_debugMode > 9.5) {
        out_FragColor = vec4(clamp(inscatter * 50.0, 0.0, 1.0), 1.0);
        return;
      }
      if (u_debugMode > 8.5) {
        out_FragColor = vec4(transmittance, 1.0);
        return;
      }
      // 8：R=ground/sky 分支（discG>0 亮）G=foreMask B=lookingAtGround
      out_FragColor = vec4(discG > 0.0 ? 0.8 : 0.2, foreMask, lookingAtGround ? 1.0 : 0.0, 1.0);
      return;
    }
    if (u_debugMode > 5.5) {
      out_FragColor = originalColor;
      return;
    }
    if (u_debugMode > 4.5) {
      out_FragColor = vec4(depth, 0.0, length(cameraPosition) / 6420.0, 1.0);
      return;
    }
    if (u_debugMode > 2.5) {
      float r = length(cameraPosition) / 6420.0;
      out_FragColor = vec4(vec3(r), 1.0);
      return;
    }
    if (u_debugMode > 1.5) {
      out_FragColor = vec4(sunDirection * 0.5 + 0.5, 1.0);
      return;
    }
    if (u_debugMode > 0.5) {
      vec3 v = log(vec3(1.0) + max(finalColor, vec3(0.0))) / log(100.0);
      out_FragColor = vec4(clamp(v, 0.0, 1.0), 1.0);
      return;
    }
  }

#ifdef DEPTH_TEMPORAL_EMA
  out_FragColor = vec4(finalColor * exposure, 1.0);  // Bug3：HDR .a=smoothLogDepth 不透传（专家1 M1：display alpha）
#else
  out_FragColor = vec4(finalColor * exposure, originalColor.a);  // UNSIGNED_BYTE main 行为
#endif
  // 线性 HDR，由链尾 tonemap stage 收尾
}
`
}

// 组装 PostProcessStage 用 fragment shader（含 czm_* automatic uniform 引用，仅供 Cesium 运行时）。
// 结构：prefix + RECIPROCAL_PI + 宏 defines（须在 bruneton/runtime 前，GROUND 被其消费）
// + uniforms + bruneton common/runtime + 辅助函数 + 天空函数 + main。
export function buildAerialPerspectiveFragmentShader(
  options: AerialPerspectiveFragOptions = {}
): string {
  const o: ResolvedOptions = {
    sun: true,
    sky: true,
    hdrDepthTemporal: false,
    cloudsShadowLength: false,
    cloudsGodRaysGain: 1.0,
    moon: true,
    ...options
  }

  const defines: string[] = ['#define GROUND'] // runtime RayIntersectsGround 用
  if (o.sun) defines.push('#define SUN')
  if (o.sky) defines.push('#define SKY')
  if (o.hdrDepthTemporal) defines.push('#define DEPTH_TEMPORAL_EMA') // Bug3：HDR 读 depthTemporal .a
  if (o.cloudsShadowLength) defines.push('#define CLOUDS_SHADOW_LENGTH') // M5 atmosphere 路径

  const uniforms: string[] = [POST_PROCESS_TEXTURES_GLSL, LUT_UNIFORMS_GLSL, FRAME_UNIFORMS_GLSL]
  if (o.sky && o.sun) uniforms.push(COS_SUN_ANGULAR_RADIUS_UNIFORM_GLSL)
  // M5 云 god rays atmosphere 路径：天空分支采样的视线云影长度（clouds march MRT att2，km 域）
  if (o.cloudsShadowLength) {
    uniforms.push('uniform sampler2D u_cloudsShadowLength;')
    uniforms.push('uniform float u_cloudsGodRaysGain;') // M5 光柱艺术增益（1=物理精确）
  }
  if (o.moon) uniforms.push(MOON_UNIFORMS_GLSL)

  // LOG_DEPTH_GLSL：czm_reverseLogDepthWindow（main depth 反演用）+ 配套反演辅助（logDepth.ts）。
  const functions: string[] = [HELPERS_GLSL, LOG_DEPTH_GLSL]
  if (o.sky) functions.push(buildSkyRadianceFn(o.sun, o.moon))

  const body = resolveIncludes(
    [
      ...uniforms,
      '#include "bruneton/common"\n#include "bruneton/runtime"',
      ...functions,
      buildMainFn(o)
    ].join('\n'),
    {
      bruneton: {
        common: glslIndex.bruneton.common,
        runtime: glslIndex.bruneton.runtime
      }
    }
  )

  return [buildAtmospherePrefix(), defines.join('\n'), body].filter(s => s.length > 0).join('\n')
}

// 供 Task 8 glslang 独立校验：补 #version 300 es + precision + Cesium 自动注入符号的桩。
// colorTexture/depthTexture 在主体 POST_PROCESS_TEXTURES_GLSL 声明；此处补 czm_* automatic uniform
// 桩 + czm_readDepth/czm_windowToEyeCoordinates 函数桩 + out_FragColor 桩。
const VALIDATION_STUBS_GLSL = `
uniform mat4 czm_inverseView;
uniform mat4 czm_inverseProjection;
uniform vec3 czm_viewerPositionWC;
uniform vec2 czm_currentFrustum;  // near(.x)/far(.y)，czm_reverseLogDepthWindow 用
vec4 czm_windowToEyeCoordinates(vec4 p) { return p; }
float czm_readDepth(sampler2D t, vec2 uv) { return 0.5; }
out vec4 out_FragColor;
`

export function buildStandaloneShaderForValidation(
  options: AerialPerspectiveFragOptions = {}
): string {
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    'precision highp sampler2D;',
    'precision highp sampler3D;',
    VALIDATION_STUBS_GLSL,
    buildAerialPerspectiveFragmentShader(options)
  ].join('\n')
}
