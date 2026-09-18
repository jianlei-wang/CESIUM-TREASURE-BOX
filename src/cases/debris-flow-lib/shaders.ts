// 泥石流地形侵蚀 —— GLSL 源码库与几何构建（对应设计文档 §4 / §5 / §6 / 附录 A）
//
// 所有计算 Pass 使用 Cesium `Context.createViewportQuadCommand` 装配的全屏三角形/四边形，
// fragment 源码由 ShaderProgram 自动注入 #version 300 es 与 precision。
// 片元通过 gl_FragCoord.xy 直接取得格点整数坐标与纹理 texelFetch，避免 varying 依赖。

import {
  ComponentDatatype,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  PrimitiveType
} from 'cesium'

export const COMMON = `
uniform vec2 u_res;
uniform float u_dx;
uniform float u_dy;
uniform float u_dt;
uniform float u_g;
uniform float u_minH;
uniform sampler2D u_flux;
uniform sampler2D u_terrain;

vec4 fetch(sampler2D t, ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(u_res) - 1);
  return texelFetch(t, p, 0);
}

float safeDiv(float a, float b) {
  return abs(b) > 1e-6 ? a / b : 0.0;
}

float mixtureDensity(float C, float rhoW, float rhoS) {
  return rhoW + (rhoS - rhoW) * C;
}

float hbpShearStress(float speed, float h, float tauY, float K, float n, float m) {
  float gammaDot = safeDiv(speed, h);
  return tauY * (1.0 - exp(-m * gammaDot)) + K * pow(max(gammaDot, 0.0), n);
}

// 静水重构（Well-Balanced）+ Rusanov 界面通量，返回 (h 通量, 法向动量通量, 切向动量通量)
vec3 interfaceFlux(vec4 L, float zbL, vec4 R, float zbR, bool yAxis) {
  float zbMax = max(zbL, zbR);
  float hsL = max(L.r + zbL - zbMax, 0.0);
  float hsR = max(R.r + zbR - zbMax, 0.0);
  float uL = L.r > u_minH ? L.g / L.r : 0.0;
  float vL = L.r > u_minH ? L.b / L.r : 0.0;
  float uR = R.r > u_minH ? R.g / R.r : 0.0;
  float vR = R.r > u_minH ? R.b / R.r : 0.0;
  float unL = yAxis ? vL : uL;
  float unR = yAxis ? vR : uR;
  float utL = yAxis ? uL : vL;
  float utR = yAxis ? uR : vR;
  float hunL = hsL * unL;
  float hunR = hsR * unR;
  float pL = 0.5 * u_g * hsL * hsL;
  float pR = 0.5 * u_g * hsR * hsR;
  float cL = sqrt(u_g * hsL);
  float cR = sqrt(u_g * hsR);
  float smax = max(max(abs(unL) + cL, abs(unR) + cR), 1e-6);
  float fh = 0.5 * (hunL + hunR) - 0.5 * smax * (hsR - hsL);
  float fn = 0.5 * ((hunL * unL + pL) + (hunR * unR + pR)) - 0.5 * smax * (hunR - hunL);
  float ft = 0.5 * (hunL * utL + hunR * utR) - 0.5 * smax * (hsR * utR - hsL * utL);
  return vec3(fh, fn, ft);
}

vec3 sweRhs(sampler2D fluxTex, sampler2D terrainTex, ivec2 c, vec4 U) {
  vec4 L = fetch(fluxTex, c - ivec2(1, 0));
  vec4 R = fetch(fluxTex, c + ivec2(1, 0));
  vec4 RR = fetch(fluxTex, c + ivec2(2, 0));
  vec4 D = fetch(fluxTex, c - ivec2(0, 1));
  vec4 Up = fetch(fluxTex, c + ivec2(0, 1));
  vec4 UU = fetch(fluxTex, c + ivec2(0, 2));
  float zL = fetch(terrainTex, c - ivec2(1, 0)).r;
  float z0 = fetch(terrainTex, c).r;
  float zR = fetch(terrainTex, c + ivec2(1, 0)).r;
  float zRR = fetch(terrainTex, c + ivec2(2, 0)).r;
  float zD = fetch(terrainTex, c - ivec2(0, 1)).r;
  float zU = fetch(terrainTex, c + ivec2(0, 1)).r;
  float zUU = fetch(terrainTex, c + ivec2(0, 2)).r;
  vec3 Fp = interfaceFlux(U, z0, R, zR, false);
  vec3 Fm = interfaceFlux(L, zL, U, z0, false);
  vec3 dF = (Fp - Fm) / u_dx;
  vec3 Gp = interfaceFlux(U, z0, Up, zU, true);
  vec3 Gm = interfaceFlux(D, zD, U, z0, true);
  vec3 dG = (Gp - Gm) / u_dy;
  vec3 rhs;
  rhs.x = dF.x + dG.x;
  rhs.y = dF.y + dG.z;
  rhs.z = dF.z + dG.y;
  return rhs;
}
`

