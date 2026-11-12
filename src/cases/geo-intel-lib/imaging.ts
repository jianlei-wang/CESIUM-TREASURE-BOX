import { PostProcessStage } from 'cesium'

export type ImagingMode = 'normal' | 'thermal' | 'nightvision' | 'lowlight' | 'sepia' | 'mono'

export type ImagingConfig = {
  enabled: boolean
  mode: ImagingMode
  gain: number
  noise: number
  vignette: number
  scanlines: number
  bloom: number
}

export const DEFAULT_IMAGING: ImagingConfig = {
  enabled: true,
  mode: 'thermal',
  gain: 1.35,
  noise: 0.045,
  vignette: 0.42,
  scanlines: 0.12,
  bloom: 0.35
}

export const IMAGING_MODES: Array<{ id: ImagingMode; label: string }> = [
  { id: 'normal', label: '正常成像' },
  { id: 'thermal', label: '热成像' },
  { id: 'nightvision', label: '微光夜视' },
  { id: 'lowlight', label: '暗光增强' },
  { id: 'sepia', label: '棕褐成像' },
  { id: 'mono', label: '单色成像' }
]

const MODE_CODE: Record<ImagingMode, number> = {
  normal: 0,
  thermal: 1,
  nightvision: 2,
  lowlight: 3,
  sepia: 4,
  mono: 5
}

export const SENSOR_IMAGING_FRAGMENT = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float u_mode;
uniform float u_gain;
uniform float u_noise;
uniform float u_vignette;
uniform float u_scanlines;
uniform float u_bloom;
uniform float u_time;

in vec2 v_textureCoordinates;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 thermalRamp(float t) {
  vec3 c0 = vec3(0.02, 0.01, 0.16);
  vec3 c1 = vec3(0.28, 0.02, 0.42);
  vec3 c2 = vec3(0.78, 0.22, 0.20);
  vec3 c3 = vec3(0.99, 0.72, 0.15);
  vec3 c4 = vec3(1.0, 0.98, 0.90);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.5) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.5) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec4 base = texture(colorTexture, uv);

  // 正常成像直接输出原始画面，不附加任何增益、噪声、暗角、扫描线与光晕。
  if (u_mode < 0.5) {
    out_FragColor = base;
    return;
  }

  float lum = dot(base.rgb, vec3(0.299, 0.587, 0.114));
  float depth = czm_unpackDepth(texture(depthTexture, uv));
  float skyMask = depth >= 0.9999 ? 1.0 : 0.0;

  vec3 color = base.rgb;

  if (u_mode < 1.5) {
    float heat = clamp(pow(lum, 0.85) * u_gain, 0.0, 1.0);
    color = thermalRamp(heat);
  } else if (u_mode < 2.5) {
    float green = clamp(pow(lum, 0.7) * u_gain, 0.0, 1.0);
    color = vec3(0.06 * green, 0.97 * green, 0.32 * green);
  } else if (u_mode < 3.5) {
    float boosted = clamp(lum * u_gain, 0.0, 1.0);
    vec3 cool = vec3(0.18, 0.32, 0.52) * boosted;
    vec3 warm = vec3(0.62, 0.66, 0.74) * boosted;
    color = mix(cool, warm, smoothstep(0.25, 0.85, boosted));
  } else if (u_mode < 4.5) {
    float sep = clamp(lum * u_gain, 0.0, 1.0);
    color = vec3(sep * 1.02, sep * 0.86, sep * 0.62);
  } else {
    float m = clamp(lum * u_gain, 0.0, 1.0);
    color = vec3(m);
  }

  float grain = hash(uv * 1024.0 + u_time * 0.12) - 0.5;
  color += grain * u_noise;

  float scan = 1.0 - u_scanlines * (0.5 + 0.5 * sin(uv.y * 1200.0));
  color *= scan;

  vec2 centered = uv - 0.5;
  float radius = length(centered);
  float vig = smoothstep(0.78, 0.24, radius);
  color *= mix(1.0, vig, u_vignette);

  if (u_bloom > 0.001) {
    vec3 blur = vec3(0.0);
    for (int i = -1; i <= 1; ++i) {
      for (int j = -1; j <= 1; ++j) {
        blur += texture(colorTexture, clamp(uv + vec2(float(i), float(j)) * 2.0 / czm_viewport.zw, vec2(0.001), vec2(0.999))).rgb;
      }
    }
    blur /= 9.0;
    color += blur * u_bloom * 0.28;
  }

  color = mix(color, color * vec3(0.55, 0.65, 0.9), skyMask * 0.25);
  out_FragColor = vec4(color, base.a);
}
`

export function createSensorImagingStage(cfg: ImagingConfig, startTime: number): PostProcessStage {
  return new PostProcessStage({
    name: 'sensor_imaging',
    fragmentShader: SENSOR_IMAGING_FRAGMENT,
    uniforms: {
      u_mode: MODE_CODE[cfg.mode],
      u_gain: cfg.gain,
      u_noise: cfg.noise,
      u_vignette: cfg.vignette,
      u_scanlines: cfg.scanlines,
      u_bloom: cfg.bloom,
      u_time: startTime
    }
  })
}

export function updateSensorImagingStage(stage: PostProcessStage, cfg: ImagingConfig, timeSec: number): void {
  stage.enabled = cfg.enabled
  stage.uniforms.u_mode = MODE_CODE[cfg.mode]
  stage.uniforms.u_gain = cfg.gain
  stage.uniforms.u_noise = cfg.noise
  stage.uniforms.u_vignette = cfg.vignette
  stage.uniforms.u_scanlines = cfg.scanlines
  stage.uniforms.u_bloom = cfg.bloom
  stage.uniforms.u_time = timeSec
}
