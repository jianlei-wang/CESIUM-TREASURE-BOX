// lf_occlusion fragment（sun 投影 + ray-ellipsoid + 36 点 depth 覆盖率，spec §5.5）。
//
// **降分辨率 textureScale=0.0625**（接线层 createLensFlareStage 设；本文件仅算法）：
//   occlusion 是空间常数标量，全分每像素 36 次 depth 采样 = 200 万×36 冗余；降 1/16，features
//   NEAREST 读低分常数图每像素同一值等价，depth 采样降 256×（spec §5.5/专2）。
//
// **sun 屏幕投影 w=0 无穷远**（spec §5.5 §1）：sunEC = czm_view * vec4(u_sunDirectionWC, 0.0)
//   剔除 view 平移列（仅旋转），等价「日地距无穷远方向」——修 cesium-clouds-atmosphere 把 sun
//   当 1e6 米远点的视差 bug（相机移动 1e3 米产生可见视差，但日地距 1.5e11 米本无视差）。
//   第二步 sunClip = czm_projection * vec4(sunEC.xyz, 1.0)（w=1 点投影）拿 clip 空间。
//
// **ray-ellipsoid（WGS84 椭球，M9 非球）**：对椭球 (x/a)²+(y/b)²+(z/c)²=1 二次方程求交，
//   相机在椭球外时 tHit>0 = 太阳在地球背面 = flare 不画。GLSL 从 T7 occlusion.ts 移植（数学等价）。
//
// **36 点 depth 覆盖率**（I5：16 点 6.25% 步进台阶 → 36 点 ~2.7% 步进）：sun 屏幕位置周围
//   sunAngularRadius 投影屏幕圆内 6×6 网格采 depth。
//
// **Task 10：depth 同源 depthTemporal smoothDepth（默认 useSmoothDepth=true，HDR/temporalEmaEnabled 路径）**。
//   occlusion 的 depthTexture uniform 在接线层（createLensFlareStage）指向 depthTemporal stage 输出
//   （uniform-name string 'czm_depth_temporal'，Cesium textureCache 跨 stage 解析为 outputTexture，
//   combine 优先 user uniform 覆盖内建 scene depth）。shader 读 texture(depthTexture, sampleUV).a
//   （depthTemporal 输出 .a = smoothDepth，raw log-depth EMA），与 atmosphere 同源 smoothDepth 统一消抖。
//   阈值改 log-depth 域 farPlane：1.0 - 1e-4（与 depthTemporal FOG_PLANE_LOGDEPTH_EPS 单源），排除
//   远平面/未加载 depth≈1 像素。
//
// **legacy useSmoothDepth=false（UNSIGNED_BYTE 兜底，无 depthTemporal）**：depthTexture 不覆盖
//   （Cesium 内建 scene globe depth），shader 用 czm_readDepth 解码 log-depth，阈值 1.0 - DEPTH_EPSILON(1e-6)。
//
// **🆢clear depth 陷阱（spec §5.5 I4，Cesium 固有限制）**：天空像素与远面几何 depthTexture 同值
//   （≈1.0）。太阳落远处 globe 边缘（接近 far 面）会被误判天空（不挡）——低仰角/轨相机可能 flare
//   穿透远处正面地形。Cesium 无法区分「真天空」与「远面地形」（同 depth=1.0），验收 L4 盯。
//   Task 10：smoothDepth 经 EMA 平滑后此边界更稳定，但 farPlane 阈值（1e-4）仍同窗口几何判定边界。
//
// **colorTexture 声明不采样**：occlusion 是 lensflare non-series 兄弟 stage，主 colorTexture
//   = atmosphere（non-series input），Cesium 要求 stage 必声明 colorTexture，但 occlusion 不采它
//   （实际只采 depthTexture + 计算）。声明仅为满足 Cesium 要求。

import { generateSampleGrid36 } from './occlusion'
import { DEPTH_EPSILON } from './lensFlareConstants'

