import { Cartesian2, Color, Material } from 'cesium'

export const ELLIPSOID_ELECTRIC_TYPE = 'EllipsoidElectric'
export const CIRCLE_RING_TYPE = 'CircleRing'
export const CIRCLE_ROTATE_TYPE = 'CircleRotate'
export const CYLINDER_FADE_TYPE = 'CylinderFade'
export const CYLINDER_PARTICLES_TYPE = 'CylinderParticles'

const ELLIPSOID_ELECTRIC_SOURCE = `
  uniform vec4 color;
  uniform float speed;

  #define pi 3.1415926535

  float rands(float p){
    return fract(sin(p) * 10000.0);
  }

  float noise(vec2 p){
    float time = fract(czm_frameNumber * speed / 1000.0);
    float t = time / 20000.0;
    if(t > 1.0) t -= floor(t);
    return rands(p.x * 14. + p.y * sin(t) * 0.5);
  }

  vec2 sw(vec2 p){ return vec2(floor(p.x), floor(p.y)); }
  vec2 se(vec2 p){ return vec2(ceil(p.x), floor(p.y)); }
  vec2 nw(vec2 p){ return vec2(floor(p.x), ceil(p.y)); }
  vec2 ne(vec2 p){ return vec2(ceil(p.x), ceil(p.y)); }

  float smoothNoise(vec2 p){
    vec2 inter = smoothstep(0.0, 1.0, fract(p));
    float s = mix(noise(sw(p)), noise(se(p)), inter.x);
    float n = mix(noise(nw(p)), noise(ne(p)), inter.x);
    return mix(s, n, inter.y);
  }

  float fbm(vec2 p){
    float z = 2.0;
    float rz = 0.0;
    vec2 bp = p;
    for(float i = 1.0; i < 6.0; i++){
      rz += abs((smoothNoise(p) - 0.5) * 2.0) / z;
      z *= 2.0;
      p *= 2.0;
    }
    return rz;
  }

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    vec2 st2 = materialInput.st;
    float time = fract(czm_frameNumber * speed / 1000.0);
    if (st.t < 0.5) {
      discard;
    }
    st *= 4.0;
    float rz = fbm(st);
    st /= exp(mod(time * 2.0, pi));
    rz *= pow(15.0, 0.9);
    vec4 temp = vec4(0.0);
    temp = mix(color / rz, vec4(color.rgb, 0.1), 0.2);
    if (st2.s < 0.05) {
      temp = mix(vec4(color.rgb, 0.1), temp, st2.s / 0.05);
    }
    if (st2.s > 0.95) {
      temp = mix(temp, vec4(color.rgb, 0.1), (st2.s - 0.95) / 0.05);
    }
    material.diffuse = temp.rgb;
    material.alpha = temp.a * 2.0;
    return material;
  }
`

const CIRCLE_RING_SOURCE = `
  uniform vec4 color;
  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    vec2 center = st - vec2(0.5, 0.5);
    float length = length(center) / 0.5;
    float time = 1.0 - abs(czm_frameNumber / 360.0 - 0.5);
    float param = 1.0 - step(length, 0.6);
    float scale = param * length;
    float alpha = param * (1.0 - abs(scale - 0.8) / 0.2);
    float param1 = step(length, 0.7);
    float scale1 = param1 * length;
    alpha += param1 * (1.0 - abs(scale1 - 0.35) / 0.35);
    material.diffuse = color.rgb * vec3(color.a);
    material.alpha = pow(alpha, 4.0);
    return material;
  }
`

const CIRCLE_ROTATE_SOURCE = `
  uniform vec4 color;
  uniform sampler2D image;
  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    vec2 center = st - vec2(0.5, 0.5);
    float time = -czm_frameNumber * 3.1415926 / 180.0;
    float sin_t = sin(time);
    float cos_t = cos(time);
    vec2 center_rotate = vec2(center.s * cos_t - center.t * sin_t + 0.5, center.s * sin_t + center.t * cos_t + 0.5);
    vec4 colorImage = texture(image, center_rotate);
    vec3 temp = colorImage.rgb * color.rgb;
    temp *= color.a;
    material.diffuse = temp;
    float length = 2.0 - length(center) / 0.5;
    material.alpha = colorImage.a * pow(length, 0.5);
    return material;
  }
`

