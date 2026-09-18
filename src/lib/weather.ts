export const RAIN_FRAGMENT = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform float time;
uniform float density;
uniform float speed;
uniform float wind;
uniform float len;
uniform float brightness;

// Derived from "Banished" by David Hoskins (2013).
// Source: https://www.shadertoy.com/view/XsX3DB
float hash(vec2 point, float seed) {
  return fract(sin(dot(point, vec2(127.1, 311.7)) + seed) * 43758.5453123);
}

float noiseTexture(vec2 point, float seed) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  return mix(
    mix(hash(cell, seed), hash(cell + vec2(1.0, 0.0), seed), local.x),
    mix(hash(cell + vec2(0.0, 1.0), seed), hash(cell + vec2(1.0), seed), local.x),
    local.y
  );
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec3 color = texture(colorTexture, uv).rgb;
  color *= brightness;

  float animatedTime = time * speed / 3.0;
  float rainScale = mix(130.0, 420.0, clamp(density / 2.5, 0.0, 1.0));
  float rainLength = mix(0.030, 0.008, len);
  float rainSlant = wind * 1.4;
  vec2 centeredUv = uv * 2.0 - 1.0;
  vec2 rainCoordinates = (
    centeredUv * vec2(0.5, rainLength) +
    vec2(animatedTime * 0.30 - uv.y * rainSlant, animatedTime * 0.30)
  );
  float rain = noiseTexture(rainCoordinates * rainScale, 17.0);
  rain *= noiseTexture(rainCoordinates * rainScale * 0.773, 83.0) * 1.55;
  rain = clamp(pow(abs(rain), 23.0) * 13.0, 0.0, uv.y * (0.08 + 0.12 * len));
  vec2 breakCoordinates = rainCoordinates * rainScale * vec2(0.32, 1.75);
  vec2 breakCell = floor(breakCoordinates);
  vec2 breakLocal = fract(breakCoordinates);
  float breakCenter = hash(breakCell, 151.0);
  float breakLength = mix(0.24, 0.68, hash(breakCell, 271.0));
  float breakMask = 1.0 - smoothstep(
    breakLength * 0.5,
    breakLength * 0.5 + 0.10,
    abs(breakLocal.y - breakCenter)
  );
  rain *= breakMask;
  float rainStrength = mix(0.55, 1.25, clamp(density / 2.5, 0.0, 1.0));

  color *= mix(vec3(1.0), vec3(0.83, 0.90, 1.0), rainStrength * 0.16);
  color += rain * rainStrength * vec3(0.70, 0.83, 1.0);
  out_FragColor = vec4(color, 1.0);
}
`

export const SNOW_FRAGMENT = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform float time;
uniform float density;
uniform float speed;
uniform float wind;
uniform float size;
uniform float brightness;

// Derived from "Just snow" by Andrew Baldwin (2013), CC BY-NC-SA 3.0.
// Source: https://www.shadertoy.com/view/ldsGDn
const int SNOW_LAYERS = 56;
const float DEPTH = 0.5;
const mat3 HASH_MATRIX = mat3(
  13.323122, 23.5112, 21.71123,
  21.1212, 28.7312, 11.9312,
  21.8112, 14.7212, 61.3934
);

void main() {
  vec2 uv = v_textureCoordinates;
  vec3 color = texture(colorTexture, uv).rgb;
  color *= brightness;

  float animatedTime = time * speed * 0.30;
  float activeLayers = clamp(20.0 + density * 20.0, 20.0, float(SNOW_LAYERS));
  float snowWidth = wind * 0.75;
  float flakeSize = clamp(size / 0.015, 0.45, 2.40);
  float dof = 5.0 * sin(animatedTime * 0.1);
  vec3 accumulatedSnow = vec3(0.0);

  for (int i = 0; i < SNOW_LAYERS; i++) {
    float layer = float(i);
    if (layer >= activeLayers) continue;

    vec2 q = uv * (1.0 + layer * DEPTH);
    q += vec2(
      q.y * (snowWidth * mod(layer * 7.238917, 1.0) - snowWidth * 0.5),
      animatedTime / (1.0 + layer * DEPTH * 0.03)
    );
    vec3 cell = vec3(floor(q), 31.189 + layer);
    vec3 hashedCell = floor(cell) * 0.00001 + fract(cell);
    vec3 random = fract((31415.9 + hashedCell) / fract(HASH_MATRIX * hashedCell));
    vec2 shape = abs(mod(q, 1.0) - 0.5 + 0.9 * random.xy - 0.45);
    shape += 0.01 * abs(2.0 * fract(10.0 * q.yx) - 1.0);

    float distanceToFlake = 0.6 * max(shape.x - shape.y, shape.x + shape.y) + max(shape.x, shape.y) - 0.01 * flakeSize;
    float edge = (0.005 + 0.05 * min(0.5 * abs(layer - 5.0 - dof), 1.0)) * (0.85 + flakeSize * 0.15);
    float flake = 1.0 - smoothstep(-edge, edge, distanceToFlake);
    accumulatedSnow += vec3(flake * random.x / (1.0 + 0.02 * layer * DEPTH));
  }

  color += vec3(0.90, 0.95, 1.0) * accumulatedSnow;

  out_FragColor = vec4(color, 1.0);
}
`

