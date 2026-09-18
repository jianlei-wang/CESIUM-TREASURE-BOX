// 链尾 ToneMapping PostProcessStage fragment。
// 读 atmosphere stage 的线性 HDR 输出（HalfFloat 或 RGBA8 兜底），做 ACES + gamma 1/2.2 +
// display triangular dithering → RGBA8 display。与 phase1 aerialPerspective.frag 的 tonemapDisplay
// 视觉等价（ACES 常数/gamma/dithering 系数原样），仅位置移到独立 stage。
//
// ACESFilmic + interleavedGradientNoise 从 aerialPerspective.frag.HELPERS_GLSL 迁来（atmosphere
// 不再需要 ACESFilmic；interleavedGradientNoise 两边各自声明同名纯函数——GLSL 不能跨 stage 共享）。
//
// debug 语义：
// - debug=0：正常 ACES+gamma+dithering。
// - debug=1..6：透传 atmosphere 输出（atmosphere 已算好 0-1 display ready 可视化值）。
// - debug=7：线性归一化 false-color（clamp(c.rgb/5,0,1)）——HalfFloat 设备太阳区 >1 显示亮区，
//   RGBA8 兜底被 clip 到 1.0 显示暗区（0.2），可证伪地证明 HDR 链承载 >1（评审 C2：log 归一化
//   ≤1 两路径都不 clip，无法区分）。
//
// 必须保持 sampleMode: NEAREST（Cesium PostProcessStage 默认）——保护 atmosphere 的 input
// dithering 经 HalfFloat RT 中转逐像素直通；改 LINEAR 会抹掉 dither 噪声 → 水波纹回归。

// 内建纹理 uniform（Cesium 提供值，shader 须显式声明）+ debug 同步 uniform。
const UNIFORMS_GLSL = `
uniform sampler2D colorTexture;
uniform float u_debugMode;
uniform float u_ditherScale;  // display dithering 强度倍率（1.0=phase1 默认 ±1.5/255；与 atmosphere input dithering 同源）
`

// ACESFilmic + interleavedGradientNoise（从 aerialPerspective.frag 迁来，原样）。
const HELPERS_GLSL = `
vec3 ACESFilmic(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float interleavedGradientNoise(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
`

const MAIN_GLSL = `
in vec2 v_textureCoordinates;

void main() {
  vec4 c = texture(colorTexture, v_textureCoordinates);
  if (u_debugMode > 6.5) {
    // debug=7：线性归一化 false-color 证明 HalfFloat 承载 >1。
    out_FragColor = vec4(clamp(c.rgb / 5.0, 0.0, 1.0), 1.0);
    return;
  }
  if (u_debugMode > 0.5) {
    // 中段 debug 透传（atmosphere 已输出 display ready 可视化值）。
    out_FragColor = c;
    return;
  }
  // ACES filmic + gamma 1/2.2（与 phase1 tonemapDisplay 等价）。
  vec3 t = ACESFilmic(c.rgb);
  t = pow(t, vec3(1.0 / 2.2));
  // display triangular dithering ±1.5 LSB 打散 8-bit output 量化。
  float dither = interleavedGradientNoise(gl_FragCoord.xy)
    + interleavedGradientNoise(gl_FragCoord.xy + vec2(7.11, 5.17)) - 1.0;  // [-1,1] triangular
  t += dither * 1.5 / 255.0 * u_ditherScale;
  out_FragColor = vec4(t, c.a);
}
`

// 供 Task 3 接线一致性测试：tonemap stage 声明的 uniform（colorTexture 是 Cesium 内建白名单）。
export const TONEMAP_UNIFORM_NAMES: string[] = ['u_debugMode', 'u_ditherScale']

// 组装 PostProcessStage 用 fragment shader（含 czm_* automatic uniform 引用，仅供 Cesium 运行时）。
export function buildTonemapFragmentShader(): string {
  return [UNIFORMS_GLSL, HELPERS_GLSL, MAIN_GLSL].join('\n')
}

// 供 glslang 独立校验：补 #version 300 es + precision + out_FragColor 桩。
// colorTexture/v_textureCoordinates/u_debugMode 在主体声明，此处仅补 Cesium 运行时注入的 out_FragColor。
const VALIDATION_STUBS_GLSL = `
out vec4 out_FragColor;
`

export function buildStandaloneShaderForValidation(): string {
  return [
    '#version 300 es',
    'precision highp float;',
    // GLSL ES 3.00 sampler 不继承 float precision，移动 GPU 严格需独立声明（对齐 phase1
    // aerialPerspective.frag 的 validation 桩）。tonomap 无 sampler3D，不声明那条。
    'precision highp int;',
    'precision highp sampler2D;',
    VALIDATION_STUBS_GLSL,
    buildTonemapFragmentShader()
  ].join('\n')
}
