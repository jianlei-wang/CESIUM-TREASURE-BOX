import {
  Cartesian2,
  Cartesian3,
  Color,
  CustomShader,
  PostProcessStage,
  SceneTransforms,
  Tonemapper,
  UniformType,
  type Scene
} from 'cesium'

export type LocalLightType = 'point' | 'spot' | 'rect'

export const LIGHT_TYPE_CODE: Record<LocalLightType, number> = {
  point: 0,
  spot: 1,
  rect: 2
}

export interface LocalLightConfig {
  type: LocalLightType
  position: Cartesian3
  color: Cartesian3
  intensity: number
  range: number
  decay: number
  direction: Cartesian3
  innerAngle: number
  outerAngle: number
  width: number
  height: number
  up: Cartesian3
  ambient: number
  specular: number
  shininess: number
  hemiSky: Cartesian3
  hemiGround: Cartesian3
  hemiIntensity: number
}

export function defaultLocalLightConfig(type: LocalLightType): LocalLightConfig {
  return {
    type,
    position: Cartesian3.fromDegrees(4.9041, 52.3676, 300),
    color: new Cartesian3(1, 0.92, 0.75),
    intensity: 3,
    range: 1500,
    decay: 2,
    direction: new Cartesian3(0, 0, -1),
    innerAngle: Math.PI / 12,
    outerAngle: Math.PI / 6,
    width: 200,
    height: 120,
    up: new Cartesian3(0, 1, 0),
    ambient: 0.18,
    specular: 0.5,
    shininess: 32,
    hemiSky: new Cartesian3(0.55, 0.68, 0.9),
    hemiGround: new Cartesian3(0.16, 0.13, 0.1),
    hemiIntensity: 0.35
  }
}

const LOCAL_LIGHT_FRAGMENT = `
float ndlTerm(vec3 N, vec3 Ld) {
  return max(dot(N, Ld), 0.0);
}

float specTerm(vec3 N, vec3 Ld, vec3 V) {
  vec3 H = normalize(Ld + V);
  float ndl = ndlTerm(N, Ld);
  return ndl > 0.0 ? pow(max(dot(N, H), 0.0), u_shininess) : 0.0;
}

vec3 calcRectDiffuse(vec3 P, vec3 N, vec3 c, vec3 dir, vec3 up, float width, float height) {
  vec3 right = normalize(cross(dir, up));
  vec3 upNorm = normalize(cross(right, dir));
  vec3 p0 = c + right * (-width * 0.5) + upNorm * (-height * 0.5);
  vec3 p1 = c + right * ( width * 0.5) + upNorm * (-height * 0.5);
  vec3 p2 = c + right * ( width * 0.5) + upNorm * ( height * 0.5);
  vec3 p3 = c + right * (-width * 0.5) + upNorm * ( height * 0.5);
  vec3 v0 = normalize(p0 - P);
  vec3 v1 = normalize(p1 - P);
  vec3 v2 = normalize(p2 - P);
  vec3 v3 = normalize(p3 - P);
  float g0 = acos(clamp(dot(v0, v1), -1.0, 1.0));
  float g1 = acos(clamp(dot(v1, v2), -1.0, 1.0));
  float g2 = acos(clamp(dot(v2, v3), -1.0, 1.0));
  float g3 = acos(clamp(dot(v3, v0), -1.0, 1.0));
  vec3 n0 = normalize(cross(v0, v1));
  vec3 n1 = normalize(cross(v1, v2));
  vec3 n2 = normalize(cross(v2, v3));
  vec3 n3 = normalize(cross(v3, v0));
  float irr = 0.5 * abs(
    g0 * dot(n0, N) + g1 * dot(n1, N) + g2 * dot(n2, N) + g3 * dot(n3, N)
  );
  return vec3(max(irr, 0.0));
}

void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  vec3 P = fsInput.attributes.positionEC;
  vec3 N = normalize(fsInput.attributes.normalEC);
  vec3 V = normalize(-P);

  vec3 Pw = (czm_inverseView * vec4(P, 1.0)).xyz;
  vec3 Nw = normalize(czm_inverseViewRotation * N);
  float hemiH = dot(Nw, normalize(Pw)) * 0.5 + 0.5;
  vec3 ambient = mix(u_hemiGroundColor, u_hemiSkyColor, hemiH) * u_hemiIntensity + vec3(u_ambient);

  vec3 lightPosEC = (czm_view * vec4(u_lightPosWC, 1.0)).xyz;
  vec3 lightDirEC = (czm_view * vec4(u_lightDirWC, 0.0)).xyz;
  vec3 upEC = (czm_view * vec4(u_lightUpWC, 0.0)).xyz;
  vec3 lc = u_lightColor;

  vec3 diffuse = vec3(0.0);
  vec3 specular = vec3(0.0);

  if (u_lightType < 0.5) {
    vec3 L = lightPosEC - P;
    float dist = length(L);
    if (dist <= u_lightRange) {
      vec3 Ld = L / max(dist, 1e-3);
      float atten = pow(clamp(1.0 - dist / max(u_lightRange, 1.0), 0.0, 1.0), u_lightDecay);
      diffuse += lc * u_lightIntensity * ndlTerm(N, Ld) * atten;
      specular += lc * u_specular * specTerm(N, Ld, V) * atten;
    }
  } else if (u_lightType < 1.5) {
    vec3 L = lightPosEC - P;
    float dist = length(L);
    if (dist <= u_lightRange) {
      vec3 Ld = L / max(dist, 1e-3);
      float atten = pow(clamp(1.0 - dist / max(u_lightRange, 1.0), 0.0, 1.0), u_lightDecay);
      vec3 fromLight = normalize(P - lightPosEC);
      float cosTheta = dot(fromLight, normalize(-lightDirEC));
      float spot = smoothstep(cos(u_lightOuter), cos(u_lightInner), cosTheta);
      diffuse += lc * u_lightIntensity * ndlTerm(N, Ld) * atten * spot;
      specular += lc * u_specular * specTerm(N, Ld, V) * atten * spot;
    }
  } else {
    vec3 irr = calcRectDiffuse(P, N, lightPosEC, normalize(lightDirEC), normalize(upEC), u_lightWidth, u_lightHeight);
    diffuse += lc * u_lightIntensity * irr;
  }

  vec3 base = material.baseColor.rgb;
  material.diffuse = vec3(0.0);
  material.emissive = base * (ambient + diffuse) + specular;
  material.specular = vec3(0.0);
}
`

