export const CLOUD_VERTEX = `
in vec3 position;
in vec2 st;
out vec3 vOrigin;
out vec3 vDirection;
out vec2 vst;

void main()
{
  vOrigin = czm_encodedCameraPositionMCHigh + czm_encodedCameraPositionMCLow;
  vDirection = position - vOrigin;
  vst = st;
  gl_Position = czm_modelViewProjection * vec4(position, 1.0);
}
`

const COMMON_HEADER = `
in vec3 vOrigin;
in vec3 vDirection;
uniform vec3 halfdim;

vec2 hitBox(vec3 orig, vec3 dir)
{
  vec3 invDir = 1.0 / dir;
  vec3 tMin = (-halfdim - orig) * invDir;
  vec3 tMax = (halfdim - orig) * invDir;
  vec3 t1 = min(tMin, tMax);
  vec3 t2 = max(tMin, tMax);
  float tNear = max(max(t1.x, t1.y), t1.z);
  float tFar = min(min(t2.x, t2.y), t2.z);
  return vec2(tNear, tFar);
}
`

export const CLOUD_FRAGMENT = `
${COMMON_HEADER}
uniform sampler3D volumeTexture;
uniform float uThreshold;
uniform float uOpacity;
uniform float uSteps;
uniform float uTime;
uniform float uAnimate;

float densityAt(vec3 p)
{
  vec3 uvw = (p + halfdim) / (2.0 * halfdim);
  if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) {
    return 0.0;
  }
  return texture(volumeTexture, uvw).r;
}

void main()
{
  vec3 ro = vOrigin;
  vec3 rd = normalize(vDirection);
  vec2 bounds = hitBox(ro, rd);
  float tNear = max(bounds.x, 0.0);
  float tFar = bounds.y;
  if (tFar <= tNear) {
    discard;
  }

  float steps = max(uSteps, 8.0);
  float stepLen = (tFar - tNear) / steps;
  vec3 p = ro + rd * tNear;
  vec4 acc = vec4(0.0);

  for (int i = 0; i < 256; i++) {
    if (float(i) >= steps) {
      break;
    }
    float d;
    if (uAnimate > 0.5) {
      vec3 uvw = (p + halfdim) / (2.0 * halfdim);
      d = texture(volumeTexture, fract(uvw + vec3(0.0, 0.0, uTime * 0.015))).r;
    } else {
      d = densityAt(p);
    }
    float shaped = smoothstep(uThreshold, min(uThreshold + 0.32, 1.0), d) * uOpacity * 0.13;
    if (shaped > 0.002) {
      float h = clamp((p.y + halfdim.y) / (2.0 * halfdim.y), 0.0, 1.0);
      float dens = smoothstep(uThreshold, min(uThreshold + 0.4, 1.0), d);
      vec3 col = mix(vec3(0.42, 0.54, 0.74), vec3(1.0, 0.96, 0.9), dens);
      col *= 0.72 + 0.4 * h;
      acc.rgb += (1.0 - acc.a) * shaped * col;
      acc.a += (1.0 - acc.a) * shaped;
      if (acc.a >= 0.985) {
        break;
      }
    }
    p += rd * stepLen;
  }

  if (acc.a < 0.008) {
    discard;
  }
  out_FragColor = acc;
}
`

export const ISO_FRAGMENT = `
${COMMON_HEADER}
uniform sampler3D volumeTexture;
uniform float uThreshold;
uniform float uSteps;

float densityAt(vec3 p)
{
  vec3 uvw = (p + halfdim) / (2.0 * halfdim);
  if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) {
    return 0.0;
  }
  return texture(volumeTexture, uvw).r;
}

vec3 normalAt(vec3 p)
{
  float e = 0.018;
  return normalize(vec3(
    densityAt(p + vec3(e, 0.0, 0.0)) - densityAt(p - vec3(e, 0.0, 0.0)),
    densityAt(p + vec3(0.0, e, 0.0)) - densityAt(p - vec3(0.0, e, 0.0)),
    densityAt(p + vec3(0.0, 0.0, e)) - densityAt(p - vec3(0.0, 0.0, e))
  ));
}

void main()
{
  vec3 ro = vOrigin;
  vec3 rd = normalize(vDirection);
  vec2 bounds = hitBox(ro, rd);
  float tNear = max(bounds.x, 0.0);
  float tFar = bounds.y;
  if (tFar <= tNear) {
    discard;
  }

  float steps = max(uSteps, 16.0);
  float stepLen = (tFar - tNear) / steps;
  vec3 p = ro + rd * tNear;
  bool hit = false;

  for (int i = 0; i < 256; i++) {
    if (float(i) >= steps) {
      break;
    }
    if (densityAt(p) > uThreshold) {
      hit = true;
      break;
    }
    p += rd * stepLen;
  }

  if (!hit) {
    discard;
  }

  float d = densityAt(p);
  vec3 n = normalAt(p);
  vec3 lightDir = normalize(vec3(0.5, 0.8, 0.35));
  float diff = max(dot(n, lightDir), 0.0);
  float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.2);
  vec3 base = mix(vec3(0.08, 0.5, 0.95), vec3(0.98, 0.56, 0.2), smoothstep(uThreshold, 0.92, d));
  vec3 col = base * (0.34 + 0.86 * diff) + vec3(0.3, 0.7, 1.0) * rim * 0.75;
  out_FragColor = vec4(col, 1.0);
}
`