export const PREDICTOR_FS = `${COMMON}
layout(location = 0) out vec4 outFlux;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 U = fetch(u_flux, c);
  vec3 rhs = sweRhs(u_flux, u_terrain, c, U);
  vec3 Un = U.xyz - u_dt * rhs;
  if (Un.x < u_minH || !(Un.x == Un.x)) { Un = vec3(0.0); }
  outFlux = vec4(Un, U.a);
}
`

export const CORRECTOR_FS = `${COMMON}
uniform sampler2D u_pred;
uniform float u_tauY;
uniform float u_K;
uniform float u_nHB;
uniform float u_mP;
uniform float u_rhoW;
uniform float u_rhoS;
layout(location = 0) out vec4 outFlux;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 Un = fetch(u_flux, c);
  vec4 Us = fetch(u_pred, c);
  vec3 rhs = sweRhs(u_pred, u_terrain, c, Us);
  vec3 Uss = Us.xyz - u_dt * rhs;
  if (Uss.x < u_minH || !(Uss.x == Uss.x)) { Uss = vec3(0.0); }

  float h = Uss.x;
  if (h > u_minH) {
    float u = Uss.y / h;
    float v = Uss.z / h;
    float speed = length(vec2(u, v));
    if (speed > 1e-4) {
      float tauB = hbpShearStress(speed, h, u_tauY, u_K, u_nHB, u_mP);
      float rhoMix = mixtureDensity(Un.a, u_rhoW, u_rhoS);
      float decel = tauB / (rhoMix * h);
      float factor = max(0.0, 1.0 - decel * u_dt / speed);
      Uss.y *= factor;
      Uss.z *= factor;
    }
  }
  vec3 Unew = 0.5 * (Un.xyz + Uss);
  if (Unew.x < u_minH || !(Unew.x == Unew.x)) { Unew = vec3(0.0); }
  outFlux = vec4(Unew, Un.a);
}
`

export const ADVECT_C_FS = `${COMMON}
uniform float u_maxC;
layout(location = 0) out vec4 outFlux;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 F = fetch(u_flux, c);
  float h = F.r;
  float u = h > u_minH ? F.g / h : 0.0;
  float v = h > u_minH ? F.b / h : 0.0;
  vec2 disp = vec2(u * u_dt / u_dx, v * u_dt / u_dy);
  vec2 uvNow = (vec2(c) + 0.5) / u_res;
  vec2 uvBack = clamp(uvNow - disp / u_res, vec2(0.0), vec2(1.0));
  vec2 uvFwd = clamp(uvNow + disp / u_res, vec2(0.0), vec2(1.0));
  float cNow = texture(u_flux, uvNow).a;
  float cBack = texture(u_flux, uvBack).a;
  float cFwd = texture(u_flux, uvFwd).a;
  float cNew = cBack + 0.5 * (cNow - cFwd);
  if (h < u_minH) cNew = 0.0;
  outFlux = vec4(F.r, F.g, F.b, clamp(cNew, 0.0, u_maxC));
}
`

export const ADVECT_SED_FS = `${COMMON}
uniform sampler2D u_sed;
uniform float u_maxC;
layout(location = 0) out vec4 outSed;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 F = fetch(u_flux, c);
  vec4 S = fetch(u_sed, c);
  float h = F.r;
  float u = h > u_minH ? F.g / h : 0.0;
  float v = h > u_minH ? F.b / h : 0.0;
  vec2 disp = vec2(u * u_dt / u_dx, v * u_dt / u_dy);
  vec2 uvNow = (vec2(c) + 0.5) / u_res;
  vec2 uvBack = clamp(uvNow - disp / u_res, vec2(0.0), vec2(1.0));
  vec2 uvFwd = clamp(uvNow + disp / u_res, vec2(0.0), vec2(1.0));
  vec2 bNow = texture(u_sed, uvNow).rg;
  vec2 bBack = texture(u_sed, uvBack).rg;
  vec2 bFwd = texture(u_sed, uvFwd).rg;
  vec2 bNew = bBack + 0.5 * (bNow - bFwd);
  if (h < u_minH) bNew = vec2(0.0);
  outSed = vec4(clamp(bNew, vec2(0.0), vec2(u_maxC)), S.b, S.a);
}
`

