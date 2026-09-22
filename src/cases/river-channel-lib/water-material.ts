import { Cartesian2, Color, Material } from 'cesium'

/**
 * 真实河道水面材质。
 *
 * 与普通粒子/多边形水面不同，这里的水面网格由真实地形采样得到：
 * 每个顶点带有「水面高程 - 河床高程」的水深属性 v_depth，片元据此在
 * 浅水色与深水色之间渐变，并在地形高于水面的地方被裁剪掉，
 * 从而让水面自然填满河谷、岸线随等高线蜿蜒。
 *
 * 着色器提供参考效果中的全套可调参数：
 * 基础颜色/透明度、水深值、扭曲度、浅水区颜色与透明度、深水区颜色与透明度、
 * 菲涅尔反射色与系数、反射强度与混合度、水流速、流向偏转（流向由地形与河道走向
 * 自动判定，偏转仅用于人工微调）、
 * 白浪混合度/速度/缩放/强度、波高/振幅/密度/平滑、高光。
 */
export type RiverWaterParams = {
  baseColor: string
  baseAlpha: number
  depthValue: number
  distortion: number
  shallowColor: string
  shallowAlpha: number
  deepColor: string
  deepAlpha: number
  fresnelColor: string
  fresnelPower: number
  reflectIntensity: number
  reflectMix: number
  flowSpeed: number
  flowAngle: number
  foamMix: number
  foamSpeed: number
  foamScale: number
  foamIntensity: number
  waveHeight: number
  waveAmplitude: number
  waveDensity: number
  waveSmooth: number
  specular: number
  specularColor: string
}

/** 水面网格的顶点着色器：透传眼空间坐标、法线、UV、逐顶点水深与自动流向。 */
export const RIVER_WATER_VERTEX_SHADER = `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in vec2 st;
in float aDepth;
in vec2 aFlow;
in float batchId;

out vec3 v_positionEC;
out vec3 v_normalEC;
out vec2 v_st;
out float v_depth;
out vec2 v_flow;

void main() {
  vec4 p = czm_translateRelativeToEye(position3DHigh, position3DLow);
  p = czm_modelViewRelativeToEye * p;
  v_positionEC = p.xyz;
  v_normalEC = normalize(czm_normal * normal);
  v_st = st;
  v_depth = aDepth;
  v_flow = aFlow;
  gl_Position = czm_projection * p;
}
`

/** 水面网格的片元着色器：调用材质里注入的 rwShade 得到颜色与透明度。 */
export const RIVER_WATER_FRAGMENT_SHADER = `
in vec3 v_positionEC;
in vec3 v_normalEC;
in vec2 v_st;
in float v_depth;
in vec2 v_flow;

void main() {
  // 地形高于水面（水深 <= 0）的地方不绘制水体，岸线由此自然形成
  if (v_depth <= 0.02) {
    discard;
  }

  vec3 viewDir = normalize(-v_positionEC);
  vec3 geoNormal = normalize(v_normalEC);
  vec3 sunDir = normalize(czm_sunDirectionEC);

  // 以水面法线构造一组切空间基，用于叠加波纹扰动
  vec3 tangent = cross(vec3(0.0, 1.0, 0.0), geoNormal);
  if (length(tangent) < 0.1) {
    tangent = cross(vec3(1.0, 0.0, 0.0), geoNormal);
  }
  tangent = normalize(tangent);
  vec3 binormal = normalize(cross(geoNormal, tangent));

  float time = mod(float(czm_frameNumber), 20000.0) * 0.016;

  vec4 shaded = rwShade(v_st, v_depth, viewDir, geoNormal, sunDir, tangent, binormal, time, v_flow);

  // 岸边浅水淡出，削弱网格边界造成的锯齿
  float shoreFade = smoothstep(0.0, 2.2, v_depth);
  out_FragColor = vec4(shaded.rgb, shaded.a * shoreFade);
}
`

/**
 * 注入到片元着色器之前的材质源码。
 *
 * 注意：Cesium 会把这里出现的 uniform 统一改名（追加内部后缀），
 * 因此所有 uniform 读取都必须写在这段源码里，片元着色器只能调用这里的函数。
 */