export const LIGHTNING_FRAGMENT = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform float time;
uniform float frequency;
uniform float intensity;
uniform float cloudCover;
uniform float brightness;

// Adapted from "fsdGWf" by the Shadertoy author. Source: https://www.shadertoy.com/view/fsdGWf
float rand(float value) {
  return fract(sin(value) * 75154.32912);
}

float noise1(float value) {
  float cell = floor(value);
  float local = value - cell;
  local = local * local * (3.0 - 2.0 * local);
  return mix(rand(cell), rand(cell + 1.0), local);
}

float perlin1(float value) {
  float result = 0.0;
  float scale = 1.0;
  float weight = 1.0;
  for (int i = 0; i < 6; i++) {
    scale *= 2.0;
    weight *= 0.5;
    result += weight * noise1(scale * value);
  }
  return result;
}

float rand3(vec3 value) {
  return fract(375.10297 * sin(dot(value, vec3(103.0139, 227.0595, 31.05914))));
}

float noise3(vec3 value) {
  vec3 cell = floor(value);
  vec3 local = fract(value);
  local = local * local * (3.0 - 2.0 * local);
  float c000 = rand3(cell + vec3(0.0, 0.0, 0.0));
  float c001 = rand3(cell + vec3(0.0, 0.0, 1.0));
  float c010 = rand3(cell + vec3(0.0, 1.0, 0.0));
  float c011 = rand3(cell + vec3(0.0, 1.0, 1.0));
  float c100 = rand3(cell + vec3(1.0, 0.0, 0.0));
  float c101 = rand3(cell + vec3(1.0, 0.0, 1.0));
  float c110 = rand3(cell + vec3(1.0, 1.0, 0.0));
  float c111 = rand3(cell + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(c000, c001, local.z), mix(c010, c011, local.z), local.y),
    mix(mix(c100, c101, local.z), mix(c110, c111, local.z), local.y),
    local.x
  );
}

float perlin3(vec3 value) {
  float result = 0.0;
  float scale = 1.0;
  float weight = 1.0;
  for (int i = 0; i < 5; i++) {
    scale *= 2.0;
    weight *= 0.5;
    result += weight * noise3(scale * value);
  }
  return result;
}

float strikeOffset(float y) {
  return 0.4 * (perlin1(2.0 * y) - 0.5);
}

float strikeLine(vec2 point, float width, bool thicker) {
  float distanceToStrike = abs(strikeOffset(point.y) - point.x);
  if (thicker) {
    distanceToStrike += 4.0 * abs(strikeOffset(point.y + 0.001) - strikeOffset(point.y));
  }
  return 1.0 - smoothstep(0.0, width, distanceToStrike);
}

