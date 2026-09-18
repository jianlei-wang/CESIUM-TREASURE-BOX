// lf_bloom series composite up 级（up0-4）fragment（9-tap + mix radius，spec §5.3）。
// 读 series 前驱（up[i-1] 或 down4 for up0 = colorTexture）+ 对应 down 级（u_downLevel），
// 输出 9-tap 加权模糊 c 与 down 锐信号的 mix，控制 bloom 软硬。
//
// **9-tap 权重**（spec §5.3，与 downsample 的 CoD:AW 13-tap 不同核，勿混）：
//   WEIGHT_CENTER = 0.25   center(0,0)
//   WEIGHT_EDGE   = 0.125  边中(±1,0)/(0,±1)×4
//   WEIGHT_CORNER = 0.0625 角(±1,±1)×4
// 权重和 = 0.25 + 4×0.125 + 4×0.0625 = 1.0（归一化）。
//
// **mix(support, c, u_upsampleRadius)**（CoD:AW bloom 软硬旋钮，spec §5.3 / v2 I5）：
//   radius 默认 0.85 → 每级 85% 上一级模糊（c，9-tap 加权）+ 15% 同级 down 锐信号（support）。
//
// **u_downLevel 是 uniform-name string 引用**（spec §5.3 / 评审 I9 强制约束）：
//   up[i] 与 down[对应级] 同 textureScale（如 up0/down3 都 0.0625），**不是直接前驱**。
//   若不 uniform-name 显式引用，down[对应] 不在 up[i] 依赖 → 同 scale framebuffer 共享 →
//   up 渲染覆盖 down 输出（冲刷 bug）。故 u_downLevel 必须由接线层以 uniform-name 字面量
//   绑定到 down[对应级] stage，列入 BLOOM_UPSAMPLE_UNIFORM_NAMES 供依赖图构建。
//
// u_texelSize 是**源** texture（series 前驱）的 1/w,1/h（对齐 downsample 做法，源非目标）。
// upsample 无除法/开方等 NaN 源，且前驱 down/threshold 已 NaN 守护归零，此处不再重复守护。

// 内建纹理 uniform（Cesium series input = 前驱 stage 输出，shader 须显式声明）+
// u_downLevel（uniform-name 引用对应 down 级）+ texel size + upsample radius。
const UNIFORMS_GLSL = `
uniform sampler2D colorTexture;       // series 前驱（up[i-1] 或 down4 for up0）
uniform sampler2D u_downLevel;        // 对应 down 级（uniform-name string，强制避共享，I9）
uniform float u_upsampleRadius;       // 默认 0.85（85% 模糊 + 15% 锐）
uniform vec2 u_texelSize;             // 源 texture（series 前驱）的 1/w, 1/h（源非目标）
`

const MAIN_GLSL = `
in vec2 v_textureCoordinates;

void main() {
  vec2 uv = v_textureCoordinates;
  vec2 ts = u_texelSize;
  // 9-tap 加权：center 0.25 + 边中(±1,0)/(0,±1)×4 @0.125 + 角(±1,±1)×4 @0.0625（和=1.0）
  //   center(0,0) @0.25
  vec3 c = texture(colorTexture, uv).rgb * 0.25;
  //   边中(±1,0)/(0,±1)×4 @0.125
  c += (texture(colorTexture, uv + vec2(-1.0, 0.0) * ts).rgb
      + texture(colorTexture, uv + vec2(1.0, 0.0) * ts).rgb
      + texture(colorTexture, uv + vec2(0.0, -1.0) * ts).rgb
      + texture(colorTexture, uv + vec2(0.0, 1.0) * ts).rgb) * 0.125;
  //   角(±1,±1)×4 @0.0625
  c += (texture(colorTexture, uv + vec2(-1.0, -1.0) * ts).rgb
      + texture(colorTexture, uv + vec2(1.0, 1.0) * ts).rgb
      + texture(colorTexture, uv + vec2(-1.0, 1.0) * ts).rgb
      + texture(colorTexture, uv + vec2(1.0, -1.0) * ts).rgb) * 0.0625;
  vec3 support = texture(u_downLevel, uv).rgb;        // 对应 down 级锐信号（uniform-name 引用）
  vec3 result = mix(support, c, u_upsampleRadius);    // 85% 模糊 + 15% 锐
  out_FragColor = vec4(result, 1.0);
}
`

// 供 series 接线一致性测试：up stage 声明的 uniform（colorTexture 是 Cesium 内建白名单）。
// u_downLevel 是 uniform-name string 引用，须列入以构建强制依赖（避同 scale 共享，I9）。
export const BLOOM_UPSAMPLE_UNIFORM_NAMES: string[] = ['u_downLevel', 'u_upsampleRadius', 'u_texelSize']

// 组装 PostProcessStage 用 fragment shader（供 Cesium 运行时；colorTexture/v_textureCoordinates
// 由 Cesium 注入值，shader 显式声明；out_FragColor 由 Cesium 注入声明）。
export function buildBloomUpsampleFragmentShader(): string {
  return [UNIFORMS_GLSL, MAIN_GLSL].join('\n')
}

// 供 glslang 独立校验：补 #version 300 es + precision + out_FragColor 桩。
// colorTexture/u_downLevel/u_upsampleRadius/u_texelSize/v_textureCoordinates 在主体声明，此处不重复。
const VALIDATION_STUBS_GLSL = `
out vec4 out_FragColor;
`

export function buildStandaloneShaderForValidation(): string {
  return [
    '#version 300 es',
    'precision highp float;',
    // GLSL ES 3.00 sampler 不继承 float precision，移动 GPU 严格需独立声明（对齐
    // bloomDownsample.frag.ts / threshold.frag.ts validation 桩）。up 无 sampler3D，不声明那条。
    'precision highp int;',
    'precision highp sampler2D;',
    VALIDATION_STUBS_GLSL,
    buildBloomUpsampleFragmentShader()
  ].join('\n')
}
