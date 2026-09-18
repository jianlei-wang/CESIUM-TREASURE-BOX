// lf_bloom series composite get(0) threshold fragment（learnopengl 13-tap 加权软阈值）。
// 读 atmosphere（series input = colorTexture），textureScale 1.0 全分（无下采样），sampleMode
// NEAREST（spec §5.7）——保护 atmosphere 的 input dithering 逐像素直通，13-tap 作轻度低通抑制
// 单像素热点（非"抗锯齿"，全分无下采样，spec §5.1 textureScale=1.0 理由③）。
//
// learnopengl 13-tap **加权**（非均匀平均，归一化）：center 0.125 + 内角(±1,±1)×4 @0.125 +
// 边中(±2,0)/(0,±2)×4 @0.0625 + 外角(±2,±2)×4 @0.03125（权重和=1.0）。数值取自
// lensFlareConstants.ts::LEARNOGLY_DOWNSAMPLE_WEIGHTS，GLSL 内直接写数值常量（避免运行时注入）。
//
// luminance 空间 smoothstep 软阈值：scale = smoothstep(level, level+range, l)，spec §5.1。
// NaN/Inf 守护：half-float LUT / 极端 exposure 下 inscatter 可能产生 NaN/Inf（部分分量级）——
// 在 13-tap 采样处逐 tap 净化（safeSample，见下），防止扩散污染下游 bloom pyramid。
//
// luminance/saturate 显式定义（Cesium 无 three.js <common> shader chunk，spec §5.1 注）；saturate
// 为 three.js <common> 标准配对 helper，当前 threshold 未用但忠实移植保留。

// three.js <common> 移植：luminance（Rec.709 加权）+ saturate。Cesium PostProcessStage 不注入这俩。
const DEFINES_GLSL = `
#define luminance(c) dot(c, vec3(0.2126, 0.7152, 0.0722))
#define saturate(x) clamp(x, 0.0, 1.0)
`

// 逐 tap NaN/Inf 净化（2026-09-05 修整）：太阳盘 half-float 溢出区可能带 NaN/Inf（部分分量），
// 13-tap 权重累加会把 NaN 扩散进整个加权和；旧「事后 any(isnan(result)) 整块归零」会把太阳盘
// 所在像素整像素清零，bloom/flare 断链（geo-lensflare 案例 flare 全不可见根因）。改为在采样后
// 立即把非有限值归零，NaN/Inf 只影响当前 tap 权重，不再污染 13-tap 加权和。
const SAFE_SAMPLE_GLSL = `
vec3 safeSample(sampler2D tex, vec2 uv) {
  vec3 c = texture(tex, uv).rgb;
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  return c;
}
`

// 内建纹理 uniform（Cesium series input = atmosphere，shader 须显式声明）+ threshold 控制 uniform。
// lf×云交互 #2（2026-08-30，用户拍板 A）：u_occlusionTexture = lf_occlusion 输出（uniform-name
// string 接线，1/16 空间常数标量）——输出乘 visibility：太阳被云/地形挡时 bloom 随之衰减。
// 全图同值乘法对非太阳亮源同衰减——本产品语境近似正确（主要非太阳亮源=水面太阳 specular，
// 物理上确随太阳遮挡减弱）。原「occlusion 仅乘 ghosts/halo」语义自此扩展为整链（旧设计的
// 「threshold 天然处理被挡太阳」仅 depth 挡成立——云在 colorTexture 里不衰减）。源由接线层
// 覆盖 colorTexture="atmosphere"（云前）配套排云。
const UNIFORMS_GLSL = `
uniform sampler2D colorTexture;
uniform sampler2D u_occlusionTexture;   // lf_occlusion 输出（visibility 标量，1=全可见 0=全挡）
uniform vec2 u_texelSize;        // 源 texture（atmosphere）的 1/w, 1/h
uniform float u_thresholdLevel;
uniform float u_thresholdRange;
`