export const EROSION_FS = `${COMMON}
uniform sampler2D u_sed;
uniform float u_Er;
uniform float u_Dr;
uniform float u_tauC;
uniform float u_tauY;
uniform float u_K;
uniform float u_nHB;
uniform float u_mP;
uniform float u_rhoW;
uniform float u_rhoS;
uniform float u_maxC;
layout(location = 0) out vec4 outTerrain;
layout(location = 1) out vec4 outSed;
layout(location = 2) out vec4 outFlux;

// 返回 (dz>0 侵蚀, dz<0 淤积, dC 总浓度增量, dCb 推移质增量)
vec4 computeErosion(vec4 F, vec4 T, vec4 S) {
  float h = F.r;
  float C = F.a;
  float Cb = S.r;
  float dz = 0.0;
  float dC = 0.0;
  float dCb = 0.0;
  if (h > u_minH && T.a < 0.5) {
    float u = F.g / h;
    float v = F.b / h;
    float speed = length(vec2(u, v));
    float tauB = hbpShearStress(speed, h, u_tauY, u_K, u_nHB, u_mP);
    if (tauB > u_tauC) {
      float dzE = u_Er * (tauB - u_tauC) * u_dt / u_rhoS;
      dzE = min(dzE, min(0.3 * h, 0.5));
      dz = dzE;
      dC = dzE / max(h, 0.01);
      dCb = dC * 0.7;
    } else if (Cb > 0.001) {
      float dzD = u_Dr * Cb * (u_tauC - tauB) * u_dt / u_rhoS;
      dzD = min(dzD, min(Cb * h, 0.3));
      dz = -dzD;
      dC = -dzD / max(h, 0.01);
      dCb = dC * 0.7;
    }
  }
  return vec4(dz, dC, dCb, 0.0);
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 F = fetch(u_flux, c);
  vec4 T = fetch(u_terrain, c);
  vec4 S = fetch(u_sed, c);
  vec4 e = computeErosion(F, T, S);
  float dz = e.x;

  float zbNew = max(T.r - dz, T.g - 50.0);
  outTerrain = vec4(zbNew, T.g, T.b, T.a);

  float cbNew = clamp(S.r + e.z, 0.0, u_maxC);
  float csNew = clamp(S.g + (e.y - e.z), 0.0, u_maxC);
  float erosionAcc = S.b + max(dz, 0.0);
  float depositAcc = S.a + max(-dz, 0.0);
  outSed = vec4(cbNew, csNew, erosionAcc, depositAcc);

  float cNew = clamp(F.a + e.y, 0.0, u_maxC);
  outFlux = vec4(F.r, F.g, F.b, cNew);
}
`

export const SOURCE_FS = `${COMMON}
uniform sampler2D u_src;
uniform float u_rainfall;
uniform float u_maxC;
layout(location = 0) out vec4 outFlux;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 F = fetch(u_flux, c);
  vec4 S = fetch(u_src, c);
  float h = max(F.r + (S.r + u_rainfall) * u_dt, 0.0);
  float C = clamp(F.a + S.g * u_dt / max(h, 0.01), 0.0, u_maxC);
  bool edge = c.x == 0 || c.y == 0 || c.x == int(u_res.x) - 1 || c.y == int(u_res.y) - 1;
  if (edge) {
    ivec2 inner = clamp(c, ivec2(1), ivec2(u_res) - 2);
    vec4 Fi = fetch(u_flux, inner);
    vec4 Si = fetch(u_src, inner);
    h = max(Fi.r + (Si.r + u_rainfall) * u_dt, 0.0);
    C = clamp(Fi.a + Si.g * u_dt / max(h, 0.01), 0.0, u_maxC);
  }
  outFlux = vec4(h, F.g, F.b, C);
}
`