/** occlusion shader 构建选项。 */
export interface OcclusionShaderOptions {
  /**
   * 读 depthTemporal smoothDepth（.a，raw log-depth EMA）替代 czm_readDepth scene globe depth。
   * 默认 true（HDR/temporalEmaEnabled 路径，与 atmosphere 同源 smoothDepth，统一消抖）。
   * false = UNSIGNED_BYTE 兜底（无 depthTemporal），读 czm_readDepth scene globe depth。
   */
  useSmoothDepth?: boolean
  /**
   * lf×云交互 #1（2026-08-30）：36 点采样叠加云覆盖率遮挡。云是后处理 overlay 不写
   * depth——太阳被云挡时 36 点 depth 判定恒全可见（visibility=1，halo/ghost 穿透云层）。
   * true 时每采样点被挡度 = max(depth 二值挡, 云 alpha)，云部分遮挡按覆盖率线性衰减
   * visibility。接线层须同时注入 u_cloudsTexture（云 march att0 premultiplied 输出，
   * .a=覆盖率；桥未就绪帧由接线层喂 1×1 a=0 dummy = 不挡，与无云等价）。
   * 默认 false：不编译采样行（云未开零回归）。
   */
  cloudsOcclusion?: boolean
}

// 内建纹理 uniform（Cesium non-series input + 场景 depth）+ occlusion 控制 uniform。
// 声明顺序与 OCCLUSION_UNIFORM_NAMES 一致（colorTexture/depthTexture 白名单，Cesium 内建）。
// czm_view/czm_projection 由 Cesium 自动注入（运行时），shader 不声明。
// czm_readDepth 仅 legacy useSmoothDepth=false 路径调用（运行时 Cesium 按需注入）。
const UNIFORMS_GLSL = `
uniform sampler2D colorTexture;          // atmosphere（non-series input，occlusion 不采样，Cesium 要求声明）
uniform sampler2D depthTexture;          // Task 10：temporalEmaEnabled=true 时接线层指向 depthTemporal 输出（uniform-name string 'czm_depth_temporal'），读 .a=smoothDepth；UNSIGNED_BYTE 时 Cesium 内建 scene globe depth
uniform vec3 u_sunDirectionWC;           // 太阳世界空间方向（单位向量）
uniform vec3 u_cameraPositionWC;          // 相机世界位置（ray origin；也可用 czm_viewerPositionWC 自动注入）
uniform float u_sunAngularRadius;         // 太阳盘角半径（rad，约 0.004675）
uniform vec3 u_ellipsoidRadiiSquared;     // WGS84 椭球三轴半径平方 [a², b², c²]（scene.globe.ellipsoid.radiiSquared）
#define DEPTH_EPSILON ${DEPTH_EPSILON.toExponential()}    // log 域 epsilon（legacy useSmoothDepth=false 路径用，单源：lensFlareConstants，沿用 cesium-clouds-atmosphere 实测，spec §5.5/I10）
`

// lf×云交互 #1：云覆盖率纹理（march att0 premultiplied 输出，.a=云覆盖率）。
// 条件段——cloudsOcclusion=true 时拼入（云未开不编译，零回归）。
const CLOUDS_UNIFORM_GLSL = `
uniform sampler2D u_cloudsTexture;         // 云 march att0（premultiplied，.a=覆盖率；接线层经 bridge 注入，未就绪帧=1×1 a=0 dummy）
`

// 射线-WGS84 椭球求交（spec §5.5 §2 / M9 椭球，从 T7 occlusion.ts::rayEllipsoidIntersect 移植到 GLSL）。
// 数学等价于 T7 纯函数：A=Σ(rd_i²/r_i²), B=2·Σ(ro_i·rd_i/r_i²), C=Σ(ro_i²/r_i²)-1；判别式<0 不交，
// t0=(-B-√D)/(2A) 入口点；t0<0 背后/背离 → -1。
const HELPERS_GLSL = `
float rayEllipsoidIntersect(vec3 ro, vec3 rd, vec3 radiiSquared) {
  vec3 invR2 = 1.0 / radiiSquared;
  float A = dot(rd * rd, invR2);
  float B = 2.0 * dot(ro * rd, invR2);
  float C = dot(ro * ro, invR2) - 1.0;
  float disc = B * B - 4.0 * A * C;
  if (disc < 0.0) return -1.0;
  float t = (-B - sqrt(disc)) / (2.0 * A);
  return t >= 0.0 ? t : -1.0;
}
`

