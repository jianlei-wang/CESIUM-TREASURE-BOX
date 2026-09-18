import { Cartesian2, Color, Event, Material } from 'cesium'

export const POLYLINE_TRAIL_TYPE = 'PolylineTrail'
export const POLYLINE_IMAGE_TRAIL_TYPE = 'PolylineImageTrail'
export const POLYLINE_FLOW_TYPE = 'PolylineFlow'
export const POLYLINE_FLICKER_TYPE = 'PolylineFlicker'
export const POLYLINE_LIGHTING_TRAIL_TYPE = 'PolylineLightingTrail'
export const POLYLINE_LIGHTING_TYPE = 'PolylineLighting'
export const POLYLINE_FENCE_TYPE = 'PolylineFence'
export const POLYLINE_MULTI_ARROW_TYPE = 'PolylineMultiArrow'
export const POLYLINE_DASH_ARROW_TYPE = 'PolylineDashArrow'
export const POLYLINE_DIRECTION_TYPE = 'PolylineDirection'

const POLYLINE_TRAIL_SOURCE = `
  uniform vec4 color;
  uniform float speed;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    float time = fract(czm_frameNumber * speed / 1000.0);
    material.diffuse = color.rgb;
    material.alpha = color.a * fract(st.s - time);
    return material;
  }
`

const POLYLINE_FLOW_SOURCE = `
  uniform vec4 color;
  uniform float speed;
  uniform float percent;
  uniform float gradient;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    float t = fract(czm_frameNumber * speed / 1000.0);
    t *= (1.0 + percent);
    float alpha = smoothstep(t - percent, t, st.s) * step(-t, -st.s);
    alpha += gradient;
    material.diffuse = color.rgb;
    material.alpha = alpha;
    return material;
  }
`

const POLYLINE_FLICKER_SOURCE = `
  uniform vec4 color;
  uniform float speed;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    float time = fract(czm_frameNumber * speed / 1000.0);
    float scalar = smoothstep(0.0, 1.0, time);
    material.diffuse = color.rgb * scalar;
    material.alpha = color.a * scalar;
    return material;
  }
`

const POLYLINE_IMAGE_TRAIL_SOURCE = `
  uniform sampler2D image;
  uniform float speed;
  uniform vec4 color;
  uniform vec2 repeat;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = repeat * materialInput.st;
    float time = fract(czm_frameNumber * speed / 1000.0);
    vec4 colorImage = texture(image, vec2(fract(st.s - time), st.t));
    if (color.a == 0.0) {
      if (colorImage.rgb == vec3(1.0) || colorImage.rgb == vec3(0.0)) {
        discard;
      }
      material.alpha = colorImage.a;
      material.diffuse = colorImage.rgb;
    } else {
      material.alpha = colorImage.a * color.a;
      material.diffuse = max(color.rgb * material.alpha * 3.0, color.rgb);
    }
    return material;
  }
`

const POLYLINE_LIGHTING_TRAIL_SOURCE = `
  uniform sampler2D image;
  uniform vec4 color;
  uniform float speed;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    float time = fract(czm_frameNumber * speed / 1000.0);
    vec4 colorImage = texture(image, st);
    vec3 fragColor = color.rgb;
    if (st.t > 0.45 && st.t < 0.55) {
      fragColor = vec3(1.0);
    }
    if (color.a == 0.0) {
      material.alpha = colorImage.a * 1.5 * fract(st.s - time);
      material.diffuse = colorImage.rgb;
    } else {
      material.alpha = colorImage.a * color.a * 1.5 * smoothstep(0.0, 1.0, fract(st.s - time));
      material.diffuse = max(fragColor.rgb * material.alpha, fragColor.rgb);
    }
    return material;
  }
`

const POLYLINE_LIGHTING_SOURCE = `
  uniform sampler2D image;
  uniform vec4 color;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    vec4 colorImage = texture(image, st);
    vec3 fragColor = color.rgb;
    material.alpha = colorImage.a * color.a * 3.0;
    material.diffuse = max(fragColor.rgb + colorImage.rgb, fragColor.rgb);
    return material;
  }
`