const MAIN_GLSL = `
in vec2 v_textureCoordinates;

void main() {
  vec2 ts = u_texelSize;
  // learnopengl 13-tap 加权（LEARNOGLY_DOWNSAMPLE_WEIGHTS）：
  vec3 color = safeSample(colorTexture, v_textureCoordinates) * 0.125;
  color += (safeSample(colorTexture, v_textureCoordinates + vec2(-1.0, -1.0) * ts)
          + safeSample(colorTexture, v_textureCoordinates + vec2(1.0, 1.0) * ts)
          + safeSample(colorTexture, v_textureCoordinates + vec2(-1.0, 1.0) * ts)
          + safeSample(colorTexture, v_textureCoordinates + vec2(1.0, -1.0) * ts)) * 0.125;
  color += (safeSample(colorTexture, v_textureCoordinates + vec2(-2.0, 0.0) * ts)
          + safeSample(colorTexture, v_textureCoordinates + vec2(2.0, 0.0) * ts)
          + safeSample(colorTexture, v_textureCoordinates + vec2(0.0, -2.0) * ts)
          + safeSample(colorTexture, v_textureCoordinates + vec2(0.0, 2.0) * ts)) * 0.0625;
  color += (safeSample(colorTexture, v_textureCoordinates + vec2(-2.0, -2.0) * ts)
          + safeSample(colorTexture, v_textureCoordinates + vec2(2.0, 2.0) * ts)
          + safeSample(colorTexture, v_textureCoordinates + vec2(-2.0, 2.0) * ts)
          + safeSample(colorTexture, v_textureCoordinates + vec2(2.0, -2.0) * ts)) * 0.03125;
  // luminance 空间 smoothstep 软阈值（spec §5.1）。
  float l = luminance(color);
  float scale = smoothstep(u_thresholdLevel, u_thresholdLevel + u_thresholdRange, l);
  vec3 result = color * scale;
  // lf×云交互 #2：乘 occlusion visibility（lf_occlusion 1/16 空间常数标量，NEAREST 读）——
  // 太阳被云/地形挡时 bloom 整体随太阳可见度衰减（.r = visibility）。
  result *= texture(u_occlusionTexture, v_textureCoordinates).r;
  out_FragColor = vec4(result, 1.0);
}
`

// 供 Task 3 接线一致性测试：threshold stage 声明的 uniform（colorTexture 是 Cesium 内建白名单）。
export const THRESHOLD_UNIFORM_NAMES: string[] = ['u_occlusionTexture', 'u_texelSize', 'u_thresholdLevel', 'u_thresholdRange']

// 组装 PostProcessStage 用 fragment shader（供 Cesium 运行时；colorTexture/v_textureCoordinates
// 由 Cesium 注入值，shader 显式声明；out_FragColor 由 Cesium 注入声明）。
export function buildThresholdFragmentShader(): string {
  return [DEFINES_GLSL, UNIFORMS_GLSL, SAFE_SAMPLE_GLSL, MAIN_GLSL].join('\n')
}

// 供 glslang 独立校验：补 #version 300 es + precision + out_FragColor 桩。
// luminance/saturate defines 已在主体 DEFINES_GLSL（Cesium 无 <common>，运行时也需），此处不重复。
// colorTexture/u_texelSize/u_thresholdLevel/u_thresholdRange/v_textureCoordinates 在主体声明。
const VALIDATION_STUBS_GLSL = `
out vec4 out_FragColor;
`

export function buildStandaloneShaderForValidation(): string {
  return [
    '#version 300 es',
    'precision highp float;',
    // GLSL ES 3.00 sampler 不继承 float precision，移动 GPU 严格需独立声明（对齐 tonemap.frag.ts
    // validation 桩）。threshold 无 sampler3D，不声明那条。
    'precision highp int;',
    'precision highp sampler2D;',
    VALIDATION_STUBS_GLSL,
    buildThresholdFragmentShader()
  ].join('\n')
}
