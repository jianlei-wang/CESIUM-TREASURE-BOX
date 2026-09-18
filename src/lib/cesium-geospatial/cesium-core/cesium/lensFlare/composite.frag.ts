// lf_composite fragment（atmosphere + (bloom+features)*intensity 加法叠加，spec §5.6）。
//
// **dithering 真正保护点（spec §5.7 专1 I2，硬约束）**：input dithering 只在 atmosphere
//   原色上，只被 composite 主 colorTexture 直接采样。故 lf_composite sampleMode 必须 NEAREST
//   ——保 phase1 水波纹修复（input dithering 打散 RGBA8 量化阶梯，LINEAR 会插值再引入 banding）。
//   threshold/preBlur/bloom/features/occlusion 的中间结果不含 dithering（threshold 13-tap 平均、
//   bloom blur、features 重影——dithering 已不在），其 sampleMode 不影响 dithering 保护。
//
// **线性域加法叠加（spec §5.6）**：`result = atmosphere + (bloom + features) * u_intensity`。
//   composite 不做 tonemap——仅线性累加，链尾 tonomap ACES 收尾（phase2a HDR 链尾 ToneMappingStage）。
//
// **composite 是 lensflare non-series 兄弟 stage**（不在 lf_bloom series 链中）：
//   - 主 colorTexture = atmosphere（non-series input，textureScale 1.0，**被采样**）
//   - u_bloomTexture / u_featuresTexture 是 uniform-name string 引用（对齐 features.frag.ts
//     u_preBlurTexture/u_occlusionTexture、bloomUpsampling.frag.ts u_downLevel 做法）：composite
//     是 non-series 兄弟 stage，与 lf_up4/lf_features 不在 series 链中，若不 uniform-name 显式
//     引用，接线层无法构建 composite→up4/features 依赖。故两者必须由接线层以 uniform-name
//     字面量绑定，列入 COMPOSITE_UNIFORM_NAMES 供依赖图构建。

// 内建纹理 uniform（Cesium non-series input = atmosphere，**被采样**——dithering 在此）+
// u_bloomTexture（uniform-name 引用 lf_up4）+ u_featuresTexture（uniform-name 引用 lf_features）
// + composite 控制 uniform。声明顺序与 COMPOSITE_UNIFORM_NAMES 一致（colorTexture 白名单）。
const UNIFORMS_GLSL = `
uniform sampler2D colorTexture;          // atmosphere（non-series input，composite 采样，NEAREST 保 input dithering）
uniform sampler2D u_bloomTexture;        // lf_up4（uniform-name string 引用，强制依赖）
uniform sampler2D u_featuresTexture;     // lf_features（uniform-name string 引用，强制依赖）
uniform float u_intensity;               // lens flare 总强度（线性域乘 bloom+features）
`

const MAIN_GLSL = `
in vec2 v_textureCoordinates;

void main() {
  vec2 uv = v_textureCoordinates;
  // atmosphere 原色（input dithering 在此，主 colorTexture 必须 NEAREST 保 phase1 水波纹修复）
  vec3 atmosphere = texture(colorTexture, uv).rgb;
  // bloom（lf_up4 全分输出）+ features（9 ghosts + halo + 色散，已乘 occlusion）
  vec3 bloom = texture(u_bloomTexture, uv).rgb;
  vec3 features = texture(u_featuresTexture, uv).rgb;
  // 线性域加法叠加，链尾 tonomap ACES 收尾（composite 不做 tonemap）
  vec3 result = atmosphere + (bloom + features) * u_intensity;
  out_FragColor = vec4(result, 1.0);
}
`

// 供 non-series 接线一致性测试：composite stage 声明的 uniform（colorTexture 是 Cesium 内建白名单）。
// u_bloomTexture / u_featuresTexture 是 uniform-name string 引用，须列入以构建强制依赖
// （保证 lf_up4 / lf_features 先于 composite 执行）。
export const COMPOSITE_UNIFORM_NAMES: string[] = [
  'u_bloomTexture',
  'u_featuresTexture',
  'u_intensity'
]

// 组装 PostProcessStage 用 fragment shader（供 Cesium 运行时；colorTexture/v_textureCoordinates
// 由 Cesium 注入值，shader 显式声明；out_FragColor 由 Cesium 注入声明）。
export function buildCompositeFragmentShader(): string {
  return [UNIFORMS_GLSL, MAIN_GLSL].join('\n')
}

// 供 glslang 独立校验：补 #version 300 es + precision + out_FragColor 桩。
// colorTexture/u_bloomTexture/u_featuresTexture/u_intensity/v_textureCoordinates 在主体声明，此处不重复。
const VALIDATION_STUBS_GLSL = `
out vec4 out_FragColor;
`

export function buildStandaloneShaderForValidation(): string {
  return [
    '#version 300 es',
    'precision highp float;',
    // GLSL ES 3.00 sampler 不继承 float precision，移动 GPU 严格需独立声明（对齐
    // features.frag.ts / bloomUpsample.frag.ts validation 桩）。
    'precision highp int;',
    'precision highp sampler2D;',
    VALIDATION_STUBS_GLSL,
    buildCompositeFragmentShader()
  ].join('\n')
}
