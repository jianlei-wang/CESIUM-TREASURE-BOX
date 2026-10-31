// The eyepieces, two overlapping circles merged into one wide opening in a 160x90 box fitted to
// the canvas, near black around them, with an uneven edge. Inside, lens effects: a slight fisheye
// and color fringes toward the rim, both stronger at high magnification, the light falling off and
// the image softening toward the rim, a violet and orange edge, specks of dirt on the glass, and
// a depth of field focused on the middle of the view that gets shallower as the magnification
// grows. Optionally, a rangefinder reticle, a mil scale that grows with the magnification. Picking
// ignores the fisheye, so near the rim the picked point is a little off what is shown.
precision highp sampler2D;
uniform sampler2D colorTexture;
uniform sampler2D blurTexture;
uniform sampler2D depthTexture;
uniform float magnification;
// 1 to draw the reticle, 0 not to
uniform float reticle;
// device pixels per milliradian, from the field of view
uniform float pixelsPerMil;
in vec2 v_textureCoordinates;

const vec2 BOX = vec2(160.0, 90.0);
const vec2 LEFT = vec2(55.2, 45.0);
const vec2 RIGHT = vec2(104.8, 45.0);
const float RADIUS = 43.3;
// how much the notches between the eyepieces fill in, in box units
const float MERGE = 6.0;
// half width of the soft edge of the eyepieces, in box units
const float EDGE = 3.5;
// around the eyepieces
const vec3 SURROUND = vec3(0.02);
// the edge of the opening for red is this much further right, and for blue further left, in box
// units, so it fades through violet on the left and orange on the right
const float EDGE_SHIFT = 2.0;
// the edge wanders in and out by up to this much, in box units, with bumps about BUMP apart
const float UNEVEN = 1.2;
const float BUMP = 9.0;
// specks of dirt on the glass: cells per canvas height, share of cells with a speck, how dark
const float DIRT_CELLS = 45.0;
const float DIRT_DENSITY = 0.015;
const float DIRT = 0.55;
// the effects only apply within this distance of the rim, in box units, so the middle of the
// view, where the eyepieces overlap, stays clean
const float BAND = 20.0;
// fisheye: on the rim, sample up to this fraction further from the center, at 5x
const float FISHEYE = 0.07;
// color fringe on the rim, in box units, at 5x
const float FRINGE = 1.0;
// light lost on the rim of an eyepiece
const float VIGNETTE = 0.25;
// a ring this wide inside the edge, in box units, where the glass bends the light more: it starts
// abruptly and shows the image from RING_PULL further in, blurred, with a wider color fringe
const float RING = 4.5;
const float RING_PULL = 1.5;
const float RING_FRINGE = 0.15;
// blur on the rim, off the optical axis
const float RIM_BLUR = 1.0;
// sharp within this many factors of two of the focal distance at 1x, narrower as 1 / magnification
const float FOCUS_RANGE = 2.0;

// ticks of the reticle closer than this, in CSS pixels, are left out for every 5th or 10th
const float MIN_TICK_SPACING = 6.0;
// ticks on each side of the middle, and the empty gap in the middle, in ticks
const float TICKS = 10.0;
const float GAP = 1.0;
// dark lines in a light halo, readable on dark forest as on snow
const vec4 RETICLE = vec4(0.05, 0.05, 0.05, 0.9);
const vec4 HALO = vec4(0.9, 0.9, 0.85, 0.6);

// coverage of a line this far from the pixel, width pixels wide
float line(float distance, float width) {
  return 1.0 - smoothstep(0.5 * width - 0.5, 0.5 * width + 0.5, distance);
}

// coverage of the reticle at a pixel, in device pixels from the middle of the view, with lines
// width device pixels wide: a cross of mil scales, ticks every 1, 5 or 10 mils, longer every 5th
float reticleAt(vec2 p, float width) {
  float minSpacing = MIN_TICK_SPACING * czm_pixelRatio;
  float spacing = pixelsPerMil;
  if (spacing < minSpacing) {
    spacing *= 5.0;
  }
  if (spacing < minSpacing) {
    spacing *= 2.0;
  }
  float coverage = 0.0;
  // one axis at a time: along is the distance along the scale, across the distance from it
  for (int axis = 0; axis < 2; axis++) {
    float along = axis == 0 ? p.x : p.y;
    float across = axis == 0 ? p.y : p.x;
    float fromMiddle = abs(along);
    if (fromMiddle < GAP * spacing || fromMiddle > TICKS * spacing + width) {
      continue;
    }
    float tick = floor(fromMiddle / spacing + 0.5);
    float tickLength = (mod(tick, 5.0) == 0.0 ? 6.0 : 3.0) * czm_pixelRatio + 0.5 * width;
    coverage = max(coverage, line(abs(across), width));
    if (abs(across) < tickLength) {
      coverage = max(coverage, line(abs(fromMiddle - tick * spacing), width));
    }
  }
  return coverage;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// coverage of the dirt at a pixel, in canvas heights: at most one small speck per cell, some
// with a smaller one next to it, so they are not all round
float dirtAt(vec2 p) {
  // before the branch: derivatives are undefined where neighboring pixels take different ones,
  // and not from inCell, which jumps at the cell borders
  float soft = 0.5 * fwidth(p.x * DIRT_CELLS);
  vec2 cell = floor(p * DIRT_CELLS);
  if (hash(cell) > DIRT_DENSITY) {
    return 0.0;
  }
  vec2 inCell = fract(p * DIRT_CELLS);
  vec2 center = 0.35 + 0.3 * vec2(hash(cell + 17.0), hash(cell + 31.0));
  float radius = 0.04 + 0.12 * hash(cell + 47.0) * hash(cell + 53.0);
  vec2 satellite = center + (vec2(hash(cell + 61.0), hash(cell + 67.0)) - 0.5) * 3.0 * radius;
  float speck = 1.0 - smoothstep(radius - soft, radius + soft, length(inCell - center));
  float small = 1.0 - smoothstep(0.6 * radius - soft, 0.6 * radius + soft, length(inCell - satellite));
  // some specks darker than others
  return (0.4 + 0.6 * hash(cell + 79.0)) * max(speck, small * step(0.5, hash(cell + 71.0)));
}

// smooth noise between -1 and 1, one bump per unit
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return 2.0 * mix(mix(a, b, f.x), mix(c, d, f.x), f.y) - 1.0;
}