export function createLocalLightShader(): CustomShader {
  return new CustomShader({
    uniforms: {
      u_lightType: { type: UniformType.FLOAT, value: 0 },
      u_lightPosWC: { type: UniformType.VEC3, value: new Cartesian3() },
      u_lightColor: { type: UniformType.VEC3, value: new Cartesian3(1, 1, 1) },
      u_lightIntensity: { type: UniformType.FLOAT, value: 3 },
      u_lightRange: { type: UniformType.FLOAT, value: 1500 },
      u_lightDecay: { type: UniformType.FLOAT, value: 2 },
      u_lightDirWC: { type: UniformType.VEC3, value: new Cartesian3(0, 0, -1) },
      u_lightInner: { type: UniformType.FLOAT, value: Math.PI / 12 },
      u_lightOuter: { type: UniformType.FLOAT, value: Math.PI / 6 },
      u_lightWidth: { type: UniformType.FLOAT, value: 200 },
      u_lightHeight: { type: UniformType.FLOAT, value: 120 },
      u_lightUpWC: { type: UniformType.VEC3, value: new Cartesian3(0, 1, 0) },
      u_ambient: { type: UniformType.FLOAT, value: 0.18 },
      u_specular: { type: UniformType.FLOAT, value: 0.5 },
      u_shininess: { type: UniformType.FLOAT, value: 32 },
      u_hemiSkyColor: { type: UniformType.VEC3, value: new Cartesian3(0.55, 0.68, 0.9) },
      u_hemiGroundColor: { type: UniformType.VEC3, value: new Cartesian3(0.16, 0.13, 0.1) },
      u_hemiIntensity: { type: UniformType.FLOAT, value: 0.35 }
    },
    fragmentShaderText: LOCAL_LIGHT_FRAGMENT
  })
}