float cloud(vec2 uv, float speed, float scale) {
  float cloudNoise = perlin3(vec3(uv * scale, time * speed * 2.0));
  return max(0.0, cloudNoise - (1.0 - cloudCover));
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec3 scene = texture(colorTexture, uv).rgb * brightness;
  vec2 centered = uv * 2.0 - 1.0;
  centered.x *= 1.0;

  float cycleLength = mix(0.42, 0.16, frequency);
  float cycle = time / cycleLength;
  float cycleIndex = floor(cycle);
  float cyclePhase = fract(cycle);
  float occurrence = step(1.0 - frequency, rand(cycleIndex));
  float duration = mix(0.22, 0.70, rand(cycleIndex + 4.0));
  float strikeActive = occurrence * step(cyclePhase, duration);
  float glareActive = occurrence * step(cyclePhase, 0.16);
  float strikePosition = (rand(cycleIndex + 10.0) - 0.5) * 1.3;
  vec2 lightningUv = centered;
  lightningUv.x -= strikePosition;
  lightningUv.y += cycleIndex * 2.0 + 0.52;

  float strike = strikeLine(lightningUv, 0.014, true);
  float glow = strikeLine(lightningUv, 0.075, false);
  float wideGlow = strikeLine(lightningUv, 0.80, false);
  float strikeHeight = mix(0.45, 0.86, rand(cycleIndex + 5.0));
  float heightMask = smoothstep(strikeHeight, strikeHeight + 0.08, centered.y + perlin1(1.2 * centered.x + 4.0 * strikeHeight) * 0.03);
  float lightning = strikeActive * (strike * 1.5 + glow * 0.48) * heightMask;
  lightning += strikeActive * wideGlow * 0.14;

  float cloudLight = cloud(uv, 0.20, 0.10) * 0.50;
  cloudLight += cloud(uv * vec2(0.5, 1.0), 0.06, 0.80) * 0.22;
  cloudLight += cloud(uv * vec2(0.1, 1.0), 0.08, 5.5) * 0.12;
  float glare = glareActive * (1.0 - smoothstep(0.0, 1.5, abs(centered.x - strikePosition))) * 0.65;

  vec3 stormTint = vec3(0.74, 0.82, 1.0);
  scene *= 1.0 - cloudLight * 0.18;
  scene += stormTint * (lightning + glare) * intensity;
  out_FragColor = vec4(scene, 1.0);
}
`

export const FOG_FRAGMENT = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;
uniform float u_earthRadiusOnCamera;
uniform float u_cameraHeight;
uniform float u_fogHeight;
uniform vec3 u_fogColor;
uniform float u_globalDensity;
uniform float brightness;

vec4 getWorldCoordinate(vec2 texCoords) {
  float depthOrLogDepth = czm_unpackDepth(texture(depthTexture, texCoords));
  vec4 eyeCoordinate = czm_windowToEyeCoordinates(gl_FragCoord.xy, depthOrLogDepth);
  eyeCoordinate /= eyeCoordinate.w;
  vec4 worldCoordinate = czm_inverseView * eyeCoordinate;
  return worldCoordinate / worldCoordinate.w;
}

float getRoughHeight(vec4 worldCoordinate) {
  return length(worldCoordinate.xyz) - u_earthRadiusOnCamera;
}

float projectVector(vec3 vectorA, vec3 vectorB) {
  float scale = dot(vectorA, vectorB) / dot(vectorB, vectorB);
  float direction = scale / max(abs(scale), 0.0001);
  return direction * length(scale * vectorB);
}

float linearHeightFog(vec3 positionToCamera, float cameraHeight, float pixelHeight, float fogMaxHeight) {
  float globalDensity = u_globalDensity / 10.0;
  vec3 up = -normalize(czm_viewerPositionWC);
  float viewHeight = projectVector(normalize(positionToCamera), up);

  float distanceStep = step(100.0, length(positionToCamera));
  vec3 nearCameraOffset = mix(positionToCamera, normalize(positionToCamera) * 100.0, distanceStep);
  positionToCamera -= nearCameraOffset;
  cameraHeight = mix(pixelHeight, cameraHeight - 100.0 * viewHeight, distanceStep);

  float upperHeight = mix(cameraHeight, fogMaxHeight, step(fogMaxHeight, cameraHeight));
  float lowerHeight = mix(pixelHeight, fogMaxHeight, step(fogMaxHeight, pixelHeight));
  float fog = (upperHeight - lowerHeight) - 0.5 * (pow(upperHeight, 2.0) - pow(lowerHeight, 2.0)) / fogMaxHeight;
  fog = globalDensity * fog / max(viewHeight, 0.0001);

  if (abs(viewHeight) <= 0.01 && cameraHeight < fogMaxHeight) {
    fog = globalDensity * (1.0 - cameraHeight / fogMaxHeight) * length(positionToCamera);
  }

  return clamp(fog / (fog + 1.0), 0.0, 1.0);
}

void main() {
  vec4 color = texture(colorTexture, v_textureCoordinates);
  float depth = czm_unpackDepth(texture(depthTexture, v_textureCoordinates));
  if (depth >= 1.0) {
    out_FragColor = vec4(color.rgb * brightness, color.a);
    return;
  }

  vec4 worldCoordinate = getWorldCoordinate(v_textureCoordinates);
  vec3 positionToCamera = worldCoordinate.xyz - czm_viewerPositionWC;
  float pixelHeight = getRoughHeight(worldCoordinate);
  float fog = linearHeightFog(positionToCamera, u_cameraHeight, pixelHeight, u_fogHeight);
  vec3 sceneColor = color.rgb * brightness;
  out_FragColor = vec4(mix(sceneColor, u_fogColor * brightness, fog), color.a);
}
`

