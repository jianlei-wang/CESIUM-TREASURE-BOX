// lf_features fragment（9 ghosts + halo + 色散，采 preBlur，spec §5.4 / C1 忠实移植）。
//
// **C1 忠实移植**：ghost 与 halo 都采 u_preBlurTexture（统一软化核），而非 v1 的
//   ghost 采 lf_threshold / halo 采 lf_bloom——避免 ghost/halo 各自重复软化且核不一致。
//   preBlur 已对 threshold 做单 pass Kawase-like 8 邻域软化，features 直接消费即可。
//
// **occlusion 仅乘 ghosts/halo（不乘 bloom）**：被挡太阳由 image-based threshold 天然
//   处理（太阳被挡时 threshold 输出近零，preBlur/features 跟着近零），故 bloom 路径不需
//   occlusion 衰减；features 输出是叠加在画面上的伪光斑，必须用 occlusion 遮挡才不会
//   穿墙。故 `(ghosts + halo) * occ`，bloom 在 composite 另路不衰减。
//
// **features 是 lensflare non-series 兄弟 stage**（不在 lf_bloom series 链中）：
//   - 主 colorTexture = atmosphere（non-series input，textureScale 1.0）
//   - 但 features **不采样 colorTexture**——声明仅为满足 Cesium「stage 必声明 colorTexture」要求
//   - 实际采样输入是 u_preBlurTexture（ghost/halo 共享）+ u_occlusionTexture
//
// **u_preBlurTexture / u_occlusionTexture 是 uniform-name string 引用**（spec §5.4，对齐
//   preBlur.frag.ts u_thresholdTexture / bloomUpsample.frag.ts u_downLevel 做法）：features
//   是 non-series 兄弟 stage，与 lf_preBlur / lf_occlusion 不在 series 链中，若不 uniform-name
//   显式引用，接线层无法构建 features→preBlur/occlusion 依赖。故两者必须由接线层以
//   uniform-name 字面量绑定，列入 FEATURES_UNIFORM_NAMES 供依赖图构建。
//
// **9 ghost offset/tint 从 lensFlareConstants.ts 注入**（单一来源，避免数值重复）：TS 模板
//   字符串把 GHOST_OFFSETS/GHOST_TINTS 生成 GLSL ES 3.00 const array（float[](...) 构造子），
//   循环内动态索引（ES 3.00 允许）。halo 半径/厚度/位移同理从常量注入。

import {
  GHOST_OFFSETS,
  GHOST_TINTS,
  HALO_RADIUS,
  HALO_THICKNESS,
  HALO_DISPLACEMENT
} from './lensFlareConstants'

// 内建纹理 uniform（Cesium non-series input = atmosphere，shader 须显式声明但 features 不采样）+
// u_preBlurTexture（uniform-name 引用 lf_preBlur）+ u_occlusionTexture（uniform-name 引用 lf_occlusion）
// + features 控制 uniform。声明顺序与 FEATURES_UNIFORM_NAMES 一致（colorTexture 白名单）。
const UNIFORMS_GLSL = `
uniform sampler2D colorTexture;          // atmosphere（non-series input，features 不采样，Cesium 要求声明）
uniform sampler2D u_preBlurTexture;      // lf_preBlur（uniform-name string 引用，强制依赖）
uniform sampler2D u_occlusionTexture;    // lf_occlusion（uniform-name string 引用，强制依赖）
uniform vec2 u_texelSize;                // 源 texture（atmosphere）的 1/w, 1/h
uniform float u_ghostAmount;             // ghost 总强度
uniform float u_haloAmount;              // halo 总强度
uniform float u_chromaticAberration;     // halo 色散偏移强度（texel 倍数）
`

// halo 环形 mask（spec §5.4）：smoothstep 内/外缘构造环形带，d 在 [radius-thickness, radius+thickness]
// 之间非零，峰在 radius 处。
const HELPERS_GLSL = `
float cubicRingMask(float d, float radius, float thickness) {
  float inner = smoothstep(radius - thickness, radius, d);
  float outer = 1.0 - smoothstep(radius, radius + thickness, d);
  return inner * outer;
}
`

// JS number → GLSL float 字面量：整数值（如 -5.0/1.0/10.0）经 toString 丢 .0 变 int 字面量，
// float[](...)/vec3[](...) 数组构造子拒绝隐式 int→float，故强制保留小数点。
const toGlslFloat = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`)

// 9 ghost offset/tint：从 lensFlareConstants.ts 注入为 GLSL const array（单一来源，避免硬编码重复）。
// GLSL ES 3.00 支持 const array 初始化列表 + 循环动态索引（已 glslang 验证 float[](...) 构造子合法）。
const GHOST_ARRAYS_GLSL = `
const float GHOST_OFFSETS[9] = float[](${GHOST_OFFSETS.map(toGlslFloat).join(', ')});
const vec3 GHOST_TINTS[9] = vec3[](${GHOST_TINTS.map((t) => `vec3(${t.map(toGlslFloat).join(', ')})`).join(', ')});
`

const MAIN_GLSL = `
in vec2 v_textureCoordinates;

