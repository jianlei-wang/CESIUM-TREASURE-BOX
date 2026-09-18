// M2 T1：three clouds.frag → Cesium 主 march fragment shader 桥接组装器。
//
// 核心挑战（plan T1）：clouds.frag 是完整 three.js fragment shader——
//   - 头部 1-99：precision + #include + three uniform（viewMatrix/cameraNear/Far/...）+ 7 个 in
//     varying（vUv/vCameraPosition/vCameraDirection/vRayDirection/vViewPosition/vGroundIrradiance/
//     vCloudsIrradiance，由 clouds.vert 算）+ MRT out layout（loc 0/1/2）
//   - main 100-1003：marchClouds 主循环 + shadow（BSM PCF）/haze/aerial perspective（bruneton
//     GetSkyRadianceToPoint）/temporal reprojection 交织，含多个 #ifdef DEBUG 分支
//
// M1 VolumetricPrimitive 用 createViewportQuadCommand（Cesium ViewportQuadVS 只输出
// v_textureCoordinates，不走 clouds.vert）。本组装器在编排层做文本手术 + 桥接 prefix，让
// clouds.frag 在 Cesium viewport quad 下跑（不动 clouds.frag 原文，保持 three 版形态便于上游 diff）。
//
// 桥接设计（方案 C：完整 clouds.frag + #define 占位 + dummy uniform）：
//   1. 剥离 3 个 three uniform（viewMatrix/cameraNear/cameraFar）→ #define 重定向到 czm_*
//   2. 剥离 7 个 in varying → 在 fragment 从 czm_viewerPositionWC / czm_inverseView /
//      czm_windowToEyeCoordinates + v_textureCoordinates 重建（clouds.vert 等价，但只在 fragment 跑）
//   3. 重命名 main → cloudsMainBody；wrapper main 先 cloudsBridge_reconstructVaryings() 再调用
//   4. M3/M4/M5 dummy：
//      - M3 BSM（T4 已接通）：shadowBuffer = ShadowPass.bsmTexture（sampler3D，z 归一化
//        (i+0.5)/SHADOW_CASCADE_COUNT 层中心采样）；cascade 选择 near 用独立 uniform
//        u_shadowCameraNear（BSM split 完整视锥 near，≠ czm_currentFrustum.x 分段值）。
//        未就绪时 CloudsPass fallback 1×1×3 全 0 dummy → sampleShadowOpticalDepth 返 0
//        → Beer-Lambert 1（无自阴影，flat lighting 降级）
//      - M4 temporal（T6 已接通）：reprojectionMatrix/viewReprojectionMatrix = preRender 组装
//        的 jittered 上帧矩阵（createCloudsStage 经 T1 temporalMath 算好写入 params）；ray 重建
//        消费 temporalJitter（Bayer 偏移，非 temporal 时恒 0 无偏移）；outputDepthVelocity
//        写 march 低分 MRT att1（CloudsResolvePass 消费做 velocity reprojection）
//      - M5 god rays（T1 已接通，默认开）：define SHADOW_LENGTH → marchShadowLength 沿视线
//        累加 BSM 光深 → applyAerialPerspective(camera, frontPos, shadowLength) 的
//        GetSkyRadianceToPoint 3 参 higher-order 分支 → 云间体积光柱；
//        outputShadowLength(loc2) 写 MRT att2（无消费者——three 喂 atmosphere 的路径 spec 不做）
//      - HAZE / GROUND_BOUNCE：不 define → 不编译
//      - ACCURATE_SUN_SKY_LIGHT：define → getCloudsSunSkyIrradiance 走 bruneton runtime 直算，
//        绕过 vGroundIrradiance/vCloudsIrradiance varying（fragment 重建下避免顶点预计算）
//      - getRayDistanceToScene：clouds.frag 原文读 depthBuffer（T2 提供 1×1 val=1.0 dummy →
//        depth<1.0-1e-7 false → 返 0.0 远截断；M6 接通真实 globe depthTexture + log-depth 转换）
//
// 双入口（仿 core aerialPerspective.frag.ts）：
//   - buildCloudsMainFragmentShader()：Cesium 运行时（无 #version；czm_* automatic uniform 由
//     ShaderProgram 自动注入）
//   - buildStandaloneCloudsShaderForValidation()：glslang 校验（补 #version 300 es + czm_* 桩）

import { ATMOSPHERE_DEFAULT_GLSL, LOG_DEPTH_GLSL } from '../cesium-core'
import { glslIndex } from './glslIndex'
import { resolveCloudsIncludes } from './resolveCloudsIncludes'

