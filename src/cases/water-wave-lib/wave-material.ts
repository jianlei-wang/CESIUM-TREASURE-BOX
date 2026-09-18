import { Color, defined, Event, Material } from 'cesium'

export const CIRCLE_WAVE_TYPE = 'CircleWaveMaterial'

function defaultValue<T>(a: T | undefined, b: T): T {
  return a !== undefined ? a : b
}

const CIRCLE_WAVE_SOURCE = `
  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    material.diffuse = 1.5 * color.rgb;
    vec2 st = materialInput.st;
    vec3 str = materialInput.str;
    float dis = distance(st, vec2(0.5, 0.5));
    float per = fract(time);
    if (abs(str.z) > 0.001) {
      discard;
    }
    if (dis > 0.5) {
      discard;
    } else {
      float perDis = 0.5 / count;
      float disNum;
      float bl = .0;
      for (int i = 0; i <= 9; i++) {
        if (float(i) <= count) {
          disNum = perDis *float(i) - dis + per / count;
          if (disNum > 0.0) {
            if (disNum < perDis) {
              bl = 1.0 - disNum / perDis;
            } else if(disNum - perDis < perDis) {
              bl = 1.0 - abs(1.0 - disNum / perDis);
            }
            material.alpha = pow(bl, gradient);
          }
        }
      }
    }
    return material;
  }
`

export type CircleWaveOptions = {
  color?: string
  duration?: number
  count?: number
  gradient?: number
}

export class CircleWaveMaterialProperty {
  private _definitionChanged: Event = new Event()
  private _color: Color
  private _duration: number
  private _count: number
  private _gradient: number
  private _time: number

  constructor(options: CircleWaveOptions = {}) {
    this._color = options.color ? Color.fromCssColorString(options.color) : Color.RED
    this._duration = defaultValue(options.duration, 1000)
    this._count = defaultValue(options.count, 2)
    if (this._count <= 0) this._count = 1
    this._gradient = defaultValue(options.gradient, 0.1)
    if (this._gradient > 1) this._gradient = 1
    this._time = new Date().getTime()
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

  get gradient(): number {
    return this._gradient
  }
  set gradient(value: number) {
    if (this._gradient === value) return
    this._gradient = value
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

  get count(): number {
    return this._count
  }
  set count(value: number) {
    if (this._count === value) return
    this._count = value
    this._definitionChanged.raiseEvent(this)
  }

  getType(): string {
    return CIRCLE_WAVE_TYPE
  }

  getValue(time: unknown, result?: Record<string, unknown>): Record<string, unknown> {
    if (!defined(result)) result = {}
    result.color = Color.clone(this._color, result.color as Color | undefined)
    result.time = ((new Date().getTime() - this._time) % this._duration) / this._duration
    result.count = this._count
    result.gradient = 1 + 10 * (1 - this._gradient)
    return result
  }

  equals(other: unknown): boolean {
    return (
      this === other ||
      (other instanceof CircleWaveMaterialProperty &&
        this._color.equals(other._color) &&
        this._duration === other._duration &&
        this._count === other._count &&
        this._gradient === other._gradient)
    )
  }
}

let registered = false

export function registerCircleWaveMaterial(): void {
  if (registered) return
  registered = true
  const cache = (Material as unknown as { _materialCache: { getMaterial: (t: string) => unknown; addMaterial: (t: string, m: unknown) => void } })._materialCache
  if (cache.getMaterial(CIRCLE_WAVE_TYPE)) return
  cache.addMaterial(CIRCLE_WAVE_TYPE, {
    fabric: {
      type: CIRCLE_WAVE_TYPE,
      uniforms: {
        color: new Color(181, 241, 254, 1),
        time: 1,
        count: 1,
        gradient: 0.1
      },
      source: CIRCLE_WAVE_SOURCE
    },
    translucent: () => true
  })
}