void main() {
  vec2 uv = v_textureCoordinates;
  // aspect 修正纵横比（vec2 非 vec3 笔误——three-geospatial 原版即 vec2）。
  vec2 aspect = vec2(u_texelSize.x / u_texelSize.y, 1.0);
  vec2 direction = uv - 0.5;
  // 9 ghosts（采 preBlur，C1 忠实移植）：沿 direction 镜像偏移采样，中心衰减 pow(1-d,3) + tint。
  vec3 ghosts = vec3(0.0);
  for (int i = 0; i < 9; ++i) {
    vec2 suv = clamp(1.0 - uv + direction * GHOST_OFFSETS[i], 0.0, 1.0);
    // three-geospatial SQRT_2 = 0.70710678（实为 1/√2，命名误导）；分母 0.5*0.70710678=0.35355339。
    // 勿用 1.41421356（√2）——那会让分母翻倍、d 减半、pow(1-d,3) 衰减变缓 → ghost 圆斑半径 ~2x → 重叠成线。
    float d = clamp(length(0.5 - suv) / (0.5 * 0.70710678), 0.0, 1.0);
    ghosts += texture(u_preBlurTexture, suv).rgb * GHOST_TINTS[i] * pow(1.0 - d, 3.0);
  }
  ghosts *= u_ghostAmount;
  // halo（采 preBlur + cubicRingMask + 色散 R/G/B 偏移）：沿 hdir 偏移到光环位置，R/G/B 三通道
  // 分别按 -1/0/+1 倍色散量偏移采样，制造镜头色散伪光斑。
  // normalize guard：uv=0.5（屏幕中心）时 direction=0，normalize(0)=NaN → halo=NaN 全屏传播（白点）。
  // 中心 cubicRingMask(0)=0 本就不贡献 halo，故 direction≈0 时 hdir=vec2(0) 防 NaN。
  vec2 dir = (uv - 0.5) / aspect;
  vec2 hdir = dot(dir, dir) > 1e-10 ? normalize(dir) * aspect : vec2(0.0);
  vec2 hsuv = fract(1.0 - uv + hdir * ${HALO_DISPLACEMENT});
  vec3 hoffset = vec3(u_texelSize.x * u_chromaticAberration) * vec3(-1.0, 0.0, 1.0);
  vec3 halo;
  halo.r = texture(u_preBlurTexture, hsuv + hdir * hoffset.r).r;
  halo.g = texture(u_preBlurTexture, hsuv + hdir * hoffset.g).g;
  halo.b = texture(u_preBlurTexture, hsuv + hdir * hoffset.b).b;
  float hd = distance((uv - vec2(0.5, 0.0)) / aspect + vec2(0.5, 0.0), vec2(0.5));
  halo *= cubicRingMask(hd, ${HALO_RADIUS}, ${HALO_THICKNESS}) * u_haloAmount;
  // occlusion 仅乘 ghosts/halo（bloom 不衰减，image-based threshold 天然处理被挡太阳）。
  float occ = texture(u_occlusionTexture, uv).r;
  vec3 result = (ghosts + halo) * occ;
  out_FragColor = vec4(result, 1.0);
}
`

// 供 non-series 接线一致性测试：features stage 声明的 uniform（colorTexture 是 Cesium 内建白名单）。
// u_preBlurTexture / u_occlusionTexture 是 uniform-name string 引用，须列入以构建强制依赖
// （保证 lf_preBlur / lf_occlusion 先于 features 执行）。
export const FEATURES_UNIFORM_NAMES: string[] = [
  'u_preBlurTexture',
  'u_occlusionTexture',
  'u_texelSize',
  'u_ghostAmount',
  'u_haloAmount',
  'u_chromaticAberration'
]

// 组装 PostProcessStage 用 fragment shader（供 Cesium 运行时；colorTexture/v_textureCoordinates
// 由 Cesium 注入值，shader 显式声明；out_FragColor 由 Cesium 注入声明）。
export function buildFeaturesFragmentShader(): string {
  return [UNIFORMS_GLSL, HELPERS_GLSL, GHOST_ARRAYS_GLSL, MAIN_GLSL].join('\n')
}

// 供 glslang 独立校验：补 #version 300 es + precision + out_FragColor 桩。
// colorTexture/u_preBlurTexture/u_occlusionTexture/u_texelSize/u_ghostAmount/u_haloAmount/
// u_chromaticAberration/v_textureCoordinates 在主体声明，此处不重复。
const VALIDATION_STUBS_GLSL = `
out vec4 out_FragColor;
`

export function buildStandaloneShaderForValidation(): string {
  return [
    '#version 300 es',
    'precision highp float;',
    // GLSL ES 3.00 sampler 不继承 float precision，移动 GPU 严格需独立声明（对齐
    // preBlur.frag.ts / bloomDownsample.frag.ts validation 桩）。features 无 sampler3D，不声明那条。
    'precision highp int;',
    'precision highp sampler2D;',
    VALIDATION_STUBS_GLSL,
    buildFeaturesFragmentShader()
  ].join('\n')
}