// M2 T1 桥接选项。
export interface CloudsMainOptions {
  /**
   * SHAPE_DETAIL 分支开关（clouds.glsl sampleMedia 走 shapeDetailTexture 细节修饰）。
   * 默认 true（M1 已搬 cloudShapeDetail 烘焙 + weather shape_detail 资产）。
   */
  shapeDetail?: boolean
  /**
   * TURBULENCE 分支开关（sampleMedia 走 turbulenceTexture 卷曲位移）。
   * 默认 true。
   */
  turbulence?: boolean
  /**
   * ACCURATE_SUN_SKY_LIGHT 开关（getCloudsSunSkyIrradiance 走 bruneton runtime
   * GetSunAndSkyScalarIrradiance 直算，绕过 vGroundIrradiance/vCloudsIrradiance varying）。
   * 默认 true（fragment 重建下避免顶点 irradiance 预计算；M2 clouds.vert 不走）。
   */
  accurateSunSkyLight?: boolean
  /**
   * Debug 视图（clouds.frag DEBUG_SHOW_* 分支，M2 视觉调试用）：
   *   'uv'（globeUv checker 映射）/ 'frontDepth'（turbo 云前深度）/ 'sampleCount'（march 采样数）/
   *   'shadowMap'（BSM 可视化，M3）/ 'cascades'（cascade 分层着色：红=0 绿=1 蓝=2，越界=白）。
   *   默认 null 正常渲染。
   */
  debugShow?: 'uv' | 'frontDepth' | 'sampleCount' | 'shadowMap' | 'cascades' | 'march' | 'marchA' | null
  /**
   * M5 云 god rays 开关（默认 true，对齐 three defaults.lightShafts）：define SHADOW_LENGTH →
   * marchShadowLength 沿视线累加 BSM 光深 → applyAerialPerspective 以 shadow_length 调
   * GetSkyRadianceToPoint（higher-order 分支只遮 single，防过暗）→ 云前表面大气散射被云影
   * 调制 = 朝太阳方向的云间体积光柱。false = 诊断基线（无该编译分支）。demo ?cloudsLightShafts=0。
   */
  lightShafts?: boolean
  /**
   * 级联数（→ #define SHADOW_CASCADE_COUNT；spec §6 参数化）。默认 3。
   * 档位路径由 applyQualityPreset 投影（applied.main.shadowCascadeCount），用户直传仅在
   * 不用档位时生效（quality 在场时被忽略——spec §5 单一来源）。
   */
  shadowCascadeCount?: number
  /**
   * march 分辨率分母（2026-09-03 穿云黑块修复）：>1 = 低分 march，depth 采样带
   * temporalJitter（低分网格亚 texel 深度采样，上游超分语义）；1（缺省）= 全分 march，
   * depth 采样**不带** jitter——±0.5px 偏移在云/地形深度边缘读到天空深度 →
   * rayDistanceToScene=0 → march 不被地形截断 → 傍晚低角度长路径 Beer 满衰减 →
   * 覆盖率满黑帧（temporal history 固化成扩散黑块）；全分下无超分收益纯伤害。
   * 以 #define LOW_RES_MARCH 编译期裁剪。非法值（非 2/4）视同 1。
   */
  upscaleDivisor?: 1 | 2 | 4
}

type ResolvedCloudsMainOptions = Required<CloudsMainOptions>

const DEFAULTS: ResolvedCloudsMainOptions = {
  shapeDetail: true,
  turbulence: true,
  accurateSunSkyLight: true,
  debugShow: null,
  lightShafts: true,
  shadowCascadeCount: 3,
  upscaleDivisor: 1
}

// Bruneton 大气 LUT 纹理尺寸 + 单位换算 + 多阶散射开关——clouds.frag 经 #include
// "atmosphere/bruneton/runtime" 引用这些（runtime 末尾 GetSkyRadianceToPoint 用）。
// 值逐字对齐 clouds.compile.test.ts BRUNETON_DEFINES（源自 core/cesium/cesiumCore.ts
// buildAtmospherePrefix）。T2 运行时 assembler 复用同一组。
const BRUNETON_DEFINES = [
  '#define TRANSMITTANCE_TEXTURE_WIDTH 256',
  '#define TRANSMITTANCE_TEXTURE_HEIGHT 64',
  '#define SCATTERING_TEXTURE_R_SIZE 32',
  '#define SCATTERING_TEXTURE_MU_SIZE 128',
  '#define SCATTERING_TEXTURE_MU_S_SIZE 32',
  '#define SCATTERING_TEXTURE_NU_SIZE 8',
  '#define IRRADIANCE_TEXTURE_WIDTH 64',
  '#define IRRADIANCE_TEXTURE_HEIGHT 16',
  '#define METER_TO_LENGTH_UNIT 0.001',
  '#define COMBINED_SCATTERING_TEXTURES',
  '#define HAS_HIGHER_ORDER_SCATTERING_TEXTURE'
]

