import { Cartesian3, PostProcessStage } from 'cesium'

export type HaloConfig = {
  enabled: boolean
  radius: number
  gain: number
  threshold: number
  tint: [number, number, number]
  rimOnly: boolean
  split: number
  maskEnabled: boolean
}

export const DEFAULT_HALO: HaloConfig = {
  enabled: true,
  radius: 3.2,
  gain: 1.4,
  threshold: 3.4,
  tint: [0.55, 0.86, 1],
  rimOnly: false,
  split: 0.5,
  maskEnabled: true
}

/**
 * 与视角无关的结构响应：
 * - 颜色项对亮度做 Sobel 梯度，并以局部平均亮度归一化，暗光与低对比画面同样有响应；
 * - 纹理项统计邻域亮度标准差，捕捉俯视时卫星影像中的细碎地物纹理；
 * - 深度项取拉普拉斯与一阶坡度之比，线性倾斜地表（二阶导为零）被抵消，只在深度不连续处响应。
 * 三项取最大值，因此平视、俯视、斜视都能得到稳定的边缘估计。
 */
export const ENTROPY_HALO_FRAGMENT = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float u_radius;
uniform float u_gain;
uniform float u_threshold;
uniform vec3 u_tint;
uniform float u_rimOnly;
uniform float u_split;
uniform float u_maskEnabled;

in vec2 v_textureCoordinates;