const CYLINDER_FADE_SOURCE = `
  uniform vec4 color;
  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    float powerRatio = 1.0 / (fract(czm_frameNumber / 30.0) + 1.0);
    float alpha = pow(1.0 - st.t, powerRatio);
    vec4 temp = vec4(color.rgb, alpha * color.a);
    material.diffuse = temp.rgb;
    material.alpha = temp.a;
    return material;
  }
`

const CYLINDER_PARTICLES_SOURCE = `
  uniform vec4 color;
  uniform sampler2D image;
  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    float time = fract(czm_frameNumber / 90.0);
    vec2 new_st = fract(st - vec2(time, time));
    vec4 colorImage = texture(image, new_st);
    vec3 diffuse = colorImage.rgb;
    float alpha = colorImage.a;
    diffuse *= color.rgb;
    alpha *= color.a;
    material.diffuse = diffuse;
    material.alpha = alpha * pow(1.0 - st.t, color.a);
    return material;
  }
`

let registered = false

export function registerPrimitiveMaterials(): void {
  if (registered) return
  registered = true
  const cache = (Material as unknown as {
    _materialCache: { getMaterial: (t: string) => unknown; addMaterial: (t: string, m: unknown) => void }
  })._materialCache
  const entries: Array<{ type: string; source: string; uniforms: Record<string, unknown> }> = [
    {
      type: ELLIPSOID_ELECTRIC_TYPE,
      source: ELLIPSOID_ELECTRIC_SOURCE,
      uniforms: { color: new Color(0.2, 1.0, 0.4, 0.8), speed: 5 }
    },
    {
      type: CIRCLE_RING_TYPE,
      source: CIRCLE_RING_SOURCE,
      uniforms: { color: new Color(0.3, 0.7, 1.0, 0.8) }
    },
    {
      type: CIRCLE_ROTATE_TYPE,
      source: CIRCLE_ROTATE_SOURCE,
      uniforms: { color: new Color(0.3, 0.7, 1.0, 0.8), image: Material.DefaultImageId }
    },
    {
      type: CYLINDER_FADE_TYPE,
      source: CYLINDER_FADE_SOURCE,
      uniforms: { color: new Color(0.3, 0.7, 1.0, 0.7) }
    },
    {
      type: CYLINDER_PARTICLES_TYPE,
      source: CYLINDER_PARTICLES_SOURCE,
      uniforms: { color: new Color(0.3, 0.7, 1.0, 0.7), image: Material.DefaultImageId }
    }
  ]
  for (const entry of entries) {
    if (cache.getMaterial(entry.type)) continue
    cache.addMaterial(entry.type, {
      fabric: {
        type: entry.type,
        uniforms: entry.uniforms,
        source: entry.source
      },
      translucent: () => true
    })
  }
}

export function makeCircleImage(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.fillStyle = 'rgba(255,255,255,0)'
  ctx.strokeStyle = 'rgba(255, 255, 255, 1)'
  ctx.setLineDash([50, 50])
  ctx.lineWidth = 30
  ctx.beginPath()
  ctx.arc(256, 256, 150, 0, Math.PI * 2, true)
  ctx.stroke()
  return canvas
}

export function makeParticlesImage(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.clearRect(0, 0, 64, 256)
  const grad = ctx.createLinearGradient(0, 256, 0, 0)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  for (let i = 0; i < 4; i++) {
    const x = 4 + i * 16
    ctx.fillRect(x, 8, 10, 240)
  }
  return canvas
}

export type PrimitiveMaterialKind = 'EllipsoidElectric' | 'CircleRing' | 'CircleRotate' | 'CylinderFade' | 'CylinderParticles'