const POLYLINE_FENCE_SOURCE = `
  uniform vec4 color;
  uniform float dashLength;
  uniform float dashPattern;
  uniform float maskLength;
  uniform float outlineWidth;
  uniform vec4 outlineColor;

  in float v_polylineAngle;
  in float v_width;

  mat2 rotate(float rad) {
    float c = cos(rad);
    float s = sin(rad);
    return mat2(c, s, -s, c);
  }

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    float halfInteriorWidth = 0.5 * (v_width - outlineWidth) / v_width;
    float b = step(0.5 - halfInteriorWidth, st.t);
    b *= 1.0 - step(0.5 + halfInteriorWidth, st.t);
    float d1 = abs(st.t - (0.5 - halfInteriorWidth));
    float d2 = abs(st.t - (0.5 + halfInteriorWidth));
    float dist = min(d1, d2);
    vec4 currentColor = mix(outlineColor, color, b);
    vec4 outColor = czm_antialias(outlineColor, color, currentColor, dist);
    vec4 gapColor = czm_gammaCorrect(outColor);

    vec2 pos = rotate(v_polylineAngle) * gl_FragCoord.xy;
    float dashPosition = fract(pos.x / (dashLength * czm_pixelRatio));
    float maskIndex = floor(dashPosition * maskLength);
    float maskTest = floor(dashPattern / pow(2.0, maskIndex));
    vec4 fragColor = (mod(maskTest, 2.0) < 1.0) ? gapColor : color;
    if (fragColor.a < 0.005) {
      discard;
    }
    fragColor = czm_gammaCorrect(fragColor);
    material.emission = fragColor.rgb;
    material.alpha = fragColor.a;
    return material;
  }
`

const POLYLINE_MULTI_ARROW_SOURCE = `
  uniform vec4 color;
  uniform float repeatFactor;
  uniform bool antiClockWise;

  float getPointOnLine(vec2 p0, vec2 p1, float x) {
    float slope = (p0.y - p1.y) / (p0.x - p1.x);
    return slope * (x - p0.x) + p0.y;
  }

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    if (antiClockWise) {
      st.s = 1.0 - st.s;
    }
    float arrowWidth = 1.0 / repeatFactor;
    st.s = mod(st.s, arrowWidth) / arrowWidth;

    float base = 1.0 - abs(fwidth(st.s)) * 10.0 * czm_pixelRatio;
    vec2 center = vec2(1.0, 0.5);
    center.s += 0.01;

    float ptOnUpperLine = getPointOnLine(vec2(base, 1.0), center, st.s);
    float ptOnLowerLine = getPointOnLine(vec2(base, 0.0), center, st.s);

    float halfWidth = 0.15;
    float s = step(0.5 - halfWidth, st.t);
    s *= 1.0 - step(0.5 + halfWidth, st.t);
    s *= 1.0 - step(base, st.s);

    float t = step(base, st.s);
    t *= 1.0 - step(ptOnUpperLine, st.t);
    t *= step(ptOnLowerLine, st.t);

    float dist;
    if (st.s < base) {
      float d1 = abs(st.t - (0.5 - halfWidth));
      float d2 = abs(st.t - (0.5 + halfWidth));
      dist = min(d1, d2);
    } else {
      float d1 = czm_infinity;
      if (st.t < 0.5 - halfWidth && st.t > 0.5 + halfWidth) {
        d1 = abs(st.s - base);
      }
      float d2 = abs(st.t - ptOnUpperLine);
      float d3 = abs(st.t - ptOnLowerLine);
      dist = min(min(d1, d2), d3);
    }

    vec4 outsideColor = vec4(0.0);
    vec4 currentColor = mix(outsideColor, color, clamp(s + t, 0.0, 1.0));
    vec4 outColor = czm_antialias(outsideColor, color, currentColor, dist);
    outColor = czm_gammaCorrect(outColor);
    material.diffuse = outColor.rgb;
    material.alpha = outColor.a;
    return material;
  }
`