export const SLOPE_FS = `${COMMON}
layout(location = 0) out vec4 outTerrain;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 T = fetch(u_terrain, c);
  float zc = T.r;
  float zx = fetch(u_terrain, c + ivec2(1, 0)).r;
  float zy = fetch(u_terrain, c + ivec2(0, 1)).r;
  float dzdx = (zx - zc) / u_dx;
  float dzdy = (zy - zc) / u_dy;
  outTerrain = vec4(zc, T.g, atan(sqrt(dzdx * dzdx + dzdy * dzdy)), T.a);
}
`

export const BRUSH_FS = `
uniform sampler2D u_src;
uniform vec2 u_center;
uniform float u_radius;
uniform float u_strength;
uniform int u_channel;
layout(location = 0) out vec4 outColor;
void main() {
  vec2 p = gl_FragCoord.xy;
  float d = distance(p, u_center);
  float sigma = max(u_radius, 1.0) * 0.5;
  float falloff = exp(-(d * d) / (2.0 * sigma * sigma));
  vec4 s = texelFetch(u_src, ivec2(p), 0);
  float v = u_strength * falloff;
  if (u_channel == 0) s.r += v;
  else if (u_channel == 1) s.g += v;
  outColor = s;
}
`

export const SOURCE_DECAY_FS = `
uniform sampler2D u_src;
uniform float u_decay;
layout(location = 0) out vec4 outColor;
void main() {
  vec4 s = texelFetch(u_src, ivec2(gl_FragCoord.xy), 0);
  outColor = s * u_decay;
}
`

export const OBSTACLE_FS = `
uniform sampler2D u_terrain;
uniform vec2 u_center;
uniform float u_radius;
uniform float u_value;
layout(location = 0) out vec4 outColor;
void main() {
  vec2 p = gl_FragCoord.xy;
  float d = distance(p, u_center);
  float f = 1.0 - smoothstep(u_radius * 0.5, u_radius, d);
  vec4 t = texelFetch(u_terrain, ivec2(p), 0);
  t.a = mix(t.a, u_value, f);
  outColor = t;
}
`

export const CLEAR_FS = `
layout(location = 0) out vec4 outColor;
void main() {
  outColor = vec4(0.0);
}
`

export const OBSTACLE_CLEAR_FS = `
uniform sampler2D u_terrain;
layout(location = 0) out vec4 outColor;
void main() {
  vec4 t = texelFetch(u_terrain, ivec2(gl_FragCoord.xy), 0);
  outColor = vec4(t.rgb, 0.0);
}
`

export const REDUCE_FS = `${COMMON}
uniform sampler2D u_sed;
uniform float u_block;
layout(location = 0) out vec4 outColor;
void main() {
  ivec2 outPix = ivec2(gl_FragCoord.xy);
  int b = int(u_block);
  float maxH = 0.0;
  float maxS = 0.0;
  float ero = 0.0;
  float dep = 0.0;
  for (int j = 0; j < b; j++) {
    for (int i = 0; i < b; i++) {
      ivec2 p = outPix * b + ivec2(i, j);
      vec4 f = fetch(u_flux, p);
      vec4 s = fetch(u_sed, p);
      maxH = max(maxH, f.r);
      float sp = f.r > u_minH ? length(f.gb / f.r) : 0.0;
      maxS = max(maxS, sp);
      ero += s.b;
      dep += s.a;
    }
  }
  outColor = vec4(maxH, maxS, ero, dep);
}
`

export const SAMPLE_FLOW_FS = `${COMMON}
uniform float u_block;
layout(location = 0) out vec4 outColor;
void main() {
  ivec2 outPix = ivec2(gl_FragCoord.xy);
  ivec2 p = outPix * int(u_block);
  vec4 f = fetch(u_flux, p);
  float sp = f.r > u_minH ? length(f.gb / f.r) : 0.0;
  float u = f.r > u_minH ? f.g / f.r : 0.0;
  float v = f.r > u_minH ? f.b / f.r : 0.0;
  outColor = vec4(u, v, f.r, sp);
}
`