export const INTEGRAL_HEIGHT_FOG_FRAGMENT = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;
uniform float u_earthRadiusOnCamera;
uniform float u_cameraHeight;
uniform float u_fogHeight;
uniform vec3 u_fogColor;
uniform float u_globalDensity;
uniform float u_heightFalloff;
uniform float u_fogStartDistance;
uniform float isLinearFog;
uniform float brightness;

vec4 getWorldCoordinate(vec2 texCoords) {
  float depthOrLogDepth = czm_unpackDepth(texture(depthTexture, texCoords));
  vec4 eyeCoordinate = czm_windowToEyeCoordinates(gl_FragCoord.xy, depthOrLogDepth);
  eyeCoordinate /= eyeCoordinate.w;
  vec4 worldCoordinate = czm_inverseView * eyeCoordinate;
  return worldCoordinate / worldCoordinate.w;
}

float getRoughHeight(vec4 worldCoordinate) {
  return length(worldCoordinate.xyz) - u_earthRadiusOnCamera;
}

float projectVector(vec3 vectorA, vec3 vectorB) {
  float scale = dot(vectorA, vectorB) / max(dot(vectorB, vectorB), 0.0001);
  return sign(scale) * length(scale * vectorB);
}

float getFogDistance(vec3 positionToCamera, float cameraHeight, float pixelHeight, float fogMaxHeight, out float startHeight, out float endHeight) {
  startHeight = 0.0;
  endHeight = 0.0;
  float totalDistance = length(positionToCamera);
  if (totalDistance <= u_fogStartDistance) return 0.0;

  float startRatio = clamp(u_fogStartDistance / totalDistance, 0.0, 1.0);
  float pathStartHeight = mix(cameraHeight, pixelHeight, startRatio);
  float heightDelta = pixelHeight - pathStartHeight;
  float effectiveDistance = totalDistance - u_fogStartDistance;
  bool startInside = pathStartHeight <= fogMaxHeight;
  bool endInside = pixelHeight <= fogMaxHeight;
  if (startInside && endInside) {
    startHeight = pathStartHeight;
    endHeight = pixelHeight;
    return effectiveDistance;
  }
  if (!startInside && !endInside || abs(heightDelta) <= 0.0001) return 0.0;

  float boundaryRatio = clamp((fogMaxHeight - pathStartHeight) / heightDelta, 0.0, 1.0);
  if (startInside) {
    startHeight = pathStartHeight;
    endHeight = fogMaxHeight;
    return effectiveDistance * boundaryRatio;
  }
  startHeight = fogMaxHeight;
  endHeight = pixelHeight;
  return effectiveDistance * (1.0 - boundaryRatio);
}