// clouds.frag 主 pipeline 额外 define（对齐 clouds.compile.test.ts CLOUDS_FRAG_DEFINES）。
// unroll 循环上界（SHADOW_CASCADE_COUNT/SHADOW_SAMPLE_COUNT/MULTI_SCATTERING_OCTAVES）+
// sampleWeather swizzle 宏 + DEPTH_PACKING（readDepthValue 走 texture().r 分支）。
const CLOUDS_MAIN_DEFINES = [
  ...BRUNETON_DEFINES,
  '#define SCATTER_ANISOTROPY_1 0.5',
  '#define SCATTER_ANISOTROPY_2 -0.5',
  '#define SCATTER_ANISOTROPY_MIX 0.35',
  // M3 cascade 数 4→3 对齐 CascadedShadowMaps；cascade define 移至 buildM2Defines 按参数生成
  // （shadowCascadeCount，spec §6——low 档 2 级联）。
  '#define SHADOW_SAMPLE_COUNT 16',
  '#define MULTI_SCATTERING_OCTAVES 6',
  '#define LOCAL_WEATHER_CHANNELS rgba',
  '#define DEPTH_PACKING 0',
  // M3 决策 D4：powder 效果（clouds.frag L581 面向光源边缘变暗）。three CloudsMaterial 在
  // powderScale > 0 时动态 define；本仓库 powderScale=0.8（cloudsDefaultParameters）恒正 → 固定开。
  // M2 漏 define 导致云底/向光侧偏亮（Beer 无 powder 项）。
  '#define POWDER'
]

// 构造 M2 运行期 define 集（基础 clouds.frag 编译分支 + M2 桥接分支开关）。
function buildM2Defines(o: ResolvedCloudsMainOptions): string[] {
  // 穿云黑块修复（2026-09-03）：depth 采样 jitter 仅低分 march（targetUvScale>1）需要
  // （低分网格亚 texel 深度采样）；全分下 jitter 把深度边缘采样切到天空 → march 不被
  // 地形截断 → 傍晚长路径 Beer 黑帧。非法值（非 2/4）视同 1（与 CloudsPass resolve 同款防御）。
  const lowResMarch = o.upscaleDivisor === 2 || o.upscaleDivisor === 4
  return [
    ...CLOUDS_MAIN_DEFINES,
    '#define PERSPECTIVE_CAMERA', // getViewZ perspectiveDepthToViewZ 分支（Cesium 相机恒透视）
    '#define SHADOW_CASCADE_COUNT ' + o.shadowCascadeCount,
    lowResMarch ? '#define LOW_RES_MARCH' : '',
    o.accurateSunSkyLight ? '#define ACCURATE_SUN_SKY_LIGHT' : '',
    o.shapeDetail ? '#define SHAPE_DETAIL' : '',
    o.turbulence ? '#define TURBULENCE' : '',
    o.debugShow === 'uv' ? '#define DEBUG_SHOW_UV' : '',
    o.debugShow === 'frontDepth' ? '#define DEBUG_SHOW_FRONT_DEPTH' : '',
    o.debugShow === 'sampleCount' ? '#define DEBUG_SHOW_SAMPLE_COUNT' : '',
    o.debugShow === 'shadowMap' ? '#define DEBUG_SHOW_SHADOW_MAP' : '',
    o.debugShow === 'cascades' ? '#define DEBUG_SHOW_CASCADES' : '',
    // 【2026-09-03 穿云黑块探针】march 分量直显（rgb×50 / alpha；a 钉 1 防 overlay 混淆）
    o.debugShow === 'march' ? '#define DEBUG_SHOW_MARCH_RADIANCE' : '',
    o.debugShow === 'marchA' ? '#define DEBUG_SHOW_MARCH_ALPHA' : '',
    o.lightShafts ? '#define SHADOW_LENGTH' : ''
  ].filter(s => s.length > 0)
}

// czm_* automatic uniform / 函数桩（仅 glslang 校验用）。
// Cesium 运行时由 ShaderProgram._automaticUniforms 自动注入（spec 附录 F6 R10 已确认 Primitive
// 走 ShaderProgram 必注入）。校验入口补类型匹配的桩声明 + 桩函数。
// 注：czm_reverseLogDepthDist/Window 不是 Cesium 内置——由 core LOG_DEPTH_GLSL 注入真定义
// （buildCloudsMainFragmentShader 拼接），勿在此加桩（重复定义冲突）。
const CZM_STUBS_GLSL = `
// czm_* automatic uniform 桩（Cesium 运行时注入；glslang 校验需手写声明）
uniform vec3 czm_viewerPositionWC;
uniform mat4 czm_view;
uniform mat4 czm_inverseView;
uniform mat4 czm_inverseProjection;
uniform vec2 czm_currentFrustum;
// czm_windowToEyeCoordinates 桩：实际 Cesium 函数把 window 坐标（含 log-depth）反演到 eye space。
// 校验只需类型签名匹配（vec4 → vec4），不执行真反演。
vec4 czm_windowToEyeCoordinates(vec4 windowCoord) { return windowCoord; }
`