float luminanceOf(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

// 直接读取原始深度值用于天空判定：清屏后的深度恰好为 1.0，
// 不经过 czm_unpackDepth 的编码解码，避免对数深度缓冲下被误判为天空。
float rawDepthAt(vec2 uv) {
  return texture(depthTexture, clamp(uv, vec2(0.0005), vec2(0.9995))).r;
}

float linearDepthAt(vec2 uv) {
  return czm_readDepth(depthTexture, clamp(uv, vec2(0.0005), vec2(0.9995)));
}

float colorStructure(vec2 uv, float centerLum) {
  vec2 tap = max(u_radius, 0.5) / czm_viewport.zw;
  float tl = luminanceOf(texture(colorTexture, uv + vec2(-1.0, 1.0) * tap).rgb);
  float tc = luminanceOf(texture(colorTexture, uv + vec2(0.0, 1.0) * tap).rgb);
  float tr = luminanceOf(texture(colorTexture, uv + vec2(1.0, 1.0) * tap).rgb);
  float ml = luminanceOf(texture(colorTexture, uv + vec2(-1.0, 0.0) * tap).rgb);
  float mr = luminanceOf(texture(colorTexture, uv + vec2(1.0, 0.0) * tap).rgb);
  float bl = luminanceOf(texture(colorTexture, uv + vec2(-1.0, -1.0) * tap).rgb);
  float bc = luminanceOf(texture(colorTexture, uv + vec2(0.0, -1.0) * tap).rgb);
  float br = luminanceOf(texture(colorTexture, uv + vec2(1.0, -1.0) * tap).rgb);

  float gradX = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gradY = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
  float gradient = length(vec2(gradX, gradY));

  float meanLum = (tl + tc + tr + ml + centerLum + mr + bl + bc + br) / 9.0;
  float contrast = gradient / max(meanLum, 0.18);

  // 纹理项：邻域亮度离散度，补充平坦区域内的小尺度地物
  float variance = 0.0;
  variance += (tl - meanLum) * (tl - meanLum);
  variance += (tc - meanLum) * (tc - meanLum);
  variance += (tr - meanLum) * (tr - meanLum);
  variance += (ml - meanLum) * (ml - meanLum);
  variance += (mr - meanLum) * (mr - meanLum);
  variance += (bl - meanLum) * (bl - meanLum);
  variance += (bc - meanLum) * (bc - meanLum);
  variance += (br - meanLum) * (br - meanLum);
  float textureTerm = sqrt(variance / 8.0) / max(meanLum, 0.18);

  return max(contrast, textureTerm * 0.85);
}

float depthStructure(vec2 uv, float centerDepth) {
  vec2 tap = max(u_radius, 0.5) / czm_viewport.zw;
  float left = linearDepthAt(uv - vec2(tap.x, 0.0));
  float right = linearDepthAt(uv + vec2(tap.x, 0.0));
  float down = linearDepthAt(uv - vec2(0.0, tap.y));
  float up = linearDepthAt(uv + vec2(0.0, tap.y));

  float laplacian = abs(4.0 * centerDepth - left - right - down - up);
  float slope = abs(right - left) + abs(up - down);
  // 平坦与平滑斜坡处 laplacian 相对 slope 很小；断崖处 laplacian 与 slope 同量级。
  float ratio = laplacian / max(slope, 1e-6);
  // 归一化幅度，抑制远距离深度量化噪声，只保留真实的深度不连续。
  float magnitude = laplacian / max(centerDepth, 1e-5);
  return ratio * smoothstep(0.0004, 0.004, magnitude);
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec4 base = texture(colorTexture, uv);

  if (u_maskEnabled > 0.5 && uv.x < u_split) {
    out_FragColor = base;
    return;
  }

  // 天空判定只针对清屏值 1.0；不能用线性化后的深度阈值，
  // 否则俯视时远处地面会被整体跳过，导致只有斜视视角才出现描边。
  if (rawDepthAt(uv) >= 0.9999995) {
    out_FragColor = base;
    return;
  }

  float centerLum = luminanceOf(base.rgb);
  float colorTerm = colorStructure(uv, centerLum);
  float depthTerm = depthStructure(uv, linearDepthAt(uv)) * 0.5;

  // colorStructure / depthStructure 返回的都是「相对局部亮度/深度」的无量纲比值，
  // 真实卫星影像上普通地物约 1~2，明显边缘约 2.5~5。直接以阈值为中心做软过渡，
  // 平坦区域保持为 0，只有真正的结构边缘才点亮，避免整幅画面泛光。
  float response = max(colorTerm, depthTerm);
  float halo = smoothstep(u_threshold * 0.82, u_threshold * 1.3, response) * u_gain;
  halo = min(halo, 0.92);

  if (u_rimOnly > 0.5) {
    float band = 1.0 - smoothstep(u_threshold * 2.1, u_threshold * 3.4, response);
    halo *= band;
  }

  vec3 shaded = mix(base.rgb, base.rgb * 0.52, clamp(halo, 0.0, 1.0) * 0.55);
  vec3 color = shaded + u_tint * halo * 0.9;
  out_FragColor = vec4(color, base.a);
}
`

export function createEntropyHaloStage(cfg: HaloConfig): PostProcessStage {
  return new PostProcessStage({
    name: 'entropy_halo',
    fragmentShader: ENTROPY_HALO_FRAGMENT,
    uniforms: {
      u_radius: cfg.radius,
      u_gain: cfg.gain,
      u_threshold: cfg.threshold,
      u_tint: new Cartesian3(cfg.tint[0], cfg.tint[1], cfg.tint[2]),
      u_rimOnly: cfg.rimOnly ? 1 : 0,
      u_split: cfg.split,
      u_maskEnabled: cfg.maskEnabled ? 1 : 0
    }
  })
}

export function updateEntropyHaloStage(stage: PostProcessStage, cfg: HaloConfig): void {
  stage.enabled = cfg.enabled
  stage.uniforms.u_radius = cfg.radius
  stage.uniforms.u_gain = cfg.gain
  stage.uniforms.u_threshold = cfg.threshold
  stage.uniforms.u_tint = new Cartesian3(cfg.tint[0], cfg.tint[1], cfg.tint[2])
  stage.uniforms.u_rimOnly = cfg.rimOnly ? 1 : 0
  stage.uniforms.u_split = cfg.split
  stage.uniforms.u_maskEnabled = cfg.maskEnabled ? 1 : 0
}
