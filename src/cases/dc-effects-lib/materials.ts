import { Color, defined, Event, Material } from 'cesium'

export const CIRCLE_RING_TYPE = 'CircleRingMaterial'
export const CIRCLE_FADE_TYPE = 'CircleFadeMaterial'
export const CIRCLE_BLUR_TYPE = 'CircleBlurMaterial'
export const CIRCLE_DIFFUSE_TYPE = 'CircleDiffuseMaterial'
export const CIRCLE_SPIRAL_TYPE = 'CircleSpiralMaterial'
export const CIRCLE_PULSE_TYPE = 'CirclePulseMaterial'
export const CIRCLE_VARY_TYPE = 'CircleVaryMaterial'
export const RADAR_LINE_TYPE = 'RadarLineMaterial'
export const RADAR_WAVE_TYPE = 'RadarWaveMaterial'
export const RADAR_OUTER_TYPE = 'RadarOuterMaterial'

const CIRCLE_RING_SOURCE = `
  uniform vec4 color;
  uniform float speed;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    vec2 center = st - vec2(0.5, 0.5);
    float radius = length(center) / 0.5;
    float t = czm_frameNumber * speed / 1000.0;
    float pulse = 0.5 + 0.5 * sin(t * 2.0);
    float outerR = 0.55 + 0.3 * pulse;
    float param = 1.0 - step(radius, outerR);
    float scale = param * radius;
    float alpha = param * (1.0 - abs(scale - outerR - 0.15) / 0.15);
    float innerR = 0.45 - 0.25 * pulse;
    float param1 = step(radius, innerR);
    float scale1 = param1 * radius;
    alpha += param1 * (1.0 - abs(scale1 - innerR * 0.5) / (innerR * 0.5));
    material.diffuse = color.rgb * vec3(color.a);
    material.alpha = pow(alpha, 4.0);
    return material;
  }
`

const CIRCLE_FADE_SOURCE = `
  uniform vec4 color;
  uniform float speed;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    material.diffuse = 1.5 * color.rgb;
    vec2 st = materialInput.st;
    float dis = distance(st, vec2(0.5, 0.5));
    float per = fract(czm_frameNumber * speed / 1000.0);
    if (dis > per * 0.5) {
      material.alpha = color.a;
    } else {
      discard;
    }
    return material;
  }
`

const CIRCLE_BLUR_SOURCE = `
  uniform vec4 color;
  uniform float speed;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    vec2 center = vec2(0.5);
    float time = fract(czm_frameNumber * speed / 1000.0);
    float r = 0.5 + sin(time) / 3.0;
    float dis = distance(st, center);
    float a = 0.0;
    if (dis < r) {
      a = 1.0 - smoothstep(0.0, r, dis);
    }
    material.alpha = pow(a, 10.0);
    material.diffuse = color.rgb * a * 3.0;
    return material;
  }
`

const CIRCLE_DIFFUSE_SOURCE = `
  uniform vec4 color;
  uniform float speed;

  vec3 circlePing(float r, float innerTail, float frontierBorder, float timeResetSeconds, float radarPingSpeed, float fadeDistance) {
    float t = fract(czm_frameNumber * speed / 1000.0);
    float time = mod(t, timeResetSeconds) * radarPingSpeed;
    float circle;
    circle += smoothstep(time - innerTail, time, r) * smoothstep(time + frontierBorder, time, r);
    circle *= smoothstep(fadeDistance, 0.0, r);
    return vec3(circle);
  }

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st * 2.0 - 1.0;
    vec2 center = vec2(0.0);
    float time = fract(czm_frameNumber * speed / 1000.0);
    vec3 flagColor;
    float r = length(st - center) / 4.0;
    flagColor += circlePing(r, 0.25, 0.025, 4.0, 0.3, 1.0) * color.rgb;
    material.alpha = length(flagColor);
    material.diffuse = flagColor.rgb;
    return material;
  }
`

