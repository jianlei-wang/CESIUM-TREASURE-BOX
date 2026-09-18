import { Cartesian2, Color, Event, Material } from 'cesium'

export const WALL_DIFFUSE_TYPE = 'WallDiffuse'
export const WALL_TRAIL_TYPE = 'WallTrail'
export const WALL_IMAGE_TRAIL_TYPE = 'WallImageTrail'

const WALL_DIFFUSE_SOURCE = `
  uniform vec4 color;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    material.diffuse = color.rgb * 2.0;
    material.alpha = color.a * (1.0 - fract(st.t)) * 0.8;
    return material;
  }
`

const WALL_TRAIL_SOURCE = `
  uniform sampler2D image;
  uniform float speed;
  uniform vec4 color;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    float time = fract(czm_frameNumber * speed / 1000.0);
    vec4 colorImage = texture(image, vec2(fract(st.t - time), st.t));
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

const WALL_IMAGE_TRAIL_SOURCE = `
  uniform sampler2D image;
  uniform vec4 color;
  uniform float speed;
  uniform vec2 repeat;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st * repeat;
    float time = fract(czm_frameNumber * speed / 1000.0);
    vec4 colorImage = texture(image, vec2(fract(st.s - time), st.t));
    material.alpha = colorImage.a * color.a;
    material.diffuse = colorImage.rgb * color.rgb * 3.0;
    return material;
  }
`

let registered = false

export function registerWallMaterials(): void {
  if (registered) return
  registered = true
  const cache = (Material as unknown as {
    _materialCache: { getMaterial: (t: string) => unknown; addMaterial: (t: string, m: unknown) => void }
  })._materialCache
  const entries: Array<{ type: string; source: string; uniforms: Record<string, unknown> }> = [
    {
      type: WALL_DIFFUSE_TYPE,
      source: WALL_DIFFUSE_SOURCE,
      uniforms: { color: new Color(0.2, 0.6, 1.0, 0.7) }
    },
    {
      type: WALL_TRAIL_TYPE,
      source: WALL_TRAIL_SOURCE,
      uniforms: { image: Material.DefaultImageId, speed: 2, color: new Color(0.2, 0.8, 0.4, 0.7) }
    },
    {
      type: WALL_IMAGE_TRAIL_TYPE,
      source: WALL_IMAGE_TRAIL_SOURCE,
      uniforms: {
        image: Material.DefaultImageId,
        color: new Color(1.0, 0.8, 0.2, 0.8),
        speed: 6,
        repeat: new Cartesian2(12, 1)
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

export type WallMaterialKind = 'WallDiffuse' | 'WallTrail' | 'WallImageTrail'

export type WallMaterialOptions = {
  color?: Color
  speed?: number
  repeatX?: number
  repeatY?: number
  image?: string
}

export class WallMaterialProperty {
  private _definitionChanged: Event = new Event()
  private _kind: WallMaterialKind
  private _color: Color
  private _speed: number
  private _repeatX: number
  private _repeatY: number
  private _image?: string

  constructor(kind: WallMaterialKind, options: WallMaterialOptions = {}) {
    this._kind = kind
    this._color = options.color ?? new Color(0.2, 0.6, 1.0, 0.7)
    this._speed = options.speed ?? 2
    this._repeatX = options.repeatX ?? 12
    this._repeatY = options.repeatY ?? 1
    this._image = options.image
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

  get repeatX(): number {
    return this._repeatX
  }
  set repeatX(value: number) {
    if (this._repeatX === value) return
    this._repeatX = value
    this._definitionChanged.raiseEvent(this)
  }

  get repeatY(): number {
    return this._repeatY
  }
  set repeatY(value: number) {
    if (this._repeatY === value) return
    this._repeatY = value
    this._definitionChanged.raiseEvent(this)
  }

  get image(): string | undefined {
    return this._image
  }
  set image(value: string | undefined) {
    if (this._image === value) return
    this._image = value
    this._definitionChanged.raiseEvent(this)
  }

  getType(): string {
    if (this._kind === 'WallTrail') return WALL_TRAIL_TYPE
    if (this._kind === 'WallImageTrail') return WALL_IMAGE_TRAIL_TYPE
    return WALL_DIFFUSE_TYPE
  }

  getValue(time: unknown, result?: Record<string, unknown>): Record<string, unknown> {
    if (!result) result = {}
    result.color = Color.clone(this._color, result.color as Color | undefined)
    result.speed = this._speed
    if (this._image) result.image = this._image
    if (this._kind === 'WallImageTrail') {
      result.repeat = new Cartesian2(this._repeatX, this._repeatY)
    }
    return result
  }

  equals(other: unknown): boolean {
    return (
      this === other ||
      (other instanceof WallMaterialProperty &&
        this._kind === other._kind &&
        this._color.equals(other._color) &&
        this._speed === other._speed &&
        this._repeatX === other._repeatX &&
        this._repeatY === other._repeatY &&
        this._image === other._image)
    )
  }
}