export function applyLocalLightUniforms(shader: CustomShader, cfg: LocalLightConfig): void {
  shader.setUniform('u_lightType', LIGHT_TYPE_CODE[cfg.type])
  shader.setUniform('u_lightPosWC', cfg.position)
  shader.setUniform('u_lightColor', cfg.color)
  shader.setUniform('u_lightIntensity', cfg.intensity)
  shader.setUniform('u_lightRange', cfg.range)
  shader.setUniform('u_lightDecay', cfg.decay)
  shader.setUniform('u_lightDirWC', cfg.direction)
  shader.setUniform('u_lightInner', cfg.innerAngle)
  shader.setUniform('u_lightOuter', cfg.outerAngle)
  shader.setUniform('u_lightWidth', cfg.width)
  shader.setUniform('u_lightHeight', cfg.height)
  shader.setUniform('u_lightUpWC', cfg.up)
  shader.setUniform('u_ambient', cfg.ambient)
  shader.setUniform('u_specular', cfg.specular)
  shader.setUniform('u_shininess', cfg.shininess)
  shader.setUniform('u_hemiSkyColor', cfg.hemiSky)
  shader.setUniform('u_hemiGroundColor', cfg.hemiGround)
  shader.setUniform('u_hemiIntensity', cfg.hemiIntensity)
}

export function hexToCartesian(hex: string): Cartesian3 {
  const color = Color.fromCssColorString(hex) ?? Color.WHITE
  return new Cartesian3(color.red, color.green, color.blue)
}

/* ------------------------------------------------------------------ */
/* 后处理效果                                                          */
/* ------------------------------------------------------------------ */

export const TONEMAPPERS: Record<string, Tonemapper> = {
  PBR_NEUTRAL: Tonemapper.PBR_NEUTRAL,
  ACES: Tonemapper.ACES,
  FILMIC: Tonemapper.FILMIC,
  REINHARD: Tonemapper.REINHARD,
  MODIFIED_REINHARD: Tonemapper.MODIFIED_REINHARD
}

export function tonemapperFromName(name: string): Tonemapper {
  return TONEMAPPERS[name] ?? Tonemapper.PBR_NEUTRAL
}

export interface BloomConfig {
  contrast: number
  brightness: number
  delta: number
  sigma: number
  stepSize: number
  glowOnly: boolean
}

export interface SsaoConfig {
  intensity: number
  lengthCap: number
  bias: number
  stepCount: number
  directionCount: number
  ambientOcclusionOnly: boolean
}

export interface ColorGradingConfig {
  slope: [number, number, number]
  offset: [number, number, number]
  power: [number, number, number]
  saturation: number
  contrast: number
  brightness: number
}

export const DEFAULT_BLOOM: BloomConfig = { contrast: 128, brightness: -0.3, delta: 1, sigma: 2, stepSize: 1, glowOnly: false }
export const DEFAULT_SSAO: SsaoConfig = { intensity: 3, lengthCap: 0.26, bias: 0.1, stepCount: 32, directionCount: 8, ambientOcclusionOnly: false }
export const DEFAULT_COLOR_GRADING: ColorGradingConfig = {
  slope: [1, 1, 1],
  offset: [0, 0, 0],
  power: [1, 1, 1],
  saturation: 1,
  contrast: 1,
  brightness: 0
}

function toCartesian3(value: [number, number, number]): Cartesian3 {
  return Cartesian3.fromElements(value[0], value[1], value[2], new Cartesian3())
}

export function applyBloom(scene: Scene, enabled: boolean, cfg: BloomConfig): void {
  const bloom = scene.postProcessStages.bloom
  bloom.enabled = enabled
  if (!enabled) return
  bloom.uniforms.contrast = cfg.contrast
  bloom.uniforms.brightness = cfg.brightness
  bloom.uniforms.delta = cfg.delta
  bloom.uniforms.sigma = cfg.sigma
  bloom.uniforms.stepSize = cfg.stepSize
  bloom.uniforms.glowOnly = cfg.glowOnly
}

export function applySsao(scene: Scene, enabled: boolean, cfg: SsaoConfig): void {
  const ao = scene.postProcessStages.ambientOcclusion
  ao.enabled = enabled
  if (!enabled) return
  ao.uniforms.intensity = cfg.intensity
  ao.uniforms.lengthCap = cfg.lengthCap
  ao.uniforms.bias = cfg.bias
  ao.uniforms.stepCount = cfg.stepCount
  ao.uniforms.directionCount = cfg.directionCount
  ao.uniforms.ambientOcclusionOnly = cfg.ambientOcclusionOnly
}

export function applyFxaa(scene: Scene, enabled: boolean): void {
  scene.postProcessStages.fxaa.enabled = enabled
}

export function applyHdr(scene: Scene, enabled: boolean, tonemapperName: string): void {
  scene.highDynamicRange = enabled
  if (enabled) scene.postProcessStages.tonemapper = tonemapperFromName(tonemapperName)
}

const COLOR_GRADING_FRAGMENT = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform vec3 u_slope;
uniform vec3 u_offset;
uniform vec3 u_power;
uniform float u_saturation;
uniform float u_contrast;
uniform float u_brightness;