// 桥接 #define：clouds.frag three.js 命名 uniform → Cesium automatic uniform 重定向。
// 必须放在 clouds.frag 文本之前（预处理期替换所有使用点）。剥离 clouds.frag 原 three 声明后，
// 这是 viewMatrix/cameraNear/cameraFar 的唯一定义来源。
//
// 注：GLSL 预处理器 #define IDENT REPL 是 token 级替换——`inverseViewMatrix`/`viewReprojectionMatrix`
// 是不同 token，不会被 `#define viewMatrix czm_view` 误伤。
const BRIDGE_DEFINES_GLSL = `
// —— Cesium → three 桥接：uniform #define 重定向 ——
// clouds.frag 原声明 uniform mat4 viewMatrix / float cameraNear / float cameraFar（three.js 命名）。
// 剥离原声明后用 #define 重定向到 Cesium automatic uniform；使用点（getViewZ / getRayNearFar /
// sampleShadowOpticalDepth 内 getFadedCascadeIndex / marchShadowLength）自动跟随。
// inverseViewMatrix / cameraPosition / worldToECEFMatrix 只在 clouds.vert 用（M2 不走 vert，N/A）。
#define viewMatrix czm_view
#define cameraNear czm_currentFrustum.x
#define cameraFar czm_currentFrustum.y

// M3 决策 D3：cascade 选择的归一化 near 解耦——viewZToOrthographicDepth(viewZ, near, shadowFar)
// 的归一化域必须与 BSM split（preRender 时刻完整视锥 near/far）一致；而上面 cameraNear 被
// #define 到 czm_currentFrustum.x（multi-frustum 分段值），分段执行时归一化错位 → cascade 全错。
// 故 surgery 把 cascade 选择 3 处调用点的 cameraNear 换本 uniform（CloudsPass 从
// state.shadow.cameraNear 注入）。getViewZ 的 depth 反演继续用 czm_currentFrustum（段语义正确）。
uniform float u_shadowCameraNear;
`

