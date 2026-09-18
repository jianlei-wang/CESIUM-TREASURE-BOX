// lf_bloom series composite down 级（down0-4）fragment（CoD:AW 13-tap downsample，spec §5.2）。
// 读 series 前驱（threshold 或 down[i-1] = colorTexture），输出 2× downsample 到下一级。
//
// **CoD:AW 权重**（非 learnopengl，**不可与 threshold.frag 混**，spec §5.2 / 评审 I4）：
//   WEIGHT_INNER = 0.125   内角(±1,±1)×4
//   WEIGHT_OUTER = 0.05556 center(0,0) + 边中(±2,0)/(0,±2)×4 + 外角(±2,±2)×4
// 权重和 ≈ 1.0（0.05556≈1/18：9 tap × 1/18 = 0.5，加 4 × 0.125 = 0.5，归一化）。
// 与 threshold.frag learnopengl 核几何同（同为 13-tap 5×5 十字），但权重不同——
// threshold 是 learnopengl 0.125/0.0625/0.03125，down 是 CoD:AW 0.125/0.05556。
// 数值取自 lensFlareConstants.ts::CODAW_DOWNSAMPLE_WEIGHTS，GLSL 内直接写数值常量
// （避免运行时注入，对齐 threshold.frag.ts 做法）。
//
// u_texelSize 是**源** texture（series 前驱）的 1/w,1/h（spec §5.2 / v2 I8：源非目标）。
// downsample 无除法/开方等 NaN 源，且前驱 threshold 已 NaN 守护归零，此处不再重复守护。

// 内建纹理 uniform（Cesium series input = 前驱 stage 输出，shader 须显式声明）+ texel size。
const UNIFORMS_GLSL = `
uniform sampler2D colorTexture;
uniform vec2 u_texelSize;        // 源 texture（series 前驱）的 1/w, 1/h（v2 I8：源非目标）
`

const MAIN_GLSL = `
in vec2 v_textureCoordinates;

void main() {
  vec2 ts = u_texelSize;
  // CoD:AW 13-tap downsample（WEIGHT_INNER=0.125 / WEIGHT_OUTER=0.05556）：
  //   center(0,0) @0.05556
  vec3 color = texture(colorTexture, v_textureCoordinates).rgb * 0.05556;
  //   内角(±1,±1)×4 @0.125（WEIGHT_INNER）
  color += (texture(colorTexture, v_textureCoordinates + vec2(-1.0, -1.0) * ts).rgb
          + texture(colorTexture, v_textureCoordinates + vec2(1.0, 1.0) * ts).rgb
          + texture(colorTexture, v_textureCoordinates + vec2(-1.0, 1.0) * ts).rgb
          + texture(colorTexture, v_textureCoordinates + vec2(1.0, -1.0) * ts).rgb) * 0.125;
  //   边中(±2,0)/(0,±2)×4 + 外角(±2,±2)×4 都用 WEIGHT_OUTER 0.05556，合并 8-tap 块
  color += (texture(colorTexture, v_textureCoordinates + vec2(-2.0, 0.0) * ts).rgb
          + texture(colorTexture, v_textureCoordinates + vec2(2.0, 0.0) * ts).rgb
          + texture(colorTexture, v_textureCoordinates + vec2(0.0, -2.0) * ts).rgb
          + texture(colorTexture, v_textureCoordinates + vec2(0.0, 2.0) * ts).rgb
          + texture(colorTexture, v_textureCoordinates + vec2(-2.0, -2.0) * ts).rgb
          + texture(colorTexture, v_textureCoordinates + vec2(2.0, 2.0) * ts).rgb
          + texture(colorTexture, v_textureCoordinates + vec2(-2.0, 2.0) * ts).rgb
          + texture(colorTexture, v_textureCoordinates + vec2(2.0, -2.0) * ts).rgb) * 0.05556;
  out_FragColor = vec4(color, 1.0);
}
`

// 供 series 接线一致性测试：down stage 声明的 uniform（colorTexture 是 Cesium 内建白名单）。
export const BLOOM_DOWNSAMPLE_UNIFORM_NAMES: string[] = ['u_texelSize']

// 组装 PostProcessStage 用 fragment shader（供 Cesium 运行时；colorTexture/v_textureCoordinates
// 由 Cesium 注入值，shader 显式声明；out_FragColor 由 Cesium 注入声明）。
export function buildBloomDownsampleFragmentShader(): string {
  return [UNIFORMS_GLSL, MAIN_GLSL].join('\n')
}

// 供 glslang 独立校验：补 #version 300 es + precision + out_FragColor 桩。
// colorTexture/u_texelSize/v_textureCoordinates 在主体声明，此处不重复。
const VALIDATION_STUBS_GLSL = `
out vec4 out_FragColor;
`

export function buildStandaloneShaderForValidation(): string {
  return [
    '#version 300 es',
    'precision highp float;',
    // GLSL ES 3.00 sampler 不继承 float precision，移动 GPU 严格需独立声明（对齐
    // threshold.frag.ts validation 桩）。down 无 sampler3D，不声明那条。
    'precision highp int;',
    'precision highp sampler2D;',
    VALIDATION_STUBS_GLSL,
    buildBloomDownsampleFragmentShader()
  ].join('\n')
}