const POLYLINE_DASH_ARROW_SOURCE = `
  uniform vec4 color;
  uniform vec4 gapColor;
  uniform float dashLength;
  uniform float dashPattern;

  in float v_polylineAngle;
  in float v_width;

  const float maskLength = 16.0;

  mat2 rotate(float rad) {
    float c = cos(rad);
    float s = sin(rad);
    return mat2(c, s, -s, c);
  }

  float getPointOnLine(vec2 p0, vec2 p1, float x) {
    float slope = (p0.y - p1.y) / (p0.x - p1.x);
    return slope * (x - p0.x) + p0.y;
  }

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 pos = rotate(v_polylineAngle) * gl_FragCoord.xy;
    float dashPosition = fract(pos.x / (dashLength * czm_pixelRatio));
    float maskIndex = floor(dashPosition * maskLength);
    float maskTest = floor(dashPattern / pow(2.0, maskIndex));
    vec4 fragColor = (mod(maskTest, 2.0) < 1.0) ? gapColor : color;

    vec2 st = materialInput.st;
    float base = 1.0 - abs(fwidth(st.s)) * 10.0 * czm_pixelRatio;
    vec2 center = vec2(1.0, 0.5);
    float ptOnUpperLine = getPointOnLine(vec2(base, 1.0), center, st.s);
    float ptOnLowerLine = getPointOnLine(vec2(base, 0.0), center, st.s);

    float halfWidth = 0.15;
    float s = step(0.5 - halfWidth, st.t);
    s *= 1.0 - step(0.5 + halfWidth, st.t);
    s *= 1.0 - step(base, st.s);

    float t = step(base, materialInput.st.s);
    t *= 1.0 - step(ptOnUpperLine, st.t);
    t *= step(ptOnLowerLine, st.t);

    float dist;
    if (st.s < base) {
      if (fragColor.a < 0.005) {
        discard;
      }
      float d1 = abs(st.t - (0.5 - halfWidth));
      float d2 = abs(st.t - (0.5 + halfWidth));
      dist = min(d1, d2);
    } else {
      fragColor = color;
      float d1 = czm_infinity;
      if (st.t < 0.5 - halfWidth && st.t > 0.5 + halfWidth) {
        d1 = abs(st.s - base);
      }
      float d2 = abs(st.t - ptOnUpperLine);
      float d3 = abs(st.t - ptOnLowerLine);
      dist = min(min(d1, d2), d3);
    }

    vec4 outsideColor = vec4(0.0);
    vec4 currentColor = mix(outsideColor, fragColor, clamp(s + t, 0.0, 1.0));
    vec4 outColor = czm_antialias(outsideColor, fragColor, currentColor, dist);
    outColor = czm_gammaCorrect(outColor);
    material.diffuse = outColor.rgb;
    material.alpha = outColor.a;
    return material;
  }
`