// 桥接 varying 重建块（替代 clouds.frag 原 7 个 in varying；clouds.vert 算 → fragment 重建）。
//
// 必须出现在 clouds.frag `#include "types"` 之后（GroundIrradiance/CloudsIrradiance 类型可见），
// 故接到 clouds.frag 文本末尾（surgery 后 main 已改名为 cloudsMainBody），wrapper main 之前。
//
// 重建几何（clouds.vert 等价，Cesium 自动 uniform 替代 three uniform）：
//   - vUv = v_textureCoordinates（Cesium ViewportQuadVS position.xy*0.5+0.5 == clouds.vert L68）
//   - vCameraPosition = czm_viewerPositionWC（ECEF 相机，米；clouds.frag main L833 + altitudeCorrection
//     得密切球局部系坐标——worldToECEFMatrix 在 Cesium 退化为单位，故无需变换）
//   - vRayDirection = czm_windowToEyeCoordinates 近/远平面差分 → czm_inverseView 转 ECEF
//     （仿 core aerialPerspective.frag.ts reconstructRay，避免 ndc + inverseProjection 在仰视
//     净空 / log-depth 下退化）。M4 T6：窗口坐标加 Bayer jitter（temporalJitter*resolution
//     = 全分像素单位偏移 ±2px = ±0.5 低分 texel；与 depth 采样 UV / 噪声种子三处原文 jitter
//     语义对齐——three 版 jitter 走 inverseProjectionMatrix 注入，本重建路径等价改为
//     gl_FragCoord 偏移；temporalJitter=0 时零偏移，非 temporal 全分行为不变）
//   - vCameraDirection = czm_inverseView * vec4(0,0,-1,0)（相机正前方向 ECEF，clouds.vert L72 等价；
//     getRayDistanceToScene L817 用，M6 depth 接通时生效）
//   - vViewPosition = normalize(dirEC)——view-space 单位视线方向（M4：与 three 未归一化版
//     （(inverseProjectionMatrix*ndc).xyz）共线——velocity 投影 viewReprojectionMatrix *
//     (vViewPosition*frontDepth) 经 prevClip.w 除法抵消标量差，语义等价）
//   - vGroundIrradiance/vCloudsIrradiance = 零（ACCURATE_SUN_SKY_LIGHT define 绕过 varying 读取）
const BRIDGE_VARYINGS_GLSL = `
// —— Cesium → three 桥接：varying 重建（替代 clouds.frag 原 7 个 in，clouds.vert 算）——
// M1 VolumetricPrimitive 用 createViewportQuadCommand（Cesium ViewportQuadVS 只输出
// v_textureCoordinates），不走 clouds.vert。在 fragment 从 czm_* + v_textureCoordinates 重建。
in vec2 v_textureCoordinates;  // Cesium ViewportQuadVS 注入

// 替代 clouds.frag 原 in varying（clouds.vert 本应输出）——声明为普通全局，由
// cloudsBridge_reconstructVaryings() 在 main 起始处填充。clouds.frag main（已改名 cloudsMainBody）
// 像原 three 版一样直接读这些变量。
vec2 vUv;
vec3 vCameraPosition;
vec3 vCameraDirection;
vec3 vRayDirection;
vec3 vViewPosition;
GroundIrradiance vGroundIrradiance;
CloudsIrradiance vCloudsIrradiance;

// 桥接：从 czm_* 重建 clouds.vert 本应输出的 varying。wrapper main 调用一次后 cloudsMainBody
// 接管，原 clouds.frag main 体不变。
void cloudsBridge_reconstructVaryings() {
  vUv = v_textureCoordinates;
  // ECEF 相机（米）——clouds.frag main L833 「+ altitudeCorrection」得密切球局部系坐标。
  vCameraPosition = czm_viewerPositionWC;

  // 视线方向（view space）：czm_windowToEyeCoordinates 近/远平面差分（仿 core reconstructRay）。
  // M4 T6：窗口坐标加 Bayer jitter（temporalJitter*resolution 单位 = 全分像素）。
  // ⚠️ 低分 march 域换算（2026-08-17 抖动根因修复）：gl_FragCoord 是**低分 FBO viewport 域**
  // （0..lowRes），而 czm_windowToEyeCoordinates 的窗口→NDC 反算按 czm_viewport（全分
  // drawingBuffer 域）——不换算会把低分坐标当全分坐标，NDC 系统性偏 4×（ray 方向错、
  // velocity 恒定非 0 → history 错位采样 → 静止时 AABB clip 拉锯 = 云整体抖动）。
  // 换算式：全分窗口 = gl_FragCoord / targetUvScale（targetUvScale = lowRes*4/全分，非
  // temporal 时 (1,1) 恒等——M2/M3 行为不变）。jitter 项已是全分像素单位，不随换算缩放。
  vec2 windowCoord = gl_FragCoord.xy / targetUvScale + temporalJitter * resolution;
  vec4 eyeNear = czm_windowToEyeCoordinates(vec4(windowCoord, 0.0, 1.0));
  vec4 eyeFar = czm_windowToEyeCoordinates(vec4(windowCoord, 1.0, 1.0));
  if (abs(eyeNear.w) > 1e-10) eyeNear /= eyeNear.w;
  if (abs(eyeFar.w) > 1e-10) eyeFar /= eyeFar.w;
  vec3 dirEC = eyeFar.xyz - eyeNear.xyz;
  if (dot(dirEC, dirEC) < 1e-20) dirEC = eyeFar.xyz;
  vViewPosition = normalize(dirEC);  // view-space 单位方向（与 three 未归一化版共线——见文件头注释）
  vRayDirection = (czm_inverseView * vec4(dirEC, 0.0)).xyz;  // ECEF 视线方向

  // 相机正前方向（view -Z → ECEF）——clouds.vert L72 等价。getRayDistanceToScene 用（M6 接通）。
  vCameraDirection = (czm_inverseView * vec4(0.0, 0.0, -1.0, 0.0)).xyz;

  // §11.1（spec v3）：accurate 关时移植参考库 clouds.vert sampleSunSkyIrradiance 云段
  //（shaders/clouds.vert:53-64）——min/max 云高 2 次 GetSunAndSkyScalarIrradiance（每次返
  // sun+sky 双值 = 4 分量），每像素一次性，远廉于 per-sample 直算（ACCURATE 路径 march
  // 循环内逐采样调，clouds.frag:535）。ground 2 分量不移植：消费点均在未 define 的
  // HAZE/GROUND_BOUNCE 分支（spec §11.1 v3 裁决——未来开启须补，否则云底 bounce 恒 0）。
  // 依赖 uniform（altitudeCorrection/sunDirection/bottomRadius/minHeight/maxHeight）均已在
  // clouds.frag 声明；GetSunAndSkyScalarIrradiance/METER_TO_LENGTH_UNIT 来自 bruneton runtime include。
#ifndef ACCURATE_SUN_SKY_LIGHT
  vec3 bridgeIrradPos = vCameraPosition + altitudeCorrection;
  vec3 bridgeSurfaceNormal = normalize(bridgeIrradPos);
  vec2 bridgeCloudsRadii = (bottomRadius + vec2(minHeight, maxHeight)) * METER_TO_LENGTH_UNIT;
  vCloudsIrradiance.minSun = GetSunAndSkyScalarIrradiance(
    bridgeSurfaceNormal * bridgeCloudsRadii.x, sunDirection, vCloudsIrradiance.minSky);
  vCloudsIrradiance.maxSun = GetSunAndSkyScalarIrradiance(
    bridgeSurfaceNormal * bridgeCloudsRadii.y, sunDirection, vCloudsIrradiance.maxSky);
#else
  // ACCURATE define → getCloudsSunSkyIrradiance 直算，varying 不被读；零初始化防未定义读。
  vCloudsIrradiance.minSun = vec3(0.0);
  vCloudsIrradiance.minSky = vec3(0.0);
  vCloudsIrradiance.maxSun = vec3(0.0);
  vCloudsIrradiance.maxSky = vec3(0.0);
#endif
  vGroundIrradiance.sun = vec3(0.0);
  vGroundIrradiance.sky = vec3(0.0);
}
`