float linearHeightFog(vec3 positionToCamera, float cameraHeight, float pixelHeight, float fogMaxHeight) {
  float safeHeight = max(fogMaxHeight, 0.0001);
  float startHeight;
  float endHeight;
  float distance = getFogDistance(positionToCamera, cameraHeight, pixelHeight, safeHeight, startHeight, endHeight);
  if (distance <= 0.0) return 0.0;
  float averageDensity = max(0.0, 1.0 - 0.5 * (startHeight + endHeight) / safeHeight);
  float fog = (u_globalDensity / 10.0) * distance * averageDensity;
  return clamp(fog / (fog + 1.0), 0.0, 1.0);
}

float exponentialHeightFog(vec3 positionToCamera, float cameraHeight, float pixelHeight, float fogMaxHeight) {
  float safeFalloff = max(u_heightFalloff, 0.0001);
  float startHeight;
  float endHeight;
  float distance = getFogDistance(positionToCamera, cameraHeight, pixelHeight, fogMaxHeight, startHeight, endHeight);
  if (distance <= 0.0) return 0.0;
  float heightDelta = endHeight - startHeight;
  float integral = abs(heightDelta) <= 0.001
    ? exp(-safeFalloff * startHeight) * distance
    : distance * (exp(-safeFalloff * startHeight) - exp(-safeFalloff * endHeight)) / (safeFalloff * heightDelta);
  float fog = (u_globalDensity / 10.0) * integral;
  return clamp(fog / (fog + 1.0), 0.0, 1.0);
}

