import { Color, ConstantProperty, defined, Event, Material } from 'cesium'

export const RADAR_PRIMITIVE_TYPE = 'RadarPrimitiveMaterial'

export const RADAR_PRIMITIVE_SOURCE = `
  uniform vec4 color;
  uniform float time;
  uniform float repeat;
  uniform float offset;
  uniform float thickness;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);

    vec2 st = materialInput.st;
    float dis = distance(st, vec2(0.5));
    float sp = 1.0 / repeat;

    float m = mod(dis + offset - time, sp);
    float edgeWidth = 0.02;
    float edge = sp * (1.0 - thickness);

    float a = 1.0 - smoothstep(edge - edgeWidth, edge, m);

    float distFade = pow(1.0 - dis, 1.5);

    float pulse = 0.5 + 0.5 * sin(time * 60.0);

    vec3 baseColor = color.rgb;
    vec3 edgeColor = baseColor * 1.8;
    vec3 finalColor = mix(baseColor, edgeColor, dis * 2.0);
    finalColor *= 1.0 + 0.2 * sin(time * 30.0 + dis * 10.0);

    material.diffuse = finalColor;
    material.emission = finalColor * a * distFade * 0.6;
    material.alpha = a * color.a * (0.7 + 0.3 * pulse);
    material.shininess = 80.0;

    return material;
  }
`

export type RadarOptions = {
  color?: Color
  duration?: number
  repeat?: number
  offset?: number
  thickness?: number
}

export class RadarPrimitiveMaterialProperty {
  private _definitionChanged: Event = new Event()
  private _color: ConstantProperty
  private _duration: number
  private _repeat: number
  private _offset: number
  private _thickness: number
  private _time: number

  constructor(options: RadarOptions = {}) {
    this._color = new ConstantProperty(options.color ?? Color.RED)
    this._duration = options.duration ?? 2000
    this._repeat = options.repeat ?? 15
    this._offset = options.offset ?? 0
    this._thickness = options.thickness ?? 0.3
    this._time = new Date().getTime()
  }

  get isConstant(): boolean {
    return false
  }

  get definitionChanged(): Event {
    return this._definitionChanged
  }

  get color(): Color {
    return this._color.getValue() as Color
  }
  set color(value: Color) {
    if (this.color.equals(value)) return
    this._color.setValue(value)
    this._definitionChanged.raiseEvent(this)
  }

  get duration(): number {
    return this._duration
  }
  set duration(value: number) {
    if (this._duration === value) return
    this._duration = value
    this._definitionChanged.raiseEvent(this)
  }

  get repeat(): number {
    return this._repeat
  }
  set repeat(value: number) {
    if (this._repeat === value) return
    this._repeat = value
    this._definitionChanged.raiseEvent(this)
  }

  get offset(): number {
    return this._offset
  }
  set offset(value: number) {
    if (this._offset === value) return
    this._offset = value
    this._definitionChanged.raiseEvent(this)
  }

  get thickness(): number {
    return this._thickness
  }
  set thickness(value: number) {
    if (this._thickness === value) return
    this._thickness = value
    this._definitionChanged.raiseEvent(this)
  }

  getType(): string {
    return RADAR_PRIMITIVE_TYPE
  }

  getValue(time: unknown, result?: Record<string, unknown>): Record<string, unknown> {
    if (!defined(result)) result = {}
    const now = new Date().getTime()
    result.color = Color.clone(this.color, result.color as Color | undefined)
    result.time = ((now - this._time) % this._duration) / this._duration / 10
    result.repeat = this._repeat
    result.offset = this._offset
    result.thickness = this._thickness
    return result
  }

  equals(other: unknown): boolean {
    return (
      this === other ||
      (other instanceof RadarPrimitiveMaterialProperty &&
        this.color.equals(other.color) &&
        this._duration === other._duration &&
        this._repeat === other._repeat &&
        this._offset === other._offset &&
        this._thickness === other._thickness)
    )
  }
}

let radarRegistered = false

export function registerRadarMaterial(): void {
  if (radarRegistered) return
  radarRegistered = true
  const cache = (Material as unknown as { _materialCache: { getMaterial: (t: string) => unknown; addMaterial: (t: string, m: unknown) => void } })._materialCache
  if (cache.getMaterial(RADAR_PRIMITIVE_TYPE)) return
  cache.addMaterial(RADAR_PRIMITIVE_TYPE, {
    fabric: {
      type: RADAR_PRIMITIVE_TYPE,
      uniforms: {
        color: new Color(0, 0.8, 1, 0.8),
        time: 0,
        repeat: 15,
        offset: 0,
        thickness: 0.4
      },
      source: RADAR_PRIMITIVE_SOURCE
    },
    translucent: () => true
  })
}