void main() {
  vec4 color = texture(colorTexture, v_textureCoordinates);
  vec3 rgb = color.rgb;
  rgb = pow(max(u_slope * rgb + u_offset, 0.0), u_power);
  rgb = (rgb - 0.5) * u_contrast + 0.5;
  rgb += u_brightness;
  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(vec3(luma), rgb, u_saturation);
  out_FragColor = vec4(rgb, color.a);
}
`

export function createColorGradingStage(cfg: ColorGradingConfig): PostProcessStage {
  return new PostProcessStage({
    name: 'color_grading',
    fragmentShader: COLOR_GRADING_FRAGMENT,
    uniforms: {
      u_slope: toCartesian3(cfg.slope),
      u_offset: toCartesian3(cfg.offset),
      u_power: toCartesian3(cfg.power),
      u_saturation: cfg.saturation,
      u_contrast: cfg.contrast,
      u_brightness: cfg.brightness
    }
  })
}

export function updateColorGradingStage(stage: PostProcessStage, cfg: ColorGradingConfig): void {
  stage.uniforms.u_slope = toCartesian3(cfg.slope)
  stage.uniforms.u_offset = toCartesian3(cfg.offset)
  stage.uniforms.u_power = toCartesian3(cfg.power)
  stage.uniforms.u_saturation = cfg.saturation
  stage.uniforms.u_contrast = cfg.contrast
  stage.uniforms.u_brightness = cfg.brightness
}

export interface VolumetricConfig {
  density: number
  decay: number
  weight: number
  exposure: number
}

export const DEFAULT_VOLUMETRIC: VolumetricConfig = { density: 0.5, decay: 0.95, weight: 0.3, exposure: 0.2 }

const VOLUMETRIC_FRAGMENT = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform vec2 u_lightScreenPos;
uniform float u_density;
uniform float u_decay;
uniform float u_weight;
uniform float u_exposure;

void main() {
  vec2 texCoord = v_textureCoordinates;
  vec2 delta = (texCoord - u_lightScreenPos) * (1.0 / 16.0) * u_density;
  vec4 color = texture(colorTexture, texCoord);
  float illum = 1.0;
  for (int i = 0; i < 16; i++) {
    texCoord -= delta;
    vec4 sampleColor = texture(colorTexture, clamp(texCoord, vec2(0.0), vec2(1.0)));
    sampleColor *= illum * u_weight;
    color += sampleColor;
    illum *= u_decay;
  }
  out_FragColor = color * u_exposure;
}
`

export function createVolumetricStage(lightScreenPos: [number, number], cfg: VolumetricConfig): PostProcessStage {
  return new PostProcessStage({
    name: 'volumetric_light',
    fragmentShader: VOLUMETRIC_FRAGMENT,
    uniforms: {
      u_lightScreenPos: Cartesian2.fromElements(lightScreenPos[0], lightScreenPos[1], new Cartesian2()),
      u_density: cfg.density,
      u_decay: cfg.decay,
      u_weight: cfg.weight,
      u_exposure: cfg.exposure
    }
  })
}

export function updateVolumetricStage(
  stage: PostProcessStage,
  lightScreenPos: [number, number],
  cfg: VolumetricConfig
): void {
  stage.uniforms.u_lightScreenPos = Cartesian2.fromElements(lightScreenPos[0], lightScreenPos[1], new Cartesian2())
  stage.uniforms.u_density = cfg.density
  stage.uniforms.u_decay = cfg.decay
  stage.uniforms.u_weight = cfg.weight
  stage.uniforms.u_exposure = cfg.exposure
}

export function projectWorldToScreen(scene: Scene, world: Cartesian3): [number, number] {
  const canvas = scene.canvas
  const pos = SceneTransforms.worldToWindowCoordinates(scene, world)
  if (!pos || canvas.clientWidth === 0 || canvas.clientHeight === 0) return [0.5, 0.5]
  return [pos.x / canvas.clientWidth, 1 - pos.y / canvas.clientHeight]
}

export const LIGHT_COLOR_OPTIONS: Array<{ label: string; hex: string }> = [
  { label: '白光', hex: '#ffffff' },
  { label: '暖黄', hex: '#ffe08a' },
  { label: '青色', hex: '#7fd8ff' },
  { label: '紫罗兰', hex: '#b39cff' },
  { label: '洋红', hex: '#ff6fa8' }
]