void main() {
  vec4 color = texture(colorTexture, v_textureCoordinates);
  float depth = czm_unpackDepth(texture(depthTexture, v_textureCoordinates));
  if (depth >= 1.0) {
    out_FragColor = vec4(color.rgb * brightness, color.a);
    return;
  }
  vec4 worldCoordinate = getWorldCoordinate(v_textureCoordinates);
  vec3 positionToCamera = worldCoordinate.xyz - czm_viewerPositionWC;
  float pixelHeight = getRoughHeight(worldCoordinate);
  float fog = isLinearFog > 0.5
    ? linearHeightFog(positionToCamera, u_cameraHeight, pixelHeight, u_fogHeight)
    : exponentialHeightFog(positionToCamera, u_cameraHeight, pixelHeight, u_fogHeight);
  vec3 sceneColor = color.rgb * brightness;
  out_FragColor = vec4(mix(sceneColor, u_fogColor * brightness, fog), color.a);
}
`

export const SANDSTORM_FRAGMENT: string = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform float time;
uniform float density;
uniform float haze;
uniform float wind;
uniform float speed;
uniform float tint;
uniform float darken;

float hash(vec2 point, float seed) {
  return fract(sin(dot(point, vec2(127.1, 311.7)) + seed) * 43758.5453123);
}

float noiseTexture(vec2 point, float seed) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  return mix(
    mix(hash(cell, seed), hash(cell + vec2(1.0, 0.0), seed), local.x),
    mix(hash(cell + vec2(0.0, 1.0), seed), hash(cell + vec2(1.0), seed), local.x),
    local.y
  );
}

float rand3(vec3 value) {
  return fract(375.10297 * sin(dot(value, vec3(103.0139, 227.0595, 31.05914))));
}

float noise3(vec3 value) {
  vec3 cell = floor(value);
  vec3 local = fract(value);
  local = local * local * (3.0 - 2.0 * local);
  float c000 = rand3(cell + vec3(0.0, 0.0, 0.0));
  float c001 = rand3(cell + vec3(0.0, 0.0, 1.0));
  float c010 = rand3(cell + vec3(0.0, 1.0, 0.0));
  float c011 = rand3(cell + vec3(0.0, 1.0, 1.0));
  float c100 = rand3(cell + vec3(1.0, 0.0, 0.0));
  float c101 = rand3(cell + vec3(1.0, 0.0, 1.0));
  float c110 = rand3(cell + vec3(1.0, 1.0, 0.0));
  float c111 = rand3(cell + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(c000, c001, local.z), mix(c010, c011, local.z), local.y),
    mix(mix(c100, c101, local.z), mix(c110, c111, local.z), local.y),
    local.x
  );
}

float perlin3(vec3 value) {
  float result = 0.0;
  float scale = 1.0;
  float weight = 1.0;
  for (int i = 0; i < 5; i++) {
    scale *= 2.0;
    weight *= 0.5;
    result += weight * noise3(scale * value);
  }
  return result;
}

float streakLayer(vec2 base, float scale, float anisotropy, float seed, float flow) {
  vec2 coord = vec2(base.x, base.y) * vec2(scale, scale * anisotropy);
  coord.x += flow * scale;
  float streak = noiseTexture(coord, seed);
  streak *= noiseTexture(coord * 0.67 + vec2(31.7, -13.5), seed * 0.63) * 1.55;
  return clamp(pow(abs(streak), 6.0) * 9.0, 0.0, 1.0);
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec3 color = texture(colorTexture, uv).rgb;

  float animatedTime = time * speed;
  float windMag = abs(wind);
  float windDir = wind >= 0.0 ? 1.0 : -1.0;
  float flowBase = animatedTime * (0.25 + 0.75 * windMag) * windDir;
  vec2 shear = vec2(uv.x + uv.y * wind, uv.y);

  float rollFlow = animatedTime * 0.05;
  float bankDrift = animatedTime * wind * 0.004;
  float bankA = perlin3(vec3(shear.x * 2.4 - bankDrift, shear.y * 2.4, rollFlow * 0.8));
  float bankB = perlin3(vec3(shear.x * 6.5 - bankDrift * 0.7, shear.y * 5.5, rollFlow * 1.2 + 4.1));
  float bankMask = smoothstep(0.34, 0.78, mix(bankA, bankB, 0.45));

  float ground = smoothstep(0.0, 1.0, uv.y);
  float fogAmount = clamp(haze * mix(1.35, 0.72, ground) * (0.45 + 1.15 * bankMask), 0.0, 1.0);

  vec3 dustColor = mix(vec3(0.70, 0.58, 0.42), vec3(0.86, 0.74, 0.52), tint);
  vec3 darkSand = vec3(0.45, 0.33, 0.20);
  vec3 fogColor = mix(dustColor, mix(dustColor, darkSand, 0.5), haze * 0.5);
  color = mix(color, fogColor, fogAmount);

  float grainScale = mix(110.0, 230.0, clamp((density - 0.2) / 2.8, 0.0, 1.0));
  float grainNear = streakLayer(shear, grainScale, 3.2, 7.0, flowBase * 0.22);
  float grainFar = streakLayer(shear, grainScale * 0.55, 2.3, 43.0, flowBase * 0.10);
  vec3 grainColor = mix(vec3(0.86, 0.74, 0.52), vec3(0.99, 0.93, 0.74), tint);
  float grainAmount = density * (grainNear + grainFar * 0.6) * 0.14 * (0.25 + 0.75 * fogAmount);
  color += grainColor * grainAmount;

  color = mix(color, color * vec3(1.06, 1.01, 0.88) + dustColor * 0.03, tint * 0.35);
  color *= 1.0 - 0.55 * darken;

  out_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`