// wrapper main：重建桥接 varying 后调用 clouds.frag 原 main（cloudsMainBody）。
// cloudsMainBody 内 `return;`（DEBUG 分支，M2 默认 #ifdef 掉）只 return 出 cloudsMainBody，
// wrapper 顺势结束 main。MRT outputColor/outputDepthVelocity 在 cloudsMainBody 体内写入。
const WRAPPER_MAIN_GLSL = `
// M2 T1 wrapper main：先重建桥接 varying，再跑 clouds.frag 原 main 体（cloudsMainBody）。
void main() {
  cloudsBridge_reconstructVaryings();
  cloudsMainBody();
}
`

// 文本手术：剥离 + 改名 clouds.frag 源（不改原 .glsl 文件）。
// 锚点唯一性已核实（grep 验证）：viewMatrix/cameraNear/cameraFar 各一处；in vUv...in CloudsIrradiance
// vCloudsIrradiance 一段连续；void main() 一处。
//
// 关键：桥接 varying 声明必须 IN-PLACE 替换 clouds.frag 原 `in` 块（L87-93，位于所有使用 vUv 等
// 的函数之前）。若追加到文件末尾，getRayDistanceToScene / getCloudsSunSkyIrradiance 等函数会在
// 声明前使用 vUv/vGroundIrradiance → GLSL undeclared identifier。
function surgeryCloudsFrag(source: string): string {
  let src = source

  // 1) 剥离 3 个桥接 uniform 声明（与 BRIDGE_DEFINES_GLSL #define 重定向配套；防双重声明冲突）
  src = src.replace(/uniform mat4 viewMatrix;\n/, '')
  src = src.replace(/uniform float cameraNear;\n/, '')
  src = src.replace(/uniform float cameraFar;\n/, '')

  // 1b) 剥离 uniform AtmosphereParameters ATMOSPHERE; → 原地替换为 const ATMOSPHERE 构造。
  //     原因（同 core cesiumCore.ts 注释）：Cesium uniformMap（ShaderProgram 自动 uniform 派发）
  //     不支持嵌套 struct / struct 数组——AtmosphereParameters 含 DensityProfile（内嵌
  //     DensityProfileLayer[2] 数组），无法经 uniformMap 注入。core 已验证的方案是 GLSL
  //     `const` 构造注入（ATMOSPHERE_DEFAULT_GLSL，逐字取自 three-geospatial
  //     AtmosphereParameters.DEFAULT）。此 uniform 声明位于 clouds.frag L19（紧跟 L17
  //     #include "atmosphere/bruneton/definitions" 之后），原地替换保证 const 在 struct 定义之后。
  src = src.replace(
    /uniform AtmosphereParameters ATMOSPHERE;\n/,
    `${ATMOSPHERE_DEFAULT_GLSL}\n`
  )

  // 2) IN-PLACE 替换 7 个 in varying 块（L87-93）为桥接块（in v_textureCoordinates + 变量声明 +
  //    reconstruct 函数）。非贪婪 [\s\S]*? 匹配 vUv...vCloudsIrradiance 最短块（grep 验证锚点唯一）。
  //    替换后桥接块位于 clouds.frag 原 in 块位置——所有使用 vUv/vCameraPosition/vGroundIrradiance
  //    的函数（getRayDistanceToScene L812 / getCloudsSunSkyIrradiance L438 / main L823）均在之后。
  src = src.replace(
    /in vec2 vUv;\n[\s\S]*?in CloudsIrradiance vCloudsIrradiance;\n/,
    BRIDGE_VARYINGS_GLSL
  )

  // 3) 重命名 main → cloudsMainBody（clouds.frag L823 唯一处 void main()）
  src = src.replace(/\bvoid\s+main\s*\(\s*\)\s*\{/, 'void cloudsMainBody() {')

  // 4) shadowBuffer: sampler2DArray → sampler3D。Cesium createUniform 不认 sampler2DArray
  //    （type 36289，createUniform.js:31-35 仅 SAMPLER_2D/3D/CUBE/UNSIGNED_INT_SAMPLER_2D）→
  //    shader bind 炸 "Unrecognized uniform type: 36289"。M2 dummy 全 0（Texture3D），
  //    texture(sampler3D, vec3) 与 sampler2DArray 调用兼容（vec3）；
  //    M3 真实 BSM 时决定 sampler3D 模拟 cascade 离散化 或 augment createUniform 支持 2D_ARRAY。
  src = src.replace(
    /uniform sampler2DArray shadowBuffer;/,
    'uniform sampler3D shadowBuffer;'
  )

  // 5) getRayDistanceToScene 函数体替换（M6 depth 提前接通，2026-08-14）：three 版
  //    readDepthValue + reverseLogDepth（three log-depth 公式）+ getViewZ 不适用 Cesium——
  //    Cesium logarithmicDepthBuffer 的编码不同。改用 core LOG_DEPTH_GLSL 的
  //    czm_reverseLogDepthDist（log-depth → 视轴深度 -z_eye 米值，一步到位无需反投影，
  //    仿 core aerialPerspective.frag Bug1 修法）→ 沿 ray 距离。depthBuffer 由 CloudsPass
  //    注入 globeDepth.depthStencilTexture（scene._view 私有路径，spec 附录 F5）。
  //    锚点唯一（getRayDistanceToScene 定义一处，grep 验证）。
  src = src.replace(
    /float getRayDistanceToScene\(const vec3 rayDirection, out float viewZ\) \{\n  float depth = readDepthValue\(depthBuffer, vUv \* targetUvScale \+ temporalJitter\);\n  if \(depth < 1\.0 - 1e-7\) \{\n    depth = reverseLogDepth\(depth, cameraNear, cameraFar\);\n    viewZ = getViewZ\(depth\);\n    return -viewZ \/ dot\(rayDirection, vCameraDirection\);\n  \}\n  viewZ = 0\.0;\n  return 0\.0;\n\}/,
    `float getRayDistanceToScene(const vec3 rayDirection, out float viewZ) {
  // Cesium 桥接：globe depthTexture 是 log-depth 编码（logarithmicDepthBuffer=true），
  // czm_reverseLogDepthDist（core LOG_DEPTH_GLSL 注入）反演视轴深度；three 版
  // reverseLogDepth 公式不适用 Cesium。
  // 【2026-09-03 穿云黑块修复】depth 采样 jitter 仅低分 march（LOW_RES_MARCH）保留：
  // 全分下 vUv±jitter（±0.5px）在深度边缘读到天空深度 → rayDistanceToScene=0 →
  // march 不被地形截断 → 傍晚低角度长路径 Beer 满衰减 → 覆盖率满黑帧（temporal history
  // 固化成扩散黑块）；全分无超分收益纯伤害。低分（targetUvScale>1）下 jitter 提供
  // 亚 texel 深度采样（超分重建边缘，上游语义）。
  #ifdef LOW_RES_MARCH
  float logDepth = texture(depthBuffer, vUv * targetUvScale + temporalJitter).r;
  #else
  float logDepth = texture(depthBuffer, vUv * targetUvScale).r;
  #endif
  if (logDepth < 1.0 - 1e-7) {
    float zDist = czm_reverseLogDepthDist(logDepth, czm_currentFrustum.x, czm_currentFrustum.y);
    viewZ = -zDist;
    return -viewZ / dot(rayDirection, vCameraDirection);
  }
  viewZ = 0.0;
  return 0.0;
}`
  )

  // 6) M3：sampler3D 的 z 是归一化深度（sampler2DArray 才是 layer 索引）——半 texel 中心采样，
  //    z 恰在层中心 → LINEAR 三线性 z 邻层权重 0，无跨层混叠（决策 D1）。锚点唯一（L180）。
  src = src.replace(
    /vec4 shadow = texture\(shadowBuffer, vec3\(uv, float\(cascadeIndex\)\)\);/,
    'vec4 shadow = texture(shadowBuffer, vec3(uv, (float(cascadeIndex) + 0.5) / float(SHADOW_CASCADE_COUNT)));'
  )

  // 6b) M3：DEBUG_SHOW_SHADOW_MAP 的 4 处 layer 字面量（L257-270 原文 0.0/1.0/2.0/3.0）同 z
  //     归一化语义换 (i+0.5)/SHADOW_CASCADE_COUNT（sampler3D z ∈ [0,1] 连续深度，非 layer 索引）。
  //     #if SHADOW_CASCADE_COUNT > N 分支结构保留（COUNT=3 时 i=3 分支被预处理裁掉）。
  src = src.replace(/vec3\(coord\.xw, 0\.0\)/, 'vec3(coord.xw, 0.5 / float(SHADOW_CASCADE_COUNT))')
  src = src.replace(/vec3\(coord\.zw, 1\.0\)/, 'vec3(coord.zw, 1.5 / float(SHADOW_CASCADE_COUNT))')
  src = src.replace(/vec3\(coord\.xy, 2\.0\)/, 'vec3(coord.xy, 2.5 / float(SHADOW_CASCADE_COUNT))')
  src = src.replace(/vec3\(coord\.zy, 3\.0\)/, 'vec3(coord.zy, 3.5 / float(SHADOW_CASCADE_COUNT))')

  // 7) M3：cascade 选择的归一化 near 必须用 BSM split 时的完整 near（u_shadowCameraNear，
  //    BRIDGE_DEFINES_GLSL 尾部声明），而非 czm_currentFrustum.x（multi-frustum 分段值——
  //    分段执行时归一化错位 → cascade 全错）。3 处调用点：getCascadeColor /
  //    getFadedCascadeColor / sampleShadowOpticalDepth（marchShadowLength 经
  //    sampleShadowOpticalDepth 间接覆盖，M5 SHADOW_LENGTH 接通时自动正确）。
  src = src.split('cameraNear,\n    shadowFar').join('u_shadowCameraNear,\n    shadowFar')

  return src
}

/**
 * 组装 Cesium 运行时 clouds 主 march fragment shader（three clouds.frag → Cesium 桥接）。
 *
 * 结构（拼接顺序关键）：
 *   1. defines（Bruneton LUT 尺寸 + M2 编译分支 + 桥接开关）
 *   2. BRIDGE_DEFINES_GLSL（viewMatrix/cameraNear/cameraFar → czm_* #define 重定向）
 *   3. clouds.frag 文本（surgery 后：3 uniform 剥离 + 7 in 块 IN-PLACE 替换为桥接块 +
 *      main 改名 cloudsMainBody）——桥接块在 clouds.frag 原 in 块位置（L87），所有使用
 *      vUv/vCameraPosition/vGroundIrradiance 的函数均在之后（GLSL 声明先于使用）
 *   4. WRAPPER_MAIN_GLSL（新 main：重建 varying → 调用 cloudsMainBody）
 *
 * 不写 #version / precision 兜底——clouds.frag 原文 L1-3 已含 precision；#version 由 Cesium
 * ShaderProgram 注入。czm_* automatic uniform 由 ShaderProgram._automaticUniforms 注入。
 */
export function buildCloudsMainFragmentShader(
  options: CloudsMainOptions = {}
): string {
  const o: ResolvedCloudsMainOptions = { ...DEFAULTS, ...options }

  const defines = buildM2Defines(o).join('\n')
  const surg = surgeryCloudsFrag(glslIndex.cloudsFrag)

  // LOG_DEPTH_GLSL（core）：czm_reverseLogDepthDist 等 Cesium 对数深度反演（非 Cesium 内置，
  // 必须注入定义）——getRayDistanceToScene（surgery 替换后）消费。放 surgery 之前 = 位于
  // clouds.frag 所有函数定义前（GLSL 声明先于使用）。
  const merged = [
    defines,
    BRIDGE_DEFINES_GLSL,
    LOG_DEPTH_GLSL,
    surg,
    WRAPPER_MAIN_GLSL
  ].join('\n\n')

  // resolveCloudsIncludes：Three <chunk> 兼容桩 + 跨包 core/* + atmosphere/bruneton/* + clouds 本地
  // + unrollLoops。桥接 #define / 全局变量声明 / wrapper main 不含 #include，原样穿透。
  let resolved = resolveCloudsIncludes(merged)

  // densityProfile struct uniform → const 注入（同 ATMOSPHERE 理由：Cesium uniformMap 不支持
  // struct 注入；CloudDensityProfile 是 flat struct 4×vec4，构造简单）。声明在 parameters.glsl
  // （经 #include "parameters" 展开进入 resolved），此处后处理替换。
  // 值 = CloudLayers.DEFAULT packDensityProfiles 结果（每层 CloudLayer 默认 densityProfile
  // (expTerm=0, exponent=0, linearTerm=0.75, constantTerm=0.25) → 四层 pack 后 vec4 标量）。
  // M2 固定 CloudLayers.DEFAULT；M6 qualityPresets 可在此参数化或改 uniform struct（若 Cesium 验证支持）。
  resolved = resolved.replace(
    /uniform CloudDensityProfile densityProfile;\n/,
    `const CloudDensityProfile densityProfile = CloudDensityProfile(\n` +
      `  vec4(0.0), vec4(0.0), vec4(0.75), vec4(0.25));\n`
  )

  return resolved
}

/**
 * glslang 校验入口：补 #version 300 es + precision + czm_* 桩 + 运行时 shader。
 *
 * 校验桩（CZM_STUBS_GLSL）：czm_viewerPositionWC / czm_view / czm_inverseView /
 * czm_inverseProjection / czm_currentFrustum / czm_windowToEyeCoordinates 函数。
 * clouds.frag 自声明的 business uniforms（sampler2D/3D/2DArray、ATMOSPHERE、sun/scatter 参数）
 * 经 #include 链全部自洽，glslang 只编译不链接，无需绑定。
 */
export function buildStandaloneCloudsShaderForValidation(
  options: CloudsMainOptions = {}
): string {
  const runtime = buildCloudsMainFragmentShader(options)
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    'precision highp sampler2D;',
    'precision highp sampler3D;',
    'precision highp sampler2DArray;',
    CZM_STUBS_GLSL,
    runtime
  ].join('\n')
}