const RIVER_WATER_MATERIAL_SOURCE = `
const vec2 RW_MOD2 = vec2(4.438975, 3.972973);

float rwHash(float p) {
  vec2 p2 = fract(vec2(p) * RW_MOD2);
  p2 += dot(p2.yx, p2.xy + 19.19);
  return fract(p2.x * p2.y);
}

vec2 rwHash2(float p) {
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 19.19);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float rwNoise(vec2 o) {
  vec2 p = floor(o);
  vec2 f = fract(o);
  float n = p.x + p.y * 57.0;
  float a = rwHash(n + 0.0);
  float b = rwHash(n + 1.0);
  float c = rwHash(n + 57.0);
  float d = rwHash(n + 58.0);
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 t = 3.0 * f2 - 2.0 * f3;
  float u = t.x;
  float v = t.y;
  return a + (b - a) * u + (c - a) * v + (a - b + d - c) * u * v;
}

vec3 rwNoiseDxy(vec2 o) {
  vec2 p = floor(o);
  vec2 f = fract(o);
  float n = p.x + p.y * 57.0;
  float a = rwHash(n + 0.0);
  float b = rwHash(n + 1.0);
  float c = rwHash(n + 57.0);
  float d = rwHash(n + 58.0);
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 t = 3.0 * f2 - 2.0 * f3;
  vec2 dt = 6.0 * f - 6.0 * f2;
  float u = t.x;
  float v = t.y;
  float du = dt.x;
  float dv = dt.y;
  float res = a + (b - a) * u + (c - a) * v + (a - b + d - c) * u * v;
  float dx = (b - a) * du + (a - b + d - c) * du * v;
  float dy = (c - a) * dv + (a - b + d - c) * u * dv;
  return vec3(dx, dy, res);
}

vec3 rwFbmDxy(vec2 p, vec2 flow, float persistence, float distortion) {
  vec3 f = vec3(0.0);
  float amplitude = 1.0;
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    p += flow;
    flow *= -0.75;
    vec3 v = rwNoiseDxy(p);
    f += v * amplitude;
    p += v.xy * distortion;
    p *= 2.0;
    total += amplitude;
    amplitude *= persistence;
  }
  return f / max(total, 1e-4);
}

float rwFbm(vec2 p, vec2 flow) {
  float f = 0.0;
  float amplitude = 1.0;
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    p += flow;
    flow *= -0.7;
    f += rwNoise(p) * amplitude;
    p *= 2.0;
    total += amplitude;
    amplitude *= 0.7;
  }
  return f / max(total, 1e-4);
}

/**
 * 取该像素处的水流方向（切空间的 east, north 分量）。
 * flow 来自逐顶点自动判定的河道流向，u_flowAngle 只作为人为偏转的微调。
 */
vec2 rwFlowDir(vec2 flow) {
  float angle = radians(u_flowAngle);
  float s = sin(angle);
  float c = cos(angle);
  vec2 dir = vec2(flow.x * c - flow.y * s, flow.x * s + flow.y * c);
  float len = length(dir);
  if (len < 1e-5) {
    return vec2(c, s);
  }
  return dir / len;
}

float rwDepthRatio(float depth) {
  return clamp(depth / max(u_depthValue, 0.001), 0.0, 1.0);
}

/**
 * 综合计算水体颜色与透明度。
 * st      归一化平面坐标
 * depth   水深（米）
 * viewDir 指向相机的方向（眼空间）
 * sunDir  指向太阳的方向（眼空间）
 * flow    该像素处的单位流向（切空间的 east, north 分量，自动判定）
 */
vec4 rwShade(vec2 st, float depth, vec3 viewDir, vec3 geoNormal, vec3 sunDir, vec3 tangent, vec3 binormal, float time, vec2 flow) {
  // 物理尺度坐标（公里），保证波纹/白浪疏密与河段真实尺寸无关
  vec2 p = st * u_uvScale;
  vec2 flowDir = rwFlowDir(flow);

  // 扭曲度：用噪声梯度轻微扰动采样坐标
  vec2 distort = rwNoiseDxy(p * 0.55).xy * u_distortion * 5.0;
  vec2 q = p + distort;

  float flowSpeed = u_flowSpeed * 0.004;
  vec2 flowOffset = flowDir * time * flowSpeed;

  float dn = rwDepthRatio(depth);
  float shore = 1.0 - dn;

  // 白浪：沿流向推进的分形噪声，浅水区更明显
  vec2 foamFlow = flowDir * time * (u_foamSpeed * 0.003);
  float foamNoise = rwFbm(q * max(u_foamScale, 0.05) * 0.22, foamFlow * 0.6);
  float foamThreshold = clamp(u_foamIntensity / 30.0, 0.0, 0.95);
  float foam = smoothstep(1.0 - foamThreshold, 1.0, foamNoise);
  foam *= mix(0.3, 1.0, shore);

  // 立体波纹：分形噪声导数构造切空间法线，再叠加到几何法线上
  vec2 waveUv = q * (u_waveDensity * 0.002) + flowOffset * 0.4;
  vec3 dxy = rwFbmDxy(waveUv, flowOffset * 0.25, 0.72, -0.35);
  float amp = u_waveAmplitude * (0.3 + u_waveHeight * 2.0);
  float smoothF = clamp(u_waveSmooth * 0.001, 0.05, 1.0);
  vec3 localNormal = normalize(vec3(dxy.x * amp, smoothF, dxy.y * amp));
  vec3 waveNormal = normalize(tangent * localNormal.x + binormal * localNormal.y + geoNormal * localNormal.z);

  // 深浅水颜色与透明度
  vec3 waterBase = mix(u_shallowColor.rgb, u_deepColor.rgb, dn) * u_baseColor.rgb;
  float waterAlpha = mix(u_shallowAlpha, u_deepAlpha, dn) * u_baseAlpha;

  // 菲涅尔反射：掠射角反射增强
  float ndv = clamp(dot(geoNormal, viewDir), 0.0, 1.0);
  float fresnel = pow(1.0 - ndv, max(u_fresnelPower, 0.01));
  float reflectAmount = clamp(fresnel * u_reflectIntensity * u_reflectMix, 0.0, 1.0);
  vec3 color = mix(waterBase, u_fresnelColor.rgb, reflectAmount);

  // 波纹明暗，让流动有可见的体积感
  float waveLight = 0.88 + 0.12 * max(dot(waveNormal, sunDir), 0.0);
  color *= waveLight;

  // 太阳高光
  vec3 halfDir = normalize(sunDir + viewDir);
  float shininess = max(u_specular, 1.0) * 8.0;
  float spec = pow(max(dot(waveNormal, halfDir), 0.0), shininess) * u_reflectIntensity;
  color += spec * u_specularColor.rgb;

  // 白浪混合
  float foamBlend = clamp(foam * u_foamMix, 0.0, 1.0);
  color = mix(color, vec3(0.94, 0.97, 1.0), foamBlend);

  float alpha = clamp(waterAlpha + reflectAmount * 0.18 + spec * 0.5 + foamBlend * 0.6, 0.0, 1.0);
  return vec4(color, alpha);
}
`