const CIRCLE_SPIRAL_SOURCE = `
  uniform vec4 color;
  uniform float speed;

  #define PI 3.14159265359

  vec2 rotate2D(vec2 st, float angle) {
    st = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * st;
    return st;
  }

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st * 2.0 - 1.0;
    st *= 1.6;
    float time = czm_frameNumber * speed / 1000.0;
    float r = length(st);
    float w = 0.3;
    st = rotate2D(st, (r * PI * 6.0 - time * 2.0));
    float a = smoothstep(-w, 0.2, st.x) * smoothstep(w, 0.2, st.x);
    float b = abs(1.0 / (sin(pow(r, 2.0) * 2.0 - time * 1.3) * 6.0)) * 0.4;
    material.alpha = a * b;
    material.diffuse = color.rgb * a * b * 3.0;
    return material;
  }
`

const CIRCLE_PULSE_SOURCE = `
  uniform vec4 color;
  uniform float speed;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st * 2.0 - 1.0;
    float time = fract(czm_frameNumber * speed / 1000.0);
    float r = length(st) * 1.2;
    float a = pow(r, 2.0);
    float b = sin(r * 0.8 - 1.6);
    float c = sin(r - 0.010);
    float s = sin(a - time * 2.0 + b) * c;
    float d = abs(1.0 / (s * 10.8)) - 0.01;
    material.alpha = pow(d, 10.0);
    material.diffuse = color.rgb * d;
    return material;
  }
`

const CIRCLE_VARY_SOURCE = `
  uniform vec4 color;
  uniform float speed;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st * 2.0 - 1.0;
    float time = czm_frameNumber * speed / 1000.0;
    float radius = length(st);
    float angle = atan(st.y / st.x);
    float radius1 = sin(time * 2.0) + sin(40.0 * angle + time) * 0.01;
    float radius2 = cos(time * 3.0);
    vec3 fragColor = 0.2 + 0.5 * cos(time + color.rgb + vec3(0, 2, 4));
    float inten1 = 1.0 - sqrt(abs(radius1 - radius));
    float inten2 = 1.0 - sqrt(abs(radius2 - radius));
    material.alpha = pow(inten1 + inten2, 5.0);
    material.diffuse = fragColor * (inten1 + inten2);
    return material;
  }
`

const RADAR_LINE_SOURCE = `
  uniform vec4 color;
  uniform float speed;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st * 2.0 - 1.0;
    float t = czm_frameNumber * speed / 1000.0;
    vec3 col = vec3(0.0);
    vec2 p = vec2(sin(t), cos(t));
    float d = length(st - dot(p, st) * p);
    if (dot(st, p) < 0.0) {
      d = length(st);
    }
    col = 0.006 / d * color.rgb;
    if (distance(st, vec2(0.0)) > 0.99) {
      col = color.rgb;
    }
    material.alpha = pow(length(col), 2.0);
    material.diffuse = col * 3.0;
    return material;
  }
`

const RADAR_WAVE_SOURCE = `
  uniform vec4 color;
  uniform float speed;

  #define PI 3.14159265359

  float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
  }

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    vec2 pos = st - vec2(0.5);
    float time = czm_frameNumber * speed / 1000.0;
    float r = length(pos);
    float t = atan(pos.y, pos.x) - time * 2.5;
    float a = (atan(sin(t), cos(t)) + PI) / (2.0 * PI);
    float ta = 0.5;
    float v = smoothstep(ta - 0.05, ta + 0.05, a) * smoothstep(ta + 0.05, ta - 0.05, a);
    vec3 flagColor = color.rgb * v;
    float blink = pow(sin(time * 1.5) * 0.5 + 0.5, 0.8);
    flagColor = color.rgb * pow(a, 8.0 * (0.2 + blink)) * (sin(r * 500.0) * 0.5 + 0.5);
    flagColor = flagColor * pow(r, 0.4);
    material.alpha = length(flagColor) * 1.3;
    material.diffuse = flagColor * 3.0;
    return material;
  }
`

const RADAR_OUTER_SOURCE = `
  uniform vec4 color;
  uniform float speed;
  uniform float repeat;
  uniform float thickness;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    float sp = 1.0 / repeat;
    vec2 st = materialInput.st;
    float dis = distance(st, vec2(0.5));
    float t = czm_frameNumber * speed / 1000.0;
    float m = mod(dis - fract(t), sp);
    float a = step(sp * (1.0 - thickness), m);
    material.diffuse = color.rgb;
    material.alpha = a * color.a;
    return material;
  }
`

export type DcEffectsOptions = {
  color?: Color
  speed?: number
  repeat?: number
  thickness?: number
}