// JS number → GLSL float 字面量：整数值（如 -1/0/1）经 toString 丢 .0 变 int 字面量，
// vec2[](...) 数组构造子拒绝隐式 int→float，故强制保留小数点。
const toGlslFloat = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`)

// 36 点采样网格（spec §5.5 §3 / I5，从 T7 occlusion.ts::generateSampleGrid36 注入 GLSL const array，
// 单一来源避免硬编码重复）。GLSL ES 3.00 支持 const array 初始化列表 + 循环动态索引（对齐
// features.frag.ts GHOST_OFFSETS/GHOST_TINTS 做法）。6×6 网格 [-1,1]²（含四角与中心带）。
const SAMPLE_GRID_GLSL = `
const vec2 SAMPLE_GRID_36[36] = vec2[](${generateSampleGrid36()
  .map((p) => `vec2(${toGlslFloat(p[0])}, ${toGlslFloat(p[1])})`)
  .join(', ')});
`

// 36 点采样网格 + 主函数：depth 读取按 useSmoothDepth 切换（Task 10）。
//   useSmoothDepth=true（默认，HDR/temporalEmaEnabled）：texture(depthTexture, sampleUV).a（depthTemporal
//     输出 .a=smoothDepth，raw log-depth EMA），阈值 1.0 - FOG_PLANE_LOGDEPTH_EPS(1e-4)。
//   useSmoothDepth=false（UNSIGNED_BYTE 兜底）：czm_readDepth(depthTexture, sampleUV)（scene globe
//     depth，log-depth 解码），阈值 1.0 - DEPTH_EPSILON(1e-6)。
// 累计形态（lf×云交互 #1）：occluded float 化（原 int++ 只能二值累计——云部分遮挡需分数覆盖）。
//   cloudsOcclusion=true：每点被挡度 = max(depth 二值挡, 云 alpha)——depth 全挡或云覆盖率取大。
//   cloudsOcclusion=false：纯 depth 二值 0/1 累加，与原 int++ 数学等价（分母 36.0 不变）。
function buildMainGlsl(useSmoothDepth: boolean, cloudsOcclusion: boolean): string {
  const depthRead = useSmoothDepth
    ? // Task 10：同源 depthTemporal smoothDepth（.a，raw log-depth EMA），与 atmosphere 统一消抖
      `float d = texture(depthTexture, sampleUV).a;`
    : // legacy：scene globe depth（czm_readDepth 解码 log-depth）
      `float d = czm_readDepth(depthTexture, sampleUV);`
  const isBlockedExpr = useSmoothDepth
    ? // farPlane/未加载 depth≈1 排除（1e-4 = depthTemporal FOG_PLANE_LOGDEPTH_EPS，与 atmosphere 同源；对齐 aerialPerspective.frag.ts 字面量写法）
      `(d < 1.0 - 1e-4)`
    : // sceneDepth < 1.0 - DEPTH_EPSILON = 几何存在 = 被挡（天空/远面 depth≈1.0 不挡）
      `(d < 1.0 - DEPTH_EPSILON)`
  const accumulate = cloudsOcclusion
    ? // 云遮挡按覆盖率线性计入（云完全挡 a=1 与 depth 等价；半覆盖 a=0.5 → 该点半挡）
      `max(${isBlockedExpr} ? 1.0 : 0.0, texture(u_cloudsTexture, sampleUV).a)`
    : `${isBlockedExpr} ? 1.0 : 0.0`
  return `
in vec2 v_textureCoordinates;

