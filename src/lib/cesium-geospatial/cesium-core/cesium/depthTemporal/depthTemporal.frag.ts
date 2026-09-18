// depthTemporal fragment shader 组装器（方案 A 单 stage 打包透传）。
//
// 评审钉死（spec v2 critical）：
// - EMA 在 raw log-depth 域（禁 czm_readDepth = czm_reverseLogDepth → window-depth，见 spec critical #2）。
// - reproject 纯 ECEF 米域（禁 altitudeCorrection / METER_TO_LENGTH_UNIT，避免密切球局部系扭曲）。
// - 2-arg czm_windowToEyeCoordinates(vec2, float)：LOG_DEPTH 分支接收 log-depth，返回 .xyz 真眼坐标
//   （已含逆透视），.w = 1/depthFromCamera（非透视 w）。用 .xyz、不除 .w（见 spec critical #1）。
// - 打包输出 vec4(sceneColor, smoothDepth)：scene color 流经 RGB，smoothDepth 存 alpha（方案 A 单 stage）。
//
// 运行时（Cesium PostProcessStage）：Cesium 自动注入 #version 300 es / precision / out_FragColor /
// czm_* automatic uniforms；本 shader 只声明业务 uniform + v_textureCoordinates + #define LOG_DEPTH
// （触发 czm_windowToEyeCoordinates 的 2-arg log-depth 分支）。约定对齐 aerialPerspective.frag.ts /
// tonemap.frag.ts（runtime 不带 #version / out_FragColor 声明）。离线 glslang 校验走
// buildDepthTemporalStandaloneShaderForValidation（补 #version + czm_* / out_FragColor 桩）。

import { FOG_PLANE_LOGDEPTH_EPS } from './depthTemporalConstants'

export interface DepthTemporalShaderOptions {
  enabled?: boolean // ?temporalEma=0 时 false（shader 纯透传，不 EMA）
}

// 供后续 Task 接线一致性测试：本 shader 声明的业务 uniform（colorTexture/depthTexture 是 Cesium 内建白名单）。
export const DEPTH_TEMPORAL_UNIFORM_NAMES: string[] = [
  'u_historyTexture',
  'u_prevViewProjection',
  'u_temporalAlpha',
  'u_depthThreshold',
  'u_debugMode'
]