const POLYLINE_DIRECTION_SOURCE = `
  uniform vec4 color;
  uniform vec4 directionColor;
  uniform vec4 outlineColor;
  uniform float outlineWidth;

  in float v_width;
  in float v_polylineAngle;

  const float fragLength = 100.0;
  const float startPosition = 0.45;
  const float endPosition = 0.55;

  mat2 rotate(float rad) {
    float c = cos(rad);
    float s = sin(rad);
    return mat2(c, s, -s, c);
  }

  float getPointOnLine(vec2 p0, vec2 p1, float x) {
    float slope = (p0.y - p1.y) / (p0.x - p1.x);
    return slope * (x - p0.x) + p0.y;
  }

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;

    float halfInteriorWidth = 0.5 * (v_width - outlineWidth) / v_width;
    float b = step(0.5 - halfInteriorWidth, st.t);
    b *= 1.0 - step(0.5 + halfInteriorWidth, st.t);

    float d1 = abs(st.t - (0.5 - halfInteriorWidth));
    float d2 = abs(st.t - (0.5 + halfInteriorWidth));
    float dist = min(d1, d2);

    vec4 currentColor = mix(outlineColor, color, b);
    vec4 outColor = czm_antialias(outlineColor, color, currentColor, dist);
    outColor = czm_gammaCorrect(outColor);

    vec2 pos = rotate(v_polylineAngle) * gl_FragCoord.xy;
    float maskS = fract(pos.x / (fragLength * czm_pixelRatio));
    float maskT = st.t;
    bool isDirection = (maskS > startPosition) && (maskS <= endPosition);

    vec4 fragColor;
    if (isDirection) {
      float arrowWidth = (endPosition - startPosition) / 2.0;
      float midS = startPosition + arrowWidth;
      float t = 1.0;
      if (maskS < midS) {
        vec2 center = vec2(midS, 0.5);
        float ptOnUpperLine = getPointOnLine(vec2(startPosition, 1.0), center, maskS);
        float ptOnLowerLine = getPointOnLine(vec2(startPosition, 0.0), center, maskS);
        t *= 1.0 - step(ptOnUpperLine, maskT);
        t *= step(ptOnLowerLine, maskT);
        t = 1.0 - t;
      } else {
        vec2 center = vec2(endPosition, 0.5);
        float ptOnUpperLine = getPointOnLine(vec2(midS, 1.0), center, maskS);
        float ptOnLowerLine = getPointOnLine(vec2(midS, 0.0), center, maskS);
        t *= 1.0 - step(ptOnUpperLine, maskT);
        t *= step(ptOnLowerLine, maskT);
      }
      vec4 outsideColor = outColor;
      vec4 currentColor = mix(outsideColor, directionColor, clamp(t, 0.0, 1.0));
      fragColor = currentColor;
    } else {
      fragColor = outColor;
    }

    fragColor = czm_gammaCorrect(fragColor);
    material.diffuse = fragColor.rgb;
    material.alpha = fragColor.a;
    return material;
  }
`

let registered = false