void main() {
  // ① sun 屏幕投影（w=0 无穷远方向，修 cesium-clouds-atmosphere 1e6 视差 bug）
  vec4 sunEC = czm_view * vec4(u_sunDirectionWC, 0.0);
  vec4 sunClip = czm_projection * vec4(sunEC.xyz, 1.0);
  // 背面 / 裁剪面后（w<=0）→ flare 不画（visibility=0）
  if (sunClip.w <= 0.0) { out_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 sunNDC = sunClip.xy / sunClip.w;
  // 屏外（NDC 超出 [-1,1]）→ visibility=0（sun 不在视椎内，flare 不画）
  if (abs(sunNDC.x) > 1.0 || abs(sunNDC.y) > 1.0) { out_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  // ② ray-ellipsoid（地球背面）：太阳方向射线击中 WGS84 椭球 → 背面 → visibility=0
  float tHit = rayEllipsoidIntersect(u_cameraPositionWC, u_sunDirectionWC, u_ellipsoidRadiiSquared);
  if (tHit > 0.0) { out_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  // ③ depth 36 点覆盖率：sun 屏幕位置周围 sunAngularRadius 投影圆内 6×6 网格采 depthTexture。
  // NDC 半径 = tan(α) * cot(fovy/2)；czm_projection[1][1]（列主 [col=1][row=1]）= cot(fovy/2)。
  float ndcRadius = tan(u_sunAngularRadius) * czm_projection[1][1];
  float occluded = 0.0;   // float（lf×云 #1）：云部分遮挡需分数覆盖累计（纯 depth 时二值 0/1 与 int++ 等价）
  for (int i = 0; i < 36; ++i) {
    vec2 sampleNDC = sunNDC + SAMPLE_GRID_36[i] * ndcRadius;
    vec2 sampleUV = sampleNDC * 0.5 + 0.5;
    ${depthRead}
    occluded += ${accumulate};
  }
  float coverage = occluded / 36.0;   // 被挡比例（0=全可见，1=全挡）
  float visibility = 1.0 - coverage;          // 0=全挡，1=全可见
  out_FragColor = vec4(visibility, 0.0, 0.0, 1.0);
}
`
}

// 供 non-series 接线一致性测试：occlusion stage 声明的 uniform（colorTexture/depthTexture 是
// Cesium 内建白名单；czm_view/czm_projection 由 Cesium 自动注入不列）。
export const OCCLUSION_UNIFORM_NAMES: string[] = [
  'u_sunDirectionWC',
  'u_cameraPositionWC',
  'u_sunAngularRadius',
  'u_ellipsoidRadiiSquared'
]

// 组装 PostProcessStage 用 fragment shader（供 Cesium 运行时；colorTexture/depthTexture/
// v_textureCoordinates 由 Cesium 注入值，shader 显式声明；out_FragColor 由 Cesium 注入声明；
// czm_view/czm_projection 由 Cesium ShaderSource 按需注入；czm_readDepth 仅 useSmoothDepth=false
// 时由 Cesium 按需注入）。
export function buildOcclusionFragmentShader(
  options: OcclusionShaderOptions = {}
): string {
  const { useSmoothDepth = true, cloudsOcclusion = false } = options
  return [
    UNIFORMS_GLSL,
    ...(cloudsOcclusion ? [CLOUDS_UNIFORM_GLSL] : []),
    HELPERS_GLSL,
    SAMPLE_GRID_GLSL,
    buildMainGlsl(useSmoothDepth, cloudsOcclusion)
  ].join('\n')
}

// 供 glslang 独立校验：补 #version 300 es + precision + Cesium 自动注入符号的桩。
// colorTexture/depthTexture/sun uniforms/v_textureCoordinates 在主体声明，此处不重复。
// czm_view/czm_projection 是 Cesium 自动注入的 mat4 uniform；czm_readDepth 是 Cesium 自动注入的
// 函数（运行时含 log-depth 解码）；此处给函数桩一个 body（return 0.5）让 glslang 单文件编译通过
// （仅原型无 body 在被调用时会触发未定义错误，对齐 aerialPerspective.frag.ts 桩做法）。
// useSmoothDepth=true 路径不调用 czm_readDepth，桩为未用函数（GLSL ES 3.00 允许未用函数定义）。
const VALIDATION_STUBS_GLSL = `
uniform mat4 czm_view;
uniform mat4 czm_projection;
float czm_readDepth(sampler2D t, vec2 uv) { return 0.5; }
out vec4 out_FragColor;
`

export function buildStandaloneShaderForValidation(
  options: OcclusionShaderOptions = {}
): string {
  return [
    '#version 300 es',
    'precision highp float;',
    // GLSL ES 3.00 sampler 不继承 float precision，移动 GPU 严格需独立声明（对齐
    // features.frag.ts / aerialPerspective.frag.ts validation 桩）。
    'precision highp int;',
    'precision highp sampler2D;',
    VALIDATION_STUBS_GLSL,
    buildOcclusionFragmentShader(options)
  ].join('\n')
}
