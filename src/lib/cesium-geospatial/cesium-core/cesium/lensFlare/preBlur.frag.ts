// lf_preBlur fragment（Kawase-like 8 邻域软化 threshold，spec §5.4 / C1 修复）。
// 读 lf_threshold（uniform-name string 引用）做单 pass Kawase-like 8 邻域 box 软化，
// 输出给 ghost/halo 共同消费（spec §5.4 / C1：ghost/halo 都采 preBlur threshold，
// 不直接采 lf_threshold——避免 ghost/halo 各自重复软化，且统一软化核）。
// 近似 three-geospatial `KawaseBlurPass SMALL` 单 pass（box 8 邻域 = 9-tap 均值）。
//
// **preBlur 是 lensflare non-series 兄弟 stage**（不在 lf_bloom series 链中）：
//   - 主 colorTexture = atmosphere（non-series input，textureScale 1.0，sampleMode NEAREST）
//   - 但 preBlur **不采样 colorTexture**——声明仅为满足 Cesium「stage 必声明 colorTexture」要求
//   - 实际软化输入是 u_thresholdTexture（uniform-name 引用 lf_threshold stage 输出）
//
// **u_thresholdTexture 是 uniform-name string 引用**（spec §5.4，对齐 bloomUpsample u_downLevel 做法）：
//   preBlur 与 lf_threshold 不在 series 链中（preBlur 是 non-series 兄弟），若不 uniform-name 显式引用，
//   接线层无法构建 preBlur→lf_threshold 依赖 → lf_threshold 不保证先于 preBlur 执行。故 u_thresholdTexture
//   必须由接线层以 uniform-name 字面量绑定到 lf_threshold stage，列入 PREBLUR_UNIFORM_NAMES 供依赖图构建。
//
// u_texelSize 是 lf_threshold 的 1/w,1/h（源=threshold 输出，textureScale 1.0 即全分）。
// 软化核无除法/开方等 NaN 源，且前驱 threshold 已 NaN 守护归零，此处不再重复守护。

// 内建纹理 uniform（Cesium non-series input = atmosphere，shader 须显式声明但 preBlur 不采样）+
// u_thresholdTexture（uniform-name 引用 lf_threshold）+ texel size。
const UNIFORMS_GLSL = `
uniform sampler2D colorTexture;        // atmosphere（non-series input，preBlur 不采样，Cesium 要求声明）
uniform sampler2D u_thresholdTexture;  // lf_threshold（uniform-name string 引用，强制依赖）
uniform vec2 u_texelSize;              // lf_threshold 的 1/w, 1/h（源=threshold 输出）
uniform float u_blurRadius;            // 软化核偏移倍数（1.0=默认 8 邻域 1 texel box；>1 更糊更大模糊半径，ghost 模糊效果）
`

const MAIN_GLSL = `
in vec2 v_textureCoordinates;

void main() {
  vec2 uv = v_textureCoordinates;
  vec2 ts = u_texelSize * u_blurRadius;  // 8 邻域偏移（× blurRadius 控模糊半径）
  // Kawase-like 8 邻域软化（box 近似 KawaseBlurPass SMALL 单 pass，软化 ghost/halo 输入）：
  //   center(0,0)
  vec3 c = texture(u_thresholdTexture, uv).rgb;
  //   边中(±1,0)/(0,±1)×4
  c += texture(u_thresholdTexture, uv + vec2( 1.0,  0.0) * ts).rgb;
  c += texture(u_thresholdTexture, uv + vec2(-1.0,  0.0) * ts).rgb;
  c += texture(u_thresholdTexture, uv + vec2( 0.0,  1.0) * ts).rgb;
  c += texture(u_thresholdTexture, uv + vec2( 0.0, -1.0) * ts).rgb;
  //   角(±1,±1)×4（9-tap 均值，和/9.0 归一化）
  c += texture(u_thresholdTexture, uv + vec2( 1.0,  1.0) * ts).rgb;
  c += texture(u_thresholdTexture, uv + vec2(-1.0,  1.0) * ts).rgb;
  c += texture(u_thresholdTexture, uv + vec2( 1.0, -1.0) * ts).rgb;
  c += texture(u_thresholdTexture, uv + vec2(-1.0, -1.0) * ts).rgb;
  out_FragColor = vec4(c / 9.0, 1.0);
}
`

// 供 non-series 接线一致性测试：preBlur stage 声明的 uniform（colorTexture 是 Cesium 内建白名单）。
// u_thresholdTexture 是 uniform-name string 引用，须列入以构建强制依赖（保证 lf_threshold 先执行）。
export const PREBLUR_UNIFORM_NAMES: string[] = ['u_thresholdTexture', 'u_texelSize', 'u_blurRadius']

// 组装 PostProcessStage 用 fragment shader（供 Cesium 运行时；colorTexture/v_textureCoordinates
// 由 Cesium 注入值，shader 显式声明；out_FragColor 由 Cesium 注入声明）。
export function buildPreBlurFragmentShader(): string {
  return [UNIFORMS_GLSL, MAIN_GLSL].join('\n')
}

// 供 glslang 独立校验：补 #version 300 es + precision + out_FragColor 桩。
// colorTexture/u_thresholdTexture/u_texelSize/v_textureCoordinates 在主体声明，此处不重复。
const VALIDATION_STUBS_GLSL = `
out vec4 out_FragColor;
`

export function buildStandaloneShaderForValidation(): string {
  return [
    '#version 300 es',
    'precision highp float;',
    // GLSL ES 3.00 sampler 不继承 float precision，移动 GPU 严格需独立声明（对齐
    // bloomDownsample.frag.ts / bloomUpsample.frag.ts validation 桩）。preBlur 无 sampler3D，不声明那条。
    'precision highp int;',
    'precision highp sampler2D;',
    VALIDATION_STUBS_GLSL,
    buildPreBlurFragmentShader()
  ].join('\n')
}
