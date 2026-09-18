import { Material } from 'cesium'

export const WATER_MATERIAL_TYPE = 'DynamicPolygonWater'

export const DYNAMIC_WATER_MATERIAL = `
uniform float time;
uniform float waveSpeed;
uniform float waveScale;
uniform float waveHeight;
uniform float clarity;

// Adapted from the procedural wave, normal, reflection, and foam ideas in
// Shadertoy csc3RS. Cesium Fabric materials do not expose feedback buffers.
float waterHash(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
}

float waterNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  return mix(
    mix(waterHash(cell), waterHash(cell + vec2(1.0, 0.0)), local.x),
    mix(waterHash(cell + vec2(0.0, 1.0)), waterHash(cell + vec2(1.0)), local.x),
    local.y
  );
}

float waterFbm(vec2 point) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotation = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) {
    value += waterNoise(point) * amplitude;
    point = rotation * point + 7.3;
    amplitude *= 0.5;
  }
  return value;
}

float waterHeightAt(vec2 point) {
  float animation = time * waveSpeed;
  float wave = sin(point.x * 8.0 + animation);
  wave += sin(point.y * 10.0 - animation * 0.8);
  wave += sin(dot(point, vec2(4.0, 7.0)) + animation * 1.5);
  wave /= 3.0;
  wave += waterFbm(point * 3.0 + animation * vec2(0.05, -0.03)) - 0.5;
  return wave * waveHeight;
}

czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  vec2 point = (materialInput.st - 0.5) * waveScale;
  float epsilon = 0.01;
  float height = waterHeightAt(point);
  float heightX = waterHeightAt(point + vec2(epsilon, 0.0));
  float heightY = waterHeightAt(point + vec2(0.0, epsilon));
  vec3 normal = normalize(vec3((height - heightX) * 15.0, (height - heightY) * 15.0, 1.0));

  vec3 deepWater = vec3(0.01, 0.10, 0.20);
  vec3 shallowWater = vec3(0.02, 0.45, 0.65);
  float depthTint = clamp(0.50 + height * 2.5, 0.0, 1.0);
  vec3 waterColor = mix(deepWater, shallowWater, depthTint) * clarity;
  float fresnel = pow(1.0 - clamp(normal.z, 0.0, 1.0), 3.0);
  vec3 lightDirection = normalize(vec3(-0.3, 0.4, 1.0));
  float specular = pow(max(dot(normal, lightDirection), 0.0), 80.0);
  float foam = smoothstep(0.65, 0.95, waterFbm(point * 5.0 + time * 0.08));

  material.diffuse = waterColor + specular + fresnel;
  material.diffuse = mix(material.diffuse, vec3(0.95, 0.98, 1.0), foam * 0.35);
  material.alpha = 0.78;
  material.normal = normal;
  return material;
}
`

export function registerWaterMaterial(): void {
  const materialCache = (Material as unknown as {
    _materialCache: {
      _materials?: Record<string, unknown>
      addMaterial: (type: string, definition: unknown) => void
    }
  })._materialCache

  if (materialCache._materials?.[WATER_MATERIAL_TYPE]) return

  materialCache.addMaterial(WATER_MATERIAL_TYPE, {
    fabric: {
      type: WATER_MATERIAL_TYPE,
      uniforms: { time: 0, waveSpeed: 1.5, waveScale: 3, waveHeight: 0.35, clarity: 1 },
      source: DYNAMIC_WATER_MATERIAL
    },
    translucent: true
  })
}