export const HISTORY_FS = `${COMMON}
uniform sampler2D u_sed;
uniform float u_block;
layout(location = 0) out vec4 outTerrain;
layout(location = 1) out vec4 outFlux;
layout(location = 2) out vec4 outSed;
void main() {
  ivec2 outPix = ivec2(gl_FragCoord.xy);
  ivec2 p = outPix * int(u_block);
  outTerrain = fetch(u_terrain, p);
  outFlux = fetch(u_flux, p);
  outSed = fetch(u_sed, p);
}
`

export const OVERLAY_VS = `
in vec3 position;
in vec2 st;
uniform sampler2D u_terrain;
uniform float u_erosionScale;
out vec2 v_st;
out vec3 v_world;
out float v_erosion;
void main() {
  vec4 t = texture(u_terrain, st);
  float base = t.g;
  float cur = t.r;
  float z = base + (cur - base) * u_erosionScale + 1.6;
  vec3 local = vec3(position.xy, z);
  v_st = st;
  v_erosion = cur - base;
  v_world = (czm_model * vec4(local, 1.0)).xyz;
  gl_Position = czm_modelViewProjection * vec4(local, 1.0);
}
`

export const OVERLAY_FS = `
in vec2 v_st;
in vec3 v_world;
in float v_erosion;
uniform sampler2D u_flux;
uniform sampler2D u_sed;
uniform sampler2D u_terrain;
uniform int u_mode;
uniform float u_maxDepth;
uniform float u_maxSpeed;
uniform vec3 u_lightDir;
uniform float u_gridDim;
uniform vec2 u_ghostCenter;
uniform float u_ghostRadius;
uniform int u_ghostActive;
uniform float u_ghostOpacity;
uniform float u_erosionRef;

const float HMIN = 0.001;

vec3 heatmap(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 blue = vec3(0.05, 0.25, 0.85);
  vec3 green = vec3(0.1, 0.85, 0.3);
  vec3 red = vec3(0.95, 0.1, 0.05);
  return (t < 0.5) ? mix(blue, green, t * 2.0) : mix(green, red, (t - 0.5) * 2.0);
}

void main() {
  vec4 f = texture(u_flux, v_st);
  vec4 s = texture(u_sed, v_st);
  float h = f.r;
  float C = f.a;
  float u = h > HMIN ? f.g / h : 0.0;
  float v = h > HMIN ? f.b / h : 0.0;
  float speed = length(vec2(u, v));

  vec3 color = vec3(0.0);
  float alpha = 0.0;

  if (u_mode == 0) {
    if (h > HMIN) {
      vec3 waterColor = mix(vec3(0.15, 0.35, 0.6), vec3(0.45, 0.33, 0.18), clamp(C / 0.6, 0.0, 1.0));
      float grad = length(vec2(dFdx(h), dFdy(h))) * 60.0;
      float foam = smoothstep(0.4, 1.6, grad);
      color = mix(waterColor, vec3(0.98), foam * 0.6);
      alpha = clamp(h * 0.4 + C * 0.5, 0.0, 0.9);
    } else {
      float net = s.a - s.b;
      float ero = clamp(net / max(u_erosionRef, 1e-6), -1.0, 1.0);
      if (ero > 0.0) color = mix(vec3(1.0), vec3(0.0, 0.7, 0.25), ero);
      else color = mix(vec3(1.0), vec3(0.85, 0.05, 0.05), -ero);
      alpha = clamp(abs(ero) * 0.7, 0.0, 0.7);
    }
  } else if (u_mode == 1) {
    color = mix(vec3(0.9, 0.96, 1.0), vec3(0.0, 0.12, 0.55), clamp(h / max(u_maxDepth, 0.5), 0.0, 1.0));
    alpha = clamp(h / 0.5, 0.0, 0.82);
  } else if (u_mode == 2) {
    color = heatmap(clamp(speed / max(u_maxSpeed, 0.5), 0.0, 1.0));
    alpha = clamp(h / 0.3, 0.0, 0.75);
  } else {
    float net = s.a - s.b;
    float ero = clamp(net / max(u_erosionRef, 1e-6), -1.0, 1.0);
    if (ero > 0.0) color = mix(vec3(1.0), vec3(0.0, 0.7, 0.25), ero);
    else color = mix(vec3(1.0), vec3(0.85, 0.05, 0.05), -ero);
    alpha = clamp(abs(ero) * 0.8, 0.0, 0.8);
  }

  float obstacle = texture(u_terrain, v_st).a;
  if (obstacle > 0.5) {
    vec2 ocf = fract(v_st * u_gridDim);
    float oedge = min(min(ocf.x, 1.0 - ocf.x), min(ocf.y, 1.0 - ocf.y));
    float oband = 1.0 - smoothstep(0.0, 0.1, oedge);
    color = mix(color, vec3(0.95, 0.15, 0.85), 0.3 + 0.4 * oband);
    alpha = max(alpha, 0.55);
  }

  if (u_ghostActive == 1 && u_ghostRadius > 0.0) {
    vec2 grid = v_st * u_gridDim;
    float d = distance(grid, u_ghostCenter);
    if (d <= u_ghostRadius + 0.5) {
      vec2 cf = fract(grid);
      float edge = min(min(cf.x, 1.0 - cf.x), min(cf.y, 1.0 - cf.y));
      float band = 1.0 - smoothstep(0.0, 0.14, edge);
      float fill = 1.0 - smoothstep(u_ghostRadius - 1.0, u_ghostRadius + 0.5, d);
      float op = clamp(u_ghostOpacity, 0.0, 1.0);
      color = mix(color, vec3(0.25, 0.95, 1.0), (0.18 + 0.5 * band) * op);
      alpha = max(alpha, (0.1 + 0.45 * band) * fill * op);
    }
  }

  if (alpha < 0.004) discard;

  vec3 n = normalize(cross(dFdx(v_world), dFdy(v_world)));
  if (dot(n, normalize(v_world)) < 0.0) n = -n;
  float lambert = clamp(dot(n, normalize(u_lightDir)), 0.0, 1.0);
  color *= 0.62 + 0.38 * lambert;
  out_FragColor = vec4(color, alpha);
}
`