export class DcCircleMaterialProperty {
  private _definitionChanged: Event = new Event()
  private _type: string
  private _color: Color
  private _speed: number
  private _repeat?: number
  private _thickness?: number

  constructor(type: string, options: DcEffectsOptions = {}) {
    this._type = type
    this._color = options.color ?? new Color(0, 1, 1, 0.8)
    this._speed = options.speed ?? 3
    this._repeat = options.repeat
    this._thickness = options.thickness
  }

  get isConstant(): boolean {
    return false
  }

  get definitionChanged(): Event {
    return this._definitionChanged
  }

  get color(): Color {
    return this._color
  }
  set color(value: Color) {
    if (this._color.equals(value)) return
    this._color = value
    this._definitionChanged.raiseEvent(this)
  }

  get speed(): number {
    return this._speed
  }
  set speed(value: number) {
    if (this._speed === value) return
    this._speed = value
    this._definitionChanged.raiseEvent(this)
  }

  get repeat(): number | undefined {
    return this._repeat
  }
  set repeat(value: number | undefined) {
    if (this._repeat === value) return
    this._repeat = value
    this._definitionChanged.raiseEvent(this)
  }

  get thickness(): number | undefined {
    return this._thickness
  }
  set thickness(value: number | undefined) {
    if (this._thickness === value) return
    this._thickness = value
    this._definitionChanged.raiseEvent(this)
  }

  getType(): string {
    return this._type
  }

  getValue(time: unknown, result?: Record<string, unknown>): Record<string, unknown> {
    if (!defined(result)) result = {}
    result.color = Color.clone(this._color, result.color as Color | undefined)
    result.speed = this._speed
    if (this._repeat !== undefined) result.repeat = this._repeat
    if (this._thickness !== undefined) result.thickness = this._thickness
    return result
  }

  equals(other: unknown): boolean {
    return (
      this === other ||
      (other instanceof DcCircleMaterialProperty &&
        this._type === other._type &&
        this._color.equals(other._color) &&
        this._speed === other._speed &&
        this._repeat === other._repeat &&
        this._thickness === other._thickness)
    )
  }
}

let registered = false

export function registerDcEffectsMaterials(): void {
  if (registered) return
  registered = true
  const cache = (Material as unknown as {
    _materialCache: { getMaterial: (t: string) => unknown; addMaterial: (t: string, m: unknown) => void }
  })._materialCache
  const entries: Array<{ type: string; source: string; uniforms: Record<string, unknown> }> = [
    { type: CIRCLE_RING_TYPE, source: CIRCLE_RING_SOURCE, uniforms: { color: new Color(1, 0, 0, 0.7), speed: 3 } },
    { type: CIRCLE_FADE_TYPE, source: CIRCLE_FADE_SOURCE, uniforms: { color: new Color(1, 0, 0, 0.7), speed: 3 } },
    { type: CIRCLE_BLUR_TYPE, source: CIRCLE_BLUR_SOURCE, uniforms: { color: new Color(1, 0, 0, 0.7), speed: 3 } },
    { type: CIRCLE_DIFFUSE_TYPE, source: CIRCLE_DIFFUSE_SOURCE, uniforms: { color: new Color(1, 0, 0, 0.7), speed: 3 } },
    { type: CIRCLE_SPIRAL_TYPE, source: CIRCLE_SPIRAL_SOURCE, uniforms: { color: new Color(1, 0, 0, 0.7), speed: 3 } },
    { type: CIRCLE_PULSE_TYPE, source: CIRCLE_PULSE_SOURCE, uniforms: { color: new Color(1, 0, 0, 0.7), speed: 12 } },
    { type: CIRCLE_VARY_TYPE, source: CIRCLE_VARY_SOURCE, uniforms: { color: new Color(1, 0, 0, 0.7), speed: 3 } },
    { type: RADAR_LINE_TYPE, source: RADAR_LINE_SOURCE, uniforms: { color: new Color(0, 1, 1, 0.8), speed: 3 } },
    { type: RADAR_WAVE_TYPE, source: RADAR_WAVE_SOURCE, uniforms: { color: new Color(0, 1, 1, 0.8), speed: 3 } },
    { type: RADAR_OUTER_TYPE, source: RADAR_OUTER_SOURCE, uniforms: { color: new Color(0, 1, 1, 0.8), speed: 3, repeat: 30, thickness: 0.3 } }
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
