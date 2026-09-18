import { Cartesian2, Color, Event, Material } from 'cesium'

export const FLOW_RING_TRAIL_TYPE = 'GroundFlowRingTrail'
export const FLOW_LINE_TRAIL_TYPE = 'GroundFlowLineTrail'
export const PULSE_DIFFUSE_TYPE = 'GroundPulseDiffuse'

const FLOW_RING_TRAIL_SOURCE = `
  uniform sampler2D image;
  uniform vec4 color;
  uniform float speed;
  uniform vec2 repeat;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = repeat * materialInput.st;
    float time = fract(czm_frameNumber * speed / 1000.0);
    vec4 colorImage = texture(image, vec2(fract(st.s - time), st.t));
    if (color.a == 0.0) {
      material.alpha = colorImage.a;
      material.diffuse = colorImage.rgb;
    } else {
      material.alpha = colorImage.a * color.a;
      material.diffuse = max(color.rgb * material.alpha * 3.0, color.rgb);
    }
    return material;
  }
`

const FLOW_LINE_TRAIL_SOURCE = `
  uniform sampler2D image;
  uniform vec4 color;
  uniform float speed;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    float time = fract(czm_frameNumber * speed / 1000.0);
    vec4 colorImage = texture(image, vec2(fract(st.s - time), st.t));
    material.alpha = colorImage.a * color.a;
    material.diffuse = colorImage.rgb * color.rgb;
    return material;
  }
`

const PULSE_DIFFUSE_SOURCE = `
  uniform vec4 color;
  uniform float speed;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st * 2.0 - 1.0;
    float r = length(st);
    float t = fract(czm_frameNumber * speed / 1000.0);
    float radius = t * 1.1;
    float ring = exp(-pow(max(r - radius, 0.0) / 0.1, 2.0));
    float inner = smoothstep(radius, radius - 0.5, r);
    float a = ring + inner * 0.3;
    material.diffuse = color.rgb * a;
    material.alpha = color.a * a;
    return material;
  }
`

let registered = false

export function registerFlowMaterials(): void {
  if (registered) return
  registered = true
  const cache = (Material as unknown as {
    _materialCache: { getMaterial: (t: string) => unknown; addMaterial: (t: string, m: unknown) => void }
  })._materialCache
  const entries: Array<{ type: string; source: string; uniforms: Record<string, unknown> }> = [
    {
      type: FLOW_RING_TRAIL_TYPE,
      source: FLOW_RING_TRAIL_SOURCE,
      uniforms: {
        image: Material.DefaultImageId,
        color: new Color(1.0, 0.2, 0.2, 0.85),
        speed: 30,
        repeat: new Cartesian2(24, 1)
      }
    },
    {
      type: FLOW_LINE_TRAIL_TYPE,
      source: FLOW_LINE_TRAIL_SOURCE,
      uniforms: {
        image: Material.DefaultImageId,
        color: new Color(1.0, 1.0, 1.0, 0.9),
        speed: 20
      }
    },
    {
      type: PULSE_DIFFUSE_TYPE,
      source: PULSE_DIFFUSE_SOURCE,
      uniforms: {
        color: new Color(1.0, 0.2, 0.2, 0.5),
        speed: 10
      }
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

export class FlowRingMaterialProperty {
  private _definitionChanged: Event = new Event()
  private _color: Color
  private _speed: number
  private _repeatX: number
  private _image: string

  constructor(color: Color, speed: number, repeatX: number, image: string) {
    this._color = color
    this._speed = speed
    this._repeatX = repeatX
    this._image = image
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
    this._color = value
    this._definitionChanged.raiseEvent(this)
  }
  get speed(): number {
    return this._speed
  }
  set speed(value: number) {
    this._speed = value
    this._definitionChanged.raiseEvent(this)
  }
  get repeatX(): number {
    return this._repeatX
  }
  set repeatX(value: number) {
    this._repeatX = value
    this._definitionChanged.raiseEvent(this)
  }
  get image(): string {
    return this._image
  }
  set image(value: string) {
    this._image = value
    this._definitionChanged.raiseEvent(this)
  }

  getType(): string {
    return FLOW_RING_TRAIL_TYPE
  }

  getValue(time: unknown, result?: Record<string, unknown>): Record<string, unknown> {
    if (!result) result = {}
    result.color = Color.clone(this._color, result.color as Color | undefined)
    result.speed = this._speed
    result.image = this._image
    result.repeat = new Cartesian2(this._repeatX, 1)
    return result
  }

  equals(other: unknown): boolean {
    return (
      this === other ||
      (other instanceof FlowRingMaterialProperty &&
        this._color.equals(other._color) &&
        this._speed === other._speed &&
        this._repeatX === other._repeatX &&
        this._image === other._image)
    )
  }
}

export class FlowLineMaterialProperty {
  private _definitionChanged: Event = new Event()
  private _color: Color
  private _speed: number
  private _image: string

  constructor(color: Color, speed: number, image: string) {
    this._color = color
    this._speed = speed
    this._image = image
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
    this._color = value
    this._definitionChanged.raiseEvent(this)
  }
  get speed(): number {
    return this._speed
  }
  set speed(value: number) {
    this._speed = value
    this._definitionChanged.raiseEvent(this)
  }
  get image(): string {
    return this._image
  }
  set image(value: string) {
    this._image = value
    this._definitionChanged.raiseEvent(this)
  }

  getType(): string {
    return FLOW_LINE_TRAIL_TYPE
  }

  getValue(time: unknown, result?: Record<string, unknown>): Record<string, unknown> {
    if (!result) result = {}
    result.color = Color.clone(this._color, result.color as Color | undefined)
    result.speed = this._speed
    result.image = this._image
    return result
  }

  equals(other: unknown): boolean {
    return (
      this === other ||
      (other instanceof FlowLineMaterialProperty &&
        this._color.equals(other._color) &&
        this._speed === other._speed &&
        this._image === other._image)
    )
  }
}

export class PulseDiffuseMaterialProperty {
  private _definitionChanged: Event = new Event()
  private _color: Color
  private _speed: number

  constructor(color: Color, speed: number) {
    this._color = color
    this._speed = speed
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
    this._color = value
    this._definitionChanged.raiseEvent(this)
  }
  get speed(): number {
    return this._speed
  }
  set speed(value: number) {
    this._speed = value
    this._definitionChanged.raiseEvent(this)
  }

  getType(): string {
    return PULSE_DIFFUSE_TYPE
  }

  getValue(time: unknown, result?: Record<string, unknown>): Record<string, unknown> {
    if (!result) result = {}
    result.color = Color.clone(this._color, result.color as Color | undefined)
    result.speed = this._speed
    return result
  }

  equals(other: unknown): boolean {
    return (
      this === other ||
      (other instanceof PulseDiffuseMaterialProperty &&
        this._color.equals(other._color) &&
        this._speed === other._speed)
    )
  }
}