export const TERRAIN_FRAGMENT = `
${COMMON_HEADER}
uniform float uTime;
uniform float uHeight;
uniform float uSea;
uniform float uFog;

float hash21(vec2 p)
{
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p)
{
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p)
{
  float value = 0.0;
  float amplitude = 0.5;
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    value += amplitude * valueNoise(p);
    total += amplitude;
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    amplitude *= 0.5;
  }
  return value / total;
}

float terrain(vec2 p)
{
  float n = fbm(p * 3.2 + vec2(11.7, 5.3));
  n = n * n * 1.7;
  return (n - 0.33) * uHeight;
}

vec3 terrainNormal(vec2 p)
{
  const float e = 0.0025;
  float hl = terrain(p - vec2(e, 0.0));
  float hr = terrain(p + vec2(e, 0.0));
  float hd = terrain(p - vec2(0.0, e));
  float hu = terrain(p + vec2(0.0, e));
  return normalize(vec3((hl - hr) * 2.6, 2.0 * e, (hd - hu) * 2.6));
}

vec3 skyColor(vec3 rd)
{
  float y = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(vec3(0.78, 0.88, 0.98), vec3(0.14, 0.4, 0.78), pow(y, 1.15));
  float sun = pow(max(dot(rd, normalize(vec3(0.55, 0.45, -0.4))), 0.0), 72.0);
  return col + vec3(1.0, 0.86, 0.58) * sun;
}

void main()
{
  vec3 ro = vOrigin;
  vec3 rd = normalize(vDirection);
  vec2 bounds = hitBox(ro, rd);
  float tNear = max(bounds.x, 0.0);
  float tFar = bounds.y;
  if (tFar <= tNear) {
    discard;
  }

  float steps = 48.0;
  float dt = (tFar - tNear) / steps;
  float t = tNear;
  bool hitTerrain = false;
  float terrainT = tFar;
  vec3 terrainPos = vec3(0.0);

  for (int i = 0; i < 48; i++) {
    vec3 p = ro + rd * t;
    if (p.y < terrain(p.xz)) {
      hitTerrain = true;
      float tPrev = t - dt;
      for (int j = 0; j < 4; j++) {
        float tm = 0.5 * (tPrev + t);
        vec3 pm = ro + rd * tm;
        if (pm.y < terrain(pm.xz)) {
          t = tm;
        } else {
          tPrev = tm;
        }
      }
      terrainT = t;
      terrainPos = ro + rd * t;
      break;
    }
    t += dt;
  }

  float waterT = 1.0e20;
  if (abs(rd.y) > 1.0e-5) {
    float candidate = (uSea - ro.y) / rd.y;
    if (candidate > tNear && candidate < tFar) {
      waterT = candidate;
    }
  }

  if (waterT < terrainT) {
    hitTerrain = false;
  }

  if (hitTerrain) {
    vec3 n = terrainNormal(terrainPos.xz);
    vec3 lightDir = normalize(vec3(0.55, 0.62, 0.35));
    float diff = clamp(dot(n, lightDir), 0.0, 1.0);
    float height = terrainPos.y - uSea;
    vec3 col = mix(vec3(0.26, 0.46, 0.22), vec3(0.52, 0.41, 0.27), smoothstep(0.08, 0.42, height));
    col = mix(col, vec3(0.86, 0.9, 0.94), smoothstep(0.5, 0.82, height));
    col *= 0.5 + 0.75 * diff;
    float fog = 1.0 - exp(-uFog * (terrainT - tNear));
    col = mix(col, vec3(0.78, 0.88, 0.97), fog * 0.55);
    out_FragColor = vec4(col, 1.0);
    return;
  }

  if (waterT < 1.0e19) {
    vec3 p = ro + rd * waterT;
    float ripple = sin(p.x * 92.0 + uTime * 1.6) * 0.5 + sin(p.z * 73.0 - uTime * 1.15) * 0.5;
    vec3 n = normalize(vec3(ripple * 0.06, 1.0, ripple * 0.045));
    vec3 lightDir = normalize(vec3(0.55, 0.62, 0.35));
    float spec = pow(max(dot(reflect(-lightDir, n), -rd), 0.0), 56.0);
    vec3 col = mix(vec3(0.035, 0.16, 0.3), vec3(0.1, 0.36, 0.54), 0.5 + ripple * 0.28);
    col += vec3(1.0, 0.9, 0.68) * spec * 0.85;
    float fog = 1.0 - exp(-uFog * (waterT - tNear));
    col = mix(col, vec3(0.78, 0.88, 0.97), fog * 0.4);
    out_FragColor = vec4(col, 1.0);
    return;
  }

  out_FragColor = vec4(skyColor(rd), 1.0);
}
`