// 组装 PostProcessStage 用 fragment shader（含 czm_* automatic uniform 引用，仅供 Cesium 运行时）。
// enabled=false（?temporalEma=0 或 UNSIGNED_BYTE RT 兜底）：纯透传 scene color + 本帧 raw log-depth。
export function buildDepthTemporalFragmentShader(options: DepthTemporalShaderOptions = {}): string {
  const enabled = options.enabled !== false
  if (!enabled) {
    // 透传兜底：不 EMA，直接写本帧 raw log-depth 到 alpha（下游 stage 与 EMA 路径打包格式一致）。
    return `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;

void main() {
  vec3 sceneColor = texture(colorTexture, v_textureCoordinates).rgb;
  float curLogDepth = texture(depthTexture, v_textureCoordinates).r;
  out_FragColor = vec4(sceneColor, curLogDepth);
}
`
  }
  // 方案 A 单 stage：读本帧 scene color（RGB 透传）+ raw log-depth（.r），EMA 平滑后打包到 alpha。
  // 链尾 stage（atmosphere/tonemap）读 colorTexture.rgb 即拿到原 scene color；history ping-pong
  // 读本 stage 输出的 .a（见 historyBlit.ts，后续 Task）。
  // u_debugMode + debug=8 分支始终 emit（enabled=true 路径），runtime resolved.debugMode 控制
  //（对齐 atmosphere pattern——u_debugMode 在 FRAME_UNIFORMS_GLSL 始终 emit，无 compile-time debugMode option）。
  return `
#define LOG_DEPTH
precision highp float;
uniform sampler2D colorTexture;       // scene color（activeStages[0] 自动 = scene）
uniform sampler2D depthTexture;       // 本帧 globe depth（raw log-depth in .r）
uniform sampler2D u_historyTexture;   // 上帧 smoothDepth（.a）
uniform mat4 u_prevViewProjection;    // 上帧 VP（ECEF 米域）
uniform float u_temporalAlpha;        // [0,1] 运动门控（position+direction 双项）
uniform float u_depthThreshold;       // log-depth 相对阈值
uniform float u_debugMode;            // 8=raw globe depth（诊断抖动源/EMA 对比，EMA 前基准）
in vec2 v_textureCoordinates;

void main() {
  vec3 sceneColor = texture(colorTexture, v_textureCoordinates).rgb;
  float curLogDepth = texture(depthTexture, v_textureCoordinates).r;  // raw log-depth（直接读 .r，不经 window-depth 反演）

  // debug=8 输出 raw globe depth（depthTemporal 输入的未平滑 log-depth，EMA 前基准）。
  // 与 atmosphere debug=5（smoothDepth，EMA 后）对比 → 验证 EMA 平滑效果（远密集近稀疏 log-depth 域）。
  // debug=8 > 7.5 与 atmosphere debug 级联（< 6.5）分离：URL ?debug=8 时 depthTemporal 输出 raw depth（红通道），
  // atmosphere debug=8 > 6.5 跳过自身 debug cascade，走正常计算（transmittance/groundDim/inscatter 调制）+ 链尾
  // ACES tonemap 显示——非 clean 透传；与 debug=5（atmosphere debug cascade 内 return，纯 smoothDepth）显示路径
  // 不同。但对观察时序抖动稳定性够用——抖动不依赖亮度调制。
  if (u_debugMode > 7.5) {
    out_FragColor = vec4(texture(depthTexture, v_textureCoordinates).r, 0.0, 0.0, 1.0);
    return;
  }

  // 反演 worldPosECEF（纯 ECEF 米域，禁高度修正向量 / 米→km 换算因子）。
  // 2-arg czm_windowToEyeCoordinates（LOG_DEPTH 分支，接收 log-depth，返回 .xyz 真眼坐标，禁 /=w）：
  // Cesium 在 LOG_DEPTH 下用 logDepth 反推眼坐标 .xyz（已含逆透视），.w = 1/depthFromCamera（非透视 w），
  // 故直接取 .xyz 配 w=1.0 进 czm_inverseView（不除 .w，对齐 spec critical #1）。
  vec4 eyePos = czm_windowToEyeCoordinates(vec2(gl_FragCoord.xy), curLogDepth);
  vec3 worldPosECEF = (czm_inverseView * vec4(eyePos.xyz, 1.0)).xyz;

  // reproject 到上一帧屏幕（u_prevViewProjection 已含上一帧 view+proj，ECEF 米 → clip）。
  vec4 prevClip = u_prevViewProjection * vec4(worldPosECEF, 1.0);
  vec2 prevUV = prevClip.xy / prevClip.w * 0.5 + 0.5;

  // disocclusion：prevUV 边界 + log-depth 相对阈值 + 远平面特殊处理。
  // prevClip.w > 0：前向可见（相机后方 w<=0 不采样 history，避免镜像翻转 UV 串色）。
  bool prevVisible = (prevClip.w > 0.0)
    && (prevUV.x >= 0.0 && prevUV.x <= 1.0)
    && (prevUV.y >= 0.0 && prevUV.y <= 1.0);
  float histLogDepth = prevVisible ? texture(u_historyTexture, prevUV).a : curLogDepth;
  // 远平面 / 未加载瓦片 depth≈1：curLogDepth 接近 1 → 不累积（避免 sky 像素污染 history）。
  // FOG_PLANE_LOGDEPTH_EPS 插值（single source of truth，与 depthTemporalConstants 共源）。
  bool farPlane = curLogDepth >= 1.0 - ${FOG_PLANE_LOGDEPTH_EPS};
  // log-depth 相对阈值（距离无关容差 ≈ 7% 距离变化）：|hist-cur|/cur < threshold → 一致。
  float relDiff = abs(histLogDepth - curLogDepth) / max(curLogDepth, ${FOG_PLANE_LOGDEPTH_EPS});
  bool consistent = !farPlane && (relDiff < u_depthThreshold);
  // 一致 → 走运动门控 alpha（静止强累积）；否则 alpha=1 直接用本帧（拒绝历史，重置累积）。
  float alpha = (prevVisible && consistent) ? u_temporalAlpha : 1.0;
  float smoothDepth = mix(histLogDepth, curLogDepth, alpha);

  // 打包输出：scene color 流经 RGB，smoothDepth 存 alpha（方案 A 单 stage 透传）。
  out_FragColor = vec4(sceneColor, smoothDepth);
}
`
}

// glslang 校验桩（Cesium 运行时自动注入 czm_* / out_FragColor，离线校验补桩）。
// compileFragment（glslangUtil.ts）不注入任何 Cesium builtins，故本 shader 引用的 czm_* 全部手写桩。
// 桩必须在 main 之前（GLSL 要求声明先于使用）；#define LOG_DEPTH 保留以与 Cesium 运行时路径一致
// （桩本身忽略 LOG_DEPTH 分支，仅证明 2-arg 签名 + 调用点类型正确；real LOG_DEPTH 分支内部依赖
// czm_currentFrustum/czm_log2FarDepthFromNearPlusOne 等由 Cesium 运行时保证，离线不验证）。
const VALIDATION_STUBS_GLSL = `
vec4 czm_windowToEyeCoordinates(vec2 windowCoord, float logDepth) {
  return vec4(windowCoord, -1.0, 1.0);
}
uniform mat4 czm_inverseView;
out vec4 out_FragColor;
`

export function buildDepthTemporalStandaloneShaderForValidation(
  options: DepthTemporalShaderOptions = {}
): string {
  return [
    '#version 300 es',
    'precision highp float;',
    // GLSL ES 3.00 sampler 不继承 float precision，移动 GPU 严格需独立声明（对齐 aerialPerspective /
    // tonemap 的 validation 桩）。depthTemporal 无 sampler3D，不声明那条。
    'precision highp int;',
    'precision highp sampler2D;',
    VALIDATION_STUBS_GLSL,
    buildDepthTemporalFragmentShader(options)
  ].join('\n')
}