/** 构建贴地区域网格：局部 ENU 平面网格，position=(e,n,0)，st∈[0,1]²（j=0 对应南侧）。 */
export function buildGridMesh(segments: number, widthMeters: number, heightMeters: number): Geometry {
  const seg = Math.max(2, Math.floor(segments))
  const count = (seg + 1) * (seg + 1)
  const positions = new Float32Array(count * 3)
  const st = new Float32Array(count * 2)
  let k = 0
  let m = 0
  for (let j = 0; j <= seg; j += 1) {
    const v = j / seg
    const n = (v - 0.5) * heightMeters
    for (let i = 0; i <= seg; i += 1) {
      const u = i / seg
      const e = (u - 0.5) * widthMeters
      positions[k] = e
      positions[k + 1] = n
      positions[k + 2] = 0
      k += 3
      st[m] = u
      st[m + 1] = v
      m += 2
    }
  }
  const indices = new Uint32Array(seg * seg * 6)
  let idx = 0
  for (let j = 0; j < seg; j += 1) {
    for (let i = 0; i < seg; i += 1) {
      const a = j * (seg + 1) + i
      const b = a + 1
      const c = a + (seg + 1)
      const d = c + 1
      indices[idx] = a
      indices[idx + 1] = c
      indices[idx + 2] = b
      indices[idx + 3] = b
      indices[idx + 4] = c
      indices[idx + 5] = d
      idx += 6
    }
  }
  const attributes = new GeometryAttributes()
  attributes.position = new GeometryAttribute({
    componentDatatype: ComponentDatatype.FLOAT,
    componentsPerAttribute: 3,
    values: positions
  })
  attributes.st = new GeometryAttribute({
    componentDatatype: ComponentDatatype.FLOAT,
    componentsPerAttribute: 2,
    values: st
  })
  return new Geometry({ attributes, indices, primitiveType: PrimitiveType.TRIANGLES })
}

/** 生成运行时箭头图标（用于 BillboardCollection 流速箭头层）。 */
export function createArrowImage(size = 64): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.clearRect(0, 0, size, size)
  ctx.translate(size / 2, size / 2)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(0, -size * 0.42)
  ctx.lineTo(size * 0.24, size * 0.05)
  ctx.lineTo(size * 0.08, size * 0.05)
  ctx.lineTo(size * 0.08, size * 0.42)
  ctx.lineTo(-size * 0.08, size * 0.42)
  ctx.lineTo(-size * 0.08, size * 0.05)
  ctx.lineTo(-size * 0.24, size * 0.05)
  ctx.closePath()
  ctx.fill()
  return canvas
}