// distance in box units to the edge of the opening, negative inside: a smooth union of the two
// circles, which fills in the notches between them, made uneven
float toRimAt(vec2 position) {
  float toLeftRim = length(position - LEFT) - RADIUS;
  float toRightRim = length(position - RIGHT) - RADIUS;
  float h = clamp(0.5 + 0.5 * (toRightRim - toLeftRim) / MERGE, 0.0, 1.0);
  float toRim = mix(toRightRim, toLeftRim, h) - MERGE * h * (1.0 - h);
  vec2 p = position / BUMP;
  return toRim + UNEVEN * (0.7 * noise(p) + 0.3 * noise(2.7 * p + 5.0));
}

// offsets in box units for one eyepiece: xy the fisheye, zw the color fringe
vec4 lensOffsets(vec2 toCenter, float strength) {
  float fromCenter = length(toCenter);
  // 0 up to the band, 1 on the rim
  float rim = 1.0 - clamp((RADIUS - fromCenter) / BAND, 0.0, 1.0);
  vec2 direction = toCenter / max(fromCenter, 1e-3);
  return strength * vec4(toCenter * FISHEYE * rim * rim, direction * FRINGE * rim * rim * rim);
}

// the scene at uv, blurred by the depth of field around the focal distance and toward the rim
vec4 sampleAt(vec2 uv, float focalDistance, float rimBlur) {
  vec4 eye = eyeAt(depthTexture, uv);
  float fromCamera = eye.w == 0.0 ? 1e30 : length(eye.xyz);
  float range = FOCUS_RANGE / magnification;
  float defocus = focalDistance > 0.0
    ? smoothstep(range, 2.0 * range, abs(log2(fromCamera / focalDistance)))
    : 0.0;
  // no depth of field at 1x, fully from 3x
  defocus *= smoothstep(1.0, 3.0, magnification);
  return mix(texture(colorTexture, uv), texture(blurTexture, uv), max(defocus, rimBlur));
}

void main() {
  vec2 size = czm_viewport.zw;
  float scale = min(size.x / BOX.x, size.y / BOX.y);
  vec2 position = (v_textureCoordinates * size - 0.5 * (size - scale * BOX)) / scale;
  vec2 toLeft = position - LEFT;
  vec2 toRight = position - RIGHT;

  // cheap optics show their flaws more when zoomed in: 0.6 at 1x, 1 at 5x, 2 at 20x and beyond
  float strength = clamp(0.5 + magnification / 10.0, 0.6, 2.0);
  vec4 left = lensOffsets(toLeft, strength);
  vec4 right = lensOffsets(toRight, strength);
  // blend the two eyepieces where they overlap, so there is no seam between them
  float weight = smoothstep(-6.0, 6.0, length(toRight) - length(toLeft));
  float toRim = toRimAt(position);
  float ring = smoothstep(-RING, -RING + 1.5, toRim);
  vec2 outward = normalize(mix(toRight, toLeft, weight));
  vec4 offsets = (mix(right, left, weight) + ring * vec4(-RING_PULL * outward, RING_FRINGE * outward)) * scale / vec4(size, size);

  // focused on what is in the middle of the view; the sky there is at infinity
  vec4 target = eyeAt(depthTexture, vec2(0.5));
  float focalDistance = target.w == 0.0 ? 0.0 : length(target.xyz);
  // 0 in the middle of an eyepiece, 1 on the rim; from the edge of the opening, so the middle of
  // the view, where the eyepieces meet, is not dimmed
  float fromAxis = 1.0 + toRim / RADIUS;
  float rimBlur = max(RIM_BLUR * smoothstep(0.5, 0.95, fromAxis), ring);

  vec2 uv = v_textureCoordinates + offsets.xy;
  vec4 center = sampleAt(uv, focalDistance, rimBlur);
  vec3 color = vec3(
    sampleAt(uv + offsets.zw, focalDistance, rimBlur).r,
    center.g,
    sampleAt(uv - offsets.zw, focalDistance, rimBlur).b
  );
  // the light falls off toward the field stop
  color *= 1.0 - VIGNETTE * smoothstep(0.5, 1.0, fromAxis);
  color *= 1.0 - DIRT * dirtAt(gl_FragCoord.xy / size.y);
  if (reticle > 0.0) {
    vec2 fromMiddle = gl_FragCoord.xy - 0.5 * size;
    color = mix(color, HALO.rgb, HALO.a * reticleAt(fromMiddle, 3.0 * czm_pixelRatio));
    color = mix(color, RETICLE.rgb, RETICLE.a * reticleAt(fromMiddle, czm_pixelRatio));
  }
  vec2 shift = vec2(EDGE_SHIFT, 0.0);
  vec3 open = 1.0 - smoothstep(-EDGE, EDGE, vec3(toRimAt(position - shift), toRim, toRimAt(position + shift)));
  out_FragColor = vec4(mix(SURROUND, color, open), center.a);
}