const DEFAULT_UNIFORM_UV_SCALE = new Cartesian2(1, 1)

function colorUniform(value: string): Color {
  return Color.fromCssColorString(value)
}

export function createRiverWaterMaterial(params: RiverWaterParams): Material {
  return new Material({
    fabric: {
      type: 'RiverChannelWater',
      uniforms: {
        u_baseColor: colorUniform(params.baseColor),
        u_baseAlpha: params.baseAlpha,
        u_depthValue: params.depthValue,
        u_distortion: params.distortion,
        u_shallowColor: colorUniform(params.shallowColor),
        u_shallowAlpha: params.shallowAlpha,
        u_deepColor: colorUniform(params.deepColor),
        u_deepAlpha: params.deepAlpha,
        u_fresnelColor: colorUniform(params.fresnelColor),
        u_fresnelPower: params.fresnelPower,
        u_reflectIntensity: params.reflectIntensity,
        u_reflectMix: params.reflectMix,
        u_flowSpeed: params.flowSpeed,
        u_flowAngle: params.flowAngle,
        u_foamMix: params.foamMix,
        u_foamSpeed: params.foamSpeed,
        u_foamScale: params.foamScale,
        u_foamIntensity: params.foamIntensity,
        u_waveHeight: params.waveHeight,
        u_waveAmplitude: params.waveAmplitude,
        u_waveDensity: params.waveDensity,
        u_waveSmooth: params.waveSmooth,
        u_specular: params.specular,
        u_specularColor: colorUniform(params.specularColor),
        u_uvScale: Cartesian2.clone(DEFAULT_UNIFORM_UV_SCALE)
      },
      source: RIVER_WATER_MATERIAL_SOURCE
    }
  })
}

/** 把最新的 UI 参数写回材质 uniforms（无需重建几何体）。 */
export function updateRiverWaterMaterial(material: Material, params: RiverWaterParams): void {
  const uniforms = material.uniforms
  if (!uniforms) return
  Color.fromCssColorString(params.baseColor, uniforms.u_baseColor)
  Color.fromCssColorString(params.shallowColor, uniforms.u_shallowColor)
  Color.fromCssColorString(params.deepColor, uniforms.u_deepColor)
  Color.fromCssColorString(params.fresnelColor, uniforms.u_fresnelColor)
  Color.fromCssColorString(params.specularColor, uniforms.u_specularColor)

  uniforms.u_baseAlpha = params.baseAlpha
  uniforms.u_depthValue = params.depthValue
  uniforms.u_distortion = params.distortion
  uniforms.u_shallowAlpha = params.shallowAlpha
  uniforms.u_deepAlpha = params.deepAlpha
  uniforms.u_fresnelPower = params.fresnelPower
  uniforms.u_reflectIntensity = params.reflectIntensity
  uniforms.u_reflectMix = params.reflectMix
  uniforms.u_flowSpeed = params.flowSpeed
  uniforms.u_flowAngle = params.flowAngle
  uniforms.u_foamMix = params.foamMix
  uniforms.u_foamSpeed = params.foamSpeed
  uniforms.u_foamScale = params.foamScale
  uniforms.u_foamIntensity = params.foamIntensity
  uniforms.u_waveHeight = params.waveHeight
  uniforms.u_waveAmplitude = params.waveAmplitude
  uniforms.u_waveDensity = params.waveDensity
  uniforms.u_waveSmooth = params.waveSmooth
  uniforms.u_specular = params.specular
}

/** 设置用于把归一化 UV 换算成公里尺度的缩放，保证不同河段波纹疏密一致。 */
export function setRiverWaterUvScale(material: Material, widthMeters: number, heightMeters: number): void {
  const uniforms = material.uniforms
  if (!uniforms?.u_uvScale) return
  uniforms.u_uvScale.x = Math.max(widthMeters / 1000, 0.05)
  uniforms.u_uvScale.y = Math.max(heightMeters / 1000, 0.05)
}