export function registerPolylineMaterials(): void {
  if (registered) return
  registered = true
  const cache = (Material as unknown as {
    _materialCache: { getMaterial: (t: string) => unknown; addMaterial: (t: string, m: unknown) => void }
  })._materialCache
  const entries: Array<{ type: string; source: string; uniforms: Record<string, unknown> }> = [
    {
      type: POLYLINE_TRAIL_TYPE,
      source: POLYLINE_TRAIL_SOURCE,
      uniforms: { color: new Color(0.2, 0.6, 1.0, 0.7), speed: 1 }
    },
    {
      type: POLYLINE_IMAGE_TRAIL_TYPE,
      source: POLYLINE_IMAGE_TRAIL_SOURCE,
      uniforms: {
        image: Material.DefaultImageId,
        speed: 1,
        color: new Color(0.2, 0.8, 0.4, 0.7),
        repeat: new Cartesian2(1, 1)
      }
    },
    {
      type: POLYLINE_FLOW_TYPE,
      source: POLYLINE_FLOW_SOURCE,
      uniforms: {
        color: new Color(1.0, 0.6, 0.2, 0.7),
        speed: 1,
        percent: 0.03,
        gradient: 0.1
      }
    },
    {
      type: POLYLINE_FLICKER_TYPE,
      source: POLYLINE_FLICKER_SOURCE,
      uniforms: { color: new Color(1.0, 0.2, 0.2, 0.7), speed: 1 }
    },
    {
      type: POLYLINE_LIGHTING_TRAIL_TYPE,
      source: POLYLINE_LIGHTING_TRAIL_SOURCE,
      uniforms: { image: Material.DefaultImageId, color: new Color(1.0, 0.9, 0.2, 0.7), speed: 3 }
    },
    {
      type: POLYLINE_LIGHTING_TYPE,
      source: POLYLINE_LIGHTING_SOURCE,
      uniforms: { image: Material.DefaultImageId, color: new Color(1.0, 0.9, 0.2, 0.7) }
    },
    {
      type: POLYLINE_FENCE_TYPE,
      source: POLYLINE_FENCE_SOURCE,
      uniforms: {
        color: new Color(1.0, 1.0, 1.0, 1.0),
        outlineColor: new Color(1.0, 1.0, 1.0, 1.0),
        dashLength: 10,
        dashPattern: 15,
        outlineWidth: 16,
        maskLength: 20
      }
    },
    {
      type: POLYLINE_MULTI_ARROW_TYPE,
      source: POLYLINE_MULTI_ARROW_SOURCE,
      uniforms: { color: Color.WHITE, repeatFactor: 1, antiClockWise: true }
    },
    {
      type: POLYLINE_DASH_ARROW_TYPE,
      source: POLYLINE_DASH_ARROW_SOURCE,
      uniforms: {
        color: Color.WHITE,
        gapColor: Color.TRANSPARENT,
        dashLength: 16,
        dashPattern: 255
      }
    },
    {
      type: POLYLINE_DIRECTION_TYPE,
      source: POLYLINE_DIRECTION_SOURCE,
      uniforms: {
        color: new Color(0.0, 1.0, 1.0, 1.0),
        directionColor: new Color(1.0, 1.0, 1.0, 1.0),
        outlineColor: new Color(1.0, 1.0, 1.0, 1.0),
        outlineWidth: 0
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

export type PolylineMaterialKind =
  | 'PolylineTrail'
  | 'PolylineImageTrail'
  | 'PolylineFlow'
  | 'PolylineFlicker'
  | 'PolylineLightingTrail'
  | 'PolylineLighting'
  | 'PolylineFence'
  | 'PolylineMultiArrow'
  | 'PolylineDashArrow'
  | 'PolylineDirection'

export type PolylineMaterialOptions = {
  color?: Color
  speed?: number
  percent?: number
  gradient?: number
  repeatX?: number
  repeatY?: number
  image?: string
  dashLength?: number
  dashPattern?: number
  maskLength?: number
  outlineWidth?: number
  outlineColor?: Color
  directionColor?: Color
  repeatFactor?: number
  antiClockWise?: boolean
}

export class PolylineMaterialProperty {
  private _definitionChanged: Event = new Event()
  private _kind: PolylineMaterialKind
  private _color: Color
  private _speed: number
  private _percent: number
  private _gradient: number
  private _repeatX: number
  private _repeatY: number
  private _image?: string
  private _dashLength: number
  private _dashPattern: number
  private _maskLength: number
  private _outlineWidth: number
  private _outlineColor: Color
  private _directionColor: Color
  private _repeatFactor: number
  private _antiClockWise: boolean

  constructor(kind: PolylineMaterialKind, options: PolylineMaterialOptions = {}) {
    this._kind = kind
    this._color = options.color ?? new Color(0.2, 0.6, 1.0, 0.7)
    this._speed = options.speed ?? 1
    this._percent = options.percent ?? 0.03
    this._gradient = options.gradient ?? 0.1
    this._repeatX = options.repeatX ?? 1
    this._repeatY = options.repeatY ?? 1
    this._image = options.image
    this._dashLength = options.dashLength ?? 10
    this._dashPattern = options.dashPattern ?? 15
    this._maskLength = options.maskLength ?? 20
    this._outlineWidth = options.outlineWidth ?? 16
    this._outlineColor = options.outlineColor ?? new Color(1, 1, 1, 1)
    this._directionColor = options.directionColor ?? new Color(1, 1, 1, 1)
    this._repeatFactor = options.repeatFactor ?? 2
    this._antiClockWise = options.antiClockWise ?? true
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

  get percent(): number {
    return this._percent
  }
  set percent(value: number) {
    if (this._percent === value) return
    this._percent = value
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

  get dashLength(): number {
    return this._dashLength
  }
  set dashLength(value: number) {
    if (this._dashLength === value) return
    this._dashLength = value
    this._definitionChanged.raiseEvent(this)
  }

  get dashPattern(): number {
    return this._dashPattern
  }
  set dashPattern(value: number) {
    if (this._dashPattern === value) return
    this._dashPattern = value
    this._definitionChanged.raiseEvent(this)
  }

  get maskLength(): number {
    return this._maskLength
  }
  set maskLength(value: number) {
    if (this._maskLength === value) return
    this._maskLength = value
    this._definitionChanged.raiseEvent(this)
  }

  get outlineWidth(): number {
    return this._outlineWidth
  }
  set outlineWidth(value: number) {
    if (this._outlineWidth === value) return
    this._outlineWidth = value
    this._definitionChanged.raiseEvent(this)
  }

  get outlineColor(): Color {
    return this._outlineColor
  }
  set outlineColor(value: Color) {
    if (this._outlineColor.equals(value)) return
    this._outlineColor = value
    this._definitionChanged.raiseEvent(this)
  }

  get directionColor(): Color {
    return this._directionColor
  }
  set directionColor(value: Color) {
    if (this._directionColor.equals(value)) return
    this._directionColor = value
    this._definitionChanged.raiseEvent(this)
  }

  get repeatFactor(): number {
    return this._repeatFactor
  }
  set repeatFactor(value: number) {
    if (this._repeatFactor === value) return
    this._repeatFactor = value
    this._definitionChanged.raiseEvent(this)
  }

  get antiClockWise(): boolean {
    return this._antiClockWise
  }
  set antiClockWise(value: boolean) {
    if (this._antiClockWise === value) return
    this._antiClockWise = value
    this._definitionChanged.raiseEvent(this)
  }

  getType(): string {
    switch (this._kind) {
      case 'PolylineTrail':
        return POLYLINE_TRAIL_TYPE
      case 'PolylineImageTrail':
        return POLYLINE_IMAGE_TRAIL_TYPE
      case 'PolylineFlow':
        return POLYLINE_FLOW_TYPE
      case 'PolylineFlicker':
        return POLYLINE_FLICKER_TYPE
      case 'PolylineLightingTrail':
        return POLYLINE_LIGHTING_TRAIL_TYPE
      case 'PolylineLighting':
        return POLYLINE_LIGHTING_TYPE
      case 'PolylineFence':
        return POLYLINE_FENCE_TYPE
      case 'PolylineMultiArrow':
        return POLYLINE_MULTI_ARROW_TYPE
      case 'PolylineDashArrow':
        return POLYLINE_DASH_ARROW_TYPE
      case 'PolylineDirection':
        return POLYLINE_DIRECTION_TYPE
    }
  }

  getValue(time: unknown, result?: Record<string, unknown>): Record<string, unknown> {
    if (!result) result = {}
    result.color = Color.clone(this._color, result.color as Color | undefined)
    result.speed = this._speed
    if (this._image) result.image = this._image
    if (this._kind === 'PolylineImageTrail') {
      result.repeat = new Cartesian2(this._repeatX, this._repeatY)
    }
    if (this._kind === 'PolylineFlow') {
      result.percent = this._percent
      result.gradient = this._gradient
    }
    if (this._kind === 'PolylineFence') {
      result.dashLength = this._dashLength
      result.dashPattern = this._dashPattern
      result.maskLength = this._maskLength
      result.outlineWidth = this._outlineWidth
      result.outlineColor = Color.clone(this._outlineColor, result.outlineColor as Color | undefined)
    }
    if (this._kind === 'PolylineDirection') {
      result.directionColor = Color.clone(this._directionColor, result.directionColor as Color | undefined)
      result.outlineColor = Color.clone(this._outlineColor, result.outlineColor as Color | undefined)
      result.outlineWidth = this._outlineWidth
    }
    if (this._kind === 'PolylineMultiArrow') {
      result.repeatFactor = this._repeatFactor
      result.antiClockWise = this._antiClockWise
    }
    if (this._kind === 'PolylineDashArrow') {
      result.dashLength = this._dashLength
      result.dashPattern = this._dashPattern
    }
    return result
  }

  equals(other: unknown): boolean {
    return (
      this === other ||
      (other instanceof PolylineMaterialProperty &&
        this._kind === other._kind &&
        this._color.equals(other._color) &&
        this._speed === other._speed &&
        this._percent === other._percent &&
        this._gradient === other._gradient &&
        this._repeatX === other._repeatX &&
        this._repeatY === other._repeatY &&
        this._image === other._image &&
        this._dashLength === other._dashLength &&
        this._dashPattern === other._dashPattern &&
        this._maskLength === other._maskLength &&
        this._outlineWidth === other._outlineWidth &&
        this._outlineColor.equals(other._outlineColor) &&
        this._directionColor.equals(other._directionColor) &&
        this._repeatFactor === other._repeatFactor &&
        this._antiClockWise === other._antiClockWise)
    )
  }
}
